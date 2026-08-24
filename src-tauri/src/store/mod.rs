//! SQLite-backed persistence (rusqlite, bundled).
//!
//! `Store` owns a single [`rusqlite::Connection`]. Connection is not `Sync`, so
//! it is wrapped in a `Mutex`; the app manages one `Store` as Tauri state and
//! all commands serialize through that lock. At this app's scale (a single local
//! user, low write volume) a global lock is more than adequate.

mod backfill;
pub(crate) mod calendar;
mod crud;
mod day_sheet;
pub(crate) mod dynamics_profiles;
mod events;
mod history_backfill;
mod history_days;
mod measure_map;
mod migrations;
pub mod model;
mod practice_loop;
mod practice_v2;
mod score_atlas;
mod score_marks;
mod session_plan;
mod tutorials;
mod v8_backfill;

pub use day_sheet::{DaySheet, PiecePlan};
pub use events::EventKind;
pub use history_days::{HistoryDayDetail, HistoryDaySummary};
// `MapBar`/`MapSystem`/`MapBarSource`/`MeasureMapPage` are the typed contract
// (task C1 brief), not yet named directly outside `store` — later Plan C
// tasks (vision scan output, reconciliation) construct them. Kept `pub` now
// rather than added piecemeal so the contract is stable from the start.
#[allow(unused_imports)]
pub use measure_map::{MapBar, MapBarSource, MapSystem, MeasureMapPage, MeasureMapPageRow};
// `measure_map_payload_defects` backs the `Unapplyable` conflict pass in
// `score::measure_reconcile` (a same-crate, not cross-crate, consumer) —
// `pub(crate)` is enough and keeps it out of any external contract.
pub(crate) use measure_map::measure_map_payload_defects;
pub(crate) use practice_v2::{command_id as v2_command_id, validate_open as v2_validate_open};
pub use score_atlas::{AtomicTargetSavePayload, CalibrationPoint, CalibrationView};
pub use score_marks::{ScoreMark, ScorePageMarks};
pub use session_plan::{SessionPlanStartOutcome, SessionPlanStartPayload};

use std::path::Path;
use std::sync::Mutex;

use rusqlite::{Connection, OptionalExtension};

use model::IncrementRule;
use model::{
    json_from_sql, json_to_sql, BlockHistory, HardSpot, Intake, PieceDetail, PieceSummary, Rep,
    ScanPiece, SessionEventView, VariantSpec, VerdictCounts,
};

/// A migrated SQLite store. Thread-safe via an internal `Mutex`.
pub struct Store {
    conn: Mutex<Connection>,
}

