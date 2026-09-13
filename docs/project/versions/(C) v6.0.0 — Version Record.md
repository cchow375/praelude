# CodaKiller v6.0.0 — Version Record

**Shipped:** 2026-08-18
**Tag:** `v6.0.0`
**Installed:** `/Applications/CodaKiller.app`
**Rollback preserved:** `~/Library/CodaKiller-rollbacks/CodaKiller-v5.0.0-rollback.app.tar.gz`
_(Corrected 2026-08-20: recorded as an unpacked `.app`, but rollbacks are stored as tarballs — Spotlight indexes `~/Library`, and a second unpacked bundle there fails the one-copy rule.)_
**Database schema:** 13 → 14 (additive migration; see below)

## What this release is

v6.0.0, "Practice Core," is the largest release since the v3.0.0 frontend rework — four
implementation plans under one approved spec, built and merged one at a time over
2026-08-06 through 2026-08-11, then shipped together. It answers Christian's July 31 goal
dump in full except the explicitly deferred "make practice addictive" half (v7.0
Motivation Layer): the score should know where its measures are; tracking should be a
small floating window, not the whole screen; plans and history should respect time; and
the voice/metronome loop plus the Assistant's misleading status copy needed fixing.

## What shipped

- **Plan C — Score Intelligence:** opt-in, per-piece **automatic measure mapping** —
  scan the real page images with a cloud vision model, reconcile deterministically against
  MusicXML bar counts (pickup-aware), then a human **review overlay** with drag-to-edit
  before an explicit **Apply** gate commits anything; tiny grey per-bar numbers render
  after Apply, with a **Show measures** toggle and an honest **stale** notice on re-scan.
  **Snap selection** — drawn boxes snap to the nearest mapped bars. **One-level
  sub-sections** on the long-unused `target_meta.parent_region_id` column (schema v8,
  never read or written until now). The real-API Scherzo acceptance run took four
  evidence-directed algorithm iterations before closing done-with-documented-limits:
  printed-number OCR came out ~flawless, but barline-COUNT geometry stays unreliable,
  worst on multi-staff systems. **Every scan in that run went through Gemini only — no
  Anthropic key exists in this Mac's Keychain, so Claude vision has still never been
  exercised** (standing action item, Flaws B67).
- **Plan A — Practice Surfaces:** schema v14 (`measure_map`, `piece.banner_text`,
  `set_contract.pass_seconds`, a one-ACTIVE-set index relaxation for plural paused sets);
  a floating **Practice Dock** (Rep Counter / Paused Sets tray / Clock-Timer, each
  minimizable to a pill) replacing the old docked HUD strip; **pause-across-days** with
  durable paused sets and auto-pause-on-resume semantics; **day-scoped sessions** (a
  session auto-closes at local midnight, retroactively, with an explicit **End my day**
  action); a day-sheet **date navigator** with **carry-forward**, **plan-total time**, and
  optional **per-set time estimates**; and a per-piece **goals banner** that can be pinned
  from the day sheet.
- **Plan B — Read Models:** two pure read commands, no schema change, no migration, zero
  new write paths — `history_days` / `history_day_detail` / `day_sheets_range` back a new
  **Days** default view in History (collapsed day cards, disclosure detail, 21-day paging;
  the old piece-indexed view lives behind a **Pieces** toggle) and planned-vs-done bars in
  Calendar day cells.
- **Plan D — Voice & Brain:** a **fast path** so "metronome off"/"metronome stop"/
  "metronome on" act on the partial transcript, changing state in under a second (was
  ~5 s); **chime acks** for routine metronome/rep actions, with speech reserved for
  anything that carries real information; looser natural-language matching ("turn the
  metronome on," "can you stop the metronome") and ASR-mangle tolerance ("metranome,"
  "metrodome") on the same conversational firewall; a **heard-text pill** that flashes
  everything the app heard, including ignored speech; a warmer default cloud voice
  (**Aoede**) that now retries after a cooldown instead of locking to the robot `say`
  fallback for the rest of the session, with a quiet **"Voice degraded — using system
  voice"** pill while it's down; and honest Assistant grounding copy — "No book excerpts
  matched this question" / "Book excerpts are kept on this Mac (sharing is off in
  Settings)" / "No knowledge books are indexed yet" instead of anything implying hidden
  content — with answer-first responses and citation ids never read aloud.
