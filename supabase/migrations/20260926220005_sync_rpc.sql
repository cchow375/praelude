-- Praelude backend: the sync RPCs (spec 4a/4d). Full protocol write-up: supabase/(C) Sync Protocol.md.
--
-- Design choice, documented in depth in the sync protocol doc: this does NOT implement a fully
-- generic per-field jsonb-clocks merge. Schema3.md explicitly considered and rejected a generic
-- per-field [String: Date] clock on the client ("heavy, easy to let drift, awkward to keep
-- Codable-stable") in favor of whole-record LWW everywhere except two named exceptions, both of
-- which already have purpose-built solutions: ink is per-row (each stroke IS its own LWW unit), and
-- Piece.lastPage gets its own named clock. Reinventing a generic mechanism server-side would
-- contradict the client's own considered design. So: one generic whole-row-LWW upsert RPC for
-- ordinary sync tables, a generic append-only insert RPC for event logs, and two small dedicated
-- RPCs for the two real exceptions (last_page, attempt undo).

-- ---------------------------------------------------------------------------
-- sync_upsert: whole-row LWW upsert for any table in public.sync_tables.
--
-- p_row must include "id" (or, for the two owner_id-keyed settings singletons,
-- may omit it) and "updated_at". owner_id is always forced to auth.uid() and
-- can never be set by the payload; created_at is preserved from the existing
-- row and only taken from the payload on first insert.
--
-- Returns {"applied": true, "row": <the stored row now>} when the write was
-- applied (including plain inserts), or {"applied": false, "row": <the
-- server's newer row>} when the incoming write lost to a newer stored
-- updated_at - the client should adopt the returned row rather than retry.
-- ---------------------------------------------------------------------------

create or replace function public.sync_upsert(p_table text, p_row jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid := auth.uid();
  v_conflict_column text;
  v_key_value text;
  v_incoming_updated_at timestamptz;
  v_stored_owner uuid;
  v_stored_updated_at timestamptz;
  v_set_clause text;
  v_merged jsonb;
  v_result jsonb;
begin
  if v_owner is null then
    raise exception 'sync_upsert: must be called as an authenticated user' using errcode = '42501';
  end if;

  select conflict_column into v_conflict_column
    from public.sync_tables where table_name = p_table;
  if v_conflict_column is null then
    raise exception 'sync_upsert: % is not a syncable table', p_table using errcode = '42501';
  end if;

  v_incoming_updated_at := (p_row->>'updated_at')::timestamptz;
  if v_incoming_updated_at is null then
    raise exception 'sync_upsert: row must include updated_at';
  end if;

  if v_conflict_column = 'owner_id' then
    v_key_value := v_owner::text;
  else
    v_key_value := p_row->>'id';
    if v_key_value is null then
      raise exception 'sync_upsert: row must include id';
    end if;
  end if;

  execute format('select owner_id, updated_at from %I where %I = $1', p_table, v_conflict_column)
    into v_stored_owner, v_stored_updated_at
    using v_key_value::uuid;

  if v_stored_owner is not null and v_stored_owner <> v_owner then
    raise exception 'sync_upsert: row belongs to another owner' using errcode = '42501';
  end if;

  if v_stored_updated_at is not null and v_stored_updated_at > v_incoming_updated_at then
    execute format('select to_jsonb(t) from %I t where %I = $1', p_table, v_conflict_column)
      into v_result using v_key_value::uuid;
    return jsonb_build_object('applied', false, 'row', v_result);
  end if;

  -- owner_id is always forced server-side, regardless of what (if anything) the payload said.
  v_merged := p_row || jsonb_build_object('owner_id', to_jsonb(v_owner));

  select string_agg(format('%1$I = excluded.%1$I', column_name), ', ')
    into v_set_clause
    from information_schema.columns
    where table_schema = 'public' and table_name = p_table
      and column_name not in ('id', 'owner_id', 'created_at');

  execute format(
    'insert into %1$I select (jsonb_populate_record(null::%1$I, $1)).*
     on conflict (%2$I) do update set %3$s
     where %1$I.owner_id = $2
     returning to_jsonb(%1$I.*)',
    p_table, v_conflict_column, v_set_clause
  )
  into v_result
  using v_merged, v_owner;

  return jsonb_build_object('applied', true, 'row', v_result);
end;
$$;

revoke all on function public.sync_upsert(text, jsonb) from public;
grant execute on function public.sync_upsert(text, jsonb) to authenticated;

comment on function public.sync_upsert(text, jsonb) is
  'Whole-row last-write-wins upsert for any table in public.sync_tables. See supabase/(C) Sync Protocol.md.';

-- ---------------------------------------------------------------------------
-- sync_append: insert-only for any table in public.append_only_tables.
-- ON CONFLICT (id) DO NOTHING makes a retried push after a dropped response
-- idempotent rather than an error.
-- ---------------------------------------------------------------------------

create or replace function public.sync_append(p_table text, p_row jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid := auth.uid();
  v_merged jsonb;
  v_result jsonb;
begin
  if v_owner is null then
    raise exception 'sync_append: must be called as an authenticated user' using errcode = '42501';
  end if;

  if not exists (select 1 from public.append_only_tables t where t.table_name = p_table) then
    raise exception 'sync_append: % is not an append-only table', p_table using errcode = '42501';
  end if;

  v_merged := p_row || jsonb_build_object('owner_id', to_jsonb(v_owner));

  execute format(
    'insert into %1$I select (jsonb_populate_record(null::%1$I, $1)).*
     on conflict (id) do nothing
     returning to_jsonb(%1$I.*)',
    p_table
  )
  into v_result
  using v_merged;

  return jsonb_build_object('applied', v_result is not null, 'row', v_result);
end;
$$;

revoke all on function public.sync_append(text, jsonb) from public;
grant execute on function public.sync_append(text, jsonb) to authenticated;

comment on function public.sync_append(text, jsonb) is
  'Insert-only append for any table in public.append_only_tables. See supabase/(C) Sync Protocol.md.';

-- ---------------------------------------------------------------------------
-- The two named per-field-clock exceptions (Schema3.md), each its own tiny
-- dedicated RPC rather than a generalized mechanism - see file header.
-- ---------------------------------------------------------------------------

create or replace function public.sync_update_last_page(p_id uuid, p_last_page int, p_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid := auth.uid();
  v_stored timestamptz;
  v_result jsonb;
begin
  if v_owner is null then
    raise exception 'sync_update_last_page: must be called as an authenticated user' using errcode = '42501';
  end if;

  select last_page_updated_at into v_stored
    from public.pieces where id = p_id and owner_id = v_owner;
  if not found then
    raise exception 'sync_update_last_page: piece not found' using errcode = '42501';
  end if;

  if v_stored > p_at then
    select to_jsonb(t) into v_result from public.pieces t where t.id = p_id;
    return jsonb_build_object('applied', false, 'row', v_result);
  end if;

  update public.pieces
     set last_page = p_last_page, last_page_updated_at = p_at
   where id = p_id and owner_id = v_owner
   returning to_jsonb(pieces.*) into v_result;

  return jsonb_build_object('applied', true, 'row', v_result);
end;
$$;

revoke all on function public.sync_update_last_page(uuid, int, timestamptz) from public;
grant execute on function public.sync_update_last_page(uuid, int, timestamptz) to authenticated;

create or replace function public.sync_undo_attempt(p_id uuid, p_undone_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid := auth.uid();
  v_result jsonb;
begin
  if v_owner is null then
    raise exception 'sync_undo_attempt: must be called as an authenticated user' using errcode = '42501';
  end if;

  update public.attempts
     set undone_at = p_undone_at
   where id = p_id and owner_id = v_owner and undone_at is null
   returning to_jsonb(attempts.*) into v_result;

  return jsonb_build_object('applied', v_result is not null, 'row', v_result);
end;
$$;

revoke all on function public.sync_undo_attempt(uuid, timestamptz) from public;
grant execute on function public.sync_undo_attempt(uuid, timestamptz) to authenticated;

comment on function public.sync_undo_attempt(uuid, timestamptz) is
  'The one legitimate post-insert edit on an append-only attempt (spec 9 Undo). No-ops (applied: '
  'false, row: null) if already undone or not owned by the caller.';
