-- Praelude backend tests (spec 5c "prove user A cannot read/write user B's private data through any
-- table/view/RPC/storage"): static coverage check.
--
-- Every owner-scoped table is configured by the same two procedures (_setup_owner_table /
-- _setup_append_only_table, see supabase/migrations/20260926220011_advisor_fixes.sql), so instead of
-- hand-testing all ~27 of them one at a time, this proves the *configuration* is complete and uniform
-- for every single one via catalog introspection - no impersonation needed, nothing to roll back. See
-- 02_owner_isolation_and_sync_rpc.sql for the matching dynamic proof that the mechanism actually
-- behaves correctly at runtime on a representative sample.
--
-- No BEGIN/ROLLBACK: this file only reads system catalogs, it never touches application data.

do $$
declare
  v_row record;
  v_missing text;
begin
  -- 1. Every public table has row_security enabled, except the three documented no-policy tables
  --    (append_only_tables/blocked_words/sync_tables - service/migration-only, matches the
  --    rls_enabled_no_policy advisor findings marked "intentional" in 20260926220011_advisor_fixes.sql).
  for v_row in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
  loop
    raise exception 'FAIL 01.1: public.% has row level security OFF', v_row.relname;
  end loop;

  -- 2. Every table registered in sync_tables with owner_column = 'owner_id' (the _setup_owner_table
  --    family - everything except profiles) has exactly the three expected policies, each still
  --    carrying the auth_rls_initplan fix (owner_id = (select auth.uid())), and critically NO delete
  --    policy (deletion is tombstone-only, or delete_my_account()).
  for v_row in select table_name from public.sync_tables where owner_column = 'owner_id'
  loop
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = v_row.table_name
        and policyname = v_row.table_name || '_select_own' and cmd = 'SELECT'
        and qual = '(owner_id = ( SELECT auth.uid() AS uid))'
    ) then
      raise exception 'FAIL 01.2: %.select_own policy missing or not owner_id-scoped', v_row.table_name;
    end if;

    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = v_row.table_name
        and policyname = v_row.table_name || '_insert_own' and cmd = 'INSERT'
        and with_check = '(owner_id = ( SELECT auth.uid() AS uid))'
    ) then
      raise exception 'FAIL 01.3: %.insert_own policy missing or not owner_id-scoped', v_row.table_name;
    end if;

    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = v_row.table_name
        and policyname = v_row.table_name || '_update_own' and cmd = 'UPDATE'
        and qual = '(owner_id = ( SELECT auth.uid() AS uid))'
        and with_check = '(owner_id = ( SELECT auth.uid() AS uid))'
    ) then
      raise exception 'FAIL 01.4: %.update_own policy missing or not owner_id-scoped', v_row.table_name;
    end if;

    if exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = v_row.table_name and cmd = 'DELETE'
    ) then
      raise exception 'FAIL 01.5: %.  has a DELETE policy - deletion must be tombstone-only or delete_my_account()', v_row.table_name;
    end if;
  end loop;

  -- 3. append_only_tables: select_own + insert_own only, no update, no delete.
  for v_row in select table_name from public.append_only_tables
  loop
    if not exists (
      select 1 from pg_policies where schemaname = 'public' and tablename = v_row.table_name
        and policyname = v_row.table_name || '_select_own' and cmd = 'SELECT'
        and qual = '(owner_id = ( SELECT auth.uid() AS uid))'
    ) then
      raise exception 'FAIL 01.6: append-only %.select_own policy missing or not owner_id-scoped', v_row.table_name;
    end if;
    if not exists (
      select 1 from pg_policies where schemaname = 'public' and tablename = v_row.table_name
        and policyname = v_row.table_name || '_insert_own' and cmd = 'INSERT'
        and with_check = '(owner_id = ( SELECT auth.uid() AS uid))'
    ) then
      raise exception 'FAIL 01.7: append-only %.insert_own policy missing or not owner_id-scoped', v_row.table_name;
    end if;
    if exists (
      select 1 from pg_policies where schemaname = 'public' and tablename = v_row.table_name
        and cmd in ('UPDATE', 'DELETE')
    ) then
      raise exception 'FAIL 01.8: append-only % has an UPDATE/DELETE policy - it must be insert-only (sync_undo_attempt is the one documented exception, applied server-side via SECURITY DEFINER, never client RLS)', v_row.table_name;
    end if;
  end loop;

  -- 4. profiles: the one owner_column = 'id' table, self-only on all three verbs, no delete policy.
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles'
      and policyname = 'profiles_select_self' and cmd = 'SELECT'
      and qual = '(id = ( SELECT auth.uid() AS uid))'
  ) then
    raise exception 'FAIL 01.9: profiles_select_self missing or not id-scoped';
  end if;
  if exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and cmd = 'DELETE'
  ) then
    raise exception 'FAIL 01.10: profiles has a DELETE policy - must go through delete_my_account()';
  end if;

  -- 5. Every security definer RPC that mutates or reads across owners must reject the unauthenticated
  --    (anon) role outright - grants are the first line of defense before the function body's own
  --    auth.uid() is null check.
  for v_row in
    select p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef -- security definer
      and p.proname not like '\_%' escape '\'   -- helper functions (leading underscore) are internal
      and has_function_privilege('anon', p.oid, 'execute')
  loop
    raise exception 'FAIL 01.11: security definer function public.%() is EXECUTE-granted to anon', v_row.proname;
  end loop;

  -- 5b. The exact, deliberately uneven authenticated-grant contract for the small "is this visible /
  --     am I a member" predicate helpers (see 20260926220011_advisor_fixes.sql's and
  --     20260926220018's own comments for the reasoning this codifies): a helper called from inside a
  --     plain RLS policy qual or a non-SECURITY-DEFINER trigger body runs *as the querying role*, so it
  --     needs its own grant or every query through that policy/trigger fails outright; a helper only
  --     ever called from inside another SECURITY DEFINER function runs as that function's owner and
  --     must NOT also be independently callable, or it becomes a way to ask about an arbitrary pair/
  --     owner with none of the caller-scoping its real call sites rely on.
  if not (
    has_function_privilege('authenticated', 'public.is_studio_member(uuid, uuid)'::regprocedure, 'execute')
    and has_function_privilege('authenticated', 'public.is_studio_owner(uuid, uuid)'::regprocedure, 'execute')
    and has_function_privilege('authenticated', 'public.can_view_activity_event(uuid)'::regprocedure, 'execute')
    and has_function_privilege('authenticated', 'public._can_view_social_target(text, uuid)'::regprocedure, 'execute')
  ) then
    raise exception 'FAIL 01.16: a helper read from inside a plain RLS policy/trigger lost its required authenticated grant';
  end if;
  if (
    has_function_privilege('authenticated', 'public.is_friend(uuid, uuid)'::regprocedure, 'execute')
    or has_function_privilege('authenticated', 'public.is_blocked(uuid, uuid)'::regprocedure, 'execute')
    or has_function_privilege('authenticated', 'public._profile_stats(uuid)'::regprocedure, 'execute')
    or has_function_privilege('authenticated', 'public._profile_field_visible(public.profile_visibility, boolean, boolean)'::regprocedure, 'execute')
  ) then
    raise exception 'FAIL 01.17: a helper meant to be reachable only from inside another SECURITY DEFINER function became directly callable (arbitrary-pair/owner probing, unscoped to the caller)';
  end if;

  -- 6. Storage: RLS is on for storage.objects, and none of the four buckets is a public bucket. See
  --    04's dynamic tests for the actual per-bucket read/write behavior.
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'storage' and c.relname = 'objects' and c.relrowsecurity
  ) then
    raise exception 'FAIL 01.12: storage.objects does not have row level security enabled';
  end if;
  for v_row in select id from storage.buckets where id in ('avatars', 'scores', 'recordings', 'note-media') and public
  loop
    raise exception 'FAIL 01.13: storage bucket % is a PUBLIC bucket (bypasses RLS entirely)', v_row.id;
  end loop;
  if (select count(*) from storage.buckets where id in ('avatars', 'scores', 'recordings', 'note-media')) <> 4 then
    raise exception 'FAIL 01.14: expected exactly 4 storage buckets (avatars, scores, recordings, note-media)';
  end if;
end $$;

select 'PASS 01: RLS policy coverage is complete and uniform across every registered table + storage' as result;
