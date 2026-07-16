//! Schema migrations, gated by `PRAGMA user_version`.
//!
//! Single-step v1 migration: apply the full schema (spec §5) when the database
//! reports `user_version == 0`, then stamp it to `SCHEMA_VERSION`. JSON-shaped
//! columns are stored as `TEXT` (SQLite has no native JSON type; values are
//! serialized JSON strings).

use rusqlite::Connection;

/// Current schema version. `Store::open` migrates any older database up to this.
pub const SCHEMA_VERSION: i32 = 10;

/// Full schema for v1. Column lists come verbatim from spec §5.
pub(crate) const SCHEMA_V1: &str = "\
CREATE TABLE piece (
    id            INTEGER PRIMARY KEY,
    title         TEXT NOT NULL,
    composer      TEXT,
    xml_path      TEXT,
    pdf_path      TEXT,
    goals         TEXT,          -- JSON
    deadline      TEXT,
    target_tempo  INTEGER,
    hard_spots    TEXT,          -- JSON
    intake_done   INTEGER NOT NULL DEFAULT 0,
    notes         TEXT
);

CREATE TABLE rep_block (
    id             INTEGER PRIMARY KEY,
    piece_id       INTEGER NOT NULL REFERENCES piece(id),
    m_start        INTEGER,
    m_end          INTEGER,
    label          TEXT,
    start_bpm      INTEGER,
    target_bpm     INTEGER,
    increment_rule TEXT,          -- JSON
    planned_reps   INTEGER,
    variants       TEXT,          -- JSON
    status         TEXT,
    created_at     TEXT
);

CREATE TABLE rep (
    id       INTEGER PRIMARY KEY,
    block_id INTEGER NOT NULL REFERENCES rep_block(id),
    ts       TEXT,
    bpm      INTEGER,
    variant  TEXT,
    verdict  TEXT CHECK (verdict IN ('clean', 'flawed', 'failed')),
    note     TEXT
);

CREATE TABLE session (
    id         INTEGER PRIMARY KEY,
    started_at TEXT,
    ended_at   TEXT,
    summary_md TEXT
);

CREATE TABLE session_event (
    id         INTEGER PRIMARY KEY,
    session_id INTEGER REFERENCES session(id),
    ts         TEXT,
    kind       TEXT,
    payload    TEXT               -- JSON
);

CREATE TABLE spot_review (
    piece_id      INTEGER NOT NULL REFERENCES piece(id),
    spot          TEXT NOT NULL,
    last_seen     TEXT,
    interval_days INTEGER,
    ease          REAL,
    PRIMARY KEY (piece_id, spot)
);

CREATE TABLE setting (
    key   TEXT PRIMARY KEY,
    value TEXT
);
";

/// Schema v2 (spec §5, the real P3 data layer). Column lists come verbatim from
/// the task-15 brief.
///
/// WHY this drops and recreates rather than `ALTER`s: the v1 `piece`/`rep_block`/
/// `rep`/`session`/`session_event`/`spot_review` tables were placeholder scaffolding
/// — the shipped app only ever wrote the `setting` table. So there is no piece data
/// to preserve, and the v2 shapes differ substantially (piece gains
/// `folder_path`/`current_state`/`created_at` and a UNIQUE key, integer BPM/tempo
/// columns become REAL, JSON columns gain NOT NULL defaults, CHECK constraints are
/// added). Dropping the empty placeholders and creating the real tables is both
/// correct and far simpler than a column-by-column `ALTER`. Crucially the `setting`
/// table is left untouched, so persisted settings survive the upgrade. Children are
/// dropped before parents so `PRAGMA foreign_keys = ON` does not object.
pub(crate) const SCHEMA_V2: &str = "\
DROP TABLE IF EXISTS spot_review;
DROP TABLE IF EXISTS session_event;
DROP TABLE IF EXISTS session;
DROP TABLE IF EXISTS rep;
DROP TABLE IF EXISTS rep_block;
DROP TABLE IF EXISTS piece;

CREATE TABLE piece (
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, composer TEXT,
  folder_path TEXT NOT NULL UNIQUE, xml_path TEXT, pdf_path TEXT,
  goals TEXT NOT NULL DEFAULT '[]', deadline TEXT, target_tempo REAL,
  hard_spots TEXT NOT NULL DEFAULT '[]', current_state TEXT,
  intake_done INTEGER NOT NULL DEFAULT 0, notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE rep_block (
  id INTEGER PRIMARY KEY, piece_id INTEGER NOT NULL REFERENCES piece(id),
  m_start INTEGER NOT NULL, m_end INTEGER NOT NULL, label TEXT,
  start_bpm REAL NOT NULL, target_bpm REAL,
  increment_rule TEXT NOT NULL, planned_reps INTEGER NOT NULL,
  variants TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','done','abandoned')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE rep (
  id INTEGER PRIMARY KEY, block_id INTEGER NOT NULL REFERENCES rep_block(id),
  ts TEXT NOT NULL DEFAULT (datetime('now')), bpm REAL NOT NULL, variant TEXT,
  verdict TEXT NOT NULL CHECK(verdict IN ('clean','flawed','failed')), note TEXT
);
CREATE TABLE session (
  id INTEGER PRIMARY KEY, started_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT, summary_md TEXT
);
CREATE TABLE session_event (
  id INTEGER PRIMARY KEY, session_id INTEGER NOT NULL REFERENCES session(id),
  ts TEXT NOT NULL DEFAULT (datetime('now')), kind TEXT NOT NULL, payload TEXT NOT NULL
);
CREATE TABLE spot_review (
  piece_id INTEGER NOT NULL REFERENCES piece(id), spot TEXT NOT NULL,
  last_seen TEXT, interval_days REAL NOT NULL DEFAULT 1.0, ease REAL NOT NULL DEFAULT 2.5,
  PRIMARY KEY (piece_id, spot)
);
";

/// Schema v3 — strictly additive in effect (all v2 rows preserved). New tables,
/// a `rep_block` rebuild that relaxes BPM/ladder NOT NULLs and adds
/// region_id/focus/use_metronome, and `session.focused_seconds`. The rebuild copies
/// every existing row; it is the only way SQLite can drop a NOT NULL constraint.
pub(crate) const SCHEMA_V3: &str = "\
CREATE TABLE region (
  id INTEGER PRIMARY KEY,
  piece_id INTEGER NOT NULL REFERENCES piece(id),
  name TEXT NOT NULL,
  m_start INTEGER NOT NULL,
  m_end INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'section'
       CHECK(kind IN ('section','phrase','group','hard_spot','custom')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  color TEXT,
  pdf_anchor TEXT                       -- reserved for P4 (JSON), nullable
);
CREATE TABLE goal (
  id INTEGER PRIMARY KEY,
  piece_id INTEGER NOT NULL REFERENCES piece(id),
  text TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'big' CHECK(kind IN ('big','sub')),
  parent_goal_id INTEGER REFERENCES goal(id),
  done INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  target_date TEXT,
  created_ts TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE event (
  id INTEGER PRIMARY KEY,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  session_id INTEGER REFERENCES session(id),
  piece_id INTEGER REFERENCES piece(id),
  kind TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}'    -- JSON
);

-- rep_block rebuild: relax start_bpm/increment_rule NOT NULL, add v3 columns.
CREATE TABLE rep_block_v3 (
  id INTEGER PRIMARY KEY,
  piece_id INTEGER NOT NULL REFERENCES piece(id),
  m_start INTEGER NOT NULL, m_end INTEGER NOT NULL, label TEXT,
  start_bpm REAL, target_bpm REAL,
  increment_rule TEXT, planned_reps INTEGER NOT NULL DEFAULT 0,
  variants TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','done','abandoned')),
  region_id INTEGER REFERENCES region(id),
  focus TEXT NOT NULL DEFAULT 'tempo'
       CHECK(focus IN ('tempo','notes','phrasing','dynamics','memory','hands','other')),
  use_metronome INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO rep_block_v3
  (id,piece_id,m_start,m_end,label,start_bpm,target_bpm,increment_rule,planned_reps,variants,status,created_at)
  SELECT id,piece_id,m_start,m_end,label,start_bpm,target_bpm,increment_rule,planned_reps,variants,status,created_at
  FROM rep_block;
DROP TABLE rep_block;
ALTER TABLE rep_block_v3 RENAME TO rep_block;

ALTER TABLE session ADD COLUMN focused_seconds INTEGER;
";

/// Schema v4 — remember the user's chosen PDF edition separately from the
/// scanner-owned `pdf_path`. Rescans may refresh `pdf_path`; they must never
/// overwrite this explicit preference.
pub(crate) const SCHEMA_V4: &str = "\
ALTER TABLE piece ADD COLUMN preferred_pdf_path TEXT;
";

/// Schema v5 — explicit calendar work attached to canonical Goals. Dates have
/// structural and Gregorian checks at the SQLite boundary; Rust applies the
/// same strict shared parser before writes. `origin_date` is additionally
/// protected by a trigger so later update code cannot accidentally rewrite
/// recovery history.
pub(crate) const SCHEMA_V5: &str = "\
CREATE TABLE daily_work (
  id INTEGER PRIMARY KEY,
  goal_id INTEGER NOT NULL REFERENCES goal(id) ON DELETE RESTRICT,
  region_id INTEGER REFERENCES region(id) ON DELETE RESTRICT,
  block_id INTEGER REFERENCES rep_block(id) ON DELETE RESTRICT,
  title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 500),
  planned_minutes INTEGER NOT NULL CHECK(planned_minutes BETWEEN 1 AND 240),
  origin_date TEXT NOT NULL CHECK(
    length(origin_date) = 10 AND
    origin_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND
    CAST(substr(origin_date, 1, 4) AS INTEGER) BETWEEN 1 AND 9999 AND
    CAST(substr(origin_date, 6, 2) AS INTEGER) BETWEEN 1 AND 12 AND
    CAST(substr(origin_date, 9, 2) AS INTEGER) BETWEEN 1 AND
      CASE CAST(substr(origin_date, 6, 2) AS INTEGER)
        WHEN 1 THEN 31 WHEN 3 THEN 31 WHEN 5 THEN 31 WHEN 7 THEN 31
        WHEN 8 THEN 31 WHEN 10 THEN 31 WHEN 12 THEN 31
        WHEN 4 THEN 30 WHEN 6 THEN 30 WHEN 9 THEN 30 WHEN 11 THEN 30
        WHEN 2 THEN CASE
          WHEN CAST(substr(origin_date, 1, 4) AS INTEGER) % 400 = 0 OR
               (CAST(substr(origin_date, 1, 4) AS INTEGER) % 4 = 0 AND
                CAST(substr(origin_date, 1, 4) AS INTEGER) % 100 != 0)
          THEN 29 ELSE 28 END
      END
  ),
  scheduled_date TEXT NOT NULL CHECK(
    length(scheduled_date) = 10 AND
    scheduled_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND
    CAST(substr(scheduled_date, 1, 4) AS INTEGER) BETWEEN 1 AND 9999 AND
    CAST(substr(scheduled_date, 6, 2) AS INTEGER) BETWEEN 1 AND 12 AND
    CAST(substr(scheduled_date, 9, 2) AS INTEGER) BETWEEN 1 AND
      CASE CAST(substr(scheduled_date, 6, 2) AS INTEGER)
        WHEN 1 THEN 31 WHEN 3 THEN 31 WHEN 5 THEN 31 WHEN 7 THEN 31
        WHEN 8 THEN 31 WHEN 10 THEN 31 WHEN 12 THEN 31
        WHEN 4 THEN 30 WHEN 6 THEN 30 WHEN 9 THEN 30 WHEN 11 THEN 30
        WHEN 2 THEN CASE
          WHEN CAST(substr(scheduled_date, 1, 4) AS INTEGER) % 400 = 0 OR
               (CAST(substr(scheduled_date, 1, 4) AS INTEGER) % 4 = 0 AND
                CAST(substr(scheduled_date, 1, 4) AS INTEGER) % 100 != 0)
          THEN 29 ELSE 28 END
      END
  ),
  status TEXT NOT NULL DEFAULT 'planned'
    CHECK(status IN ('planned','done','dismissed')),
  source TEXT NOT NULL CHECK(source IN ('manual','planner','recovery')),
  reschedule_count INTEGER NOT NULL DEFAULT 0 CHECK(reschedule_count >= 0),
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK(sort_order >= 0),
  completed_ts TEXT,
  created_ts TEXT NOT NULL DEFAULT (datetime('now')),
  updated_ts TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK((status = 'planned' AND completed_ts IS NULL) OR
        (status IN ('done','dismissed') AND completed_ts IS NOT NULL))
);
CREATE INDEX daily_work_scheduled_status_idx
  ON daily_work(scheduled_date, status, sort_order, id);
