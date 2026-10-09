// Local stand-in for Supabase used by browser tests (?cloud=mock).
// Plays the database (same rules as supabase/migrations) and realtime
// broadcast + presence. Run: node tests/e2e/mock-server.mjs [port]
import { WebSocketServer } from 'ws';

const port = Number(process.argv[2] || 8899);
const games = new Map(); // id -> row
const members = new Map(); // `${gameId}|${userId}` -> { game_id, user_id, player_id }
const topics = new Map(); // topic -> Set<socket>

const live = (g) => g.status === 'live';
const latest = (rows) => rows.sort((a, b) => (b.created_at > a.created_at ? 1 : -1))[0] ?? null;

const fns = {
  save({ row }, user) {
    if (!user) throw new Error('not signed in');
    const old = games.get(row.id);
    if (old && old.host_id !== user.id) throw new Error('rls');
    if (old && row.rev < old.rev) return null;
    games.set(row.id, { ...row, host_id: user.id });
    return null;
  },
  link({ gameId, pid }, user) {
    if (!user) throw new Error('not signed in');
    const g = games.get(gameId);
    if (!g || !g.state.players.some((p) => p.id === pid)) return false;
    for (const m of members.values()) if (m.game_id === gameId && m.player_id === pid && m.user_id !== user.id) throw new Error('seat taken');
    members.set(`${gameId}|${user.id}`, { game_id: gameId, user_id: user.id, player_id: pid });
    return true;
  },
  myGames(_, user) {
    if (!user) return [];
    return [...games.values()]
      .map((g) => {
        const m = members.get(`${g.id}|${user.id}`);
        const isHost = g.host_id === user.id;
        if (!isHost && !m) return null;
        return { ...g, is_host: isHost, my_player_id: m?.player_id ?? (isHost ? g.state.managerId : null) };
      })
      .filter(Boolean)
      .sort((a, b) => (b.created_at > a.created_at ? 1 : -1));
  },
  liveHosted({ code }, user) {
    if (!user) return null;
    return latest([...games.values()].filter((g) => g.code === code && live(g) && g.host_id === user.id))?.state ?? null;
  },
  remove({ gameId }, user) {
    const g = games.get(gameId);
    if (g && g.host_id === user?.id) games.delete(gameId);
    members.delete(`${gameId}|${user?.id}`);
    return null;
  },
  findGame({ code }) {
    return latest([...games.values()].filter((g) => g.code === String(code).toUpperCase() && live(g)))?.secret ?? null;
  },
  gameState({ secret }) {
    return latest([...games.values()].filter((g) => g.secret === secret))?.state ?? null;
  },
  verify({ token }) {
    return /^u-[a-z]+$/.test(String(token)) ? { id: token, pic: `https://lh3.googleusercontent.com/a/${token}=s96-c` } : null;
  },
  config(_, user) {
    return user ? { tip_bit_link: 'https://www.bitpay.co.il/app/me/TEST-1234' } : {};
  },
  isAdmin(_, user) {
    return user?.id === 'u-yoni';
  },
  adminStats(_, user) {
    if (user?.id !== 'u-yoni') throw new Error('not allowed');
    const all = [...games.values()];
    const day = (d) => new Date(d).toISOString().slice(0, 10);
    const daily = Array.from({ length: 30 }, (_, i) => {
      const d = day(Date.now() - (29 - i) * 864e5);
      const gs = all.filter((g) => day(g.created_at) === d);
      return { day: d, users: i % 5, games: gs.length + (i % 3), players: gs.reduce((n, g) => n + g.state.players.length, 0) + (i % 4) };
    });
    const cents = all.reduce((n, g) => n + g.state.players.reduce((m, p) => m + p.buyIns.reduce((k, b) => k + b.cents, 0), 0), 0);
    return {
      generated_at: new Date().toISOString(),
      users: { total: 12, d1: 1, d7: 4, d30: 12, active7: 6, hosts: 3, returning_hosts: 2 },
      games: { total: all.length, ended: all.filter((g) => g.status === 'ended').length, d1: all.length, d7: all.length, d30: all.length, live_now: all.filter(live).length, stale_live: 0, avg_players: 3.5, avg_minutes: 142, seats: 14, account_seats: 5, buyins: 21 },
      live: all.filter(live).map((g) => ({ started: g.created_at, updated: g.created_at, currency: g.currency, players: g.state.players.length, buyin_cents: 20000 })),
      money: [{ currency: 'ILS', games: all.length, buyin_cents: cents, avg_cents: all.length ? Math.round(cents / all.length) : 0 }, { currency: 'USD', games: 1, buyin_cents: 15000, avg_cents: 15000 }],
      tips: { games: 2, by_pct: { 0: 3, 2: 1, 5: 1 }, by_currency: { ILS: 3500 } },
      daily,
      hours: Array.from({ length: 24 }, (_, h) => (h >= 19 && h <= 23 ? h - 17 : h < 2 ? 2 : 0)),
      weekdays: [1, 0, 1, 2, 5, 3, 1],
      sizes: { 2: 1, 4: 3, 6: 2 },
    };
  },
  // test helper
  dump() {
    return { games: [...games.values()].map((g) => ({ id: g.id, status: g.status, rev: g.rev, host: g.host_id })), members: [...members.values()] };
  },
};

function presence(topic) {
  const state = {};
  for (const s of topics.get(topic) ?? []) {
    const p = s.presence?.get(topic);
    if (p) (state[p.key] ??= []).push(p.meta);
  }
  for (const s of topics.get(topic) ?? []) s.send(JSON.stringify({ op: 'presence', topic, state }));
}

function leave(s, topic) {
  topics.get(topic)?.delete(s);
  s.presence?.delete(topic);
  presence(topic);
}

const wss = new WebSocketServer({ host: '127.0.0.1', port });
wss.on('connection', (s) => {
  s.presence = new Map();
  s.keys = new Map();
  s.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.op === 'rpc') {
      let reply;
      try {
        reply = { op: 'reply', id: m.id, data: fns[m.fn](m.args || {}, m.user) ?? null };
      } catch (e) {
        reply = { op: 'reply', id: m.id, error: e.message };
      }
      return s.send(JSON.stringify(reply));
    }
    if (m.op === 'join') {
      if (!topics.has(m.topic)) topics.set(m.topic, new Set());
      topics.get(m.topic).add(s);
      s.presence.set(m.topic, null);
      s.keys.set(m.topic, m.key || Math.random().toString(36).slice(2));
      s.send(JSON.stringify({ op: 'joined', topic: m.topic }));
      return presence(m.topic);
    }
    if (m.op === 'track') {
      s.presence.set(m.topic, { key: s.keys.get(m.topic), meta: m.meta });
      return presence(m.topic);
    }
    if (m.op === 'leave') return leave(s, m.topic);
    if (m.op === 'send') {
      for (const o of topics.get(m.topic) ?? []) if (o !== s) o.send(JSON.stringify({ op: 'bcast', topic: m.topic, event: m.event, payload: m.payload }));
    }
  });
  s.on('close', () => {
    for (const topic of s.presence.keys()) leave(s, topic);
  });
});
console.log(`mock supabase on ws://127.0.0.1:${port}`);
