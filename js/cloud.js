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
const SAVE_DELAY = 700;

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
  };
}

// ---------- a stand-in for tests (?cloud=mock), kept in localStorage ----------

function mockBackend() {
  const K = 'felt:mock';
  const db = () => JSON.parse(localStorage.getItem(K) || '{"user":null,"games":{},"members":{}}');
  const put = (d) => localStorage.setItem(K, JSON.stringify(d));
  let cb = () => {};
  return {
    async session() {
      return db().user;
    },
    onAuth(fn) {
      cb = fn;
    },
    async signIn() {
      const d = db();
      const name = new URLSearchParams(location.search).get('mockName') || 'Test Host';
      d.user = { id: 'u-' + name.toLowerCase().replace(/\W/g, ''), email: 'test@example.com', user_metadata: { full_name: name } };
      put(d);
      cb(d.user);
    },
    async signOut() {
      const d = db();
      d.user = null;
      put(d);
      cb(null);
    },
    async save(row) {
      const d = db();
      const old = d.games[row.id];
      if (old && row.rev < old.rev) return;
      d.games[row.id] = { ...row, host_id: d.user.id };
      put(d);
    },
    async link(gameId, pid) {
      const d = db();
      d.members[`${gameId}|${d.user.id}`] = { game_id: gameId, user_id: d.user.id, player_id: pid };
      put(d);
      return true;
    },
    async myGames() {
      const d = db();
      const uid = d.user?.id;
      return Object.values(d.games)
        .map((g) => {
          const mem = d.members[`${g.id}|${uid}`];
          const isHost = g.host_id === uid;
          if (!isHost && !mem) return null;
          return { ...g, is_host: isHost, my_player_id: mem?.player_id ?? (isHost ? g.state.managerId : null) };
        })
        .filter(Boolean)
        .sort((a, b) => (b.created_at > a.created_at ? 1 : -1));
    },
    async liveHosted(code) {
      const d = db();
      const g = Object.values(d.games).find((x) => x.code === code && x.status === 'live' && x.host_id === d.user?.id);
      return g?.state ?? null;
    },
    async remove(gameId) {
      const d = db();
      delete d.games[gameId];
      put(d);
    },
  };
}

// ---------- public API ----------

const pending = new Map(); // game id -> latest row waiting to be saved
let saveTimer = null;
let linkTries = new Map();

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
  // a flaky connection never blocks the table.
  saveGame(game) {
    if (!client || !user) return;
    pending.set(game.id, {
      id: game.id,
      code: game.code,
      name: game.name,
      currency: game.currency,
      status: game.status,
      rev: game.rev || 0,
      state: game,
      created_at: new Date(game.createdAt).toISOString(),
      ended_at: game.endedAt ? new Date(game.endedAt).toISOString() : null,
    });
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, SAVE_DELAY);
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

  async removeGame(gameId) {
    if (!client || !user) return;
    await client.remove(gameId);
  },
};

async function flush() {
  const rows = [...pending.values()];
  pending.clear();
  for (const row of rows) {
    try {
      await client.save(row);
    } catch {
      // Keep the newest copy and try again shortly.
      if (!pending.has(row.id)) pending.set(row.id, row);
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
  const mock = new URLSearchParams(location.search).get('cloud') === 'mock';
  try {
    client = mock ? mockBackend() : supabaseBackend();
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
