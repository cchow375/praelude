//! Schema migrations, gated by `PRAGMA user_version`.
//!
//! Single-step v1 migration: apply the full schema (spec §5) when the database
//! reports `user_version == 0`, then stamp it to `SCHEMA_VERSION`. JSON-shaped
//! columns are stored as `TEXT` (SQLite has no native JSON type; values are
//! serialized JSON strings).

use rusqlite::Connection;

/// Current schema version. `Store::open` migrates any older database up to this.
pub const SCHEMA_VERSION: i32 = 5;

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

/// Migrate `conn` up to [`SCHEMA_VERSION`], applying only the steps its current
/// `user_version` has not yet seen. Idempotent: a fully-migrated database is a
/// no-op. Steps are layered (v0→v1→v2→v3) so a fresh database and older databases
/// all converge on the same current schema.
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
            conn.execute_batch(&format!("PRAGMA user_version = {SCHEMA_VERSION};"))?;
            conn.execute_batch("COMMIT;")?;
            Ok(())
        })();
        if let Err(error) = v5 {
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

    fn seed_v3() -> Connection {
        let c = seed_v2();
        c.execute_batch("PRAGMA foreign_keys = OFF; BEGIN;").unwrap();
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
        c.execute("INSERT INTO session (id) VALUES (1)", []).unwrap();
        c.execute(
            "INSERT INTO event (session_id,piece_id,kind,payload) VALUES (1,1,'rep','{\"block_id\":1}')",
            [],
        )
        .unwrap();
        c
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

        let version: i32 = c.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(version, 5);
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
            .query_row(
                "SELECT preferred_pdf_path FROM piece WHERE id=1",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(preferred, "/p/1/score/urtext.pdf");
    }

    #[test]
    fn migrate_v2_to_v3_is_additive_and_backfills() {
        let c = seed_v2();
        migrate(&c).unwrap();

        // schema stamped
        let v: i32 = c.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v, 5);

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

        // copied VALUES survived the rep_block rebuild (guards against a
        // mis-mapped INSERT…SELECT, not just row counts): block 1's seeded
        // start_bpm and its increment_rule JSON string must be intact.
        let (sb, rule): (f64, String) = c.query_row(
            "SELECT start_bpm, increment_rule FROM rep_block WHERE id=1", [],
            |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!(sb, 40.0);
        assert_eq!(rule, "{\"clean_needed\":2,\"bpm_step\":4}");
        let (m_start, m_end): (i64, i64) = c.query_row(
            "SELECT m_start, m_end FROM rep_block WHERE id=3", [],
            |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!((m_start, m_end), (40, 48));

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

    #[test]
    fn migrate_v4_to_v5_preserves_every_existing_graph_and_is_idempotent() {
        let c = seed_v4();
        let tables = [
            "piece", "rep_block", "rep", "session", "session_event", "spot_review",
            "setting", "region", "goal", "event",
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
            5
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
            .query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |row| row.get(0))
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
            c.query_row("SELECT count(*) FROM daily_work", [], |row| row.get::<_, i64>(0))
                .unwrap(),
            1,
            "reopening v5 must not duplicate or clear work"
        );
    }

    #[test]
    fn v5_constraints_reject_impossible_dates_ranges_states_and_origin_rewrites() {
        let c = seed_v4();
        migrate(&c).unwrap();
        let insert = |title: &str, minutes: i64, origin: &str, scheduled: &str, status: &str,
                      source: &str, completed: Option<&str>| {
            c.execute(
                "INSERT INTO daily_work
                 (goal_id,title,planned_minutes,origin_date,scheduled_date,status,source,completed_ts)
                 VALUES (1,?1,?2,?3,?4,?5,?6,?7)",
                rusqlite::params![title, minutes, origin, scheduled, status, source, completed],
            )
        };
        assert!(insert("Leap work", 30, "2028-02-29", "2028-02-29", "planned", "manual", None).is_ok());
        for bad in ["2026-02-29", "2026-04-31", "2026-13-01", "0000-01-01"] {
            assert!(insert("Bad date", 30, bad, "2026-07-12", "planned", "manual", None).is_err(), "{bad}");
        }
        assert!(insert("", 30, "2026-07-12", "2026-07-12", "planned", "manual", None).is_err());
        assert!(insert("Too short", 0, "2026-07-12", "2026-07-12", "planned", "manual", None).is_err());
        assert!(insert("Too long", 241, "2026-07-12", "2026-07-12", "planned", "manual", None).is_err());
        assert!(insert("Bad state", 30, "2026-07-12", "2026-07-12", "missed", "manual", None).is_err());
        assert!(insert("Bad source", 30, "2026-07-12", "2026-07-12", "planned", "ai", None).is_err());
        assert!(insert("Fake done", 30, "2026-07-12", "2026-07-12", "done", "manual", None).is_err());
        assert!(c.execute("UPDATE daily_work SET origin_date='2028-03-01' WHERE title='Leap work'", []).is_err());
    }
}
