//! Schema-v6 bridge from the original live `session_event` feed to the
//! canonical `event` log.
//!
//! The caller owns the migration transaction. Every legacy row receives one
//! durable ledger disposition, including rows that cannot safely become a
//! canonical practice event. That makes retries deterministic without guessing
//! piece ownership or rewriting either source table.

use rusqlite::{Connection, OptionalExtension};
use serde_json::Value;

#[derive(Debug, Default, Eq, PartialEq)]
pub(crate) struct BackfillStats {
    pub inserted: usize,
    pub matched: usize,
    pub skipped: usize,
}

struct LegacyEvent {
    id: i64,
    session_id: i64,
    ts: String,
    kind: String,
    payload: String,
}

/// Ledger every previously unseen `session_event` and copy only reconstructable
/// `rep_open`/`rep` rows into `event`.
///
/// A reconstructable row must carry integer `piece_id` and `block_id` values,
/// the piece must still exist, and the block must belong to that exact piece.
/// The original timestamp, session link, kind, and payload bytes are preserved.
/// An exact pre-existing canonical counterpart is linked instead of duplicated.
pub(crate) fn backfill_history(conn: &Connection) -> rusqlite::Result<BackfillStats> {
    let rows = {
        let mut statement = conn.prepare(
            "SELECT se.id, se.session_id, se.ts, se.kind, se.payload
             FROM session_event se
             LEFT JOIN session_event_backfill ledger
               ON ledger.legacy_session_event_id = se.id
             WHERE ledger.legacy_session_event_id IS NULL
             ORDER BY se.id",
        )?;
        let rows = statement
            .query_map([], |row| {
                Ok(LegacyEvent {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    ts: row.get(2)?,
                    kind: row.get(3)?,
                    payload: row.get(4)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        rows
    };

    let mut stats = BackfillStats::default();
    for row in rows {
        if row.kind != "rep_open" && row.kind != "rep" {
            record_skip(conn, row.id, "unsupported_kind")?;
            stats.skipped += 1;
            continue;
        }

        let payload: Value = match serde_json::from_str(&row.payload) {
            Ok(Value::Object(object)) => Value::Object(object),
            _ => {
                record_skip(conn, row.id, "malformed_payload")?;
                stats.skipped += 1;
                continue;
            }
        };
        let Some(piece_id) = payload.get("piece_id").and_then(Value::as_i64) else {
            record_skip(conn, row.id, "missing_piece_id")?;
            stats.skipped += 1;
            continue;
        };
        let Some(block_id) = payload.get("block_id").and_then(Value::as_i64) else {
            record_skip(conn, row.id, "missing_block_id")?;
            stats.skipped += 1;
            continue;
        };

        let piece_exists = conn
            .query_row("SELECT 1 FROM piece WHERE id = ?1", [piece_id], |_| Ok(()))
            .optional()?
            .is_some();
        if !piece_exists {
            record_skip(conn, row.id, "missing_piece")?;
            stats.skipped += 1;
            continue;
        }

        let block_piece: Option<i64> = conn
            .query_row(
                "SELECT piece_id FROM rep_block WHERE id = ?1",
                [block_id],
                |result| result.get(0),
            )
            .optional()?;
        match block_piece {
            None => {
                record_skip(conn, row.id, "missing_block")?;
                stats.skipped += 1;
                continue;
            }
            Some(owner) if owner != piece_id => {
                record_skip(conn, row.id, "cross_piece_block")?;
                stats.skipped += 1;
                continue;
            }
            Some(_) => {}
        }

        // Dual-writing builds stored the same serialized payload and normally
        // the same SQLite-second timestamp in both logs. Reuse only that exact
        // tuple; looser time/payload matching could silently claim the wrong rep.
        let existing: Option<i64> = conn
            .query_row(
                "SELECT event.id
                 FROM event
                 LEFT JOIN session_event_backfill ledger
                   ON ledger.canonical_event_id = event.id
                 WHERE event.ts = ?1
                   AND event.session_id = ?2
                   AND event.piece_id = ?3
                   AND event.kind = ?4
                   AND event.payload = ?5
                   AND ledger.canonical_event_id IS NULL
                 ORDER BY event.id
                 LIMIT 1",
                rusqlite::params![row.ts, row.session_id, piece_id, row.kind, row.payload],
                |result| result.get(0),
            )
            .optional()?;

        let (canonical_id, disposition, reason) = if let Some(event_id) = existing {
            stats.matched += 1;
            (event_id, "matched", "exact_existing")
        } else {
            let event_id = conn.query_row(
                "INSERT INTO event (ts,session_id,piece_id,kind,payload)
                 VALUES (?1,?2,?3,?4,?5)
                 RETURNING id",
                rusqlite::params![row.ts, row.session_id, piece_id, row.kind, row.payload],
                |result| result.get(0),
            )?;
            stats.inserted += 1;
            (event_id, "inserted", "backfilled")
        };
        conn.execute(
            "INSERT INTO session_event_backfill
             (legacy_session_event_id,canonical_event_id,disposition,reason)
             VALUES (?1,?2,?3,?4)",
            rusqlite::params![row.id, canonical_id, disposition, reason],
        )?;
    }
    Ok(stats)
}

fn record_skip(conn: &Connection, legacy_id: i64, reason: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO session_event_backfill
         (legacy_session_event_id,canonical_event_id,disposition,reason)
         VALUES (?1,NULL,'skipped',?2)",
        rusqlite::params![legacy_id, reason],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_backfill_is_a_no_op() {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE session_event (
                   id INTEGER PRIMARY KEY, session_id INTEGER NOT NULL,
                   ts TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL
                 );
                 CREATE TABLE piece (id INTEGER PRIMARY KEY);
                 CREATE TABLE rep_block (
                   id INTEGER PRIMARY KEY, piece_id INTEGER NOT NULL REFERENCES piece(id)
                 );
                 CREATE TABLE event (
                   id INTEGER PRIMARY KEY, ts TEXT NOT NULL, session_id INTEGER,
                   piece_id INTEGER, kind TEXT NOT NULL, payload TEXT NOT NULL
                 );
                 CREATE TABLE session_event_backfill (
                   legacy_session_event_id INTEGER PRIMARY KEY,
                   canonical_event_id INTEGER UNIQUE,
                   disposition TEXT NOT NULL, reason TEXT NOT NULL
                 );",
            )
            .unwrap();
        assert_eq!(
            backfill_history(&connection).unwrap(),
            BackfillStats::default()
        );
    }
}
