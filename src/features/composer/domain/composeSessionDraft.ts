import {
  DEFAULT_MAX_DRAFT_ITEMS,
  DEFAULT_SESSION_MINUTES,
  MAX_DRAFT_ITEMS,
  MAX_SESSION_MINUTES,
  MIN_SESSION_MINUTES,
  type ComposeSessionInput,
  type ComposerCandidate,
  type ComposerCandidateKind,
  type ComposerEvidence,
  type ComposerIssue,
  type ComposerSourceRef,
  type DraftProvenance,
  type SessionDraft,
  type SessionDraftItem,
} from "./models";

interface NormalizedCandidate extends ComposerCandidate {
  readonly evidence: readonly ComposerEvidence[];
}

interface ConsolidatedCandidate {
  readonly primary: NormalizedCandidate;
  readonly provenance: DraftProvenance;
}

const KIND_ORDER: Readonly<Record<ComposerCandidateKind, number>> = {
  due_retention: 0,
  recent_failure: 1,
  unresolved_target: 2,
  planned_goal: 3,
  planned_work: 4,
};

const KIND_RATIONALE: Readonly<Record<ComposerCandidateKind, string>> = {
  due_retention: "Due retention check",
  recent_failure: "Recently failed target",
  unresolved_target: "Unresolved target",
  planned_goal: "Planned goal",
  planned_work: "Planned work",
};

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isValidIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
  );
}

function normalizeRef(value: string): string {
  return value.trim();
}

function compareSourceRef(left: ComposerSourceRef, right: ComposerSourceRef): number {
  return (
    compareText(left.source_type, right.source_type)
    || compareText(left.source_id, right.source_id)
  );
}

function compareEvidence(left: ComposerEvidence, right: ComposerEvidence): number {
  return (
    compareText(left.evidence_id, right.evidence_id)
    || compareText(left.evidence_type, right.evidence_type)
    || compareSourceRef(left.source_ref, right.source_ref)
    || compareText(left.observed_at ?? "", right.observed_at ?? "")
    || compareText(left.detail ?? "", right.detail ?? "")
  );
}

function latestEvidence(candidate: NormalizedCandidate): string {
  return candidate.evidence.reduce(
    (latest, evidence) => (
      (evidence.observed_at ?? "") > latest ? evidence.observed_at ?? "" : latest
    ),
    "",
  );
}

function compareCandidate(
  left: NormalizedCandidate,
  right: NormalizedCandidate,
): number {
  const kind = KIND_ORDER[left.kind] - KIND_ORDER[right.kind];
  if (kind !== 0) return kind;

  if (left.kind === "due_retention" && right.kind === "due_retention") {
    const due = compareText(left.due_on ?? "", right.due_on ?? "");
    if (due !== 0) return due;
  }

  const priority = right.priority - left.priority;
  if (priority !== 0) return priority;

  if (left.kind === "recent_failure" && right.kind === "recent_failure") {
    const recency = compareText(latestEvidence(right), latestEvidence(left));
    if (recency !== 0) return recency;
  }

  return compareText(left.id, right.id);
}

function normalizeEvidence(evidence: ComposerEvidence): ComposerEvidence | null {
  const evidenceId = normalizeRef(evidence.evidence_id);
  const evidenceType = normalizeRef(evidence.evidence_type);
  const sourceType = normalizeRef(evidence.source_ref?.source_type ?? "");
  const sourceId = normalizeRef(evidence.source_ref?.source_id ?? "");
  if (!evidenceId || !evidenceType || !sourceType || !sourceId) return null;

  return {
    evidence_id: evidenceId,
    evidence_type: evidenceType,
    source_ref: { source_type: sourceType, source_id: sourceId },
    ...(evidence.observed_at === undefined
      ? {}
      : { observed_at: evidence.observed_at.trim() }),
    ...(evidence.detail === undefined ? {} : { detail: evidence.detail.trim() }),
  };
}

function normalizeCandidate(candidate: ComposerCandidate): NormalizedCandidate | null {
  const id = normalizeRef(candidate.id);
  const pieceRef = normalizeRef(candidate.piece_ref);
  const targetRef = normalizeRef(candidate.target_ref);
  if (!id || !pieceRef || !targetRef || !(candidate.kind in KIND_ORDER)) return null;
  if (
    !Number.isInteger(candidate.priority)
    || candidate.priority < 0
    || candidate.priority > 100
    || !Number.isInteger(candidate.estimated_minutes)
    || candidate.estimated_minutes < 1
  ) return null;
  if (
    candidate.kind === "due_retention"
    && (candidate.due_on === undefined || !isValidIsoDate(candidate.due_on))
  ) return null;
  if (!Array.isArray(candidate.evidence) || candidate.evidence.length === 0) return null;

  const evidence = candidate.evidence.map(normalizeEvidence);
  if (evidence.some((item) => item === null)) return null;
  const normalizedEvidence = (evidence as ComposerEvidence[]).sort(compareEvidence);

  return {
    id,
    piece_ref: pieceRef,
    target_ref: targetRef,
    kind: candidate.kind,
    ...(candidate.due_on === undefined ? {} : { due_on: candidate.due_on }),
    priority: candidate.priority,
    evidence: normalizedEvidence,
    estimated_minutes: candidate.estimated_minutes,
    ...(candidate.piece_label === undefined
      ? {}
      : { piece_label: candidate.piece_label.trim() }),
    ...(candidate.target_label === undefined
      ? {}
      : { target_label: candidate.target_label.trim() }),
  };
}

