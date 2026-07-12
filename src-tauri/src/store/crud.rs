//! Foundation Tasks 3-7: the Rust CRUD layer for regions, blocks, reps, goals,
//! and inline piece-field edits. Each task's methods + tests are grouped in
//! their own section below (`region`/`block`/`rep`/`goal`/`piece_field`), all
//! sharing the `#[cfg(test)] mod tests` seed helpers at the bottom.

use rusqlite::Connection;

use super::model::{
    BlockPatch, Goal, GoalCreate, GoalPatch, PieceFieldPatch, Region, RegionCreate, RegionPatch,
    RepPatch, VerdictCounts,
};
use super::{EventKind, Store};
// ── Shared: append_event over an already-locked connection ─────────────────
//
// Landed with T3 (the first task to need it): every CRUD mutation below holds
// the store's connection lock across its whole read-modify-write + event
// append, so it calls this instead of the public `Store::append_event` (which
// would try to re-acquire the same `Mutex` and deadlock).

impl Store {
    /// `append_event`'s logic, taken over a `Connection` already borrowed from
    /// the lock — the CRUD methods above hold the lock across their whole
    /// mutation (so patch + event append is atomic under one lock acquisition)
    /// and can't re-enter `Store::append_event` (it would deadlock on the
    /// same `Mutex`).
    fn append_event_conn(
        conn: &Connection,
        kind: &str,
        session_id: Option<i64>,
        piece_id: Option<i64>,
        payload: &serde_json::Value,
    ) -> rusqlite::Result<i64> {
        conn.query_row(
            "INSERT INTO event (kind, session_id, piece_id, payload)
             VALUES (?1, ?2, ?3, ?4)
             RETURNING id",
            rusqlite::params![kind, session_id, piece_id, super::model::json_to_sql(payload)?],
            |row| row.get(0),
        )
    }
}

// ── Shared test-support helpers (seed_piece landed with T3; seed_block used
// from T3 on; seed_rep added when T4/T5 first need it, kept together here to
// avoid a second definition site) ───────────────────────────────────────────

#[cfg(test)]
mod test_support {
    use super::Store;
    use crate::store::model::{IncrementRule, ScanPiece};

    /// Seed a piece with a fixed folder path derived from `id` (unique per
    /// call so multiple seeded pieces in one test don't collide on the
    /// `folder_path` UNIQUE key). Returns nothing — callers already know
    /// `id` because a fresh in-memory store assigns ids from 1.
    pub fn seed_piece(s: &Store, id: i64) {
        let got = s
            .upsert_piece(&ScanPiece {
                folder_path: format!("/v/Piece{id}"),
                title: format!("Piece {id}"),
                composer: None,
                xml_path: None,
                pdf_path: None,
            })
            .unwrap();
        assert_eq!(got, id, "seed_piece must be called in id order starting at 1");
    }

    /// Seed an open rep block for `piece` spanning `[m_start, m_end]` with
    /// placeholder ladder/plan fields; returns its row id.
    pub fn seed_block(s: &Store, piece: i64, m_start: u32, m_end: u32) -> i64 {
        s.insert_rep_block(
            piece,
            m_start,
            m_end,
            None,
            60.0,
            None,
            &IncrementRule { clean_needed: 3, bpm_step: 2.0 },
            10,
            &[],
            "tempo",
            true,
        )
        .unwrap()
    }

    /// Seed one rep against a block with the given verdict; returns its row id.
    pub fn seed_rep(s: &Store, block_id: i64, verdict: &str) -> i64 {
        s.insert_rep(block_id, 60.0, None, verdict, None).unwrap()
    }
}
// ── T3: Region CRUD ─────────────────────────────────────────────────────────

impl Store {
    /// All regions for a piece, ordered by `sort_order`.
    pub fn region_list(&self, piece_id: i64) -> rusqlite::Result<Vec<Region>> {
        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        Self::region_list_conn(&conn, piece_id)
    }

    fn region_list_conn(conn: &Connection, piece_id: i64) -> rusqlite::Result<Vec<Region>> {
        let mut stmt = conn.prepare(
            "SELECT id, piece_id, name, m_start, m_end, kind, sort_order, color, pdf_anchor
             FROM region WHERE piece_id = ?1 ORDER BY sort_order",
        )?;
        let rows = stmt.query_map([piece_id], Self::region_from_row)?;
        rows.collect()
    }

