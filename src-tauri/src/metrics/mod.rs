//! Derived-metrics layer (Task 9).
//!
//! Everything here is DERIVED from the durable `event` log + the canonical graph
//! — nothing is stored. The core metric functions are PURE (no `Store`, no I/O):
//! they take already-loaded slices so they can be unit-tested in isolation and can
//! never disagree with the graph they were handed. [`progress_summary`] is the one
//! impure assembler: it loads the inputs via [`Store`] and calls the pure functions.

use std::collections::{BTreeMap, HashMap};

use crate::date::Date;
use crate::store::model::{
    BlockMeta, Event, FocusTime, ProgressSummary, Region, RegionMastery, Rep,
};
use crate::store::Store;

/// A gap between two consecutive events longer than this (seconds) means the
/// pianist stepped away — that gap contributes zero focused time. Shorter gaps
/// count in full.
pub const IDLE_THRESHOLD_SECS: i64 = 120;

fn is_practice_event(event: &Event) -> bool {
    matches!(
        event.kind.as_str(),
        "rep_open" | "rep" | "verdict" | "tempo_change"
    )
}

/// Sum the gaps between consecutive events, counting only gaps at or under the
/// idle threshold (a longer gap means the pianist stepped away — not focused
/// time, so it contributes 0).
pub fn focused_seconds(events: &[Event]) -> u64 {
    let mut ts: Vec<i64> = events
        .iter()
        .filter(|event| is_practice_event(event))
        .filter_map(|event| parse_ts_secs(&event.ts))
        .collect();
    ts.sort_unstable();
    ts.windows(2)
        .map(|w| w[1] - w[0])
        .map(|g| if (0..=IDLE_THRESHOLD_SECS).contains(&g) { g } else { 0 })
        .sum::<i64>() as u64
}

/// The current practice streak: consecutive calendar days ending at the most
/// recent practice day. Dates are `"YYYY-MM-DD"`; duplicates and gaps are handled
/// (a gap breaks the streak). Returns 0 for no days.
pub fn streak(session_days: &[String]) -> u32 {
    let mut days: Vec<i64> = session_days
        .iter()
        .filter_map(|date| Date::parse(date).map(Date::days_since_epoch))
        .collect();
    days.sort_unstable();
    days.dedup();
    let Some(&latest) = days.last() else {
        return 0;
    };
    let mut count = 1u32;
    let mut expected = latest - 1;
    for &d in days.iter().rev().skip(1) {
        if d == expected {
            count += 1;
            expected -= 1;
        } else {
            break;
        }
    }
    count
}

/// The fastest tempo (bpm) at which a rep landed **clean** — the best tempo
/// actually achieved. `None` when no clean rep exists.
pub fn best_tempo_reached(reps: &[Rep]) -> Option<f64> {
    reps.iter()
        .filter(|r| r.verdict == "clean")
        .map(|r| r.bpm)
        .fold(None, |acc, b| Some(acc.map_or(b, |a: f64| a.max(b))))
}

/// Per-region mastery: for each region, how many blocks it holds, how many reps
/// landed there, the clean fraction, the best clean tempo, and the last-practiced
/// timestamp. Regions with no blocks still appear (zeroed).
pub fn per_region_mastery(
    regions: &[Region],
    blocks: &[BlockMeta],
    reps: &[Rep],
) -> Vec<RegionMastery> {
    // block_id → region_id, for blocks that belong to a region.
    let region_of: HashMap<i64, i64> = blocks
        .iter()
        .filter_map(|b| b.region_id.map(|r| (b.block_id, r)))
        .collect();

    regions
        .iter()
        .map(|region| {
            let block_count = blocks
                .iter()
                .filter(|b| b.region_id == Some(region.id))
                .count() as u32;
            let region_reps: Vec<&Rep> = reps
                .iter()
                .filter(|r| region_of.get(&r.block_id) == Some(&region.id))
                .collect();
            let total = region_reps.len() as u32;
            let clean = region_reps.iter().filter(|r| r.verdict == "clean").count() as u32;
            let clean_ratio = if total > 0 {
                clean as f64 / total as f64
            } else {
                0.0
            };
            let cleaned: Vec<Rep> = region_reps.iter().map(|r| (*r).clone()).collect();
            let best_bpm = best_tempo_reached(&cleaned);
            let last_practiced = region_reps.iter().map(|r| r.ts.clone()).max();
            RegionMastery {
                region_id: region.id,
                name: region.name.clone(),
                blocks: block_count,
                reps: total,
                clean_ratio,
                best_bpm,
                last_practiced,
            }
        })
        .collect()
}

