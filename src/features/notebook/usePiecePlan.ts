import { useMemo } from "react";
import { defineCommand, executeCommand } from "../../services/command";
import {
  useAutosavedDocument,
  type AutosavedDocument,
} from "./useAutosavedDocument";
import type { PiecePlan } from "./lines";

// The piece plan: the fully-editable long-term "arch" schedule per piece (spec
// item 10 / C2). Plain text (≤40000 chars). `piece_plan_save` RETURNS the
// canonical PiecePlan; the editor reconciles its text from `body_text`. Debounced
// saves + save receipts, immediate flush on blur/unmount, honest error states.

const PIECE_PLAN_GET = defineCommand<{ pieceId: number }, PiecePlan | null>(
  "piece_plan_get",
  "The piece plan could not be opened.",
);
const PIECE_PLAN_SAVE = defineCommand<
  { pieceId: number; bodyText: string },
  PiecePlan
>("piece_plan_save", "The piece plan could not be saved.");

export interface UsePiecePlan {
  bodyText: string;
  setBodyText: (next: string | ((prev: string) => string)) => void;
  status: AutosavedDocument<string>["status"];
  error: string | null;
  saving: boolean;
  updatedAt: string | null;
  /** Persist a pending edit immediately (blur handler). */
  flush: () => void;
}

export function usePiecePlan(pieceId: number): UsePiecePlan {
  const config = useMemo(
    () => ({
      key: pieceId,
      empty: "",
      savedMessage: "Saved.",
      loadErrorFallback: "The piece plan could not be opened.",
      saveErrorFallback: "The piece plan could not be saved.",
      load: async () => {
        const plan = await executeCommand(PIECE_PLAN_GET, { pieceId });
        return plan
          ? { value: plan.body_text, updatedAt: plan.updated_at }
          : null;
      },
      save: async (bodyText: string) => {
        const saved = await executeCommand(PIECE_PLAN_SAVE, {
          pieceId,
          bodyText,
        });
        return { value: saved.body_text, updatedAt: saved.updated_at };
      },
    }),
    [pieceId],
  );

  const doc = useAutosavedDocument(config);
  return {
    bodyText: doc.value,
    setBodyText: doc.setValue,
    status: doc.status,
    error: doc.error,
    saving: doc.saving,
    updatedAt: doc.updatedAt,
    flush: doc.flush,
  };
}
