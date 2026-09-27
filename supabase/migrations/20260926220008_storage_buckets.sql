-- Praelude backend: storage buckets and their RLS (spec 4a). Path convention throughout:
-- {bucket}/{owner_id}/... - the owner's own uid is always the first path segment, which every
-- policy below reads via storage.foldername(name)[1] rather than trusting anything else in the
-- path. See supabase/(C) Backend.md for the exact per-bucket path shape and supabase/(C) Sync
-- Protocol.md for how a piece/recording/note-media row's *_path column is expected to store that
-- same relative path (not a full URL) so a signed URL can be minted for it on demand.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('avatars', 'avatars', false, 5242880, array['image/png', 'image/jpeg', 'image/webp']),
  ('scores', 'scores', false, 209715200, array['application/pdf']),
  ('recordings', 'recordings', false, 104857600, array['audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/x-m4a', 'audio/aac']),
  ('note-media', 'note-media', false, 20971520, array['image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'video/quicktime'])
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- avatars: "public read of allowed profiles" (spec 4a) - not a public *bucket* (that would bypass
-- per-field privacy entirely, since a public bucket's objects are fetchable by anyone with the URL,
-- privacy setting or not). Read access instead mirrors get_profile_card's own photo-privacy logic
-- exactly, including the private-account clamp; write is owner-only.
-- ---------------------------------------------------------------------------

create or replace function public.can_view_avatar(p_owner uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select case
    when auth.uid() = p_owner then true
    when public.is_blocked(auth.uid(), p_owner) then false
    else coalesce((
      select public._profile_field_visible(p.privacy_photo, p.is_private_account, public.is_friend(auth.uid(), p_owner))
      from public.profiles p where p.id = p_owner
    ), false)
  end;
$$;

revoke all on function public.can_view_avatar(uuid) from public;
grant execute on function public.can_view_avatar(uuid) to authenticated;

create policy avatars_select on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and public.can_view_avatar(((storage.foldername(name))[1])::uuid));
create policy avatars_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy avatars_update_own on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy avatars_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------------
-- scores / recordings (spec 4a): both "private owner" - every operation is owner-only, full stop.
-- ---------------------------------------------------------------------------

create policy scores_select_own on storage.objects for select to authenticated
  using (bucket_id = 'scores' and (storage.foldername(name))[1] = auth.uid()::text);
create policy scores_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'scores' and (storage.foldername(name))[1] = auth.uid()::text);
create policy scores_update_own on storage.objects for update to authenticated
  using (bucket_id = 'scores' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'scores' and (storage.foldername(name))[1] = auth.uid()::text);
create policy scores_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'scores' and (storage.foldername(name))[1] = auth.uid()::text);

create policy recordings_select_own on storage.objects for select to authenticated
  using (bucket_id = 'recordings' and (storage.foldername(name))[1] = auth.uid()::text);
create policy recordings_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'recordings' and (storage.foldername(name))[1] = auth.uid()::text);
create policy recordings_update_own on storage.objects for update to authenticated
  using (bucket_id = 'recordings' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'recordings' and (storage.foldername(name))[1] = auth.uid()::text);
create policy recordings_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'recordings' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------------
-- note-media: media attached to a note (spec 5a), read-visible to whoever can see that note (owner,
-- or a non-blocked friend, while the note is within its 24h window and not deleted - the exact same
-- rule notes/comments/reactions already use). Path convention: note-media/{owner_id}/{note_id}/file
-- - the note_id segment lets the read policy check that specific note's live visibility instead of
-- just the uploader's identity, so a friend's access correctly expires with the note itself. Write
-- stays owner-only.
-- ---------------------------------------------------------------------------

create policy note_media_select on storage.objects for select to authenticated
  using (
    bucket_id = 'note-media'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public._can_view_social_target('note', ((storage.foldername(name))[2])::uuid)
    )
  );
create policy note_media_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'note-media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy note_media_update_own on storage.objects for update to authenticated
  using (bucket_id = 'note-media' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'note-media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy note_media_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'note-media' and (storage.foldername(name))[1] = auth.uid()::text);
