import { invoke } from "@tauri-apps/api/core";
import type {
  BrainAnswer,
  BrainApi,
  BrainAskRequest,
  BrainIntakeApplyRequest,
  BrainIntakeApplyResult,
  BrainThreadResume,
  PlannerScheduleRequest,
  WorkSuggestion,
} from "./types";

/** Thin, injectable IPC boundary. No provider credentials ever reach React. */
export const brainApi: BrainApi = {
  ask: (request: BrainAskRequest) =>
    invoke<BrainAnswer>("brain_ask", { request }),
  applyIntakeReview: (request: BrainIntakeApplyRequest) =>
    invoke<BrainIntakeApplyResult>("brain_intake_apply", { request }),
  planPreview: (pieceId: number | null) =>
    invoke<WorkSuggestion[]>("brain_plan_preview", { pieceId }),
  resumeThread: (pieceId: number) =>
    invoke<BrainThreadResume>("brain_thread_resume", { pieceId }),
  clearThread: (pieceId: number) =>
    invoke<void>("brain_thread_clear", { pieceId }).then(() => undefined),
  schedule: (request: PlannerScheduleRequest) =>
    invoke("daily_work_create", {
      args: {
        goal_id: request.goal_id,
        region_id: null,
        block_id: null,
        title: request.title,
        minutes: request.minutes,
        date: request.date,
        source: "planner",
      },
    }).then(() => undefined),
};
