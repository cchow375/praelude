import { invoke } from "@tauri-apps/api/core";
import type { Goal, PieceSummary } from "../pieces/types";
import { daySheetsRange, historyDays } from "../ledger/historyDays";
import type {
  CalendarApi,
  DailyWork,
  DailyWorkCreateArgs,
  DailyWorkPatch,
  RecoveryApplyResult,
  RecoveryDecision,
  RecoveryPreview,
} from "./types";

/** Thin, injectable IPC boundary. All dates are local Gregorian YYYY-MM-DD strings. */
export const calendarApi: CalendarApi = {
  list: ({ from, to, pieceId }) =>
    invoke<DailyWork[]>("daily_work_list", { from, to, pieceId }),
  create: (args: DailyWorkCreateArgs) =>
    invoke<DailyWork>("daily_work_create", { args }),
  update: (id: number, expectedUpdatedTs: string, patch: DailyWorkPatch) =>
    invoke<DailyWork>("daily_work_update", { id, expectedUpdatedTs, patch }),
  delete: (id: number, expectedUpdatedTs: string) =>
    invoke<void>("daily_work_delete", { id, expectedUpdatedTs }),
  recoveryPreview: () => invoke<RecoveryPreview>("recovery_preview"),
  recoveryApply: (decisions: RecoveryDecision[]) =>
    invoke<RecoveryApplyResult>("recovery_apply", { decisions }),
  setCapacity: (minutes: number) =>
    invoke<void>("calendar_capacity_set", { minutes }),
  listPieces: () => invoke<PieceSummary[]>("pieces_list"),
  listGoals: (pieceId: number) => invoke<Goal[]>("goal_list", { pieceId }),
  historyDays: (from, to) => historyDays(from, to),
  daySheetsRange: (from, to) => daySheetsRange(from, to),
};
