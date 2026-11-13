-- Temporary users and data roll back together. No signups, emails or personal libraries touched.
begin;
insert into auth.users(id, email) values
  ('61000000-0000-4000-8000-000000000001', 'praelude-sql-fixture-a@example.invalid'),
  ('62000000-0000-4000-8000-000000000002', 'praelude-sql-fixture-b@example.invalid');
set local role authenticated;
set local request.jwt.claims = '{"sub":"61000000-0000-4000-8000-000000000001","role":"authenticated"}';
do $$
declare v_result jsonb;
begin
  v_result := public.sync_upsert('account_preferences', jsonb_build_object(
    'preferences', '{"theme":"dark","showPassageBoxes":true,"futureScoreMode":"reader"}'::jsonb,
    'created_at', now(), 'updated_at', now()));
  if v_result->'row'->'preferences'->>'theme' <> 'dark' then raise exception 'Preference round trip failed'; end if;
  v_result := public.sync_upsert('account_preferences', jsonb_build_object(
    'preferences', '{"theme":"light","showPassageBoxes":false}'::jsonb,
    'updated_at', now()+interval '1 second'));
  if v_result->'row'->'preferences'->>'futureScoreMode' <> 'reader' or
     v_result->'row'->'preferences'->>'showPassageBoxes' <> 'false' or
     v_result->'row'->'preferences'->>'theme' <> 'light' then
    raise exception 'Older preference payload erased future key or ignored known choice';
  end if;
end $$;
do $$
declare v_result jsonb;
begin
  perform public.sync_upsert('pieces', jsonb_build_object(
    'id','63000000-0000-4000-8000-000000000001','title','Fixture score',
    'score_sections','[{"title":"Movement II","startPage":3,"endPage":4}]'::jsonb,
    'measure_anchors','[{"page":3,"startMeasure":1,"endMeasure":4}]'::jsonb,
    'default_practice_bpm',72,'custom_cover_ref','fixture.jpg', 'difficulty',3,
    'updated_at',now()));
  v_result := public.sync_upsert('pieces', jsonb_build_object(
    'id','63000000-0000-4000-8000-000000000001','title','Edited by older client','updated_at',now()+interval '1 second'));
  if jsonb_array_length(v_result->'row'->'score_sections') <> 1 or
     (v_result->'row'->>'default_practice_bpm')::double precision <> 72 then
    raise exception 'Legacy payload erased new score metadata';
  end if;
  v_result := public.sync_upsert('pieces', jsonb_build_object(
    'id','63000000-0000-4000-8000-000000000001','title','Cleared score metadata','score_sections','[]'::jsonb,
    'measure_anchors','[]'::jsonb,'default_practice_bpm',null,'custom_cover_ref',null,'difficulty',null,
    'updated_at',now()+interval '2 seconds'));
  if jsonb_array_length(v_result->'row'->'score_sections') <> 0 or
     v_result->'row'->>'custom_cover_ref' is not null or v_result->'row'->>'difficulty' is not null or
     v_result->'row'->>'default_practice_bpm' is not null then
    raise exception 'Explicit clear did not reach stored score row';
  end if;
end $$;
set local request.jwt.claims = '{"sub":"62000000-0000-4000-8000-000000000002","role":"authenticated"}';
do $$
declare v_n int;
begin
  select count(*) into v_n from public.account_preferences;
  if v_n <> 0 then raise exception 'User B saw A preferences'; end if;
  update public.account_preferences set preferences='{}'::jsonb
    where owner_id='61000000-0000-4000-8000-000000000001';
  get diagnostics v_n = row_count;
  if v_n <> 0 then raise exception 'User B changed A preferences'; end if;
end $$;
reset role;
do $$
begin
  if not exists(select 1 from storage.buckets where id='covers' and public=false and file_size_limit=15000000) then
    raise exception 'Private covers bucket missing';
  end if;
  if (select count(*) from pg_policies where schemaname='storage' and tablename='objects' and policyname like 'covers_%_own') <> 4 then
    raise exception 'Cover owner policies missing';
  end if;
  if pg_get_functiondef('public.delete_my_account()'::regprocedure) not like '%note-media%, %covers%' then
    raise exception 'Cover account cleanup guard missing';
  end if;
end $$;
rollback;
