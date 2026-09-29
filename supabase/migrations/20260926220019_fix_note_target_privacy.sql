-- Praelude backend: _can_view_social_target('note', ...) never checked privacy_notes.
--
-- friend_notes() (20260926220006_social.sql) correctly gates a friend's notes behind
-- _profile_field_visible(privacy_notes, is_private_account, true) - the private-account-clamped
-- per-field visibility check spec 5c asks for ("Settings for who sees ... notes"). But
-- _can_view_social_target's 'note' branch - the function every OTHER note-adjacent write path
-- actually enforces through (note_replies_visible/reactions_target_visible/comments_target_visible
-- BEFORE INSERT triggers, and the note_media_select storage policy) - only checked ownership,
-- friendship and the 24h window, never privacy_notes at all. A friend whose privacy_notes is
-- 'onlyMe' (never shown to friends, only the owner) could still reply to, react to, comment on, or
-- read note-attached media for that note, because none of those paths call friend_notes() - they all
-- go through this one shared function. Fixed here to mirror friend_notes()'s own predicate exactly,
-- which also closes the same gap for reactions/comments/note-media in the same edit (all four share
-- this one function - see supabase/(C) Backend.md, "Design: cross-user reads go through named
-- functions, not scattered policies").
--
-- Unaffected: the activity_event branch (no per-field privacy setting exists for the activity feed
-- in this spec - see supabase/(C) Backend.md's own "Design" section), and friend_notes() itself
-- (already correct - this migration makes _can_view_social_target consistent with it, not the
-- other way around).

create or replace function public._can_view_social_target(p_target_type text, p_target_id uuid)
returns boolean
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if p_target_type = 'activity_event' then
    return public.can_view_activity_event(p_target_id);
  elsif p_target_type = 'note' then
    return exists (
      select 1
      from public.notes n
      join public.profiles p on p.id = n.owner_id
      where n.id = p_target_id and n.deleted_at is null and n.created_at > now() - interval '24 hours'
        and (
          n.owner_id = auth.uid()
          or (
            public.is_friend(auth.uid(), n.owner_id)
            and not public.is_blocked(auth.uid(), n.owner_id)
            and public._profile_field_visible(p.privacy_notes, p.is_private_account, true)
          )
        )
    );
  end if;
  return false;
end;
$$;

comment on function public._can_view_social_target(text, uuid) is
  'Shared visibility check for reactions/comments/note_replies/note-media on an activity_event or a '
  'note. The note branch mirrors friend_notes()''s own privacy_notes + friendship + block + 24h-window '
  'predicate exactly (fixed 20260926220019 - it previously omitted privacy_notes).';
