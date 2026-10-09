// Game state: creation, the host-side action reducer, and localStorage.
// The host's browser is the source of truth. Players send actions, the host
// applies them here and broadcasts the new state.

import { boughtCents, chipsForCents, results } from './settle.js';

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const COLORS = ['red', 'blue', 'green', 'gold', 'violet', 'teal', 'orange', 'rose', 'slate', 'lime'];

export function uid(len = 10) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => (b % 36).toString(36)).join('');
}

// 8 characters from a 31-letter alphabet: ~8.5e11 codes, so guessing a live
// one by brute force isn't practical. Ambiguous letters (0/O, 1/I/L) are out.
export const CODE_LENGTH = 8;

export function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

export function normalizeCode(s) {
  return String(s || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, CODE_LENGTH);
}

// 128 random bits, URL-safe. Names the live channel and rides in invite links.
export function newSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function isSecret(s) {
  return /^[A-Za-z0-9_-]{22,64}$/.test(String(s || ''));
}

// A device is recognised by a hash of its private id, so the id itself never
// appears in the shared table (anyone holding it could act as that player).
export async function deviceKey(clientId) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`felt-device:${clientId}`));
  return [...new Uint8Array(buf, 0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// A signed-in account is recognised the same way, so one Google account
// keeps one seat across all its devices without the account id being shared.
export async function accountKey(userId) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`chipper-account:${userId}`));
  return [...new Uint8Array(buf, 0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Google profile photos only (they're on googleusercontent.com, which the
// page's security policy allows).
export function isPhoto(url) {
  return /^https:\/\/[a-z0-9-]+\.googleusercontent\.com\/[^\s"'<>]{1,1000}$/.test(String(url || ''));
}

const isKey = (k) => /^[0-9a-f]{32}$/.test(String(k || ''));

export function cleanName(s) {
  return String(s || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24);
}

// Two players with the same name make the settle-up confusing, so names are
// unique per game (ignoring case and spacing).
const nameKey = (n) => cleanName(n).toLocaleLowerCase();

function assertFreeName(game, name, exceptId = null) {
  if (game.players.some((p) => p.id !== exceptId && nameKey(p.name) === nameKey(name))) throw new ActionError('nameTaken');
}

function nextColor(game) {
  const used = new Set(game.players.map((p) => p.color));
  return COLORS.find((c) => !used.has(c)) ?? COLORS[game.players.length % COLORS.length];
}

function makePlayer(game, { name, key = null, acct = null, playing = true }) {
  return {
    id: uid(8),
    key,
    acct,
    name,
    color: nextColor(game),
    seat: null,
    playing,
    status: 'playing',
    buyIns: [],
    leftChips: null,
    leftAt: null,
    settledOnLeave: false,
    joinedAt: Date.now(),
  };
}

export function createGame(opts) {
  const now = Date.now();
  const game = {
    v: 1,
    id: uid(12),
    code: opts.code ?? newCode(),
    secret: opts.secret ?? newSecret(),
    name: cleanName(opts.name) || 'Poker',
    type: opts.type === 'cash' ? 'cash' : 'fixed',
    currency: opts.currency || 'ILS',
    buyIn: Math.round(opts.buyIn),
    chip: { cents: Math.round(opts.chip.cents), chips: Number(opts.chip.chips) },
    seats: Math.min(10, Math.max(2, opts.seats | 0)),
    // true: buy-ins are paid in cash into a pot on the table.
    // false: nobody pays during the game; everyone settles at the end.
    pot: opts.pot !== false,
    createdAt: now,
    endedAt: null,
    status: 'live',
    managerId: null,
    players: [],
    log: [],
    result: null,
    rev: 0,
  };
  const host = makePlayer(game, { name: cleanName(opts.hostName) || 'Host', playing: !!opts.hostPlaying });
  if (host.playing) host.seat = 0;
  game.managerId = host.id;
  game.players.push(host);
  log(game, 'created', host.id, { quiet: true });
  return game;
}

// A fresh round with the same settings, link, players and seats.
export function rematch(prev) {
  const game = structuredClone(prev);
  game.id = uid(12);
  game.createdAt = Date.now();
  game.endedAt = null;
  game.status = 'live';
  game.result = null;
  game.log = [];
  game.rev = (prev.rev || 0) + 1;
  game.players = game.players.map((p) => ({
    ...p,
    buyIns: [],
    status: 'playing',
    leftChips: null,
    leftAt: null,
    settledOnLeave: false,
  }));
  log(game, 'rematch', game.managerId, { quiet: true });
  return game;
}

function log(game, type, pid, extra = {}) {
  game.log.push({ id: uid(6), at: Date.now(), type, pid, ...extra });
  if (game.log.length > 400) game.log.splice(0, game.log.length - 400);
}

export class ActionError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

// Group tip options for the app's developer, as a share of the buy-ins.
export const TIP_PCTS = [0, 1, 2, 5];

const HOST_ONLY = new Set(['addPlayer', 'undoBuyin', 'settleLeave', 'remove', 'end', 'reopen', 'settleMode', 'paid', 'setSeat', 'paidBuyin', 'rename']);
// Players pick their name once when they join; after that only the host can
// change it, so nobody shows up under a new name mid-game.
const SELF_OK = new Set(['sit', 'buyin', 'leave', 'return']);

// Applies an action in place. `actor` is { pid, host }.
// Returns the log entry (if any) so callers can react to it.
export function apply(game, type, payload, actor) {
  if (HOST_ONLY.has(type) && !actor.host) throw new ActionError('notAllowed');
  if (SELF_OK.has(type) && !actor.host && payload.pid !== actor.pid) throw new ActionError('notAllowed');
  if (!HOST_ONLY.has(type) && !SELF_OK.has(type) && type !== 'join') throw new ActionError('generic');
  if (game.status === 'ended' && !['reopen', 'settleMode', 'paid', 'paidBuyin', 'join'].includes(type)) throw new ActionError('ended');

  const find = (id) => {
    const p = game.players.find((x) => x.id === id);
    if (!p) throw new ActionError('generic');
    return p;
  };
  const before = game.log.length;

  switch (type) {
    case 'join': {
      const key = String(payload.key || '');
      if (!isKey(key)) throw new ActionError('generic');
      // The host checked the account before passing it on; same account,
      // same seat, from any device.
      const acct = isKey(payload.acct) ? payload.acct : null;
      const pic = acct && isPhoto(payload.pic) ? payload.pic : null;
      const existing = game.players.find((p) => p.key === key) || (acct && game.players.find((p) => p.acct === acct));
      if (existing) {
        if (acct && !existing.acct) existing.acct = acct;
        if (pic && existing.acct === acct) existing.pic = pic;
        return { pid: existing.id };
      }
      const name = cleanName(payload.name);
      if (!name) throw new ActionError('name');
      assertFreeName(game, name);
      const p = makePlayer(game, { name, key, acct });
      p.pic = pic;
      game.players.push(p);
      log(game, 'join', p.id);
      bump(game);
      return { pid: p.id };
    }
    case 'addPlayer': {
      const name = cleanName(payload.name);
      if (!name) throw new ActionError('name');
      assertFreeName(game, name);
      const p = makePlayer(game, { name });
      const free = freeSeats(game);
      if (free.length) p.seat = free[0];
      game.players.push(p);
      log(game, 'join', p.id, { quiet: true });
      break;
    }
    case 'sit':
    case 'setSeat': {
      const p = find(payload.pid);
      const seat = payload.seat;
      if (seat !== null) {
        if (!(seat >= 0 && seat < game.seats)) throw new ActionError('generic');
        const holder = game.players.find((x) => x.seat === seat && x.status === 'playing');
        if (holder && holder.id !== p.id) throw new ActionError('seatTaken');
      }
      const first = p.seat === null;
      if (!p.playing) p.playing = true;
      p.seat = seat;
      if (first && seat !== null) log(game, 'sit', p.id, { quiet: true });
      break;
    }
    case 'buyin': {
      const p = find(payload.pid);
      if (p.status === 'left') throw new ActionError('generic');
      const cents = Math.round(Number(payload.cents));
      if (!(cents > 0) || cents > 100_000_000) throw new ActionError('amount');
      if (game.type === 'fixed' && cents % game.buyIn !== 0) throw new ActionError('amount');
      const paid = typeof payload.paid === 'boolean' ? payload.paid : !!game.pot;
      const buy = { id: uid(6), cents, chips: chipsForCents(game, cents), paid, at: Date.now(), by: actor.pid };
      p.buyIns.push(buy);
      p.playing = true;
      log(game, 'buyin', p.id, { cents, by: actor.pid });
      break;
    }
    case 'paidBuyin': {
      const p = find(payload.pid);
      const b = p.buyIns.find((x) => x.id === payload.buyinId);
      if (!b) throw new ActionError('generic');
      b.paid = !!payload.value;
      if (game.result) game.result.paid = {};
      break;
    }
    case 'undoBuyin': {
      const p = find(payload.pid);
      const i = p.buyIns.findIndex((b) => b.id === payload.buyinId);
      if (i < 0) throw new ActionError('generic');
      const [b] = p.buyIns.splice(i, 1);
      log(game, 'undo', p.id, { cents: b.cents });
      break;
    }
    case 'leave': {
      const p = find(payload.pid);
      if (p.status === 'left') throw new ActionError('generic');
      const chips = Number(payload.chips);
      if (!(chips >= 0) || !Number.isFinite(chips)) throw new ActionError('amount');
      p.status = 'left';
      p.leftChips = chips;
      p.leftAt = Date.now();
      p.seat = null;
      p.settledOnLeave = actor.host && !!payload.settled;
      log(game, 'leave', p.id, { chips });
      break;
    }
    case 'settleLeave': {
      const p = find(payload.pid);
      p.settledOnLeave = !!payload.value;
      break;
    }
    case 'return': {
      const p = find(payload.pid);
      if (p.status !== 'left') throw new ActionError('generic');
      p.status = 'playing';
      p.leftChips = null;
      p.leftAt = null;
      p.settledOnLeave = false;
      const free = freeSeats(game);
      p.seat = free.length ? free[0] : null;
      log(game, 'return', p.id);
      break;
    }
    case 'rename': {
      const p = find(payload.pid);
      const name = cleanName(payload.name);
      if (!name) throw new ActionError('name');
      if (name === p.name) break;
      assertFreeName(game, name, p.id);
      log(game, 'rename', p.id, { old: p.name, quiet: true });
      p.name = name;
      break;
    }
    case 'remove': {
      const p = find(payload.pid);
      if (p.id === game.managerId) throw new ActionError('notAllowed');
      if (p.buyIns.length) throw new ActionError('hasBuyIns');
      game.players = game.players.filter((x) => x.id !== p.id);
      log(game, 'remove', p.id, { name: p.name, quiet: true });
      break;
    }
    case 'end': {
      const stacks = {};
      for (const [id, v] of Object.entries(payload.stacks || {})) {
        const n = Number(v);
        if (!(n >= 0) || !Number.isFinite(n)) throw new ActionError('amount');
        stacks[id] = n;
      }
      game.status = 'ended';
      game.endedAt = Date.now();
      const tipPct = TIP_PCTS.includes(Number(payload.tipPct)) ? Number(payload.tipPct) : 0;
      game.result = { stacks, adjust: !!payload.adjust, mode: game.pot ? 'pot' : 'fewest', paid: {}, tipPct };
      log(game, 'end', actor.pid);
      break;
    }
    case 'reopen': {
      game.status = 'live';
      game.endedAt = null;
      game.result = null;
      log(game, 'reopen', actor.pid);
      break;
    }
    case 'settleMode': {
      if (!game.result) throw new ActionError('generic');
      game.result.mode = ['pot', 'bank'].includes(payload.mode) ? payload.mode : 'fewest';
      game.result.paid = {};
      break;
    }
    case 'paid': {
      if (!game.result) throw new ActionError('generic');
      if (payload.value) game.result.paid[payload.key] = true;
      else delete game.result.paid[payload.key];
      break;
    }
  }
  bump(game);
  return { entry: game.log.length > before ? game.log[game.log.length - 1] : null };
}

function bump(game) {
  game.rev = (game.rev || 0) + 1;
}

export function freeSeats(game) {
  const taken = new Set(game.players.filter((p) => p.status === 'playing' && p.seat !== null).map((p) => p.seat));
  const out = [];
  for (let i = 0; i < game.seats; i++) if (!taken.has(i)) out.push(i);
  return out;
}

export function player(game, id) {
  return game?.players.find((p) => p.id === id) ?? null;
}

export function gameResults(game) {
  if (!game.result) return null;
  return results(game, game.result.stacks, { adjust: game.result.adjust, tipPct: game.result.tipPct || 0 });
}

// ---------- persistence ----------

const K = {
  game: (code) => `felt:game:${code}`,
  snap: (code) => `felt:snap:${code}`,
  me: (code) => `felt:me:${code}`,
  host: (code) => `felt:host:${code}`,
  client: 'felt:client',
  name: 'felt:name',
  history: 'felt:history',
  tips: 'felt:tips',
};

function read(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function remove(key) {
  try {
    localStorage.removeItem(key);
  } catch {}
}

export const storage = {
  clientId() {
    let id = read(K.client);
    if (!id) {
      id = uid(16);
      write(K.client, id);
    }
    return id;
  },
  lastName: () => read(K.name, ''),
  setLastName: (n) => write(K.name, n),

  isHost: (code) => !!read(K.host(code)),
  hostedGame: (code) => read(K.game(code)),
  saveHosted(game) {
    write(K.game(game.code), game);
    write(K.host(game.code), true);
  },
  dropHosted(code) {
    remove(K.game(code));
    remove(K.host(code));
  },

  snapshot: (code) => read(K.snap(code)),
  saveSnapshot: (game) => write(K.snap(game.code), game),
  me: (code) => read(K.me(code)),
  saveMe: (code, me) => write(K.me(code), me),
  forget(code) {
    remove(K.snap(code));
    remove(K.me(code));
  },

  openGames() {
    const out = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        const m = key && key.match(/^felt:(game|snap):(\w+)$/);
        if (!m) continue;
        const g = read(key);
        if (!g || g.status !== 'live') continue;
        if (m[1] === 'snap' && storage.isHost(m[2])) continue;
        out.push({ role: m[1] === 'game' ? 'host' : 'player', game: g });
      }
    } catch {}
    return out.sort((a, b) => b.game.createdAt - a.game.createdAt);
  },

  // Every game on this device, hosted or joined, for adding to an account.
  allLocal() {
    const out = { hosted: [], joined: [] };
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        const m = key && key.match(/^felt:(game|snap):(\w+)$/);
        if (!m) continue;
        const g = read(key);
        if (!g?.id) continue;
        if (m[1] === 'game') out.hosted.push(g);
        else if (!storage.isHost(m[2])) {
          const pid = storage.me(m[2])?.pid;
          if (pid) out.joined.push({ gameId: g.id, pid });
        }
      }
    } catch {}
    return out;
  },

  history: () => read(K.history, []),
  // One entry per finished game, keyed by game id so re-renders don't duplicate.
  recordResult(game) {
    const res = gameResults(game);
    if (!res) return;
    const list = storage.history().filter((h) => h.id !== game.id);
    const me = storage.isHost(game.code) ? game.managerId : storage.me(game.code)?.pid ?? null;
    list.unshift({
      id: game.id,
      me,
      name: game.name,
      currency: game.currency,
      startedAt: game.createdAt,
      endedAt: game.endedAt,
      rows: res.map((r) => ({ id: r.id, name: r.name, net: r.net, bought: r.bought })),
    });
    write(K.history, list.slice(0, 200));
  },
  deleteHistory(id) {
    write(
      K.history,
      storage.history().filter((h) => h.id !== id),
    );
  },

  tipSeen: (k) => !!read(K.tips, {})[k],
  markTip(k) {
    const tips = read(K.tips, {});
    tips[k] = true;
    write(K.tips, tips);
  },
};

export { boughtCents };