    fn region_from_row(row: &rusqlite::Row) -> rusqlite::Result<Region> {
        let pdf_anchor_json: Option<String> = row.get(8)?;
        Ok(Region {
            id: row.get(0)?,
            piece_id: row.get(1)?,
            name: row.get(2)?,
            m_start: row.get(3)?,
            m_end: row.get(4)?,
            kind: row.get(5)?,
            order: row.get(6)?,
            color: row.get(7)?,
            pdf_anchor: pdf_anchor_json
                .map(|s| serde_json::from_str(&s))
                .transpose()
                .map_err(|e| {
                    rusqlite::Error::FromSqlConversionFailure(
                        8,
                        rusqlite::types::Type::Text,
                        Box::new(e),
                    )
                })?,
        })
    }

    fn region_get(conn: &Connection, id: i64) -> rusqlite::Result<Region> {
        conn.query_row(
            "SELECT id, piece_id, name, m_start, m_end, kind, sort_order, color, pdf_anchor
             FROM region WHERE id = ?1",
            [id],
            Self::region_from_row,
        )
    }

    /// Create a region; appends a `region_change` event. New regions land at
    /// the end of the piece's ordering (`sort_order = MAX(sort_order)+1`).
    pub fn region_create(&self, args: RegionCreate) -> rusqlite::Result<Region> {
        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        let id: i64 = conn.query_row(
            "INSERT INTO region (piece_id, name, m_start, m_end, kind, sort_order)
             VALUES (?1, ?2, ?3, ?4, ?5,
                 COALESCE((SELECT MAX(sort_order) + 1 FROM region WHERE piece_id = ?1), 0))
             RETURNING id",
            rusqlite::params![args.piece_id, args.name, args.m_start, args.m_end, args.kind],
            |row| row.get(0),
        )?;
        let region = Self::region_get(&conn, id)?;
        Self::append_event_conn(
            &conn,
            EventKind::REGION_CHANGE,
            None,
            Some(args.piece_id),
            &serde_json::json!({ "action": "create", "region_id": id }),
        )?;
        Ok(region)
    }

    /// Apply a partial patch to a region; appends a `region_change` event.
    pub fn region_update(&self, id: i64, patch: RegionPatch) -> rusqlite::Result<Region> {
        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        let mut sets: Vec<String> = Vec::new();
        let mut vals: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        if let Some(v) = patch.name {
            sets.push(format!("name = ?{}", vals.len() + 2));
            vals.push(Box::new(v));
        }
        if let Some(v) = patch.m_start {
            sets.push(format!("m_start = ?{}", vals.len() + 2));
            vals.push(Box::new(v));
        }
        if let Some(v) = patch.m_end {
            sets.push(format!("m_end = ?{}", vals.len() + 2));
            vals.push(Box::new(v));
        }
        if let Some(v) = patch.kind {
            sets.push(format!("kind = ?{}", vals.len() + 2));
            vals.push(Box::new(v));
        }
        if let Some(v) = patch.order {
            sets.push(format!("sort_order = ?{}", vals.len() + 2));
            vals.push(Box::new(v));
        }
        if let Some(v) = patch.color {
            sets.push(format!("color = ?{}", vals.len() + 2));
            vals.push(Box::new(v));
        }
        if !sets.is_empty() {
            let sql = format!("UPDATE region SET {} WHERE id = ?1", sets.join(", "));
            let mut params: Vec<&dyn rusqlite::ToSql> = vec![&id];
            for v in &vals {
                params.push(v.as_ref());
            }
            conn.execute(&sql, params.as_slice())?;
        }
        let region = Self::region_get(&conn, id)?;
        Self::append_event_conn(
            &conn,
            EventKind::REGION_CHANGE,
            None,
            Some(region.piece_id),
            &serde_json::json!({ "action": "update", "region_id": id }),
        )?;
        Ok(region)
    }

    /// Delete a region; member blocks are kept but their `region_id` is
    /// cleared (never cascade-deleted — a region is organizational, not
    /// load-bearing for practice history). Appends a `region_change` event.
    pub fn region_delete(&self, id: i64) -> rusqlite::Result<()> {
        let mut conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        let piece_id: i64 = conn.query_row(
            "SELECT piece_id FROM region WHERE id = ?1",
            [id],
            |row| row.get(0),
        )?;
        let tx = conn.transaction()?;
        tx.execute(
            "UPDATE rep_block SET region_id = NULL WHERE region_id = ?1",
            [id],
        )?;
        tx.execute("DELETE FROM region WHERE id = ?1", [id])?;
        tx.commit()?;
        Self::append_event_conn(
            &conn,
            EventKind::REGION_CHANGE,
            None,
            Some(piece_id),
            &serde_json::json!({ "action": "delete", "region_id": id }),
        )?;
        Ok(())
    }

