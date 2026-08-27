//! Kept listen-back takes for subjective practice verdicts.
//!
//! Temporary recordings never enter this store: the frontend holds one small
//! blob only long enough for the pianist to listen and judge it. A row is
//! created solely when they explicitly choose “Keep after verdict”. The audio
//! bytes live under app-data/rep-replays; this module owns metadata and links
//! the take to the exact physical attempt returned by the judged rep write.

use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

use super::Store;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct RepReplayMeta {
    pub id: i64,
    pub rep_block_id: i64,
    pub attempt_id: Option<i64>,
    pub mime_type: String,
    pub duration_ms: u64,
    pub byte_len: u64,
    pub verdict: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RepReplaySaveInput {
    pub rep_block_id: i64,
    pub attempt_id: i64,
    pub mime_type: String,
    pub duration_ms: u64,
    pub bytes_base64: String,
}

#[derive(Debug, Clone)]
pub(crate) struct RepReplayFileRow {
    pub id: i64,
    pub rel_path: String,
    pub content_hash: String,
    pub byte_len: u64,
}

pub(crate) struct RepReplayInsert<'a> {
    pub block_id: i64,
    pub attempt_id: i64,
    pub rel_path: &'a str,
    pub mime_type: &'a str,
    pub duration_ms: u64,
    pub byte_len: u64,
    pub content_hash: &'a str,
}

impl Store {
    #[cfg(test)]
    pub(crate) fn rep_replay_test_seed(&self) -> rusqlite::Result<(i64, i64)> {
        let piece = self.upsert_piece(&super::model::ScanPiece {
            folder_path: "/scores/replay-command".into(),
            title: "Replay command".into(),
            composer: None,
            xml_path: None,
            pdf_path: None,
        })?;
        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        let block: i64 = conn.query_row(
            "INSERT INTO rep_block
             (piece_id,m_start,m_end,label,status,focus,use_metronome)
             VALUES (?1,1,2,'Tone','open','phrasing',0) RETURNING id",
            [piece],
            |row| row.get(0),
        )?;
        conn.execute(
            "INSERT INTO rep(block_id,bpm,verdict) VALUES (?1,0,'clean')",
            [block],
        )?;
        Ok((block, conn.last_insert_rowid()))
    }

