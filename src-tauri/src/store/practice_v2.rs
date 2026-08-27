//! Transactional v2 practice-set persistence and the single Rust-owned read
//! projection. The v1 tables remain compatibility anchors; mastery, provenance,
//! and corrections live in additive schema-v8 sidecars.

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{Connection, OptionalExtension, Transaction};
use serde_json::{json, Value};

use super::model::{
    json_from_sql, json_to_sql, BlockHistory, DemotionConfig, IncrementRule, LastRep,
    MutationEntityRef, MutationReceipt, PausedSetRow, RepOpenArgs, RepSnapshot,
    SetFocusContextInput, SetTuning, VariantSpec, VerdictCounts,
};
use super::Store;
use crate::ledger::{
    self, AdjustmentKind, AdjustmentRecord, AttemptRecord, EffectiveAttempt, MutationSource,
    RecoveryDirectives,
};
use crate::protocol::{
    AttemptVerdict, MasteryBasis, MasteryStatus, PracticeContract, RecoveryPolicy, SourceReference,
};
use crate::rep::{ladder, RepVerdict};

static COMMAND_SEQUENCE: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone)]
pub(crate) struct V2Mutation {
    pub snapshot: RepSnapshot,
    pub feed_id: Option<i64>,
    pub new_bpm: Option<f64>,
    pub receipt: Option<MutationReceipt<RepSnapshot>>,
}

#[derive(Debug, Clone)]
pub(crate) struct V2Open {
    pub snapshot: RepSnapshot,
    pub feed_id: i64,
    pub session_id: i64,
}

pub(crate) struct EffectiveAttemptView {
    pub verdict: String,
    pub note: Option<String>,
    pub voided: bool,
    pub source: String,
    pub active_adjustment_ids: Vec<i64>,
    pub original_verdict: String,
    pub bpm: Option<f64>,
}

pub(super) struct EventWrite<'a> {
    pub(super) session_id: Option<i64>,
    pub(super) piece_id: i64,
    pub(super) kind: &'a str,
    pub(super) payload: &'a Value,
    pub(super) entity_type: &'a str,
    pub(super) entity_id: i64,
    pub(super) source: MutationSource,
    pub(super) command_id: &'a str,
    pub(super) timestamp: Option<&'a str>,
}

pub(crate) fn command_id(source: MutationSource, action: &str) -> String {
    let micros = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_micros();
    let sequence = COMMAND_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    format!("{}:{action}:{micros}:{sequence}", source_name(source))
}

pub(super) fn invalid(message: impl Into<String>) -> rusqlite::Error {
    rusqlite::Error::InvalidParameterName(message.into())
}

pub(super) fn source_name(source: MutationSource) -> &'static str {
    match source {
        MutationSource::UserClick => "user_click",
        MutationSource::VoiceHotLoop => "voice_hot_loop",
        MutationSource::VoiceDraft => "voice_draft",
        MutationSource::BrainDraft => "brain_draft",
        MutationSource::ImportReview => "import_review",
        MutationSource::MigrationLegacy => "migration_legacy",
        MutationSource::SystemSchedule => "system_schedule",
    }
}

fn parse_source(value: &str) -> rusqlite::Result<MutationSource> {
    match value {
        "user_click" => Ok(MutationSource::UserClick),
        "voice_hot_loop" => Ok(MutationSource::VoiceHotLoop),
        "voice_draft" => Ok(MutationSource::VoiceDraft),
        "brain_draft" => Ok(MutationSource::BrainDraft),
        "import_review" => Ok(MutationSource::ImportReview),
        "migration_legacy" => Ok(MutationSource::MigrationLegacy),
        "system_schedule" => Ok(MutationSource::SystemSchedule),
        _ => Err(invalid(format!("unknown mutation source {value}"))),
    }
}

fn verdict(value: &str) -> rusqlite::Result<AttemptVerdict> {
    match value {
        "clean" => Ok(AttemptVerdict::Clean),
        "flawed" => Ok(AttemptVerdict::Flawed),
        "failed" => Ok(AttemptVerdict::Failed),
        _ => Err(invalid(format!("unknown verdict {value}"))),
    }
}

fn mastery_name(value: MasteryStatus) -> &'static str {
    match value {
        MasteryStatus::Satisfied => "satisfied",
        MasteryStatus::NotSatisfied => "not_satisfied",
        MasteryStatus::NotApplicable => "not_applicable",
        MasteryStatus::UnverifiedLegacy => "unverified_legacy",
    }
}

#[derive(Debug)]
struct SetRow {
    block_id: i64,
    piece_id: i64,
    piece_title: String,
    m_start: u32,
    m_end: u32,
    label: Option<String>,
    start_bpm: Option<f64>,
    target_bpm: Option<f64>,
    planned_reps: u32,
    status: String,
    variants: Vec<VariantSpec>,
    rule: IncrementRule,
    focus: String,
    use_metronome: bool,
    tuning: SetTuning,
    contract: PracticeContract,
    contract_source: String,
    set_state: String,
    mastery_verification: String,
}

fn load_set_row(conn: &Connection, block_id: i64) -> rusqlite::Result<Option<SetRow>> {
    let base = conn
        .query_row(
            "SELECT b.id,b.piece_id,p.title,b.m_start,b.m_end,b.label,b.start_bpm,
                    b.target_bpm,b.planned_reps,b.status,b.variants,b.increment_rule,
                    b.focus,b.use_metronome,b.tuning_json
             FROM rep_block b JOIN piece p ON p.id=b.piece_id WHERE b.id=?1",
            [block_id],
            |row| {
                let variants: String = row.get(10)?;
                let rule: Option<String> = row.get(11)?;
                let tuning: String = row.get(14)?;
                let m_start: i64 = row.get(3)?;
                let m_end: i64 = row.get(4)?;
                let planned: i64 = row.get(8)?;
                Ok(SetRow {
                    block_id: row.get(0)?,
                    piece_id: row.get(1)?,
                    piece_title: row.get(2)?,
                    m_start: u32::try_from(m_start.max(0)).unwrap_or(u32::MAX),
                    m_end: u32::try_from(m_end.max(0)).unwrap_or(u32::MAX),
                    label: row.get(5)?,
                    start_bpm: row.get(6)?,
                    target_bpm: row.get(7)?,
                    planned_reps: u32::try_from(planned.max(0)).unwrap_or(u32::MAX),
                    status: row.get(9)?,
                    variants: json_from_sql(&variants)?,
                    rule: rule.map(|raw| json_from_sql(&raw)).transpose()?.unwrap_or(
                        IncrementRule {
                            clean_needed: 3,
                            bpm_step: 4.0,
                            ..Default::default()
                        },
                    ),
                    focus: row.get(12)?,
                    use_metronome: row.get(13)?,
                    tuning: json_from_sql(&tuning)?,
                    contract: PracticeContract::legacy_attempt_count(
                        u32::try_from(planned.max(0)).unwrap_or(u32::MAX),
                    ),
                    contract_source: "migration_legacy".into(),
                    set_state: match row.get::<_, String>(9)?.as_str() {
                        "done" => "legacy_closed".into(),
                        "abandoned" => "abandoned".into(),
                        _ => "legacy_open".into(),
                    },
                    mastery_verification: "unverified".into(),
                })
            },
        )
        .optional()?;
    let Some(mut row) = base else { return Ok(None) };

    if let Some(contract) = load_contract(conn, block_id)? {
        row.contract = contract.0;
        row.set_state = contract.1;
        row.mastery_verification = contract.2;
        row.contract_source = contract.3;
    }
    Ok(Some(row))
}

fn load_contract(
    conn: &Connection,
    block_id: i64,
) -> rusqlite::Result<Option<(PracticeContract, String, String, String)>> {
    conn.query_row(
        "SELECT template_id,contract_version,name,rationale,mastery_basis,
                required_success,reset_on_flawed,reset_on_failed,recovery_policy,
                recovery_value,recovery_minimum,attempt_ceiling,source_refs_json,
                set_state,mastery_verification,source
         FROM set_contract WHERE set_id=?1",
        [block_id],
        |row| {
            let basis: String = row.get(4)?;
            let recovery: String = row.get(8)?;
            let recovery_value: u32 = row.get(9)?;
            let recovery_minimum: u32 = row.get(10)?;
            let refs: String = row.get(12)?;
            let mastery_basis = match basis.as_str() {
                "consecutive_clean" => MasteryBasis::ConsecutiveClean,
                "total_clean" => MasteryBasis::TotalClean,
                "timed_exposure" => MasteryBasis::TimedExposure,
                "exploratory" => MasteryBasis::Exploratory,
                "legacy_attempt_count" => MasteryBasis::LegacyAttemptCount,
                _ => return Err(invalid("unknown mastery basis")),
            };
            let recovery = match recovery.as_str() {
                "none" => RecoveryPolicy::None,
                "fixed" => RecoveryPolicy::FixedCleanDebt {
                    additional_clean: recovery_value,
                },
                "adaptive" => RecoveryPolicy::Adaptive {
                    ratio_basis_points: u16::try_from(recovery_value)
                        .map_err(|_| invalid("invalid recovery ratio"))?,
                    minimum_clean_streak: recovery_minimum,
                },
                _ => return Err(invalid("unknown recovery policy")),
            };
            Ok((
                PracticeContract {
                    template_id: row.get(0)?,
                    contract_version: row.get(1)?,
                    name: row.get(2)?,
                    rationale: row.get(3)?,
                    mastery_basis,
                    required_success: row.get(5)?,
                    reset_on_flawed: row.get(6)?,
                    reset_on_failed: row.get(7)?,
                    recovery,
                    attempt_ceiling: row.get(11)?,
                    sources: json_from_sql::<Vec<SourceReference>>(&refs)?,
                },
                row.get(13)?,
                row.get(14)?,
                row.get(15)?,
            ))
        },
    )
    .optional()
}