/// Focused practice time split by the practice `focus` of the block each event
/// belongs to. Events carry their `block_id` in the payload; each focus's events
/// are run through the same [`focused_seconds`] gap heuristic. Sorted by focus.
pub fn time_by_focus(events: &[Event], blocks: &[BlockMeta]) -> Vec<FocusTime> {
    let focus_of: HashMap<i64, &str> =
        blocks.iter().map(|b| (b.block_id, b.focus.as_str())).collect();
    let mut by_focus: BTreeMap<String, Vec<Event>> = BTreeMap::new();
    for e in events {
        if !is_practice_event(e) {
            continue;
        }
        if let Some(bid) = e.payload["block_id"].as_i64() {
            if let Some(focus) = focus_of.get(&bid) {
                by_focus.entry((*focus).to_string()).or_default().push(e.clone());
            }
        }
    }
    by_focus
        .into_iter()
        .map(|(focus, evs)| FocusTime {
            focus,
            seconds: focused_seconds(&evs),
        })
        .collect()
}

/// Assemble a piece's [`ProgressSummary`] from the durable event log + canonical
/// graph. The one impure entry point: it loads every input via `store`, then
/// delegates to the pure functions above.
pub fn progress_summary(store: &Store, piece_id: i64) -> rusqlite::Result<ProgressSummary> {
    let events = store.events_for_piece(piece_id)?;
    let regions = store.region_list(piece_id)?;
    let blocks = store.blocks_meta(piece_id)?;
    let reps = store.reps_for_piece(piece_id)?;

    // Distinct practice days for the piece (event date component), for the streak.
    let mut days: Vec<String> = events
        .iter()
        .filter(|event| is_practice_event(event))
        .filter_map(|e| e.ts.get(0..10).map(str::to_string))
        .collect();
    days.sort();
    days.dedup();

    Ok(ProgressSummary {
        piece_id,
        focused_seconds: focused_seconds(&events),
        per_region_mastery: per_region_mastery(&regions, &blocks, &reps),
        streak: streak(&days),
        best_tempo_reached: best_tempo_reached(&reps),
        time_by_focus: time_by_focus(&events, &blocks),
    })
}

