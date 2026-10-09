// Test stand-in for Supabase (loaded only with ?cloud=mock). It talks to a
// tiny local server (tests/e2e/mock-server.mjs) that plays the database and
// the realtime service, so several browsers can share one "backend".

const URL = new URLSearchParams(location.search).get('mockServer') || 'ws://127.0.0.1:8899';
const USER_KEY = 'felt:mockUser';

export function mockBackend() {
  let ws;
  let open;
  let seq = 0;
  const waiting = new Map();
  const channels = new Map(); // topic -> MockChannel
  let authCb = () => {};

  const user = () => JSON.parse(localStorage.getItem(USER_KEY) || 'null');

  function connect() {
    ws = new WebSocket(URL);
    open = new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.op === 'reply') {
        const w = waiting.get(m.id);
        waiting.delete(m.id);
        if (w) m.error ? w.reject(new Error(m.error)) : w.resolve(m.data);
      } else channels.get(m.topic)?.incoming(m);
    });
    ws.addEventListener('close', () => {
      for (const ch of channels.values()) ch.status('CLOSED');
      setTimeout(() => {
        connect();
        open.then(() => channels.forEach((ch) => ch.rejoin()));
      }, 500);
    });
  }
  connect();

  const send = async (msg) => {
    await open;
    ws.send(JSON.stringify(msg));
  };
  const rpc = (fn, args = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      waiting.set(id, { resolve, reject });
      send({ op: 'rpc', id, fn, args, user: user() });
    });

  class MockChannel {
    constructor(topic, opts) {
      this.topic = topic;
      this.key = opts?.config?.presence?.key;
      this.handlers = [];
      this.state = {};
    }
    on(type, filter, cb) {
      this.handlers.push({ type, filter, cb });
      return this;
    }
    subscribe(cb) {
      this.cb = cb;
      channels.set(this.topic, this);
      this.rejoin();
      return this;
    }
    rejoin() {
      send({ op: 'join', topic: this.topic, key: this.key }).then(() => {
        if (this.meta) send({ op: 'track', topic: this.topic, meta: this.meta });
      });
    }
    status(s) {
      this.cb?.(s);
    }
    incoming(m) {
      if (m.op === 'joined') return this.status('SUBSCRIBED');
      if (m.op === 'bcast') {
        for (const h of this.handlers) if (h.type === 'broadcast' && h.filter.event === m.event) h.cb({ payload: m.payload });
      }
      if (m.op === 'presence') {
        this.state = m.state;
        for (const h of this.handlers) if (h.type === 'presence' && h.filter.event === 'sync') h.cb();
      }
    }
    track(meta) {
      this.meta = meta;
      return send({ op: 'track', topic: this.topic, meta });
    }
    send({ event, payload }) {
      return send({ op: 'send', topic: this.topic, event, payload });
    }
    presenceState() {
      return this.state;
    }
  }

  return {
    async session() {
      return user();
    },
    onAuth(fn) {
      authCb = fn;
    },
    async signIn() {
      const name = new URLSearchParams(location.search).get('mockName') || 'Test Host';
      const u = { id: `u-${name.toLowerCase().replace(/\W/g, '')}`, email: `${name.split(' ')[0].toLowerCase()}@example.com`, user_metadata: { full_name: name } };
      localStorage.setItem(USER_KEY, JSON.stringify(u));
      authCb(u);
    },
    async signOut() {
      localStorage.removeItem(USER_KEY);
      authCb(null);
    },
    save: (row) => rpc('save', { row }),
    link: (gameId, pid) => rpc('link', { gameId, pid }),
    myGames: () => rpc('myGames'),
    liveHosted: (code) => rpc('liveHosted', { code }),
    remove: (gameId) => rpc('remove', { gameId }),
    findGame: (code) => rpc('findGame', { code }),
    gameState: (secret) => rpc('gameState', { secret }),
    config: () => rpc('config'),
    realtime: {
      channel: (topic, opts) => new MockChannel(topic, opts),
      removeChannel(ch) {
        channels.delete(ch.topic);
        send({ op: 'leave', topic: ch.topic });
      },
    },
  };
}
