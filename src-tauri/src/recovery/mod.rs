//! Pure, deterministic missed-day recovery planning.
//!
//! This module deliberately has no store or Tauri dependency. It receives an
//! immutable snapshot, proposes moves, and exposes every placement constraint.
//! Applying a proposal (including optimistic-lock checks and audit events) is a
//! separate storage concern.

use std::collections::{BTreeMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::date::Date;

pub const RECOVERY_HORIZON_DAYS: u8 = 7;

/// Locked recovery ceiling: recovered work may consume at most half of the
/// visible daily capacity. Integer capacities round down, never up.
pub const fn recovery_limit_minutes(capacity_minutes: u32) -> u32 {
    capacity_minutes / 2
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RecoveryInput {
    /// Backend-derived user-local date in strict `YYYY-MM-DD` form.
    pub today: String,
    /// Visible total-work ceiling for each day.
    pub capacity_minutes: u32,
    pub missed_work: Vec<MissedDailyWork>,
    pub existing_days: Vec<ExistingDayPlan>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MissedDailyWork {
    pub id: i64,
    pub goal_id: i64,
    pub planned_minutes: u32,
    /// The first date this work was assigned. Recovery must never change it.
    pub origin_date: String,
    /// The current (missed) date. This, not `origin_date`, drives missed age.
    pub scheduled_date: String,
    /// The earliest applicable goal/work deadline, if any.
    pub effective_deadline: Option<String>,
    pub goal_order: i64,
    /// Opaque optimistic-lock token copied into the proposal for Apply.
    pub expected_updated_ts: String,
    pub reschedule_count: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExistingDayPlan {
    pub date: String,
    /// All already-planned work on the day, including recovered work.
    pub planned_minutes: u32,
    /// The recovered subset of `planned_minutes`.
    pub recovery_minutes: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RecoveryPreview {
    pub today: String,
    pub capacity_minutes: u32,
    pub recovery_limit_minutes: u32,
    pub days: Vec<RecoveryDayPreview>,
    pub items: Vec<RecoveryItemPreview>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RecoveryDayPreview {
    pub date: String,
    pub capacity_minutes: u32,
    pub recovery_limit_minutes: u32,
    pub existing_planned_minutes: u32,
    pub existing_recovery_minutes: u32,
    pub proposed_recovery_minutes: u32,
    pub total_after_preview_minutes: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RecoveryItemPreview {
    pub id: i64,
    pub goal_id: i64,
    pub planned_minutes: u32,
    pub origin_date: String,
    pub scheduled_date: String,
    pub effective_deadline: Option<String>,
    pub goal_order: i64,
    pub expected_updated_ts: String,
    pub current_reschedule_count: u32,
    /// What Apply would store for a Move. Preview itself stores nothing.
    pub proposed_reschedule_count: Option<u32>,
    pub proposed_date: Option<String>,
    pub outcome: RecoveryOutcome,
    pub unresolved: Option<RecoveryUnresolved>,
    pub priority: RecoveryPriority,
    pub traces: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RecoveryOutcome {
    ProposedMove,
    Unresolved,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RecoveryPriority {
    /// `None` sorts after every real deadline.
    pub effective_deadline: Option<String>,
    pub missed_date: String,
    pub goal_order: i64,
    pub work_id: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UnresolvedReason {
    DuplicateWorkId,
    InvalidOriginDate,
    InvalidScheduledDate,
    NotMissed,
    InvalidEffectiveDeadline,
    DeadlineBeforeToday,
    InvalidPlannedMinutes,
    OversizedForRecoveryShare,
    NoCapacityBeforeDeadline,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RecoveryUnresolved {
    pub code: UnresolvedReason,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "code", rename_all = "snake_case")]
pub enum RecoveryError {
    InvalidToday {
        value: String,
    },
    HorizonOverflow {
        today: String,
    },
    ZeroCapacity,
    InvalidDayDate {
        value: String,
    },
    DuplicateDayDate {
        value: String,
    },
    RecoveryMinutesExceedPlanned {
        date: String,
        recovery_minutes: u32,
        planned_minutes: u32,
    },
}

#[derive(Debug, Clone)]
struct ValidItem {
    item: MissedDailyWork,
    scheduled: Date,
    deadline: Option<Date>,
}

#[derive(Debug, Clone)]
struct DayState {
    date: Date,
    existing_planned: u32,
    existing_recovery: u32,
    proposed_recovery: u32,
}

/// Produce a seven-day recovery preview without I/O or mutation.
///
/// Valid items are ranked by effective deadline, oldest missed date, goal
/// order, then work id. Each proposed move is whole and lands on the earliest
/// day that satisfies both the total-work and recovery-share ceilings.
pub fn preview(input: &RecoveryInput) -> Result<RecoveryPreview, RecoveryError> {
    if input.capacity_minutes == 0 {
        return Err(RecoveryError::ZeroCapacity);
    }

    let today = Date::parse(&input.today).ok_or_else(|| RecoveryError::InvalidToday {
        value: input.today.clone(),
    })?;
    let recovery_limit = recovery_limit_minutes(input.capacity_minutes);

    let horizon = (0..RECOVERY_HORIZON_DAYS)
        .map(|offset| today.add_days(offset.into()))
        .collect::<Option<Vec<_>>>()
        .ok_or_else(|| RecoveryError::HorizonOverflow {
            today: input.today.clone(),
        })?;
    let mut existing = BTreeMap::<Date, &ExistingDayPlan>::new();
    for day in &input.existing_days {
        let date = Date::parse(&day.date).ok_or_else(|| RecoveryError::InvalidDayDate {
            value: day.date.clone(),
        })?;
        if existing.insert(date, day).is_some() {
            return Err(RecoveryError::DuplicateDayDate {
                value: day.date.clone(),
            });
        }
        if day.recovery_minutes > day.planned_minutes {
            return Err(RecoveryError::RecoveryMinutesExceedPlanned {
                date: day.date.clone(),
                recovery_minutes: day.recovery_minutes,
                planned_minutes: day.planned_minutes,
            });
        }
    }

    let mut days = horizon
        .iter()
        .map(|date| {
            let load = existing.get(date);
            DayState {
                date: *date,
                existing_planned: load.map_or(0, |day| day.planned_minutes),
                existing_recovery: load.map_or(0, |day| day.recovery_minutes),
                proposed_recovery: 0,
            }
        })
        .collect::<Vec<_>>();

    let duplicate_ids = duplicate_work_ids(&input.missed_work);
    let mut valid = Vec::<ValidItem>::new();
    let mut output = Vec::<RecoveryItemPreview>::new();

    for item in &input.missed_work {
        let priority = priority_from(item);
        if duplicate_ids.contains(&item.id) {
            output.push(unresolved(
                item,
                priority,
                UnresolvedReason::DuplicateWorkId,
                format!(
                    "work id {} appears more than once in the preview snapshot",
                    item.id
                ),
            ));
            continue;
        }
        if Date::parse(&item.origin_date).is_none() {
            output.push(unresolved(
                item,
                priority,
                UnresolvedReason::InvalidOriginDate,
                format!(
                    "origin date {} is not a strict Gregorian date",
                    item.origin_date
                ),
            ));
            continue;
        }
        let Some(scheduled) = Date::parse(&item.scheduled_date) else {
            output.push(unresolved(
                item,
                priority,
                UnresolvedReason::InvalidScheduledDate,
                format!(
                    "scheduled date {} is not a strict Gregorian date",
                    item.scheduled_date
                ),
            ));
            continue;
        };
        if scheduled >= today {
            output.push(unresolved(
                item,
                priority,
                UnresolvedReason::NotMissed,
                format!(
                    "scheduled date {} is not before local today {}",
                    item.scheduled_date, input.today
                ),
            ));
            continue;
        }
        let deadline = match item.effective_deadline.as_deref() {
            Some(raw) => match Date::parse(raw) {
                Some(date) => Some(date),
                None => {
                    output.push(unresolved(
                        item,
                        priority,
                        UnresolvedReason::InvalidEffectiveDeadline,
                        format!("effective deadline {raw} is not a strict Gregorian date"),
                    ));
                    continue;
                }
            },
            None => None,
        };
        if deadline.is_some_and(|date| date < today) {
            output.push(unresolved(
                item,
                priority,
                UnresolvedReason::DeadlineBeforeToday,
                format!(
                    "effective deadline {} passed before local today {}",
                    item.effective_deadline.as_deref().unwrap_or_default(),
                    input.today
                ),
            ));
            continue;
        }
        if item.planned_minutes == 0 {
            output.push(unresolved(
                item,
                priority,
                UnresolvedReason::InvalidPlannedMinutes,
                "planned minutes must be at least 1".into(),
            ));
            continue;
        }
        if item.planned_minutes > recovery_limit || item.planned_minutes > input.capacity_minutes {
            output.push(unresolved(
                item,
                priority,
                UnresolvedReason::OversizedForRecoveryShare,
                format!(
                    "{} minutes exceeds this preview's {}-minute per-day recovery allowance",
                    item.planned_minutes,
                    recovery_limit.min(input.capacity_minutes)
                ),
            ));
            continue;
        }
        valid.push(ValidItem {
            item: item.clone(),
            scheduled,
            deadline,
        });
    }

    valid.sort_by(|a, b| {
        compare_deadlines(a.deadline, b.deadline)
            .then_with(|| a.scheduled.cmp(&b.scheduled))
            .then_with(|| a.item.goal_order.cmp(&b.item.goal_order))
            .then_with(|| a.item.id.cmp(&b.item.id))
    });

    for valid_item in valid {
        let item = &valid_item.item;
        let priority = priority_from(item);
        let placement = days.iter_mut().find(|day| {
            if valid_item
                .deadline
                .is_some_and(|deadline| day.date > deadline)
            {
                return false;
            }
            let total_after = day
                .existing_planned
                .saturating_add(day.proposed_recovery)
                .saturating_add(item.planned_minutes);
            let recovery_after = day
                .existing_recovery
                .saturating_add(day.proposed_recovery)
                .saturating_add(item.planned_minutes);
            total_after <= input.capacity_minutes && recovery_after <= recovery_limit
        });

        match placement {
            Some(day) => {
                day.proposed_recovery += item.planned_minutes;
                let proposed_date = day.date.to_string();
                let next_count = item.reschedule_count.saturating_add(1);
                output.push(RecoveryItemPreview {
                    id: item.id,
                    goal_id: item.goal_id,
                    planned_minutes: item.planned_minutes,
                    origin_date: item.origin_date.clone(),
                    scheduled_date: item.scheduled_date.clone(),
                    effective_deadline: item.effective_deadline.clone(),
                    goal_order: item.goal_order,
                    expected_updated_ts: item.expected_updated_ts.clone(),
                    current_reschedule_count: item.reschedule_count,
                    proposed_reschedule_count: Some(next_count),
                    proposed_date: Some(proposed_date.clone()),
                    outcome: RecoveryOutcome::ProposedMove,
                    unresolved: None,
                    priority,
                    traces: vec![
                        priority_trace(item),
                        format!(
                            "placed on earliest available date {proposed_date} within {} through {}",
                            input.today,
                            horizon.last().expect("seven-day horizon")
                        ),
                        format!(
                            "{} recovered minutes fit the {}-minute recovery limit and {}-minute total capacity",
                            item.planned_minutes, recovery_limit, input.capacity_minutes
                        ),
                        format!(
                            "origin date {} remains unchanged; Apply would increment reschedule count {} -> {}",
                            item.origin_date, item.reschedule_count, next_count
                        ),
                    ],
                });
            }
            None => {
                let deadline_text = item.effective_deadline.as_deref().map_or_else(
                    || "the seven-day horizon".to_string(),
                    |date| format!("effective deadline {date}"),
                );
                output.push(unresolved(
                    item,
                    priority,
                    UnresolvedReason::NoCapacityBeforeDeadline,
                    format!(
                        "no day from {} through {deadline_text} has both total and recovery-share capacity for {} minutes",
                        input.today, item.planned_minutes
                    ),
                ));
            }
        }
    }

    output.sort_by(compare_item_priority);

    Ok(RecoveryPreview {
        today: input.today.clone(),
        capacity_minutes: input.capacity_minutes,
        recovery_limit_minutes: recovery_limit,
        days: days
            .into_iter()
            .map(|day| RecoveryDayPreview {
                date: day.date.to_string(),
                capacity_minutes: input.capacity_minutes,
                recovery_limit_minutes: recovery_limit,
                existing_planned_minutes: day.existing_planned,
                existing_recovery_minutes: day.existing_recovery,
                proposed_recovery_minutes: day.proposed_recovery,
                total_after_preview_minutes: day
                    .existing_planned
                    .saturating_add(day.proposed_recovery),
            })
            .collect(),
        items: output,
    })
}

fn duplicate_work_ids(items: &[MissedDailyWork]) -> HashSet<i64> {
    let mut seen = HashSet::new();
    let mut duplicates = HashSet::new();
    for item in items {
        if !seen.insert(item.id) {
            duplicates.insert(item.id);
        }
    }
    duplicates
}

fn priority_from(item: &MissedDailyWork) -> RecoveryPriority {
    RecoveryPriority {
        effective_deadline: item.effective_deadline.clone(),
        missed_date: item.scheduled_date.clone(),
        goal_order: item.goal_order,
        work_id: item.id,
    }
}

fn priority_trace(item: &MissedDailyWork) -> String {
    format!(
        "priority: deadline {} -> missed date {} -> goal order {} -> work id {}",
        item.effective_deadline.as_deref().unwrap_or("none"),
        item.scheduled_date,
        item.goal_order,
        item.id
    )
}

fn unresolved(
    item: &MissedDailyWork,
    priority: RecoveryPriority,
    code: UnresolvedReason,
    message: String,
) -> RecoveryItemPreview {
    RecoveryItemPreview {
        id: item.id,
        goal_id: item.goal_id,
        planned_minutes: item.planned_minutes,
        origin_date: item.origin_date.clone(),
        scheduled_date: item.scheduled_date.clone(),
        effective_deadline: item.effective_deadline.clone(),
        goal_order: item.goal_order,
        expected_updated_ts: item.expected_updated_ts.clone(),
        current_reschedule_count: item.reschedule_count,
        proposed_reschedule_count: None,
        proposed_date: None,
        outcome: RecoveryOutcome::Unresolved,
        unresolved: Some(RecoveryUnresolved {
            code,
            message: message.clone(),
        }),
        priority,
        traces: vec![priority_trace(item), format!("unresolved: {message}")],
    }
}

fn compare_deadlines(a: Option<Date>, b: Option<Date>) -> std::cmp::Ordering {
    match (a, b) {
        (Some(a), Some(b)) => a.cmp(&b),
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (None, None) => std::cmp::Ordering::Equal,
    }
}

fn compare_item_priority(a: &RecoveryItemPreview, b: &RecoveryItemPreview) -> std::cmp::Ordering {
    let a_deadline = a.effective_deadline.as_deref().and_then(Date::parse);
    let b_deadline = b.effective_deadline.as_deref().and_then(Date::parse);
    compare_deadlines(a_deadline, b_deadline)
        .then_with(|| {
            match (
                Date::parse(&a.scheduled_date),
                Date::parse(&b.scheduled_date),
            ) {
                (Some(a), Some(b)) => a.cmp(&b),
                (Some(_), None) => std::cmp::Ordering::Less,
                (None, Some(_)) => std::cmp::Ordering::Greater,
                (None, None) => std::cmp::Ordering::Equal,
            }
        })
        .then_with(|| a.goal_order.cmp(&b.goal_order))
        .then_with(|| a.id.cmp(&b.id))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(id: i64, minutes: u32, scheduled: &str) -> MissedDailyWork {
        MissedDailyWork {
            id,
            goal_id: 10,
            planned_minutes: minutes,
            origin_date: scheduled.into(),
            scheduled_date: scheduled.into(),
            effective_deadline: None,
            goal_order: 0,
            expected_updated_ts: format!("token-{id}"),
            reschedule_count: 0,
        }
    }

    fn input(today: &str, capacity: u32, work: Vec<MissedDailyWork>) -> RecoveryInput {
        RecoveryInput {
            today: today.into(),
            capacity_minutes: capacity,
            missed_work: work,
            existing_days: vec![],
        }
    }

    #[test]
    fn horizon_crosses_leap_day_month_and_year_boundaries() {
        let leap = preview(&input("2028-02-27", 60, vec![])).unwrap();
        assert_eq!(leap.days[2].date, "2028-02-29");
        assert_eq!(leap.days[3].date, "2028-03-01");

        let century = preview(&input("2100-02-27", 60, vec![])).unwrap();
        assert_eq!(century.days[2].date, "2100-03-01");

        let year = preview(&input("2026-12-29", 60, vec![])).unwrap();
        assert_eq!(year.days[3].date, "2027-01-01");
        assert_eq!(year.days[6].date, "2027-01-04");
    }

    #[test]
    fn rejects_non_gregorian_dates_and_horizon_overflow() {
        assert_eq!(
            preview(&input("2026-02-29", 60, vec![])),
            Err(RecoveryError::InvalidToday {
                value: "2026-02-29".into()
            })
        );
        assert_eq!(
            preview(&input("9999-12-30", 60, vec![])),
            Err(RecoveryError::HorizonOverflow {
                today: "9999-12-30".into()
            })
        );
    }

    #[test]
    fn respects_total_capacity_and_exact_half_recovery_share() {
        let mut snapshot = input(
            "2026-07-12",
            20,
            vec![item(1, 15, "2026-07-10"), item(2, 6, "2026-07-11")],
        );
        snapshot.existing_days = vec![ExistingDayPlan {
            date: "2026-07-12".into(),
            planned_minutes: 5,
            recovery_minutes: 0,
        }];

        let result = preview(&snapshot).unwrap();
        assert_eq!(result.recovery_limit_minutes, 10);
        assert_eq!(result.items[0].proposed_date, None);
        assert_eq!(
            result.items[0].unresolved.as_ref().unwrap().code,
            UnresolvedReason::OversizedForRecoveryShare
        );
        assert_eq!(result.items[1].proposed_date.as_deref(), Some("2026-07-12"));
        assert_eq!(result.days[0].total_after_preview_minutes, 11);
        assert_eq!(result.days[0].proposed_recovery_minutes, 6);
        assert!(result.days.iter().all(|day| {
            day.total_after_preview_minutes <= day.capacity_minutes
                && day.existing_recovery_minutes + day.proposed_recovery_minutes
                    <= day.recovery_limit_minutes
        }));
    }

    #[test]
    fn existing_recovery_consumes_the_recovery_share() {
        let mut snapshot = input("2026-07-12", 60, vec![item(1, 20, "2026-07-11")]);
        snapshot.existing_days = vec![ExistingDayPlan {
            date: "2026-07-12".into(),
            planned_minutes: 50,
            recovery_minutes: 20,
        }];
        let result = preview(&snapshot).unwrap();
        assert_eq!(result.items[0].proposed_date.as_deref(), Some("2026-07-13"));
    }

    #[test]
    fn stable_priority_is_deadline_then_age_then_goal_order_then_id() {
        let mut work = vec![
            item(40, 10, "2026-07-10"),
            item(20, 10, "2026-07-10"),
            item(30, 10, "2026-07-09"),
            item(10, 10, "2026-07-08"),
        ];
        work[0].effective_deadline = Some("2026-07-14".into());
        work[1].effective_deadline = Some("2026-07-14".into());
        work[1].goal_order = 1;
        work[0].goal_order = 2;
        work[2].effective_deadline = Some("2026-07-15".into());
        work[3].effective_deadline = None;

        let result = preview(&input("2026-07-12", 60, work)).unwrap();
        let ids = result.items.iter().map(|row| row.id).collect::<Vec<_>>();
        assert_eq!(ids, vec![20, 40, 30, 10]);
        assert!(result.items[0].traces[0].contains("goal order 1"));
        assert!(result.items[0].traces[0].contains("work id 20"));
    }

    #[test]
    fn exact_tie_breaks_by_work_id_and_is_repeatable() {
        let mut a = item(2, 10, "2026-07-11");
        let mut b = item(1, 10, "2026-07-11");
        a.effective_deadline = Some("2026-07-16".into());
        b.effective_deadline = Some("2026-07-16".into());
        let snapshot = input("2026-07-12", 60, vec![a, b]);
        let first = preview(&snapshot).unwrap();
        let second = preview(&snapshot).unwrap();
        assert_eq!(first, second);
        assert_eq!(first.items[0].id, 1);
        assert_eq!(first.items[1].id, 2);
    }

    #[test]
    fn deadline_conflict_stays_unresolved_instead_of_overloading() {
        let mut missed = item(7, 20, "2026-07-10");
        missed.effective_deadline = Some("2026-07-12".into());
        let mut snapshot = input("2026-07-12", 60, vec![missed]);
        snapshot.existing_days = vec![ExistingDayPlan {
            date: "2026-07-12".into(),
            planned_minutes: 50,
            recovery_minutes: 20,
        }];

        let result = preview(&snapshot).unwrap();
        assert_eq!(result.items[0].outcome, RecoveryOutcome::Unresolved);
        assert_eq!(result.items[0].proposed_date, None);
        assert!(result.items[0].traces[1].contains("no day"));
        assert_eq!(result.days[0].total_after_preview_minutes, 50);
    }

    #[test]
    fn oversized_work_is_explicitly_unresolved() {
        let result = preview(&input("2026-07-12", 60, vec![item(1, 31, "2026-07-11")])).unwrap();
        assert_eq!(result.items[0].outcome, RecoveryOutcome::Unresolved);
        assert!(result.items[0].traces[1].contains("30-minute"));
    }

    #[test]
    fn repeated_miss_keeps_origin_and_only_proposes_next_count() {
        let mut repeated = item(9, 15, "2026-07-10");
        repeated.origin_date = "2026-07-01".into();
        repeated.reschedule_count = 3;
        let snapshot = input("2026-07-12", 60, vec![repeated]);
        let before = snapshot.clone();

        let result = preview(&snapshot).unwrap();

        assert_eq!(snapshot, before, "preview must not mutate its input");
        assert_eq!(result.items[0].origin_date, "2026-07-01");
        assert_eq!(result.items[0].scheduled_date, "2026-07-10");
        assert_eq!(result.items[0].current_reschedule_count, 3);
        assert_eq!(result.items[0].proposed_reschedule_count, Some(4));
        assert!(result.items[0].traces[3].contains("remains unchanged"));
    }

    #[test]
    fn future_work_is_not_recovered() {
        let result = preview(&input(
            "2026-07-12",
            60,
            vec![item(1, 15, "2026-07-12"), item(2, 15, "2026-07-13")],
        ))
        .unwrap();
        assert!(result
            .items
            .iter()
            .all(|row| row.outcome == RecoveryOutcome::Unresolved));
        assert!(result.items.iter().all(|row| row.proposed_date.is_none()));
        assert!(result
            .days
            .iter()
            .all(|day| day.proposed_recovery_minutes == 0));
    }

    #[test]
    fn duplicate_snapshot_rows_never_receive_two_moves() {
        let repeated = item(1, 10, "2026-07-11");
        let result = preview(&input("2026-07-12", 60, vec![repeated.clone(), repeated])).unwrap();
        assert_eq!(result.items.len(), 2);
        assert!(result
            .items
            .iter()
            .all(|row| row.outcome == RecoveryOutcome::Unresolved));
        assert_eq!(result.days[0].proposed_recovery_minutes, 0);
    }
}
