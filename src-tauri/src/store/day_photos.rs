//! A3: one row per LOCAL calendar day that has a practice photo.
//!
//! The IMAGE never enters the database. The row carries the day key, the path
//! relative to the app data dir, a SHA-256 of the full JPEG bytes, and when it
//! was created; the bytes live in `app_data_dir()/day-photos/`. That split is a
//! schema-v15 decision (spec: "Images are files under app data, never DB blobs")
//! and it keeps the durable practice database small enough to back up in one
//! copy.
//!
//! This module owns the ROW only. The filesystem half lives in the `day_photo_*`
//! commands in `lib.rs`, because resolving `app_data_dir()` needs an `AppHandle`
//! and `Store` deliberately knows nothing about Tauri (same split as
//! `score_page_image`).

use rusqlite::OptionalExtension;
use serde::Serialize;
use sha2::{Digest, Sha256};

use super::practice_v2::invalid;
use super::Store;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DayPhotoRow {
    /// `YYYY-MM-DD`, local.
    pub day: String,
    /// Relative to the app data dir — never absolute, so a restored backup on a
    /// different machine still resolves.
    pub rel_path: String,
    /// SHA-256 hex of the full JPEG bytes.
    pub content_hash: String,
    pub created_at: String,
}

/// SHA-256 as lowercase hex.
pub fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn checked_day(day: &str) -> rusqlite::Result<&str> {
    let day = day.trim();
    if !crate::date::is_valid(day) {
        return Err(invalid("day must be a valid YYYY-MM-DD local date"));
    }
    Ok(day)
}

impl Store {
    /// Insert or replace the row for `day`.
    pub(crate) fn day_photo_upsert(
        &self,
        day: &str,
        rel_path: &str,
        content_hash: &str,
    ) -> rusqlite::Result<()> {
        let day = checked_day(day)?;
        let conn = self
            .conn
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        conn.execute(
            "INSERT INTO day_photo (day,rel_path,content_hash,created_at)
             VALUES (?1,?2,?3,datetime('now'))
             ON CONFLICT(day) DO UPDATE SET
               rel_path=excluded.rel_path,
               content_hash=excluded.content_hash,
               created_at=excluded.created_at",
            rusqlite::params![day, rel_path, content_hash],
        )?;
        Ok(())
    }

    pub(crate) fn day_photo_row(&self, day: &str) -> rusqlite::Result<Option<DayPhotoRow>> {
        let day = checked_day(day)?;
        let conn = self
            .conn
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        conn.query_row(
            "SELECT day,rel_path,content_hash,created_at FROM day_photo WHERE day=?1",
            [day],
            |row| {
                Ok(DayPhotoRow {
                    day: row.get(0)?,
                    rel_path: row.get(1)?,
                    content_hash: row.get(2)?,
                    created_at: row.get(3)?,
                })
            },
        )
        .optional()
    }

    pub(crate) fn day_photo_rows(
        &self,
        from: &str,
        to: &str,
    ) -> rusqlite::Result<Vec<DayPhotoRow>> {
        let from = checked_day(from)?;
        let to = checked_day(to)?;
        let conn = self
            .conn
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let mut stmt = conn.prepare(
            "SELECT day,rel_path,content_hash,created_at FROM day_photo
             WHERE day BETWEEN ?1 AND ?2 ORDER BY day ASC",
        )?;
        let rows = stmt.query_map(rusqlite::params![from, to], |row| {
            Ok(DayPhotoRow {
                day: row.get(0)?,
                rel_path: row.get(1)?,
                content_hash: row.get(2)?,
                created_at: row.get(3)?,
            })
        })?;
        rows.collect()
    }

    /// Idempotent: deleting a day that was never photographed is a no-op.
    pub(crate) fn day_photo_delete_row(&self, day: &str) -> rusqlite::Result<()> {
        let day = checked_day(day)?;
        let conn = self
            .conn
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        conn.execute("DELETE FROM day_photo WHERE day=?1", [day])?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::Store;

    #[test]
    fn a_saved_photo_round_trips_by_day() {
        let store = Store::open(":memory:").expect("store");
        store
            .day_photo_upsert("2026-08-22", "day-photos/2026-08-22.jpg", "abc123")
            .expect("upsert");
        let row = store
            .day_photo_row("2026-08-22")
            .expect("read")
            .expect("row");
        assert_eq!(row.day, "2026-08-22");
        assert_eq!(row.rel_path, "day-photos/2026-08-22.jpg");
        assert_eq!(row.content_hash, "abc123");
        assert!(!row.created_at.is_empty());
    }

    #[test]
    fn re_saving_a_day_replaces_it_rather_than_stacking_rows() {
        let store = Store::open(":memory:").expect("store");
        store
            .day_photo_upsert("2026-08-22", "day-photos/2026-08-22.jpg", "first")
            .expect("upsert");
        store
            .day_photo_upsert("2026-08-22", "day-photos/2026-08-22.jpg", "second")
            .expect("re-upsert");
        assert_eq!(
            store
                .day_photo_row("2026-08-22")
                .unwrap()
                .unwrap()
                .content_hash,
            "second"
        );
        assert_eq!(
            store
                .day_photo_rows("2026-08-01", "2026-08-31")
                .unwrap()
                .len(),
            1
        );
    }

    #[test]
    fn a_range_read_returns_only_days_inside_it_oldest_first() {
        let store = Store::open(":memory:").expect("store");
        for day in ["2026-08-10", "2026-08-22", "2026-09-02"] {
            store
                .day_photo_upsert(day, &format!("day-photos/{day}.jpg"), "h")
                .expect("upsert");
        }
        let rows = store
            .day_photo_rows("2026-08-01", "2026-08-31")
            .expect("rows");
        assert_eq!(
            rows.iter().map(|r| r.day.as_str()).collect::<Vec<_>>(),
            vec!["2026-08-10", "2026-08-22"]
        );
    }

    #[test]
    fn a_day_with_no_photo_is_none_not_an_error() {
        let store = Store::open(":memory:").expect("store");
        assert!(store.day_photo_row("2026-08-22").expect("read").is_none());
        assert!(store
            .day_photo_rows("2026-08-01", "2026-08-31")
            .unwrap()
            .is_empty());
    }

    #[test]
    fn deleting_a_day_removes_its_row() {
        let store = Store::open(":memory:").expect("store");
        store
            .day_photo_upsert("2026-08-22", "p", "h")
            .expect("upsert");
        store.day_photo_delete_row("2026-08-22").expect("delete");
        assert!(store.day_photo_row("2026-08-22").expect("read").is_none());
        // Deleting a day that was never photographed is a no-op, not an error.
        store
            .day_photo_delete_row("2026-08-22")
            .expect("idempotent delete");
    }

    #[test]
    fn an_invalid_day_key_is_rejected_before_it_reaches_the_filesystem() {
        let store = Store::open(":memory:").expect("store");
        assert!(store
            .day_photo_upsert("../../etc/passwd", "p", "h")
            .is_err());
        assert!(store.day_photo_upsert("2026-13-99", "p", "h").is_err());
        assert!(store.day_photo_row("not-a-date").is_err());
    }

    #[test]
    fn the_content_hash_is_stable_and_content_addressed() {
        assert_eq!(sha256_hex(b"hello"), sha256_hex(b"hello"));
        assert_ne!(sha256_hex(b"hello"), sha256_hex(b"hello!"));
        assert_eq!(sha256_hex(b"hello").len(), 64);
    }
}
