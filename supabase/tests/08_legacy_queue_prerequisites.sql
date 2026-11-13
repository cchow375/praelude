-- Synthetic dependency regression only; all changes are inside one rollback transaction.
begin;
insert into auth.users(id,email) values
('325d8c74-dcc1-4fd8-a0f0-0b3b6602f1fd','praelude-dependency-a@example.invalid'),
('5b684072-90c3-4cda-8932-c3e19f374919','praelude-dependency-b@example.invalid');
set local role authenticated;
set local request.jwt.claims = '{"sub":"325d8c74-dcc1-4fd8-a0f0-0b3b6602f1fd","role":"authenticated"}';
do $$
declare
  v_result jsonb;
  v_session jsonb := jsonb_build_object('id','c997d77b-95ef-4aba-baba-242e54565a1a','piece_id','c43e87ec-fe03-4b0a-9380-d6a3dd7c704f','focus','Synthetic pulse','updated_at',now());
  v_set jsonb := jsonb_build_object('id','b96f4b7b-c47d-415d-b370-103c4965d9fe','session_id','c997d77b-95ef-4aba-baba-242e54565a1a','piece_id','c43e87ec-fe03-4b0a-9380-d6a3dd7c704f','passage_id','73eaacd7-416a-4e31-bfbb-f0712d26ff0f','updated_at',now());
  v_attempt jsonb := jsonb_build_object('id','8cbf4561-6f83-4160-b36e-fdd97fc6f7d1','set_id','b96f4b7b-c47d-415d-b370-103c4965d9fe','verdict','clean','date',now(),'bpm',60,'stage_index',0);
  v_piece jsonb := jsonb_build_object('id','c43e87ec-fe03-4b0a-9380-d6a3dd7c704f','title','Synthetic dependency score','instrument_id','8d458301-6145-4bbd-b06a-c564665ea27e',
    'tag_ids',jsonb_build_array('2c797ff6-9071-42a8-a35f-a0bb7bcc25fe'),'folder_ids',jsonb_build_array('ff03a700-c285-4ffd-9761-7633b8af9134'),'updated_at',now());
begin
  begin
    perform public.sync_upsert('practice_sessions',v_session);
    raise exception 'Legacy session unexpectedly succeeded without its piece';
  exception when foreign_key_violation then null;
  end;
  begin
    perform public.sync_upsert('sets',v_set);
    raise exception 'Legacy set unexpectedly succeeded without its parents';
  exception when foreign_key_violation then null;
  end;
  begin
    perform public.sync_append('attempts',v_attempt);
    raise exception 'Legacy attempt unexpectedly succeeded without its set';
  exception when foreign_key_violation then null;
  end;
  if exists(select 1 from public.practice_sessions where id='c997d77b-95ef-4aba-baba-242e54565a1a') or
     exists(select 1 from public.sets where id='b96f4b7b-c47d-415d-b370-103c4965d9fe') or
     exists(select 1 from public.attempts where id='8cbf4561-6f83-4160-b36e-fdd97fc6f7d1') then
    raise exception 'Expected failing child insert published a record';
  end if;
  perform public.sync_upsert('instruments',jsonb_build_object('id','8d458301-6145-4bbd-b06a-c564665ea27e','family','keyboard','name','Synthetic piano','updated_at',now()));
  perform public.sync_upsert('tags',jsonb_build_object('id','2c797ff6-9071-42a8-a35f-a0bb7bcc25fe','name','Synthetic tag','updated_at',now()));
  perform public.sync_upsert('folders',jsonb_build_object('id','ebfaeabf-6872-4d6f-8a6f-67320ba0617a','name','Synthetic parent','updated_at',now()));
  perform public.sync_upsert('folders',jsonb_build_object('id','ff03a700-c285-4ffd-9761-7633b8af9134','name','Synthetic child','parent_folder_id','ebfaeabf-6872-4d6f-8a6f-67320ba0617a','updated_at',now()));
  perform public.sync_upsert('pieces',v_piece);
  perform public.sync_upsert('passages',jsonb_build_object('id','8c44079b-1978-4925-a0bd-487e9c0cdf7f','piece_id','c43e87ec-fe03-4b0a-9380-d6a3dd7c704f','title','Synthetic parent passage','updated_at',now()));
  perform public.sync_upsert('passages',jsonb_build_object('id','73eaacd7-416a-4e31-bfbb-f0712d26ff0f','piece_id','c43e87ec-fe03-4b0a-9380-d6a3dd7c704f','title','Synthetic child passage','parent_passage_id','8c44079b-1978-4925-a0bd-487e9c0cdf7f','updated_at',now()));
  perform public.sync_upsert('practice_sessions',v_session);
  perform public.sync_upsert('sets',v_set);
  v_result := public.sync_append('attempts',v_attempt);
  if (v_result->>'applied')::boolean is not true then raise exception 'Original attempt did not append after bootstrap'; end if;
  v_result := public.sync_append('attempts',v_attempt);
  if (v_result->>'applied')::boolean is not false then raise exception 'Retried attempt duplicated'; end if;
  perform public.sync_undo_attempt('8cbf4561-6f83-4160-b36e-fdd97fc6f7d1',now()+interval '1 second');
  if (select count(*) from public.attempts where id='8cbf4561-6f83-4160-b36e-fdd97fc6f7d1') <> 1 or
     not exists(select 1 from public.attempts where id='8cbf4561-6f83-4160-b36e-fdd97fc6f7d1' and undone_at is not null) then
    raise exception 'Append then Undo was not retained';
  end if;
  -- Partial native upserts explicitly clear represented nullable fields; omitted keys preserve them.
  perform public.sync_upsert('sets',v_set || jsonb_build_object('passage_id',null,'ended_at',null,'last_checkpoint',null,'updated_at',now()+interval '2 seconds'));
  if not exists(select 1 from public.sets where id='b96f4b7b-c47d-415d-b370-103c4965d9fe' and passage_id is null and ended_at is null and last_checkpoint is null) then
    raise exception 'Explicit nullable transport payload did not clear old parent/state';
  end if;
