# (C) v0.3.0 — Version Record

> **Immutable once filed** (factual corrections only). Shipped **2026-07-12**, git tag
> `v0.3.0`, installed to `/Applications/CodaKiller.app`. Phase **P3.5 — Editable Foundation**.
> Predecessor: [[(C) v0.2.0 — Version Record]] · Hub: [[(C) CodaKiller Command Center]].

## What this version IS

The version where CodaKiller stops being write-once. v0.2.0 proved the rep tracker; v0.3.0
makes its memory correctable, organized, and extensible: every important practice object has a
stable id and CRUD path; history navigates Region → block → rep; auxiliary surfaces are movable;
and “practice” no longer means “tempo ladder with a metronome.”

## What shipped

- **Schema v3 + canonical graph:** new Region, Goal, and durable Event tables; session focused
  seconds; block region/focus/metronome fields; nullable block tempo. The v2→v3 migration copies
  every existing block/rep and back-fills goals plus overlapping-range region clusters in one
  crash-atomic transaction.
- **Full edit/delete:** consistent double-click inline editing for piece current state/deadline/
  target/notes, goals, block ranges/labels/BPM/rep target, region names, and rep notes; verdict
  correction; confirmation before block/rep/goal/region deletion; goal completion/reordering.
- **Organized history:** collapsible region groups with blocks and individual reps, summary lines,
  search, recent/measure/most-practiced sorting, Ungrouped safety bucket, and region rename/color/
  merge/split/block-move tools.
- **Movable workspace:** Rep HUD and Session feed are floating windows—drag, resize, collapse,
  snap, raise, persist, reset. Active Rep gets a right-side content gutter; Session starts collapsed
  in the top bar. Final review fixed a drag z-order race.
- **Practice focus:** tempo, notes, phrasing, dynamics, memory, hands/coordination, other;
  metronome independently on/off. Only tempo focus climbs a ladder. Metronome-free non-tempo
  blocks store NULL BPM and export “—”; UI-opened blocks actually start/retune the click when on.
- **Canonical export + metrics:** export reloads current blocks/reps so post-log edits survive
  relaunch and appear in markdown. `progress_summary` derives focused time, streak, per-region
  mastery, best clean tempo, and time by focus—no duplicated stored summary state.
- **Future seams:** Region `pdf_anchor` for P4; structured graph for a thin Claude/Gemini brain;
  real Goal parent/date fields for P5.5; honest event-derived inputs for the Practice Universe.

## How it was verified

- Rust: **216 passed, 3 hardware/live ignored** (`cargo test --lib`); `cargo clippy
  --all-targets -- -D warnings` clean.
- Frontend: **24 test files, 127 tests passed**; `tsc` + Vite production build green.
- Installed-bundle smoke: `/Applications/CodaKiller.app` reports **0.3.0**, launched and stayed
  alive. Its real database opened at schema **v3**, returned `integrity_check = ok`, no foreign-key
  violations, and retained 5 pieces / 23 blocks / 167 reps after migration.
- Regression coverage includes crash-atomic migration/value preservation, event ordering,
  region merge/delete/back-fill, rep-count recompute, edits surviving relaunch/export, active
  snapshot resync, metronome-off ladder behavior, NULL BPM, panel clamp/snap/resize/persistence,
  CRUD IPC casing, grouped/filterable history, region management, and focus-aware block creation.
- Visual QA used a full representative piece state in dark mode. It caught real overlap and HUD
  clipping: Session now starts collapsed in the top bar, Rep uses a dedicated right gutter, and
  the HUD reflows inside 410 px. The in-app browser disconnected before a second captured light
  screenshot; light parity is covered by the same semantic tokens + production build/tests, not
  falsely claimed as a second visual artifact.
- Whole-diff review caught two final functional issues: UI metronome toggle previously changed
  metadata without starting/retuning audio, and drag completion could undo raise-to-front. Both
  fixed in `0296c49` with regression tests.

## Honest gaps

- **Real at-piano acceptance is still pending.** Automated evidence and representative visual QA
  do not prove Christian's voice/Steinway/room or whether this workflow feels good in practice.
- Region migration is a geometric guess; first open may require rename/split/merge/reassignment.
- Region split is a recoverable multi-command sequence, not one database transaction.
- Score/PDF interaction, brain/library, calendar recovery, and Practice Universe remain unbuilt.
- Repo remains local-only with no off-disk backup.

## NEXT STEPS

1. **Christian: one real v0.3.0 session.** Open a piece; log reps; deliberately correct one
   verdict/note; drill through Region → block → rep; drag/collapse/reset both windows; run a
   phrasing block with metronome off; end and inspect the edited export.
2. Put every friction point into [[(C) Flaws]] and tune before adding scope.
3. Plan P4 **real-PDF viewer + light Region mapping**; spike the large Scherzo PDF/XML pair.
4. Create an off-disk private git remote.