fn insert_practice_event_rows(
    tx: &rusqlite::Transaction<'_>,
    session_id: i64,
    piece_id: i64,
    kind: &str,
    payload: &serde_json::Value,
) -> rusqlite::Result<(i64, i64, String)> {
    if kind != EventKind::REP_OPEN && kind != EventKind::REP {
        return Err(rusqlite::Error::InvalidParameterName(
            "practice event kind".into(),
        ));
    }
    let payload = json_to_sql(payload)?;
    let (legacy_id, timestamp): (i64, String) = tx.query_row(
        "INSERT INTO session_event (session_id,kind,payload)
         VALUES (?1,?2,?3) RETURNING id,ts",
        rusqlite::params![session_id, kind, &payload],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    let canonical_id: i64 = tx.query_row(
        "INSERT INTO event (ts,session_id,piece_id,kind,payload)
         VALUES (?1,?2,?3,?4,?5) RETURNING id",
        rusqlite::params![&timestamp, session_id, piece_id, kind, &payload],
        |row| row.get(0),
    )?;
    tx.execute(
        "INSERT INTO session_event_backfill
         (legacy_session_event_id,canonical_event_id,disposition,reason)
         VALUES (?1,?2,'inserted','live_atomic')",
        rusqlite::params![legacy_id, canonical_id],
    )?;
    Ok((legacy_id, canonical_id, timestamp))
}

/// Scanner-owned and user-owned score paths kept separate for secure edition
/// discovery. Crate-private: the frontend receives
/// [`PdfEdition`](crate::score::PdfEdition), never this raw filesystem record.
pub(crate) struct PiecePdfPaths {
    pub folder_path: String,
    pub scanned_pdf_path: Option<String>,
    pub preferred_pdf_path: Option<String>,
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
        conn.query_row("SELECT value FROM setting WHERE key = ?1", [key], |row| {
            row.get(0)
        })
        .optional()
    }

    /// User-local calendar date according to SQLite/macOS. Planner code uses
    /// this instead of slicing UTC timestamps, which is wrong near midnight in
    /// America/New_York and other non-UTC zones.
    pub fn local_today(&self) -> rusqlite::Result<String> {
        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        conn.query_row("SELECT date('now', 'localtime')", [], |row| row.get(0))
    }

    pub fn now_rfc3339(&self) -> rusqlite::Result<String> {
        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        let value: String = conn.query_row("SELECT datetime('now')", [], |row| row.get(0))?;
        Ok(model::sqlite_ts_to_rfc3339(&value))
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

    /// Read the floating-panel layout from the generic settings table.
    pub fn layout_get(&self) -> rusqlite::Result<Option<model::PanelLayout>> {
        self.get_setting("panel_layout")?
            .map(|raw| model::json_from_sql(&raw))
            .transpose()
    }

    /// Store the floating-panel layout as one JSON value.
    pub fn layout_set(&self, layout: &model::PanelLayout) -> rusqlite::Result<()> {
        let raw = model::json_to_sql(layout)?;
        self.set_setting("panel_layout", &raw)
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
    /// are refreshed and every intake field plus `preferred_pdf_path` is
    /// preserved.
    pub fn upsert_piece(&self, piece: &ScanPiece) -> rusqlite::Result<i64> {
        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        let xml = piece
            .xml_path
            .as_ref()
            .map(|p| p.to_string_lossy().into_owned());
        let pdf = piece
            .pdf_path
            .as_ref()
            .map(|p| p.to_string_lossy().into_owned());
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

    /// Re-point a piece's `folder_path` (used by `pieces::archive` to move the
    /// row's folder reference to a `.trash/` location so it drops out of
    /// [`Store::list_pieces`] without deleting the row or any practice history).
    /// Returns the number of rows updated (0 when the piece was never scanned).
    pub fn repoint_piece_folder(&self, old: &str, new: &str) -> rusqlite::Result<usize> {
        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        conn.execute(
            "UPDATE piece SET folder_path = ?2 WHERE folder_path = ?1",
            rusqlite::params![old, new],
        )
    }

    /// All pieces as list-view summaries, ordered by title (case-insensitive).
    ///
    /// Archived pieces (moved to a `.trash/` folder by `pieces::archive`, which
    /// re-points their `folder_path`) are excluded so they leave the workspace
    /// while their rows — and all referencing practice history — remain in the DB.
    pub fn list_pieces(&self) -> rusqlite::Result<Vec<PieceSummary>> {
        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        let mut stmt = conn.prepare(
            "SELECT id, title, composer,
                    xml_path IS NOT NULL,
                    COALESCE(preferred_pdf_path, pdf_path) IS NOT NULL,
                    intake_done
             FROM piece
             WHERE folder_path NOT LIKE '%/.trash/%'
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

    /// Read-only projection of every disclosed data anomaly, ordered by kind
    /// then id so callers get a stable grouping. Anomalies are surfaced, never
    /// repaired: this method reads and never writes.
    pub fn list_anomalies(&self) -> rusqlite::Result<Vec<model::AnomalyRow>> {
        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        let mut stmt = conn.prepare(
            "SELECT id, entity_type, entity_id, kind, observed_facts_json,
                    severity, review_state, created_ts, reviewed_ts
             FROM data_anomaly
             ORDER BY kind, id",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(model::AnomalyRow {
                id: row.get(0)?,
                entity_type: row.get(1)?,
                entity_id: row.get(2)?,
                kind: row.get(3)?,
                observed_facts_json: row.get(4)?,
                severity: row.get(5)?,
                review_state: row.get(6)?,
                created_ts: row.get(7)?,
                reviewed_ts: row.get(8)?,
            })
        })?;
        rows.collect()
    }

    /// Test-only raw execution seam for seeding fixture rows (e.g.
    /// `data_anomaly`) that production only ever fabricates through the
    /// migration/backfill path.
    #[cfg(test)]
    pub(crate) fn exec_for_test(&self, sql: &str) {
        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        conn.execute_batch(sql).expect("seed sql");
    }

    /// Full detail for one piece, or `None` if the id is unknown.
    pub fn get_piece(&self, id: i64) -> rusqlite::Result<Option<PieceDetail>> {
        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        conn.query_row(
            "SELECT id, title, composer, folder_path, xml_path,
                    COALESCE(preferred_pdf_path, pdf_path),
                    goals, deadline, target_tempo, hard_spots, current_state,
                    intake_done, notes, banner_text
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
                    banner_text: row.get(13)?,
                })
            },
        )
        .optional()
    }

    /// Filesystem roots needed by the score module. The scanned PDF and the
    /// explicit preference stay separate so edition discovery can mark the
    /// correct selected row and fall back cleanly when no preference exists.
    pub(crate) fn piece_pdf_paths(&self, id: i64) -> rusqlite::Result<Option<PiecePdfPaths>> {
        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        conn.query_row(
            "SELECT folder_path, pdf_path, preferred_pdf_path FROM piece WHERE id = ?1",
            [id],
            |row| {
                Ok(PiecePdfPaths {
                    folder_path: row.get(0)?,
                    scanned_pdf_path: row.get(1)?,
                    preferred_pdf_path: row.get(2)?,
                })
            },
        )
        .optional()
    }

    /// Persist a validated PDF path chosen by the user. Validation belongs to
    /// the score module; this method only owns the database mutation.
    pub(crate) fn set_preferred_pdf_path(&self, id: i64, path: &str) -> rusqlite::Result<bool> {
        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        Ok(conn.execute(
            "UPDATE piece SET preferred_pdf_path = ?2 WHERE id = ?1",
            rusqlite::params![id, path],
        )? == 1)
    }

    /// Persist a piece's intake payload and mark intake complete.
    pub fn save_intake(&self, id: i64, intake: &Intake) -> rusqlite::Result<()> {
        if intake
            .deadline
            .as_deref()
            .is_some_and(|date| !crate::date::is_valid(date))
        {
            return Err(rusqlite::Error::InvalidQuery);
        }
        let mut conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        let tx = conn.transaction()?;
        let old_deadline: Option<String> =
            tx.query_row("SELECT deadline FROM piece WHERE id = ?1", [id], |row| {
                row.get(0)
            })?;
        tx.execute(
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

        // Existing root Goals that still carry the previous piece-level
        // deadline inherited that default. Move those rows with the Piece;
        // preserve any goal whose date was customized independently.
        tx.execute(
            "UPDATE goal SET target_date = ?2
             WHERE piece_id = ?1 AND parent_goal_id IS NULL
               AND target_date IS ?3",
            rusqlite::params![id, intake.deadline, old_deadline],
        )?;

        // The legacy JSON summary remains for backward-compatible PieceDetail
        // reads, but canonical Goal rows are what P5+ planners consume. Intake
        // is additive: never delete a Goal merely because a later review omits
        // it, since that could erase user-managed structure.
        let mut seen = std::collections::HashSet::new();
        for text in &intake.goals {
            let text = text.trim();
            if text.is_empty() || !seen.insert(text.to_lowercase()) {
                continue;
            }
            tx.execute(
                "INSERT INTO goal (piece_id, text, kind, parent_goal_id, target_date, sort_order)
                 SELECT ?1, ?2, 'big', NULL, ?3,
                    COALESCE((SELECT MAX(sort_order) + 1 FROM goal
                              WHERE piece_id = ?1 AND parent_goal_id IS NULL), 0)
                 WHERE NOT EXISTS (
                    SELECT 1 FROM goal WHERE piece_id = ?1 AND lower(trim(text)) = lower(?2)
                 )",
                rusqlite::params![id, text, intake.deadline],
            )?;
        }

        // Intake is the one entry point that still speaks in the old
        // `{measures,note}` shape. Convert each usable item into the canonical
        // Region graph immediately. After intake, every screen edits Region;
        // the legacy JSON remains compatibility-only and is never displayed as
        // a second editable copy.
        for spot in &intake.hard_spots {
            let note = spot.note.trim();
            let (start, end) = backfill::parse_measure_range(&spot.measures);
            if note.is_empty() || start < 1 || end < start {
                continue;
            }
            let header = format!("mm. {start}–{end}");
            tx.execute(
                "INSERT INTO region (piece_id,name,notes,m_start,m_end,kind,sort_order,color)
                 SELECT ?1,?2,?3,?4,?5,'hard_spot',
                    COALESCE((SELECT MAX(sort_order) + 1 FROM region WHERE piece_id = ?1),0),
                    '#c05a5a'
                 WHERE NOT EXISTS (
                    SELECT 1 FROM region
                    WHERE piece_id = ?1 AND m_start = ?4 AND m_end = ?5
                      AND lower(trim(COALESCE(notes,''))) = lower(?3)
                 )",
                rusqlite::params![id, header, note, start, end],
            )?;
        }
        tx.commit()?;
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
        start_bpm: Option<f64>,
        target_bpm: Option<f64>,
        increment_rule: &IncrementRule,
        planned_reps: u32,
        variants: &[VariantSpec],
        focus: &str,
        use_metronome: bool,
    ) -> rusqlite::Result<i64> {
        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        conn.query_row(
            "INSERT INTO rep_block
                 (piece_id, m_start, m_end, label, start_bpm, target_bpm,
                  increment_rule, planned_reps, variants, focus, use_metronome, region_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11,
                (SELECT id FROM region
                 WHERE piece_id = ?1 AND m_start <= ?2 AND m_end >= ?3
                 ORDER BY (m_end - m_start), sort_order, id LIMIT 1))
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
                focus,
                use_metronome,
            ],
            |row| row.get(0),
        )
    }

    /// Insert a block plus its rep-open feed/canonical/ledger rows in one
    /// transaction. The builder receives the real block id and returns both
    /// the exact event payload and the caller-owned snapshot derived from it.
    #[allow(clippy::too_many_arguments)]
    pub fn insert_rep_block_with_practice_event<T, F>(
        &self,
        session_id: i64,
        piece_id: i64,
        m_start: u32,
        m_end: u32,
        label: Option<&str>,
        start_bpm: Option<f64>,
        target_bpm: Option<f64>,
        increment_rule: &IncrementRule,
        planned_reps: u32,
        variants: &[VariantSpec],
        focus: &str,
        use_metronome: bool,
        explicit_region_id: Option<i64>,
        build: F,
    ) -> rusqlite::Result<(i64, i64, T)>
    where
        F: FnOnce(i64) -> rusqlite::Result<(serde_json::Value, T)>,
    {
        let mut conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        let tx = conn.transaction()?;
        if let Some(region_id) = explicit_region_id {
            let belongs_to_piece: bool = tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM region WHERE id = ?1 AND piece_id = ?2)",
                rusqlite::params![region_id, piece_id],
                |row| row.get(0),
            )?;
            if !belongs_to_piece {
                return Err(rusqlite::Error::InvalidQuery);
            }
        }
        let block_id = tx.query_row(
            "INSERT INTO rep_block
                 (piece_id,m_start,m_end,label,start_bpm,target_bpm,
                  increment_rule,planned_reps,variants,focus,use_metronome,region_id)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,
                COALESCE(?12, (SELECT id FROM region
                  WHERE piece_id = ?1 AND m_start <= ?2 AND m_end >= ?3
                  ORDER BY (m_end - m_start), sort_order, id LIMIT 1)))
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
                focus,
                use_metronome,
                explicit_region_id,
            ],
            |row| row.get(0),
        )?;
        let (payload, output) = build(block_id)?;
        let (legacy_id, _, _) =
            insert_practice_event_rows(&tx, session_id, piece_id, EventKind::REP_OPEN, &payload)?;
        tx.commit()?;
        Ok((block_id, legacy_id, output))
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

    /// Insert the authoritative rep and all of its practice-history rows in one
    /// transaction. A simultaneous ladder step is included in the same commit.
    #[allow(clippy::too_many_arguments)]
    pub fn insert_rep_with_practice_event(
        &self,
        session_id: i64,
        piece_id: i64,
        block_id: i64,
        bpm: f64,
        variant: Option<&str>,
        verdict: &str,
        note: Option<&str>,
        payload: &serde_json::Value,
        tempo_change: Option<&serde_json::Value>,
    ) -> rusqlite::Result<(i64, i64)> {
        let mut conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        let tx = conn.transaction()?;
        let rep_id = tx.query_row(
            "INSERT INTO rep (block_id,bpm,variant,verdict,note)
             VALUES (?1,?2,?3,?4,?5) RETURNING id",
            rusqlite::params![block_id, bpm, variant, verdict, note],
            |row| row.get(0),
        )?;
        let (legacy_id, _, timestamp) =
            insert_practice_event_rows(&tx, session_id, piece_id, EventKind::REP, payload)?;
        if let Some(tempo_payload) = tempo_change {
            tx.execute(
                "INSERT INTO event (ts,session_id,piece_id,kind,payload)
                 VALUES (?1,?2,?3,?4,?5)",
                rusqlite::params![
                    &timestamp,
                    session_id,
                    piece_id,
                    EventKind::TEMPO_CHANGE,
                    json_to_sql(tempo_payload)?,
                ],
            )?;
        }
        tx.commit()?;
        Ok((rep_id, legacy_id))
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
                    ) AS bpm,
                    b.region_id, b.focus, b.use_metronome
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
                attempt_ceiling: None,
                contract_source: "migration_legacy".into(),
                status: row.get(7)?,
                reps_done: row.get(8)?,
                attempts_recorded: 0,
                tries: 0,
                voided_attempts: 0,
                current_clean_streak: 0,
                mastery_progress_streak: 0,
                best_clean_streak: 0,
                reset_count: 0,
                accuracy: None,
                required_clean_streak: 0,
                effective_required_clean_streak: 0,
                recovery_remaining: 0,
                review_boundary_reached: false,
                mastery_status: "unverified_legacy".into(),
                mastery_verified: false,
                set_state: "legacy_open".into(),
                last_attempt_id: None,
                last_adjustment_id: None,
                verdicts: VerdictCounts {
                    clean: row.get(9)?,
                    flawed: row.get(10)?,
                    failed: row.get(11)?,
                },
                bpm: row.get(12)?,
                region_id: row.get(13)?,
                focus: row.get(14)?,
                use_metronome: row.get(15)?,
            })
        })?;
        let mut history = rows.collect::<rusqlite::Result<Vec<_>>>()?;
        drop(stmt);
        drop(conn);
        for row in &mut history {
            self.v2_enrich_history(row)?;
        }
        Ok(history)
    }

    /// A single block's history row (same shape/derivation as [`Self::block_history`],
    /// narrowed to one id), or `None` if the block doesn't exist. Shared reader used
    /// by the T4/T5 CRUD mutations and the rep engine's active-snapshot resync.
    pub fn block_row(&self, block_id: i64) -> rusqlite::Result<Option<BlockHistory>> {
        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        let history = conn
            .query_row(
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
                    ) AS bpm,
                    b.region_id, b.focus, b.use_metronome
             FROM rep_block b
             LEFT JOIN rep r ON r.block_id = b.id
             WHERE b.id = ?1
             GROUP BY b.id",
                [block_id],
                |row| {
                    Ok(BlockHistory {
                        block_id: row.get(0)?,
                        m_start: row.get(1)?,
                        m_end: row.get(2)?,
                        label: row.get(3)?,
                        start_bpm: row.get(4)?,
                        target_bpm: row.get(5)?,
                        planned_reps: row.get(6)?,
                        attempt_ceiling: None,
                        contract_source: "migration_legacy".into(),
                        status: row.get(7)?,
                        reps_done: row.get(8)?,
                        attempts_recorded: 0,
                        tries: 0,
                        voided_attempts: 0,
                        current_clean_streak: 0,
                        mastery_progress_streak: 0,
                        best_clean_streak: 0,
                        reset_count: 0,
                        accuracy: None,
                        required_clean_streak: 0,
                        effective_required_clean_streak: 0,
                        recovery_remaining: 0,
                        review_boundary_reached: false,
                        mastery_status: "unverified_legacy".into(),
                        mastery_verified: false,
                        set_state: "legacy_open".into(),
                        last_attempt_id: None,
                        last_adjustment_id: None,
                        verdicts: VerdictCounts {
                            clean: row.get(9)?,
                            flawed: row.get(10)?,
                            failed: row.get(11)?,
                        },
                        bpm: row.get(12)?,
                        region_id: row.get(13)?,
                        focus: row.get(14)?,
                        use_metronome: row.get(15)?,
                    })
                },
            )
            .optional()?;
        drop(conn);
        if let Some(mut history) = history {
            self.v2_enrich_history(&mut history)?;
            Ok(Some(history))
        } else {
            Ok(None)
        }
    }

    /// The resolved ladder rule stored on a block (`increment_rule` JSON), or
    /// `None` when the block is missing or has no rule. Used by the rep engine's
    /// `resync_active_if` to mirror a live edit of the block's ladder config.
    pub fn block_rule(&self, block_id: i64) -> rusqlite::Result<Option<IncrementRule>> {
        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        let text: Option<String> = conn
            .query_row(
                "SELECT increment_rule FROM rep_block WHERE id = ?1",
                [block_id],
                |row| row.get(0),
            )
            .optional()?
            .flatten();
        match text {
            Some(t) => Ok(Some(json_from_sql(&t)?)),
            None => Ok(None),
        }
    }

    /// A block's practice `focus` and `use_metronome` flag, or `None` when the
    /// block is missing. Used by the rep engine's `resync_active_if` to mirror a
    /// live edit of the block's focus/metronome config into the active snapshot.
    pub fn block_focus_metronome(&self, block_id: i64) -> rusqlite::Result<Option<(String, bool)>> {
        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        conn.query_row(
            "SELECT focus, use_metronome FROM rep_block WHERE id = ?1",
            [block_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
    }

    /// Every rep row logged against a block, oldest first.
    pub fn reps_for_block(&self, block_id: i64) -> rusqlite::Result<Vec<Rep>> {
        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        let mut stmt = conn.prepare(
            "SELECT id, block_id, ts, bpm, variant, verdict, note
             FROM rep WHERE block_id = ?1 ORDER BY id",
        )?;
        let rows = stmt.query_map([block_id], |row| {
            let verdict: String = row.get(5)?;
            Ok(Rep {
                id: row.get(0)?,
                block_id: row.get(1)?,
                ts: row.get(2)?,
                bpm: row.get(3)?,
                variant: row.get(4)?,
                verdict: verdict.clone(),
                note: row.get(6)?,
                original_verdict: verdict,
                voided: false,
                source: "migration_legacy".into(),
                active_adjustment_ids: Vec::new(),
            })
        })?;
        let mut reps = rows.collect::<rusqlite::Result<Vec<_>>>()?;
        drop(stmt);
        drop(conn);
        for rep in &mut reps {
            let effective = self.v2_effective_attempt(block_id, rep.id)?;
            rep.verdict = effective.verdict;
            rep.note = effective.note;
            rep.voided = effective.voided;
            rep.source = effective.source;
            rep.active_adjustment_ids = effective.active_adjustment_ids;
            rep.original_verdict = effective.original_verdict;
            rep.bpm = effective.bpm;
        }
        Ok(reps)
    }

    /// Minimal per-block metadata (region membership + practice focus) for every
    /// block of a piece, ordered by id. Feeds the derived-metrics layer (Task 9),
    /// which groups reps by region/focus.
    pub fn blocks_meta(&self, piece_id: i64) -> rusqlite::Result<Vec<model::BlockMeta>> {
        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        let mut stmt = conn.prepare(
            "SELECT id, region_id, focus FROM rep_block WHERE piece_id = ?1 ORDER BY id",
        )?;
        let rows = stmt.query_map([piece_id], |row| {
            Ok(model::BlockMeta {
                block_id: row.get(0)?,
                region_id: row.get(1)?,
                focus: row.get(2)?,
            })
        })?;
        rows.collect()
    }

    /// Every rep logged against any block of a piece, oldest first. Feeds the
    /// derived-metrics layer (Task 9).
    pub fn reps_for_piece(&self, piece_id: i64) -> rusqlite::Result<Vec<Rep>> {
        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        let mut stmt = conn.prepare(
            "SELECT r.id, r.block_id, r.ts, r.bpm, r.variant, r.verdict, r.note
             FROM rep r JOIN rep_block b ON r.block_id = b.id
             WHERE b.piece_id = ?1 ORDER BY r.id",
        )?;
        let rows = stmt.query_map([piece_id], |row| {
            let verdict: String = row.get(5)?;
            Ok(Rep {
                id: row.get(0)?,
                block_id: row.get(1)?,
                ts: row.get(2)?,
                bpm: row.get(3)?,
                variant: row.get(4)?,
                verdict: verdict.clone(),
                note: row.get(6)?,
                original_verdict: verdict,
                voided: false,
                source: "migration_legacy".into(),
                active_adjustment_ids: Vec::new(),
            })
        })?;
        let mut reps = rows.collect::<rusqlite::Result<Vec<_>>>()?;
        drop(stmt);
        drop(conn);
        for rep in &mut reps {
            let effective = self.v2_effective_attempt(rep.block_id, rep.id)?;
            rep.verdict = effective.verdict;
            rep.note = effective.note;
            rep.voided = effective.voided;
            rep.source = effective.source;
            rep.active_adjustment_ids = effective.active_adjustment_ids;
            rep.original_verdict = effective.original_verdict;
            rep.bpm = effective.bpm;
        }
        Ok(reps)
    }

    /// Reassign (or clear) a block's region membership.
    pub fn block_set_region(&self, block_id: i64, region_id: Option<i64>) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        conn.execute(
            "UPDATE rep_block SET region_id = ?2 WHERE id = ?1",
            rusqlite::params![block_id, region_id],
        )?;
        Ok(())
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

    /// Open a new session at an explicit, already-committed `started_at`
    /// (rather than SQLite's own `datetime('now')`). Used by the session
    /// service so the day-rollover boundary check and the event it opens
    /// against agree on the same clock (production: still real time; tests:
    /// an injected fixed value — see `sessions::SessionClock`).
    pub(crate) fn open_session_at(&self, started_at: &str) -> rusqlite::Result<i64> {
        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        conn.query_row(
            "INSERT INTO session (started_at) VALUES (?1) RETURNING id",
            [started_at],
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

    /// Same as [`Self::insert_session_event`], but at an explicit `ts` rather
    /// than SQLite's own `datetime('now')` — so every session-event write
    /// agrees with the same clock the day-rollover boundary check reads (see
    /// `sessions::SessionClock`).
    pub(crate) fn insert_session_event_at(
        &self,
        session_id: i64,
        kind: &str,
        payload: &serde_json::Value,
        ts: &str,
    ) -> rusqlite::Result<i64> {
        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        conn.query_row(
            "INSERT INTO session_event (session_id, ts, kind, payload)
             VALUES (?1, ?2, ?3, ?4)
             RETURNING id",
            rusqlite::params![session_id, ts, kind, json_to_sql(payload)?],
            |row| row.get(0),
        )
    }

    /// Atomically append a practice event to the live session feed, canonical
    /// event log, and v6 reconciliation ledger. One SQLite timestamp is shared
    /// by both logs, so a crash or second-boundary rollover cannot create a
    /// missing or duplicate canonical rep on the next open.
    pub fn insert_practice_event(
        &self,
        session_id: i64,
        piece_id: i64,
        kind: &str,
        payload: &serde_json::Value,
    ) -> rusqlite::Result<i64> {
        if kind != EventKind::REP_OPEN && kind != EventKind::REP {
            return Err(rusqlite::Error::InvalidParameterName(
                "practice event kind".into(),
            ));
        }
        let mut conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        let tx = conn.transaction()?;
        let (legacy_id, _, _) =
            insert_practice_event_rows(&tx, session_id, piece_id, kind, payload)?;
        tx.commit()?;
        Ok(legacy_id)
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

    /// Close a session retroactively, at an explicit already-committed
    /// timestamp rather than `datetime('now')`. Used by the day-rollover
    /// adoption boundary: a session left open into the next local calendar day
    /// is closed at its own last event, never at rollover-detection time, so no
    /// phantom overnight focused time is ever attributed to it.
    pub(crate) fn end_session_at(
        &self,
        id: i64,
        ended_at: &str,
        summary_md: &str,
    ) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        conn.execute(
            "UPDATE session SET ended_at = ?2, summary_md = ?3 WHERE id = ?1",
            rusqlite::params![id, ended_at, summary_md],
        )?;
        Ok(())
    }

    /// A session's last event timestamp (falling back to `started_at` when it
    /// has no events yet), returned verbatim in whatever native format that row
    /// already carries, alongside whether that timestamp falls on the same
    /// LOCAL calendar day as `now` — both sides compared through SQLite's
    /// `'localtime'` modifier (the Mac's local timezone at evaluation time, per
    /// the v6 day-scoped-sessions adoption rule). `None` if the session id is
    /// unknown.
    pub(crate) fn session_last_event_and_same_local_day(
        &self,
        session_id: i64,
        now: &str,
    ) -> rusqlite::Result<Option<(String, bool)>> {
        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        conn.query_row(
            "SELECT ts, date(ts,'localtime') = date(?2,'localtime')
             FROM (SELECT COALESCE(
                     (SELECT MAX(ts) FROM session_event WHERE session_id = ?1),
                     (SELECT started_at FROM session WHERE id = ?1)
                   ) AS ts)
             WHERE ts IS NOT NULL",
            rusqlite::params![session_id, now],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, bool>(1)?)),
        )
        .optional()
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
    fn fresh_store_is_at_current_schema_version() {
        assert_eq!(mem().schema_version().unwrap(), migrations::SCHEMA_VERSION);
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
    fn layout_roundtrips_through_settings() {
        let store = mem();
        let layout = model::PanelLayout {
            panels: vec![model::PanelGeometry {
                id: "rep".into(),
                x: 12.0,
                y: 24.0,
                w: 320.0,
                h: 180.0,
                collapsed: false,
                z: 3,
            }],
        };
        assert_eq!(store.layout_get().unwrap(), None);
        store.layout_set(&layout).unwrap();
        assert_eq!(store.layout_get().unwrap(), Some(layout));
    }

    #[test]
    fn all_core_schema_tables_exist() {
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
            "region",
            "goal",
            "event",
            "daily_work",
            "session_event_backfill",
            "tutorial_video",
            "tutorial_chapter",
            "tutorial_clip",
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
    fn practice_event_writes_feed_canonical_and_ledger_atomically_with_one_timestamp() {
        let store = mem();
        let piece_id = store
            .upsert_piece(&ScanPiece {
                folder_path: "/vault/Atomic".into(),
                title: "Atomic".into(),
                composer: None,
                xml_path: None,
                pdf_path: None,
            })
            .unwrap();
        let session_id = store.open_session().unwrap();
        let legacy_id = store
            .insert_practice_event(
                session_id,
                piece_id,
                EventKind::REP,
                &serde_json::json!({"piece_id":piece_id,"block_id":99,"verdict":"clean"}),
            )
            .unwrap();
        let conn = store.conn.lock().unwrap_or_else(|p| p.into_inner());
        let row: (i64, String, String, String) = conn
            .query_row(
                "SELECT event.id,event.ts,session_event.ts,ledger.reason
                 FROM session_event
                 JOIN session_event_backfill ledger
                   ON ledger.legacy_session_event_id=session_event.id
                 JOIN event ON event.id=ledger.canonical_event_id
                 WHERE session_event.id=?1",
                [legacy_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert!(row.0 > 0);
        assert_eq!(row.1, row.2, "both logs share the exact SQLite timestamp");
        assert_eq!(row.3, "live_atomic");
    }

    #[test]
    fn rep_and_block_source_rows_roll_back_when_history_transaction_fails() {
        let store = mem();
        let piece_id = store
            .upsert_piece(&ScanPiece {
                folder_path: "/vault/Rollback".into(),
                title: "Rollback".into(),
                composer: None,
                xml_path: None,
                pdf_path: None,
            })
            .unwrap();
        let session_id = store.open_session().unwrap();
        {
            let conn = store.conn.lock().unwrap_or_else(|p| p.into_inner());
            conn.execute_batch(
                "CREATE TRIGGER fail_live_ledger BEFORE INSERT ON session_event_backfill
                 BEGIN SELECT RAISE(ABORT,'injected ledger failure'); END;",
            )
            .unwrap();
        }
        let rule = IncrementRule {
            clean_needed: 1,
            bpm_step: 4.0,
        };
        assert!(store
            .insert_rep_block_with_practice_event(
                session_id,
                piece_id,
                1,
                4,
                None,
                Some(80.0),
                Some(100.0),
                &rule,
                10,
                &[],
                "tempo",
                true,
                None,
                |block_id| Ok((
                    serde_json::json!({"piece_id":piece_id,"block_id":block_id}),
                    ()
                )),
            )
            .is_err());
        {
            let conn = store.conn.lock().unwrap_or_else(|p| p.into_inner());
            assert_eq!(
                conn.query_row("SELECT count(*) FROM rep_block", [], |r| r.get::<_, i64>(0))
                    .unwrap(),
                0
            );
            assert_eq!(
                conn.query_row("SELECT count(*) FROM session_event", [], |r| r
                    .get::<_, i64>(0))
                    .unwrap(),
                0
            );
            assert_eq!(
                conn.query_row(
                    "SELECT count(*) FROM event WHERE kind='rep_open'",
                    [],
                    |r| r.get::<_, i64>(0)
                )
                .unwrap(),
                0
            );
            conn.execute_batch("DROP TRIGGER fail_live_ledger;")
                .unwrap();
        }

        let block_id = store
            .insert_rep_block(
                piece_id,
                1,
                4,
                None,
                Some(80.0),
                Some(100.0),
                &rule,
                10,
                &[],
                "tempo",
                true,
            )
            .unwrap();
        {
            let conn = store.conn.lock().unwrap_or_else(|p| p.into_inner());
            conn.execute_batch(
                "CREATE TRIGGER fail_live_ledger BEFORE INSERT ON session_event_backfill
                 BEGIN SELECT RAISE(ABORT,'injected ledger failure'); END;",
            )
            .unwrap();
        }
        let payload =
            serde_json::json!({"piece_id":piece_id,"block_id":block_id,"verdict":"clean"});
        assert!(store
            .insert_rep_with_practice_event(
                session_id,
                piece_id,
                block_id,
                80.0,
                None,
                "clean",
                None,
                &payload,
                Some(&serde_json::json!({"piece_id":piece_id,"block_id":block_id,"from_bpm":80,"to_bpm":84})),
            )
            .is_err());
        let conn = store.conn.lock().unwrap_or_else(|p| p.into_inner());
        assert_eq!(
            conn.query_row("SELECT count(*) FROM rep", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            0
        );
        assert_eq!(
            conn.query_row("SELECT count(*) FROM session_event", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
        assert_eq!(
            conn.query_row(
                "SELECT count(*) FROM event WHERE kind IN ('rep','tempo_change')",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            0
        );
        assert_eq!(
            conn.query_row("SELECT count(*) FROM session_event_backfill", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }

    #[test]
    fn migrate_is_idempotent_on_reopen() {
        // Re-running migration over an already-migrated connection must not error
        // (e.g. duplicate CREATE TABLE) and must leave the version untouched.
        let store = mem();
        migrations::migrate(&store.conn.lock().unwrap()).expect("re-migrate is a no-op");
        assert_eq!(store.schema_version().unwrap(), migrations::SCHEMA_VERSION);
    }

    /// Events owned by `piece_id`, optionally narrowed to the kinds that count
    /// as practice time (`universe::PRACTICE_EVENT_KINDS`).
    fn count_events(conn: &Connection, piece_id: i64, practice_only: bool) -> i64 {
        let sql = if practice_only {
            "SELECT COUNT(*) FROM event WHERE piece_id = ?1
               AND kind IN ('rep_open','rep','verdict','tempo_change')"
        } else {
            "SELECT COUNT(*) FROM event WHERE piece_id = ?1"
        };
        conn.query_row(sql, [piece_id], |row| row.get(0)).unwrap()
    }

    /// The piece the Tanglewood split created (or merged into), or 0 if this
    /// database never had the merged row.
    fn tanglewood_copland_id(conn: &Connection) -> i64 {
        conn.query_row(
            "SELECT COALESCE(MIN(id), 0) FROM piece
             WHERE title = 'Cowboys with Lassos (Billy the Kid)'",
            [],
            |row| row.get(0),
        )
        .unwrap()
    }

    /// D2 rehearsal: the ordering hazard, replayed on the real data.
    ///
    /// If the vault script runs and the PREVIOUS build is launched even once
    /// before the upgrade, its startup folder scan upserts `Barber - Pas de Deux`
    /// and `Copland - …` as fresh, history-less pieces. The v12 step used to see
    /// those folders taken, decline, and stamp `user_version = 12` anyway —
    /// abandoning the repair permanently with the Copland's whole practice graph
    /// stranded on the merged row. It must now finish the job by merging into the
    /// rows the scanner made.
    ///
    /// `stranded_path` is a byte copy of the supplied disposable database, taken
    /// before the main rehearsal migrated it.
    #[allow(clippy::too_many_arguments)]
    fn rehearse_stranded_tanglewood_repair(
        stranded_path: &str,
        merged_id: i64,
        merged_folder: &str,
        before_pieces: i64,
        merged_regions: i64,
        merged_blocks: i64,
        merged_reps: i64,
        merged_events: i64,
    ) {
        let parent = merged_folder
            .strip_suffix("/Chamber Pieces Tanglewood")
            .expect("merged folder is the Tanglewood drawer");
        let barber_folder = format!("{parent}/Barber - Pas de Deux");
        let copland_folder = format!("{parent}/Copland - Cowboys with Lassos (Billy the Kid)");

        // Exactly what `Store::upsert_piece` writes for a newly seen folder:
        // scanner-derived title/composer/pdf_path, no `preferred_pdf_path`, and
        // no history of any kind.
        let seeded = Connection::open(stranded_path).expect("open the stranded rehearsal copy");
        seeded.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        for (folder, title, composer, pdf) in [
            (
                &barber_folder,
                "Pas de Deux",
                "Barber",
                "Christian_C_Barber_Pas_de_Deux_Primo.pdf",
            ),
            (
                &copland_folder,
                "Cowboys with Lassos (Billy the Kid)",
                "Copland",
                "Christian_C_Copland_Cowboys_with_Lassos.pdf",
            ),
        ] {
            seeded
                .execute(
                    "INSERT INTO piece (title, composer, folder_path, pdf_path)
                     VALUES (?1, ?2, ?3, ?4)",
                    rusqlite::params![title, composer, folder, format!("{folder}/{pdf}")],
                )
                .unwrap();
        }
        let scanned_barber: i64 = seeded
            .query_row(
                "SELECT id FROM piece WHERE folder_path = ?1",
                [&barber_folder],
                |row| row.get(0),
            )
            .unwrap();
        let scanned_copland: i64 = seeded
            .query_row(
                "SELECT id FROM piece WHERE folder_path = ?1",
                [&copland_folder],
                |row| row.get(0),
            )
            .unwrap();
        let stranded_version: i32 = seeded
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        println!(
            "rehearsal(stranded): before v12 — version={stranded_version} pieces={} \
             merged row {merged_id} still holds regions={} blocks={}",
            before_pieces + 2,
            merged_regions,
            merged_blocks
        );
        drop(seeded);

        let store = Store::open(stranded_path).expect("migrate the stranded rehearsal copy");
        assert_eq!(store.schema_version().unwrap(), migrations::SCHEMA_VERSION);
        let conn = store.conn.lock().unwrap_or_else(|p| p.into_inner());

        assert_eq!(
            conn.query_row(
                "SELECT COUNT(*) FROM piece WHERE title = 'Chamber Pieces Tanglewood'",
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
            0,
            "the merged pseudo-piece must be gone, not left stranded"
        );
        assert_eq!(
            conn.query_row(
                "SELECT COUNT(*) FROM piece WHERE id = ?1",
                [merged_id],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            0,
            "the emptied merged row is deleted once its history lives elsewhere"
        );
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM piece", [], |row| row.get::<_, i64>(0))
                .unwrap(),
            before_pieces + 1,
            "the two auto-discovered rows are reused, not duplicated"
        );

        // The stranded practice graph landed on the scanner's Copland row.
        for (table, expected) in [("region", merged_regions), ("rep_block", merged_blocks)] {
            assert_eq!(
                conn.query_row(
                    &format!("SELECT COUNT(*) FROM {table} WHERE piece_id = ?1"),
                    [scanned_copland],
                    |row| row.get::<_, i64>(0)
                )
                .unwrap(),
                expected,
                "{table} must reach the auto-discovered Copland row"
            );
        }
        assert_eq!(
            conn.query_row(
                "SELECT COUNT(*) FROM rep JOIN rep_block ON rep_block.id = rep.block_id
                 WHERE rep_block.piece_id = ?1",
                [scanned_copland],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
            merged_reps
        );
        assert_eq!(count_events(&conn, scanned_copland, false), merged_events);
        assert_eq!(count_events(&conn, scanned_barber, false), 0);
        // ...and the Barber-bound calibration landed on the scanner's Barber row.
        assert_eq!(
            conn.query_row(
                "SELECT COUNT(*) FROM score_edition_calibration WHERE piece_id = ?1",
                [scanned_barber],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
            1,
            "the Barber calibration follows the Barber, not the Copland"
        );

        assert_eq!(
            conn.query_row("PRAGMA integrity_check", [], |row| row.get::<_, String>(0))
                .unwrap(),
            "ok"
        );
        {
            let mut statement = conn.prepare("PRAGMA foreign_key_check").unwrap();
            assert!(
                statement.query([]).unwrap().next().unwrap().is_none(),
                "the stranded repair must leave no FK violations"
            );
        }
        // `progress_summary` takes the store's own connection lock, so the
        // guard has to be released before calling it.
        drop(conn);
        let barber_progress = crate::metrics::progress_summary(&store, scanned_barber).unwrap();
        let copland_progress = crate::metrics::progress_summary(&store, scanned_copland).unwrap();
        assert_eq!(
            (barber_progress.focused_seconds, barber_progress.streak),
            (0, 0),
            "the Barber must show no practice time and no streak"
        );
        assert!(
            copland_progress.focused_seconds > 0 && copland_progress.streak > 0,
            "the Copland must show the practice time and streak it earned, got {:?}",
            (copland_progress.focused_seconds, copland_progress.streak)
        );
        println!(
            "rehearsal(stranded): after v12 — pieces={} tanglewood rows=0, \
             Copland {scanned_copland} regions={merged_regions} blocks={merged_blocks} \
             reps={merged_reps} events={merged_events} focused={}s streak={} | \
             Barber {scanned_barber} focused={}s streak={}",
            before_pieces + 1,
            copland_progress.focused_seconds,
            copland_progress.streak,
            barber_progress.focused_seconds,
            barber_progress.streak
        );
        drop(store);

        // Five more launches change nothing.
        for _ in 0..5 {
            let reopened = Store::open(stranded_path).expect("stranded repair is idempotent");
            let conn = reopened.conn.lock().unwrap_or_else(|p| p.into_inner());
            assert_eq!(
                conn.query_row("SELECT COUNT(*) FROM piece", [], |row| row.get::<_, i64>(0))
                    .unwrap(),
                before_pieces + 1
            );
            assert_eq!(count_events(&conn, scanned_copland, false), merged_events);
        }
        println!("rehearsal(stranded): 5 further launches — pieces and events unchanged");
    }

    /// Release-gate rehearsal against an operator-created backup of the real DB.
    /// The ignored test never chooses or copies a database itself; it only opens
    /// the explicit `CODAKILLER_MIGRATION_COPY` path supplied by the release run.
    #[test]
    #[ignore = "requires CODAKILLER_MIGRATION_COPY pointing to a disposable backup"]
    fn rehearse_migration_on_real_database_copy() {
        let path = std::env::var("CODAKILLER_MIGRATION_COPY")
            .expect("set CODAKILLER_MIGRATION_COPY to a disposable database backup");

        // Guard: never run against the live app-data database. This test
        // MIGRATES what it is handed — pointing it at the real file would run an
        // unreviewed schema step on the user's only copy. Reject any path that
        // resolves inside the app's bundle-identifier data directory; the
        // operator supplies a backup (`sqlite3 … .backup`).
        let resolved = std::fs::canonicalize(&path)
            .unwrap_or_else(|e| panic!("resolve CODAKILLER_MIGRATION_COPY '{path}': {e}"));
        assert!(
            !resolved
                .components()
                .any(|component| component.as_os_str() == "com.christian.codakiller"),
            "refuse to run on the live app-data location ({}); copy the database first",
            resolved.display()
        );

        // `piece` is NOT in this list: the v12 Tanglewood split adds exactly one
        // row, and only on the database that still carries the merged piece. It
        // is asserted separately below. Everything else must be untouched —
        // notably `rep`, which the split is forbidden to write.
        let preserved_tables = [
            "region",
            "rep_block",
            "rep",
            "goal",
            "session",
            "session_event",
        ];
        let before_conn = Connection::open(&path).expect("open migration rehearsal copy");
        let before_version: i32 = before_conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert!(before_version <= migrations::SCHEMA_VERSION);
        let before: Vec<i64> = preserved_tables
            .iter()
            .map(|table| {
                before_conn
                    .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                        row.get(0)
                    })
                    .unwrap()
            })
            .collect();
        let before_events: i64 = before_conn
            .query_row("SELECT COUNT(*) FROM event", [], |row| row.get(0))
            .unwrap();
        let source_events: i64 = before_conn
            .query_row("SELECT COUNT(*) FROM session_event", [], |row| row.get(0))
            .unwrap();

        // Snapshot of the v11→v12 Tanglewood split's inputs, read from the copy
        // BEFORE it is migrated. `0` means this database never had the merged
        // piece, in which case the split must be a complete no-op.
        let before_pieces: i64 = before_conn
            .query_row("SELECT COUNT(*) FROM piece", [], |row| row.get(0))
            .unwrap();
        let merged_id: i64 = before_conn
            .query_row(
                "SELECT COALESCE(MIN(id), 0) FROM piece WHERE title = 'Chamber Pieces Tanglewood'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let merged_regions: i64 = before_conn
            .query_row(
                "SELECT COUNT(*) FROM region WHERE piece_id = ?1",
                [merged_id],
                |row| row.get(0),
            )
            .unwrap();
        let merged_blocks: i64 = before_conn
            .query_row(
                "SELECT COUNT(*) FROM rep_block WHERE piece_id = ?1",
                [merged_id],
                |row| row.get(0),
            )
            .unwrap();
        let merged_reps: i64 = before_conn
            .query_row(
                "SELECT COUNT(*) FROM rep
                 JOIN rep_block ON rep_block.id = rep.block_id
                 WHERE rep_block.piece_id = ?1",
                [merged_id],
                |row| row.get(0),
            )
            .unwrap();
        let merged_calibrations: String = before_conn
            .query_row(
                "SELECT COALESCE(GROUP_CONCAT(id), '') FROM score_edition_calibration
                 WHERE piece_id = ?1 ORDER BY id",
                [merged_id],
                |row| row.get(0),
            )
            .unwrap();
        // The canonical log the merged row carries. `event.piece_id` is what
        // `Store::events_for_piece` filters on, and that feeds History's
        // progress summary and the Universe view — so these rows decide which
        // piece shows practice time and a streak.
        let merged_events: i64 = before_conn
            .query_row(
                "SELECT COUNT(*) FROM event WHERE piece_id = ?1",
                [merged_id],
                |row| row.get(0),
            )
            .unwrap();
        let merged_practice_events: i64 = before_conn
            .query_row(
                "SELECT COUNT(*) FROM event WHERE piece_id = ?1
                   AND kind IN ('rep_open','rep','verdict','tempo_change')",
                [merged_id],
                |row| row.get(0),
            )
            .unwrap();
        // How many of those are legacy rows mirrored into the canonical log by
        // the v6 backfill. Their frozen payloads still name the merged piece;
        // the split re-points the `piece_id` column and deliberately leaves the
        // payload bytes alone, and the ledger check below pins exactly that.
        let merged_ledgered_events: i64 = before_conn
            .query_row(
                "SELECT COUNT(*) FROM session_event_backfill ledger
                 JOIN event canonical ON canonical.id = ledger.canonical_event_id
                 WHERE canonical.piece_id = ?1",
                [merged_id],
                |row| row.get(0),
            )
            .unwrap();

        // ── post-split copies ────────────────────────────────────────────────
        // Once the installed app has itself run v12, the merged row no longer
        // exists and `merged_id` is 0 — but the merged -> Copland re-attribution
        // it performed is still recorded in the ledger forever, and every later
        // migration still has to be held to it. The split KEPT the merged row's
        // id for the surviving Barber, so on such a copy the historical merged id
        // is the `'Pas de Deux'` row's id. Resolve it only when the Copland the
        // split creates is actually present, so a database that never carried the
        // merged row (and a synthetic fixture that merely happens to own a Barber)
        // keeps the strict `0` and the strict pre-split checks below.
        let historical_merged_id: i64 = if merged_id != 0 {
            merged_id
        } else {
            before_conn
                .query_row(
                    "SELECT COALESCE(MIN(barber.id), 0) FROM piece barber
                     WHERE barber.title = 'Pas de Deux'
                       AND EXISTS (SELECT 1 FROM piece copland
                                   WHERE copland.title
                                         = 'Cowboys with Lassos (Billy the Kid)')",
                    [],
                    |row| row.get(0),
                )
                .unwrap()
        };
        // The size of that historical exception as it stands BEFORE this test
        // migrates anything. The rest of the run asserts the very same number
        // comes back out: v12 already moved these rows, so every later step must
        // move exactly zero of them. Stays 0 (and unqueried) on a pre-split copy,
        // where nothing has moved yet and the strict expectation is still "the
        // split re-attributed exactly the merged row's ledgered events".
        let before_reattributed: i64 = if merged_id == 0 && historical_merged_id != 0 {
            before_conn
                .query_row(
                    "SELECT COUNT(*) FROM session_event_backfill ledger
                     JOIN session_event source ON source.id = ledger.legacy_session_event_id
                     JOIN event canonical ON canonical.id = ledger.canonical_event_id
                     WHERE canonical.piece_id = (SELECT MIN(id) FROM piece
                                                 WHERE title
                                                   = 'Cowboys with Lassos (Billy the Kid)')
                       AND CAST(json_extract(source.payload, '$.piece_id') AS INTEGER) = ?1",
                    [historical_merged_id],
                    |row| row.get(0),
                )
                .unwrap()
        } else {
            0
        };

        // Practice Notebook rows the copy already holds (0 on a pre-v11 copy,
        // where the tables do not exist yet). Migration must not change these.
        let before_notebook: Vec<i64> = ["day_sheet", "piece_plan"]
            .iter()
            .map(|table| {
                let exists: i64 = before_conn
                    .query_row(
                        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
                        [*table],
                        |row| row.get(0),
                    )
                    .unwrap();
                if exists == 0 {
                    return 0;
                }
                before_conn
                    .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                        row.get(0)
                    })
                    .unwrap()
            })
            .collect();
        let merged_folder: String = if merged_id == 0 {
            String::new()
        } else {
            before_conn
                .query_row(
                    "SELECT folder_path FROM piece WHERE id = ?1",
                    [merged_id],
                    |row| row.get(0),
                )
                .unwrap()
        };
        drop(before_conn);

        // Input for the D2 sub-rehearsal below: a byte copy of the supplied
        // disposable database taken BEFORE this test migrates it. The app runs
        // `journal_mode = delete`, so with every connection closed the file is
        // the whole database.
        let stranded_path = format!("{path}.stranded-rehearsal");
        let _ = std::fs::remove_file(&stranded_path);
        if merged_id != 0 {
            std::fs::copy(&path, &stranded_path).expect("copy the rehearsal database");
        }

        let store = Store::open(&path).expect("migrate rehearsal copy");
        assert_eq!(store.schema_version().unwrap(), migrations::SCHEMA_VERSION);
        let conn = store.conn.lock().unwrap_or_else(|p| p.into_inner());
        let after: Vec<i64> = preserved_tables
            .iter()
            .map(|table| {
                conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .unwrap()
            })
            .collect();
        assert_eq!(
            after, before,
            "migration must preserve all source graph row counts"
        );
        for (table, count) in preserved_tables.iter().zip(&after) {
            println!("rehearsal: {table} unchanged at {count}");
        }

        // ── v11→v12: the Tanglewood split ────────────────────────────────────
        let after_pieces: i64 = conn
            .query_row("SELECT COUNT(*) FROM piece", [], |row| row.get(0))
            .unwrap();
        let split_ran = i64::from(merged_id != 0);
        assert_eq!(
            after_pieces,
            before_pieces + split_ran,
            "the split adds exactly one piece, and only where the merged row existed"
        );
        println!("rehearsal: piece {before_pieces} -> {after_pieces}");
        assert_eq!(
            conn.query_row(
                "SELECT COUNT(*) FROM piece WHERE title = 'Chamber Pieces Tanglewood'",
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
            0,
            "the merged pseudo-piece is gone"
        );

        if merged_id != 0 {
            // The surviving row is the Barber: same id, no practice graph, and
            // it still owns the calibration made against its page geometry.
            let (barber_title, barber_composer, barber_folder): (String, String, String) = conn
                .query_row(
                    "SELECT title, composer, folder_path FROM piece WHERE id = ?1",
                    [merged_id],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )
                .unwrap();
            assert_eq!(barber_title, "Pas de Deux");
            assert_eq!(barber_composer, "Barber");
            assert!(
                barber_folder.ends_with("/Barber - Pas de Deux"),
                "unexpected Barber folder {barber_folder}"
            );
            for table in ["region", "rep_block"] {
                assert_eq!(
                    conn.query_row(
                        &format!("SELECT COUNT(*) FROM {table} WHERE piece_id = ?1"),
                        [merged_id],
                        |row| row.get::<_, i64>(0)
                    )
                    .unwrap(),
                    0,
                    "the Barber must keep no {table} rows"
                );
            }
            let barber_calibrations: String = conn
                .query_row(
                    "SELECT COALESCE(GROUP_CONCAT(id), '') FROM score_edition_calibration
                     WHERE piece_id = ?1 ORDER BY id",
                    [merged_id],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(
                barber_calibrations, merged_calibrations,
                "calibration stays with the Barber it was calibrated against"
            );
            println!(
                "rehearsal: Barber piece {merged_id} '{barber_composer} - {barber_title}' \
                 regions=0 blocks=0 calibration_ids=[{barber_calibrations}]"
            );

            // The new row is the Copland and owns the entire moved graph.
            let (copland_id, copland_composer, copland_folder): (i64, String, String) = conn
                .query_row(
                    "SELECT id, composer, folder_path FROM piece
                     WHERE title = 'Cowboys with Lassos (Billy the Kid)'",
                    [],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )
                .expect("the Copland piece exists after the split");
            assert_eq!(copland_composer, "Copland");
            assert!(
                copland_folder.ends_with("/Copland - Cowboys with Lassos (Billy the Kid)"),
                "unexpected Copland folder {copland_folder}"
            );
            let copland_regions: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM region WHERE piece_id = ?1",
                    [copland_id],
                    |row| row.get(0),
                )
                .unwrap();
            let copland_blocks: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM rep_block WHERE piece_id = ?1",
                    [copland_id],
                    |row| row.get(0),
                )
                .unwrap();
            let copland_reps: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM rep
                     JOIN rep_block ON rep_block.id = rep.block_id
                     WHERE rep_block.piece_id = ?1",
                    [copland_id],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(
                (copland_regions, copland_blocks, copland_reps),
                (merged_regions, merged_blocks, merged_reps),
                "every region, block and rep of the merged row moved to the Copland intact"
            );
            assert!(
                copland_regions > 0 && copland_blocks > 0 && copland_reps > 0,
                "the split must actually move the practice graph"
            );
            assert_eq!(
                conn.query_row(
                    "SELECT COUNT(*) FROM score_edition_calibration WHERE piece_id = ?1",
                    [copland_id],
                    |row| row.get::<_, i64>(0)
                )
                .unwrap(),
                0,
                "the Barber calibration must not follow the Copland"
            );
            println!(
                "rehearsal: Copland piece {copland_id} '{copland_composer} - Cowboys with Lassos \
                 (Billy the Kid)' regions={copland_regions} blocks={copland_blocks} \
                 reps={copland_reps}"
            );

            // ── the canonical log follows the work, not the score file ───────
            // `event.piece_id` is what `Store::events_for_piece` filters on, and
            // that is the sole input to the practice time / streak the UI shows.
            // Leaving it on the surviving row is what made the never-practised
            // Barber report focused time and a streak while the Copland — the
            // piece actually practised — reported none.
            let barber_events = count_events(&conn, merged_id, false);
            let copland_events = count_events(&conn, copland_id, false);
            assert_eq!(
                barber_events, 0,
                "the Barber has never been practised and must own no events"
            );
            assert_eq!(
                copland_events, merged_events,
                "every event of the merged row was attributable and moved"
            );
            let barber_practice = count_events(&conn, merged_id, true);
            let copland_practice = count_events(&conn, copland_id, true);
            assert_eq!(barber_practice, 0);
            assert_eq!(
                copland_practice, merged_practice_events,
                "the practice-time kinds land on the piece that was practised"
            );
            println!(
                "rehearsal: events merged->Copland {copland_events} \
                 (practice kinds {copland_practice}), Barber keeps {barber_events}"
            );

            // Every other `piece_id`-bearing table went where the migration says
            // it goes. Only the calibration stays with the Barber; it names the
            // Barber PDF and holds Barber page geometry.
            for table in [
                "brain_thread",
                "goal",
                "piece_plan",
                "spot_review",
                "action_draft",
                "score_section",
                "tutorial_video",
            ] {
                let left: i64 = conn
                    .query_row(
                        &format!("SELECT COUNT(*) FROM {table} WHERE piece_id = ?1"),
                        [merged_id],
                        |row| row.get(0),
                    )
                    .unwrap();
                assert_eq!(left, 0, "{table} records practice work and must not stay");
            }
        } else if historical_merged_id != 0 {
            // The split is already history on this copy, so there is no before/
            // after pair to compare — but its *result* is still load-bearing and
            // migration must not quietly undo it. Note what cannot be asserted
            // here: the Barber legitimately accumulates its own practice after
            // the split, so "the Barber owns nothing" is only true at the moment
            // v12 runs, never afterwards.
            let copland_id = tanglewood_copland_id(&conn);
            let (copland_regions, copland_blocks, copland_reps): (i64, i64, i64) = conn
                .query_row(
                    "SELECT
                       (SELECT COUNT(*) FROM region WHERE piece_id = ?1),
                       (SELECT COUNT(*) FROM rep_block WHERE piece_id = ?1),
                       (SELECT COUNT(*) FROM rep
                        JOIN rep_block ON rep_block.id = rep.block_id
                        WHERE rep_block.piece_id = ?1)",
                    [copland_id],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )
                .unwrap();
            assert!(
                copland_regions > 0 && copland_blocks > 0 && copland_reps > 0,
                "the Copland must still own the practice graph v12 moved to it, got \
                 regions={copland_regions} blocks={copland_blocks} reps={copland_reps}"
            );
            println!(
                "rehearsal: split already historic — Barber {historical_merged_id} kept the \
                 merged row's id, Copland {copland_id} regions={copland_regions} \
                 blocks={copland_blocks} reps={copland_reps}"
            );
        }

        let after_events: i64 = conn
            .query_row("SELECT COUNT(*) FROM event", [], |row| row.get(0))
            .unwrap();
        assert!(
            after_events >= before_events,
            "the canonical log is additive only"
        );
        let ledger_rows: i64 = conn
            .query_row("SELECT COUNT(*) FROM session_event_backfill", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(
            ledger_rows, source_events,
            "every legacy row is ledgered exactly once"
        );
        let mismatched_mappings: i64 = conn
            .query_row(
                "SELECT count(*)
                 FROM session_event_backfill ledger
                 JOIN session_event source ON source.id=ledger.legacy_session_event_id
                 JOIN event canonical ON canonical.id=ledger.canonical_event_id
                 WHERE canonical.ts != source.ts
                    OR canonical.session_id != source.session_id
                    OR canonical.kind != source.kind
                    OR canonical.payload != source.payload",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            mismatched_mappings, 0,
            "mapped rows preserve their exact source bytes"
        );
        // `piece_id` is the one column the v12 split is allowed to move, and it
        // may move ONLY from the merged row to the Copland. Everything else must
        // still equal the piece the legacy payload named — and the exception set
        // must be exactly the merged row's ledgered events, no more, no fewer.
        // On a copy where v12 already ran, `historical_merged_id` names the row
        // that move started from (the id the surviving Barber inherited), so the
        // one legitimate exception is recognised as such instead of counting as
        // hundreds of violations.
        let (reattributed, wrongly_attributed): (i64, i64) = conn
            .query_row(
                "SELECT
                   count(*) FILTER (
                     WHERE canonical.piece_id = ?2
                       AND CAST(json_extract(source.payload,'$.piece_id') AS INTEGER) = ?1),
                   count(*) FILTER (
                     WHERE canonical.piece_id
                           != CAST(json_extract(source.payload,'$.piece_id') AS INTEGER)
                       AND NOT (canonical.piece_id = ?2
                                AND CAST(json_extract(source.payload,'$.piece_id') AS INTEGER) = ?1))
                 FROM session_event_backfill ledger
                 JOIN session_event source ON source.id=ledger.legacy_session_event_id
                 JOIN event canonical ON canonical.id=ledger.canonical_event_id",
                rusqlite::params![historical_merged_id, tanglewood_copland_id(&conn)],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(
            wrongly_attributed, 0,
            "no mapped row moved anywhere except merged -> Copland"
        );
        if merged_id != 0 {
            // Pre-split copy: the split ran during THIS rehearsal, so exactly the
            // merged row's ledgered events must have been re-attributed.
            assert_eq!(
                reattributed, merged_ledgered_events,
                "every ledgered event of the merged row was re-attributed to the Copland"
            );
            println!("rehearsal: {reattributed} ledgered events re-attributed merged -> Copland");
        } else {
            // Post-split copy: the move is history. The exception set must come
            // back out of migration exactly the size it went in — a later step
            // that re-pointed even one more ledgered event would show up here.
            assert_eq!(
                reattributed, before_reattributed,
                "migration must re-attribute nothing further; the merged -> Copland \
                 exception set must be unchanged"
            );
            println!(
                "rehearsal: split already historic — {reattributed} ledgered events stay \
                 attributed merged({historical_merged_id}) -> Copland, unchanged by migration"
            );
        }
        assert_eq!(
            conn.query_row("PRAGMA integrity_check", [], |row| row.get::<_, String>(0))
                .unwrap(),
            "ok"
        );
        {
            let mut statement = conn.prepare("PRAGMA foreign_key_check").unwrap();
            let mut rows = statement.query([]).unwrap();
            assert!(
                rows.next().unwrap().is_none(),
                "migration must leave no FK violations"
            );
        }
        // The additive v11 Practice Notebook tables exist after rehearsal, and
        // migration neither invents nor drops rows in them. The count is
        // compared against the copy's own pre-migration count rather than 0:
        // once the installed app is itself on v11 the real database legitimately
        // carries the day sheets the user has written.
        for (table, before_rows) in ["day_sheet", "piece_plan"].iter().zip(&before_notebook) {
            assert_eq!(
                conn.query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
                    [*table],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
                1,
                "migration rehearsal must create the v11 table {table}"
            );
            assert_eq!(
                conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| row
                    .get::<_, i64>(0))
                    .unwrap(),
                *before_rows,
                "migration must neither invent nor drop {table} rows"
            );
        }
        let copland_piece_id = tanglewood_copland_id(&conn);
        // `progress_summary` takes the store's own connection lock, so the guard
        // has to be released before calling it.
        drop(conn);

        // End to end, through the exact command History invokes: the piece that
        // was practised is the one that reports practice time and a streak.
        if merged_id != 0 {
            let barber = crate::metrics::progress_summary(&store, merged_id).unwrap();
            let copland = crate::metrics::progress_summary(&store, copland_piece_id).unwrap();
            assert_eq!(
                (barber.focused_seconds, barber.streak),
                (0, 0),
                "the never-practised Barber must show no practice time and no streak"
            );
            assert!(
                copland.focused_seconds > 0 && copland.streak > 0,
                "the Copland must show the practice time and streak it earned, got {:?}",
                (copland.focused_seconds, copland.streak)
            );
            println!(
                "rehearsal: progress_summary Barber {merged_id} focused={}s streak={} | \
                 Copland {copland_piece_id} focused={}s streak={}",
                barber.focused_seconds, barber.streak, copland.focused_seconds, copland.streak
            );
        } else if historical_merged_id != 0 {
            // Post-split: the same end-to-end command, but only the half that
            // stays true forever. The Copland keeps the practice time it earned;
            // the Barber's own numbers are its own business by now, so the streak
            // (which decays with idle days) is reported, not asserted.
            let copland = crate::metrics::progress_summary(&store, copland_piece_id).unwrap();
            assert!(
                copland.focused_seconds > 0,
                "the Copland must still report the practice time v12 moved to it"
            );
            println!(
                "rehearsal: progress_summary Copland {copland_piece_id} focused={}s streak={}",
                copland.focused_seconds, copland.streak
            );
        }
        drop(store);

        let reopened = Store::open(&path).expect("migration is idempotent on second open");
        assert_eq!(
            reopened.schema_version().unwrap(),
            migrations::SCHEMA_VERSION
        );
        let conn = reopened
            .conn
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM event", [], |row| row.get::<_, i64>(0))
                .unwrap(),
            after_events,
            "second open maps zero additional events"
        );
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM piece", [], |row| row.get::<_, i64>(0))
                .unwrap(),
            after_pieces,
            "second open splits nothing again"
        );
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM session_event_backfill", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            ledger_rows,
            "second open adds zero ledger rows"
        );
        drop(conn);
        drop(reopened);

        // ── D2: the same real data, but with the ordering hazard triggered ───
        if merged_id != 0 {
            rehearse_stranded_tanglewood_repair(
                &stranded_path,
                merged_id,
                &merged_folder,
                before_pieces,
                merged_regions,
                merged_blocks,
                merged_reps,
                merged_events,
            );
            let _ = std::fs::remove_file(&stranded_path);
        } else {
            // The hazard needs the merged row present to strand anything, so on a
            // copy where v12 has already run it is not reachable — and never will
            // be again on this database. Say so out loud rather than silently
            // skipping, so a green run is never mistaken for D2 coverage.
            println!(
                "rehearsal(stranded): skipped — the merged row is already split, \
                 the v12 ordering hazard cannot recur on this database"
            );
        }
    }

    /// Release-gate rehearsal / injection tool: push the 288 pre-mapped line
    /// anchors from `docs/qa/premap/*.json` into a DISPOSABLE copy of the real
    /// database through the exact validated calibration save path, computing
    /// each edition's identity with the SAME `score::pdf_editions` code the app
    /// runs at lookup time (so the stored row carries the identity a runtime
    /// lookup will match — not a hand-built one).
    ///
    /// Like the migration rehearsal, the test never chooses or copies a
    /// database itself; it only opens the explicit `CODAKILLER_PREMAP_DB` path
    /// supplied by the release run, and refuses to touch anything inside the
    /// live app-data directory. Emits self-documenting stdout (piece,
    /// edition_id, fingerprint, points, OK/SKIP).
    #[test]
    #[ignore = "requires CODAKILLER_PREMAP_DB pointing to a disposable database copy"]
    fn premap_injection_on_database_copy() {
        #[derive(serde::Deserialize)]
        struct PremapFile {
            piece_id: i64,
            pdf: String,
            anchors: Vec<PremapAnchor>,
        }
        #[derive(serde::Deserialize)]
        struct PremapAnchor {
            page: i64,
            // The grand-staff midpoint — the most robust y for overlap tests.
            // `yTopPct` is deliberately NOT read.
            #[serde(rename = "yCenterPct")]
            y_center_pct: f64,
            measure: i64,
        }

        let path = std::env::var("CODAKILLER_PREMAP_DB")
            .expect("set CODAKILLER_PREMAP_DB to a disposable copy of the database");

        // Guard: never run against the live app-data database. Reject any path
        // that resolves inside the app's bundle-identifier data directory —
        // same spirit as the migration rehearsal (operator supplies a copy).
        let resolved = std::fs::canonicalize(&path)
            .unwrap_or_else(|e| panic!("resolve CODAKILLER_PREMAP_DB '{path}': {e}"));
        assert!(
            !resolved
                .components()
                .any(|component| component.as_os_str() == "com.christian.codakiller"),
            "refuse to run on the live app-data location ({}); copy the database first",
            resolved.display()
        );

        // Load every pre-map file from the repo (compile-time located).
        let premap_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../docs/qa/premap");
        let mut files: Vec<std::path::PathBuf> = std::fs::read_dir(&premap_dir)
            .unwrap_or_else(|e| panic!("read premap dir {}: {e}", premap_dir.display()))
            .flatten()
            .map(|entry| entry.path())
            .filter(|entry| entry.extension().and_then(|ext| ext.to_str()) == Some("json"))
            .collect();
        files.sort();
        assert_eq!(files.len(), 6, "expected exactly 6 pre-map json files");

        let store = Store::open(&path).expect("open premap rehearsal copy");

        let mut ok_count = 0usize;
        let mut total_points = 0usize;
        let mut scherzo_points: Option<Vec<_>> = None;

        for file in &files {
            let name = file.file_name().unwrap().to_string_lossy().into_owned();
            let raw = std::fs::read_to_string(file).unwrap_or_else(|e| panic!("read {name}: {e}"));
            let premap: PremapFile =
                serde_json::from_str(&raw).unwrap_or_else(|e| panic!("parse {name}: {e}"));

            // (1) piece must exist.
            if store.piece_pdf_paths(premap.piece_id).unwrap().is_none() {
                println!(
                    "SKIP  {name}: piece_id {} not found in this database",
                    premap.piece_id
                );
                continue;
            }

            // (2) compute the edition identity via the SAME code path the app
            // uses; match the json's pdf basename to exactly one edition.
            let editions = match crate::score::pdf_editions(&store, premap.piece_id) {
                Ok(editions) => editions,
                Err(e) => {
                    println!(
                        "SKIP  {name}: cannot enumerate editions for piece {}: {e}",
                        premap.piece_id
                    );
                    continue;
                }
            };
            let matches: Vec<_> = editions
                .iter()
                .filter(|edition| {
                    edition
                        .id
                        .rsplit('/')
                        .next()
                        .is_some_and(|base| base == premap.pdf)
                })
                .collect();
            let edition = match matches.as_slice() {
                [only] => *only,
                [] => {
                    println!(
                        "SKIP  {name}: no edition basename matches json pdf '{}'; found [{}]",
                        premap.pdf,
                        editions
                            .iter()
                            .map(|edition| edition.id.as_str())
                            .collect::<Vec<_>>()
                            .join(", ")
                    );
                    continue;
                }
                _ => {
                    println!(
                        "SKIP  {name}: json pdf '{}' matched {} editions (ambiguous)",
                        premap.pdf,
                        matches.len()
                    );
                    continue;
                }
            };

            // (3) anchors -> points_json [{page, y: yCenterPct, measure}].
            let points: Vec<serde_json::Value> = premap
                .anchors
                .iter()
                .map(|anchor| {
                    serde_json::json!({
                        "page": anchor.page,
                        "y": anchor.y_center_pct,
                        "measure": anchor.measure,
                    })
                })
                .collect();
            let anchor_count = points.len();
            let points_json = serde_json::to_string(&points).unwrap();

            // (4) the real validated save (user_verified = true).
            let saved = store
                .score_calibration_save(
                    premap.piece_id,
                    &edition.id,
                    &edition.fingerprint,
                    &points_json,
                    true,
                )
                .unwrap_or_else(|e| panic!("save calibration for {name}: {e}"));
            assert_eq!(saved.points.len(), anchor_count, "{name} saved point count");

            // Round-trip via the real get path.
            let fetched = store
                .score_calibration_get(premap.piece_id, &edition.id, &edition.fingerprint)
                .unwrap()
                .unwrap_or_else(|| panic!("calibration for {name} missing after save"));
            assert_eq!(
                fetched.points.len(),
                anchor_count,
                "{name} round-trip point count"
            );
            assert!(fetched.user_verified, "{name} must be stored user-verified");

            if premap.piece_id == 2 {
                scherzo_points = Some(fetched.points.clone());
            }

            println!(
                "OK    {name}: piece {} edition_id='{}' fingerprint='{}' points={}",
                premap.piece_id, edition.id, edition.fingerprint, anchor_count
            );
            ok_count += 1;
            total_points += anchor_count;
        }

        println!("--- rehearsal summary: {ok_count}/6 pieces OK, {total_points} points total ---");

        // Assertions: 6 rows exist, 288 points injected total.
        assert_eq!(ok_count, 6, "all 6 pre-map pieces must inject cleanly");
        let row_count: i64 = {
            let conn = store
                .conn
                .lock()
                .unwrap_or_else(|poison| poison.into_inner());
            conn.query_row(
                "SELECT COUNT(*) FROM score_edition_calibration",
                [],
                |row| row.get(0),
            )
            .unwrap()
        };
        assert_eq!(row_count, 6, "exactly 6 calibration rows must exist");
        assert_eq!(total_points, 288, "the sum of injected anchors must be 288");

        // Spot resolution sanity: for the Scherzo (piece 2), measure 67 sits on
        // page 3 between the stored m.65 and m.71 systems. In y-order the stored
        // page-3 points must bracket measure 67.
        let scherzo_points = scherzo_points.expect("Scherzo (piece 2) must have injected");
        let mut page3: Vec<_> = scherzo_points
            .iter()
            .filter(|point| point.page == 3)
            .cloned()
            .collect();
        assert!(!page3.is_empty(), "Scherzo page 3 must carry stored points");
        page3.sort_by(|a, b| a.y.partial_cmp(&b.y).unwrap());
        let brackets_67 = page3
            .windows(2)
            .any(|pair| pair[0].measure <= 67 && 67 <= pair[1].measure && pair[0].y < pair[1].y);
        assert!(
            brackets_67,
            "Scherzo page-3 stored points must bracket measure 67 in y-order: {:?}",
            page3
                .iter()
                .map(|point| (point.measure, point.y))
                .collect::<Vec<_>>()
        );
        println!(
            "OK    Scherzo m.67 brackets on page 3 (measure, y): {:?}",
            page3
                .iter()
                .map(|point| (point.measure, point.y))
                .collect::<Vec<_>>()
        );
    }

    // ── v1 → v3 migration ─────────────────────────────────────────────────

    /// Build a raw v1 database (the old placeholder schema) with a settings row,
    /// then hand it to `Store::from_connection` so the normal migrate() path
    /// upgrades it. Proves the upgrade preserves settings and reaches v3.
    #[test]
    fn v1_to_current_upgrade_preserves_settings() {
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
        assert_eq!(
            store.schema_version().unwrap(),
            migrations::SCHEMA_VERSION,
            "reaches current schema"
        );
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
        let canonical_goals = store.goal_list(id).unwrap();
        assert_eq!(canonical_goals.len(), 2);
        assert!(canonical_goals.iter().all(|goal| goal.kind == "big"));
        assert!(canonical_goals
            .iter()
            .all(|goal| goal.target_date.as_deref() == Some("2026-09-01")));
        store
            .set_preferred_pdf_path(id, "/v/Chopin - Scherzo/score/preferred.pdf")
            .unwrap();

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
        assert_eq!(
            d.pdf_path.as_deref(),
            Some("/v/Chopin - Scherzo/score/preferred.pdf"),
            "get_piece resolves the user preference over the refreshed scan"
        );
        let paths = store.piece_pdf_paths(id).unwrap().unwrap();
        assert_eq!(
            paths.scanned_pdf_path.as_deref(),
            Some("/v/Chopin - Scherzo/score/s.pdf")
        );
        assert_eq!(
            paths.preferred_pdf_path.as_deref(),
            Some("/v/Chopin - Scherzo/score/preferred.pdf"),
            "rescan never overwrites the user preference"
        );
    }

    #[test]
    fn intake_goal_sync_is_additive_deduplicated_and_never_deletes() {
        let store = mem();
        let id = store.upsert_piece(&scan("/v/A", "A", None)).unwrap();
        let intake = Intake {
            goals: vec!["Memorize".into(), " memorize ".into(), "Perform".into()],
            deadline: None,
            target_tempo: None,
            hard_spots: vec![],
            current_state: None,
        };
        store.save_intake(id, &intake).unwrap();
        assert_eq!(store.goal_list(id).unwrap().len(), 2);

        let shorter = Intake {
            goals: vec!["Perform".into()],
            ..intake
        };
        store.save_intake(id, &shorter).unwrap();
        let goals = store.goal_list(id).unwrap();
        assert_eq!(
            goals.len(),
            2,
            "omitting a goal from review must not erase it"
        );
    }

    #[test]
    fn intake_hard_spots_become_canonical_regions_once() {
        let store = mem();
        let id = store.upsert_piece(&scan("/v/A", "A", None)).unwrap();
        let intake = Intake {
            goals: vec![],
            deadline: None,
            target_tempo: None,
            hard_spots: vec![
                HardSpot {
                    measures: "12–16".into(),
                    note: "LH landing".into(),
                },
                HardSpot {
                    measures: "12-16".into(),
                    note: " lh landing ".into(),
                },
                HardSpot {
                    measures: "?".into(),
                    note: "Not mappable".into(),
                },
            ],
            current_state: None,
        };
        store.save_intake(id, &intake).unwrap();
        store.save_intake(id, &intake).unwrap();
        let regions = store.region_list(id).unwrap();
        assert_eq!(regions.len(), 1);
        assert_eq!(regions[0].name, "mm. 12–16");
        assert_eq!(regions[0].notes.as_deref(), Some("LH landing"));
        assert_eq!((regions[0].m_start, regions[0].m_end), (12, 16));
        assert_eq!(regions[0].color.as_deref(), Some("#c05a5a"));
    }

    #[test]
    fn intake_resave_moves_inherited_goal_deadlines_but_preserves_custom_dates() {
        let store = mem();
        let id = store.upsert_piece(&scan("/v/A", "A", None)).unwrap();
        let initial = Intake {
            goals: vec!["Memorize".into(), "Perform".into()],
            deadline: Some("2026-08-01".into()),
            target_tempo: None,
            hard_spots: vec![],
            current_state: None,
        };
        store.save_intake(id, &initial).unwrap();
        let goals = store.goal_list(id).unwrap();
        store
            .goal_update(
                goals[1].id,
                model::GoalPatch {
                    target_date: Some(Some("2026-07-20".into())),
                    ..Default::default()
                },
            )
            .unwrap();

        store
            .save_intake(
                id,
                &Intake {
                    deadline: Some("2026-09-01".into()),
                    ..initial
                },
            )
            .unwrap();

        let goals = store.goal_list(id).unwrap();
        assert_eq!(goals[0].target_date.as_deref(), Some("2026-09-01"));
        assert_eq!(goals[1].target_date.as_deref(), Some("2026-07-20"));
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
        assert_eq!(d.banner_text, None, "a fresh piece carries no score banner");
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
            .insert_rep_block(
                pid,
                1,
                8,
                Some("intro"),
                Some(80.0),
                Some(120.0),
                &rule,
                10,
                &variants,
                "tempo",
                true,
            )
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
        assert_eq!(h.start_bpm, Some(80.0));
        assert_eq!(h.bpm, Some(80.0), "latest rep bpm (all reps were at 80)");
        assert_eq!(h.target_bpm, Some(120.0));
        assert_eq!(h.planned_reps, 10);
        assert_eq!(h.status, "open");
        assert_eq!(h.reps_done, 4);
        assert_eq!(
            h.verdicts,
            VerdictCounts {
                clean: 2,
                flawed: 1,
                failed: 1
            }
        );

        store.update_block_status(block, "done").unwrap();
        assert_eq!(store.block_history(pid).unwrap()[0].status, "done");

        // A piece with no blocks yields an empty history (not an error).
        let empty = store
            .upsert_piece(&scan("/v/Empty", "Empty", None))
            .unwrap();
        assert!(store.block_history(empty).unwrap().is_empty());
    }

    #[test]
    fn block_history_zero_reps_has_empty_tallies() {
        let store = mem();
        let pid = store.upsert_piece(&scan("/v/P", "P", None)).unwrap();
        let rule = IncrementRule {
            clean_needed: 1,
            bpm_step: 2.0,
        };
        store
            .insert_rep_block(
                pid,
                1,
                4,
                None,
                Some(60.0),
                None,
                &rule,
                5,
                &[],
                "tempo",
                true,
            )
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
            .insert_session_event(
                sid,
                "rep",
                &serde_json::json!({ "verdict": "clean", "bpm": 80 }),
            )
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
