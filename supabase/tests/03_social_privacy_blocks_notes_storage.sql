-- Praelude backend tests: profile privacy redaction, friend requests, blocks, avatar visibility,
-- leaderboard opt-out, notes 24h expiry + private replies, and storage.objects bucket policies.
--
-- Requires two throwaway users already created via the public signup path - see supabase/tests/run.sh.
-- __USER_A_ID__ / __USER_B_ID__ are replaced with real uuids by run.sh before this file is sent. A
-- third identity, a fixed uuid that was never signed up, stands in for "a total stranger" wherever a
-- test only needs a SELECT-shaped check (RLS/these functions compare uuids; they never require the
-- comparison value to be a real auth.users row for a read). Everything runs inside one transaction and
-- is rolled back: re-runnable indefinitely against the same two users, never leaves data behind.

begin;

set local role = 'authenticated';

-- ---------------------------------------------------------------------------
-- 3.1-3.4: profile privacy tiers (public/friends/onlyMe), the private-account clamp on public-tier
-- fields, and get_profile_card/can_view_avatar as the one read path for another user's profile.
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"__USER_A_ID__","role":"authenticated"}';

update public.profiles set
  teacher_or_school = 'Juilliard Prep', privacy_teacher_or_school = 'public',
  location = 'New York, NY', privacy_location = 'onlyMe',
  bio = 'Cellist, mostly Bach these days.' -- privacy_bio stays at its default, 'friends'
where id = '__USER_A_ID__';

do $$
declare
  v_card jsonb;
begin
  -- 3.1: a total stranger (never friended, account still public) sees the public-tier field, not the
  -- onlyMe or friends-tier ones.
  set local request.jwt.claims = '{"sub":"ffffffff-ffff-4fff-8fff-ffffffffffff","role":"authenticated"}';
  v_card := public.get_profile_card('__USER_A_ID__');
  if v_card ->> 'teacher_or_school' is distinct from 'Juilliard Prep' then
    raise exception 'FAIL 03.1a: public-tier field not visible to a stranger on a public account (got %)', v_card;
  end if;
  if v_card ? 'location' then
    raise exception 'FAIL 03.1b: onlyMe-tier field leaked to a stranger (got %)', v_card;
  end if;
  if v_card ? 'bio' then
    raise exception 'FAIL 03.1c: friends-tier field leaked to a non-friend stranger (got %)', v_card;
  end if;
  if (v_card ->> 'is_friend')::boolean is distinct from false then
    raise exception 'FAIL 03.1d: is_friend should be false for a stranger';
  end if;
end $$;

-- 3.2: friend request -> accept -> friends-tier field becomes visible, onlyMe still is not.
set local request.jwt.claims = '{"sub":"__USER_B_ID__","role":"authenticated"}';
select public.send_friend_request('__USER_A_ID__');
set local request.jwt.claims = '{"sub":"__USER_A_ID__","role":"authenticated"}';
select public.respond_friend_request('__USER_B_ID__', true);

do $$
declare
  v_card jsonb;
  v_status public.friendship_status;
begin
  set local request.jwt.claims = '{"sub":"__USER_B_ID__","role":"authenticated"}';
  -- is_friend/is_blocked are intentionally not directly callable (see
  -- 20260926220018_revert_unneeded_friend_block_grants.sql) - every real call site is from inside
  -- another SECURITY DEFINER function, so tests check the same state through what a client actually
  -- can read: the friendships table's own self-scoped SELECT policy.
  select status into v_status from public.friendships
    where (requester_id = '__USER_A_ID__' and addressee_id = '__USER_B_ID__')
       or (requester_id = '__USER_B_ID__' and addressee_id = '__USER_A_ID__');
  if v_status is distinct from 'accepted' then
    raise exception 'FAIL 03.2a: friendship status is % after an accepted request, expected accepted', v_status;
  end if;
  v_card := public.get_profile_card('__USER_A_ID__');
  if v_card ->> 'bio' is distinct from 'Cellist, mostly Bach these days.' then
    raise exception 'FAIL 03.2b: friends-tier field not visible to an accepted friend (got %)', v_card;
  end if;
  if v_card ? 'location' then
    raise exception 'FAIL 03.2c: onlyMe-tier field leaked even to a friend (got %)', v_card;
  end if;
  if (v_card ->> 'is_friend')::boolean is distinct from true then
    raise exception 'FAIL 03.2d: is_friend should be true after acceptance';
  end if;
end $$;

-- 3.3: can_view_avatar mirrors the same photo-privacy logic (default privacy_photo = 'public').
do $$
begin
  set local request.jwt.claims = '{"sub":"__USER_B_ID__","role":"authenticated"}';
  if not public.can_view_avatar('__USER_A_ID__') then
    raise exception 'FAIL 03.3: a friend should see a public-photo-privacy avatar';
  end if;
