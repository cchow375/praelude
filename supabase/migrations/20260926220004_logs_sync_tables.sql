-- Praelude backend: append-only event logs (spec 4d/11/14). Mirrors Schema3.md's own rule exactly:
-- "an append-only log carries only id and its own event date... adding updatedAt/deletedAt to these
-- would be dead weight" - so none of these tables have created_at/updated_at/deleted_at at all.
--
-- Two narrow, deliberate exceptions to "never touched after insert" get their own SECURITY DEFINER
-- RPCs in 20260926220005_sync_rpc.sql instead of an UPDATE policy: attempts.undone_at (spec 9 Undo)
-- and pieces.last_page (handled in that same migration). rule_events.overridden is NOT one of these -
-- Core's own doc says a RuleEvent is "never edited after creation", so the override decision is
-- known and recorded at insert time, not patched in later.

create or replace procedure public._setup_append_only_table(p_table text)
language plpgsql
as $$
begin
  execute format('alter table %I enable row level security', p_table);
  execute format(
    'create policy %I on %I for select to authenticated using (owner_id = auth.uid())',
    p_table || '_select_own', p_table);
  execute format(
    'create policy %I on %I for insert to authenticated with check (owner_id = auth.uid())',
    p_table || '_insert_own', p_table);
  insert into public.append_only_tables (table_name) values (p_table) on conflict do nothing;
end;
$$;

-- Attempt (spec 9/10): one verdict. undone_at is written only by sync_undo_attempt().
create table public.attempts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  set_id uuid not null references public.sets (id) on delete cascade,
  verdict text not null check (verdict in ('clean', 'sloppy', 'again', 'reset')),
  date timestamptz not null default now(),
  bpm double precision not null,
  stage_index int not null default 0,
  undone_at timestamptz
);
call public._setup_append_only_table('attempts');

-- RuleEvent (spec 11): one firing, override decision already known at insert time.
create table public.rule_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  rule_id text not null check (rule_id in (
    'r1SmallChunks', 'r2JoinSeams', 'r3ColdAttempt', 'r4SpacedReview', 'r5StreakGoal', 'r6SlowDown',
    'r7SpeedUp', 'r8SplitWeakSpot', 'r9StopGrinding', 'r10PerformanceReady', 'r11PerformanceDate',
    'r12VariantsWhenStuck', 'r13PartsSeparately', 'r14PulseCheck', 'r15SessionBuilder'
  )),
  piece_id uuid references public.pieces (id) on delete cascade,
  passage_id uuid references public.passages (id) on delete cascade,
  reason_text text not null,
  fired_at timestamptz not null default now(),
  overridden boolean not null default false
);
call public._setup_append_only_table('rule_events');

-- RewardLedgerEntry (spec 14): coins/xp are structurally non-negative, matching Core's validate().
create table public.reward_ledger (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  date timestamptz not null default now(),
  coins_delta int not null default 0 check (coins_delta >= 0),
  xp_delta int not null default 0 check (xp_delta >= 0),
  reason text not null
);
call public._setup_append_only_table('reward_ledger');

-- Badge (spec 14): a stable slug, not a closed enum, so a new badge never needs a migration.
create table public.badges (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  key text not null,
  earned_at timestamptz not null default now()
);
call public._setup_append_only_table('badges');

-- MilestoneEvent (spec 14): a celebration-worthy moment, for the feed and "never mid-set" bookkeeping.
create table public.milestone_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  date timestamptz not null default now(),
  detail text not null default ''
);
call public._setup_append_only_table('milestone_events');

-- ColdGradeRecord (spec 9/11 R3/R4).
create table public.cold_grades (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  passage_id uuid not null references public.passages (id) on delete cascade,
  date timestamptz not null default now(),
  grade text not null check (grade in ('clean', 'shaky', 'missed')),
  tempo double precision not null
);
call public._setup_append_only_table('cold_grades');

-- BreakPointTap (spec 11 R8): three clustered taps offer a sub-passage split.
create table public.break_point_taps (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  passage_id uuid not null references public.passages (id) on delete cascade,
  date timestamptz not null default now(),
  location jsonb
);
call public._setup_append_only_table('break_point_taps');
