-- Praelude backend tests: the two 20260926220019/20260926220021 fixes -
--   (a) note-adjacent visibility (note_replies/reactions/comments/note-media, all sharing
--       _can_view_social_target) now honors privacy_notes the same way friend_notes() already did;
--   (b) the presence Realtime-authorization helpers (can_receive_presence/_presence_topic_owner) and
--       friend_presence_piece_title() enforce the same friendship/block/privacy_presence/
--       privacy_currently_working_on gates the table-fallback path (friend_presence()) already used.
--
-- Requires two throwaway users already created via the public signup path - see run.sh's own header.
-- __USER_A_ID__ / __USER_B_ID__ are replaced with real uuids by run.sh before this file is sent. A
-- third identity, a fixed uuid that was never signed up, stands in for "a total stranger" wherever a
-- test only needs a comparison value, not a real auth.users row (matching 03's own convention).
--
-- Discipline (matching 01-04): `set local request.jwt.claims` is issued immediately before every
-- single statement whose result depends on a specific impersonated caller, never left to carry over
-- from a previous `do $$ ... $$` block (its effect *does* persist past the block's own end, since a
-- `do` block is not a sub-transaction - relying on that here would make this file fragile to reorder
-- and easy to silently break by adding a step in the middle, exactly the kind of mistake a security
-- test must not have).
--
-- Everything runs inside one transaction and is rolled back: re-runnable indefinitely, never leaves
-- data behind, and never actually touches realtime.messages (a partitioned table with no partition
-- for "now" on this project as of this writing - see 5.4's own note) or the live Realtime socket
-- path, which is integration surface no SQL test can reach; the two helper functions the new
-- policies are built from are exactly what this file proves, plus the policies' own text (5.4).

begin;

set local role = 'authenticated';

-- ---------------------------------------------------------------------------
-- 5.0 setup: A and B become friends (does not persist from 03 - each test file is its own rolled-
-- back transaction), with default privacy (privacy_notes/privacy_presence/privacy_currently_working_on
-- all 'friends', profiles.is_private_account false).
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"__USER_B_ID__","role":"authenticated"}';
select public.send_friend_request('__USER_A_ID__');
set local request.jwt.claims = '{"sub":"__USER_A_ID__","role":"authenticated"}';
select public.respond_friend_request('__USER_B_ID__', true);

-- ---------------------------------------------------------------------------
-- 5.1: privacy_notes = 'onlyMe' - a note owner can still see/reply to their own note, but a friend
-- can no longer reply (note_replies_visible's trigger, via the fixed _can_view_social_target), even
-- though the same friend could reply before this profile setting was applied. Regression check
-- alongside: friend_notes() itself (already correct pre-fix) still hides it too.
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"__USER_A_ID__","role":"authenticated"}';
update public.profiles set privacy_notes = 'onlyMe' where id = '__USER_A_ID__';
insert into public.notes (id, owner_id, text, created_at) values
  ('00000000-0000-4000-8000-0000000005a1', '__USER_A_ID__', 'For my eyes only, even from friends', now());

do $$
declare
  v_notes jsonb;
  v_n int;
begin
  set local request.jwt.claims = '{"sub":"__USER_B_ID__","role":"authenticated"}';

  -- 5.1a: friend_notes() (unaffected by this fix - already correct) still hides an onlyMe note.
  v_notes := public.friend_notes();
  if exists (select 1 from jsonb_array_elements(v_notes) e where e ->> 'id' = '00000000-0000-4000-8000-0000000005a1') then
    raise exception 'FAIL 05.1a: an onlyMe-privacy note leaked through friend_notes() to a friend (got %)', v_notes;
  end if;

  -- 5.1b: the actual fix - a friend can no longer reply. note_replies_visible raises 42501.
  begin
    insert into public.note_replies (id, note_id, owner_id, body)
      values ('00000000-0000-4000-8000-0000000005a2', '00000000-0000-4000-8000-0000000005a1', '__USER_B_ID__', 'Should never land');
    raise exception 'FAIL 05.1b: a friend replied to an onlyMe-privacy note - _can_view_social_target did not honor privacy_notes';
  exception
    when sqlstate '42501' then null; -- expected: note_replies_visible trigger raised "note is not visible to the caller"
  end;
  select count(*) into v_n from public.note_replies where id = '00000000-0000-4000-8000-0000000005a2';
  if v_n <> 0 then raise exception 'FAIL 05.1c: the rejected reply was inserted anyway'; end if;
end $$;

-- 5.1d: the owner replying to their own onlyMe note is unaffected (owner_id = auth.uid() branch).
set local request.jwt.claims = '{"sub":"__USER_A_ID__","role":"authenticated"}';
insert into public.note_replies (id, note_id, owner_id, body)
  values ('00000000-0000-4000-8000-0000000005a3', '00000000-0000-4000-8000-0000000005a1', '__USER_A_ID__', 'Note to self');
do $$
declare v_n int;
begin
  select count(*) into v_n from public.note_replies where id = '00000000-0000-4000-8000-0000000005a3';
  if v_n <> 1 then raise exception 'FAIL 05.1d: the note owner could not reply to their own onlyMe note'; end if;
end $$;

-- Restore the default before the next section reuses A/B as ordinary friends.
set local request.jwt.claims = '{"sub":"__USER_A_ID__","role":"authenticated"}';
update public.profiles set privacy_notes = 'friends' where id = '__USER_A_ID__';

-- ---------------------------------------------------------------------------
-- 5.2: can_receive_presence(owner) - self, an accepted friend (default privacy_presence='friends'),
-- a friend after privacy_presence is tightened to 'onlyMe', a blocked friend, and a total stranger.
-- This is the exact predicate presence_topic_select_own_or_friend's USING clause calls with
-- _presence_topic_owner() in place of a literal id - see 5.4 for that composition proven directly.
-- ---------------------------------------------------------------------------

do $$
begin
  -- 5.2a: the owner can always receive their own presence.
  set local request.jwt.claims = '{"sub":"__USER_A_ID__","role":"authenticated"}';
  if not public.can_receive_presence('__USER_A_ID__') then
    raise exception 'FAIL 05.2a: the owner could not receive their own presence';
  end if;

  -- 5.2b: an accepted, non-blocked friend, default privacy_presence, can receive it.
  set local request.jwt.claims = '{"sub":"__USER_B_ID__","role":"authenticated"}';
  if not public.can_receive_presence('__USER_A_ID__') then
    raise exception 'FAIL 05.2b: a friend with default privacy_presence could not receive presence';
  end if;

  -- 5.2c: a total stranger cannot, regardless of privacy_presence.
  set local request.jwt.claims = '{"sub":"ffffffff-ffff-4fff-8fff-ffffffffffff","role":"authenticated"}';
  if public.can_receive_presence('__USER_A_ID__') then
    raise exception 'FAIL 05.2c: a non-friend stranger could receive presence';
  end if;
end $$;

set local request.jwt.claims = '{"sub":"__USER_A_ID__","role":"authenticated"}';
update public.profiles set privacy_presence = 'onlyMe' where id = '__USER_A_ID__';

do $$
begin
  -- 5.2d: tightening privacy_presence to onlyMe now hides it even from an accepted friend.
  set local request.jwt.claims = '{"sub":"__USER_B_ID__","role":"authenticated"}';
  if public.can_receive_presence('__USER_A_ID__') then
    raise exception 'FAIL 05.2d: privacy_presence=onlyMe did not hide presence from a friend';
  end if;
end $$;

set local request.jwt.claims = '{"sub":"__USER_A_ID__","role":"authenticated"}';
update public.profiles set privacy_presence = 'friends' where id = '__USER_A_ID__';

do $$
begin
  -- 5.2e/f: a block hides presence in both directions, even with friendly privacy_presence.
  -- block_user always blocks (auth.uid() -> p_target), so this runs as B blocking A.
  set local request.jwt.claims = '{"sub":"__USER_B_ID__","role":"authenticated"}';
  perform public.block_user('__USER_A_ID__');
  if public.can_receive_presence('__USER_A_ID__') then
    raise exception 'FAIL 05.2e: B could still receive A''s presence after B blocked A';
  end if;

  set local request.jwt.claims = '{"sub":"__USER_A_ID__","role":"authenticated"}';
  if public.can_receive_presence('__USER_B_ID__') then
    raise exception 'FAIL 05.2f: A could still receive B''s presence after B blocked A (blocks are symmetric for visibility)';
  end if;

  -- Only the blocker can unblock (asymmetric - see supabase/(C) Backend.md's own note).
  set local request.jwt.claims = '{"sub":"__USER_B_ID__","role":"authenticated"}';
  perform public.unblock_user('__USER_A_ID__');
end $$;

-- block_user (verified above) also deletes the friendship outright (not just hides it) - unblocking
-- does not restore it. Re-friend A and B so 5.3 below can reuse them as ordinary friends.
set local request.jwt.claims = '{"sub":"__USER_B_ID__","role":"authenticated"}';
select public.send_friend_request('__USER_A_ID__');
set local request.jwt.claims = '{"sub":"__USER_A_ID__","role":"authenticated"}';
select public.respond_friend_request('__USER_B_ID__', true);

-- ---------------------------------------------------------------------------
-- 5.3: friend_presence_piece_title() - needs BOTH can_receive_presence AND privacy_currently_working_on
-- to clear, checks true piece ownership (not just any piece id), and never errors on a denied
-- lookup - always a quiet null a client can fall back to a generic label for.
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"__USER_A_ID__","role":"authenticated"}';
insert into public.pieces (id, owner_id, title) values ('00000000-0000-4000-8000-0000000005b1', '__USER_A_ID__', 'Chopin Ballade No. 1');
set local request.jwt.claims = '{"sub":"__USER_B_ID__","role":"authenticated"}';
insert into public.pieces (id, owner_id, title) values ('00000000-0000-4000-8000-0000000005b2', '__USER_B_ID__', 'Debussy Clair de Lune');

do $$
declare v_title text;
begin
  set local request.jwt.claims = '{"sub":"__USER_B_ID__","role":"authenticated"}';

  -- 5.3a: default privacy (both privacy_presence and privacy_currently_working_on are 'friends') -
  -- a friend resolves the real title.
  v_title := public.friend_presence_piece_title('__USER_A_ID__', '00000000-0000-4000-8000-0000000005b1');
  if v_title is distinct from 'Chopin Ballade No. 1' then
    raise exception 'FAIL 05.3a: a friend with default privacy could not resolve the piece title (got %)', v_title;
  end if;

  -- 5.3b: a piece id that does not actually belong to the claimed owner never resolves, even to that
  -- owner's own real title under a different id, and even though B can see *some* piece with that id
  -- belongs to B - this must never cross-wire two different people's libraries.
  v_title := public.friend_presence_piece_title('__USER_A_ID__', '00000000-0000-4000-8000-0000000005b2');
  if v_title is not null then
    raise exception 'FAIL 05.3b: resolved a title for a piece id that does not belong to the claimed owner (got %)', v_title;
  end if;
end $$;

set local request.jwt.claims = '{"sub":"__USER_A_ID__","role":"authenticated"}';
update public.profiles set privacy_currently_working_on = 'onlyMe' where id = '__USER_A_ID__';

do $$
declare v_title text;
begin
  set local request.jwt.claims = '{"sub":"__USER_B_ID__","role":"authenticated"}';
  -- 5.3c: presence itself is still visible (privacy_presence untouched), but the title is not -
  -- exactly the "expose the title only when pieces privacy allows" requirement, as its own gate
  -- independent of whether the friend can see that practicing is happening at all.
  if not public.can_receive_presence('__USER_A_ID__') then
    raise exception 'FAIL 05.3c-setup: presence should still be visible with only privacy_currently_working_on tightened';
  end if;
  v_title := public.friend_presence_piece_title('__USER_A_ID__', '00000000-0000-4000-8000-0000000005b1');
  if v_title is not null then
    raise exception 'FAIL 05.3c: a title resolved despite privacy_currently_working_on=onlyMe (got %)', v_title;
  end if;
end $$;

set local request.jwt.claims = '{"sub":"__USER_A_ID__","role":"authenticated"}';
update public.profiles set privacy_currently_working_on = 'friends' where id = '__USER_A_ID__';

-- ---------------------------------------------------------------------------
-- 5.4: the realtime.messages policies exist, are attached to the right command, and their text is
-- exactly the composition of the two helpers 5.2/5.3 already proved correct in isolation - so proving
-- those two functions is proving the policies too, without needing a row in realtime.messages (this
-- project currently has zero partitions for it - RANGE (inserted_at) with no child partition yet
-- exists - so a literal INSERT/SELECT against it is an unrelated infrastructure concern this test
-- does not depend on). This part needs no particular impersonated role (pg_policy is catalog metadata).
-- ---------------------------------------------------------------------------

do $$
declare
  v_select_using text;
  v_insert_check text;
begin
  select pg_get_expr(polqual, polrelid) into v_select_using
    from pg_policy where polrelid = 'realtime.messages'::regclass and polname = 'presence_topic_select_own_or_friend';
  select pg_get_expr(polwithcheck, polrelid) into v_insert_check
    from pg_policy where polrelid = 'realtime.messages'::regclass and polname = 'presence_topic_insert_own';

  if v_select_using is null or v_select_using !~ 'can_receive_presence' or v_select_using !~ '_presence_topic_owner' then
    raise exception 'FAIL 05.4a: presence_topic_select_own_or_friend is missing or does not call can_receive_presence/_presence_topic_owner (got %)', v_select_using;
  end if;
  if v_insert_check is null or v_insert_check !~ '_presence_topic_owner' or v_insert_check !~ 'auth\.uid' then
    raise exception 'FAIL 05.4b: presence_topic_insert_own is missing or does not restrict to the topic''s own owner (got %)', v_insert_check;
  end if;
end $$;

-- 5.4c/d/e: _presence_topic_owner() parses the app's one topic convention correctly and fails closed
-- (null, never an error) on anything else - this plus 5.2 together are the full authorization
-- decision Realtime evaluates for a real subscribe/track attempt (see 20260926220021's own header for
-- what is, and is not, independently re-verified about Realtime's own internal check mechanism).
do $$
begin
  perform set_config('realtime.topic', 'presence:' || '__USER_A_ID__', true);
  if public._presence_topic_owner() is distinct from '__USER_A_ID__'::uuid then
    raise exception 'FAIL 05.4c: _presence_topic_owner() did not parse "presence:<uuid>" correctly';
  end if;

  perform set_config('realtime.topic', 'some-other-channel:not-presence', true);
  if public._presence_topic_owner() is not null then
    raise exception 'FAIL 05.4d: _presence_topic_owner() returned non-null for a non-presence topic';
  end if;

  perform set_config('realtime.topic', '', true);
  if public._presence_topic_owner() is not null then
    raise exception 'FAIL 05.4e: _presence_topic_owner() returned non-null with no topic set at all';
  end if;
end $$;

rollback;

select 'PASS 05: privacy_notes honored by _can_view_social_target (note_replies + friends), presence Realtime authorization (can_receive_presence, _presence_topic_owner, the two realtime.messages policies), and friend_presence_piece_title (both privacy gates, real-ownership check) all hold' as result;
