//! Deterministic P5 next-work preview.
//!
//! The brain may narrate this output but never owns its ranking and this module
//! never writes. Every score component is exposed in `reasons`, so a suggestion
//! can be audited instead of arriving as an opaque AI instruction.

use serde::{Deserialize, Serialize};

use crate::store::model::{BlockHistory, Goal, RegionMastery};
use crate::store::Store;

#[derive(Debug, Clone, PartialEq)]
pub struct PlanInput {
    /// User-local `YYYY-MM-DD`, supplied by the UI rather than inferred from UTC.
    pub today: String,
    pub goals: Vec<Goal>,
    pub blocks: Vec<BlockHistory>,
    pub regions: Vec<RegionMastery>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WorkSuggestion {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub m_start: Option<u32>,
    pub m_end: Option<u32>,
    pub score: i32,
    pub reasons: Vec<String>,
}

/// Load the canonical graph and produce a read-only preview for one piece.
pub fn preview_for_piece(
    store: &Store,
    piece_id: i64,
) -> rusqlite::Result<Vec<WorkSuggestion>> {
    let progress = crate::metrics::progress_summary(store, piece_id)?;
    Ok(preview(&PlanInput {
        today: store.local_today()?,
        goals: store.goal_list(piece_id)?,
        blocks: store.block_history(piece_id)?,
        regions: progress.per_region_mastery,
    }))
}

/// Rank at most seven concrete next actions. Ties are stable by id.
pub fn preview(input: &PlanInput) -> Vec<WorkSuggestion> {
    let today = parse_date_days(&input.today);
    let mut output = Vec::new();

    for goal in input.goals.iter().filter(|goal| !goal.done) {
        let mut score = 35;
        let mut reasons = vec!["unfinished goal".to_string()];
        if let (Some(today), Some(target)) = (
            today,
            goal.target_date.as_deref().and_then(parse_date_days),
        ) {
            let days = target - today;
            if days < 0 {
                score += 65;
                reasons.push(format!("overdue by {} day{}", -days, if days == -1 { "" } else { "s" }));
            } else if days == 0 {
                score += 60;
                reasons.push("due today".into());
            } else if days <= 7 {
                score += 45 - (days as i32 * 3);
                reasons.push(format!("due in {days} days"));
            }
        }
        output.push(WorkSuggestion {
            id: format!("goal:{}", goal.id),
            kind: "goal".into(),
            title: goal.text.clone(),
            m_start: None,
            m_end: None,
            score,
            reasons,
        });
    }

    for block in input.blocks.iter().filter(|block| block.status == "open") {
        let remaining = block.planned_reps.saturating_sub(block.reps_done);
        let mut score = 58 + remaining.min(20) as i32;
        let mut reasons = vec![format!("{remaining} planned reps remain")];
        if block.reps_done > 0 {
            score += 8;
            reasons.push("resume existing work instead of starting over".into());
        }
        output.push(WorkSuggestion {
            id: format!("block:{}", block.block_id),
            kind: "open_block".into(),
            title: block.label.clone().unwrap_or_else(|| {
                format!("Measures {}–{}", block.m_start, block.m_end)
            }),
            m_start: Some(block.m_start),
            m_end: Some(block.m_end),
            score,
            reasons,
        });
    }

    for region in input.regions.iter().filter(|region| region.reps > 0) {
        let Some(today) = today else { continue };
        let Some(last) = region
            .last_practiced
            .as_deref()
            .and_then(|value| value.get(0..10))
            .and_then(parse_date_days)
        else {
            continue;
        };
        let age = today - last;
        if age < 3 {
            continue;
        }
        let score = 42 + (age.min(21) as i32);
        output.push(WorkSuggestion {
            id: format!("region:{}", region.region_id),
            kind: "revisit".into(),
            title: region.name.clone(),
            m_start: None,
            m_end: None,
            score,
            reasons: vec![format!(
                "last practiced {age} days ago; revisit for consolidation"
            )],
        });
    }

    output.sort_by(|a, b| b.score.cmp(&a.score).then_with(|| a.id.cmp(&b.id)));
    output.truncate(7);
    output
}

fn parse_date_days(date: &str) -> Option<i64> {
    let mut parts = date.split('-');
    let year: i64 = parts.next()?.parse().ok()?;
    let month: i64 = parts.next()?.parse().ok()?;
    let day: i64 = parts.next()?.parse().ok()?;
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let days_in_month = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return None,
    };
    if parts.next().is_some() || !(1..=days_in_month).contains(&day) {
        return None;
    }
    let year = if month <= 2 { year - 1 } else { year };
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let yoe = year - era * 400;
    let doy = (153 * (if month > 2 { month - 3 } else { month + 9 }) + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    Some(era * 146_097 + doe - 719_468)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::model::VerdictCounts;

    fn goal(id: i64, text: &str, target_date: Option<&str>) -> Goal {
        Goal {
            id,
            piece_id: 1,
            text: text.into(),
            kind: "big".into(),
            parent_goal_id: None,
            done: false,
            order: id,
            target_date: target_date.map(str::to_string),
            created_ts: "2026-07-01T00:00:00Z".into(),
        }
    }

    fn block(id: i64, reps_done: u32, planned_reps: u32) -> BlockHistory {
        BlockHistory {
            block_id: id,
            m_start: 40,
            m_end: 56,
            label: Some("Coda climb".into()),
            start_bpm: Some(80.0),
            target_bpm: Some(120.0),
            planned_reps,
            status: "open".into(),
            reps_done,
            verdicts: VerdictCounts { clean: 0, flawed: 0, failed: 0 },
            bpm: Some(80.0),
            region_id: Some(1),
            focus: "tempo".into(),
            use_metronome: true,
        }
    }

    #[test]
    fn overdue_goal_beats_open_block_and_trace_is_explicit() {
        let input = PlanInput {
            today: "2026-07-12".into(),
            goals: vec![goal(1, "Memorize", Some("2026-07-10"))],
            blocks: vec![block(2, 5, 10)],
            regions: vec![],
        };
        let out = preview(&input);
        assert_eq!(out[0].id, "goal:1");
        assert!(out[0].reasons[1].contains("overdue"));
        assert_eq!(out[1].id, "block:2");
    }

    #[test]
    fn recent_regions_are_not_revisited_but_spaced_regions_are() {
        let mk = |id, date: &str| RegionMastery {
            region_id: id,
            name: format!("R{id}"),
            blocks: 1,
            reps: 8,
            clean_ratio: 0.5,
            best_bpm: Some(80.0),
            last_practiced: Some(format!("{date}T12:00:00Z")),
        };
        let out = preview(&PlanInput {
            today: "2026-07-12".into(),
            goals: vec![],
            blocks: vec![],
            regions: vec![mk(1, "2026-07-11"), mk(2, "2026-07-05")],
        });
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].id, "region:2");
        assert!(out[0].reasons[0].contains("7 days"));
    }

    #[test]
    fn preview_never_mutates_and_caps_output() {
        let goals = (1..=10).map(|id| goal(id, &format!("G{id}"), None)).collect();
        let out = preview(&PlanInput {
            today: "2026-07-12".into(),
            goals,
            blocks: vec![],
            regions: vec![],
        });
        assert_eq!(out.len(), 7);
        assert!(out.iter().all(|item| item.kind == "goal"));
    }

    #[test]
    fn invalid_calendar_dates_do_not_affect_ranking() {
        let out = preview(&PlanInput {
            today: "2026-02-30".into(),
            goals: vec![goal(1, "Invalid due date", Some("2026-02-31"))],
            blocks: vec![],
            regions: vec![],
        });
        assert_eq!(out[0].score, 35);
        assert_eq!(out[0].reasons, vec!["unfinished goal"]);
    }
}