fn load_attempts(conn: &Connection, row: &SetRow) -> rusqlite::Result<Vec<AttemptRecord>> {
    let mut stmt = conn.prepare(
        "SELECT r.id,r.bpm,r.verdict,r.note,COALESCE(p.source,'migration_legacy')
         FROM rep r LEFT JOIN attempt_provenance p ON p.rep_id=r.id
         WHERE r.block_id=?1 ORDER BY r.id",
    )?;
    let records = stmt.query_map([row.block_id], |record| {
        let id: i64 = record.get(0)?;
        let physical_bpm: Option<f64> = record.get(1)?;
        let source_text: String = record.get(4)?;
        let source = parse_source(&source_text)?;
        let bpm = match physical_bpm {
            Some(value) if value.is_finite() && value > 0.0 => Some(value),
            Some(value) if value == 0.0 && row.focus != "tempo" && !row.use_metronome => {
                // Exact zero is the sole compatibility sentinel written by the
                // untouched v1 NOT NULL column for a condition with no tempo.
                None
            }
            Some(value) => {
                return Err(invalid(format!(
                    "invalid physical BPM {value} for attempt {id}"
                )))
            }
            None => {
                return Err(invalid(format!(
                    "missing physical BPM for compatibility attempt {id}"
                )))
            }
        };
        Ok(AttemptRecord {
            id,
            verdict: verdict(&record.get::<_, String>(2)?)?,
            bpm,
            note: record.get(3)?,
            source,
        })
    })?;
    records.collect()
}

fn load_adjustments(conn: &Connection, block_id: i64) -> rusqlite::Result<Vec<AdjustmentRecord>> {
    let mut stmt = conn.prepare(
        "SELECT a.id,a.rep_id,a.kind,a.after_json,a.source,a.reason,a.reverses_adjustment_id
         FROM attempt_adjustment a JOIN rep r ON r.id=a.rep_id
         WHERE r.block_id=?1 ORDER BY a.id",
    )?;
    let records = stmt.query_map([block_id], |row| {
        let kind: String = row.get(2)?;
        let after: String = row.get(3)?;
        let value: Value = json_from_sql(&after)?;
        let parsed = match kind.as_str() {
            "void" => AdjustmentKind::Void,
            "restore" => AdjustmentKind::Restore,
            "replace_verdict" => AdjustmentKind::ReplaceVerdict {
                verdict: verdict(value.get("verdict").and_then(Value::as_str).unwrap_or(""))?,
            },
            "replace_note" => AdjustmentKind::ReplaceNote {
                note: value
                    .get("note")
                    .and_then(Value::as_str)
                    .map(str::to_string),
            },
            "combined_correction" => AdjustmentKind::CombinedCorrection {
                verdict: verdict(value.get("verdict").and_then(Value::as_str).unwrap_or(""))?,
                note: value
                    .get("note")
                    .and_then(Value::as_str)
                    .map(str::to_string),
            },
            _ => return Err(invalid("unknown adjustment kind")),
        };
        Ok(AdjustmentRecord {
            id: row.get(0)?,
            attempt_id: row.get(1)?,
            kind: parsed,
            source: parse_source(&row.get::<_, String>(4)?)?,
            reason: row.get(5)?,
            reverses_adjustment_id: row.get(6)?,
        })
    })?;
    records.collect()
}

const BPM_EPSILON: f64 = 0.000_001;

#[derive(Debug, Clone, Copy)]
struct TempoProjection {
    bpm: Option<f64>,
    cleans_at_step: u32,
    /// A1: consecutive `flawed` reps accumulated toward the next demotion.
    sloppy_streak: u32,
    /// A1: whether an automatic demotion has occurred anywhere in this set.
    demoted_this_set: bool,
    /// A2: the current point in the block's variant chain, resolved over the
    /// verdicts recorded since the chain last restarted (at open, or at the
    /// most recent chain-driven tempo step). `None` with no variants.
    variant_stage: Option<ladder::VariantStage>,
    /// Physical attempt that first completed the chain at the CURRENT rung.
    /// A ladder step or explicit clean-proof reset clears this boundary.
    variant_chain_completed_at_attempt_id: Option<i64>,
}

fn project_fixed_variant_chain(
    variants: &[VariantSpec],
    effective: &[EffectiveAttempt],
    reset_after_attempt_id: Option<i64>,
) -> (Option<ladder::VariantStage>, Option<i64>) {
    if variants.is_empty() {
        return (None, None);
    }
    let mut verdicts = Vec::new();
    let mut completed_at = None;
    for attempt in effective.iter().filter(|attempt| {
        !attempt.voided && reset_after_attempt_id.is_none_or(|boundary| attempt.id > boundary)
    }) {
        verdicts.push(attempt.verdict);
        let stage = ladder::variant_stage(variants, &verdicts)
            .expect("non-empty variants always yield a stage");
        if stage.complete && completed_at.is_none() {
            completed_at = Some(attempt.id);
        }
    }
    (ladder::variant_stage(variants, &verdicts), completed_at)
}

fn trailing_contract_clean_after(
    effective: &[EffectiveAttempt],
    boundary: i64,
    contract: &PracticeContract,
) -> u32 {
    let mut streak = 0_u32;
    for attempt in effective
        .iter()
        .filter(|attempt| !attempt.voided && attempt.id > boundary)
    {
        if attempt.verdict == AttemptVerdict::Clean {
            streak = streak.saturating_add(1);
        } else if contract.resets(attempt.verdict) {
            streak = 0;
        }
    }
    streak
}

