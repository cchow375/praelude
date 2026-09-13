# CodaKiller v4.0.0 — Version Record

**Shipped:** 2026-07-30
**Tag:** `v4.0.0`
**Implementation/release commit:** `ab7828a`
**Installed:** `/Applications/CodaKiller.app`
**Rollback preserved:** `~/CodaKiller-v3.2.0-rollback.app`
**Database schema:** 10 → 11 (additive migration; see below)

## What this release is

v4.0.0, "the Practice Notebook OS," is the largest release since the v3.0.0 frontend
rework. Christian's July 27 goal dump asked for the whole app in one round: fix bugs and
performance first, overhaul the UI, rename Brain→Assistant and Ledger→History, and build
the real Practice Notebook — a day sheet, a Plan tab, and a passage-helper — plus quotes,
a scholarly reader, a book library, in-app IMSLP search, and a real score-mapping wizard.
Four phases (A–D), all merged to `main`, each independently fresh-verifier CONFIRMED before
this ship.

## What shipped

- **Phase A — bug/perf fixes:** Universe click/teleport fix (flaw B40); rep counter/
  metronome display fix so a rung-completing clean no longer flashes 0/N (flaw B41); a
  transform-first score-zoom pipeline (scales the existing bitmap on the same frame, one
  crisp re-render 140ms after the gesture settles) plus trackpad pinch-zoom.
- **Phase B — UI overhaul:** collapsed practice form (context + target + one defaults row +
  a single More disclosure, byte-identical submit payload); rebuilt metronome quick bar +
  no-scroll icon popover; 148px icon rail; Today rebuilt as the app's main menu with a
  Today's-Practice window; **Brain → "Assistant"** and **Ledger → "History"** renamed across
  every user-visible string.
- **Phase C — the Practice Notebook (schema v11):** `day_sheet` and `piece_plan` tables; a
  paper-like day-sheet editor where chips insert editable text; a Score **Plan** tab with
  two-way sync; calendar past-day sheets; one-step flag (⚑) goal promotion; an Assistant
  passage-helper whose Accept button is the sole write path. Browser QA 10/10.
- **Phase D — quotes/reader/books/IMSLP/mapping:** 182 machine-verified-verbatim quotes
  opening a scholarly windowed reader; a data-driven book library with a Settings Books
  panel; in-app IMSLP search + edition picker (download hands off to the system browser
  because IMSLP CAPTCHA-gates files — documented, not bypassed — with typed-name archive
  removal); a real score-mapping wizard rendering the actual PDF page with a parallel
  measure strip and real MusicXML landmarks; piece-switch cache.

## Verification

- Frontend: **1,270 passed / 1,270 total** (125 files).
- Rust: **580 passed / 0 failed**, plus clippy `-D warnings` clean.
- TypeScript (`tsc`): clean.
- Every feature lane passed an independent fresh-context adversarial verifier before
  merging to `main`.
- Phase C browser QA: **10/10**, screenshots saved in `~/codakiller/.workflow/scratch/c-qa/`.
- Migration rehearsed on a fresh copy of the live database (schema v10 → v11, additive,
  counts preserved) before touching the live app.
- Live launch migrated the real database schema **10 → 11**: integrity `ok`, zero FK
  violations, exactly **6 pieces / 98 blocks / 803 reps / 21 sessions** before AND after
  migration; new `day_sheet` and `piece_plan` tables empty and ready for use.
- Pre-install backup: `(C) pre-v4.0.0-install-2026-07-30-144607.db`, SHA-256
  `fddd6cb12b1f047379008d1b15af8725ef00ea53b4b4fe8e3bd2d0a13d845116`.
- Rollback app preserved at `~/CodaKiller-v3.2.0-rollback.app`.

## Honest gaps

- **Christian's hands-on acceptance is still open.** No design verdict from the screenshots
  yet, and no real Steinway practice session has run against v4.0.0. Voice recognition risk
  over a live acoustic piano is unchanged from v3.2.0 — this release does not touch that
  problem.
- **Fresh binary killed TCC grants.** Christian must re-allow Microphone and Speech
  Recognition on first real use of the new `.app`; Dictation must be ON.
- **Flaws B43–B46 remain open by design** — not addressed in this release; see [[(C) Flaws]].
- **No off-disk private git remote (standing item C1).** The repo is still local-only; disk
  loss is total loss.
- **Real-world piece-switch wall-clock time and the wizard's visual alignment still need
  in-app eyeballing** — automated tests and QA screenshots cover function, not the felt
  experience at the piano.

## Next steps

1. Christian gives a design verdict from the shipped screenshots, then runs one real
   at-piano v4.0.0 session on the Steinway — exact verdicts, at least one Practice Notebook
   day-sheet entry, one Plan-tab edit, and one Assistant passage-helper Accept — and records
   every recognition/routing miss verbatim.
2. On first real use, re-grant Microphone and Speech Recognition permissions (fresh binary
   reset TCC); confirm Dictation is ON before testing voice paths.
3. Investigate and either fix or formally scope flaws B43–B46.
4. Create and push the private off-disk git remote (`gh repo create codakiller --private
--source=. --push`).
5. Once the at-piano session lands, close the loop: update [[(C) Flaws]], [[(C) Changelog]],
   and [[(C) CodaKiller Command Center]] with the real-use findings, and open the next
   milestone (the Today/Goals/Calendar/session-planning capability registry that v3.2.0's
   record already flagged as unfinished).
