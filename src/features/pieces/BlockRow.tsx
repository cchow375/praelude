import { useEffect, useRef, useState } from "react";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { EditableField } from "../../components/EditableField";
import { commandErrorMessage } from "../../services/command";
import { useReceipts } from "../receipts/ReceiptCenter";
import { useCrud } from "../rep/useCrud";
import type { BlockHistory, Rep } from "./types";

interface BlockRowProps {
  block: BlockHistory;
  onChanged: () => void;
  regions?: { id: number; name: string }[];
}

const VERDICT_LABEL: Record<Rep["verdict"], string> = {
  clean: "Clean",
  flawed: "Sloppy",
  failed: "Again",
};

function plainLabel(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter: string) => letter.toUpperCase());
}

function attemptSourceLabel(source: string | undefined): string {
  switch (source) {
    case "user_click":
      return "button";
    case "voice_hot_loop":
      return "voice";
    case "voice_draft":
      return "voice draft";
    case "brain_draft":
      return "Brain draft";
    case "import_review":
      return "reviewed import";
    case "migration_legacy":
      return "legacy import";
    case "system_schedule":
      return "system";
    default:
      return source ? plainLabel(source).toLocaleLowerCase() : "unknown source";
  }
}

function contractSourceLabel(source: string): string {
  switch (source) {
    case "migration_legacy":
      return "legacy migration";
    case "user_click":
      return "set setup";
    case "system_schedule":
      return "scheduled contract";
    default:
      return plainLabel(source);
  }
}

function attemptLineage(rep: Rep): string {
  const original = rep.original_verdict ?? rep.verdict;
  const changes = rep.active_adjustment_ids?.length ?? 0;
  const changeSuffix = changes > 1 ? ` · ${changes} active changes` : "";
  if (rep.voided) return `Voided · excluded from totals${changeSuffix}`;
  if (original !== rep.verdict) {
    return `Corrected from ${VERDICT_LABEL[original]} to ${VERDICT_LABEL[rep.verdict]}${changeSuffix}`;
  }
  if (changes > 0)
    return `Corrected · ${changes} active ${changes === 1 ? "change" : "changes"}`;
  return "Original verdict";
}