    pub(crate) fn rep_replay_attempt_exists(
        &self,
        block_id: i64,
        attempt_id: i64,
    ) -> rusqlite::Result<bool> {
        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM rep WHERE id=?1 AND block_id=?2)",
            params![attempt_id, block_id],
            |row| row.get(0),
        )
    }

    pub(crate) fn rep_replay_for_attempt(
        &self,
        block_id: i64,
        attempt_id: i64,
    ) -> rusqlite::Result<Option<RepReplayMeta>> {
        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        conn.query_row(
            "SELECT rr.id,rr.rep_block_id,rr.attempt_id,rr.mime_type,
                    rr.duration_ms,rr.byte_len,r.verdict,rr.created_at
             FROM rep_replay rr
             LEFT JOIN rep r ON r.id=rr.attempt_id
             WHERE rr.rep_block_id=?1 AND rr.attempt_id=?2",
            params![block_id, attempt_id],
            |row| {
                let created_at: String = row.get(7)?;
                let duration_ms: i64 = row.get(4)?;
                let byte_len: i64 = row.get(5)?;
                Ok(RepReplayMeta {
                    id: row.get(0)?,
                    rep_block_id: row.get(1)?,
                    attempt_id: row.get(2)?,
                    mime_type: row.get(3)?,
                    duration_ms: u64::try_from(duration_ms).unwrap_or(0),
                    byte_len: u64::try_from(byte_len).unwrap_or(0),
                    verdict: row.get(6)?,
                    created_at: super::model::sqlite_ts_to_rfc3339(&created_at),
                })
            },
        )
        .optional()
    }

    pub(crate) fn rep_replay_insert(
        &self,
        input: RepReplayInsert<'_>,
    ) -> rusqlite::Result<RepReplayMeta> {
        let mut conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        let tx = conn.transaction()?;
        let exists: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM rep_block WHERE id=?1)",
            [input.block_id],
            |row| row.get(0),
        )?;
        if !exists {
            return Err(rusqlite::Error::QueryReturnedNoRows);
        }
        // Never infer "latest": another voice/button write could land while
        // audio encoding or disk I/O is in flight. The caller supplies the
        // exact attempt identity returned by its successful `rep_check`, and
        // this transaction proves it belongs to the requested block.
        let verdict: String = tx.query_row(
            "SELECT verdict FROM rep WHERE id=?1 AND block_id=?2",
            params![input.attempt_id, input.block_id],
            |row| row.get(0),
        )?;
        let id: i64 = tx.query_row(
            "INSERT INTO rep_replay
             (rep_block_id,attempt_id,rel_path,mime_type,duration_ms,byte_len,content_hash)
            VALUES (?1,?2,?3,?4,?5,?6,?7) RETURNING id",
            params![
                input.block_id,
                input.attempt_id,
                input.rel_path,
                input.mime_type,
                i64::try_from(input.duration_ms).unwrap_or(i64::MAX),
                i64::try_from(input.byte_len).unwrap_or(i64::MAX),
                input.content_hash,
            ],
            |row| row.get(0),
        )?;
        let created_at: String = tx.query_row(
            "SELECT created_at FROM rep_replay WHERE id=?1",
            [id],
            |row| row.get(0),
        )?;
        tx.commit()?;
        Ok(RepReplayMeta {
            id,
            rep_block_id: input.block_id,
            attempt_id: Some(input.attempt_id),
            mime_type: input.mime_type.to_string(),
            duration_ms: input.duration_ms,
            byte_len: input.byte_len,
            verdict: Some(verdict),
            created_at: super::model::sqlite_ts_to_rfc3339(&created_at),
        })
    }

    pub fn rep_replay_list(&self, block_id: i64) -> rusqlite::Result<Vec<RepReplayMeta>> {
        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        let mut stmt = conn.prepare(
            "SELECT rr.id,rr.rep_block_id,rr.attempt_id,rr.mime_type,
                    rr.duration_ms,rr.byte_len,r.verdict,rr.created_at
             FROM rep_replay rr
             LEFT JOIN rep r ON r.id=rr.attempt_id
             WHERE rr.rep_block_id=?1 ORDER BY rr.id DESC",
        )?;
        let rows = stmt.query_map([block_id], |row| {
            let created_at: String = row.get(7)?;
            let duration_ms: i64 = row.get(4)?;
            let byte_len: i64 = row.get(5)?;
            Ok(RepReplayMeta {
                id: row.get(0)?,
                rep_block_id: row.get(1)?,
                attempt_id: row.get(2)?,
                mime_type: row.get(3)?,
                duration_ms: u64::try_from(duration_ms).unwrap_or(0),
                byte_len: u64::try_from(byte_len).unwrap_or(0),
                verdict: row.get(6)?,
                created_at: super::model::sqlite_ts_to_rfc3339(&created_at),
            })
        })?;
        rows.collect()
    }

    pub(crate) fn rep_replay_file(&self, id: i64) -> rusqlite::Result<Option<RepReplayFileRow>> {
        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        conn.query_row(
            "SELECT id,rel_path,content_hash,byte_len FROM rep_replay WHERE id=?1",
            [id],
            |row| {
                let byte_len: i64 = row.get(3)?;
                Ok(RepReplayFileRow {
                    id: row.get(0)?,
                    rel_path: row.get(1)?,
                    content_hash: row.get(2)?,
                    byte_len: u64::try_from(byte_len).unwrap_or(0),
                })
            },
        )
        .optional()
    }

    /// Files referenced by durable replay metadata. Startup reconciliation
    /// uses this exact set rather than guessing from filenames, and never
    /// removes one of these rows automatically when its file is unavailable.
    pub(crate) fn rep_replay_files(&self) -> rusqlite::Result<Vec<RepReplayFileRow>> {
        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        let mut stmt =
            conn.prepare("SELECT id,rel_path,content_hash,byte_len FROM rep_replay ORDER BY id")?;
        let rows = stmt.query_map([], |row| {
            let byte_len: i64 = row.get(3)?;
            Ok(RepReplayFileRow {
                id: row.get(0)?,
                rel_path: row.get(1)?,
                content_hash: row.get(2)?,
                byte_len: u64::try_from(byte_len).unwrap_or(0),
            })
        })?;
        rows.collect()
    }

    pub(crate) fn rep_replay_delete_row(&self, id: i64) -> rusqlite::Result<bool> {
        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        Ok(conn.execute("DELETE FROM rep_replay WHERE id=?1", [id])? == 1)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn opened_store() -> (Store, i64) {
        let store = Store::open(":memory:").unwrap();
        let piece = store
            .upsert_piece(&crate::store::model::ScanPiece {
                folder_path: "/scores/test".into(),
                title: "Test".into(),
                composer: None,
                xml_path: None,
                pdf_path: None,
            })
            .unwrap();
        let block = store
            .conn
            .lock()
            .unwrap()
            .query_row(
                "INSERT INTO rep_block
                 (piece_id,m_start,m_end,label,status,focus,use_metronome)
                 VALUES (?1,1,2,'Sound','open','phrasing',0) RETURNING id",
                [piece],
                |row| row.get(0),
            )
            .unwrap();
        (store, block)
    }

    #[test]
    fn kept_take_links_to_exact_attempt_and_lists_newest_first() {
        let (store, block) = opened_store();
        let first_attempt = {
            let conn = store.conn.lock().unwrap();
            conn.execute(
                "INSERT INTO rep(block_id,bpm,verdict) VALUES (?1,0,'clean')",
                [block],
            )
            .unwrap();
            conn.last_insert_rowid()
        };
        let second_attempt = {
            let conn = store.conn.lock().unwrap();
            conn.execute(
                "INSERT INTO rep(block_id,bpm,verdict) VALUES (?1,0,'flawed')",
                [block],
            )
            .unwrap();
            conn.last_insert_rowid()
        };
        let first = store
            .rep_replay_insert(RepReplayInsert {
                block_id: block,
                attempt_id: first_attempt,
                rel_path: "rep-replays/a.webm",
                mime_type: "audio/webm",
                duration_ms: 1200,
                byte_len: 20,
                content_hash: &"a".repeat(64),
            })
            .unwrap();
        assert_eq!(first.attempt_id, Some(first_attempt));
        assert_eq!(first.verdict.as_deref(), Some("clean"));
        assert_ne!(first.attempt_id, Some(second_attempt));
        let second = store
            .rep_replay_insert(RepReplayInsert {
                block_id: block,
                attempt_id: second_attempt,
                rel_path: "rep-replays/b.webm",
                mime_type: "audio/webm",
                duration_ms: 900,
                byte_len: 12,
                content_hash: &"b".repeat(64),
            })
            .unwrap();
        assert_eq!(
            store
                .rep_replay_list(block)
                .unwrap()
                .iter()
                .map(|row| row.id)
                .collect::<Vec<_>>(),
            vec![second.id, first.id],
        );
    }

    #[test]
    fn metadata_delete_is_idempotent_at_command_boundary() {
        let (store, block) = opened_store();
        let row = store
            .rep_replay_insert(RepReplayInsert {
                block_id: block,
                attempt_id: {
                    let conn = store.conn.lock().unwrap();
                    conn.execute(
                        "INSERT INTO rep(block_id,bpm,verdict) VALUES (?1,0,'flawed')",
                        [block],
                    )
                    .unwrap();
                    conn.last_insert_rowid()
                },
                rel_path: "rep-replays/a.webm",
                mime_type: "audio/webm",
                duration_ms: 100,
                byte_len: 5,
                content_hash: &"c".repeat(64),
            })
            .unwrap();
        assert!(store.rep_replay_delete_row(row.id).unwrap());
        assert!(!store.rep_replay_delete_row(row.id).unwrap());
    }

    #[test]
    fn exact_attempt_must_belong_to_requested_block() {
        let (store, block) = opened_store();
        let (other_block, foreign_attempt) = {
            let conn = store.conn.lock().unwrap();
            let piece_id: i64 = conn
                .query_row(
                    "SELECT piece_id FROM rep_block WHERE id=?1",
                    [block],
                    |row| row.get(0),
                )
                .unwrap();
            let other_block: i64 = conn
                .query_row(
                    "INSERT INTO rep_block
                     (piece_id,m_start,m_end,label,status,focus,use_metronome)
                     VALUES (?1,3,4,'Other','open','phrasing',0) RETURNING id",
                    [piece_id],
                    |row| row.get(0),
                )
                .unwrap();
            conn.execute(
                "INSERT INTO rep(block_id,bpm,verdict) VALUES (?1,0,'clean')",
                [block],
            )
            .unwrap();
            (other_block, conn.last_insert_rowid())
        };
        assert!(store
            .rep_replay_insert(RepReplayInsert {
                block_id: other_block,
                attempt_id: foreign_attempt,
                rel_path: "rep-replays/wrong.webm",
                mime_type: "audio/webm",
                duration_ms: 100,
                byte_len: 5,
                content_hash: &"d".repeat(64),
            })
            .is_err());
    }
}