function fingerprintCandidate(candidate: NormalizedCandidate): string {
  return JSON.stringify(candidate);
}

function validateAndDeduplicate(
  candidates: readonly ComposerCandidate[],
  issues: ComposerIssue[],
): NormalizedCandidate[] {
  const byId = new Map<string, NormalizedCandidate[]>();

  for (const candidate of candidates) {
    const normalized = normalizeCandidate(candidate);
    if (!normalized) {
      issues.push({
        code: "invalid_candidate",
        candidate_id: typeof candidate?.id === "string" ? candidate.id : undefined,
        detail: "Candidate omitted: refs, kind, due date, priority, estimate, or evidence is invalid.",
      });
      continue;
    }
    const matches = byId.get(normalized.id) ?? [];
    matches.push(normalized);
    byId.set(normalized.id, matches);
  }

  const result: NormalizedCandidate[] = [];
  for (const id of [...byId.keys()].sort(compareText)) {
    const claims = byId.get(id) ?? [];
    const unique = new Map(claims.map((claim) => [fingerprintCandidate(claim), claim]));
    if (unique.size > 1) {
      issues.push({
        code: "conflicting_candidate_id",
        candidate_id: id,
        detail: "All claims for this stable candidate ID were omitted because they conflict.",
      });
      continue;
    }
    if (claims.length > 1) {
      issues.push({
        code: "duplicate_candidate_collapsed",
        candidate_id: id,
        detail: "Identical candidate copies were collapsed into one option.",
      });
    }
    const only = unique.values().next().value as NormalizedCandidate | undefined;
    if (only) result.push(only);
  }

  return result;
}

function uniqueSourceRefs(candidates: readonly NormalizedCandidate[]): ComposerSourceRef[] {
  const refs = new Map<string, ComposerSourceRef>();
  for (const candidate of candidates) {
    for (const evidence of candidate.evidence) {
      const ref = evidence.source_ref;
      refs.set(`${ref.source_type}\u0000${ref.source_id}`, { ...ref });
    }
  }
  return [...refs.values()].sort(compareSourceRef);
}

function consolidateTargets(
  candidates: readonly NormalizedCandidate[],
  issues: ComposerIssue[],
): ConsolidatedCandidate[] {
  const byTarget = new Map<string, NormalizedCandidate[]>();
  for (const candidate of candidates) {
    const key = `${candidate.piece_ref}\u0000${candidate.target_ref}`;
    const matches = byTarget.get(key) ?? [];
    matches.push(candidate);
    byTarget.set(key, matches);
  }

  const consolidated: ConsolidatedCandidate[] = [];
  for (const matches of byTarget.values()) {
    matches.sort(compareCandidate);
    const primary = matches[0];
    if (!primary) continue;
    if (matches.length > 1) {
      issues.push({
        code: "duplicate_target_consolidated",
        candidate_id: primary.id,
        detail: "Same-target options were consolidated; the strongest explicit reason is primary.",
      });
    }
    consolidated.push({
      primary,
      provenance: {
        candidate_ids: [primary.id, ...matches.slice(1).map((item) => item.id).sort(compareText)],
        evidence_ids: [...new Set(matches.flatMap((item) => item.evidence.map(
          (evidence) => evidence.evidence_id,
        )))].sort(compareText),
        source_refs: uniqueSourceRefs(matches),
      },
    });
  }

  return consolidated.sort((left, right) => compareCandidate(left.primary, right.primary));
}

function urgencyGroup(kind: ComposerCandidateKind): "retention" | "repair" | "planned" {
  if (kind === "due_retention") return "retention";
  if (kind === "recent_failure" || kind === "unresolved_target") return "repair";
  return "planned";
}

/**
 * Reserves one slot for each available urgency group before filling remaining
 * slots by rank. Retention still leads and receives spare slots, while repair
 * and planned work cannot be starved when the budget can hold all three.
 */
function chooseSequence(
  candidates: readonly ConsolidatedCandidate[],
  capacity: number,
): ConsolidatedCandidate[] {
  if (capacity <= 0) return [];
  const selected = new Set<string>();
  const result: ConsolidatedCandidate[] = [];

  for (const group of ["retention", "repair", "planned"] as const) {
    if (result.length >= capacity) break;
    const first = candidates.find((candidate) => (
      urgencyGroup(candidate.primary.kind) === group
      && !selected.has(candidate.primary.id)
    ));
    if (first) {
      result.push(first);
      selected.add(first.primary.id);
    }
  }

  for (const candidate of candidates) {
    if (result.length >= capacity) break;
    if (!selected.has(candidate.primary.id)) {
      result.push(candidate);
      selected.add(candidate.primary.id);
    }
  }

  return result.sort((left, right) => compareCandidate(left.primary, right.primary));
}

