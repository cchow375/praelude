//! Schema migrations, gated by `PRAGMA user_version`.
//!
//! Single-step v1 migration: apply the full schema (spec §5) when the database
//! reports `user_version == 0`, then stamp it to `SCHEMA_VERSION`. JSON-shaped
//! columns are stored as `TEXT` (SQLite has no native JSON type; values are
//! serialized JSON strings).

use rusqlite::Connection;

/// Current schema version. `Store::open` migrates any older database up to this.
pub const SCHEMA_VERSION: i32 = 2;

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
const SCHEMA_V2: &str = "\
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

/// Migrate `conn` up to [`SCHEMA_VERSION`], applying only the steps its current
/// `user_version` has not yet seen. Idempotent: a fully-migrated database is a
/// no-op. Steps are layered (v0→v1→v2) so a fresh database and a v1 database both
/// converge on the same v2 schema.
pub fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    let version: i32 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;

    if version < 1 {
        conn.execute_batch(SCHEMA_V1)?;
    }

    if version < 2 {
        conn.execute_batch(SCHEMA_V2)?;
    }

    if version != SCHEMA_VERSION {
        // PRAGMA user_version does not accept bound parameters.
        conn.execute_batch(&format!("PRAGMA user_version = {}", SCHEMA_VERSION))?;
    }

    Ok(())
}
