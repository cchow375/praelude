-- Praelude backend: fix respond_friend_request (found by supabase/tests/03, not the advisors -
-- this is a correctness bug, not a lint finding).
--
-- `set status = case when p_accept then 'accepted' else 'declined' end` fails at runtime with
-- "column \"status\" is of type friendship_status but expression is of type text": Postgres resolves
-- a bare CASE over two string literals to text (losing the "unknown literal" status that lets a plain
-- 'accepted' auto-cast to an enum column), and does not implicitly cast text -> enum on assignment.
-- send_friend_request's own `set status = 'accepted'` a few lines above it is a single literal, not a
-- CASE, so it was never affected - this was the one call site with the bug, not a pattern repeated
-- elsewhere (checked: every other `case when` in these migrations returns a uuid, a plain numeric sort
-- key, or jsonb). The fix is the explicit cast every other enum-typed write in this schema already
-- gets implicitly for free.

create or replace function public.respond_friend_request(p_requester uuid, p_accept boolean)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_me uuid := auth.uid();
  v_result public.friendships;
begin
  if v_me is null then raise exception 'respond_friend_request: must be called as an authenticated user' using errcode = '42501'; end if;

  update public.friendships
     set status = (case when p_accept then 'accepted' else 'declined' end)::public.friendship_status,
         updated_at = now(), responded_at = now()
   where requester_id = p_requester and addressee_id = v_me and status = 'pending'
   returning * into v_result;

  if not found then
    raise exception 'respond_friend_request: no pending request from that user' using errcode = '42501';
  end if;

  return jsonb_build_object('status', v_result.status);
end;
$$;

revoke all on function public.respond_friend_request(uuid, boolean) from public;
grant execute on function public.respond_friend_request(uuid, boolean) to authenticated;