    /// Merge `id_absorb` into `id_keep`: `id_keep`'s measure range widens to
    /// cover both, every block belonging to `id_absorb` is reassigned to
    /// `id_keep`, and `id_absorb` is deleted. Runs in one transaction.
    /// Appends a `region_change` event.
    pub fn region_merge(&self, id_keep: i64, id_absorb: i64) -> rusqlite::Result<Region> {
        let mut conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        let keep = Self::region_get(&conn, id_keep)?;
        let absorb = Self::region_get(&conn, id_absorb)?;
        let new_start = keep.m_start.min(absorb.m_start);
        let new_end = keep.m_end.max(absorb.m_end);

        let tx = conn.transaction()?;
        tx.execute(
            "UPDATE rep_block SET region_id = ?1 WHERE region_id = ?2",
            rusqlite::params![id_keep, id_absorb],
        )?;
        tx.execute(
            "UPDATE region SET m_start = ?2, m_end = ?3 WHERE id = ?1",
            rusqlite::params![id_keep, new_start, new_end],
        )?;
        tx.execute("DELETE FROM region WHERE id = ?1", [id_absorb])?;
        tx.commit()?;

        let region = Self::region_get(&conn, id_keep)?;
        Self::append_event_conn(
            &conn,
            EventKind::REGION_CHANGE,
            None,
            Some(region.piece_id),
            &serde_json::json!({ "action": "merge", "kept": id_keep, "absorbed": id_absorb }),
        )?;
        Ok(region)
    }
}
// ── T3: region tests ─────────────────────────────────────────────────────

#[cfg(test)]
mod region {
    use super::test_support::{seed_block, seed_piece};
    use super::*;
    use crate::store::Store;

    /// Test-only accessor into the private `conn` field, for assertions that
    /// read a raw column no public reader exposes (e.g. `rep_block.region_id`).
    fn s_conn(s: &Store) -> std::sync::MutexGuard<'_, rusqlite::Connection> {
        s.conn.lock().unwrap_or_else(|p| p.into_inner())
    }

    #[test]
    fn region_merge_reassigns_and_widens() {
        let s = Store::open(":memory:").unwrap();
        seed_piece(&s, 1);
        let a = s
            .region_create(RegionCreate { piece_id: 1, name: "A".into(), m_start: 1, m_end: 8, kind: "section".into() })
            .unwrap();
        let b = s
            .region_create(RegionCreate { piece_id: 1, name: "B".into(), m_start: 20, m_end: 28, kind: "section".into() })
            .unwrap();
        let bid = seed_block(&s, 1, 22, 26); // block in region B
        s.block_set_region(bid, Some(b.id)).unwrap();
        let kept = s.region_merge(a.id, b.id).unwrap();
        assert_eq!(kept.id, a.id);
        assert_eq!(kept.m_start, 1);
        assert_eq!(kept.m_end, 28); // widened
        assert_eq!(s.region_list(1).unwrap().len(), 1); // B gone
        assert_eq!(s.block_row(bid).unwrap().unwrap().block_id, bid);
        // reassigned: confirm via raw region_id column since BlockHistory has none.
        let region_id: Option<i64> = {
            let conn = s_conn(&s);
            conn.query_row("SELECT region_id FROM rep_block WHERE id = ?1", [bid], |r| r.get(0))
                .unwrap()
        };
        assert_eq!(region_id, Some(a.id));
    }

    #[test]
    fn region_delete_nulls_member_blocks_but_keeps_them() {
        let s = Store::open(":memory:").unwrap();
        seed_piece(&s, 1);
        let r = s
            .region_create(RegionCreate { piece_id: 1, name: "A".into(), m_start: 1, m_end: 8, kind: "section".into() })
            .unwrap();
        let bid = seed_block(&s, 1, 1, 8);
        s.block_set_region(bid, Some(r.id)).unwrap();
        s.region_delete(r.id).unwrap();
        assert!(s.region_list(1).unwrap().is_empty());
        let region_id: Option<i64> = {
            let conn = s_conn(&s);
            conn.query_row("SELECT region_id FROM rep_block WHERE id = ?1", [bid], |r| r.get(0))
                .unwrap()
        };
        assert_eq!(region_id, None, "block kept but region unlinked");
        assert!(s.block_row(bid).unwrap().is_some(), "block itself still exists");
    }

    #[test]
    fn region_update_applies_partial_patch() {
        let s = Store::open(":memory:").unwrap();
        seed_piece(&s, 1);
        let r = s
            .region_create(RegionCreate { piece_id: 1, name: "A".into(), m_start: 1, m_end: 8, kind: "section".into() })
            .unwrap();
        let updated = s
            .region_update(r.id, RegionPatch { name: Some("Intro".into()), color: Some(Some("#fff".into())), ..Default::default() })
            .unwrap();
        assert_eq!(updated.name, "Intro");
        assert_eq!(updated.color.as_deref(), Some("#fff"));
        assert_eq!(updated.m_start, 1, "untouched field unchanged");

        // Some(None) clears color.
        let cleared = s.region_update(r.id, RegionPatch { color: Some(None), ..Default::default() }).unwrap();
        assert_eq!(cleared.color, None);
    }

    #[test]
    fn region_list_orders_by_sort_order() {
        let s = Store::open(":memory:").unwrap();
        seed_piece(&s, 1);
        let a = s
            .region_create(RegionCreate { piece_id: 1, name: "A".into(), m_start: 1, m_end: 8, kind: "section".into() })
            .unwrap();
        let b = s
            .region_create(RegionCreate { piece_id: 1, name: "B".into(), m_start: 9, m_end: 16, kind: "section".into() })
            .unwrap();
        s.region_update(a.id, RegionPatch { order: Some(5), ..Default::default() }).unwrap();
        let ids: Vec<i64> = s.region_list(1).unwrap().into_iter().map(|r| r.id).collect();
        assert_eq!(ids, vec![b.id, a.id]);
    }
}
// ── T4: Block update/delete ─────────────────────────────────────────────────

