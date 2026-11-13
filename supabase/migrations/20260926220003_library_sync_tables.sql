-- Praelude backend: the schema3 "library" sync tables (spec 4d) - one table per Core collection in
-- ios/Praelude/Core, plus instruments (spec 6). Column names are the snake_case of the matching
-- Swift struct field; see supabase/(C) Sync Protocol.md for the full field-by-field mapping and for
-- why array-typed references (tag_ids, folder_ids, ...) are not hard foreign keys - Core itself only
-- does the same "cheap existence check" at the app layer, not a DB constraint.

-- ---------------------------------------------------------------------------
-- Shared setup for every owner-scoped, tombstone-deleted sync table: RLS
-- limited to the owning user, an updated_at trigger, and registration in the
-- sync_tables allow-list the generic sync_upsert() RPC reads (see
-- 20260926220005_sync_rpc.sql). No DELETE policy anywhere: deletion is a
-- deleted_at tombstone via UPDATE; the only true row delete is
-- delete_my_account() (SECURITY DEFINER, spec 4b).
-- ---------------------------------------------------------------------------

create or replace procedure public._setup_owner_table(p_table text, p_conflict_column text default 'id')
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
  execute format(
    'create policy %I on %I for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid())',
    p_table || '_update_own', p_table);
  execute format(
    'create trigger %I before update on %I for each row execute function public.set_updated_at()',
    p_table || '_set_updated_at', p_table);
  insert into public.sync_tables (table_name, conflict_column) values (p_table, p_conflict_column)
    on conflict (table_name) do update set conflict_column = excluded.conflict_column;
end;
$$;

-- ---------------------------------------------------------------------------
-- Enums for this migration's tables.
-- ---------------------------------------------------------------------------

create type public.piece_status as enum ('active', 'completed', 'resting');
create type public.learning_state as enum ('new', 'learning', 'review', 'performance_ready');
create type public.page_kind as enum ('original', 'blank', 'staff');
create type public.instrument_family as enum
  ('keyboard', 'strings', 'woodwinds', 'brass', 'percussion', 'voice', 'plucked_strings', 'other');
create type public.warmup_kind as enum ('scale', 'arpeggio', 'exercise', 'custom');
create type public.annotation_kind as enum ('text', 'stamp');
create type public.stamp_kind as enum
  ('fingering', 'dynamic', 'breath', 'bowing', 'accidental', 'circle', 'watch');
create type public.notebook_entry_kind as enum ('daily', 'lesson_note', 'lesson_prep');

-- ---------------------------------------------------------------------------
-- instruments (spec 6) - Instrument, one row per entry in the player's list.
-- ---------------------------------------------------------------------------

create table public.instruments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  family public.instrument_family not null,
  name text not null,
  level text not null default '',
  transposition_semitones int,
  transposition_label text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
call public._setup_owner_table('instruments');

-- ---------------------------------------------------------------------------
-- pieces - Piece. The PDF itself lives in the "scores" storage bucket at
-- scores/{owner_id}/{id}/{pdf_file_name}; this row is metadata only.
-- ---------------------------------------------------------------------------