export function BlockRow({ block, onChanged, regions = [] }: BlockRowProps) {
  const crud = useCrud();
  const receipts = useReceipts();
  const [expanded, setExpanded] = useState(false);
  const [reps, setReps] = useState<Rep[]>([]);
  const [busyRep, setBusyRep] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const expandedRef = useRef(false);
  const attemptRequest = useRef(0);
  const attempts = block.attempts_recorded ?? block.tries ?? block.reps_done;
  const masteryVerified =
    block.mastery_verified === true &&
    block.mastery_status !== "unverified_legacy";
  const masterySatisfied =
    masteryVerified && block.mastery_status === "satisfied";
  const masteryTarget =
    block.effective_required_clean_streak ?? block.required_clean_streak;
  const range =
    block.m_start === block.m_end
      ? `measure ${block.m_start}`
      : `measures ${block.m_start}–${block.m_end}`;
  const region = regions.find((candidate) => candidate.id === block.region_id);
  const tempoStart = block.start_bpm;
  const tempoEnd = block.bpm;
  const tempoPath =
    tempoStart == null && tempoEnd == null
      ? null
      : tempoStart != null && tempoEnd != null && tempoStart !== tempoEnd
        ? `♩ ${tempoStart} → ${tempoEnd}`
        : `♩ ${tempoEnd ?? tempoStart}`;
  const contractText =
    masteryVerified && masteryTarget != null
      ? `${masteryTarget} consecutive clean ${masteryTarget === 1 ? "attempt" : "attempts"}`
      : "Legacy record · mastery contract unverified";
  const reviewText =
    block.attempt_ceiling !== undefined
      ? block.attempt_ceiling == null
        ? "No attempt review boundary"
        : `Review after ${block.attempt_ceiling} attempts · not mastery`
      : block.planned_reps > 0
        ? `Legacy review count: ${block.planned_reps} attempts · not mastery`
        : "Legacy review boundary unavailable";
  const sourceText = block.contract_source
    ? contractSourceLabel(block.contract_source)
    : masteryVerified
      ? "source not supplied"
      : "legacy source not captured";

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      attemptRequest.current += 1;
    };
  }, []);

  async function loadReps() {
    const opening = !expanded;
    expandedRef.current = opening;
    const generation = ++attemptRequest.current;
    setExpanded(opening);
    if (!opening) return;
    setError(null);
    try {
      const next = (await crud.repsForBlock(block.block_id)) ?? [];
      if (
        mounted.current &&
        expandedRef.current &&
        attemptRequest.current === generation
      )
        setReps(next);
    } catch (reason) {
      if (mounted.current && attemptRequest.current === generation) {
        setError(
          commandErrorMessage(reason, "The attempts could not be loaded."),
        );
      }
    }
  }

  async function refreshReps() {
    if (!mounted.current || !expandedRef.current) return;
    const generation = ++attemptRequest.current;
    const next = (await crud.repsForBlock(block.block_id)) ?? [];
    if (
      mounted.current &&
      expandedRef.current &&
      attemptRequest.current === generation
    )
      setReps(next);
  }

  // The set TITLE is editable metadata (rename a mislabeled set) — never an
  // attempt. Attempts stay append-only; only this human label routes through
  // block_update. EditableField rolls its display back if the save rejects.
  async function saveTitle(nextLabel: string) {
    const label = nextLabel.trim() ? nextLabel.trim() : null;
    if (mounted.current) setError(null);
    try {
      await crud.blockUpdate(block.block_id, { label });
    } catch (reason) {
      receipts.error(reason, "The set title could not be saved.");
      if (mounted.current) {
        setError(
          commandErrorMessage(reason, "The set title could not be saved."),
        );
      }
      throw reason;
    }
    receipts.committed("Set title saved.");
    onChanged();
  }

  async function mutateRep(
    repId: number,
    committedMessage: string,
    fallbackError: string,
    action: () => Promise<unknown>,
  ) {
    if (mounted.current) {
      setError(null);
      setBusyRep(repId);
    }
    try {
      await action();
    } catch (reason) {
      receipts.error(reason, fallbackError);
      if (mounted.current) {
        setError(commandErrorMessage(reason, fallbackError));
        setBusyRep(null);
      }
      throw reason;
    }

    receipts.committed(committedMessage);
    onChanged();
    try {
      await refreshReps();
    } catch (reason) {
      const refreshError =
        "The attempt saved, but practice history could not be refreshed.";
      receipts.error(reason, refreshError);
      if (mounted.current) setError(commandErrorMessage(reason, refreshError));
    } finally {
      if (mounted.current) setBusyRep(null);
    }
  }

  return (
    <article className="history-block" aria-label={`Practice set for ${range}`}>
      <div className="history-block-summary">
        <button
          type="button"
          className="history-disclosure"
          aria-label={`${expanded ? "Collapse" : "Expand"} attempts for ${range}${block.label ? `, ${block.label}` : ""}`}
          aria-expanded={expanded}
          onClick={() => void loadReps()}
        >
          {expanded ? "▾" : "▸"}
        </button>
        <span className="history-range">
          {block.m_start === block.m_end
            ? `m. ${block.m_start}`
            : `mm. ${block.m_start}–${block.m_end}`}
        </span>
        <span className="history-block-label">
          <EditableField
            value={block.label ?? ""}
            placeholder="Name this set"
            ariaLabel="set title"
            onSave={saveTitle}
          />
        </span>
        {(block.focus === "tempo" || block.use_metronome) && (
          <span className="history-tempo">
            {tempoPath ?? "Tempo not captured"}
          </span>
        )}
        <span className="history-count">
          {attempts} attempt{attempts === 1 ? "" : "s"}
        </span>
        <span
          className={`history-mastery ${masterySatisfied ? "is-mastered" : masteryVerified ? "is-pending" : "is-unverified"}`}
        >
          {masterySatisfied
            ? "Mastery verified"
            : masteryVerified
              ? "Mastery not yet"
              : "Legacy · mastery unverified"}
        </span>
        <span className="history-verdicts" aria-label="Verdict counts">
          <span className="is-clean">{block.verdicts.clean}</span>
          <span className="is-flawed">{block.verdicts.flawed}</span>
          <span className="is-failed">{block.verdicts.failed}</span>
        </span>
      </div>

      <div
        className="history-block-controls"
        aria-label="Captured set contract"
      >
        <span>
          <strong>Focus</strong> {plainLabel(block.focus)}
        </span>
        <span>{block.use_metronome ? "Metronome on" : "Metronome off"}</span>
        <span>
          <strong>Captured contract</strong> {contractText}
        </span>
        <span>{reviewText}</span>
        <span>
          <strong>Contract source</strong> {sourceText}
        </span>
        {region && (
          <span>
            <strong>Section</strong> {region.name}
          </span>
        )}
      </div>

      {expanded && (
        <ul className="history-reps">
          {reps.length === 0 ? (
            <li className="history-empty">No attempts logged.</li>
          ) : (
            reps.map((rep, index) => {
              const ordinal = index + 1;
              const isBusy = busyRep === rep.id;
              const showTempo =
                (block.focus === "tempo" || block.use_metronome) &&
                rep.bpm != null;
              return (
                <li
                  key={rep.id}
                  className={`history-rep ${rep.voided ? "is-voided" : ""}`}
                >
                  <span className="history-rep-index">{ordinal}</span>
                  {rep.voided ? (
                    <span className={`history-rep-verdict is-${rep.verdict}`}>
                      {VERDICT_LABEL[rep.verdict]}
                    </span>
                  ) : (
                    <select
                      aria-label={`Attempt ${ordinal} verdict`}
                      value={rep.verdict}
                      disabled={isBusy}
                      onChange={(event) => {
                        const verdict = event.target.value as Rep["verdict"];
                        void mutateRep(
                          rep.id,
                          `Attempt ${ordinal} verdict correction saved.`,
                          "The attempt correction could not be saved.",
                          () => crud.repUpdate(rep.id, { verdict }),
                        ).catch(() => undefined);
                      }}
                    >
                      <option value="clean">Clean</option>
                      <option value="flawed">Sloppy</option>
                      <option value="failed">Again</option>
                    </select>
                  )}
                  <span className="history-rep-bpm">
                    {showTempo ? `♩ ${rep.bpm}` : plainLabel(block.focus)}
                  </span>
                  <span className="history-rep-source">
                    Logged by {attemptSourceLabel(rep.source)}
                  </span>
                  <span className="history-rep-lineage">
                    {attemptLineage(rep)}
                  </span>
                  {rep.voided ? (
                    <span className="history-rep-note">
                      {rep.note || "No note"}
                    </span>
                  ) : (
                    <EditableField
                      value={rep.note ?? ""}
                      placeholder="Add note"
                      ariaLabel={`Attempt ${ordinal} note`}
                      onSave={(note) =>
                        mutateRep(
                          rep.id,
                          `Attempt ${ordinal} note correction saved.`,
                          "The attempt correction could not be saved.",
                          () => crud.repUpdate(rep.id, { note: note || null }),
                        )
                      }
                    />
                  )}
                  {!rep.voided && (
                    <ConfirmDelete
                      label="Void this attempt? The original stays in the ledger and the set projection will be recalculated."
                      onConfirm={() =>
                        mutateRep(
                          rep.id,
                          `Attempt ${ordinal} voided. The original remains in the ledger.`,
                          "The attempt could not be voided.",
                          () => crud.repDelete(rep.id),
                        )
                      }
                    >
                      <button
                        type="button"
                        className="history-delete"
                        disabled={isBusy}
                        aria-label={`Void attempt ${ordinal}`}
                      >
                        ×
                      </button>
                    </ConfirmDelete>
                  )}
                </li>
              );
            })
          )}
        </ul>
      )}
      {error && (
        <p className="ck-inline-error" role="alert">
          {error}
        </p>
      )}
    </article>
  );
}
