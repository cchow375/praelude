//! SQLite-backed persistence (rusqlite, bundled).
//!
//! `Store` owns a single [`rusqlite::Connection`]. Connection is not `Sync`, so
//! it is wrapped in a `Mutex`; the app manages one `Store` as Tauri state and
//! all commands serialize through that lock. At this app's scale (a single local
//! user, low write volume) a global lock is more than adequate.

mod backfill;
mod events;
mod migrations;
pub mod model;

pub use events::EventKind;

use std::path::Path;
use std::sync::Mutex;

use rusqlite::{Connection, OptionalExtension};

use model::{
    json_from_sql, json_to_sql, BlockHistory, HardSpot, Intake, PieceDetail, PieceSummary,
    ScanPiece, SessionEventView, VariantSpec, VerdictCounts,
};
use model::IncrementRule;

/// A migrated SQLite store. Thread-safe via an internal `Mutex`.
pub struct Store {
    conn: Mutex<Connection>,
}

impl Store {
    /// Open (creating if absent) the database at `path` and migrate it to the
    /// current schema version. Pass `":memory:"` for an ephemeral test database.
    pub fn open<P: AsRef<Path>>(path: P) -> rusqlite::Result<Self> {
        let conn = Connection::open(path)?;
        Self::from_connection(conn)
    }

    fn from_connection(conn: Connection) -> rusqlite::Result<Self> {
        conn.execute_batch("PRAGMA foreign_keys = ON;")?;
        migrations::migrate(&conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// The database's current `PRAGMA user_version`. Part of the store contract
    /// (migration gate); currently exercised only by tests.
    #[allow(dead_code)]
    pub fn schema_version(&self) -> rusqlite::Result<i32> {
        // A poisoned lock (panic while holding it) must not permanently kill the
        // settings store for the rest of the app; recover the inner data instead.
        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        conn.query_row("PRAGMA user_version", [], |row| row.get(0))
    }

    /// Read a setting, or `None` if the key is absent.
    pub fn get_setting(&self, key: &str) -> rusqlite::Result<Option<String>> {
        // See `schema_version`: recover from a poisoned lock rather than propagate it.
        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        conn.query_row(
            "SELECT value FROM setting WHERE key = ?1",
            [key],
            |row| row.get(0),
        )
        .optional()
    }

    /// Insert-or-replace several settings atomically in a single transaction.
    /// Used by write-through paths (e.g. `metro_set` persisting all metronome
    /// settings) so the six writes commit as one unit and take one lock, rather
    /// than six independent statements.
    pub fn set_settings(&self, pairs: &[(&str, String)]) -> rusqlite::Result<()> {
        // See `schema_version`: recover from a poisoned lock rather than propagate it.
        let mut conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        let tx = conn.transaction()?;
        {
            let mut stmt = tx.prepare(
                "INSERT INTO setting (key, value) VALUES (?1, ?2)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            )?;
            for (key, value) in pairs {
                stmt.execute((key, value.as_str()))?;
            }
        }
        tx.commit()
    }

    /// Insert or replace a setting.
    pub fn set_setting(&self, key: &str, value: &str) -> rusqlite::Result<()> {
        // See `schema_version`: recover from a poisoned lock rather than propagate it.
        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        conn.execute(
            "INSERT INTO setting (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [key, value],
        )?;
        Ok(())
    }

    // ── Pieces ────────────────────────────────────────────────────────────
    //
    // `folder_path` is the natural key: a piece IS its vault folder, and a
    // rescan re-discovers the same folder. So upsert keys on `folder_path` and,
    // on conflict, refreshes ONLY the machine-derived fields (title, composer,
    // xml/pdf paths) — never the human-authored intake fields. That is what lets
    // a rescan after the user has done intake leave their goals/hard-spots/notes
    // intact.

    /// Insert a scanned piece, or refresh an existing one keyed on `folder_path`.
    /// Returns the piece's row id. On conflict, title/composer/xml_path/pdf_path
    /// are refreshed and every intake field is preserved.
    pub fn upsert_piece(&self, piece: &ScanPiece) -> rusqlite::Result<i64> {
        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        let xml = piece.xml_path.as_ref().map(|p| p.to_string_lossy().into_owned());
        let pdf = piece.pdf_path.as_ref().map(|p| p.to_string_lossy().into_owned());
        conn.query_row(
            "INSERT INTO piece (title, composer, folder_path, xml_path, pdf_path)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(folder_path) DO UPDATE SET
                 title    = excluded.title,
                 composer = excluded.composer,
                 xml_path = excluded.xml_path,
                 pdf_path = excluded.pdf_path
             RETURNING id",
            rusqlite::params![piece.title, piece.composer, piece.folder_path, xml, pdf],
            |row| row.get(0),
        )
    }

    /// All pieces as list-view summaries, ordered by title (case-insensitive).
    pub fn list_pieces(&self) -> rusqlite::Result<Vec<PieceSummary>> {
        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        let mut stmt = conn.prepare(
            "SELECT id, title, composer,
                    xml_path IS NOT NULL, pdf_path IS NOT NULL, intake_done
             FROM piece
             ORDER BY title COLLATE NOCASE",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(PieceSummary {
                id: row.get(0)?,
                title: row.get(1)?,
                composer: row.get(2)?,
                has_xml: row.get(3)?,
                has_pdf: row.get(4)?,
                intake_done: row.get(5)?,
            })
        })?;
        rows.collect()
    }