/// Parse a SQLite-native timestamp (`"YYYY-MM-DD HH:MM:SS"`, UTC) into seconds
/// since the Unix epoch. As a test convenience it also accepts a bare integer
/// string (already-epoch seconds); real event rows are always the datetime form.
fn parse_ts_secs(ts: &str) -> Option<i64> {
    let ts = ts.trim().trim_end_matches('Z');
    // Bare epoch-seconds form (tests): a plain integer.
    if let Ok(secs) = ts.parse::<i64>() {
        return Some(secs);
    }
    // "YYYY-MM-DD[ T]HH:MM:SS"
    let (date, time) = ts.split_once(['T', ' '])?;
    let days = Date::parse(date)?.days_since_epoch();
    let mut parts = time.split(':');
    let h: i64 = parts.next()?.parse().ok()?;
    let m: i64 = parts.next()?.parse().ok()?;
    let s: i64 = parts.next()?.parse().ok()?;
    if parts.next().is_some() || !(0..=23).contains(&h) || !(0..=59).contains(&m) || !(0..=59).contains(&s) {
        return None;
    }
    Some(days * 86_400 + h * 3_600 + m * 60 + s)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn ev_at(secs: i64) -> Event {
        Event {
            id: 0,
            ts: secs.to_string(),
            session_id: None,
            piece_id: Some(1),
            kind: "rep".into(),
            payload: json!({}),
        }
    }

    fn events_at(secs: &[i64]) -> Vec<Event> {
        secs.iter().map(|s| ev_at(*s)).collect()
    }

    fn rep(block_id: i64, bpm: f64, verdict: &str, ts: &str) -> Rep {
        Rep {
            id: 0,
            block_id,
            ts: ts.into(),
            bpm,
            variant: None,
            verdict: verdict.into(),
            note: None,
        }
    }

    fn region(id: i64, name: &str) -> Region {
        Region {
            id,
            piece_id: 1,
            name: name.into(),
            m_start: 1,
            m_end: 8,
            kind: "section".into(),
            order: 0,
            color: None,
            pdf_anchor: None,
        }
    }

    fn block_meta(block_id: i64, region_id: Option<i64>, focus: &str) -> BlockMeta {
        BlockMeta {
            block_id,
            region_id,
            focus: focus.into(),
        }
    }

    #[test]
    fn focused_seconds_sums_gaps_under_idle_threshold() {
        // gaps of 30s, 45s, then a 10-min idle gap (excluded), then 20s
        let evs = events_at(&[0, 30, 75, 675, 695]); // seconds since epoch
        // 30 + 45 + (idle >120 → 0) + 20 = 95
        assert_eq!(focused_seconds(&evs), 95);
    }

    #[test]
    fn focused_seconds_is_empty_for_under_two_events() {
        assert_eq!(focused_seconds(&[]), 0);
        assert_eq!(focused_seconds(&events_at(&[42])), 0);
    }

    #[test]
    fn admin_events_do_not_create_focused_time() {
        let mut first = ev_at(0);
        first.kind = "goal_change".into();
        let mut second = ev_at(60);
        second.kind = "block_edit".into();
        assert_eq!(focused_seconds(&[first, second]), 0);
    }

    #[test]
    fn focused_seconds_parses_real_sqlite_timestamps() {
        // Real event rows carry "YYYY-MM-DD HH:MM:SS"; a 90s gap counts, a
        // cross-day 10-minute gap does not.
        let mut e1 = ev_at(0);
        e1.ts = "2026-07-12 10:00:00".into();
        let mut e2 = ev_at(0);
        e2.ts = "2026-07-12 10:01:30".into(); // +90s
        let mut e3 = ev_at(0);
        e3.ts = "2026-07-12 10:11:30".into(); // +600s → idle → 0
        assert_eq!(focused_seconds(&[e1, e2, e3]), 90);
    }

    #[test]
    fn focused_seconds_rejects_invalid_or_trailing_clock_components() {
        let mut valid = ev_at(0);
        valid.ts = "2026-07-12 23:59:00".into();
        let invalid = [
            "2026-07-12 24:00:00",
            "2026-07-12 23:60:00",
            "2026-07-12 23:59:60",
            "2026-07-12 23:59:30:99",
        ];
        for timestamp in invalid {
            let mut bad = ev_at(0);
            bad.ts = timestamp.into();
            assert_eq!(focused_seconds(&[valid.clone(), bad]), 0, "{timestamp}");
        }
    }

    #[test]
    fn streak_counts_consecutive_calendar_days_back_from_latest() {
        assert_eq!(
            streak(&["2026-07-10".into(), "2026-07-11".into(), "2026-07-12".into()]),
            3
        );
        assert_eq!(
            streak(&["2026-07-08".into(), "2026-07-10".into(), "2026-07-11".into()]),
            2
        );
    }

    #[test]
    fn streak_handles_duplicates_month_rollover_and_empty() {
        assert_eq!(streak(&[]), 0);
        // Duplicates collapse; a lone day is a streak of 1.
        assert_eq!(streak(&["2026-07-12".into(), "2026-07-12".into()]), 1);
        // Across a month boundary: Jul 31 → Aug 1 → Aug 2 is 3 consecutive days.
        assert_eq!(
            streak(&["2026-07-31".into(), "2026-08-01".into(), "2026-08-02".into()]),
            3
        );
    }

    #[test]
    fn best_tempo_reached_is_fastest_clean_rep() {
        let reps = vec![
            rep(1, 80.0, "clean", "2026-07-12 10:00:00"),
            rep(1, 96.0, "flawed", "2026-07-12 10:01:00"), // faster but not clean
            rep(1, 88.0, "clean", "2026-07-12 10:02:00"),
        ];
        assert_eq!(best_tempo_reached(&reps), Some(88.0));
        // No clean reps → None.
        assert_eq!(
            best_tempo_reached(&[rep(1, 100.0, "failed", "2026-07-12 10:00:00")]),
            None
        );
        assert_eq!(best_tempo_reached(&[]), None);
    }

    #[test]
    fn per_region_mastery_aggregates_clean_ratio_and_best_bpm_per_region() {
        let regions = vec![region(1, "Intro"), region(2, "Coda")];
        // block 10 → region 1, block 11 → region 1, block 20 → region 2, block 30 → no region
        let blocks = vec![
            block_meta(10, Some(1), "tempo"),
            block_meta(11, Some(1), "tempo"),
            block_meta(20, Some(2), "notes"),
            block_meta(30, None, "tempo"),
        ];
        let reps = vec![
            rep(10, 80.0, "clean", "2026-07-12 10:00:00"),
            rep(10, 84.0, "clean", "2026-07-12 10:01:00"),
            rep(11, 88.0, "flawed", "2026-07-12 10:05:00"), // region 1, not clean
            rep(20, 60.0, "clean", "2026-07-12 11:00:00"),
            rep(30, 200.0, "clean", "2026-07-12 12:00:00"), // unassigned block, ignored
        ];
        let out = per_region_mastery(&regions, &blocks, &reps);
        assert_eq!(out.len(), 2);

        let r1 = &out[0];
        assert_eq!(r1.region_id, 1);
        assert_eq!(r1.blocks, 2, "two blocks belong to region 1");
        assert_eq!(r1.reps, 3, "three reps across region 1's blocks");
        assert!((r1.clean_ratio - 2.0 / 3.0).abs() < 1e-9);
        assert_eq!(r1.best_bpm, Some(84.0), "fastest CLEAN rep in region 1");
        assert_eq!(r1.last_practiced.as_deref(), Some("2026-07-12 10:05:00"));

        let r2 = &out[1];
        assert_eq!(r2.region_id, 2);
        assert_eq!(r2.blocks, 1);
        assert_eq!(r2.reps, 1);
        assert_eq!(r2.clean_ratio, 1.0);
        assert_eq!(r2.best_bpm, Some(60.0));
    }

    #[test]
    fn per_region_mastery_zeroes_a_region_with_no_blocks() {
        let out = per_region_mastery(&[region(1, "Empty")], &[], &[]);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].blocks, 0);
        assert_eq!(out[0].reps, 0);
        assert_eq!(out[0].clean_ratio, 0.0);
        assert_eq!(out[0].best_bpm, None);
        assert_eq!(out[0].last_practiced, None);
    }

    #[test]
    fn time_by_focus_splits_focused_time_by_block_focus() {
        // Two tempo-block events 40s apart, two notes-block events 30s apart.
        let mk = |secs: i64, block_id: i64| {
            let mut e = ev_at(secs);
            e.payload = json!({ "block_id": block_id });
            e
        };
        let events = vec![mk(0, 10), mk(40, 10), mk(100, 20), mk(130, 20)];
        let blocks = vec![block_meta(10, Some(1), "tempo"), block_meta(20, Some(2), "notes")];
        let out = time_by_focus(&events, &blocks);
        // BTreeMap order: "notes" before "tempo".
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].focus, "notes");
        assert_eq!(out[0].seconds, 30);
        assert_eq!(out[1].focus, "tempo");
        assert_eq!(out[1].seconds, 40);
    }
}
