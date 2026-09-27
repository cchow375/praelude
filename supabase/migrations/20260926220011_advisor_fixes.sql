-- Praelude backend: fixes from `supabase db advisors --type all` run against the hosted project
-- after 20260926220010. See supabase/(C) Backend.md for the full run notes; this migration is the
-- remediation for everything it found that wasn't already by design (the three `rls_enabled_no_policy`
-- infos - append_only_tables/blocked_words/sync_tables - are intentional: nothing but a migration
-- should ever touch them, matching the file header notes where each was created).

-- ---------------------------------------------------------------------------
-- auth_rls_initplan (WARN, 107 findings - effectively every RLS policy in the schema): every policy
-- called auth.uid() directly in its USING/WITH CHECK clause, which Postgres's planner then
-- re-evaluates once per row scanned rather than once per query. Wrapping it as `(select auth.uid())`
-- lets the planner hoist it into an InitPlan (evaluated once). Two migrations back-fix this:
--
-- 1. The two generator procedures (_setup_owner_table/_setup_append_only_table) are corrected in
--    place and made safely re-callable (drop-if-exists before each create; `create or replace
--    trigger`, a PG14+ form, instead of a plain create), so every one of the 27 tables they already
--    configured can just be re-run through the fixed procedure instead of hand-editing ~74 policies.
-- 2. Every hand-written policy (profiles, the social-graph tables, storage.objects) is dropped and
--    recreated below with the same fix. These statements were generated from a `pg_policies` dump of
--    the live, already-applied policies (not retyped from the source migrations by hand) with a
--    single mechanical substitution of `auth.uid()` -> `(select auth.uid())`, specifically to rule
--    out a transcription error across ~50 individually-shaped policies.
-- ---------------------------------------------------------------------------

create or replace procedure public._setup_owner_table(p_table text, p_conflict_column text default 'id')
language plpgsql
as $$
begin
  execute format('alter table %I enable row level security', p_table);

  execute format('drop policy if exists %I on %I', p_table || '_select_own', p_table);
  execute format(
    'create policy %I on %I for select to authenticated using (owner_id = (select auth.uid()))',
    p_table || '_select_own', p_table);

  execute format('drop policy if exists %I on %I', p_table || '_insert_own', p_table);
  execute format(
    'create policy %I on %I for insert to authenticated with check (owner_id = (select auth.uid()))',
    p_table || '_insert_own', p_table);

  execute format('drop policy if exists %I on %I', p_table || '_update_own', p_table);
  execute format(
    'create policy %I on %I for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()))',
    p_table || '_update_own', p_table);

  execute format(
    'create or replace trigger %I before update on %I for each row execute function public.set_updated_at()',
    p_table || '_set_updated_at', p_table);
  insert into public.sync_tables (table_name, conflict_column) values (p_table, p_conflict_column)
    on conflict (table_name) do update set conflict_column = excluded.conflict_column;
end;
$$;

create or replace procedure public._setup_append_only_table(p_table text)
language plpgsql
as $$
begin
  execute format('alter table %I enable row level security', p_table);

  execute format('drop policy if exists %I on %I', p_table || '_select_own', p_table);
  execute format(
    'create policy %I on %I for select to authenticated using (owner_id = (select auth.uid()))',
    p_table || '_select_own', p_table);

  execute format('drop policy if exists %I on %I', p_table || '_insert_own', p_table);
  execute format(
    'create policy %I on %I for insert to authenticated with check (owner_id = (select auth.uid()))',
    p_table || '_insert_own', p_table);

  insert into public.append_only_tables (table_name) values (p_table) on conflict do nothing;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'instruments', 'pieces', 'passages', 'ink_strokes', 'tags', 'folders', 'setlists', 'bookmarks',
    'page_edits', 'score_links', 'annotations', 'warmup_exercises', 'audio_recordings',
    'notebook_entries', 'practice_goals', 'practice_routines', 'practice_sessions', 'sets'
  ]
  loop
    call public._setup_owner_table(t);
  end loop;

  call public._setup_owner_table('rule_settings', 'owner_id');
  call public._setup_owner_table('rewards_state', 'owner_id');

  foreach t in array array[
    'attempts', 'rule_events', 'reward_ledger', 'badges', 'milestone_events', 'cold_grades', 'break_point_taps'
  ]
  loop
    call public._setup_append_only_table(t);
  end loop;
