# CodaKiller v6.0.1 "Real-Use Fixes" + v7.0.0 "Motivation Layer" (approved design)

> **Status:** Approved by Christian 2026-08-20 (brainstorming session; all recommended
> options taken). Drives two releases: the **v6.0.1 patch** (ships first, no schema
> change) and **v7.0.0** (three plans, schema v15).
> **Source:** Christian's 2026-08-20 acceptance-with-issues verdict on v6.0.0 (four issue
> areas: score top-row overlap, voice misfires, Assistant not worth asking, dock/panel
> ergonomics) + the motivation-layer half of the July 31 goal dump, deferred out of v6 on
> 2026-08-05 (galaxy, streaks/photo calendar, animations, dynamics checker, Brain
> usefulness — verbatim quotes in `(C) Changelog` 2026-08-05 entry).

## Decisions made with Christian 2026-08-20

- **v6.0.0 verdict:** accepted **with issues** — the four areas above. Recorded; the
  Roadmap's "no v7 before a verdict" gate is satisfied.
- **B54 backup:** approved — private GitHub repo (`gh repo create codakiller --private
--source=. --push`). Blocked only on an interactive `gh auth login`; run it the moment
  that lands. v7 implementation must not start before the remote exists.
- **Release shape:** v6.0.1 patch first, then one v7.0.0 with three plans (A Galaxy &
  Ritual, B Dynamics, C Assistant) — the v6 shape, reused.
- **B74:** decided **drop the column** — executed in v7's v15 migration, _not_ in the
  patch, so the patch stays schema-free.
- **Photo source:** webcam capture + file-drop fallback.
- **Galaxy mechanic:** piece = star system (focused time grows the star, mastered
  sections orbit, streaks glow).
- **Assistant pillars:** all four (practice data, book coaching, planning help, piece
  knowledge).

## Constraints (unchanged, binding)

- User-as-sensor. The dynamics checker is the first and only approved
  mic-judges-loudness feature: **loudness only, forever** — no pitch, no onset/note
  detection, no transcription, no correctness grading. If a design detail drifts that
  way, the detail is wrong and gets cut.
- Deterministic hot loop; the LLM is never in the rep/metronome path. Assistant tools
  are read-only and confirm-gated.
- 8 GB M2 Air (D1): no local ML runtimes. Dynamics DSP is a weighting filter + RMS —
  no FFT pipeline, no models.
- Live DB never opened/migrated from dev code; the v15 migration rehearses on a fresh
  copy via `CODAKILLER_MIGRATION_COPY=<copy> cargo test --lib
rehearse_migration_on_real_database_copy -- --ignored`.
- Every voice-router or fast-path change re-passes the narrated-corpus replay (finals
  AND partial-stream suites) with zero false mutations. No bare prefix word ever joins
  the fast-path allowlist.
- All 85+ legacy CSS token names preserved. Paper design language throughout.
- Suggest, never dictate. Earned-only: nothing in the galaxy/streak/photo layer can be
  granted, bought, backfilled, or faked — every visual is a pure function of recorded
  practice events.

---

# Part 1 — v6.0.1 "Real-Use Fixes" (patch, no schema change, no migration)

## P1 — Score top-row overlap (Christian's report; mechanism confirmed by recon)

**What breaks.** `.score-edition-group` (`ScoreView.tsx:2566`) holds six controls
(Edition select, Draw target, Pencil, Map this score, Map measures, Show measures) in a
flex row with **no `flex-wrap`** (`ScoreView.css:81-100`); the only narrow-width rule
(900px, `ScoreView.css:1073-1086`) restacks `.score-zoom` but never reflows the edition
group. At narrow widths the controls collide/overflow.

**Fix.**

- Allow the edition group to wrap; give the `.score-toolbar` grid a proper narrow
  reflow (edition group full-width row, page controls + zoom below) at the width where
  wrapping alone still crowds — measured, not guessed.
