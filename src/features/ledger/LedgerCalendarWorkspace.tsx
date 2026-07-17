import { useState } from "react";
import { LedgerWorkspace } from "./LedgerWorkspace";
import { CalendarWorkspace } from "../calendar/CalendarWorkspace";
import "./LedgerCalendarWorkspace.css";

type Surface = "ledger" | "calendar";

const SURFACES: { id: Surface; label: string }[] = [
  { id: "ledger", label: "Ledger" },
  { id: "calendar", label: "Calendar" },
];

/**
 * The single shell slot the plan calls "Ledger/Calendar". Rather than inventing
 * a sixth top-level tab (the shell nav is fixed at five and asserts exactly
 * ["Today","Score","Brain","Ledger","Universe"]), both history surfaces live
 * here behind one quiet in-workspace switch — active state is ink weight, never
 * a filled pill. Only the chosen surface is mounted, so neither loads the
 * other's IPC until selected.
 */
export function LedgerCalendarWorkspace() {
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
      {surface === "ledger" ? <LedgerWorkspace /> : <CalendarWorkspace />}
    </div>
  );
}
