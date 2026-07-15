//! Pure practice-contract semantics.
//!
//! This module has no database, clock, audio, or UI dependency. It evaluates
//! explicit human verdict evidence against the immutable contract captured for
//! a set. RepEngine integration belongs to a later slice.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AttemptVerdict {
    Clean,
    Flawed,
    Failed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MasteryBasis {
    ConsecutiveClean,
    TotalClean,
    TimedExposure,
    Exploratory,
    LegacyAttemptCount,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum RecoveryPolicy {
    None,
    /// If any pre-solution error exists, require this many additional clean
    /// attempts after the first clean, subject to the contract's base target.
    FixedCleanDebt {
        additional_clean: u32,
    },
    /// Evidence-aligned recovery: a percentage of errors before first clean,
    /// rounded up, plus the first clean itself. Basis points avoid float drift.
    Adaptive {
        ratio_basis_points: u16,
        minimum_clean_streak: u32,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SourceReference {
    pub source: String,
    pub locator: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PracticeContract {
    pub contract_version: u32,
    pub template_id: Option<String>,
    pub name: String,
    pub rationale: String,
    pub mastery_basis: MasteryBasis,
    /// Consecutive/total attempts, or seconds for TimedExposure.
    pub required_success: u32,
    pub reset_on_flawed: bool,
    pub reset_on_failed: bool,
    pub recovery: RecoveryPolicy,
    /// A review boundary only. Reaching it can never imply mastery.
    pub attempt_ceiling: Option<u32>,
    pub sources: Vec<SourceReference>,
}

impl PracticeContract {
    pub fn consecutive_clean(required: u32) -> Self {
        Self {
            contract_version: 1,
            template_id: Some("default-consecutive-clean-v1".into()),
            name: format!("{required} clean in a row"),
            rationale: "Configurable stabilization; attempts are not mastery.".into(),
            mastery_basis: MasteryBasis::ConsecutiveClean,
            required_success: required,
            reset_on_flawed: true,
            reset_on_failed: true,
            recovery: RecoveryPolicy::None,
            attempt_ceiling: None,
            sources: vec![SourceReference {
                source: "Molly Gebrian, Learn Faster, Perform Better".into(),
                locator: "Chapter 1, Pathways and practicing".into(),
            }],
        }
    }

    pub fn legacy_attempt_count(planned_attempts: u32) -> Self {
        Self {
            contract_version: 1,
            template_id: None,
            name: "Legacy attempt-count record".into(),
            rationale: "Imported exactly from v1; streak mastery was not recorded.".into(),
            mastery_basis: MasteryBasis::LegacyAttemptCount,
            required_success: planned_attempts,
            reset_on_flawed: false,
            reset_on_failed: false,
            recovery: RecoveryPolicy::None,
            attempt_ceiling: (planned_attempts > 0).then_some(planned_attempts),
            sources: Vec::new(),
        }
    }

    pub fn resets(&self, verdict: AttemptVerdict) -> bool {
        match verdict {
            AttemptVerdict::Clean => false,
            AttemptVerdict::Flawed => self.reset_on_flawed,
            AttemptVerdict::Failed => self.reset_on_failed,
        }
    }

    pub fn validate(&self) -> Result<(), ProtocolError> {
        if self.contract_version == 0 {
            return Err(ProtocolError::InvalidContractVersion);
        }
        if self.name.trim().is_empty() {
            return Err(ProtocolError::EmptyName);
        }
        if matches!(
            self.mastery_basis,
            MasteryBasis::ConsecutiveClean | MasteryBasis::TotalClean | MasteryBasis::TimedExposure
        ) && self.required_success == 0
        {
            return Err(ProtocolError::ZeroSuccessTarget);
        }
        if let RecoveryPolicy::Adaptive {
            ratio_basis_points,
            minimum_clean_streak,
        } = self.recovery
        {
            if ratio_basis_points > 10_000 {
                return Err(ProtocolError::InvalidRecoveryRatio);
            }
            if minimum_clean_streak == 0 {
                return Err(ProtocolError::ZeroRecoveryMinimum);
            }
        }
        if !matches!(self.recovery, RecoveryPolicy::None)
            && self.mastery_basis != MasteryBasis::ConsecutiveClean
        {
            return Err(ProtocolError::RecoveryRequiresConsecutiveBasis);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct EvaluationInput {
    pub tries: u32,
    pub clean_count: u32,
    pub current_clean_streak: u32,
    pub active_seconds: u32,
    pub errors_before_first_clean: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MasteryStatus {
    Satisfied,
    NotSatisfied,
    NotApplicable,
    UnverifiedLegacy,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ContractEvaluation {
    pub mastery: MasteryStatus,
    pub effective_required_success: u32,
    pub recovery_target_streak: u32,
    pub recovery_remaining: u32,
    pub review_boundary_reached: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProtocolError {
    InvalidContractVersion,
    EmptyName,
    ZeroSuccessTarget,
    InvalidRecoveryRatio,
    ZeroRecoveryMinimum,
    RecoveryRequiresConsecutiveBasis,
}

pub fn evaluate(
    contract: &PracticeContract,
    input: EvaluationInput,
) -> Result<ContractEvaluation, ProtocolError> {
    contract.validate()?;

    let recovery_target_streak = recovery_target(contract, input.errors_before_first_clean);
    let effective_required_success = if contract.mastery_basis == MasteryBasis::ConsecutiveClean {
        contract.required_success.max(recovery_target_streak)
    } else {
        contract.required_success
    };

    let mastery = match contract.mastery_basis {
        MasteryBasis::ConsecutiveClean => {
            if input.current_clean_streak >= effective_required_success {
                MasteryStatus::Satisfied
            } else {
                MasteryStatus::NotSatisfied
            }
        }
        MasteryBasis::TotalClean => {
            if input.clean_count >= effective_required_success {
                MasteryStatus::Satisfied
            } else {
                MasteryStatus::NotSatisfied
            }
        }
        MasteryBasis::TimedExposure => {
            if input.active_seconds >= effective_required_success {
                MasteryStatus::Satisfied
            } else {
                MasteryStatus::NotSatisfied
            }
        }
        MasteryBasis::Exploratory => MasteryStatus::NotApplicable,
        MasteryBasis::LegacyAttemptCount => MasteryStatus::UnverifiedLegacy,
    };

    let review_boundary_reached = contract
        .attempt_ceiling
        .is_some_and(|ceiling| input.tries >= ceiling)
        && mastery == MasteryStatus::NotSatisfied;

    Ok(ContractEvaluation {
        mastery,
        effective_required_success,
        recovery_target_streak,
        recovery_remaining: recovery_target_streak.saturating_sub(input.current_clean_streak),
        review_boundary_reached,
    })
}

fn recovery_target(contract: &PracticeContract, errors_before_first_clean: u32) -> u32 {
    match contract.recovery {
        RecoveryPolicy::None => 0,
        RecoveryPolicy::FixedCleanDebt { additional_clean } => {
            if errors_before_first_clean == 0 {
                0
            } else {
                1_u32.saturating_add(additional_clean)
            }
        }
        RecoveryPolicy::Adaptive {
            ratio_basis_points,
            minimum_clean_streak,
        } => {
            if errors_before_first_clean == 0 {
                return 0;
            }
            let numerator =
                u64::from(errors_before_first_clean).saturating_mul(u64::from(ratio_basis_points));
            let additional = numerator.saturating_add(9_999) / 10_000;
            minimum_clean_streak
                .max(1_u32.saturating_add(u32::try_from(additional).unwrap_or(u32::MAX)))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(streak: u32, errors: u32) -> EvaluationInput {
        EvaluationInput {
            tries: streak + errors,
            clean_count: streak,
            current_clean_streak: streak,
            active_seconds: 0,
            errors_before_first_clean: errors,
        }
    }

    #[test]
    fn adaptive_half_recovery_is_rounded_up_and_not_magic() {
        let mut contract = PracticeContract::consecutive_clean(5);
        contract.recovery = RecoveryPolicy::Adaptive {
            ratio_basis_points: 5_000,
            minimum_clean_streak: 5,
        };

        let ordinary = evaluate(&contract, input(4, 8)).unwrap();
        assert_eq!(ordinary.recovery_target_streak, 5);
        assert_eq!(ordinary.recovery_remaining, 1);
        assert_eq!(ordinary.mastery, MasteryStatus::NotSatisfied);

        let heavy = evaluate(&contract, input(6, 12)).unwrap();
        assert_eq!(heavy.recovery_target_streak, 7);
        assert_eq!(heavy.mastery, MasteryStatus::NotSatisfied);
        assert_eq!(
            evaluate(&contract, input(7, 12)).unwrap().mastery,
            MasteryStatus::Satisfied
        );
    }

    #[test]
    fn attempt_ceiling_requests_review_and_never_grants_mastery() {
        let mut contract = PracticeContract::consecutive_clean(5);
        contract.attempt_ceiling = Some(10);
        let result = evaluate(
            &contract,
            EvaluationInput {
                tries: 10,
                clean_count: 0,
                current_clean_streak: 0,
                active_seconds: 0,
                errors_before_first_clean: 10,
            },
        )
        .unwrap();
        assert_eq!(result.mastery, MasteryStatus::NotSatisfied);
        assert!(result.review_boundary_reached);
    }

    #[test]
    fn adaptive_recovery_does_not_raise_the_base_target_before_any_error() {
        let mut contract = PracticeContract::consecutive_clean(3);
        contract.recovery = RecoveryPolicy::Adaptive {
            ratio_basis_points: 5_000,
            minimum_clean_streak: 5,
        };

        let clean_run = evaluate(&contract, input(3, 0)).unwrap();
        assert_eq!(clean_run.recovery_target_streak, 0);
        assert_eq!(clean_run.effective_required_success, 3);
        assert_eq!(clean_run.mastery, MasteryStatus::Satisfied);

        let after_error = evaluate(&contract, input(3, 1)).unwrap();
        assert_eq!(after_error.recovery_target_streak, 5);
        assert_eq!(after_error.mastery, MasteryStatus::NotSatisfied);
    }

    #[test]
    fn legacy_attempt_count_can_never_be_reinterpreted_as_mastery() {
        let contract = PracticeContract::legacy_attempt_count(10);
        let result = evaluate(
            &contract,
            EvaluationInput {
                tries: 100,
                clean_count: 100,
                current_clean_streak: 100,
                active_seconds: 10_000,
                errors_before_first_clean: 0,
            },
        )
        .unwrap();
        assert_eq!(result.mastery, MasteryStatus::UnverifiedLegacy);
    }
}
