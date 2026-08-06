import { useCallback, useEffect, useRef, useState } from "react";
import { DockPanel } from "./DockPanel";
import { useDock } from "./DockProvider";
import {
  listPausedSets,
  resumePausedSet,
  type PausedSetRow,
} from "../rep/pausedSets";
import { commandErrorMessage } from "../../services/command";
import { useReceipts, type MutationReceipt } from "../receipts/ReceiptCenter";
import type { RepSnapshot } from "../rep/useRep";
import { Button } from "../../ui";
import { NAV_RAIL_WIDTH } from "./dockState";
import {
  ASSUMED_MAX_HEIGHT as REP_ASSUMED_MAX_HEIGHT,
  DEFAULT_POSITION as REP_DEFAULT_POSITION,
} from "./RepPanel";
import "./dock.css";

/** Mirrors `useRetention.ts`'s `receiptError` — a rejected receipt carries its
 * own message; never fall back to a generic string while one is available. */
function receiptError(receipt: MutationReceipt): string {
  return (
    receipt.error_detail?.trim() ||
    receipt.summary?.trim() ||
    "The set could not be resumed."
  );
}

/** Fix wave item 9: derived from the rep panel's own default position + its
 * documented assumed-max-height ceiling (RepPanel.tsx), plus a gap, so an
 * auto-opened rep panel and a manually-opened tray never start stacked on
 * top of each other at the 720x520 floor — see dockDefaultLayout.test.ts.
 * `x` clears the nav rail the same way the rep panel's own default does. */
export const DEFAULT_POSITION = {
  x: NAV_RAIL_WIDTH + 12,
  y: REP_DEFAULT_POSITION.y + REP_ASSUMED_MAX_HEIGHT + 24,
};

/** Fix wave item 9: same spirit as RepPanel's `ASSUMED_MAX_HEIGHT` — a
 * documented ceiling (not a measurement) for the tray's own rendered height,
 * so the clock panel's default can in turn clear IT. */
export const ASSUMED_MAX_HEIGHT = 140;

export interface PausedSetsTrayProps {
  /** The rep engine's own `set_state`, so the tray refetches on the
   * active<->paused transition instead of polling. */
  repSetState: string | null | undefined;
  /** Fix wave item 10: `useRep()`'s own apply seam (its `applySnapshot`
   * under the hood) — a committed resume's snapshot goes through this SAME
   * path so the rep panel updates immediately instead of showing a stale
   * "· paused" state until an unrelated event refreshes it. */
  applyExternalReceipt: (receipt: MutationReceipt<RepSnapshot>) => void;
}

/**
 * Task A4: the paused-sets tray — every set currently sitting in
 * `set_contract.set_state='paused'` (backend: `sets_paused_list`), with a
 * Resume button per row. Resuming goes through the same `rep_resume`
 * command the rep HUD's own Pause/Resume toggle uses; this panel adds no new
 * write path, only a read surface plus the existing mutation.
 */
export function PausedSetsTray({
  repSetState,
  applyExternalReceipt,
}: PausedSetsTrayProps) {
  const dock = useDock("paused");
  const receipts = useReceipts();
  const [rows, setRows] = useState<PausedSetRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busySetId, setBusySetId] = useState<number | null>(null);
  const hadRows = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const next = await listPausedSets();
      // Defensive: an unmocked/stubbed backend (e.g. other suites' own Tauri
      // mocks that were not written with this command in mind) can resolve
      // with `null`/`undefined` rather than rejecting. Never let that reach
      // `rows.length` downstream.
      setRows(Array.isArray(next) ? next : []);
      setError(null);
    } catch (cause) {
      setError(
        commandErrorMessage(cause, "The paused sets could not be loaded."),
      );
    }
  }, []);

  // Loads once on mount, then refetches on every active<->paused transition
  // — pausing or resuming a set from the rep panel changes what this tray
  // must show.
  useEffect(() => {
    void refresh();
  }, [refresh, repSetState]);

  // Auto-open the very first time a paused set appears, same pattern as
  // RepPanel's active-transition open — never re-opens a tray the pianist
  // minimized while a paused set is still sitting there.
  useEffect(() => {
    if (rows.length > 0 && !hadRows.current) {
      dock.open();
    }
    hadRows.current = rows.length > 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length]);

  const handleResume = async (row: PausedSetRow) => {
    if (busySetId != null) return;
    setBusySetId(row.set_id);
    try {
      const receipt = await resumePausedSet(row.set_id);
      // `rep_resume` resolves business rejections as a receipt rather than
      // throwing — only a COMMITTED receipt means the set actually resumed.
      // A rejected/confirmation-required receipt leaves the row in place and
      // surfaces the receipt's own message, matching useRetention.ts.
      if (receipt.status !== "committed") {
        setError(receiptError(receipt));
        return;
      }
      setError(null);
      // Task A4b fix round 1: a committed resume may have auto-paused a
      // DIFFERENT set (`Store::v2_resume`'s atomic auto-pause-then-resume) —
      // that set's transition never touches `repSetState` (THIS engine's own
      // focus goes active -> active), so the mount/repSetState effect above
      // never refetches on its own. Refetch explicitly so a newly
      // auto-paused set appears, and surface the receipt's
      // "Paused X · Resumed Y" summary through the established ReceiptCenter
      // surface (same idiom as `useRep.ts`'s own `receipts.mutation` calls)
      // — the local `role="alert"` region above stays reserved for
      // rejections, not committed summaries.
      receipts.mutation(receipt);
      // Fix wave item 10: this resume's committed snapshot IS the rep
      // engine's new state (it becomes the active set) — apply it through
      // the same seam the rep HUD's own mutations use so the panel reflects
      // "active"/Pause immediately, not the stale "· paused"/Resume it was
      // showing before this click.
      applyExternalReceipt(receipt);
      void refresh();
    } catch (cause) {
      setError(commandErrorMessage(cause, "The set could not be resumed."));
    } finally {
      setBusySetId(null);
    }
  };

  return (
    <DockPanel
      id="paused"
      title="Paused Sets"
      defaultPosition={DEFAULT_POSITION}
    >
      {error && (
        <p className="dock-empty-state" role="alert">
          {error}
        </p>
      )}
      {rows.length === 0 ? (
        <p className="dock-empty-state">No paused sets</p>
      ) : (
        <ul className="paused-sets-list">
          {rows.map((row) => (
            <li key={row.set_id} className="paused-sets-row">
              <div className="paused-sets-row-info">
                <span className="paused-sets-row-piece">{row.piece_title}</span>
                <span className="paused-sets-row-range">
                  {row.m_start === row.m_end
                    ? `m. ${row.m_start}`
                    : `mm. ${row.m_start}–${row.m_end}`}
                  {" · "}
                  {row.bpm} → {row.target_bpm} bpm
                </span>
              </div>
              <Button
                type="button"
                variant="text"
                disabled={busySetId != null}
                onClick={() => void handleResume(row)}
              >
                {busySetId === row.set_id ? "Resuming…" : "Resume"}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </DockPanel>
  );
}
