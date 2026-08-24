# CodaKiller — code repo (docs live in the Obsidian vault)

This is the **code** for CodaKiller (Tauri v2, Rust + React/TS). The project's
**canonical documentation, operating manual, roadmap, flaws register, changelog, and
version history live in the Obsidian vault**, not here:

> **`~/Desktop/christian's universe/Piano Practice/CodaKiller/`**
> Start at `AGENTS.md` there, then `(C) CodaKiller Command Center.md`. The portable
> whole-project summary is `CodaKiller.md`.

## 🔒 Binding rule (from the vault AGENTS.md — the most important one)

**After EVERY change or session, before reporting done, run the UPDATE PROTOCOL:**

1. Log it in the vault `(C) Changelog.md` (date · what · why · files).
2. Refresh the vault `CodaKiller.md` (portable summary + its `Last updated:` line).
3. Update the affected vault living docs — `(C) Roadmap.md`, `(C) Flaws.md` (never delete
   a flaw; move to Resolved), the `(C) CodaKiller Command Center.md` status/threads, and
   **`(C) How To Use.md` whenever anything user-facing changes** (voice grammar/vocabulary,
   UI flows, defaults, permissions/setup) — bump its `Matches: vX.Y.Z` line; the tutorial
   must always describe the installed app exactly.
4. Log engineering decisions/gotchas/empirical facts in **this repo's `NOTES.md`**.
5. Commit here with a clear message; **tag on a version bump** (`git tag vX.Y.Z`).

**If a session ends without the vault docs updated, the session is not done.**

## The golden rules (full rationale in the vault docs)

- **User is the sensor; the app is the memory.** Never interpret audio as music — the last
  app died of that. Speech only; the human gives every verdict.
- **Deterministic hot loop** (regex intent router); the LLM brain is for open questions only.
- **Successor to PianoCoach in mission/lessons, zero shared code or UI.** Do not port the old
  app's UI, web-server model, or perception-first architecture.
- **Honest over impressive.** Unproven/unbuilt/broken → say so. Christian values this.

## Code-repo docs (stay here, with the code)

- `NOTES.md` — engineering decisions, gotchas, hard-won empirical facts (read before touching
  `src-tauri/src/audio`, `stt`, `tts`, `metronome`).
- `docs/superpowers/specs/2026-07-19-codakiller-hands-free-practice-operator.md` — the current
  v3.1.0 operator/stabilization contract.
- `docs/superpowers/plans/2026-07-19-codakiller-hands-free-practice-operator.md` — its execution
  and verification plan.
- `docs/superpowers/specs/2026-07-09-codakiller-design.md` — the approved design spec.
- `docs/superpowers/specs/2026-07-15-codakiller-v2-transformation-design.md` — active P7/v2
  architecture and compatibility contract.
- `docs/superpowers/plans/2026-07-15-codakiller-v2.md` — active dependency-ordered execution plan.
- `docs/qa/(C) v2-narrated-replay-contract.md` — old-session speech/state-machine regression
  boundary; never a piano-grading benchmark.
- `docs/superpowers/plans/2026-07-09-codakiller-p0-p2.md` — the P0–P2 execution plan.
- `docs/qa/` — acceptance records + screenshots (incl. the pending at-piano checklist).
- `.superpowers/sdd/progress.md` — per-task ledger + carry-notes.
- `README.md` — user-facing build/run/first-launch.

## Build / run / test

```
npm install
npm run tauri dev                       # dev run
npm run tauri build -- --bundles app    # build ONLY the .app (the dmg step deletes the .app — see NOTES.md)
cd src-tauri && cargo test               # Rust suite
npm test                                 # frontend (vitest)
```

Quit + relaunch the installed `.app` to run new code. First launch needs mic + Speech
Recognition Allow; macOS Dictation must be ON (`Code 201` = it's off).

## Status (mirror of the vault; keep in sync)

**Installed is v6.0.1 "Real-Use Fixes" (tag `v6.0.1`, merge `d9fa0fe`, installed 2026-08-21)**
on top of v6.0.0 "Practice Core" (2026-08-18, schema 14). The patch closed B70 (fast-path
suppression by routed intent), B76 (score toolbar top-row overlap), B72 (BooksPanel nested
form), and the dock stacking-floor/defaults/Reset-layout ergonomics. Gates at ship: vitest
2125/0, cargo 898/0, clippy + tsc clean, six corpus/firewall suites zero false mutations.
v6.0.0 acceptance verdict recorded 2026-08-20: **accepted with issues**. Off-disk backup
resolved 2026-08-23 — private remote `https://github.com/cchow375/codakiller`. Open flaws:
B67 (no Anthropic key — Claude vision never exercised), B71/B73 (minor), B75 (measure
mapping: 0 rows on the live DB), B77 (measure-map dialog focus trap), B78/B79 (dock
residuals). Rollbacks live in `~/Library/CodaKiller-rollbacks/`; latest pre-install backup
`(C) pre-v6.0.1-install-2026-08-21-121450.db` SHA `02461039…`.

**Active: v7.0.0 "Motivation Layer" — BUILDING (started 2026-08-23).** Spec approved
2026-08-20 (`docs/superpowers/specs/2026-08-20-codakiller-v6.0.1-fixes-v7-motivation-layer.md`);
Christian cleared the spec-review gate 2026-08-23 ("push to v7"). Implementation plans
written 2026-08-23: `docs/superpowers/plans/2026-08-23-codakiller-v7-foundations.md` (B0
mic-coexistence spike + schema v15), `…-v7-plan-a-galaxy-ritual.md`, `…-v7-plan-b-dynamics.md`
(on hold until B0 verdict), `…-v7-plan-c-assistant.md`. Build order: Foundations → A → B → C,
lanes in `~/.ck-lanes/`, requirements ledger at `.workflow/LEDGER.md`. Schema v14→v15 (drop
`session.focused_seconds` (B74), add `day_photo` + dynamics calibration tables).

**2026-08-24 progress:** Foundations merged (`45070c9`), **A1 living galaxy + A2 day streak
merged** (`a1e74e5`), **B1–B4 dynamics checker merged** (`d126c3f`). Integrated main green:
vitest 2235 passed / 1 skipped, cargo 904 passed / 0 failed, clippy + tsc clean; pushed to the
private remote. Fresh-context verification REFUTED the galaxy twice before merge (earned-only
violation — a never-practised piece rendered a glowing star tagged with a zero-valued evidence
field; and orbits escaping the 720×520 dense floor at 4+ mastered regions) and killed five
surviving mutants, one of which would have shown a long-dead streak as current. **Still owed:**
A3 photo calendar, A4 completion animations, Plan C (Assistant) in full, 720×520 live QA,
B75's one real measure-mapping run, and the ship. Ledger: 14 of 28 closed.
