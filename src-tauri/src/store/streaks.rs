//! A2: the GLOBAL day-streak read model.
//!
//! `metrics::streak` already exists but is piece-scoped in practice (it backs
//! `progress_summary`) and only ever counts the trailing run. This module is the
//! global, threshold-gated day source the Today and Calendar headers read: it
//! buckets sessions by LOCAL calendar day with `date(started_at,'localtime')` —
//! the same convention `history_days.rs` and `session_last_event_and_same_local_day`
//! use — sums each day's event-derived `metrics::focused_seconds`, and keeps only
//! the days that cleared the configured minute bar.
//!
//! Read-only. No migration, no new table, no write path: a streak is a fact about
//! events that already happened, and there is nowhere to store one even if
//! somebody wanted to grant it.

use std::collections::BTreeMap;

use rusqlite::Connection;
use serde::Serialize;

use super::Store;
use crate::date::Date;
use crate::metrics;

/// The default focused-minute bar a local day must clear to join the streak
/// (spec A2). Mirrored by `settings::snapshot`'s `streak.threshold_minutes`.
pub const DEFAULT_STREAK_THRESHOLD_MINUTES: i64 = 10;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct StreakSummary {
    /// Consecutive qualifying LOCAL days ending today (or yesterday, while
    /// today is still in progress). Zero when the last qualifying day is older.
    pub current_days: i64,
    /// The longest qualifying run ever recorded.
    pub best_days: i64,
    /// Echoed back so the UI never has to guess what bar produced these numbers.
    pub threshold_minutes: i64,
    /// Today's event-derived focused seconds — the "you are N minutes away" fact.
    pub today_focused_seconds: i64,
}

/// `(local day, session id)` for every session on record, oldest first.
fn sessions_by_local_day(conn: &Connection) -> rusqlite::Result<Vec<(String, i64)>> {
    let mut stmt = conn
        .prepare("SELECT date(started_at,'localtime') AS day, id FROM session ORDER BY day, id")?;
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
    })?;
    rows.collect()
}

/// The longest stretch of consecutive days in an unsorted day list.
/// `metrics::streak` cannot answer this — it only counts the run ending at the
/// latest day — so `best_days` needs its own walk.
pub fn longest_run(days: &[String]) -> i64 {
    let mut ordinals: Vec<i64> = days
        .iter()
        .filter_map(|day| Date::parse(day).map(Date::days_since_epoch))
        .collect();
    ordinals.sort_unstable();
    ordinals.dedup();
    let mut best = 0i64;
    let mut run = 0i64;
    let mut previous: Option<i64> = None;
    for ordinal in ordinals {
        run = match previous {
            Some(prev) if ordinal == prev + 1 => run + 1,
            _ => 1,
        };
        best = best.max(run);
        previous = Some(ordinal);
    }
    best
}

impl Store {
    /// Today's LOCAL calendar date, read through SQLite so it uses exactly the
    /// same clock and timezone rule as every day-bucketing query in the app.
    pub(crate) fn today_local(&self) -> rusqlite::Result<String> {
        let conn = self
            .conn
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        conn.query_row("SELECT date('now','localtime')", [], |row| row.get(0))
    }

