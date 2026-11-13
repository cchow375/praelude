-- Praelude backend: is_friend/is_blocked were never granted to authenticated (found by
-- supabase/tests/03: "permission denied for function is_friend"), unlike every other
-- non-underscore-prefixed helper in this schema (contains_blocked_word, username_search_escape).
-- Both are read-only booleans over a pair of uuids - no more sensitive than the `is_friend` field
-- get_profile_card already returns to any caller - and a client reasonably wants "are we friends" /
-- "did I block them" (e.g. for a UI badge) without fetching a whole profile card. Underscore-prefixed
-- helpers (_profile_field_visible, _can_view_social_target, ...) stay ungranted on purpose; these two
-- were the one inconsistency with that convention.

grant execute on function public.is_friend(uuid, uuid) to authenticated;
grant execute on function public.is_blocked(uuid, uuid) to authenticated;
