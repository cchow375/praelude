//! Reviewed session plan start: the durable, receipted command that turns a
//! composer's reviewed draft into one live rep set — opening exactly the item
//! the user pressed Start on, one at a time.
//!
//! The wire contract mirrors `ReviewedSessionDraft` in
//! `src/features/composer/SessionComposer.tsx` field for field (snake_case,
//! `deny_unknown_fields`). Writes happen only on an explicit start.
//!
//! The reviewed plan does not get its own storage table: `action_draft` (the v8
//! "validated action draft" table) cannot honestly hold it — its
//! `source` CHECK admits only `voice_draft`/`brain_draft`, and its whole shape
//! (`original_text`, `operations_json`, `risk`, `revision_hash`, …) models a
//! natural-language edit awaiting confirmation, not an ordered practice
//! sequence. Per the no-schema-change constraint, the durable plan record is the
//! start command's own receipt (`practice_operation.value_json`), which carries
//! the full reviewed plan plus the item that opened. Progression is per-item
//! invocation of this same start machinery; the single-live-set invariant blocks
//! starting a second item while a block is live, surfaced as an honest error.

use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use serde_json::json;

use super::model::{
    IncrementRule, MutationEntityRef, MutationReceipt, RepOpenArgs, RepSnapshot,
    SetFocusContextInput,
};
use super::practice_loop::{
    begin_operation, finish_operation, request_fingerprint, OperationStart,
};
use super::practice_v2::{invalid, open_set_in_tx, project, validate_open};
use super::Store;
use crate::ledger::MutationSource;
use crate::protocol::PracticeContract;

/// Upper bound on a reviewed item's minute allocation; mirrors
/// `MAX_SESSION_MINUTES` in `composer/domain/models.ts`.
const MAX_SESSION_MINUTES: i64 = 180;

/// One `ComposerSourceRef` — a caller-owned provenance pointer.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PlanSourceRef {
    pub source_type: String,
    pub source_id: String,
}

/// One `DraftProvenance` block, pinning the strict wire contract. Provenance is
/// evidence the frontend already assembled; it is carried into the receipt, not
/// re-derived here.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PlanProvenance {
    pub candidate_ids: Vec<String>,
    pub evidence_ids: Vec<String>,
    pub source_refs: Vec<PlanSourceRef>,
}

/// Mirrors the composer's `editable_minutes` bound object.
#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PlanEditableMinutes {
    pub min: i64,
    pub max: i64,
}

/// One `ReviewedSessionItem` from the composer's reviewed handoff.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ReviewedSessionItem {
    pub sequence: i64,
    pub candidate_id: String,
    pub piece_ref: String,
    pub target_ref: String,
    pub kind: String,
    #[serde(default)]
    pub piece_label: Option<String>,
    #[serde(default)]
    pub target_label: Option<String>,
    pub allocated_minutes: i64,
    pub estimated_minutes: i64,
    pub rationale: String,
    pub editable_minutes: PlanEditableMinutes,
    pub provenance: PlanProvenance,
}

/// One `ComposerIssue` carried through as source provenance.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PlanIssue {
    pub code: String,
    #[serde(default)]
    pub candidate_id: Option<String>,
    pub detail: String,
}

/// The reviewed session draft handed off by `SessionComposer`. This value has no
/// command identity of its own; the start command supplies that.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ReviewedSessionPlan {
    pub mode: String,
    pub available_minutes: i64,
    pub allocated_minutes: i64,
    pub unallocated_minutes: i64,
    pub sequence: Vec<ReviewedSessionItem>,
    pub excluded_candidate_ids: Vec<String>,
    pub source_draft_issues: Vec<PlanIssue>,
}

/// One reviewed session plan start. `command_id` is the durable idempotency key
/// the frontend derives per item (`{plan}:{sequence}`); `start_sequence` selects
/// which reviewed item opens now.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SessionPlanStartPayload {
    pub command_id: String,
    pub start_sequence: i64,
    pub plan: ReviewedSessionPlan,
}

/// The committed result of a reviewed session plan start: the durable plan
/// record, which item opened, and the live block it opened.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionPlanStartOutcome {
    pub plan: ReviewedSessionPlan,
    pub started_sequence: i64,
    pub started_candidate_id: String,
    pub block_id: i64,
    pub snapshot: RepSnapshot,
}

