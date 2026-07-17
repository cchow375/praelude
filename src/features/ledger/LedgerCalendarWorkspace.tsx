import { useState } from "react";
import { LedgerWorkspace } from "./LedgerWorkspace";
import { CalendarWorkspace } from "../calendar/CalendarWorkspace";
import { PiecesPanel } from "../pieces/PiecesPanel";
import type { RepOpenArgs, RepSnapshot } from "../rep/useRep";
import "./LedgerCalendarWorkspace.css";

type Surface = "ledger" | "calendar" | "pieces";

const SURFACES: { id: Surface; label: string }[] = [
  { id: "ledger", label: "Ledger" },
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
}: LedgerCalendarWorkspaceProps = {}) {
  const [surface, setSurface] = useState<Surface>("ledger");

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
              role="tab"
              aria-selected={selected}
              className={`ledger-calendar-tab${selected ? " is-active" : ""}`}
              onClick={() => setSurface(id)}
            >
              {label}
            </button>
          );
        })}
      </div>
      {surface === "ledger" ? (
        <LedgerWorkspace />
      ) : surface === "calendar" ? (
        <CalendarWorkspace />
      ) : (
        <PiecesPanel
          onOpenBlock={onOpenBlock ?? (async () => {})}
          activeRep={activeRep}
          defaultCleanStreak={defaultCleanStreak}
        />
      )}
    </div>
  );
}
