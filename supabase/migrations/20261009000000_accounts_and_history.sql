-- Felt: accounts (Google sign-in) and game history.
--
-- The host's phone still runs the game. While a game is live the host saves
-- the full game state here, so it survives a lost phone and can be resumed
-- from any device the host signs in on. Signed-in players link themselves to
-- the games they played, which is what their history is built from.
-- Guests never touch the database.

-- ---------- profiles ----------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles: read own" on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy "profiles: update own" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- A profile row for every new account, filled from the Google profile.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- games ----------

create table public.games (
  id text primary key check (char_length(id) between 6 and 40),
  code text not null check (code ~ '^[A-Z0-9]{6}$'),
  host_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null default 'Poker',
  currency text not null default 'ILS',
  status text not null default 'live' check (status in ('live', 'ended')),
  rev integer not null default 0,
  state jsonb not null check (pg_column_size(state) < 1000000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ended_at timestamptz
);

create index games_host_idx on public.games (host_id, created_at desc);
create index games_code_idx on public.games (code);

create table public.game_members (
  game_id text not null references public.games (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  player_id text not null,
  joined_at timestamptz not null default now(),
  primary key (game_id, user_id)
);

create index game_members_user_idx on public.game_members (user_id);

alter table public.games enable row level security;
alter table public.game_members enable row level security;

create policy "games: host or player reads" on public.games
  for select to authenticated using (
    host_id = (select auth.uid())
    or exists (
      select 1 from public.game_members m
      where m.game_id = games.id and m.user_id = (select auth.uid())
    )
  );
create policy "games: host creates" on public.games
  for insert to authenticated with check (host_id = (select auth.uid()));
create policy "games: host saves" on public.games
  for update to authenticated using (host_id = (select auth.uid())) with check (host_id = (select auth.uid()));
create policy "games: host deletes" on public.games
  for delete to authenticated using (host_id = (select auth.uid()));

create policy "members: read own" on public.game_members
  for select to authenticated using (user_id = (select auth.uid()));
create policy "members: leave own" on public.game_members
  for delete to authenticated using (user_id = (select auth.uid()));

-- Guests use no tables at all.
revoke all on public.profiles, public.games, public.game_members from anon;

-- Keep updated_at fresh, and never let an older save overwrite a newer one
-- (two tabs, or a phone that wakes up with stale state).
create function public.games_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.rev < old.rev then
    return null;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger games_before_update
  before update on public.games
  for each row execute function public.games_before_update();

create function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- A signed-in player links themselves to a game they're sitting in. The game
-- id is only known to people in the game, and the seat has to exist.
create function public.link_game(p_game_id text, p_player_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not signed in';
  end if;
  if not exists (
    select 1
    from public.games g, jsonb_array_elements(g.state -> 'players') p
    where g.id = p_game_id and p ->> 'id' = p_player_id
  ) then
    return false;
  end if;
  insert into public.game_members (game_id, user_id, player_id)
  values (p_game_id, uid, p_player_id)
  on conflict (game_id, user_id) do update set player_id = excluded.player_id;
  return true;
end;
$$;

revoke execute on function public.link_game(text, text) from public, anon;
grant execute on function public.link_game(text, text) to authenticated;

-- Everything the signed-in user hosted or played, newest first, with the
-- seat that was theirs in each game.
create function public.my_games(p_limit integer default 200)
returns table (
  id text,
  code text,
  name text,
  currency text,
  status text,
  state jsonb,
  created_at timestamptz,
  ended_at timestamptz,
  is_host boolean,
  my_player_id text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    g.id, g.code, g.name, g.currency, g.status, g.state, g.created_at, g.ended_at,
    g.host_id = (select auth.uid()) as is_host,
    coalesce(m.player_id, case when g.host_id = (select auth.uid()) then g.state ->> 'managerId' end) as my_player_id
  from public.games g
  left join public.game_members m on m.game_id = g.id and m.user_id = (select auth.uid())
  order by g.created_at desc
  limit least(greatest(p_limit, 1), 500);
$$;

revoke execute on function public.my_games(integer) from public, anon;
grant execute on function public.my_games(integer) to authenticated;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
