-- Praelude backend: fix _enforce_owned_piece_passage (found by supabase/tests/03: inserting a note
-- crashed every time with `record "new" has no field "passage_id"`).
--
-- This trigger function is shared by activity_events_ownership (on activity_events, which has both
-- piece_id and passage_id) and notes_ownership (on notes, which only ever had piece_id - see its
-- table definition). A generic trigger function's NEW is a `record`; `new.passage_id` requires that
-- column to actually exist on whichever table fired the trigger, so every notes insert failed outright
-- rather than just skipping a check that does not apply to notes. Fixed the same way
-- enforce_no_blocked_words already handles running across differently-shaped tables: read the field
-- dynamically through to_jsonb(new) instead of a direct new.passage_id, so a table without the column
-- simply gets null (check skipped) instead of an error. new.piece_id is untouched - every table this
-- trigger fires on does have that column.

create or replace function public._enforce_owned_piece_passage()
returns trigger
language plpgsql
as $$
declare
  v_passage_id uuid;
begin
  if new.piece_id is not null and not exists (
    select 1 from public.pieces p where p.id = new.piece_id and p.owner_id = new.owner_id
  ) then
    raise exception '%: piece_id must belong to the same owner', tg_table_name using errcode = '23514';
  end if;

  v_passage_id := (to_jsonb(new) ->> 'passage_id')::uuid;
  if v_passage_id is not null and not exists (
    select 1 from public.passages p where p.id = v_passage_id and p.owner_id = new.owner_id
  ) then
    raise exception '%: passage_id must belong to the same owner', tg_table_name using errcode = '23514';
  end if;

  return new;
end;
$$;