/// Rebuild the current tempo from immutable attempt facts plus their effective
/// verdicts. Tempo-change events remain an append-only audit trail, but are not
/// semantic state: voiding/correcting the clean that caused a step must project
/// the prior rung again, and reversing that adjustment must restore the step.
fn project_tempo(
    row: &SetRow,
    effective: &[EffectiveAttempt],
    reset_after_attempt_id: Option<i64>,
    tempo_backoff: Option<f64>,
    demotion: DemotionConfig,
) -> rusqlite::Result<TempoProjection> {
    // A2: without a ladder (or with one not yet reached), a variant chain is
    // still resolved over the whole set's effective verdicts — there is no
    // tempo window to restart it against.
    if row.focus != "tempo" {
        let (variant_stage, variant_chain_completed_at_attempt_id) =
            project_fixed_variant_chain(&row.variants, effective, reset_after_attempt_id);
        return Ok(TempoProjection {
            // The click is a factual practice condition even when tempo is not
            // the mastery focus. Preserve the captured tempo, but never run a
            // ladder or tempo-mastery projection for this set.
            bpm: if row.use_metronome {
                effective
                    .iter()
                    .rev()
                    .find(|attempt| !attempt.voided)
                    .and_then(|attempt| attempt.bpm)
                    .or(row.start_bpm)
            } else {
                None
            },
            cleans_at_step: 0,
            sloppy_streak: 0,
            demoted_this_set: false,
            variant_stage,
            variant_chain_completed_at_attempt_id,
        });
    }

    // Historical contracts never asserted ladder semantics. Preserve their
    // factual last effective attempt tempo (or start tempo) without inventing a
    // post-hoc step from legacy verdicts.
    if row.contract_source == "migration_legacy" {
        let (variant_stage, variant_chain_completed_at_attempt_id) =
            project_fixed_variant_chain(&row.variants, effective, reset_after_attempt_id);
        return Ok(TempoProjection {
            bpm: effective
                .iter()
                .rev()
                .find(|attempt| !attempt.voided)
                .and_then(|attempt| attempt.bpm)
                .or(row.start_bpm),
            cleans_at_step: 0,
            sloppy_streak: 0,
            demoted_this_set: false,
            variant_stage,
            variant_chain_completed_at_attempt_id,
        });
    }

    let start_bpm = row
        .start_bpm
        .filter(|bpm| bpm.is_finite() && *bpm > 0.0)
        .ok_or_else(|| invalid("tempo set requires a positive finite start BPM"))?;
    let mut working = start_bpm;
    let mut clean_streak = 0_u32;
    // A1 "the punishment": consecutive `flawed` reps pull the tempo back one
    // rung. `Failed` ("again") neither counts toward this nor resets it — a
    // mis-start must not launder a sloppy run (Christian's explicit answer,
    // Q4). Only `Clean` resets it, same as `clean_streak`.
    let mut sloppy_streak = 0_u32;
    // Ambiguity resolution (stated, not stalled on): "while demoted, the
    // threshold is `demote_repeat`" is read as *once a demotion has occurred
    // anywhere in this set, the repeat threshold applies for the remainder of
    // the set* — not just immediately after. Simple, predictable, and matches
    // "more punishment".
    let mut demoted_this_set = false;
    let mut recovery_reset_applied = false;
    // A2 "ladder interplay" (spec §5.2): with variants, one full CHAIN pass
    // at the current tempo counts as the ladder's clean group — the usual
    // `rule.clean_needed` consecutive-clean gate is bypassed in favour of the
    // chain actually completing. `chain_verdicts` accumulates the verdicts
    // since the chain last restarted (at open, or at the most recent
    // chain-driven step below); it is cleared on that step so the chain
    // restarts at the new tempo, per spec. A1's demotion loop below is
    // untouched by any of this — it reads/writes only `sloppy_streak` and
    // `working`, never `chain_verdicts` — so a demotion operates strictly
    // within the current variant, neither advancing nor resetting the chain.
    let has_variants = !row.variants.is_empty();
    let mut chain_verdicts: Vec<AttemptVerdict> = Vec::new();
    let mut variant_chain_completed_at_attempt_id = None;
    for attempt in effective.iter().filter(|attempt| !attempt.voided) {
        if reset_after_attempt_id
            .is_some_and(|boundary| !recovery_reset_applied && attempt.id > boundary)
        {
            clean_streak = 0;
            chain_verdicts.clear();
            variant_chain_completed_at_attempt_id = None;
            recovery_reset_applied = true;
        }
        let attempt_bpm = attempt
            .bpm
            .filter(|bpm| bpm.is_finite() && *bpm > 0.0)
            .ok_or_else(|| invalid(format!("tempo attempt {} has no BPM", attempt.id)))?;

        // A later attempt at a different factual tempo is authoritative rung
        // evidence. This matters when an earlier correction is made only after
        // Christian has already continued at the stepped tempo.
        if (attempt_bpm - working).abs() > BPM_EPSILON {
            working = attempt_bpm;
            clean_streak = 0;
        }
        match attempt.verdict {
            AttemptVerdict::Clean => {
                clean_streak = clean_streak.saturating_add(1);
                sloppy_streak = 0;
            }
            AttemptVerdict::Flawed => {
                clean_streak = 0;
                sloppy_streak = sloppy_streak.saturating_add(1);
            }
            // `Failed` ("again") resets rung progress like any non-clean rep,
            // but deliberately leaves `sloppy_streak` untouched.
            AttemptVerdict::Failed => {
                clean_streak = 0;
            }
        }
        if has_variants {
            chain_verdicts.push(attempt.verdict);
        }
        let chain_stage = has_variants.then(|| {
            ladder::variant_stage(&row.variants, &chain_verdicts)
                .expect("non-empty variants always yield a stage")
        });
        let stepped = if has_variants {
            chain_stage.filter(|stage| stage.complete).and_then(|_| {
                row.target_bpm
                    .map(|target| (working + row.rule.bpm_step).min(target))
                    .filter(|&next| next > working)
            })
        } else {
            ladder::step(&row.rule, clean_streak, working, row.target_bpm)
        };
        if let Some(next) = stepped {
            working = next;
            clean_streak = 0;
            if has_variants {
                // The chain restarts at the new tempo.
                chain_verdicts.clear();
                variant_chain_completed_at_attempt_id = None;
            }
        } else if chain_stage.is_some_and(|stage| stage.complete)
            && variant_chain_completed_at_attempt_id.is_none()
        {
            variant_chain_completed_at_attempt_id = Some(attempt.id);
        }
        if demotion.enabled {
            let threshold = if demoted_this_set {
                demotion.repeat
            } else {
                demotion.first
            };
            if sloppy_streak >= threshold {
                working = (working - row.rule.bpm_step).max(start_bpm);
                sloppy_streak = 0;
                clean_streak = 0;
                demoted_this_set = true;
            }
        }
    }
    if reset_after_attempt_id.is_some() && !recovery_reset_applied {
        clean_streak = 0;
        chain_verdicts.clear();
        variant_chain_completed_at_attempt_id = None;
    }
    if let Some(backoff) = tempo_backoff {
        if !backoff.is_finite() || backoff <= 0.0 {
            return Err(invalid("accepted tempo backoff is invalid"));
        }
        // Manual "Back off tempo" recovery force-overwrites the ladder's
        // working tempo AFTER both the climb and the automatic-demotion loop
        // above — an explicit human backoff always wins over/composes with
        // automatic demotion, never the reverse.
        working = backoff;
        clean_streak = 0;
    }
    let variant_stage = has_variants.then(|| {
        ladder::variant_stage(&row.variants, &chain_verdicts)
            .expect("non-empty variants always yield a stage")
    });
    Ok(TempoProjection {
        bpm: Some(working),
        cleans_at_step: clean_streak,
        sloppy_streak,
        demoted_this_set,
        variant_stage,
        variant_chain_completed_at_attempt_id,
    })
}

fn trailing_clean_at_or_above(
    effective: &[EffectiveAttempt],
    minimum_bpm: f64,
    reset_after_attempt_id: Option<i64>,
) -> u32 {
    let mut streak = 0_u32;
    for attempt in effective.iter().rev().filter(|attempt| !attempt.voided) {
        if reset_after_attempt_id.is_some_and(|boundary| attempt.id <= boundary) {
            break;
        }
        if attempt.verdict != AttemptVerdict::Clean
            || !attempt
                .bpm
                .is_some_and(|bpm| bpm + BPM_EPSILON >= minimum_bpm)
        {
            break;
        }
        streak = streak.saturating_add(1);
    }
    streak
}

/// Task A4: every set currently sitting in `set_contract.set_state='paused'`,
/// newest-paused first. Reuses [`project`] for `current_clean_streak` rather
/// than re-deriving streak math here — the ledger projection is the single
/// source of truth for that number everywhere else it's shown.
pub(super) fn paused_sets_list(
    conn: &Connection,
    demotion: DemotionConfig,
) -> rusqlite::Result<Vec<PausedSetRow>> {
    let mut stmt = conn.prepare(
        "SELECT sc.set_id, rb.piece_id, p.title, rb.m_start, rb.m_end,
                (SELECT e.ts FROM event e
                  WHERE e.entity_type='set' AND e.entity_id=sc.set_id AND e.kind='rep_pause'
                  ORDER BY e.id DESC LIMIT 1) AS paused_since_ts,
                (SELECT e.id FROM event e
                  WHERE e.entity_type='set' AND e.entity_id=sc.set_id AND e.kind='rep_pause'
                  ORDER BY e.id DESC LIMIT 1) AS paused_event_id
         FROM set_contract sc
         JOIN rep_block rb ON rb.id = sc.set_id
         JOIN piece p ON p.id = rb.piece_id
         WHERE sc.set_state = 'paused'
         ORDER BY paused_event_id IS NULL, paused_event_id DESC, sc.set_id DESC",
    )?;
    let raw = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, Option<String>>(5)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    drop(stmt);

    let mut out = Vec::with_capacity(raw.len());
    for (set_id, piece_id, piece_title, m_start, m_end, paused_since_ts) in raw {
        let snapshot = project(conn, set_id, demotion)?;
        // Legacy/migrated paused rows with no recorded `rep_pause` event (see
        // the ambiguity note on `PausedSetRow`) fall back to the contract's
        // own creation timestamp rather than a fabricated pause time.
        let paused_since_ts = match paused_since_ts {
            Some(ts) => ts,
            None => conn.query_row(
                "SELECT created_ts FROM set_contract WHERE set_id=?1",
                [set_id],
                |row| row.get(0),
            )?,
        };
        out.push(PausedSetRow {
            set_id,
            block_id: set_id,
            piece_id,
            piece_title,
            m_start,
            m_end,
            bpm: snapshot.bpm.unwrap_or(0.0).round() as i64,
            target_bpm: snapshot.target_bpm.unwrap_or(0.0).round() as i64,
            paused_since_ts,
            current_clean_streak: i64::from(snapshot.current_clean_streak),
        });
    }
    Ok(out)
}

