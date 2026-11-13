-- Praelude backend: revert part of 20260926220014, and fix a search_path gap `db advisors` found in
-- 20260926220015's replacement function.
--
-- 20260926220014 granted execute on is_friend/is_blocked to authenticated because this project's own
-- supabase/tests called them directly and got "permission denied". That diagnosis was wrong: every
-- real call site (grep across every migration) is from inside another SECURITY DEFINER function
-- (get_profile_card, friend_activity_feed, leaderboard_friends, ...), which always runs as those
-- functions' owner regardless of the caller's own grants - exactly the reasoning
-- 20260926220011 already spelled out for _profile_stats/_profile_field_visible/_week_start, and
-- (correctly) did NOT apply to is_friend/is_blocked when it revoked them in the first place. Unlike
-- is_studio_member/is_studio_owner (20260926220016 - genuinely needed: they're read from inside plain
-- RLS policy quals on studios/studio_members/studio_goals, which run as the querying role, not the
-- function owner), nothing in this schema needs is_friend/is_blocked to be directly callable. Widening
-- the API surface to fix a test rather than fixing the test was the wrong call; supabase/tests/03 now
-- checks friendship state via the friendships table (already self-scoped and selectable) instead.

revoke all on function public.is_friend(uuid, uuid) from authenticated;
revoke all on function public.is_blocked(uuid, uuid) from authenticated;

-- Unrelated: 20260926220015's replacement _enforce_owned_piece_passage() carried forward the
-- original's missing `set search_path`, which `supabase db advisors` (function_search_path_mutable)
-- caught. Every other function in this schema already pins it; this was the one still missing it.
create or replace function public._enforce_owned_piece_passage()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_passage_id uuid;
begin
  if new.piece_id is not null and not exists (
    select 1 from public.pieces p where p.id = new.piece_id and p.owner_id = new.owner_id
  ) then
    raise exception '%: piece_id must belong to the same owner', tg_table_name using errcode = '23514';
  end if;

  v_passage_id := (to_jsonb(new) ->> 'passage_id')::uuid;
  if v_passage_id is not null and not exists (
    select 1 from public.passages p where p.id = v_passage_id and p.owner_id = new.owner_id
  ) then
    raise exception '%: passage_id must belong to the same owner', tg_table_name using errcode = '23514';
  end if;

  return new;
end;
$$;
