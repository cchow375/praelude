//! Read-only rewards from canonical practice. No sampling call can mint XP.
use std::collections::BTreeMap;

use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;

use super::super::model::{json_from_sql, DemotionConfig, Event};
use crate::metrics;

pub(super) const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct StudioProgress {
    pub total_xp: u64,
    pub focused_seconds: u64,
    pub focus_xp: u64,
    pub set_xp: u64,
    pub completed_sets: u64,
    pub current_session_sets: u64,
    pub next_set_milestone: Option<u64>,
    /// One-based commitment rank; this is never a musical proficiency grade.
    pub rank_index: u32,
    pub rank_name: String,
    pub division: u32,
    pub division_xp: u64,
    pub division_xp_required: u64,
    pub divisions_completed: u64,
}

/// Per-session cumulative milestones, not additive awards at each threshold.
/// Ten completed sets earn 6 XP total; reading the page cannot replay a reward.
pub(super) fn set_milestone_xp(sets: u64) -> u64 {
    match sets {
        0..=2 => 0,
        3..=4 => 1,
        5..=6 => 2,
        7..=9 => 4,
        _ => 6,
    }
}

fn rank_start(rank: u64) -> u64 {
    // Ten divisions per rank. Division requirements are 100,150,200,...
    250 * (rank - 1) * (rank + 2)
}

pub(super) fn rank_progress(focused_seconds: u64, set_xp: u64) -> StudioProgress {
    let focus_xp = focused_seconds / 600;
    let total_xp = focus_xp.saturating_add(set_xp).min(MAX_SAFE_INTEGER);
    // A bounded integer binary search stays exact past the first ten ranks.
    let (mut low, mut high) = (1u64, 10_000_000u64);
    while low < high {
        let middle = low + (high - low).div_ceil(2);
        if rank_start(middle) <= total_xp {
            low = middle;
        } else {
            high = middle - 1;
        }
    }
    let rank = low;
    let remaining = total_xp - rank_start(rank);
    let required = 100 + 50 * (rank - 1);
    let division_index = remaining / required;
    const NAMES: [&str; 10] = [
        "Prelude",
        "Etude",
        "Arabesque",
        "Nocturne",
        "Scherzo",
        "Sonata",
        "Rhapsody",
        "Concerto",
        "Cadenza",
        "Opus",
    ];
    let rank_name = NAMES
        .get((rank - 1) as usize)
        .map_or_else(|| format!("Encore {}", rank - 10), |name| (*name).into());
    StudioProgress {
        total_xp,
        focused_seconds,
        focus_xp,
        set_xp,
        completed_sets: 0,
        current_session_sets: 0,
        next_set_milestone: Some(3),
        rank_index: rank as u32,
        rank_name,
        division: (division_index + 1) as u32,
        division_xp: remaining % required,
        division_xp_required: required,
        divisions_completed: (rank - 1) * 10 + division_index,
    }
}

pub(super) fn read(conn: &Connection) -> Result<StudioProgress, String> {
    derive(conn).map_err(|error| format!("Practice progress could not be read: {error}"))
}

fn derive(conn: &Connection) -> rusqlite::Result<StudioProgress> {
    let mut events_by_session: BTreeMap<Option<i64>, Vec<Event>> = BTreeMap::new();
    let mut block_sessions = BTreeMap::new();
    let mut statement = conn.prepare(
        "SELECT id,ts,session_id,piece_id,kind,payload FROM event
         WHERE piece_id IS NOT NULL
           AND kind IN ('rep_open','rep','verdict','tempo_change','rep_close') ORDER BY id",
    )?;
    let events = statement.query_map([], |row| {
        let payload: String = row.get(5)?;
        Ok(Event {
            id: row.get(0)?,
            ts: row.get(1)?,
            session_id: row.get(2)?,
            piece_id: row.get(3)?,
            kind: row.get(4)?,
            payload: json_from_sql(&payload)?,
        })
    })?;
    for event in events {
        let event = event?;
        // Attribute a completed set to its final practice/close session. A
        // later administrative tempo correction must not move earned credit.
        if matches!(event.kind.as_str(), "rep" | "verdict" | "rep_close") {
            if let (Some(session_id), Some(block_id)) = (
                event.session_id,
                event
                    .payload
                    .get("block_id")
                    .and_then(serde_json::Value::as_i64),
            ) {
                block_sessions.insert(block_id, session_id);
            }
        }
        if event.kind != "rep_close" {
            events_by_session
                .entry(event.session_id)
                .or_default()
                .push(event);
        }
    }
    let focused_seconds = events_by_session.values().fold(0u64, |sum, events| {
        sum.saturating_add(metrics::focused_seconds(events))
            .min(MAX_SAFE_INTEGER)
    });

    let mut sets_by_session: BTreeMap<i64, u64> = BTreeMap::new();
    let mut statement = conn.prepare(
        "SELECT b.id FROM rep_block b JOIN set_contract sc ON sc.set_id=b.id
         WHERE sc.set_state='mastered' AND b.status='done'
           AND sc.source!='migration_legacy' ORDER BY b.id",
    )?;
    let ids = statement.query_map([], |row| row.get::<_, i64>(0))?;
    for id in ids {
        let id = id?;
        // Reuse the same effective-attempt / undo / recovery / variant / tempo
        // projection used by practice. A stale stored 'done' flag earns nothing.
        let projected = super::super::practice_v2::project(conn, id, DemotionConfig::default())?;
        if projected.mastery_status == "satisfied"
            && (projected.mastery_verified || projected.mastery_basis == "total_attempts")
        {
            // A retry of close or a history edit cannot move one completed set
            // into a second session's milestone. Its final effective attempt
            // owns the credit; time-only sets use their canonical close event.
            let session_id = match projected.last_attempt_id {
                Some(attempt_id) => conn
                    .query_row(
                        "SELECT e.session_id FROM attempt_provenance ap JOIN event e
                     ON e.id=ap.canonical_event_id WHERE ap.rep_id=?1",
                        [attempt_id],
                        |row| row.get::<_, Option<i64>>(0),
                    )
                    .optional()?
                    .flatten(),
                None if projected.mastery_basis == "timed_exposure" => {
                    block_sessions.get(&id).copied()
                }
                None => None,
            };
            if let Some(session_id) = session_id {
                *sets_by_session.entry(session_id).or_default() += 1;
            }
        }
    }
    let set_xp = sets_by_session
        .values()
        .map(|count| set_milestone_xp(*count))
        .sum();
    let mut progress = rank_progress(focused_seconds, set_xp);
    progress.completed_sets = sets_by_session.values().sum();
    let active_session: Option<i64> = conn
        .query_row(
            "SELECT id FROM session WHERE ended_at IS NULL ORDER BY id DESC LIMIT 1",
            [],
            |row| row.get(0),
        )
        .optional()?;
    progress.current_session_sets = active_session
        .and_then(|session_id| sets_by_session.get(&session_id).copied())
        .unwrap_or(0);
    progress.next_set_milestone = [3, 5, 7, 10]
        .into_iter()
        .find(|threshold| *threshold > progress.current_session_sets);
    Ok(progress)
}
