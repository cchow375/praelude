# CodaKiller v3.1.0 — Version Record

**Shipped:** 2026-07-20
**Tag:** `v3.1.0`
**Implementation commit:** `36f21fd`
**Installed:** `/Applications/CodaKiller.app`
**Database schema:** 10 (no migration in this release)

## What this release is

v3.1.0 is the hands-free stabilization release driven by Christian's July 19 practice
sessions. It removes the most immediate practice-loop friction and restores the first safe
slice of the Brain as a screen-grounded operator. Its product test is simple: fewer forced
touches, more accurately recorded work.

It is **not** the completed autonomous Practice Operator. The LLM never clicks arbitrary DOM,
never enters the deterministic rep/metronome hot loop, and never receives permission to infer
what the piano sounded like. It sees a typed semantic snapshot and may produce only validated,
closed action drafts that Christian confirms.

## What shipped

- Routine receipts auto-dismiss in 1.5 seconds and do not intercept the underlying UI;
  errors and confirmation-required states remain dismissible and persistent.
- Set-open metronome behavior is state-aware and idempotent: start once, live-retune, or no-op.
  UI, voice, ladder, and safety calls share a serialized native command boundary. Exact stop
  phrases route locally, and handled metronome events retain recognized text plus before/after
  state.
- The Brain receives the visible piece, selected Region, page, edition identity, active set,
  Today's written plan, canonical goals/history, notation facts, and cited practice sources.
- Clearly assistant-directed questions no longer require a wake phrase. Natural selected-Region
  set requests become editable, spoken, confirm-gated drafts. `confirm`/`cancel` work by voice,
  exact-once; edited values are authoritative; bare yes/no remain verdict words, not approval.
- Today has a date-scoped plain-language plan/intention box. Settings contains an honest,
  current in-app usage guide.
- The compact active-set HUD sits in normal page flow at 720×520 instead of covering the app;
  Expand reveals full controls, and the emergency safety stop remains visible while compact.

## Verification

- Frontend: **99 files, 985 passed, 2 todo, 0 failed**.
- Rust library: **501 tests discovered; 490 passed, 11 ignored, 0 failed**; every integration
  suite passed; clippy passed with warnings denied.
- Production TypeScript/Vite build passed; native Tauri `.app` built and ad-hoc sealed.
- Fresh-context verification found five real defects during review—stale edited-draft voice
  confirmation, a non-routing guide phrase, concurrent metronome publication, dropped edition
  identity, and hidden compact safety stop. All were fixed and regression-locked. Final verifier:
  **no actionable issue remaining**.
- Rendered 720×520 drive verified the compact HUD/session bar do not overlap, the guide is
  readable, Today's plan survives reload, and the blocking receipt card disappears after 1.5 s.
- Pre-install backup: `(C) pre-v3.1.0-install-2026-07-20-000233.db`, SHA-256
  `91e8c3fe5295d4d652a18b4486c336c96688148bf95ed2f892fd750e239ddb25`.
- Before/after live database: schema 10, integrity `ok`, zero foreign-key violations, exactly
  **6 pieces / 63 blocks / 559 reps / 14 sessions**.
- Installed Info.plist: 3.1.0; signature valid; DMG checksum valid; filesystem and Spotlight
  each resolve exactly one active app at `/Applications/CodaKiller.app`.

## Honest gaps

- Real Steinway-room recognition remains unproven; tests and narrated recordings do not prove
  `done` or `metronome stop` will be recognized correctly over live piano.
- A page number alone does not identify a measure range. Select a canonical Region first.
- Brain cannot yet create/edit Goals, Calendar work, session intentions, or arbitrary app state
  by voice. The complete capability registry and action ledger remain future work.
- Unfinished action drafts are not durable across relaunch. Natural corrections such as
  “change that to 72” are not yet a general action language.
- Today's plan is date-scoped local WebView storage, not part of SQLite/export and not a Goal or
  Calendar event.
- The repo still has no off-disk private remote.

## Next steps

1. Christian runs one real at-piano session using exact verdicts, `metronome stop`, a no-wake
   question, and one selected-Region natural set draft; record every miss verbatim.
2. Build the complete semantic capability registry for Today/Goals/Calendar/session planning,
   each action using preview → spoken readback → explicit confirm → durable receipt → undo.
3. Add page/edition-to-Region clarification and durable draft history without guessing measures.
4. Create and push the private off-disk git remote.
