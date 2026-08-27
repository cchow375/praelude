import { invoke } from "@tauri-apps/api/core";
import { defineCommand, executeCommand } from "../../services/command";
import type { BlockHistory, Goal, Region, Rep } from "../pieces/types";

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

type RepHistoryPatch = Partial<Pick<Rep, "verdict" | "note">>;

const REP_HISTORY_UPDATE = defineCommand<
  { repId: number; patch: RepHistoryPatch },
  void
>("rep_update", "The attempt correction could not be saved.");

const REP_HISTORY_VOID = defineCommand<{ repId: number }, void>(
  "rep_delete",
  "The attempt could not be voided.",
);

export function useCrud() {
  return {
    blockUpdate: (blockId: number, patch: BlockPatch) =>
      invoke<BlockHistory>("block_update", { blockId, patch }),
    blockDelete: (blockId: number) => invoke<void>("block_delete", { blockId }),
    repsForBlock: (blockId: number) =>
      invoke<Rep[]>("reps_for_block", { blockId }),
    repUpdate: (repId: number, patch: RepHistoryPatch) =>
      executeCommand(REP_HISTORY_UPDATE, { repId, patch }),
    repDelete: (repId: number) => executeCommand(REP_HISTORY_VOID, { repId }),
    goalList: (pieceId: number) => invoke<Goal[]>("goal_list", { pieceId }),
    goalCreate: (args: {
      piece_id: number;
      text: string;
      kind: "big" | "sub";
      parent_goal_id: number | null;
      target_date: string | null;
    }) => invoke<Goal>("goal_create", { args }),
    goalUpdate: (
      id: number,
      patch: Partial<
        Pick<Goal, "text" | "done" | "target_date" | "parent_goal_id">
      >,
    ) => invoke<Goal>("goal_update", { id, patch }),
    goalDelete: (id: number) => invoke<void>("goal_delete", { id }),
    goalReorder: (pieceId: number, orderedIds: number[]) =>
      invoke<void>("goal_reorder", { pieceId, orderedIds }),
    pieceFieldUpdate: (
      pieceId: number,
      patch: Partial<
        Pick<
          PieceFieldPatch,
          "current_state" | "deadline" | "target_tempo" | "notes"
        >
      >,
    ) => invoke<void>("piece_field_update", { pieceId, patch }),
    regionList: (pieceId: number) =>
      invoke<Region[]>("region_list", { pieceId }),
    regionCreate: (args: {
      piece_id: number;
      name: string;
      notes: string | null;
      m_start: number;
      m_end: number;
      kind: string;
      /** Task C5: set to create this region as a one-level sub-section. */
      parent_region_id?: number | null;
    }) => {
      const { parent_region_id, ...rest } = args;
      return invoke<Region>("region_create", {
        args: rest,
        parent_region_id: parent_region_id ?? null,
      });
    },
    /** Create a complete score micro-target in one native transaction. */
    microTargetCreate: (args: {
      command_id: string;
      piece_id: number;
      parent_region_id: number;
      name: string;
      m_start: number;
      m_end: number;
      color: string | null;
      pdf_anchor: unknown;
    }) => invoke<Region>("score_micro_target_create", { args }),
    regionUpdate: (
      id: number,
      patch: Partial<
        Pick<
          Region,
          | "name"
          | "notes"
          | "m_start"
          | "m_end"
          | "kind"
          | "order"
          | "color"
          | "pdf_anchor"
        >
      >,
    ) => invoke<Region>("region_update", { id, patch }),
    /** Task C5: `mode` only matters when the region has children — "cascade"
     * deletes them too, "promote" clears their `parent_region_id` so they
     * survive as top-level regions. Defaults to "cascade" (the old
     * behavior, which any region with no children is identical under). */
    regionDelete: (id: number, mode: "cascade" | "promote" = "cascade") =>
      invoke<void>("region_delete", { id, mode }),
    regionMerge: (idKeep: number, idAbsorb: number) =>
      invoke<Region>("region_merge", { idKeep, idAbsorb }),
    regionSplit: (id: number, splitAt: number) =>
      invoke<Region[]>("region_split", { id, splitAt }),
  };
}

interface PieceFieldPatch {
  current_state: string | null;
  deadline: string | null;
  target_tempo: number | null;
  notes: string | null;
}
