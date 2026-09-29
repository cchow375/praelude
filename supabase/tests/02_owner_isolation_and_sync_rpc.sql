-- Praelude backend tests: dynamic proof that owner-only RLS actually behaves correctly at runtime,
-- on a representative sample of tables (01_rls_policy_coverage.sql proves the configuration is
-- uniform across every table; this proves the mechanism really works, including through sync_upsert).
--
-- Requires two throwaway users already created via the public signup path - see supabase/tests/run.sh.
-- __USER_A_ID__ / __USER_B_ID__ are replaced with real uuids by run.sh before this file is sent.
-- Everything runs inside one transaction and is rolled back: re-runnable indefinitely against the
-- same two users, never leaves data behind.

begin;

set local role = 'authenticated';
set local request.jwt.claims = '{"sub":"__USER_A_ID__","role":"authenticated"}';

-- ---------------------------------------------------------------------------
-- Simple table (tags): minimal columns, proves the generic _setup_owner_table pattern.
-- ---------------------------------------------------------------------------
select public.sync_upsert('tags', jsonb_build_object(
  'id', '00000000-0000-4000-8000-00000000a001',
  'name', 'A''s private tag',
  'created_at', now(), 'updated_at', now()
));

-- Richer table with real NOT NULL business columns + a child row with a FK and a bytea column: pieces
-- + ink_strokes.
select public.sync_upsert('pieces', jsonb_build_object(
  'id', '00000000-0000-4000-8000-00000000a002',
  'title', 'A''s private piece', 'composer', 'Test Composer',
  'page_count', 4, 'last_page', 1, 'status', 'active', 'notes', '',
  'tag_ids', '[]'::jsonb, 'folder_ids', '[]'::jsonb, 'performance_dates', '[]'::jsonb,
  'created_at', now(), 'updated_at', now(), 'last_page_updated_at', now()
));

select public.sync_upsert('ink_strokes', jsonb_build_object(
  'id', '00000000-0000-4000-8000-00000000a003',
  'piece_id', '00000000-0000-4000-8000-00000000a002',
  'page', 1, 'layer', 'mine', 'data', to_jsonb('\x0102030405'::bytea),
  'created_at', now(), 'updated_at', now()
));

-- ---------------------------------------------------------------------------
-- As user B: direct SELECT/UPDATE/DELETE against A's rows must all see/touch nothing.
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"__USER_B_ID__","role":"authenticated"}';

do $$
declare
  v_n int;
begin
  select count(*) into v_n from public.tags where id = '00000000-0000-4000-8000-00000000a001';
  if v_n <> 0 then raise exception 'FAIL 02.1: user B could SELECT user A''s tag'; end if;

  select count(*) into v_n from public.pieces where id = '00000000-0000-4000-8000-00000000a002';
  if v_n <> 0 then raise exception 'FAIL 02.2: user B could SELECT user A''s piece'; end if;

  select count(*) into v_n from public.ink_strokes where id = '00000000-0000-4000-8000-00000000a003';
  if v_n <> 0 then raise exception 'FAIL 02.3: user B could SELECT user A''s ink stroke'; end if;

  update public.tags set name = 'hijacked' where id = '00000000-0000-4000-8000-00000000a001';
  get diagnostics v_n = row_count;
  if v_n <> 0 then raise exception 'FAIL 02.4: user B could UPDATE user A''s tag (% rows)', v_n; end if;

  delete from public.pieces where id = '00000000-0000-4000-8000-00000000a002';
  get diagnostics v_n = row_count;
  if v_n <> 0 then raise exception 'FAIL 02.5: user B could DELETE user A''s piece (% rows)', v_n; end if;
end $$;

-- sync_upsert must refuse an ownership takeover with a named error (42501), not a silent no-op and
-- not a generic error - the client needs to be able to tell "lost the LWW race" (applied: false) apart
-- from "tried to touch someone else's row" (exception).
do $$
begin
  perform public.sync_upsert('tags', jsonb_build_object(
    'id', '00000000-0000-4000-8000-00000000a001',
    'name', 'hijacked via RPC', 'created_at', now(), 'updated_at', now()
  ));
  raise exception 'FAIL 02.6: sync_upsert let user B overwrite user A''s tag';
exception
  when sqlstate '42501' then null; -- expected
end $$;

-- A child row can't be smuggled in against someone else's parent either: user B inserting a *new*
-- ink_strokes row that points at A's piece_id should fail the FK-owner mismatch the same way (the
-- row would be owned by B per sync_upsert's forced owner_column, but piece_id references a piece B
-- does not own - there is no DB constraint tying ink_strokes.owner_id to pieces.owner_id, so this is
-- specifically a product-layer expectation, not RLS; documented here as a known gap, not asserted).

-- ---------------------------------------------------------------------------
-- Back as user A: confirm B's blocked attempts left everything untouched, and A can still read it.
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"__USER_A_ID__","role":"authenticated"}';

do $$
declare
  v_name text;
  v_exists boolean;
begin
  select name into v_name from public.tags where id = '00000000-0000-4000-8000-00000000a001';
  if v_name is distinct from 'A''s private tag' then
    raise exception 'FAIL 02.7: user A''s tag was mutated by user B''s blocked attempts (got %)', v_name;
  end if;

  select exists(select 1 from public.pieces where id = '00000000-0000-4000-8000-00000000a002') into v_exists;
  if not v_exists then raise exception 'FAIL 02.8: user A''s piece was deleted by user B''s blocked attempt'; end if;
end $$;

-- Legitimate same-owner update through the RPC must still work (proves the isolation checks above
-- aren't accidentally blocking the *owner* too).
select public.sync_upsert('tags', jsonb_build_object(
  'id', '00000000-0000-4000-8000-00000000a001',
  'name', 'A''s renamed tag', 'created_at', now(), 'updated_at', now() + interval '1 second'
));

do $$
declare
  v_name text;
begin
  select name into v_name from public.tags where id = '00000000-0000-4000-8000-00000000a001';
  if v_name <> 'A''s renamed tag' then
    raise exception 'FAIL 02.9: user A could not update their own tag via sync_upsert (got %)', v_name;
  end if;
end $$;

rollback;

select 'PASS 02: owner-only isolation holds for direct SELECT/UPDATE/DELETE and sync_upsert, and does not block the real owner' as result;
