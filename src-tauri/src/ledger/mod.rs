//! Pure effective-attempt folding and practice-set summaries.
//!
//! Original attempts remain visible. Append-only adjustments determine the
//! effective projection; no function here mutates a row or consults live state.

use std::collections::{BTreeMap, HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::protocol::{
    self, AttemptVerdict, ContractEvaluation, EvaluationInput, PracticeContract,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MutationSource {
    UserClick,
    VoiceHotLoop,
    VoiceDraft,
    BrainDraft,
    ImportReview,
    MigrationLegacy,
    SystemSchedule,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AttemptRecord {
    pub id: i64,
    pub verdict: AttemptVerdict,
    pub bpm: Option<f64>,
    pub note: Option<String>,
    pub source: MutationSource,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AdjustmentKind {
    Void,
    Restore,
    ReplaceVerdict {
        verdict: AttemptVerdict,
    },
    ReplaceNote {
        note: Option<String>,
    },
    CombinedCorrection {
        verdict: AttemptVerdict,
        note: Option<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AdjustmentRecord {
    pub id: i64,
    pub attempt_id: i64,
    pub kind: AdjustmentKind,
    /// A reversal is itself append-only. Its payload is ignored; disabling the
    /// referenced prior adjustment restores the preceding effective state.
    pub reverses_adjustment_id: Option<i64>,
    pub source: MutationSource,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EffectiveAttempt {
    pub id: i64,
    pub original_verdict: AttemptVerdict,
    pub verdict: AttemptVerdict,
    pub bpm: Option<f64>,
    pub note: Option<String>,
    pub source: MutationSource,
    pub voided: bool,
    pub active_adjustment_ids: Vec<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TempoPoint {
    pub attempt_id: i64,
    pub bpm: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LedgerSummary {
    pub attempts_recorded: u32,
    pub tries: u32,
    pub voided_attempts: u32,
    pub clean: u32,
    pub flawed: u32,
    pub failed: u32,
    pub current_clean_streak: u32,
    pub best_clean_streak: u32,
    pub reset_count: u32,
    pub accuracy: Option<f64>,
    pub adjustment_count: u32,
    pub source_mix: BTreeMap<MutationSource, u32>,
    pub tempo_path: Vec<TempoPoint>,
    pub effective_attempts: Vec<EffectiveAttempt>,
    pub contract: ContractEvaluation,
}

/// Accepted runtime consequences folded beside immutable attempts. These are
/// projections of append-only recovery rows, never edits to the captured
/// [`PracticeContract`].
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct RecoveryDirectives {
    pub reset_after_attempt_id: Option<i64>,
    pub manual_clean_debt: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LedgerError {
    Protocol(protocol::ProtocolError),
    DuplicateAttemptId(i64),
    DuplicateAdjustmentId(i64),
    UnknownAttempt(i64),
    UnknownOrFutureReversal(i64),
    CrossAttemptReversal { adjustment_id: i64, target_id: i64 },
    InvalidTempo(i64),
    UnknownRecoveryBoundary(i64),
    CountOverflow,
}

impl From<protocol::ProtocolError> for LedgerError {
    fn from(value: protocol::ProtocolError) -> Self {
        Self::Protocol(value)
    }
}

pub fn derive(
    contract: &PracticeContract,
    attempts: &[AttemptRecord],
    adjustments: &[AdjustmentRecord],
    active_seconds: u32,
) -> Result<LedgerSummary, LedgerError> {
    derive_with_recovery(
        contract,
        attempts,
        adjustments,
        active_seconds,
        RecoveryDirectives::default(),
    )
}

pub fn derive_with_recovery(
    contract: &PracticeContract,
    attempts: &[AttemptRecord],
    adjustments: &[AdjustmentRecord],
    active_seconds: u32,
    recovery: RecoveryDirectives,
) -> Result<LedgerSummary, LedgerError> {
    contract.validate()?;

    let mut attempt_ids = HashSet::new();
    for attempt in attempts {
        if !attempt_ids.insert(attempt.id) {
            return Err(LedgerError::DuplicateAttemptId(attempt.id));
        }
        if attempt
            .bpm
            .is_some_and(|bpm| !bpm.is_finite() || bpm <= 0.0)
        {
            return Err(LedgerError::InvalidTempo(attempt.id));
        }
    }
    if let Some(boundary) = recovery.reset_after_attempt_id {
        if !attempt_ids.contains(&boundary) {
            return Err(LedgerError::UnknownRecoveryBoundary(boundary));
        }
    }

    // SQLite row ids are the durable commit order for both tables. Callers may
    // load rows through joins (or tests/import review may supply them in an
    // arbitrary order), so never let slice order change streaks, tempo paths,
    // or adjustment meaning. The id is also the deterministic tie-break when
    // legacy rows share the same second-resolution timestamp.
    let mut ordered_attempts = attempts.iter().collect::<Vec<_>>();
    ordered_attempts.sort_unstable_by_key(|attempt| attempt.id);

    let mut ordered_adjustments = adjustments.iter().collect::<Vec<_>>();
    ordered_adjustments.sort_unstable_by_key(|adjustment| adjustment.id);

    let mut adjustment_positions: HashMap<i64, usize> = HashMap::new();
    for (position, adjustment) in ordered_adjustments.iter().enumerate() {
        if !attempt_ids.contains(&adjustment.attempt_id) {
            return Err(LedgerError::UnknownAttempt(adjustment.attempt_id));
        }
        if adjustment_positions.contains_key(&adjustment.id) {
            return Err(LedgerError::DuplicateAdjustmentId(adjustment.id));
        }
        if let Some(target_id) = adjustment.reverses_adjustment_id {
            let Some(target_position) = adjustment_positions.get(&target_id).copied() else {
                return Err(LedgerError::UnknownOrFutureReversal(target_id));
            };
            let target = ordered_adjustments[target_position];
            if target.attempt_id != adjustment.attempt_id {
                return Err(LedgerError::CrossAttemptReversal {
                    adjustment_id: adjustment.id,
                    target_id,
                });
            }
        }
        adjustment_positions.insert(adjustment.id, position);
    }

    // Work backward so reversing a reversal reactivates the original change.
    let mut disabled_adjustments = HashSet::new();
    for adjustment in ordered_adjustments.iter().rev() {
        if disabled_adjustments.contains(&adjustment.id) {
            continue;
        }
        if let Some(target) = adjustment.reverses_adjustment_id {
            disabled_adjustments.insert(target);
        }
    }

    let mut by_attempt: HashMap<i64, Vec<&AdjustmentRecord>> = HashMap::new();
    for adjustment in ordered_adjustments {
        if disabled_adjustments.contains(&adjustment.id)
            || adjustment.reverses_adjustment_id.is_some()
        {
            continue;
        }
        by_attempt
            .entry(adjustment.attempt_id)
            .or_default()
            .push(adjustment);
    }

    let mut effective_attempts = Vec::with_capacity(attempts.len());
    for attempt in ordered_attempts {
        let mut effective = EffectiveAttempt {
            id: attempt.id,
            original_verdict: attempt.verdict,
            verdict: attempt.verdict,
            bpm: attempt.bpm,
            note: attempt.note.clone(),
            source: attempt.source,
            voided: false,
            active_adjustment_ids: Vec::new(),
        };
        if let Some(changes) = by_attempt.get(&attempt.id) {
            for change in changes {
                effective.active_adjustment_ids.push(change.id);
                match &change.kind {
                    AdjustmentKind::Void => effective.voided = true,
                    AdjustmentKind::Restore => effective.voided = false,
                    AdjustmentKind::ReplaceVerdict { verdict } => {
                        effective.verdict = *verdict;
                    }
                    AdjustmentKind::ReplaceNote { note } => effective.note.clone_from(note),
                    AdjustmentKind::CombinedCorrection { verdict, note } => {
                        effective.verdict = *verdict;
                        effective.note.clone_from(note);
                    }
                }
            }
        }
        effective_attempts.push(effective);
    }

    let attempts_recorded = count_u32(attempts.len())?;
    let adjustment_count = count_u32(adjustments.len())?;
    let mut tries = 0_u32;
    let mut voided_attempts = 0_u32;
    let mut clean = 0_u32;
    let mut flawed = 0_u32;
    let mut failed = 0_u32;
    let mut current_clean_streak = 0_u32;
    let mut best_clean_streak = 0_u32;
    let mut reset_count = 0_u32;
    let mut first_clean_seen = false;
    let mut errors_before_first_clean = 0_u32;
    let mut source_mix = BTreeMap::new();
    let mut tempo_path = Vec::new();

    let mut recovery_reset_applied = false;
    for attempt in &effective_attempts {
        if recovery
            .reset_after_attempt_id
            .is_some_and(|boundary| !recovery_reset_applied && attempt.id > boundary)
        {
            current_clean_streak = 0;
            recovery_reset_applied = true;
        }
        if attempt.voided {
            voided_attempts = voided_attempts.saturating_add(1);
            continue;
        }
        tries = tries.saturating_add(1);
        *source_mix.entry(attempt.source).or_insert(0) += 1;
        if let Some(bpm) = attempt.bpm {
            tempo_path.push(TempoPoint {
                attempt_id: attempt.id,
                bpm,
            });
        }

        match attempt.verdict {
            AttemptVerdict::Clean => {
                clean = clean.saturating_add(1);
                first_clean_seen = true;
                current_clean_streak = current_clean_streak.saturating_add(1);
                best_clean_streak = best_clean_streak.max(current_clean_streak);
            }
            AttemptVerdict::Flawed => {
                flawed = flawed.saturating_add(1);
                if !first_clean_seen {
                    errors_before_first_clean = errors_before_first_clean.saturating_add(1);
                }
                if contract.resets(AttemptVerdict::Flawed) {
                    current_clean_streak = 0;
                    reset_count = reset_count.saturating_add(1);
                }
            }
            AttemptVerdict::Failed => {
                failed = failed.saturating_add(1);
                if !first_clean_seen {
                    errors_before_first_clean = errors_before_first_clean.saturating_add(1);
                }
                if contract.resets(AttemptVerdict::Failed) {
                    current_clean_streak = 0;
                    reset_count = reset_count.saturating_add(1);
                }
            }
        }
    }

    // A reset accepted after the latest attempt has no following row on which
    // to trigger the boundary check above. It still resets the projected streak
    // immediately while leaving all historical attempts and the best streak.
    if recovery.reset_after_attempt_id.is_some() && !recovery_reset_applied {
        current_clean_streak = 0;
    }
    if recovery.reset_after_attempt_id.is_some() {
        reset_count = reset_count.saturating_add(1);
    }

    let accuracy = (tries > 0).then(|| f64::from(clean) / f64::from(tries));
    let evaluation = protocol::evaluate_with_clean_debt(
        contract,
        EvaluationInput {
            tries,
            clean_count: clean,
            current_clean_streak,
            active_seconds,
            errors_before_first_clean,
        },
        recovery.manual_clean_debt,
    )?;

    Ok(LedgerSummary {
        attempts_recorded,
        tries,
        voided_attempts,
        clean,
        flawed,
        failed,
        current_clean_streak,
        best_clean_streak,
        reset_count,
        accuracy,
        adjustment_count,
        source_mix,
        tempo_path,
        effective_attempts,
        contract: evaluation,
    })
}

fn count_u32(value: usize) -> Result<u32, LedgerError> {
    u32::try_from(value).map_err(|_| LedgerError::CountOverflow)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::{MasteryStatus, RecoveryPolicy};

    fn attempt(id: i64, verdict: AttemptVerdict) -> AttemptRecord {
        AttemptRecord {
            id,
            verdict,
            bpm: Some(60.0),
            note: None,
            source: MutationSource::UserClick,
        }
    }

    fn summary(verdicts: &[AttemptVerdict]) -> LedgerSummary {
        let attempts = verdicts
            .iter()
            .enumerate()
            .map(|(index, verdict)| attempt(index as i64 + 1, *verdict))
            .collect::<Vec<_>>();
        derive(&PracticeContract::consecutive_clean(5), &attempts, &[], 0).unwrap()
    }

    #[test]
    fn accepted_reset_and_clean_debt_preserve_history_and_extend_one_mastery_projection() {
        let attempts = (1..=2)
            .map(|id| attempt(id, AttemptVerdict::Clean))
            .collect::<Vec<_>>();
        let out = derive_with_recovery(
            &PracticeContract::consecutive_clean(5),
            &attempts,
            &[],
            0,
            RecoveryDirectives {
                reset_after_attempt_id: Some(2),
                manual_clean_debt: 2,
            },
        )
        .unwrap();
        assert_eq!(out.tries, 2);
        assert_eq!(out.clean, 2);
        assert_eq!(out.best_clean_streak, 2);
        assert_eq!(out.current_clean_streak, 0);
        assert_eq!(out.reset_count, 1);
        assert_eq!(out.contract.effective_required_success, 7);
        assert_eq!(out.contract.mastery, MasteryStatus::NotSatisfied);

        let mut recovered = attempts;
        recovered.extend((3..=9).map(|id| attempt(id, AttemptVerdict::Clean)));
        let mastered = derive_with_recovery(
            &PracticeContract::consecutive_clean(5),
            &recovered,
            &[],
            0,
            RecoveryDirectives {
                reset_after_attempt_id: Some(2),
                manual_clean_debt: 2,
            },
        )
        .unwrap();
        assert_eq!(mastered.current_clean_streak, 7);
        assert_eq!(mastered.contract.mastery, MasteryStatus::Satisfied);
    }

    /// Recovery anchors on the physical attempt id — the durable commit
    /// watermark — not the effective (post-void) latest. A reset accepted after
    /// an attempt that is later voided must still resolve its boundary, because
    /// the physical row is present, and reset the projected streak. A boundary
    /// carrying an id no physical row holds is rejected.
    #[test]
    fn recovery_boundary_resolves_on_a_physically_latest_voided_attempt() {
        let attempts = (1..=3)
            .map(|id| attempt(id, AttemptVerdict::Clean))
            .collect::<Vec<_>>();
        let void_latest = AdjustmentRecord {
            id: 1,
            attempt_id: 3,
            kind: AdjustmentKind::Void,
            reverses_adjustment_id: None,
            source: MutationSource::UserClick,
            reason: None,
        };
        let out = derive_with_recovery(
            &PracticeContract::consecutive_clean(5),
            &attempts,
            std::slice::from_ref(&void_latest),
            0,
            RecoveryDirectives {
                reset_after_attempt_id: Some(3),
                manual_clean_debt: 0,
            },
        )
        .expect("the physical boundary resolves even though attempt 3 is voided");
        assert_eq!(out.voided_attempts, 1);
        assert_eq!(out.tries, 2);
        assert_eq!(out.best_clean_streak, 2);
        assert_eq!(out.current_clean_streak, 0);
        assert_eq!(out.reset_count, 1);

        // An id absent from the physical set — as an effective-MAX anchor could
        // produce once the row is gone — must be rejected, not silently ignored.
        assert_eq!(
            derive_with_recovery(
                &PracticeContract::consecutive_clean(5),
                &attempts,
                std::slice::from_ref(&void_latest),
                0,
                RecoveryDirectives {
                    reset_after_attempt_id: Some(4),
                    manual_clean_debt: 0,
                },
            ),
            Err(LedgerError::UnknownRecoveryBoundary(4))
        );
    }

    #[test]
    fn clean_clean_failed_resets_current_and_preserves_best() {
        let out = summary(&[
            AttemptVerdict::Clean,
            AttemptVerdict::Clean,
            AttemptVerdict::Failed,
        ]);
        assert_eq!(out.tries, 3);
        assert_eq!(out.current_clean_streak, 0);
        assert_eq!(out.best_clean_streak, 2);
        assert_eq!(out.reset_count, 1);
        assert_eq!(out.contract.mastery, MasteryStatus::NotSatisfied);
    }

    #[test]
    fn five_cleans_after_reset_master_only_on_the_fifth() {
        let mut verdicts = vec![
            AttemptVerdict::Clean,
            AttemptVerdict::Clean,
            AttemptVerdict::Failed,
        ];
        for clean_number in 1..=5 {
            verdicts.push(AttemptVerdict::Clean);
            let out = summary(&verdicts);
            assert_eq!(out.current_clean_streak, clean_number);
            assert_eq!(
                out.contract.mastery,
                if clean_number == 5 {
                    MasteryStatus::Satisfied
                } else {
                    MasteryStatus::NotSatisfied
                }
            );
        }
    }

    #[test]
    fn ten_failures_never_complete_even_at_attempt_ceiling() {
        let attempts = (1..=10)
            .map(|id| attempt(id, AttemptVerdict::Failed))
            .collect::<Vec<_>>();
        let mut contract = PracticeContract::consecutive_clean(5);
        contract.attempt_ceiling = Some(10);
        let out = derive(&contract, &attempts, &[], 0).unwrap();
        assert_eq!(out.tries, 10);
        assert_eq!(out.clean, 0);
        assert_eq!(out.contract.mastery, MasteryStatus::NotSatisfied);
        assert!(out.contract.review_boundary_reached);
    }

    #[test]
    fn fifty_percent_accuracy_is_not_consecutive_mastery() {
        let verdicts = (0..20)
            .map(|index| {
                if index % 2 == 0 {
                    AttemptVerdict::Clean
                } else {
                    AttemptVerdict::Failed
                }
            })
            .collect::<Vec<_>>();
        let out = summary(&verdicts);
        assert_eq!(out.accuracy, Some(0.5));
        assert_eq!(out.current_clean_streak, 0);
        assert_eq!(out.contract.mastery, MasteryStatus::NotSatisfied);
    }

    #[test]
    fn void_correction_and_reversal_recompute_from_originals() {
        let attempts = vec![
            attempt(1, AttemptVerdict::Clean),
            attempt(2, AttemptVerdict::Clean),
            attempt(3, AttemptVerdict::Failed),
        ];
        let void_last = AdjustmentRecord {
            id: 10,
            attempt_id: 3,
            kind: AdjustmentKind::Void,
            reverses_adjustment_id: None,
            source: MutationSource::UserClick,
            reason: Some("duplicate click".into()),
        };
        let corrected_second = AdjustmentRecord {
            id: 11,
            attempt_id: 2,
            kind: AdjustmentKind::ReplaceVerdict {
                verdict: AttemptVerdict::Failed,
            },
            reverses_adjustment_id: None,
            source: MutationSource::UserClick,
            reason: None,
        };
        let reverse_correction = AdjustmentRecord {
            id: 12,
            attempt_id: 2,
            kind: AdjustmentKind::Restore,
            reverses_adjustment_id: Some(11),
            source: MutationSource::UserClick,
            reason: None,
        };

        let voided = derive(
            &PracticeContract::consecutive_clean(5),
            &attempts,
            std::slice::from_ref(&void_last),
            0,
        )
        .unwrap();
        assert_eq!((voided.tries, voided.current_clean_streak), (2, 2));

        let corrected = derive(
            &PracticeContract::consecutive_clean(5),
            &attempts,
            &[void_last.clone(), corrected_second.clone()],
            0,
        )
        .unwrap();
        assert_eq!(
            (corrected.tries, corrected.clean, corrected.failed),
            (2, 1, 1)
        );
        assert_eq!(corrected.current_clean_streak, 0);

        let reversed = derive(
            &PracticeContract::consecutive_clean(5),
            &attempts,
            &[void_last, corrected_second, reverse_correction],
            0,
        )
        .unwrap();
        assert_eq!((reversed.tries, reversed.clean), (2, 2));
        assert_eq!(reversed.current_clean_streak, 2);
    }

    #[test]
    fn legacy_done_evidence_stays_unverified() {
        let attempts = (1..=10)
            .map(|id| attempt(id, AttemptVerdict::Clean))
            .collect::<Vec<_>>();
        let out = derive(
            &PracticeContract::legacy_attempt_count(10),
            &attempts,
            &[],
            0,
        )
        .unwrap();
        assert_eq!(out.contract.mastery, MasteryStatus::UnverifiedLegacy);
    }

    #[test]
    fn adaptive_recovery_expands_the_streak_after_many_errors() {
        let mut contract = PracticeContract::consecutive_clean(5);
        contract.recovery = RecoveryPolicy::Adaptive {
            ratio_basis_points: 5_000,
            minimum_clean_streak: 5,
        };
        let mut attempts = (1..=12)
            .map(|id| attempt(id, AttemptVerdict::Failed))
            .collect::<Vec<_>>();
        attempts.extend((13..=18).map(|id| attempt(id, AttemptVerdict::Clean)));
        let six = derive(&contract, &attempts, &[], 0).unwrap();
        assert_eq!(six.contract.effective_required_success, 7);
        assert_eq!(six.contract.mastery, MasteryStatus::NotSatisfied);

        attempts.push(attempt(19, AttemptVerdict::Clean));
        assert_eq!(
            derive(&contract, &attempts, &[], 0)
                .unwrap()
                .contract
                .mastery,
            MasteryStatus::Satisfied
        );
    }

    #[test]
    fn ids_define_commit_order_when_rows_and_equal_timestamp_adjustments_arrive_shuffled() {
        let attempts = vec![
            attempt(3, AttemptVerdict::Clean),
            attempt(1, AttemptVerdict::Clean),
            attempt(2, AttemptVerdict::Failed),
        ];
        let correction = AdjustmentRecord {
            id: 10,
            attempt_id: 2,
            kind: AdjustmentKind::ReplaceVerdict {
                verdict: AttemptVerdict::Clean,
            },
            reverses_adjustment_id: None,
            source: MutationSource::ImportReview,
            reason: Some("same-second import correction".into()),
        };
        let reversal = AdjustmentRecord {
            id: 11,
            attempt_id: 2,
            kind: AdjustmentKind::Restore,
            reverses_adjustment_id: Some(10),
            source: MutationSource::UserClick,
            reason: None,
        };

        let out = derive(
            &PracticeContract::consecutive_clean(5),
            &attempts,
            &[reversal, correction],
            0,
        )
        .unwrap();

        assert_eq!(
            out.effective_attempts
                .iter()
                .map(|attempt| attempt.id)
                .collect::<Vec<_>>(),
            vec![1, 2, 3]
        );
        assert_eq!(out.current_clean_streak, 1);
        assert_eq!(
            out.tempo_path
                .iter()
                .map(|point| point.attempt_id)
                .collect::<Vec<_>>(),
            vec![1, 2, 3]
        );
    }

    #[test]
    fn self_and_future_reversals_are_rejected_even_if_the_input_slice_is_shuffled() {
        let attempts = vec![attempt(1, AttemptVerdict::Clean)];
        let self_reversal = AdjustmentRecord {
            id: 10,
            attempt_id: 1,
            kind: AdjustmentKind::Restore,
            reverses_adjustment_id: Some(10),
            source: MutationSource::UserClick,
            reason: None,
        };
        assert_eq!(
            derive(
                &PracticeContract::consecutive_clean(5),
                &attempts,
                &[self_reversal],
                0,
            ),
            Err(LedgerError::UnknownOrFutureReversal(10))
        );

        let future_reversal = AdjustmentRecord {
            id: 10,
            attempt_id: 1,
            kind: AdjustmentKind::Restore,
            reverses_adjustment_id: Some(11),
            source: MutationSource::UserClick,
            reason: None,
        };
        let future_change = AdjustmentRecord {
            id: 11,
            attempt_id: 1,
            kind: AdjustmentKind::Void,
            reverses_adjustment_id: None,
            source: MutationSource::UserClick,
            reason: None,
        };
        assert_eq!(
            derive(
                &PracticeContract::consecutive_clean(5),
                &attempts,
                &[future_change, future_reversal],
                0,
            ),
            Err(LedgerError::UnknownOrFutureReversal(11))
        );
    }
}
