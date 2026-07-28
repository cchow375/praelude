import { useEffect, useId, useMemo, useState } from "react";
import {
  composeSessionDraft,
  DEFAULT_SESSION_MINUTES,
  MAX_SESSION_MINUTES,
  MIN_SESSION_MINUTES,
  type ComposerCandidate,
  type ComposerCandidateKind,
  type SessionDraft,
  type SessionDraftItem,
} from "./domain";
import { Button } from "../../ui";
import "./SessionComposer.css";

export interface ReviewedSessionItem extends Omit<
  SessionDraftItem,
  "sequence" | "allocated_minutes"
> {
  readonly sequence: number;
  readonly allocated_minutes: number;
}

/**
 * Reviewed handoff only. This value contains no command identity, write
 * operation, attempt, or mastery claim; the owner decides how to start it.
 */
export interface ReviewedSessionDraft {
  readonly mode: "reviewed_session_draft";
  readonly available_minutes: number;
  readonly allocated_minutes: number;
  readonly unallocated_minutes: number;
  readonly sequence: readonly ReviewedSessionItem[];
  readonly excluded_candidate_ids: readonly string[];
  readonly source_draft_issues: SessionDraft["issues"];
}

export interface SessionComposerProps {
  readonly candidates: readonly ComposerCandidate[];
  readonly initialMinutes?: number;
  /** The component's sole outward action. It never invokes native code itself. */
  readonly onStartSession: (
    reviewedDraft: ReviewedSessionDraft,
  ) => void | Promise<void>;
}

interface ItemEdit {
  readonly included: boolean;
  readonly minutes: string;
}

interface BudgetValidation {
  readonly value: number | null;
  readonly message: string;
}

interface AllocationValidation {
  readonly values: ReadonlyMap<string, number>;
  readonly errors: ReadonlyMap<string, string>;
  readonly includedCount: number;
  readonly allocatedMinutes: number;
  readonly message: string;
}

const GROUP_LABEL: Readonly<Record<ComposerCandidateKind, string>> = {
  due_retention: "Retention",
  recent_failure: "Repair",
  unresolved_target: "Repair",
  planned_goal: "Planned",
  planned_work: "Planned",
};

function validateBudget(raw: string): BudgetValidation {
  if (raw.trim() === "") {
    return {
      value: null,
      message: "Enter a session length from 5 to 180 minutes.",
    };
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    return {
      value: null,
      message: "Session length must be a whole number of minutes.",
    };
  }
  if (value < MIN_SESSION_MINUTES || value > MAX_SESSION_MINUTES) {
    return {
      value: null,
      message: `Session length must be between ${MIN_SESSION_MINUTES} and ${MAX_SESSION_MINUTES} minutes.`,
    };
  }
  return { value, message: "" };
}

function initialEdits(draft: SessionDraft): Record<string, ItemEdit> {
  return Object.fromEntries(
    draft.sequence.map((item) => [
      item.candidate_id,
      { included: true, minutes: String(item.allocated_minutes) },
    ]),
  );
}

function currentEdit(
  edits: Readonly<Record<string, ItemEdit>>,
  item: SessionDraftItem,
): ItemEdit {
  return (
    edits[item.candidate_id] ?? {
      included: true,
      minutes: String(item.allocated_minutes),
    }
  );
}

