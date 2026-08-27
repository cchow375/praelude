//! Pure rep-ladder arithmetic — no I/O, no state, exhaustively unit-tested.
//!
//! A rep block climbs a *ladder*: the user reps a passage at the current tempo,
//! and once enough reps land clean the tempo steps up by a fixed increment until
//! it reaches the target. This module owns the two decisions that arithmetic:
//!
//! * [`resolve_auto`] — from a start/target/planned/variants spec, derive the
//!   concrete [`IncrementRule`] (how many clean reps per rung, how big a rung)
//!   and the total planned rep count.
//! * [`step`] — after a clean rep, decide whether the tempo advances and to what.
//!
//! The test-only [`variant_index_for_rep`] keeps the pre-chain, attempt-count
//! lane arithmetic pinned as historical compatibility evidence. Production
//! current-stage identity comes from [`variant_stage`], never raw tries.

use crate::protocol::AttemptVerdict;
use crate::store::model::{IncrementRule, VariantSpec};

/// The fixed BPM increment per rung. A ladder always steps by whole, musical
/// amounts; 4 BPM is the spec default.
pub const BPM_STEP: f64 = 4.0;

/// The default total reps for a plain block (no variants, no explicit count).
#[allow(dead_code)] // retained by the legacy resolve_auto compatibility helper
pub const DEFAULT_PLANNED: u32 = 30;

/// Resolve an "auto" ladder spec into a concrete [`IncrementRule`] and total
/// planned rep count.
///
/// Planned reps: the sum of variant reps when variants are given, else the
/// explicit `planned`, else [`DEFAULT_PLANNED`].
///
/// The rule: `bpm_step` is always [`BPM_STEP`]. The number of rungs is
/// `K = ceil((target - start) / step)` (at least 1), or 1 when there is no
/// target. `clean_needed` is `round(planned / K)` clamped to `1..=5` — so a
/// block with more planned reps than rungs demands more cleans per rung — EXCEPT
/// with no target, where the ladder cannot climb and `clean_needed` is fixed at
/// 3 (the rule is still returned, for display).
#[cfg(test)]
pub fn resolve_auto(
    start: f64,
    target: Option<f64>,
    planned: Option<u32>,
    variants: &[VariantSpec],
) -> (IncrementRule, u32) {
    resolve_auto_with_defaults(start, target, planned, variants, DEFAULT_PLANNED, BPM_STEP)
}

pub fn resolve_auto_with_defaults(
    start: f64,
    target: Option<f64>,
    planned: Option<u32>,
    variants: &[VariantSpec],
    default_planned: u32,
    bpm_step: f64,
) -> (IncrementRule, u32) {
    let default_planned = default_planned.clamp(1, 240);
    let bpm_step = if bpm_step.is_finite() {
        bpm_step.clamp(1.0, 24.0)
    } else {
        BPM_STEP
    };
    let planned_reps = if !variants.is_empty() {
        variants.iter().map(|v| v.reps).sum()
    } else {
        planned.unwrap_or(default_planned)
    };

    let clean_needed = match target {
        // No target ⇒ no ceiling ⇒ the ladder never steps (see `step`). The rule
        // is still stored for display; clean_needed is fixed at 3.
        None => 3,
        Some(t) => {
            let k = rungs(start, t, bpm_step);
            let raw = (planned_reps as f64 / k as f64).round() as i64;
            raw.clamp(1, 5) as u32
        }
    };

    (
        IncrementRule {
            clean_needed,
            bpm_step,
            ..Default::default()
        },
        planned_reps,
    )
}

/// The number of rungs between `start` and `target`: `ceil((target-start)/step)`,
/// at least 1. When `target <= start` there is nowhere to climb, so it is 1.
fn rungs(start: f64, target: f64, bpm_step: f64) -> u32 {
    if target <= start {
        return 1;
    }
    (((target - start) / bpm_step).ceil() as u32).max(1)
}