- If a wrapped toolbar eats too much score height at the 720×520 floor, collapse the
  lower-priority controls (Draw target, Pencil, Map measures, Show measures) behind a
  "⋯" overflow menu at narrow widths. Wrap first; menu only if needed by eye.
- Screenshot QA at 720×520 AND at Christian's real window size, with the stale notice
  (`measure-map-stale`), pencil bar, and score banner all visible simultaneously —
  the worst-case top-of-score stack.

## P2 — Dock/panel ergonomics (Christian's issue area)

- Harden mount-time clamping (the past defect class: a remembered position off-screen
  or over an interactive surface must be corrected on mount, not only on drag).
- Collision-free **default** placements: no default panel position may cover the score
  toolbar, the rep card, or the day sheet's header.
- "Reset panel layout" affordance in Settings.
- Panels stay freely draggable — fix where they land, never what he's allowed to do.

## P3 — B70: fast-path tail guard suppresses by routed intent, not prefix

Suppress the settled final **only when its routed intent matches the action the fast
path already took**. Consequences that must hold (and become corpus lines):
"metronome on ninety six" sets 96; an ambient sentence starting "metronome off …" that
routes to Ignored does not stop the click and shows fully in the heard pill. Regression
lock: extend the partial-STREAM replay suites; the full 1,309-utterance corpus stays at
zero false mutations. Rust/TS router parity tested on the same phrases.

## P4 — B72: BooksPanel nested form

The "Add a book" `<form>` inside the settings `<form>` becomes a non-form group
(explicit button handlers). React dev error gone; behavior identical.

## P5 — Docs + backup

Acceptance verdict recorded in vault docs; Flaws updated (B70 → Resolved on ship, B72 →
Resolved, B54 → Resolved when the push succeeds); Changelog, CodaKiller.md, How To Use
(voice phrasing note for "metronome on 96" un-caveated) per the update protocol.

**Out of the patch, deliberately:** anything with a migration (B74 → v7), B71 second
output stream (architecture decision, revisit if ever hit in practice), B73
(unreachable today), B67/B75 (Christian-action + usage, standing items).

---

# Part 2 — v7.0.0 "Motivation Layer" (schema v14 → v15)

## Schema v15 (one migration, rehearsed)

- **Drop** `session.focused_seconds` (B74: NULL on all rows ever; the event-derived
  `metrics::focused_seconds` heuristic is and remains the single source of truth).
- **Add** `day_photo` (day key, file path relative to app-data, content hash, created
  ts). Images are files under app data, never DB blobs.
- **Add** dynamics calibration storage (per profile: device id + label, ordered
  pp→ff calibration points as measured levels, created ts; one active profile).
- Streaks and the galaxy need **no schema** — both derive from existing events/read
  models at read time.

## Plan A — Galaxy & Ritual

**A1 — Earned-only living galaxy.** Each piece is a star system: focused time grows the
star; each mastered section becomes an orbiting body; an active streak adds glow.
"Living" = deterministic ambient motion (twinkle, slow orbit, parallax) — **no physics
sim** (removed in v5, stays removed) and no interactivity requirement beyond the
existing navigate-to-piece. The render is a pure function of practice events — property
test: two DBs with identical event histories render identical galaxies; no code path
can add a visual without a backing event. Replaces the static Universe view in place
(same route, same deep links).

**A2 — Day streak.** A calendar day joins the streak at **≥ 10 focused minutes**
(event-derived; configurable in Settings; a 24-second launch poke never counts).
Current + best streak shown in Today and Calendar. Timezone/day boundary follows the
v6 day-scoped session convention (localtime).

**A3 — Photo calendar.** At day close ("end my day" or midnight auto-close prompt at
next launch), offer a webcam capture (getUserMedia, front camera, one tap) with
file-drop fallback. Skippable in one keypress — a ritual, not a toll. Calendar day
cells render photo thumbnails Liftoff-style; a day with practice but no photo shows
the existing planned-vs-done bars unchanged.

