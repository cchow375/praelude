-- Preserve preference keys introduced by future clients while current known fields follow
-- the same atomic row-clock comparison. Clients send every known choice, including false.
-- Other nested model JSON stays explicitly versioned; this is not an arbitrary JSON merge.
create or replace function public.sync_upsert(p_table text, p_row jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid := auth.uid();
  v_conflict_column text;
  v_owner_column text;
  v_key_value text;
  v_incoming_updated_at timestamptz;
  v_stored_owner uuid;
  v_set_clause text;
  v_columns text;
  v_select_columns text;
  v_merged jsonb;
  v_result jsonb;
begin
  if v_owner is null then
    raise exception 'sync_upsert: must be called as an authenticated user' using errcode = '42501';
  end if;

  select conflict_column, owner_column into v_conflict_column, v_owner_column
    from public.sync_tables where table_name = p_table;
  if v_conflict_column is null then
    raise exception 'sync_upsert: % is not a syncable table', p_table using errcode = '42501';
  end if;

  v_incoming_updated_at := (p_row->>'updated_at')::timestamptz;
  if v_incoming_updated_at is null then
    raise exception 'sync_upsert: row must include updated_at';
  end if;

  if v_conflict_column = v_owner_column then
    -- Owner-keyed singleton (rule_settings, rewards_state) or an id-is-the-owner table (profiles):
    -- the row this call can possibly touch is always the caller's own.
    v_key_value := v_owner::text;
  else
    v_key_value := p_row->>v_conflict_column;
    if v_key_value is null then
      raise exception 'sync_upsert: row must include %', v_conflict_column;
    end if;
  end if;

  -- Ownership pre-check: a clear, named error instead of a silent no-op. This is NOT the LWW
  -- decision (see below) - it only confirms the caller cannot even attempt another owner's row.
  execute format('select %I from %I where %I = $1', v_owner_column, p_table, v_conflict_column)
    into v_stored_owner
    using v_key_value::uuid;

  if v_stored_owner is not null and v_stored_owner <> v_owner then
    raise exception 'sync_upsert: row belongs to another owner' using errcode = '42501';
  end if;

  -- owner_column is always forced server-side, regardless of what (if anything) the payload said.
  v_merged := p_row || jsonb_build_object(v_owner_column, to_jsonb(v_owner));

  select string_agg(case
      when p_table = 'account_preferences' and column_name = 'preferences'
        then format('preferences = %I.preferences || excluded.preferences', p_table)
      else format('%1$I = excluded.%1$I', column_name)
    end, ', ')
    into v_set_clause
    from information_schema.columns
    where table_schema = 'public' and table_name = p_table
      and column_name not in (v_conflict_column, v_owner_column, 'created_at')
      and v_merged ? column_name;

  select string_agg(format('%I', column_name), ', ' order by ordinal_position),
         string_agg(format('r.%I', column_name), ', ' order by ordinal_position)
    into v_columns, v_select_columns
    from information_schema.columns
    where table_schema = 'public' and table_name = p_table and v_merged ? column_name;

  -- The WHERE clause on DO UPDATE *is* the LWW decision, made atomically against whatever is
  -- currently committed for this row. Postgres holds a lock on the conflicting row for the duration
  -- of this statement, so a concurrent second writer blocks until the first commits, then
  -- re-evaluates this WHERE against the first writer's already-applied row - never a snapshot taken
  -- before either of them ran. A rejected write matches zero rows, so RETURNING yields nothing and
  -- v_result stays null (checked below), rather than silently reporting success.
  execute format(
    'insert into %1$I (%5$s) select %6$s from jsonb_populate_record(null::%1$I, $1) r
     on conflict (%2$I) do update set %3$s
     where %1$I.%4$I = $2 and %1$I.updated_at <= excluded.updated_at
     returning to_jsonb(%1$I.*)',
    p_table, v_conflict_column, v_set_clause, v_owner_column, v_columns, v_select_columns
  )
  into v_result
  using v_merged, v_owner;

  if v_result is null then
    execute format('select to_jsonb(t) from %1$I t where t.%2$I = $1 and t.%3$I = $2', p_table, v_conflict_column, v_owner_column)
      into v_result using v_key_value::uuid, v_owner;
    if v_result is null then
      raise exception 'sync_upsert: row unavailable or belongs to another owner' using errcode = '42501';
    end if;
    return jsonb_build_object('applied', false, 'row', v_result);
  end if;

  return jsonb_build_object('applied', true, 'row', v_result);
end;
$$;

revoke all on function public.sync_upsert(text, jsonb) from public;
grant execute on function public.sync_upsert(text, jsonb) to authenticated;

comment on function public.sync_upsert(text, jsonb) is
  'Owner-scoped last-write-wins upsert; absent columns and unknown preference keys survive older clients. See supabase/(C) Sync Protocol.md.';