/// After a clean rep, decide whether the tempo steps and to what value.
///
/// Returns `Some(new_bpm)` — the current tempo plus one rung, capped at the
/// target — when `cleans_at_step` has reached `rule.clean_needed` and there is
/// headroom below the target. Returns `None` (stay) when there is no target
/// (a ladder needs a ceiling to climb toward), the tempo is already at/above the
/// target, or not enough clean reps have accumulated yet.
pub fn step(
    rule: &IncrementRule,
    cleans_at_step: u32,
    bpm: f64,
    target: Option<f64>,
) -> Option<f64> {
    let t = target?; // no target ⇒ never step
    if bpm >= t {
        return None; // already topped out
    }
    if cleans_at_step < rule.clean_needed {
        return None; // not enough cleans at this rung yet
    }
    let next = (bpm + rule.bpm_step).min(t);
    (next > bpm).then_some(next)
}

/// The variant lane a 1-based rep number falls into, as an index into
/// `variants`. Lanes are laid out by cumulative reps: with `[A:10, B:5]`, reps
/// 1–10 are lane 0 (`A`) and 11–15 are lane 1 (`B`). A rep beyond the planned
/// total clamps to the last lane. `None` when there are no variants. Retained
/// only as a regression seam for the legacy arithmetic; production chain
/// attribution must use [`variant_stage`].
#[cfg(test)]
pub fn variant_index_for_rep(variants: &[VariantSpec], rep_1based: u32) -> Option<usize> {
    if variants.is_empty() {
        return None;
    }
    let mut cumulative = 0u32;
    for (i, v) in variants.iter().enumerate() {
        cumulative += v.reps;
        if rep_1based <= cumulative {
            return Some(i);
        }
    }
    Some(variants.len() - 1)
}

/// A2: one resolved point in a variant CHAIN — which stage is current, how
/// many clean reps have landed at it, how many it requires, and whether the
/// whole chain has been cleared this pass.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct VariantStage {
    /// 0-based index into `variants`.
    pub index: usize,
    /// Clean reps landed so far at `index`.
    pub cleans: u32,
    /// Clean reps required to clear `index`.
    pub required: u32,
    /// Whether every stage, including the last, has been cleared.
    pub complete: bool,
}

/// The clean-streak requirement for stage `index`: its own `clean_streak`
/// when set, else its `reps` (the legacy fallback — see [`VariantSpec`]),
/// floored at 1 so a stray `0` can never stall the chain forever.
fn stage_requirement(variants: &[VariantSpec], index: usize) -> u32 {
    variants[index]
        .clean_streak
        .unwrap_or(variants[index].reps)
        .max(1)
}