create table public.pieces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  composer text not null default '',
  pdf_file_name text,
  page_count int not null default 0,
  last_page int not null default 1,
  status public.piece_status not null default 'active',
  notes text not null default '',
  instrument_id uuid references public.instruments (id) on delete set null,
  tag_ids uuid[] not null default '{}',
  folder_ids uuid[] not null default '{}',
  difficulty int,
  custom_cover_ref text,
  performance_dates timestamptz[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Second, independent clock (Schema3.md): a page turn must never race a deliberate metadata edit
  -- made offline on another device. Only sync_update_last_page() (20260926220005) advances this.
  last_page_updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
call public._setup_owner_table('pieces');

-- ---------------------------------------------------------------------------
-- passages - Passage (spec 8/11), with its embedded regions/schedule flattened.
-- ---------------------------------------------------------------------------

create table public.passages (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  piece_id uuid not null references public.pieces (id) on delete cascade,
  title text not null,
  start_measure int,
  end_measure int,
  page int not null default 1,
  focus text not null default 'Pulse',
  -- Array of PassageRegion {id,page,x,y,width,height}.
  regions jsonb not null default '[]'::jsonb,
  color text,
  parent_passage_id uuid references public.passages (id) on delete set null,
  joined_from_passage_ids uuid[] not null default '{}',
  archived boolean not null default false,
  learning_state public.learning_state not null default 'new',
  schedule_due_date timestamptz,
  schedule_interval_days int not null default 1,
  schedule_review_step int not null default 0,
  parked_until timestamptz,
  performance_tempo double precision,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
call public._setup_owner_table('passages');

-- ---------------------------------------------------------------------------
-- ink_strokes - InkStroke (spec 7). Each row is its own merge unit; no extra
-- clock mechanism is needed on top of the ordinary per-row updated_at.
-- ---------------------------------------------------------------------------

create table public.ink_strokes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  piece_id uuid not null references public.pieces (id) on delete cascade,
  page int not null,
  layer public.ink_layer not null default 'mine',
  data bytea not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
call public._setup_owner_table('ink_strokes');

-- ---------------------------------------------------------------------------
-- Library organization (spec 7): tags, folders, setlists, bookmarks,
-- page_edits, score_links, annotations (TextBoxAnnotation + StampAnnotation
-- unified with a kind discriminator).
-- ---------------------------------------------------------------------------

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
call public._setup_owner_table('tags');

create table public.folders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  parent_folder_id uuid references public.folders (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
call public._setup_owner_table('folders');

create table public.setlists (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  -- Array of SetlistItem {id,pieceID,movementLabel?,startPage?,endPage?}.
  items jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
call public._setup_owner_table('setlists');

create table public.bookmarks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  piece_id uuid not null references public.pieces (id) on delete cascade,
  page int not null,
  label text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
call public._setup_owner_table('bookmarks');

create table public.page_edits (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  piece_id uuid not null references public.pieces (id) on delete cascade,
  source_page int,
  display_order int not null,
  kind public.page_kind not null default 'original',
  -- NormalizedRect {x,y,width,height}, nullable.
  crop_rect jsonb,
  rotation_degrees int not null default 0,
  -- Core's own "removed from reading order" flag - distinct from the sync tombstone deleted_at below.
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
call public._setup_owner_table('page_edits');

create table public.score_links (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  piece_id uuid not null references public.pieces (id) on delete cascade,
  source_page int not null,
  source_region jsonb,
  target_page int not null,
  target_region jsonb,
  label text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
call public._setup_owner_table('score_links');

create table public.annotations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  piece_id uuid not null references public.pieces (id) on delete cascade,
  page int not null,
  region jsonb not null,
  layer public.ink_layer not null default 'mine',
  kind public.annotation_kind not null,
  -- kind = 'text':
  text text,
  -- kind = 'stamp':
  stamp_kind public.stamp_kind,
  stamp_label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint annotations_kind_shape check (
    (kind = 'text' and text is not null and stamp_kind is null)
    or (kind = 'stamp' and stamp_kind is not null and text is null)
  )
);
call public._setup_owner_table('annotations');

-- ---------------------------------------------------------------------------
-- Warmups (spec 12), recordings metadata (spec 13; bytes live in the
-- "recordings" storage bucket), notebook (spec 15), goals, routines.
-- ---------------------------------------------------------------------------

create table public.warmup_exercises (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  kind public.warmup_kind not null,
  key text not null default '',
  mode text,
  instrument_family public.instrument_family,
  custom_from_passage_id uuid references public.passages (id) on delete set null,
  name text not null,
  is_favorite boolean not null default false,
  last_used_at timestamptz,
  use_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
call public._setup_owner_table('warmup_exercises');

create table public.audio_recordings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  passage_id uuid references public.passages (id) on delete set null,
  set_id uuid,
  date timestamptz not null default now(),
  file_name text not null,
  duration double precision not null default 0,
  byte_size bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
call public._setup_owner_table('audio_recordings');

create table public.notebook_entries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  kind public.notebook_entry_kind not null,
  piece_id uuid references public.pieces (id) on delete cascade,
  date timestamptz not null default now(),
  text text not null default '',
  passage_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
call public._setup_owner_table('notebook_entries');

create table public.practice_goals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  piece_id uuid references public.pieces (id) on delete cascade,
  due_date timestamptz,
  is_complete boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
call public._setup_owner_table('practice_goals');

create table public.practice_routines (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  -- Array of VariantStage {id,name,targetCount}.
  stages jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
call public._setup_owner_table('practice_routines');

-- ---------------------------------------------------------------------------
-- rule_settings / rewards_state - RuleSettings/RewardsState (spec 11/14):
-- one row per user, keyed by owner_id itself (Core gives these no `id`
-- either - record-level LWW is the documented right granularity for a
-- settings-like record). sync_upsert() targets ON CONFLICT (owner_id) for
-- these two - see conflict_column below.
-- ---------------------------------------------------------------------------

create table public.rule_settings (
  owner_id uuid primary key references auth.users (id) on delete cascade,
  r1_enabled boolean not null default true,
  r1_max_measures int not null default 4,
  r1_max_systems double precision not null default 2.0,
  r2_enabled boolean not null default true,
  r3_enabled boolean not null default true,
  r4_enabled boolean not null default true,
  r4_clean_intervals_days int[] not null default '{1,3,7,14,30}',
  r4_shaky_interval_days int not null default 2,
  r5_enabled boolean not null default true,
  r5_learning_streak int not null default 5,
  r5_review_streak int not null default 3,
  r6_enabled boolean not null default true,
  r6_resets_before_step_down int not null default 3,
  r6_step_down_percent double precision not null default 6.0,
  r7_enabled boolean not null default true,
  r7_max_increases_per_day int not null default 2,
  r8_enabled boolean not null default true,
  r8_taps_to_offer_split int not null default 3,
  r9_enabled boolean not null default true,
  r9_minutes int not null default 10,
  r9_sets int not null default 3,
  r10_enabled boolean not null default true,
  r10_distinct_days int not null default 3,
  r10_requires_first_in_session boolean not null default true,
  r11_enabled boolean not null default true,
  r11_final_week_days int not null default 7,
  r11_final_two_weeks_days int not null default 14,
  r12_enabled boolean not null default true,
  r12_slow_downs_per_day int not null default 2,
  r13_enabled boolean not null default true,
  r13_consecutive_missed int not null default 2,
  r14_enabled boolean not null default true,
  r14_dropout_bars int not null default 2,
  r15_enabled boolean not null default true,
  r15_max_new_per_session int not null default 3,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
call public._setup_owner_table('rule_settings', 'owner_id');

create table public.rewards_state (
  owner_id uuid primary key references auth.users (id) on delete cascade,
  rank text not null default 'Unranked',
  division int not null default 1,
  streak_days int not null default 0,
  streak_freezes_available int not null default 0,
  last_practice_date timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
call public._setup_owner_table('rewards_state', 'owner_id');

-- ---------------------------------------------------------------------------
-- Practice sessions/sets stay mutable while running (spec 10); attempts and
-- every other event log are append-only and live in
-- 20260926220004_logs_sync_tables.sql.
-- ---------------------------------------------------------------------------

create table public.practice_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  piece_id uuid not null references public.pieces (id) on delete cascade,
  focus text not null default '',
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  active_seconds double precision not null default 0,
  completed_sets int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
call public._setup_owner_table('practice_sessions');

create table public.sets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  session_id uuid references public.practice_sessions (id) on delete cascade,
  -- PracticeConfiguration, flattened.
  piece_id uuid not null references public.pieces (id) on delete cascade,
  passage_id uuid references public.passages (id) on delete set null,
  focus text not null default 'Pulse',
  goal text not null default 'tempo',
  basis text not null default 'cleanStreak',
  target_count int not null default 5,
  start_bpm double precision not null default 60,
  target_bpm double precision not null default 60,
  tempo_step jsonb not null default '{"kind":"fixed","amount":4}',
  stages jsonb not null default '[]'::jsonb,
  hands text not null default 'Both hands',
  use_metronome boolean not null default false,
  passage_snapshot jsonb,
  -- ActiveSet's own running state.
  current_bpm double precision not null default 60,
  stage_index int not null default 0,
  streak int not null default 0,
  total_plays int not null default 0,
  completed_stages int not null default 0,
  status text not null default 'running',
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  active_seconds double precision not null default 0,
  last_checkpoint timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint sets_status_check check (status in ('running', 'paused', 'completed', 'ended'))
);
call public._setup_owner_table('sets');

comment on table public.sets is
  'ActiveSet (spec 10): both the single live set and every finished history entry, distinguished by '
  'status. Mutable while running (pause/resume/tempo must propagate across devices); attempts within '
  'it are the append-only child rows in public.attempts.';