function validateAllocations(
  draft: SessionDraft,
  edits: Readonly<Record<string, ItemEdit>>,
  budget: number | null,
): AllocationValidation {
  const values = new Map<string, number>();
  const errors = new Map<string, string>();
  let includedCount = 0;
  let allocatedMinutes = 0;

  for (const item of draft.sequence) {
    const edit = currentEdit(edits, item);
    if (!edit.included) continue;
    includedCount += 1;
    const minutes = Number(edit.minutes);
    if (
      edit.minutes.trim() === "" ||
      !Number.isFinite(minutes) ||
      !Number.isInteger(minutes)
    ) {
      errors.set(item.candidate_id, "Use a whole number of minutes.");
      continue;
    }
    if (
      minutes < item.editable_minutes.min ||
      minutes > item.editable_minutes.max
    ) {
      errors.set(
        item.candidate_id,
        `Use ${item.editable_minutes.min}–${item.editable_minutes.max} minutes for this target.`,
      );
      continue;
    }
    values.set(item.candidate_id, minutes);
    allocatedMinutes += minutes;
  }

  let message = "";
  if (budget === null) message = "Fix the session length before starting.";
  else if (draft.status !== "ready")
    message = "Add at least one valid explicit candidate.";
  else if (includedCount === 0)
    message = "Include at least one target before starting.";
  else if (errors.size > 0) message = "Fix the highlighted minute allocation.";
  else if (allocatedMinutes > budget) {
    message = `Allocated time exceeds the session by ${allocatedMinutes - budget} minute${allocatedMinutes - budget === 1 ? "" : "s"}.`;
  }

  return { values, errors, includedCount, allocatedMinutes, message };
}

function targetName(item: SessionDraftItem): string {
  return item.target_label?.trim() || `Target ${item.target_ref}`;
}

function pieceName(item: SessionDraftItem): string {
  return item.piece_label?.trim() || `Piece ${item.piece_ref}`;
}

function makeReviewedDraft(
  draft: SessionDraft,
  edits: Readonly<Record<string, ItemEdit>>,
  budget: number,
  validation: AllocationValidation,
): ReviewedSessionDraft {
  const included = draft.sequence.filter(
    (item) => currentEdit(edits, item).included,
  );
  const sequence = included.map((item, index): ReviewedSessionItem => ({
    ...item,
    sequence: index + 1,
    allocated_minutes: validation.values.get(item.candidate_id) as number,
  }));
  return {
    mode: "reviewed_session_draft",
    available_minutes: budget,
    allocated_minutes: validation.allocatedMinutes,
    unallocated_minutes: budget - validation.allocatedMinutes,
    sequence,
    excluded_candidate_ids: draft.sequence
      .filter((item) => !currentEdit(edits, item).included)
      .map((item) => item.candidate_id),
    source_draft_issues: draft.issues,
  };
}

