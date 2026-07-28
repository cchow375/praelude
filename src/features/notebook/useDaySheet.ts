import { useMemo } from "react";
import { defineCommand, executeCommand } from "../../services/command";
import { todayLocal } from "../calendar/dates";
import { clearTodayPlan, readTodayPlan } from "../today/todayPlan";
import {
  useAutosavedDocument,
  type AutosavedDocument,
} from "./useAutosavedDocument";
import type { DaySheet, NotebookLine } from "./lines";

// The day sheet: one notebook page per calendar date (spec C1/C2). Body is an
// ordered NotebookLine[]. `day_sheet_save` TAKES a body_json STRING and RETURNS
// the canonical DaySheet (null optionals dropped, `checked` defaulted, unknown
// fields rejected) — the editor reconciles from that returned body. Blank each
// morning: a date the backend has no row for renders empty; there is no
// auto-carry-over.

const DAY_SHEET_GET = defineCommand<{ date: string }, DaySheet | null>(
  "day_sheet_get",
  "Today's page could not be opened.",
);
const DAY_SHEET_SAVE = defineCommand<
  { date: string; bodyJson: string },
  DaySheet
>("day_sheet_save", "Today's page could not be saved.");

export interface UseDaySheet {
  /** Ordered lines; edit through `setBody`. Reconciled from canonical on save. */
  body: NotebookLine[];
  setBody: (
    next: NotebookLine[] | ((prev: NotebookLine[]) => NotebookLine[]),
  ) => void;
  status: AutosavedDocument<NotebookLine[]>["status"];
  error: string | null;
  saving: boolean;
  updatedAt: string | null;
  /** Persist a pending edit immediately (blur handler). */
  flush: () => void;
}

export function useDaySheet(date: string): UseDaySheet {
  const config = useMemo(
    () => ({
      key: date,
      empty: [] as NotebookLine[],
      savedMessage: "Saved.",
      loadErrorFallback: "Today's page could not be opened.",
      saveErrorFallback: "Today's page could not be saved.",
      load: async () => {
        const sheet = await executeCommand(DAY_SHEET_GET, { date });
        if (sheet) return { value: sheet.body, updatedAt: sheet.updated_at };
        // One-time migration of the legacy localStorage todayPlan into the
        // sheet — only for today, only when the backend truly has no row yet,
        // only when a legacy value exists. Retire the legacy key on success so
        // it never runs twice; leave it intact if the seed save fails so the
        // next open can retry, and show a blank sheet meanwhile.
        if (date === todayLocal()) {
          const legacy = readTodayPlan(date).trim();
          if (legacy) {
            const seeded: NotebookLine[] = [{ type: "text", text: legacy }];
            try {
              const saved = await executeCommand(DAY_SHEET_SAVE, {
                date,
                bodyJson: JSON.stringify(seeded),
              });
              clearTodayPlan(date);
              return { value: saved.body, updatedAt: saved.updated_at };
            } catch {
              return null;
            }
          }
        }
        return null;
      },
      save: async (body: NotebookLine[]) => {
        const saved = await executeCommand(DAY_SHEET_SAVE, {
          date,
          bodyJson: JSON.stringify(body),
        });
        return { value: saved.body, updatedAt: saved.updated_at };
      },
    }),
    [date],
  );

  const doc = useAutosavedDocument(config);
  return {
    body: doc.value,
    setBody: doc.setValue,
    status: doc.status,
    error: doc.error,
    saving: doc.saving,
    updatedAt: doc.updatedAt,
    flush: doc.flush,
  };
}
