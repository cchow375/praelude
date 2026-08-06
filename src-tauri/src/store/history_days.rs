//! Task B1: pure READ commands over existing tables — day-bucketed History/Calendar
//! evidence. Every day boundary here is a LOCAL calendar day via SQLite's
//! `date(ts,'localtime')`, the same convention `session_last_event_and_same_local_day`
//! (task A5) uses — History/Calendar day bucketing must agree with session
//! day-scoping or the two surfaces would disagree about which day a rep landed on.
//!
//! No migration, no new indexes, no write paths: this module only ever reads
//! `session`, `rep`, `rep_block`, `piece`, `region`, `practice_interval`, and
//! `day_sheet` — every one of them already durable before this task.

use std::collections::HashMap;

use rusqlite::Connection;
use serde::Serialize;

use super::day_sheet::DaySheet;
use super::practice_v2::{invalid, project};
use super::Store;
use crate::date::Date;
use crate::metrics;

/// One piece's slice of a day's attempts, inside [`HistoryDaySummary`].
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct HistoryDayPiece {
    pub piece_id: i64,
    pub title: String,
    pub attempts: i64,
}

/// One row of the History day timeline: a LOCAL calendar day with any practice
/// evidence, rolled up across every session/set touched that day.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct HistoryDaySummary {
    /// `YYYY-MM-DD`, local.
    pub date: String,
    pub focused_seconds: i64,
    pub session_count: i64,
    pub attempts: i64,
    pub cleans: i64,
    pub sets_touched: i64,
    pub mastered_sets: i64,
    pub pieces: Vec<HistoryDayPiece>,
}

/// One session's slice of a [`HistoryDayDetail`].
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct HistoryDaySession {
    pub session_id: i64,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub focused_seconds: i64,
}

/// One set's slice of a [`HistoryDayDetail`] — that day's attempts on a block,
/// joined out to its piece/region names in SQL (day detail spans pieces, unlike
/// [`super::model::BlockHistory`]'s client-side join within one piece).
/// `mastery_status` is the set's CURRENT live projection (via the same ledger
/// [`project`] every other mastery-status read uses), not a day-specific
/// snapshot — the day-specific numbers are `attempts`/`cleans`/`flawed`/`failed`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct HistoryDaySet {
    pub block_id: i64,
    pub piece_id: i64,
    pub piece_title: String,
    pub region_name: Option<String>,
    pub m_start: i64,
    pub m_end: i64,
    pub attempts: i64,
    pub cleans: i64,
    pub flawed: i64,
    pub failed: i64,
    pub start_bpm: i64,
    pub end_bpm: i64,
    pub mastery_status: String,
    pub first_ts: String,
    pub last_ts: String,
}

/// One LOCAL calendar day's full detail: every session and every set touched
/// that day.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct HistoryDayDetail {
    pub date: String,
    pub sessions: Vec<HistoryDaySession>,
    pub sets: Vec<HistoryDaySet>,
}

/// The widest range `history_days`/`day_sheets_range` will ever answer in one
/// call — a defensive cap, not a product limit (see global-constraints: read
/// commands only, no new indexes to make a wider scan cheap).
const MAX_RANGE_DAYS: i64 = 400;

/// Validate `from`/`to` as an inclusive local-date range: both must be real
/// `YYYY-MM-DD` dates (the same strict Gregorian parser every other date
/// boundary in this codebase uses), `to` may not precede `from`, and the span
/// may not exceed [`MAX_RANGE_DAYS`].
fn validate_range(from: &str, to: &str) -> rusqlite::Result<(Date, Date)> {
    let from_date =
        Date::parse(from).ok_or_else(|| invalid("from must be a valid YYYY-MM-DD date"))?;
    let to_date = Date::parse(to).ok_or_else(|| invalid("to must be a valid YYYY-MM-DD date"))?;
    if to_date < from_date {
        return Err(invalid("to must not be before from"));
    }
    if to_date.days_since_epoch() - from_date.days_since_epoch() + 1 > MAX_RANGE_DAYS {
        return Err(invalid(format!(
            "date range may not exceed {MAX_RANGE_DAYS} days"
        )));
    }
    Ok((from_date, to_date))
}