impl Store {
    /// Apply a partial patch to a rep block; appends a `block_edit` event and
    /// returns the refreshed [`super::model::BlockHistory`] row. Does NOT
    /// touch the rep engine's in-memory active snapshot — the command layer
    /// calls `RepEngine::resync_active_if` after this succeeds.
    pub fn block_update(
        &self,
        block_id: i64,
        patch: BlockPatch,
    ) -> rusqlite::Result<super::model::BlockHistory> {
        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        let mut sets: Vec<String> = Vec::new();
        let mut vals: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        if let Some(v) = patch.label {
            sets.push(format!("label = ?{}", vals.len() + 2));
            vals.push(Box::new(v));
        }
        if let Some(v) = patch.m_start {
            sets.push(format!("m_start = ?{}", vals.len() + 2));
            vals.push(Box::new(v));
        }
        if let Some(v) = patch.m_end {
            sets.push(format!("m_end = ?{}", vals.len() + 2));
            vals.push(Box::new(v));
        }
        if let Some(v) = patch.start_bpm {
            sets.push(format!("start_bpm = ?{}", vals.len() + 2));
            vals.push(Box::new(v));
        }
        if let Some(v) = patch.target_bpm {
            sets.push(format!("target_bpm = ?{}", vals.len() + 2));
            vals.push(Box::new(v));
        }
        if let Some(v) = patch.planned_reps {
            sets.push(format!("planned_reps = ?{}", vals.len() + 2));
            vals.push(Box::new(v));
        }
        if let Some(v) = patch.focus {
            sets.push(format!("focus = ?{}", vals.len() + 2));
            vals.push(Box::new(v));
        }
        if let Some(v) = patch.use_metronome {
            sets.push(format!("use_metronome = ?{}", vals.len() + 2));
            vals.push(Box::new(v));
        }
        if let Some(v) = patch.region_id {
            sets.push(format!("region_id = ?{}", vals.len() + 2));
            vals.push(Box::new(v));
        }
        if let Some(v) = patch.increment_rule {
            let json = v.map(|r| super::model::json_to_sql(&r)).transpose()?;
            sets.push(format!("increment_rule = ?{}", vals.len() + 2));
            vals.push(Box::new(json));
        }
        if !sets.is_empty() {
            let sql = format!("UPDATE rep_block SET {} WHERE id = ?1", sets.join(", "));
            let mut params: Vec<&dyn rusqlite::ToSql> = vec![&block_id];
            for v in &vals {
                params.push(v.as_ref());
            }
            conn.execute(&sql, params.as_slice())?;
        }
        let piece_id: i64 =
            conn.query_row("SELECT piece_id FROM rep_block WHERE id = ?1", [block_id], |r| {
                r.get(0)
            })?;
        Self::append_event_conn(
            &conn,
            EventKind::BLOCK_EDIT,
            None,
            Some(piece_id),
            &serde_json::json!({ "action": "update", "block_id": block_id }),
        )?;
        drop(conn);
        self.block_row(block_id)?
            .ok_or_else(|| rusqlite::Error::QueryReturnedNoRows)
    }

