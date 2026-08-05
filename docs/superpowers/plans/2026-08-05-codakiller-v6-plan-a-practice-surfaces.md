# CodaKiller v6.0 Plan A — Practice Surfaces (S3 Dock · S4 Pause/Day-Close · S5 Plans+Time · S8 Banner)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the v6 practice surfaces: a floating Practice Dock (rep counter, paused-sets
tray, clock/timers), sets pausable across days with day-scoped sessions, day sheets with a
date navigator + carry-forward + time totals + set time estimates, and the per-piece score
goals banner — plus the complete v14 migration all v6 plans share.

**Architecture:** All UI is plain React in the single Tauri window (no multi-window). New
`src/features/dock/` owns floating-panel mechanics; existing RepHud content and new tray/clock
panels mount inside it. Rust gains one migration (v13→v14), one paused-sets query command, a
banner mutation, an optional `pass_seconds` on the composer's start write, and the
same-calendar-day session adoption rule. Spec: `docs/superpowers/specs/2026-08-05-codakiller-v6-practice-core.md`.

**Tech Stack:** React 19 + TS + vitest (jsdom) · Rust/rusqlite + cargo test · no new npm or
cargo dependencies (drag/snap is hand-rolled pointer-event code).

## Global Constraints

- Never delete or rename a CSS token — deleting one renders a surface transparent. New styles
  use the existing paper tokens (`--bg`, `--ink`, `--ink-dim`, `--accent`, `--s-1…6`,
  `--r-sm/md/lg`, `--dur-fast`, `--ease-out`, `--signal-*`).
- Practice truth is append-only. No task here may add a write path to `rep`/`rep_block`
  beyond the existing commands; checking a plan checkbox never mutates practice truth.
- Voice grammar, wake word, STT/TTS, and receipt surfaces are UNTOUCHED in Plan A (they are
  Plan D). The narrated-corpus suite must still pass untouched.
- devMock convention: every new IPC command gets a `routeCommand` case in
  `src/devMock/tauriDevMock.ts`; handlers reject with plain-string errors
  (`Promise.reject("<msg>")` via the try/catch seam); keyed in-memory stores are cleared in
  `installTauriDevMock()`.
- jsdom has NO `window.localStorage` — tests that touch it install the Map-backed shim via
  `Object.defineProperty(window, "localStorage", …)` (pattern in the Today/composer suites).
- Migration rule (binding): never open the live DB from dev code. Rehearse with
  `CODAKILLER_MIGRATION_COPY=<copy> cargo test --lib rehearse_migration_on_real_database_copy -- --ignored`.
- Dense-layout floor: every new surface must be usable at the 720×520 minimum window.
- TDD per task: failing test → run (expect FAIL) → minimal implementation → run (expect PASS)
  → commit. Single-file runs: `npx vitest run <path>` / `cargo test <name>`.

---

### Task A1: Schema v14 migration (shared by all v6 plans)

**Files:**

- Modify: `src-tauri/src/store/migrations.rs` (SCHEMA_VERSION at :11, SCHEMA_V13 pattern at
  :945, `migrate()` step loop at :1410 — copy the v12→v13 step shape exactly)
- Test: same file's test module (follow `migrate_v11_to_v12_…` at :1995; `seed_v12`-style
  builder if one exists, else seed via `migrate()` to 13 first)

**Interfaces:**

- Produces: `SCHEMA_VERSION = 14`; table `measure_map`; columns `piece.banner_text TEXT`
  (nullable), `set_contract.pass_seconds INTEGER` (nullable). Later plans (B/C) and later
  tasks in this plan read these — names are contract.

```sql
CREATE TABLE measure_map (
  id INTEGER PRIMARY KEY,
  piece_id INTEGER NOT NULL REFERENCES piece(id) ON DELETE CASCADE,
  edition_id TEXT NOT NULL,
  edition_fingerprint TEXT NOT NULL,
  page INTEGER NOT NULL CHECK(page >= 1),
  systems_json TEXT NOT NULL CHECK(length(systems_json) <= 262144),
  created_ts TEXT NOT NULL DEFAULT (datetime('now')),
  updated_ts TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(piece_id, edition_fingerprint, page)
);
CREATE INDEX measure_map_piece_idx ON measure_map(piece_id, edition_fingerprint, page);
ALTER TABLE piece ADD COLUMN banner_text TEXT CHECK(banner_text IS NULL OR length(banner_text) <= 140);
ALTER TABLE set_contract ADD COLUMN pass_seconds INTEGER CHECK(pass_seconds IS NULL OR (pass_seconds >= 1 AND pass_seconds <= 3600));
```

