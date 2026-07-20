import { useEffect, useRef, useState } from "react";
import {
  validateNaturalPracticeActionDraft,
  type NaturalPracticeActionDraft,
  type PracticeHands,
} from "./domain/actionDraft";
import type { ProposedAction } from "./domain/proposedAction";
import "./ActionDraftCard.css";

/** Draft shapes the card can render: the editable Lane-B set form, or a slim
 *  confirm card for a Brain-proposed spoken action. */
export type ActionDraft = NaturalPracticeActionDraft | ProposedAction;

interface ActionDraftCardProps {
  draft: ActionDraft;
  onConfirm: (draft: ActionDraft) => Promise<void> | void;
  onCancel: () => void;
  /** Editable set cards report their latest validated value so a spoken
   * confirmation and the visible button always confirm the same draft. */
  onDraftChange?: (draft: NaturalPracticeActionDraft) => void;
  confirming?: boolean;
  /** Slim cards only: when set, the action cannot run right now (e.g. a verdict
   *  with no active set). The card explains why and offers no Confirm. */
  unavailableReason?: string | null;
}

const SLIM_TITLES: Record<ProposedAction["kind"], string> = {
  verdict: "Record a verdict",
  tempo: "Change the tempo",
  undo: "Undo the last rep",
  restart: "Restart the streak",
};

/**
 * Router. The existing editable form owns `start_practice_set`; each spoken
 * Brain proposal renders a slim, single-Confirm card. Neither writes: only the
 * explicit Confirm reaches the parent, which maps it to one existing command.
 */
export function ActionDraftCard({
  draft,
  onConfirm,
  onCancel,
  onDraftChange,
  confirming = false,
  unavailableReason = null,
}: ActionDraftCardProps) {
  if (draft.kind === "start_practice_set") {
    return (
      <NaturalPracticeDraftCard
        draft={draft}
        onConfirm={onConfirm}
        onCancel={onCancel}
        onDraftChange={onDraftChange}
        confirming={confirming}
      />
    );
  }
  return (
    <ProposedActionSlimCard
      draft={draft}
      onConfirm={onConfirm}
      onCancel={onCancel}
      confirming={confirming}
      unavailableReason={unavailableReason}
    />
  );
}

function ProposedActionSlimCard({
  draft,
  onConfirm,
  onCancel,
  confirming,
  unavailableReason,
}: {
  draft: ProposedAction;
  onConfirm: (draft: ActionDraft) => Promise<void> | void;
  onCancel: () => void;
  confirming: boolean;
  unavailableReason: string | null;
}) {
  return (
    <section
      className="voice-action-draft voice-action-draft-slim"
      aria-labelledby="voice-proposed-action-title"
    >
      <header>
        <div>
          <p>Action draft · nothing changed</p>
          <h2 id="voice-proposed-action-title">{SLIM_TITLES[draft.kind]}</h2>
        </div>
        <span>{unavailableReason ? "Unavailable" : "Confirm"}</span>
      </header>

      <p className="voice-action-draft-summary">{draft.summary}</p>

      {unavailableReason && (
        <p className="voice-action-draft-unavailable" role="note">
          {unavailableReason}
        </p>
      )}

      <footer>
        <button type="button" onClick={onCancel} disabled={confirming}>
          Cancel
        </button>
        {!unavailableReason && (
          <button
            type="button"
            className="is-confirm"
            disabled={confirming}
            onClick={() => void onConfirm(draft)}
          >
            {confirming ? "Working…" : "Confirm"}
          </button>
        )}
      </footer>
      <small>
        Nothing changes until you confirm. This runs one existing command.
      </small>
    </section>
  );
}

function optionalInteger(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : Number.NaN;
}

function revalidate(
  next: NaturalPracticeActionDraft,
): NaturalPracticeActionDraft {
  const issues = validateNaturalPracticeActionDraft(next);
  return {
    ...next,
    issues,
    status: issues.length === 0 ? "ready_to_confirm" : "needs_input",
  };
}

/**
 * Lane-B action preview. It owns editable draft state, but cannot write. The
 * parent is the only place allowed to translate a confirmed draft into IPC.
 */