    /// Delete a block and every rep logged against it (cascade, in one
    /// transaction). Appends a `block_edit` event.
    pub fn block_delete(&self, block_id: i64) -> rusqlite::Result<()> {
        let mut conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        let piece_id: i64 =
            conn.query_row("SELECT piece_id FROM rep_block WHERE id = ?1", [block_id], |r| {
                r.get(0)
            })?;
        let tx = conn.transaction()?;
        tx.execute("DELETE FROM rep WHERE block_id = ?1", [block_id])?;
        tx.execute("DELETE FROM rep_block WHERE id = ?1", [block_id])?;
        tx.commit()?;
        Self::append_event_conn(
            &conn,
            EventKind::BLOCK_EDIT,
            None,
            Some(piece_id),
            &serde_json::json!({ "action": "delete", "block_id": block_id }),
        )?;
        Ok(())
    }
}
// ── T4: block tests ──────────────────────────────────────────────────────

#[cfg(test)]
mod block {
    use super::test_support::{seed_block, seed_piece, seed_rep};
    use super::*;
    use crate::store::Store;

    #[test]
    fn block_delete_removes_block_and_its_reps() {
        let s = Store::open(":memory:").unwrap();
        seed_piece(&s, 1);
        let bid = seed_block(&s, 1, 1, 8);
        seed_rep(&s, bid, "clean");
        seed_rep(&s, bid, "flawed");
        s.block_delete(bid).unwrap();
        assert_eq!(s.block_row(bid).unwrap(), None);
        let reps = s.reps_for_block(bid).unwrap();
        assert!(reps.is_empty());
    }

    #[test]
    fn block_update_on_non_active_block_persists() {
        let s = Store::open(":memory:").unwrap();
        seed_piece(&s, 1);
        let bid = seed_block(&s, 1, 1, 8);
        let updated = s
            .block_update(
                bid,
                BlockPatch {
                    label: Some(Some("legato".into())),
                    target_bpm: Some(Some(120.0)),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(updated.label.as_deref(), Some("legato"));
        assert_eq!(updated.target_bpm, Some(120.0));
        assert_eq!(updated.m_start, 1, "untouched field unchanged");
    }
}
// ── T5: Rep update/delete with verdict-count recompute ─────────────────────

/// Recompute verdict tallies for a block by grouping its surviving `rep`
/// rows. Counts are always derived live (never a stored/decremented
/// counter) — see `block_row`, which uses the same derivation for the full
/// `reps_done`/`bpm` row.
fn recompute_block_counts(conn: &Connection, block_id: i64) -> rusqlite::Result<VerdictCounts> {
    let mut counts = VerdictCounts::default();
    let mut stmt =
        conn.prepare("SELECT verdict, COUNT(*) FROM rep WHERE block_id = ?1 GROUP BY verdict")?;
    let rows = stmt.query_map([block_id], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
    })?;
    for row in rows {
        let (v, n) = row?;
        match v.as_str() {
            "clean" => counts.clean = n as u32,
            "flawed" => counts.flawed = n as u32,
            "failed" => counts.failed = n as u32,
            _ => {}
        }
    }
    Ok(counts)
}

impl Store {
    /// Apply a partial patch to one rep (verdict replace, nullable note);
    /// appends a `rep_edit` event. Counts are derived live on read (see
    /// `block_row`), so no counter needs updating here.
    /// Returns the owning `block_id` so the command layer can resync the rep
    /// engine's active snapshot without a second lookup.
    pub fn rep_update(&self, rep_id: i64, patch: RepPatch) -> rusqlite::Result<i64> {
        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        let mut sets: Vec<String> = Vec::new();
        let mut vals: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        if let Some(v) = patch.verdict {
            sets.push(format!("verdict = ?{}", vals.len() + 2));
            vals.push(Box::new(v));
        }
        if let Some(v) = patch.note {
            sets.push(format!("note = ?{}", vals.len() + 2));
            vals.push(Box::new(v));
        }
        if !sets.is_empty() {
            let sql = format!("UPDATE rep SET {} WHERE id = ?1", sets.join(", "));
            let mut params: Vec<&dyn rusqlite::ToSql> = vec![&rep_id];
            for v in &vals {
                params.push(v.as_ref());
            }
            conn.execute(&sql, params.as_slice())?;
        }
        let block_id: i64 =
            conn.query_row("SELECT block_id FROM rep WHERE id = ?1", [rep_id], |r| r.get(0))?;
        // Touch the derived counts (also validates the row exists post-patch);
        // the actual values are re-derived by whoever reads block_row next.
        recompute_block_counts(&conn, block_id)?;
        let piece_id: i64 =
            conn.query_row("SELECT piece_id FROM rep_block WHERE id = ?1", [block_id], |r| {
                r.get(0)
            })?;
        Self::append_event_conn(
            &conn,
            EventKind::REP_EDIT,
            None,
            Some(piece_id),
            &serde_json::json!({ "action": "update", "rep_id": rep_id, "block_id": block_id }),
        )?;
        Ok(block_id)
    }

