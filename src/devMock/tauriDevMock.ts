// ---------------------------------------------------------------------------
// DEV-ONLY Tauri interception mock.
//
// This module lets the five-workspace v2 UI mount and render in a plain browser
// (`npm run dev:mock`) or a jsdom smoke test, WITHOUT a Rust backend. It is a
// STATIC render harness for visual/design review — NOT a functional acceptance
// surface. It only ever returns coherent sample data for the commands the five
// workspaces call on their LOAD path; live event pushes are an explicit no-op.
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
  RepSnapshot,
  RetentionCheckView,
  Verdict,
} from "../features/rep/useRep";
import type { MutationReceipt } from "../features/receipts/ReceiptCenter";
import type { SessionView } from "../features/session/useSession";
import type { UniverseSnapshot } from "../features/universe/types";

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

const TODAY = todayLocal();

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
  },
};

const REGIONS: Record<number, Region[]> = {
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
    },
  ],
};

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

/** A valid, blank single-page PDF (correct xref) so the viewer reaches "ready". */
function minimalPdfBytes(): ArrayBuffer {
  const objs = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> >>\nendobj\n",
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const obj of objs) {
    offsets.push(body.length);
    body += obj;
  }
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
    case "api_key_save":
      return apiKeyStatus(args, true);
    case "api_key_clear":
      return apiKeyStatus(args, false);
    case "rep_state":
      return MOCK_REP_STATE;
    // Clean/Sloppy/Again in the HUD: return a committed CheckOutcome so the
    // receipt lands GREEN (previously unmapped → null → red error receipt).
    case "rep_check":
      return repCheckOutcome(args);
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
    case "piece_get":
      return PIECE_DETAILS[pieceIdOf(args)] ?? null;
    case "region_list":
      return REGIONS[pieceIdOf(args)] ?? [];

    // Score atlas: one blank edition + no saved calibration, so the Score tab
    // reaches "ready" and the Map-this-score wizard can open.
    case "score_pdf_editions":
      return [mockEdition(pieceIdOf(args))];
    case "score_pdf_select":
      return mockEdition(pieceIdOf(args));
    case "score_pdf_bytes":
      return minimalPdfBytes();
    case "score_calibration_get":
      return null;
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
      return GOALS[pieceIdOf(args)] ?? [];
    case "anomalies_list":
      return anomalies();

    // Today / Universe.
    case "universe_snapshot":
      return universeSnapshot();

    // Calendar / composer.
    case "daily_work_list":
      return dailyWork();
    case "recovery_preview":
      return recoveryPreview();
    case "retention_due":
      return retentionDue();

    default:
      return null;
  }
}

let installed = false;

/**
 * Install the dev-only Tauri seam onto `window`. Idempotent. Called ONLY behind
 * the `VITE_DEV_MOCK` flag (main.tsx) or explicitly from the smoke test.
 */
export function installTauriDevMock(): void {
  if (installed) return;
  installed = true;

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
      return Promise.resolve(routeCommand(cmd, args));
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