end;
$$;

-- profiles was configured by hand (its id column doubles as owner_id - see 20260926220002_profiles.sql),
-- and the two contact-hash tables (composite PK, no updated_at) explicitly opted out of
-- _setup_owner_table (see 20260926220006_social.sql) - all three, plus every remaining hand-written
-- social/storage policy, are fixed individually below rather than through the procedure.

drop policy if exists "activity_events_insert_own" on public.activity_events;
create policy "activity_events_insert_own" on public.activity_events for insert to authenticated with check ((owner_id = (select auth.uid())));
drop policy if exists "activity_events_select_own" on public.activity_events;
create policy "activity_events_select_own" on public.activity_events for select to authenticated using ((owner_id = (select auth.uid())));
drop policy if exists "blocks_select_own" on public.blocks;
create policy "blocks_select_own" on public.blocks for select to authenticated using ((blocker_id = (select auth.uid())));
drop policy if exists "comments_delete_own" on public.comments;
create policy "comments_delete_own" on public.comments for delete to authenticated using ((owner_id = (select auth.uid())));
drop policy if exists "comments_insert_own" on public.comments;
create policy "comments_insert_own" on public.comments for insert to authenticated with check ((owner_id = (select auth.uid())));
drop policy if exists "comments_select_own" on public.comments;
create policy "comments_select_own" on public.comments for select to authenticated using ((owner_id = (select auth.uid())));
drop policy if exists "comments_update_own" on public.comments;
create policy "comments_update_own" on public.comments for update to authenticated using ((owner_id = (select auth.uid()))) with check ((owner_id = (select auth.uid())));
drop policy if exists "discoverable_contact_hashes_delete_own" on public.discoverable_contact_hashes;
create policy "discoverable_contact_hashes_delete_own" on public.discoverable_contact_hashes for delete to authenticated using ((owner_id = (select auth.uid())));
drop policy if exists "discoverable_contact_hashes_insert_own" on public.discoverable_contact_hashes;
create policy "discoverable_contact_hashes_insert_own" on public.discoverable_contact_hashes for insert to authenticated with check ((owner_id = (select auth.uid())));
drop policy if exists "discoverable_contact_hashes_select_own" on public.discoverable_contact_hashes;
create policy "discoverable_contact_hashes_select_own" on public.discoverable_contact_hashes for select to authenticated using ((owner_id = (select auth.uid())));
drop policy if exists "friendships_select_own" on public.friendships;
create policy "friendships_select_own" on public.friendships for select to authenticated using (((requester_id = (select auth.uid())) OR (addressee_id = (select auth.uid()))));
drop policy if exists "invite_codes_select_own" on public.invite_codes;
create policy "invite_codes_select_own" on public.invite_codes for select to authenticated using ((owner_id = (select auth.uid())));
drop policy if exists "note_replies_insert_own" on public.note_replies;
create policy "note_replies_insert_own" on public.note_replies for insert to authenticated with check ((owner_id = (select auth.uid())));
drop policy if exists "note_replies_select_participant" on public.note_replies;
create policy "note_replies_select_participant" on public.note_replies for select to authenticated using (((owner_id = (select auth.uid())) OR (note_id IN ( SELECT notes.id
   FROM notes
  WHERE (notes.owner_id = (select auth.uid()))))));