end $$;

-- 3.4: a *private* account clamps its public-tier fields to friends-only - a friend still sees them,
-- a stranger no longer does (even though privacy_teacher_or_school itself is still nominally 'public').
set local request.jwt.claims = '{"sub":"__USER_A_ID__","role":"authenticated"}';
update public.profiles set is_private_account = true where id = '__USER_A_ID__';

do $$
declare v_card jsonb;
begin
  set local request.jwt.claims = '{"sub":"__USER_B_ID__","role":"authenticated"}';
  v_card := public.get_profile_card('__USER_A_ID__');
  if v_card ->> 'teacher_or_school' is distinct from 'Juilliard Prep' then
    raise exception 'FAIL 03.4a: a private account should still show public-tier fields to a friend (got %)', v_card;
  end if;

  set local request.jwt.claims = '{"sub":"ffffffff-ffff-4fff-8fff-ffffffffffff","role":"authenticated"}';
  v_card := public.get_profile_card('__USER_A_ID__');
  if v_card ? 'teacher_or_school' then
    raise exception 'FAIL 03.4b: a private account leaked a public-tier field to a stranger (got %)', v_card;
  end if;
  if public.can_view_avatar('__USER_A_ID__') then
    raise exception 'FAIL 03.4c: a stranger should not see a private account''s avatar';
  end if;
end $$;

set local request.jwt.claims = '{"sub":"__USER_A_ID__","role":"authenticated"}';
update public.profiles set is_private_account = false where id = '__USER_A_ID__';

-- ---------------------------------------------------------------------------
-- 3.5: blocking severs the friendship and hides the profile/avatar entirely (get_profile_card returns
-- null outright, not a redacted card), symmetrically for both directions.
-- ---------------------------------------------------------------------------
select public.block_user('__USER_B_ID__');

do $$
declare v_n int;
begin
  select count(*) into v_n from public.friendships
    where (requester_id = '__USER_A_ID__' and addressee_id = '__USER_B_ID__')
       or (requester_id = '__USER_B_ID__' and addressee_id = '__USER_A_ID__');
  if v_n <> 0 then
    raise exception 'FAIL 03.5a: blocking should have deleted the friendship (% row(s) remain)', v_n;
  end if;

  set local request.jwt.claims = '{"sub":"__USER_B_ID__","role":"authenticated"}';
  if public.get_profile_card('__USER_A_ID__') is not null then
    raise exception 'FAIL 03.5b: a blocked viewer should get null from get_profile_card, not a redacted card';
  end if;
  if public.can_view_avatar('__USER_A_ID__') then
    raise exception 'FAIL 03.5c: a blocked viewer should not see the avatar';
  end if;
end $$;

set local request.jwt.claims = '{"sub":"__USER_A_ID__","role":"authenticated"}';
select public.unblock_user('__USER_B_ID__');

-- ---------------------------------------------------------------------------
-- 3.6: friends-only weekly leaderboard honors leaderboard_opt_out (re-friend after the unblock first).
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"__USER_B_ID__","role":"authenticated"}';
select public.send_friend_request('__USER_A_ID__');
set local request.jwt.claims = '{"sub":"__USER_A_ID__","role":"authenticated"}';
select public.respond_friend_request('__USER_B_ID__', true);

set local request.jwt.claims = '{"sub":"__USER_B_ID__","role":"authenticated"}';
select public.sync_upsert('pieces', jsonb_build_object(
  'id', '00000000-0000-4000-8000-00000000b001',
  'title', 'B''s piece', 'composer', '', 'page_count', 1, 'last_page', 1, 'status', 'active', 'notes', '',
  'tag_ids', '[]'::jsonb, 'folder_ids', '[]'::jsonb, 'performance_dates', '[]'::jsonb,
  'created_at', now(), 'updated_at', now(), 'last_page_updated_at', now()
));
select public.sync_upsert('sets', jsonb_build_object(
  'id', '00000000-0000-4000-8000-00000000b002',
  'piece_id', '00000000-0000-4000-8000-00000000b001',
  'focus', 'Pulse', 'goal', 'tempo', 'basis', 'cleanStreak', 'target_count', 5,
  'start_bpm', 60, 'target_bpm', 60, 'tempo_step', jsonb_build_object('kind', 'fixed', 'amount', 4),
  'stages', '[]'::jsonb, 'hands', 'Both hands', 'use_metronome', false,
  'current_bpm', 60, 'stage_index', 0, 'streak', 0, 'total_plays', 0, 'completed_stages', 0,
  'status', 'completed', 'started_at', now(), 'active_seconds', 600,
  'created_at', now(), 'updated_at', now()
));

