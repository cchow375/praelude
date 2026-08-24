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

/// Pending rollover-photo days live under this setting key as a JSON array
/// of `YYYY-MM-DD` strings, oldest first (F4 fix wave — was a single-slot
/// setting keyed `ritual.unphotographed_day` that a second rollover before
/// the next launch would silently clobber; this feature has never shipped,
/// so there is no old-shape value in the wild to migrate).
const RITUAL_PENDING_DAYS_SETTING: &str = "ritual.unphotographed_days";

/// A device left uncharged/unlaunched for months should not grow this
/// setting without bound. 14 days is generous for "how long could you
/// plausibly go without opening the app".
const MAX_PENDING_ROLLOVER_DAYS: usize = 14;

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

    // ── Rollover-photo prompt queue (F4 fix wave) ───────────────────────
    //
    // Originally a single setting SLOT holding one pending day, read-and-
    // cleared in one shot. Two defects, both real:
    //   (a) a second midnight rollover before the next launch overwrote the
    //       first day's slot — that day's ritual was gone for good.
    //   (b) the read-and-clear was DESTRUCTIVE at read time, so a crash (or
    //       React StrictMode's mount->unmount->remount double-invoke of the
    //       Shell mount effect in `npm run tauri dev`) could consume the
    //       setting on a call whose result was then discarded — again gone
    //       for good.
    // Fix: pending days are a capped, deduped JSON array, and the read is a
    // non-destructive PEEK. A day is cleared only by an explicit dismiss,
    // called once the user has actually acted on it (photographed or
    // skipped) — never merely by having been offered.

    /// The raw pending list, oldest first. Corrupt/missing JSON reads as
    /// empty rather than erroring — a malformed setting must never brick the
    /// app on launch.
    fn day_photo_pending_days(&self) -> rusqlite::Result<Vec<String>> {
        let Some(raw) = self.get_setting(RITUAL_PENDING_DAYS_SETTING)? else {
            return Ok(Vec::new());
        };
        Ok(serde_json::from_str(&raw).unwrap_or_default())
    }

    fn day_photo_write_pending_days(&self, days: &[String]) -> rusqlite::Result<()> {
        let raw = serde_json::to_string(days).unwrap_or_else(|_| "[]".to_string());
        self.set_setting(RITUAL_PENDING_DAYS_SETTING, &raw)
    }

    /// Record `day` as skipped-live by an unattended midnight rollover.
    /// Deduped; capped at `MAX_PENDING_ROLLOVER_DAYS` (oldest dropped first)
    /// so a device left idle for months can't grow this without bound.
    pub(crate) fn day_photo_prompt_add_pending(&self, day: &str) -> rusqlite::Result<()> {
        let day = checked_day(day)?.to_string();
        let mut days = self.day_photo_pending_days()?;
        if !days.iter().any(|existing| existing == &day) {
            days.push(day);
        }
        if days.len() > MAX_PENDING_ROLLOVER_DAYS {
            let overflow = days.len() - MAX_PENDING_ROLLOVER_DAYS;
            days.drain(0..overflow);
        }
        self.day_photo_write_pending_days(&days)
    }

    /// PEEK, non-destructive: the oldest pending day that has not already
    /// been photographed through the normal end-of-day flow, or `None`.
    /// Never mutates anything — callable any number of times with no risk
    /// of losing a day.
    pub(crate) fn day_photo_prompt_peek(&self) -> rusqlite::Result<Option<String>> {
        for day in self.day_photo_pending_days()? {
            // Already photographed some other way — no evidence gap to
            // fill, so skip it rather than re-offering it.
            if self.day_photo_row(&day)?.is_none() {
                return Ok(Some(day));
            }
        }
        Ok(None)
    }

    /// Consume exactly one pending day. Called once the user has actually
    /// acted on it (photographed or skipped) — idempotent, so dismissing a
    /// day that was never pending (e.g. a live, same-day end-of-session
    /// photo) is a harmless no-op.
    pub(crate) fn day_photo_prompt_dismiss(&self, day: &str) -> rusqlite::Result<()> {
        let day = checked_day(day)?.to_string();
        let mut days = self.day_photo_pending_days()?;
        days.retain(|existing| existing != &day);
        self.day_photo_write_pending_days(&days)
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

    #[test]
    fn no_pending_rollover_day_prompts_for_nothing() {
        let store = Store::open(":memory:").expect("store");
        assert_eq!(store.day_photo_prompt_peek().unwrap(), None);
    }

    #[test]
    fn f4_two_rollovers_before_a_launch_offer_both_days_in_order() {
        // Regression: the old single-slot setting meant the SECOND
        // add_pending clobbered the first day's slot, losing it for good.
        let store = Store::open(":memory:").expect("store");
        store.day_photo_prompt_add_pending("2026-08-21").unwrap();
        store.day_photo_prompt_add_pending("2026-08-22").unwrap();
        assert_eq!(
            store.day_photo_prompt_peek().unwrap(),
            Some("2026-08-21".to_string()),
            "the older day is offered first"
        );
        store.day_photo_prompt_dismiss("2026-08-21").unwrap();
        assert_eq!(
            store.day_photo_prompt_peek().unwrap(),
            Some("2026-08-22".to_string()),
            "the second day was never lost"
        );
    }

    #[test]
    fn f4_a_peek_that_is_never_acted_on_still_offers_the_day_next_launch() {
        // Regression: the old day_photo_prompt_take cleared the setting at
        // READ time, so a crash (or React StrictMode's mount/unmount/remount
        // double-invoke) between the read and the UI actually showing the
        // card could lose the day even though nothing was ever dismissed.
        let store = Store::open(":memory:").expect("store");
        store.day_photo_prompt_add_pending("2026-08-22").unwrap();
        // Peek as many times as a flaky mount effect likes — never mutates.
        for _ in 0..5 {
            assert_eq!(
                store.day_photo_prompt_peek().unwrap(),
                Some("2026-08-22".to_string())
            );
        }
    }

    #[test]
    fn f4_skip_and_photograph_each_clear_exactly_one_day() {
        let store = Store::open(":memory:").expect("store");
        store.day_photo_prompt_add_pending("2026-08-21").unwrap();
        store.day_photo_prompt_add_pending("2026-08-22").unwrap();

        // "Skip": the frontend calls dismiss with no photo taken.
        store.day_photo_prompt_dismiss("2026-08-21").unwrap();
        assert_eq!(
            store.day_photo_prompt_peek().unwrap(),
            Some("2026-08-22".to_string())
        );

        // "Photograph": a row now exists AND the frontend dismisses it.
        store
            .day_photo_upsert("2026-08-22", "day-photos/2026-08-22.jpg", "h")
            .unwrap();
        store.day_photo_prompt_dismiss("2026-08-22").unwrap();
        assert_eq!(store.day_photo_prompt_peek().unwrap(), None);
    }

    #[test]
    fn a_day_already_photographed_through_the_normal_flow_is_not_prompted() {
        let store = Store::open(":memory:").expect("store");
        store.day_photo_prompt_add_pending("2026-08-22").unwrap();
        store
            .day_photo_upsert("2026-08-22", "day-photos/2026-08-22.jpg", "h")
            .expect("upsert");
        assert_eq!(store.day_photo_prompt_peek().unwrap(), None);
    }

    #[test]
    fn adding_the_same_pending_day_twice_does_not_duplicate_it() {
        let store = Store::open(":memory:").expect("store");
        store.day_photo_prompt_add_pending("2026-08-22").unwrap();
        store.day_photo_prompt_add_pending("2026-08-22").unwrap();
        store.day_photo_prompt_dismiss("2026-08-22").unwrap();
        // If it had been duplicated, one dismiss would leave one behind.
        assert_eq!(store.day_photo_prompt_peek().unwrap(), None);
    }

    #[test]
    fn the_pending_queue_is_capped_dropping_the_oldest_day_first() {
        let store = Store::open(":memory:").expect("store");
        for day in 1..=16u32 {
            store
                .day_photo_prompt_add_pending(&format!("2026-01-{day:02}"))
                .unwrap();
        }
        // 16 added, capped at 14 -> the oldest two (01, 02) are gone.
        assert_eq!(
            store.day_photo_prompt_peek().unwrap(),
            Some("2026-01-03".to_string())
        );
    }

    #[test]
    fn dismissing_a_day_that_was_never_pending_is_a_harmless_no_op() {
        let store = Store::open(":memory:").expect("store");
        store.day_photo_prompt_add_pending("2026-08-22").unwrap();
        // A live, same-day end-of-session photo dismisses a day that was
        // never in the rollover queue at all.
        store.day_photo_prompt_dismiss("2026-08-23").unwrap();
        assert_eq!(
            store.day_photo_prompt_peek().unwrap(),
            Some("2026-08-22".to_string())
        );
    }
}
