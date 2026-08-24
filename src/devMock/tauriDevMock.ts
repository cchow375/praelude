// ---------------------------------------------------------------------------
// DEV-ONLY Tauri interception mock.
//
// This module lets the five-workspace v2 UI mount and render in a plain browser
// (`npm run dev:mock`) or a jsdom smoke test, WITHOUT a Rust backend. It is a
// BOUNDED interactive harness for visual/design review and browser journeys —
// NOT a substitute for native acceptance. It returns coherent sample data for
// every workspace plus a few high-value interactions; live native event pushes,
// audio, persistence, and complete domain semantics remain out of scope.
//
// Interception point: `window.__TAURI_INTERNALS__`. Both @tauri-apps/api
// surfaces bottom out here — `invoke(cmd, args)` calls
// `window.__TAURI_INTERNALS__.invoke(...)`, and `listen(event, handler)` calls
// `invoke('plugin:event|listen', ...)` after `transformCallback(handler)` (also
// on __TAURI_INTERNALS__). Mocking this one object therefore intercepts every
// command AND every event subscription through a single seam. Nothing here
// touches `window.isTauri`, so `isTauri()` stays falsy exactly as in the browser.
//
// This file is only imported behind the `import.meta.env.VITE_DEV_MOCK` flag
// (see main.tsx) and behind an explicit call in the smoke test. When the flag is
// off it is never imported, so the real Tauri app and a normal `vite` dev run
// are byte-for-byte unaffected.
// ---------------------------------------------------------------------------

import type { AnomalyReport } from "../features/ledger/AnomaliesPanel";
import type {
  HistoryDayDetail,
  HistoryDaySet,
  HistoryDaySession,
  HistoryDaySummary,
} from "../features/ledger/historyDays";
import type { DailyWork, RecoveryPreview } from "../features/calendar/types";
import type {
  BlockHistory,
  Goal,
  PieceDetailData,
  PieceSummary,
  ProgressSummary,
  Region,
  Rep,
} from "../features/pieces/types";
import type {
  CheckOutcome,
  RepOpenArgs,
  RepSnapshot,
  RetentionCheckView,
  Verdict,
} from "../features/rep/useRep";
import type { MutationReceipt } from "../features/receipts/ReceiptCenter";
import type { PausedSetRow } from "../features/rep/pausedSets";
import type { SessionView } from "../features/session/useSession";
import type { UniverseSnapshot } from "../features/universe/types";
import type { StreakSummary } from "../features/streak/api";
import {
  assertPiecePlanText,
  parseBodyJson,
  type DaySheet,
  type NotebookLine,
  type PiecePlan,
} from "../features/notebook/lines";
import { BANNER_MAX_CHARS } from "../features/score/bannerText";

/** Local YYYY-MM-DD, matching calendar/dates.ts `todayLocal()`. */
function todayLocal(): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isoDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

/** Local YYYY-MM-DD `days` ago, matching `todayLocal()`'s own local (not
 * UTC) day math — used only by the fix-wave item 12 QA fixtures below. */
