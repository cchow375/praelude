import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { LedgerWorkspace } from "./LedgerWorkspace";
import { HISTORY } from "../../shell/terms";
import { CalendarWorkspace } from "../calendar/CalendarWorkspace";
import { PiecesPanel } from "../pieces/PiecesPanel";
import type { RepOpenArgs, RepSnapshot } from "../rep/useRep";
import type { PracticeBrainContext } from "../brain/types";
import "./LedgerCalendarWorkspace.css";

export type LedgerSurface = "ledger" | "calendar" | "pieces";

const SURFACES: { id: LedgerSurface; label: string }[] = [
  { id: "ledger", label: HISTORY },
  { id: "calendar", label: "Calendar" },
  { id: "pieces", label: "Pieces" },
];

interface LedgerCalendarWorkspaceProps {
  /**
   * Opening a practice block is delegated up to the shell's rep engine so the
   * shell-level RepHud reflects it. When rendered standalone (tests) it falls
   * back to a no-op so the Pieces surface still mounts and browses.
   */
  onOpenBlock?: (args: RepOpenArgs) => Promise<void>;
  activeRep?: RepSnapshot | null;
  defaultCleanStreak?: number;
  requestedSurface?: LedgerSurface | null;
  requestedPieceId?: number | null;
  requestRevision?: number;
  onSurfaceChange?: (surface: LedgerSurface) => void;
  onPracticeContextChange?: (context: PracticeBrainContext | null) => void;
}

/**
 * The single shell slot the plan calls "Ledger/Calendar". Rather than inventing
 * a sixth top-level tab (the shell nav is fixed at five and asserts exactly
 * ["Today","Score","Brain","Ledger","Universe"]), the two history surfaces AND
 * the piece browser/intake/goals surface live here behind one quiet in-workspace
 * switch — active state is ink weight, never a filled pill. Only the chosen
 * surface is mounted, so none loads the others' IPC until selected.
 *
 * Mounting `PiecesPanel → PieceDetail` here is what makes the piece browser/scan
 * (pieces_scan/piece_get), the IntakeForm (piece_intake_save), the GoalsPanel
 * (goal_create/update/delete/reorder), and the ReferenceButtons (reference_open)
 * reachable again — the Phase 8.1 parity gaps.
 */
export function LedgerCalendarWorkspace({
  onOpenBlock,
  activeRep = null,
  defaultCleanStreak = 5,
  requestedSurface = null,
  requestedPieceId = null,
  requestRevision = 0,
  onSurfaceChange,
  onPracticeContextChange,
}: LedgerCalendarWorkspaceProps = {}) {
  const [surface, setSurface] = useState<LedgerSurface>(
    requestedSurface ?? "ledger",
  );
  const tabRefs = useRef<
    Partial<Record<LedgerSurface, HTMLButtonElement | null>>
  >({});

  useEffect(() => {
    if (requestedSurface) setSurface(requestedSurface);
  }, [requestedSurface]);

  useEffect(() => {
    if (surface !== "pieces") onPracticeContextChange?.(null);
  }, [onPracticeContextChange, surface]);

  useEffect(
    () => () => onPracticeContextChange?.(null),
    [onPracticeContextChange],
  );

  const activateSurface = (next: LedgerSurface, focus = false) => {
    setSurface(next);
    onSurfaceChange?.(next);
    if (focus) requestAnimationFrame(() => tabRefs.current[next]?.focus());
  };

  const onTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    current: LedgerSurface,
  ) => {
    const index = SURFACES.findIndex(({ id }) => id === current);
    let next: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown")
      next = (index + 1) % SURFACES.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp")
      next = (index - 1 + SURFACES.length) % SURFACES.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = SURFACES.length - 1;
    if (next == null) return;
    event.preventDefault();
    activateSurface(SURFACES[next].id, true);
  };

  return (
    <div className="ledger-calendar" data-testid="workspace-ledger">
      <div
        className="ledger-calendar-switch"
        role="tablist"
        aria-label="History surface"
      >
        {SURFACES.map(({ id, label }) => {
          const selected = surface === id;
          return (
            <button
              key={id}
              type="button"
              ref={(node) => {
                tabRefs.current[id] = node;
              }}
              role="tab"
              id={`history-tab-${id}`}
              aria-controls={`history-panel-${id}`}
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              className={`ledger-calendar-tab${selected ? " is-active" : ""}`}
              onClick={() => activateSurface(id)}
              onKeyDown={(event) => onTabKeyDown(event, id)}
            >
              {label}
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id={`history-panel-${surface}`}
        aria-labelledby={`history-tab-${surface}`}
      >
        {surface === "ledger" ? (
          <LedgerWorkspace
            requestedPieceId={requestedPieceId}
            requestRevision={requestRevision}
          />
        ) : surface === "calendar" ? (
          <CalendarWorkspace />
        ) : (
          <PiecesPanel
            onOpenBlock={onOpenBlock ?? (async () => {})}
            activeRep={activeRep}
            defaultCleanStreak={defaultCleanStreak}
            initialPieceId={requestedPieceId}
            onPracticeContextChange={onPracticeContextChange}
          />
        )}
      </div>
    </div>
  );
}