function NaturalPracticeDraftCard({
  draft,
  onConfirm,
  onCancel,
  onDraftChange,
  confirming = false,
}: {
  draft: NaturalPracticeActionDraft;
  onConfirm: (draft: ActionDraft) => Promise<void> | void;
  onCancel: () => void;
  onDraftChange?: (draft: NaturalPracticeActionDraft) => void;
  confirming?: boolean;
}) {
  const [value, setValue] = useState(() => revalidate(draft));
  const onDraftChangeRef = useRef(onDraftChange);

  useEffect(() => {
    onDraftChangeRef.current = onDraftChange;
  }, [onDraftChange]);

  useEffect(() => {
    const next = revalidate(draft);
    setValue(next);
    onDraftChangeRef.current?.(next);
  }, [draft]);

  const update = (
    updater: (
      current: NaturalPracticeActionDraft,
    ) => NaturalPracticeActionDraft,
  ) =>
    setValue((current) => {
      const next = revalidate(updater(current));
      onDraftChangeRef.current?.(next);
      return next;
    });

  const updateContract = (
    patch: Partial<NaturalPracticeActionDraft["contract"]>,
  ) =>
    update((current) => ({
      ...current,
      contract: { ...current.contract, ...patch },
    }));

  return (
    <section
      className="voice-action-draft"
      aria-labelledby="voice-action-draft-title"
    >
      <header>
        <div>
          <p>Action draft · nothing changed</p>
          <h2 id="voice-action-draft-title">Review the spoken set.</h2>
        </div>
        <span>
          {value.status === "ready_to_confirm" ? "Ready" : "Needs input"}
        </span>
      </header>

      <blockquote>{value.source_text}</blockquote>

      <div className="voice-action-draft-context">
        <span>Piece</span>
        <strong>{value.piece_title ?? "Choose a piece in Atlas"}</strong>
      </div>

      <div className="voice-action-draft-grid">
        <fieldset>
          <legend>Score target</legend>
          <label>
            <span>From measure</span>
            <input
              aria-label="Draft start measure"
              type="number"
              min="1"
              value={
                Number.isFinite(value.target.m_start)
                  ? (value.target.m_start ?? "")
                  : ""
              }
              onChange={(event) =>
                update((current) => ({
                  ...current,
                  target: {
                    ...current.target,
                    m_start: optionalInteger(event.target.value),
                  },
                }))
              }
            />
          </label>
          <label>
            <span>To measure</span>
            <input
              aria-label="Draft end measure"
              type="number"
              min="1"
              value={
                Number.isFinite(value.target.m_end)
                  ? (value.target.m_end ?? "")
                  : ""
              }
              onChange={(event) =>
                update((current) => ({
                  ...current,
                  target: {
                    ...current.target,
                    m_end: optionalInteger(event.target.value),
                  },
                }))
              }
            />
          </label>
        </fieldset>

        <fieldset>
          <legend>Tempo contract</legend>
          <label>
            <span>Start BPM</span>
            <input
              aria-label="Draft start BPM"
              type="number"
              min="20"
              max="300"
              value={
                Number.isFinite(value.contract.start_bpm)
                  ? (value.contract.start_bpm ?? "")
                  : ""
              }
              onChange={(event) =>
                updateContract({
                  start_bpm: optionalInteger(event.target.value),
                })
              }
            />
          </label>
          <label>
            <span>Target BPM</span>
            <input
              aria-label="Draft target BPM"
              type="number"
              min="20"
              max="300"
              value={
                Number.isFinite(value.contract.target_bpm)
                  ? (value.contract.target_bpm ?? "")
                  : ""
              }
              onChange={(event) =>
                updateContract({
                  target_bpm: optionalInteger(event.target.value),
                })
              }
            />
          </label>
        </fieldset>

        <label>
          <span>Attempt boundary</span>
          <input
            aria-label="Draft planned attempts"
            type="number"
            min="1"
            max="100"
            value={
              Number.isFinite(value.contract.planned_attempts)
                ? (value.contract.planned_attempts ?? "")
                : ""
            }
            onChange={(event) =>
              updateContract({
                planned_attempts: optionalInteger(event.target.value),
              })
            }
          />
        </label>

        <label>
          <span>Clean in a row</span>
          <input
            aria-label="Draft clean streak target"
            type="number"
            min="1"
            max="100"
            value={value.contract.required_clean_streak}
            onChange={(event) =>
              updateContract({
                required_clean_streak: optionalInteger(event.target.value) ?? 0,
              })
            }
          />
        </label>

        <label>
          <span>Hands</span>
          <select
            aria-label="Draft hands"
            value={value.contract.hands ?? ""}
            onChange={(event) =>
              updateContract({
                hands: (event.target.value || null) as PracticeHands | null,
              })
            }
          >
            <option value="">Not specified</option>
            <option value="left">Left hand</option>
            <option value="right">Right hand</option>
            <option value="together">Hands together</option>
            <option value="separate">Hands separate</option>
          </select>
        </label>

        <label>
          <span>Method</span>
          <select
            aria-label="Draft method"
            value={value.contract.method ?? ""}
            onChange={(event) =>
              updateContract({ method: event.target.value || null })
            }
          >
            <option value="">Not specified</option>
            <option value="tempo ladder">Tempo ladder</option>
            <option value="rhythmic variants">Rhythmic variants</option>
            <option value="blocked practice">Blocked practice</option>
            <option value="silent fingering">Silent fingering</option>
            <option value="backward chaining">Backward chaining</option>
          </select>
        </label>
      </div>

      {value.issues.length > 0 && (
        <ul className="voice-action-draft-issues" aria-label="Draft issues">
          {value.issues.map((entry) => (
            <li key={entry.code}>{entry.message}</li>
          ))}
        </ul>
      )}

      <footer>
        <button type="button" onClick={onCancel} disabled={confirming}>
          Cancel
        </button>
        <button
          type="button"
          className="is-confirm"
          disabled={confirming || value.issues.length > 0}
          onClick={() => void onConfirm(value)}
        >
          {confirming ? "Starting…" : "Start this set"}
        </button>
      </footer>
      <small>
        Confirmation writes one audited set. You can undo or restart it
        afterward.
      </small>
    </section>
  );
}
