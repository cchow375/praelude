export const DEFAULT_SESSION_MINUTES = 20;
export const MIN_SESSION_MINUTES = 5;
export const MAX_SESSION_MINUTES = 180;
export const DEFAULT_MAX_DRAFT_ITEMS = 5;
export const MAX_DRAFT_ITEMS = 6;

export type ComposerCandidateKind =
  | "due_retention"
  | "recent_failure"
  | "unresolved_target"
  | "planned_goal"
  | "planned_work";

export interface ComposerSourceRef {
  /** Caller-owned source namespace, for example `retention_check` or `goal`. */
  readonly source_type: string;
  /** Stable identifier in the caller-owned source. */
  readonly source_id: string;
}

export interface ComposerEvidence {
  readonly evidence_id: string;
  readonly evidence_type: string;
  readonly source_ref: ComposerSourceRef;
  /** ISO date or timestamp supplied by the caller. It is provenance, not inferred truth. */
  readonly observed_at?: string;
  readonly detail?: string;
}

/**
 * An explicit option supplied to the composer. The composer never discovers,
 * creates, or changes pieces, targets, attempts, mastery, goals, or checks.
 */
export interface ComposerCandidate {
  readonly id: string;
  readonly piece_ref: string;
  readonly target_ref: string;
  readonly kind: ComposerCandidateKind;
  /** Required for `due_retention`; the caller has already decided it is due. */
  readonly due_on?: string;
  /** Caller-owned ordering signal in the inclusive range 0–100. */
  readonly priority: number;
  readonly evidence: readonly ComposerEvidence[];
  readonly estimated_minutes: number;
  readonly piece_label?: string;
  readonly target_label?: string;
}

export interface ComposeSessionInput {
  /** Defaults to 20. Values above 180 are safely capped; values below 5 are invalid. */
  readonly available_minutes?: number;
  /** Defaults to 5 and is capped at 6 so the draft remains a small sequence. */
  readonly max_items?: number;
  readonly candidates: readonly ComposerCandidate[];
}

export type ComposerIssueCode =
  | "invalid_budget"
  | "budget_capped"
  | "budget_rounded"
  | "invalid_max_items"
  | "max_items_capped"
  | "max_items_rounded"
  | "invalid_candidate"
  | "duplicate_candidate_collapsed"
  | "conflicting_candidate_id"
  | "duplicate_target_consolidated";

export interface ComposerIssue {
  readonly code: ComposerIssueCode;
  readonly candidate_id?: string;
  readonly detail: string;
}

export interface DraftProvenance {
  /** Primary candidate first, followed by any same-target supporting candidates. */
  readonly candidate_ids: readonly string[];
  readonly evidence_ids: readonly string[];
  readonly source_refs: readonly ComposerSourceRef[];
}

export interface SessionDraftItem {
  readonly sequence: number;
  readonly candidate_id: string;
  readonly piece_ref: string;
  readonly target_ref: string;
  readonly kind: ComposerCandidateKind;
  readonly piece_label?: string;
  readonly target_label?: string;
  readonly allocated_minutes: number;
  readonly estimated_minutes: number;
  readonly rationale: string;
  /** UI may edit minutes inside these bounds before a separate start action. */
  readonly editable_minutes: {
    readonly min: 1;
    readonly max: number;
  };
  readonly provenance: DraftProvenance;
}

export interface SessionDraft {
  readonly status: "ready" | "empty" | "invalid";
  /** Makes the no-write-before-start boundary explicit at runtime and in types. */
  readonly mode: "draft_only";
  readonly write_operations: readonly [];
  readonly available_minutes: number;
  readonly allocated_minutes: number;
  readonly unallocated_minutes: number;
  readonly sequence: readonly SessionDraftItem[];
  readonly issues: readonly ComposerIssue[];
}
