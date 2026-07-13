import { invoke } from "@tauri-apps/api/core";
import type {
  BrainAnswer,
  BrainApi,
  BrainAskRequest,
  BrainIntakeApplyRequest,
  BrainIntakeApplyResult,
} from "./types";

/** Thin, injectable IPC boundary. No provider credentials ever reach React. */
export const brainApi: BrainApi = {
  ask: (request: BrainAskRequest) =>
    invoke<BrainAnswer>("brain_ask", { request }),
  applyIntakeReview: (request: BrainIntakeApplyRequest) =>
    invoke<BrainIntakeApplyResult>("brain_intake_apply", { request }),
};
