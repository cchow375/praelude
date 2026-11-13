-- Isolated synthetic owners/records only. Every write rolls back; no signup/email/storage API.
begin;
insert into auth.users(id, email) values
  ('71000000-0000-4000-8000-000000000001', 'praelude-balance-fixture-a@example.invalid'),
  ('72000000-0000-4000-8000-000000000002', 'praelude-balance-fixture-b@example.invalid');
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000000-0000-4000-8000-000000000001","role":"authenticated"}';
do $$
declare
  v_result jsonb;
  v_plan jsonb := '{"leftHandPercent":30,"rightHandPercent":20,"verySlowPercent":40,"variantPercent":10}';
begin
  v_result := public.sync_upsert('pieces', jsonb_build_object(
    'id','73000000-0000-4000-8000-000000000001','title','Synthetic photo passage',
    'full_tempo_bpm',144,'practice_balance_plan',v_plan,'is_photo_passage',true,'updated_at',now()));
  if (v_result->'row'->>'full_tempo_bpm')::double precision <> 144 or
     v_result->'row'->'practice_balance_plan' <> v_plan or
     (v_result->'row'->>'is_photo_passage')::boolean is not true then
    raise exception 'Practice target/plan round trip failed';
  end if;

  v_result := public.sync_upsert('pieces', jsonb_build_object(
    'id','73000000-0000-4000-8000-000000000001','title','Older client rename',
    'updated_at',now()+interval '1 second'));
  if (v_result->'row'->>'full_tempo_bpm')::double precision <> 144 or
     v_result->'row'->'practice_balance_plan' <> v_plan or
     (v_result->'row'->>'is_photo_passage')::boolean is not true then
    raise exception 'Older client erased planning fields';
  end if;

  begin
    perform public.sync_upsert('pieces', jsonb_build_object(
      'id','73000000-0000-4000-8000-000000000001','title','Synthetic validation','full_tempo_bpm',301,
      'updated_at',now()+interval '2 seconds'));
    raise exception 'Out-of-range tempo accepted';
  exception when check_violation then null;
  end;
  begin
    perform public.sync_upsert('pieces', jsonb_build_object(
      'id','73000000-0000-4000-8000-000000000001','title','Synthetic validation',
      'practice_balance_plan','{"leftHandPercent":80,"rightHandPercent":30,"verySlowPercent":40,"variantPercent":10}'::jsonb,
      'updated_at',now()+interval '2 seconds'));
    raise exception 'Impossible separate-hand shares accepted';
  exception when check_violation then null;
  end;
  begin
    perform public.sync_upsert('pieces', jsonb_build_object(
      'id','73000000-0000-4000-8000-000000000001','title','Synthetic validation','practice_balance_plan','{}'::jsonb,
      'updated_at',now()+interval '2 seconds'));
    raise exception 'Incomplete planning object accepted';
  exception when check_violation then null;
  end;
  begin
    perform public.sync_upsert('pieces', jsonb_build_object(
      'id','73000000-0000-4000-8000-000000000001','title','Synthetic validation',
      'practice_balance_plan','{"leftHandPercent":null,"rightHandPercent":20,"verySlowPercent":40,"variantPercent":10}'::jsonb,
      'updated_at',now()+interval '2 seconds'));
    raise exception 'JSON null planning share accepted';
  exception when check_violation then null;
  end;
  begin
    perform public.sync_upsert('pieces', jsonb_build_object(
      'id','73000000-0000-4000-8000-000000000001','title','Synthetic validation',
      'practice_balance_plan','{"leftHandPercent":"30","rightHandPercent":20,"verySlowPercent":40,"variantPercent":10}'::jsonb,
      'updated_at',now()+interval '2 seconds'));
    raise exception 'String planning share accepted';
  exception when check_violation then null;
  end;

  v_result := public.sync_upsert('pieces', jsonb_build_object(
    'id','73000000-0000-4000-8000-000000000001','title','Synthetic cleared plan','full_tempo_bpm',null,
    'is_photo_passage',false,
    'practice_balance_plan','{"leftHandPercent":0,"rightHandPercent":0,"verySlowPercent":0,"variantPercent":0}'::jsonb,
    'updated_at',now()+interval '3 seconds'));
  if v_result->'row'->>'full_tempo_bpm' is not null or
     (v_result->'row'->'practice_balance_plan'->>'verySlowPercent')::integer <> 0 or
     (v_result->'row'->>'is_photo_passage')::boolean is not false then
    raise exception 'Explicit planning clear failed';
  end if;
end $$;
set local request.jwt.claims = '{"sub":"72000000-0000-4000-8000-000000000002","role":"authenticated"}';
do $$
declare v_n integer;
begin
  select count(*) into v_n from public.pieces where id='73000000-0000-4000-8000-000000000001';
  if v_n <> 0 then raise exception 'Other owner could read a practice plan'; end if;
  begin
    perform public.sync_upsert('pieces', jsonb_build_object(
      'id','73000000-0000-4000-8000-000000000001','title','Other owner',
      'full_tempo_bpm',80,'updated_at',now()+interval '4 seconds'));
    raise exception 'Other owner could overwrite a practice plan';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;