**A4 — Completion animations.** Three moments: set complete, mastery landing, day
close. Short (< 1.5 s), deterministic, paper/ink design language, never input-blocking,
`prefers-reduced-motion` honored (reduce to a static flourish), paired with the
existing chime/speech ack policy (no new audio path).

## Plan B — Dynamics Checker (isolated; spike first)

**B0 — SPIKE (feasibility, throwaway, answers before any UI).** Can a cpal input
stream coexist with hear-CLI speech recognition on the same default mic on the M2 Air
(both live during a session)? Measure CPU/RSS of the meter loop. If coexistence fails,
the fallback design is push-to-measure (dynamics capture pauses STT) — Christian
decides that trade-off if the spike forces it.

**B1 — Level meter core (Rust).** cpal input → A-weighting filter → short-window RMS +
peak, streamed to the frontend at panel rate. Loudness only; the module exposes dB
figures and nothing else.

**B2 — Calibration wizard.** Guided per-piano capture: play pp, p, mf, f, ff at the
Steinway; store the curve as the active profile (per device). Recalibrate any time;
profiles named (e.g. "Steinway, living room, lid half").

**B3 — Live readout.** A floating dock panel (v6 dock family: draggable, minimizable,
clamped) showing the current level mapped onto the calibrated pp→ff band.

**B4 — Target mode.** User-triggered only: pick a dynamic (or a crescendo range);
the meter shows the zone and where the playing landed. The app reports levels;
Christian judges the music. No verdict writes, no streak effects — motivation
surface, not a contract term (revisit only if he asks).

## Plan C — Assistant Usefulness (all four pillars)

**C1 — Practice-data tools.** The Brain gets read-only, confirm-gated tools over the
deterministic read models (history days/detail, progress summary, per-piece/per-block
stats, streaks): "what's stalling?", "what did I do last week?", "which piece is behind
plan?" get grounded, citable answers. Tool results are the only source for numeric
claims — the honest-grounding rule from v6 extends to numbers: no figure without a
tool row behind it.

**C2 — Book-grounded coaching.** The 4-book corpus (Roskell, Gebrian, Breth,
Gieseking/Leimer) retrieved against the current situation and cited — "you've failed
this passage at 96 six times; Breth's step-back rule says…". Advice is suggestion-only.

**C3 — Planning help.** On request, compose a suggested day plan from carry-forward,
`pass_seconds` estimates, and break science (the "three in a row, then break" pattern).
Output is a draft the user applies or ignores — never auto-imposed (the v4 lesson).

**C4 — Piece knowledge.** Questions about the open piece grounded in its actual
metadata (edition, composer, regions, goals banner) rather than hallucinated context.

## Non-goals (v7)

- No pitch/note/onset detection, transcription, or correctness grading — the checker
  measures decibels.
- No purchasable/grantable/backfillable galaxy content; no points, coins, or levels.
- No separate OS windows; panels stay in-app (2026-08-05 direction call).
- No Assistant write-access to practice data; no LLM in the hot loop.
- No social/sharing features.

## Verification regime (unchanged, binding)

Per-slice fresh-context adversarial verification before anything counts done;
narrated-corpus (finals + partial-stream) zero-false-mutation gate on any voice
touchpoint; v15 rehearsal on a fresh live-DB copy before install; 720×520 screenshot
QA for every new surface; vitest/cargo/tsc/clippy all green at merge; lanes live in
`~/.ck-lanes/` (never the session scratchpad); commit per numbered item.

## Standing items riding alongside (not v7 scope)

- **B67:** Christian adds an Anthropic key to Keychain — until then Claude vision has
  never executed.
- **B75:** v7's QA checklist includes running measure mapping once on a real score so
  the headline v6 feature finally has a live datapoint.

## Next steps

1. Christian reviews this spec file.
2. On approval: implementation plans via the writing-plans skill — v6.0.1 first
   (single plan), then v7 Plans A/B/C (B0 spike scheduled first within B).
3. v6.0.1 builds, verifies, ships, installs; v7 lanes start only after the patch
   ships and the GitHub remote exists.
