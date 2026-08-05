import {
  defineCommand,
  executeCommand,
  type CommandInvoker,
} from "../../services/command";
import { createCommandId } from "../../services/commandId";

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
// rep HUD uses (lib.rs:684) — there is intentionally no set-scoped resume
// command. The backend's single-live-set invariant means at most one set can
// ever be paused at a time, and it is always the engine's own tracked block,
// so "resume" (with no target id) is unambiguous.
const REP_RESUME = defineCommand<{ commandId: string }, unknown>(
  "rep_resume",
  "The practice timer could not be resumed.",
);

export function resumePausedSet(invoker?: CommandInvoker): Promise<unknown> {
  const commandId = createCommandId("paused-tray-resume");
  return executeCommand(REP_RESUME, { commandId }, invoker);
}
