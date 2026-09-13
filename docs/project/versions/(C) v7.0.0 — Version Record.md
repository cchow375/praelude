# CodaKiller v7.0.0 — Version Record

**Shipped:** 2026-08-24
**Tag:** `v7.0.0`
**Installed:** `/Applications/CodaKiller.app`
**Rollback preserved:** `~/Library/CodaKiller-rollbacks/CodaKiller-v6.0.1-rollback.app.tar.gz`
**Pre-install backup:** `(C) pre-v7.0.0-install-2026-08-24-165722.db`
SHA-256 `69fae67bd911f0889e33d6025893f7add3fa2492e9881ef923f843fe2d14a0e1`
**DMG:** `releases/v7.0.0/CodaKiller-7.0.0.dmg` — SHA-256 `a9a00b9eadeb7b8b07953bf2ce0027b5722bbd4d7ad6d3700f64219d3f301aeb`
**Database schema:** 14 → 15 (drops one dead column, adds three tables)

## What this release is

v7.0.0, "Motivation Layer," is the release that makes practice *visible*. The Universe stops
being a static index and becomes a living galaxy that can only grow from real work; days you
practise join a streak; the day closes with a photo if you want one; finishing something feels
like finishing something. Alongside that it adds the first — and deliberately the only —
feature where the microphone judges anything: a calibrated **loudness** meter.

It also ships the AI Assistant **switched off by default**, at Christian's request mid-build:
"it's just getting in the way and it is very extra and is a whole different project."

## What shipped

**Plan A — Galaxy & Ritual.** A deterministic SVG + CSS galaxy replacing the static Universe in
place (same route, same deep links): pieces are star systems whose disc grows with log-scaled
focused time, whose ring shows earned maturity, whose mastered sections orbit, and which glow
during an active streak. Never-practised pieces render as hollow unlit markers. No
`requestAnimationFrame`, no physics, no simulation — motion is entirely CSS, so nothing can
desynchronise, and `prefers-reduced-motion` renders it still. A global day-streak read model
(≥10 focused minutes, configurable) surfaces current and best runs in Today and Calendar, with
no streak table and no write path. An end-of-day photo ritual (webcam or file, Esc/Skip in one
keypress, never a toll) with Liftoff-style Calendar thumbnails that keep the planned-vs-done
numbers intact. Completion animations for set-complete, mastery and day-close: under 1.5s,
non-blocking, reduced-motion aware, no new audio path.

**Plan B — Dynamics Checker.** Its own `cpal` input thread (the realtime output engine is
untouched — zero diff), A-weighting via three cascaded biquads derived at the device sample rate
by bilinear transform (no FFT, no crate, no model), 125 ms RMS + peak pushed at 8 Hz. A pp→ff
calibration wizard whose one-active-profile rule is enforced by a partial unique index and
written in a single transaction. A live readout dock panel using listen-then-fetch (never polls)
that tears the mic down on close/minimise/unmount with no warm state. Target mode as a pure
reducer that writes nothing at all. **Loudness only, forever** — no pitch, onset, transcription
or grading anywhere.

**The Assistant switch.** A Settings checkbox, **off by default**, that hides the tab, the
workspace, Today's Assistant entry, the passage-helper card, and the connection panel — and,
critically, stops a spoken question routing to a model. The refusal is enforced in Rust on every
provider-reaching command, spy-proven to make zero network calls, because IPC commands are
callable regardless of which view is mounted.

**B81 — the silent `say` fallback.** Found while chasing a red test that predated v7. The app
invoked `say` with no voice, depending on a macOS default that on this machine returns 118 frames
(0.005 s) for any text. Since v6 `say` is the fallback when Gemini TTS fails, a Gemini outage left
the app believing it had spoken while emitting silence. Now: an explicit resolved voice (cached,
retried if the probe fails), the configured `tts.voice` actually reaching the fallback (it never
did), a hollow synth reported rather than returned as speech, and degraded state surfaced when
both providers fail.

**Schema v15.** Drops `session.focused_seconds` (B74 — NULL on every session ever recorded; focus
time was always derived from events). Adds `day_photo` (path + content hash; photos are files,
never blobs) and `dynamics_profile` / `dynamics_calibration_point`.

## Verification

Gates at ship: **vitest 2285 passed / 1 skipped**, **cargo 949 passed / 0 failed**, clippy
`--all-targets --all-features -D warnings` clean, `tsc` clean, production build clean.

Migration rehearsed on a fresh copy of *that day's* live database before install: schema 15,
integrity ok, row counts preserved (10 pieces / 193 rep_blocks / 1,814 reps / 40 sessions).

**Ten adversarial verification rounds ran across this release, and they REFUTED work six times.**
The regime paid for itself repeatedly:

- The B0 spike and the first v15 rehearsal were reported done with **no retained evidence** — no
  CSV, an empty capture, a claimed dBFS figure the spike's own code could not produce, and a
  rehearsal commit that was literally empty. Both were re-run with every artifact kept.
- **The galaxy violated its own earned-only law**: a never-practised piece rendered a full
  glowing star tagged with a zero-valued evidence field, the glow borrowed from a global streak.
- The **720×520 guarantee never covered orbits** — four mastered regions threw bodies off-canvas;
  setting the orbit gap to 400 left the suite green.
- **A photo deleted the day's planned-vs-done evidence**, and `day_photo_delete` deleted files
  **outside** the photo directory via a crafted key.
- The **ritual lost days two ways** (a single overwritten slot; StrictMode consuming a destructive
  read), and mastery celebrations **re-fired on every refetch** for sets the authoritative field
  said were not satisfied.
- Fifteen surviving mutants were killed across the release. The worst would have displayed a
  **long-dead 30-day streak as current** with every test green.

## Honest gaps

- **The Assistant overhaul is ON HOLD, not done.** Its tool loop and numbers policy live on the
  unmerged branch `v7/plan-c` (pushed to the remote). That policy was **refuted twice**: it let a
  fully fabricated answer ship *with a provenance chip* ("twelve times… nineteen days" against a
  real streak of zero), while simultaneously blocking honest sentences like "one more slow pass".
  C2 coaching, C3 planning and C4 piece knowledge were never built. Resume only on Christian's
  word.
- **No at-piano acceptance yet** for v7.0.0 — owed, as for every release before it.
- **No 720×520 live screenshot QA** of the new surfaces; coverage is automated only, and this
  project has a documented history of jsdom-green-but-broken UI.
- **B75 still open:** measure mapping has still never produced a row on the live database.
- **B67 still open:** no Anthropic key, so the Claude vision path has never executed. A Gemini key
  is present.
- Minor: `day_photo_read_verified` joins the stored path without the new containment helper
  (unreachable today); the devMock's date validator diverges cosmetically from Rust's for years
  1–99; **B80** — `brain_intake_apply` has no devMock handler.

## Next steps

1. **Practise on it** and record an at-piano acceptance verdict.
2. Live 720×520 QA of the galaxy, streak line, capture card, calendar thumbnails and the
   Dynamics panel.
3. Calibrate the dynamics meter at the Steinway — the first real use of that feature.
4. B75: run measure mapping once on a real score (the Gemini path works).
5. Decide whether the Assistant resumes, and if so with what design.