function allocateMinutes(
  selected: readonly ConsolidatedCandidate[],
  availableMinutes: number,
): number[] {
  const allocation = selected.map(() => 1);
  let remaining = availableMinutes - allocation.length;
  while (remaining > 0) {
    let changed = false;
    for (let index = 0; index < selected.length && remaining > 0; index += 1) {
      const cap = Math.min(selected[index].primary.estimated_minutes, MAX_SESSION_MINUTES);
      if (allocation[index] < cap) {
        allocation[index] += 1;
        remaining -= 1;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return allocation;
}

function rationaleFor(candidate: ConsolidatedCandidate): string {
  const primary = candidate.primary;
  const due = primary.kind === "due_retention" ? ` · due ${primary.due_on}` : "";
  const support = candidate.provenance.candidate_ids.length > 1
    ? ` · ${candidate.provenance.candidate_ids.length} explicit reasons`
    : "";
  return `${KIND_RATIONALE[primary.kind]}${due} · priority ${primary.priority}${support}`;
}

function normalizeBudget(
  requested: number | undefined,
  issues: ComposerIssue[],
): number | null {
  const raw = requested ?? DEFAULT_SESSION_MINUTES;
  if (!Number.isFinite(raw) || raw < MIN_SESSION_MINUTES) {
    issues.push({
      code: "invalid_budget",
      detail: `Session budget must be a finite number from ${MIN_SESSION_MINUTES} to ${MAX_SESSION_MINUTES} minutes.`,
    });
    return null;
  }
  let normalized = Math.floor(raw);
  if (normalized !== raw) {
    issues.push({ code: "budget_rounded", detail: `Session budget was rounded down to ${normalized} minutes.` });
  }
  if (normalized > MAX_SESSION_MINUTES) {
    normalized = MAX_SESSION_MINUTES;
    issues.push({ code: "budget_capped", detail: `Session budget was capped at ${MAX_SESSION_MINUTES} minutes.` });
  }
  return normalized;
}

function normalizeMaxItems(
  requested: number | undefined,
  issues: ComposerIssue[],
): number | null {
  const raw = requested ?? DEFAULT_MAX_DRAFT_ITEMS;
  if (!Number.isFinite(raw) || raw < 1) {
    issues.push({ code: "invalid_max_items", detail: "Draft item limit must be a positive finite number." });
    return null;
  }
  let normalized = Math.floor(raw);
  if (normalized !== raw) {
    issues.push({ code: "max_items_rounded", detail: `Draft item limit was rounded down to ${normalized}.` });
  }
  if (normalized > MAX_DRAFT_ITEMS) {
    normalized = MAX_DRAFT_ITEMS;
    issues.push({ code: "max_items_capped", detail: `Draft item limit was capped at ${MAX_DRAFT_ITEMS}.` });
  }
  return normalized;
}

/**
 * Build an editable, non-persisted routine from caller-supplied candidates.
 * This function is deterministic and side-effect-free. It does not expose a
 * start/save operation and cannot write practice facts.
 */
export function composeSessionDraft(input: ComposeSessionInput): SessionDraft {
  const issues: ComposerIssue[] = [];
  const availableMinutes = normalizeBudget(input.available_minutes, issues);
  const maxItems = normalizeMaxItems(input.max_items, issues);
  if (availableMinutes === null || maxItems === null) {
    return {
      status: "invalid",
      mode: "draft_only",
      write_operations: [],
      available_minutes: 0,
      allocated_minutes: 0,
      unallocated_minutes: 0,
      sequence: [],
      issues,
    };
  }

  const valid = validateAndDeduplicate(input.candidates, issues);
  const consolidated = consolidateTargets(valid, issues);
  const capacity = Math.min(maxItems, availableMinutes, consolidated.length);
  const selected = chooseSequence(consolidated, capacity);
  const allocations = allocateMinutes(selected, availableMinutes);

  const sequence: SessionDraftItem[] = selected.map((candidate, index) => ({
    sequence: index + 1,
    candidate_id: candidate.primary.id,
    piece_ref: candidate.primary.piece_ref,
    target_ref: candidate.primary.target_ref,
    kind: candidate.primary.kind,
    ...(candidate.primary.piece_label === undefined
      ? {}
      : { piece_label: candidate.primary.piece_label }),
    ...(candidate.primary.target_label === undefined
      ? {}
      : { target_label: candidate.primary.target_label }),
    allocated_minutes: allocations[index],
    estimated_minutes: candidate.primary.estimated_minutes,
    rationale: rationaleFor(candidate),
    editable_minutes: {
      min: 1,
      max: Math.min(candidate.primary.estimated_minutes, availableMinutes),
    },
    provenance: candidate.provenance,
  }));

  const allocatedMinutes = allocations.reduce((total, value) => total + value, 0);
  return {
    status: sequence.length > 0 ? "ready" : "empty",
    mode: "draft_only",
    write_operations: [],
    available_minutes: availableMinutes,
    allocated_minutes: allocatedMinutes,
    unallocated_minutes: availableMinutes - allocatedMinutes,
    sequence,
    issues,
  };
}