pub(super) fn project(
    conn: &Connection,
    block_id: i64,
    demotion: DemotionConfig,
) -> rusqlite::Result<RepSnapshot> {
    let row = load_set_row(conn, block_id)?.ok_or(rusqlite::Error::QueryReturnedNoRows)?;
    let loop_state = super::practice_loop::load_loop_projection(
        conn,
        block_id,
        row.m_start,
        row.m_end,
        &row.focus,
        &row.set_state,
    )?;
    let attempts = load_attempts(conn, &row)?;
    let adjustments = load_adjustments(conn, block_id)?;
    let mut summary = ledger::derive_with_recovery(
        &row.contract,
        &attempts,
        &adjustments,
        loop_state.active_seconds,
        RecoveryDirectives {
            reset_after_attempt_id: loop_state.reset_after_attempt_id,
            manual_clean_debt: loop_state.manual_clean_debt,
        },
    )
    .map_err(|error| invalid(format!("ledger projection failed: {error:?}")))?;

    let tempo = project_tempo(
        &row,
        &summary.effective_attempts,
        loop_state.reset_after_attempt_id,
        loop_state.tempo_backoff,
        demotion,
    )?;
    // One authoritative tempo-mastery rule: progress resets whenever tempo
    // changes, and with a target the final required effective attempts must be
    // clean at/above that target. The projection exposes rung progress and
    // target-eligible mastery progress separately so consumers cannot confuse
    // sub-target fluency with mastery.
    let mut mastery_progress_streak = summary.current_clean_streak;
    if row.focus == "tempo" && row.contract_source != "migration_legacy" {
        let eligible_bpm = row
            .target_bpm
            .or(tempo.bpm)
            .ok_or_else(|| invalid("tempo set has no projected BPM"))?;
        let eligible = if loop_state.tempo_backoff.is_some() {
            0
        } else {
            trailing_clean_at_or_above(
                &summary.effective_attempts,
                eligible_bpm,
                loop_state.reset_after_attempt_id,
            )
        };
        summary.current_clean_streak = tempo.cleans_at_step;
        mastery_progress_streak = eligible;
        summary.contract.mastery = if eligible >= summary.contract.effective_required_success {
            MasteryStatus::Satisfied
        } else {
            MasteryStatus::NotSatisfied
        };
    }
    // B1 (P2): when a set HAS a variant chain, the chain governs completion —
    // for EVERY focus, with or without a target tempo. This is deliberately
    // the LAST word on `summary.contract.mastery`.
    //
    // WHY: the chain IS the set. Christian's Aug 8 note: "after I do like five
    // in a row for the first variation(dotted) then it automatically moves me
    // onto the next variation(reverse dotted), then the next(stacatto), and so
    // on". Every generic mastery rule above (trailing clean streak, total
    // clean, timed exposure, and the tempo rule) has no notion of the chain's
    // per-stage requirements, so each of them declares the WHOLE set mastered
    // at the end of stage ONE — the set freezes at "5/5" and he has to close
    // it and delete the finished variant chip by hand to continue.
    //
    // The rule this replaces was gated on `row.target_bpm.is_none()` and lived
    // inside the tempo branch. Both gates were wrong: he always sets a target
    // tempo, and he chains dotted/reverse-dotted/staccato on phrasing and
    // dynamics sets too, which never enter the tempo branch at all.
    //
    // Direction of travel is one-way: with a chain, mastery now requires
    // clearing EVERY stage (and, with a ladder, clearing them at the target
    // tempo, since a tempo step restarts the chain). It can only turn a
    // Satisfied into a NotSatisfied, never the reverse — the earned-only law
    // holds. Sets with NO variants are byte-identical to before.
    //
    // Two exclusions, both about not rewriting verdicts this rule never
    // governed:
    //   * `migration_legacy` contracts — historical sets never asserted chain
    //     semantics (same reasoning as `project_tempo`'s legacy branch), so a
    //     rule invented afterwards must not retroactively unsatisfy them.
    //   * contracts that make no mastery claim at all — `NotApplicable`
    //     (exploratory) and `UnverifiedLegacy`. Those are statements that
    //     mastery is not being judged; the chain does not start judging it.
    if !row.variants.is_empty()
        && row.contract_source != "migration_legacy"
        && matches!(
            summary.contract.mastery,
            MasteryStatus::Satisfied | MasteryStatus::NotSatisfied
        )
    {
        let chain_complete = tempo.variant_stage.is_some_and(|stage| stage.complete);

        // A completed chain proves the captured BASE requirement, but an
        // explicitly accepted recovery consequence remains additional work.
        // Count that work only after BOTH the final-stage completion and the
        // first clean-debt action. This keeps the chain visibly complete while
        // asking for the extra cleans at its final stage; earlier-stage cleans
        // can never pre-pay a debt accepted later.
        let extra_recovery_required = summary
            .contract
            .effective_required_success
            .saturating_sub(row.contract.required_success);
        let first_clean_debt_boundary = loop_state
            .recovery_actions
            .iter()
            .filter(|action| action.kind == "clean_debt")
            .map(|action| action.after_attempt_id.unwrap_or(0))
            .min();
        let chain_recovery_remaining =
            match (chain_complete, tempo.variant_chain_completed_at_attempt_id) {
                (true, Some(completed_at)) => {
                    let boundary = first_clean_debt_boundary
                        .map_or(completed_at, |debt_at| completed_at.max(debt_at));
                    extra_recovery_required.saturating_sub(trailing_contract_clean_after(
                        &summary.effective_attempts,
                        boundary,
                        &row.contract,
                    ))
                }
                _ => extra_recovery_required,
            };
        if extra_recovery_required > 0 {
            summary.contract.recovery_remaining = chain_recovery_remaining;
        }

        // Earned-only direction: chain/recovery logic may withhold a generic
        // Satisfied result, but it may never manufacture Satisfied from an
        // underlying NotSatisfied contract projection.
        if summary.contract.mastery == MasteryStatus::Satisfied
            && (!chain_complete || chain_recovery_remaining > 0)
        {
            summary.contract.mastery = MasteryStatus::NotSatisfied;
        }
    }
    let effective = summary
        .effective_attempts
        .iter()
        .filter(|attempt| !attempt.voided)
        .collect::<Vec<_>>();
    let last_effective = effective.last().copied();
    let last_adjustment_id = adjustments.iter().map(|adjustment| adjustment.id).max();
    let variants = row.variants.clone();
    // A2/B86 follow-up: the displayed/current variant must come from the same
    // clean-streak chain projection that governs advancement and mastery. The
    // former attempt-count lane advanced on Sloppy/Again merely because `tries`
    // increased, producing contradictory variant names for one set.
    let current_variant = tempo
        .variant_stage
        .and_then(|stage| variants.get(stage.index))
        .map(|variant| variant.name.clone());
    let next_variant_stage_name = tempo
        .variant_stage
        .filter(|stage| !stage.complete)
        .and_then(|stage| variants.get(stage.index + 1))
        .map(|variant| variant.name.clone());
    let verification = row.mastery_verification == "verified";

    Ok(RepSnapshot {
        block_id: row.block_id,
        piece_id: row.piece_id,
        piece_title: row.piece_title,
        m_start: row.m_start,
        m_end: row.m_end,
        label: row.label,
        bpm: tempo.bpm,
        start_bpm: row.start_bpm.unwrap_or(0.0),
        target_bpm: row.target_bpm,
        planned_reps: row.planned_reps,
        attempt_ceiling: row.contract.attempt_ceiling,
        contract_source: row.contract_source,
        reps_done: summary.tries,
        attempts_recorded: summary.attempts_recorded,
        tries: summary.tries,
        voided_attempts: summary.voided_attempts,
        current_clean_streak: summary.current_clean_streak,
        mastery_progress_streak,
        best_clean_streak: summary.best_clean_streak,
        reset_count: summary.reset_count,
        accuracy: summary.accuracy,
        required_clean_streak: row.contract.required_success,
        effective_required_clean_streak: summary.contract.effective_required_success,
        recovery_remaining: summary.contract.recovery_remaining,
        review_boundary_reached: summary.contract.review_boundary_reached,
        mastery_status: mastery_name(summary.contract.mastery).into(),
        mastery_verified: verification,
        set_state: row.set_state,
        last_attempt_id: last_effective.map(|attempt| attempt.id),
        last_adjustment_id,
        cleans_at_step: tempo.cleans_at_step,
        rule: row.rule,
        variant: current_variant,
        variants,
        verdicts: VerdictCounts {
            clean: summary.clean,
            flawed: summary.flawed,
            failed: summary.failed,
        },
        last: last_effective.map(|attempt| LastRep {
            verdict: match attempt.verdict {
                AttemptVerdict::Clean => "clean",
                AttemptVerdict::Flawed => "flawed",
                AttemptVerdict::Failed => "failed",
            }
            .into(),
            note: attempt.note.clone(),
            bpm: attempt.bpm,
        }),
        status: row.status,
        focus: row.focus,
        use_metronome: row.use_metronome,
        tuning: row.tuning,
        active_seconds: loop_state.active_seconds,
        timer_state: loop_state.timer_state,
        intention: loop_state.intention,
        judging_axis: loop_state.judging_axis,
        hands: loop_state.hands,
        method: loop_state.method,
        planned_seconds: loop_state.planned_seconds,
        reflection: loop_state.reflection,
        safety_state: loop_state.safety_state,
        manual_clean_debt: loop_state.manual_clean_debt,
        recovery_actions: loop_state.recovery_actions,
        retention_check: loop_state.retention_check,
        working_m_start: loop_state.working_m_start,
        working_m_end: loop_state.working_m_end,
        current_sloppy_streak: tempo.sloppy_streak,
        demoted_this_set: tempo.demoted_this_set,
        variant_stage_index: tempo.variant_stage.map(|stage| stage.index),
        variant_stage_cleans: tempo.variant_stage.map_or(0, |stage| stage.cleans),
        variant_stage_required: tempo.variant_stage.map_or(0, |stage| stage.required),
        next_variant_stage_name,
        variant_chain_complete: tempo.variant_stage.is_some_and(|stage| stage.complete),
    })
}

fn projected_retune(before: Option<f64>, after: Option<f64>) -> Option<f64> {
    match (before, after) {
        (Some(from), Some(to)) if (from - to).abs() > BPM_EPSILON => Some(to),
        (None, Some(to)) => Some(to),
        _ => None,
    }
}

