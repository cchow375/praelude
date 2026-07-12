//! Schema migrations, gated by `PRAGMA user_version`.
//!
//! Single-step v1 migration: apply the full schema (spec §5) when the database
//! reports `user_version == 0`, then stamp it to `SCHEMA_VERSION`. JSON-shaped
//! columns are stored as `TEXT` (SQLite has no native JSON type; values are
//! serialized JSON strings).

use rusqlite::Connection;

/// Current schema version. `Store::open` migrates any older database up to this.
pub const SCHEMA_VERSION: i32 = 3;

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

/// Migrate `conn` up to [`SCHEMA_VERSION`], applying only the steps its current
/// `user_version` has not yet seen. Idempotent: a fully-migrated database is a
/// no-op. Steps are layered (v0→v1→v2→v3) so a fresh database and older databases
/// all converge on the same v3 schema.
pub fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    let version: i32 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;

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
        // foreign_keys` only takes effect outside an open transaction, so this
        // relies on `execute_batch` not wrapping these statements in one.
        conn.execute_batch("PRAGMA foreign_keys = OFF;")?;
        conn.execute_batch(SCHEMA_V3)?;
        super::backfill::backfill_v3(conn)?;
        conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    }

    if version != SCHEMA_VERSION {
        // PRAGMA user_version does not accept bound parameters.
        conn.execute_batch(&format!("PRAGMA user_version = {}", SCHEMA_VERSION))?;
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
             '[{\"measures\":\"12-16\",\"note\":\"LH leap\"}]')", []).unwrap();
        for (id, s, e) in [(1, 1, 8), (2, 5, 12), (3, 40, 48)] {
            c.execute(
                "INSERT INTO rep_block (id,piece_id,m_start,m_end,start_bpm,increment_rule,planned_reps,status) \
                 VALUES (?1,1,?2,?3,40.0,'{\"clean_needed\":2,\"bpm_step\":4}',10,'done')",
                (id, s, e)).unwrap();
        }
        c.execute("INSERT INTO rep (block_id,bpm,verdict) VALUES (1,40.0,'clean')", []).unwrap();
        c.execute("INSERT INTO rep (block_id,bpm,verdict) VALUES (1,40.0,'flawed')", []).unwrap();
        c
    }

    #[test]
    fn migrate_v2_to_v3_is_additive_and_backfills() {
        let c = seed_v2();
        migrate(&c).unwrap();

        // schema stamped
        let v: i32 = c.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v, 3);

        // new tables exist
        for t in ["region", "goal", "event"] {
            let n: i64 = c.query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?1",
                [t], |r| r.get(0)).unwrap();
            assert_eq!(n, 1, "table {t} missing");
        }

        // all prior blocks/reps preserved
        let blocks: i64 = c.query_row("SELECT count(*) FROM rep_block", [], |r| r.get(0)).unwrap();
        assert_eq!(blocks, 3);
        let reps: i64 = c.query_row("SELECT count(*) FROM rep", [], |r| r.get(0)).unwrap();
        assert_eq!(reps, 2);

        // rep_block gained columns with correct defaults
        let (focus, use_metro): (String, i64) = c.query_row(
            "SELECT focus, use_metronome FROM rep_block WHERE id=1", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!(focus, "tempo");
        assert_eq!(use_metro, 1);

        // session gained focused_seconds
        c.execute("INSERT INTO session (id) VALUES (1)", []).unwrap();
        let fs: Option<i64> = c.query_row("SELECT focused_seconds FROM session WHERE id=1", [], |r| r.get(0)).unwrap();
        assert_eq!(fs, None);

        // back-fill: blocks 1&2 overlap → one section region; block 3 → another; + 1 hard_spot region
        let sections: i64 = c.query_row(
            "SELECT count(*) FROM region WHERE piece_id=1 AND kind='section'", [], |r| r.get(0)).unwrap();
        assert_eq!(sections, 2);
        let hard: i64 = c.query_row(
            "SELECT count(*) FROM region WHERE piece_id=1 AND kind='hard_spot'", [], |r| r.get(0)).unwrap();
        assert_eq!(hard, 1);
        // blocks 1 and 2 assigned to the same region
        let (r1, r2): (i64, i64) = c.query_row(
            "SELECT (SELECT region_id FROM rep_block WHERE id=1),(SELECT region_id FROM rep_block WHERE id=2)",
            [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!(r1, r2);

        // intake goals → Goal rows kind=big
        let goals: i64 = c.query_row(
            "SELECT count(*) FROM goal WHERE piece_id=1 AND kind='big'", [], |r| r.get(0)).unwrap();
        assert_eq!(goals, 2);

        // idempotent: second migrate does not duplicate
        migrate(&c).unwrap();
        let regions2: i64 = c.query_row("SELECT count(*) FROM region", [], |r| r.get(0)).unwrap();
        assert_eq!(regions2, 3);
    }
}
