// Host <-> player link over Supabase Realtime (WebSockets over TLS).
//
// The host's phone runs the game: players send it actions, it applies them
// and broadcasts the new table. One channel per table, named after the
// table's 128-bit secret, which only people with the invite have.
//
// Anyone with the link can join a channel and send on it, so nothing on it
// is trusted by default:
// - The host has two key pairs: ECDSA to sign every table it sends, ECDH so
//   players can talk to it privately. Both public keys are saved with the
//   game in the database, which only the signed-in host can write; players
//   read them from there (over TLS) and check everything against them.
// - What a player sends the host is end-to-end encrypted with a key derived
//   from the host's ECDH key, so other players can't read it or forge it.
// - The table itself is signed but not encrypted: everyone at it sees it.

const STATE_LOG = 60; // activity entries sent with each table update

const enc = new TextEncoder();
const dec = new TextDecoder();

const b64 = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const unb64 = (s) => Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const rid = () => b64(crypto.getRandomValues(new Uint8Array(12)));

const ECDH = { name: 'ECDH', namedCurve: 'P-256' };
const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' };
const SIGN = { name: 'ECDSA', hash: 'SHA-256' };

const verifiers = new Map(); // public key -> CryptoKey

async function verify(publicRaw, data, sig) {
  try {
    let key = verifiers.get(publicRaw);
    if (!key) {
      key = await crypto.subtle.importKey('raw', unb64(publicRaw), ECDSA, false, ['verify']);
      verifiers.set(publicRaw, key);
    }
    return await crypto.subtle.verify(SIGN, key, unb64(sig), enc.encode(data));
  } catch {
    return false;
  }
}

async function sessionKey(privateKey, publicRaw, sid) {
  const pub = await crypto.subtle.importKey('raw', unb64(publicRaw), ECDH, false, []);
  const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: pub }, privateKey, 256);
  const hkdf = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode('felt/v2'), info: enc.encode(sid) },
    hkdf,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

// `dir` is bound into each message so a host reply can't be replayed as a
// player message or the other way round.
async function seal(key, dir, sid, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(dir + sid) }, key, enc.encode(JSON.stringify(obj)));
  return { iv: b64(iv), ct: b64(ct) };
}

async function open(key, dir, sid, { iv, ct }) {
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv), additionalData: enc.encode(dir + sid) }, key, unb64(ct));
    return JSON.parse(dec.decode(plain));
  } catch {
    return null; // not for us, or tampered with
  }
}

function channelFor(client, secret, presenceKey) {
  return client.channel(`felt:${secret}`, {
    config: { broadcast: { self: false, ack: false }, presence: { key: presenceKey } },
  });
}

// Remembers recent message ids so a replayed message is applied once.
class Seen {
  constructor() {
    this.set = new Set();
    this.order = [];
  }
  add(id) {
    if (!id || this.set.has(id)) return false;
    this.set.add(id);
    this.order.push(id);
    if (this.order.length > 300) this.set.delete(this.order.shift());
    return true;
  }
}

// ---------------- host ----------------

export class HostLink {
  constructor(client, secret, { onMessage, onPresence, onStatus }) {
    this.client = client;
    this.onMessage = onMessage;
    this.onPresence = onPresence;
    this.onStatus = onStatus;
    this.sessions = new Map(); // sid -> { key, pid, seen }
    this.onlinePids = new Set();
    this.closed = false;
    this.onStatus('starting');
    this.ready = this.start(secret);
  }

  async start(secret) {
    this.keys = await crypto.subtle.generateKey(ECDH, false, ['deriveBits']);
    this.signer = await crypto.subtle.generateKey(ECDSA, false, ['sign', 'verify']);
    this.publicKey = b64(await crypto.subtle.exportKey('raw', this.keys.publicKey));
    // Players trust these once they read them from the saved game.
    this.anchor = { dh: this.publicKey, sig: b64(await crypto.subtle.exportKey('raw', this.signer.publicKey)) };
    if (this.closed) return;
    const ch = (this.channel = channelFor(this.client, secret, 'host'));
    ch.on('broadcast', { event: 'up' }, ({ payload }) => this.receive(payload));
    ch.on('presence', { event: 'sync' }, () => this.presence());
    ch.subscribe((status) => {
      if (this.closed) return;
      if (status === 'SUBSCRIBED') {
        ch.track({ role: 'host', key: this.publicKey });
        this.onStatus('live');
        if (this.lastState) this.publish(this.lastState);
      } else {
        this.onStatus('offline');
      }
    });
  }