CREATE INDEX daily_work_goal_date_idx
  ON daily_work(goal_id, scheduled_date, sort_order, id);
CREATE INDEX daily_work_region_idx ON daily_work(region_id) WHERE region_id IS NOT NULL;
CREATE INDEX daily_work_block_idx ON daily_work(block_id) WHERE block_id IS NOT NULL;
CREATE TRIGGER daily_work_origin_date_immutable
BEFORE UPDATE OF origin_date ON daily_work
WHEN NEW.origin_date != OLD.origin_date
BEGIN
  SELECT RAISE(ABORT, 'daily_work.origin_date is immutable');
END;
";

/// Schema v6 — one durable disposition per legacy live-feed event. A mapped
/// row points to exactly one canonical event; safely skipped rows retain a
/// reason and no canonical link. The UNIQUE canonical id prevents two legacy
/// rows from claiming the same pre-existing event during conservative dedup.
pub(crate) const SCHEMA_V6: &str = "\
CREATE TABLE session_event_backfill (
  legacy_session_event_id INTEGER PRIMARY KEY
    REFERENCES session_event(id) ON DELETE RESTRICT,
  canonical_event_id INTEGER UNIQUE
    REFERENCES event(id) ON DELETE RESTRICT,
  disposition TEXT NOT NULL
    CHECK(disposition IN ('inserted','matched','skipped')),
  reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 100),
  migrated_ts TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK(
    (disposition IN ('inserted','matched') AND canonical_event_id IS NOT NULL) OR
    (disposition = 'skipped' AND canonical_event_id IS NULL)
  )
);
";

/// Schema v7 — separate the short Region header (`name`) from nullable,
/// detailed practice notes and add reusable, path-backed tutorial videos.
///
/// Existing Region text remains in `name` verbatim. Authored prose is also
/// copied into `notes`; generated `mm. …` labels leave `notes` NULL. Tutorial
/// media stays on disk: SQLite stores only the canonical path and chapter/clip
/// metadata, never video bytes.
pub(crate) const SCHEMA_V7: &str = "\
ALTER TABLE region ADD COLUMN notes TEXT
  CHECK(notes IS NULL OR length(notes) <= 10000);
-- v6 had only one text field. Keep every header byte-for-byte and seed detailed
-- notes from authored prose; generated `mm. …` labels carry no extra meaning.
UPDATE region SET notes = name
WHERE lower(trim(name)) NOT GLOB 'mm. *';

CREATE TABLE tutorial_video (
  id INTEGER PRIMARY KEY,
  piece_id INTEGER NOT NULL REFERENCES piece(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 500),
  file_path TEXT NOT NULL CHECK(length(trim(file_path)) BETWEEN 1 AND 4096),
  duration_seconds REAL CHECK(duration_seconds IS NULL OR duration_seconds > 0),
  created_ts TEXT NOT NULL DEFAULT (datetime('now')),
  updated_ts TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(piece_id, file_path)
);
CREATE INDEX tutorial_video_piece_idx
  ON tutorial_video(piece_id, title COLLATE NOCASE, id);

CREATE TABLE tutorial_chapter (
  id INTEGER PRIMARY KEY,
  video_id INTEGER NOT NULL REFERENCES tutorial_video(id) ON DELETE CASCADE,
  start_seconds REAL NOT NULL CHECK(start_seconds >= 0),
  end_seconds REAL NOT NULL CHECK(end_seconds > start_seconds),
  title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 500),
  notes TEXT CHECK(notes IS NULL OR length(notes) <= 10000),
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK(sort_order >= 0),
  created_ts TEXT NOT NULL DEFAULT (datetime('now')),
  updated_ts TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX tutorial_chapter_video_idx
  ON tutorial_chapter(video_id, sort_order, start_seconds, id);

-- A clip is the lightweight mapping from one reusable chapter to one Region.
-- This avoids duplicating timestamps/title/notes when a chapter demonstrates
-- more than one Tricky Section while retaining a flat IPC representation.
CREATE TABLE tutorial_clip (
  id INTEGER PRIMARY KEY,
  chapter_id INTEGER NOT NULL REFERENCES tutorial_chapter(id) ON DELETE CASCADE,
  region_id INTEGER NOT NULL REFERENCES region(id) ON DELETE CASCADE,
  UNIQUE(chapter_id, region_id)
);
CREATE INDEX tutorial_clip_region_idx
  ON tutorial_clip(region_id, id);
CREATE INDEX tutorial_clip_chapter_idx
  ON tutorial_clip(chapter_id, id);

-- A clip may only connect a Region to a video belonging to the same Piece.
-- Ordinary independent FKs cannot express that invariant without duplicating
-- piece_id on the clip, so enforce it for both insert and reassignment.
CREATE TRIGGER tutorial_clip_same_piece_insert
BEFORE INSERT ON tutorial_clip
WHEN (SELECT v.piece_id FROM tutorial_chapter c
      JOIN tutorial_video v ON v.id=c.video_id WHERE c.id=NEW.chapter_id) !=
     (SELECT piece_id FROM region WHERE id = NEW.region_id)
BEGIN
  SELECT RAISE(ABORT, 'tutorial clip video and region must belong to the same piece');
END;
CREATE TRIGGER tutorial_clip_same_piece_update
BEFORE UPDATE OF chapter_id, region_id ON tutorial_clip
WHEN (SELECT v.piece_id FROM tutorial_chapter c
      JOIN tutorial_video v ON v.id=c.video_id WHERE c.id=NEW.chapter_id) !=
     (SELECT piece_id FROM region WHERE id = NEW.region_id)
BEGIN
  SELECT RAISE(ABORT, 'tutorial clip video and region must belong to the same piece');
END;
CREATE TRIGGER tutorial_chapter_same_piece_update
BEFORE UPDATE OF video_id ON tutorial_chapter
WHEN EXISTS (
  SELECT 1 FROM tutorial_clip l
  JOIN region r ON r.id=l.region_id
  WHERE l.chapter_id=NEW.id AND r.piece_id !=
    (SELECT piece_id FROM tutorial_video WHERE id=NEW.video_id)
)
BEGIN
  SELECT RAISE(ABORT, 'shared tutorial chapter cannot move across linked pieces');
END;
";

/// Schema v8 — additive Practice OS sidecars around the immutable v1 graph.
///
/// The physical v1 tables and their ids remain authoritative compatibility
/// anchors. New semantics are attached one-to-one (target_meta, set_contract,
/// attempt_provenance) or appended (adjustments, anomalies, drafts, threads).
/// In particular this migration never rebuilds region/rep_block/rep and never
/// touches region.pdf_anchor.
pub(crate) const SCHEMA_V8: &str = "\
CREATE TABLE score_section (
  id INTEGER PRIMARY KEY,
  piece_id INTEGER NOT NULL REFERENCES piece(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 500),
  m_start INTEGER NOT NULL CHECK(m_start >= 1),
  m_end INTEGER NOT NULL CHECK(m_end >= m_start),
  source TEXT NOT NULL CHECK(source IN ('musicxml','user','import_review')),
  source_ref TEXT,
  created_ts TEXT NOT NULL DEFAULT (datetime('now')),
  updated_ts TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX score_section_piece_range_idx
  ON score_section(piece_id,m_start,m_end,id);

CREATE TABLE target_meta (
  region_id INTEGER PRIMARY KEY REFERENCES region(id) ON DELETE CASCADE,
  parent_region_id INTEGER REFERENCES region(id) ON DELETE SET NULL,
  score_section_id INTEGER REFERENCES score_section(id) ON DELETE SET NULL,
  color TEXT,
  archived_ts TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  mapping_evidence_version INTEGER NOT NULL DEFAULT 1
    CHECK(mapping_evidence_version >= 1),
  created_ts TEXT NOT NULL DEFAULT (datetime('now')),
  updated_ts TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK(parent_region_id IS NULL OR parent_region_id != region_id)
);
CREATE INDEX target_meta_parent_idx
  ON target_meta(parent_region_id) WHERE parent_region_id IS NOT NULL;
CREATE INDEX target_meta_section_idx
  ON target_meta(score_section_id) WHERE score_section_id IS NOT NULL;
CREATE TRIGGER target_meta_same_piece_insert
BEFORE INSERT ON target_meta
WHEN (NEW.parent_region_id IS NOT NULL AND
      (SELECT piece_id FROM region WHERE id=NEW.parent_region_id) !=
      (SELECT piece_id FROM region WHERE id=NEW.region_id))
  OR (NEW.score_section_id IS NOT NULL AND
      (SELECT piece_id FROM score_section WHERE id=NEW.score_section_id) !=
      (SELECT piece_id FROM region WHERE id=NEW.region_id))
BEGIN
  SELECT RAISE(ABORT, 'target parent and section must belong to the same piece');
END;
CREATE TRIGGER target_meta_same_piece_update
BEFORE UPDATE OF region_id,parent_region_id,score_section_id ON target_meta
WHEN (NEW.parent_region_id IS NOT NULL AND
      (SELECT piece_id FROM region WHERE id=NEW.parent_region_id) !=
      (SELECT piece_id FROM region WHERE id=NEW.region_id))
  OR (NEW.score_section_id IS NOT NULL AND
      (SELECT piece_id FROM score_section WHERE id=NEW.score_section_id) !=
      (SELECT piece_id FROM region WHERE id=NEW.region_id))
BEGIN
  SELECT RAISE(ABORT, 'target parent and section must belong to the same piece');
END;

CREATE TABLE score_edition_calibration (
  id INTEGER PRIMARY KEY,
  piece_id INTEGER NOT NULL REFERENCES piece(id) ON DELETE CASCADE,
  edition_id TEXT NOT NULL CHECK(length(trim(edition_id)) BETWEEN 1 AND 4096),
  edition_fingerprint TEXT NOT NULL
    CHECK(length(trim(edition_fingerprint)) BETWEEN 1 AND 500),
  method TEXT NOT NULL CHECK(method IN ('exact_xml','user_confirmed','calibrated')),
  confidence REAL NOT NULL CHECK(confidence >= 0.0 AND confidence <= 1.0),
  points_json TEXT NOT NULL DEFAULT '[]',
  user_verified INTEGER NOT NULL DEFAULT 0 CHECK(user_verified IN (0,1)),
  created_ts TEXT NOT NULL DEFAULT (datetime('now')),
  updated_ts TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(piece_id,edition_id,edition_fingerprint)
);
CREATE INDEX score_calibration_edition_idx
  ON score_edition_calibration(piece_id,edition_fingerprint,id);

