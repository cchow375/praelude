//! Foundation Tasks 3-7: the Rust CRUD layer for regions, blocks, reps, goals,
//! and inline piece-field edits. Each task's methods + tests are grouped in
//! their own section below (`region`/`block`/`rep`/`goal`/`piece_field`), all
//! sharing the `#[cfg(test)] mod tests` seed helpers at the bottom.

use rusqlite::{Connection, OptionalExtension};

use super::model::{
    json_to_sql, BlockPatch, BrainThreadResume, BrainTurnRow, DemotionConfig, Goal, GoalCreate,
    GoalPatch, PieceFieldPatch, RecoveryActionRow, Region, RegionCreate, RegionDeleteMode,
    RegionPatch, RepPatch,
};
use super::{EventKind, Store};
use crate::ledger::MutationSource;
use crate::rep::RepVerdict;
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
            rusqlite::params![
                kind,
                session_id,
                piece_id,
                super::model::json_to_sql(payload)?
            ],
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
        assert_eq!(
            got, id,
            "seed_piece must be called in id order starting at 1"
        );
    }

    /// Seed an open rep block for `piece` spanning `[m_start, m_end]` with
    /// placeholder ladder/plan fields; returns its row id.
    pub fn seed_block(s: &Store, piece: i64, m_start: u32, m_end: u32) -> i64 {
        s.insert_rep_block(
            piece,
            m_start,
            m_end,
            None,
            Some(60.0),
            None,
            &IncrementRule {
                clean_needed: 3,
                bpm_step: 2.0,
                ..Default::default()
            },
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

    /// Task C5: every row gains `target_meta.parent_region_id` via a LEFT JOIN
    /// (most regions have no `target_meta` row at all, hence LEFT not INNER).
    const REGION_SELECT: &'static str =
        "SELECT region.id, region.piece_id, region.name, region.m_start, region.m_end,
                region.kind, region.sort_order, region.color, region.pdf_anchor, region.notes,
                target_meta.parent_region_id
         FROM region LEFT JOIN target_meta ON target_meta.region_id = region.id";

    fn region_list_conn(conn: &Connection, piece_id: i64) -> rusqlite::Result<Vec<Region>> {
        let sql = format!(
            "{} WHERE region.piece_id = ?1 ORDER BY region.sort_order",
            Self::REGION_SELECT
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map([piece_id], Self::region_from_row)?;
        rows.collect()
    }

    fn region_from_row(row: &rusqlite::Row) -> rusqlite::Result<Region> {
        let pdf_anchor_json: Option<String> = row.get(8)?;
        Ok(Region {
            id: row.get(0)?,
            piece_id: row.get(1)?,
            name: row.get(2)?,
            notes: row.get(9)?,
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
            parent_region_id: row.get(10)?,
        })
    }

    fn region_get(conn: &Connection, id: i64) -> rusqlite::Result<Region> {
        let sql = format!("{} WHERE region.id = ?1", Self::REGION_SELECT);
        conn.query_row(&sql, [id], Self::region_from_row)
    }

    fn normalized_region_name(value: String) -> rusqlite::Result<String> {
        let value = value.trim().to_string();
        if value.is_empty() || value.chars().count() > 500 {
            return Err(rusqlite::Error::InvalidQuery);
        }
        Ok(value)
    }

    fn normalized_region_notes(value: Option<String>) -> rusqlite::Result<Option<String>> {
        let value = value
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        if value
            .as_ref()
            .is_some_and(|value| value.chars().count() > 10_000)
        {
            return Err(rusqlite::Error::InvalidQuery);
        }
        Ok(value)
    }

    fn valid_region_kind(value: &str) -> bool {
        matches!(
            value,
            "section" | "phrase" | "group" | "hard_spot" | "custom"
        )
    }

    /// Create a region; appends a `region_change` event. New regions land at
    /// the end of the piece's ordering (`sort_order = MAX(sort_order)+1`).
    pub fn region_create(&self, args: RegionCreate) -> rusqlite::Result<Region> {
        let name = Self::normalized_region_name(args.name)?;
        let notes = Self::normalized_region_notes(args.notes)?;
        if args.m_start < 1 || args.m_end < args.m_start || !Self::valid_region_kind(&args.kind) {
            return Err(rusqlite::Error::InvalidQuery);
        }
        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        let id: i64 = conn.query_row(
            "INSERT INTO region (piece_id, name, notes, m_start, m_end, kind, sort_order)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6,
                 COALESCE((SELECT MAX(sort_order) + 1 FROM region WHERE piece_id = ?1), 0))
             RETURNING id",
            rusqlite::params![
                args.piece_id,
                name,
                notes,
                args.m_start,
                args.m_end,
                args.kind
            ],
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

    /// Task C5: this region's parent, if it is a sub-section (`None` for a
    /// top-level region, or a region with no `target_meta` row at all).
    pub fn region_parent_id(&self, region_id: i64) -> rusqlite::Result<Option<i64>> {
        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        Ok(conn
            .query_row(
                "SELECT parent_region_id FROM target_meta WHERE region_id = ?1",
                [region_id],
                |row| row.get::<_, Option<i64>>(0),
            )
            .optional()?
            .flatten())
    }

    /// Create a region, optionally as a sub-section of `parent_region_id`.
    /// Rust enforces, with a friendly error before the DB is ever touched:
    /// the parent must exist, must belong to the same piece as the new
    /// region (the `target_meta` trigger is a backstop, not the primary
    /// check), and must not itself be a sub-section — nesting is capped at
    /// one level. On success the parent linkage is written to `target_meta`
    /// (an upsert: a `target_meta` row may already exist for other reasons).
    pub fn region_create_with_parent(
        &self,
        args: RegionCreate,
        parent_region_id: Option<i64>,
    ) -> rusqlite::Result<Region> {
        if let Some(parent_id) = parent_region_id {
            let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
            let parent_piece: Option<i64> = conn
                .query_row(
                    "SELECT piece_id FROM region WHERE id = ?1",
                    [parent_id],
                    |row| row.get(0),
                )
                .optional()?;
            let parent_piece = parent_piece.ok_or_else(|| {
                rusqlite::Error::InvalidParameterName(
                    "the parent section could not be found".into(),
                )
            })?;
            if parent_piece != args.piece_id {
                return Err(rusqlite::Error::InvalidParameterName(
                    "a sub-section's parent must belong to the same piece".into(),
                ));
            }
            let grandparent: Option<i64> = conn
                .query_row(
                    "SELECT parent_region_id FROM target_meta WHERE region_id = ?1",
                    [parent_id],
                    |row| row.get::<_, Option<i64>>(0),
                )
                .optional()?
                .flatten();
            if grandparent.is_some() {
                return Err(rusqlite::Error::InvalidParameterName(
                    "a sub-section cannot itself have sub-sections (only one level of nesting is allowed)"
                        .into(),
                ));
            }
        }
        let mut region = self.region_create(args)?;
        if let Some(parent_id) = parent_region_id {
            let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
            conn.execute(
                "INSERT INTO target_meta (region_id, parent_region_id) VALUES (?1, ?2)
                 ON CONFLICT(region_id) DO UPDATE SET
                     parent_region_id = excluded.parent_region_id,
                     updated_ts = datetime('now')",
                rusqlite::params![region.id, parent_id],
            )?;
            region.parent_region_id = Some(parent_id);
        }
        Ok(region)
    }

    /// Apply a partial patch to a region; appends a `region_change` event.
    pub fn region_update(&self, id: i64, patch: RegionPatch) -> rusqlite::Result<Region> {
        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        let current = Self::region_get(&conn, id)?;
        let mut sets: Vec<String> = Vec::new();
        let mut vals: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        if let Some(v) = patch.name {
            let v = Self::normalized_region_name(v)?;
            sets.push(format!("name = ?{}", vals.len() + 2));
            vals.push(Box::new(v));
        }
        if let Some(v) = patch.notes {
            let v = Self::normalized_region_notes(v)?;
            sets.push(format!("notes = ?{}", vals.len() + 2));
            vals.push(Box::new(v));
        }
        if patch.m_start.is_some() || patch.m_end.is_some() {
            let next_start = patch.m_start.unwrap_or(current.m_start);
            let next_end = patch.m_end.unwrap_or(current.m_end);
            if next_start < 1 || next_end < next_start {
                return Err(rusqlite::Error::InvalidQuery);
            }
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
            if !Self::valid_region_kind(&v) {
                return Err(rusqlite::Error::InvalidQuery);
            }
            sets.push(format!("kind = ?{}", vals.len() + 2));
            vals.push(Box::new(v));
        }
        if let Some(v) = patch.order {
            if v < 0 {
                return Err(rusqlite::Error::InvalidQuery);
            }
            sets.push(format!("sort_order = ?{}", vals.len() + 2));
            vals.push(Box::new(v));
        }
        if let Some(v) = patch.color {
            sets.push(format!("color = ?{}", vals.len() + 2));
            vals.push(Box::new(v));
        }
        if let Some(v) = patch.pdf_anchor {
            sets.push(format!("pdf_anchor = ?{}", vals.len() + 2));
            let raw = v.map(|value| json_to_sql(&value)).transpose()?;
            vals.push(Box::new(raw));
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
    /// Task C5: delete a region that may have children (`target_meta`
    /// `parent_region_id`). `Cascade` deletes every child region too;
    /// `Promote` deletes only this region and clears its children's
    /// `parent_region_id` so they survive as top-level regions. Both paths
    /// are one transaction — all or nothing. When the region has no
    /// children, both modes behave identically to the old unconditional
    /// delete.
    pub fn region_delete_mode(&self, id: i64, mode: RegionDeleteMode) -> rusqlite::Result<()> {
        let mut conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        let piece_id: i64 =
            conn.query_row("SELECT piece_id FROM region WHERE id = ?1", [id], |row| {
                row.get(0)
            })?;
        let children: Vec<i64> = {
            let mut stmt =
                conn.prepare("SELECT region_id FROM target_meta WHERE parent_region_id = ?1")?;
            let rows = stmt.query_map([id], |row| row.get(0))?;
            rows.collect::<rusqlite::Result<Vec<i64>>>()?
        };
        let tx = conn.transaction()?;
        match mode {
            RegionDeleteMode::Promote => {
                if !children.is_empty() {
                    tx.execute(
                        "UPDATE target_meta SET parent_region_id = NULL, updated_ts = datetime('now')
                         WHERE parent_region_id = ?1",
                        [id],
                    )?;
                }
            }
            RegionDeleteMode::Cascade => {
                for child_id in &children {
                    tx.execute(
                        "UPDATE rep_block SET region_id = NULL WHERE region_id = ?1",
                        [child_id],
                    )?;
                    tx.execute(
                        "UPDATE daily_work SET region_id = NULL WHERE region_id = ?1",
                        [child_id],
                    )?;
                    tx.execute("DELETE FROM region WHERE id = ?1", [child_id])?;
                }
            }
        }
        tx.execute(
            "UPDATE rep_block SET region_id = NULL WHERE region_id = ?1",
            [id],
        )?;
        tx.execute(
            "UPDATE daily_work SET region_id = NULL WHERE region_id = ?1",
            [id],
        )?;
        tx.execute("DELETE FROM region WHERE id = ?1", [id])?;
        tx.execute(
            "DELETE FROM tutorial_chapter
             WHERE NOT EXISTS (
               SELECT 1 FROM tutorial_clip WHERE chapter_id=tutorial_chapter.id
             )",
            [],
        )?;
        tx.commit()?;
        Self::append_event_conn(
            &conn,
            EventKind::REGION_CHANGE,
            None,
            Some(piece_id),
            &serde_json::json!({ "action": "delete", "region_id": id, "mode": format!("{mode:?}") }),
        )?;
        Ok(())
    }

    /// Merge `id_absorb` into `id_keep`: `id_keep`'s measure range widens to
    /// cover both, every block belonging to `id_absorb` is reassigned to
    /// `id_keep`, and `id_absorb` is deleted. Runs in one transaction.
    /// Compatible PDF anchors are combined. If both regions have geometry for
    /// the same edition but disagree on its fingerprint, that edition is
    /// dropped rather than retaining a highlight for the wrong score revision.
    /// Appends a `region_change` event.
    pub fn region_merge(&self, id_keep: i64, id_absorb: i64) -> rusqlite::Result<Region> {
        let mut conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        let keep = Self::region_get(&conn, id_keep)?;
        let absorb = Self::region_get(&conn, id_absorb)?;
        if keep.piece_id != absorb.piece_id || keep.id == absorb.id {
            return Err(rusqlite::Error::InvalidQuery);
        }
        let new_start = keep.m_start.min(absorb.m_start);
        let new_end = keep.m_end.max(absorb.m_end);
        let merged_anchor = merge_pdf_anchors(keep.pdf_anchor, absorb.pdf_anchor);
        let merged_anchor_sql = merged_anchor.as_ref().map(json_to_sql).transpose()?;
        let merged_notes = merge_region_notes(keep.notes.as_deref(), absorb.notes.as_deref())?;

        let tx = conn.transaction()?;
        tx.execute(
            "UPDATE rep_block SET region_id = ?1 WHERE region_id = ?2",
            rusqlite::params![id_keep, id_absorb],
        )?;
        tx.execute(
            "UPDATE daily_work SET region_id = ?1 WHERE region_id = ?2",
            rusqlite::params![id_keep, id_absorb],
        )?;
        // Preserve tutorial coverage. If both Regions already point at the
        // same shared chapter, keep the destination link and let the absorbed
        // duplicate cascade away with its Region.
        tx.execute(
            "UPDATE OR IGNORE tutorial_clip SET region_id = ?1 WHERE region_id = ?2",
            rusqlite::params![id_keep, id_absorb],
        )?;
        tx.execute(
            "UPDATE region SET m_start = ?2, m_end = ?3, pdf_anchor = ?4, notes = ?5 WHERE id = ?1",
            rusqlite::params![id_keep, new_start, new_end, merged_anchor_sql, merged_notes],
        )?;
        tx.execute("DELETE FROM region WHERE id = ?1", [id_absorb])?;
        tx.execute(
            "DELETE FROM tutorial_chapter
             WHERE NOT EXISTS (
               SELECT 1 FROM tutorial_clip WHERE chapter_id=tutorial_chapter.id
             )",
            [],
        )?;
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

    /// Split one Region before `split_at` as one transaction. Printed score
    /// geometry cannot be divided safely from a measure number alone, so both
    /// halves deliberately require remapping after the UI's explicit warning.
    pub fn region_split(&self, id: i64, split_at: u32) -> rusqlite::Result<Vec<Region>> {
        let mut conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        let current = Self::region_get(&conn, id)?;
        if split_at <= current.m_start || split_at > current.m_end {
            return Err(rusqlite::Error::InvalidQuery);
        }
        let suffix = " · part 2";
        let keep_chars = 500usize.saturating_sub(suffix.chars().count());
        let second_name = format!(
            "{}{}",
            current.name.chars().take(keep_chars).collect::<String>(),
            suffix
        );

        let tx = conn.transaction()?;
        tx.execute(
            "UPDATE region SET sort_order = sort_order + 1
             WHERE piece_id = ?1 AND sort_order > ?2",
            rusqlite::params![current.piece_id, current.order],
        )?;
        let second_id: i64 = tx.query_row(
            "INSERT INTO region
                 (piece_id,name,m_start,m_end,kind,sort_order,color,pdf_anchor,notes)
             VALUES (?1,?2,?3,?4,?5,?6,?7,NULL,?8)
             RETURNING id",
            rusqlite::params![
                current.piece_id,
                second_name,
                split_at,
                current.m_end,
                current.kind,
                current.order + 1,
                current.color,
                current.notes,
            ],
            |row| row.get(0),
        )?;
        tx.execute(
            "UPDATE region SET m_end = ?2, pdf_anchor = NULL WHERE id = ?1",
            rusqlite::params![id, split_at - 1],
        )?;
        tx.execute(
            "UPDATE daily_work SET region_id = ?2
             WHERE region_id = ?1 AND block_id IN (
                 SELECT id FROM rep_block WHERE region_id = ?1 AND m_start >= ?3
             )",
            rusqlite::params![id, second_id, split_at],
        )?;
        let moved_blocks = tx.execute(
            "UPDATE rep_block SET region_id = ?2
             WHERE region_id = ?1 AND m_start >= ?3",
            rusqlite::params![id, second_id, split_at],
        )?;
        Self::append_event_conn(
            &tx,
            EventKind::REGION_CHANGE,
            None,
            Some(current.piece_id),
            &serde_json::json!({
                "action": "split",
                "original": id,
                "created": second_id,
                "split_at": split_at,
                "moved_blocks": moved_blocks,
                "score_annotations_cleared": true,
            }),
        )?;
        let first = Self::region_get(&tx, id)?;
        let second = Self::region_get(&tx, second_id)?;
        tx.commit()?;
        Ok(vec![first, second])
    }
}

/// Preserve both detailed instructions when organizational Regions are merged.
/// Refuse an over-limit merge instead of silently truncating the user's text.
fn merge_region_notes(
    keep: Option<&str>,
    absorb: Option<&str>,
) -> rusqlite::Result<Option<String>> {
    let merged = match (
        keep.filter(|value| !value.trim().is_empty()),
        absorb.filter(|value| !value.trim().is_empty()),
    ) {
        (None, None) => None,
        (Some(value), None) | (None, Some(value)) => Some(value.trim().to_string()),
        (Some(left), Some(right)) if left.trim() == right.trim() => Some(left.trim().to_string()),
        (Some(left), Some(right)) => Some(format!("{}\n\n{}", left.trim(), right.trim())),
    };
    if merged
        .as_ref()
        .is_some_and(|value| value.chars().count() > 10_000)
    {
        return Err(rusqlite::Error::InvalidQuery);
    }
    Ok(merged)
}

/// Merge the P4 anchor contract without guessing across changed PDF editions.
/// Unknown/malformed values are treated conservatively: keep-side data wins.
fn merge_pdf_anchors(
    keep: Option<serde_json::Value>,
    absorb: Option<serde_json::Value>,
) -> Option<serde_json::Value> {
    let (mut keep, absorb) = match (keep, absorb) {
        (Some(keep), Some(absorb)) => (keep, absorb),
        (keep, absorb) => return keep.or(absorb),
    };

    let Some(keep_editions) = keep.get_mut("editions").and_then(|v| v.as_object_mut()) else {
        return Some(keep);
    };
    let Some(absorb_editions) = absorb.get("editions").and_then(|v| v.as_object()) else {
        return Some(keep);
    };

    for (edition_id, absorb_edition) in absorb_editions {
        let Some(keep_edition) = keep_editions.get_mut(edition_id) else {
            keep_editions.insert(edition_id.clone(), absorb_edition.clone());
            continue;
        };

        let fingerprints_match =
            keep_edition.get("fingerprint") == absorb_edition.get("fingerprint");
        if !fingerprints_match {
            keep_editions.remove(edition_id);
            continue;
        }

        let Some(keep_rects) = keep_edition.get_mut("rects").and_then(|v| v.as_array_mut()) else {
            continue;
        };
        let Some(absorb_rects) = absorb_edition.get("rects").and_then(|v| v.as_array()) else {
            continue;
        };
        for rect in absorb_rects {
            if !keep_rects.contains(rect) {
                keep_rects.push(rect.clone());
            }
        }
    }

    Some(keep)
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
            .region_create(RegionCreate {
                piece_id: 1,
                name: "A".into(),
                notes: None,
                m_start: 1,
                m_end: 8,
                kind: "section".into(),
            })
            .unwrap();
        let b = s
            .region_create(RegionCreate {
                piece_id: 1,
                name: "B".into(),
                notes: None,
                m_start: 20,
                m_end: 28,
                kind: "section".into(),
            })
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
            conn.query_row(
                "SELECT region_id FROM rep_block WHERE id = ?1",
                [bid],
                |r| r.get(0),
            )
            .unwrap()
        };
        assert_eq!(region_id, Some(a.id));
    }

    #[test]
    fn region_merge_combines_compatible_pdf_anchors() {
        let s = Store::open(":memory:").unwrap();
        seed_piece(&s, 1);
        let a = s
            .region_create(RegionCreate {
                piece_id: 1,
                name: "A".into(),
                notes: None,
                m_start: 1,
                m_end: 8,
                kind: "section".into(),
            })
            .unwrap();
        let b = s
            .region_create(RegionCreate {
                piece_id: 1,
                name: "B".into(),
                notes: None,
                m_start: 9,
                m_end: 16,
                kind: "section".into(),
            })
            .unwrap();
        let rect_a = serde_json::json!({ "page": 1, "x": 0.1, "y": 0.2, "w": 0.3, "h": 0.1 });
        let rect_b = serde_json::json!({ "page": 2, "x": 0.1, "y": 0.2, "w": 0.3, "h": 0.1 });
        let anchor_a = serde_json::json!({ "v": 1, "editions": { "score.pdf": { "fingerprint": "same", "rects": [rect_a.clone()] } } });
        let anchor_b = serde_json::json!({ "v": 1, "editions": { "score.pdf": { "fingerprint": "same", "rects": [rect_a, rect_b.clone()] } } });
        s.region_update(
            a.id,
            RegionPatch {
                pdf_anchor: Some(Some(anchor_a)),
                ..Default::default()
            },
        )
        .unwrap();
        s.region_update(
            b.id,
            RegionPatch {
                pdf_anchor: Some(Some(anchor_b)),
                ..Default::default()
            },
        )
        .unwrap();

        let merged = s.region_merge(a.id, b.id).unwrap();
        let rects = merged.pdf_anchor.unwrap()["editions"]["score.pdf"]["rects"]
            .as_array()
            .unwrap()
            .clone();
        assert_eq!(rects.len(), 2);
        assert!(rects.contains(&rect_b));
    }

    #[test]
    fn region_merge_drops_anchor_for_conflicting_fingerprint() {
        let s = Store::open(":memory:").unwrap();
        seed_piece(&s, 1);
        let a = s
            .region_create(RegionCreate {
                piece_id: 1,
                name: "A".into(),
                notes: None,
                m_start: 1,
                m_end: 8,
                kind: "section".into(),
            })
            .unwrap();
        let b = s
            .region_create(RegionCreate {
                piece_id: 1,
                name: "B".into(),
                notes: None,
                m_start: 9,
                m_end: 16,
                kind: "section".into(),
            })
            .unwrap();
        for (region, fingerprint) in [(a.id, "old"), (b.id, "new")] {
            let anchor = serde_json::json!({ "v": 1, "editions": { "score.pdf": { "fingerprint": fingerprint, "rects": [{ "page": 1, "x": 0.1, "y": 0.2, "w": 0.3, "h": 0.1 }] } } });
            s.region_update(
                region,
                RegionPatch {
                    pdf_anchor: Some(Some(anchor)),
                    ..Default::default()
                },
            )
            .unwrap();
        }

        let merged = s.region_merge(a.id, b.id).unwrap();
        assert!(merged.pdf_anchor.unwrap()["editions"]
            .as_object()
            .unwrap()
            .is_empty());
    }

    #[test]
    fn region_delete_nulls_member_blocks_but_keeps_them() {
        let s = Store::open(":memory:").unwrap();
        seed_piece(&s, 1);
        let r = s
            .region_create(RegionCreate {
                piece_id: 1,
                name: "A".into(),
                notes: None,
                m_start: 1,
                m_end: 8,
                kind: "section".into(),
            })
            .unwrap();
        let bid = seed_block(&s, 1, 1, 8);
        s.block_set_region(bid, Some(r.id)).unwrap();
        s.region_delete_mode(r.id, RegionDeleteMode::Cascade)
            .unwrap();
        assert!(s.region_list(1).unwrap().is_empty());
        let region_id: Option<i64> = {
            let conn = s_conn(&s);
            conn.query_row(
                "SELECT region_id FROM rep_block WHERE id = ?1",
                [bid],
                |r| r.get(0),
            )
            .unwrap()
        };
        assert_eq!(region_id, None, "block kept but region unlinked");
        assert!(
            s.block_row(bid).unwrap().is_some(),
            "block itself still exists"
        );
    }

    #[test]
    fn region_delete_and_merge_keep_calendar_work_valid() {
        use crate::store::model::DailyWorkCreate;

        let s = Store::open(":memory:").unwrap();
        seed_piece(&s, 1);
        let keep = s
            .region_create(RegionCreate {
                piece_id: 1,
                name: "Keep".into(),
                notes: None,
                m_start: 1,
                m_end: 8,
                kind: "section".into(),
            })
            .unwrap();
        let absorb = s
            .region_create(RegionCreate {
                piece_id: 1,
                name: "Absorb".into(),
                notes: None,
                m_start: 9,
                m_end: 16,
                kind: "section".into(),
            })
            .unwrap();
        let remove = s
            .region_create(RegionCreate {
                piece_id: 1,
                name: "Remove".into(),
                notes: None,
                m_start: 17,
                m_end: 24,
                kind: "section".into(),
            })
            .unwrap();
        let goal = s
            .goal_create(GoalCreate {
                piece_id: 1,
                text: "Goal".into(),
                kind: "big".into(),
                parent_goal_id: None,
                target_date: None,
            })
            .unwrap();
        for (region_id, title) in [(absorb.id, "Merge me"), (remove.id, "Unlink me")] {
            s.daily_work_create(DailyWorkCreate {
                goal_id: goal.id,
                region_id: Some(region_id),
                block_id: None,
                title: title.into(),
                minutes: 10,
                date: "2026-07-13".into(),
                source: "manual".into(),
            })
            .unwrap();
        }

        s.region_merge(keep.id, absorb.id).unwrap();
        s.region_delete_mode(remove.id, RegionDeleteMode::Cascade)
            .unwrap();
        let work = s.daily_work_list("2026-07-13", "2026-07-13", None).unwrap();
        assert_eq!(
            work.iter()
                .find(|item| item.title == "Merge me")
                .unwrap()
                .region_id,
            Some(keep.id)
        );
        assert_eq!(
            work.iter()
                .find(|item| item.title == "Unlink me")
                .unwrap()
                .region_id,
            None
        );
    }

    #[test]
    fn region_split_is_atomic_and_moves_only_later_blocks() {
        use crate::store::model::DailyWorkCreate;

        let s = Store::open(":memory:").unwrap();
        seed_piece(&s, 1);
        let region = s
            .region_create(RegionCreate {
                piece_id: 1,
                name: "Phrase".into(),
                notes: Some("Rotate instead of reaching".into()),
                m_start: 1,
                m_end: 12,
                kind: "section".into(),
            })
            .unwrap();
        let early = seed_block(&s, 1, 1, 4);
        let late = seed_block(&s, 1, 7, 12);
        s.block_set_region(early, Some(region.id)).unwrap();
        s.block_set_region(late, Some(region.id)).unwrap();
        let goal = s
            .goal_create(GoalCreate {
                piece_id: 1,
                text: "Goal".into(),
                kind: "big".into(),
                parent_goal_id: None,
                target_date: None,
            })
            .unwrap();
        s.daily_work_create(DailyWorkCreate {
            goal_id: goal.id,
            region_id: Some(region.id),
            block_id: Some(late),
            title: "Later half".into(),
            minutes: 10,
            date: "2026-07-13".into(),
            source: "manual".into(),
        })
        .unwrap();
        {
            let conn = s_conn(&s);
            conn.execute_batch(
                "CREATE TRIGGER fail_region_split BEFORE UPDATE OF region_id ON rep_block
                 BEGIN SELECT RAISE(ABORT,'injected split failure'); END;",
            )
            .unwrap();
        }
        assert!(s.region_split(region.id, 7).is_err());
        let unchanged = s.region_list(1).unwrap();
        assert_eq!(unchanged.len(), 1);
        assert_eq!((unchanged[0].m_start, unchanged[0].m_end), (1, 12));
        {
            let conn = s_conn(&s);
            conn.execute_batch("DROP TRIGGER fail_region_split;")
                .unwrap();
        }

        let halves = s.region_split(region.id, 7).unwrap();
        assert_eq!((halves[0].m_start, halves[0].m_end), (1, 6));
        assert_eq!((halves[1].m_start, halves[1].m_end), (7, 12));
        assert_eq!(
            halves[0].notes.as_deref(),
            Some("Rotate instead of reaching")
        );
        assert_eq!(
            halves[1].notes.as_deref(),
            Some("Rotate instead of reaching")
        );
        assert_eq!(
            s.block_row(early).unwrap().unwrap().region_id,
            Some(halves[0].id)
        );
        assert_eq!(
            s.block_row(late).unwrap().unwrap().region_id,
            Some(halves[1].id)
        );
        let work = s.daily_work_list("2026-07-13", "2026-07-13", None).unwrap();
        assert_eq!(work[0].region_id, Some(halves[1].id));
    }

    #[test]
    fn region_update_applies_partial_patch() {
        let s = Store::open(":memory:").unwrap();
        seed_piece(&s, 1);
        let r = s
            .region_create(RegionCreate {
                piece_id: 1,
                name: "A".into(),
                notes: None,
                m_start: 1,
                m_end: 8,
                kind: "section".into(),
            })
            .unwrap();
        let updated = s
            .region_update(
                r.id,
                RegionPatch {
                    name: Some("Intro".into()),
                    color: Some(Some("#fff".into())),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(updated.name, "Intro");
        assert_eq!(updated.color.as_deref(), Some("#fff"));
        assert_eq!(updated.m_start, 1, "untouched field unchanged");

        // Some(None) clears color.
        let cleared = s
            .region_update(
                r.id,
                RegionPatch {
                    color: Some(None),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(cleared.color, None);

        let with_notes = s
            .region_update(
                r.id,
                RegionPatch {
                    notes: Some(Some("  Keep the wrist loose  ".into())),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(
            with_notes.name, "Intro",
            "notes do not overwrite the header"
        );
        assert_eq!(with_notes.notes.as_deref(), Some("Keep the wrist loose"));
        let notes_cleared = s
            .region_update(
                r.id,
                RegionPatch {
                    notes: Some(None),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(notes_cleared.notes, None);

        let anchor = serde_json::json!({
            "v": 1,
            "editions": {"score/urtext.pdf": {"fingerprint": "abc", "rects": [
                {"page": 2, "x": 0.1, "y": 0.2, "w": 0.3, "h": 0.1}
            ]}}
        });
        let anchored = s
            .region_update(
                r.id,
                RegionPatch {
                    pdf_anchor: Some(Some(anchor.clone())),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(anchored.pdf_anchor, Some(anchor));
        let cleared = s
            .region_update(
                r.id,
                RegionPatch {
                    pdf_anchor: Some(None),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(cleared.pdf_anchor, None);
    }

    #[test]
    fn region_create_and_measure_edits_reject_invalid_canonical_fields() {
        let s = Store::open(":memory:").unwrap();
        seed_piece(&s, 1);
        for args in [
            RegionCreate {
                piece_id: 1,
                name: "   ".into(),
                notes: None,
                m_start: 1,
                m_end: 8,
                kind: "section".into(),
            },
            RegionCreate {
                piece_id: 1,
                name: "zero".into(),
                notes: None,
                m_start: 0,
                m_end: 8,
                kind: "section".into(),
            },
            RegionCreate {
                piece_id: 1,
                name: "backwards".into(),
                notes: None,
                m_start: 8,
                m_end: 1,
                kind: "section".into(),
            },
            RegionCreate {
                piece_id: 1,
                name: "unknown".into(),
                notes: None,
                m_start: 1,
                m_end: 8,
                kind: "mystery".into(),
            },
        ] {
            assert!(s.region_create(args).is_err());
        }

        let region = s
            .region_create(RegionCreate {
                piece_id: 1,
                name: "  Canonical note  ".into(),
                notes: None,
                m_start: 1,
                m_end: 8,
                kind: "hard_spot".into(),
            })
            .unwrap();
        assert_eq!(region.name, "Canonical note");
        assert!(s
            .region_update(
                region.id,
                RegionPatch {
                    m_start: Some(9),
                    ..Default::default()
                }
            )
            .is_err());
        assert!(s
            .region_update(
                region.id,
                RegionPatch {
                    name: Some("".into()),
                    ..Default::default()
                }
            )
            .is_err());
    }

    #[test]
    fn pdf_anchor_save_clear_survives_reopen() {
        let td = tempfile::TempDir::new().unwrap();
        let db = td.path().join("codakiller.db");
        let anchor = serde_json::json!({
            "v": 1,
            "editions": {"score/urtext.pdf": {"fingerprint": "5-a", "rects": [
                {"page": 1, "x": 0.2, "y": 0.3, "w": 0.4, "h": 0.1}
            ]}}
        });

        let region_id = {
            let store = Store::open(&db).unwrap();
            seed_piece(&store, 1);
            let region = store
                .region_create(RegionCreate {
                    piece_id: 1,
                    name: "Intro".into(),
                    notes: None,
                    m_start: 1,
                    m_end: 8,
                    kind: "section".into(),
                })
                .unwrap();
            store
                .region_update(
                    region.id,
                    RegionPatch {
                        pdf_anchor: Some(Some(anchor.clone())),
                        ..Default::default()
                    },
                )
                .unwrap();
            region.id
        };
        {
            let reopened = Store::open(&db).unwrap();
            let region = reopened.region_list(1).unwrap().remove(0);
            assert_eq!(region.id, region_id);
            assert_eq!(region.pdf_anchor, Some(anchor));
            reopened
                .region_update(
                    region_id,
                    RegionPatch {
                        pdf_anchor: Some(None),
                        ..Default::default()
                    },
                )
                .unwrap();
        }
        let reopened = Store::open(&db).unwrap();
        assert_eq!(reopened.region_list(1).unwrap()[0].pdf_anchor, None);
    }

    #[test]
    fn region_list_orders_by_sort_order() {
        let s = Store::open(":memory:").unwrap();
        seed_piece(&s, 1);
        let a = s
            .region_create(RegionCreate {
                piece_id: 1,
                name: "A".into(),
                notes: None,
                m_start: 1,
                m_end: 8,
                kind: "section".into(),
            })
            .unwrap();
        let b = s
            .region_create(RegionCreate {
                piece_id: 1,
                name: "B".into(),
                notes: None,
                m_start: 9,
                m_end: 16,
                kind: "section".into(),
            })
            .unwrap();
        s.region_update(
            a.id,
            RegionPatch {
                order: Some(5),
                ..Default::default()
            },
        )
        .unwrap();
        let ids: Vec<i64> = s
            .region_list(1)
            .unwrap()
            .into_iter()
            .map(|r| r.id)
            .collect();
        assert_eq!(ids, vec![b.id, a.id]);
    }

    // ── Task C5: sub-sections via target_meta.parent_region_id ─────────────

    fn create_region(s: &Store, piece_id: i64, name: &str, m_start: u32, m_end: u32) -> Region {
        s.region_create(RegionCreate {
            piece_id,
            name: name.into(),
            notes: None,
            m_start,
            m_end,
            kind: "hard_spot".into(),
        })
        .unwrap()
    }

    #[test]
    fn region_create_with_parent_links_child_and_region_list_carries_it() {
        let s = Store::open(":memory:").unwrap();
        seed_piece(&s, 1);
        let parent = create_region(&s, 1, "Exposition", 1, 40);
        let child = s
            .region_create_with_parent(
                RegionCreate {
                    piece_id: 1,
                    name: "Sticky run".into(),
                    notes: None,
                    m_start: 10,
                    m_end: 14,
                    kind: "hard_spot".into(),
                },
                Some(parent.id),
            )
            .unwrap();
        assert_eq!(child.parent_region_id, Some(parent.id));
        let listed = s.region_list(1).unwrap();
        let listed_child = listed.iter().find(|r| r.id == child.id).unwrap();
        assert_eq!(listed_child.parent_region_id, Some(parent.id));
        let listed_parent = listed.iter().find(|r| r.id == parent.id).unwrap();
        assert_eq!(
            listed_parent.parent_region_id, None,
            "the parent itself is still top-level"
        );
    }

    #[test]
    fn region_create_with_parent_rejects_a_missing_parent() {
        let s = Store::open(":memory:").unwrap();
        seed_piece(&s, 1);
        let err = s
            .region_create_with_parent(
                RegionCreate {
                    piece_id: 1,
                    name: "Orphan".into(),
                    notes: None,
                    m_start: 1,
                    m_end: 4,
                    kind: "hard_spot".into(),
                },
                Some(999),
            )
            .unwrap_err();
        assert!(
            err.to_string().contains("could not be found"),
            "expected a friendly not-found message, got: {err}"
        );
        assert!(
            s.region_list(1).unwrap().is_empty(),
            "no region should have been created"
        );
    }

    #[test]
    fn region_create_with_parent_rejects_cross_piece_parent() {
        let s = Store::open(":memory:").unwrap();
        seed_piece(&s, 1);
        seed_piece(&s, 2);
        let parent_in_piece_1 = create_region(&s, 1, "Section A", 1, 20);
        let err = s
            .region_create_with_parent(
                RegionCreate {
                    piece_id: 2,
                    name: "Cross-piece child".into(),
                    notes: None,
                    m_start: 1,
                    m_end: 4,
                    kind: "hard_spot".into(),
                },
                Some(parent_in_piece_1.id),
            )
            .unwrap_err();
        assert!(
            err.to_string().contains("same piece"),
            "expected a friendly same-piece message, got: {err}"
        );
        assert!(s.region_list(2).unwrap().is_empty());
    }

    #[test]
    fn region_create_with_parent_rejects_nesting_beyond_one_level() {
        let s = Store::open(":memory:").unwrap();
        seed_piece(&s, 1);
        let grandparent = create_region(&s, 1, "Movement I", 1, 100);
        let parent = s
            .region_create_with_parent(
                RegionCreate {
                    piece_id: 1,
                    name: "Development".into(),
                    notes: None,
                    m_start: 30,
                    m_end: 60,
                    kind: "hard_spot".into(),
                },
                Some(grandparent.id),
            )
            .unwrap();
        let err = s
            .region_create_with_parent(
                RegionCreate {
                    piece_id: 1,
                    name: "Too deep".into(),
                    notes: None,
                    m_start: 35,
                    m_end: 40,
                    kind: "hard_spot".into(),
                },
                Some(parent.id),
            )
            .unwrap_err();
        assert!(
            err.to_string().contains("only one level of nesting"),
            "expected a friendly one-level-nesting message, got: {err}"
        );
    }

    /// Backstop check: even bypassing the Rust validation entirely (raw SQL,
    /// as if some other code path forgot to call it), the `target_meta`
    /// same-piece trigger still rejects a cross-piece parent link.
    #[test]
    fn target_meta_same_piece_trigger_still_fires_as_a_backstop() {
        let s = Store::open(":memory:").unwrap();
        seed_piece(&s, 1);
        seed_piece(&s, 2);
        let parent_in_piece_1 = create_region(&s, 1, "Section A", 1, 20);
        let child_in_piece_2 = create_region(&s, 2, "Unrelated", 1, 8);
        let conn = s_conn(&s);
        let result = conn.execute(
            "INSERT INTO target_meta (region_id, parent_region_id) VALUES (?1, ?2)",
            rusqlite::params![child_in_piece_2.id, parent_in_piece_1.id],
        );
        assert!(
            result.is_err(),
            "the DB trigger must reject a cross-piece parent even without app-level validation"
        );
    }

    #[test]
    fn region_delete_cascade_removes_children_transactionally() {
        let s = Store::open(":memory:").unwrap();
        seed_piece(&s, 1);
        let parent = create_region(&s, 1, "Parent", 1, 40);
        let child_a = s
            .region_create_with_parent(
                RegionCreate {
                    piece_id: 1,
                    name: "Child A".into(),
                    notes: None,
                    m_start: 1,
                    m_end: 8,
                    kind: "hard_spot".into(),
                },
                Some(parent.id),
            )
            .unwrap();
        let child_b = s
            .region_create_with_parent(
                RegionCreate {
                    piece_id: 1,
                    name: "Child B".into(),
                    notes: None,
                    m_start: 9,
                    m_end: 16,
                    kind: "hard_spot".into(),
                },
                Some(parent.id),
            )
            .unwrap();
        s.region_delete_mode(parent.id, RegionDeleteMode::Cascade)
            .unwrap();
        let remaining = s.region_list(1).unwrap();
        assert!(
            remaining.is_empty(),
            "parent and both children must be gone"
        );
        // Prove atomicity by re-checking through a fresh read (not just the
        // in-memory return value): none of the three ids exist any more.
        let conn = s_conn(&s);
        for id in [parent.id, child_a.id, child_b.id] {
            let count: i64 = conn
                .query_row("SELECT COUNT(*) FROM region WHERE id = ?1", [id], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(count, 0, "region {id} should be deleted");
        }
        // The FK cascade is the mechanism, but pin the `target_meta` state
        // directly rather than inferring it from `region_list`: both children's
        // linkage rows must be gone, and nothing may linger for this parent.
        for id in [child_a.id, child_b.id] {
            let count: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM target_meta WHERE region_id = ?1",
                    [id],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(count, 0, "target_meta row for region {id} should be gone");
        }
        let orphans: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM target_meta WHERE parent_region_id = ?1",
                [parent.id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            orphans, 0,
            "no target_meta row may still point at the parent"
        );
        let total: i64 = conn
            .query_row("SELECT COUNT(*) FROM target_meta", [], |row| row.get(0))
            .unwrap();
        assert_eq!(total, 0, "cascade must leave no target_meta rows behind");
    }

    #[test]
    fn region_delete_promote_keeps_children_as_top_level() {
        let s = Store::open(":memory:").unwrap();
        seed_piece(&s, 1);
        let parent = create_region(&s, 1, "Parent", 1, 40);
        let child = s
            .region_create_with_parent(
                RegionCreate {
                    piece_id: 1,
                    name: "Child".into(),
                    notes: None,
                    m_start: 1,
                    m_end: 8,
                    kind: "hard_spot".into(),
                },
                Some(parent.id),
            )
            .unwrap();
        s.region_delete_mode(parent.id, RegionDeleteMode::Promote)
            .unwrap();
        let remaining = s.region_list(1).unwrap();
        assert_eq!(remaining.len(), 1, "only the child should survive");
        assert_eq!(remaining[0].id, child.id);
        assert_eq!(
            remaining[0].parent_region_id, None,
            "the surviving child must be promoted to top-level"
        );
        // Pin the `target_meta` state directly: promote must KEEP the child's
        // linkage row (unlike cascade) and only null out its parent pointer.
        let conn = s_conn(&s);
        let rows: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM target_meta WHERE region_id = ?1",
                [child.id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(rows, 1, "the child's target_meta row must survive promote");
        let parent_ref: Option<i64> = conn
            .query_row(
                "SELECT parent_region_id FROM target_meta WHERE region_id = ?1",
                [child.id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            parent_ref, None,
            "the surviving target_meta row must have parent_region_id = NULL"
        );
        let dangling: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM target_meta WHERE parent_region_id = ?1",
                [parent.id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            dangling, 0,
            "no target_meta row may still point at the parent"
        );
    }

    /// Task C5's "come back later" requirement: a child region's retention
    /// check must route through the EXISTING retention/snooze queue exactly
    /// as it does for a top-level region today — zero new engine code. The
    /// `retention_check` row only ever references `region_id`; it has no
    /// idea whether that region is a sub-section, so this is provable by
    /// simply exercising the existing command against a child region's
    /// check and confirming it behaves the same.
    #[test]
    fn retention_snooze_works_identically_for_a_child_region_set() {
        let s = Store::open(":memory:").unwrap();
        seed_piece(&s, 1);
        let parent = create_region(&s, 1, "Parent", 1, 40);
        let child = s
            .region_create_with_parent(
                RegionCreate {
                    piece_id: 1,
                    name: "Child".into(),
                    notes: None,
                    m_start: 1,
                    m_end: 8,
                    kind: "hard_spot".into(),
                },
                Some(parent.id),
            )
            .unwrap();
        s.test_seed_retention_check(child.id, "2026-07-16", "{}");
        let check_id: i64 = {
            let conn = s_conn(&s);
            conn.query_row(
                "SELECT id FROM retention_check WHERE region_id = ?1",
                [child.id],
                |row| row.get(0),
            )
            .unwrap()
        };
        let receipt = s
            .retention_snooze(
                None,
                check_id,
                "2026-07-20",
                MutationSource::UserClick,
                "child-snooze-1",
                "2026-07-16T00:00:00Z",
            )
            .unwrap();
        let value = receipt.value.unwrap();
        assert_eq!(value.due_date, "2026-07-20");
        assert_eq!(value.original_due_date, "2026-07-16");
    }
}
// ── T4: Block update/delete ─────────────────────────────────────────────────

impl Store {
    /// Historical set rows are immutable compatibility evidence. Range, tempo,
    /// contract, and target repairs must land as reviewed additive sidecars or a
    /// linked restart; this legacy endpoint therefore rejects every physical
    /// update, including migration-era rows.
    pub fn block_update(
        &self,
        block_id: i64,
        _patch: BlockPatch,
    ) -> rusqlite::Result<super::model::BlockHistory> {
        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        conn.query_row(
            "SELECT 1 FROM rep_block WHERE id=?1",
            [block_id],
            |_| Ok(()),
        )?;
        Err(rusqlite::Error::InvalidParameterName(
            "practice-set history is immutable; use attempt corrections or restart a set".into(),
        ))
    }

    /// No history set may be physically deleted. Attempts remain repairable via
    /// append-only adjustments; sets can be closed/restarted, never erased.
    pub fn block_delete(&self, block_id: i64) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        conn.query_row(
            "SELECT 1 FROM rep_block WHERE id=?1",
            [block_id],
            |_| Ok(()),
        )?;
        Err(rusqlite::Error::InvalidParameterName(
            "practice-set history is immutable; close or restart instead".into(),
        ))
    }
}
// ── T4: block tests ──────────────────────────────────────────────────────

#[cfg(test)]
mod block {
    use super::test_support::{seed_block, seed_piece, seed_rep};
    use super::*;
    use crate::store::Store;

    #[test]
    fn block_delete_rejects_and_preserves_exact_set_and_attempt_rows() {
        let s = Store::open(":memory:").unwrap();
        seed_piece(&s, 1);
        let bid = seed_block(&s, 1, 1, 8);
        seed_rep(&s, bid, "clean");
        seed_rep(&s, bid, "flawed");
        let block_before = serde_json::to_string(&s.block_row(bid).unwrap()).unwrap();
        let reps_before = serde_json::to_string(&s.reps_for_block(bid).unwrap()).unwrap();

        let error = s.block_delete(bid).unwrap_err().to_string();
        assert!(error.contains("immutable"), "{error}");
        assert_eq!(
            serde_json::to_string(&s.block_row(bid).unwrap()).unwrap(),
            block_before
        );
        assert_eq!(
            serde_json::to_string(&s.reps_for_block(bid).unwrap()).unwrap(),
            reps_before
        );
        assert_eq!(
            s.test_scalar_i64("SELECT count(*) FROM rep_block").unwrap(),
            1
        );
        assert_eq!(s.test_scalar_i64("SELECT count(*) FROM rep").unwrap(), 2);
    }

    #[test]
    fn block_update_rejects_and_preserves_exact_legacy_set_row() {
        let s = Store::open(":memory:").unwrap();
        seed_piece(&s, 1);
        let bid = seed_block(&s, 1, 1, 8);
        let before = serde_json::to_string(&s.block_row(bid).unwrap()).unwrap();
        let error = s
            .block_update(
                bid,
                BlockPatch {
                    label: Some(Some("legato".into())),
                    target_bpm: Some(Some(120.0)),
                    ..Default::default()
                },
            )
            .unwrap_err()
            .to_string();
        assert!(error.contains("immutable"), "{error}");
        assert_eq!(
            serde_json::to_string(&s.block_row(bid).unwrap()).unwrap(),
            before
        );
        assert_eq!(
            s.test_scalar_i64("SELECT count(*) FROM rep_block").unwrap(),
            1
        );
    }
}
// ── T5: Rep update/delete with verdict-count recompute ─────────────────────

impl Store {
    /// Apply a partial patch to one rep (verdict replace, nullable note);
    /// appends a `rep_edit` event. Counts are derived live on read (see
    /// `block_row`), so no counter needs updating here.
    /// Returns the owning `block_id` so the command layer can resync the rep
    /// engine's active snapshot without a second lookup.
    pub fn rep_update(&self, rep_id: i64, patch: RepPatch) -> rusqlite::Result<i64> {
        let block_id = self.v2_block_id_for_attempt(rep_id)?;
        let current = self.v2_effective_attempt(block_id, rep_id)?;
        let verdict_text = patch.verdict.unwrap_or(current.verdict);
        let verdict = RepVerdict::parse(&verdict_text)
            .ok_or_else(|| rusqlite::Error::InvalidParameterName("unknown verdict".into()))?;
        let replace_note = patch.note.is_some();
        let note = patch.note.flatten();
        let keep_open = self
            .v2_snapshot(block_id, DemotionConfig::default())
            .map(|snapshot| matches!(snapshot.set_state.as_str(), "active" | "paused"))
            .unwrap_or(false);
        let command_id =
            super::practice_v2::command_id(MutationSource::UserClick, "history_correct");
        self.v2_correct(
            None,
            block_id,
            Some(rep_id),
            verdict,
            note.as_deref(),
            replace_note,
            MutationSource::UserClick,
            &command_id,
            keep_open,
            None,
            DemotionConfig::default(),
        )?;
        Ok(block_id)
    }

    /// Preserve the rep and append a void adjustment. The legacy command name
    /// remains usable, but no source attempt row is deleted.
    pub fn rep_delete(&self, rep_id: i64) -> rusqlite::Result<i64> {
        let block_id = self.v2_block_id_for_attempt(rep_id)?;
        let keep_open = self
            .v2_snapshot(block_id, DemotionConfig::default())
            .map(|snapshot| matches!(snapshot.set_state.as_str(), "active" | "paused"))
            .unwrap_or(false);
        let command_id = super::practice_v2::command_id(MutationSource::UserClick, "history_void");
        self.v2_void_history_attempt(
            block_id,
            rep_id,
            MutationSource::UserClick,
            &command_id,
            keep_open,
            DemotionConfig::default(),
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
        s.rep_update(
            r1,
            RepPatch {
                verdict: Some("clean".into()),
                note: None,
            },
        )
        .unwrap();
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
             FROM goal WHERE piece_id = ?1 ORDER BY sort_order, id",
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

    /// Create a root `big` goal or one `sub` goal beneath a same-piece root.
    /// Ordering is sibling-local and mutation + event append commit atomically.
    pub fn goal_create(&self, args: GoalCreate) -> rusqlite::Result<Goal> {
        let text = args.text.trim();
        if text.is_empty()
            || text.chars().count() > 500
            || !matches!(args.kind.as_str(), "big" | "sub")
            || args
                .target_date
                .as_deref()
                .is_some_and(|date| !crate::date::is_valid(date))
            || (args.kind == "big" && args.parent_goal_id.is_some())
            || (args.kind == "sub" && args.parent_goal_id.is_none())
        {
            return Err(rusqlite::Error::InvalidQuery);
        }
        let mut conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        let tx = conn.transaction()?;
        if let Some(parent_id) = args.parent_goal_id {
            let parent = Self::goal_get(&tx, parent_id)?;
            if parent.piece_id != args.piece_id
                || parent.kind != "big"
                || parent.parent_goal_id.is_some()
            {
                return Err(rusqlite::Error::InvalidQuery);
            }
        }
        let id: i64 = tx.query_row(
            "INSERT INTO goal (piece_id, text, kind, parent_goal_id, target_date, sort_order)
             VALUES (?1, ?2, ?3, ?4, ?5,
                 COALESCE((SELECT MAX(sort_order) + 1 FROM goal
                           WHERE piece_id = ?1 AND parent_goal_id IS ?4), 0))
             RETURNING id",
            rusqlite::params![
                args.piece_id,
                text,
                args.kind,
                args.parent_goal_id,
                args.target_date
            ],
            |row| row.get(0),
        )?;
        let goal = Self::goal_get(&tx, id)?;
        Self::append_event_conn(
            &tx,
            EventKind::GOAL_CHANGE,
            None,
            Some(args.piece_id),
            &serde_json::json!({ "action": "create", "goal_id": id }),
        )?;
        tx.commit()?;
        Ok(goal)
    }

    /// Apply a partial patch to a goal; appends a `goal_change` event.
    pub fn goal_update(&self, id: i64, patch: GoalPatch) -> rusqlite::Result<Goal> {
        if patch
            .text
            .as_deref()
            .is_some_and(|text| text.trim().is_empty() || text.trim().chars().count() > 500)
            || patch
                .target_date
                .as_ref()
                .and_then(|date| date.as_deref())
                .is_some_and(|date| !crate::date::is_valid(date))
        {
            return Err(rusqlite::Error::InvalidQuery);
        }
        let mut conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        let tx = conn.transaction()?;
        let current = Self::goal_get(&tx, id)?;
        let requested_parent = patch.parent_goal_id.unwrap_or(current.parent_goal_id);
        match (current.kind.as_str(), requested_parent) {
            ("big", None) => {}
            ("sub", Some(parent_id)) if parent_id != id => {
                let parent = Self::goal_get(&tx, parent_id)?;
                if parent.piece_id != current.piece_id
                    || parent.kind != "big"
                    || parent.parent_goal_id.is_some()
                {
                    return Err(rusqlite::Error::InvalidQuery);
                }
            }
            _ => return Err(rusqlite::Error::InvalidQuery),
        }
        let parent_changed =
            patch.parent_goal_id.is_some() && requested_parent != current.parent_goal_id;
        let mut sets: Vec<String> = Vec::new();
        let mut vals: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        if let Some(v) = patch.text {
            sets.push(format!("text = ?{}", vals.len() + 2));
            vals.push(Box::new(v.trim().to_string()));
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
            if parent_changed {
                let next_order: i64 = tx.query_row(
                    "SELECT COALESCE(MAX(sort_order) + 1, 0) FROM goal
                     WHERE piece_id = ?1 AND parent_goal_id IS ?2",
                    rusqlite::params![current.piece_id, requested_parent],
                    |row| row.get(0),
                )?;
                sets.push(format!("sort_order = ?{}", vals.len() + 2));
                vals.push(Box::new(next_order));
            }
        }
        if !sets.is_empty() {
            let sql = format!("UPDATE goal SET {} WHERE id = ?1", sets.join(", "));
            let mut params: Vec<&dyn rusqlite::ToSql> = vec![&id];
            for v in &vals {
                params.push(v.as_ref());
            }
            tx.execute(&sql, params.as_slice())?;
        }
        if parent_changed {
            tx.execute(
                "UPDATE goal SET sort_order = sort_order - 1
                 WHERE piece_id = ?1 AND parent_goal_id IS ?2 AND sort_order > ?3",
                rusqlite::params![current.piece_id, current.parent_goal_id, current.order],
            )?;
        }
        let goal = Self::goal_get(&tx, id)?;
        Self::append_event_conn(
            &tx,
            EventKind::GOAL_CHANGE,
            None,
            Some(goal.piece_id),
            &serde_json::json!({ "action": "update", "goal_id": id }),
        )?;
        tx.commit()?;
        Ok(goal)
    }

    /// Delete one Goal after the UI's explicit destructive confirmation.
    /// A root deletion also removes its direct subgoals and every Calendar row
    /// owned by that branch. This is one transaction: Calendar can never retain
    /// an orphaned card and Goals can never retain a half-deleted tree.
    pub fn goal_delete(&self, id: i64) -> rusqlite::Result<()> {
        let mut conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        let tx = conn.transaction()?;
        let goal = Self::goal_get(&tx, id)?;
        let removed_work: Vec<i64> = {
            let mut statement = tx.prepare(
                "SELECT id FROM daily_work
                 WHERE goal_id = ?1
                    OR goal_id IN (SELECT id FROM goal WHERE parent_goal_id = ?1)
                 ORDER BY id",
            )?;
            let ids = statement
                .query_map([id], |row| row.get(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            ids
        };
        tx.execute(
            "DELETE FROM daily_work
             WHERE goal_id = ?1
                OR goal_id IN (SELECT id FROM goal WHERE parent_goal_id = ?1)",
            [id],
        )?;
        let removed_children = tx.execute("DELETE FROM goal WHERE parent_goal_id = ?1", [id])?;
        tx.execute("DELETE FROM goal WHERE id = ?1", [id])?;
        tx.execute(
            "UPDATE goal SET sort_order = sort_order - 1
             WHERE piece_id = ?1 AND parent_goal_id IS ?2 AND sort_order > ?3",
            rusqlite::params![goal.piece_id, goal.parent_goal_id, goal.order],
        )?;
        Self::append_event_conn(
            &tx,
            EventKind::GOAL_CHANGE,
            None,
            Some(goal.piece_id),
            &serde_json::json!({
                "action": "delete_tree",
                "goal_id": id,
                "removed_subgoals": removed_children,
                "removed_daily_work": removed_work,
            }),
        )?;
        if !removed_work.is_empty() {
            Self::append_event_conn(
                &tx,
                EventKind::DAILY_WORK_CHANGE,
                None,
                Some(goal.piece_id),
                &serde_json::json!({
                    "action": "delete_for_goal_tree",
                    "goal_id": id,
                    "daily_work_ids": removed_work,
                }),
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Reorder exactly one complete sibling set. Partial, duplicate, missing,
    /// mixed-parent, and cross-piece arrays reject without changing any row.
    pub fn goal_reorder(&self, piece_id: i64, ordered_ids: Vec<i64>) -> rusqlite::Result<()> {
        if ordered_ids.is_empty() {
            return Err(rusqlite::Error::InvalidQuery);
        }
        let unique = ordered_ids
            .iter()
            .copied()
            .collect::<std::collections::HashSet<_>>();
        if unique.len() != ordered_ids.len() {
            return Err(rusqlite::Error::InvalidQuery);
        }
        let mut conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        let tx = conn.transaction()?;
        let first = Self::goal_get(&tx, ordered_ids[0])?;
        if first.piece_id != piece_id {
            return Err(rusqlite::Error::InvalidQuery);
        }
        let mut stmt = tx.prepare(
            "SELECT id FROM goal
             WHERE piece_id = ?1 AND parent_goal_id IS ?2 ORDER BY sort_order, id",
        )?;
        let sibling_ids = stmt
            .query_map(rusqlite::params![piece_id, first.parent_goal_id], |row| {
                row.get::<_, i64>(0)
            })?
            .collect::<rusqlite::Result<std::collections::HashSet<_>>>()?;
        drop(stmt);
        if sibling_ids != unique {
            return Err(rusqlite::Error::InvalidQuery);
        }
        for (idx, id) in ordered_ids.iter().enumerate() {
            tx.execute(
                "UPDATE goal SET sort_order = ?2 WHERE id = ?1 AND piece_id = ?3",
                rusqlite::params![id, idx as i64, piece_id],
            )?;
        }
        Self::append_event_conn(
            &tx,
            EventKind::GOAL_CHANGE,
            None,
            Some(piece_id),
            &serde_json::json!({
                "action": "reorder",
                "parent_goal_id": first.parent_goal_id,
                "order": ordered_ids,
            }),
        )?;
        tx.commit()?;
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
            .goal_create(GoalCreate {
                piece_id: 1,
                text: "a".into(),
                kind: "big".into(),
                parent_goal_id: None,
                target_date: None,
            })
            .unwrap();
        let b = s
            .goal_create(GoalCreate {
                piece_id: 1,
                text: "b".into(),
                kind: "big".into(),
                parent_goal_id: None,
                target_date: None,
            })
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
            .goal_create(GoalCreate {
                piece_id: 1,
                text: "a".into(),
                kind: "big".into(),
                parent_goal_id: None,
                target_date: None,
            })
            .unwrap();
        assert!(!g.done);
        let updated = s
            .goal_update(
                g.id,
                GoalPatch {
                    done: Some(true),
                    ..Default::default()
                },
            )
            .unwrap();
        assert!(updated.done);
    }

    #[test]
    fn goal_delete_removes_it() {
        let s = Store::open(":memory:").unwrap();
        seed_piece(&s, 1);
        let g = s
            .goal_create(GoalCreate {
                piece_id: 1,
                text: "a".into(),
                kind: "big".into(),
                parent_goal_id: None,
                target_date: None,
            })
            .unwrap();
        s.goal_delete(g.id).unwrap();
        assert!(s.goal_list(1).unwrap().is_empty());
    }

    #[test]
    fn goal_parent_must_be_a_root_goal_from_the_same_piece() {
        let s = Store::open(":memory:").unwrap();
        seed_piece(&s, 1);
        seed_piece(&s, 2);
        let root = s
            .goal_create(GoalCreate {
                piece_id: 1,
                text: "root".into(),
                kind: "big".into(),
                parent_goal_id: None,
                target_date: None,
            })
            .unwrap();
        let other = s
            .goal_create(GoalCreate {
                piece_id: 2,
                text: "other".into(),
                kind: "big".into(),
                parent_goal_id: None,
                target_date: None,
            })
            .unwrap();
        assert!(s
            .goal_create(GoalCreate {
                piece_id: 1,
                text: "cross".into(),
                kind: "sub".into(),
                parent_goal_id: Some(other.id),
                target_date: None,
            })
            .is_err());
        let child = s
            .goal_create(GoalCreate {
                piece_id: 1,
                text: "child".into(),
                kind: "sub".into(),
                parent_goal_id: Some(root.id),
                target_date: None,
            })
            .unwrap();
        assert!(s
            .goal_update(
                root.id,
                GoalPatch {
                    parent_goal_id: Some(Some(child.id)),
                    ..Default::default()
                }
            )
            .is_err());
        assert!(s
            .goal_update(
                child.id,
                GoalPatch {
                    parent_goal_id: Some(Some(child.id)),
                    ..Default::default()
                }
            )
            .is_err());
    }

    #[test]
    fn goal_shapes_dates_deletes_and_reorders_are_strict() {
        let s = Store::open(":memory:").unwrap();
        seed_piece(&s, 1);
        assert!(s
            .goal_create(GoalCreate {
                piece_id: 1,
                text: "orphan".into(),
                kind: "sub".into(),
                parent_goal_id: None,
                target_date: None,
            })
            .is_err());
        assert!(s
            .goal_create(GoalCreate {
                piece_id: 1,
                text: "bad date".into(),
                kind: "big".into(),
                parent_goal_id: None,
                target_date: Some("2026-02-30".into()),
            })
            .is_err());
        let a = s
            .goal_create(GoalCreate {
                piece_id: 1,
                text: "A".into(),
                kind: "big".into(),
                parent_goal_id: None,
                target_date: Some("2026-08-01".into()),
            })
            .unwrap();
        let b = s
            .goal_create(GoalCreate {
                piece_id: 1,
                text: "B".into(),
                kind: "big".into(),
                parent_goal_id: None,
                target_date: None,
            })
            .unwrap();
        let child = s
            .goal_create(GoalCreate {
                piece_id: 1,
                text: "child".into(),
                kind: "sub".into(),
                parent_goal_id: Some(a.id),
                target_date: None,
            })
            .unwrap();
        assert!(
            s.goal_reorder(1, vec![a.id]).is_err(),
            "partial sibling order must fail"
        );
        assert!(
            s.goal_reorder(1, vec![a.id, a.id]).is_err(),
            "duplicates must fail"
        );
        assert!(
            s.goal_reorder(1, vec![a.id, child.id, b.id]).is_err(),
            "mixed levels must fail"
        );
        assert!(s
            .goal_update(
                a.id,
                GoalPatch {
                    target_date: Some(Some("2026-04-31".into())),
                    ..Default::default()
                }
            )
            .is_err());
        s.goal_delete(a.id).unwrap();
        let surviving = s.goal_list(1).unwrap();
        assert_eq!(
            surviving.len(),
            1,
            "confirmed root deletion removes its subgoals"
        );
        assert_eq!(surviving[0].id, b.id);
    }

    #[test]
    fn moving_a_subgoal_compacts_old_siblings_and_appends_to_new_parent() {
        let s = Store::open(":memory:").unwrap();
        seed_piece(&s, 1);
        let a = s
            .goal_create(GoalCreate {
                piece_id: 1,
                text: "A".into(),
                kind: "big".into(),
                parent_goal_id: None,
                target_date: None,
            })
            .unwrap();
        let b = s
            .goal_create(GoalCreate {
                piece_id: 1,
                text: "B".into(),
                kind: "big".into(),
                parent_goal_id: None,
                target_date: None,
            })
            .unwrap();
        let one = s
            .goal_create(GoalCreate {
                piece_id: 1,
                text: "one".into(),
                kind: "sub".into(),
                parent_goal_id: Some(a.id),
                target_date: None,
            })
            .unwrap();
        let two = s
            .goal_create(GoalCreate {
                piece_id: 1,
                text: "two".into(),
                kind: "sub".into(),
                parent_goal_id: Some(a.id),
                target_date: None,
            })
            .unwrap();

        let moved = s
            .goal_update(
                one.id,
                GoalPatch {
                    parent_goal_id: Some(Some(b.id)),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(moved.parent_goal_id, Some(b.id));
        assert_eq!(moved.order, 0);
        let remaining = s
            .goal_list(1)
            .unwrap()
            .into_iter()
            .find(|goal| goal.id == two.id)
            .unwrap();
        assert_eq!(remaining.order, 0);
    }
}
// ── T7: Inline piece-field update ───────────────────────────────────────────

impl Store {
    /// Update any of a piece's inline-editable intake fields (absent =
    /// unchanged). Deliberately appends NO event — see [`PieceFieldPatch`].
    pub fn piece_field_update(
        &self,
        piece_id: i64,
        patch: PieceFieldPatch,
    ) -> rusqlite::Result<()> {
        let PieceFieldPatch {
            current_state,
            deadline,
            target_tempo,
            notes,
        } = patch;
        if deadline
            .as_ref()
            .and_then(|date| date.as_deref())
            .is_some_and(|date| !crate::date::is_valid(date))
        {
            return Err(rusqlite::Error::InvalidQuery);
        }
        let mut conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        let tx = conn.transaction()?;
        let old_deadline: Option<String> = if deadline.is_some() {
            tx.query_row(
                "SELECT deadline FROM piece WHERE id = ?1",
                [piece_id],
                |row| row.get(0),
            )?
        } else {
            None
        };
        let mut sets: Vec<String> = Vec::new();
        let mut vals: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        if let Some(v) = current_state {
            sets.push(format!("current_state = ?{}", vals.len() + 2));
            vals.push(Box::new(v));
        }
        if let Some(v) = deadline.clone() {
            sets.push(format!("deadline = ?{}", vals.len() + 2));
            vals.push(Box::new(v));
        }
        if let Some(v) = target_tempo {
            sets.push(format!("target_tempo = ?{}", vals.len() + 2));
            vals.push(Box::new(v));
        }
        if let Some(v) = notes {
            sets.push(format!("notes = ?{}", vals.len() + 2));
            vals.push(Box::new(v));
        }
        if !sets.is_empty() {
            let sql = format!("UPDATE piece SET {} WHERE id = ?1", sets.join(", "));
            let mut params: Vec<&dyn rusqlite::ToSql> = vec![&piece_id];
            for v in &vals {
                params.push(v.as_ref());
            }
            tx.execute(&sql, params.as_slice())?;
        }
        if let Some(new_deadline) = deadline {
            // A piece deadline is the default inherited by its canonical root
            // goals. Move only rows that still match the previous default;
            // preserve explicit per-goal dates the user set independently.
            tx.execute(
                "UPDATE goal SET target_date = ?2
                 WHERE piece_id = ?1 AND parent_goal_id IS NULL
                   AND target_date IS ?3",
                rusqlite::params![piece_id, new_deadline, old_deadline],
            )?;
        }
        tx.commit()
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
        s.piece_field_update(
            1,
            PieceFieldPatch {
                current_state: Some(Some("mm.1-40 solid".into())),
                ..Default::default()
            },
        )
        .unwrap();
        let p = s.get_piece(1).unwrap().unwrap();
        assert_eq!(p.current_state.as_deref(), Some("mm.1-40 solid"));
        assert_eq!(p.deadline, None); // untouched
    }

    #[test]
    fn piece_deadline_moves_only_goals_inheriting_the_previous_default() {
        let s = Store::open(":memory:").unwrap();
        seed_piece(&s, 1);
        s.piece_field_update(
            1,
            PieceFieldPatch {
                deadline: Some(Some("2026-08-01".into())),
                ..Default::default()
            },
        )
        .unwrap();
        s.goal_create(GoalCreate {
            piece_id: 1,
            text: "Inherited".into(),
            kind: "big".into(),
            parent_goal_id: None,
            target_date: Some("2026-08-01".into()),
        })
        .unwrap();
        s.goal_create(GoalCreate {
            piece_id: 1,
            text: "Custom".into(),
            kind: "big".into(),
            parent_goal_id: None,
            target_date: Some("2026-07-20".into()),
        })
        .unwrap();

        s.piece_field_update(
            1,
            PieceFieldPatch {
                deadline: Some(Some("2026-09-01".into())),
                ..Default::default()
            },
        )
        .unwrap();

        let goals = s.goal_list(1).unwrap();
        assert_eq!(goals[0].target_date.as_deref(), Some("2026-09-01"));
        assert_eq!(goals[1].target_date.as_deref(), Some("2026-07-20"));
    }
}

// ── Brain conversation memory + read-only grounding accessors ───────────────
//
// Durable per-piece Brain memory (resume/append/clear) and the read-only
// retention/recovery reads the context builder grounds answers in. These paths
// persist ONLY the Brain's own conversation; they never mutate practice state.

/// Maximum recent turns loaded when a Brain thread resumes. Bounds relaunch
/// memory and the history that can re-enter a later provider call.
pub const MAX_THREAD_TURNS_LOADED: usize = 20;

impl Store {
    /// Resume the most-recent non-cleared Brain thread for a piece, creating one
    /// if none exists, and return its last [`MAX_THREAD_TURNS_LOADED`] turns in
    /// chronological order. Never deletes: a cleared thread is simply skipped so
    /// the next resume starts fresh while old turns stay in the table.
    pub fn brain_thread_resume(&self, piece_id: i64) -> rusqlite::Result<BrainThreadResume> {
        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        let existing: Option<i64> = conn
            .query_row(
                "SELECT id FROM brain_thread
                 WHERE piece_id = ?1 AND cleared_ts IS NULL
                 ORDER BY updated_ts DESC, id DESC LIMIT 1",
                [piece_id],
                |row| row.get(0),
            )
            .optional()?;
        let thread_id = match existing {
            Some(id) => id,
            None => conn.query_row(
                "INSERT INTO brain_thread (piece_id) VALUES (?1) RETURNING id",
                [piece_id],
                |row| row.get(0),
            )?,
        };
        let turns = Self::brain_turns_recent(&conn, thread_id, MAX_THREAD_TURNS_LOADED)?;
        Ok(BrainThreadResume { thread_id, turns })
    }

    fn brain_turns_recent(
        conn: &Connection,
        thread_id: i64,
        limit: usize,
    ) -> rusqlite::Result<Vec<BrainTurnRow>> {
        // Read the newest `limit` rows, then restore chronological order so the
        // drawer and any re-sent history read oldest→newest.
        let mut stmt = conn.prepare(
            "SELECT role, content, provider, citations_json, created_ts
             FROM brain_turn WHERE thread_id = ?1
             ORDER BY id DESC LIMIT ?2",
        )?;
        let mut rows = stmt
            .query_map(rusqlite::params![thread_id, limit as i64], |row| {
                let citations: String = row.get(3)?;
                Ok(BrainTurnRow {
                    role: row.get(0)?,
                    content: row.get(1)?,
                    provider: row.get(2)?,
                    citations: serde_json::from_str(&citations)
                        .unwrap_or_else(|_| serde_json::json!([])),
                    created_ts: row.get(4)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        rows.reverse();
        Ok(rows)
    }

    /// Append one completed turn to a thread and bump the thread's `updated_ts`
    /// so resume ordering follows real activity. Content is bounded to the
    /// schema ceiling. Only real, completed exchanges are ever appended.
    pub fn brain_turn_append(
        &self,
        thread_id: i64,
        role: &str,
        content: &str,
        provider: Option<&str>,
        citations_json: &str,
    ) -> rusqlite::Result<i64> {
        let content: String = content.chars().take(24_000).collect();
        if content.trim().is_empty() || !matches!(role, "user" | "assistant") {
            return Err(rusqlite::Error::InvalidQuery);
        }
        let mut conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        let tx = conn.transaction()?;
        let id: i64 = tx.query_row(
            "INSERT INTO brain_turn (thread_id, role, content, provider, citations_json)
             VALUES (?1, ?2, ?3, ?4, ?5) RETURNING id",
            rusqlite::params![thread_id, role, content, provider, citations_json],
            |row| row.get(0),
        )?;
        tx.execute(
            "UPDATE brain_thread SET updated_ts = datetime('now') WHERE id = ?1",
            [thread_id],
        )?;
        tx.commit()?;
        Ok(id)
    }

    /// "Clear / new conversation": mark every active thread for a piece cleared
    /// so the next resume starts a fresh, empty thread. Turns are preserved.
    pub fn brain_thread_clear(&self, piece_id: i64) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        conn.execute(
            "UPDATE brain_thread SET cleared_ts = datetime('now')
             WHERE piece_id = ?1 AND cleared_ts IS NULL",
            [piece_id],
        )?;
        Ok(())
    }

    /// Read-only: the most recent recovery actions for a piece, newest first,
    /// capped at `limit`. Joins set→piece and performs NO writes.
    pub fn recovery_actions_for_piece(
        &self,
        piece_id: i64,
        limit: usize,
    ) -> rusqlite::Result<Vec<RecoveryActionRow>> {
        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        let mut stmt = conn.prepare(
            "SELECT pra.kind, pra.rationale, pra.created_ts, b.m_start, b.m_end, b.region_id
             FROM practice_recovery_action pra
             JOIN rep_block b ON b.id = pra.set_id
             WHERE b.piece_id = ?1
             ORDER BY pra.id DESC LIMIT ?2",
        )?;
        let rows = stmt.query_map(rusqlite::params![piece_id, limit as i64], |row| {
            Ok(RecoveryActionRow {
                kind: row.get(0)?,
                rationale: row.get(1)?,
                created_ts: row.get(2)?,
                m_start: row.get(3)?,
                m_end: row.get(4)?,
                region_id: row.get(5)?,
            })
        })?;
        rows.collect()
    }
}

#[cfg(test)]
impl Store {
    /// Test-only: seed a due retention check for a region via raw SQL, so
    /// grounding tests can exercise the read path without the full rep engine.
    pub(crate) fn test_seed_retention_check(
        &self,
        region_id: i64,
        due_date: &str,
        condition_json: &str,
    ) {
        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        conn.execute(
            "INSERT INTO retention_check (region_id, due_date, original_due_date, condition_json)
             VALUES (?1, ?2, ?2, ?3)",
            rusqlite::params![region_id, due_date, condition_json],
        )
        .unwrap();
    }

    /// Test-only: seed a recovery action for a set via raw SQL, minting the
    /// required `practice_operation` row. `uniq` keeps unique keys distinct.
    pub(crate) fn test_seed_recovery_action(
        &self,
        set_id: i64,
        kind: &str,
        rationale: &str,
        uniq: i64,
    ) {
        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        let op_id: i64 = conn
            .query_row(
                "INSERT INTO practice_operation
                 (receipt_id, command_id, operation_kind, request_fingerprint,
                  set_id, source, summary, value_json, committed_ts)
                 VALUES (?1, ?2, 'recover', ?1, ?3, 'user_click', 'test recovery',
                  '{}', datetime('now'))
                 RETURNING id",
                rusqlite::params![format!("receipt-{uniq}"), format!("cmd-{uniq}"), set_id],
                |row| row.get(0),
            )
            .unwrap();
        conn.execute(
            "INSERT INTO practice_recovery_action
             (set_id, kind, rationale, source, operation_id, created_ts)
             VALUES (?1, ?2, ?3, 'user_click', ?4, datetime('now'))",
            rusqlite::params![set_id, kind, rationale, op_id],
        )
        .unwrap();
    }
}

#[cfg(test)]
mod brain_memory {
    use super::test_support::seed_piece;
    use super::*;
    use crate::store::Store;

    fn count_turns(store: &Store) -> i64 {
        let conn = store.conn.lock().unwrap_or_else(|p| p.into_inner());
        conn.query_row("SELECT count(*) FROM brain_turn", [], |row| row.get(0))
            .unwrap()
    }

    #[test]
    fn append_then_resume_returns_turns_in_order() {
        let store = Store::open(":memory:").unwrap();
        seed_piece(&store, 1);
        let resumed = store.brain_thread_resume(1).unwrap();
        assert!(resumed.turns.is_empty(), "a fresh thread has no turns");
        let thread_id = resumed.thread_id;

        store
            .brain_turn_append(thread_id, "user", "Why does the leap miss?", None, "[]")
            .unwrap();
        store
            .brain_turn_append(
                thread_id,
                "assistant",
                "Release the wrist before the arrival.",
                Some("claude"),
                r#"[{"source_id":"source-1"}]"#,
            )
            .unwrap();

        let again = store.brain_thread_resume(1).unwrap();
        assert_eq!(again.thread_id, thread_id, "resume rejoins the same thread");
        assert_eq!(again.turns.len(), 2);
        assert_eq!(again.turns[0].role, "user");
        assert_eq!(again.turns[0].content, "Why does the leap miss?");
        assert_eq!(again.turns[1].role, "assistant");
        assert_eq!(again.turns[1].provider.as_deref(), Some("claude"));
        assert_eq!(again.turns[1].citations[0]["source_id"], "source-1");
    }

    #[test]
    fn resume_is_bounded_to_the_load_cap() {
        let store = Store::open(":memory:").unwrap();
        seed_piece(&store, 1);
        let thread_id = store.brain_thread_resume(1).unwrap().thread_id;
        for index in 0..(MAX_THREAD_TURNS_LOADED + 5) {
            store
                .brain_turn_append(thread_id, "user", &format!("q{index}"), None, "[]")
                .unwrap();
        }
        let resumed = store.brain_thread_resume(1).unwrap();
        assert_eq!(resumed.turns.len(), MAX_THREAD_TURNS_LOADED);
        // The cap keeps the newest turns: the last appended question survives.
        let last = format!("q{}", MAX_THREAD_TURNS_LOADED + 4);
        assert_eq!(resumed.turns.last().unwrap().content, last);
    }

    #[test]
    fn clear_starts_a_fresh_thread_without_deleting_turns() {
        let store = Store::open(":memory:").unwrap();
        seed_piece(&store, 1);
        let first = store.brain_thread_resume(1).unwrap().thread_id;
        store
            .brain_turn_append(first, "user", "old question", None, "[]")
            .unwrap();

        store.brain_thread_clear(1).unwrap();
        let fresh = store.brain_thread_resume(1).unwrap();
        assert_ne!(fresh.thread_id, first, "clear forces a brand-new thread");
        assert!(fresh.turns.is_empty(), "the fresh thread starts empty");
        // The cleared thread's turn is preserved in the table, never deleted.
        assert_eq!(count_turns(&store), 1);
    }

    #[test]
    fn threads_are_isolated_per_piece() {
        let store = Store::open(":memory:").unwrap();
        seed_piece(&store, 1);
        seed_piece(&store, 2);
        let thread_one = store.brain_thread_resume(1).unwrap().thread_id;
        store
            .brain_turn_append(thread_one, "user", "piece one only", None, "[]")
            .unwrap();

        let piece_two = store.brain_thread_resume(2).unwrap();
        assert_ne!(piece_two.thread_id, thread_one);
        assert!(
            piece_two.turns.is_empty(),
            "piece 2 never sees piece 1's turns"
        );
    }
}

// ── A11: the per-piece score goals banner ───────────────────────────────────

impl Store {
    /// Set (or, with `None`, clear) the one goal sentence pinned over a piece's
    /// score, and return the piece's refreshed detail.
    ///
    /// Length is NOT checked here — the command layer rejects anything over
    /// [`crate::BANNER_MAX_CHARS`] before this is ever reached, and the column's
    /// own CHECK constraint is the last line of defence.
    pub fn piece_banner_set(
        &self,
        piece_id: i64,
        text: Option<&str>,
    ) -> rusqlite::Result<Option<crate::store::model::PieceDetail>> {
        {
            let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
            conn.execute(
                "UPDATE piece SET banner_text = ?2 WHERE id = ?1",
                rusqlite::params![piece_id, text],
            )?;
        } // drop the guard before get_piece takes it again
        self.get_piece(piece_id)
    }
}

#[cfg(test)]
mod piece_banner {
    use super::test_support::seed_piece;
    use super::*;
    use crate::store::Store;

    #[test]
    fn piece_banner_set_round_trips_text_and_clears_with_none() {
        let s = Store::open(":memory:").unwrap();
        seed_piece(&s, 1);
        assert_eq!(
            s.get_piece(1).unwrap().unwrap().banner_text,
            None,
            "a fresh piece has no banner"
        );

        let set = s
            .piece_banner_set(1, Some("Even development voicing"))
            .unwrap()
            .unwrap();
        assert_eq!(set.banner_text.as_deref(), Some("Even development voicing"));
        assert_eq!(
            s.get_piece(1).unwrap().unwrap().banner_text.as_deref(),
            Some("Even development voicing"),
            "the banner is durable, not just echoed back"
        );

        let cleared = s.piece_banner_set(1, None).unwrap().unwrap();
        assert_eq!(cleared.banner_text, None);
        assert_eq!(s.get_piece(1).unwrap().unwrap().banner_text, None);
    }

    #[test]
    fn piece_banner_set_leaves_the_rest_of_the_piece_untouched() {
        let s = Store::open(":memory:").unwrap();
        seed_piece(&s, 1);
        s.piece_field_update(
            1,
            PieceFieldPatch {
                notes: Some(Some("Left hand light".into())),
                ..Default::default()
            },
        )
        .unwrap();
        let after = s
            .piece_banner_set(1, Some("Perform from memory"))
            .unwrap()
            .unwrap();
        assert_eq!(after.notes.as_deref(), Some("Left hand light"));
        assert_eq!(after.title, "Piece 1");
    }

    #[test]
    fn the_column_check_still_rejects_an_over_long_banner() {
        // Proves the 140-char CHECK is real, which is exactly why the command
        // layer validates FIRST rather than letting a user edit reach SQLite.
        let s = Store::open(":memory:").unwrap();
        seed_piece(&s, 1);
        let too_long = "x".repeat(141);
        assert!(s.piece_banner_set(1, Some(&too_long)).is_err());
    }

    #[test]
    fn setting_a_banner_on_an_unknown_piece_returns_none() {
        let s = Store::open(":memory:").unwrap();
        seed_piece(&s, 1);
        assert_eq!(s.piece_banner_set(9999, Some("nope")).unwrap(), None);
    }
}