/// A digit-only entity reference parses to an id; a namespaced ref such as
/// `goal:12` (a planned goal with no measure anchor) does not and cannot open a
/// measure-bound set.
fn parse_ref(value: &str) -> Option<i64> {
    value.trim().parse::<i64>().ok()
}

impl Store {
    /// Start one reviewed session plan item as a live rep set, in a single
    /// receipted transaction. Opens the requested item's block through the exact
    /// path `rep_open` uses; a repeated `command_id` replays the committed
    /// result without opening a second block or writing a second receipt. A
    /// start while another block is live is rejected with no partial writes.
    pub(crate) fn session_plan_start(
        &self,
        session_hint: Option<i64>,
        payload: &SessionPlanStartPayload,
        source: MutationSource,
        now: &str,
    ) -> rusqlite::Result<MutationReceipt<SessionPlanStartOutcome>> {
        let plan = &payload.plan;
        // Pure validation first: any failure here writes zero rows because no
        // transaction has opened yet.
        if plan.mode != "reviewed_session_draft" {
            return Err(invalid(
                "session plan payload is not a reviewed session draft",
            ));
        }
        if plan.sequence.is_empty() {
            return Err(invalid("a session plan needs at least one reviewed item"));
        }
        let raw_command_id = payload.command_id.trim();
        if raw_command_id.is_empty() {
            return Err(invalid("a session plan start needs a command id"));
        }
        let item = plan
            .sequence
            .iter()
            .find(|item| item.sequence == payload.start_sequence)
            .ok_or_else(|| invalid("the plan has no item at the requested sequence"))?;
        let piece_id = parse_ref(&item.piece_ref)
            .filter(|id| *id >= 1)
            .ok_or_else(|| invalid("the plan item has no valid piece reference"))?;
        let region_id = parse_ref(&item.target_ref).filter(|id| *id >= 1).ok_or_else(|| {
            invalid(
                "this plan item has no target region to open; only measure-anchored targets can start a set",
            )
        })?;
        if item.allocated_minutes < 1 || item.allocated_minutes > MAX_SESSION_MINUTES {
            return Err(invalid("the plan item minute allocation is out of range"));
        }
        let planned_seconds = u32::try_from(item.allocated_minutes * 60)
            .map_err(|_| invalid("the plan item minute allocation is out of range"))?;

        // Task C5: a one-gesture start on a sub-section (target_meta's
        // parent_region_id set) defaults required_success to 3 instead of
        // the usual setting-derived default — deliberately NOT the same
        // branch as below, so a plain top-level region's computation stays
        // byte-identical to before this task.
        let required = if self.region_parent_id(region_id).ok().flatten().is_some() {
            3
        } else {
            self.get_setting("practice.default_clean_streak")
                .ok()
                .flatten()
                .and_then(|value| value.parse::<u32>().ok())
                .filter(|value| (1..=100).contains(value))
                .unwrap_or(5)
        };

        let command_id = format!("session-plan-start:{raw_command_id}");
        let fingerprint = request_fingerprint(&json!({
            "start_sequence": item.sequence,
            "candidate_id": item.candidate_id,
            "piece_ref": item.piece_ref,
            "target_ref": item.target_ref,
            "allocated_minutes": item.allocated_minutes,
            "sequence_ids": plan
                .sequence
                .iter()
                .map(|entry| entry.candidate_id.as_str())
                .collect::<Vec<_>>(),
        }))?;

        let mut conn = self
            .conn
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let tx = conn.transaction()?;
        let mut pending = match begin_operation::<SessionPlanStartOutcome>(
            &tx,
            &command_id,
            "session_plan_start",
            &fingerprint,
            None,
            source,
            now,
        )? {
            OperationStart::Replay(mut receipt) => {
                // Re-project the block so a replay reflects live truth rather
                // than the snapshot frozen at first commit.
                if let Some(outcome) = receipt.value.as_mut() {
                    outcome.snapshot = project(&tx, outcome.block_id)?;
                }
                tx.commit()?;
                return Ok(receipt);
            }
            OperationStart::New(pending) => pending,
        };

        // The region carries the measure range; requiring piece ownership here
        // gives an honest message instead of a raw constraint failure.
        let (m_start, m_end): (u32, u32) = tx
            .query_row(
                "SELECT m_start,m_end FROM region WHERE id=?1 AND piece_id=?2",
                rusqlite::params![region_id, piece_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?
            .ok_or_else(|| invalid("the plan item target region does not belong to its piece"))?;

        let label = item
            .target_label
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| value.chars().take(200).collect::<String>());
        let rule = IncrementRule {
            clean_needed: required,
            bpm_step: 1.0,
        };
        let args = RepOpenArgs {
            tuning: Default::default(),
            piece_id,
            region_id: Some(region_id),
            m_start,
            m_end,
            label,
            start_bpm: 0.0,
            target_bpm: None,
            planned_reps: None,
            required_clean_streak: Some(required),
            increment: Some(rule.clone()),
            variants: Vec::new(),
            focus: "notes".to_string(),
            use_metronome: false,
        };
        let contract = PracticeContract::consecutive_clean(required);
        validate_open(&args, &rule, required, &contract)?;
        let intention = {
            let trimmed = item.rationale.trim();
            (!trimmed.is_empty()).then(|| trimmed.chars().take(2000).collect::<String>())
        };
        let context = SetFocusContextInput {
            intention,
            judging_axis: None,
            hands: None,
            method: None,
            planned_seconds: Some(planned_seconds),
            reflection: None,
            pass_seconds: None,
        };

        let (opened, event_ids) = open_set_in_tx(
            &tx,
            session_hint,
            &args,
            &rule,
            required,
            &contract,
            Some(&context),
            source,
            &command_id,
            now,
        )?;
        pending.session_id = Some(opened.session_id);

        let block_id = opened.snapshot.block_id;
        let outcome = SessionPlanStartOutcome {
            plan: plan.clone(),
            started_sequence: item.sequence,
            started_candidate_id: item.candidate_id.clone(),
            block_id,
            snapshot: opened.snapshot,
        };
        let name = item
            .target_label
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("target");
        let summary = format!(
            "Session plan started: item {} of {} — {name}.",
            item.sequence,
            plan.sequence.len(),
        );
        let receipt = finish_operation(
            &tx,
            pending,
            &summary,
            &outcome,
            vec![
                MutationEntityRef {
                    entity_type: "set".into(),
                    entity_id: block_id,
                },
                MutationEntityRef {
                    entity_type: "piece".into(),
                    entity_id: piece_id,
                },
            ],
            event_ids,
            None,
        )?;
        tx.commit()?;
        Ok(receipt)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::model::{RegionCreate, ScanPiece};

    const NOW: &str = "2026-07-16T12:00:00Z";

    fn store_with_region() -> (Store, i64, i64) {
        let store = Store::open(":memory:").expect("memory store");
        let piece_id = store
            .upsert_piece(&ScanPiece {
                folder_path: "/v/Scherzo".into(),
                title: "Scherzo".into(),
                composer: Some("Chopin".into()),
                xml_path: None,
                pdf_path: None,
            })
            .unwrap();
        assert_eq!(piece_id, 1);
        let region = store
            .region_create(RegionCreate {
                piece_id,
                name: "Development leap".into(),
                notes: None,
                m_start: 40,
                m_end: 56,
                kind: "hard_spot".into(),
            })
            .unwrap();
        (store, piece_id, region.id)
    }

    fn item(sequence: i64, piece_id: i64, region_id: i64, minutes: i64) -> ReviewedSessionItem {
        ReviewedSessionItem {
            sequence,
            candidate_id: format!("retention:{sequence}"),
            piece_ref: piece_id.to_string(),
            target_ref: region_id.to_string(),
            kind: "due_retention".into(),
            piece_label: Some("Scherzo".into()),
            target_label: Some("Development leap".into()),
            allocated_minutes: minutes,
            estimated_minutes: minutes,
            rationale: "Confirm the leap is still reliable.".into(),
            editable_minutes: PlanEditableMinutes { min: 1, max: 30 },
            provenance: PlanProvenance {
                candidate_ids: vec![format!("retention:{sequence}")],
                evidence_ids: vec![format!("retention-check:{sequence}")],
                source_refs: vec![PlanSourceRef {
                    source_type: "retention_check".into(),
                    source_id: sequence.to_string(),
                }],
            },
        }
    }

    fn plan(items: Vec<ReviewedSessionItem>) -> ReviewedSessionPlan {
        let allocated: i64 = items.iter().map(|entry| entry.allocated_minutes).sum();
        ReviewedSessionPlan {
            mode: "reviewed_session_draft".into(),
            available_minutes: 20,
            allocated_minutes: allocated,
            unallocated_minutes: 20 - allocated,
            sequence: items,
            excluded_candidate_ids: vec![],
            source_draft_issues: vec![],
        }
    }

    fn payload(
        command_id: &str,
        start_sequence: i64,
        plan: ReviewedSessionPlan,
    ) -> SessionPlanStartPayload {
        SessionPlanStartPayload {
            command_id: command_id.into(),
            start_sequence,
            plan,
        }
    }

    fn active_sets(store: &Store) -> i64 {
        store
            .test_scalar_i64("SELECT count(*) FROM set_contract WHERE set_state='active'")
            .unwrap()
    }

    fn start_receipts(store: &Store) -> i64 {
        store
            .test_scalar_i64(
                "SELECT count(*) FROM practice_operation WHERE operation_kind='session_plan_start'",
            )
            .unwrap()
    }

    fn blocks(store: &Store) -> i64 {
        store
            .test_scalar_i64("SELECT count(*) FROM rep_block")
            .unwrap()
    }

    #[test]
    fn happy_path_persists_the_plan_and_opens_the_first_item() {
        let (store, piece, region) = store_with_region();
        let plan = plan(vec![item(1, piece, region, 8), item(2, piece, region, 6)]);
        let receipt = store
            .session_plan_start(
                None,
                &payload("plan-a:1", 1, plan),
                MutationSource::UserClick,
                NOW,
            )
            .expect("plan starts");

        assert_eq!(receipt.status, "committed");
        assert!(!receipt.replayed);
        let outcome = receipt.value.expect("committed outcome");
        assert_eq!(outcome.started_sequence, 1);
        assert_eq!(outcome.started_candidate_id, "retention:1");
        assert!(outcome.block_id >= 1);
        assert_eq!(outcome.snapshot.piece_id, piece);
        assert_eq!((outcome.snapshot.m_start, outcome.snapshot.m_end), (40, 56));
        assert_eq!(outcome.snapshot.set_state, "active");
        assert_eq!(outcome.snapshot.planned_seconds, Some(8 * 60));
        // The durable receipt carries the whole reviewed plan, not just the item.
        assert_eq!(outcome.plan.sequence.len(), 2);

        assert_eq!(active_sets(&store), 1);
        assert_eq!(blocks(&store), 1);
        assert_eq!(start_receipts(&store), 1);
        // The opened block is bound to the reviewed target region.
        assert_eq!(
            store
                .test_scalar_i64(&format!(
                    "SELECT region_id FROM rep_block WHERE id={}",
                    outcome.block_id
                ))
                .unwrap(),
            region
        );
    }

    /// Task C5: a plain top-level region's one-gesture start must compute
    /// `required` exactly as before this task — same setting-derived value,
    /// same fields on the resulting snapshot. This is the byte-identical
    /// guarantee the C5 brief asks for.
    #[test]
    fn top_level_region_start_keeps_the_setting_derived_default() {
        let (store, piece, region) = store_with_region();
        let plan = plan(vec![item(1, piece, region, 8)]);
        let receipt = store
            .session_plan_start(
                None,
                &payload("plan-top-level:1", 1, plan),
                MutationSource::UserClick,
                NOW,
            )
            .expect("plan starts");
        let outcome = receipt.value.expect("committed outcome");
        assert_eq!(
            outcome.snapshot.required_clean_streak, 5,
            "unchanged: the global default (no custom setting written in this test)"
        );
    }

    /// Task C5: starting a session-plan item whose target region is a
    /// sub-section (`target_meta.parent_region_id` set) must default
    /// `required_success` to 3, regardless of the `practice.default_clean_streak`
    /// setting.
    #[test]
    fn child_region_start_defaults_required_success_to_three() {
        let (store, piece, parent_region) = store_with_region();
        // A setting far from 3, to prove the child default wins over it.
        store
            .set_setting("practice.default_clean_streak", "7")
            .unwrap();
        let child = store
            .region_create_with_parent(
                crate::store::model::RegionCreate {
                    piece_id: piece,
                    name: "Tricky run".into(),
                    notes: None,
                    m_start: 44,
                    m_end: 48,
                    kind: "hard_spot".into(),
                },
                Some(parent_region),
            )
            .unwrap();
        let plan = plan(vec![item(1, piece, child.id, 8)]);
        let receipt = store
            .session_plan_start(
                None,
                &payload("plan-child:1", 1, plan),
                MutationSource::UserClick,
                NOW,
            )
            .expect("plan starts");
        let outcome = receipt.value.expect("committed outcome");
        assert_eq!(outcome.snapshot.required_clean_streak, 3);
    }

    #[test]
    fn a_goal_only_item_cannot_open_a_set_and_writes_nothing() {
        let (store, piece, region) = store_with_region();
        let mut only = item(1, piece, region, 8);
        only.target_ref = "goal:5".into();
        let err = store
            .session_plan_start(
                None,
                &payload("plan-goal:1", 1, plan(vec![only])),
                MutationSource::UserClick,
                NOW,
            )
            .unwrap_err();
        assert!(err.to_string().contains("no target region"));
        assert_eq!(active_sets(&store), 0);
        assert_eq!(blocks(&store), 0);
        assert_eq!(start_receipts(&store), 0);
    }

    #[test]
    fn a_region_from_another_piece_is_rejected_and_rolls_back_the_pending_receipt() {
        let (store, piece, region) = store_with_region();
        let mut wrong = item(1, piece, region, 8);
        wrong.target_ref = "999".into();
        let err = store
            .session_plan_start(
                None,
                &payload("plan-wrong:1", 1, plan(vec![wrong])),
                MutationSource::UserClick,
                NOW,
            )
            .unwrap_err();
        assert!(err.to_string().contains("does not belong"));
        // The pending practice_operation row from begin_operation rolled back.
        assert_eq!(active_sets(&store), 0);
        assert_eq!(blocks(&store), 0);
        assert_eq!(start_receipts(&store), 0);
    }

    #[test]
    fn replaying_the_same_command_id_returns_one_block_and_one_receipt() {
        let (store, piece, region) = store_with_region();
        let plan = plan(vec![item(1, piece, region, 8), item(2, piece, region, 6)]);
        let first = store
            .session_plan_start(
                None,
                &payload("plan-b:1", 1, plan.clone()),
                MutationSource::UserClick,
                NOW,
            )
            .expect("first start");
        let second = store
            .session_plan_start(
                None,
                &payload("plan-b:1", 1, plan),
                MutationSource::UserClick,
                "2026-07-16T12:05:00Z",
            )
            .expect("replayed start");

        assert!(!first.replayed);
        assert!(second.replayed);
        assert_eq!(second.receipt_id, first.receipt_id);
        assert_eq!(
            first.value.unwrap().block_id,
            second.value.unwrap().block_id
        );
        assert_eq!(active_sets(&store), 1);
        assert_eq!(blocks(&store), 1);
        assert_eq!(start_receipts(&store), 1);
    }

    #[test]
    fn a_reused_command_id_with_a_different_item_is_rejected() {
        let (store, piece, region) = store_with_region();
        let plan = plan(vec![item(1, piece, region, 8), item(2, piece, region, 6)]);
        store
            .session_plan_start(
                None,
                &payload("plan-conflict:1", 1, plan.clone()),
                MutationSource::UserClick,
                NOW,
            )
            .expect("first start");
        // Same command id, different start sequence → different fingerprint.
        let err = store
            .session_plan_start(
                None,
                &payload("plan-conflict:1", 2, plan),
                MutationSource::UserClick,
                "2026-07-16T12:05:00Z",
            )
            .unwrap_err();
        assert!(err.to_string().contains("already committed"));
        assert_eq!(blocks(&store), 1);
    }

    #[test]
    fn starting_a_second_item_while_a_block_is_live_is_cleanly_rejected() {
        let (store, piece, region) = store_with_region();
        let plan = plan(vec![item(1, piece, region, 8), item(2, piece, region, 6)]);
        store
            .session_plan_start(
                None,
                &payload("plan-live:1", 1, plan.clone()),
                MutationSource::UserClick,
                NOW,
            )
            .expect("first item opens");
        // A distinct command id for the next item, but a block is already live.
        let err = store
            .session_plan_start(
                None,
                &payload("plan-live:2", 2, plan),
                MutationSource::UserClick,
                "2026-07-16T12:05:00Z",
            )
            .unwrap_err();
        assert!(err.to_string().contains("close the current block first"));
        // No partial writes: still exactly one block and one start receipt.
        assert_eq!(active_sets(&store), 1);
        assert_eq!(blocks(&store), 1);
        assert_eq!(start_receipts(&store), 1);
    }

    #[test]
    fn progression_starts_the_next_item_after_the_prior_closes_and_replays_safely() {
        let (store, piece, region) = store_with_region();
        let plan = plan(vec![item(1, piece, region, 8), item(2, piece, region, 6)]);
        let first = store
            .session_plan_start(
                None,
                &payload("plan-prog:1", 1, plan.clone()),
                MutationSource::UserClick,
                NOW,
            )
            .expect("first item opens");
        let first_block = first.value.unwrap().block_id;
        let session_id = first.session_id.expect("committed session");

        // Close item 1's live set, then item 2 can start.
        store
            .v2_close(
                session_id,
                first_block,
                MutationSource::UserClick,
                "close-plan-prog-1",
                "2026-07-16T12:05:00Z",
            )
            .expect("closes first block");
        assert_eq!(active_sets(&store), 0);

        let second = store
            .session_plan_start(
                None,
                &payload("plan-prog:2", 2, plan.clone()),
                MutationSource::UserClick,
                "2026-07-16T12:06:00Z",
            )
            .expect("second item opens");
        assert!(!second.replayed);
        let second_block = second.value.unwrap().block_id;
        assert_ne!(second_block, first_block);
        assert_eq!(active_sets(&store), 1);
        assert_eq!(blocks(&store), 2);
        assert_eq!(start_receipts(&store), 2);

        // Replaying the second start returns the committed block, opens nothing.
        let replay = store
            .session_plan_start(
                None,
                &payload("plan-prog:2", 2, plan),
                MutationSource::UserClick,
                "2026-07-16T12:07:00Z",
            )
            .expect("replayed second start");
        assert!(replay.replayed);
        assert_eq!(replay.value.unwrap().block_id, second_block);
        assert_eq!(blocks(&store), 2);
        assert_eq!(start_receipts(&store), 2);
    }

    #[test]
    fn rejects_an_empty_plan_and_a_missing_start_sequence() {
        let (store, piece, region) = store_with_region();
        let empty = store
            .session_plan_start(
                None,
                &payload("plan-empty:1", 1, plan(vec![])),
                MutationSource::UserClick,
                NOW,
            )
            .unwrap_err();
        assert!(empty.to_string().contains("at least one reviewed item"));

        let missing = store
            .session_plan_start(
                None,
                &payload("plan-missing:1", 9, plan(vec![item(1, piece, region, 8)])),
                MutationSource::UserClick,
                NOW,
            )
            .unwrap_err();
        assert!(missing
            .to_string()
            .contains("no item at the requested sequence"));
        assert_eq!(blocks(&store), 0);
    }

    #[test]
    fn the_reviewed_draft_wire_shape_deserializes_and_denies_unknown_fields() {
        let json = serde_json::json!({
            "command_id": "plan-x:1",
            "start_sequence": 1,
            "plan": {
                "mode": "reviewed_session_draft",
                "available_minutes": 20,
                "allocated_minutes": 8,
                "unallocated_minutes": 12,
                "sequence": [{
                    "sequence": 1,
                    "candidate_id": "retention:7",
                    "piece_ref": "1",
                    "target_ref": "3",
                    "kind": "due_retention",
                    "piece_label": "Scherzo",
                    "target_label": "Development leap",
                    "allocated_minutes": 8,
                    "estimated_minutes": 4,
                    "rationale": "Confirm the leap is still reliable.",
                    "editable_minutes": { "min": 1, "max": 30 },
                    "provenance": {
                        "candidate_ids": ["retention:7"],
                        "evidence_ids": ["retention-check:7"],
                        "source_refs": [
                            { "source_type": "retention_check", "source_id": "7" }
                        ]
                    }
                }],
                "excluded_candidate_ids": [],
                "source_draft_issues": []
            }
        });
        let parsed: SessionPlanStartPayload =
            serde_json::from_value(json.clone()).expect("reviewed draft deserializes");
        assert_eq!(parsed.start_sequence, 1);
        assert_eq!(parsed.plan.sequence[0].target_ref, "3");

        let mut with_extra = json;
        with_extra["plan"]["surprise"] = serde_json::json!(true);
        assert!(serde_json::from_value::<SessionPlanStartPayload>(with_extra).is_err());
    }
}
