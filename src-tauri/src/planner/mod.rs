//! Deterministic P5 next-work preview.
//!
//! The brain may narrate this output but never owns its ranking and this module
//! never writes. Every score component is exposed in `reasons`, so a suggestion
//! can be audited instead of arriving as an opaque AI instruction.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::date::Date;
use crate::store::model::{BlockHistory, BlockMeta, Goal, RegionMastery, Rep};
use crate::store::Store;

#[derive(Debug, Clone, PartialEq)]
pub struct PlanInput {
    /// User-local `YYYY-MM-DD`, loaded from SQLite/macOS rather than inferred from UTC.
    pub today: String,
    pub goals: Vec<Goal>,
    pub blocks: Vec<BlockHistory>,
    pub regions: Vec<RegionMastery>,
    pub region_signals: Vec<RegionSignal>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RegionSignal {
    pub region_id: i64,
    pub recent_attempts: u32,
    pub recent_misses: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WorkSuggestion {
    pub id: String,
    pub kind: String,
    /// Present only when the suggestion already has canonical Goal ownership
    /// and can therefore be explicitly added to Calendar without inventing a
    /// relationship. Other suggestion kinds remain read-only until the user
    /// connects that work to a Goal.
    pub goal_id: Option<i64>,
    pub title: String,
    pub m_start: Option<u32>,
    pub m_end: Option<u32>,
    pub score: i32,
    pub reasons: Vec<String>,
}

/// Load the canonical graph and produce a read-only preview for one piece.
pub fn preview_for_piece(store: &Store, piece_id: i64) -> rusqlite::Result<Vec<WorkSuggestion>> {
    let progress = crate::metrics::progress_summary(store, piece_id)?;
    let block_meta = store.blocks_meta(piece_id)?;
    let reps = store.reps_for_piece(piece_id)?;
    Ok(preview(&PlanInput {
        today: store.local_today()?,
        goals: store.goal_list(piece_id)?,
        blocks: store.block_history(piece_id)?,
        regions: progress.per_region_mastery,
        region_signals: recent_region_signals(&block_meta, &reps),
    }))
}

fn recent_region_signals(blocks: &[BlockMeta], reps: &[Rep]) -> Vec<RegionSignal> {
    let region_of = blocks
        .iter()
        .filter_map(|block| block.region_id.map(|region| (block.block_id, region)))
        .collect::<HashMap<_, _>>();
    let mut by_region: HashMap<i64, Vec<&Rep>> = HashMap::new();
    for rep in reps.iter().filter(|rep| !rep.voided) {
        if let Some(region_id) = region_of.get(&rep.block_id) {
            by_region.entry(*region_id).or_default().push(rep);
        }
    }
    let mut signals = by_region
        .into_iter()
        .map(|(region_id, region_reps)| {
            let recent = region_reps
                .iter()
                .rev()
                .take(5)
                .copied()
                .collect::<Vec<_>>();
            RegionSignal {
                region_id,
                recent_attempts: recent.len() as u32,
                recent_misses: recent
                    .iter()
                    .filter(|rep| rep.verdict == "flawed" || rep.verdict == "failed")
                    .count() as u32,
            }
        })
        .collect::<Vec<_>>();
    signals.sort_by_key(|signal| signal.region_id);
    signals
}

/// Rank at most seven concrete next actions. Ties are stable by id.
pub fn preview(input: &PlanInput) -> Vec<WorkSuggestion> {
    let today = Date::parse(&input.today);
    let signals = input
        .region_signals
        .iter()
        .map(|signal| (signal.region_id, signal))
        .collect::<HashMap<_, _>>();
    let mut output = Vec::new();

    for goal in input.goals.iter().filter(|goal| !goal.done) {
        let mut score = 35;
        let mut reasons = vec!["unfinished goal".to_string()];
        if let (Some(today), Some(target)) =
            (today, goal.target_date.as_deref().and_then(Date::parse))
        {
            let days = target.days_since_epoch() - today.days_since_epoch();
            if days < 0 {
                score += 65;
                reasons.push(format!(
                    "overdue by {} day{}",
                    -days,
                    if days == -1 { "" } else { "s" }
                ));
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
            goal_id: Some(goal.id),
            title: goal.text.clone(),
            m_start: None,
            m_end: None,
            score,
            reasons,
        });
    }

    for block in input.blocks.iter().filter(|block| {
        matches!(
            block.set_state.as_str(),
            "active" | "paused" | "legacy_open"
        )
    }) {
        let remaining = block
            .attempt_ceiling
            .map(|ceiling| ceiling.saturating_sub(block.tries));
        let mut score = 58 + remaining.unwrap_or(0).min(20) as i32;
        let mut reasons = match remaining {
            Some(remaining) => vec![format!(
                "{remaining} attempts until the optional review boundary"
            )],
            None => vec!["unresolved mastery contract; no attempt ceiling".into()],
        };
        if block.tries > 0 {
            score += 8;
            reasons.push("resume existing work instead of starting over".into());
        }
        output.push(WorkSuggestion {
            id: format!("block:{}", block.block_id),
            kind: "open_block".into(),
            goal_id: None,
            title: block
                .label
                .clone()
                .unwrap_or_else(|| format!("Measures {}–{}", block.m_start, block.m_end)),
            m_start: Some(block.m_start),
            m_end: Some(block.m_end),
            score,
            reasons,
        });
    }

    for region in input.regions.iter().filter(|region| region.reps > 0) {
        let mut score = 40;
        let mut reasons = Vec::new();
        if region.reps >= 3 && region.clean_ratio < 0.75 {
            score += ((0.75 - region.clean_ratio) * 40.0).round() as i32;
            reasons.push(format!(
                "{}% clean across {} reps; this Region is not consolidated",
                (region.clean_ratio * 100.0).round() as u32,
                region.reps
            ));
        }
        if let Some(signal) = signals.get(&region.region_id) {
            if signal.recent_misses > 0 {
                score += signal.recent_misses.min(3) as i32 * 8;
                reasons.push(format!(
                    "{} of the last {} attempts were flawed or failed",
                    signal.recent_misses, signal.recent_attempts
                ));
            }
        }
        if let (Some(today), Some(last)) = (
            today,
            region
                .last_practiced
                .as_deref()
                .and_then(|value| value.get(0..10))
                .and_then(Date::parse),
        ) {
            let age = today.days_since_epoch() - last.days_since_epoch();
            if age >= 3 {
                score += age.min(21) as i32;
                reasons.push(format!(
                    "last practiced {age} days ago; revisit for consolidation"
                ));
            }
        }
        if reasons.is_empty() {
            continue;
        }
        output.push(WorkSuggestion {
            id: format!("region:{}", region.region_id),
            kind: "revisit".into(),
            goal_id: None,
            title: region.name.clone(),
            m_start: None,
            m_end: None,
            score,
            reasons,
        });
    }

    output.sort_by(|a, b| b.score.cmp(&a.score).then_with(|| a.id.cmp(&b.id)));
    output.truncate(7);
    output
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
            attempt_ceiling: Some(planned_reps),
            contract_source: "native_v2".into(),
            status: "open".into(),
            reps_done,
            attempts_recorded: reps_done,
            tries: reps_done,
            voided_attempts: 0,
            current_clean_streak: 0,
            mastery_progress_streak: 0,
            best_clean_streak: 0,
            reset_count: 0,
            accuracy: None,
            required_clean_streak: 5,
            effective_required_clean_streak: 5,
            recovery_remaining: 5,
            review_boundary_reached: false,
            mastery_status: "not_satisfied".into(),
            mastery_verified: true,
            set_state: "active".into(),
            last_attempt_id: None,
            last_adjustment_id: None,
            verdicts: VerdictCounts {
                clean: 0,
                flawed: 0,
                failed: 0,
            },
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
            region_signals: vec![],
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
            clean_ratio: 1.0,
            best_bpm: Some(80.0),
            last_practiced: Some(format!("{date}T12:00:00Z")),
        };
        let out = preview(&PlanInput {
            today: "2026-07-12".into(),
            goals: vec![],
            blocks: vec![],
            regions: vec![mk(1, "2026-07-11"), mk(2, "2026-07-05")],
            region_signals: vec![],
        });
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].id, "region:2");
        assert!(out[0].reasons[0].contains("7 days"));
    }

    #[test]
    fn preview_never_mutates_and_caps_output() {
        let goals = (1..=10)
            .map(|id| goal(id, &format!("G{id}"), None))
            .collect();
        let out = preview(&PlanInput {
            today: "2026-07-12".into(),
            goals,
            blocks: vec![],
            regions: vec![],
            region_signals: vec![],
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
            region_signals: vec![],
        });
        assert_eq!(out[0].score, 35);
        assert_eq!(out[0].reasons, vec!["unfinished goal"]);
    }

    #[test]
    fn weak_region_and_recent_misses_are_exposed_even_when_practiced_today() {
        let out = preview(&PlanInput {
            today: "2026-07-12".into(),
            goals: vec![],
            blocks: vec![],
            regions: vec![RegionMastery {
                region_id: 7,
                name: "Coda landing".into(),
                blocks: 1,
                reps: 10,
                clean_ratio: 0.4,
                best_bpm: Some(92.0),
                last_practiced: Some("2026-07-12T18:00:00Z".into()),
            }],
            region_signals: vec![RegionSignal {
                region_id: 7,
                recent_attempts: 5,
                recent_misses: 3,
            }],
        });
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].id, "region:7");
        assert!(out[0]
            .reasons
            .iter()
            .any(|reason| reason.contains("40% clean")));
        assert!(out[0]
            .reasons
            .iter()
            .any(|reason| reason.contains("3 of the last 5")));
    }

    #[test]
    fn recent_region_signals_exclude_voided_attempts() {
        let blocks = [BlockMeta {
            block_id: 10,
            region_id: Some(7),
            focus: "notes".into(),
        }];
        let attempt = |id, verdict: &str, voided| Rep {
            id,
            block_id: 10,
            ts: format!("2026-07-12 10:00:0{id}"),
            bpm: None,
            variant: None,
            verdict: verdict.into(),
            note: None,
            original_verdict: verdict.into(),
            voided,
            source: "user_click".into(),
            active_adjustment_ids: vec![],
        };
        let signals = recent_region_signals(
            &blocks,
            &[attempt(1, "clean", false), attempt(2, "failed", true)],
        );
        assert_eq!(
            signals,
            vec![RegionSignal {
                region_id: 7,
                recent_attempts: 1,
                recent_misses: 0,
            }]
        );
    }
}
