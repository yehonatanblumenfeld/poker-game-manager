// Accounts and game history on Supabase.
//
// Hosts sign in with Google; players may join as guests or sign in too.
// The host's phone still runs the game: it saves the full state here as the
// game goes, so it survives a lost phone, can be resumed on another device,
// and becomes part of everyone's history. Signed-in players link themselves
// to each game they sit in. Guests never touch the database.
//
// The publishable key is meant to ship in the page: row-level security in
// supabase/migrations decides who can read or write what.

const URL = 'https://nmkqfwzqblfrdftlhkwa.supabase.co';
const KEY = 'sb_publishable_2KO_VEJgZLvnxGs9p6idGQ_4ke-vxQr';
const AFTER_KEY = 'felt:afterSignIn';
const LINKED_KEY = 'felt:linked';
const SAVE_DELAY = 1200;

const listeners = new Set();
let client = null;
let user = null;
let readyResolve;
const ready = new Promise((r) => (readyResolve = r));

function emit() {
  for (const fn of listeners) {
    try {
      fn(user);
    } catch {}
  }
}

function readLinked() {
  try {
    return new Set(JSON.parse(localStorage.getItem(LINKED_KEY) || '[]'));
  } catch {
    return new Set();
  }
}

function writeLinked(set) {
  try {
    localStorage.setItem(LINKED_KEY, JSON.stringify([...set].slice(-500)));
  } catch {}
}

// ---------- the real backend ----------