do $$
declare
  v_board jsonb;
  v_b_row jsonb;
begin
  set local request.jwt.claims = '{"sub":"__USER_A_ID__","role":"authenticated"}';
  v_board := public.leaderboard_friends('time');
  select e into v_b_row from jsonb_array_elements(v_board) e where e ->> 'owner_id' = '__USER_B_ID__';
  if v_b_row is null then
    raise exception 'FAIL 03.6a: opted-in friend B is missing from A''s leaderboard (got %)', v_board;
  end if;

  set local request.jwt.claims = '{"sub":"__USER_B_ID__","role":"authenticated"}';
  update public.profiles set leaderboard_opt_out = true where id = '__USER_B_ID__';

  set local request.jwt.claims = '{"sub":"__USER_A_ID__","role":"authenticated"}';
  v_board := public.leaderboard_friends('time');
  select e into v_b_row from jsonb_array_elements(v_board) e where e ->> 'owner_id' = '__USER_B_ID__';
  if v_b_row is not null then
    raise exception 'FAIL 03.6b: opted-out friend B still appears on A''s leaderboard (got %)', v_board;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3.7: notes 24h expiry (friend_notes()) and private replies (RLS on note_replies directly - a
-- stranger, using the fixed placeholder uuid, gets zero rows with no function call needed).
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"__USER_A_ID__","role":"authenticated"}';
insert into public.notes (id, owner_id, text, created_at) values
  ('00000000-0000-4000-8000-00000000a010', '__USER_A_ID__', 'Fresh note for a friend to see', now()),
  ('00000000-0000-4000-8000-00000000a011', '__USER_A_ID__', 'Stale note past the 24h window', now() - interval '25 hours');

do $$
declare
  v_notes jsonb;
begin
  set local request.jwt.claims = '{"sub":"__USER_B_ID__","role":"authenticated"}';
  v_notes := public.friend_notes();
  if not exists (select 1 from jsonb_array_elements(v_notes) e where e ->> 'id' = '00000000-0000-4000-8000-00000000a010') then
    raise exception 'FAIL 03.7a: fresh note missing from friend_notes() (got %)', v_notes;
  end if;
  if exists (select 1 from jsonb_array_elements(v_notes) e where e ->> 'id' = '00000000-0000-4000-8000-00000000a011') then
    raise exception 'FAIL 03.7b: a note older than 24h leaked through friend_notes() (got %)', v_notes;
  end if;
end $$;

set local request.jwt.claims = '{"sub":"__USER_B_ID__","role":"authenticated"}';
insert into public.note_replies (id, note_id, owner_id, body) values
  ('00000000-0000-4000-8000-00000000a012', '00000000-0000-4000-8000-00000000a010', '__USER_B_ID__', 'Nice, which recording?');

do $$
declare v_n int;
begin
  -- both participants (note owner A, replier B) can see the reply
  set local request.jwt.claims = '{"sub":"__USER_A_ID__","role":"authenticated"}';
  select count(*) into v_n from public.note_replies where id = '00000000-0000-4000-8000-00000000a012';
  if v_n <> 1 then raise exception 'FAIL 03.7c: note owner A cannot see B''s reply on A''s own note'; end if;

  set local request.jwt.claims = '{"sub":"__USER_B_ID__","role":"authenticated"}';
  select count(*) into v_n from public.note_replies where id = '00000000-0000-4000-8000-00000000a012';
  if v_n <> 1 then raise exception 'FAIL 03.7d: replier B cannot see their own reply'; end if;

  -- a non-participant, even a friend of A who could see the *note* via friend_notes(), sees nothing
  -- of the *reply* - the private-replies guarantee (spec 5a).
  set local request.jwt.claims = '{"sub":"ffffffff-ffff-4fff-8fff-ffffffffffff","role":"authenticated"}';
  select count(*) into v_n from public.note_replies where id = '00000000-0000-4000-8000-00000000a012';
  if v_n <> 0 then raise exception 'FAIL 03.7e: a non-participant could see a private reply'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3.8: storage.objects policies for all four buckets. A real client uploads through the Storage API,
-- not raw SQL - but storage.objects is an ordinary RLS-protected table, and its policies are exactly
-- what the Storage API's own insert/select ultimately evaluates, so inserting a row directly here
-- exercises the identical predicate.
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"__USER_A_ID__","role":"authenticated"}';
insert into storage.objects (bucket_id, name) values
  ('scores', '__USER_A_ID__/piece.pdf'),
  ('avatars', '__USER_A_ID__/avatar.png'),
  ('recordings', '__USER_A_ID__/take1.m4a'),
  ('note-media', '__USER_A_ID__/00000000-0000-4000-8000-00000000a010/photo.jpg');

