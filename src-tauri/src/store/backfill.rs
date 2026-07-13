//! One-shot v3 back-fill. Idempotent by construction: it only runs inside the
//! `version < 3` migration step, and each sub-step no-ops if its target rows
//! already exist (guards on `region`/`goal` emptiness per piece).
use rusqlite::Connection;
use serde_json::Value;

const PALETTE: [&str; 6] = ["#6b8fb5", "#b58f6b", "#8fb56b", "#b56b8f", "#6bb5a8", "#a86bb5"];

pub(crate) fn backfill_v3(conn: &Connection) -> rusqlite::Result<()> {
    let piece_ids: Vec<i64> = {
        let mut stmt = conn.prepare("SELECT id FROM piece")?;
        let rows = stmt.query_map([], |r| r.get(0))?;
        rows.collect::<Result<_, _>>()?
    };
    for pid in piece_ids {
        backfill_regions_for_piece(conn, pid)?;
        backfill_hard_spots_for_piece(conn, pid)?;
        backfill_goals_for_piece(conn, pid)?;
    }
    Ok(())
}

/// Cluster a piece's blocks into Regions by overlapping/touching measure ranges.
/// Sort by m_start; a block joins the current cluster iff m_start <= running m_end;
/// otherwise it starts a new cluster. One `kind='section'` Region per cluster; each
/// block in the cluster gets that region_id. Skips pieces that already have regions.
fn backfill_regions_for_piece(conn: &Connection, pid: i64) -> rusqlite::Result<()> {
    let existing: i64 = conn.query_row(
        "SELECT count(*) FROM region WHERE piece_id=?1 AND kind='section'", [pid], |r| r.get(0))?;
    if existing > 0 { return Ok(()); }

    // (block_id, m_start, m_end) ordered by start then end
    let mut stmt = conn.prepare(
        "SELECT id, m_start, m_end FROM rep_block WHERE piece_id=?1 ORDER BY m_start, m_end")?;
    let blocks: Vec<(i64, i64, i64)> = stmt
        .query_map([pid], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
        .collect::<Result<_, _>>()?;
    drop(stmt);
    if blocks.is_empty() { return Ok(()); }

    let mut clusters: Vec<(i64, i64, Vec<i64>)> = Vec::new(); // (cs, ce, block_ids)
    for (bid, s, e) in blocks {
        match clusters.last_mut() {
            Some((_cs, ce, ids)) if s <= *ce => { *ce = (*ce).max(e); ids.push(bid); }
            _ => clusters.push((s, e, vec![bid])),
        }
    }
    for (i, (cs, ce, ids)) in clusters.into_iter().enumerate() {
        let color = PALETTE[i % PALETTE.len()];
        let name = format!("mm. {cs}–{ce}");
        conn.execute(
            "INSERT INTO region (piece_id,name,m_start,m_end,kind,sort_order,color) \
             VALUES (?1,?2,?3,?4,'section',?5,?6)",
            rusqlite::params![pid, name, cs, ce, i as i64, color])?;
        let rid = conn.last_insert_rowid();
        for bid in ids {
            conn.execute("UPDATE rep_block SET region_id=?1 WHERE id=?2", [rid, bid])?;
        }
    }
    Ok(())
}

/// intake hard_spots[] JSON ({measures, note}) → Region kind='hard_spot'.
fn backfill_hard_spots_for_piece(conn: &Connection, pid: i64) -> rusqlite::Result<()> {
    let existing: i64 = conn.query_row(
        "SELECT count(*) FROM region WHERE piece_id=?1 AND kind='hard_spot'", [pid], |r| r.get(0))?;
    if existing > 0 { return Ok(()); }
    let raw: String = conn.query_row("SELECT hard_spots FROM piece WHERE id=?1", [pid], |r| r.get(0))
        .unwrap_or_else(|_| "[]".into());
    let spots: Vec<Value> = serde_json::from_str(&raw).unwrap_or_default();
    for (i, spot) in spots.iter().enumerate() {
        let measures = spot.get("measures").and_then(Value::as_str).unwrap_or("").to_string();
        let note = spot.get("note").and_then(Value::as_str).unwrap_or("").to_string();
        let (ms, me) = parse_measure_range(&measures);
        let name = if note.is_empty() { format!("hard spot mm. {measures}") } else { note };
        conn.execute(
            "INSERT INTO region (piece_id,name,m_start,m_end,kind,sort_order,color) \
             VALUES (?1,?2,?3,?4,'hard_spot',?5,'#c05a5a')",
            rusqlite::params![pid, name, ms, me, (1000 + i) as i64])?;
    }
    Ok(())
}

/// intake goals[] JSON (string array) → Goal kind='big'.
fn backfill_goals_for_piece(conn: &Connection, pid: i64) -> rusqlite::Result<()> {
    let existing: i64 = conn.query_row("SELECT count(*) FROM goal WHERE piece_id=?1", [pid], |r| r.get(0))?;
    if existing > 0 { return Ok(()); }
    let raw: String = conn.query_row("SELECT goals FROM piece WHERE id=?1", [pid], |r| r.get(0))
        .unwrap_or_else(|_| "[]".into());
    let goals: Vec<String> = serde_json::from_str(&raw).unwrap_or_default();
    for (i, text) in goals.iter().enumerate() {
        conn.execute(
            "INSERT INTO goal (piece_id,text,kind,sort_order) VALUES (?1,?2,'big',?3)",
            rusqlite::params![pid, text, i as i64])?;
    }
    Ok(())
}

/// "12-16" → (12,16); "12" → (12,12); unparseable → (0,0).
pub(super) fn parse_measure_range(s: &str) -> (i64, i64) {
    let clean: String = s.chars().filter(|c| c.is_ascii_digit() || *c == '-' || *c == '–').collect();
    let norm = clean.replace('–', "-");
    let mut parts = norm.split('-').filter(|p| !p.is_empty());
    let a = parts.next().and_then(|p| p.parse().ok()).unwrap_or(0);
    let b = parts.next().and_then(|p| p.parse().ok()).unwrap_or(a);
    (a, b)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_measure_range_cases() {
        assert_eq!(parse_measure_range("12-16"), (12, 16));
        assert_eq!(parse_measure_range("12"), (12, 12));
        assert_eq!(parse_measure_range("mm. 40–48"), (40, 48));
        assert_eq!(parse_measure_range(""), (0, 0));
    }

    fn conn_with_v3_schema() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        c.execute_batch(crate::store::migrations::SCHEMA_V1).unwrap();
        c.execute_batch(crate::store::migrations::SCHEMA_V2).unwrap();
        c.execute_batch("PRAGMA foreign_keys = OFF;").unwrap();
        c.execute_batch(crate::store::migrations::SCHEMA_V3).unwrap();
        c.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        c
    }

    fn insert_block(c: &Connection, pid: i64, s: i64, e: i64) -> i64 {
        c.execute(
            "INSERT INTO rep_block (piece_id,m_start,m_end,planned_reps,status) VALUES (?1,?2,?3,0,'open')",
            rusqlite::params![pid, s, e],
        ).unwrap();
        c.last_insert_rowid()
    }

    #[test]
    fn clustering_merges_overlapping_and_touching_but_not_disjoint() {
        let c = conn_with_v3_schema();
        c.execute("INSERT INTO piece (id,title,folder_path) VALUES (1,'P','/p')", []).unwrap();
        // overlapping
        let b1 = insert_block(&c, 1, 1, 8);
        let b2 = insert_block(&c, 1, 5, 12);
        // touching (b2 ends at 12, this starts at 12)
        let b3 = insert_block(&c, 1, 12, 20);
        // disjoint
        let b4 = insert_block(&c, 1, 40, 48);

        backfill_regions_for_piece(&c, 1).unwrap();

        let region_of = |bid: i64| -> i64 {
            c.query_row("SELECT region_id FROM rep_block WHERE id=?1", [bid], |r| r.get(0)).unwrap()
        };
        let r1 = region_of(b1);
        let r2 = region_of(b2);
        let r3 = region_of(b3);
        let r4 = region_of(b4);
        assert_eq!(r1, r2, "overlapping blocks share a region");
        assert_eq!(r2, r3, "touching blocks share a region");
        assert_ne!(r3, r4, "disjoint block gets its own region");

        let sections: i64 = c.query_row(
            "SELECT count(*) FROM region WHERE piece_id=1 AND kind='section'", [], |r| r.get(0)).unwrap();
        assert_eq!(sections, 2);
    }

    #[test]
    fn backfill_regions_is_idempotent() {
        let c = conn_with_v3_schema();
        c.execute("INSERT INTO piece (id,title,folder_path) VALUES (1,'P','/p')", []).unwrap();
        insert_block(&c, 1, 1, 8);
        backfill_regions_for_piece(&c, 1).unwrap();
        backfill_regions_for_piece(&c, 1).unwrap();
        let sections: i64 = c.query_row(
            "SELECT count(*) FROM region WHERE piece_id=1 AND kind='section'", [], |r| r.get(0)).unwrap();
        assert_eq!(sections, 1);
    }
}
