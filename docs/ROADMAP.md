# CodaKiller — Roadmap

> The build plan and what's next. Phases end **usable + verified**. Each version maps to
> a phase span; every phase block ends with concrete next steps so the next session never
> has to guess where to pick up. Canonical phase definitions live in the design spec
> (`docs/superpowers/specs/2026-07-09-codakiller-design.md` §7); this doc tracks **status
> + next steps** and stays current.
> **Last updated: 2026-07-10.**

## Version ↔ phase map

| Version | Phases | Meaning | Status |
|---|---|---|---|
| **v0.1.0** | P0–P2 | Skeleton + metronome + voice loop | 🟢 shipped 2026-07-09 (tag `p2-done`) |
| v0.2.0 | P3 | Pieces + rep engine (the real product begins) | 🔴 not started |
| v0.3.0 | P4 | Score viewer | 🔴 not started |
| v0.4.0 | P5 | Brain + knowledge library | 🔴 not started |
| v1.0.0 | P6 | References + full design pass (vision complete) | 🔴 not started |

---

## 🟢 P0 — Skeleton — DONE
Tauri scaffold, dark/light shell, settings store, sqlite schema v1, toolchain (Rust via
brew, vendored `hear` 0.8), `.app` builds. (Tasks 1–4.)

## 🟢 P1 — Metronome — DONE
Sample-accurate cpal audio engine (fractional clock + mixer, lock-free RT thread), 6
synthesized click sounds, accents/subdivisions/gain, boost mode (crash-safe volume
restore), popover UI. Daily-usable. (Tasks 5–8.)

## 🟢 P2 — Voice loop — DONE
`hear` STT supervisor + half-duplex gate + deterministic intent router + Gemini TTS (with
`say` fallback) + Keychain key handling. Spoken commands drive the metronome; never hears
itself; 60 s real-piano-plus-narration → zero false intents. (Tasks 9–14.)
Ships as **v0.1.0**. **⚠️ Acceptance caveat:** verified by automated tests + `say`-through-
speakers only — the human at-piano checklist (`docs/qa/p2-acceptance.md`) is **pending**.

### ⟶ Immediate next steps (before/independent of P3)
1. **Christian runs the at-piano acceptance checklist** (`docs/qa/p2-acceptance.md`, ~10
   min). This is the first real-world signal for the entire thesis — highest priority.
2. **Set up an off-disk git remote** (`gh repo create codakiller --private --source=. --push`)
   — the repo is local-only (see `FLAWS.md` C1).
3. Carry the two P2→P3 debts into P3 (below).

---

## 🔴 P3 — Pieces + rep engine — NOT STARTED — **the next build, → v0.2.0**
This is where CodaKiller starts being the product it's for. From the spec:
- **Pieces:** seed the list from the vault (`Piano Practice/Pieces/*/score/*.musicxml`;
  PDF-only pieces still get tracking). First open of a piece = **intake interview** (verbal
  or typed): goals, deadline, target tempo, known hard spots. Stored per piece.
- **Rep tracker (the heart):** rep blocks over a measure range with auto- or manual ladders
  (rep count + bpm increments), named/reorderable variant schemes (dotted/staccato/legato…),
  and **verbal check-off** ("done" / "again" / "nope, missed the LH jump") logging tempo,
  variant, verdict, note. Coach speaks back minimally ("12 of 30"). Metronome follows a
  ladder step automatically.
- **Sessions:** every action lands on a session timeline; session end appends a summary
  markdown to the vault per piece (namespaced `CodaKiller 2/`, additive, never edits
  human-authored docs).
- **Data model:** build out the designed rusqlite schema (`piece`, `rep_block`, `rep`,
  `session`, `session_event`, `spot_review`, `setting`) — schema v1 (settings) exists.

**P3 also owes (carried from P2 final review):**
- Runtime **Gemini→`say` TTS fallback after N failures** (see `FLAWS.md` B1).
- **Mic-permission-denied → actionable guidance** (see `FLAWS.md` B2).

### ⟶ P3 next steps
1. Write the P3 task-level plan (`docs/superpowers/plans/`), informed by `NOTES.md` and the
   carry-notes in `.superpowers/sdd/progress.md`.
2. Build data model → rep engine (deterministic ladders/variants/check-off) → intake →
   sessions + vault export, each task gate-reviewed by a fresh-context verifier.
3. Fold in the two debts. Ship **v0.2.0**; write its `versions/v0.2.0/` record.

## 🔴 P4 — Score viewer — NOT STARTED — → v0.3.0
OSMD render of vault MusicXML (the hero surface), verbal/click measure navigation, rep-block
range highlighting. **Open risk:** OSMD rendering the big Scherzo XML must be perf-checked on
8 GB (the old app proved OSMD works in a WebView; size is the question).
### ⟶ Next step: after P3, plan P4; spike the largest score first.

## 🔴 P5 — Brain + knowledge library — NOT STARTED — → v0.4.0
Claude/Gemini adapter (grounded Q&A, planner narration; **never** generates verdicts about
playing it can't hear). Deterministic planner (deadline pressure + spaced revisit of hard
spots + resume point) that the brain narrates but doesn't own. **Knowledge library:** port
the old **Drill Library + Strategy Engine** (~24 methods, symptom→method routing) rewritten
clean, and author a new **practice-psychology layer** (Bulletproof-Musician-style:
interleaving, spacing, mental practice, slow-practice discipline) — none exists in the vault
today.
### ⟶ Next step: after P4, plan P5; audit which old-app knowledge is worth porting.

## 🔴 P6 — References + polish — NOT STARTED — → v1.0.0
Spotify (AppleScript) + YouTube references, deep settings, full apple-grade design pass, app
icon, DMG packaging. Ships the vision as **v1.0.0**.

---

## Standing (cross-phase) to-dos
- [ ] **At-piano acceptance run** of v0.1.0 (highest priority; unblocks trust in the thesis).
- [ ] **Off-disk git backup** (local-only today).
- [ ] Write P3–P6 task-level plans as each phase begins.
- [ ] Keep `FLAWS.md` current as real use surfaces issues.

## Non-goals (v1) — do not build these
Transcription/grading/pitch-detection of playing; a local LLM; any LLM in the hot command
loop; auto-imposed drills or plans; an always-on web server / cache-busting deploys. (Full
rationale in the spec §1 and `FLAWS.md` D2.)
