import { invoke } from "@tauri-apps/api/core";
import type { WarmupApi, WarmupRoutine, WarmupSystemPiece } from "./types";

export const nativeWarmupApi: WarmupApi = {
  listRoutines: () => invoke<WarmupRoutine[]>("warmup_routines_list"),
  saveRoutine: (input) =>
    invoke<WarmupRoutine>("warmup_routine_save", { input }),
  deleteRoutine: (id) => invoke<void>("warmup_routine_delete", { id }),
  systemPiece: () => invoke<WarmupSystemPiece>("warmup_system_piece"),
};