    /// Delete a rep; appends a `rep_edit` event. Verdict counts and
    /// `reps_done` need no explicit recompute step — they are always derived
    /// live from surviving `rep` rows by `block_row`. Returns the owning
    /// `block_id` (see [`Self::rep_update`]).
    pub fn rep_delete(&self, rep_id: i64) -> rusqlite::Result<i64> {
        let mut conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        let block_id: i64 =
            conn.query_row("SELECT block_id FROM rep WHERE id = ?1", [rep_id], |r| r.get(0))?;
        let tx = conn.transaction()?;
        tx.execute("DELETE FROM rep WHERE id = ?1", [rep_id])?;
        tx.commit()?;
        recompute_block_counts(&conn, block_id)?;
        let piece_id: i64 =
            conn.query_row("SELECT piece_id FROM rep_block WHERE id = ?1", [block_id], |r| {
                r.get(0)
            })?;
        Self::append_event_conn(
            &conn,
            EventKind::REP_EDIT,
            None,
            Some(piece_id),
            &serde_json::json!({ "action": "delete", "rep_id": rep_id, "block_id": block_id }),
        )?;
        Ok(block_id)
    }
}
// ── T5: rep tests ────────────────────────────────────────────────────────

#[cfg(test)]
mod rep {
    use super::test_support::{seed_block, seed_piece, seed_rep};
    use super::*;
    use crate::store::Store;

    #[test]
    fn deleting_a_rep_recomputes_block_counts() {
        let s = Store::open(":memory:").unwrap();
        seed_piece(&s, 1);
        let bid = seed_block(&s, 1, 1, 8);
        let r1 = seed_rep(&s, bid, "clean");
        let _r2 = seed_rep(&s, bid, "clean");
        let _r3 = seed_rep(&s, bid, "flawed");
        s.rep_delete(r1).unwrap();
        let b = s.block_row(bid).unwrap().unwrap();
        assert_eq!(b.reps_done, 2);
        assert_eq!(b.verdicts.clean, 1);
        assert_eq!(b.verdicts.flawed, 1);
    }

    #[test]
    fn updating_a_verdict_recomputes_counts() {
        let s = Store::open(":memory:").unwrap();
        seed_piece(&s, 1);
        let bid = seed_block(&s, 1, 1, 8);
        let r1 = seed_rep(&s, bid, "flawed");
        s.rep_update(r1, RepPatch { verdict: Some("clean".into()), note: None }).unwrap();
        assert_eq!(s.block_row(bid).unwrap().unwrap().verdicts.clean, 1);
    }
}
// ── T6: Goal CRUD + reorder ─────────────────────────────────────────────────

impl Store {
    /// All goals for a piece, ordered by `sort_order`.
    pub fn goal_list(&self, piece_id: i64) -> rusqlite::Result<Vec<Goal>> {
        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        let mut stmt = conn.prepare(
            "SELECT id, piece_id, text, kind, parent_goal_id, done, sort_order, target_date, created_ts
             FROM goal WHERE piece_id = ?1 ORDER BY sort_order",
        )?;
        let rows = stmt.query_map([piece_id], Self::goal_from_row)?;
        rows.collect()
    }

