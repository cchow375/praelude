-- Platform-neutral user choices, shared by native and future desktop/web clients.
-- Device permissions/audio session state stay local. Owner-keyed singleton, whole-row LWW.
create table if not exists public.account_preferences (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  preferences jsonb not null check (jsonb_typeof(preferences) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.account_preferences enable row level security;
create policy account_preferences_select_own on public.account_preferences
  for select to authenticated using (owner_id = (select auth.uid()));
create policy account_preferences_insert_own on public.account_preferences
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy account_preferences_update_own on public.account_preferences
  for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create trigger account_preferences_set_updated_at before update on public.account_preferences
  for each row execute function public.set_updated_at();
insert into public.sync_tables(table_name, conflict_column, owner_column)
  values ('account_preferences', 'owner_id', 'owner_id')
  on conflict (table_name) do update set conflict_column=excluded.conflict_column, owner_column=excluded.owner_column;
revoke all on public.account_preferences from anon;
grant select, insert, update on public.account_preferences to authenticated;