- [ ] Failing tests: `migrate_v13_to_v14_adds_measure_map_and_columns` (fresh DB → migrate →
      `user_version=14`, `measure_map` insert/select round-trips, `piece.banner_text` and
      `set_contract.pass_seconds` accept NULL and reject over-limit values) and
      `migrate_is_idempotent_at_v14` (second `migrate()` is a no-op).
- [ ] Implement the v14 step; run module tests → PASS.
- [ ] Run the rehearsal test against a FRESH copy of the live DB (copy it yourself from
      `~/Library/Application Support/com.christian.codakiller/codakiller.db` to a scratch path
      first); record row counts before/after in the task report — must be identical, integrity ok.
- [ ] `cargo test` clean → commit `feat(db): schema v14 — measure_map, piece.banner_text, set_contract.pass_seconds`.

### Task A2: Dock framework (`src/features/dock/`)

**Files:**

- Create: `src/features/dock/DockProvider.tsx` (context: registered panels, z-order, open/
  minimized state), `src/features/dock/DockPanel.tsx` (chrome: title bar, drag handle,
  minimize + close buttons, pill form), `src/features/dock/dockState.ts` (pure state +
  localStorage persistence), `src/features/dock/dock.css`
- Test: `src/features/dock/dockState.test.ts`, `src/features/dock/DockPanel.test.tsx`

**Interfaces:**

- Produces: `<DockProvider>` (mounted once at shell level, Task A3),
  `<DockPanel id="rep"|"paused"|"clock" title={string} defaultPosition={{x,y}}>{children}</DockPanel>`,
  `useDock(id): { open(): void; close(): void; minimize(): void; isOpen: boolean; isMinimized: boolean }`,
  `loadDockState()/saveDockState(state)` on localStorage key `ck.dock.v1`
  (`{ [id]: {x, y, minimized, open, z} }`).

- [ ] Failing tests: pure `dockState` — position clamp to viewport (a panel dragged to
      x=−500 clamps so ≥48px of its title bar stays visible at 720×520), z-raise on focus
      (focused panel gets max z+1), minimize round-trip, persistence round-trip through the
      localStorage shim, corrupt-JSON load falls back to defaults.
- [ ] Failing component tests: drag via pointerdown/pointermove/pointerup updates transform;
      Escape and the pill button restore/minimize; panels are `role="dialog"` non-modal with
      `aria-label`, tab-reachable, and arrow-key movable (8px steps) for keyboard users.
- [ ] Implement (pointer events + `transform: translate`, no libraries; paper tokens; pill =
      title + restore affordance) → tests PASS.
- [ ] Commit `feat(dock): floating panel framework with persistence + keyboard support`.

### Task A3: Rep Counter panel (RepHud moves into the dock)

**Files:**

- Modify: `src/shell/Shell.tsx` (mount `<DockProvider>` + the three panels at shell level so
  they persist across workspace tabs — same promotion pattern the session event bar used),
  `src/features/today/TodayPracticePanel.tsx` (:136–143 — remove the docked HUD strip),
  `src/features/rep/RepHud.tsx` (render inside `<DockPanel id="rep">`; the component's
  internal logic — verdict buttons, streak, rung-celebration hold — is NOT changed)
- Test: modify RepHud/Today suites; add `src/features/dock/repPanel.test.tsx`

**Interfaces:**

- Consumes: Task A2's `DockPanel`/`useDock`. RepHud's existing props/store stay identical.
- Produces: the rep panel auto-opens when a set becomes active (`set_state === "active"` in
  the rep store) and shows a subdued empty state otherwise.

- [ ] Failing tests: HUD no longer renders inside TodayPracticePanel; it renders in the dock
      panel on every workspace tab; verdict buttons still invoke the exact same IPC commands
      (spy on the seam — byte-identical args); active-set transition opens the panel.
- [ ] Implement → PASS; run the full today/rep/shell suites for blast radius.
- [ ] Commit `feat(rep): rep counter lives in a floating dock panel`.

### Task A4: Paused Sets — backend query + tray panel + pause button

**Files:**