drop policy if exists "notes_insert_own" on public.notes;
create policy "notes_insert_own" on public.notes for insert to authenticated with check ((owner_id = (select auth.uid())));
drop policy if exists "notes_select_own" on public.notes;
create policy "notes_select_own" on public.notes for select to authenticated using ((owner_id = (select auth.uid())));
drop policy if exists "notes_update_own" on public.notes;
create policy "notes_update_own" on public.notes for update to authenticated using ((owner_id = (select auth.uid()))) with check ((owner_id = (select auth.uid())));
drop policy if exists "presence_select_own" on public.presence;
create policy "presence_select_own" on public.presence for select to authenticated using ((owner_id = (select auth.uid())));
drop policy if exists "profiles_insert_self" on public.profiles;
create policy "profiles_insert_self" on public.profiles for insert to authenticated with check ((id = (select auth.uid())));
drop policy if exists "profiles_select_self" on public.profiles;
create policy "profiles_select_self" on public.profiles for select to authenticated using ((id = (select auth.uid())));
drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self" on public.profiles for update to authenticated using ((id = (select auth.uid()))) with check ((id = (select auth.uid())));
drop policy if exists "reactions_delete_own" on public.reactions;
create policy "reactions_delete_own" on public.reactions for delete to authenticated using ((owner_id = (select auth.uid())));
drop policy if exists "reactions_insert_own" on public.reactions;
create policy "reactions_insert_own" on public.reactions for insert to authenticated with check ((owner_id = (select auth.uid())));
drop policy if exists "reactions_select_own" on public.reactions;
create policy "reactions_select_own" on public.reactions for select to authenticated using ((owner_id = (select auth.uid())));
drop policy if exists "reports_select_own" on public.reports;
create policy "reports_select_own" on public.reports for select to authenticated using ((reporter_id = (select auth.uid())));
drop policy if exists "studio_goals_insert_member" on public.studio_goals;
create policy "studio_goals_insert_member" on public.studio_goals for insert to authenticated with check ((is_studio_member(studio_id, (select auth.uid())) AND (created_by = (select auth.uid()))));
drop policy if exists "studio_goals_select_member" on public.studio_goals;
create policy "studio_goals_select_member" on public.studio_goals for select to authenticated using (is_studio_member(studio_id, (select auth.uid())));
drop policy if exists "studio_goals_update_member" on public.studio_goals;
create policy "studio_goals_update_member" on public.studio_goals for update to authenticated using (is_studio_member(studio_id, (select auth.uid()))) with check (is_studio_member(studio_id, (select auth.uid())));
drop policy if exists "studio_members_select_member" on public.studio_members;
create policy "studio_members_select_member" on public.studio_members for select to authenticated using (is_studio_member(studio_id, (select auth.uid())));
drop policy if exists "studios_select_member" on public.studios;
create policy "studios_select_member" on public.studios for select to authenticated using (is_studio_member(id, (select auth.uid())));
drop policy if exists "uploaded_contact_hashes_delete_own" on public.uploaded_contact_hashes;
create policy "uploaded_contact_hashes_delete_own" on public.uploaded_contact_hashes for delete to authenticated using ((owner_id = (select auth.uid())));
drop policy if exists "uploaded_contact_hashes_insert_own" on public.uploaded_contact_hashes;
create policy "uploaded_contact_hashes_insert_own" on public.uploaded_contact_hashes for insert to authenticated with check ((owner_id = (select auth.uid())));
drop policy if exists "uploaded_contact_hashes_select_own" on public.uploaded_contact_hashes;
create policy "uploaded_contact_hashes_select_own" on public.uploaded_contact_hashes for select to authenticated using ((owner_id = (select auth.uid())));
drop policy if exists "avatars_delete_own" on storage.objects;
create policy "avatars_delete_own" on storage.objects for delete to authenticated using (((bucket_id = 'avatars'::text) AND ((storage.foldername(name))[1] = ((select auth.uid()))::text)));
drop policy if exists "avatars_insert_own" on storage.objects;
create policy "avatars_insert_own" on storage.objects for insert to authenticated with check (((bucket_id = 'avatars'::text) AND ((storage.foldername(name))[1] = ((select auth.uid()))::text)));
drop policy if exists "avatars_update_own" on storage.objects;
create policy "avatars_update_own" on storage.objects for update to authenticated using (((bucket_id = 'avatars'::text) AND ((storage.foldername(name))[1] = ((select auth.uid()))::text))) with check (((bucket_id = 'avatars'::text) AND ((storage.foldername(name))[1] = ((select auth.uid()))::text)));
drop policy if exists "note_media_delete_own" on storage.objects;
create policy "note_media_delete_own" on storage.objects for delete to authenticated using (((bucket_id = 'note-media'::text) AND ((storage.foldername(name))[1] = ((select auth.uid()))::text)));
drop policy if exists "note_media_insert_own" on storage.objects;
create policy "note_media_insert_own" on storage.objects for insert to authenticated with check (((bucket_id = 'note-media'::text) AND ((storage.foldername(name))[1] = ((select auth.uid()))::text)));
drop policy if exists "note_media_select" on storage.objects;
create policy "note_media_select" on storage.objects for select to authenticated using (((bucket_id = 'note-media'::text) AND (((storage.foldername(name))[1] = ((select auth.uid()))::text) OR public._can_view_social_target('note'::text, ((storage.foldername(name))[2])::uuid))));
drop policy if exists "note_media_update_own" on storage.objects;
create policy "note_media_update_own" on storage.objects for update to authenticated using (((bucket_id = 'note-media'::text) AND ((storage.foldername(name))[1] = ((select auth.uid()))::text))) with check (((bucket_id = 'note-media'::text) AND ((storage.foldername(name))[1] = ((select auth.uid()))::text)));
drop policy if exists "recordings_delete_own" on storage.objects;
create policy "recordings_delete_own" on storage.objects for delete to authenticated using (((bucket_id = 'recordings'::text) AND ((storage.foldername(name))[1] = ((select auth.uid()))::text)));
drop policy if exists "recordings_insert_own" on storage.objects;
create policy "recordings_insert_own" on storage.objects for insert to authenticated with check (((bucket_id = 'recordings'::text) AND ((storage.foldername(name))[1] = ((select auth.uid()))::text)));
drop policy if exists "recordings_select_own" on storage.objects;
create policy "recordings_select_own" on storage.objects for select to authenticated using (((bucket_id = 'recordings'::text) AND ((storage.foldername(name))[1] = ((select auth.uid()))::text)));
drop policy if exists "recordings_update_own" on storage.objects;
create policy "recordings_update_own" on storage.objects for update to authenticated using (((bucket_id = 'recordings'::text) AND ((storage.foldername(name))[1] = ((select auth.uid()))::text))) with check (((bucket_id = 'recordings'::text) AND ((storage.foldername(name))[1] = ((select auth.uid()))::text)));
drop policy if exists "scores_delete_own" on storage.objects;
create policy "scores_delete_own" on storage.objects for delete to authenticated using (((bucket_id = 'scores'::text) AND ((storage.foldername(name))[1] = ((select auth.uid()))::text)));
drop policy if exists "scores_insert_own" on storage.objects;
create policy "scores_insert_own" on storage.objects for insert to authenticated with check (((bucket_id = 'scores'::text) AND ((storage.foldername(name))[1] = ((select auth.uid()))::text)));
drop policy if exists "scores_select_own" on storage.objects;
create policy "scores_select_own" on storage.objects for select to authenticated using (((bucket_id = 'scores'::text) AND ((storage.foldername(name))[1] = ((select auth.uid()))::text)));
drop policy if exists "scores_update_own" on storage.objects;
create policy "scores_update_own" on storage.objects for update to authenticated using (((bucket_id = 'scores'::text) AND ((storage.foldername(name))[1] = ((select auth.uid()))::text))) with check (((bucket_id = 'scores'::text) AND ((storage.foldername(name))[1] = ((select auth.uid()))::text)));