do $$
declare v_n int;
begin
  -- B: a friend, not blocked, A's account currently public (reset at the end of 3.4).
  set local request.jwt.claims = '{"sub":"__USER_B_ID__","role":"authenticated"}';

  select count(*) into v_n from storage.objects where bucket_id = 'scores' and name = '__USER_A_ID__/piece.pdf';
  if v_n <> 0 then raise exception 'FAIL 03.8a: friend B could read A''s private scores object'; end if;

  select count(*) into v_n from storage.objects where bucket_id = 'recordings' and name = '__USER_A_ID__/take1.m4a';
  if v_n <> 0 then raise exception 'FAIL 03.8b: friend B could read A''s private recordings object'; end if;

  select count(*) into v_n from storage.objects where bucket_id = 'avatars' and name = '__USER_A_ID__/avatar.png';
  if v_n <> 1 then raise exception 'FAIL 03.8c: friend B could not read A''s (public, friend-visible) avatar object'; end if;

  -- B replied to this note, so B is a participant and should see the attached note-media object.
  select count(*) into v_n from storage.objects where bucket_id = 'note-media' and name = '__USER_A_ID__/00000000-0000-4000-8000-00000000a010/photo.jpg';
  if v_n <> 1 then raise exception 'FAIL 03.8d: participant B could not read note-media attached to a note B replied to'; end if;

  -- stranger: public account + public privacy_photo means the avatar is visible to anyone (by
  -- design - see 3.1); everything else must still be invisible.
  set local request.jwt.claims = '{"sub":"ffffffff-ffff-4fff-8fff-ffffffffffff","role":"authenticated"}';

  select count(*) into v_n from storage.objects where bucket_id = 'avatars' and name = '__USER_A_ID__/avatar.png';
  if v_n <> 1 then raise exception 'FAIL 03.8e: a public account''s public-photo-privacy avatar should be visible to a stranger'; end if;

  select count(*) into v_n from storage.objects where bucket_id = 'scores' and name = '__USER_A_ID__/piece.pdf';
  if v_n <> 0 then raise exception 'FAIL 03.8f: a stranger could read A''s private scores object'; end if;

  select count(*) into v_n from storage.objects where bucket_id = 'note-media' and name = '__USER_A_ID__/00000000-0000-4000-8000-00000000a010/photo.jpg';
  if v_n <> 0 then raise exception 'FAIL 03.8g: a non-participant stranger could read note-media for a note they never replied to'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3.9: reports are reporter-visible only (moderation queue itself is service_role-only, see
-- supabase/migrations/20260926220007_moderation_and_leaderboard.sql).
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"__USER_A_ID__","role":"authenticated"}';
select public.submit_report('user', '__USER_B_ID__', 'testing the moderation queue');

do $$
declare v_n int;
begin
  select count(*) into v_n from public.reports where reporter_id = '__USER_A_ID__' and target_id = '__USER_B_ID__';
  if v_n <> 1 then raise exception 'FAIL 03.9a: reporter A cannot see their own filed report'; end if;

  set local request.jwt.claims = '{"sub":"__USER_B_ID__","role":"authenticated"}';
  select count(*) into v_n from public.reports where reporter_id = '__USER_A_ID__' and target_id = '__USER_B_ID__';
  if v_n <> 0 then raise exception 'FAIL 03.9b: the reported user B could see the report filed against them'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3.10: studios are membership-gated; add_studio_member is owner-only.
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"__USER_A_ID__","role":"authenticated"}';

do $$
declare
  v_studio uuid;
  v_n int;
begin
  v_studio := public.create_studio('Test Studio');

  set local request.jwt.claims = '{"sub":"__USER_B_ID__","role":"authenticated"}';
  select count(*) into v_n from public.studios where id = v_studio;
  if v_n <> 0 then raise exception 'FAIL 03.10a: non-member B could see a studio before being added'; end if;

  begin
    perform public.add_studio_member(v_studio, '__USER_B_ID__'); -- B is not the owner
    raise exception 'FAIL 03.10b: non-owner B could add themself to a studio';
  exception
    when sqlstate '42501' then null; -- expected
  end;

  set local request.jwt.claims = '{"sub":"__USER_A_ID__","role":"authenticated"}';
  perform public.add_studio_member(v_studio, '__USER_B_ID__');

  set local request.jwt.claims = '{"sub":"__USER_B_ID__","role":"authenticated"}';
  select count(*) into v_n from public.studios where id = v_studio;
  if v_n <> 1 then raise exception 'FAIL 03.10c: B still cannot see the studio after the owner added them'; end if;
end $$;

rollback;

select 'PASS 03: profile privacy tiers, friends/blocks, leaderboard opt-out, notes expiry + private replies, storage.objects policies, reports and studio membership all hold' as result;