    /// Full detail for one piece, or `None` if the id is unknown.
    pub fn get_piece(&self, id: i64) -> rusqlite::Result<Option<PieceDetail>> {
        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        conn.query_row(
            "SELECT id, title, composer, folder_path, xml_path, pdf_path,
                    goals, deadline, target_tempo, hard_spots, current_state,
                    intake_done, notes
             FROM piece WHERE id = ?1",
            [id],
            |row| {
                let goals_json: String = row.get(6)?;
                let hard_spots_json: String = row.get(9)?;
                let xml_path: Option<String> = row.get(4)?;
                let pdf_path: Option<String> = row.get(5)?;
                Ok(PieceDetail {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    composer: row.get(2)?,
                    has_xml: xml_path.is_some(),
                    has_pdf: pdf_path.is_some(),
                    folder_path: row.get(3)?,
                    xml_path,
                    pdf_path,
                    goals: json_from_sql(&goals_json)?,
                    deadline: row.get(7)?,
                    target_tempo: row.get(8)?,
                    hard_spots: json_from_sql::<Vec<HardSpot>>(&hard_spots_json)?,
                    current_state: row.get(10)?,
                    intake_done: row.get(11)?,
                    notes: row.get(12)?,
                })
            },
        )
        .optional()
    }

    /// Persist a piece's intake payload and mark intake complete.
    pub fn save_intake(&self, id: i64, intake: &Intake) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        conn.execute(
            "UPDATE piece SET
                 goals         = ?2,
                 deadline      = ?3,
                 target_tempo  = ?4,
                 hard_spots    = ?5,
                 current_state = ?6,
                 intake_done   = 1
             WHERE id = ?1",
            rusqlite::params![
                id,
                json_to_sql(&intake.goals)?,
                intake.deadline,
                intake.target_tempo,
                json_to_sql(&intake.hard_spots)?,
                intake.current_state,
            ],
        )?;
        Ok(())
    }

}

/// Rep, block, and session persistence. These methods are the data layer the
/// Task 17 rep engine and Task 18 session layer build on; they are exercised by
/// this module's tests but have no in-crate callers yet, hence the crate-local
/// `dead_code` allowance (the same pattern `schema_version` uses).
#[allow(dead_code)]
impl Store {
    // ── Rep blocks & reps ─────────────────────────────────────────────────

    /// Insert a new rep block (always `status = 'open'`); returns its row id.
    /// `increment_rule`/`variants` are stored as JSON.
    #[allow(clippy::too_many_arguments)]
    pub fn insert_rep_block(
        &self,
        piece_id: i64,
        m_start: u32,
        m_end: u32,
        label: Option<&str>,
        start_bpm: f64,
        target_bpm: Option<f64>,
        increment_rule: &IncrementRule,
        planned_reps: u32,
        variants: &[VariantSpec],
    ) -> rusqlite::Result<i64> {
        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        conn.query_row(
            "INSERT INTO rep_block
                 (piece_id, m_start, m_end, label, start_bpm, target_bpm,
                  increment_rule, planned_reps, variants)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             RETURNING id",
            rusqlite::params![
                piece_id,
                m_start,
                m_end,
                label,
                start_bpm,
                target_bpm,
                json_to_sql(increment_rule)?,
                planned_reps,
                json_to_sql(variants)?,
            ],
            |row| row.get(0),
        )
    }

