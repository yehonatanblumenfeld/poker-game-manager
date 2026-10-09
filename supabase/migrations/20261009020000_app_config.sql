-- Small app settings the owner edits in the dashboard (Table Editor), kept
-- out of the code. Signed-in users can read them; nobody can write them
-- from the app.
create table public.app_config (
  key text primary key check (key ~ '^[a-z_]{1,40}$'),
  value text not null check (char_length(value) <= 500)
);

alter table public.app_config enable row level security;

create policy "signed-in users read settings" on public.app_config
  for select to authenticated using (true);

revoke all on public.app_config from anon;
grant select on public.app_config to authenticated;
