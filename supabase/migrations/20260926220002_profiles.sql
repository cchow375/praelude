-- Praelude backend: profiles (spec 4c/5c).
--
-- Per-field privacy cannot be enforced by a single row-level SELECT policy (RLS is all-or-nothing
-- per row). So the base table only lets a user read/write their *own* row directly; every other
-- viewer goes through public.get_profile_card() (added in 20260926220006_social.sql, once
-- friendships/blocks/instruments/rewards_state/passages/badges all exist), which computes a
-- redacted projection honoring privacy + friendship + blocks.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique,
  display_name text not null default '',
  photo_path text,
  bio text not null default '',
  teacher_or_school text not null default '',
  location text not null default '',
  currently_working_on_piece_ids uuid[] not null default '{}',
  -- Array of {title?: text, date: date, location?: text}; kept schemaless since a performance is a
  -- small free-form record with no sync identity of its own in Core (Piece.performanceDates is just
  -- [Date] - the richer {title, location} shape here is a superset for the profile-card use case).
  upcoming_performances jsonb not null default '[]'::jsonb,
  join_date timestamptz not null default now(),
  is_private_account boolean not null default false,
  age_bracket public.age_bracket,
  leaderboard_opt_out boolean not null default false,

  privacy_name public.profile_visibility not null default 'public',
  privacy_username public.profile_visibility not null default 'public',
  privacy_photo public.profile_visibility not null default 'public',
  privacy_bio public.profile_visibility not null default 'friends',
  privacy_instruments public.profile_visibility not null default 'friends',
  privacy_teacher_or_school public.profile_visibility not null default 'friends',
  privacy_location public.profile_visibility not null default 'friends',
  privacy_currently_working_on public.profile_visibility not null default 'friends',
  privacy_upcoming_performances public.profile_visibility not null default 'friends',
  privacy_stats public.profile_visibility not null default 'friends',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint profiles_username_format check (username ~ '^[a-z0-9_.]{3,30}$')
);

comment on table public.profiles is
  'One row per account (spec 4c). Direct table access is self-only; other viewers use get_profile_card().';
comment on column public.profiles.upcoming_performances is
  'jsonb array of {title?, date, location?} - see supabase/(C) Sync Protocol.md.';

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Safety: username filter + stricter, server-enforced ceilings for minors.
--
-- Spec 5c asks for "stricter defaults for minors if public"; this enforces those as a hard ceiling
-- (clamped on every write, not just a one-time default) rather than a default a minor could
-- immediately loosen back to public - a deliberate strengthening given this concerns minors'
-- public visibility. See supabase/(C) Backend.md.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_profile_safety()
returns trigger
language plpgsql
as $$
begin
  if new.username is null or public.contains_blocked_word(new.username) then
    raise exception 'profiles.username contains a blocked word or is invalid' using errcode = '23514';
  end if;

  if new.age_bracket in ('under_13', '13_to_17') then
    new.is_private_account := true;
    if new.privacy_name = 'public' then new.privacy_name := 'friends'; end if;
    if new.privacy_username = 'public' then new.privacy_username := 'friends'; end if;
    if new.privacy_photo = 'public' then new.privacy_photo := 'friends'; end if;
    if new.privacy_bio = 'public' then new.privacy_bio := 'friends'; end if;
    if new.privacy_instruments = 'public' then new.privacy_instruments := 'friends'; end if;
    if new.privacy_teacher_or_school = 'public' then new.privacy_teacher_or_school := 'friends'; end if;
    if new.privacy_location = 'public' then new.privacy_location := 'friends'; end if;
    if new.privacy_currently_working_on = 'public' then new.privacy_currently_working_on := 'friends'; end if;
    if new.privacy_upcoming_performances = 'public' then new.privacy_upcoming_performances := 'friends'; end if;
    if new.privacy_stats = 'public' then new.privacy_stats := 'friends'; end if;
  end if;

  return new;
end;
$$;

create trigger profiles_enforce_safety
  before insert or update on public.profiles
  for each row execute function public.enforce_profile_safety();

-- ---------------------------------------------------------------------------
-- RLS: self-only on the base table.
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;

create policy profiles_select_self on public.profiles
  for select to authenticated
  using (id = auth.uid());

create policy profiles_insert_self on public.profiles
  for insert to authenticated
  with check (id = auth.uid());

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- No delete policy: account deletion goes through delete_my_account() (SECURITY DEFINER), never a
-- direct row delete, so it can also remove the auth.users row and storage objects atomically.

-- ---------------------------------------------------------------------------
-- Auto-provision a minimal profile row on signup, so the client never has to
-- race "insert my own profile" against RLS before it has a session that could
-- own it. username is a placeholder the client replaces during onboarding.
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, username, display_name)
  values (new.id, 'user_' || substr(replace(new.id::text, '-', ''), 1, 12), '')
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();
