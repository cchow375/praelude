-- Custom cover bytes travel with native Piece metadata. Private owner prefix, same as scores.
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('covers','covers',false,15000000,array['image/png','image/jpeg']) on conflict(id) do nothing;
create policy covers_select_own on storage.objects for select to authenticated
  using (bucket_id='covers' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy covers_insert_own on storage.objects for insert to authenticated
  with check (bucket_id='covers' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy covers_update_own on storage.objects for update to authenticated
  using (bucket_id='covers' and (storage.foldername(name))[1]=(select auth.uid())::text)
  with check (bucket_id='covers' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy covers_delete_own on storage.objects for delete to authenticated
  using (bucket_id='covers' and (storage.foldername(name))[1]=(select auth.uid())::text);

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
    where bucket_id in ('avatars', 'scores', 'recordings', 'note-media', 'covers')
      and (storage.foldername(name))[1] = v_uid::text
  ) then
    raise exception 'delete_my_account: storage objects still exist for this account - delete them via the Storage API first (buckets avatars/scores/recordings/note-media/covers), then call this again'
      using errcode = '55000',
            hint = 'Direct DELETE from storage.objects is blocked by the platform; only the Storage API removes the underlying object, not just the row.';
  end if;

  delete from auth.users where id = v_uid;
end;
$$;

comment on function public.delete_my_account() is
  'Deletes every row owned by the caller, then the caller''s own auth.users row. Irreversible. The '
  'client must delete the caller''s own storage objects (all five buckets) via the Storage API first - '
  'this function refuses to run while any remain, rather than silently orphaning them (protect_delete() '
  'blocks a direct DB-level delete of the objects for us). See supabase/(C) Backend.md for the cascade '
  'audit and supabase/tests for the proof that it is complete.';
