# CodaKiller v3.2.0 — Version Record

**Shipped:** 2026-07-20
**Tag:** `v3.2.0`
**Implementation commit:** `853f440`
**Installed:** `/Applications/CodaKiller.app`
**Database schema:** 10 (no migration in this release)

## What this release is

v3.2.0 is the endurance and system-coherence release. Christian asked for the whole app to be
debugged as a serious pianist would use it over hours—not just a collection of component tests.
The governing question was: can every feature agree about the same live practice, preserve the
pianist's work, and reduce touching the computer?

It hardens the deterministic practice loop and makes the first screen-grounded Brain slice more
truthful. It does **not** claim arbitrary AI control or prove microphone recognition over a live
Steinway.

## What shipped

- Explicit native metronome ownership (`manual` or `practice(set_id)`) across set open, live
  retune, pause/resume, close, restart, manual takeover, safety stop, and relaunch.
- A session cannot end through a live set; graceful quit closes before serialized export.
- A 220-attempt stateful endurance simulation spanning every verdict, notes, variants, retries,
  tempo, pause/focus, correction/undo, recovery, relaunch, restart, retention, close, and export.
- Race-safe Brain threads/answers/actions and a visible `Coda sees` strip for exact piece,
  Region/range, page, edition, active set, and Today-plan context.
- Reviewed multi-item plan persistence across workspace switches and relaunch; concurrent item
  starts are visibly blocked.
- Preserved Score page/zoom/Region/inspector/draft state and Settings return-to-origin behavior.
- Exact Today/Universe destinations, repeatable same-piece deep links, truthful no-PDF handling,
  and native `piece_select { id }` synchronization.
- Hidden cached Score no longer captures paging keys or native score-navigation events.
- Expanded Rep HUD in page flow; rapid routine receipts expire after 1.5 seconds; all persistent
  failures/confirmations survive until explicit dismissal.
- Keyboard-operable Universe nodes/text equivalent, nested tab semantics, and focused/Escape-
  cancellable action drafts.
- Removed dead Reset/theme Settings promises; dark-only appearance, clean-streak defaults, and
  attempt-review boundaries now match the UI.

## Verification

- Frontend: **99 files / 1,025 passed / 0 failed / 0 todo**.
- TypeScript and production Vite build passed.
- Rust library: **495 passed / 11 ignored**.
- Rust integration suites: **34 passed / 2 ignored**; **529 passed / 13 ignored total**.
- Strict clippy passed with warnings denied.
- Interactive mock drive covered every workspace, exact repeated deep links, hidden-score paging,
  grounded plain-English Brain, keyboard Universe, and 24 rapid rep writes/receipt expiry.
- Fresh-context verification found and forced fixes for nine initial integration/accessibility/doc
  defects, then hidden Score key capture, repeated same-ID deep links, sticky-receipt eviction, and
  a scheduling-dependent no-PDF alert race. Final verdict: **Ship**.
- Pre-install backup: `(C) pre-v3.2.0-install-2026-07-20-014755.db`, SHA-256
  `9b82ceee860cb772a0fb1ea7a1ec99291d6dd598589c29fd104c5e913a00745a`.
- Disposable production reopen rehearsal and post-package launch/quit: schema 10, integrity `ok`,
  zero FK violations, exactly **6 pieces / 63 blocks / 559 reps / 14 sessions**.
- Installed Info.plist 3.2.0, valid ad-hoc signature, exact-one-app audit, DMG checksum passed.
- DMG SHA-256: `0492a63cc6807a5d4ac239ab427242941148ec179d60a65564fc128a4ea5891d`.
- The installed app was launched once, quit normally, and left closed.

## Honest gaps

- Real Steinway-room Speech Recognition remains unproven. If macOS transcribes `stop` as
  `sixty`, the deterministic router cannot reconstruct the unheard intention; exact
  `metronome stop` routes correctly and raw transcripts are retained for diagnosis.
- The 2.5-second identical-final dedup can suppress a genuinely repeated rapid `done`. A safe fix
  needs recognizer utterance/delivery identity; shrinking the timer risks duplicate attempts.
- Brain actions remain verdict, tempo, undo, restart, and selected-Region set draft—not full
  Today, Goals, Calendar, session, or Score authority.
- A General Brain question without a selected piece cannot yet receive Today's plan.
- Unfinished action drafts disappear safely on relaunch. Page-only practice targets remain
  fail-closed without a selected/mapped Region.
- A Claude consumer subscription does not include Claude API access. Offline mode is bounded local
  retrieval, not a local LLM; the 8 GB M2 Air remains a hard no-resident-model constraint.
- The repo still has no off-disk private remote.

## Next steps

1. Christian runs one real at-piano v3.2 session: exact verdicts, rapid repeated `done`,
   `metronome stop`, one no-wake question, and one selected-Region natural set request; save every
   recognition/routing miss verbatim.
2. Build the complete typed capability registry for Today/Goals/Calendar/session planning using
   preview → spoken readback → explicit confirm → durable receipt → undo.
3. Add page/edition-to-Region clarification and durable draft history without guessing measures.
4. Create and push the private off-disk git remote.
