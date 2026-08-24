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

**Installed: v7.0.0 "Motivation Layer" — SHIPPED + INSTALLED 2026-08-24** (tag `v7.0.0`).
Schema **14 → 15**, rehearsed on a copy of the SAME DAY's live database then verified in place:
integrity ok, counts identical — 10 pieces / 193 blocks / 1,814 reps / 40 sessions. Gates at ship:
vitest 2285 passed / 1 skipped, cargo 949 passed / 0 failed, clippy `--all-targets --all-features`
clean, tsc clean, all eight release-script gates PASS.

Shipped: the living earned-only galaxy; day streaks; the end-of-day photo ritual; completion
animations; the complete loudness-only dynamics checker; the B81 silent-`say` fix; and a Settings
switch that fully disables the Assistant.

**⚠️ THE ASSISTANT SHIPS OFF BY DEFAULT** (Christian's request: "it's just getting in the way and
it is very extra and is a whole different project"). Off means off — the refusal is enforced in
Rust on every provider-reaching command, spy-proven to make zero network calls. **The voice→LLM
fallback lives in `Shell.tsx`, NOT `voice_loop.rs`** — read that before touching either.

**Plan C (the Assistant overhaul) is ON HOLD**, unmerged on branch `v7/plan-c` (pushed to the
remote). Its "no figure without a tool row" guarantee was REFUTED twice — a fabricated answer
shipped WITH a provenance chip — and C2/C3/C4 were never built. Resume only on Christian's word.

**Owed:** an at-piano acceptance verdict, live 720×520 QA of the new surfaces, B75 (one real
measure-mapping run), B67 (no Anthropic key).