end $$;
set local request.jwt.claims = '{"sub":"5b684072-90c3-4cda-8932-c3e19f374919","role":"authenticated"}';
do $$
declare v_result jsonb;
begin
  if exists(select 1 from public.pieces where id='c43e87ec-fe03-4b0a-9380-d6a3dd7c704f') or
     exists(select 1 from public.practice_sessions where id='c997d77b-95ef-4aba-baba-242e54565a1a') or
     exists(select 1 from public.sets where id='b96f4b7b-c47d-415d-b370-103c4965d9fe') or
     exists(select 1 from public.attempts where id='8cbf4561-6f83-4160-b36e-fdd97fc6f7d1') then
    raise exception 'Other owner could read synthetic dependency rows';
  end if;
  begin
    perform public.sync_upsert('pieces',jsonb_build_object('id','c43e87ec-fe03-4b0a-9380-d6a3dd7c704f','title','Other owner overwrite','updated_at',now()+interval '3 seconds'));
    raise exception 'Other owner could overwrite synthetic piece';
  exception when insufficient_privilege then null;
  end;
  v_result := public.sync_undo_attempt('8cbf4561-6f83-4160-b36e-fdd97fc6f7d1',now()+interval '4 seconds');
  if (v_result->>'applied')::boolean is not false or v_result->'row' <> 'null'::jsonb then
    raise exception 'Other owner Undo returned or changed a record';
  end if;
end $$;
rollback;
do $$
begin
  if exists(select 1 from auth.users where id in ('325d8c74-dcc1-4fd8-a0f0-0b3b6602f1fd','5b684072-90c3-4cda-8932-c3e19f374919')) or
     exists(select 1 from public.instruments where id='8d458301-6145-4bbd-b06a-c564665ea27e') or
     exists(select 1 from public.tags where id='2c797ff6-9071-42a8-a35f-a0bb7bcc25fe') or
     exists(select 1 from public.folders where id in ('ebfaeabf-6872-4d6f-8a6f-67320ba0617a','ff03a700-c285-4ffd-9761-7633b8af9134')) or
     exists(select 1 from public.pieces where id='c43e87ec-fe03-4b0a-9380-d6a3dd7c704f') or
     exists(select 1 from public.passages where id in ('8c44079b-1978-4925-a0bd-487e9c0cdf7f','73eaacd7-416a-4e31-bfbb-f0712d26ff0f')) or
     exists(select 1 from public.practice_sessions where id='c997d77b-95ef-4aba-baba-242e54565a1a') or
     exists(select 1 from public.sets where id='b96f4b7b-c47d-415d-b370-103c4965d9fe') or
     exists(select 1 from public.attempts where id='8cbf4561-6f83-4160-b36e-fdd97fc6f7d1') then
    raise exception 'Synthetic fixture escaped rollback';
  end if;
end $$;
select 'PASS: three child-first FKs; ordered parent prefix; idempotent append and Undo; explicit nulls; owner isolation; rollback cleanup' as result;
