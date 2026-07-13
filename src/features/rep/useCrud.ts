import { invoke } from "@tauri-apps/api/core";
import type {
  BlockHistory,
  Goal,
  Region,
  Rep,
} from "../pieces/types";

export type BlockPatch = Partial<{
  label: string | null;
  m_start: number;
  m_end: number;
  start_bpm: number | null;
  target_bpm: number | null;
  planned_reps: number;
  focus: string;
  use_metronome: boolean;
  region_id: number | null;
}>;

export function useCrud() {
  return {
    blockUpdate: (blockId: number, patch: BlockPatch) =>
      invoke<BlockHistory>("block_update", { blockId, patch }),
    blockDelete: (blockId: number) =>
      invoke<void>("block_delete", { blockId }),
    repsForBlock: (blockId: number) =>
      invoke<Rep[]>("reps_for_block", { blockId }),
    repUpdate: (repId: number, patch: Partial<Pick<Rep, "verdict" | "note">>) =>
      invoke<void>("rep_update", { repId, patch }),
    repDelete: (repId: number) => invoke<void>("rep_delete", { repId }),
    goalList: (pieceId: number) => invoke<Goal[]>("goal_list", { pieceId }),
    goalCreate: (args: {
      piece_id: number;
      text: string;
      kind: "big" | "sub";
      parent_goal_id: number | null;
      target_date: string | null;
    }) => invoke<Goal>("goal_create", { args }),
    goalUpdate: (id: number, patch: Partial<Pick<Goal, "text" | "done" | "target_date" | "parent_goal_id">>) =>
      invoke<Goal>("goal_update", { id, patch }),
    goalDelete: (id: number) => invoke<void>("goal_delete", { id }),
    goalReorder: (pieceId: number, orderedIds: number[]) =>
      invoke<void>("goal_reorder", { pieceId, orderedIds }),
    pieceFieldUpdate: (
      pieceId: number,
      patch: Partial<Pick<PieceFieldPatch, "current_state" | "deadline" | "target_tempo" | "notes">>,
    ) => invoke<void>("piece_field_update", { pieceId, patch }),
    regionList: (pieceId: number) => invoke<Region[]>("region_list", { pieceId }),
    regionCreate: (args: { piece_id: number; name: string; m_start: number; m_end: number; kind: string }) =>
      invoke<Region>("region_create", { args }),
    regionUpdate: (id: number, patch: Partial<Pick<Region, "name" | "m_start" | "m_end" | "kind" | "order" | "color" | "pdf_anchor">>) =>
      invoke<Region>("region_update", { id, patch }),
    regionDelete: (id: number) => invoke<void>("region_delete", { id }),
    regionMerge: (idKeep: number, idAbsorb: number) =>
      invoke<Region>("region_merge", { idKeep, idAbsorb }),
  };
}

interface PieceFieldPatch {
  current_state: string | null;
  deadline: string | null;
  target_tempo: number | null;
  notes: string | null;
}