    /// Update a block's status (`open` / `done` / `abandoned`).
    pub fn update_block_status(&self, block_id: i64, status: &str) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        conn.execute(
            "UPDATE rep_block SET status = ?2 WHERE id = ?1",
            rusqlite::params![block_id, status],
        )?;
        Ok(())
    }

    /// Record a single rep against a block; returns its row id.
    pub fn insert_rep(
        &self,
        block_id: i64,
        bpm: f64,
        variant: Option<&str>,
        verdict: &str,
        note: Option<&str>,
    ) -> rusqlite::Result<i64> {
        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        conn.query_row(
            "INSERT INTO rep (block_id, bpm, variant, verdict, note)
             VALUES (?1, ?2, ?3, ?4, ?5)
             RETURNING id",
            rusqlite::params![block_id, bpm, variant, verdict, note],
            |row| row.get(0),
        )
    }

    /// Every rep block for a piece (newest first), each with its rep verdict
    /// tallies rolled up in a single query. `bpm` is the block's latest rep bpm
    /// (via a correlated subquery), falling back to `start_bpm` when the block
    /// has no reps yet.
    pub fn block_history(&self, piece_id: i64) -> rusqlite::Result<Vec<BlockHistory>> {
        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        let mut stmt = conn.prepare(
            "SELECT b.id, b.m_start, b.m_end, b.label,
                    b.start_bpm, b.target_bpm, b.planned_reps, b.status,
                    COUNT(r.id) AS reps_done,
                    COALESCE(SUM(r.verdict = 'clean'),  0) AS cleans,
                    COALESCE(SUM(r.verdict = 'flawed'), 0) AS flaweds,
                    COALESCE(SUM(r.verdict = 'failed'), 0) AS faileds,
                    COALESCE(
                        (SELECT r2.bpm FROM rep r2 WHERE r2.block_id = b.id
                         ORDER BY r2.id DESC LIMIT 1),
                        b.start_bpm
                    ) AS bpm
             FROM rep_block b
             LEFT JOIN rep r ON r.block_id = b.id
             WHERE b.piece_id = ?1
             GROUP BY b.id
             ORDER BY b.id DESC",
        )?;
        let rows = stmt.query_map([piece_id], |row| {
            Ok(BlockHistory {
                block_id: row.get(0)?,
                m_start: row.get(1)?,
                m_end: row.get(2)?,
                label: row.get(3)?,
                start_bpm: row.get(4)?,
                target_bpm: row.get(5)?,
                planned_reps: row.get(6)?,
                status: row.get(7)?,
                reps_done: row.get(8)?,
                verdicts: VerdictCounts {
                    clean: row.get(9)?,
                    flawed: row.get(10)?,
                    failed: row.get(11)?,
                },
                bpm: row.get(12)?,
            })
        })?;
        rows.collect()
    }

    // ── Sessions & the session event log ──────────────────────────────────

    /// Open a new session (server-stamped `started_at`); returns its row id.
    pub fn open_session(&self) -> rusqlite::Result<i64> {
        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        conn.query_row(
            "INSERT INTO session DEFAULT VALUES RETURNING id",
            [],
            |row| row.get(0),
        )
    }

    /// The id of the most recently opened session that has not been ended, if any.
    pub fn latest_open_session(&self) -> rusqlite::Result<Option<i64>> {
        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        conn.query_row(
            "SELECT id FROM session WHERE ended_at IS NULL ORDER BY id DESC LIMIT 1",
            [],
            |row| row.get(0),
        )
        .optional()
    }

    /// Append an event to a session's log. `payload` is stored as JSON TEXT.
    pub fn insert_session_event(
        &self,
        session_id: i64,
        kind: &str,
        payload: &serde_json::Value,
    ) -> rusqlite::Result<i64> {
        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        conn.query_row(
            "INSERT INTO session_event (session_id, kind, payload)
             VALUES (?1, ?2, ?3)
             RETURNING id",
            rusqlite::params![session_id, kind, json_to_sql(payload)?],
            |row| row.get(0),
        )
    }

    /// Close a session, stamping `ended_at` and storing its markdown summary.
    pub fn end_session(&self, id: i64, summary_md: &str) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        conn.execute(
            "UPDATE session SET ended_at = datetime('now'), summary_md = ?2 WHERE id = ?1",
            rusqlite::params![id, summary_md],
        )?;
        Ok(())
    }

    /// A session's events in chronological (insertion) order. The command layer
    /// reverses and caps for the newest-first, 200-capped session view.
    pub fn session_events(&self, session_id: i64) -> rusqlite::Result<Vec<SessionEventView>> {
        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        let mut stmt = conn.prepare(
            "SELECT ts, kind, payload FROM session_event
             WHERE session_id = ?1 ORDER BY id ASC",
        )?;
        let rows = stmt.query_map([session_id], |row| {
            let payload_json: String = row.get(2)?;
            Ok(SessionEventView {
                ts: row.get(0)?,
                kind: row.get(1)?,
                payload: json_from_sql(&payload_json)?,
            })
        })?;
        rows.collect()
    }

    /// A single session event by its row id (native `ts`). Used by the session
    /// service to build the `session://event` payload for the just-logged event
    /// without re-reading the whole log.
    pub fn session_event(&self, event_id: i64) -> rusqlite::Result<SessionEventView> {
        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        conn.query_row(
            "SELECT ts, kind, payload FROM session_event WHERE id = ?1",
            [event_id],
            |row| {
                let payload_json: String = row.get(2)?;
                Ok(SessionEventView {
                    ts: row.get(0)?,
                    kind: row.get(1)?,
                    payload: json_from_sql(&payload_json)?,
                })
            },
        )
    }

    /// A session's `started_at` (native ts), or `None` if the id is unknown.
    pub fn session_started_at(&self, session_id: i64) -> rusqlite::Result<Option<String>> {
        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        conn.query_row(
            "SELECT started_at FROM session WHERE id = ?1",
            [session_id],
            |row| row.get(0),
        )
        .optional()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mem() -> Store {
        Store::open(":memory:").expect("open in-memory store")
    }

    #[test]
    fn fresh_store_is_at_schema_version_3() {
        assert_eq!(mem().schema_version().unwrap(), 3);
    }

    #[test]
    fn setting_roundtrips() {
        let store = mem();
        assert_eq!(store.get_setting("theme").unwrap(), None);

        store.set_setting("theme", "dark").unwrap();
        assert_eq!(store.get_setting("theme").unwrap(), Some("dark".into()));

        // Upsert overwrites rather than erroring on the PK.
        store.set_setting("theme", "light").unwrap();
        assert_eq!(store.get_setting("theme").unwrap(), Some("light".into()));
    }

    #[test]
    fn all_seven_schema_tables_exist() {
        let store = mem();
        let conn = store.conn.lock().unwrap();
        for table in [
            "piece",
            "rep_block",
            "rep",
            "session",
            "session_event",
            "spot_review",
            "setting",
        ] {
            let found: String = conn
                .query_row(
                    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?1",
                    [table],
                    |row| row.get(0),
                )
                .unwrap_or_else(|_| panic!("table `{table}` should exist"));
            assert_eq!(found, table);
        }
    }

    #[test]
    fn session_event_has_expected_columns() {
        let store = mem();
        let conn = store.conn.lock().unwrap_or_else(|p| p.into_inner());
        let mut stmt = conn.prepare("PRAGMA table_info(session_event)").unwrap();
        let columns: Vec<String> = stmt
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        assert_eq!(
            columns,
            vec!["id", "session_id", "ts", "kind", "payload"],
            "session_event should have exactly these columns, in order"
        );
    }

    #[test]
    fn migrate_is_idempotent_on_reopen() {
        // Re-running migration over an already-migrated connection must not error
        // (e.g. duplicate CREATE TABLE) and must leave the version untouched.
        let store = mem();
        migrations::migrate(&store.conn.lock().unwrap()).expect("re-migrate is a no-op");
        assert_eq!(store.schema_version().unwrap(), 3);
    }

    // ── v1 → v3 migration ─────────────────────────────────────────────────

    /// Build a raw v1 database (the old placeholder schema) with a settings row,
    /// then hand it to `Store::from_connection` so the normal migrate() path
    /// upgrades it. Proves the upgrade preserves settings and reaches v3.
    #[test]
    fn v1_to_v3_upgrade_preserves_settings() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        // Simulate a shipped v1 database: apply v1 schema + stamp version, and
        // write a real setting the way the old app would have.
        conn.execute_batch(migrations::SCHEMA_V1).unwrap();
        conn.execute_batch("PRAGMA user_version = 1").unwrap();
        conn.execute(
            "INSERT INTO setting (key, value) VALUES ('theme', 'dark')",
            [],
        )
        .unwrap();

        let store = Store::from_connection(conn).expect("v1 db upgrades cleanly");
        assert_eq!(store.schema_version().unwrap(), 3, "reaches v3");
        assert_eq!(
            store.get_setting("theme").unwrap(),
            Some("dark".into()),
            "existing setting survives the upgrade"
        );
        // The v2+ piece table must exist with its new UNIQUE folder_path key.
        let p = ScanPiece {
            folder_path: "/x/Foo".into(),
            title: "Foo".into(),
            composer: None,
            xml_path: None,
            pdf_path: None,
        };
        assert!(store.upsert_piece(&p).unwrap() > 0);
    }

    // ── Pieces CRUD ───────────────────────────────────────────────────────

    fn scan(folder: &str, title: &str, composer: Option<&str>) -> ScanPiece {
        ScanPiece {
            folder_path: folder.into(),
            title: title.into(),
            composer: composer.map(String::from),
            xml_path: None,
            pdf_path: None,
        }
    }

    #[test]
    fn upsert_twice_is_one_row_and_preserves_intake() {
        let store = mem();
        let mut p = scan("/v/Chopin - Scherzo", "Scherzo", Some("Chopin"));
        p.xml_path = Some("/v/Chopin - Scherzo/score/s.musicxml".into());
        let id = store.upsert_piece(&p).unwrap();

        // User completes intake.
        let intake = Intake {
            goals: vec!["memorize".into(), "up to 120".into()],
            deadline: Some("2026-09-01".into()),
            target_tempo: Some(120.0),
            hard_spots: vec![HardSpot {
                measures: "61-72".into(),
                note: "LH leaps".into(),
            }],
            current_state: Some("hands separate".into()),
        };
        store.save_intake(id, &intake).unwrap();

        // Rescan discovers the same folder, now also with a PDF and refreshed title.
        let mut p2 = scan("/v/Chopin - Scherzo", "Scherzo No.2 Op.31", Some("Chopin"));
        p2.xml_path = Some("/v/Chopin - Scherzo/score/s.musicxml".into());
        p2.pdf_path = Some("/v/Chopin - Scherzo/score/s.pdf".into());
        let id2 = store.upsert_piece(&p2).unwrap();
        assert_eq!(id, id2, "same folder_path upserts the same row");

        assert_eq!(store.list_pieces().unwrap().len(), 1, "still one piece");

        let d = store.get_piece(id).unwrap().unwrap();
        // Machine fields refreshed:
        assert_eq!(d.title, "Scherzo No.2 Op.31");
        assert!(d.has_xml && d.has_pdf);
        // Intake fields preserved across the rescan:
        assert_eq!(d.goals, vec!["memorize".to_string(), "up to 120".into()]);
        assert_eq!(d.deadline.as_deref(), Some("2026-09-01"));
        assert_eq!(d.target_tempo, Some(120.0));
        assert_eq!(d.hard_spots.len(), 1);
        assert_eq!(d.hard_spots[0].measures, "61-72");
        assert_eq!(d.current_state.as_deref(), Some("hands separate"));
        assert!(d.intake_done);
    }

    #[test]
    fn fresh_piece_has_empty_json_defaults() {
        let store = mem();
        let id = store.upsert_piece(&scan("/v/A", "A", None)).unwrap();
        let d = store.get_piece(id).unwrap().unwrap();
        assert!(d.goals.is_empty());
        assert!(d.hard_spots.is_empty());
        assert!(!d.intake_done);
        assert_eq!(d.composer, None);
        assert_eq!(store.get_piece(9999).unwrap(), None, "unknown id -> None");
    }

    #[test]
    fn list_pieces_summary_flags_and_order() {
        let store = mem();
        let mut z = scan("/v/Z", "Zebra", None);
        z.pdf_path = Some("/v/Z/z.pdf".into());
        store.upsert_piece(&z).unwrap();
        let mut a = scan("/v/A", "apple", Some("Bach"));
        a.xml_path = Some("/v/A/a.mxl".into());
        store.upsert_piece(&a).unwrap();

        let list = store.list_pieces().unwrap();
        assert_eq!(list.len(), 2);
        // Case-insensitive title order: "apple" before "Zebra".
        assert_eq!(list[0].title, "apple");
        assert!(list[0].has_xml && !list[0].has_pdf);
        assert_eq!(list[1].title, "Zebra");
        assert!(!list[1].has_xml && list[1].has_pdf);
    }

    // ── Rep round-trip ────────────────────────────────────────────────────

    #[test]
    fn rep_block_and_reps_round_trip_with_verdict_tallies() {
        let store = mem();
        let pid = store.upsert_piece(&scan("/v/P", "P", None)).unwrap();
        let rule = IncrementRule {
            clean_needed: 3,
            bpm_step: 4.0,
        };
        let variants = vec![VariantSpec {
            name: "hands together".into(),
            reps: 10,
        }];
        let block = store
            .insert_rep_block(pid, 1, 8, Some("intro"), 80.0, Some(120.0), &rule, 10, &variants)
            .unwrap();

        store.insert_rep(block, 80.0, None, "clean", None).unwrap();
        store.insert_rep(block, 80.0, None, "clean", None).unwrap();
        store
            .insert_rep(block, 80.0, None, "flawed", Some("rushed"))
            .unwrap();
        store.insert_rep(block, 80.0, None, "failed", None).unwrap();

        let hist = store.block_history(pid).unwrap();
        assert_eq!(hist.len(), 1);
        let h = &hist[0];
        assert_eq!(h.block_id, block);
        assert_eq!(h.m_start, 1);
        assert_eq!(h.m_end, 8);
        assert_eq!(h.label.as_deref(), Some("intro"));
        assert_eq!(h.start_bpm, 80.0);
        assert_eq!(h.bpm, 80.0, "latest rep bpm (all reps were at 80)");
        assert_eq!(h.target_bpm, Some(120.0));
        assert_eq!(h.planned_reps, 10);
        assert_eq!(h.status, "open");
        assert_eq!(h.reps_done, 4);
        assert_eq!(h.verdicts, VerdictCounts { clean: 2, flawed: 1, failed: 1 });

        store.update_block_status(block, "done").unwrap();
        assert_eq!(store.block_history(pid).unwrap()[0].status, "done");

        // A piece with no blocks yields an empty history (not an error).
        let empty = store.upsert_piece(&scan("/v/Empty", "Empty", None)).unwrap();
        assert!(store.block_history(empty).unwrap().is_empty());
    }

    #[test]
    fn block_history_zero_reps_has_empty_tallies() {
        let store = mem();
        let pid = store.upsert_piece(&scan("/v/P", "P", None)).unwrap();
        let rule = IncrementRule { clean_needed: 1, bpm_step: 2.0 };
        store
            .insert_rep_block(pid, 1, 4, None, 60.0, None, &rule, 5, &[])
            .unwrap();
        let h = &store.block_history(pid).unwrap()[0];
        assert_eq!(h.reps_done, 0);
        assert_eq!(h.verdicts, VerdictCounts::default());
    }

    // ── Session open → events → end ───────────────────────────────────────

    #[test]
    fn session_open_events_end_round_trip() {
        let store = mem();
        assert_eq!(store.latest_open_session().unwrap(), None);

        let sid = store.open_session().unwrap();
        assert_eq!(store.latest_open_session().unwrap(), Some(sid));

        store
            .insert_session_event(sid, "rep", &serde_json::json!({ "verdict": "clean", "bpm": 80 }))
            .unwrap();
        store
            .insert_session_event(sid, "note", &serde_json::json!({ "text": "watch LH" }))
            .unwrap();

        let events = store.session_events(sid).unwrap();
        assert_eq!(events.len(), 2);
        // Chronological (insertion) order.
        assert_eq!(events[0].kind, "rep");
        assert_eq!(events[0].payload["verdict"], "clean");
        assert_eq!(events[1].kind, "note");
        assert_eq!(events[1].payload["text"], "watch LH");

        store.end_session(sid, "# Summary\n\n2 events").unwrap();
        assert_eq!(
            store.latest_open_session().unwrap(),
            None,
            "an ended session is no longer the latest open one"
        );
        // Events survive ending the session.
        assert_eq!(store.session_events(sid).unwrap().len(), 2);
    }
}