function dayLocalOffset(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const TODAY = todayLocal();
const YESTERDAY = dayLocalOffset(-1);

// --- Repertoire -----------------------------------------------------------

const PIECES: PieceSummary[] = [
  {
    id: 1,
    title: "Scherzo No. 2",
    composer: "Frédéric Chopin",
    has_xml: true,
    has_pdf: true,
    intake_done: true,
  },
  {
    id: 2,
    title: "The White Peacock",
    composer: "Charles Tomlinson Griffes",
    has_xml: false,
    has_pdf: true,
    intake_done: true,
  },
  {
    // A freshly-scanned piece that still needs intake — exercises the now-mounted
    // IntakeForm (piece_intake_save) and, once past intake, the Details surface
    // with its GoalsPanel. No PDF so it opens straight to the practice details.
    id: 3,
    title: "Gymnopédie No. 1",
    composer: "Erik Satie",
    has_xml: true,
    has_pdf: false,
    intake_done: false,
  },
  {
    // Id 6 on purpose: `PICKUP_DEMO_PIECE_ID` (see the measure-mapping
    // section below) is the mock's pickup fixture — every page reports zero
    // printed numbers, so a scan produces `pickup_ambiguity`. Listing it here
    // makes that flow reachable by CLICKING through the pieces list in
    // `npm run dev:mock`, instead of only by a test hardcoding piece_id 6.
    id: 6,
    title: "Menuet in G (pickup demo)",
    composer: "Christian Petzold",
    has_xml: false,
    has_pdf: true,
    intake_done: true,
  },
];

// Canned IMSLP add-a-score data for the dev harness (no network). The search
// snippet carries a highlight `<span>` on purpose so the panel's plain-text
// stripping is exercised; the publisher field carries raw `{{…}}` wikitext.
// `page_id` is 0 on every hit ON PURPOSE — that is what the live IMSLP API
// actually produces (its `list=search` sends no `pageid`). These used to carry
// invented ids, which meant dev mode was the one place the result list had
// unique keys, hiding the duplicate-key/select-everything bug that real data
// triggered. Keep them 0 so the harness fails the same way production would.
const IMSLP_HITS = [
  {
    title: "Nocturnes, Op.9 (Chopin, Frédéric)",
    page_id: 0,
    snippet: 'Complete <span class="searchmatch">Nocturnes</span> score',
    size: 42942,
    word_count: 3000,
    is_redirect: false,
  },
  {
    title: "Nocturne in E minor, Op.72 No.1 (Chopin, Frédéric)",
    page_id: 0,
    snippet: "Posthumous nocturne",
    size: 9637,
    word_count: 1175,
    is_redirect: false,
  },
];

const IMSLP_EDITIONS = [
  {
    file_name: "PMLP02312-Chopin_Nocturnes_Op_9_Kistner.pdf",
    description: "Complete Score",
    editor: "{{FE}} (German)",
    publisher: "{{P|Kistner|Fr. Kistner|Leipzig|{{HMB|1833|7}}|1832||995}}",
    copyright: "Public Domain",
    image_type: "Normal Scan",
  },
];

const IMSLP_FILE_INFO = {
  url: "https://imslp.org/images/9/91/PMLP02312-Chopin_Nocturnes_Op_9_Kistner.pdf",
  size: 1964066,
  mime: "application/pdf",
};

const MOCK_DOWNLOADS = [
  {
    name: "PMLP02312-Chopin_Nocturnes_Op_9_Kistner.pdf",
    path: "/Users/you/Downloads/PMLP02312-Chopin_Nocturnes_Op_9_Kistner.pdf",
    modified_ms: Date.now(),
  },
];

const PIECE_DETAILS: Record<number, PieceDetailData> = {
  1: {
    id: 1,
    title: "Scherzo No. 2",
    composer: "Frédéric Chopin",
    has_xml: true,
    has_pdf: true,
    intake_done: true,
    folder_path: "/dev-mock/scherzo-no-2",
    xml_path: "/dev-mock/scherzo-no-2/score.musicxml",
    pdf_path: "/dev-mock/scherzo-no-2/score.pdf",
    goals: ["Perform from memory", "Even development voicing"],
    deadline: null,
    target_tempo: 100,
    hard_spots: [{ measures: "65-96", note: "Development hand coordination" }],
    current_state: "Development section under tempo",
    notes: "Keep the left hand light in the opening.",
    banner_text: "Even development voicing, hands together at 84",
  },
  2: {
    id: 2,
    title: "The White Peacock",
    composer: "Charles Tomlinson Griffes",
    has_xml: false,
    has_pdf: true,
    intake_done: true,
    folder_path: "/dev-mock/white-peacock",
    xml_path: null,
    pdf_path: "/dev-mock/white-peacock/score.pdf",
    goals: ["Voice the melody over the tremolo"],
    deadline: null,
    target_tempo: 63,
    hard_spots: [{ measures: "40-52", note: "Climax pedaling" }],
    current_state: "Reading the opening",
    notes: null,
    banner_text: null,
  },
  3: {
    id: 3,
    title: "Gymnopédie No. 1",
    composer: "Erik Satie",
    has_xml: true,
    has_pdf: false,
    intake_done: false,
    folder_path: "/dev-mock/gymnopedie-no-1",
    xml_path: "/dev-mock/gymnopedie-no-1/score.musicxml",
    pdf_path: null,
    goals: [],
    deadline: null,
    target_tempo: null,
    hard_spots: [],
    current_state: null,
    notes: null,
    banner_text: null,
  },
  // The pickup-ambiguity mapping demo (`PICKUP_DEMO_PIECE_ID`). Same shape as
  // the others so every piece-detail surface works when it is selected.
  6: {
    id: 6,
    title: "Menuet in G (pickup demo)",
    composer: "Christian Petzold",
    has_xml: false,
    has_pdf: true,
    intake_done: true,
    folder_path: "/dev-mock/menuet-in-g",
    xml_path: null,
    pdf_path: "/dev-mock/menuet-in-g/score.pdf",
    goals: [],
    deadline: null,
    target_tempo: null,
    hard_spots: [],
    current_state: "Pickup-measure mapping demo",
    notes: null,
    banner_text: null,
  },
};

/** Task A11: banner edits made during a dev run, keyed by piece id. Absent =
 *  use the fixture's own `banner_text`. Cleared in `installTauriDevMock()`. */
const MOCK_BANNERS = new Map<number, string | null>();

const SEED_REGIONS: Record<number, Region[]> = {
  1: [
    {
      id: 11,
      piece_id: 1,
      name: "Opening theme",
      notes: null,
      m_start: 1,
      m_end: 8,
      kind: "phrase",
      order: 0,
      color: null,
      pdf_anchor: null,
      parent_region_id: null,
    },
    {
      id: 12,
      piece_id: 1,
      name: "Development",
      notes: null,
      m_start: 65,
      m_end: 96,
      kind: "section",
      order: 1,
      color: null,
      pdf_anchor: null,
      parent_region_id: null,
    },
    {
      id: 13,
      piece_id: 1,
      name: "Coda",
      notes: null,
      m_start: 240,
      m_end: 268,
      kind: "section",
      order: 2,
      color: null,
      pdf_anchor: null,
      parent_region_id: null,
    },
  ],
  2: [
    {
      id: 21,
      piece_id: 2,
      name: "Opening",
      notes: null,
      m_start: 1,
      m_end: 12,
      kind: "phrase",
      order: 0,
      color: null,
      pdf_anchor: null,
      parent_region_id: null,
    },
    {
      id: 22,
      piece_id: 2,
      name: "Climax",
      notes: null,
      m_start: 40,
      m_end: 52,
      kind: "section",
      order: 1,
      color: null,
      pdf_anchor: null,
      parent_region_id: null,
    },
  ],
};

/** Mutable per-install region state, reset from `SEED_REGIONS` in
 * `installTauriDevMock()` so create/delete never bleeds between installs
 * (the same pattern as `DAY_SHEETS`/`MOCK_BANNERS` below). */
let REGIONS: Record<number, Region[]> = SEED_REGIONS;

/** Task C5: next id handed to a mock-created region, and a small helper set
 * so `region_create`/`region_delete` behave like the real store (parent
 * validation, one-level nesting, cascade/promote) for offline QA. */
let mockRegionNextId = 100;

function mockAllRegions(): Region[] {
  return Object.values(REGIONS).flat();
}

function mockFindRegion(id: number): Region | undefined {
  return mockAllRegions().find((region) => region.id === id);
}

const BLOCKS: Record<number, BlockHistory[]> = {
  1: [
    {
      block_id: 101,
      region_id: 11,
      m_start: 1,
      m_end: 8,
      label: "Opening theme",
      start_bpm: 80,
      bpm: 92,
      target_bpm: 108,
      planned_reps: 8,
      reps_done: 6,
      status: "open",
      verdicts: { clean: 5, flawed: 1, failed: 0 },
      focus: "notes",
      use_metronome: true,
      attempts_recorded: 6,
      tries: 6,
      current_clean_streak: 2,
      mastery_progress_streak: 2,
      best_clean_streak: 3,
      required_clean_streak: 5,
      effective_required_clean_streak: 5,
      recovery_remaining: 0,
      mastery_status: "not_satisfied",
      mastery_verified: false,
      set_state: "active",
    },
    {
      block_id: 102,
      region_id: 12,
      m_start: 65,
      m_end: 96,
      label: "Development",
      start_bpm: 60,
      bpm: 84,
      target_bpm: 84,
      planned_reps: 8,
      reps_done: 8,
      status: "closed",
      verdicts: { clean: 8, flawed: 0, failed: 0 },
      focus: "hands",
      use_metronome: true,
      attempts_recorded: 8,
      tries: 8,
      current_clean_streak: 8,
      mastery_progress_streak: 8,
      best_clean_streak: 8,
      required_clean_streak: 5,
      effective_required_clean_streak: 5,
      recovery_remaining: 0,
      mastery_status: "satisfied",
      mastery_verified: true,
      set_state: "mastered",
    },
  ],
  2: [
    {
      block_id: 201,
      region_id: 21,
      m_start: 1,
      m_end: 12,
      label: "Opening",
      start_bpm: 48,
      bpm: 52,
      target_bpm: 63,
      planned_reps: 6,
      reps_done: 4,
      status: "open",
      verdicts: { clean: 3, flawed: 0, failed: 1 },
      focus: "notes",
      use_metronome: false,
      attempts_recorded: 4,
      tries: 4,
      current_clean_streak: 0,
      mastery_progress_streak: 0,
      best_clean_streak: 2,
      required_clean_streak: 5,
      effective_required_clean_streak: 5,
      recovery_remaining: 1,
      mastery_status: "not_satisfied",
      mastery_verified: false,
      set_state: "active",
    },
  ],
};

const PROGRESS: Record<number, ProgressSummary> = {
  1: {
    piece_id: 1,
    focused_seconds: 8400,
    streak: 3,
    best_tempo_reached: 92,
    per_region_mastery: [
      {
        region_id: 11,
        name: "Opening theme",
        blocks: 3,
        reps: 18,
        clean_ratio: 0.83,
        best_bpm: 92,
        last_practiced: isoDaysAgo(1),
      },
      {
        region_id: 12,
        name: "Development",
        blocks: 2,
        reps: 16,
        clean_ratio: 1,
        best_bpm: 84,
        last_practiced: isoDaysAgo(2),
      },
    ],
    time_by_focus: [
      { focus: "notes", seconds: 4200 },
      { focus: "hands", seconds: 4200 },
    ],
  },
  2: {
    piece_id: 2,
    focused_seconds: 3200,
    streak: 1,
    best_tempo_reached: 52,
    per_region_mastery: [
      {
        region_id: 21,
        name: "Opening",
        blocks: 1,
        reps: 4,
        clean_ratio: 0.75,
        best_bpm: 52,
        last_practiced: isoDaysAgo(3),
      },
    ],
    time_by_focus: [{ focus: "notes", seconds: 3200 }],
  },
};

const GOALS: Record<number, Goal[]> = {
  1: [
    {
      id: 1,
      piece_id: 1,
      text: "Perform Scherzo No. 2 from memory",
      kind: "big",
      parent_goal_id: null,
      done: false,
      order: 0,
      target_date: TODAY,
      created_ts: isoDaysAgo(20),
    },
    {
      id: 2,
      piece_id: 1,
      text: "Clean the development section hands together",
      kind: "sub",
      parent_goal_id: 1,
      done: false,
      order: 0,
      target_date: null,
      created_ts: isoDaysAgo(10),
    },
  ],
  2: [
    {
      id: 3,
      piece_id: 2,
      text: "Voice the melody above the tremolo",
      kind: "big",
      parent_goal_id: null,
      done: false,
      order: 0,
      target_date: null,
      created_ts: isoDaysAgo(8),
    },
  ],
};

// Goals promoted from the day sheet at runtime (spec 13). Kept apart from the
// read-only seeded GOALS so `goal_create`/`goal_update` round-trip and reload
// without mutating the samples other suites read; cleared on each install.
const CREATED_GOALS = new Map<number, Goal>();
let mockGoalSeq = 900;

function findSeededGoal(id: number): Goal | undefined {
  for (const list of Object.values(GOALS)) {
    const found = list.find((goal) => goal.id === id);
    if (found) return found;
  }
  return undefined;
}

function goalListFor(pieceId: number): Goal[] {
  const seeded = GOALS[pieceId] ?? [];
  const created = [...CREATED_GOALS.values()].filter(
    (goal) => goal.piece_id === pieceId,
  );
  return [...seeded, ...created];
}

function goalCreate(args: unknown): Goal {
  const outer = argsRecord(args);
  // The app invokes with `{ args: { … } }`; accept a flat `{ … }` too so the
  // created goal always captures a real piece_id + text. Without that a promoted
  // goal_ref would re-resolve to a text-less goal after remount (an empty "Goal"
  // placeholder), since the day sheet resolves goal_ref text through goal_list.
  const spec = (outer.args ?? outer) as Record<string, unknown>;
  const pieceId = Number(spec.piece_id);
  const goal: Goal = {
    id: (mockGoalSeq += 1),
    piece_id: Number.isInteger(pieceId) && pieceId >= 1 ? pieceId : 1,
    text: String(spec.text ?? ""),
    kind: spec.kind === "sub" ? "sub" : "big",
    parent_goal_id:
      spec.parent_goal_id == null ? null : Number(spec.parent_goal_id),
    done: false,
    order: 0,
    target_date: spec.target_date == null ? null : String(spec.target_date),
    created_ts: new Date().toISOString(),
  };
  CREATED_GOALS.set(goal.id, goal);
  return goal;
}

function goalUpdate(args: unknown): Goal {
  const record = argsRecord(args);
  const id = Number(record.id);
  const patch = (record.patch ?? {}) as Record<string, unknown>;
  const existing = CREATED_GOALS.get(id) ?? findSeededGoal(id);
  if (!existing) throw "goal_update: unknown goal";
  const updated: Goal = { ...existing };
  if ("text" in patch) updated.text = String(patch.text ?? "");
  if ("done" in patch) updated.done = Boolean(patch.done);
  if ("target_date" in patch) {
    updated.target_date =
      patch.target_date == null ? null : String(patch.target_date);
  }
  if ("parent_goal_id" in patch) {
    updated.parent_goal_id =
      patch.parent_goal_id == null ? null : Number(patch.parent_goal_id);
  }
  CREATED_GOALS.set(id, updated);
  return updated;
}

function dailyWork(): DailyWork[] {
  const base = {
    origin_date: TODAY,
    scheduled_date: TODAY,
    reschedule_count: 0,
    completed_ts: null,
    created_ts: isoDaysAgo(1),
    updated_ts: isoDaysAgo(1),
  };
  return [
    {
      ...base,
      id: 1,
      goal_id: 2,
      region_id: 11,
      block_id: null,
      title: "Development hands-together, slow",
      planned_minutes: 20,
      status: "planned",
      source: "planner",
      sort_order: 0,
      piece_id: 1,
      piece_title: "Scherzo No. 2",
      goal_text: "Clean the development section hands together",
      parent_goal_text: "Perform Scherzo No. 2 from memory",
    },
    {
      ...base,
      id: 2,
      goal_id: 3,
      region_id: 21,
      block_id: null,
      title: "White Peacock opening, voicing",
      planned_minutes: 15,
      status: "planned",
      source: "manual",
      sort_order: 1,
      piece_id: 2,
      piece_title: "The White Peacock",
      goal_text: "Voice the melody above the tremolo",
      parent_goal_text: null,
    },
  ];
}

function recoveryPreview(): RecoveryPreview {
  const missed: DailyWork = {
    id: 3,
    goal_id: 2,
    region_id: 11,
    block_id: null,
    title: "Opening theme review",
    planned_minutes: 10,
    origin_date: TODAY,
    scheduled_date: isoDaysAgo(2).slice(0, 10),
    status: "planned",
    source: "planner",
    reschedule_count: 1,
    sort_order: 0,
    completed_ts: null,
    created_ts: isoDaysAgo(4),
    updated_ts: isoDaysAgo(2),
    piece_id: 1,
    piece_title: "Scherzo No. 2",
    goal_text: "Clean the development section hands together",
    parent_goal_text: "Perform Scherzo No. 2 from memory",
  };
  return {
    today: TODAY,
    capacity_minutes: 60,
    items: [
      {
        work: missed,
        proposed_date: TODAY,
        reason: "Scheduled 2 days ago and not marked done.",
        effective_deadline: null,
      },
    ],
    days: [
      {
        date: TODAY,
        planned_minutes: 35,
        recovery_minutes: 10,
        capacity_minutes: 60,
      },
    ],
  };
}

function retentionDue(): RetentionCheckView[] {
  return [
    {
      id: 501,
      region_id: 11,
      source_set_id: 102,
      due_date: TODAY,
      original_due_date: TODAY,
      condition: {
        bpm: 84,
        m_start: 65,
        m_end: 96,
        hands: "together",
        required_clean_streak: 5,
      },
      state: "due",
      result: null,
      completed_ts: null,
      created_ts: isoDaysAgo(3),
      updated_ts: isoDaysAgo(1),
    },
  ];
}

function anomalies(): AnomalyReport {
  return {
    generated_at: new Date().toISOString(),
    total: 3,
    groups: [
      {
        kind: "incomplete_event_provenance",
        severity: "info",
        count: 2,
        rows: [
          {
            id: 1,
            entity_type: "event",
            entity_id: 4021,
            review_state: "open",
            detail: { input_source: "unknown" },
            created_ts: isoDaysAgo(30),
            reviewed_ts: null,
          },
          {
            id: 2,
            entity_type: "event",
            entity_id: 4022,
            review_state: "open",
            detail: { input_source: "unknown" },
            created_ts: isoDaysAgo(30),
            reviewed_ts: null,
          },
        ],
      },
      {
        kind: "same_second_attempt_burst",
        severity: "warning",
        count: 1,
        rows: [
          {
            id: 3,
            entity_type: "set",
            entity_id: 101,
            review_state: "open",
            detail: { attempts: 2, shared_timestamp: isoDaysAgo(5) },
            created_ts: isoDaysAgo(5),
            reviewed_ts: null,
          },
        ],
      },
    ],
  };
}

function universeSnapshot(): UniverseSnapshot {
  return {
    generated_at: new Date().toISOString(),
    definitions: [
      {
        signal: "focused_time",
        label: "System size",
        definition: "Focused practice time after idle time is removed.",
      },
      {
        signal: "continuity",
        label: "Outer arc",
        definition: "Distinct active days in the inclusive 28-day window.",
      },
      {
        signal: "mastery",
        label: "Mastery ring",
        definition:
          "Only verified consecutive-clean contracts; never raw click totals.",
      },
    ],
    traces: {
      source: "dev-mock sample practice events",
      practice_event_kinds: ["rep_open", "rep", "verdict", "tempo_change"],
      idle_threshold_seconds: 300,
      active_window_start: isoDaysAgo(27).slice(0, 10),
      active_window_end: TODAY,
      quality_formula: "bounded smoothing",
      maturity_formula: "coverage × verified mastery × continuity",
    },
    totals: {
      focused_seconds: 11600,
      active_days_28: 6,
      regions_practiced: 3,
      regions_revisited: 1,
      mastered_targets: 1,
      recovered_targets: 0,
      practice_sessions: 7,
    },
    pieces: [
      {
        piece_id: 1,
        title: "Scherzo No. 2",
        composer: "Frédéric Chopin",
        focused_seconds: 8400,
        active_days_28: 6,
        regions_total: 3,
        regions_practiced: 2,
        regions_revisited: 1,
        mastered_targets: 1,
        recovered_targets: 0,
        open_recovery_debt: 0,
        practice_sessions: 5,
        earned_maturity: 0.55,
        quality_brightness: 0.97,
        last_practiced: isoDaysAgo(1),
        region_signals: [
          {
            region_id: 11,
            name: "Opening theme",
            kind: "phrase",
            focused_seconds: 4200,
            active_days_28: 4,
            practiced: true,
            revisited: true,
            quality_brightness: 0.98,
            last_practiced: isoDaysAgo(1),
            practice_events: 14,
            rated_rep_events: 8,
            clean_rep_events: 6,
            distinct_practice_dates: 4,
            mastery_contracts_completed: 0,
            recovery_resets: 0,
            recovered: false,
            open_recovery_debt: 0,
            practice_sessions: 7,
          },
          {
            region_id: 12,
            name: "Development",
            kind: "section",
            focused_seconds: 4200,
            active_days_28: 3,
            practiced: true,
            revisited: false,
            quality_brightness: 0.96,
            last_practiced: isoDaysAgo(2),
            practice_events: 10,
            rated_rep_events: 8,
            clean_rep_events: 8,
            distinct_practice_dates: 2,
            mastery_contracts_completed: 1,
            recovery_resets: 0,
            recovered: false,
            open_recovery_debt: 0,
            practice_sessions: 3,
          },
          {
            region_id: 13,
            name: "Coda",
            kind: "section",
            focused_seconds: 0,
            active_days_28: 0,
            practiced: false,
            revisited: false,
            quality_brightness: 0.95,
            last_practiced: null,
            practice_events: 0,
            rated_rep_events: 0,
            clean_rep_events: 0,
            distinct_practice_dates: 0,
          },
        ],
      },
      {
        piece_id: 2,
        title: "The White Peacock",
        composer: "Charles Tomlinson Griffes",
        focused_seconds: 3200,
        active_days_28: 3,
        regions_total: 2,
        regions_practiced: 1,
        regions_revisited: 0,
        mastered_targets: 0,
        recovered_targets: 0,
        open_recovery_debt: 1,
        practice_sessions: 2,
        earned_maturity: 0.2,
        quality_brightness: 0.94,
        last_practiced: isoDaysAgo(3),
        region_signals: [
          {
            region_id: 21,
            name: "Opening",
            kind: "phrase",
            focused_seconds: 3200,
            active_days_28: 3,
            practiced: true,
            revisited: false,
            quality_brightness: 0.94,
            last_practiced: isoDaysAgo(3),
            practice_events: 6,
            rated_rep_events: 4,
            clean_rep_events: 3,
            distinct_practice_dates: 2,
            mastery_contracts_completed: 0,
            recovery_resets: 1,
            recovered: false,
            open_recovery_debt: 1,
            practice_sessions: 2,
          },
          {
            region_id: 22,
            name: "Climax",
            kind: "section",
            focused_seconds: 0,
            active_days_28: 0,
            practiced: false,
            revisited: false,
            quality_brightness: 0.93,
            last_practiced: null,
            practice_events: 0,
            rated_rep_events: 0,
            clean_rep_events: 0,
            distinct_practice_dates: 0,
          },
        ],
      },
    ],
  };
}

// A live, PAUSED active set so the shell-level Rep HUD renders in the static
// harness. Paused (timer_state) keeps the HUD's focused-time checkpoint interval
// from firing against the mock (which has no rep_checkpoint receipt).
const MOCK_REP_STATE: RepSnapshot = {
  block_id: 102,
  piece_id: 1,
  piece_title: "Scherzo No. 2",
  m_start: 65,
  m_end: 96,
  label: "Development",
  bpm: 84,
  start_bpm: 60,
  target_bpm: 96,
  planned_reps: 30,
  reps_done: 3,
  cleans_at_step: 2,
  rule: { clean_needed: 3, bpm_step: 4 },
  variant: "hands together",
  variants: [],
  verdicts: { clean: 3, flawed: 1, failed: 0 },
  last: { verdict: "clean", note: "steadier release", bpm: 84 },
  status: "active",
  focus: "tempo",
  use_metronome: true,
  attempts_recorded: 4,
  tries: 4,
  voided_attempts: 0,
  current_clean_streak: 3,
  mastery_progress_streak: 3,
  best_clean_streak: 3,
  reset_count: 0,
  accuracy: 0.75,
  required_clean_streak: 5,
  effective_required_clean_streak: 5,
  recovery_remaining: 0,
  mastery_status: "not_satisfied",
  mastery_verified: true,
  set_state: "active",
  last_attempt_id: 4402,
  last_adjustment_id: null,
  active_seconds: 372,
  timer_state: "paused",
  intention: "Even development voicing",
  judging_axis: "pulse",
  hands: "together",
  method: "tempo ladder",
};

// Task A4: the paused-sets tray's backing state. `rep_pause`/`rep_resume`
// toggle `mockSetState` and keep `mockPausedSets` in sync so `sets_paused_list`
// reflects it — the same real/mock relationship as `rep_state` vs. the ledger
// counters below. Reset in `installTauriDevMock()` so tests don't bleed state.
let mockSetState: "active" | "paused" = "active";
let mockPausedSets: PausedSetRow[] = [];

// Task A4b fix round 1 (folded minor a): deliberately DISTINCT from
// `MOCK_REP_STATE.block_id` (102) — if the frontend ever dropped `setId` off
// a paused-row Resume call (regressing back to the pre-A4b no-target
// command), this mismatch would make the resume hit the rejection branch
// below instead of silently "succeeding" against the wrong id.
const MOCK_PAUSED_SET_ID = 5102;

function mockPausedRow(): PausedSetRow {
  return {
    set_id: MOCK_PAUSED_SET_ID,
    block_id: MOCK_PAUSED_SET_ID,
    piece_id: MOCK_REP_STATE.piece_id,
    piece_title: MOCK_REP_STATE.piece_title,
    m_start: MOCK_REP_STATE.m_start,
    m_end: MOCK_REP_STATE.m_end,
    bpm: MOCK_REP_STATE.bpm ?? 0,
    target_bpm: MOCK_REP_STATE.target_bpm ?? 0,
    paused_since_ts: new Date().toISOString(),
    current_clean_streak: mockCleanStreak,
  };
}

function repPauseReceipt(commandId: string): MutationReceipt<RepSnapshot> {
  mockSetState = "paused";
  mockPausedSets = [mockPausedRow()];
  const snap: RepSnapshot = {
    ...MOCK_REP_STATE,
    set_state: "paused",
    timer_state: "paused",
  };
  return {
    receipt_id: `mock-receipt-pause-${Date.now()}`,
    command_id: commandId,
    status: "committed",
    summary: "Practice paused; paused time will not count.",
    value: snap,
    entity_refs: [{ entity_type: "set", entity_id: snap.block_id }],
    event_ids: [],
    undo_action: null,
    error_code: null,
    error_detail: null,
    replayed: false,
    committed_ts: new Date().toISOString(),
  };
}

// Task A4 fix round 1: a deterministic, test-controlled hook to force the
// next `rep_resume` mock call to resolve a REJECTED receipt (a business
// rejection, not a thrown error — real rejections like "only a paused
// practice set can resume" arrive exactly this way, per lib.rs's
// `rejected_snapshot`). Distinct from the mock's plain-string-throw
// convention (e.g. `book_add`'s validation failures): this is a rejected
// PROMISE RESOLUTION carrying a receipt, not a thrown/rejected promise.
let mockResumeRejects = false;

/** Test-only: flip whether the next `rep_resume` mock call rejects the
 * receipt. Not reachable through any UI affordance — imported directly by
 * tests, same spirit as `imslp_search`'s query-driven failure trigger below
 * but for a receipt-shaped (not thrown) rejection. */
export function setMockResumeRejects(reject: boolean): void {
  mockResumeRejects = reject;
}

// Task A4b fix round 1: the real backend's `Store::v2_resume` can atomically
// auto-pause a DIFFERENT set while resuming the target (rep/mod.rs's
// `resume`) — the mock only ever tracks ONE simulated live block, so it
// can't derive that on its own. Test-only hook, same spirit as
// `setMockResumeRejects`: when set, the next COMMITTED resume replaces
// `mockPausedSets` with this value (instead of clearing it to `[]`) and
// includes it in the receipt's summary, simulating "the backend just
// auto-paused this other set while resuming the target" — the exact
// scenario `PausedSetsTray` must refetch and surface.
let mockPausedSetsAfterResume: PausedSetRow[] | null = null;

/** Test-only: seed what `mockPausedSets` becomes after the NEXT committed
 * `rep_resume` (simulating an auto-paused OTHER set), or `null` to restore
 * the default "clears to empty" behavior. Not reachable through any UI
 * affordance. */
export function setMockPausedSetsAfterResume(
  rows: PausedSetRow[] | null,
): void {
  mockPausedSetsAfterResume = rows;
}

// Task A4b: `rep_resume` gained an optional `setId` (the tray now always
// passes the specific row's `set_id`; the rep HUD's own Resume chip still
// omits it — that's `undefined`, not a mismatch, and is accepted). The mock
// only ever simulates ONE live block, so there is no second set to
// auto-pause here — a `setId` that doesn't match `MOCK_PAUSED_SET_ID`
// simulates the real backend's "only a paused practice set can resume"
// rejection rather than silently resuming the wrong thing.
function repResumeReceipt(
  commandId: string,
  setId?: number,
): MutationReceipt<RepSnapshot> {
  if (mockResumeRejects) {
    return {
      receipt_id: `mock-receipt-resume-rejected-${Date.now()}`,
      command_id: commandId,
      status: "rejected",
      summary: "Practice could not be resumed.",
      value: null,
      entity_refs: [],
      event_ids: [],
      undo_action: null,
      error_code: "practice_rejected",
      error_detail: "Mock-forced rejection for testing.",
      replayed: false,
      committed_ts: null,
    };
  }
  if (setId != null && setId !== MOCK_PAUSED_SET_ID) {
    return {
      receipt_id: `mock-receipt-resume-rejected-${Date.now()}`,
      command_id: commandId,
      status: "rejected",
      summary: "The practice set could not be resumed.",
      value: null,
      entity_refs: [],
      event_ids: [],
      undo_action: null,
      error_code: "practice_rejected",
      error_detail: "only a paused practice set can resume",
      replayed: false,
      committed_ts: null,
    };
  }
  mockSetState = "active";
  const autoPaused = mockPausedSetsAfterResume;
  mockPausedSets = autoPaused ?? [];
  const snap: RepSnapshot = {
    ...MOCK_REP_STATE,
    set_state: "active",
    timer_state: "active",
  };
  const summary =
    autoPaused != null && autoPaused.length > 0
      ? `Paused ${autoPaused[0].piece_title} \u{b7} Resumed ${MOCK_REP_STATE.piece_title}`
      : "Practice resumed.";
  return {
    receipt_id: `mock-receipt-resume-${Date.now()}`,
    command_id: commandId,
    status: "committed",
    summary,
    value: snap,
    entity_refs: [{ entity_type: "set", entity_id: snap.block_id }],
    event_ids: [],
    undo_action: null,
    error_code: null,
    error_detail: null,
    replayed: false,
    committed_ts: new Date().toISOString(),
  };
}

// Fix wave item 8: the checkpoint heartbeat (useRep.ts's 15s `rep_checkpoint`
// interval, active while a set is timing) had NO mock handler at all — the
// switch's `default: return null` resolved every checkpoint call with `null`
// instead of a receipt, and the null-guard added to
// `runSnapshotReceiptMutation` (useRep.ts) turned that into a repeating
// error toast every 15s. A real checkpoint just persists elapsed focused
// seconds and returns the (otherwise unchanged) snapshot — mirror that here
// so `dev:mock` behaves like the real backend instead of erroring on a timer.
let mockCheckpointedSeconds = MOCK_REP_STATE.active_seconds ?? 0;

function repCheckpointReceipt(commandId: string): MutationReceipt<RepSnapshot> {
  mockCheckpointedSeconds += 15;
  const snap: RepSnapshot = {
    ...MOCK_REP_STATE,
    set_state: mockSetState,
    timer_state: mockSetState,
    active_seconds: mockCheckpointedSeconds,
  };
  return {
    receipt_id: `mock-receipt-checkpoint-${Date.now()}`,
    command_id: commandId,
    status: "committed",
    summary: "Focused time checkpointed.",
    value: snap,
    entity_refs: [{ entity_type: "set", entity_id: snap.block_id }],
    event_ids: [],
    undo_action: null,
    error_code: null,
    error_detail: null,
    replayed: false,
    committed_ts: new Date().toISOString(),
  };
}

// Task A10: `rep_open`'s optional `context.pass_seconds` round-trips through
// the mock so `BlockForm`'s live estimate is exercisable in `dev:mock`
// without a Rust backend. Not otherwise surfaced by any read command (the
// real backend only persists it into `set_contract`, never returns it on the
// snapshot) — a test-only getter reads it directly, same spirit as
// `setMockResumeRejects` above.
let mockLastPassSeconds: number | null = null;

/** Test-only: the most recent `rep_open` mock call's `context.pass_seconds`
 * (or `null` if the last open had none / none has happened yet). */
export function mockLastOpenedPassSeconds(): number | null {
  return mockLastPassSeconds;
}

function repOpenSnapshot(args: unknown, context: unknown): RepSnapshot {
  const a = (args ?? {}) as Partial<RepOpenArgs>;
  const c = (context ?? {}) as { pass_seconds?: number | null };
  mockLastPassSeconds = c.pass_seconds ?? null;
  mockSetState = "active";
  mockPausedSets = [];
  return {
    ...MOCK_REP_STATE,
    piece_id: a.piece_id ?? MOCK_REP_STATE.piece_id,
    m_start: a.m_start ?? MOCK_REP_STATE.m_start,
    m_end: a.m_end ?? MOCK_REP_STATE.m_end,
    label: a.label ?? MOCK_REP_STATE.label,
    bpm: a.start_bpm ?? MOCK_REP_STATE.bpm,
    start_bpm: a.start_bpm ?? MOCK_REP_STATE.start_bpm,
    target_bpm: a.target_bpm ?? MOCK_REP_STATE.target_bpm,
    planned_reps: a.planned_reps ?? MOCK_REP_STATE.planned_reps,
    focus: a.focus ?? MOCK_REP_STATE.focus,
    use_metronome: a.use_metronome ?? MOCK_REP_STATE.use_metronome,
    reps_done: 0,
    verdicts: { clean: 0, flawed: 0, failed: 0 },
    last: null,
    set_state: "active",
    timer_state: "active",
    active_seconds: 0,
  };
}

// Sample attempt rows so a Ledger block drill-in (`reps_for_block`) shows real
// evidence instead of an empty "No attempts logged." list in the static harness.
const REPS_BY_BLOCK: Record<number, Rep[]> = {
  101: [
    {
      id: 1011,
      block_id: 101,
      ts: isoDaysAgo(2),
      bpm: 88,
      variant: null,
      verdict: "clean",
      note: "even LH",
      source: "user_click",
      active_adjustment_ids: [],
    },
    {
      id: 1012,
      block_id: 101,
      ts: isoDaysAgo(2),
      bpm: 90,
      variant: null,
      verdict: "flawed",
      note: null,
      source: "voice_hot_loop",
      active_adjustment_ids: [],
    },
    {
      id: 1013,
      block_id: 101,
      ts: isoDaysAgo(1),
      bpm: 92,
      variant: null,
      verdict: "clean",
      note: null,
      source: "user_click",
      active_adjustment_ids: [],
    },
  ],
  102: [
    {
      id: 1021,
      block_id: 102,
      ts: isoDaysAgo(2),
      bpm: 80,
      variant: "hands together",
      verdict: "clean",
      note: "steadier release",
      source: "user_click",
      active_adjustment_ids: [],
    },
    {
      id: 1022,
      block_id: 102,
      ts: isoDaysAgo(2),
      bpm: 84,
      variant: "hands together",
      verdict: "clean",
      note: null,
      source: "user_click",
      active_adjustment_ids: [],
    },
    {
      id: 1023,
      block_id: 102,
      ts: isoDaysAgo(1),
      bpm: 84,
      variant: "hands together",
      verdict: "clean",
      note: "in the pocket",
      source: "voice_hot_loop",
      active_adjustment_ids: [],
    },
  ],
  201: [
    {
      id: 2011,
      block_id: 201,
      ts: isoDaysAgo(3),
      bpm: 50,
      variant: null,
      verdict: "failed",
      note: "lost the voicing",
      source: "user_click",
      active_adjustment_ids: [],
    },
    {
      id: 2012,
      block_id: 201,
      ts: isoDaysAgo(3),
      bpm: 52,
      variant: null,
      verdict: "clean",
      note: null,
      source: "user_click",
      active_adjustment_ids: [],
    },
  ],
};

// Mutable ledger state for the interactive `rep_check` handler so repeated
// Clean/Sloppy/Again clicks each advance the count and carry a distinct
// attempt id (the receipt de-dupe keys on `last_attempt_id`).
let mockAttemptSeq = MOCK_REP_STATE.last_attempt_id ?? 4402;
let mockAttempts = MOCK_REP_STATE.attempts_recorded ?? 4;
let mockCleanStreak = MOCK_REP_STATE.current_clean_streak ?? 3;

// Books panel (D3): the four built-ins the native manifest bootstraps, plus any
// books added this session. In-memory only — a reload restores the built-ins,
// which mirrors the native "bootstrap from built-ins on first read" behaviour.
interface MockBook {
  id: string;
  file_name: string;
  title: string;
  author: string;
  kind: "practice-method" | "composer-life" | "interpretation";
  visual_dependency: boolean;
  available: boolean;
}
let mockBooks: MockBook[] = [
  {
    id: "roskell-complete-pianist",
    file_name: "the-complete-pianist.md",
    title: "The Complete Pianist",
    author: "Penelope Roskell",
    kind: "practice-method",
    visual_dependency: true,
    available: true,
  },
  {
    id: "gebrian-learn-faster",
    file_name: "learn-faster-perform-better.md",
    title: "Learn Faster, Perform Better",
    author: "Molly Gebrian",
    kind: "practice-method",
    visual_dependency: false,
    available: true,
  },
  {
    id: "breth-effective-practicing",
    file_name: "the-piano-students-guide-to-effective-practicing.md",
    title: "The Piano Student's Guide to Effective Practicing",
    author: "Nancy O'Neill Breth",
    kind: "practice-method",
    visual_dependency: true,
    available: true,
  },
  {
    id: "gieseking-leimer-technique",
    file_name: "gieseking-leimer-piano-technique.md",
    title: "Piano Technique",
    author: "Walter Gieseking and Karl Leimer",
    kind: "interpretation",
    visual_dependency: true,
    available: true,
  },
];

/** Add a book to the in-memory manifest, echoing the native validation. */
function mockBookAdd(args: unknown): MockBook {
  const record = (args ?? {}) as Record<string, unknown>;
  const path = String(record.path ?? "").trim();
  const title = String(record.title ?? "").trim();
  const author = String(record.author ?? "").trim();
  const kind = record.kind as MockBook["kind"];
  if (!title) throw "A book needs a title.";
  if (!path.toLowerCase().endsWith(".md")) {
    throw "Only Markdown (.md) files can be added to the library.";
  }
  const fileName = path.split("/").pop() || `${title}.md`;
  const book: MockBook = {
    id: `added-${Date.now()}`,
    file_name: fileName,
    title,
    author,
    kind: kind ?? "practice-method",
    visual_dependency: false,
    available: true,
  };
  mockBooks = [...mockBooks, book];
  return book;
}

/**
 * Canned `assistant_suggest` response (C4 passage-helper). Reads `expandOf`,
 * `description`, and `pieceId` off the invoke args (camelCase, as Tauri maps
 * them). In expand mode it returns exactly one fuller ≤3-line row; otherwise it
 * returns three one-line strategies, one cited into the corpus
 * (`roskell-complete-pianist`) so the reader marker is exercised. Mirrors the
 * native shape: `{ suggestions: [{ id, text, source_id?, source_author?,
 * source_heading? }] }`.
 */
function mockAssistantSuggest(args: unknown): {
  suggestions: {
    id: string;
    text: string;
    source_id?: string;
    source_author?: string;
    source_heading?: string;
  }[];
} {
  const record = (args ?? {}) as Record<string, unknown>;
  const expandOf =
    typeof record.expandOf === "string" ? record.expandOf.trim() : "";
  const stamp = Date.now();
  if (expandOf) {
    return {
      suggestions: [
        {
          id: `mock-suggest-${stamp}`,
          text: "Play the leap hand alone, five times, stopping silently on the landing chord.\nThen add the beat before it at half tempo.\nRaise the tempo only after three clean, unhurried arrivals.",
        },
      ],
    };
  }
  return {
    suggestions: [
      {
        id: `mock-suggest-${stamp}-1`,
        text: "Practice hands separately at half tempo, watching the landing shape.",
      },
      {
        id: `mock-suggest-${stamp}-2`,
        text: "Place a silent landing before the leap so the arm learns the distance.",
        source_id: "roskell-complete-pianist",
        source_author: "Penelope Roskell",
        source_heading: "Leaps and lateral movements",
      },
      {
        id: `mock-suggest-${stamp}-3`,
        text: "Chunk the passage into two-note cells, then join them at tempo.",
      },
    ],
  };
}

/**
 * Canned `book_excerpt` response (D2 reader). For any sourceId this returns a
 * multi-paragraph section with a heading, weaving the requested `contains` quote
 * into a middle paragraph so the reader can anchor it. The heading-less OCR book
 * (`gieseking-leimer-technique`) instead returns a HUGE whole-book body with
 * heading:"" so the reader's client-side windowing (±paragraphs + Show more) is
 * exercisable in the dev harness with no vault present.
 */
function mockBookExcerpt(args: unknown): {
  source_id: string;
  title: string;
  author: string;
  heading: string;
  text: string;
} {
  const record = (args ?? {}) as Record<string, unknown>;
  const sourceId = String(record.sourceId ?? record.source_id ?? "mock-book");
  const contains =
    typeof record.contains === "string" && record.contains.trim() !== ""
      ? record.contains.trim()
      : "Slow practice is fast learning.";
  const book = mockBooks.find((b) => b.id === sourceId);
  const author = book?.author ?? "A Piano Pedagogue";
  const title = book?.title ?? "A Practice Method";

  if (sourceId === "gieseking-leimer-technique") {
    // No headings in the OCR source → whole-book body, heading "". Padded well
    // past the reader's window threshold so windowing must engage.
    const filler = Array.from(
      { length: 40 },
      (_, i) =>
        `Paragraph ${i + 1}. Visualize the passage away from the keyboard, ` +
        "hearing each voice before the hands move; the ear leads and the " +
        "fingers merely obey what the mind has already made concrete.",
    );
    const body = [...filler.slice(0, 20), contains, ...filler.slice(20)].join(
      "\n\n",
    );
    return { source_id: sourceId, title, author, heading: "", text: body };
  }

  const text = [
    "Practising is not the same as playing through. A rehearsal that only " +
      "repeats what you can already do is a comfortable way to avoid the work.",
    `${contains} The point is deliberate attention on the one thing that is ` +
      "not yet secure, at a speed slow enough that no error is rehearsed.",
    "When the passage is reliable three times in a row, and only then, let " +
      "the tempo rise by a small, honest increment.",
  ].join("\n\n");
  return {
    source_id: sourceId,
    title,
    author,
    heading: "Practising: healthy, effective and inspired",
    text,
  };
}

/**
 * A committed CheckOutcome consistent with the `rep_state` mock (block 102).
 * This is a MOCK, not a simulation: it advances the attempt ledger just enough
 * for the HUD to reconcile the returned snapshot and land a GREEN receipt. No
 * mastery/tempo logic is emulated — `new_bpm` stays null so no metronome side
 * effect fires, and `block_done` stays false.
 */
function repCheckOutcome(args: unknown): CheckOutcome {
  const record = (args ?? {}) as Record<string, unknown>;
  const verdict: Verdict =
    record.verdict === "flawed" || record.verdict === "failed"
      ? record.verdict
      : "clean";
  const note = typeof record.note === "string" ? record.note : null;
  const commandId = String(record.commandId ?? `mock-check-${mockAttemptSeq}`);
  const attemptId = ++mockAttemptSeq;
  mockAttempts += 1;
  mockCleanStreak = verdict === "clean" ? mockCleanStreak + 1 : 0;
  const nextVerdicts = {
    ...MOCK_REP_STATE.verdicts,
    [verdict]: (MOCK_REP_STATE.verdicts[verdict] ?? 0) + 1,
  };
  const snap: RepSnapshot = {
    ...MOCK_REP_STATE,
    verdicts: nextVerdicts,
    attempts_recorded: mockAttempts,
    tries: mockAttempts,
    reps_done: mockAttempts,
    current_clean_streak: mockCleanStreak,
    mastery_progress_streak: mockCleanStreak,
    best_clean_streak: Math.max(
      MOCK_REP_STATE.best_clean_streak ?? 0,
      mockCleanStreak,
    ),
    last_attempt_id: attemptId,
    last: { verdict, note, bpm: MOCK_REP_STATE.bpm },
  };
  const receipt: MutationReceipt<RepSnapshot> = {
    receipt_id: `mock-receipt-${attemptId}`,
    command_id: commandId,
    status: "committed",
    summary: `Attempt ${mockAttempts} saved — ${verdict}.`,
    value: snap,
    entity_refs: [{ entity_type: "set", entity_id: snap.block_id }],
    event_ids: [attemptId],
    undo_action: "rep_undo",
    error_code: null,
    error_detail: null,
    replayed: false,
    committed_ts: new Date().toISOString(),
  };
  return { snap, new_bpm: null, block_done: false, say: "", receipt };
}

function mockSession(): SessionView {
  const startedAt = new Date(Date.now() - 22 * 60 * 1000).toISOString();
  return {
    id: 91,
    started_at: startedAt,
    events: [
      { ts: startedAt, kind: "session_start", payload: {} },
      { ts: isoDaysAgo(0), kind: "rep_open", payload: { measures: "65–96" } },
      {
        ts: isoDaysAgo(0),
        kind: "verdict",
        payload: { verdict: "clean", bpm: 84 },
      },
    ],
  };
}

const METRO_STATE = {
  running: false,
  bpm: 92,
  beats_per_bar: 4,
  subdivision: 1,
  accent_first: true,
  sound: "click",
  gain: 0.8,
  boost: false,
};

// A complete settings snapshot so the v3 Settings workspace renders (and its
// Brain/keys/aliases rows resolve) under `npm run dev:mock`.
const SETTINGS_SNAPSHOT = {
  theme: "dark" as const,
  interface_scale: 90,
  tts_provider: "auto" as const,
  tts_voice: "Kore",
  brain_provider: "auto" as const,
  knowledge_dir: "/dev-mock/Knowledge and Resources",
  share_retrieved_knowledge: true,
  wake_word_enabled: false,
  wake_word: "coda",
  metronome_sound: "woodblock",
  metronome_boost: false,
  metronome_boost_level: 85,
  ladder_default_reps: 30,
  practice_default_clean_streak: 5,
  ladder_bpm_step: 4,
  calendar_capacity_minutes: 60,
  streak_threshold_minutes: 10,
  vault_pieces_dir: "/dev-mock/Pieces",
  verdict_aliases: { clean: [], flawed: [], failed: [] },
  api_keys: [
    { provider: "claude", configured: false, source: "none" },
    { provider: "gemini", configured: true, source: "keychain" },
  ],
};

// Truthful-status contract from Phase 1, sample values for the static harness.
const BRAIN_STATUS = { online: true, provider: "gemini", reason: null };
const BRAIN_TEST_RESULT = {
  ok: true,
  provider: "gemini",
  model: "gemini-flash-latest",
  latency_ms: 380,
  error: null,
};

function apiKeyStatus(args: unknown, configured: boolean) {
  const record = (args ?? {}) as Record<string, unknown>;
  const provider = record.provider === "claude" ? "claude" : "gemini";
  return { provider, configured, source: configured ? "keychain" : "none" };
}

function pieceIdOf(args: unknown): number {
  const record = (args ?? {}) as Record<string, unknown>;
  const raw = record.pieceId ?? record.id ?? record.piece_id;
  const value = Number(raw);
  return Number.isFinite(value) ? value : 1;
}

/**
 * A valid, blank MULTI-page PDF (correct xref) so the viewer reaches "ready".
 * Defaults to 25 pages so the mock harness actually exercises the paged,
 * virtualized viewer (Christian's real scores run ~25 pages). The page objects
 * carry a printed number so paging is visually obvious while driving.
 */
function minimalPdfBytes(pageCount = 25): ArrayBuffer {
  const total = Math.max(1, Math.floor(pageCount));
  // obj 1 = Catalog, obj 2 = Pages, obj 3..(2+total) = one Page each. A tiny
  // shared Helvetica font (obj 3+total) + per-page content streams draw the
  // page number so a real render is not a blank white sheet.
  const fontObj = 3 + total;
  const objs: string[] = [];
  objs.push("<< /Type /Catalog /Pages 2 0 R >>");
  const kids = Array.from({ length: total }, (_, i) => `${i + 3} 0 R`).join(
    " ",
  );
  objs.push(`<< /Type /Pages /Kids [${kids}] /Count ${total} >>`);
  const contentStart = fontObj + 1;
  for (let i = 0; i < total; i += 1) {
    objs.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
        `/Resources << /Font << /F1 ${fontObj} 0 R >> >> ` +
        `/Contents ${contentStart + i} 0 R >>`,
    );
  }
  objs.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  for (let i = 0; i < total; i += 1) {
    const stream = `BT /F1 48 Tf 60 700 Td (Mock score page ${i + 1} of ${total}) Tj ET`;
    objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }

  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((obj, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefStart = body.length;
  let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    xref += `${offset.toString().padStart(10, "0")} 00000 n \n`;
  }
  const full = `${body}${xref}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return new TextEncoder().encode(full).buffer;
}

function mockEdition(pieceId: number) {
  return {
    id: "score/score.pdf",
    label: "Score",
    size_bytes: 2048,
    modified_unix: 1_700_000_000,
    fingerprint: `mock-fp-${pieceId}`,
    selected: true,
  };
}

/**
 * A saved line-anchor calibration for the first piece so the Score tab shows the
 * pre-mapped-edition behavior: drawn boxes resolve to measures, and the wizard
 * pre-fills the measure "from anchors" when a click lands on a known system.
 * Pieces without an entry stay unmapped (the fresh-run path).
 */
function mockCalibration(pieceId: number): unknown {
  const points: Record<number, { page: number; y: number; measure: number }[]> =
    {
      1: [
        { page: 1, y: 0.2, measure: 1 },
        { page: 1, y: 0.34, measure: 5 },
        { page: 1, y: 0.48, measure: 9 },
        { page: 1, y: 0.62, measure: 13 },
      ],
    };
  const entry = points[pieceId];
  if (!entry) return null;
  return {
    piece_id: pieceId,
    edition_id: "score/score.pdf",
    edition_fingerprint: `mock-fp-${pieceId}`,
    method: "user_confirmed",
    confidence: 0.75,
    points: entry,
    user_verified: true,
    updated_ts: new Date().toISOString(),
  };
}

// --- Measure mapping (Plan C, task C4 + fix round 1 + C6b) -----------------
//
// Canned `measure_scan_page` outputs plus a C6b-SUBSET mirror of
// `score::measure_reconcile::reconcile` and `measure_map` CRUD against
// in-memory state, so the whole scan → reconcile → review → Apply flow is
// offline-QA-able.
//
// Scope, honestly (the same scope `mockReconcile`'s own doc comment states —
// keep the two in agreement): this is NOT full parity with the final Rust
// algorithm. There is no XML and no calibration side channel here, so
// `total_mismatch`, `anchor_disagreement`, `low_confidence_anchor` and
// `overlapping_systems` are out of scope and no fixture produces them;
// `has_pickup` is a piece-id fixture switch (`PICKUP_DEMO_PIECE_ID`) rather
// than derived from real MusicXML. What the fixtures DO exercise:
//   - page 1: a clean single system with a printed "1";
//   - page 2: a printed "10" one system later — since C6b that pair is a
//     system-start BRACKET, so page 1's system is resolved by
//     `derived_bar_count` + even interpolation, NOT the plain
//     `continuity_break` this comment used to claim (no offline
//     scan-derived continuity_break fixture remains);
//   - page 3 (`CLIENT_RASTER_PAGE`): needs-client-raster once, then unsorted
//     `barline_xs` → an `unapplyable` structural defect;
//   - `PICKUP_DEMO_PIECE_ID`: zero printed numbers anywhere → `pickup_ambiguity`.
// `measure_map_apply` re-derives the store's own whole-payload invariants
// (`measureMapApplyDefect`) so a malformed hand-edited payload is rejected
// here the same way the real command rejects it.

interface MockScanSystem {
  y_top: number;
  y_bottom: number;
  x_left: number;
  x_right: number;
  barline_xs: number[];
  printed_numbers: {
    number: number;
    x: number;
    y: number;
    confidence: number;
  }[];
  staves: number;
}

interface MockScanPageOutput {
  systems: MockScanSystem[];
}

/** Piece id whose every page reports ZERO printed numbers — with `has_pickup`
 * on (this is the piece the mock treats as pickup-having, see the
 * `measure_reconcile` case below), zero anchors is exactly the case that
 * produces `pickup_ambiguity` (no evidence anywhere to derive the pickup
 * offset from). Any other piece has `has_pickup: false`. */
const PICKUP_DEMO_PIECE_ID = 6;

/** The one page whose FIRST scan call (no `pageJpeg`) rejects with the exact
 * `needs_client_raster` literal, so the dev-mock harness can exercise the
 * client-raster retry path without a real vector-PDF edge case. Once a call
 * arrives WITH bytes, that (piece, page) is marked served and never rejects
 * again. */
const CLIENT_RASTER_PAGE = 3;

/** Page 1: a clean single system, printed number 1 pins the first bar
 * exactly — reconciling this alone produces zero conflicts. Page 2: a
 * printed "10" pinning ITS system's first bar, one system after page 1's
 * "1" — since C6b that adjacent system-start pair is a BRACKET, so
 * reconciling pages 1+2 together resolves page 1's system via
 * `derived_bar_count` + even interpolation (9 bars, not the model's 4)
 * rather than raising a `continuity_break`. Page 3 (after the
 * client-raster retry): UNSORTED `barline_xs` — a structural defect that
 * `measure_map_apply` would reject, so `mockReconcile` must flag it
 * `unapplyable` even though nothing else about the page is wrong. Any other
 * page gets a plain, unlabeled system so a full-length mock score still
 * scans end to end without inventing more conflicts. `PICKUP_DEMO_PIECE_ID`
 * overrides every page to report zero printed numbers, demonstrating the
 * pickup-ambiguity fixture regardless of which page is asked for. */
function mockScanPage(page: number, pieceId: number): MockScanPageOutput {
  if (pieceId === PICKUP_DEMO_PIECE_ID) {
    return {
      systems: [
        {
          y_top: 0.1,
          y_bottom: 0.2,
          x_left: 0.05,
          x_right: 0.9,
          barline_xs: [0.3, 0.5, 0.7, 0.9],
          printed_numbers: [],
          staves: 2,
        },
      ],
    };
  }
  if (page === 1) {
    return {
      systems: [
        {
          y_top: 0.1,
          y_bottom: 0.2,
          x_left: 0.05,
          x_right: 0.9,
          barline_xs: [0.3, 0.5, 0.7, 0.9],
          printed_numbers: [{ number: 1, x: 0.05, y: 0.09, confidence: 0.95 }],
          staves: 2,
        },
      ],
    };
  }
  if (page === 2) {
    return {
      systems: [
        {
          y_top: 0.3,
          y_bottom: 0.4,
          x_left: 0.05,
          x_right: 0.9,
          barline_xs: [0.3, 0.5, 0.7, 0.9],
          printed_numbers: [{ number: 10, x: 0.05, y: 0.29, confidence: 0.9 }],
          staves: 2,
        },
      ],
    };
  }
  if (page === CLIENT_RASTER_PAGE) {
    return {
      systems: [
        {
          y_top: 0.5,
          y_bottom: 0.6,
          x_left: 0.05,
          x_right: 0.9,
          // Deliberately unsorted (the "unsorted barline_xs" apply-invariant
          // defect, C3 fix round 1 finding #3) — same fractions as the clean
          // pages, out of order.
          barline_xs: [0.7, 0.3, 0.9, 0.5],
          printed_numbers: [],
          staves: 2,
        },
      ],
    };
  }
  return {
    systems: [
      {
        y_top: 0.1,
        y_bottom: 0.2,
        x_left: 0.05,
        x_right: 0.9,
        barline_xs: [0.4, 0.9],
        printed_numbers: [],
        staves: 2,
      },
    ],
  };
}

interface MockMapBar {
  x_right: number;
  number: number;
  confidence?: number;
  source: "model" | "user" | "interpolated";
}

interface MockMapSystem {
  y_top: number;
  y_bottom: number;
  x_left: number;
  x_right: number;
  bars: MockMapBar[];
}

interface MockMeasureMapPageRow {
  page: number;
  map: { version: number; systems: MockMapSystem[] };
}

type MockMapConflict =
  | {
      kind: "continuity_break";
      page: number;
      system: number;
      expected: number;
      found: number;
    }
  | { kind: "pickup_ambiguity"; page: number }
  | { kind: "unapplyable"; page: number; system: number; reason: string }
  | {
      kind: "derived_bar_count";
      page: number;
      system: number;
      expected: number;
      found: number;
    };

const ANCHOR_CONFIDENCE_MIN = 0.5;

/** Mirrors `score::measure_reconcile::system_index_for` — find which system
 * (by index into `starts`/`counts`) a global bar-stream index falls inside,
 * or (for an index exactly on a boundary) the system whose start exactly
 * equals it. */
function systemIndexFor(
  starts: number[],
  counts: number[],
  idx: number,
): number {
  for (let i = 0; i < starts.length; i += 1) {
    if (idx >= starts[i] && idx < starts[i] + counts[i]) return i;
  }
  for (let i = starts.length - 1; i >= 0; i -= 1) {
    if (starts[i] === idx) return i;
  }
  return -1;
}

/**
 * Mirrors `score::measure_reconcile::reconcile`'s FINAL bidirectional
 * numbering contract (C3 fix round 1, `task-C3-report.md`) PLUS the C6b
 * system-start bracket pass: a synthetic floor-start anchor is used ONLY
 * when there is no printed anchor anywhere in the whole stream; the instant
 * at least one real anchor exists, the span BEFORE it back-fills FROM it
 * (clamped at the floor — 0 with a pickup, 1 otherwise — raising a
 * `continuity_break` on the leading span if that would underflow), and
 * every span after an anchor forward-fills from its nearest preceding
 * anchor. Before any of that, when two consecutive real anchors each pin
 * their own system's first bar AND are on immediately adjacent systems, the
 * number gap between them overrides the model's own bar count for the
 * earlier anchor's system (evenly interpolated, `source: "interpolated"`,
 * `confidence: undefined`) instead of merely flagging a `continuity_break`
 * — see `measure_reconcile`'s "System-start bracketing" doc comment. Also
 * re-derives the `unapplyable` structural checks (empty/unsorted
 * `barline_xs`) `measure_map_apply` would reject, so a conflict-free mock
 * result is genuinely Apply-ready, same as the real command. No
 * XML/calibration side channel exists here, so `total_mismatch`,
 * `anchor_disagreement`, `low_confidence_anchor` and `overlapping_systems`
 * are out of scope for the mock — every fixture below only exercises
 * `continuity_break`, `pickup_ambiguity`, `unapplyable`, and (since C6b)
 * `derived_bar_count`.
 */
function mockReconcile(
  pages: { page: number; scan: MockScanPageOutput }[],
  hasPickup: boolean,
): {
  pages: MockMeasureMapPageRow[];
  conflicts: MockMapConflict[];
  total_bars: number;
  has_pickup: boolean;
} {
  const sorted = [...pages].sort((a, b) => a.page - b.page);

  interface FlatBar {
    page: number;
    system: number;
    x_right: number;
    number: number;
  }
  const flat: FlatBar[] = [];
  const systemMeta: {
    page: number;
    system: number;
    y_top: number;
    y_bottom: number;
    x_left: number;
    x_right: number;
    start: number;
    count: number;
    /** `true` once the C6b system-start bracket pass below resynthesizes
     * this system's bars — its `count` then no longer matches the model's
     * own `barline_xs.length`. */
    interpolated: boolean;
  }[] = [];
  for (const { page, scan } of sorted) {
    const systems = [...scan.systems].sort((a, b) => a.y_top - b.y_top);
    systems.forEach((system, systemIndex) => {
      const start = flat.length;
      for (const x_right of system.barline_xs) {
        flat.push({ page, system: systemIndex + 1, x_right, number: 0 });
      }
      systemMeta.push({
        page,
        system: systemIndex + 1,
        y_top: system.y_top,
        y_bottom: system.y_bottom,
        x_left: system.x_left,
        x_right: system.x_right,
        start,
        count: system.barline_xs.length,
        interpolated: false,
      });
    });
  }

  interface Anchor {
    index: number;
    number: number;
    page: number;
    system: number;
    confidence?: number;
  }
  const anchors: Anchor[] = [];
  for (const { page, scan } of sorted) {
    const metasForPage = systemMeta.filter((m) => m.page === page);
    for (const system of scan.systems) {
      for (const printed of system.printed_numbers) {
        if (printed.confidence < ANCHOR_CONFIDENCE_MIN) continue;
        const owning =
          metasForPage.find(
            (m) => printed.y >= m.y_top && printed.y <= m.y_bottom,
          ) ?? metasForPage[0];
        if (!owning || owning.count === 0) continue;
        let localIndex = 0;
        for (let i = 0; i < owning.count; i += 1) {
          localIndex = i;
          if (flat[owning.start + i].x_right >= printed.x) break;
        }
        anchors.push({
          index: owning.start + localIndex,
          number: printed.number,
          page: owning.page,
          system: owning.system,
          confidence: printed.confidence,
        });
      }
    }
  }
  anchors.sort((a, b) => a.index - b.index);
  // Keep only the first-seen anchor per bar index (contradictory printed
  // numbers pinning the identical bar silently keep the first — a documented
  // C3 carry-forward, not fixed by this round).
  const dedupedAnchors: Anchor[] = [];
  for (const anchor of anchors) {
    if (dedupedAnchors[dedupedAnchors.length - 1]?.index !== anchor.index) {
      dedupedAnchors.push(anchor);
    }
  }

  const conflicts: MockMapConflict[] = [];

  // Pass (C6b): system-start bracket resolution — mirrors
  // `score::measure_reconcile::reconcile`'s system-start bracket pass (see
  // that module's doc comment, "System-start bracketing"). Determined
  // entirely from the ORIGINAL geometry/anchors above (no cascading); then
  // `flat`/`systemMeta` are rebuilt and `dedupedAnchors`' indices remapped
  // before the numbering pass below ever runs.
  {
    const oldStarts = systemMeta.map((m) => m.start);
    const oldCounts = systemMeta.map((m) => m.count);
    const oldFlat = flat.slice();
    for (let i = 0; i < systemMeta.length - 1; i += 1) {
      const a = dedupedAnchors.find((anchor) => anchor.index === oldStarts[i]);
      const b = dedupedAnchors.find(
        (anchor) => anchor.index === oldStarts[i + 1],
      );
      if (!a || !b) continue;
      const expected = b.number - a.number;
      const found = oldCounts[i];
      // `expected <= 0` (a degenerate/contradictory anchor pair) is left to
      // the ordinary continuity-break handling below rather than
      // synthesizing a zero-or-negative-bar system.
      if (expected === found || expected <= 0) continue;
      conflicts.push({
        kind: "derived_bar_count",
        page: systemMeta[i].page,
        system: systemMeta[i].system,
        expected,
        found,
      });
      systemMeta[i].count = expected;
      systemMeta[i].interpolated = true;
    }
    let cursor = 0;
    for (const meta of systemMeta) {
      meta.start = cursor;
      cursor += meta.count;
    }
    flat.length = 0;
    systemMeta.forEach((meta, i) => {
      if (meta.interpolated) {
        const width = (meta.x_right - meta.x_left) / meta.count;
        for (let j = 0; j < meta.count; j += 1) {
          flat.push({
            page: meta.page,
            system: meta.system,
            x_right: meta.x_left + width * (j + 1),
            number: 0,
          });
        }
      } else {
        for (let k = 0; k < meta.count; k += 1) {
          flat.push({ ...oldFlat[oldStarts[i] + k], number: 0 });
        }
      }
    });
    for (const anchor of dedupedAnchors) {
      const sys = systemIndexFor(oldStarts, oldCounts, anchor.index);
      if (sys === -1) continue;
      const local = anchor.index - oldStarts[sys];
      const oldC = oldCounts[sys];
      const newC = systemMeta[sys].count;
      const newLocal =
        oldC === 0 || oldC === newC
          ? Math.min(local, Math.max(newC - 1, 0))
          : Math.min(Math.floor((local * newC) / oldC), Math.max(newC - 1, 0));
      anchor.index = systemMeta[sys].start + newLocal;
    }
  }

  const floor = hasPickup ? 0 : 1;

  if (dedupedAnchors.length === 0) {
    // Zero anchors anywhere: the synthetic start is UNCONDITIONALLY 1,
    // regardless of has_pickup — the floor (0 with a pickup) only governs
    // back-fill underflow clamping once a REAL anchor exists (see the
    // `else` branch below). Mirrors `score::measure_reconcile::reconcile`'s
    // own zero-anchor branch exactly (pinned by its
    // `pickup_without_a_pinning_printed_number_defaults_to_one_with_a_conflict`
    // test: `bars[0].number == 1` even with `has_pickup: true`).
    if (hasPickup) {
      conflicts.push({
        kind: "pickup_ambiguity",
        page: flat[0]?.page ?? sorted[0]?.page ?? 1,
      });
    }
    for (let i = 0; i < flat.length; i += 1) {
      flat[i].number = 1 + i;
    }
  } else {
    const first = dedupedAnchors[0];
    if (first.index > 0) {
      const wouldUnderflow = first.number - first.index < floor;
      for (let i = 0; i < first.index; i += 1) {
        flat[i].number = Math.max(floor, first.number - (first.index - i));
      }
      if (wouldUnderflow) {
        conflicts.push({
          kind: "continuity_break",
          page: flat[0].page,
          system: flat[0].system,
          expected: Math.max(0, first.number - floor),
          found: first.index,
        });
      }
    }
    for (let a = 0; a < dedupedAnchors.length; a += 1) {
      const anchor = dedupedAnchors[a];
      const end = dedupedAnchors[a + 1]?.index ?? flat.length;
      for (let i = anchor.index; i < end; i += 1) {
        flat[i].number = anchor.number + (i - anchor.index);
      }
    }
    for (let a = 0; a < dedupedAnchors.length - 1; a += 1) {
      const left = dedupedAnchors[a];
      const right = dedupedAnchors[a + 1];
      const expected = right.number - left.number;
      const found = right.index - left.index;
      if (expected !== found) {
        conflicts.push({
          kind: "continuity_break",
          page: left.page,
          system: left.system,
          expected: Math.max(0, expected),
          found,
        });
      }
    }
  }

  // Re-derive the exact structural invariants `measure_map_apply` enforces
  // (C3 fix round 1 finding #3's `unapplyable`): every system needs at
  // least one bar, and a system's bar `x_right`s must strictly increase.
  for (const meta of systemMeta) {
    if (meta.count === 0) {
      conflicts.push({
        kind: "unapplyable",
        page: meta.page,
        system: meta.system,
        reason: "a system needs at least one bar",
      });
      continue;
    }
    const barsInSystem = flat.slice(meta.start, meta.start + meta.count);
    for (let i = 1; i < barsInSystem.length; i += 1) {
      if (barsInSystem[i].x_right <= barsInSystem[i - 1].x_right) {
        conflicts.push({
          kind: "unapplyable",
          page: meta.page,
          system: meta.system,
          reason: "bar x_right must strictly increase within a system",
        });
        break;
      }
    }
  }

  const anchorConfidenceByIndex = new Map(
    dedupedAnchors.map((anchor) => [anchor.index, anchor.confidence]),
  );
  const resultPages: MockMeasureMapPageRow[] = sorted.map(({ page }) => {
    const metas = systemMeta.filter((m) => m.page === page);
    const systems: MockMapSystem[] = metas.map((meta) => ({
      y_top: meta.y_top,
      y_bottom: meta.y_bottom,
      x_left: meta.x_left,
      x_right: meta.x_right,
      bars: flat
        .slice(meta.start, meta.start + meta.count)
        .map((bar, localIndex) => ({
          x_right: bar.x_right,
          number: bar.number,
          confidence: meta.interpolated
            ? undefined
            : anchorConfidenceByIndex.get(meta.start + localIndex),
          source: meta.interpolated
            ? ("interpolated" as const)
            : ("model" as const),
        })),
    }));
    return { page, map: { version: 1, systems } };
  });

  return {
    pages: resultPages,
    conflicts,
    total_bars: flat.length,
    has_pickup: hasPickup,
  };
}

/** `(piece_id, edition_fingerprint)` -> applied map, exactly like the real
 * `measure_map` table's identity key (`edition_id` is accepted but not part
 * of it — see `store::measure_map`'s module docs). */
const MOCK_MEASURE_MAP = new Map<string, MockMeasureMapPageRow[]>();

function measureMapKey(pieceId: number, fingerprint: string): string {
  return `${pieceId}::${fingerprint}`;
}

/** Re-derives the whole-payload invariants `store::measure_map`'s
 * `validate_page` / `validate_page_systems` enforce (see
 * `measure_map_payload_defects`' doc comment for the authoritative list), and
 * returns the first violation's message — or `null` when the payload is
 * applyable.
 *
 * Apply is reachable with geometry that never went back through
 * `measure_reconcile` (a barline drag, a hand-edited page), so this mock's
 * Apply has to validate for itself: without it the mock accepted payloads the
 * real Rust command rejects, which is exactly the parity gap that let live QA
 * "apply" malformed geometry offline. Fail-fast, like the Rust checker. */
function measureMapApplyDefect(pages: MockMeasureMapPageRow[]): string | null {
  const seenPages = new Set<number>();
  const isFraction = (value: unknown): value is number =>
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1;

  let lastNumber: number | null = null;
  for (const row of [...pages].sort((a, b) => a.page - b.page)) {
    const page = row.page;
    if (!Number.isInteger(page) || page < 1) {
      return `page ${page}: page numbers start at 1`;
    }
    if (seenPages.has(page)) return `page ${page}: duplicate page ${page}`;
    seenPages.add(page);
    if (row.map?.version !== 1) {
      return `page ${page}: unsupported measure map version ${row.map?.version} (expected 1)`;
    }

    let prevYTop: number | null = null;
    for (const system of row.map.systems ?? []) {
      for (const [field, value] of [
        ["system y_top", system.y_top],
        ["system y_bottom", system.y_bottom],
        ["system x_left", system.x_left],
        ["system x_right", system.x_right],
      ] as const) {
        if (!isFraction(value)) {
          return `page ${page}: ${field} must be a normalized 0..=1 fraction`;
        }
      }
      if (system.y_top >= system.y_bottom) {
        return `page ${page}: system y_top must be less than y_bottom`;
      }
      if (system.x_left >= system.x_right) {
        return `page ${page}: system x_left must be less than x_right`;
      }
      if (prevYTop !== null && system.y_top <= prevYTop) {
        return `page ${page}: systems must be ordered top-to-bottom (y_top strictly increasing)`;
      }
      prevYTop = system.y_top;

      if (!system.bars || system.bars.length === 0) {
        return `page ${page}: a system needs at least one bar`;
      }
      let prevXRight: number | null = null;
      for (const bar of system.bars) {
        if (!isFraction(bar.x_right)) {
          return `page ${page}: bar x_right must be a normalized 0..=1 fraction`;
        }
        if (prevXRight !== null && bar.x_right <= prevXRight) {
          return `page ${page}: bar x_right must strictly increase within a system`;
        }
        prevXRight = bar.x_right;
        if (bar.confidence != null && !isFraction(bar.confidence)) {
          return `page ${page}: bar confidence must be a normalized 0..=1 fraction`;
        }
        if (lastNumber !== null && bar.number <= lastNumber) {
          return `page ${page}: bar numbers must strictly increase (bar ${bar.number} follows ${lastNumber})`;
        }
        lastNumber = bar.number;
      }
    }
  }
  return null;
}

/** The EXACT literal `score::measure_scan::ScanError::NeedsClientRaster`
 * serializes to — matched verbatim by the frontend's `isNeedsClientRaster`. */
const NEEDS_CLIENT_RASTER_LITERAL = "needs_client_raster";

/** `(piece_id, page)` keys already served a client-rasterized JPEG for
 * `CLIENT_RASTER_PAGE` — the "once" in "errors once, then accepts bytes". */
const CLIENT_RASTER_SERVED = new Set<string>();

// --- Pencil marks on the score -------------------------------------------
//
// STATEFUL, like the notebook maps below, so the browser harness exercises the
// real draw → persist → reopen round-trip. Keyed exactly as the Rust store keys
// it — piece + edition id + edition fingerprint + page — so the dev run proves
// the same isolation guarantees (marks never bleed between editions) rather
// than a looser mock version of them. Ids ascend, which is also undo order.

interface MockMark {
  id: number;
  page: number;
  width: number;
  points: Array<{ x: number; y: number }>;
}

const SCORE_MARKS = new Map<string, MockMark[]>();
let nextMarkId = 1;

function markKey(args: Record<string, unknown>, withPage: boolean): string {
  const piece = Number(args.pieceId ?? args.piece_id ?? 0);
  const edition = String(args.editionId ?? args.edition_id ?? "");
  const fingerprint = String(
    args.editionFingerprint ?? args.edition_fingerprint ?? "",
  );
  const page = Number(args.page ?? 0);
  return withPage
    ? `${piece} ${edition} ${fingerprint} ${page}`
    : `${piece} ${edition} ${fingerprint} `;
}

/** Strokes stored for this piece+edition under any OTHER fingerprint. */
function staleMarkCount(args: Record<string, unknown>): number {
  const piece = Number(args.pieceId ?? args.piece_id ?? 0);
  const edition = String(args.editionId ?? args.edition_id ?? "");
  const fingerprint = String(
    args.editionFingerprint ?? args.edition_fingerprint ?? "",
  );
  let count = 0;
  for (const [key, marks] of SCORE_MARKS) {
    const [keyPiece, keyEdition, keyFingerprint] = key.split(" ");
    if (
      Number(keyPiece) === piece &&
      keyEdition === edition &&
      keyFingerprint !== fingerprint
    ) {
      count += marks.length;
    }
  }
  return count;
}

// --- Practice notebook (day sheet + piece plan) ---------------------------
//
// Unlike the read-only samples above these are STATEFUL and date/piece-keyed, so
// the browser harness exercises real save→reload round-trips. Saves validate and
// re-serialize through the shared `parseBodyJson`/`assertPiecePlanText`, i.e. the
// same canonical rules the Rust backend applies: unknown line types/fields and
// out-of-bound values REJECT (a thrown string → a rejected invoke promise), and
// stored bodies are canonical (`checked` defaulted, null optionals dropped). Both
// maps are cleared on each install so tests start from an empty backend.

const DAY_SHEETS = new Map<string, DaySheet>();
const PIECE_PLANS = new Map<number, PiecePlan>();

// --- History day-timeline (Task B2) ----------------------------------------
//
// Deterministic, read-only fixtures for `history_days`/`history_day_detail`/
// `day_sheets_range` (task B1's three commands). Five days: a recent
// single-piece day, a multi-piece day, a day with a mastered set, another
// normal day, and — deliberately dated 150 days back, OUTSIDE the
// DayTimeline's initial 120-day fetch window — a 50-set QA stress-test day
// that only becomes reachable once "Earlier days" extends the window. This
// keeps the default view uncluttered while still exercising the dense-list
// render path live in `npm run dev:mock`.

const HISTORY_DAY_RECENT = dayLocalOffset(-2);
const HISTORY_DAY_MULTI_PIECE = dayLocalOffset(-5);
const HISTORY_DAY_MASTERED = dayLocalOffset(-10);
const HISTORY_DAY_NORMAL = dayLocalOffset(-20);
const HISTORY_DAY_DENSE = dayLocalOffset(-150);

// Task B3: TODAY needs its own "done" evidence, paired with `seedQaFixtures`'s
// TODAY day sheet (20 planned minutes), so the Calendar's planned-vs-done cell
// for today shows live non-empty data in `npm run dev:mock` rather than the
// "cells with neither" empty state (spec S7 — today stops showing empty).
const HISTORY_DAY_TODAY: HistoryDaySummary = {
  date: TODAY,
  focused_seconds: 14 * 60,
  session_count: 1,
  attempts: 5,
  cleans: 4,
  sets_touched: 1,
  mastered_sets: 0,
  pieces: [{ piece_id: 1, title: "Scherzo No. 2", attempts: 5 }],
};

const HISTORY_DAY_SUMMARIES: HistoryDaySummary[] = [
  HISTORY_DAY_TODAY,
  {
    date: HISTORY_DAY_RECENT,
    focused_seconds: 42 * 60,
    session_count: 1,
    attempts: 12,
    cleans: 8,
    sets_touched: 3,
    mastered_sets: 0,
    pieces: [{ piece_id: 1, title: "Scherzo No. 2", attempts: 12 }],
  },
  {
    date: HISTORY_DAY_MULTI_PIECE,
    focused_seconds: 55 * 60,
    session_count: 2,
    attempts: 20,
    cleans: 14,
    sets_touched: 5,
    mastered_sets: 0,
    pieces: [
      { piece_id: 1, title: "Scherzo No. 2", attempts: 12 },
      { piece_id: 2, title: "The White Peacock", attempts: 8 },
    ],
  },
  {
    date: HISTORY_DAY_MASTERED,
    focused_seconds: 30 * 60,
    session_count: 1,
    attempts: 10,
    cleans: 9,
    sets_touched: 2,
    mastered_sets: 1,
    pieces: [{ piece_id: 1, title: "Scherzo No. 2", attempts: 10 }],
  },
  {
    date: HISTORY_DAY_NORMAL,
    focused_seconds: 18 * 60,
    session_count: 1,
    attempts: 6,
    cleans: 3,
    sets_touched: 2,
    mastered_sets: 0,
    pieces: [{ piece_id: 2, title: "The White Peacock", attempts: 6 }],
  },
  {
    date: HISTORY_DAY_DENSE,
    focused_seconds: 180 * 60,
    session_count: 4,
    attempts: 400,
    cleans: 250,
    sets_touched: 50,
    mastered_sets: 3,
    pieces: [
      { piece_id: 1, title: "Scherzo No. 2", attempts: 250 },
      { piece_id: 2, title: "The White Peacock", attempts: 150 },
    ],
  },
];

function historyDaySet(
  date: string,
  index: number,
  overrides: Partial<HistoryDaySet> = {},
): HistoryDaySet {
  return {
    block_id: 9_000 + index,
    piece_id: index % 2 === 0 ? 1 : 2,
    piece_title: index % 2 === 0 ? "Scherzo No. 2" : "The White Peacock",
    region_name: index % 3 === 0 ? null : `Section ${index + 1}`,
    m_start: index * 4 + 1,
    m_end: index * 4 + 8,
    attempts: 8,
    cleans: 5,
    flawed: 2,
    failed: 1,
    start_bpm: 72,
    end_bpm: 96,
    mastery_status: index % 10 === 0 ? "satisfied" : "not_satisfied",
    first_ts: `${date}T10:00:00Z`,
    last_ts: `${date}T10:30:00Z`,
    ...overrides,
  };
}

function historyDaySession(
  date: string,
  sessionId: number,
  overrides: Partial<HistoryDaySession> = {},
): HistoryDaySession {
  return {
    session_id: sessionId,
    started_at: `${date}T09:00:00Z`,
    ended_at: `${date}T09:45:00Z`,
    focused_seconds: 30 * 60,
    ...overrides,
  };
}

const HISTORY_DAY_DETAILS = new Map<string, HistoryDayDetail>([
  [
    TODAY,
    {
      date: TODAY,
      sessions: [historyDaySession(TODAY, 500, { focused_seconds: 14 * 60 })],
      sets: [historyDaySet(TODAY, 0, { attempts: 5, cleans: 4 })],
    },
  ],
  [
    HISTORY_DAY_RECENT,
    {
      date: HISTORY_DAY_RECENT,
      sessions: [historyDaySession(HISTORY_DAY_RECENT, 501)],
      sets: [
        historyDaySet(HISTORY_DAY_RECENT, 0, { attempts: 5, cleans: 3 }),
        historyDaySet(HISTORY_DAY_RECENT, 1, { attempts: 4, cleans: 3 }),
        historyDaySet(HISTORY_DAY_RECENT, 2, { attempts: 3, cleans: 2 }),
      ],
    },
  ],
  [
    HISTORY_DAY_MULTI_PIECE,
    {
      date: HISTORY_DAY_MULTI_PIECE,
      sessions: [
        historyDaySession(HISTORY_DAY_MULTI_PIECE, 502, {
          started_at: `${HISTORY_DAY_MULTI_PIECE}T08:00:00Z`,
          ended_at: `${HISTORY_DAY_MULTI_PIECE}T08:30:00Z`,
          focused_seconds: 25 * 60,
        }),
        historyDaySession(HISTORY_DAY_MULTI_PIECE, 503, {
          started_at: `${HISTORY_DAY_MULTI_PIECE}T18:00:00Z`,
          ended_at: `${HISTORY_DAY_MULTI_PIECE}T18:30:00Z`,
          focused_seconds: 30 * 60,
        }),
      ],
      sets: Array.from({ length: 5 }, (_, index) =>
        historyDaySet(HISTORY_DAY_MULTI_PIECE, index),
      ),
    },
  ],
  [
    HISTORY_DAY_MASTERED,
    {
      date: HISTORY_DAY_MASTERED,
      sessions: [historyDaySession(HISTORY_DAY_MASTERED, 504)],
      sets: [
        historyDaySet(HISTORY_DAY_MASTERED, 0, {
          attempts: 6,
          cleans: 6,
          flawed: 0,
          failed: 0,
          mastery_status: "satisfied",
        }),
        historyDaySet(HISTORY_DAY_MASTERED, 1, { attempts: 4, cleans: 3 }),
      ],
    },
  ],
  [
    HISTORY_DAY_NORMAL,
    {
      date: HISTORY_DAY_NORMAL,
      sessions: [historyDaySession(HISTORY_DAY_NORMAL, 505)],
      sets: [
        historyDaySet(HISTORY_DAY_NORMAL, 1, { attempts: 3, cleans: 2 }),
        historyDaySet(HISTORY_DAY_NORMAL, 3, { attempts: 3, cleans: 1 }),
      ],
    },
  ],
  [
    HISTORY_DAY_DENSE,
    {
      date: HISTORY_DAY_DENSE,
      sessions: [
        historyDaySession(HISTORY_DAY_DENSE, 506),
        historyDaySession(HISTORY_DAY_DENSE, 507),
        historyDaySession(HISTORY_DAY_DENSE, 508),
        historyDaySession(HISTORY_DAY_DENSE, 509),
      ],
      // The QA stress case: 50 sets in one day.
      sets: Array.from({ length: 50 }, (_, index) =>
        historyDaySet(HISTORY_DAY_DENSE, index),
      ),
    },
  ],
]);

function withinRange(date: string, from: string, to: string): boolean {
  return date >= from && date <= to;
}

function historyDaysMock(args: unknown): HistoryDaySummary[] {
  const record = argsRecord(args);
  const from = String(record.from ?? "");
  const to = String(record.to ?? "");
  return HISTORY_DAY_SUMMARIES.filter((day) =>
    withinRange(day.date, from, to),
  ).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

// Day streak (Task A2) — derived from the SAME `HISTORY_DAY_SUMMARIES` fixture
// `history_days` serves, so the mock can never show a streak the mock history
// does not support. Mirrors `src-tauri/src/store/streaks.rs`: a day joins the
// streak once its focused seconds clear the threshold; `current_days` is the
// consecutive run ending today (or yesterday, so a streak in progress is not
// declared dead before today has had its chance); `best_days` is the longest
// run anywhere in the fixture.
const STREAK_THRESHOLD_MINUTES = 10;

/** The longest run of consecutive calendar days in an unsorted day list. */
function longestRun(days: string[]): number {
  const ordinals = [...new Set(days)]
    .map((day) => Date.parse(`${day}T00:00:00Z`) / 86_400_000)
    .sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  let previous: number | null = null;
  for (const ordinal of ordinals) {
    run = previous !== null && ordinal === previous + 1 ? run + 1 : 1;
    best = Math.max(best, run);
    previous = ordinal;
  }
  return best;
}

/** The run of consecutive qualifying days ending at `today` (or `today - 1`,
 * so a streak in progress is not declared dead before today has had its
 * chance). Zero when the most recent qualifying day is older than that. */
function trailingRun(days: string[], today: string): number {
  const ordinals = new Set(
    days.map((day) => Date.parse(`${day}T00:00:00Z`) / 86_400_000),
  );
  const todayOrdinal = Date.parse(`${today}T00:00:00Z`) / 86_400_000;
  let anchor = todayOrdinal;
  if (!ordinals.has(anchor)) {
    anchor -= 1;
    if (!ordinals.has(anchor)) return 0;
  }
  let run = 0;
  let cursor = anchor;
  while (ordinals.has(cursor)) {
    run += 1;
    cursor -= 1;
  }
  return run;
}

function streakSummaryMock(): StreakSummary {
  const qualifying = HISTORY_DAY_SUMMARIES.filter(
    (day) => day.focused_seconds >= STREAK_THRESHOLD_MINUTES * 60,
  )
    .map((day) => day.date)
    .sort();
  const today = todayLocal();
  return {
    current_days: trailingRun(qualifying, today),
    best_days: longestRun(qualifying),
    threshold_minutes: STREAK_THRESHOLD_MINUTES,
    today_focused_seconds:
      HISTORY_DAY_SUMMARIES.find((day) => day.date === today)?.focused_seconds ?? 0,
  };
}

function historyDayDetailMock(args: unknown): HistoryDayDetail {
  const date = String(argsRecord(args).date ?? "");
  return HISTORY_DAY_DETAILS.get(date) ?? { date, sessions: [], sets: [] };
}

function daySheetsRangeMock(args: unknown): DaySheet[] {
  const record = argsRecord(args);
  const from = String(record.from ?? "");
  const to = String(record.to ?? "");
  return [...DAY_SHEETS.values()]
    .filter((sheet) => withinRange(sheet.date, from, to))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

function argsRecord(args: unknown): Record<string, unknown> {
  return (args ?? {}) as Record<string, unknown>;
}

/** Re-throw a validation Error as the plain string the contract rejects with. */
function asRejectionString(cause: unknown): never {
  throw cause instanceof Error ? cause.message : String(cause);
}

function daySheetGet(args: unknown): DaySheet | null {
  const date = String(argsRecord(args).date ?? "");
  return DAY_SHEETS.get(date) ?? null;
}

function daySheetSave(args: unknown): DaySheet {
  const record = argsRecord(args);
  const date = String(record.date ?? "");
  if (!date) throw "day_sheet_save requires a date";
  let body: NotebookLine[];
  try {
    body = parseBodyJson(String(record.bodyJson ?? ""));
  } catch (cause) {
    asRejectionString(cause);
  }
  const saved: DaySheet = { date, body, updated_at: new Date().toISOString() };
  DAY_SHEETS.set(date, saved);
  return saved;
}

// Fix wave item 12: `DAY_SHEETS` starts genuinely empty (see the comment
// above) — correct for every automated test, which seeds exactly what it
// needs through `day_sheet_save`, but it left the interactive `dev:mock`
// harness with NOTHING to browse: carry-forward, plan totals, and
// pin-from-day-sheet all need a PAST day with real content and a TODAY sheet
// with a timed line + a goal reference to exercise at all. Deliberately
// opt-in (see `installTauriDevMock`'s `seedQaFixtures` option) — the test
// suite's `installTauriDevMock()` calls stay exactly as empty as before,
// this only runs for the real interactive harness (main.tsx).
function seedQaFixtures(): void {
  DAY_SHEETS.set(YESTERDAY, {
    date: YESTERDAY,
    body: [
      { type: "piece", piece_id: 1 },
      { type: "item", text: "Slow hands separately, m. 65-96", checked: false },
      {
        type: "item",
        text: "Voice the melody over the tremolo",
        checked: false,
      },
      { type: "block", minutes: 25, piece_id: 1 },
    ],
    updated_at: isoDaysAgo(1),
  });
  DAY_SHEETS.set(TODAY, {
    date: TODAY,
    body: [
      { type: "piece", piece_id: 1 },
      { type: "block", minutes: 20, piece_id: 1 },
      { type: "goal_ref", goal_id: 1 },
    ],
    updated_at: new Date().toISOString(),
  });
}

function piecePlanGet(args: unknown): PiecePlan | null {
  const record = argsRecord(args);
  const pieceId = Number(record.pieceId ?? record.piece_id);
  return PIECE_PLANS.get(pieceId) ?? null;
}

function piecePlanSave(args: unknown): PiecePlan {
  const record = argsRecord(args);
  const pieceId = Number(record.pieceId ?? record.piece_id);
  if (!Number.isInteger(pieceId) || pieceId < 1) {
    throw "piece_plan_save requires a piece id";
  }
  let bodyText: string;
  try {
    bodyText = assertPiecePlanText(String(record.bodyText ?? ""));
  } catch (cause) {
    asRejectionString(cause);
  }
  const saved: PiecePlan = {
    piece_id: pieceId,
    body_text: bodyText,
    updated_at: new Date().toISOString(),
  };
  PIECE_PLANS.set(pieceId, saved);
  return saved;
}

/**
 * Coherent sample data for LOAD-path commands only. Any unmapped command (a
 * mutation or a not-yet-exercised read) returns `null`: the read paths guard
 * `?? []`/`?? null`, and mutations are out of scope for this static harness.
 */
function routeCommand(cmd: string, args: unknown): unknown {
  switch (cmd) {
    // Shell-level mounts.
    case "settings_snapshot":
      return SETTINGS_SNAPSHOT;
    case "settings_update": {
      const patch =
        ((args ?? {}) as { patch?: Record<string, unknown> }).patch ?? {};
      return { ...SETTINGS_SNAPSHOT, ...patch };
    }
    case "brain_status":
      return BRAIN_STATUS;
    case "brain_test_connection":
      return BRAIN_TEST_RESULT;
    case "brain_thread_resume":
      return { thread_id: 8_001, turns: [] };
    case "brain_thread_clear":
      return null;
    case "brain_plan_preview":
      return [];
    case "brain_ask":
      return {
        id: `mock-brain-${Date.now()}`,
        answer:
          "The record shows repeated development work below the target tempo. Keep the selected section narrow, name one judging axis, and require the clean streak before raising the condition.",
        provider: "offline",
        citations: [
          {
            source_id: "mock-ledger",
            label: "Practice history",
            excerpt: "Development: recent work at 84 BPM with mixed outcomes.",
          },
        ],
        methods: [],
        intake_review: null,
        proposed_action: null,
        grounding: {
          piece_title: "Scherzo No. 2",
          region_name: "Development",
          measure_range: [65, 96],
          recent_rep_count: mockAttempts,
          active_block_included: true,
          knowledge_status: "ready",
          knowledge_shared_with_provider: false,
          knowledge_sources: ["Practice history"],
          musicxml_status: "ready",
          warnings: ["Browser mock response; native provider was not called."],
        },
      };
    // Passage-helper (C4): canned strategies, one cited into the corpus so the
    // reader marker is exercised. In expand mode return one fuller ≤3-line row.
    case "assistant_suggest":
      return mockAssistantSuggest(args);
    case "api_key_save":
      return apiKeyStatus(args, true);
    case "api_key_clear":
      return apiKeyStatus(args, false);

    // Books panel (D3): data-driven corpus registry.
    case "books_list":
      return mockBooks;
    case "book_add":
      // Native validation failures arrive as rejected promises; mirror that so
      // the seam never throws synchronously out of `invoke`.
      try {
        return mockBookAdd(args);
      } catch (reason) {
        return Promise.reject(reason);
      }
    case "book_remove": {
      const id = String(((args ?? {}) as { id?: unknown }).id ?? "");
      mockBooks = mockBooks.filter((book) => book.id !== id);
      return null;
    }
    // Excerpt reader (D2): canned section for any book; the OCR book returns a
    // huge heading-less body to exercise client-side windowing.
    case "book_excerpt":
      return mockBookExcerpt(args);
    case "rep_state":
      return {
        ...MOCK_REP_STATE,
        set_state: mockSetState,
        timer_state: mockSetState,
      };
    // Task A10: the composer/block-open flow's single write. Round-trips
    // `context.pass_seconds` (see `mockLastOpenedPassSeconds`) without
    // otherwise changing any other mocked read/write path.
    case "rep_open": {
      const record = (args ?? {}) as { args?: unknown; context?: unknown };
      return repOpenSnapshot(record.args, record.context);
    }
    // Clean/Sloppy/Again in the HUD: return a committed CheckOutcome so the
    // receipt lands GREEN (previously unmapped → null → red error receipt).
    case "rep_check":
      return repCheckOutcome(args);
    // Task A4: the rep HUD's existing Pause/Resume toggle and the paused-sets
    // tray's Resume button both call these two commands — no separate mock
    // write path, matching the real backend.
    case "rep_pause": {
      const commandId = String(
        ((args ?? {}) as { commandId?: unknown }).commandId ?? "mock-pause",
      );
      return repPauseReceipt(commandId);
    }
    case "rep_resume": {
      const record = (args ?? {}) as { commandId?: unknown; setId?: unknown };
      const commandId = String(record.commandId ?? "mock-resume");
      const setId = typeof record.setId === "number" ? record.setId : undefined;
      return repResumeReceipt(commandId, setId);
    }
    // Fix wave item 8: see `repCheckpointReceipt` — the 15s focused-time
    // heartbeat now has a real (committed) mock handler instead of falling
    // through to `default: return null`.
    case "rep_checkpoint": {
      const commandId = String(
        ((args ?? {}) as { commandId?: unknown }).commandId ??
          "mock-checkpoint",
      );
      return repCheckpointReceipt(commandId);
    }
    case "sets_paused_list":
      return mockPausedSets;
    case "metro_state":
      return METRO_STATE;
    case "session_current":
      return mockSession();
    case "voice_state":
      return { muted: false, down: null };

    // Repertoire / Atlas / Ledger.
    case "pieces_list":
    case "pieces_scan":
      return PIECES;

    // Add-a-score (IMSLP) flow. Canned data so the panel is fully browsable in
    // the dev harness without any network.
    // NOTE: this mock SHADOWS the real backend whenever VITE_DEV_MOCK is set —
    // results seen under `npm run dev:mock` prove the panel's rendering, never
    // that live IMSLP works. Use the native app (or the `live_search_smoke`
    // Rust test) for that.
    case "imslp_search": {
      const q = String(
        ((args ?? {}) as { query?: unknown }).query ?? "",
      ).trim();
      if (!q) return [];
      // Dev affordance: a query containing "fail" rejects, so the panel's error
      // state is drivable without unplugging the network. Native failures
      // arrive as rejected promises; mirror that rather than throwing.
      if (/fail/i.test(q)) {
        return Promise.reject(
          new Error(
            "Could not reach IMSLP. Check your connection and try again.",
          ),
        );
      }
      // Filter like a real full-text search would. Returning the same canned
      // hits for literally any query made the "no matches" state unreachable in
      // dev, which is exactly how a broken search hides.
      const terms = q.toLowerCase().split(/\s+/);
      return IMSLP_HITS.filter((hit) => {
        const haystack = `${hit.title} ${hit.snippet}`.toLowerCase();
        return terms.every((term) => haystack.includes(term));
      });
    }
    case "imslp_editions":
      return IMSLP_EDITIONS;
    case "imslp_open_download":
      return IMSLP_FILE_INFO;
    case "piece_import_pdf":
      return "/vault/Pieces/Chopin - Nocturne";
    case "piece_archive":
      return PIECES.filter((p) => p.id !== pieceIdOf(args));
    case "piece_open_source_url":
      return null;
    case "downloads_list":
      return MOCK_DOWNLOADS;
    case "pick_import_file":
      return null;
    case "piece_get": {
      const detail = PIECE_DETAILS[pieceIdOf(args)];
      if (!detail) return null;
      const id = pieceIdOf(args);
      return MOCK_BANNERS.has(id)
        ? { ...detail, banner_text: MOCK_BANNERS.get(id) ?? null }
        : detail;
    }
    // Task A11: the score goals banner. Length is bounded exactly as the Rust
    // command bounds it, so the browser harness rejects an over-long pin the
    // same way native does.
    case "piece_banner_set": {
      const id = pieceIdOf(args);
      const detail = PIECE_DETAILS[id];
      if (!detail) throw `piece ${id} not found`;
      const raw = ((args ?? {}) as { text?: string | null }).text ?? null;
      const text = raw == null || raw.trim() === "" ? null : raw;
      if (text != null && Array.from(text).length > BANNER_MAX_CHARS) {
        throw `A score banner is limited to ${BANNER_MAX_CHARS} characters (that one is ${Array.from(text).length}).`;
      }
      MOCK_BANNERS.set(id, text);
      return { ...detail, banner_text: text };
    }
    case "region_list":
      return REGIONS[pieceIdOf(args)] ?? [];

    // Task C5: full region_create/region_delete coverage (parent-linkage
    // validation + cascade/promote) so the snap-selection + sub-sections
    // flow QAs offline, matching the real store's friendly-error and
    // transactional semantics.
    case "region_create": {
      const record = argsRecord(args);
      const created = argsRecord(record.args);
      const pieceId = Number(created.piece_id);
      const parentIdRaw = record.parent_region_id;
      const parentId =
        parentIdRaw == null || parentIdRaw === "" ? null : Number(parentIdRaw);
      try {
        if (parentId != null) {
          const parent = mockFindRegion(parentId);
          if (!parent) {
            throw new Error("the parent section could not be found");
          }
          if (parent.piece_id !== pieceId) {
            throw new Error(
              "a sub-section's parent must belong to the same piece",
            );
          }
          if (parent.parent_region_id != null) {
            throw new Error(
              "a sub-section cannot itself have sub-sections (only one level of nesting is allowed)",
            );
          }
        }
        const region: Region = {
          id: mockRegionNextId++,
          piece_id: pieceId,
          name: String(created.name ?? ""),
          notes: (created.notes as string | null) ?? null,
          m_start: Number(created.m_start),
          m_end: Number(created.m_end),
          kind: String(created.kind ?? "hard_spot"),
          order: (REGIONS[pieceId] ?? []).length,
          color: null,
          pdf_anchor: null,
          parent_region_id: parentId,
        };
        REGIONS[pieceId] = [...(REGIONS[pieceId] ?? []), region];
        return region;
      } catch (cause) {
        asRejectionString(cause);
      }
      break;
    }
    case "region_delete": {
      const record = argsRecord(args);
      const id = Number(record.id);
      const mode = record.mode === "promote" ? "promote" : "cascade";
      const target = mockFindRegion(id);
      if (!target) return null;
      const children = mockAllRegions().filter(
        (region) => region.parent_region_id === id,
      );
      if (mode === "promote") {
        for (const child of children) child.parent_region_id = null;
      } else {
        const childIds = new Set(children.map((child) => child.id));
        REGIONS[target.piece_id] = (REGIONS[target.piece_id] ?? []).filter(
          (region) => !childIds.has(region.id),
        );
      }
      REGIONS[target.piece_id] = (REGIONS[target.piece_id] ?? []).filter(
        (region) => region.id !== id,
      );
      return null;
    }

    // Score atlas: one blank edition + a saved line-anchor calibration for
    // piece 1 (his six pieces are pre-mapped), so the Score tab reaches "ready",
    // drawn boxes resolve to measures, and the Map-this-score wizard shows the
    // "from anchors" measure-number prefill. Other pieces stay unmapped so the
    // fresh-run auto-offer path is still exercisable.
    case "score_pdf_editions":
      return [mockEdition(pieceIdOf(args))];
    case "score_pdf_select":
      return mockEdition(pieceIdOf(args));
    case "score_pdf_bytes":
      return minimalPdfBytes();
    // The screen-resolution page-image fast path. An EMPTY answer is the real
    // command's way of saying "this page is not a single-image scan", and the
    // mock's one-page vector PDF is exactly that case — so the browser dev run
    // exercises the PDF.js fallback, which is the behaviour it should have.
    case "score_page_image":
      return new Uint8Array(0);
    case "score_page_image_warm":
      return null;
    case "score_calibration_get":
      return mockCalibration(pieceIdOf(args));
    case "score_calibration_save": {
      const record = (args ?? {}) as Record<string, unknown>;
      const points = (() => {
        try {
          return JSON.parse(String(record.pointsJson ?? "[]"));
        } catch {
          return [];
        }
      })();
      return {
        piece_id: pieceIdOf(args),
        edition_id: String(record.editionId ?? "score/score.pdf"),
        edition_fingerprint: String(record.editionFingerprint ?? "mock-fp"),
        method: "user_confirmed",
        confidence: 0.75,
        points,
        user_verified: Boolean(record.userVerified),
        updated_ts: new Date().toISOString(),
      };
    }
    case "score_marks_page": {
      const record = argsRecord(args);
      return {
        marks: SCORE_MARKS.get(markKey(record, true)) ?? [],
        stale_marks: staleMarkCount(record),
      };
    }
    case "score_mark_add": {
      const record = argsRecord(args);
      const points = JSON.parse(String(record.pointsJson ?? "[]")) as Array<{
        x: number;
        y: number;
      }>;
      if (!Array.isArray(points) || points.length < 2) {
        throw new Error("a score mark needs at least 2 points");
      }
      const mark: MockMark = {
        id: nextMarkId++,
        page: Number(record.page ?? 1),
        width: Number(record.width ?? 0.0022),
        points,
      };
      const key = markKey(record, true);
      SCORE_MARKS.set(key, [...(SCORE_MARKS.get(key) ?? []), mark]);
      return mark;
    }
    case "score_mark_undo": {
      const key = markKey(argsRecord(args), true);
      const marks = SCORE_MARKS.get(key) ?? [];
      const last = marks[marks.length - 1];
      if (!last) return null;
      SCORE_MARKS.set(key, marks.slice(0, -1));
      return last.id;
    }
    case "score_marks_clear_page": {
      const key = markKey(argsRecord(args), true);
      const removed = (SCORE_MARKS.get(key) ?? []).length;
      SCORE_MARKS.set(key, []);
      return removed;
    }
    case "rep_blocks_for_piece":
      return BLOCKS[pieceIdOf(args)] ?? [];
    case "reps_for_block": {
      const record = (args ?? {}) as Record<string, unknown>;
      const blockId = Number(record.blockId ?? record.block_id);
      return REPS_BY_BLOCK[blockId] ?? [];
    }
    case "progress_summary":
      return PROGRESS[pieceIdOf(args)] ?? null;
    case "goal_list":
      return goalListFor(pieceIdOf(args));
    case "goal_create":
      return goalCreate(args);
    case "goal_update":
      return goalUpdate(args);
    case "anomalies_list":
      return anomalies();

    // Today / Universe.
    case "universe_snapshot":
      return universeSnapshot();

    // Day streak (Task A2) — derived from the same fixture days history_days
    // serves, so the mock can never show a streak the mock history does not
    // support.
    case "streak_summary":
      return streakSummaryMock();

    // Calendar / composer.
    case "daily_work_list":
      return dailyWork();
    case "recovery_preview":
      return recoveryPreview();
    case "retention_due":
      return retentionDue();

    // Practice notebook — stateful, date/piece-keyed round-trips.
    case "day_sheet_get":
      return daySheetGet(args);
    case "day_sheet_save":
      return daySheetSave(args);
    case "piece_plan_get":
      return piecePlanGet(args);
    case "piece_plan_save":
      return piecePlanSave(args);

    // History day-timeline (Task B2) — read-only, deterministic fixtures.
    case "history_days":
      return historyDaysMock(args);
    case "history_day_detail":
      return historyDayDetailMock(args);
    case "day_sheets_range":
      return daySheetsRangeMock(args);

    // Measure mapping (Plan C, task C4 + fix round 1) — canned scans + a
    // faithful bidirectional local reconcile + full measure_map CRUD, so the
    // scan → review → Apply flow is offline-QA-able end to end.
    case "measure_scan_page": {
      const record = argsRecord(args);
      const pieceId = pieceIdOf(args);
      const page = Number(record.page ?? 1);
      const jpeg = record.pageJpeg;
      const rasterKey = `${pieceId}::${page}`;
      if (
        page === CLIENT_RASTER_PAGE &&
        (jpeg == null || (Array.isArray(jpeg) && jpeg.length === 0)) &&
        !CLIENT_RASTER_SERVED.has(rasterKey)
      ) {
        CLIENT_RASTER_SERVED.add(rasterKey);
        throw NEEDS_CLIENT_RASTER_LITERAL;
      }
      if (jpeg != null) CLIENT_RASTER_SERVED.add(rasterKey);
      return mockScanPage(page, pieceId);
    }
    case "measure_reconcile": {
      const record = argsRecord(args);
      const inputs = (() => {
        try {
          return JSON.parse(String(record.pagesJson ?? "[]")) as {
            page: number;
            scan: MockScanPageOutput;
          }[];
        } catch {
          return [];
        }
      })();
      // No XML side channel in the mock — `PICKUP_DEMO_PIECE_ID` is the
      // fixture switch for exercising the pickup-ambiguity conflict.
      const hasPickup = pieceIdOf(args) === PICKUP_DEMO_PIECE_ID;
      return mockReconcile(inputs, hasPickup);
    }
    case "measure_map_get": {
      const record = argsRecord(args);
      const key = measureMapKey(
        pieceIdOf(args),
        String(record.editionFingerprint ?? ""),
      );
      return MOCK_MEASURE_MAP.get(key) ?? [];
    }
    case "measure_map_apply": {
      const record = argsRecord(args);
      const key = measureMapKey(
        pieceIdOf(args),
        String(record.editionFingerprint ?? ""),
      );
      const pages = (record.pages ?? []) as MockMeasureMapPageRow[];
      // Parity with the real command: a payload that violates the store's
      // invariants is REJECTED (plain string, like every other mock
      // rejection), never silently stored.
      const defect = measureMapApplyDefect(pages);
      if (defect) throw defect;
      MOCK_MEASURE_MAP.set(key, pages);
      return pages.length;
    }
    case "measure_map_clear": {
      const record = argsRecord(args);
      const key = measureMapKey(
        pieceIdOf(args),
        String(record.editionFingerprint ?? ""),
      );
      const removed = MOCK_MEASURE_MAP.get(key)?.length ?? 0;
      MOCK_MEASURE_MAP.delete(key);
      return removed;
    }

    default:
      return null;
  }
}

let installed = false;

export interface InstallTauriDevMockOptions {
  /** Fix wave item 12: seed a deterministic yesterday/today day-sheet pair
   * (carry-forward + plan-totals + pin-from-day-sheet material) so the real
   * interactive `dev:mock` harness has something to browse. Defaults to
   * `false` so every test suite's `installTauriDevMock()` call keeps getting
   * the genuinely-empty notebook backend it always has — only `main.tsx`
   * (the actual `npm run dev:mock` entry point) opts in. */
  seedQaFixtures?: boolean;
}

/**
 * Install the dev-only Tauri seam onto `window`. Idempotent. Called ONLY behind
 * the `VITE_DEV_MOCK` flag (main.tsx) or explicitly from the smoke test.
 */
export function installTauriDevMock(
  options: InstallTauriDevMockOptions = {},
): void {
  if (installed) return;
  installed = true;
  // Fresh, empty notebook backend per install so date/piece-keyed tests do not
  // bleed state into one another.
  DAY_SHEETS.clear();
  PIECE_PLANS.clear();
  if (options.seedQaFixtures) seedQaFixtures();
  // Reset runtime-created goals so promotion tests start from the seeded set.
  CREATED_GOALS.clear();
  mockGoalSeq = 900;
  // Task A4: fresh paused-sets tray state per install.
  mockSetState = "active";
  mockPausedSets = [];
  mockResumeRejects = false;
  // Task A4b fix round 1: fresh auto-pause-simulation state per install.
  mockPausedSetsAfterResume = null;
  // Task A10: fresh pass-seconds round-trip state per install.
  mockLastPassSeconds = null;
  // Fix wave item 8: fresh checkpoint-seconds state per install.
  mockCheckpointedSeconds = MOCK_REP_STATE.active_seconds ?? 0;
  // Task A11: banner edits never bleed between installs.
  MOCK_BANNERS.clear();
  // Task C4: applied measure maps never bleed between installs.
  MOCK_MEASURE_MAP.clear();
  // Task C4 fix round 1: the client-raster "once" gate resets too.
  CLIENT_RASTER_SERVED.clear();
  // Task C5: region create/delete state (including parent linkage) never
  // bleeds between installs — deep-clone the seed fresh every time.
  REGIONS = JSON.parse(JSON.stringify(SEED_REGIONS)) as Record<
    number,
    Region[]
  >;
  mockRegionNextId = 100;

  let callbackId = 0;
  let subscriptionId = 0;

  const internals = {
    // The single command seam. Events are a benign no-op: a `plugin:event|listen`
    // resolves to a valid subscription id (so `listen()` returns a real unlisten
    // fn), but no callback is ever fired — the initial render comes entirely from
    // the invoke load calls above.
    invoke(cmd: string, args?: unknown): Promise<unknown> {
      if (cmd === "plugin:event|listen")
        return Promise.resolve(++subscriptionId);
      if (cmd === "plugin:event|unlisten") return Promise.resolve(null);
      // A handler that throws (e.g. notebook validation) rejects the promise
      // with a plain string, matching the real backend's error convention.
      try {
        return Promise.resolve(routeCommand(cmd, args));
      } catch (cause) {
        return Promise.reject(cause);
      }
    },
    // Returns a callback id; the registered handler is intentionally never invoked.
    transformCallback(_callback?: unknown, _once?: boolean): number {
      return ++callbackId;
    },
    unregisterCallback(_id: number): void {},
    convertFileSrc(filePath: string): string {
      return filePath;
    },
  };

  (
    window as unknown as { __TAURI_INTERNALS__: typeof internals }
  ).__TAURI_INTERNALS__ = internals;

  // @tauri-apps/api's event `unlisten` reaches for this separate global; without
  // it, any component that calls `listen()` (e.g. ScoreView's score://navigate)
  // throws on cleanup. Registration goes through `plugin:event|listen` above, so
  // only a no-op unregister is needed here.
  (
    window as unknown as {
      __TAURI_EVENT_PLUGIN_INTERNALS__: {
        unregisterListener: (event: string, id: number) => void;
      };
    }
  ).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener() {},
  };
}

/** Test helper: remove the seam so unrelated suites see a backend-free window. */
export function uninstallTauriDevMock(): void {
  installed = false;
  delete (window as unknown as { __TAURI_INTERNALS__?: unknown })
    .__TAURI_INTERNALS__;
  delete (window as unknown as { __TAURI_EVENT_PLUGIN_INTERNALS__?: unknown })
    .__TAURI_EVENT_PLUGIN_INTERNALS__;
}