CREATE TABLE protocol_template (
  id TEXT PRIMARY KEY CHECK(length(trim(id)) BETWEEN 1 AND 200),
  contract_version INTEGER NOT NULL CHECK(contract_version >= 1),
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 500),
  rationale TEXT NOT NULL CHECK(length(trim(rationale)) BETWEEN 1 AND 4000),
  mastery_basis TEXT NOT NULL CHECK(mastery_basis IN
    ('consecutive_clean','total_clean','timed_exposure','exploratory','legacy_attempt_count')),
  required_success INTEGER NOT NULL CHECK(required_success >= 0),
  reset_on_flawed INTEGER NOT NULL CHECK(reset_on_flawed IN (0,1)),
  reset_on_failed INTEGER NOT NULL CHECK(reset_on_failed IN (0,1)),
  recovery_policy TEXT NOT NULL CHECK(recovery_policy IN ('none','fixed','adaptive')),
  recovery_value INTEGER NOT NULL DEFAULT 0 CHECK(recovery_value >= 0),
  recovery_minimum INTEGER NOT NULL DEFAULT 0 CHECK(recovery_minimum >= 0),
  tempo_policy_json TEXT NOT NULL DEFAULT '{}',
  attempt_ceiling INTEGER CHECK(attempt_ceiling IS NULL OR attempt_ceiling >= 1),
  planned_seconds INTEGER CHECK(planned_seconds IS NULL OR planned_seconds >= 1),
  retention_delay_days INTEGER
    CHECK(retention_delay_days IS NULL OR retention_delay_days >= 0),
  source_refs_json TEXT NOT NULL DEFAULT '[]',
  user_editable INTEGER NOT NULL DEFAULT 1 CHECK(user_editable IN (0,1)),
  created_ts TEXT NOT NULL DEFAULT (datetime('now')),
  updated_ts TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE set_contract (
  set_id INTEGER PRIMARY KEY REFERENCES rep_block(id) ON DELETE CASCADE,
  template_id TEXT REFERENCES protocol_template(id) ON DELETE SET NULL,
  contract_version INTEGER NOT NULL CHECK(contract_version >= 1),
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 500),
  rationale TEXT NOT NULL CHECK(length(trim(rationale)) BETWEEN 1 AND 4000),
  mastery_basis TEXT NOT NULL CHECK(mastery_basis IN
    ('consecutive_clean','total_clean','timed_exposure','exploratory','legacy_attempt_count')),
  required_success INTEGER NOT NULL CHECK(required_success >= 0),
  reset_on_flawed INTEGER NOT NULL CHECK(reset_on_flawed IN (0,1)),
  reset_on_failed INTEGER NOT NULL CHECK(reset_on_failed IN (0,1)),
  recovery_policy TEXT NOT NULL CHECK(recovery_policy IN ('none','fixed','adaptive')),
  recovery_value INTEGER NOT NULL DEFAULT 0 CHECK(recovery_value >= 0),
  recovery_minimum INTEGER NOT NULL DEFAULT 0 CHECK(recovery_minimum >= 0),
  tempo_policy_json TEXT NOT NULL DEFAULT '{}',
  attempt_ceiling INTEGER CHECK(attempt_ceiling IS NULL OR attempt_ceiling >= 1),
  planned_seconds INTEGER CHECK(planned_seconds IS NULL OR planned_seconds >= 1),
  retention_delay_days INTEGER
    CHECK(retention_delay_days IS NULL OR retention_delay_days >= 0),
  source_refs_json TEXT NOT NULL DEFAULT '[]',
  set_state TEXT NOT NULL CHECK(set_state IN
    ('draft','active','paused','mastered','closed_unresolved','abandoned','restarted',
     'legacy_open','legacy_closed')),
  mastery_verification TEXT NOT NULL CHECK(mastery_verification IN
    ('verified','unverified','not_applicable')),
  restart_of_set_id INTEGER REFERENCES rep_block(id) ON DELETE SET NULL,
  source TEXT NOT NULL CHECK(source IN
    ('user_click','voice_hot_loop','voice_draft','brain_draft','import_review','migration_legacy','system_schedule')),
  created_ts TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK(restart_of_set_id IS NULL OR restart_of_set_id != set_id)
);
CREATE INDEX set_contract_state_idx ON set_contract(set_state,set_id);
CREATE TRIGGER set_contract_restart_same_piece_insert
BEFORE INSERT ON set_contract
WHEN NEW.restart_of_set_id IS NOT NULL AND
     (SELECT piece_id FROM rep_block WHERE id=NEW.restart_of_set_id) !=
     (SELECT piece_id FROM rep_block WHERE id=NEW.set_id)
BEGIN
  SELECT RAISE(ABORT, 'restarted sets must belong to the same piece');
END;
CREATE TRIGGER set_contract_restart_same_piece_update
BEFORE UPDATE OF set_id,restart_of_set_id ON set_contract
WHEN NEW.restart_of_set_id IS NOT NULL AND
     (SELECT piece_id FROM rep_block WHERE id=NEW.restart_of_set_id) !=
     (SELECT piece_id FROM rep_block WHERE id=NEW.set_id)
BEGIN
  SELECT RAISE(ABORT, 'restarted sets must belong to the same piece');
END;

