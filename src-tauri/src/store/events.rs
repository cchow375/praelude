//! The durable, append-only canonical event log (v3 `event` table).
//!
//! This is a SEPARATE store from the pre-existing `session_event` table: that one
//! drives the live session-panel feed, while `event` is the canonical, durable log
//! that export, metrics, and future features derive from (Foundation global
//! constraint: "SQLite is the single source of truth"). Both `session_id` and
//! `piece_id` are nullable — an event may belong to a session, a piece, both, or
//! neither. Rows are strictly ordered by their autoincrement `id`, so read-back is
//! insertion order regardless of same-second `ts` ties.

use super::model::{json_from_sql, json_to_sql, Event};
use super::Store;

/// The canonical `event.kind` string constants. Kept as `&'static str` consts (not
/// an enum) because the column is free-form TEXT and callers/readers compare
/// against the wire string; this gives one authoritative spelling per kind.
pub struct EventKind;

#[allow(dead_code)] // several kinds are appended by later Foundation tasks (T18+).
impl EventKind {
    pub const SESSION_START: &'static str = "session_start";
    pub const SESSION_END: &'static str = "session_end";
    pub const REP_OPEN: &'static str = "rep_open";
    pub const REP: &'static str = "rep";
    pub const VERDICT: &'static str = "verdict";
    pub const TEMPO_CHANGE: &'static str = "tempo_change";
    pub const BLOCK_EDIT: &'static str = "block_edit";
    pub const REP_EDIT: &'static str = "rep_edit";
    pub const REGION_CHANGE: &'static str = "region_change";
    pub const GOAL_CHANGE: &'static str = "goal_change";
    pub const DAILY_WORK_CHANGE: &'static str = "daily_work_change";
    pub const RECOVERY_APPLY: &'static str = "recovery_apply";
}

impl Store {
    /// Append one event to the durable log and return its row id. `payload` is
    /// stored as JSON TEXT. `session_id`/`piece_id` are optional FK links (pass
    /// `None` for an event not tied to a session or piece).
    pub fn append_event(
        &self,
        kind: &str,
        session_id: Option<i64>,
        piece_id: Option<i64>,
        payload: &serde_json::Value,
    ) -> rusqlite::Result<i64> {
        // See `schema_version`: recover from a poisoned lock rather than propagate it.
        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        conn.query_row(
            "INSERT INTO event (kind, session_id, piece_id, payload)
             VALUES (?1, ?2, ?3, ?4)
             RETURNING id",
            rusqlite::params![kind, session_id, piece_id, json_to_sql(payload)?],
            |row| row.get(0),
        )
    }

    /// Every event for a session, in insertion order (by `id`).
    #[allow(dead_code)] // read side consumed by metrics/export in later Foundation tasks.
    pub fn events_for_session(&self, session_id: i64) -> rusqlite::Result<Vec<Event>> {
        self.events_where("session_id", session_id)
    }

    /// Every event for a piece, in insertion order (by `id`).
    #[allow(dead_code)] // read side consumed by metrics/export in later Foundation tasks.
    pub fn events_for_piece(&self, piece_id: i64) -> rusqlite::Result<Vec<Event>> {
        self.events_where("piece_id", piece_id)
    }

    /// Shared reader for the two `events_for_*` queries. `column` is a fixed,
    /// crate-internal identifier (never user input), so interpolating it into the
    /// SQL is safe here.
    fn events_where(&self, column: &str, value: i64) -> rusqlite::Result<Vec<Event>> {
        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        let mut stmt = conn.prepare(&format!(
            "SELECT id, ts, session_id, piece_id, kind, payload
             FROM event WHERE {column} = ?1 ORDER BY id",
        ))?;
        let rows = stmt.query_map([value], |row| {
            let payload_json: String = row.get(5)?;
            Ok(Event {
                id: row.get(0)?,
                ts: row.get(1)?,
                session_id: row.get(2)?,
                piece_id: row.get(3)?,
                kind: row.get(4)?,
                payload: json_from_sql(&payload_json)?,
            })
        })?;
        rows.collect()
    }
}

#[cfg(test)]
mod tests {
    use crate::store::model::ScanPiece;
    use crate::store::Store;
    use serde_json::json;

    /// Seed one piece + one open session so the real FK links in the test below
    /// are satisfiable (the `event` table's `session_id`/`piece_id` are enforced
    /// FKs and `PRAGMA foreign_keys = ON`). In a fresh in-memory store both ids
    /// are 1, matching the brief's literal `Some(1)` values.
    fn seeded() -> (Store, i64, i64) {
        let s = Store::open(":memory:").unwrap();
        let pid = s
            .upsert_piece(&ScanPiece {
                folder_path: "/v/P".into(),
                title: "P".into(),
                composer: None,
                xml_path: None,
                pdf_path: None,
            })
            .unwrap();
        let sid = s.open_session().unwrap();
        (s, sid, pid)
    }

    #[test]
    fn append_and_read_back_ordered() {
        let (s, sid, pid) = seeded();
        s.append_event(
            super::EventKind::REP_OPEN,
            Some(sid),
            Some(pid),
            &json!({"block_id":7}),
        )
        .unwrap();
        s.append_event(
            super::EventKind::REP,
            Some(sid),
            Some(pid),
            &json!({"verdict":"clean"}),
        )
        .unwrap();
        let evs = s.events_for_session(sid).unwrap();
        assert_eq!(evs.len(), 2);
        assert_eq!(evs[0].kind, "rep_open");
        assert_eq!(evs[0].payload["block_id"], 7);
        assert_eq!(evs[1].kind, "rep");
        assert_eq!(evs[1].payload["verdict"], "clean");
        // ts is populated by the column default and ordering is by id, not ts.
        assert!(!evs[0].ts.is_empty());
    }

    #[test]
    fn nullable_piece_id_is_allowed() {
        // Proves an event may omit its piece link (session_start is not piece-scoped).
        let (s, sid, _pid) = seeded();
        let id = s
            .append_event(super::EventKind::SESSION_START, Some(sid), None, &json!({}))
            .unwrap();
        assert!(id > 0);
        let evs = s.events_for_session(sid).unwrap();
        assert_eq!(evs.len(), 1);
        assert_eq!(evs[0].kind, "session_start");
        assert_eq!(evs[0].piece_id, None);
        assert_eq!(evs[0].session_id, Some(sid));
    }

    #[test]
    fn events_for_piece_filters_by_piece() {
        let (s, sid, pid) = seeded();
        s.append_event(super::EventKind::REP, Some(sid), Some(pid), &json!({"n":1}))
            .unwrap();
        s.append_event(super::EventKind::SESSION_START, Some(sid), None, &json!({}))
            .unwrap();
        let evs = s.events_for_piece(pid).unwrap();
        assert_eq!(evs.len(), 1, "only the piece-scoped event");
        assert_eq!(evs[0].payload["n"], 1);
    }
}
