-- Live play over Supabase Realtime.
--
-- Every table gets a 128-bit secret. The realtime channel is named after it,
-- and invite links carry it in the URL fragment, which browsers never send
-- to any server. A rematch keeps the same secret (same link), so the newest
-- game with a secret is the table. Guests reach a game through the link or
-- by typing the 8-character code, which only resolves while it's live.

alter table public.games
  add column secret text not null check (secret ~ '^[A-Za-z0-9_-]{22,64}$'),
  drop constraint games_code_check,
  add constraint games_code_check check (code ~ '^[A-Z0-9]{8}$');

-- Only one person can claim a seat for their history.
alter table public.game_members
  add constraint game_members_seat_key unique (game_id, player_id);

drop index public.games_code_idx;
create index games_live_code_idx on public.games (code) where status = 'live';
create index games_secret_idx on public.games (secret, created_at desc);

-- Typed code -> secret, for live games only.
create function public.find_game(p_code text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select g.secret from public.games g
  where g.code = upper(p_code) and g.status = 'live'
  order by g.created_at desc
  limit 1;
$$;

-- The table as last saved by the host, for someone holding the secret.
-- Finished games stay readable for a week so players can check the result.
create function public.game_state(p_secret text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select g.state from public.games g
  where g.secret = p_secret
    and (g.status = 'live' or g.ended_at > now() - interval '7 days')
  order by g.created_at desc
  limit 1;
$$;

revoke execute on function public.find_game(text) from public;
revoke execute on function public.game_state(text) from public;
grant execute on function public.find_game(text) to anon, authenticated;
grant execute on function public.game_state(text) to anon, authenticated;