  presence() {
    const next = new Set();
    for (const [key, metas] of Object.entries(this.channel.presenceState())) {
      if (key === 'host') continue;
      for (const m of metas) if (m.pid) next.add(m.pid);
    }
    const changed = next.size !== this.onlinePids.size || [...next].some((p) => !this.onlinePids.has(p));
    this.onlinePids = next;
    if (changed) this.onPresence();
  }

  async receive(p) {
    if (!p || typeof p.sid !== 'string' || p.sid.length > 40) return;
    let s = this.sessions.get(p.sid);
    if (p.epk) {
      // A player says hello: derive their private key from their one-time
      // public key. A new hello replaces any older session with that id.
      try {
        s = { key: await sessionKey(this.keys.privateKey, p.epk, p.sid), pid: null, seen: new Seen() };
      } catch {
        return;
      }
      const msg = await open(s.key, 'up', p.sid, p);
      if (!msg || msg.t !== 'hello') return;
      this.sessions.set(p.sid, s);
      if (this.sessions.size > 200) this.sessions.delete(this.sessions.keys().next().value);
      if (!s.seen.add(msg.id)) return;
      return this.onMessage(msg, p.sid);
    }
    if (!s) return;
    const msg = await open(s.key, 'up', p.sid, p);
    if (!msg || !s.seen.add(msg.id)) return;
    this.onMessage(msg, p.sid);
  }

  bind(sid, pid) {
    const s = this.sessions.get(sid);
    if (s) s.pid = pid;
  }

  pidOf(sid) {
    return this.sessions.get(sid)?.pid ?? null;
  }

  online() {
    return [...this.onlinePids];
  }

  async send(sid, msg) {
    await this.ready;
    const s = this.sessions.get(sid);
    if (!s || !this.channel) return;
    const box = await seal(s.key, 'down', sid, { ...msg, id: rid() });
    this.channel.send({ type: 'broadcast', event: 'down', payload: { sid, ...box } });
  }

  async broadcast(msg) {
    this.lastState = msg;
    await this.ready;
    this.publish(msg);
  }

  async publish(msg) {
    if (!this.channel || this.closed) return;
    // The full log stays with the host (and in the saved game).
    const data = JSON.stringify({ ...msg.game, log: msg.game.log.slice(-STATE_LOG) });
    const sig = b64(await crypto.subtle.sign(SIGN, this.signer.privateKey, enc.encode(data)));
    if (this.closed || msg !== this.lastState) return; // a newer table is on its way
    this.channel.send({ type: 'broadcast', event: 'state', payload: { data, sig } });
  }

  close() {
    this.closed = true;
    if (this.channel) this.client.removeChannel(this.channel);
  }
}

// ---------------- player ----------------

export class PlayerLink {
  // `trust()` resolves to the host's public keys as saved in the database.
  constructor(client, secret, { hello, onMessage, onStatus, onPresence, trust, anchor }) {
    this.client = client;
    this.trust = trust;
    this.anchor = anchor ?? null;
    this.hello = hello;
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.onPresence = onPresence;
    this.pending = new Map();
    this.onlinePids = new Set();
    this.hostKey = null;
    this.session = null;
    this.subscribed = false;
    this.closed = false;
    this.rev = -1;
    this.me = rid(); // presence key for this page
    this.onStatus('connecting');

    const ch = (this.channel = channelFor(client, secret, this.me));
    ch.on('broadcast', { event: 'state' }, ({ payload }) => this.state(payload));
    ch.on('broadcast', { event: 'down' }, ({ payload }) => this.down(payload));
    ch.on('presence', { event: 'sync' }, () => this.presence());
    ch.subscribe((status) => {
      if (this.closed) return;
      this.subscribed = status === 'SUBSCRIBED';
      if (this.subscribed) this.track();
      this.report();
    });
  }

  track(pid = this.pid) {
    this.pid = pid;
    if (this.subscribed) this.channel.track({ role: 'player', pid: pid ?? null });
  }

  presence() {
    const state = this.channel.presenceState();
    // Anyone can claim to be "host" in presence; prefer the key the saved
    // game vouches for, so an impostor can't hide the real host.
    const hosts = (state.host ?? []).map((m) => m.key).filter(Boolean);
    const hostKey = hosts.find((k) => k === this.anchor?.dh) ?? hosts[0] ?? null;
    const next = new Set();
    for (const [key, metas] of Object.entries(state)) {
      if (key === 'host') continue;
      for (const m of metas) if (m.pid) next.add(m.pid);
    }
    this.onlinePids = next;
    if (hostKey !== this.hostKey) {
      this.hostKey = hostKey;
      this.session = null;
      this.welcomed = false;
      // A new host key means the host (re)opened the table: say hello again,
      // but only to the key the saved game vouches for.
      if (hostKey) this.greetIfTrusted(hostKey);
    }
    this.report();
    this.onPresence?.();
  }

