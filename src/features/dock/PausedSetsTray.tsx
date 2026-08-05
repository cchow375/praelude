import { useCallback, useEffect, useRef, useState } from "react";
import { DockPanel } from "./DockPanel";
import { useDock } from "./DockProvider";
import {
  listPausedSets,
  resumePausedSet,
  type PausedSetRow,
} from "../rep/pausedSets";
import { commandErrorMessage } from "../../services/command";
import type { MutationReceipt } from "../receipts/ReceiptCenter";
import { Button } from "../../ui";
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

/** Below the rep counter's default spot so both can be open at once without
 * overlapping on first launch. */
const DEFAULT_POSITION = { x: 24, y: 340 };

export interface PausedSetsTrayProps {
  /** The rep engine's own `set_state`, so the tray refetches on the
   * active<->paused transition instead of polling. */
  repSetState: string | null | undefined;
}

/**
 * Task A4: the paused-sets tray — every set currently sitting in
 * `set_contract.set_state='paused'` (backend: `sets_paused_list`), with a
 * Resume button per row. Resuming goes through the same `rep_resume`
 * command the rep HUD's own Pause/Resume toggle uses; this panel adds no new
 * write path, only a read surface plus the existing mutation.
 */
export function PausedSetsTray({ repSetState }: PausedSetsTrayProps) {
  const dock = useDock("paused");
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
      const receipt = await resumePausedSet();
      // `rep_resume` resolves business rejections as a receipt rather than
      // throwing — only a COMMITTED receipt means the set actually resumed.
      // A rejected/confirmation-required receipt leaves the row in place and
      // surfaces the receipt's own message, matching useRetention.ts.
      if (receipt.status !== "committed") {
        setError(receiptError(receipt));
        return;
      }
      setRows((current) => current.filter((r) => r.set_id !== row.set_id));
      setError(null);
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
