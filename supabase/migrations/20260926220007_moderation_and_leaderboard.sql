-- Praelude backend: moderation queue and the friends-only weekly leaderboard (spec 5b/5c).

-- ---------------------------------------------------------------------------
-- Reports (5c): user/note/comment/activity_event, plus a "developer_contact" kind with no target -
-- the same queue doubles as the spec's separately-named "developer contact" channel rather than
-- inventing a second table for it. This table *is* the moderation queue: report_status (open/
-- actioned/dismissed, from 20260926220001_extensions_and_helpers.sql) is the queue state.
--
-- No admin role/panel exists yet in this schema (out of scope for this track - see
-- supabase/(C) Backend.md), so resolving a report (moving it off "open") is a service_role-only
-- operation for now: service_role bypasses RLS entirely, which is how the developer works the queue
-- from the Studio SQL editor or a future admin tool. A reporter can still see their own reports'
-- status via the ordinary self-select policy below.
-- ---------------------------------------------------------------------------

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users (id) on delete cascade,
  target_type text not null check (target_type in ('user', 'note', 'comment', 'activity_event', 'developer_contact')),
  target_id uuid,
  reason text not null,
  status public.report_status not null default 'open',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolver_note text,
  constraint reports_target_id_required check (
    (target_type = 'developer_contact' and target_id is null) or
    (target_type <> 'developer_contact' and target_id is not null)
  )
);

alter table public.reports enable row level security;

create policy reports_select_own on public.reports
  for select to authenticated using (reporter_id = auth.uid());
-- No update/delete policy for authenticated: only submit_report (below) inserts, and only
-- service_role (which bypasses RLS) resolves a report by updating status/resolved_at/resolver_note.

create index reports_status_idx on public.reports (status);
create index reports_reporter_idx on public.reports (reporter_id);

create or replace function public.submit_report(p_target_type text, p_target_id uuid, p_reason text)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_me uuid := auth.uid();
  v_id uuid;
begin
  if v_me is null then
    raise exception 'submit_report: must be called as an authenticated user' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'submit_report: reason is required';
  end if;

  insert into public.reports (reporter_id, target_type, target_id, reason)
    values (v_me, p_target_type, p_target_id, p_reason)
    returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.submit_report(text, uuid, text) from public;
grant execute on function public.submit_report(text, uuid, text) to authenticated;

comment on function public.submit_report(text, uuid, text) is
  'Report a user/note/comment/activity_event, or contact the developer directly (target_type '
  '''developer_contact'', target_id null). Lands in public.reports, the moderation queue.';

-- ---------------------------------------------------------------------------
-- Weekly friends-only leaderboard (5b), opt-out via profiles.leaderboard_opt_out. "Friends-only"
-- here means friends of the CALLER specifically - there is no global leaderboard, matching the
-- spec's "friends-only weekly leaderboards" (plural metrics, scoped per viewer, not a site-wide
-- ranking). p_metric selects which of the three named metrics (time, days, reviews) to rank by; all
-- three are always returned per row so the client can show the other two as context.
--
-- "This week" = the most recent Monday 00:00 UTC through now, a fixed reset boundary rather than a
-- rolling 7 days, so every friend's week starts and ends at the same instant (comparable "this
-- week" standings) instead of each viewer seeing a leaderboard with a different window than their
-- friends see of them.
-- ---------------------------------------------------------------------------

create or replace function public._week_start(p_at timestamptz)
returns timestamptz
language sql immutable
as $$
  -- date_trunc('week', ...) already starts on Monday 00:00 per ISO 8601, in the session's timezone;
  -- callers pass timestamptz throughout so this is UTC-consistent regardless of session tz.
  select date_trunc('week', p_at at time zone 'utc') at time zone 'utc';
$$;

create or replace function public.leaderboard_friends(p_metric text default 'time')
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  v_me uuid := auth.uid();
  v_week_start timestamptz := public._week_start(now());
  v_result jsonb;
begin
  if v_me is null then
    raise exception 'leaderboard_friends: must be called as an authenticated user' using errcode = '42501';
  end if;
  if p_metric not in ('time', 'days', 'reviews') then
    raise exception 'leaderboard_friends: metric must be one of time, days, reviews';
  end if;

  with eligible as (
    -- The caller is always included in their own leaderboard alongside friends who haven't opted out.
    select v_me as owner_id
    union
    select case when f.requester_id = v_me then f.addressee_id else f.requester_id end
    from public.friendships f
    where f.status = 'accepted' and (f.requester_id = v_me or f.addressee_id = v_me)
  ),
  eligible_visible as (
    select e.owner_id from eligible e
    join public.profiles p on p.id = e.owner_id
    where (e.owner_id = v_me or not p.leaderboard_opt_out)
      and not public.is_blocked(v_me, e.owner_id)
  ),
  week_sets as (
    -- Both terminal statuses count toward practice time: 'ended' means stopped before reaching its
    -- goal, but that time was still spent practicing. Only 'running'/'paused' (not yet finished,
    -- and whose active_seconds may not be the live/current value until the next sync) are excluded.
    select s.owner_id, s.active_seconds, s.ended_at
    from public.sets s
    join eligible_visible ev on ev.owner_id = s.owner_id
    where s.started_at >= v_week_start and s.status in ('completed', 'ended')
  ),
  week_cold_grades as (
    select cg.owner_id, cg.date
    from public.cold_grades cg
    join eligible_visible ev on ev.owner_id = cg.owner_id
    where cg.date >= v_week_start
  ),
  per_user as (
    select
      ev.owner_id,
      coalesce((select sum(ws.active_seconds) from week_sets ws where ws.owner_id = ev.owner_id), 0) as total_seconds,
      coalesce((select count(distinct date_trunc('day', ws.ended_at)) from week_sets ws where ws.owner_id = ev.owner_id and ws.ended_at is not null), 0) as practice_days,
      coalesce((select count(*) from week_cold_grades wc where wc.owner_id = ev.owner_id), 0) as reviews_done
    from eligible_visible ev
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'owner_id', pu.owner_id,
    'username', p.username,
    'display_name', p.display_name,
    'total_seconds', pu.total_seconds,
    'practice_days', pu.practice_days,
    'reviews_done', pu.reviews_done,
    'is_you', pu.owner_id = v_me
  ) order by
    case when p_metric = 'time' then pu.total_seconds end desc,
    case when p_metric = 'days' then pu.practice_days end desc,
    case when p_metric = 'reviews' then pu.reviews_done end desc
  ), '[]'::jsonb)
  into v_result
  from per_user pu
  join public.profiles p on p.id = pu.owner_id;

  return v_result;
end;
$$;

revoke all on function public.leaderboard_friends(text) from public;
grant execute on function public.leaderboard_friends(text) to authenticated;

comment on function public.leaderboard_friends(text) is
  'This week (Monday 00:00 UTC to now), friends-only, opt-out via profiles.leaderboard_opt_out. '
  'p_metric picks the sort order (time/days/reviews); all three are returned per row regardless.';
