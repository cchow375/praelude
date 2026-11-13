-- Praelude backend: fix delete_my_account (found by supabase/tests/04: it could never succeed).
--
-- `delete from storage.objects where ...` always failed with "Direct deletion from storage tables is
-- not allowed. Use the Storage API instead." - a platform-level trigger (protect_delete()) on
-- storage.objects blocks every direct DELETE, even from a SECURITY DEFINER function owned by a
-- high-privilege role, specifically so a DB-only delete can never orphan the underlying object in the
-- storage backend (deleting just the row would leak the actual file bytes forever). There is no SQL
-- workaround for this; the platform is explicit that the Storage API is the only path.
--
-- New contract (documented in supabase/(C) Backend.md and supabase/(C) Sync Protocol.md for the iOS
-- client track): the client deletes its own objects in all four buckets via the Storage API (already
-- possible today - the *_delete_own policies on storage.objects, from
-- 20260926220008_storage_buckets.sql, are owner-scoped, not blocked by protect_delete() when called
-- through that API) *before* calling delete_my_account(). This function now checks that no objects
-- remain under the caller's prefix and raises a clear, actionable error instead of a confusing
-- platform error if the client got the order wrong, rather than silently leaving orphans behind.

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'delete_my_account: must be called as an authenticated user' using errcode = '42501';
  end if;

  if exists (
    select 1 from storage.objects
    where bucket_id in ('avatars', 'scores', 'recordings', 'note-media')
      and (storage.foldername(name))[1] = v_uid::text
  ) then
    raise exception 'delete_my_account: storage objects still exist for this account - delete them via the Storage API first (buckets avatars/scores/recordings/note-media), then call this again'
      using errcode = '55000',
            hint = 'Direct DELETE from storage.objects is blocked by the platform; only the Storage API removes the underlying object, not just the row.';
  end if;

  delete from auth.users where id = v_uid;
end;
$$;

comment on function public.delete_my_account() is
  'Deletes every row owned by the caller, then the caller''s own auth.users row. Irreversible. The '
  'client must delete the caller''s own storage objects (all four buckets) via the Storage API first - '
  'this function refuses to run while any remain, rather than silently orphaning them (protect_delete() '
  'blocks a direct DB-level delete of the objects for us). See supabase/(C) Backend.md for the cascade '
  'audit and supabase/tests for the proof that it is complete.';