    fn goal_from_row(row: &rusqlite::Row) -> rusqlite::Result<Goal> {
        Ok(Goal {
            id: row.get(0)?,
            piece_id: row.get(1)?,
            text: row.get(2)?,
            kind: row.get(3)?,
            parent_goal_id: row.get(4)?,
            done: row.get(5)?,
            order: row.get(6)?,
            target_date: row.get(7)?,
            created_ts: row.get(8)?,
        })
    }

    fn goal_get(conn: &Connection, id: i64) -> rusqlite::Result<Goal> {
        conn.query_row(
            "SELECT id, piece_id, text, kind, parent_goal_id, done, sort_order, target_date, created_ts
             FROM goal WHERE id = ?1",
            [id],
            Self::goal_from_row,
        )
    }

    /// Create a goal; appends a `goal_change` event. New goals land at the
    /// end of the piece's ordering (`sort_order = MAX(sort_order)+1`).
    pub fn goal_create(&self, args: GoalCreate) -> rusqlite::Result<Goal> {
        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        let id: i64 = conn.query_row(
            "INSERT INTO goal (piece_id, text, kind, parent_goal_id, target_date, sort_order)
             VALUES (?1, ?2, ?3, ?4, ?5,
                 COALESCE((SELECT MAX(sort_order) + 1 FROM goal WHERE piece_id = ?1), 0))
             RETURNING id",
            rusqlite::params![
                args.piece_id,
                args.text,
                args.kind,
                args.parent_goal_id,
                args.target_date
            ],
            |row| row.get(0),
        )?;
        let goal = Self::goal_get(&conn, id)?;
        Self::append_event_conn(
            &conn,
            EventKind::GOAL_CHANGE,
            None,
            Some(args.piece_id),
            &serde_json::json!({ "action": "create", "goal_id": id }),
        )?;
        Ok(goal)
    }

    /// Apply a partial patch to a goal; appends a `goal_change` event.
    pub fn goal_update(&self, id: i64, patch: GoalPatch) -> rusqlite::Result<Goal> {
        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        let mut sets: Vec<String> = Vec::new();
        let mut vals: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        if let Some(v) = patch.text {
            sets.push(format!("text = ?{}", vals.len() + 2));
            vals.push(Box::new(v));
        }
        if let Some(v) = patch.done {
            sets.push(format!("done = ?{}", vals.len() + 2));
            vals.push(Box::new(v));
        }
        if let Some(v) = patch.target_date {
            sets.push(format!("target_date = ?{}", vals.len() + 2));
            vals.push(Box::new(v));
        }
        if let Some(v) = patch.parent_goal_id {
            sets.push(format!("parent_goal_id = ?{}", vals.len() + 2));
            vals.push(Box::new(v));
        }
        if !sets.is_empty() {
            let sql = format!("UPDATE goal SET {} WHERE id = ?1", sets.join(", "));
            let mut params: Vec<&dyn rusqlite::ToSql> = vec![&id];
            for v in &vals {
                params.push(v.as_ref());
            }
            conn.execute(&sql, params.as_slice())?;
        }
        let goal = Self::goal_get(&conn, id)?;
        Self::append_event_conn(
            &conn,
            EventKind::GOAL_CHANGE,
            None,
            Some(goal.piece_id),
            &serde_json::json!({ "action": "update", "goal_id": id }),
        )?;
        Ok(goal)
    }

    /// Delete a goal; appends a `goal_change` event.
    pub fn goal_delete(&self, id: i64) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        let piece_id: i64 =
            conn.query_row("SELECT piece_id FROM goal WHERE id = ?1", [id], |r| r.get(0))?;
        conn.execute("DELETE FROM goal WHERE id = ?1", [id])?;
        Self::append_event_conn(
            &conn,
            EventKind::GOAL_CHANGE,
            None,
            Some(piece_id),
            &serde_json::json!({ "action": "delete", "goal_id": id }),
        )?;
        Ok(())
    }

