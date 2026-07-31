import { useEffect, useMemo, useRef, useState } from "react";
import { defineCommand, executeCommand } from "../../services/command";
import { addDays } from "../calendar/dates";
import { useTodaySheet } from "../notebook/DaySheetStore";
import type { DaySheet, NotebookLine } from "../notebook/lines";
import type { RepSnapshot } from "../rep/useRep";
import { QUOTES, type Quote } from "../../content/quotes";
import {
  connectorFor,
  contextKey,
  deriveCues,
  NO_SIGNALS,
  resolveHomeQuote,
  type QuoteCue,
  type QuoteSignals,
  type QuoteStore,
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
 *
 * FRESHNESS IS THE WHOLE POINT (D1). The strip prints a line claiming why the
 * quote is on screen, so every fact behind it has to be a fact NOW:
 *   · today's page is read straight out of the shared in-memory store on every
 *     render, so the moment Christian types a line "before you write today's
 *     page" stops being derivable — no round-trip, no remount needed;
 *   · everything that lives behind IPC (yesterday's page, the open set's
 *     verdicts, and the clock itself) is re-read on a timer, so a run of reps
 *     logged in the practice window cannot leave a claim about "your last three
 *     reps" standing after those reps stopped being the last three.
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
 * True when today's page carries a lesson-prep line with something in it. An
 * empty prep line is a heading he has not filled in yet, and treating that as
 * "a lesson is coming" would put a claim on screen the page does not support.
 */
export function sheetHasLessonPrep(body: readonly NotebookLine[]): boolean {
  return body.some(
    (line) =>
      line.type === "lesson_prep" &&
      (line.bring.length > 0 || line.want.trim().length > 0),
  );
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
    lessonPrep: todaySheet == null ? null : sheetHasLessonPrep(todaySheet),
    yesterdaySheetWritten:
      yesterday === undefined ? null : sheetHasContent(yesterday?.body ?? []),
    recentVerdicts: verdicts,
  };
}

/**
 * How often the IPC-backed half of the signals is re-read. Two indexed reads a
 * minute is nothing next to a claim that has gone stale on screen.
 */
export const SIGNAL_REFRESH_MS = 60_000;

/** What `useQuoteSignals` hands to `useHomeQuote`. */
export interface LiveQuoteSignals {
  readonly signals: QuoteSignals;
  /** False until the first full read lands — the strip waits rather than guess. */
  readonly ready: boolean;
  /** ms stamp of the last backend read. A change is the "re-evaluate" pulse. */
  readonly readAt: number;
}

/**
 * The live signal bag. `ready` gates the pick: choosing on half-read signals and
 * then re-choosing when the rest land would swap the quote out from under the
 * reader, so the strip waits for the whole bag.
 *
 * Today's-page facts are NOT taken from the last gather — they are recomputed
 * from the shared store on every render, because they are already in memory and
 * they are the ones that change while the menu is on screen.
 *
 * `api` must be a stable reference (the default module-level `nativeApi` is);
 * a fresh object per render would re-run the IPC reads on every render.
 */
export function useQuoteSignals(
  api: QuoteSignalApi = nativeApi,
  refreshMs = SIGNAL_REFRESH_MS,
): LiveQuoteSignals {
  const sheet = useTodaySheet();
  // "loading" means wait; "error" means the body we hold is the empty default,
  // NOT an empty page — reporting that as a blank sheet would be a lie.
  const sheetStatus = sheet.status;
  const [read, setRead] = useState<{
    signals: QuoteSignals;
    ready: boolean;
    readAt: number;
  }>({ signals: NO_SIGNALS, ready: false, readAt: 0 });

  // The sheet body changes on every keystroke; only its loaded-ness may
  // retrigger the IPC reads (the page's own facts are derived below instead).
  const bodyRef = useRef(sheet.body);
  bodyRef.current = sheet.body;

  useEffect(() => {
    if (sheetStatus === "loading") return;
    let alive = true;
    const readAll = () => {
      void gatherQuoteSignals({
        todaySheet: sheetStatus === "ready" ? bodyRef.current : null,
        now: new Date(),
        api,
      }).then((signals) => {
        if (alive) setRead({ signals, ready: true, readAt: Date.now() });
      });
    };
    readAll();
    const timer = setInterval(readAll, refreshMs);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [api, sheetStatus, refreshMs]);

  const body = sheet.body;
  const written = sheetStatus === "ready" ? sheetHasContent(body) : null;
  const lessonPrep = sheetStatus === "ready" ? sheetHasLessonPrep(body) : null;

  const signals = useMemo(
    () => ({ ...read.signals, daySheetWritten: written, lessonPrep }),
    [read.signals, written, lessonPrep],
  );

  return { signals, ready: read.ready, readAt: read.readAt };
}

// ---------------------------------------------------------------------------
// The strip's own state
// ---------------------------------------------------------------------------

/** localStorage, or null where it is unavailable (private mode, a test env). */
function browserQuoteStore(): QuoteStore | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export interface HomeQuoteOptions {
  readonly store?: QuoteStore | null;
  readonly quotes?: readonly Quote[];
  readonly now?: () => number;
}

/**
 * Everything the quote strip renders. The QUOTE is held in state — it must not
 * change under the reader on every keystroke, and `resolveHomeQuote` keeps it
 * for at least `MIN_DWELL_MS` — but the CONNECTOR is never held: it is derived
 * from the current signals on every render.
 *
 * That split is the D1 fix. Storing the pick whole (quote AND the cue it was
 * chosen under) is what let "before you write today's page" stay on screen after
 * the page was written: the quote was correctly held, and the reason was held
 * with it. A held quote is fine. A held reason is a false claim.
 */
export function useHomeQuote(
  live: LiveQuoteSignals,
  options: HomeQuoteOptions = {},
): { quote: Quote | null; connector: QuoteCue | null } {
  const { signals, ready, readAt } = live;
  const {
    store = browserQuoteStore(),
    quotes = QUOTES,
    now = Date.now,
  } = options;
  const [quote, setQuote] = useState<Quote | null>(null);

  // A string key, not the signals object: the rotation must advance when the
  // FACTS move, never because a render allocated a new bag.
  const key = ready ? contextKey(signals, deriveCues(signals)) : null;
  const latest = useRef({ signals, quotes, now });
  latest.current = { signals, quotes, now };

  useEffect(() => {
    if (key == null || store == null) return;
    const { signals: s, quotes: qs, now: clock } = latest.current;
    try {
      setQuote(resolveHomeQuote(store, s, clock(), qs).quote);
    } catch {
      // A storage failure must never blank the menu; the slot just stays empty.
    }
    // `readAt` is the pulse that lets the dwell bounds actually expire: without
    // it a menu left open all day would never re-evaluate and MAX_DWELL_MS would
    // be a promise nothing kept.
  }, [key, readAt, store]);

  return { quote, connector: connectorFor(quote, signals) };
}
