-- Additive native practice planning sync. Existing personal rows stay untouched/null until an
-- updated owner client explicitly saves them. Older clients omit these keys; sync_upsert keeps
-- the existing values. No practice schema, ownership policy or existing RPC is changed.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.pieces add column if not exists full_tempo_bpm double precision
  check (full_tempo_bpm between 20 and 300);
alter table public.pieces add column if not exists practice_balance_plan jsonb
  check (practice_balance_plan is null or (
    jsonb_typeof(practice_balance_plan) = 'object'
    and practice_balance_plan ?& array['leftHandPercent','rightHandPercent','verySlowPercent','variantPercent']
    and jsonb_typeof(practice_balance_plan->'leftHandPercent') = 'number'
    and jsonb_typeof(practice_balance_plan->'rightHandPercent') = 'number'
    and jsonb_typeof(practice_balance_plan->'verySlowPercent') = 'number'
    and jsonb_typeof(practice_balance_plan->'variantPercent') = 'number'
    and (practice_balance_plan->>'leftHandPercent') ~ '^[0-9]{1,3}$'
    and (practice_balance_plan->>'rightHandPercent') ~ '^[0-9]{1,3}$'
    and (practice_balance_plan->>'verySlowPercent') ~ '^[0-9]{1,3}$'
    and (practice_balance_plan->>'variantPercent') ~ '^[0-9]{1,3}$'
    and (practice_balance_plan->>'leftHandPercent')::integer between 0 and 100
    and (practice_balance_plan->>'rightHandPercent')::integer between 0 and 100
    and (practice_balance_plan->>'verySlowPercent')::integer between 0 and 100
    and (practice_balance_plan->>'variantPercent')::integer between 0 and 100
    and (practice_balance_plan->>'leftHandPercent')::integer + (practice_balance_plan->>'rightHandPercent')::integer <= 100
  ));

comment on column public.pieces.full_tempo_bpm is
  'Optional pianist-chosen full performance tempo; separate from current practice tempo. Null explicitly clears it.';
comment on column public.pieces.practice_balance_plan is
  'Optional pianist-chosen repetition coverage goals. Null means legacy/unpublished; zero-valued fields clear a goal.';

notify pgrst, 'reload schema';
commit;