pub(super) fn insert_event(
    tx: &Transaction<'_>,
    write: EventWrite<'_>,
) -> rusqlite::Result<(Option<i64>, i64)> {
    let encoded = json_to_sql(write.payload)?;
    let (feed_id, ts) = if let Some(session_id) = write.session_id {
        let (feed_id, ts): (i64, String) = if let Some(timestamp) = write.timestamp {
            tx.query_row(
                "INSERT INTO session_event(session_id,ts,kind,payload)
                 VALUES (?1,?2,?3,?4) RETURNING id,ts",
                rusqlite::params![session_id, timestamp, write.kind, &encoded],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?
        } else {
            tx.query_row(
                "INSERT INTO session_event(session_id,kind,payload)
                 VALUES (?1,?2,?3) RETURNING id,ts",
                rusqlite::params![session_id, write.kind, &encoded],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?
        };
        (Some(feed_id), ts)
    } else {
        let ts: String = if let Some(timestamp) = write.timestamp {
            timestamp.to_string()
        } else {
            tx.query_row("SELECT datetime('now')", [], |row| row.get(0))?
        };
        (None, ts)
    };
    let canonical_id: i64 = tx.query_row(
        "INSERT INTO event(ts,session_id,piece_id,kind,payload,entity_type,entity_id,source,command_id)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9) RETURNING id",
        rusqlite::params![
            ts,
            write.session_id,
            write.piece_id,
            write.kind,
            encoded,
            write.entity_type,
            write.entity_id,
            source_name(write.source),
            write.command_id,
        ],
        |row| row.get(0),
    )?;
    if let Some(feed_id) = feed_id {
        tx.execute(
            "INSERT INTO session_event_backfill
             (legacy_session_event_id,canonical_event_id,disposition,reason)
             VALUES (?1,?2,'inserted','live_atomic_v2')",
            rusqlite::params![feed_id, canonical_id],
        )?;
    }
    Ok((feed_id, canonical_id))
}

#[allow(clippy::too_many_arguments)]
fn insert_contract(
    tx: &Transaction<'_>,
    set_id: i64,
    contract: &PracticeContract,
    state: &str,
    restart_of: Option<i64>,
    source: MutationSource,
    planned_seconds: Option<u32>,
    pass_seconds: Option<i64>,
) -> rusqlite::Result<()> {
    let (recovery_policy, recovery_value, recovery_minimum) = match contract.recovery {
        RecoveryPolicy::None => ("none", 0_u32, 0_u32),
        RecoveryPolicy::FixedCleanDebt { additional_clean } => ("fixed", additional_clean, 0),
        RecoveryPolicy::Adaptive {
            ratio_basis_points,
            minimum_clean_streak,
        } => (
            "adaptive",
            u32::from(ratio_basis_points),
            minimum_clean_streak,
        ),
    };
    let basis = match contract.mastery_basis {
        MasteryBasis::ConsecutiveClean => "consecutive_clean",
        MasteryBasis::TotalClean => "total_clean",
        MasteryBasis::TimedExposure => "timed_exposure",
        MasteryBasis::Exploratory => "exploratory",
        MasteryBasis::LegacyAttemptCount => "legacy_attempt_count",
    };
    tx.execute(
        "INSERT INTO set_contract
         (set_id,template_id,contract_version,name,rationale,mastery_basis,
          required_success,reset_on_flawed,reset_on_failed,recovery_policy,
          recovery_value,recovery_minimum,tempo_policy_json,attempt_ceiling,
          planned_seconds,retention_delay_days,source_refs_json,set_state,
          mastery_verification,restart_of_set_id,source,pass_seconds)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,
                 ?15,NULL,?16,?17,'verified',?18,?19,?20)",
        rusqlite::params![
            set_id,
            contract.template_id,
            contract.contract_version,
            contract.name,
            contract.rationale,
            basis,
            contract.required_success,
            contract.reset_on_flawed,
            contract.reset_on_failed,
            recovery_policy,
            recovery_value,
            recovery_minimum,
            json_to_sql(&json!({
                "mastery": "final_required_clean_attempts_at_or_above_target_bpm"
            }))?,
            contract.attempt_ceiling,
            planned_seconds,
            json_to_sql(&contract.sources)?,
            state,
            restart_of,
            source_name(source),
            pass_seconds,
        ],
    )?;
    Ok(())
}

fn ensure_sidecars(tx: &Transaction<'_>, block_id: i64) -> rusqlite::Result<()> {
    tx.execute(
        "INSERT OR IGNORE INTO set_contract
         (set_id,template_id,contract_version,name,rationale,mastery_basis,
          required_success,reset_on_flawed,reset_on_failed,recovery_policy,
          recovery_value,recovery_minimum,tempo_policy_json,attempt_ceiling,
          planned_seconds,retention_delay_days,source_refs_json,set_state,
          mastery_verification,restart_of_set_id,source)
         SELECT id,NULL,1,'Legacy attempt-count record','Compatibility marker.',
                'legacy_attempt_count',MAX(planned_reps,0),0,0,'none',0,0,'{}',
                CASE WHEN planned_reps>=1 THEN planned_reps END,NULL,NULL,'[]',
                CASE status WHEN 'done' THEN 'legacy_closed' WHEN 'abandoned' THEN 'abandoned' ELSE 'legacy_open' END,
                'unverified',NULL,'migration_legacy'
         FROM rep_block WHERE id=?1",
        [block_id],
    )?;
    tx.execute(
        "INSERT OR IGNORE INTO attempt_provenance(rep_id,source,recorded_ts)
         SELECT id,'migration_legacy',COALESCE(ts,datetime('now')) FROM rep WHERE block_id=?1",
        [block_id],
    )?;
    Ok(())
}

pub(crate) fn validate_open(
    args: &RepOpenArgs,
    rule: &IncrementRule,
    planned_reps: u32,
    contract: &PracticeContract,
) -> rusqlite::Result<()> {
    if args.m_start < 1 || args.m_end < args.m_start {
        return Err(invalid("invalid measure range"));
    }
    if (args.focus == "tempo" || args.use_metronome)
        && (!args.start_bpm.is_finite() || args.start_bpm <= 0.0)
    {
        return Err(invalid(
            "tempo or metronome sets require a positive finite BPM",
        ));
    }
    if !(1..=16).contains(&args.tuning.beats_per_bar) {
        return Err(invalid("beats per bar must be between 1 and 16"));
    }
    if !(1..=16).contains(&args.tuning.subdivision) {
        return Err(invalid("subdivision must be between 1 and 16"));
    }
    if args.focus != "tempo" && args.target_bpm.is_some() {
        return Err(invalid("target BPM is valid only for tempo-focus sets"));
    }
    if args
        .required_clean_streak
        .is_some_and(|value| !(1..=100).contains(&value))
    {
        return Err(invalid("required clean streak must be between 1 and 100"));
    }
    if let Some(target) = args.target_bpm {
        if !target.is_finite() || target <= 0.0 || (args.start_bpm > 0.0 && target < args.start_bpm)
        {
            return Err(invalid(
                "target BPM must be finite, positive, and not below start",
            ));
        }
    }
    if rule.clean_needed == 0 || !rule.bpm_step.is_finite() || rule.bpm_step <= 0.0 {
        return Err(invalid(
            "increment rule must have positive cleans and BPM step",
        ));
    }
    if args.planned_reps == Some(0) || planned_reps == 0 {
        return Err(invalid("attempt review boundary must be positive"));
    }
    if args.variants.iter().any(|variant| {
        variant.name.trim().is_empty() || variant.name.chars().count() > 200 || variant.reps == 0
    }) {
        return Err(invalid(
            "variants require a short name and positive attempts",
        ));
    }
    contract
        .validate()
        .map_err(|error| invalid(format!("invalid contract: {error:?}")))
}

/// Open one live rep set inside an already-open transaction, reusing the exact
/// block/contract/context/event writes `v2_open_set` commits. Callers own the
/// transaction and commit, so a durable command (e.g. the reviewed session
/// plan) can atomically wrap this open in one receipted operation. Enforces
/// the one-ACTIVE-set invariant here (Task A4b: `set_contract_one_active_v2_idx`,
/// SCHEMA_V14) so an in-flight ACTIVE block rejects a second open with no
/// partial writes — a set merely sitting `paused` elsewhere no longer blocks
/// opening a fresh one; paused sets are plural by design (the paused-sets
/// tray). Returns the fresh `V2Open` plus the operation's canonical event ids
/// for the receipt.
#[allow(clippy::too_many_arguments)]
pub(super) fn open_set_in_tx(
    tx: &Transaction<'_>,
    session_hint: Option<i64>,
    args: &RepOpenArgs,
    rule: &IncrementRule,
    planned_reps: u32,
    contract: &PracticeContract,
    context: Option<&SetFocusContextInput>,
    source: MutationSource,
    command_id: &str,
    now: &str,
    demotion: DemotionConfig,
) -> rusqlite::Result<(V2Open, Vec<i64>)> {
    let active_exists: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM set_contract WHERE set_state='active')",
        [],
        |row| row.get(0),
    )?;
    if active_exists {
        return Err(invalid("close the current block first"));
    }
    if let Some(region_id) = args.region_id {
        let valid: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM region WHERE id=?1 AND piece_id=?2)",
            rusqlite::params![region_id, args.piece_id],
            |row| row.get(0),
        )?;
        if !valid {
            return Err(invalid("region does not belong to piece"));
        }
    }
    let session =
        super::practice_loop::resolve_practice_session(tx, session_hint, source, command_id, now)?;
    let persisted_start = (args.focus == "tempo" || args.use_metronome).then_some(args.start_bpm);
    let block_id: i64 = tx.query_row(
        "INSERT INTO rep_block
             (piece_id,m_start,m_end,label,start_bpm,target_bpm,increment_rule,
              planned_reps,variants,focus,use_metronome,region_id,tuning_json)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,
               COALESCE(?12,(SELECT id FROM region WHERE piece_id=?1 AND m_start<=?2 AND m_end>=?3
                ORDER BY (m_end-m_start),sort_order,id LIMIT 1)),?13) RETURNING id",
        rusqlite::params![
            args.piece_id,
            args.m_start,
            args.m_end,
            args.label,
            persisted_start,
            args.target_bpm,
            json_to_sql(rule)?,
            planned_reps,
            json_to_sql(&args.variants)?,
            args.focus,
            args.use_metronome,
            args.region_id,
            json_to_sql(&args.tuning)?,
        ],
        |row| row.get(0),
    )?;
    insert_contract(
        tx,
        block_id,
        contract,
        "active",
        None,
        source,
        context.and_then(|value| value.planned_seconds),
        context.and_then(|value| value.pass_seconds),
    )?;
    super::practice_loop::capture_open_context(tx, block_id, args, context, now)?;
    let payload = json!({
        "block_id": block_id,
        "piece_id": args.piece_id,
        "m_start": args.m_start,
        "m_end": args.m_end,
        "required_clean_streak": contract.required_success,
        "source": source_name(source),
        "command_id": command_id,
    });
    let (feed_id, open_event_id) = insert_event(
        tx,
        EventWrite {
            session_id: Some(session.id),
            piece_id: args.piece_id,
            kind: "rep_open",
            payload: &payload,
            entity_type: "set",
            entity_id: block_id,
            source,
            command_id,
            timestamp: Some(now),
        },
    )?;
    let snapshot = project(tx, block_id, demotion)?;
    let event_ids = super::practice_loop::operation_event_ids(session, open_event_id);
    Ok((
        V2Open {
            snapshot,
            feed_id: feed_id.expect("session-backed open has feed row"),
            session_id: session.id,
        },
        event_ids,
    ))
}