- **B58 harness repair (Lane H, merged first):** the rehearsal-harness test had been
  misreading the historic July v12 chamber-split (Barber/Copland) as 118 "wrongly
  attributed" rows. Made the exception split-aware, snapshotted the pre-migration
  exception count, and asserted the mapping is byte-identical before vs. after — the
  fresh live-DB copy rehearsal now runs clean, unblocking the real migration.

## Verification

- Frontend: **vitest 2101 passed / 1 skipped**.
- Rust: **cargo 855 passed / 0 failed**, plus `cargo clippy --all-targets -- -D warnings`
  clean.
- TypeScript (`tsc`): clean.
- Six narrated-corpus/firewall suites (including the 1,309-segment narrated-session
  replay): **zero false mutations**.
- **Two** fresh-context adversarial verification passes on the merged diff, per the
  binding process:
  - **Pass 1 — REFUTED.** Found a critical fast-path defect: bare words like "stop" and
    "again" were firing on partial transcripts at the head of ordinary sentences,
    producing phantom rep writes on four corpus lines. Fixed before ship — the fast path
    was narrowed to the exact phrases "metronome off" / "metronome stop" / "metronome on"
    only.
  - **Pass 2 — CONFIRMED, verdict SHIP.** Independently re-verified the fix; one residual
    logged (Flaws B70 — the orchestrator's entry).
- Live smoke QA via devMock: app boots, Dock/pill/Assistant copy render, no console
  errors.
- Migration rehearsed on a **fresh copy of the real live database** immediately before
  install (schema v13 → v14, additive; B58 fixed first so the rehearsal harness itself is
  trustworthy).
- Live launch migrated the real database schema **13 → 14**: integrity `ok`, exactly
  **9 pieces / 171 blocks / 1,640 reps / 34 sessions** before AND after migration.
- Pre-install backup: `(C) pre-v6.0.0-install-2026-08-18-101647.db`, SHA-256
  `c142f70a2bfed212edb567bc57ea9030b251b11ef9e540e6f7f57e4cbb94b58b`.
- Rollback app preserved at
  `~/Library/CodaKiller-rollbacks/CodaKiller-v5.0.0-rollback.app` (rollback apps now live
  under `~/Library/CodaKiller-rollbacks/` rather than directly in `~`, since the release
  one-copy rule scans the home folder).

## Honest gaps

- **Christian's at-piano acceptance is still open.** No real Steinway session has run
  against v6.0.0 yet — measure mapping, the Practice Dock, pause-across-days, the new
  voice/metronome feel, and the Assistant's honest copy are all unproven at the piano.
- **Claude vision has never actually been exercised.** No Anthropic API key exists in
  this Mac's Keychain; every real-API measure-mapping run to date, including the ship
  acceptance run, went through Gemini only (Flaws B67).
- **Fresh binary may re-prompt for permissions.** Microphone and Speech Recognition
  grants can be reset by the reinstall; Dictation must be confirmed ON before testing
  voice paths.
- **Flaws B70–B73 remain open by design** — new residuals from this release; see
  [[(C) Flaws]] (owned by the orchestrator, not this record).
- **No off-disk private git remote (standing item C1).** The repo is still local-only;
  disk loss is total loss.

## Next steps

1. Christian runs one real at-piano v6.0.0 session on the Steinway — an applied measure
   map, a Practice Dock pause-and-resume across the panel, one "metronome on"/"metronome
   off" pair timed by feel, one heard-text-pill check, and one Assistant question that
   should return the new honest grounding copy — and records every recognition/routing
   miss verbatim.
2. Add an Anthropic API key to Keychain so Claude vision gets exercised at least once
   (Flaws B67).
3. On first real use, re-grant Microphone and Speech Recognition permissions if prompted;
   confirm Dictation is ON.
4. Once the at-piano session lands, close the loop: update [[(C) Flaws]],
   [[(C) Changelog]], and [[(C) CodaKiller Command Center]] with the real-use findings.
5. Open the v7.0 "Motivation Layer" spec round (living earned-only galaxy, streaks +
   end-of-day photo calendar, completion animations, the full calibrated volume/dynamics
   checker, Assistant usefulness overhaul) — scoped and deferred in the v6.0.0 spec,
   awaiting its own approval round.
6. Create and push the private off-disk git remote (`gh repo create codakiller --private
--source=. --push`).
