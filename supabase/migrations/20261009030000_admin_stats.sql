-- Admin area: app-wide numbers for the owner, and nobody else.
--
-- Who is an admin lives in public.admins, filled by hand in the dashboard
-- (insert the owner's auth user id). No API role can read or write it.
-- The numbers come from admin_stats(), which refuses anyone not listed.
--
-- game_stats keeps one anonymous summary row per game (counts and totals, no
-- names), filled by a trigger as the host saves. It stays when a host deletes
-- the game, so growth numbers don't shrink when people tidy their history.

create table public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);
alter table public.admins enable row level security;
revoke all on public.admins from anon, authenticated;

create table public.game_stats (
  game_id text primary key,
  host_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null,
  ended_at timestamptz,
  currency text not null,
  players integer not null default 0,
  accounts integer not null default 0, -- seats tied to a Google account
  buyins integer not null default 0,
  buyin_cents bigint not null default 0,
  tip_pct integer not null default 0
);
create index game_stats_created_idx on public.game_stats (created_at);
alter table public.game_stats enable row level security;
revoke all on public.game_stats from anon, authenticated;

-- One summary row from a game row.
create function public.game_summary(g public.games)
returns public.game_stats
language sql
immutable
set search_path = ''
as $$
  select
    g.id,
    g.host_id,
    g.created_at,
    case when g.status = 'ended' then coalesce(g.ended_at, g.updated_at) end,
    g.currency,
    coalesce(jsonb_array_length(g.state -> 'players'), 0),
    (select count(*) from jsonb_array_elements(g.state -> 'players') p where p ->> 'acct' is not null)::integer,
    coalesce((select sum(jsonb_array_length(p -> 'buyIns')) from jsonb_array_elements(g.state -> 'players') p), 0)::integer,
    coalesce((select sum((b ->> 'cents')::bigint) from jsonb_array_elements(g.state -> 'players') p, jsonb_array_elements(p -> 'buyIns') b), 0)::bigint,
    case when g.status = 'ended' then coalesce((g.state -> 'result' ->> 'tipPct')::integer, 0) else 0 end;
$$;
revoke execute on function public.game_summary(public.games) from public, anon, authenticated;

create function public.games_to_stats()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.game_stats
  select (public.game_summary(new)).*
  on conflict (game_id) do update set
    ended_at = excluded.ended_at,
    currency = excluded.currency,
    players = excluded.players,
    accounts = excluded.accounts,
    buyins = excluded.buyins,
    buyin_cents = excluded.buyin_cents,
    tip_pct = excluded.tip_pct;
  return null;
exception when others then
  -- Numbers are nice to have; a host's save must never fail over them.
  return null;
end;
$$;
revoke execute on function public.games_to_stats() from public, anon, authenticated;

create trigger games_stats
  after insert or update on public.games
  for each row execute function public.games_to_stats();

-- Summaries for the games that already exist.
insert into public.game_stats
select (public.game_summary(g)).* from public.games g
on conflict (game_id) do nothing;

create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admins where user_id = (select auth.uid()));
$$;
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- Every number on the admin page, in one round trip. Times are Israel time.
create function public.admin_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  tz constant text := 'Asia/Jerusalem';
  since timestamptz := date_trunc('day', now() at time zone tz) at time zone tz - interval '29 days';
