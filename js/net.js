// Peer-to-peer link between the host's browser and the players' browsers.
// Uses PeerJS (vendor/peerjs.min.js) and its public signaling server only to
// introduce the browsers; game data then flows directly between them.

const PREFIX = 'felt-homepoker-';

function peerOptions() {
  // ?signal=host:port points at a self-hosted PeerJS server (used by tests).
  const signal = new URLSearchParams(location.search).get('signal');
  if (!signal) return { debug: 0 };
  const [host, port] = signal.split(':');
  return { host, port: Number(port || 9000), path: '/', secure: false, debug: 0 };
}

export function hostPeerId(code) {
  return PREFIX + code.toLowerCase();
}

// ---------------- host ----------------

export class HostLink {
  constructor(code, { onMessage, onPresence, onStatus }) {
    this.code = code;
    this.onMessage = onMessage;
    this.onPresence = onPresence;
    this.onStatus = onStatus;
    this.conns = new Map(); // conn -> pid | null
    this.closed = false;
    this.retry = 0;
    this.start();
  }

  start() {
    if (this.closed) return;
    this.onStatus('starting');
    const peer = new window.Peer(hostPeerId(this.code), peerOptions());
    this.peer = peer;
    peer.on('open', () => {
      this.retry = 0;
      this.onStatus('live');
    });
    peer.on('connection', (conn) => this.accept(conn));
    peer.on('disconnected', () => {
      if (this.closed || peer.destroyed) return;
      this.onStatus('offline');
      setTimeout(() => !peer.destroyed && peer.reconnect(), 1500);
    });
    peer.on('error', (err) => {
      if (this.closed) return;
      if (err.type === 'unavailable-id') {
        // Usually a stale registration from a reload; it clears within seconds.
        this.onStatus(this.retry > 4 ? 'otherTab' : 'starting');
      } else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type)) {
        this.onStatus('offline');
      } else {
        return; // peer-level errors for a single player don't take the table down
      }
      this.restart();
    });
  }

  restart() {
    try {
      this.peer?.destroy();
    } catch {}
    this.retry++;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.start(), Math.min(10000, 1500 * this.retry));
  }

  accept(conn) {
    conn.on('open', () => {
      this.conns.set(conn, null);
    });
    conn.on('data', (msg) => {
      if (!msg || typeof msg !== 'object') return;
      this.onMessage(msg, conn);
    });
    const drop = () => {
      const pid = this.conns.get(conn);
      this.conns.delete(conn);
      if (pid) this.onPresence();
    };
    conn.on('close', drop);
    conn.on('error', drop);
  }

  bind(conn, pid) {
    // A player who reconnects replaces their old connection.
    for (const [c, id] of this.conns) {
      if (id === pid && c !== conn) {
        this.conns.delete(c);
        try {
          c.close();
        } catch {}
      }
    }
    this.conns.set(conn, pid);
    this.onPresence();
  }

  pidOf(conn) {
    return this.conns.get(conn) ?? null;
  }

  online() {
    return [...new Set([...this.conns.values()].filter(Boolean))];
  }

  send(conn, msg) {
    try {
      if (conn.open) conn.send(msg);
    } catch {}
  }

  broadcast(msg) {
    for (const [conn, pid] of this.conns) if (pid) this.send(conn, msg);
  }

  close() {
    this.closed = true;
    clearTimeout(this.timer);
    try {
      this.peer?.destroy();
    } catch {}
  }
}

// ---------------- player ----------------

export class PlayerLink {
  constructor(code, { hello, onMessage, onStatus }) {
    this.code = code;
    this.hello = hello;
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.pending = new Map();
    this.closed = false;
    this.retry = 0;
    this.start();
  }

  start() {
    if (this.closed) return;
    this.onStatus(this.retry ? 'offline' : 'connecting');
    const peer = new window.Peer(peerOptions());
    this.peer = peer;
    peer.on('open', () => this.dial());
    peer.on('disconnected', () => {
      if (!this.closed && !peer.destroyed) setTimeout(() => !peer.destroyed && peer.reconnect(), 1500);
    });
    peer.on('error', (err) => {
      if (this.closed) return;
      this.lastNoHost = err.type === 'peer-unavailable';
      if (!this.lastNoHost && this.conn?.open) return;
      this.restart();
    });
  }

  dial() {
    const conn = this.peer.connect(hostPeerId(this.code), { reliable: true, serialization: 'json' });
    this.conn = conn;
    const timeout = setTimeout(() => {
      if (!conn.open) this.restart();
    }, 12000);
    conn.on('open', () => {
      clearTimeout(timeout);
      this.retry = 0;
      this.lastNoHost = false;
      conn.send({ t: 'hello', ...this.hello() });
    });
    conn.on('data', (msg) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.t === 'ok' || msg.t === 'err') {
        const p = this.pending.get(msg.rid);
        if (p) {
          this.pending.delete(msg.rid);
          clearTimeout(p.timer);
          msg.t === 'ok' ? p.resolve(msg) : p.reject(Object.assign(new Error(msg.code), { code: msg.code }));
        }
        return;
      }
      if (msg.t === 'welcome' || msg.t === 'state') this.onStatus('online');
      this.onMessage(msg);
    });
    conn.on('close', () => {
      clearTimeout(timeout);
      if (!this.closed) this.restart();
    });
  }

  restart() {
    try {
      this.peer?.destroy();
    } catch {}
    this.retry++;
    this.onStatus(this.lastNoHost ? 'noHost' : 'offline');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.start(), Math.min(8000, 1000 * 2 ** Math.min(this.retry, 3)));
  }

  request(type, payload) {
    return new Promise((resolve, reject) => {
      if (!this.conn?.open) return reject(Object.assign(new Error('timeout'), { code: 'timeout' }));
      const rid = Math.random().toString(36).slice(2);
      const timer = setTimeout(() => {
        this.pending.delete(rid);
        reject(Object.assign(new Error('timeout'), { code: 'timeout' }));
      }, 8000);
      this.pending.set(rid, { resolve, reject, timer });
      this.conn.send({ t: 'act', rid, type, payload });
    });
  }

  close() {
    this.closed = true;
    clearTimeout(this.timer);
    try {
      this.peer?.destroy();
    } catch {}
  }
}
