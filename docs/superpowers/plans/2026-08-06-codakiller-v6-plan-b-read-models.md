# CodaKiller v6.0 Plan B — Read Models (S6 History Day-Timeline · S7 Calendar Planned-vs-Done)

> **Status:** Historical/as built; this slice shipped in v6.0.0. Checkboxes below are retained as
> execution evidence, not current roadmap state.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** History's default view becomes a day-by-day timeline (collapsed day cards, expand
for sets→attempts) and Calendar day cells show planned-vs-done instead of empty — both pure
read models over existing tables.

**Architecture:** Two new Rust read commands (`history_days`, `history_day_detail`) + one bulk
day-sheet range read (`day_sheets_range`); frontend adds a Days view to the History workspace
and merges planned/done into the Calendar week cells. **No schema change, no migration** (data
volumes: ~1.4k reps, ~30 sessions — full scans are fine; this deliberately avoids the broken
rehearsal harness, Flaws B58). Presentation only: practice truth stays append-only, zero new
write paths.

**Tech Stack:** React 19 + TS + vitest (jsdom) · Rust/rusqlite + cargo test · no new deps
(no virtualization library — paged day loading + disclosure bounds render cost; recorded as a
deliberate delta from the spec's literal "virtualization" word).

## Global Constraints

- Never delete or rename a CSS token; new styles use existing paper tokens.
- Practice truth is append-only — this plan adds ZERO write paths (read commands only).
- Voice grammar, STT/TTS, receipts, dock, and day-sheet write paths are UNTOUCHED.
- "Local day" everywhere means `date(ts,'localtime')` — the same convention the A5
  session-boundary code uses (`session_last_event_and_same_local_day`); History/Calendar day
  bucketing must agree with session day-scoping or days will disagree with sessions.
- devMock: every new command gets a `routeCommand` case + deterministic fixtures usable by
  live QA at 720×520; state cleared in `installTauriDevMock()`; plain-string rejects.
- jsdom localStorage shim pattern where needed; co-located `X.test.tsx` convention.
- Dense floor: every new surface usable at 720×520.
- TDD per task; run scoped suites per task, full gates at B4. Commit per task on branch
  `v6/plan-b`.

---

### Task B1: Rust read model — `history_days`, `history_day_detail`, `day_sheets_range`

**Files:**

- Create: `src-tauri/src/store/history_days.rs` (queries + types; wire `mod` in store)
- Modify: `src-tauri/src/lib.rs` (three command registrations), `src-tauri/src/store/model.rs`
  (types if the store convention keeps them there)
- Test: alongside the queries (house style)

**Interfaces (produces — frontend mirrors these exactly):**

- `history_days(from: String, to: String) -> Vec<HistoryDaySummary>` — one row per LOCAL day
  in [from,to] that has ANY practice evidence, newest first:
  `HistoryDaySummary { date: String /*YYYY-MM-DD local*/, focused_seconds: i64,
session_count: i64, attempts: i64, cleans: i64, sets_touched: i64, mastered_sets: i64,
pieces: Vec<HistoryDayPiece { piece_id: i64, title: String, attempts: i64 }> }`.
  Sources: sessions bucketed by `date(started_at,'localtime')` with `focused_seconds` via the
  existing `metrics::focused_seconds` over each session's events; attempts/cleans from `rep`
  by `date(ts,'localtime')`; `mastered_sets` = sets whose mastery event landed that day
  (derive from the same projection evidence `sets_paused_list`/RepSnapshot use — reuse, don't
  re-derive mastery math).
- `history_day_detail(date: String) -> HistoryDayDetail` — that local day's work:
  `HistoryDayDetail { date: String, sessions: Vec<HistoryDaySession { session_id: i64,
started_at: String, ended_at: Option<String>, focused_seconds: i64 }>,
sets: Vec<HistoryDaySet { block_id: i64, piece_id: i64, piece_title: String,
region_name: Option<String>, m_start: i64, m_end: i64, attempts: i64, cleans: i64,
flawed: i64, failed: i64, start_bpm: i64, end_bpm: i64, mastery_status: String,
first_ts: String, last_ts: String } > }` — sets ordered by first_ts; region/piece names
  joined in SQL (unlike BlockHistory's client-side join — day detail spans pieces).
- `day_sheets_range(from: String, to: String) -> Vec<DaySheet>` — existing DaySheet shape,
  only dates that have rows; read-only; never creates rows.

- [ ] Failing Rust tests: seed two pieces + reps across three local days (one spanning a UTC
      boundary to prove localtime bucketing: a rep at 2026-08-04T23:30 local stored as UTC must
      bucket to Aug 4); `history_days` returns exact counts/ordering and excludes empty days;
      `history_day_detail` returns sets with correct per-day attempt splits (a block practiced on
      two days appears in both days with only that day's attempts) + names joined; empty day →
      empty detail (not an error); `day_sheets_range` returns only existing rows, untouched body.
- [ ] Implement; `cargo test` (new module + blast radius) + `cargo clippy --all-targets -- -D warnings`.
- [ ] Commit `feat(history): day-bucketed read model — history_days/day_detail/day_sheets_range`.

### Task B2: History day-timeline (frontend)

**Files:**

- Create: `src/features/ledger/DayTimeline.tsx` (+`.test.tsx`), `src/features/ledger/historyDays.ts`
  (API + mirrored types), `src/features/ledger/dayTimeline.css`
- Modify: `src/features/ledger/LedgerWorkspace.tsx` (view switch: **Days | Pieces** — Days is
  the DEFAULT; Pieces = today's piece-index + HistoryPanel untouched), `src/devMock/tauriDevMock.ts`
- Test: LedgerWorkspace suite updated + DayTimeline suite

**Interfaces:**

- Consumes B1's three commands (mirror types verbatim in `historyDays.ts`).
- Produces: collapsed day cards newest-first — header `"Wed · Aug 6 — 42 min · Scherzo No. 2 ·
3 sets · 2 mastered"` (piece list truncated to 2 + "+N"); expand loads `history_day_detail`
  on demand (disclosure-first — never prefetch details); paging: first 21 days with evidence,
  "Earlier days" appends the next 21 (bounds render cost; no virtualization dependency —
  deliberate, recorded); the existing filters do NOT apply to Days view v1 (they're
  piece-scoped; keep them on the Pieces view only — honest scope cut, noted in the plan).
- Persistence: last-used view (Days|Pieces) in localStorage `ck.history.view`.

- [ ] Failing tests: default view is Days; cards render exact header text from fixture data;
      expand calls `history_day_detail` exactly once per day (cached after); collapse/re-expand
      doesn't refetch; "Earlier days" appends; Pieces view still renders the untouched
      HistoryPanel (regression: its suite stays green); empty history → calm empty state; dense
      fixture at 720×520 (long piece titles truncate, cards don't overflow).
- [ ] devMock: handlers + a deterministic 5-day fixture (incl. one multi-piece day, one
      mastered set) reachable in dev:mock for live QA.
- [ ] Run ledger/devMock suites + `npx tsc --noEmit`. Commit
      `feat(history): day-timeline default view with disclosure + paging`.

### Task B3: Calendar planned-vs-done day cells

**Files:**

- Create: `src/features/calendar/plannedVsDone.ts` (pure merge fn + types, +`.test.ts`)
- Modify: `src/features/calendar/CalendarWorkspace.tsx` (day-cell markup), its CSS,
  `src/features/calendar/api.ts` (add `historyDays(from,to)` + `daySheetsRange(from,to)`
  callers), `src/devMock/tauriDevMock.ts` (reuse B2 fixtures + seed a planned sheet)
- Test: CalendarWorkspace suite + plannedVsDone unit tests

**Interfaces:**

- Consumes: B1's `history_days` + `day_sheets_range`; existing `daily_work` list stays as-is
  (rendered as today; this task ADDS a planned-vs-done line per cell, it does not rework
  daily_work).
- Produces: `mergePlannedVsDone(sheets: DaySheet[], days: HistoryDaySummary[], weekDates:
string[]) -> Record<string, { plannedMinutes: number; plannedItems: number;
doneMinutes: number; attempts: number }>` — plannedMinutes = Σ BlockLine.minutes on that
  date's sheet (reuse `planTotals` — import, don't duplicate); doneMinutes =
  round(focused_seconds/60). Cell renders a compact two-segment bar (planned vs done, paper
  tokens, no new colors beyond existing signal tokens) + "45 planned · 38 done" text; cells
  with neither render as today. Today's cell must show live data (the S7 "today stops showing
  empty" acceptance). Leave a `{/* v7: streak/photo layer slots here */}` marker in the cell.

- [ ] Failing tests: merge fn exact numbers incl. a date with sheet-but-no-practice and
      practice-but-no-sheet; week fetch issues ONE `history_days` + ONE `day_sheets_range` call
      for the visible week (no per-cell calls); today's cell shows the seeded live data; capacity
      control + recovery preview + DaySheetWindow open — existing suite stays green; 720×520
      dense fixture.
- [ ] Run calendar/devMock suites + `npx tsc --noEmit`. Commit
      `feat(calendar): planned-vs-done day cells from day sheets + practice read model`.

### Task B4: Gates, live QA, protocol, merge

- [ ] Full gates: `npx vitest run` (0 fail), `npx tsc --noEmit`, `cargo test` (0 fail),
      `cargo clippy --all-targets -- -D warnings`, `npm run build`.
- [ ] Fresh-context live QA at 720×520 in dev:mock (fresh localStorage): Days timeline
      renders the fixture days, expand shows sets, paging works; Pieces view unchanged; Calendar
      week shows planned-vs-done bars + non-empty today; console error-free (do not open
      Settings — known B63). Adversarial: a day with 50 sets (seed via fixture), rapid
      expand/collapse, week navigation spam.
- [ ] Whole-branch review (most capable model) over the Plan B diff + triage; ONE fix wave if
      findings; scoped re-review.
- [ ] UPDATE PROTOCOL: Changelog entry, Roadmap (Plan B done), Command Center thread,
      CodaKiller.md, Flaws (record the two deliberate deltas: no virtualization lib — paging
      instead; Days view drops piece-scoped filters v1), NOTES.md facts, repo CLAUDE.md status.
      How To Use still untouched (installed app unchanged).
- [ ] Merge `v6/plan-b` → main (--no-ff). No version bump, no install.