begin
  if not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'generated_at', now(),
    'users', jsonb_build_object(
      'total', (select count(*) from auth.users),
      'd1', (select count(*) from auth.users where created_at > now() - interval '1 day'),
      'd7', (select count(*) from auth.users where created_at > now() - interval '7 days'),
      'd30', (select count(*) from auth.users where created_at > now() - interval '30 days'),
      'active7', (select count(*) from auth.users where last_sign_in_at > now() - interval '7 days'),
      'hosts', (select count(distinct host_id) from public.game_stats),
      'returning_hosts', (select count(*) from (select host_id from public.game_stats where host_id is not null group by host_id having count(*) > 1) h)
    ),
    'games', jsonb_build_object(
      'total', (select count(*) from public.game_stats),
      'ended', (select count(*) from public.game_stats where ended_at is not null),
      'd1', (select count(*) from public.game_stats where created_at > now() - interval '1 day'),
      'd7', (select count(*) from public.game_stats where created_at > now() - interval '7 days'),
      'd30', (select count(*) from public.game_stats where created_at > now() - interval '30 days'),
      'live_now', (select count(*) from public.games where status = 'live' and updated_at > now() - interval '12 hours'),
      'stale_live', (select count(*) from public.games where status = 'live' and updated_at <= now() - interval '12 hours'),
      'avg_players', (select round(avg(players), 1) from public.game_stats where players > 0),
      'avg_minutes', (select round(avg(extract(epoch from ended_at - created_at) / 60)) from public.game_stats where ended_at is not null and ended_at - created_at < interval '2 days'),
      'seats', (select coalesce(sum(players), 0) from public.game_stats),
      'account_seats', (select coalesce(sum(accounts), 0) from public.game_stats),
      'buyins', (select coalesce(sum(buyins), 0) from public.game_stats)
    ),
    'live', coalesce((
      select jsonb_agg(jsonb_build_object(
        'started', g.created_at,
        'updated', g.updated_at,
        'currency', g.currency,
        'players', s.players,
        'buyin_cents', s.buyin_cents
      ) order by g.created_at desc)
      from public.games g join public.game_stats s on s.game_id = g.id
      where g.status = 'live' and g.updated_at > now() - interval '12 hours'
    ), '[]'::jsonb),
    'money', coalesce((
      select jsonb_agg(jsonb_build_object('currency', currency, 'games', n, 'buyin_cents', cents, 'avg_cents', avg_cents) order by cents desc)
      from (select currency, count(*) n, sum(buyin_cents) cents, round(avg(buyin_cents)) avg_cents from public.game_stats group by currency) m
    ), '[]'::jsonb),
    'tips', jsonb_build_object(
      'games', (select count(*) from public.game_stats where tip_pct > 0),
      'by_pct', coalesce((select jsonb_object_agg(tip_pct, n) from (select tip_pct, count(*) n from public.game_stats where ended_at is not null group by tip_pct) t), '{}'::jsonb),
      -- Same rounding as the app (whole units, rounded up); before the cap at
      -- what winners won, so it can be a little high.
      'by_currency', coalesce((
        select jsonb_object_agg(currency, cents)
        from (select currency, sum(ceil(buyin_cents * tip_pct / 10000.0) * 100) cents from public.game_stats where tip_pct > 0 group by currency) t
      ), '{}'::jsonb)
    ),
    'daily', (
      select jsonb_agg(jsonb_build_object(
        'day', to_char(d, 'YYYY-MM-DD'),
        'users', coalesce(u.n, 0),
        'games', coalesce(g.n, 0),
        'players', coalesce(g.p, 0)
      ) order by d)
      from generate_series((since at time zone tz)::date, (now() at time zone tz)::date, interval '1 day') d
      left join (select (created_at at time zone tz)::date dd, count(*) n from auth.users where created_at >= since group by 1) u on u.dd = d::date
      left join (select (created_at at time zone tz)::date dd, count(*) n, sum(players) p from public.game_stats where created_at >= since group by 1) g on g.dd = d::date
    ),
    'hours', (
      select jsonb_agg(coalesce(n, 0) order by h)
      from generate_series(0, 23) h
      left join (select extract(hour from created_at at time zone tz)::int hr, count(*) n from public.game_stats group by 1) x on x.hr = h
    ),
    'weekdays', (
      select jsonb_agg(coalesce(n, 0) order by w)
      from generate_series(0, 6) w
      left join (select extract(dow from created_at at time zone tz)::int dw, count(*) n from public.game_stats group by 1) x on x.dw = w
    ),
    'sizes', coalesce((
      select jsonb_object_agg(players, n) from (select players, count(*) n from public.game_stats group by players) x
    ), '{}'::jsonb)
  );
end;
$$;
revoke execute on function public.admin_stats() from public, anon;
grant execute on function public.admin_stats() to authenticated;