CREATE TABLE attempt_provenance (
  rep_id INTEGER PRIMARY KEY REFERENCES rep(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK(source IN
    ('user_click','voice_hot_loop','voice_draft','brain_draft','import_review','migration_legacy','system_schedule')),
  command_id TEXT,
  canonical_event_id INTEGER REFERENCES event(id) ON DELETE SET NULL,
  recorded_ts TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX attempt_provenance_source_idx ON attempt_provenance(source,rep_id);
CREATE UNIQUE INDEX attempt_provenance_command_idx
  ON attempt_provenance(command_id) WHERE command_id IS NOT NULL;

CREATE TABLE attempt_adjustment (
  id INTEGER PRIMARY KEY,
  rep_id INTEGER NOT NULL REFERENCES rep(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK(kind IN
    ('void','restore','replace_verdict','replace_note','combined_correction')),
  before_json TEXT NOT NULL,
  after_json TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN
    ('user_click','voice_hot_loop','voice_draft','brain_draft','import_review','migration_legacy','system_schedule')),
  command_id TEXT NOT NULL CHECK(length(trim(command_id)) BETWEEN 1 AND 200),
  reason TEXT,
  reverses_adjustment_id INTEGER REFERENCES attempt_adjustment(id) ON DELETE RESTRICT,
  created_ts TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK(reverses_adjustment_id IS NULL OR reverses_adjustment_id != id),
  UNIQUE(command_id)
);
CREATE INDEX attempt_adjustment_rep_idx ON attempt_adjustment(rep_id,id);
CREATE TRIGGER attempt_adjustment_same_attempt_insert
BEFORE INSERT ON attempt_adjustment
WHEN NEW.reverses_adjustment_id IS NOT NULL AND
     (SELECT rep_id FROM attempt_adjustment WHERE id=NEW.reverses_adjustment_id) != NEW.rep_id
BEGIN
  SELECT RAISE(ABORT, 'an adjustment can reverse only the same attempt');
END;
CREATE TRIGGER attempt_adjustment_same_attempt_update
BEFORE UPDATE OF rep_id,reverses_adjustment_id ON attempt_adjustment
WHEN NEW.reverses_adjustment_id IS NOT NULL AND
     (SELECT rep_id FROM attempt_adjustment WHERE id=NEW.reverses_adjustment_id) != NEW.rep_id
BEGIN
  SELECT RAISE(ABORT, 'an adjustment can reverse only the same attempt');
END;

CREATE TABLE retention_check (
  id INTEGER PRIMARY KEY,
  region_id INTEGER NOT NULL REFERENCES region(id) ON DELETE CASCADE,
  source_set_id INTEGER REFERENCES rep_block(id) ON DELETE SET NULL,
  due_date TEXT NOT NULL,
  original_due_date TEXT NOT NULL,
  condition_json TEXT NOT NULL DEFAULT '{}',
  state TEXT NOT NULL DEFAULT 'due'
    CHECK(state IN ('due','snoozed','confirmed','lowered','reopened','dismissed')),
  result_json TEXT,
  completed_ts TEXT,
  created_ts TEXT NOT NULL DEFAULT (datetime('now')),
  updated_ts TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX retention_check_due_idx ON retention_check(state,due_date,id);
CREATE INDEX retention_check_region_idx ON retention_check(region_id,id);
CREATE TRIGGER retention_check_same_piece_insert
BEFORE INSERT ON retention_check
WHEN NEW.source_set_id IS NOT NULL AND
     (SELECT piece_id FROM rep_block WHERE id=NEW.source_set_id) !=
     (SELECT piece_id FROM region WHERE id=NEW.region_id)
BEGIN
  SELECT RAISE(ABORT, 'retention source set and target must belong to the same piece');
END;
CREATE TRIGGER retention_check_same_piece_update
BEFORE UPDATE OF region_id,source_set_id ON retention_check
WHEN NEW.source_set_id IS NOT NULL AND
     (SELECT piece_id FROM rep_block WHERE id=NEW.source_set_id) !=
     (SELECT piece_id FROM region WHERE id=NEW.region_id)
BEGIN
  SELECT RAISE(ABORT, 'retention source set and target must belong to the same piece');
END;

CREATE TABLE data_anomaly (
  id INTEGER PRIMARY KEY,
  fingerprint TEXT NOT NULL UNIQUE
    CHECK(length(trim(fingerprint)) BETWEEN 1 AND 1000),
  entity_type TEXT NOT NULL CHECK(entity_type IN
    ('piece','target','set','attempt','session','event')),
  entity_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(length(trim(kind)) BETWEEN 1 AND 200),
  observed_facts_json TEXT NOT NULL,
  severity TEXT NOT NULL CHECK(severity IN ('info','warning','error')),
  review_state TEXT NOT NULL DEFAULT 'open'
    CHECK(review_state IN ('open','dismissed','resolved')),
  resolving_event_id INTEGER REFERENCES event(id) ON DELETE SET NULL,
  created_ts TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_ts TEXT
);
CREATE INDEX data_anomaly_review_idx
  ON data_anomaly(review_state,severity,entity_type,entity_id);

CREATE TABLE action_draft (
  id INTEGER PRIMARY KEY,
  piece_id INTEGER REFERENCES piece(id) ON DELETE CASCADE,
  region_id INTEGER REFERENCES region(id) ON DELETE SET NULL,
  set_id INTEGER REFERENCES rep_block(id) ON DELETE SET NULL,
  source TEXT NOT NULL CHECK(source IN ('voice_draft','brain_draft')),
  original_text TEXT NOT NULL CHECK(length(trim(original_text)) BETWEEN 1 AND 8000),
  operations_json TEXT NOT NULL,
  ambiguities_json TEXT NOT NULL DEFAULT '[]',
  confidence REAL CHECK(confidence IS NULL OR (confidence >= 0.0 AND confidence <= 1.0)),
  risk TEXT NOT NULL CHECK(risk IN ('low','medium','high')),
  revision_hash TEXT NOT NULL CHECK(length(trim(revision_hash)) BETWEEN 1 AND 500),
  status TEXT NOT NULL CHECK(status IN
    ('draft','confirmation_required','applied','rejected','undone')),
  applied_event_id INTEGER REFERENCES event(id) ON DELETE SET NULL,
  created_ts TEXT NOT NULL DEFAULT (datetime('now')),
  updated_ts TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX action_draft_piece_status_idx ON action_draft(piece_id,status,id);
CREATE TRIGGER action_draft_context_insert
BEFORE INSERT ON action_draft
WHEN (NEW.piece_id IS NOT NULL AND NEW.region_id IS NOT NULL AND
      NEW.piece_id != (SELECT piece_id FROM region WHERE id=NEW.region_id))
  OR (NEW.piece_id IS NOT NULL AND NEW.set_id IS NOT NULL AND
      NEW.piece_id != (SELECT piece_id FROM rep_block WHERE id=NEW.set_id))
  OR (NEW.region_id IS NOT NULL AND NEW.set_id IS NOT NULL AND
      (SELECT piece_id FROM region WHERE id=NEW.region_id) !=
      (SELECT piece_id FROM rep_block WHERE id=NEW.set_id))
BEGIN
  SELECT RAISE(ABORT, 'draft context must belong to one piece');
END;
CREATE TRIGGER action_draft_context_update
BEFORE UPDATE OF piece_id,region_id,set_id ON action_draft
WHEN (NEW.piece_id IS NOT NULL AND NEW.region_id IS NOT NULL AND
      NEW.piece_id != (SELECT piece_id FROM region WHERE id=NEW.region_id))
  OR (NEW.piece_id IS NOT NULL AND NEW.set_id IS NOT NULL AND
      NEW.piece_id != (SELECT piece_id FROM rep_block WHERE id=NEW.set_id))
  OR (NEW.region_id IS NOT NULL AND NEW.set_id IS NOT NULL AND
      (SELECT piece_id FROM region WHERE id=NEW.region_id) !=
      (SELECT piece_id FROM rep_block WHERE id=NEW.set_id))
BEGIN
  SELECT RAISE(ABORT, 'draft context must belong to one piece');
END;

CREATE TABLE brain_thread (
  id INTEGER PRIMARY KEY,
  piece_id INTEGER NOT NULL REFERENCES piece(id) ON DELETE CASCADE,
  region_id INTEGER REFERENCES region(id) ON DELETE SET NULL,
  title TEXT,
  created_ts TEXT NOT NULL DEFAULT (datetime('now')),
  updated_ts TEXT NOT NULL DEFAULT (datetime('now')),
  cleared_ts TEXT
);
CREATE INDEX brain_thread_piece_idx ON brain_thread(piece_id,updated_ts,id);
CREATE TRIGGER brain_thread_same_piece_insert
BEFORE INSERT ON brain_thread
WHEN NEW.region_id IS NOT NULL AND
     NEW.piece_id != (SELECT piece_id FROM region WHERE id=NEW.region_id)
BEGIN
  SELECT RAISE(ABORT, 'Brain thread region must belong to its piece');
END;
CREATE TRIGGER brain_thread_same_piece_update
BEFORE UPDATE OF piece_id,region_id ON brain_thread
WHEN NEW.region_id IS NOT NULL AND
     NEW.piece_id != (SELECT piece_id FROM region WHERE id=NEW.region_id)
BEGIN
  SELECT RAISE(ABORT, 'Brain thread region must belong to its piece');
END;

CREATE TABLE brain_turn (
  id INTEGER PRIMARY KEY,
  thread_id INTEGER NOT NULL REFERENCES brain_thread(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('user','assistant')),
  content TEXT NOT NULL CHECK(length(content) BETWEEN 1 AND 24000),
  provider TEXT,
  citations_json TEXT NOT NULL DEFAULT '[]',
  created_ts TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX brain_turn_thread_idx ON brain_turn(thread_id,id);

ALTER TABLE event ADD COLUMN entity_type TEXT;
ALTER TABLE event ADD COLUMN entity_id INTEGER;
ALTER TABLE event ADD COLUMN source TEXT CHECK(source IS NULL OR source IN
  ('user_click','voice_hot_loop','voice_draft','brain_draft','import_review','migration_legacy','system_schedule'));
ALTER TABLE event ADD COLUMN command_id TEXT;
ALTER TABLE event ADD COLUMN draft_id INTEGER REFERENCES action_draft(id) ON DELETE SET NULL;
CREATE INDEX event_entity_idx ON event(entity_type,entity_id,id);
CREATE INDEX event_command_idx ON event(command_id) WHERE command_id IS NOT NULL;
";

/// Schema v9 — structurally enforce RepEngine's single-live-set invariant.
/// This migration is deliberately additive: the approved v2 boundary forbids
/// rebuilding any v1 evidence table. Legacy rows use `legacy_open` and remain
/// untouched; only native v2 `active`/`paused` states participate.
pub(crate) const SCHEMA_V9: &str = "\
CREATE UNIQUE INDEX set_contract_one_live_v2_idx
  ON set_contract((1)) WHERE set_state IN ('active','paused');
";

/// Schema v10 — durable V2.4 practice-loop identity and append-only evidence.
///
/// This step is intentionally sidecar-only. The v1 evidence tables (`rep_block`,
/// `rep`, `session_event`, and `event`) are not rebuilt or rewritten. Runtime
/// projections may join these tables, but the new focus/timing/recovery records
/// remain independently auditable and a retried command can return its original
/// durable receipt without executing the mutation twice.
pub(crate) const SCHEMA_V10: &str = "\
CREATE TABLE practice_operation (
  id INTEGER PRIMARY KEY,
  receipt_id TEXT NOT NULL UNIQUE
    CHECK(length(trim(receipt_id)) BETWEEN 1 AND 240),
  command_id TEXT NOT NULL UNIQUE
    CHECK(length(trim(command_id)) BETWEEN 1 AND 200),
  operation_kind TEXT NOT NULL
    CHECK(length(trim(operation_kind)) BETWEEN 1 AND 100),
  request_fingerprint TEXT NOT NULL
    CHECK(length(request_fingerprint) BETWEEN 1 AND 24000),
  set_id INTEGER,
  source TEXT NOT NULL CHECK(source IN
    ('user_click','voice_hot_loop','voice_draft','brain_draft','import_review','migration_legacy','system_schedule')),
  summary TEXT NOT NULL CHECK(length(trim(summary)) BETWEEN 1 AND 2000),
  value_json TEXT NOT NULL,
  entity_refs_json TEXT NOT NULL DEFAULT '[]',
  event_ids_json TEXT NOT NULL DEFAULT '[]',
  undo_action TEXT,
  committed_ts TEXT NOT NULL
);
CREATE INDEX practice_operation_set_idx ON practice_operation(set_id,id);

CREATE TABLE practice_set_context (
  set_id INTEGER PRIMARY KEY REFERENCES rep_block(id) ON DELETE CASCADE,
  intention TEXT CHECK(intention IS NULL OR length(trim(intention)) BETWEEN 1 AND 2000),
  judging_axis TEXT NOT NULL
    CHECK(length(trim(judging_axis)) BETWEEN 1 AND 200),
  hands TEXT NOT NULL CHECK(length(trim(hands)) BETWEEN 1 AND 200),
  method TEXT NOT NULL CHECK(length(trim(method)) BETWEEN 1 AND 500),
  planned_seconds INTEGER CHECK(planned_seconds IS NULL OR planned_seconds BETWEEN 1 AND 86400),
  initial_reflection TEXT
    CHECK(initial_reflection IS NULL OR length(trim(initial_reflection)) BETWEEN 1 AND 4000),
  captured_ts TEXT NOT NULL
);

CREATE TABLE practice_interval (
  id INTEGER PRIMARY KEY,
  set_id INTEGER NOT NULL REFERENCES rep_block(id) ON DELETE CASCADE,
  started_ts TEXT NOT NULL,
  last_checkpoint_ts TEXT NOT NULL,
  ended_ts TEXT,
  end_reason TEXT CHECK(end_reason IS NULL OR end_reason IN
    ('pause','close','mastered','restart','safety_stop','suspension','crash_checkpoint')),
  opened_operation_id INTEGER REFERENCES practice_operation(id) ON DELETE RESTRICT,
  closed_operation_id INTEGER REFERENCES practice_operation(id) ON DELETE RESTRICT,
  CHECK(julianday(last_checkpoint_ts) >= julianday(started_ts)),
  CHECK(ended_ts IS NULL OR julianday(ended_ts) >= julianday(started_ts)),
  CHECK((ended_ts IS NULL AND end_reason IS NULL AND closed_operation_id IS NULL)
     OR (ended_ts IS NOT NULL AND end_reason IS NOT NULL))
);
CREATE INDEX practice_interval_set_idx ON practice_interval(set_id,id);
CREATE UNIQUE INDEX practice_interval_one_open_idx
  ON practice_interval(set_id) WHERE ended_ts IS NULL;
CREATE TRIGGER practice_interval_no_backward_overlap_insert
BEFORE INSERT ON practice_interval
WHEN EXISTS(
  SELECT 1 FROM practice_interval prior
  WHERE prior.set_id=NEW.set_id
    AND julianday(COALESCE(prior.ended_ts,prior.last_checkpoint_ts)) > julianday(NEW.started_ts)
)
BEGIN
  SELECT RAISE(ABORT, 'practice interval cannot overlap an earlier interval');
END;

CREATE TABLE practice_reflection (
  id INTEGER PRIMARY KEY,
  set_id INTEGER NOT NULL REFERENCES rep_block(id) ON DELETE RESTRICT,
  reflection TEXT NOT NULL CHECK(length(trim(reflection)) BETWEEN 1 AND 4000),
  operation_id INTEGER NOT NULL UNIQUE
    REFERENCES practice_operation(id) ON DELETE RESTRICT,
  created_ts TEXT NOT NULL
);
CREATE INDEX practice_reflection_set_idx ON practice_reflection(set_id,id);
CREATE TRIGGER practice_reflection_append_only_update
BEFORE UPDATE ON practice_reflection
BEGIN
  SELECT RAISE(ABORT, 'practice reflections are append-only');
END;
CREATE TRIGGER practice_reflection_append_only_delete
BEFORE DELETE ON practice_reflection
BEGIN
  SELECT RAISE(ABORT, 'practice reflections are append-only');
END;

CREATE TABLE practice_safety_event (
  id INTEGER PRIMARY KEY,
  set_id INTEGER NOT NULL REFERENCES rep_block(id) ON DELETE RESTRICT,
  state TEXT NOT NULL CHECK(state IN ('stopped','cleared')),
  reason TEXT CHECK(reason IS NULL OR length(trim(reason)) BETWEEN 1 AND 2000),
  operation_id INTEGER NOT NULL UNIQUE
    REFERENCES practice_operation(id) ON DELETE RESTRICT,
  created_ts TEXT NOT NULL
);
CREATE TRIGGER practice_safety_event_append_only_update
BEFORE UPDATE ON practice_safety_event
BEGIN
  SELECT RAISE(ABORT, 'practice safety evidence is append-only');
END;
CREATE TRIGGER practice_safety_event_append_only_delete
BEFORE DELETE ON practice_safety_event
BEGIN
  SELECT RAISE(ABORT, 'practice safety evidence is append-only');
END;

CREATE TABLE practice_recovery_action (
  id INTEGER PRIMARY KEY,
  set_id INTEGER NOT NULL REFERENCES rep_block(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK(kind IN
    ('reset_streak','clean_debt','tempo_backoff','narrow_target','change_hands','change_method','break','schedule_retention')),
  after_attempt_id INTEGER REFERENCES rep(id) ON DELETE RESTRICT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  rationale TEXT NOT NULL CHECK(length(trim(rationale)) BETWEEN 1 AND 2000),
  source TEXT NOT NULL CHECK(source IN
    ('user_click','voice_hot_loop','voice_draft','brain_draft','import_review','migration_legacy','system_schedule')),
  operation_id INTEGER NOT NULL UNIQUE
    REFERENCES practice_operation(id) ON DELETE RESTRICT,
  created_ts TEXT NOT NULL
);
CREATE INDEX practice_recovery_action_set_idx
  ON practice_recovery_action(set_id,id);
CREATE TRIGGER practice_recovery_same_set_insert
BEFORE INSERT ON practice_recovery_action
WHEN NEW.after_attempt_id IS NOT NULL AND
     (SELECT block_id FROM rep WHERE id=NEW.after_attempt_id) != NEW.set_id
BEGIN
  SELECT RAISE(ABORT, 'recovery boundary attempt must belong to its set');
END;
CREATE TRIGGER practice_recovery_append_only_update
BEFORE UPDATE ON practice_recovery_action
BEGIN
  SELECT RAISE(ABORT, 'recovery actions are append-only');
END;
CREATE TRIGGER practice_recovery_append_only_delete
BEFORE DELETE ON practice_recovery_action
BEGIN
  SELECT RAISE(ABORT, 'recovery actions are append-only');
END;

CREATE TABLE retention_check_event (
  id INTEGER PRIMARY KEY,
  retention_check_id INTEGER NOT NULL
    REFERENCES retention_check(id) ON DELETE RESTRICT,
  from_state TEXT,
  to_state TEXT NOT NULL CHECK(to_state IN
    ('due','snoozed','confirmed','lowered','reopened','dismissed')),
  due_date TEXT NOT NULL,
  original_due_date TEXT NOT NULL,
  result_json TEXT,
  operation_id INTEGER NOT NULL UNIQUE
    REFERENCES practice_operation(id) ON DELETE RESTRICT,
  created_ts TEXT NOT NULL
);
CREATE INDEX retention_check_event_check_idx
  ON retention_check_event(retention_check_id,id);
CREATE TRIGGER retention_check_event_append_only_update
BEFORE UPDATE ON retention_check_event
BEGIN
  SELECT RAISE(ABORT, 'retention evidence is append-only');
END;
CREATE TRIGGER retention_check_event_append_only_delete
BEFORE DELETE ON retention_check_event
BEGIN
  SELECT RAISE(ABORT, 'retention evidence is append-only');
END;
";

/// Migrate `conn` up to [`SCHEMA_VERSION`], applying only the steps its current
/// `user_version` has not yet seen. Idempotent: a fully-migrated database is a
/// no-op. Steps are layered (v0→v1→v2→v3) so a fresh database and older databases
/// all converge on the same current schema.
pub fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    let version: i32 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;

    if version > SCHEMA_VERSION {
        return Err(rusqlite::Error::InvalidParameterName(format!(
            "database schema {version} is newer than supported schema {SCHEMA_VERSION}; do not open it with this app — restore the matching app/database pair"
        )));
    }

    if version < 1 {
        conn.execute_batch(SCHEMA_V1)?;
    }

    if version < 2 {
        conn.execute_batch(SCHEMA_V2)?;
    }

    if version < 3 {
        // The rep_block rebuild drops a table that `rep` FKs into. Disable FK
        // enforcement for the structural step (rows are re-inserted with identical
        // ids, so referential integrity is preserved) then re-enable. `PRAGMA
        // foreign_keys` only takes effect outside an open transaction, so the two
        // pragmas stay OUTSIDE the transaction that wraps the DDL.
        //
        // The DDL + back-fill + version stamp are wrapped in one explicit
        // transaction so the step is crash-atomic: SQLite DDL is transactional, so
        // a crash mid-migration rolls back cleanly to v2 (leaving `user_version`
        // at 2) and a retry re-runs the whole step from scratch. Stamping
        // `user_version = 3` INSIDE the transaction is what makes "schema is v3"
        // and "version says 3" commit as a single indivisible unit — they can
        // never disagree on disk.
        conn.execute_batch("PRAGMA foreign_keys = OFF;")?;
        let v3 = (|| -> rusqlite::Result<()> {
            conn.execute_batch("BEGIN;")?;
            conn.execute_batch(SCHEMA_V3)?;
            super::backfill::backfill_v3(conn)?;
            conn.execute_batch("PRAGMA user_version = 3;")?;
            conn.execute_batch("COMMIT;")?;
            Ok(())
        })();
        if let Err(e) = v3 {
            // Best-effort rollback so the connection is left clean; re-enable FKs
            // regardless before propagating so we never leave enforcement off.
            let _ = conn.execute_batch("ROLLBACK;");
            let _ = conn.execute_batch("PRAGMA foreign_keys = ON;");
            return Err(e);
        }
        conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    }

    if version < 4 {
        // Add the preference and its version stamp atomically. This runs after
        // the v3 transaction above for fresh/v1/v2 databases and directly for
        // shipped v3 databases.
        let v4 = (|| -> rusqlite::Result<()> {
            conn.execute_batch("BEGIN;")?;
            conn.execute_batch(SCHEMA_V4)?;
            conn.execute_batch("PRAGMA user_version = 4;")?;
            conn.execute_batch("COMMIT;")?;
            Ok(())
        })();
        if let Err(e) = v4 {
            let _ = conn.execute_batch("ROLLBACK;");
            return Err(e);
        }
    }

    if version < 5 {
        // The new table, indexes, immutability trigger, and version stamp form
        // one transaction. A crash can therefore leave either complete v4 or
        // complete v5, never a partially usable Calendar schema.
        let v5 = (|| -> rusqlite::Result<()> {
            conn.execute_batch("BEGIN;")?;
            conn.execute_batch(SCHEMA_V5)?;
            conn.execute_batch("PRAGMA user_version = 5;")?;
            conn.execute_batch("COMMIT;")?;
            Ok(())
        })();
        if let Err(error) = v5 {
            let _ = conn.execute_batch("ROLLBACK;");
            return Err(error);
        }
    }

    if version < 6 {
        // The ledger, copied canonical rows, and version stamp are one crash-
        // atomic unit. Any insert/validation failure rolls all three back to a
        // clean v5 database, so reopening can safely retry the entire bridge.
        let v6 = (|| -> rusqlite::Result<()> {
            conn.execute_batch("BEGIN;")?;
            conn.execute_batch(SCHEMA_V6)?;
            super::history_backfill::backfill_history(conn)?;
            // Keep this stamp tied to the step. Using SCHEMA_VERSION here would
            // skip later migrations when a fresh database runs all steps.
            conn.execute_batch("PRAGMA user_version = 6;")?;
            conn.execute_batch("COMMIT;")?;
            Ok(())
        })();
        if let Err(error) = v6 {
            let _ = conn.execute_batch("ROLLBACK;");
            return Err(error);
        }
    } else if version != 7 {
        // The live session feed and canonical event log were historically two
        // independent writes. Reconcile on every schema-v6 open so a crash
        // between those writes cannot permanently hide practice from Universe.
        // A schema-v7 open defers this worker into the one v8 transaction below
        // so a failed v8 backfill cannot leave pre-migration reconciliation
        // writes behind.
        let reconciliation = (|| -> rusqlite::Result<()> {
            conn.execute_batch("BEGIN;")?;
            super::history_backfill::backfill_history(conn)?;
            conn.execute_batch("COMMIT;")?;
            Ok(())
        })();
        if let Err(error) = reconciliation {
            let _ = conn.execute_batch("ROLLBACK;");
            return Err(error);
        }
    }

    if version < 7 {
        let v7 = (|| -> rusqlite::Result<()> {
            conn.execute_batch("BEGIN;")?;
            conn.execute_batch(SCHEMA_V7)?;
            // Keep the v7 stamp tied to this step. Using SCHEMA_VERSION here
            // would falsely mark a database v8 before the separate v8
            // transaction and backfill have committed.
            conn.execute_batch("PRAGMA user_version = 7;")?;
            conn.execute_batch("COMMIT;")?;
            Ok(())
        })();
        if let Err(error) = v7 {
            let _ = conn.execute_batch("ROLLBACK;");
            return Err(error);
        }
    }

    if version < 8 {
        // Every sidecar, mechanically knowable legacy row, anomaly projection,
        // and the version stamp commits as one immediate transaction. A failure
        // therefore leaves the source schema-v7 graph untouched and retryable.
        let v8 = (|| -> rusqlite::Result<()> {
            conn.execute_batch("BEGIN IMMEDIATE;")?;
            // This is normally a no-op, but captures any v7 live-feed rows that
            // were not yet represented in the canonical event table. Keeping it
            // here makes reconciliation + sidecars + v8 stamp one transaction.
            super::history_backfill::backfill_history(conn)?;
            conn.execute_batch(SCHEMA_V8)?;
            super::v8_backfill::backfill_v8(conn)?;
            conn.execute_batch("PRAGMA user_version = 8;")?;
            conn.execute_batch("COMMIT;")?;
            Ok(())
        })();
        if let Err(error) = v8 {
            let _ = conn.execute_batch("ROLLBACK;");
            return Err(error);
        }
    }

    if version < 9 {
        let v9 = (|| -> rusqlite::Result<()> {
            conn.execute_batch("BEGIN IMMEDIATE;")?;
            conn.execute_batch(SCHEMA_V9)?;
            conn.execute_batch("PRAGMA user_version = 9;")?;
            conn.execute_batch("COMMIT;")?;
            Ok(())
        })();
        if let Err(error) = v9 {
            let _ = conn.execute_batch("ROLLBACK;");
            return Err(error);
        }
    }

    if version < 10 {
        let v10 = (|| -> rusqlite::Result<()> {
            conn.execute_batch("BEGIN IMMEDIATE;")?;
            conn.execute_batch(SCHEMA_V10)?;
            conn.execute_batch("PRAGMA user_version = 10;")?;
            conn.execute_batch("COMMIT;")?;
            Ok(())
        })();
        if let Err(error) = v10 {
            let _ = conn.execute_batch("ROLLBACK;");
            return Err(error);
        }
    }

    Ok(())
}

#[cfg(test)]
mod v3_tests {
    use super::*;
    use rusqlite::Connection;

    fn seed_v2() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        c.execute_batch(SCHEMA_V1).unwrap();
        c.execute_batch(SCHEMA_V2).unwrap();
        c.execute_batch("PRAGMA user_version = 2;").unwrap();
        c.execute(
            "INSERT INTO piece (id,title,folder_path,goals,hard_spots) VALUES \
             (1,'Etude','/p/1','[\"memorize\",\"hands together\"]',\
             '[{\"measures\":\"12-16\",\"note\":\"LH leap\"}]')",
            [],
        )
        .unwrap();
        for (id, s, e) in [(1, 1, 8), (2, 5, 12), (3, 40, 48)] {
            c.execute(
                "INSERT INTO rep_block (id,piece_id,m_start,m_end,start_bpm,increment_rule,planned_reps,status) \
                 VALUES (?1,1,?2,?3,40.0,'{\"clean_needed\":2,\"bpm_step\":4}',10,'done')",
                (id, s, e)).unwrap();
        }
        c.execute(
            "INSERT INTO rep (block_id,bpm,verdict) VALUES (1,40.0,'clean')",
            [],
        )
        .unwrap();
        c.execute(
            "INSERT INTO rep (block_id,bpm,verdict) VALUES (1,40.0,'flawed')",
            [],
        )
        .unwrap();
        c
    }

    fn seed_v3() -> Connection {
        let c = seed_v2();
        c.execute_batch("PRAGMA foreign_keys = OFF; BEGIN;")
            .unwrap();
        c.execute_batch(SCHEMA_V3).unwrap();
        super::super::backfill::backfill_v3(&c).unwrap();
        c.execute_batch("PRAGMA user_version = 3; COMMIT; PRAGMA foreign_keys = ON;")
            .unwrap();
        c.execute(
            "UPDATE piece SET pdf_path='/p/1/score/scanned.pdf' WHERE id=1",
            [],
        )
        .unwrap();
        c
    }

    fn seed_v4() -> Connection {
        let c = seed_v3();
        c.execute_batch("BEGIN;").unwrap();
        c.execute_batch(SCHEMA_V4).unwrap();
        c.execute_batch("PRAGMA user_version = 4; COMMIT;").unwrap();
        c.execute(
            "UPDATE piece SET preferred_pdf_path='/p/1/score/urtext.pdf' WHERE id=1",
            [],
        )
        .unwrap();
        c.execute("INSERT INTO session (id) VALUES (1)", [])
            .unwrap();
        c.execute(
            "INSERT INTO event (session_id,piece_id,kind,payload) VALUES (1,1,'rep','{\"block_id\":1}')",
            [],
        )
        .unwrap();
        c
    }

    fn seed_v5() -> Connection {
        let c = seed_v4();
        c.execute_batch("BEGIN;").unwrap();
        c.execute_batch(SCHEMA_V5).unwrap();
        c.execute_batch("PRAGMA user_version = 5; COMMIT;").unwrap();
        c
    }

    fn seed_v6() -> Connection {
        let c = seed_v5();
        c.execute_batch("BEGIN;").unwrap();
        c.execute_batch(SCHEMA_V6).unwrap();
        super::super::history_backfill::backfill_history(&c).unwrap();
        c.execute_batch("PRAGMA user_version = 6; COMMIT;").unwrap();
        c
    }

    fn seed_v7() -> Connection {
        let c = seed_v6();
        c.execute_batch("BEGIN;").unwrap();
        c.execute_batch(SCHEMA_V7).unwrap();
        c.execute_batch("PRAGMA user_version = 7; COMMIT;").unwrap();
        c
    }

    #[test]
    fn migrate_v6_to_v7_preserves_region_headers_and_adds_tutorial_graph_once() {
        let c = seed_v6();
        let region_id: i64 = c
            .query_row(
                "SELECT id FROM region WHERE piece_id=1 LIMIT 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        c.execute(
            "UPDATE region SET name='Left hand voicing — keep this exact text' WHERE id=?1",
            [region_id],
        )
        .unwrap();

        migrate(&c).unwrap();
        assert_eq!(
            c.query_row("PRAGMA user_version", [], |row| row.get::<_, i32>(0))
                .unwrap(),
            SCHEMA_VERSION
        );
        let (name, notes): (String, Option<String>) = c
            .query_row(
                "SELECT name,notes FROM region WHERE id=?1",
                [region_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(name, "Left hand voicing — keep this exact text");
        assert_eq!(
            notes.as_deref(),
            Some("Left hand voicing — keep this exact text"),
            "authored v6 prose is copied into notes without changing the header"
        );
        let generated_notes: Option<String> = c
            .query_row(
                "SELECT notes FROM region WHERE name GLOB 'mm. *' LIMIT 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            generated_notes, None,
            "generated measure labels are not duplicated into fake notes"
        );

        c.execute(
            "UPDATE region SET notes='Drop the wrist before the octave' WHERE id=?1",
            [region_id],
        )
        .unwrap();
        c.execute(
            "INSERT INTO tutorial_video(piece_id,title,file_path,duration_seconds)
             VALUES (1,'Lesson','/piece/tutorials/lesson.mp4',60)",
            [],
        )
        .unwrap();
        let video_id = c.last_insert_rowid();
        c.execute(
            "INSERT INTO tutorial_chapter
             (video_id,start_seconds,end_seconds,title,sort_order)
             VALUES (?1,5,12,'Opening shape',0)",
            [video_id],
        )
        .unwrap();
        let chapter_id = c.last_insert_rowid();
        c.execute(
            "INSERT INTO tutorial_clip(chapter_id,region_id) VALUES (?1,?2)",
            rusqlite::params![chapter_id, region_id],
        )
        .unwrap();

        migrate(&c).unwrap();
        assert_eq!(
            c.query_row("SELECT notes FROM region WHERE id=?1", [region_id], |row| {
                row.get::<_, String>(0)
            })
            .unwrap(),
            "Drop the wrist before the octave"
        );
        assert_eq!(
            c.query_row("SELECT count(*) FROM tutorial_video", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            1
        );
        assert_eq!(
            c.query_row("SELECT count(*) FROM tutorial_clip", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            1
        );
        assert_eq!(
            c.query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |row| {
                row.get::<_, i64>(0)
            })
            .unwrap(),
            0
        );
    }

    #[test]
    fn v7_constraints_reject_cross_piece_and_invalid_clips_and_cascade() {
        let c = seed_v6();
        migrate(&c).unwrap();
        c.execute(
            "INSERT INTO piece(id,title,folder_path) VALUES (2,'Other','/p/2')",
            [],
        )
        .unwrap();
        c.execute(
            "INSERT INTO region(piece_id,name,m_start,m_end,kind) VALUES (2,'Other',1,4,'section')",
            [],
        )
        .unwrap();
        let other_region = c.last_insert_rowid();
        c.execute(
            "INSERT INTO tutorial_video(piece_id,title,file_path,duration_seconds)
             VALUES (1,'Lesson','/p/1/tutorials/lesson.mp4',60)",
            [],
        )
        .unwrap();
        let video = c.last_insert_rowid();
        c.execute(
            "INSERT INTO tutorial_chapter(video_id,start_seconds,end_seconds,title)
             VALUES (?1,0,5,'Chapter')",
            [video],
        )
        .unwrap();
        let chapter = c.last_insert_rowid();
        assert!(c
            .execute(
                "INSERT INTO tutorial_clip(chapter_id,region_id) VALUES (?1,?2)",
                rusqlite::params![chapter, other_region],
            )
            .is_err());
        let own_region: i64 = c
            .query_row(
                "SELECT id FROM region WHERE piece_id=1 LIMIT 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(c
            .execute(
                "INSERT INTO tutorial_chapter(video_id,start_seconds,end_seconds,title)
                 VALUES (?1,5,5,'Empty')",
                [video],
            )
            .is_err());
        c.execute(
            "INSERT INTO tutorial_clip(chapter_id,region_id) VALUES (?1,?2)",
            rusqlite::params![chapter, own_region],
        )
        .unwrap();
        c.execute("DELETE FROM tutorial_video WHERE id=?1", [video])
            .unwrap();
        assert_eq!(
            c.query_row("SELECT count(*) FROM tutorial_clip", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }

    #[test]
    fn migrate_v3_to_v4_preserves_graph_and_adds_pdf_preference() {
        let c = seed_v3();
        let before: (i64, i64, i64, i64) = c
            .query_row(
                "SELECT
                    (SELECT count(*) FROM rep_block),
                    (SELECT count(*) FROM rep),
                    (SELECT count(*) FROM region),
                    (SELECT count(*) FROM goal)",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();

        migrate(&c).unwrap();

        let version: i32 = c
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(version, SCHEMA_VERSION);
        let after: (i64, i64, i64, i64) = c
            .query_row(
                "SELECT
                    (SELECT count(*) FROM rep_block),
                    (SELECT count(*) FROM rep),
                    (SELECT count(*) FROM region),
                    (SELECT count(*) FROM goal)",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        assert_eq!(after, before, "v4/v5 are additive over the full v3 graph");
        let paths: (Option<String>, Option<String>) = c
            .query_row(
                "SELECT pdf_path, preferred_pdf_path FROM piece WHERE id=1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(paths.0.as_deref(), Some("/p/1/score/scanned.pdf"));
        assert_eq!(paths.1, None);

        c.execute(
            "UPDATE piece SET preferred_pdf_path='/p/1/score/urtext.pdf' WHERE id=1",
            [],
        )
        .unwrap();
        migrate(&c).unwrap();
        let preferred: String = c
            .query_row("SELECT preferred_pdf_path FROM piece WHERE id=1", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(preferred, "/p/1/score/urtext.pdf");
    }

    #[test]
    fn migrate_v2_to_v3_is_additive_and_backfills() {
        let c = seed_v2();
        migrate(&c).unwrap();

        // schema stamped
        let v: i32 = c
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(v, SCHEMA_VERSION);

        // v4 adds a user-owned edition preference without disturbing the
        // scanner-owned pdf_path.
        let (scanned, preferred): (Option<String>, Option<String>) = c
            .query_row(
                "SELECT pdf_path, preferred_pdf_path FROM piece WHERE id=1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(scanned, None);
        assert_eq!(preferred, None);

        // new tables exist
        for t in ["region", "goal", "event"] {
            let n: i64 = c
                .query_row(
                    "SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?1",
                    [t],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(n, 1, "table {t} missing");
        }

        // all prior blocks/reps preserved
        let blocks: i64 = c
            .query_row("SELECT count(*) FROM rep_block", [], |r| r.get(0))
            .unwrap();
        assert_eq!(blocks, 3);
        let reps: i64 = c
            .query_row("SELECT count(*) FROM rep", [], |r| r.get(0))
            .unwrap();
        assert_eq!(reps, 2);

        // copied VALUES survived the rep_block rebuild (guards against a
        // mis-mapped INSERT…SELECT, not just row counts): block 1's seeded
        // start_bpm and its increment_rule JSON string must be intact.
        let (sb, rule): (f64, String) = c
            .query_row(
                "SELECT start_bpm, increment_rule FROM rep_block WHERE id=1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(sb, 40.0);
        assert_eq!(rule, "{\"clean_needed\":2,\"bpm_step\":4}");
        let (m_start, m_end): (i64, i64) = c
            .query_row("SELECT m_start, m_end FROM rep_block WHERE id=3", [], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .unwrap();
        assert_eq!((m_start, m_end), (40, 48));

        // rep_block gained columns with correct defaults
        let (focus, use_metro): (String, i64) = c
            .query_row(
                "SELECT focus, use_metronome FROM rep_block WHERE id=1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(focus, "tempo");
        assert_eq!(use_metro, 1);

        // session gained focused_seconds
        c.execute("INSERT INTO session (id) VALUES (1)", [])
            .unwrap();
        let fs: Option<i64> = c
            .query_row("SELECT focused_seconds FROM session WHERE id=1", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(fs, None);

        // back-fill: blocks 1&2 overlap → one section region; block 3 → another; + 1 hard_spot region
        let sections: i64 = c
            .query_row(
                "SELECT count(*) FROM region WHERE piece_id=1 AND kind='section'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(sections, 2);
        let hard: i64 = c
            .query_row(
                "SELECT count(*) FROM region WHERE piece_id=1 AND kind='hard_spot'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(hard, 1);
        // blocks 1 and 2 assigned to the same region
        let (r1, r2): (i64, i64) = c.query_row(
            "SELECT (SELECT region_id FROM rep_block WHERE id=1),(SELECT region_id FROM rep_block WHERE id=2)",
            [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!(r1, r2);

        // intake goals → Goal rows kind=big
        let goals: i64 = c
            .query_row(
                "SELECT count(*) FROM goal WHERE piece_id=1 AND kind='big'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(goals, 2);

        // idempotent: second migrate does not duplicate
        migrate(&c).unwrap();
        let regions2: i64 = c
            .query_row("SELECT count(*) FROM region", [], |r| r.get(0))
            .unwrap();
        assert_eq!(regions2, 3);
    }

    #[test]
    fn migrate_v4_to_v5_preserves_every_existing_graph_and_is_idempotent() {
        let c = seed_v4();
        let tables = [
            "piece",
            "rep_block",
            "rep",
            "session",
            "session_event",
            "spot_review",
            "setting",
            "region",
            "goal",
            "event",
        ];
        let before = tables
            .iter()
            .map(|table| {
                c.query_row(&format!("SELECT count(*) FROM {table}"), [], |row| {
                    row.get::<_, i64>(0)
                })
                .unwrap()
            })
            .collect::<Vec<_>>();

        migrate(&c).unwrap();
        assert_eq!(
            c.query_row("PRAGMA user_version", [], |row| row.get::<_, i32>(0))
                .unwrap(),
            SCHEMA_VERSION
        );
        let after = tables
            .iter()
            .map(|table| {
                c.query_row(&format!("SELECT count(*) FROM {table}"), [], |row| {
                    row.get::<_, i64>(0)
                })
                .unwrap()
            })
            .collect::<Vec<_>>();
        assert_eq!(after, before, "v5 must not rewrite any v4 graph row");
        assert_eq!(
            c.query_row(
                "SELECT preferred_pdf_path FROM piece WHERE id=1",
                [],
                |row| row.get::<_, String>(0),
            )
            .unwrap(),
            "/p/1/score/urtext.pdf"
        );
        let fk_failures: i64 = c
            .query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(fk_failures, 0);

        c.execute(
            "INSERT INTO daily_work
             (goal_id,title,planned_minutes,origin_date,scheduled_date,source)
             VALUES (1,'Coda ladder',20,'2026-07-12','2026-07-12','manual')",
            [],
        )
        .unwrap();
        migrate(&c).unwrap();
        assert_eq!(
            c.query_row("SELECT count(*) FROM daily_work", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            1,
            "reopening v5 must not duplicate or clear work"
        );
    }

    #[test]
    fn v5_constraints_reject_impossible_dates_ranges_states_and_origin_rewrites() {
        let c = seed_v4();
        migrate(&c).unwrap();
        let insert = |title: &str,
                      minutes: i64,
                      origin: &str,
                      scheduled: &str,
                      status: &str,
                      source: &str,
                      completed: Option<&str>| {
            c.execute(
                "INSERT INTO daily_work
                 (goal_id,title,planned_minutes,origin_date,scheduled_date,status,source,completed_ts)
                 VALUES (1,?1,?2,?3,?4,?5,?6,?7)",
                rusqlite::params![title, minutes, origin, scheduled, status, source, completed],
            )
        };
        assert!(insert(
            "Leap work",
            30,
            "2028-02-29",
            "2028-02-29",
            "planned",
            "manual",
            None
        )
        .is_ok());
        for bad in ["2026-02-29", "2026-04-31", "2026-13-01", "0000-01-01"] {
            assert!(
                insert("Bad date", 30, bad, "2026-07-12", "planned", "manual", None).is_err(),
                "{bad}"
            );
        }
        assert!(insert(
            "",
            30,
            "2026-07-12",
            "2026-07-12",
            "planned",
            "manual",
            None
        )
        .is_err());
        assert!(insert(
            "Too short",
            0,
            "2026-07-12",
            "2026-07-12",
            "planned",
            "manual",
            None
        )
        .is_err());
        assert!(insert(
            "Too long",
            241,
            "2026-07-12",
            "2026-07-12",
            "planned",
            "manual",
            None
        )
        .is_err());
        assert!(insert(
            "Bad state",
            30,
            "2026-07-12",
            "2026-07-12",
            "missed",
            "manual",
            None
        )
        .is_err());
        assert!(insert(
            "Bad source",
            30,
            "2026-07-12",
            "2026-07-12",
            "planned",
            "ai",
            None
        )
        .is_err());
        assert!(insert(
            "Fake done",
            30,
            "2026-07-12",
            "2026-07-12",
            "done",
            "manual",
            None
        )
        .is_err());
        assert!(c
            .execute(
                "UPDATE daily_work SET origin_date='2028-03-01' WHERE title='Leap work'",
                []
            )
            .is_err());
    }

    #[test]
    fn migrate_v5_to_v6_preserves_rows_maps_exact_history_and_ledgers_skips() {
        let c = seed_v5();
        c.execute(
            "INSERT INTO piece (id,title,folder_path) VALUES (2,'Nocturne','/p/2')",
            [],
        )
        .unwrap();
        c.execute(
            "INSERT INTO rep_block
             (id,piece_id,m_start,m_end,planned_reps,focus,use_metronome)
             VALUES (20,2,1,8,4,'notes',0)",
            [],
        )
        .unwrap();
        c.execute(
            "INSERT INTO daily_work
             (goal_id,title,planned_minutes,origin_date,scheduled_date,source)
             VALUES (1,'Keep me',15,'2026-07-11','2026-07-12','manual')",
            [],
        )
        .unwrap();

        let source_rows = [
            (
                1,
                "2026-07-11 09:00:00",
                "rep_open",
                r#"{"piece_id":1,"block_id":1,"bpm":72}"#,
            ),
            (
                2,
                "2026-07-11 09:01:02",
                "rep",
                r#"{"piece_id":1,"block_id":1,"verdict":"clean"}"#,
            ),
            (3, "2026-07-11 09:02:00", "metro", r#"{"bpm":72}"#),
            (4, "2026-07-11 09:03:00", "rep", "not-json"),
            (
                5,
                "2026-07-11 09:04:00",
                "rep",
                r#"{"piece_id":2,"block_id":1}"#,
            ),
            (
                6,
                "2026-07-11 09:05:00",
                "rep",
                r#"{"piece_id":999,"block_id":1}"#,
            ),
            (
                7,
                "2026-07-11 09:06:00",
                "rep",
                r#"{"piece_id":1,"block_id":999}"#,
            ),
            (8, "2026-07-11 09:07:00", "rep", r#"{"block_id":1}"#),
        ];
        for (id, ts, kind, payload) in source_rows {
            c.execute(
                "INSERT INTO session_event (id,session_id,ts,kind,payload)
                 VALUES (?1,1,?2,?3,?4)",
                rusqlite::params![id, ts, kind, payload],
            )
            .unwrap();
        }
        // Simulate a post-v3 dual write. It must be claimed, not copied again.
        c.execute(
            "INSERT INTO event (id,ts,session_id,piece_id,kind,payload)
             VALUES (100,'2026-07-11 09:00:00',1,1,'rep_open',
                     '{\"piece_id\":1,\"block_id\":1,\"bpm\":72}')",
            [],
        )
        .unwrap();

        let preserved_tables = [
            "piece",
            "rep_block",
            "rep",
            "session",
            "session_event",
            "region",
            "goal",
            "daily_work",
        ];
        let before: Vec<i64> = preserved_tables
            .iter()
            .map(|table| {
                c.query_row(&format!("SELECT count(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .unwrap()
            })
            .collect();
        let events_before: i64 = c
            .query_row("SELECT count(*) FROM event", [], |row| row.get(0))
            .unwrap();

        migrate(&c).unwrap();
        assert_eq!(
            c.query_row("PRAGMA user_version", [], |row| row.get::<_, i32>(0))
                .unwrap(),
            SCHEMA_VERSION
        );
        let after: Vec<i64> = preserved_tables
            .iter()
            .map(|table| {
                c.query_row(&format!("SELECT count(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .unwrap()
            })
            .collect();
        assert_eq!(
            after, before,
            "v6 must not rewrite or delete any v5 graph row"
        );
        assert_eq!(
            c.query_row("SELECT count(*) FROM event", [], |row| row.get::<_, i64>(0))
                .unwrap(),
            events_before + 2,
            "the unmatched rep and exact piece-level deleted-block history are inserted"
        );
        assert_eq!(
            c.query_row("SELECT count(*) FROM session_event_backfill", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            8,
            "every legacy row receives one durable disposition"
        );
        assert_eq!(
            c.query_row(
                "SELECT canonical_event_id FROM session_event_backfill
                 WHERE legacy_session_event_id=1 AND disposition='matched'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap(),
            100
        );

        let copied: (String, i64, i64, String, String) = c
            .query_row(
                "SELECT event.ts,event.session_id,event.piece_id,event.kind,event.payload
                 FROM event JOIN session_event_backfill ledger
                   ON ledger.canonical_event_id=event.id
                 WHERE ledger.legacy_session_event_id=2
                   AND ledger.disposition='inserted'",
                [],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )
            .unwrap();
        assert_eq!(
            copied,
            (
                "2026-07-11 09:01:02".into(),
                1,
                1,
                "rep".into(),
                r#"{"piece_id":1,"block_id":1,"verdict":"clean"}"#.into(),
            ),
            "the canonical copy preserves the exact source tuple"
        );

        let skipped: Vec<(i64, String)> = {
            let mut statement = c
                .prepare(
                    "SELECT legacy_session_event_id,reason FROM session_event_backfill
                     WHERE disposition='skipped' ORDER BY legacy_session_event_id",
                )
                .unwrap();
            statement
                .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
                .unwrap()
                .collect::<Result<_, _>>()
                .unwrap()
        };
        assert_eq!(
            skipped,
            vec![
                (3, "unsupported_kind".into()),
                (4, "malformed_payload".into()),
                (5, "cross_piece_block".into()),
                (6, "missing_piece".into()),
                (8, "missing_piece_id".into()),
            ]
        );
        assert_eq!(
            c.query_row(
                "SELECT reason FROM session_event_backfill WHERE legacy_session_event_id=7",
                [],
                |row| row.get::<_, String>(0),
            )
            .unwrap(),
            "backfilled_deleted_block"
        );

        let event_count: i64 = c
            .query_row("SELECT count(*) FROM event", [], |row| row.get(0))
            .unwrap();
        migrate(&c).unwrap();
        assert_eq!(
            c.query_row("SELECT count(*) FROM event", [], |row| row.get::<_, i64>(0))
                .unwrap(),
            event_count,
            "a second migration inserts zero events"
        );
        assert_eq!(
            super::super::history_backfill::backfill_history(&c).unwrap(),
            super::super::history_backfill::BackfillStats::default(),
            "the ledger also makes the worker itself idempotent"
        );
        c.execute(
            "INSERT INTO session_event (id,session_id,ts,kind,payload)
             VALUES (9,1,'2026-07-11 09:08:00','rep',
                     '{\"piece_id\":1,\"block_id\":1,\"verdict\":\"clean\"}')",
            [],
        )
        .unwrap();
        migrate(&c).unwrap();
        assert_eq!(
            c.query_row(
                "SELECT count(*) FROM session_event_backfill WHERE legacy_session_event_id=9",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap(),
            1,
            "every schema-v6 open reconciles a live-feed write missed by the canonical log"
        );
        assert_eq!(
            c.query_row("SELECT count(*) FROM event", [], |row| row.get::<_, i64>(0))
                .unwrap(),
            event_count + 1
        );
        assert_eq!(
            c.query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |row| {
                row.get::<_, i64>(0)
            })
            .unwrap(),
            0
        );
    }

    #[test]
    fn v6_failure_rolls_back_schema_events_ledger_and_version() {
        let c = seed_v5();
        for (id, block_id) in [(1, 1), (2, 2)] {
            c.execute(
                "INSERT INTO session_event (id,session_id,ts,kind,payload)
                 VALUES (?1,1,?2,'rep',?3)",
                rusqlite::params![
                    id,
                    format!("2026-07-11 10:00:0{id}"),
                    format!(r#"{{"piece_id":1,"block_id":{block_id}}}"#),
                ],
            )
            .unwrap();
        }
        let before_events: i64 = c
            .query_row("SELECT count(*) FROM event", [], |row| row.get(0))
            .unwrap();
        c.execute_batch(
            "CREATE TRIGGER fail_second_backfill
             BEFORE INSERT ON event
             WHEN NEW.payload = '{\"piece_id\":1,\"block_id\":2}'
             BEGIN SELECT RAISE(ABORT,'simulated interruption'); END;",
        )
        .unwrap();

        assert!(migrate(&c).is_err());
        assert_eq!(
            c.query_row("PRAGMA user_version", [], |row| row.get::<_, i32>(0))
                .unwrap(),
            5
        );
        assert_eq!(
            c.query_row("SELECT count(*) FROM event", [], |row| row.get::<_, i64>(0))
                .unwrap(),
            before_events,
            "the first copied event rolls back with the later failure"
        );
        assert_eq!(
            c.query_row(
                "SELECT count(*) FROM sqlite_master
                 WHERE type='table' AND name='session_event_backfill'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap(),
            0,
            "the ledger DDL is in the same failed transaction"
        );

        c.execute_batch("DROP TRIGGER fail_second_backfill;")
            .unwrap();
        migrate(&c).unwrap();
        assert_eq!(
            c.query_row("PRAGMA user_version", [], |row| row.get::<_, i32>(0))
                .unwrap(),
            SCHEMA_VERSION
        );
        assert_eq!(
            c.query_row("SELECT count(*) FROM session_event_backfill", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            2
        );
    }

    #[test]
    fn migrate_v7_to_v8_preserves_source_rows_and_projects_legacy_truth() {
        let c = seed_v7();
        let region_id: i64 = c
            .query_row("SELECT min(id) FROM region", [], |row| row.get(0))
            .unwrap();
        let other_region_id: i64 = c
            .query_row("SELECT max(id) FROM region", [], |row| row.get(0))
            .unwrap();
        assert_ne!(region_id, other_region_id);
        let anchor = r#" { "version": 1, "editions": { "score.pdf": { "rects": [] } } } "#;
        c.execute(
            "UPDATE region
             SET m_start=90,m_end=80,pdf_anchor=?2,sort_order=-7 WHERE id=?1",
            rusqlite::params![region_id, anchor],
        )
        .unwrap();
        c.execute(
            "UPDATE region SET m_start=0,m_end=1 WHERE id=?1",
            [other_region_id],
        )
        .unwrap();
        c.execute("UPDATE rep_block SET planned_reps=1 WHERE id=1", [])
            .unwrap();
        c.execute("UPDATE rep_block SET planned_reps=-3 WHERE id=2", [])
            .unwrap();
        c.execute(
            "UPDATE rep SET ts='2026-07-15 10:00:00' WHERE block_id=1",
            [],
        )
        .unwrap();
        c.execute("UPDATE rep_block SET m_start=50,m_end=40 WHERE id=3", [])
            .unwrap();
        c.execute(
            "INSERT INTO rep_block
             (id,piece_id,m_start,m_end,label,planned_reps,status,focus,use_metronome)
             VALUES (4,1,1,8,NULL,1,'abandoned','tempo',1)",
            [],
        )
        .unwrap();

        let source_before: (i64, i64, i64, String) = c
            .query_row(
                "SELECT
                   (SELECT count(*) FROM region),
                   (SELECT count(*) FROM rep_block),
                   (SELECT count(*) FROM rep),
                   (SELECT pdf_anchor FROM region WHERE id=?1)",
                [region_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();

        migrate(&c).unwrap();

        assert_eq!(
            c.query_row("PRAGMA user_version", [], |row| row.get::<_, i32>(0))
                .unwrap(),
            SCHEMA_VERSION
        );
        for table in [
            "score_section",
            "target_meta",
            "score_edition_calibration",
            "protocol_template",
            "set_contract",
            "attempt_provenance",
            "attempt_adjustment",
            "retention_check",
            "data_anomaly",
            "action_draft",
            "brain_thread",
            "brain_turn",
        ] {
            assert_eq!(
                c.query_row(
                    "SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?1",
                    [table],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
                1,
                "missing schema-v8 sidecar {table}"
            );
        }

        let source_after: (i64, i64, i64, String) = c
            .query_row(
                "SELECT
                   (SELECT count(*) FROM region),
                   (SELECT count(*) FROM rep_block),
                   (SELECT count(*) FROM rep),
                   (SELECT pdf_anchor FROM region WHERE id=?1)",
                [region_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(source_after, source_before, "v8 never rewrites v1 rows");
        assert_eq!(source_after.3, anchor, "anchor bytes round-trip exactly");
        assert_eq!(
            c.query_row(
                "SELECT group_concat(id,',') FROM (SELECT id FROM rep ORDER BY id)",
                [],
                |row| row.get::<_, String>(0),
            )
            .unwrap(),
            "1,2",
            "physical attempt ids remain unchanged"
        );

        assert_eq!(
            c.query_row("SELECT count(*) FROM target_meta", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            source_before.0
        );
        assert_eq!(
            c.query_row(
                "SELECT display_order FROM target_meta WHERE region_id=?1",
                [region_id],
                |row| row.get::<_, i64>(0),
            )
            .unwrap(),
            -7,
            "legacy ordering is copied exactly rather than silently clamped"
        );
        assert_eq!(
            c.query_row("SELECT count(*) FROM set_contract", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            source_before.1
        );
        let legacy: (String, String, String, String) = c
            .query_row(
                "SELECT mastery_basis,mastery_verification,set_state,source
                 FROM set_contract WHERE set_id=1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(
            legacy,
            (
                "legacy_attempt_count".into(),
                "unverified".into(),
                "legacy_closed".into(),
                "migration_legacy".into()
            )
        );
        assert_eq!(
            c.query_row(
                "SELECT count(*) FROM attempt_provenance WHERE source='migration_legacy'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap(),
            source_before.2
        );
        assert_eq!(
            c.query_row(
                "SELECT required_success FROM protocol_template
                 WHERE id='default-consecutive-clean-v1'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap(),
            5
        );

        for kind in [
            "reversed_range",
            "nonpositive_range",
            "invalid_planned_attempts",
            "attempt_overrun",
            "empty_set",
            "abandoned_legacy_set",
            "duplicate_candidate",
            "same_second_attempt_burst",
            "incomplete_event_provenance",
        ] {
            assert!(
                c.query_row(
                    "SELECT count(*) FROM data_anomaly WHERE kind=?1",
                    [kind],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap()
                    > 0,
                "expected projected anomaly {kind}"
            );
        }
        let burst_facts: String = c
            .query_row(
                "SELECT observed_facts_json FROM data_anomaly
                 WHERE kind='same_second_attempt_burst' AND entity_id=1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let burst_facts: serde_json::Value = serde_json::from_str(&burst_facts).unwrap();
        assert_eq!(burst_facts["attempt_ids"], serde_json::json!([1, 2]));
        assert_eq!(
            c.query_row("SELECT m_start FROM rep_block WHERE id=3", [], |row| row
                .get::<_, i64>(0),)
                .unwrap(),
            50,
            "a projected anomaly does not repair its source"
        );
        assert_eq!(
            c.query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |row| {
                row.get::<_, i64>(0)
            })
            .unwrap(),
            0
        );

        let anomaly_count: i64 = c
            .query_row("SELECT count(*) FROM data_anomaly", [], |row| row.get(0))
            .unwrap();
        c.execute_batch("BEGIN IMMEDIATE;").unwrap();
        let second = super::super::v8_backfill::backfill_v8(&c).unwrap();
        c.execute_batch("COMMIT;").unwrap();
        assert_eq!(second, super::super::v8_backfill::BackfillStats::default());
        migrate(&c).unwrap();
        assert_eq!(
            c.query_row("SELECT count(*) FROM data_anomaly", [], |row| {
                row.get::<_, i64>(0)
            })
            .unwrap(),
            anomaly_count,
            "worker and migration reopen are idempotent"
        );
    }

    #[test]
    fn migrate_v7_to_v10_adds_only_practice_loop_sidecars_and_reopens_idempotently() {
        let c = seed_v7();
        let source_counts = (
            c.query_row("SELECT count(*) FROM piece", [], |row| row.get::<_, i64>(0))
                .unwrap(),
            c.query_row("SELECT count(*) FROM region", [], |row| {
                row.get::<_, i64>(0)
            })
            .unwrap(),
            c.query_row("SELECT count(*) FROM rep_block", [], |row| {
                row.get::<_, i64>(0)
            })
            .unwrap(),
            c.query_row("SELECT count(*) FROM rep", [], |row| row.get::<_, i64>(0))
                .unwrap(),
            c.query_row("SELECT count(*) FROM event", [], |row| row.get::<_, i64>(0))
                .unwrap(),
        );

        migrate(&c).unwrap();
        assert_eq!(
            c.query_row("PRAGMA user_version", [], |row| row.get::<_, i32>(0))
                .unwrap(),
            10
        );
        for table in [
            "practice_operation",
            "practice_set_context",
            "practice_interval",
            "practice_reflection",
            "practice_safety_event",
            "practice_recovery_action",
            "retention_check_event",
        ] {
            assert_eq!(
                c.query_row(
                    "SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?1",
                    [table],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
                1,
                "missing additive v10 table {table}"
            );
        }
        assert_eq!(
            (
                c.query_row("SELECT count(*) FROM piece", [], |row| row.get::<_, i64>(0))
                    .unwrap(),
                c.query_row("SELECT count(*) FROM region", [], |row| row
                    .get::<_, i64>(0))
                    .unwrap(),
                c.query_row("SELECT count(*) FROM rep_block", [], |row| row
                    .get::<_, i64>(0))
                    .unwrap(),
                c.query_row("SELECT count(*) FROM rep", [], |row| row.get::<_, i64>(0))
                    .unwrap(),
                c.query_row("SELECT count(*) FROM event", [], |row| row.get::<_, i64>(0))
                    .unwrap(),
            ),
            source_counts,
            "v10 creates sidecars without changing physical v1 evidence rows"
        );
        assert_eq!(
            c.query_row("SELECT count(*) FROM practice_operation", [], |row| {
                row.get::<_, i64>(0)
            })
            .unwrap(),
            0,
            "migration must not invent runtime operations"
        );
        migrate(&c).unwrap();
        assert_eq!(
            c.query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |row| {
                row.get::<_, i64>(0)
            })
            .unwrap(),
            0
        );
    }

    #[test]
    fn v8_constraints_reject_cross_piece_context_reversal_and_duplicate_calibration() {
        let c = seed_v7();
        c.execute(
            "INSERT INTO piece(id,title,folder_path) VALUES (100,'Other','/p/other')",
            [],
        )
        .unwrap();
        c.execute(
            "INSERT INTO region(id,piece_id,name,m_start,m_end)
             VALUES (100,100,'Other target',1,4)",
            [],
        )
        .unwrap();
        c.execute(
            "INSERT INTO rep_block
             (id,piece_id,m_start,m_end,planned_reps,status,focus,use_metronome)
             VALUES (100,100,1,4,5,'open','tempo',1)",
            [],
        )
        .unwrap();
        c.execute(
            "INSERT INTO rep(id,block_id,bpm,verdict) VALUES (100,100,60,'clean')",
            [],
        )
        .unwrap();
        migrate(&c).unwrap();

        let piece_one_region: i64 = c
            .query_row("SELECT min(id) FROM region WHERE piece_id=1", [], |row| {
                row.get(0)
            })
            .unwrap();
        let piece_one_set: i64 = c
            .query_row(
                "SELECT min(id) FROM rep_block WHERE piece_id=1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let piece_one_rep: i64 = c
            .query_row(
                "SELECT min(r.id) FROM rep r
                 JOIN rep_block b ON b.id=r.block_id WHERE b.piece_id=1",
                [],
                |row| row.get(0),
            )
            .unwrap();

        assert!(c
            .execute(
                "UPDATE target_meta SET parent_region_id=100 WHERE region_id=?1",
                [piece_one_region],
            )
            .is_err());
        c.execute(
            "INSERT INTO score_section
             (id,piece_id,name,m_start,m_end,source)
             VALUES (100,100,'Other section',1,4,'user')",
            [],
        )
        .unwrap();
        assert!(c
            .execute(
                "UPDATE target_meta SET score_section_id=100 WHERE region_id=?1",
                [piece_one_region],
            )
            .is_err());
        assert!(c
            .execute(
                "UPDATE set_contract SET restart_of_set_id=100 WHERE set_id=?1",
                [piece_one_set],
            )
            .is_err());
        assert!(c
            .execute(
                "UPDATE set_contract SET restart_of_set_id=set_id WHERE set_id=?1",
                [piece_one_set],
            )
            .is_err());
        assert!(c
            .execute(
                "INSERT INTO retention_check
                 (region_id,source_set_id,due_date,original_due_date)
                 VALUES (?1,100,'2026-07-16','2026-07-16')",
                [piece_one_region],
            )
            .is_err());
        assert!(c
            .execute(
                "INSERT INTO action_draft
                 (piece_id,region_id,source,original_text,operations_json,
                  risk,revision_hash,status)
                 VALUES (1,100,'voice_draft','change it','[]','low','r1','draft')",
                [],
            )
            .is_err());
        assert!(c
            .execute(
                "INSERT INTO brain_thread(piece_id,region_id) VALUES (1,100)",
                [],
            )
            .is_err());

        c.execute(
            "INSERT INTO attempt_adjustment
             (id,rep_id,kind,before_json,after_json,source,command_id)
             VALUES (1,?1,'void','{}','{}','user_click','adj-one')",
            [piece_one_rep],
        )
        .unwrap();
        assert!(c
            .execute(
                "INSERT INTO attempt_adjustment
                 (id,rep_id,kind,before_json,after_json,source,command_id,
                  reverses_adjustment_id)
                 VALUES (2,100,'restore','{}','{}','user_click','adj-two',1)",
                [],
            )
            .is_err());

        c.execute(
            "INSERT INTO score_edition_calibration
             (id,piece_id,edition_id,edition_fingerprint,method,confidence)
             VALUES (1,1,'score.pdf','sha256:one','user_confirmed',1.0)",
            [],
        )
        .unwrap();
        assert!(c
            .execute(
                "INSERT INTO score_edition_calibration
                 (id,piece_id,edition_id,edition_fingerprint,method,confidence)
                 VALUES (2,1,'score.pdf','sha256:one','calibrated',0.8)",
                [],
            )
            .is_err());
        assert_eq!(
            c.query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |row| {
                row.get::<_, i64>(0)
            })
            .unwrap(),
            0
        );
    }

    #[test]
    fn v8_backfill_failure_rolls_back_all_sidecars_and_version() {
        let c = seed_v7();
        c.execute_batch("BEGIN IMMEDIATE;").unwrap();
        c.execute_batch(SCHEMA_V8).unwrap();
        c.execute_batch(
            "CREATE TRIGGER fail_v8_contract_backfill
             BEFORE INSERT ON set_contract
             BEGIN SELECT RAISE(ABORT,'simulated v8 backfill interruption'); END;",
        )
        .unwrap();
        assert!(super::super::v8_backfill::backfill_v8(&c).is_err());
        c.execute_batch("ROLLBACK;").unwrap();

        assert_eq!(
            c.query_row("PRAGMA user_version", [], |row| row.get::<_, i32>(0))
                .unwrap(),
            7
        );
        assert_eq!(
            c.query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='score_section'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap(),
            0,
            "DDL and earlier default/template inserts share the rollback"
        );

        migrate(&c).unwrap();
        assert_eq!(
            c.query_row("PRAGMA user_version", [], |row| row.get::<_, i32>(0))
                .unwrap(),
            SCHEMA_VERSION
        );
    }

    #[test]
    fn newer_schema_fails_before_reconciliation_or_writes() {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(
            "CREATE TABLE sentinel(id INTEGER PRIMARY KEY,value TEXT);
             INSERT INTO sentinel(id,value) VALUES (1,'preserve me');
             PRAGMA user_version = 11;",
        )
        .unwrap();

        let error = migrate(&c).unwrap_err().to_string();
        assert!(error.contains("newer than supported"), "{error}");
        assert_eq!(
            c.query_row("PRAGMA user_version", [], |row| row.get::<_, i32>(0))
                .unwrap(),
            11
        );
        assert_eq!(
            c.query_row("SELECT value FROM sentinel WHERE id=1", [], |row| {
                row.get::<_, String>(0)
            })
            .unwrap(),
            "preserve me"
        );
        assert_eq!(
            c.query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='score_section'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap(),
            0
        );
    }
}
