// Host <-> player link over a public MQTT relay (no account, no database).
//
// Why a relay: direct phone-to-phone WebRTC is blocked on most mobile networks
// and dies when the host's screen locks. MQTT over secure WebSockets goes
// through port 443-style TLS like any website, so it works everywhere.
//
// The host is still the source of truth. The relay only forwards messages and
// keeps the latest table state (a "retained" message), so players see the
// current table even while the host's phone is asleep.
//
// Everything is end-to-end encrypted (AES-GCM) with a key derived from the
// game code; the relay and anyone listening on it only see ciphertext on an
// opaque topic. We talk to two independent public brokers at once, so one
// going down doesn't end the game.

const BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt'];
const PING_MS = 20000;
const OFFLINE_AFTER_MS = 50000;

function brokers() {
  // ?broker=ws://127.0.0.1:8888 points at a local broker (used by tests).
  const override = new URLSearchParams(location.search).getAll('broker');
  return override.length ? override : BROKERS;
}

// ---------------- crypto ----------------

const enc = new TextEncoder();
const dec = new TextDecoder();

async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function channelFor(code) {
  const base = await crypto.subtle.importKey('raw', enc.encode(code.toUpperCase()), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode('felt-poker/v1'), iterations: 150000, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  const topic = `felt-poker/v1/${(await sha256Hex(`topic:${code.toUpperCase()}`)).slice(0, 32)}`;
  return { key, topic };
}

async function seal(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj))));
  const out = new Uint8Array(iv.length + data.length);
  out.set(iv);
  out.set(data, iv.length);
  return out;
}

async function open(key, bytes) {
  try {
    const u = new Uint8Array(bytes);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u.slice(0, 12) }, key, u.slice(12));
    return JSON.parse(dec.decode(plain));
  } catch {
    return null; // not ours, or tampered with
  }
}

// ---------------- multi-broker bus ----------------

// One logical connection fanned out over every broker. Messages carry an id so
// a message that arrives through both brokers is handled once.
class Bus {
  constructor({ clientId, clean, will, onMessage, onChange, subscribe }) {
    this.seen = new Set();
    this.seenOrder = [];
    this.onMessage = onMessage;
    this.onChange = onChange;
    this.clients = brokers().map((url) => {
      const c = window.mqtt.connect(url, {
        clientId,
        clean,
        keepalive: 30,
        reconnectPeriod: 2500,
        connectTimeout: 10000,
        protocolVersion: 4,
        will,
      });
      c.on('connect', () => {
        c.subscribe(subscribe, { qos: 1 });
        this.onChange();
      });
      for (const ev of ['close', 'offline', 'error']) c.on(ev, () => this.onChange());
      c.on('message', (topic, payload, packet) => this.onMessage(topic, payload, packet));
      return c;
    });
  }

  connected() {
    return this.clients.some((c) => c.connected);
  }

  publish(topic, payload, opts = { qos: 1 }) {
    for (const c of this.clients) if (c.connected) c.publish(topic, payload, opts);
    // Not connected right now: mqtt.js queues it and sends on reconnect.
    for (const c of this.clients) if (!c.connected) c.publish(topic, payload, opts);
  }

  dedupe(id) {
    if (!id) return false;
    if (this.seen.has(id)) return true;
    this.seen.add(id);
    this.seenOrder.push(id);
    if (this.seenOrder.length > 500) this.seen.delete(this.seenOrder.shift());
    return false;
  }

  end() {
    for (const c of this.clients) {
      try {
        c.end(true);
      } catch {}
    }
  }
}

const msgId = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

// ---------------- host ----------------

export class HostLink {
  constructor(code, { onMessage, onPresence, onStatus }) {
    this.onMessage = onMessage;
    this.onPresence = onPresence;
    this.onStatus = onStatus;
    this.peers = new Map(); // clientId -> { pid, seen }
    this.closed = false;
    this.onStatus('starting');
    this.ready = channelFor(code).then(({ key, topic }) => {
      if (this.closed) return;
      this.key = key;
      this.topic = topic;
      this.bus = new Bus({
        // Stable id + persistent session: messages sent while the host blinks
        // offline are queued by the broker and delivered when it's back.
        clientId: `felt-h-${topic.slice(-16)}`,
        clean: false,
        will: { topic: `${topic}/host`, payload: 'off', qos: 1, retain: true },
        subscribe: [`${topic}/up`],
        onChange: () => this.status(),
        onMessage: (_t, payload) => this.receive(payload),
      });
    });
    this.sweep = setInterval(() => this.expire(), 10000);
  }

  status() {
    if (this.closed || !this.bus) return;
    const live = this.bus.connected();
    if (live && !this.announced) {
      this.announced = true;
      this.bus.publish(`${this.topic}/host`, 'on', { qos: 1, retain: true });
      if (this.lastState) this.publishState(this.lastState);
    }
    if (!live) this.announced = false;
    this.onStatus(live ? 'live' : 'offline');
  }

  async receive(payload) {
    const msg = await open(this.key, payload);
    if (!msg || typeof msg !== 'object' || !msg.cid || this.bus.dedupe(msg.id)) return;
    const cid = String(msg.cid);
    const peer = this.peers.get(cid);
    if (msg.t === 'bye') {
      if (peer) {
        this.peers.delete(cid);
        this.onPresence();
      }
      return;
    }
    if (peer) {
      const wasOff = Date.now() - peer.seen > OFFLINE_AFTER_MS;
      peer.seen = Date.now();
      if (wasOff) this.onPresence();
    }
    if (msg.t === 'ping') {
      // A player we don't know yet (host reloaded): ask them to say hello.
      if (!peer) this.send(cid, { t: 'rehello' });
      return;
    }
    this.onMessage(msg, cid);
  }