export function SessionComposer({
  candidates,
  initialMinutes = DEFAULT_SESSION_MINUTES,
  onStartSession,
}: SessionComposerProps) {
  const instanceId = useId();
  const [budgetInput, setBudgetInput] = useState(String(initialMinutes));
  const budget = useMemo(() => validateBudget(budgetInput), [budgetInput]);
  const draftBudget = budget.value ?? DEFAULT_SESSION_MINUTES;
  const draft = useMemo(
    () =>
      composeSessionDraft({
        available_minutes: draftBudget,
        candidates,
      }),
    [candidates, draftBudget],
  );
  const [edits, setEdits] = useState<Record<string, ItemEdit>>(() =>
    initialEdits(draft),
  );
  const [startState, setStartState] = useState<
    "idle" | "starting" | "started" | "error"
  >("idle");
  const [startMessage, setStartMessage] = useState("");

  useEffect(() => {
    setEdits(initialEdits(draft));
    setStartState("idle");
    setStartMessage("");
  }, [draft]);

  const allocation = useMemo(
    () => validateAllocations(draft, edits, budget.value),
    [budget.value, draft, edits],
  );
  const canStart =
    budget.value !== null &&
    allocation.message === "" &&
    startState !== "starting" &&
    startState !== "started";
  const placedCandidateIds = useMemo(
    () =>
      new Set(draft.sequence.flatMap((item) => item.provenance.candidate_ids)),
    [draft],
  );
  const unplacedCount = candidates.filter(
    (candidate) => !placedCandidateIds.has(candidate.id.trim()),
  ).length;

  const updateItem = (candidateId: string, patch: Partial<ItemEdit>) => {
    setEdits((current) => ({
      ...current,
      [candidateId]: {
        ...(current[candidateId] ?? { included: true, minutes: "1" }),
        ...patch,
      },
    }));
    setStartState("idle");
    setStartMessage("");
  };

  const startSession = async () => {
    if (!canStart || budget.value === null) return;
    const reviewed = makeReviewedDraft(draft, edits, budget.value, allocation);
    setStartState("starting");
    setStartMessage("Handing the reviewed draft to the session owner…");
    try {
      await onStartSession(reviewed);
      setStartState("started");
      setStartMessage(
        `Start requested for ${reviewed.sequence.length} target${reviewed.sequence.length === 1 ? "" : "s"}; no practice fact was written by the composer.`,
      );
    } catch {
      setStartState("error");
      setStartMessage(
        "The session owner did not accept the start request. Nothing was written.",
      );
    }
  };

  const remaining =
    budget.value === null ? 0 : budget.value - allocation.allocatedMinutes;
  const validationMessage = budget.message || allocation.message;

  return (
    <section
      className="session-composer"
      aria-labelledby={`${instanceId}-title`}
    >
      <header className="session-composer__masthead">
        <div>
          <span className="session-composer__kicker">Session composer</span>
          <h2 id={`${instanceId}-title`}>Shape the next twenty minutes.</h2>
          <p>
            A deterministic draft from explicit retention, repair, and planned
            work. Review it before anything starts.
          </p>
        </div>

        <div className="session-composer__budget">
          <label htmlFor={`${instanceId}-budget`}>
            Session length in minutes
          </label>
          <div className="session-composer__budget-entry">
            <input
              id={`${instanceId}-budget`}
              type="number"
              min={MIN_SESSION_MINUTES}
              max={MAX_SESSION_MINUTES}
              step={1}
              inputMode="numeric"
              value={budgetInput}
              aria-invalid={budget.message !== ""}
              aria-describedby={`${instanceId}-budget-help ${instanceId}-validation`}
              onChange={(event) => {
                setBudgetInput(event.target.value);
                setStartState("idle");
                setStartMessage("");
              }}
            />
            <span aria-hidden="true">min</span>
          </div>
          <small id={`${instanceId}-budget-help`}>
            Whole minutes · 5–180 · default 20
          </small>
        </div>
      </header>

      <div
        id={`${instanceId}-validation`}
        className={`session-composer__validation${validationMessage ? " is-error" : ""}`}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {validationMessage ||
          `${allocation.allocatedMinutes} allocated · ${remaining} unallocated`}
      </div>

      {draft.issues.length > 0 && (
        <details className="session-composer__issues">
          <summary>
            {draft.issues.length} source note
            {draft.issues.length === 1 ? "" : "s"}
          </summary>
          <ul>
            {draft.issues.map((issue, index) => (
              <li
                key={`${issue.code}-${issue.candidate_id ?? "draft"}-${index}`}
              >
                {issue.detail}
              </li>
            ))}
          </ul>
        </details>
      )}

      {draft.sequence.length === 0 ? (
        <div className="session-composer__empty">
          <span aria-hidden="true">—</span>
          <p>
            No valid explicit candidates are available. The composer will not
            invent one.
          </p>
        </div>
      ) : (
        <ol
          className="session-composer__sequence"
          aria-label="Editable session sequence"
        >
          {draft.sequence.map((item) => {
            const edit = currentEdit(edits, item);
            const error = allocation.errors.get(item.candidate_id) ?? "";
            const checkboxId = `${instanceId}-include-${item.sequence}`;
            const minutesId = `${instanceId}-minutes-${item.sequence}`;
            const errorId = `${instanceId}-minutes-error-${item.sequence}`;
            const helpId = `${instanceId}-minutes-help-${item.sequence}`;
            const name = targetName(item);
            return (
              <li
                key={item.candidate_id}
                className={`session-composer__item ck-fit-reveal${edit.included ? "" : " is-excluded"}`}
                data-kind={item.kind}
              >
                <div className="session-composer__order" aria-hidden="true">
                  {String(item.sequence).padStart(2, "0")}
                </div>
                <div className="session-composer__item-main">
                  <div className="session-composer__item-heading">
                    <div>
                      <span className="session-composer__group">
                        {GROUP_LABEL[item.kind]}
                      </span>
                      <h3 className="ck-fit">{name}</h3>
                      <p className="ck-fit">{pieceName(item)}</p>
                    </div>
                    <label
                      className="session-composer__include"
                      htmlFor={checkboxId}
                    >
                      <input
                        id={checkboxId}
                        type="checkbox"
                        checked={edit.included}
                        onChange={(event) =>
                          updateItem(item.candidate_id, {
                            included: event.target.checked,
                          })
                        }
                      />
                      Include {name}
                    </label>
                  </div>

                  <p className="session-composer__rationale">
                    {item.rationale}
                  </p>

                  <details className="session-composer__provenance">
                    <summary>Why this target is here</summary>
                    <dl>
                      <div>
                        <dt>
                          Explicit candidate
                          {item.provenance.candidate_ids.length === 1
                            ? ""
                            : "s"}
                        </dt>
                        <dd>{item.provenance.candidate_ids.join(", ")}</dd>
                      </div>
                      <div>
                        <dt>Evidence</dt>
                        <dd>{item.provenance.evidence_ids.join(", ")}</dd>
                      </div>
                      <div>
                        <dt>
                          Source
                          {item.provenance.source_refs.length === 1 ? "" : "s"}
                        </dt>
                        <dd>
                          {item.provenance.source_refs
                            .map(
                              (source) =>
                                `${source.source_type}:${source.source_id}`,
                            )
                            .join(" · ")}
                        </dd>
                      </div>
                    </dl>
                  </details>
                </div>

                <div className="session-composer__minutes">
                  <label htmlFor={minutesId}>Minutes for {name}</label>
                  <input
                    id={minutesId}
                    type="number"
                    min={item.editable_minutes.min}
                    max={item.editable_minutes.max}
                    step={1}
                    inputMode="numeric"
                    value={edit.minutes}
                    disabled={!edit.included}
                    aria-invalid={error !== ""}
                    aria-describedby={`${helpId}${error ? ` ${errorId}` : ""}`}
                    onChange={(event) =>
                      updateItem(item.candidate_id, {
                        minutes: event.target.value,
                      })
                    }
                  />
                  <small id={helpId}>1–{item.editable_minutes.max} min</small>
                  {error && (
                    <span
                      id={errorId}
                      className="session-composer__field-error"
                    >
                      {error}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {unplacedCount > 0 && (
        <p className="session-composer__unplaced">
          {unplacedCount} explicit candidate
          {unplacedCount === 1 ? " was" : "s were"} not placed in this small
          draft. No substitute target was created.
        </p>
      )}

      <footer className="session-composer__footer">
        <div>
          <span>{allocation.includedCount} included</span>
          <strong>
            {allocation.allocatedMinutes} / {budget.value ?? "—"} min
          </strong>
          <span>
            {budget.value === null ? "—" : Math.max(0, remaining)} open
          </span>
        </div>
        <Button
          variant="primary"
          className="session-composer__start"
          disabled={!canStart}
          onClick={() => void startSession()}
        >
          {startState === "starting"
            ? "Starting session…"
            : startState === "started"
              ? "Session requested"
              : "Start Session"}
        </Button>
      </footer>

      <p
        className={`session-composer__start-status${startState === "error" ? " is-error" : ""}`}
        role={startState === "error" ? "alert" : "status"}
        aria-live={startState === "error" ? "assertive" : "polite"}
      >
        {startMessage}
      </p>
    </section>
  );
}