/// Every LOCAL calendar day in `[from,to]` with any practice evidence
/// (a session started that day, or a rep landed that day), newest first.
fn day_candidates(conn: &Connection, from: &str, to: &str) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT day FROM (
            SELECT DISTINCT date(started_at,'localtime') AS day FROM session
            UNION
            SELECT DISTINCT date(ts,'localtime') AS day FROM rep
         )
         WHERE day BETWEEN ?1 AND ?2
         ORDER BY day DESC",
    )?;
    let rows = stmt.query_map(rusqlite::params![from, to], |row| row.get::<_, String>(0))?;
    rows.collect()
}

struct DayAggregates {
    session_ids: Vec<i64>,
    attempts: i64,
    cleans: i64,
    sets_touched: i64,
    mastered_sets: i64,
    pieces: Vec<HistoryDayPiece>,
}

/// Everything for one day that's derivable from a single connection without
/// crossing into another `Store` method's own lock (see the call site: session
/// focused-seconds is computed afterward, through `Store::events_for_session`,
/// outside this function's lock scope).
fn day_aggregates(conn: &Connection, day: &str) -> rusqlite::Result<DayAggregates> {
    let session_ids: Vec<i64> = {
        let mut stmt = conn.prepare(
            "SELECT id FROM session WHERE date(started_at,'localtime') = ?1 ORDER BY id",
        )?;
        let rows = stmt.query_map([day], |row| row.get(0))?;
        rows.collect::<rusqlite::Result<_>>()?
    };

    let (attempts, cleans, sets_touched): (i64, i64, i64) = conn.query_row(
        "SELECT COUNT(*),
                COALESCE(SUM(CASE WHEN verdict='clean' THEN 1 ELSE 0 END), 0),
                COUNT(DISTINCT block_id)
         FROM rep WHERE date(ts,'localtime') = ?1",
        [day],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )?;

    // Mastery-landed-that-day evidence: `practice_interval.end_reason='mastered'`
    // is written by the same v2 ledger commit that flips a set's live state to
    // `mastered` (see `practice_v2::v2_check`) — reused here, not re-derived.
    let mastered_sets: i64 = conn.query_row(
        "SELECT COUNT(DISTINCT set_id) FROM practice_interval
         WHERE end_reason = 'mastered' AND date(ended_ts,'localtime') = ?1",
        [day],
        |row| row.get(0),
    )?;

    let mut stmt = conn.prepare(
        "SELECT rb.piece_id, p.title, COUNT(*) AS attempts
         FROM rep r
         JOIN rep_block rb ON rb.id = r.block_id
         JOIN piece p ON p.id = rb.piece_id
         WHERE date(r.ts,'localtime') = ?1
         GROUP BY rb.piece_id, p.title
         ORDER BY attempts DESC, p.title ASC",
    )?;
    let pieces = stmt
        .query_map([day], |row| {
            Ok(HistoryDayPiece {
                piece_id: row.get(0)?,
                title: row.get(1)?,
                attempts: row.get(2)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    Ok(DayAggregates {
        session_ids,
        attempts,
        cleans,
        sets_touched,
        mastered_sets,
        pieces,
    })
}

fn detail_sessions(
    conn: &Connection,
    date: &str,
) -> rusqlite::Result<Vec<(i64, String, Option<String>)>> {
    let mut stmt = conn.prepare(
        "SELECT id, started_at, ended_at FROM session
         WHERE date(started_at,'localtime') = ?1 ORDER BY id ASC",
    )?;
    let rows = stmt.query_map([date], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?;
    rows.collect()
}

struct SetAgg {
    block_id: i64,
    piece_id: i64,
    piece_title: String,
    region_name: Option<String>,
    m_start: i64,
    m_end: i64,
    attempts: i64,
    cleans: i64,
    flawed: i64,
    failed: i64,
    start_bpm: f64,
    end_bpm: f64,
    first_ts: String,
    last_ts: String,
}

/// Every set with a rep on `date`, in first-attempt-of-the-day order. Reps are
/// read in canonical `id` (insertion) order and folded into per-block
/// aggregates as encountered, so a block's position in the returned `Vec`
/// already matches its `first_ts` — no separate sort needed, and no risk of a
/// same-second `ts` tie reordering two blocks relative to each other.
fn detail_sets_raw(conn: &Connection, date: &str) -> rusqlite::Result<Vec<SetAgg>> {
    let mut stmt = conn.prepare(
        "SELECT r.block_id, rb.piece_id, p.title, rg.name, rb.m_start, rb.m_end,
                r.ts, r.bpm, r.verdict
         FROM rep r
         JOIN rep_block rb ON rb.id = r.block_id
         JOIN piece p ON p.id = rb.piece_id
         LEFT JOIN region rg ON rg.id = rb.region_id
         WHERE date(r.ts,'localtime') = ?1
         ORDER BY r.id ASC",
    )?;
    let raw = stmt
        .query_map([date], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, i64>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, f64>(7)?,
                row.get::<_, String>(8)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let mut order: Vec<i64> = Vec::new();
    let mut by_block: HashMap<i64, SetAgg> = HashMap::new();
    for (block_id, piece_id, piece_title, region_name, m_start, m_end, ts, bpm, verdict) in raw {
        let entry = by_block.entry(block_id).or_insert_with(|| {
            order.push(block_id);
            SetAgg {
                block_id,
                piece_id,
                piece_title,
                region_name,
                m_start,
                m_end,
                attempts: 0,
                cleans: 0,
                flawed: 0,
                failed: 0,
                start_bpm: bpm,
                end_bpm: bpm,
                first_ts: ts.clone(),
                last_ts: ts.clone(),
            }
        });
        entry.attempts += 1;
        match verdict.as_str() {
            "clean" => entry.cleans += 1,
            "flawed" => entry.flawed += 1,
            "failed" => entry.failed += 1,
            _ => {}
        }
        entry.end_bpm = bpm;
        entry.last_ts = ts;
    }
    Ok(order
        .into_iter()
        .map(|id| by_block.remove(&id).expect("just inserted"))
        .collect())
}

impl Store {
    /// One row per LOCAL day in `[from,to]` with any practice evidence, newest
    /// first — the History timeline's top-level list.
    pub(crate) fn history_days(
        &self,
        from: &str,
        to: &str,
    ) -> rusqlite::Result<Vec<HistoryDaySummary>> {
        let from = from.trim();
        let to = to.trim();
        validate_range(from, to)?;

        let days = {
            let conn = self
                .conn
                .lock()
                .unwrap_or_else(|poison| poison.into_inner());
            day_candidates(&conn, from, to)?
        };

        let mut out = Vec::with_capacity(days.len());
        for day in days {
            let aggregates = {
                let conn = self
                    .conn
                    .lock()
                    .unwrap_or_else(|poison| poison.into_inner());
                day_aggregates(&conn, &day)?
            };
            // Outside the lock above: `events_for_session` takes its own lock,
            // and `std::sync::Mutex` is not reentrant.
            let mut focused_seconds = 0i64;
            for session_id in &aggregates.session_ids {
                let events = self.events_for_session(*session_id)?;
                focused_seconds += metrics::focused_seconds(&events) as i64;
            }
            out.push(HistoryDaySummary {
                date: day,
                focused_seconds,
                session_count: aggregates.session_ids.len() as i64,
                attempts: aggregates.attempts,
                cleans: aggregates.cleans,
                sets_touched: aggregates.sets_touched,
                mastered_sets: aggregates.mastered_sets,
                pieces: aggregates.pieces,
            });
        }
        Ok(out)
    }

    /// One LOCAL day's full detail: every session and every set touched that
    /// day. An empty day (no evidence) returns an empty detail, never an
    /// error — the frontend renders a blank day, same as `day_sheet_get`'s
    /// `None` convention for an unsaved sheet.
    pub(crate) fn history_day_detail(&self, date: &str) -> rusqlite::Result<HistoryDayDetail> {
        let date = date.trim();
        if !crate::date::is_valid(date) {
            return Err(invalid("date must be a valid YYYY-MM-DD date"));
        }

        let (session_rows, block_rows) = {
            let conn = self
                .conn
                .lock()
                .unwrap_or_else(|poison| poison.into_inner());
            let session_rows = detail_sessions(&conn, date)?;
            let block_rows = detail_sets_raw(&conn, date)?;
            (session_rows, block_rows)
        };

        let mut sessions = Vec::with_capacity(session_rows.len());
        for (session_id, started_at, ended_at) in session_rows {
            let events = self.events_for_session(session_id)?;
            let focused_seconds = metrics::focused_seconds(&events) as i64;
            sessions.push(HistoryDaySession {
                session_id,
                started_at,
                ended_at,
                focused_seconds,
            });
        }

        let mut sets = Vec::with_capacity(block_rows.len());
        for row in block_rows {
            // `project` reuses the exact same ledger projection every other
            // mastery-status read (paused-sets tray, block history, rep state)
            // goes through — never re-derived here.
            let mastery_status = {
                let conn = self
                    .conn
                    .lock()
                    .unwrap_or_else(|poison| poison.into_inner());
                project(&conn, row.block_id)?.mastery_status
            };
            sets.push(HistoryDaySet {
                block_id: row.block_id,
                piece_id: row.piece_id,
                piece_title: row.piece_title,
                region_name: row.region_name,
                m_start: row.m_start,
                m_end: row.m_end,
                attempts: row.attempts,
                cleans: row.cleans,
                flawed: row.flawed,
                failed: row.failed,
                start_bpm: row.start_bpm.round() as i64,
                end_bpm: row.end_bpm.round() as i64,
                mastery_status,
                first_ts: row.first_ts,
                last_ts: row.last_ts,
            });
        }

        Ok(HistoryDayDetail {
            date: date.to_string(),
            sessions,
            sets,
        })
    }

    /// Existing day sheets whose `date` falls in `[from,to]`, ascending —
    /// read-only, never creates a row for a date that has none. Delegates to
    /// [`Store::day_sheet_get`] per date so the body-parsing logic (and its
    /// error handling) is never duplicated.
    pub(crate) fn day_sheets_range(&self, from: &str, to: &str) -> rusqlite::Result<Vec<DaySheet>> {
        let from = from.trim();
        let to = to.trim();
        validate_range(from, to)?;

        let dates: Vec<String> = {
            let conn = self
                .conn
                .lock()
                .unwrap_or_else(|poison| poison.into_inner());
            let mut stmt = conn.prepare(
                "SELECT date FROM day_sheet WHERE date BETWEEN ?1 AND ?2 ORDER BY date ASC",
            )?;
            let rows =
                stmt.query_map(rusqlite::params![from, to], |row| row.get::<_, String>(0))?;
            rows.collect::<rusqlite::Result<_>>()?
        };

        let mut out = Vec::with_capacity(dates.len());
        for date in dates {
            if let Some(sheet) = self.day_sheet_get(&date)? {
                out.push(sheet);
            }
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use crate::store::model::ScanPiece;
    use crate::store::Store;

    fn seed_piece(store: &Store, folder: &str, title: &str) -> i64 {
        store
            .upsert_piece(&ScanPiece {
                folder_path: folder.into(),
                title: title.into(),
                composer: None,
                xml_path: None,
                pdf_path: None,
            })
            .unwrap()
    }

    /// Seed a bare `rep_block` row through raw fixture SQL — this module tests
    /// the READ side only. Deliberately writes no `set_contract` row: `project`
    /// (via `load_set_row`/`load_contract`) already falls back to a legacy
    /// contract when a block has none, exactly as it does for pre-v2 data, so
    /// `history_day_detail`'s `mastery_status` read stays exercised without
    /// this module re-deriving what a real v2 contract's mastery math is.
    fn seed_block(store: &Store, piece_id: i64, m_start: i64, m_end: i64) -> i64 {
        store
            .test_execute_batch(&format!(
                "INSERT INTO rep_block (piece_id,m_start,m_end,start_bpm,target_bpm,planned_reps,focus,use_metronome)
                 VALUES ({piece_id},{m_start},{m_end},80,120,10,'notes',0);"
            ))
            .unwrap();
        store
            .test_scalar_i64("SELECT id FROM rep_block ORDER BY id DESC LIMIT 1")
            .unwrap()
    }

    /// Seed a closed `practice_interval` row with `end_reason='mastered'` —
    /// the exact evidence `mastered_sets` reads (`practice_v2::v2_check`
    /// writes the real one at the moment a set's ledger projection first
    /// satisfies mastery; see `close_active_interval`). No real ledger replay
    /// needed for a read-model test: the read side only ever looks at this
    /// row's `end_reason`/`ended_ts`, never at how it got there.
    fn seed_mastered_interval(store: &Store, block_id: i64, ended_ts: &str) {
        store
            .test_execute_batch(&format!(
                "INSERT INTO practice_interval (set_id, started_ts, last_checkpoint_ts, ended_ts, end_reason)
                 VALUES ({block_id}, '{ended_ts}', '{ended_ts}', '{ended_ts}', 'mastered');"
            ))
            .unwrap();
    }

    fn seed_session(store: &Store, started_at: &str, ended_at: Option<&str>) -> i64 {
        let ended = match ended_at {
            Some(value) => format!("'{value}'"),
            None => "NULL".to_string(),
        };
        store
            .test_execute_batch(&format!(
                "INSERT INTO session (started_at, ended_at) VALUES ('{started_at}', {ended});"
            ))
            .unwrap();
        store
            .test_scalar_i64("SELECT id FROM session ORDER BY id DESC LIMIT 1")
            .unwrap()
    }

    fn seed_rep(store: &Store, block_id: i64, ts: &str, bpm: f64, verdict: &str) {
        store
            .test_execute_batch(&format!(
                "INSERT INTO rep (block_id, ts, bpm, verdict) VALUES ({block_id}, '{ts}', {bpm}, '{verdict}');"
            ))
            .unwrap();
    }

    fn seed_event(store: &Store, session_id: i64, ts: &str, kind: &str) {
        store
            .test_execute_batch(&format!(
                "INSERT INTO event (ts, session_id, kind, payload) VALUES ('{ts}', {session_id}, '{kind}', '{{}}');"
            ))
            .unwrap();
    }

    #[test]
    fn history_days_returns_exact_counts_ordering_and_excludes_empty_days() {
        let store = Store::open(":memory:").unwrap();
        let piece_a = seed_piece(&store, "/v/A", "Piece A");
        let piece_b = seed_piece(&store, "/v/B", "Piece B");
        let block_a = seed_block(&store, piece_a, 1, 8);
        let block_b = seed_block(&store, piece_b, 1, 8);

        // Day 1 (2026-08-03): two reps on block_a, one clean.
        let session1 = seed_session(&store, "2026-08-03T15:00:00Z", Some("2026-08-03T15:10:00Z"));
        seed_event(&store, session1, "2026-08-03T15:00:00Z", "rep_open");
        seed_event(&store, session1, "2026-08-03T15:00:30Z", "rep");
        seed_rep(&store, block_a, "2026-08-03T15:00:00Z", 80.0, "flawed");
        seed_rep(&store, block_a, "2026-08-03T15:00:30Z", 80.0, "clean");

        // Day 2 (2026-08-05): one rep on block_b (day 4 is deliberately empty
        // to prove empty days are excluded from the result).
        let session2 = seed_session(&store, "2026-08-05T12:00:00Z", Some("2026-08-05T12:05:00Z"));
        seed_event(&store, session2, "2026-08-05T12:00:00Z", "rep_open");
        seed_rep(&store, block_b, "2026-08-05T12:00:00Z", 90.0, "clean");

        let days = store.history_days("2026-08-01", "2026-08-06").unwrap();

        assert_eq!(
            days.iter().map(|d| d.date.as_str()).collect::<Vec<_>>(),
            vec!["2026-08-05", "2026-08-03"],
            "newest first, empty days (08-01/02/04/06) excluded"
        );

        let day1 = &days[1];
        assert_eq!(day1.date, "2026-08-03");
        assert_eq!(day1.session_count, 1);
        assert_eq!(day1.attempts, 2);
        assert_eq!(day1.cleans, 1);
        assert_eq!(day1.sets_touched, 1);
        assert_eq!(day1.mastered_sets, 0);
        assert_eq!(day1.pieces.len(), 1);
        assert_eq!(day1.pieces[0].piece_id, piece_a);
        assert_eq!(day1.pieces[0].attempts, 2);
        assert_eq!(
            day1.focused_seconds, 30,
            "the 30s gap between the two events"
        );

        let day2 = &days[0];
        assert_eq!(day2.date, "2026-08-05");
        assert_eq!(day2.attempts, 1);
        assert_eq!(day2.cleans, 1);
        assert_eq!(day2.pieces[0].piece_id, piece_b);
    }

    #[test]
    fn history_days_counts_mastered_sets_by_the_day_mastery_landed() {
        let store = Store::open(":memory:").unwrap();
        let piece = seed_piece(&store, "/v/M", "Mastery Piece");
        let block_one = seed_block(&store, piece, 1, 8);
        let block_two = seed_block(&store, piece, 9, 16);

        // Two sets master on the SAME day; a third masters on a different day.
        seed_mastered_interval(&store, block_one, "2026-08-03T18:00:00Z");
        seed_mastered_interval(&store, block_two, "2026-08-03T19:00:00Z");
        let block_three = seed_block(&store, piece, 17, 24);
        seed_mastered_interval(&store, block_three, "2026-08-04T09:00:00Z");
        // A rep on 08-03 so the day is even in range without the mastery
        // evidence alone carrying it (belt and suspenders for the "ANY
        // practice evidence" day-candidate rule).
        seed_rep(&store, block_one, "2026-08-03T18:00:00Z", 80.0, "clean");
        seed_rep(&store, block_three, "2026-08-04T09:00:00Z", 80.0, "clean");

        let days = store.history_days("2026-08-03", "2026-08-04").unwrap();
        let day1 = days.iter().find(|d| d.date == "2026-08-03").unwrap();
        let day2 = days.iter().find(|d| d.date == "2026-08-04").unwrap();
        assert_eq!(day1.mastered_sets, 2);
        assert_eq!(day2.mastered_sets, 1);
    }

    #[test]
    fn history_days_bucketing_matches_utc_boundary_localtime_convention() {
        // Task B1 mandatory test: a rep's canonical timestamp is stored in
        // UTC; it must bucket to whatever LOCAL calendar day SQLite's
        // `date(ts,'localtime')` resolves it to — the exact same convention
        // `session_last_event_and_same_local_day` (task A5) already commits
        // to — never to the UTC calendar date embedded in the literal string.
        // This must hold on whatever machine runs the suite, so the expected
        // bucket is read from the SAME `'localtime'` conversion the
        // production code uses, rather than hardcoded to one timezone.
        let store = Store::open(":memory:").unwrap();
        let piece = seed_piece(&store, "/v/TZ", "TZ Piece");
        let block = seed_block(&store, piece, 1, 8);

        // Early UTC morning: for any negative (west-of-Greenwich) local
        // offset this lands on the PRIOR local calendar day.
        let utc_ts = "2026-08-05T01:15:00Z";
        seed_rep(&store, block, utc_ts, 80.0, "clean");

        let expected_local_day: String = store
            .test_scalar_string(&format!("SELECT date('{utc_ts}','localtime')"))
            .unwrap();

        // Bracket the UTC date by a few days either side (any real-world local
        // offset shifts by at most one calendar day) — wide enough to catch
        // the bucket, narrow enough to stay under the 400-day range cap.
        let days = store.history_days("2026-08-01", "2026-08-09").unwrap();
        assert_eq!(days.len(), 1, "the single rep produces exactly one day row");
        assert_eq!(
            days[0].date, expected_local_day,
            "buckets by the SQLite 'localtime' conversion, not the literal UTC date"
        );
        assert_eq!(days[0].attempts, 1);
    }

    #[test]
    fn history_days_rejects_inverted_range_and_oversized_range() {
        let store = Store::open(":memory:").unwrap();
        let inverted = store.history_days("2026-08-05", "2026-08-01");
        assert!(inverted.is_err(), "to before from must be rejected");

        let too_wide = store.history_days("2026-01-01", "2027-06-01");
        assert!(too_wide.is_err(), "a span over 400 days must be rejected");

        let bad_shape = store.history_days("2026-8-1", "2026-08-05");
        assert!(bad_shape.is_err(), "non YYYY-MM-DD input must be rejected");

        let ok = store.history_days("2026-08-01", "2026-08-01");
        assert!(ok.is_ok(), "a same-day range is a valid 1-day span");
    }

    #[test]
    fn history_day_detail_splits_attempts_per_day_and_joins_names() {
        let store = Store::open(":memory:").unwrap();
        let piece = seed_piece(&store, "/v/D", "Detail Piece");
        let block = seed_block(&store, piece, 9, 16);
        store
            .test_execute_batch(&format!(
                "INSERT INTO region (piece_id, name, m_start, m_end) VALUES ({piece}, 'Development', 9, 16);
                 UPDATE rep_block SET region_id = (SELECT id FROM region WHERE piece_id={piece}) WHERE id={block};"
            ))
            .unwrap();

        // The SAME block practiced on two different local days: day 1 gets
        // two reps (one flawed, one clean); day 2 gets one more clean rep.
        seed_rep(&store, block, "2026-08-03T10:00:00Z", 80.0, "flawed");
        seed_rep(&store, block, "2026-08-03T10:05:00Z", 84.0, "clean");
        seed_rep(&store, block, "2026-08-04T09:00:00Z", 90.0, "clean");

        let day1 = store.history_day_detail("2026-08-03").unwrap();
        assert_eq!(day1.sets.len(), 1);
        let set1 = &day1.sets[0];
        assert_eq!(set1.block_id, block);
        assert_eq!(set1.piece_id, piece);
        assert_eq!(set1.piece_title, "Detail Piece");
        assert_eq!(set1.region_name.as_deref(), Some("Development"));
        assert_eq!(set1.m_start, 9);
        assert_eq!(set1.m_end, 16);
        assert_eq!(
            set1.attempts, 2,
            "only that day's attempts, not the block's total"
        );
        assert_eq!(set1.cleans, 1);
        assert_eq!(set1.flawed, 1);
        assert_eq!(set1.failed, 0);
        assert_eq!(set1.start_bpm, 80);
        assert_eq!(set1.end_bpm, 84);
        assert_eq!(set1.first_ts, "2026-08-03T10:00:00Z");
        assert_eq!(set1.last_ts, "2026-08-03T10:05:00Z");

        let day2 = store.history_day_detail("2026-08-04").unwrap();
        assert_eq!(day2.sets.len(), 1);
        let set2 = &day2.sets[0];
        assert_eq!(
            set2.attempts, 1,
            "the same block appears in both days with only that day's attempts"
        );
        assert_eq!(set2.start_bpm, 90);
        assert_eq!(set2.end_bpm, 90);
    }

    #[test]
    fn history_day_detail_of_an_empty_day_is_an_empty_detail_not_an_error() {
        let store = Store::open(":memory:").unwrap();
        let detail = store.history_day_detail("2026-08-03").unwrap();
        assert_eq!(detail.date, "2026-08-03");
        assert!(detail.sessions.is_empty());
        assert!(detail.sets.is_empty());
    }

    #[test]
    fn history_day_detail_rejects_a_malformed_date() {
        let store = Store::open(":memory:").unwrap();
        assert!(store.history_day_detail("08-03-2026").is_err());
    }

    #[test]
    fn day_sheets_range_returns_only_existing_rows_with_untouched_body() {
        let store = Store::open(":memory:").unwrap();
        store
            .day_sheet_save("2026-08-02", r#"[{"type":"text","text":"hello"}]"#)
            .unwrap();
        store
            .day_sheet_save("2026-08-04", r#"[{"type":"text","text":"world"}]"#)
            .unwrap();
        // 2026-08-03 deliberately has no sheet.

        let sheets = store.day_sheets_range("2026-08-01", "2026-08-05").unwrap();
        assert_eq!(
            sheets.len(),
            2,
            "only the two dates that actually have rows"
        );
        assert_eq!(sheets[0].date, "2026-08-02");
        assert_eq!(sheets[1].date, "2026-08-04");

        match &sheets[0].body[0] {
            super::super::day_sheet::NotebookLine::Text(line) => {
                assert_eq!(line.text, "hello", "body round-trips untouched");
            }
            other => panic!("expected a text line, got {other:?}"),
        }
    }

    #[test]
    fn day_sheets_range_rejects_inverted_range() {
        let store = Store::open(":memory:").unwrap();
        assert!(store.day_sheets_range("2026-08-05", "2026-08-01").is_err());
    }
}