/// Resolve the current stage of a variant chain from the sequence of
/// verdicts recorded so far (oldest first) — a pure replay, exactly the way
/// `project_tempo` replays the attempt ledger. `None` when there are no
/// variants.
///
/// Each stage is cleared by `required` CONSECUTIVE clean verdicts; clearing
/// advances to the next stage, or completes the chain at the last one. A
/// `Flawed` rep resets only the CURRENT stage's streak — it does not throw
/// away progress through earlier stages. `Failed` ("again") neither counts
/// nor resets, mirroring A1's treatment of a mis-start. Once the chain is
/// complete, trailing verdicts are ignored — the chain simply stays complete
/// until the caller (the ladder/set projection) restarts it.
pub fn variant_stage(
    variants: &[VariantSpec],
    verdicts: &[AttemptVerdict],
) -> Option<VariantStage> {
    if variants.is_empty() {
        return None;
    }
    let mut index = 0usize;
    let mut cleans = 0u32;
    let mut complete = false;
    for verdict in verdicts {
        if complete {
            break;
        }
        match verdict {
            AttemptVerdict::Clean => {
                cleans += 1;
                let required = stage_requirement(variants, index);
                if cleans >= required {
                    if index + 1 < variants.len() {
                        index += 1;
                        cleans = 0;
                    } else {
                        complete = true;
                    }
                }
            }
            AttemptVerdict::Flawed => {
                cleans = 0;
            }
            AttemptVerdict::Failed => {}
        }
    }
    let required = stage_requirement(variants, index);
    Some(VariantStage {
        index,
        cleans,
        required,
        complete,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn variant(name: &str, reps: u32) -> VariantSpec {
        VariantSpec {
            name: name.to_string(),
            reps,
            clean_streak: None,
        }
    }

    #[test]
    fn resolve_auto_80_to_120_over_30_reps() {
        // The canonical case from the brief: 80→120, 30 reps → step 4, K=10 rungs,
        // clean_needed = round(30/10) = 3.
        let (rule, planned) = resolve_auto(80.0, Some(120.0), Some(30), &[]);
        assert_eq!(planned, 30);
        assert_eq!(rule.bpm_step, 4.0);
        assert_eq!(rule.clean_needed, 3);
    }

    #[test]
    fn resolve_auto_defaults_to_30_reps() {
        let (rule, planned) = resolve_auto(60.0, Some(80.0), None, &[]);
        assert_eq!(planned, 30, "no variants + no planned → 30");
        // K = ceil((80-60)/4) = 5; clean_needed = round(30/5) = 6 → clamped to 5.
        assert_eq!(rule.clean_needed, 5, "clamped to the 1..=5 ceiling");
    }

    #[test]
    fn resolve_auto_clamps_clean_needed_floor() {
        // Many rungs, few reps → round(planned/K) would be < 1, clamps up to 1.
        let (rule, _) = resolve_auto(60.0, Some(200.0), Some(5), &[]);
        // K = ceil(140/4) = 35; round(5/35) = 0 → clamped to 1.
        assert_eq!(rule.clean_needed, 1);
    }

    #[test]
    fn resolve_auto_variants_sum_the_planned_reps() {
        let vs = [variant("hands separate", 10), variant("hands together", 8)];
        let (_, planned) = resolve_auto(80.0, Some(100.0), None, &vs);
        assert_eq!(planned, 18, "planned = Σ variant reps");
    }

    #[test]
    fn resolve_auto_no_target_fixes_clean_needed_at_3() {
        let (rule, planned) = resolve_auto(90.0, None, None, &[]);
        assert_eq!(planned, 30);
        assert_eq!(rule.clean_needed, 3, "no target → clean_needed fixed at 3");
        assert_eq!(rule.bpm_step, 4.0, "rule still stored for display");
    }

    #[test]
    fn configured_defaults_apply_only_when_the_request_omits_them() {
        let (rule, planned) = resolve_auto_with_defaults(80.0, Some(104.0), None, &[], 40, 6.0);
        assert_eq!(planned, 40);
        assert_eq!(rule.bpm_step, 6.0);
        assert_eq!(rule.clean_needed, 5);
        let (_, explicit) = resolve_auto_with_defaults(80.0, Some(104.0), Some(12), &[], 40, 6.0);
        assert_eq!(explicit, 12);
    }

    #[test]
    fn step_advances_when_cleans_reached() {
        let rule = IncrementRule {
            clean_needed: 3,
            bpm_step: 4.0,
            ..Default::default()
        };
        assert_eq!(step(&rule, 3, 80.0, Some(120.0)), Some(84.0));
        assert_eq!(
            step(&rule, 5, 80.0, Some(120.0)),
            Some(84.0),
            "at or over threshold"
        );
        assert_eq!(
            step(&rule, 2, 80.0, Some(120.0)),
            None,
            "not enough cleans yet"
        );
    }

    #[test]
    fn step_caps_at_target() {
        let rule = IncrementRule {
            clean_needed: 1,
            bpm_step: 4.0,
            ..Default::default()
        };
        // 118 + 4 would be 122, but the target 120 caps it.
        assert_eq!(step(&rule, 1, 118.0, Some(120.0)), Some(120.0));
        // Already at target → stay.
        assert_eq!(step(&rule, 5, 120.0, Some(120.0)), None);
        // Above target → stay.
        assert_eq!(step(&rule, 5, 124.0, Some(120.0)), None);
    }

    #[test]
    fn step_never_steps_without_a_target() {
        let rule = IncrementRule {
            clean_needed: 1,
            bpm_step: 4.0,
            ..Default::default()
        };
        assert_eq!(step(&rule, 99, 80.0, None), None, "no target ⇒ never steps");
    }

    #[test]
    fn variant_lane_boundaries() {
        let vs = [variant("A", 10), variant("B", 5)];
        assert_eq!(variant_index_for_rep(&vs, 1), Some(0));
        assert_eq!(
            variant_index_for_rep(&vs, 10),
            Some(0),
            "last rep of lane 0"
        );
        assert_eq!(
            variant_index_for_rep(&vs, 11),
            Some(1),
            "first rep of lane 1"
        );
        assert_eq!(variant_index_for_rep(&vs, 15), Some(1));
        assert_eq!(
            variant_index_for_rep(&vs, 99),
            Some(1),
            "beyond total clamps to last"
        );
        assert_eq!(variant_index_for_rep(&[], 1), None, "no variants → no lane");
    }

    // ── A2: variant chains ──────────────────────────────────────────────────

    fn variant_with_streak(name: &str, reps: u32, clean_streak: u32) -> VariantSpec {
        VariantSpec {
            name: name.to_string(),
            reps,
            clean_streak: Some(clean_streak),
        }
    }

    use AttemptVerdict::{Clean, Failed, Flawed};

    #[test]
    fn a_stage_advances_at_exactly_its_clean_streak() {
        let chain = [
            variant_with_streak("dotted", 30, 3),
            variant_with_streak("reverse dotted", 30, 2),
        ];
        let stage = variant_stage(&chain, &[Clean, Clean]).unwrap();
        assert_eq!(stage.index, 0, "not yet at the threshold");
        assert_eq!(stage.cleans, 2);
        assert_eq!(stage.required, 3);

        let stage = variant_stage(&chain, &[Clean, Clean, Clean]).unwrap();
        assert_eq!(stage.index, 1, "advanced to the next stage");
        assert_eq!(stage.cleans, 0, "fresh start on the new stage");
        assert_eq!(stage.required, 2);
    }

    #[test]
    fn a_flawed_rep_resets_the_current_stages_streak_but_not_the_chain() {
        let chain = [
            variant_with_streak("dotted", 30, 2),
            variant_with_streak("reverse dotted", 30, 3),
        ];
        // Clear stage 0, land one clean on stage 1, then flub one.
        let stage = variant_stage(&chain, &[Clean, Clean, Clean, Flawed]).unwrap();
        assert_eq!(
            stage.index, 1,
            "the chain's progress through stage 0 stands"
        );
        assert_eq!(stage.cleans, 0, "only the current stage's streak reset");
    }

    #[test]
    fn a_legacy_variant_without_clean_streak_falls_back_to_reps() {
        let chain = [VariantSpec {
            name: "hands separate".into(),
            reps: 4,
            clean_streak: None,
        }];
        let stage = variant_stage(&chain, &[Clean, Clean, Clean]).unwrap();
        assert_eq!(stage.required, 4, "falls back to reps");
        assert!(!stage.complete);
        let stage = variant_stage(&chain, &[Clean, Clean, Clean, Clean]).unwrap();
        assert!(stage.complete, "four cleans clears a lone legacy stage");
    }

    #[test]
    fn the_chain_completes_after_its_last_stage() {
        let chain = [
            variant_with_streak("dotted", 30, 1),
            variant_with_streak("reverse dotted", 30, 1),
            variant_with_streak("staccato", 30, 1),
        ];
        let stage = variant_stage(&chain, &[Clean, Clean]).unwrap();
        assert_eq!(stage.index, 2, "on the last stage");
        assert!(!stage.complete);
        let stage = variant_stage(&chain, &[Clean, Clean, Clean]).unwrap();
        assert!(
            stage.complete,
            "the last stage's clean streak completes the chain"
        );
        assert_eq!(stage.index, 2, "stays reported at the last stage");
        // Failed neither counts nor resets, mirroring A1.
        let stage = variant_stage(&chain, &[Failed, Clean, Failed, Clean, Failed, Clean]).unwrap();
        assert!(stage.complete);
    }

    #[test]
    fn an_empty_chain_is_none_exactly_as_today() {
        assert_eq!(variant_stage(&[], &[Clean, Clean]), None);
    }
}
