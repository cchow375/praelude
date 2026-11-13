-- Praelude backend: is_studio_member/is_studio_owner were never granted to authenticated (found by
-- supabase/tests/03: "permission denied for function is_studio_member"). Both are referenced directly
-- inside RLS policies (studios_select_member, studio_members_select_member, studio_goals_select_member
-- /_insert_member/_update_member) - a policy's USING/WITH CHECK runs as the querying role, so without
-- this grant every studios/studio_members/studio_goals query failed outright for every real user, not
-- just a lint finding. Same class of gap as 20260926220014 (is_friend/is_blocked), swept for here with
-- the full has_function_privilege() audit that turned up only these two remaining non-underscore
-- SECURITY DEFINER functions still missing the grant (handle_new_auth_user correctly has none - it is
-- an auth.users trigger function, never called directly by any role).

grant execute on function public.is_studio_member(uuid, uuid) to authenticated;
grant execute on function public.is_studio_owner(uuid, uuid) to authenticated;
