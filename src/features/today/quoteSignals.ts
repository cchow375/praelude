import { useEffect, useRef, useState } from "react";
import { defineCommand, executeCommand } from "../../services/command";
import { addDays } from "../calendar/dates";
import { useTodaySheet } from "../notebook/DaySheetStore";
import type { DaySheet, NotebookLine } from "../notebook/lines";
import type { RepSnapshot } from "../rep/useRep";
import {
  NO_SIGNALS,
  type QuoteSignals,
  type RepVerdict,
} from "./quoteRotation";

/**
 * The impure half of home-quote selection: read what Christian is actually
 * doing, and hand a plain data bag to the pure scorer in `quoteRotation.ts`.
 *
 * Deliberately cheap. Today's sheet costs nothing (it is already in memory via
 * the shared store); yesterday's sheet is one indexed row; `rep_state` is an
 * in-memory read on the Rust side; the attempt rows are fetched only while a
 * set is actually open. Any of them may fail — a signal we could not read stays
 * `null`, which the scorer treats as "no evidence" rather than "no".
 */

const DAY_SHEET_GET = defineCommand<{ date: string }, DaySheet | null>(
  "day_sheet_get",
  "Yesterday's page could not be read.",
);
const REP_STATE = defineCommand<undefined, RepSnapshot | null>(
  "rep_state",
  "The current practice set could not be read.",
);

/** One attempt row, as `reps_for_block` serializes it (snake_case). */
export interface RepRow {
  id: number;
  ts: string;
  verdict: string;
  voided: boolean;
}

const REPS_FOR_BLOCK = defineCommand<{ blockId: number }, RepRow[]>(
  "reps_for_block",
  "The recent attempts could not be read.",
);

/** How many trailing attempts we hand to the scorer. */
const RECENT_VERDICTS = 3;

const VERDICTS = new Set<RepVerdict>(["clean", "flawed", "failed"]);

/** True when the sheet holds anything a person would call "written". */
export function sheetHasContent(body: readonly NotebookLine[]): boolean {
  return body.some((line) => {
    switch (line.type) {
      case "text":
      case "item":
      case "lesson_notes":
        return line.text.trim().length > 0;
      case "lesson_prep":
        return line.bring.length > 0 || line.want.trim().length > 0;
      default:
        return true;
    }
  });
}

/**
 * Newest-first effective verdicts. Voided attempts are dropped — they were
 * explicitly taken back, so calling them a rough run would be a lie — and rows
 * are ordered by id because `reps_for_block` returns insertion order.
 */
export function recentVerdicts(
  rows: readonly RepRow[],
  limit = RECENT_VERDICTS,
): RepVerdict[] {
  return rows
    .filter((row) => !row.voided && VERDICTS.has(row.verdict as RepVerdict))
    .sort((a, b) => b.id - a.id)
    .slice(0, limit)
    .map((row) => row.verdict as RepVerdict);
}

/** The native reads, injectable so the gatherer is testable without Tauri. */
export interface QuoteSignalApi {
  daySheet(date: string): Promise<DaySheet | null>;
  repState(): Promise<RepSnapshot | null>;
  repsForBlock(blockId: number): Promise<RepRow[]>;
}

const nativeApi: QuoteSignalApi = {
  daySheet: (date) => executeCommand(DAY_SHEET_GET, { date }),
  repState: () => executeCommand(REP_STATE, undefined),
  repsForBlock: (blockId) => executeCommand(REPS_FOR_BLOCK, { blockId }),
};

export interface GatherInput {
  /** Today's sheet, straight from the shared in-memory store. */
  readonly todaySheet: readonly NotebookLine[] | null;
  readonly now: Date;
  readonly api: QuoteSignalApi;
}

/**
 * Read every signal, tolerating failure on each independently. Always resolves
 * — a backend that is missing entirely yields `NO_SIGNALS`, and the quote strip
 * falls back to the plain rotation with no connector line.
 */
export async function gatherQuoteSignals({
  todaySheet,
  now,
  api,
}: GatherInput): Promise<QuoteSignals> {
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  const [yesterday, snap] = await Promise.all([
    api.daySheet(addDays(date, -1)).catch(() => undefined),
    api.repState().catch(() => undefined),
  ]);

  let verdicts: RepVerdict[] = [];
  if (snap != null) {
    const rows = await api.repsForBlock(snap.block_id).catch(() => undefined);
    if (rows != null) verdicts = recentVerdicts(rows);
  }

  return {
    date,
    hour: now.getHours(),
    daySheetWritten: todaySheet == null ? null : sheetHasContent(todaySheet),
    yesterdaySheetWritten:
      yesterday === undefined ? null : sheetHasContent(yesterday?.body ?? []),
    setOpen: snap === undefined ? null : snap != null,
    recentVerdicts: verdicts,
  };
}

/**
 * Gather once per mount of the menu. `ready` gates the pick: choosing on
 * half-read signals and then re-choosing when the rest land would swap the
 * quote out from under the reader, so the strip waits for the whole bag.
 */
export function useQuoteSignals(api: QuoteSignalApi = nativeApi): {
  signals: QuoteSignals;
  ready: boolean;
} {
  const sheet = useTodaySheet();
  // "loading" means wait; "error" means the body we hold is the empty default,
  // NOT an empty page — reporting that as a blank sheet would be a lie.
  const sheetStatus = sheet.status;
  const [state, setState] = useState<{
    signals: QuoteSignals;
    ready: boolean;
  }>({ signals: NO_SIGNALS, ready: false });

  // The sheet body changes on every keystroke; only its loaded-ness may retrigger.
  const bodyRef = useRef(sheet.body);
  bodyRef.current = sheet.body;

  useEffect(() => {
    if (sheetStatus === "loading") return;
    let alive = true;
    void gatherQuoteSignals({
      todaySheet: sheetStatus === "ready" ? bodyRef.current : null,
      now: new Date(),
      api,
    }).then((signals) => {
      if (alive) setState({ signals, ready: true });
    });
    return () => {
      alive = false;
    };
  }, [api, sheetStatus]);

  return state;
}