- Modify: `src-tauri/src/lib.rs` (new command near `rep_pause` at :678), `src-tauri/src/rep/mod.rs`
  or `store/` query module (follow where `rep_pause` reads state), `src/devMock/tauriDevMock.ts`
- Create: `src/features/dock/PausedSetsTray.tsx`, `src/features/rep/pausedSets.ts` (API + types)
- Test: Rust query tests beside the query; `src/features/dock/PausedSetsTray.test.tsx`

**Interfaces:**

- Produces: `sets_paused_list()` → `Vec<PausedSetRow>` where `PausedSetRow = { set_id: i64,
block_id: i64, piece_id: i64, piece_title: String, m_start: i64, m_end: i64, bpm: i64,
target_bpm: i64, paused_since_ts: String, current_clean_streak: i64 }` (join
  `set_contract` WHERE `set_state='paused'` × `rep_block` × `piece`). Frontend mirror type
  `PausedSetRow` in `pausedSets.ts`.
- Consumes: existing `rep_pause(command_id)` / `rep_resume(command_id)` receipts.

- [ ] Failing Rust test: seed two pieces, pause one set each, one active elsewhere →
      `sets_paused_list` returns exactly the two paused rows, newest-paused first.
- [ ] Failing frontend tests: tray lists rows (devMock fixture); Resume calls `rep_resume`
      and removes the row on the success receipt; a **Pause** button rendered in the rep panel
      (Task A3's panel, active state only) calls `rep_pause`; paused sets appear NOWHERE else
      (assert the old top-strip render sites are gone).
- [ ] Implement both sides + devMock case → PASS. Also verify by hand in `npm run dev:mock`:
      pause → quit mock → reinstall mock state → row survives only via backend in real app
      (state is in SQLite; note in report that cross-relaunch survival is exercised in Rust
      tests, not jsdom).
- [ ] Commit `feat(sets): paused-sets tray + pause surface over existing pause/resume engine`.

### Task A5: Day-scoped sessions (same-calendar-day adoption + retroactive close + auto-pause)

**Files:**

- Modify: `src-tauri/src/sessions/mod.rs` (`resolve_session()` at :68 — the adoption branch),
  `src-tauri/src/lib.rs` (surface "End my day" as the existing `session_end` — add a
  UI-labeled button in `src/features/session/` beside the session bar; voice command
  unchanged)
- Test: `src-tauri/src/sessions/` module tests

**Interfaces:**

- Consumes: `latest_open_session()`, `open_session()`, the internal pause path `rep_pause`
  uses (call the same store function, not the IPC layer).
- Produces: adoption rule — `latest_open_session()` is adopted ONLY if its last event (fall
  back to `started_at`) is the same LOCAL calendar day as now; otherwise it is closed with
  `ended_at = <its last event timestamp>` (never `now` — no phantom overnight focused time),
  any still-active set is paused through the standard pause path, and a fresh session opens.

- [ ] Failing Rust tests (inject the clock — follow however `sessions`/`metrics` tests fake
      time; if nothing exists, thread a `now: DateTime<Local>` parameter with a
      production-default wrapper): same-day restart adopts; first event after midnight closes
      the old session at its last event time, pauses the active set, opens a new session;
      `focused_seconds` of the closed session excludes the overnight gap.
- [ ] Implement → PASS; add the "End my day" button (calls `session_end`, confirm dialog,
      shows the session summary receipt it already returns).
- [ ] Commit `feat(sessions): sessions are day-scoped — midnight adoption boundary + end-my-day`.

### Task A6: Clock / Timer dock panel

**Files:**

- Create: `src/features/dock/ClockPanel.tsx`, `src/features/dock/timerMachine.ts` (pure),
  `public/chime.wav` (short single-strike chime, generate with `afconvert`/sox from a sine
  burst — keep < 50 KB)
- Test: `src/features/dock/timerMachine.test.ts`, `src/features/dock/ClockPanel.test.tsx`

**Interfaces:**

- Produces: `createTimer(kind: "stopwatch" | "countdown", seconds?: number)` pure machine
  (`start/pause/reset/tick(now)` → `{ remaining, elapsed, done }`); ClockPanel shows local
  time + one stopwatch + one countdown with presets [5, 15, 25, 45 min] + custom minutes.
- Consumes: `DockPanel id="clock"`.

- [ ] Failing tests (vitest fake timers): countdown reaches done exactly once; runs while
      minimized (machine is time-based, not interval-accumulating — tick(now) math, so a
      throttled background interval cannot drift it); pause/resume; custom minutes bounds 1–180.
- [ ] Implement; completion plays `chime.wav` via `new Audio()` (CSP already allows local
      media) and flashes the pill; never touches the Rust audio engine or the mic path.
- [ ] Commit `feat(clock): clock/stopwatch/break-timer dock panel with chime`.

### Task A7: Day-sheet date navigator + read-only past sheets

**Files:**

- Modify: `src/features/notebook/useDaySheet.ts` (:41 — already `useDaySheet(date)`),
  the day-sheet host in `src/features/today/` (find the component that calls
  `useDaySheet(todayLocal())` and lift date into state), `src/features/notebook/dates.ts`
  (add `addDays(date: string, n: number): string`, local-time-safe)
- Test: extend the notebook/today suites

**Interfaces:**

- Produces: header nav `‹ [date label] ›` + "Today" jump; `isToday(date)` gates editing —
  past sheets render the same line UI with editing disabled (no autosave mounts) and a
  quiet "read-only — [date]" caption. Future dates are not navigable (right arrow disabled
  at today).
- Consumes: `day_sheet_get(date)` (returns `None` → empty read-only sheet for past dates,
  NOT a seeded save — never create rows for browsed dates).

- [ ] Failing tests: `addDays("2026-08-01", -1) === "2026-07-31"` (and a DST-crossing case);
      navigating back renders yesterday's lines read-only and mounts no autosave (spy:
      `day_sheet_save` never called from a past date); legacy `todayPlan` migration (:52–66)
      still fires only when viewing today.