-- ---------------------------------------------------------------------------
-- function_search_path_mutable (WARN, 11 findings): a function/procedure with no fixed search_path
-- resolves unqualified names against whatever search_path the calling session happens to have,
-- which for a SECURITY DEFINER function is the classic search-path-injection vector (a caller could
-- create a same-named object earlier in their own search_path to redirect what the definer resolves)
-- and for any function is at least a correctness hazard. ALTER FUNCTION/PROCEDURE ... SET
-- search_path fixes it in place without touching the body.
-- ---------------------------------------------------------------------------

alter function public.set_updated_at() set search_path = public, pg_temp;
alter function public.enforce_profile_safety() set search_path = public, pg_temp;
alter procedure public._setup_owner_table(text, text) set search_path = public, pg_temp;
alter procedure public._setup_append_only_table(text) set search_path = public, pg_temp;
alter function public._profile_field_visible(public.profile_visibility, boolean, boolean) set search_path = public, pg_temp;
alter function public.username_search_escape(text) set search_path = public, pg_temp;
alter function public._enforce_owned_piece_passage() set search_path = public, pg_temp;
alter function public.enforce_no_blocked_words() set search_path = public, pg_temp;
alter function public._enforce_social_target_visible() set search_path = public, pg_temp;
alter function public._enforce_social_target_visible_note() set search_path = public, pg_temp;
alter function public._week_start(timestamptz) set search_path = public, pg_temp;