    /// Assign `sort_order` by array index, in one transaction. Appends a
    /// single `goal_change` event for the whole reorder.
    pub fn goal_reorder(&self, piece_id: i64, ordered_ids: Vec<i64>) -> rusqlite::Result<()> {
        let mut conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        let tx = conn.transaction()?;
        for (idx, id) in ordered_ids.iter().enumerate() {
            tx.execute(
                "UPDATE goal SET sort_order = ?2 WHERE id = ?1 AND piece_id = ?3",
                rusqlite::params![id, idx as i64, piece_id],
            )?;
        }
        tx.commit()?;
        Self::append_event_conn(
            &conn,
            EventKind::GOAL_CHANGE,
            None,
            Some(piece_id),
            &serde_json::json!({ "action": "reorder", "order": ordered_ids }),
        )?;
        Ok(())
    }
}
// ── T6: goal tests ───────────────────────────────────────────────────────

#[cfg(test)]
mod goal {
    use super::test_support::seed_piece;
    use super::*;
    use crate::store::Store;

    #[test]
    fn goal_reorder_sets_sort_order_by_index() {
        let s = Store::open(":memory:").unwrap();
        seed_piece(&s, 1);
        let a = s
            .goal_create(GoalCreate { piece_id: 1, text: "a".into(), kind: "big".into(), parent_goal_id: None, target_date: None })
            .unwrap();
        let b = s
            .goal_create(GoalCreate { piece_id: 1, text: "b".into(), kind: "big".into(), parent_goal_id: None, target_date: None })
            .unwrap();
        s.goal_reorder(1, vec![b.id, a.id]).unwrap();
        let ids: Vec<i64> = s.goal_list(1).unwrap().into_iter().map(|g| g.id).collect();
        assert_eq!(ids, vec![b.id, a.id]);
    }

    #[test]
    fn goal_update_toggles_done() {
        let s = Store::open(":memory:").unwrap();
        seed_piece(&s, 1);
        let g = s
            .goal_create(GoalCreate { piece_id: 1, text: "a".into(), kind: "big".into(), parent_goal_id: None, target_date: None })
            .unwrap();
        assert!(!g.done);
        let updated = s.goal_update(g.id, GoalPatch { done: Some(true), ..Default::default() }).unwrap();
        assert!(updated.done);
    }

    #[test]
    fn goal_delete_removes_it() {
        let s = Store::open(":memory:").unwrap();
        seed_piece(&s, 1);
        let g = s
            .goal_create(GoalCreate { piece_id: 1, text: "a".into(), kind: "big".into(), parent_goal_id: None, target_date: None })
            .unwrap();
        s.goal_delete(g.id).unwrap();
        assert!(s.goal_list(1).unwrap().is_empty());
    }
}
// ── T7: Inline piece-field update ───────────────────────────────────────────

impl Store {
    /// Update any of a piece's inline-editable intake fields (absent =
    /// unchanged). Deliberately appends NO event — see [`PieceFieldPatch`].
    pub fn piece_field_update(&self, piece_id: i64, patch: PieceFieldPatch) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        let mut sets: Vec<String> = Vec::new();
        let mut vals: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        if let Some(v) = patch.current_state {
            sets.push(format!("current_state = ?{}", vals.len() + 2));
            vals.push(Box::new(v));
        }
        if let Some(v) = patch.deadline {
            sets.push(format!("deadline = ?{}", vals.len() + 2));
            vals.push(Box::new(v));
        }
        if let Some(v) = patch.target_tempo {
            sets.push(format!("target_tempo = ?{}", vals.len() + 2));
            vals.push(Box::new(v));
        }
        if let Some(v) = patch.notes {
            sets.push(format!("notes = ?{}", vals.len() + 2));
            vals.push(Box::new(v));
        }
        if !sets.is_empty() {
            let sql = format!("UPDATE piece SET {} WHERE id = ?1", sets.join(", "));
            let mut params: Vec<&dyn rusqlite::ToSql> = vec![&piece_id];
            for v in &vals {
                params.push(v.as_ref());
            }
            conn.execute(&sql, params.as_slice())?;
        }
        Ok(())
    }
}
// ── T7: piece_field tests ────────────────────────────────────────────────

#[cfg(test)]
mod piece_field {
    use super::test_support::seed_piece;
    use super::*;
    use crate::store::Store;

    #[test]
    fn piece_field_update_edits_current_state_only() {
        let s = Store::open(":memory:").unwrap();
        seed_piece(&s, 1);
        s.piece_field_update(1, PieceFieldPatch { current_state: Some(Some("mm.1-40 solid".into())), ..Default::default() })
            .unwrap();
        let p = s.get_piece(1).unwrap().unwrap();
        assert_eq!(p.current_state.as_deref(), Some("mm.1-40 solid"));
        assert_eq!(p.deadline, None); // untouched
    }
}