  expire() {
    const now = Date.now();
    let changed = false;
    for (const [cid, p] of this.peers) {
      if (now - p.seen > OFFLINE_AFTER_MS && !p.reported) {
        p.reported = true;
        changed = true;
      } else if (now - p.seen <= OFFLINE_AFTER_MS && p.reported) {
        p.reported = false;
        changed = true;
      }
    }
    if (changed) this.onPresence();
  }

  bind(cid, pid) {
    this.peers.set(cid, { pid, seen: Date.now() });
    this.onPresence();
  }

  pidOf(cid) {
    return this.peers.get(cid)?.pid ?? null;
  }

  online() {
    const now = Date.now();
    return [...new Set([...this.peers.values()].filter((p) => now - p.seen <= OFFLINE_AFTER_MS).map((p) => p.pid))];
  }

  async send(cid, msg) {
    await this.ready;
    if (!this.bus) return;
    this.bus.publish(`${this.topic}/down/${cid}`, await seal(this.key, { ...msg, id: msgId() }));
  }

  async broadcast(msg) {
    this.lastState = msg;
    await this.ready;
    if (this.bus) this.publishState(msg);
  }

  async publishState(msg) {
    // Keep the retained payload small: the full log stays on the host.
    const game = { ...msg.game, log: msg.game.log.slice(-150) };
    this.bus.publish(`${this.topic}/state`, await seal(this.key, { ...msg, game, id: msgId() }), { qos: 1, retain: true });
  }

  close() {
    this.closed = true;
    clearInterval(this.sweep);
    this.bus?.end();
  }
}

// ---------------- player ----------------

export class PlayerLink {
  constructor(code, { hello, onMessage, onStatus }) {
    this.hello = hello;
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.pending = new Map();
    this.hostOn = null;
    this.closed = false;
    this.rev = -1;
    this.onStatus('connecting');
    this.ready = channelFor(code).then(async ({ key, topic }) => {
      if (this.closed) return;
      this.key = key;
      this.topic = topic;
      const cid = hello().clientId;
      this.cid = cid;
      this.bus = new Bus({
        clientId: `felt-p-${cid.slice(0, 12)}`,
        clean: true,
        will: { topic: `${topic}/up`, payload: await seal(key, { t: 'bye', cid, id: msgId() }), qos: 0, retain: false },
        subscribe: [`${topic}/state`, `${topic}/host`, `${topic}/down/${cid}`],
        onChange: () => this.connectedChanged(),
        onMessage: (t, payload) => this.receive(t, payload),
      });
    });
    this.timer = setInterval(() => this.up({ t: 'ping' }), PING_MS);
    this.onVis = () => {
      if (document.visibilityState === 'visible') this.up({ t: 'ping' });
    };
    document.addEventListener('visibilitychange', this.onVis);
  }

  connectedChanged() {
    if (this.closed) return;
    const up = this.bus.connected();
    if (up && !this.greeted) {
      this.greeted = true;
      this.up({ t: 'hello', ...this.hello() });
    }
    if (!up) this.greeted = false;
    this.report();
  }

  report() {
    if (!this.bus?.connected()) return this.onStatus('offline');
    if (this.hostOn === false) return this.onStatus('noHost');
    if (this.hostOn === true && this.welcomed) return this.onStatus('online');
    this.onStatus('connecting');
  }

  async receive(topic, payload) {
    if (topic.endsWith('/host')) {
      const on = String(payload) === 'on';
      if (on && this.hostOn === false) this.up({ t: 'hello', ...this.hello() });
      this.hostOn = on;
      return this.report();
    }
    const msg = await open(this.key, payload);
    if (!msg || this.bus.dedupe(msg.id)) return;
    if (msg.t === 'rehello') return this.up({ t: 'hello', ...this.hello() });
    if (msg.t === 'ok' || (msg.t === 'err' && msg.rid)) {
      const p = this.pending.get(msg.rid);
      if (p) {
        this.pending.delete(msg.rid);
        clearTimeout(p.timer);
        msg.t === 'ok' ? p.resolve(msg) : p.reject(Object.assign(new Error(msg.code), { code: msg.code }));
      }
      return;
    }
    if (msg.t === 'welcome') {
      this.welcomed = true;
      this.report();
    }
    if (msg.t === 'state') {
      // Both brokers deliver the same state; ignore anything older.
      if (msg.game?.rev != null && msg.game.id === this.gameId && msg.game.rev < this.rev) return;
      this.gameId = msg.game?.id;
      this.rev = msg.game?.rev ?? this.rev;
    }
    this.onMessage(msg);
  }

  async up(msg) {
    await this.ready;
    if (!this.bus || this.closed) return;
    this.bus.publish(`${this.topic}/up`, await seal(this.key, { ...msg, cid: this.cid, id: msgId() }));
  }

  request(type, payload) {
    return new Promise((resolve, reject) => {
      if (!this.bus?.connected() || this.hostOn === false) return reject(Object.assign(new Error('timeout'), { code: 'timeout' }));
      const rid = msgId();
      const timer = setTimeout(() => {
        this.pending.delete(rid);
        reject(Object.assign(new Error('timeout'), { code: 'timeout' }));
      }, 10000);
      this.pending.set(rid, { resolve, reject, timer });
      this.up({ t: 'act', rid, type, payload });
    });
  }

  close() {
    this.closed = true;
    clearInterval(this.timer);
    document.removeEventListener('visibilitychange', this.onVis);
    if (this.bus) {
      this.up({ t: 'bye' });
      setTimeout(() => this.bus.end(), 300);
    }
  }
}