-- ---------------------------------------------------------------------------
-- anon_security_definer_function_executable / authenticated_security_definer_function_executable
-- (6 + 37 WARN): most of the 37 authenticated-executable ones are exactly the public RPC surface
-- this backend is built around (sync_upsert, get_profile_card, submit_report, ...) - SECURITY
-- DEFINER + authenticated execute is the intended, documented shape for all of those, not a finding
-- to act on. Six are genuinely internal helpers that had never been explicitly revoked (Postgres
-- grants EXECUTE to PUBLIC by default) and take either no implicit caller-scoping at all or an
-- arbitrary pair of ids as plain parameters:
--
-- - is_friend(p_a, p_b) / is_blocked(p_a, p_b) / is_studio_member(p_studio, p_user) /
--   is_studio_owner(p_studio, p_user): every real call site in this schema already passes
--   (select auth.uid()) as one side - called directly with two *other* people's ids, each would
--   answer "are X and Y friends / has X blocked Y / is X a member of studio Y" for any arbitrary
--   pair, which is real social-graph information no client should be able to query about people who
--   aren't the caller. Revoked entirely; unaffected internally, since every function that calls them
--   is itself SECURITY DEFINER and always has implicit execute on functions its owner (postgres) owns.
-- - handle_new_auth_user(): a trigger function (`returns trigger`) - not something any RPC call can
--   actually invoke regardless of grants (Postgres itself refuses to run a trigger function outside
--   trigger context), so this is hygiene rather than a reachable bug. Revoked anyway to remove the
--   confusing signal and stop it appearing as a callable-looking endpoint at all.
-- - can_view_activity_event(p_event_id): different shape from the four above - it only ever answers
--   about *the caller's own* (select auth.uid()) ability to view a given event, so it isn't a
--   cross-user leak; kept executable by authenticated (useful directly, e.g. before showing a react/
--   comment control), just not by anon.
-- ---------------------------------------------------------------------------

revoke all on function public.is_friend(uuid, uuid) from public, anon, authenticated;
revoke all on function public.is_blocked(uuid, uuid) from public, anon, authenticated;
revoke all on function public.is_studio_member(uuid, uuid) from public, anon, authenticated;
revoke all on function public.is_studio_owner(uuid, uuid) from public, anon, authenticated;
revoke all on function public.handle_new_auth_user() from public, anon, authenticated;
revoke all on function public.can_view_activity_event(uuid) from public, anon;
grant execute on function public.can_view_activity_event(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Correcting a mistake the previous migration (20260926220010) made in the same spirit: it revoked
-- _can_view_social_target from authenticated too, reasoning it was "only ever called from within
-- another SECURITY DEFINER function" the same way _profile_stats/_profile_field_visible/_week_start
-- are - but that reasoning doesn't hold for this one. Its real call sites are the
-- reactions_target_visible/comments_target_visible/note_replies_visible BEFORE INSERT triggers
-- (_enforce_social_target_visible/_enforce_social_target_visible_note, both plain, non-definer
-- plpgsql) and the note_media_select storage policy - none of which are SECURITY DEFINER themselves,
-- so the nested call to _can_view_social_target executes as the original caller (authenticated), not
-- as postgres, and needs its own EXECUTE grant. (A trigger *firing* is exempt from the invoking
-- role needing EXECUTE on the trigger function itself - that's why _enforce_owned_piece_passage etc.
-- staying revoked is fine - but a plain function call *from inside* a non-definer trigger body, or
-- from a plain RLS policy qual, is an ordinary call and is not exempt.) Like can_view_activity_event,
-- it only ever answers about the caller's own (select auth.uid()) visibility, not an arbitrary pair,
-- so authenticated execute is not a cross-user leak.
-- ---------------------------------------------------------------------------

grant execute on function public._can_view_social_target(text, uuid) to authenticated;
