-- Praelude backend: the social graph and its features (spec 5). Full design notes in
-- supabase/(C) Backend.md; wire-format field mapping in supabase/(C) Sync Protocol.md.
--
-- None of the tables in this migration are schema3 sync tables (not in public.sync_tables /
-- public.append_only_tables, and never will be): §5 has no Core-side mirror at all - Profile.swift's
-- own comment says it plainly ("the backend/sync track owns the authoritative copy, friend graph and
-- moderation"). These are inherently server-first, online features, not part of the offline-editable
-- personal library. The client reads/writes them directly (RLS-gated) or through the RPCs below, not
-- through sync_upsert/sync_append.
--
-- Recurring pattern used throughout (established by profiles/get_profile_card in the previous
-- migration): a base table's own RLS only ever lets a user see their OWN rows directly. Every
-- cross-user read (a friend's card, a friend's feed, who reacted to a post, ...) goes through a
-- named SECURITY DEFINER function that manually checks friendship/blocks/privacy and returns a
-- redacted projection. This keeps every cross-user access path auditable in one place instead of
-- scattered across USING clauses, and sidesteps RLS-recursion pitfalls for the multi-party tables
-- (studios) by checking membership through a SECURITY DEFINER helper instead of a self-referencing
-- policy.

-- ---------------------------------------------------------------------------
-- Corrections to already-applied migrations, found in this review pass before any real client
-- depended on them:
-- ---------------------------------------------------------------------------

-- 1. public.sync_tables / public.append_only_tables had RLS disabled entirely. Supabase exposes
--    every public-schema table over PostgREST by default, so *any* authenticated caller could have
--    inserted a row of their own choosing into either allow-list and then handed that table name to
--    sync_upsert/sync_append - at minimum corrupting the allow-list (e.g. changing another table's
--    conflict_column), and for any public table shaped enough like a sync table, reaching rows a
--    client was never meant to touch directly. Both now match public.blocked_words: RLS on, zero
--    policies, so PostgREST returns zero rows and permits zero writes - only a migration (running as
--    postgres) can maintain them.
alter table public.sync_tables enable row level security;
alter table public.append_only_tables enable row level security;

-- 2. Four enum types were given snake_case labels that don't match the Swift raw value Core's
--    Codable already emits for that case: an undecorated multi-word Swift case's synthesized raw
--    value is the case name verbatim (camelCase), never snake_case. Renamed in place - the values
--    never shipped to a real client - rather than recreated.
alter type public.learning_state rename value 'performance_ready' to 'performanceReady';
alter type public.instrument_family rename value 'plucked_strings' to 'pluckedStrings';
alter type public.notebook_entry_kind rename value 'lesson_note' to 'lessonNote';
alter type public.notebook_entry_kind rename value 'lesson_prep' to 'lessonPrep';
alter type public.profile_visibility rename value 'only_me' to 'onlyMe';

-- 3. sets.tempo_step's default didn't match TempoStep's real (verified empirically, not guessed)
--    Codable shape: Swift's synthesized encoding for a single-associated-value enum case wraps the
--    value as {"_0": ...} - `.fixed(4)` encodes to {"fixed":{"_0":4}}, not {"kind":"fixed","amount":4}.
--    jsonb columns that mirror a Core type are opaque blobs the server never inspects (documented in
--    the sync protocol doc); this only corrects the one literal default value to actually match.
alter table public.sets alter column tempo_step set default '{"fixed":{"_0":4}}'::jsonb;

-- 4. sets.goal/sets.basis had no integrity check at all (any text would insert). Every other
--    enum-shaped sync column in this schema is constrained; these two were just missed.
alter table public.sets add constraint sets_goal_check check (goal in (
  'tempo', 'notesAndAccuracy', 'phrasing', 'dynamics', 'memory', 'partsCoordination', 'other'
));
alter table public.sets add constraint sets_basis_check check (basis in ('cleanStreak', 'totalPlays'));

-- ---------------------------------------------------------------------------
-- profiles gains two settings the spec asks for (5c: "who sees presence/streaks/pieces/notes") that
-- weren't on the original per-field privacy set - streaks/pieces are already privacy_stats /
-- privacy_currently_working_on. Also registered in the generic sync engine: profiles was previously
-- self-RLS-only with no LWW comparison at all (a plain PATCH would let whichever HTTP request lands
-- last at the DB win, regardless of which edit is actually newer) - conflict_column = owner_column =
-- 'id' lets it reuse the exact same atomic upsert as every other table.
-- ---------------------------------------------------------------------------

alter table public.profiles add column privacy_presence public.profile_visibility not null default 'friends';
alter table public.profiles add column privacy_notes public.profile_visibility not null default 'friends';

insert into public.sync_tables (table_name, conflict_column, owner_column) values ('profiles', 'id', 'id')
  on conflict (table_name) do update set conflict_column = excluded.conflict_column, owner_column = excluded.owner_column;

-- ---------------------------------------------------------------------------
-- Friendships (5a/5b): one symmetric relationship, not a one-way follow. A private account doesn't
-- change this mechanics - every request already requires an explicit accept, which is the whole of
-- what "private accounts approve followers" asks for; private only changes default *content*
-- visibility (see get_profile_card below).
-- ---------------------------------------------------------------------------

create table public.friendships (
  requester_id uuid not null references auth.users (id) on delete cascade,
  addressee_id uuid not null references auth.users (id) on delete cascade,
  status public.friendship_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  responded_at timestamptz,
  primary key (requester_id, addressee_id),
  constraint friendships_not_self check (requester_id <> addressee_id)
);

alter table public.friendships enable row level security;

create policy friendships_select_own on public.friendships
  for select to authenticated
  using (requester_id = auth.uid() or addressee_id = auth.uid());

-- No insert/update/delete policy: send_friend_request/respond_friend_request/unfriend (below) are
-- the only mutation path, so the mutual-request-auto-accept and cross-cleanup logic can't be
-- bypassed by a direct table write.

create index friendships_addressee_idx on public.friendships (addressee_id, status);

create or replace function public.is_friend(p_a uuid, p_b uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.friendships f
    where f.status = 'accepted'
      and ((f.requester_id = p_a and f.addressee_id = p_b) or (f.requester_id = p_b and f.addressee_id = p_a))
  );
$$;

-- ---------------------------------------------------------------------------
-- Blocks (5c). Symmetric for visibility purposes (either party having blocked the other hides both
-- from each other), asymmetric for who can undo it (only the blocker can unblock).
-- ---------------------------------------------------------------------------

create table public.blocks (
  blocker_id uuid not null references auth.users (id) on delete cascade,
  blocked_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint blocks_not_self check (blocker_id <> blocked_id)
);

alter table public.blocks enable row level security;

create policy blocks_select_own on public.blocks
  for select to authenticated
  using (blocker_id = auth.uid());

create index blocks_blocked_idx on public.blocks (blocked_id);

create or replace function public.is_blocked(p_a uuid, p_b uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.blocks b
    where (b.blocker_id = p_a and b.blocked_id = p_b) or (b.blocker_id = p_b and b.blocked_id = p_a)
  );
$$;

create or replace function public.block_user(p_target uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'block_user: must be called as an authenticated user' using errcode = '42501'; end if;
  if p_target = v_me then raise exception 'block_user: cannot block yourself'; end if;

  insert into public.blocks (blocker_id, blocked_id) values (v_me, p_target) on conflict do nothing;
  delete from public.friendships
   where (requester_id = v_me and addressee_id = p_target) or (requester_id = p_target and addressee_id = v_me);
end;
$$;

revoke all on function public.block_user(uuid) from public;
grant execute on function public.block_user(uuid) to authenticated;

create or replace function public.unblock_user(p_target uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  delete from public.blocks where blocker_id = auth.uid() and blocked_id = p_target;
end;
$$;

revoke all on function public.unblock_user(uuid) from public;
grant execute on function public.unblock_user(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Friend request RPCs. send_friend_request auto-accepts a mutual request instead of leaving two
-- pending rows pointed at each other.
-- ---------------------------------------------------------------------------

create or replace function public.send_friend_request(p_addressee uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_me uuid := auth.uid();
  v_reverse public.friendships;
  v_result public.friendships;
begin
  if v_me is null then raise exception 'send_friend_request: must be called as an authenticated user' using errcode = '42501'; end if;
  if p_addressee = v_me then raise exception 'send_friend_request: cannot friend yourself'; end if;
  if public.is_blocked(v_me, p_addressee) then raise exception 'send_friend_request: blocked' using errcode = '42501'; end if;

  select * into v_reverse from public.friendships
    where requester_id = p_addressee and addressee_id = v_me;

  if found and v_reverse.status = 'pending' then
    update public.friendships set status = 'accepted', updated_at = now(), responded_at = now()
      where requester_id = p_addressee and addressee_id = v_me
      returning * into v_result;
    return jsonb_build_object('status', v_result.status, 'auto_accepted', true);
  end if;

  insert into public.friendships (requester_id, addressee_id, status)
    values (v_me, p_addressee, 'pending')
    on conflict (requester_id, addressee_id) do update set status = 'pending', updated_at = now(), responded_at = null
    returning * into v_result;
  return jsonb_build_object('status', v_result.status, 'auto_accepted', false);
end;
$$;

revoke all on function public.send_friend_request(uuid) from public;
grant execute on function public.send_friend_request(uuid) to authenticated;

create or replace function public.respond_friend_request(p_requester uuid, p_accept boolean)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_me uuid := auth.uid();
  v_result public.friendships;
begin
  if v_me is null then raise exception 'respond_friend_request: must be called as an authenticated user' using errcode = '42501'; end if;

  update public.friendships
     set status = case when p_accept then 'accepted' else 'declined' end,
         updated_at = now(), responded_at = now()
   where requester_id = p_requester and addressee_id = v_me and status = 'pending'
   returning * into v_result;

  if not found then
    raise exception 'respond_friend_request: no pending request from that user' using errcode = '42501';
  end if;

  return jsonb_build_object('status', v_result.status);
end;
$$;

revoke all on function public.respond_friend_request(uuid, boolean) from public;
grant execute on function public.respond_friend_request(uuid, boolean) to authenticated;

create or replace function public.unfriend(p_friend uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_me uuid := auth.uid();
begin
  delete from public.friendships
   where (requester_id = v_me and addressee_id = p_friend) or (requester_id = p_friend and addressee_id = v_me);
end;
$$;

revoke all on function public.unfriend(uuid) from public;
grant execute on function public.unfriend(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Profile field visibility (5c). A private account clamps its own 'public'-flagged fields down to
-- 'friends' - "public" only ever means "public" for an account that isn't itself private. This is
-- the one piece of behavior implicit in the spec's "conservative defaults" ethos that isn't spelled
-- out mechanically; documented at length in supabase/(C) Backend.md.
-- ---------------------------------------------------------------------------

create or replace function public._profile_field_visible(p_visibility public.profile_visibility, p_is_private boolean, p_is_friend boolean)
returns boolean
language sql immutable
as $$
  select case
    when p_visibility = 'onlyMe' then false
    when p_visibility = 'friends' then p_is_friend
    when p_visibility = 'public' then (p_is_friend or not p_is_private)
    else false
  end;
$$;

create or replace function public._profile_stats(p_owner uuid)
returns jsonb
language sql stable security definer set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'streak_days', coalesce(r.streak_days, 0),
    'streak_freezes_available', coalesce(r.streak_freezes_available, 0),
    'rank', coalesce(r.rank, 'Unranked'),
    'division', coalesce(r.division, 1),
    -- Total practice time: append-only sets' own active_seconds, the authoritative per-set figure
    -- (spec 10); practice_sessions.active_seconds double-counts the same time, so it is not summed
    -- here too.
    'total_practice_seconds', coalesce((
      select sum(s.active_seconds) from public.sets s where s.owner_id = p_owner
    ), 0),
    'pieces_performance_ready', coalesce((
      select count(distinct pa.piece_id) from public.passages pa
      where pa.owner_id = p_owner and pa.learning_state = 'performanceReady' and pa.deleted_at is null
    ), 0),
    'badges', coalesce((
      select jsonb_agg(jsonb_build_object('key', b.key, 'earned_at', b.earned_at) order by b.earned_at desc)
      from public.badges b where b.owner_id = p_owner
    ), '[]'::jsonb)
    -- "Longest streak" (spec 4c) has no home yet: Core's RewardsState only tracks the current streak
    -- (Rewards.swift), and rewards_state is a sync_upsert-registered whole-row-LWW table, so adding a
    -- server-only column here would just be overwritten to null by the next client upsert that
    -- doesn't know about it. Left out until the rewards engine (spec 14, a separate future track)
    -- decides where a running "longest streak ever" is computed and stored.
  )
  from public.rewards_state r where r.owner_id = p_owner;
$$;

create or replace function public.get_profile_card(p_target uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  v_viewer uuid := auth.uid();
  v_profile public.profiles;
  v_friend boolean;
  v_card jsonb;
begin
  if v_viewer is null then
    raise exception 'get_profile_card: must be called as an authenticated user' using errcode = '42501';
  end if;

  select * into v_profile from public.profiles where id = p_target;
  if not found then
    return null;
  end if;

  if p_target = v_viewer then
    return to_jsonb(v_profile) || jsonb_build_object('stats', public._profile_stats(p_target));
  end if;

  if public.is_blocked(v_viewer, p_target) then
    return null;
  end if;

  v_friend := public.is_friend(v_viewer, p_target);

  v_card := jsonb_build_object('id', v_profile.id, 'join_date', v_profile.join_date, 'is_friend', v_friend);

  if public._profile_field_visible(v_profile.privacy_name, v_profile.is_private_account, v_friend) then
    v_card := v_card || jsonb_build_object('display_name', v_profile.display_name);
  end if;
  if public._profile_field_visible(v_profile.privacy_username, v_profile.is_private_account, v_friend) then
    v_card := v_card || jsonb_build_object('username', v_profile.username);
  end if;
  if public._profile_field_visible(v_profile.privacy_photo, v_profile.is_private_account, v_friend) then
    v_card := v_card || jsonb_build_object('photo_path', v_profile.photo_path);
  end if;
  if public._profile_field_visible(v_profile.privacy_bio, v_profile.is_private_account, v_friend) then
    v_card := v_card || jsonb_build_object('bio', v_profile.bio);
  end if;
  if public._profile_field_visible(v_profile.privacy_teacher_or_school, v_profile.is_private_account, v_friend) then
    v_card := v_card || jsonb_build_object('teacher_or_school', v_profile.teacher_or_school);
  end if;
  if public._profile_field_visible(v_profile.privacy_location, v_profile.is_private_account, v_friend) then
    v_card := v_card || jsonb_build_object('location', v_profile.location);
  end if;
  if public._profile_field_visible(v_profile.privacy_currently_working_on, v_profile.is_private_account, v_friend) then
    v_card := v_card || jsonb_build_object('currently_working_on_piece_ids', v_profile.currently_working_on_piece_ids);
  end if;
  if public._profile_field_visible(v_profile.privacy_upcoming_performances, v_profile.is_private_account, v_friend) then
    v_card := v_card || jsonb_build_object('upcoming_performances', v_profile.upcoming_performances);
  end if;
  if public._profile_field_visible(v_profile.privacy_stats, v_profile.is_private_account, v_friend) then
    v_card := v_card || jsonb_build_object('stats', public._profile_stats(p_target));
  end if;
  if public._profile_field_visible(v_profile.privacy_instruments, v_profile.is_private_account, v_friend) then
    v_card := v_card || jsonb_build_object('instruments', coalesce((
      select jsonb_agg(to_jsonb(i.*) - 'owner_id') from public.instruments i
      where i.owner_id = p_target and i.deleted_at is null
    ), '[]'::jsonb));
  end if;

  return v_card;
end;
$$;

revoke all on function public.get_profile_card(uuid) from public;
grant execute on function public.get_profile_card(uuid) to authenticated;

comment on function public.get_profile_card(uuid) is
  'The one read path for another user''s profile (spec 4c/5c): privacy + friendship + blocks, with a '
  'private account clamping its own ''public'' fields to ''friends''. See supabase/(C) Backend.md.';

-- search_profiles needs its pattern escaped so a query containing %, _ or \ can't turn into an
-- unintentionally broad ILIKE scan; a tiny helper keeps the query below a plain one-liner. Defined
-- first: search_profiles is a `language sql` function, and (like is_friend/is_blocked in the file
-- header note) its body is parsed - and every function/table it calls resolved - at CREATE time, not
-- deferred to first execution the way a plpgsql body would be.
create or replace function public.username_search_escape(p_text text)
returns text language sql immutable as $$
  select replace(replace(replace(p_text, '\', '\\'), '%', '\%'), '_', '\_');
$$;

create or replace function public.search_profiles(p_query text)
returns jsonb
language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'username', p.username, 'display_name', p.display_name)), '[]'::jsonb)
  from public.profiles p
  where p.username ilike '%' || public.username_search_escape(p_query) || '%'
    and p.id <> auth.uid()
    and not public.is_blocked(auth.uid(), p.id)
    and public._profile_field_visible(p.privacy_username, p.is_private_account, public.is_friend(auth.uid(), p.id))
  limit 20;
$$;

create or replace function public.friend_cards()
returns jsonb
language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(public.get_profile_card(f.friend_id)), '[]'::jsonb)
  from (
    select case when requester_id = auth.uid() then addressee_id else requester_id end as friend_id
    from public.friendships
    where status = 'accepted' and (requester_id = auth.uid() or addressee_id = auth.uid())
  ) f;
$$;

revoke all on function public.search_profiles(text) from public;
grant execute on function public.search_profiles(text) to authenticated;
revoke all on function public.friend_cards() from public;
grant execute on function public.friend_cards() to authenticated;

comment on function public.friend_cards() is
  'Every accepted friend''s profile card in one call (spec 5a friend cards). Presence/"current '
  'practice" is layered on client-side from friend_presence(), not duplicated here.';

-- ---------------------------------------------------------------------------
-- Shared repertoire (5b): friends only, matched by normalized title+composer. No privacy toggle of
-- its own - it is an explicit, one-friend-at-a-time lookup (not a broadcast), gated by friendship
-- and blocks like everything else in this file.
-- ---------------------------------------------------------------------------

create or replace function public.shared_repertoire(p_friend uuid)
returns jsonb
language sql stable security definer set search_path = public, pg_temp
as $$
  select case
    when not public.is_friend(auth.uid(), p_friend) or public.is_blocked(auth.uid(), p_friend) then '[]'::jsonb
    else coalesce((
      select jsonb_agg(jsonb_build_object('title', mine.title, 'composer', mine.composer))
      from (
        select distinct trim(title) as title, trim(composer) as composer from public.pieces
        where owner_id = auth.uid() and deleted_at is null
      ) mine
      join (
        select distinct trim(title) as title, trim(composer) as composer from public.pieces
        where owner_id = p_friend and deleted_at is null
      ) theirs on lower(mine.title) = lower(theirs.title) and lower(mine.composer) = lower(theirs.composer)
    ), '[]'::jsonb)
  end;
$$;

revoke all on function public.shared_repertoire(uuid) from public;
grant execute on function public.shared_repertoire(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Activity feed (5a). Client posts an event at the moments the spec names (session finished, streak
-- milestone, passage performance-ready, new piece, performance date set, note posted, rank/badge);
-- deliberately not fanned out automatically by triggers on every source table, so this backend
-- migration doesn't have to guess the product's exact "what's feed-worthy" rules on the source
-- tables' behalf, and the one insert path stays easy to test.
-- ---------------------------------------------------------------------------

create table public.activity_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in (
    'session_finished', 'streak_milestone', 'passage_performance_ready', 'new_piece',
    'performance_date_set', 'note_posted', 'rank_badge'
  )),
  piece_id uuid references public.pieces (id) on delete set null,
  passage_id uuid references public.passages (id) on delete set null,
  detail text not null default '',
  created_at timestamptz not null default now()
);

create or replace function public._enforce_owned_piece_passage()
returns trigger
language plpgsql
as $$
begin
  if new.piece_id is not null and not exists (
    select 1 from public.pieces p where p.id = new.piece_id and p.owner_id = new.owner_id
  ) then
    raise exception '%: piece_id must belong to the same owner', tg_table_name using errcode = '23514';
  end if;
  if new.passage_id is not null and not exists (
    select 1 from public.passages p where p.id = new.passage_id and p.owner_id = new.owner_id
  ) then
    raise exception '%: passage_id must belong to the same owner', tg_table_name using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger activity_events_ownership before insert on public.activity_events
  for each row execute function public._enforce_owned_piece_passage();

alter table public.activity_events enable row level security;

create policy activity_events_select_own on public.activity_events
  for select to authenticated using (owner_id = auth.uid());
create policy activity_events_insert_own on public.activity_events
  for insert to authenticated with check (owner_id = auth.uid());
-- No update/delete: a feed item is append-only, matching every other event log in this schema.

create index activity_events_owner_created_idx on public.activity_events (owner_id, created_at desc);

create or replace function public.post_activity_event(p_kind text, p_piece_id uuid default null, p_passage_id uuid default null, p_detail text default '')
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_id uuid;
begin
  insert into public.activity_events (owner_id, kind, piece_id, passage_id, detail)
    values (auth.uid(), p_kind, p_piece_id, p_passage_id, p_detail)
    returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.post_activity_event(text, uuid, uuid, text) from public;
grant execute on function public.post_activity_event(text, uuid, uuid, text) to authenticated;

create or replace function public.friend_activity_feed(p_since timestamptz default now() - interval '30 days', p_limit int default 100)
returns jsonb
language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(to_jsonb(e.*) order by e.created_at desc), '[]'::jsonb)
  from (
    select * from public.activity_events e
    where e.created_at >= p_since
      and (e.owner_id = auth.uid() or (public.is_friend(auth.uid(), e.owner_id) and not public.is_blocked(auth.uid(), e.owner_id)))
    order by e.created_at desc
    limit greatest(p_limit, 0)
  ) e;
$$;

revoke all on function public.friend_activity_feed(timestamptz, int) from public;
grant execute on function public.friend_activity_feed(timestamptz, int) to authenticated;

-- ---------------------------------------------------------------------------
-- Offensive-text filter (5c), generalized: applies contains_blocked_word (from
-- 20260926220001_extensions_and_helpers.sql) to any single column via a trigger argument, so
-- comments (below), notes and note_replies (further below) share one function instead of three
-- near-identical ones. Defined here, ahead of every table/trigger that uses it: CREATE TRIGGER must
-- resolve its function by name immediately (unlike a plain function-body reference, which - for
-- plpgsql - is only resolved at first call).
-- ---------------------------------------------------------------------------

create or replace function public.enforce_no_blocked_words()
returns trigger
language plpgsql
as $$
declare
  v_column text := tg_argv[0];
  v_value text;
begin
  v_value := to_jsonb(new) ->> v_column;
  if v_value is not null and public.contains_blocked_word(v_value) then
    raise exception '%.% contains a blocked word', tg_table_name, v_column using errcode = '23514';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reactions and comments (5a), on an activity_event or a note. Visibility to react/comment on a
-- target mirrors visibility to *see* it; enforced once, in a shared trigger, rather than duplicated
-- in a USING clause and a function.
-- ---------------------------------------------------------------------------

create or replace function public.can_view_activity_event(p_event_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.activity_events e
    where e.id = p_event_id
      and (e.owner_id = auth.uid() or (public.is_friend(auth.uid(), e.owner_id) and not public.is_blocked(auth.uid(), e.owner_id)))
  );
$$;

create table public.reactions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  target_type text not null check (target_type in ('activity_event', 'note')),
  target_id uuid not null,
  kind text not null check (kind in ('bravo', 'encore', 'applause', 'crescendo', 'fermata')),
  created_at timestamptz not null default now(),
  unique (owner_id, target_type, target_id, kind)
);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  target_type text not null check (target_type in ('activity_event', 'note')),
  target_id uuid not null,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create or replace function public._can_view_social_target(p_target_type text, p_target_id uuid)
returns boolean
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if p_target_type = 'activity_event' then
    return public.can_view_activity_event(p_target_id);
  elsif p_target_type = 'note' then
    return exists (
      select 1 from public.notes n
      where n.id = p_target_id and n.deleted_at is null and n.created_at > now() - interval '24 hours'
        and (n.owner_id = auth.uid() or (public.is_friend(auth.uid(), n.owner_id) and not public.is_blocked(auth.uid(), n.owner_id)))
    );
  end if;
  return false;
end;
$$;

create or replace function public._enforce_social_target_visible()
returns trigger
language plpgsql
as $$
begin
  if not public._can_view_social_target(new.target_type, new.target_id) then
    raise exception '%: target is not visible to the caller', tg_table_name using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger reactions_target_visible before insert on public.reactions
  for each row execute function public._enforce_social_target_visible();
create trigger comments_target_visible before insert on public.comments
  for each row execute function public._enforce_social_target_visible();
create trigger comments_safety before insert or update on public.comments
  for each row execute function public.enforce_no_blocked_words('body');

alter table public.reactions enable row level security;
create policy reactions_select_own on public.reactions for select to authenticated using (owner_id = auth.uid());
create policy reactions_insert_own on public.reactions for insert to authenticated with check (owner_id = auth.uid());
create policy reactions_delete_own on public.reactions for delete to authenticated using (owner_id = auth.uid());

alter table public.comments enable row level security;
create policy comments_select_own on public.comments for select to authenticated using (owner_id = auth.uid());
create policy comments_insert_own on public.comments for insert to authenticated with check (owner_id = auth.uid());
create policy comments_update_own on public.comments for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy comments_delete_own on public.comments for delete to authenticated using (owner_id = auth.uid());

create index reactions_target_idx on public.reactions (target_type, target_id);
create index comments_target_idx on public.comments (target_type, target_id);

create or replace function public.activity_event_reactions(p_event_id uuid)
returns jsonb
language sql stable security definer set search_path = public, pg_temp
as $$
  select case when not public.can_view_activity_event(p_event_id) then '[]'::jsonb else coalesce((
    select jsonb_agg(jsonb_build_object('owner_id', r.owner_id, 'kind', r.kind, 'created_at', r.created_at))
    from public.reactions r where r.target_type = 'activity_event' and r.target_id = p_event_id
  ), '[]'::jsonb) end;
$$;

create or replace function public.activity_event_comments(p_event_id uuid)
returns jsonb
language sql stable security definer set search_path = public, pg_temp
as $$
  select case when not public.can_view_activity_event(p_event_id) then '[]'::jsonb else coalesce((
    select jsonb_agg(jsonb_build_object('id', c.id, 'owner_id', c.owner_id, 'body', c.body, 'created_at', c.created_at) order by c.created_at)
    from public.comments c where c.target_type = 'activity_event' and c.target_id = p_event_id and c.deleted_at is null
  ), '[]'::jsonb) end;
$$;

revoke all on function public.activity_event_reactions(uuid) from public;
grant execute on function public.activity_event_reactions(uuid) to authenticated;
revoke all on function public.activity_event_comments(uuid) from public;
grant execute on function public.activity_event_comments(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Notes (5a): Instagram-Notes style, 24h, optional piece, private replies. 24h expiry is enforced by
-- every reader filtering on created_at, not by a cron/purge job - see supabase/(C) Backend.md for why
-- that's enough for the product behavior, and what a hygiene purge would add on top.
-- ---------------------------------------------------------------------------

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  text text not null,
  piece_id uuid references public.pieces (id) on delete set null,
  -- Denormalized at write time (the author's own client already has this) so a friend reading the
  -- note never needs a cross-user join into the author's otherwise-private pieces table.
  piece_title text,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint notes_text_not_blank check (length(trim(text)) > 0)
);

create trigger notes_ownership before insert on public.notes
  for each row execute function public._enforce_owned_piece_passage();
create trigger notes_safety before insert or update on public.notes
  for each row execute function public.enforce_no_blocked_words('text');

alter table public.notes enable row level security;
create policy notes_select_own on public.notes for select to authenticated using (owner_id = auth.uid());
create policy notes_insert_own on public.notes for insert to authenticated with check (owner_id = auth.uid());
create policy notes_update_own on public.notes for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create index notes_owner_created_idx on public.notes (owner_id, created_at desc);

create table public.note_replies (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.notes (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  constraint note_replies_body_not_blank check (length(trim(body)) > 0)
);

-- note_replies uses target_id = note_id directly (no target_type column needed - it can only ever
-- target a note), so it gets its own tiny wrapper around _can_view_social_target instead of reusing
-- _enforce_social_target_visible verbatim (whose trigger body reads NEW.target_type/target_id).
-- Defined before the trigger that uses it, same reasoning as enforce_no_blocked_words above.
create or replace function public._enforce_social_target_visible_note()
returns trigger
language plpgsql
as $$
begin
  if not public._can_view_social_target('note', new.note_id) then
    raise exception 'note_replies: note is not visible to the caller' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger note_replies_visible before insert on public.note_replies
  for each row execute function public._enforce_social_target_visible_note();

create trigger note_replies_safety before insert on public.note_replies
  for each row execute function public.enforce_no_blocked_words('body');

alter table public.note_replies enable row level security;
-- Private replies (spec 5a): visible only to the two participants, never to other viewers of the
-- note - this is the one place in this migration a cross-user SELECT policy is correct rather than a
-- reader function, because "the two of us" is exactly what RLS row filtering expresses well.
create policy note_replies_select_participant on public.note_replies
  for select to authenticated
  using (owner_id = auth.uid() or note_id in (select id from public.notes where owner_id = auth.uid()));
create policy note_replies_insert_own on public.note_replies
  for insert to authenticated with check (owner_id = auth.uid());

create index note_replies_note_idx on public.note_replies (note_id);

create or replace function public.friend_notes()
returns jsonb
language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', n.id, 'owner_id', n.owner_id, 'text', n.text, 'piece_title', n.piece_title, 'created_at', n.created_at
  ) order by n.created_at desc), '[]'::jsonb)
  from public.notes n
  where n.deleted_at is null and n.created_at > now() - interval '24 hours'
    and (n.owner_id = auth.uid() or (
      public.is_friend(auth.uid(), n.owner_id) and not public.is_blocked(auth.uid(), n.owner_id)
      and public._profile_field_visible(
        (select p.privacy_notes from public.profiles p where p.id = n.owner_id),
        (select p.is_private_account from public.profiles p where p.id = n.owner_id),
        true
      )
    ));
$$;

revoke all on function public.friend_notes() from public;
grant execute on function public.friend_notes() to authenticated;

-- ---------------------------------------------------------------------------
-- Presence (5a "practicing now"). This table is the fallback/last-known-state read for a friend who
-- isn't currently subscribed to Realtime; the live blinking-dot behavior itself is designed to run
-- over Supabase Realtime presence/broadcast on a per-user channel (no schema of its own - see
-- supabase/(C) Backend.md), which this table backs up whenever a client happens to call
-- set_presence. A single upsert-by-owner row, so "most recent write wins" is trivially correct - no
-- LWW/merge concern the way an offline-editable record would have.
-- ---------------------------------------------------------------------------

create table public.presence (
  owner_id uuid primary key references auth.users (id) on delete cascade,
  is_practicing boolean not null default false,
  piece_id uuid references public.pieces (id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.presence enable row level security;
create policy presence_select_own on public.presence for select to authenticated using (owner_id = auth.uid());
-- No insert/update policy: set_presence (below) is the only mutation path, since it also validates
-- piece_id ownership the way a bare RLS check policy cannot express as simply as a WHERE clause here.

create or replace function public.set_presence(p_is_practicing boolean, p_piece_id uuid default null)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'set_presence: must be called as an authenticated user' using errcode = '42501'; end if;
  if p_piece_id is not null and not exists (select 1 from public.pieces p where p.id = p_piece_id and p.owner_id = v_me) then
    raise exception 'set_presence: piece_id must belong to the caller';
  end if;

  insert into public.presence (owner_id, is_practicing, piece_id, updated_at)
    values (v_me, p_is_practicing, p_piece_id, now())
  on conflict (owner_id) do update
    set is_practicing = excluded.is_practicing, piece_id = excluded.piece_id, updated_at = excluded.updated_at;
end;
$$;

revoke all on function public.set_presence(boolean, uuid) from public;
grant execute on function public.set_presence(boolean, uuid) to authenticated;

create or replace function public.friend_presence()
returns jsonb
language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'owner_id', pr.owner_id, 'is_practicing', pr.is_practicing, 'piece_id', pr.piece_id, 'updated_at', pr.updated_at
  )), '[]'::jsonb)
  from public.presence pr
  join public.profiles p on p.id = pr.owner_id
  where public.is_friend(auth.uid(), pr.owner_id) and not public.is_blocked(auth.uid(), pr.owner_id)
    and public._profile_field_visible(p.privacy_presence, p.is_private_account, true)
    -- A presence row older than a couple of minutes is stale (client stopped/backgrounded without a
    -- final set_presence(false) call, e.g. a force-quit) - treat it as "not currently practicing"
    -- rather than showing a stuck true forever.
    and (pr.is_practicing = false or pr.updated_at > now() - interval '2 minutes');
$$;

revoke all on function public.friend_presence() from public;
grant execute on function public.friend_presence() to authenticated;

-- ---------------------------------------------------------------------------
-- Studios/groups with shared goals (5b). Membership checked through a SECURITY DEFINER helper
-- (rather than a self-referencing policy on studio_members) to avoid RLS-recursion.
-- ---------------------------------------------------------------------------

create table public.studios (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.studio_members (
  studio_id uuid not null references public.studios (id) on delete cascade,
  member_id uuid not null references auth.users (id) on delete cascade,
  role public.studio_member_role not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (studio_id, member_id)
);

create or replace function public.is_studio_member(p_studio uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.studio_members m where m.studio_id = p_studio and m.member_id = p_user);
$$;

create or replace function public.is_studio_owner(p_studio uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.studio_members m where m.studio_id = p_studio and m.member_id = p_user and m.role = 'owner');
$$;

alter table public.studios enable row level security;
create policy studios_select_member on public.studios for select to authenticated using (public.is_studio_member(id, auth.uid()));
-- No insert/update/delete policy: create_studio/add_studio_member/remove_studio_member (below) are
-- the only mutation path, so "creating a studio always makes you its owner member" can't be skipped.

alter table public.studio_members enable row level security;
create policy studio_members_select_member on public.studio_members for select to authenticated using (public.is_studio_member(studio_id, auth.uid()));

create table public.studio_goals (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios (id) on delete cascade,
  title text not null,
  target_date date,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.studio_goals enable row level security;
create policy studio_goals_select_member on public.studio_goals for select to authenticated using (public.is_studio_member(studio_id, auth.uid()));
create policy studio_goals_insert_member on public.studio_goals for insert to authenticated
  with check (public.is_studio_member(studio_id, auth.uid()) and created_by = auth.uid());
create policy studio_goals_update_member on public.studio_goals for update to authenticated
  using (public.is_studio_member(studio_id, auth.uid())) with check (public.is_studio_member(studio_id, auth.uid()));

create index studio_members_member_idx on public.studio_members (member_id);
create index studio_goals_studio_idx on public.studio_goals (studio_id);

create or replace function public.create_studio(p_name text)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_me uuid := auth.uid(); v_id uuid;
begin
  if v_me is null then raise exception 'create_studio: must be called as an authenticated user' using errcode = '42501'; end if;
  insert into public.studios (name, created_by) values (p_name, v_me) returning id into v_id;
  insert into public.studio_members (studio_id, member_id, role) values (v_id, v_me, 'owner');
  return v_id;
end;
$$;

revoke all on function public.create_studio(text) from public;
grant execute on function public.create_studio(text) to authenticated;

create or replace function public.add_studio_member(p_studio uuid, p_member uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if not public.is_studio_owner(p_studio, auth.uid()) then
    raise exception 'add_studio_member: must be a studio owner' using errcode = '42501';
  end if;
  if public.is_blocked(auth.uid(), p_member) then
    raise exception 'add_studio_member: blocked';
  end if;
  insert into public.studio_members (studio_id, member_id, role) values (p_studio, p_member, 'member') on conflict do nothing;
end;
$$;

revoke all on function public.add_studio_member(uuid, uuid) from public;
grant execute on function public.add_studio_member(uuid, uuid) to authenticated;

create or replace function public.remove_studio_member(p_studio uuid, p_member uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  -- An owner can remove anyone (including another owner); a member can always remove themself.
  if not (public.is_studio_owner(p_studio, auth.uid()) or p_member = auth.uid()) then
    raise exception 'remove_studio_member: not permitted' using errcode = '42501';
  end if;
  delete from public.studio_members where studio_id = p_studio and member_id = p_member;
end;
$$;

revoke all on function public.remove_studio_member(uuid, uuid) from public;
grant execute on function public.remove_studio_member(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Invite links + QR (5b). A QR code is just the client rendering praelude://invite/{code} as an
-- image - no backend concern beyond issuing and redeeming the code.
-- ---------------------------------------------------------------------------

create table public.invite_codes (
  code text primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  use_count int not null default 0
);

alter table public.invite_codes enable row level security;
create policy invite_codes_select_own on public.invite_codes for select to authenticated using (owner_id = auth.uid());

create or replace function public.create_invite_code()
returns text
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_me uuid := auth.uid(); v_code text;
begin
  if v_me is null then raise exception 'create_invite_code: must be called as an authenticated user' using errcode = '42501'; end if;
  -- 12 lowercase hex characters, sliced off a core gen_random_uuid() (128 random bits, 32 hex chars)
  -- rather than pgcrypto's gen_random_bytes - this project deliberately has no pgcrypto dependency
  -- (see 20260926220001_extensions_and_helpers.sql). Collision odds are negligible at this app's
  -- scale, and the primary key catches the rest.
  v_code := substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  insert into public.invite_codes (code, owner_id) values (v_code, v_me);
  return v_code;
end;
$$;

revoke all on function public.create_invite_code() from public;
grant execute on function public.create_invite_code() to authenticated;

create or replace function public.redeem_invite_code(p_code text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_me uuid := auth.uid(); v_invite public.invite_codes;
begin
  if v_me is null then raise exception 'redeem_invite_code: must be called as an authenticated user' using errcode = '42501'; end if;

  select * into v_invite from public.invite_codes where code = p_code for update;
  if not found or v_invite.expires_at < now() then
    raise exception 'redeem_invite_code: invalid or expired code' using errcode = '42501';
  end if;
  if v_invite.owner_id = v_me then
    raise exception 'redeem_invite_code: cannot redeem your own code';
  end if;
  if public.is_blocked(v_me, v_invite.owner_id) then
    raise exception 'redeem_invite_code: blocked' using errcode = '42501';
  end if;

  -- An invite link implies mutual consent, so it goes straight to accepted rather than pending.
  insert into public.friendships (requester_id, addressee_id, status, responded_at)
    values (v_invite.owner_id, v_me, 'accepted', now())
    on conflict (requester_id, addressee_id) do update set status = 'accepted', updated_at = now(), responded_at = now();

  update public.invite_codes set use_count = use_count + 1 where code = p_code;

  return jsonb_build_object('friend_id', v_invite.owner_id);
end;
$$;

revoke all on function public.redeem_invite_code(text) from public;
grant execute on function public.redeem_invite_code(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Opt-in contacts suggestions (5b). Both sides opt in explicitly: a user only appears as a
-- suggestion to someone else once they've written a hash identifying themself into
-- discoverable_contact_hashes, and only sees suggestions themself once they've uploaded hashes of
-- their own phone contacts. The client must hash phone numbers/emails itself (SHA-256, lowercased/
-- E.164-normalized before hashing) - the raw contact never reaches the server either way. This is a
-- plain hash join, not a private-set-intersection protocol; supabase/(C) Backend.md documents that
-- as a known, acceptable-for-v1 limitation (a phone number's hash is brute-forceable from a small
-- search space), not an oversight.
-- ---------------------------------------------------------------------------

create table public.discoverable_contact_hashes (
  owner_id uuid not null references auth.users (id) on delete cascade,
  hash text not null,
  hash_kind text not null check (hash_kind in ('phone', 'email')),
  created_at timestamptz not null default now(),
  primary key (owner_id, hash)
);

create table public.uploaded_contact_hashes (
  owner_id uuid not null references auth.users (id) on delete cascade,
  hash text not null,
  hash_kind text not null check (hash_kind in ('phone', 'email')),
  created_at timestamptz not null default now(),
  primary key (owner_id, hash)
);

-- Hand-written RLS rather than _setup_owner_table/_setup_append_only_table: both procedures assume
-- the shape every other table in this schema has (a single-column "id" or "owner_id" primary key,
-- an updated_at column to attach their trigger to). These two are a plain owner+hash junction with a
-- composite primary key and no updated_at at all - forcing them through either procedure would
-- attach an update trigger that errors the moment it fires (no updated_at field to write) and would
-- register a meaningless conflict_column with the generic sync engine, which they have no business
-- being part of (a hash hand-uploaded once has no "last write wins" merge story). insert/delete only:
-- there is no legitimate "update a hash" operation.
alter table public.discoverable_contact_hashes enable row level security;
create policy discoverable_contact_hashes_select_own on public.discoverable_contact_hashes
  for select to authenticated using (owner_id = auth.uid());
create policy discoverable_contact_hashes_insert_own on public.discoverable_contact_hashes
  for insert to authenticated with check (owner_id = auth.uid());
create policy discoverable_contact_hashes_delete_own on public.discoverable_contact_hashes
  for delete to authenticated using (owner_id = auth.uid());

alter table public.uploaded_contact_hashes enable row level security;
create policy uploaded_contact_hashes_select_own on public.uploaded_contact_hashes
  for select to authenticated using (owner_id = auth.uid());
create policy uploaded_contact_hashes_insert_own on public.uploaded_contact_hashes
  for insert to authenticated with check (owner_id = auth.uid());
create policy uploaded_contact_hashes_delete_own on public.uploaded_contact_hashes
  for delete to authenticated using (owner_id = auth.uid());

create or replace function public.contact_suggestions()
returns jsonb
language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(distinct jsonb_build_object('id', p.id, 'username', p.username, 'display_name', p.display_name)), '[]'::jsonb)
  from public.uploaded_contact_hashes u
  join public.discoverable_contact_hashes d on d.hash = u.hash and d.hash_kind = u.hash_kind
  join public.profiles p on p.id = d.owner_id
  where u.owner_id = auth.uid()
    and d.owner_id <> auth.uid()
    and not public.is_blocked(auth.uid(), d.owner_id)
    and not public.is_friend(auth.uid(), d.owner_id);
$$;

revoke all on function public.contact_suggestions() from public;
grant execute on function public.contact_suggestions() to authenticated;