impl Store {
    /// IPC-facing read for the paused-sets tray (Task A4). See
    /// [`paused_sets_list`] for the query and streak-reuse rationale.
    pub fn paused_sets_list(
        &self,
        demotion: DemotionConfig,
    ) -> rusqlite::Result<Vec<PausedSetRow>> {
        let conn = self
            .conn
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        paused_sets_list(&conn, demotion)
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn v2_open_set(
        &self,
        session_hint: Option<i64>,
        args: &RepOpenArgs,
        rule: &IncrementRule,
        planned_reps: u32,
        contract: &PracticeContract,
        context: Option<&SetFocusContextInput>,
        source: MutationSource,
        command_id: &str,
        now: &str,
        demotion: DemotionConfig,
    ) -> rusqlite::Result<V2Open> {
        validate_open(args, rule, planned_reps, contract)?;

        let mut conn = self
            .conn
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let tx = conn.transaction()?;
        let (opened, _events) = open_set_in_tx(
            &tx,
            session_hint,
            args,
            rule,
            planned_reps,
            contract,
            context,
            source,
            command_id,
            now,
            demotion,
        )?;
        tx.commit()?;
        Ok(opened)
    }

    pub(crate) fn v2_snapshot(
        &self,
        block_id: i64,
        demotion: DemotionConfig,
    ) -> rusqlite::Result<RepSnapshot> {
        let conn = self
            .conn
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        project(&conn, block_id, demotion)
    }

    /// Historical/read-model enrichment, not the interactive hot loop — uses
    /// the global demotion defaults rather than a live-resolved per-set
    /// config, since `BlockHistory` rows carry no per-set override context
    /// here and this path is display-only (see the lock-trap note on
    /// `project_tempo`: settings are still never read from inside the store).
    pub(crate) fn v2_enrich_history(&self, history: &mut BlockHistory) -> rusqlite::Result<()> {
        let snapshot = self.v2_snapshot(history.block_id, DemotionConfig::default())?;
        history.bpm = snapshot.bpm;
        history.reps_done = snapshot.reps_done;
        history.attempt_ceiling = snapshot.attempt_ceiling;
        history.contract_source = snapshot.contract_source;
        history.verdicts = snapshot.verdicts;
        history.attempts_recorded = snapshot.attempts_recorded;
        history.tries = snapshot.tries;
        history.voided_attempts = snapshot.voided_attempts;
        history.current_clean_streak = snapshot.current_clean_streak;
        history.mastery_progress_streak = snapshot.mastery_progress_streak;
        history.best_clean_streak = snapshot.best_clean_streak;
        history.reset_count = snapshot.reset_count;
        history.accuracy = snapshot.accuracy;
        history.required_clean_streak = snapshot.required_clean_streak;
        history.effective_required_clean_streak = snapshot.effective_required_clean_streak;
        history.recovery_remaining = snapshot.recovery_remaining;
        history.review_boundary_reached = snapshot.review_boundary_reached;
        history.mastery_status = snapshot.mastery_status;
        history.mastery_verified = snapshot.mastery_verified;
        history.set_state = snapshot.set_state;
        history.last_attempt_id = snapshot.last_attempt_id;
        history.last_adjustment_id = snapshot.last_adjustment_id;
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn v2_record_attempt(
        &self,
        session_hint: Option<i64>,
        block_id: i64,
        rep_variant: Option<&str>,
        verdict_value: RepVerdict,
        note: Option<&str>,
        source: MutationSource,
        command_id: &str,
        now: &str,
        demotion: DemotionConfig,
    ) -> rusqlite::Result<V2Mutation> {
        // `rep_variant` is derived from the durable set projection, not supplied
        // by the caller. A retry after the first delivery commits can therefore
        // observe the next lane. Keep the idempotency fingerprint bound only to
        // the caller's stable request so the original receipt still replays.
        let fingerprint = super::practice_loop::request_fingerprint(&json!({
            "block_id": block_id,
            "verdict": verdict_value.as_str(),
            "note": note,
            "source": source_name(source),
        }))?;
        let mut conn = self
            .conn
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let tx = conn.transaction()?;
        let mut pending = match super::practice_loop::begin_operation(
            &tx,
            command_id,
            "record_attempt",
            &fingerprint,
            Some(block_id),
            source,
            now,
        )? {
            super::practice_loop::OperationStart::Replay(mut receipt) => {
                let snapshot = project(&tx, block_id, demotion)?;
                receipt.value = Some(snapshot.clone());
                return Ok(V2Mutation {
                    snapshot,
                    feed_id: None,
                    new_bpm: None,
                    receipt: Some(receipt),
                });
            }
            super::practice_loop::OperationStart::New(pending) => pending,
        };
        let session = super::practice_loop::resolve_practice_session(
            &tx,
            session_hint,
            source,
            command_id,
            now,
        )?;
        pending.session_id = Some(session.id);
        ensure_sidecars(&tx, block_id)?;
        let before = project(&tx, block_id, demotion)?;
        if !matches!(before.set_state.as_str(), "active" | "paused" | "mastered") {
            return Err(invalid("practice set is already terminal"));
        }
        if before.set_state != "active" {
            return Err(invalid("practice set is not active"));
        }
        super::practice_loop::checkpoint_active_interval(&tx, block_id, now, Some(pending.id))?;
        let semantic_bpm = if before.focus == "tempo" || before.use_metronome {
            Some(
                before
                    .bpm
                    .filter(|bpm| bpm.is_finite() && *bpm > 0.0)
                    .ok_or_else(|| invalid("tempo attempt requires a positive finite BPM"))?,
            )
        } else {
            None
        };
        // `rep.bpm` is a v1 evidence column with a historical NOT NULL
        // constraint. The approved v2 migration boundary forbids rebuilding
        // that source table, so metronome-free non-tempo writes retain 0 only as
        // the physical compatibility sentinel. `load_attempts` immediately
        // projects it to None and no semantic/API surface treats it as tempo.
        let physical_bpm = semantic_bpm.unwrap_or(0.0);
        let rep_id: i64 = tx.query_row(
            "INSERT INTO rep(block_id,ts,bpm,variant,verdict,note)
             VALUES (?1,?2,?3,?4,?5,?6) RETURNING id",
            rusqlite::params![
                block_id,
                now,
                physical_bpm,
                rep_variant,
                verdict_value.as_str(),
                note,
            ],
            |row| row.get(0),
        )?;
        tx.execute(
            "INSERT INTO attempt_provenance(rep_id,source,command_id,recorded_ts)
             VALUES (?1,?2,?3,?4)",
            rusqlite::params![rep_id, source_name(source), command_id, now],
        )?;

        let after_attempt = project(&tx, block_id, demotion)?;
        let new_bpm = projected_retune(before.bpm, after_attempt.bpm);
        let payload = json!({
            "block_id": block_id,
            "piece_id": after_attempt.piece_id,
            "attempt_id": rep_id,
            "bpm": semantic_bpm,
            "variant": rep_variant,
            "verdict": verdict_value.as_str(),
            "note": note,
            "tries": after_attempt.tries,
            "current_clean_streak": after_attempt.current_clean_streak,
            "command_id": command_id,
        });
        let (feed_id, canonical_id) = insert_event(
            &tx,
            EventWrite {
                session_id: Some(session.id),
                piece_id: after_attempt.piece_id,
                kind: "rep",
                payload: &payload,
                entity_type: "attempt",
                entity_id: rep_id,
                source,
                command_id,
                timestamp: Some(now),
            },
        )?;
        tx.execute(
            "UPDATE attempt_provenance SET canonical_event_id=?2 WHERE rep_id=?1",
            rusqlite::params![rep_id, canonical_id],
        )?;
        let mut event_ids = super::practice_loop::operation_event_ids(session, canonical_id);
        if let Some(to_bpm) = new_bpm {
            let tempo_command = format!("{command_id}:tempo");
            let tempo_payload = json!({
                "block_id": block_id,
                "piece_id": after_attempt.piece_id,
                "attempt_id": rep_id,
                "from_bpm": before.bpm,
                "to_bpm": to_bpm,
                "reason": "effective_ladder_step",
            });
            let (_, tempo_event_id) = insert_event(
                &tx,
                EventWrite {
                    session_id: Some(session.id),
                    piece_id: after_attempt.piece_id,
                    kind: "tempo_change",
                    payload: &tempo_payload,
                    entity_type: "set",
                    entity_id: block_id,
                    source,
                    command_id: &tempo_command,
                    timestamp: Some(now),
                },
            )?;
            event_ids.push(tempo_event_id);
        }
        let after_tempo = project(&tx, block_id, demotion)?;
        if after_tempo.mastery_status == "satisfied" {
            super::practice_loop::close_active_interval(
                &tx,
                block_id,
                now,
                "mastered",
                Some(pending.id),
            )?;
            tx.execute(
                "UPDATE set_contract SET set_state='mastered' WHERE set_id=?1",
                [block_id],
            )?;
            tx.execute("UPDATE rep_block SET status='done' WHERE id=?1", [block_id])?;
        }
        let snapshot = project(&tx, block_id, demotion)?;
        let receipt = super::practice_loop::finish_operation(
            &tx,
            pending,
            &format!(
                "Attempt {} saved — {}.",
                snapshot.tries,
                verdict_value.as_str()
            ),
            &snapshot,
            vec![
                MutationEntityRef {
                    entity_type: "set".into(),
                    entity_id: block_id,
                },
                MutationEntityRef {
                    entity_type: "attempt".into(),
                    entity_id: rep_id,
                },
            ],
            event_ids,
            Some("rep_undo"),
        )?;
        tx.commit()?;
        Ok(V2Mutation {
            snapshot,
            feed_id,
            new_bpm,
            receipt: Some(receipt),
        })
    }

    #[allow(clippy::too_many_arguments)]
    fn v2_adjust(
        &self,
        session_id: Option<i64>,
        block_id: i64,
        attempt_id: Option<i64>,
        kind: &str,
        after: &Value,
        reverses: Option<i64>,
        source: MutationSource,
        command_id: &str,
        keep_open: bool,
        now: Option<&str>,
        demotion: DemotionConfig,
    ) -> rusqlite::Result<V2Mutation> {
        let mut conn = self
            .conn
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let tx = conn.transaction()?;
        ensure_sidecars(&tx, block_id)?;
        let before = project(&tx, block_id, demotion)?;
        let attempt_id = attempt_id
            .or(before.last_attempt_id)
            .ok_or_else(|| invalid("no effective attempt to adjust"))?;
        let effective = effective_attempt(&tx, block_id, attempt_id)?;
        let adjustment_id: i64 = tx.query_row(
            "INSERT INTO attempt_adjustment
             (rep_id,kind,before_json,after_json,source,command_id,reason,reverses_adjustment_id)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8) RETURNING id",
            rusqlite::params![
                attempt_id,
                kind,
                json_to_sql(&json!({
                    "verdict": verdict_name(effective.verdict),
                    "note": effective.note,
                    "voided": effective.voided,
                }))?,
                json_to_sql(after)?,
                source_name(source),
                command_id,
                format!("{kind} via v2 compensating adjustment"),
                reverses,
            ],
            |row| row.get(0),
        )?;
        let mut snapshot = project(&tx, block_id, demotion)?;
        // Corrections repair attempt truth; they do not rewrite how a set left
        // the live lifecycle. Mastered, restarted, explicitly abandoned, and
        // unresolved closed sets retain that terminal lineage even if the
        // repaired ledger would now satisfy (or cease to satisfy) mastery. Only
        // an explicit reviewed lifecycle command may reopen or promote them.
        let preserves_terminal_lineage = matches!(
            before.set_state.as_str(),
            "mastered" | "restarted" | "abandoned" | "closed_unresolved"
        );
        if before.mastery_status != "unverified_legacy" && !preserves_terminal_lineage {
            let next_state = if snapshot.mastery_status == "satisfied" {
                "mastered"
            } else if keep_open {
                if before.set_state == "paused" {
                    "paused"
                } else {
                    "active"
                }
            } else {
                "closed_unresolved"
            };
            let compat = if next_state == "mastered" {
                "done"
            } else if keep_open {
                "open"
            } else {
                "abandoned"
            };
            tx.execute(
                "UPDATE set_contract SET set_state=?2 WHERE set_id=?1",
                rusqlite::params![block_id, next_state],
            )?;
            tx.execute(
                "UPDATE rep_block SET status=?2 WHERE id=?1",
                rusqlite::params![block_id, compat],
            )?;
            snapshot = project(&tx, block_id, demotion)?;
        }
        let payload = json!({
            "block_id": block_id,
            "piece_id": snapshot.piece_id,
            "attempt_id": attempt_id,
            "adjustment_id": adjustment_id,
            "action": kind,
            "reverses_adjustment_id": reverses,
            "command_id": command_id,
        });
        let (feed_id, _) = insert_event(
            &tx,
            EventWrite {
                session_id,
                piece_id: snapshot.piece_id,
                kind: "rep_edit",
                payload: &payload,
                entity_type: "attempt",
                entity_id: attempt_id,
                source,
                command_id,
                timestamp: now,
            },
        )?;
        let new_bpm = projected_retune(before.bpm, snapshot.bpm);
        if let Some(to_bpm) = new_bpm {
            let tempo_command = format!("{command_id}:tempo");
            let tempo_payload = json!({
                "block_id": block_id,
                "piece_id": snapshot.piece_id,
                "attempt_id": attempt_id,
                "adjustment_id": adjustment_id,
                "from_bpm": before.bpm,
                "to_bpm": to_bpm,
                "reason": "effective_attempt_adjustment",
            });
            insert_event(
                &tx,
                EventWrite {
                    session_id,
                    piece_id: snapshot.piece_id,
                    kind: "tempo_change",
                    payload: &tempo_payload,
                    entity_type: "set",
                    entity_id: block_id,
                    source,
                    command_id: &tempo_command,
                    timestamp: now,
                },
            )?;
        }
        tx.commit()?;
        Ok(V2Mutation {
            snapshot,
            feed_id,
            new_bpm,
            receipt: None,
        })
    }

    /// `now`: `Some` stamps the compensating `rep_edit`/`tempo_change` events at
    /// that already-committed timestamp (RepEngine callers thread its own clock
    /// through here so a history repair under a test/fixed clock never reads
    /// back as "on a different day" from the surrounding practice — task A5);
    /// `None` preserves the original behavior (SQLite's own `datetime('now')`)
    /// for callers with no clock of their own (data-repair/import paths).
    pub(crate) fn v2_undo(
        &self,
        session_id: i64,
        block_id: i64,
        source: MutationSource,
        command_id: &str,
        now: Option<&str>,
        demotion: DemotionConfig,
    ) -> rusqlite::Result<V2Mutation> {
        self.v2_adjust(
            Some(session_id),
            block_id,
            None,
            "void",
            &json!({"voided": true}),
            None,
            source,
            command_id,
            true,
            now,
            demotion,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn v2_correct(
        &self,
        session_id: Option<i64>,
        block_id: i64,
        attempt_id: Option<i64>,
        verdict_value: RepVerdict,
        note: Option<&str>,
        replace_note: bool,
        source: MutationSource,
        command_id: &str,
        keep_open: bool,
        now: Option<&str>,
        demotion: DemotionConfig,
    ) -> rusqlite::Result<V2Mutation> {
        let (kind, after) = if replace_note {
            (
                "combined_correction",
                json!({"verdict": verdict_value.as_str(), "note": note}),
            )
        } else {
            (
                "replace_verdict",
                json!({"verdict": verdict_value.as_str()}),
            )
        };
        self.v2_adjust(
            session_id, block_id, attempt_id, kind, &after, None, source, command_id, keep_open,
            now, demotion,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn v2_void_history_attempt(
        &self,
        block_id: i64,
        attempt_id: i64,
        source: MutationSource,
        command_id: &str,
        keep_open: bool,
        demotion: DemotionConfig,
    ) -> rusqlite::Result<V2Mutation> {
        self.v2_adjust(
            None,
            block_id,
            Some(attempt_id),
            "void",
            &json!({"voided": true}),
            None,
            source,
            command_id,
            keep_open,
            None,
            demotion,
        )
    }

    pub(crate) fn v2_effective_attempt(
        &self,
        block_id: i64,
        attempt_id: i64,
    ) -> rusqlite::Result<EffectiveAttemptView> {
        let conn = self
            .conn
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let attempt = effective_attempt(&conn, block_id, attempt_id)?;
        Ok(EffectiveAttemptView {
            verdict: verdict_name(attempt.verdict).into(),
            note: attempt.note,
            voided: attempt.voided,
            source: source_name(attempt.source).into(),
            active_adjustment_ids: attempt.active_adjustment_ids,
            original_verdict: verdict_name(attempt.original_verdict).into(),
            bpm: attempt.bpm,
        })
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn v2_reverse_adjustment(
        &self,
        session_id: i64,
        block_id: i64,
        adjustment_id: i64,
        source: MutationSource,
        command_id: &str,
        now: Option<&str>,
        demotion: DemotionConfig,
    ) -> rusqlite::Result<V2Mutation> {
        let conn = self
            .conn
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let attempt_id: i64 = conn.query_row(
            "SELECT a.rep_id FROM attempt_adjustment a JOIN rep r ON r.id=a.rep_id
             WHERE a.id=?1 AND r.block_id=?2",
            rusqlite::params![adjustment_id, block_id],
            |row| row.get(0),
        )?;
        drop(conn);
        self.v2_adjust(
            Some(session_id),
            block_id,
            Some(attempt_id),
            "restore",
            &json!({"reversed_adjustment_id": adjustment_id}),
            Some(adjustment_id),
            source,
            command_id,
            true,
            now,
            demotion,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn v2_restart(
        &self,
        session_id: i64,
        block_id: i64,
        required_clean_streak: Option<u32>,
        source: MutationSource,
        command_id: &str,
        now: &str,
        demotion: DemotionConfig,
    ) -> rusqlite::Result<V2Open> {
        let mut conn = self
            .conn
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let tx = conn.transaction()?;
        let old = load_set_row(&tx, block_id)?.ok_or(rusqlite::Error::QueryReturnedNoRows)?;
        if !matches!(old.set_state.as_str(), "active" | "paused" | "mastered") {
            return Err(invalid("only the current set can restart"));
        }
        let required = required_clean_streak.unwrap_or(old.contract.required_success);
        if !(1..=100).contains(&required) {
            return Err(invalid("clean-streak target must be 1 to 100"));
        }
        if old.set_state == "active" {
            super::practice_loop::close_active_interval(&tx, block_id, now, "restart", None)?;
        }
        tx.execute(
            "UPDATE set_contract SET set_state='restarted' WHERE set_id=?1",
            [block_id],
        )?;
        tx.execute(
            "UPDATE rep_block SET status='abandoned' WHERE id=?1",
            [block_id],
        )?;
        let new_id: i64 = tx.query_row(
            "INSERT INTO rep_block
             (piece_id,m_start,m_end,label,start_bpm,target_bpm,increment_rule,
              planned_reps,variants,status,region_id,focus,use_metronome,tuning_json)
             SELECT piece_id,m_start,m_end,label,start_bpm,target_bpm,increment_rule,
                    planned_reps,variants,'open',region_id,focus,use_metronome,tuning_json
             FROM rep_block WHERE id=?1 RETURNING id",
            [block_id],
            |row| row.get(0),
        )?;
        let mut contract = PracticeContract::consecutive_clean(required);
        contract.attempt_ceiling = old.contract.attempt_ceiling;
        contract.recovery = old.contract.recovery;
        let planned_seconds: Option<u32> = tx.query_row(
            "SELECT planned_seconds FROM set_contract WHERE set_id=?1",
            [block_id],
            |row| row.get(0),
        )?;
        let pass_seconds: Option<i64> = tx.query_row(
            "SELECT pass_seconds FROM set_contract WHERE set_id=?1",
            [block_id],
            |row| row.get(0),
        )?;
        insert_contract(
            &tx,
            new_id,
            &contract,
            "active",
            Some(block_id),
            source,
            planned_seconds,
            pass_seconds,
        )?;
        super::practice_loop::capture_restart_context(&tx, block_id, new_id, now)?;
        let payload = json!({
            "block_id": new_id,
            "restart_of_set_id": block_id,
            "piece_id": old.piece_id,
            "required_clean_streak": required,
            "command_id": command_id,
        });
        let (feed_id, _) = insert_event(
            &tx,
            EventWrite {
                session_id: Some(session_id),
                piece_id: old.piece_id,
                kind: "rep_open",
                payload: &payload,
                entity_type: "set",
                entity_id: new_id,
                source,
                command_id,
                timestamp: Some(now),
            },
        )?;
        let snapshot = project(&tx, new_id, demotion)?;
        tx.commit()?;
        Ok(V2Open {
            snapshot,
            feed_id: feed_id.expect("session-backed restart has feed row"),
            session_id,
        })
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn v2_close(
        &self,
        session_id: i64,
        block_id: i64,
        source: MutationSource,
        command_id: &str,
        now: &str,
        demotion: DemotionConfig,
    ) -> rusqlite::Result<V2Mutation> {
        let mut conn = self
            .conn
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let tx = conn.transaction()?;
        let before = project(&tx, block_id, demotion)?;
        if !matches!(before.set_state.as_str(), "active" | "paused" | "mastered") {
            return Err(invalid("practice set is already terminal"));
        }
        let (state, compat) = if before.mastery_status == "satisfied" {
            ("mastered", "done")
        } else {
            ("closed_unresolved", "abandoned")
        };
        if before.set_state == "active" {
            super::practice_loop::close_active_interval(
                &tx,
                block_id,
                now,
                if state == "mastered" {
                    "mastered"
                } else {
                    "close"
                },
                None,
            )?;
        }
        tx.execute(
            "UPDATE set_contract SET set_state=?2 WHERE set_id=?1",
            rusqlite::params![block_id, state],
        )?;
        tx.execute(
            "UPDATE rep_block SET status=?2 WHERE id=?1",
            rusqlite::params![block_id, compat],
        )?;
        let snapshot = project(&tx, block_id, demotion)?;
        let close_payload = json!({
            "block_id": block_id,
            "piece_id": snapshot.piece_id,
            "set_state": state,
            "tries": snapshot.tries,
            "current_clean_streak": snapshot.current_clean_streak,
            "mastery_status": snapshot.mastery_status,
            "command_id": command_id,
        });
        let (feed_id, _) = insert_event(
            &tx,
            EventWrite {
                session_id: Some(session_id),
                piece_id: snapshot.piece_id,
                kind: "rep_close",
                payload: &close_payload,
                entity_type: "set",
                entity_id: block_id,
                source,
                command_id,
                timestamp: Some(now),
            },
        )?;
        tx.commit()?;
        Ok(V2Mutation {
            snapshot,
            feed_id,
            new_bpm: None,
            receipt: None,
        })
    }

    pub(crate) fn v2_block_id_for_attempt(&self, attempt_id: i64) -> rusqlite::Result<i64> {
        let conn = self
            .conn
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        conn.query_row(
            "SELECT block_id FROM rep WHERE id=?1",
            [attempt_id],
            |row| row.get(0),
        )
    }

    #[cfg(test)]
    pub(crate) fn test_execute_batch(&self, sql: &str) -> rusqlite::Result<()> {
        let conn = self
            .conn
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        conn.execute_batch(sql)
    }

    #[cfg(test)]
    pub(crate) fn test_scalar_i64(&self, sql: &str) -> rusqlite::Result<i64> {
        let conn = self
            .conn
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        conn.query_row(sql, [], |row| row.get(0))
    }

    #[cfg(test)]
    pub(crate) fn test_scalar_i64_opt(&self, sql: &str) -> rusqlite::Result<Option<i64>> {
        let conn = self
            .conn
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        conn.query_row(sql, [], |row| row.get(0))
    }

    #[cfg(test)]
    pub(crate) fn test_scalar_string(&self, sql: &str) -> rusqlite::Result<String> {
        let conn = self
            .conn
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        conn.query_row(sql, [], |row| row.get(0))
    }
}

fn effective_attempt(
    conn: &Connection,
    block_id: i64,
    attempt_id: i64,
) -> rusqlite::Result<EffectiveAttempt> {
    let row = load_set_row(conn, block_id)?.ok_or(rusqlite::Error::QueryReturnedNoRows)?;
    let attempts = load_attempts(conn, &row)?;
    let adjustments = load_adjustments(conn, block_id)?;
    ledger::derive(&row.contract, &attempts, &adjustments, 0)
        .map_err(|error| invalid(format!("ledger projection failed: {error:?}")))?
        .effective_attempts
        .into_iter()
        .find(|attempt| attempt.id == attempt_id)
        .ok_or(rusqlite::Error::QueryReturnedNoRows)
}

fn verdict_name(value: AttemptVerdict) -> &'static str {
    match value {
        AttemptVerdict::Clean => "clean",
        AttemptVerdict::Flawed => "flawed",
        AttemptVerdict::Failed => "failed",
    }
}

#[cfg(test)]
mod real_copy_tests {
    use super::*;

    #[test]
    #[ignore = "requires CODAKILLER_MIGRATION_COPY pointing to a disposable backup"]
    fn real_legacy_notes_zero_bpm_rows_project_to_none_without_source_rewrite() {
        let path = std::env::var("CODAKILLER_MIGRATION_COPY")
            .expect("CODAKILLER_MIGRATION_COPY must point to a disposable database copy");

        // Guard: never run against the live app-data database. `Store::open`
        // migrates whatever it is given, so the same refusal the migration
        // rehearsal and the pre-map injection carry applies here.
        let resolved = std::fs::canonicalize(&path)
            .unwrap_or_else(|e| panic!("resolve CODAKILLER_MIGRATION_COPY '{path}': {e}"));
        assert!(
            !resolved
                .components()
                .any(|component| component.as_os_str() == "com.christian.codakiller"),
            "refuse to run on the live app-data location ({}); copy the database first",
            resolved.display()
        );

        let store = Store::open(&path).expect("disposable copy migrates");
        let physical = store
            .test_scalar_i64(
                "SELECT count(*) FROM rep r JOIN rep_block b ON b.id=r.block_id
                 JOIN attempt_provenance p ON p.rep_id=r.id
                 WHERE p.source='migration_legacy' AND b.focus!='tempo' AND r.bpm<=0",
            )
            .unwrap();
        assert_eq!(physical, 127);

        let semantic_none = [30_i64, 33, 44, 45, 46, 49, 50]
            .into_iter()
            .flat_map(|block_id| store.reps_for_block(block_id).unwrap())
            .filter(|attempt| attempt.source == "migration_legacy" && attempt.bpm.is_none())
            .count();
        assert_eq!(semantic_none, 127);
        assert_eq!(
            store
                .test_scalar_i64(
                    "SELECT count(*) FROM rep r JOIN rep_block b ON b.id=r.block_id
                     WHERE b.id IN (30,33,44,45,46,49,50) AND r.bpm=0",
                )
                .unwrap(),
            127,
            "projection must not rewrite physical legacy rows"
        );
    }
}
