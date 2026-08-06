import {
  defineCommand,
  executeCommand,
  type CommandInvoker,
} from "../../services/command";
import { createCommandId } from "../../services/commandId";
import type { MutationReceipt } from "../receipts/ReceiptCenter";

/**
 * Task A4: one row of the paused-sets tray. Field names and types mirror the
 * Rust `PausedSetRow` (src-tauri/src/store/model.rs) exactly — no camelCase
 * translation, same convention as `RepSnapshot`.
 */
export interface PausedSetRow {
  readonly set_id: number;
  readonly block_id: number;
  readonly piece_id: number;
  readonly piece_title: string;
  readonly m_start: number;
  readonly m_end: number;
  readonly bpm: number;
  readonly target_bpm: number;
  readonly paused_since_ts: string;
  readonly current_clean_streak: number;
}

const SETS_PAUSED_LIST = defineCommand<undefined, PausedSetRow[]>(
  "sets_paused_list",
  "The paused sets could not be loaded.",
);

export function listPausedSets(
  invoker?: CommandInvoker,
): Promise<PausedSetRow[]> {
  return executeCommand(SETS_PAUSED_LIST, undefined, invoker);
}

// The tray resumes a paused set through the SAME `rep_resume` command the
// rep HUD uses (lib.rs) — there is intentionally no set-scoped resume
// command, only an optional `setId` argument on the existing one (Task A4b).
// Before A4b the backend's single-live-set invariant meant at most one set
// could ever be paused at a time, so "resume" with no target was
// unambiguous; A4b relaxed that to one-ACTIVE-set (plural paused), so the
// tray now always passes the specific row's `set_id` it wants resumed. If
// some OTHER set is currently active, the backend auto-pauses it and
// activates this one atomically — the returned receipt's summary reflects
// both transitions.
//
// `rep_resume` resolves business rejections as a `MutationReceipt` with
// `status: "rejected"` rather than throwing (lib.rs's `rejected_snapshot`) —
// the caller MUST check `receipt.status` before treating the mutation as a
// success, exactly like `useRetention.ts`/`useRep.ts`'s
// `runSnapshotReceiptMutation` already do. A thrown/rejected PROMISE (network
// failure, command not found, etc.) is a separate, orthogonal failure mode
// and still surfaces as a rejected promise here.
const REP_RESUME = defineCommand<
  { commandId: string; setId: number },
  MutationReceipt
>("rep_resume", "The practice timer could not be resumed.");

export function resumePausedSet(
  setId: number,
  invoker?: CommandInvoker,
): Promise<MutationReceipt> {
  const commandId = createCommandId("paused-tray-resume");
  return executeCommand(REP_RESUME, { commandId, setId }, invoker);
}
