-- Praelude backend tests: proves delete_my_account() removes every row it owns and only what it owns
-- (spec 4b). Storage objects are the client's responsibility to remove via the Storage API first (see
-- supabase/migrations/20260926220017_fix_delete_my_account_storage.sql for why: the platform blocks a
-- direct DB-level delete of storage.objects outright) - the first part below proves the function
-- refuses to run rather than silently orphaning them if the client gets that order wrong; that part
-- rolls back, same as 01-03. The second part is the one genuinely destructive test in this suite - it
-- COMMITs. Requires a THIRD throwaway user, __USER_C_ID__ (see supabase/tests/run.sh), which must
-- never be the same account as __USER_A_ID__ or __USER_B_ID__: that account is gone for real once this
-- file runs. __USER_A_ID__ is also used (as a friend of C, and standing in for "storage objects exist"
-- in the first part) to confirm deletion never touches a *different* user's own data.

-- ---------------------------------------------------------------------------
-- Part 1 (rolled back): delete_my_account refuses to run while storage objects remain, with a named
-- error - not the platform's confusing "Direct deletion... not allowed", and not a silent no-op that
-- would leave an orphaned row-less-but-still-billed object behind.
-- ---------------------------------------------------------------------------
begin;
set local role = 'authenticated';
set local request.jwt.claims = '{"sub":"__USER_A_ID__","role":"authenticated"}';

insert into storage.objects (bucket_id, name) values ('scores', '__USER_A_ID__/leftover.pdf');

do $$
begin
  perform public.delete_my_account();
  raise exception 'FAIL 04.1: delete_my_account succeeded despite a leftover storage object';
exception
  when sqlstate '55000' then null; -- expected
end $$;

rollback;

-- ---------------------------------------------------------------------------
-- Part 2 (COMMITs): the real, complete-deletion proof. One representative row per major category -
-- owned library data with a child FK row and a bytea column, and a note - plus a friendship with A (a
-- real, otherwise-untouched user) so 04.6/04.7 below can also confirm the friendship row disappears
-- without touching A's own account.
-- ---------------------------------------------------------------------------
begin;
set local role = 'authenticated';
set local request.jwt.claims = '{"sub":"__USER_C_ID__","role":"authenticated"}';

select public.sync_upsert('pieces', jsonb_build_object(
  'id', '00000000-0000-4000-8000-00000000c001',
  'title', 'C''s piece, about to be deleted', 'composer', '', 'page_count', 1, 'last_page', 1,
  'status', 'active', 'notes', '', 'tag_ids', '[]'::jsonb, 'folder_ids', '[]'::jsonb,
  'performance_dates', '[]'::jsonb, 'created_at', now(), 'updated_at', now(), 'last_page_updated_at', now()
));
select public.sync_upsert('ink_strokes', jsonb_build_object(
  'id', '00000000-0000-4000-8000-00000000c002', 'piece_id', '00000000-0000-4000-8000-00000000c001',
  'page', 1, 'layer', 'mine', 'data', to_jsonb('\x0a0b0c'::bytea), 'created_at', now(), 'updated_at', now()
));
insert into public.notes (id, owner_id, text) values
  ('00000000-0000-4000-8000-00000000c003', '__USER_C_ID__', 'A note C will lose on account deletion');

set local request.jwt.claims = '{"sub":"__USER_A_ID__","role":"authenticated"}';
select public.send_friend_request('__USER_C_ID__');
set local request.jwt.claims = '{"sub":"__USER_C_ID__","role":"authenticated"}';
select public.respond_friend_request('__USER_A_ID__', true);

select public.delete_my_account();

commit;

-- Verified as the default (superuser/bypass-RLS) role, restored the instant the transaction above
-- committed (SET LOCAL never outlives its transaction) - so this sees the true state of every table,
-- not whatever RLS would filter for some impersonated viewer.
do $$
declare v_n int;
begin
  select count(*) into v_n from auth.users where id = '__USER_C_ID__';
  if v_n <> 0 then raise exception 'FAIL 04.2: auth.users row for C still exists after delete_my_account'; end if;

  select count(*) into v_n from public.profiles where id = '__USER_C_ID__';
  if v_n <> 0 then raise exception 'FAIL 04.3: profiles row for C still exists'; end if;

  select count(*) into v_n from public.pieces where owner_id = '__USER_C_ID__';
  if v_n <> 0 then raise exception 'FAIL 04.4: C still owns pieces rows'; end if;

  select count(*) into v_n from public.ink_strokes where owner_id = '__USER_C_ID__';
  if v_n <> 0 then raise exception 'FAIL 04.5: C still owns ink_strokes rows'; end if;

  select count(*) into v_n from public.notes where owner_id = '__USER_C_ID__';
  if v_n <> 0 then raise exception 'FAIL 04.6: C still owns notes rows'; end if;

  select count(*) into v_n from public.friendships where requester_id = '__USER_C_ID__' or addressee_id = '__USER_C_ID__';
  if v_n <> 0 then raise exception 'FAIL 04.7: a friendship row involving C still exists'; end if;

  -- A (a different, real, still-existing user who was friends with C) must be completely untouched -
  -- deleting one account must never take another user's own data down with it. (Part 1's leftover
  -- storage object doesn't need checking here - that whole transaction rolled back, so it was never
  -- actually persisted in the first place.)
  select count(*) into v_n from public.profiles where id = '__USER_A_ID__';
  if v_n <> 1 then raise exception 'FAIL 04.8: deleting C''s account affected friend A''s profile too'; end if;
end $$;

select 'PASS 04: delete_my_account refuses to run with leftover storage, and otherwise removes every row it owns and only what it owns' as result;