function supabaseBackend() {
  if (!window.supabase?.createClient) return null;
  const sb = window.supabase.createClient(URL, KEY, {
    auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return {
    async session() {
      const { data } = await sb.auth.getSession();
      return data.session?.user ?? null;
    },
    onAuth(fn) {
      sb.auth.onAuthStateChange((_e, session) => fn(session?.user ?? null));
    },
    async signIn(redirectTo) {
      const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
      if (error) throw error;
    },
    async token() {
      const { data } = await sb.auth.getSession();
      return data.session?.access_token ?? null;
    },
    // Who a player's token belongs to, checked with Supabase Auth.
    async verify(token) {
      const { data, error } = await sb.auth.getUser(token);
      if (error) throw error;
      const u = data.user;
      return u ? { id: u.id, pic: u.user_metadata?.avatar_url || u.user_metadata?.picture || '' } : null;
    },
    async signOut() {
      await sb.auth.signOut();
    },
    async save(row) {
      const { error } = await sb.from('games').upsert(row, { onConflict: 'id' });
      if (error) throw error;
    },
    async link(gameId, pid) {
      const { data, error } = await sb.rpc('link_game', { p_game_id: gameId, p_player_id: pid });
      if (error) throw error;
      return !!data;
    },
    async myGames() {
      const { data, error } = await sb.rpc('my_games', { p_limit: 300 });
      if (error) throw error;
      return data;
    },
    async liveHosted(code) {
      const { data, error } = await sb
        .from('games')
        .select('state')
        .eq('code', code)
        .eq('status', 'live')
        .eq('host_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1);
      if (error) throw error;
      return data[0]?.state ?? null;
    },
    async remove(gameId) {
      // A host deletes the game for everyone; a player only drops it from
      // their own history.
      const { error } = await sb.from('games').delete().eq('id', gameId).eq('host_id', user.id);
      if (error) throw error;
      await sb.from('game_members').delete().eq('game_id', gameId).eq('user_id', user.id);
    },
    async findGame(code) {
      const { data, error } = await sb.rpc('find_game', { p_code: code });
      if (error) throw error;
      return data || null;
    },
    async gameState(secret) {
      const { data, error } = await sb.rpc('game_state', { p_secret: secret });
      if (error) throw error;
      return data || null;
    },
    async config() {
      const { data, error } = await sb.from('app_config').select('key, value');
      if (error) throw error;
      return Object.fromEntries(data.map((r) => [r.key, r.value]));
    },
    realtime: sb,
  };
}

// ---------- public API ----------

const pending = new Map(); // game id -> latest row waiting to be saved
let saveTimer = null;
let linkTries = new Map();
let configCache = null;

export const cloud = {
  ready,

  available: () => !!client,
  user: () => user,
  name: () => user?.user_metadata?.full_name || user?.user_metadata?.name || '',
  email: () => user?.email || '',
  avatar: () => user?.user_metadata?.avatar_url || user?.user_metadata?.picture || '',

  onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  // Google sends the user back to the page; `after` is the screen to return to.
  async signIn(after = location.hash) {
    if (!client) throw new Error('offline');
    try {
      sessionStorage.setItem(AFTER_KEY, after || '#/');
    } catch {}
    const params = new URLSearchParams(location.search);
    params.delete('code');
    const q = params.toString();
    await client.signIn(`${location.origin}${location.pathname}${q ? `?${q}` : ''}`);
  },

  async signOut() {
    await client?.signOut();
  },

  // Called on every change while hosting. Saves are batched and retried, so
  // a flaky connection never blocks the table. `now` skips the batching.
  saveGame(game, { now = false } = {}) {
    // Games from before accounts (no secret, short code) stay on the device.
    if (!client || !user || !game.secret || game.code?.length !== 8) return;
    pending.set(game.id, {
      id: game.id,
      code: game.code,
      secret: game.secret,
      name: game.name,
      currency: game.currency,
      status: game.status,
      rev: game.rev || 0,
      state: game,
      created_at: new Date(game.createdAt).toISOString(),
      ended_at: game.endedAt ? new Date(game.endedAt).toISOString() : null,
    });
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, now ? 0 : SAVE_DELAY);
  },

  // Live channel access, for js/net.js.
  realtime: () => client?.realtime ?? null,

  async findGame(code) {
    return client ? client.findGame(code) : null;
  },

  async gameState(secret) {
    return client ? client.gameState(secret) : null;
  },

  // A signed-in player puts this game in their history. The host may not
  // have saved it yet, so this quietly retries.
  linkGame(gameId, pid) {
    if (!client || !user || !gameId || !pid) return;
    const key = `${user.id}|${gameId}|${pid}`;
    const linked = readLinked();
    if (linked.has(key)) return;
    const last = linkTries.get(key) || 0;
    if (Date.now() - last < 4000) return;
    linkTries.set(key, Date.now());
    client
      .link(gameId, pid)
      .then((ok) => {
        if (!ok) return;
        linked.add(key);
        writeLinked(linked);
      })
      .catch(() => {});
  },

  async myGames() {
    if (!client || !user) return [];
    return client.myGames();
  },

  async liveHosted(code) {
    if (!client || !user) return null;
    try {
      return await client.liveHosted(code);
    } catch {
      return null;
    }
  },

  // The signed-in user's access token, sent (encrypted) to the host when
  // joining so the host can match the account to its seat.
  async token() {
    if (!client || !user) return null;
    try {
      return await client.token();
    } catch {
      return null;
    }
  },

  // The account behind a player's token ({ id, pic }), or null if it doesn't check out.
  async verify(token) {
    if (!client || !token) return null;
    try {
      return await client.verify(String(token).slice(0, 4096));
    } catch {
      return null;
    }
  },

  // Owner-edited settings (app_config). Signed-in only.
  async config() {
    if (!client || !user) return {};
    configCache ||= client.config().catch((e) => {
      configCache = null;
      throw e;
    });
    return configCache;
  },

  async removeGame(gameId) {
    if (!client || !user) return;
    await client.remove(gameId);
  },
};

const failures = new Map(); // game id -> failed attempts in a row

async function flush() {
  const rows = [...pending.values()];
  pending.clear();
  for (const row of rows) {
    try {
      await client.save(row);
      failures.delete(row.id);
    } catch {
      // Keep the newest copy and try again shortly, but don't hammer the
      // server forever over a save it keeps refusing.
      const n = (failures.get(row.id) || 0) + 1;
      failures.set(row.id, n);
      if (n < 20 && !pending.has(row.id)) pending.set(row.id, row);
    }
  }
  if (pending.size) saveTimer = setTimeout(flush, 5000);
}

// Flush right away when the page is being hidden (phone locked, tab closed).
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && pending.size) {
    clearTimeout(saveTimer);
    flush();
  }
});

export async function initCloud() {
  // ?cloud=mock swaps in a local stand-in (tests only; see tests/e2e).
  const mock = new URLSearchParams(location.search).get('cloud') === 'mock';
  try {
    client = mock ? (await import('./mock.js')).mockBackend() : supabaseBackend();
  } catch {
    client = null;
  }
  if (!client) {
    readyResolve(null);
    return null;
  }
  client.onAuth((u) => {
    const changed = (u?.id ?? null) !== (user?.id ?? null);
    user = u;
    if (changed) emit();
  });
  try {
    user = await client.session();
  } catch {
    user = null;
  }
  // Back from Google: drop the one-time code from the address bar and
  // return to the screen the sign-in started from.
  const params = new URLSearchParams(location.search);
  if (params.has('code') || params.has('error')) {
    params.delete('code');
    params.delete('error');
    params.delete('error_code');
    params.delete('error_description');
    const q = params.toString();
    let after = '#/';
    try {
      after = sessionStorage.getItem(AFTER_KEY) || '#/';
      sessionStorage.removeItem(AFTER_KEY);
    } catch {}
    history.replaceState(null, '', `${location.pathname}${q ? `?${q}` : ''}${after}`);
  }
  readyResolve(user);
  return user;
}
