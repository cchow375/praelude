//! Foundation Tasks 3-7: the Rust CRUD layer for regions, blocks, reps, goals,
//! and inline piece-field edits. Each task's methods + tests are grouped in
//! their own section below (`region`/`block`/`rep`/`goal`/`piece_field`), all
//! sharing the `#[cfg(test)] mod tests` seed helpers at the bottom.

use rusqlite::Connection;

use super::model::{Region, RegionCreate, RegionPatch};
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