    /// Consecutive LOCAL days whose event-derived focused time cleared
    /// `threshold_minutes`, plus the best such run and today's raw seconds.
    pub(crate) fn streak_summary(&self, threshold_minutes: i64) -> rusqlite::Result<StreakSummary> {
        let threshold_minutes = threshold_minutes.clamp(1, 1_440);
        let threshold_seconds = threshold_minutes.saturating_mul(60);
        let today = self.today_local()?;

        let pairs = {
            let conn = self
                .conn
                .lock()
                .unwrap_or_else(|poison| poison.into_inner());
            sessions_by_local_day(&conn)?
        };

        // Outside the lock above: `events_for_session` takes its own lock and
        // `std::sync::Mutex` is not reentrant (same discipline as
        // `Store::history_days`).
        let mut focused_by_day: BTreeMap<String, i64> = BTreeMap::new();
        for (day, session_id) in pairs {
            let events = self.events_for_session(session_id)?;
            *focused_by_day.entry(day).or_insert(0) += metrics::focused_seconds(&events) as i64;
        }

        let qualifying: Vec<String> = focused_by_day
            .iter()
            .filter(|(_, seconds)| **seconds >= threshold_seconds)
            .map(|(day, _)| day.clone())
            .collect();

        // Backward walk: the run must reach today (or yesterday, so a streak is
        // not declared dead before today has had its chance). A forward walk
        // would report a three-week-old run as "current" — fake progress, which
        // the earned-only law forbids.
        let anchor_is_live = qualifying
            .last()
            .and_then(|day| Date::parse(day))
            .zip(Date::parse(&today))
            .map(|(last, now)| {
                let gap = now.days_since_epoch() - last.days_since_epoch();
                (0..=1).contains(&gap)
            })
            .unwrap_or(false);

        Ok(StreakSummary {
            current_days: if anchor_is_live {
                i64::from(metrics::streak(&qualifying))
            } else {
                0
            },
            best_days: longest_run(&qualifying),
            threshold_minutes,
            today_focused_seconds: focused_by_day.get(&today).copied().unwrap_or(0),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::Store;

    /// Seed one session on `day` (LOCAL) with `count` practice events spaced
    /// 60s apart — under IDLE_THRESHOLD_SECS, so every gap counts as focus.
    /// `count` events therefore yield (count - 1) * 60 focused seconds.
    ///
    /// NOTE: the plan's original snippet (a) called a `set_session_started_at`
    /// method that does not exist on `Store`, and (b) wrote through
    /// `insert_session_event_at`, which only appends to the `session_event`
    /// feed table. `streak_summary` (via `Store::events_for_session` and
    /// `metrics::focused_seconds`) reads the CANONICAL `event` table instead —
    /// writing only to `session_event` left every seeded day at 0 focused
    /// seconds, which is why every test asserting a nonzero streak failed
    /// (the ones expecting 0 passed "by accident"). Fixed to seed the `event`
    /// table directly via `test_execute_batch`, the same pattern
    /// `history_days.rs`'s `seed_event` helper already uses.
    fn seed_day(store: &Store, day: &str, count: usize) {
        let sid = store
            .open_session_at(&format!("{day}T14:00:00"))
            .expect("open session");
        for index in 0..count {
            let ts = format!("{day}T14:{:02}:00", index);
            store
                .test_execute_batch(&format!(
                    "INSERT INTO event (ts, session_id, kind, payload) VALUES ('{ts}', {sid}, 'rep', '{{}}');"
                ))
                .expect("event");
        }
    }

    #[test]
    fn longest_run_counts_the_best_consecutive_stretch_not_the_last() {
        let days = vec![
            "2026-08-01".to_string(),
            "2026-08-02".to_string(),
            "2026-08-03".to_string(),
            // gap
            "2026-08-10".to_string(),
        ];
        assert_eq!(longest_run(&days), 3);
        assert_eq!(longest_run(&[]), 0);
        assert_eq!(longest_run(&["2026-08-01".to_string()]), 1);
    }

    #[test]
    fn a_day_joins_the_streak_only_once_it_clears_the_threshold() {
        // NOTE: the store constructor in the plan's original snippet
        // (`Store::open_in_memory()`) does not exist; the real in-memory
        // constructor used by every other store test module is
        // `Store::open(":memory:")`. Fixed here and in every test below.
        let store = Store::open(":memory:").expect("store");
        // 3 events = 120 focused seconds = 2 minutes. Below a 10-minute bar.
        seed_day(&store, "2026-08-22", 3);
        let out = store.streak_summary(10).expect("summary");
        assert_eq!(out.current_days, 0);
        assert_eq!(out.best_days, 0);
        assert_eq!(out.threshold_minutes, 10);
    }

    #[test]
    fn a_twenty_four_second_launch_poke_never_counts() {
        let store = Store::open(":memory:").expect("store");
        seed_day(&store, "2026-08-22", 2); // 60 focused seconds
        assert_eq!(store.streak_summary(10).expect("summary").best_days, 0);
    }

    #[test]
    fn consecutive_qualifying_local_days_form_the_current_run() {
        let store = Store::open(":memory:").expect("store");
        let today = store.today_local().expect("today");
        // NOTE: `Date::add_days` returns `Option<Date>` (it can fail outside
        // the four-digit year range), so the plan's original
        // `.add_days(-1).to_string()` does not compile. Fixed with `.unwrap()`.
        let yesterday = Date::parse(&today)
            .unwrap()
            .add_days(-1)
            .unwrap()
            .to_string();
        let two_back = Date::parse(&today)
            .unwrap()
            .add_days(-2)
            .unwrap()
            .to_string();
        let far = Date::parse(&today)
            .unwrap()
            .add_days(-9)
            .unwrap()
            .to_string();
        // 11 events = 600 focused seconds = exactly 10 minutes: the bar is >=.
        for day in [&today, &yesterday, &two_back, &far] {
            seed_day(&store, day, 11);
        }
        let out = store.streak_summary(10).expect("summary");
        assert_eq!(out.current_days, 3, "today + 2 back, the far day is a gap");
        assert_eq!(out.best_days, 3);
        assert_eq!(out.today_focused_seconds, 600);
    }

    #[test]
    fn a_stale_run_is_never_reported_as_current() {
        let store = Store::open(":memory:").expect("store");
        let today = Date::parse(&store.today_local().unwrap()).unwrap();
        for back in 5..9 {
            seed_day(&store, &today.add_days(-back).unwrap().to_string(), 11);
        }
        let out = store.streak_summary(10).expect("summary");
        assert_eq!(out.current_days, 0, "the run ended five days ago");
        assert_eq!(out.best_days, 4, "but it is still the best on record");
        assert_eq!(out.today_focused_seconds, 0);
    }

    #[test]
    fn an_empty_database_has_no_streak_and_no_visual_to_show() {
        let store = Store::open(":memory:").expect("store");
        let out = store.streak_summary(10).expect("summary");
        assert_eq!(
            out,
            StreakSummary {
                current_days: 0,
                best_days: 0,
                threshold_minutes: 10,
                today_focused_seconds: 0,
            }
        );
    }

    #[test]
    fn the_threshold_is_configurable_and_clamped() {
        let store = Store::open(":memory:").expect("store");
        seed_day(&store, &store.today_local().unwrap(), 3); // 120s = 2 min
        assert_eq!(store.streak_summary(1).expect("s").current_days, 1);
        assert_eq!(store.streak_summary(10).expect("s").current_days, 0);
        assert_eq!(store.streak_summary(0).expect("s").threshold_minutes, 1);
        assert_eq!(
            store.streak_summary(9_999).expect("s").threshold_minutes,
            1_440
        );
    }
}