  async refreshAnchor() {
    const now = Date.now();
    if (this.anchorAt && now - this.anchorAt < 3000) return this.anchorWait;
    this.anchorAt = now;
    this.anchorWait = Promise.resolve(this.trust?.())
      .then((a) => {
        if (a?.dh && a?.sig) this.anchor = a;
      })
      .catch(() => {});
    return this.anchorWait;
  }

  async greetIfTrusted(hostKey, tries = 0) {
    if (this.anchor?.dh !== hostKey) await this.refreshAnchor();
    if (this.closed || hostKey !== this.hostKey) return;
    if (this.anchor?.dh === hostKey) return this.greet();
    // The host may not have saved its new keys yet.
    if (tries < 5) setTimeout(() => this.greetIfTrusted(hostKey, tries + 1), 1500 * (tries + 1));
  }

  online() {
    return this.onlinePids;
  }

  async greet() {
    const hostKey = this.hostKey;
    const sid = rid();
    const eph = await crypto.subtle.generateKey(ECDH, false, ['deriveBits']);
    const epk = b64(await crypto.subtle.exportKey('raw', eph.publicKey));
    const key = await sessionKey(eph.privateKey, hostKey, sid);
    if (this.closed || hostKey !== this.hostKey) return;
    this.session = { sid, key };
    const box = await seal(key, 'up', sid, { t: 'hello', id: rid(), ...(await this.hello()) });
    this.channel.send({ type: 'broadcast', event: 'up', payload: { sid, epk, ...box } });
  }

  report() {
    if (!this.subscribed) return this.onStatus('offline');
    if (!this.hostKey) return this.onStatus('noHost');
    if (this.welcomed) return this.onStatus('online');
    this.onStatus('connecting');
  }

  async state(payload) {
    if (typeof payload?.data !== 'string' || typeof payload.sig !== 'string') return;
    let ok = this.anchor && (await verify(this.anchor.sig, payload.data, payload.sig));
    if (!ok) {
      await this.refreshAnchor();
      ok = this.anchor && (await verify(this.anchor.sig, payload.data, payload.sig));
    }
    if (!ok) return; // not from the host
    let g;
    try {
      g = JSON.parse(payload.data);
    } catch {
      return;
    }
    if (!g || typeof g !== 'object') return;
    if (g.id === this.gameId && g.rev < this.rev) return;
    this.gameId = g.id;
    this.rev = g.rev;
    this.onMessage({ t: 'state', game: g });
  }

  async down(p) {
    const s = this.session;
    if (!s || !p || p.sid !== s.sid) return;
    const msg = await open(s.key, 'down', s.sid, p);
    if (!msg) return;
    if (msg.t === 'ok' || (msg.t === 'err' && msg.rid)) {
      const req = this.pending.get(msg.rid);
      if (req) {
        this.pending.delete(msg.rid);
        clearTimeout(req.timer);
        msg.t === 'ok' ? req.resolve(msg) : req.reject(Object.assign(new Error(msg.code), { code: msg.code }));
      }
      return;
    }
    if (msg.t === 'welcome') {
      this.welcomed = true;
      this.track(msg.pid);
      this.report();
    }
    this.onMessage(msg);
  }

  // Re-introduce ourselves (e.g. after picking a new name).
  rehello() {
    if (this.hostKey) this.greet();
  }

  request(type, payload) {
    return new Promise((resolve, reject) => {
      const s = this.session;
      if (!s || !this.subscribed || !this.welcomed) return reject(Object.assign(new Error('timeout'), { code: 'timeout' }));
      const id = rid();
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Object.assign(new Error('timeout'), { code: 'timeout' }));
      }, 10000);
      this.pending.set(id, { resolve, reject, timer });
      seal(s.key, 'up', s.sid, { t: 'act', id, rid: id, type, payload }).then((box) =>
        this.channel.send({ type: 'broadcast', event: 'up', payload: { sid: s.sid, ...box } }),
      );
    });
  }

  close() {
    this.closed = true;
    for (const { timer } of this.pending.values()) clearTimeout(timer);
    this.client.removeChannel(this.channel);
  }
}