- [ ] Implement → PASS. Commit `feat(notebook): date navigator with read-only past sheets`.

### Task A8: Carry-forward unchecked items to today

**Files:**

- Create: `src/features/notebook/carryForward.ts` (pure)
- Modify: the past-sheet read-only line renderer (Task A7) to show a per-line "→ today"
  affordance on unchecked `ItemLine`s and on `BlockLine`s
- Test: `src/features/notebook/carryForward.test.ts` + a host-level test

**Interfaces:**

- Produces: `carryLine(line: ItemLine | BlockLine, fromDate: string): ItemLine | BlockLine`
  — returns a copy with `checked: false` (items) and, when the text does not already end
  with a provenance suffix, appends `" · from <Mon D>"` (e.g. `" · from Aug 4"`; BlockLine
  carries minutes/piece_id unchanged and the suffix goes on a trailing TextLine only if
  BlockLine has no text field — check `lines.ts:25–29`: it has none, so a carried BlockLine
  is appended verbatim and provenance is skipped for it).
- Consumes: `useDaySheet(todayLocal())`'s existing append/save path — a carry is an ordinary
  edit to TODAY's sheet; the past sheet is never written.

- [ ] Failing tests: carried item lands at the end of today's sheet unchecked with the
      suffix; carrying twice from the same source line appends twice (simple, visible —
      Christian's call each day; no hidden dedup); the past sheet's body is byte-identical
      after a carry (spy on `day_sheet_save` args — only today's date ever appears).
- [ ] Implement → PASS. Commit `feat(notebook): one-tap carry-forward of unchecked plan lines`.

### Task A9: Plan total time

**Files:**

- Create: `src/features/notebook/planTotals.ts` (pure)
- Modify: the day-sheet header (mount point from Task A7)
- Test: `src/features/notebook/planTotals.test.ts`

**Interfaces:**

- Produces: `planTotals(lines: NotebookLine[]): { minutes: number; timedLines: number;
untimedActionLines: number }` — sums `BlockLine.minutes`; `untimedActionLines` counts
  unchecked ItemLines with no minutes anywhere on them; header renders
  `"Σ 75 min planned · 3 lines unestimated"` (omit the second clause when 0).

- [ ] Failing tests: mixed sheet sums correctly; empty sheet renders nothing; header updates
      live as lines change (existing autosave state, no new IPC).
- [ ] Implement → PASS. Commit `feat(notebook): live plan total time in the day-sheet header`.

### Task A10: Set time estimates (`pass_seconds` through the composer)

**Files:**

- Create: `src/features/rep/estimate.ts` (pure)
- Modify: the Session Composer (locate via the "Start-is-the-only-write" flow — grep
  `src/features` for the composer component and `lib.rs` for its start command, registered
  near `rep_pause` at lib.rs:678; extend that command's args with optional
  `pass_seconds: Option<i64>`), `src-tauri` start handler to persist into
  `set_contract.pass_seconds` (column from Task A1), `src/devMock/tauriDevMock.ts`
- Test: `src/features/rep/estimate.test.ts`, composer suite, Rust start-command test

**Interfaces:**

- Produces: `estimateSetSeconds(passSeconds: number, ladder: { bpm: number; reps: number }[],
entryBpm: number): { lowSeconds: number; highSeconds: number }` — low = Σ over rungs of
  `reps × passSeconds × (entryBpm / rung.bpm)` + 3s reset allowance per rep; high =
  low × 1.5 (retries). Composer shows `"≈ 12–18 min"` beside the optional
  "one pass ≈ [N] sec" field; the estimate flows into the day-sheet BlockLine minutes when
  the set is planned from the sheet (round highSeconds up to whole minutes).
- Consumes: A1's `set_contract.pass_seconds`; the composer's existing ladder preview data.

- [ ] Failing tests (exact numbers): `pass=30s`, entry 60 bpm, ladder `[{60,3},{72,3}]` →
      low = 3·30·1 + 3·30·(60/72) + 6·3 = 90 + 75 + 18 = 183s, high = 274.5s → renders
      "≈ 4–5 min"; slower-than-entry rung scales above 1×; absent pass_seconds → no estimate UI
      and the start command sends `pass_seconds: null` byte-compatibly (Start-is-the-only-write
      contract must show NO new write commands — extend the one write).
- [ ] Rust failing test: start with `pass_seconds: Some(30)` persists; `None` stores NULL;
      out-of-bounds rejected by the CHECK.
- [ ] Implement both sides + devMock → PASS. Commit
      `feat(sets): optional pass-time estimate through the composer's single write`.

### Task A11: Score goals banner

**Files:**

- Modify: `src-tauri/src/lib.rs` (new `piece_banner_set` command), `src-tauri/src/store/`
  (piece query + `PieceDetail` gains `banner_text: Option<String>` — model.rs:67–83),
  `src/features/score/ScoreWorkspace.tsx` (banner strip above the page), the day-sheet ⚑
  line renderer (add "pin to score" on flag/goal lines), `src/devMock/tauriDevMock.ts`
- Test: Rust command test; `src/features/score/Banner.test.tsx`

**Interfaces:**

- Produces: `piece_banner_set(piece_id: i64, text: Option<String>)` → updated `PieceDetail`
  (None clears; ≤140 chars enforced in Rust to match the CHECK). Banner renders large serif
  (paper tokens), click-to-edit inline, × deletes (confirm), eye-slash dismisses for the
  session only (React state, not persisted). "Pin to score" on a day-sheet ⚑ line calls the
  same command with the line's text (piece context = the line's `piece_id`, else the
  selected piece).
- Consumes: A1's `piece.banner_text`.

- [ ] Failing tests: set/clear round-trip incl. 141-char rejection (Rust); banner renders,
      edits in place, session-dismiss hides without a save call, reappears on remount
      (frontend); pinning a ⚑ line sets the banner (spy args).
- [ ] Implement + devMock → PASS. Commit `feat(score): editable per-piece goals banner`.

### Task A12: Gates, adversarial verification, protocol

- [ ] Full gates: `npm test` (≥ 1643 passing, 0 fail), `npx tsc --noEmit`, `cd src-tauri &&
cargo test` (≥ 668), `cargo clippy -- -D warnings`, `npm run build`. Dense pass: exercise
      every new surface in `npm run dev:mock` at 720×520 (screenshot each into `docs/qa/`).
- [ ] Dispatch a FRESH-context adversarial verifier over the whole slice: claims = each task's
      Produces block; it must exercise the built UI (dev:mock) and the Rust tests, and try to
      refute cross-day pause survival, midnight adoption, read-only past sheets, and the
      Start-is-the-only-write contract. Fix every high/medium finding before proceeding.
- [ ] UPDATE PROTOCOL (binding): vault `(C) Changelog` entry; `CodaKiller.md` refresh;
      `(C) Roadmap` Plan A → done; `(C) Flaws` — add honest residuals found; repo `NOTES.md`
      engineering facts; Command Center thread tick. **No version bump / no install** — v6.0.0
      ships once Plans A–D are all done; the installed app stays v5.0.0 until then.
