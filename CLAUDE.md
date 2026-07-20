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

**Installed is v3.1.0 (tag `v3.1.0`, 2026-07-20; implementation commit `36f21fd`).** It ships
routine 1.5-second nonblocking receipts, state-aware serialized metronome transitions, a compact
normal-flow HUD with visible safety stop, Today's date-scoped plan, the current in-app guide, and
restored Brain context for the visible Score piece/Region/page/edition/active set/Today plan.
Clearly assistant-directed questions work without a wake phrase. With a Region selected, a natural
set request becomes an editable spoken draft requiring exact-once `confirm` or `cancel`; the model
never enters the deterministic verdict/metronome hot loop or clicks arbitrary DOM.

Release gates: frontend 985 passed / 0 failed / 2 todo; Rust 490 passed / 0 failed / 11 ignored
plus every integration suite; strict clippy and production build; sealed app; valid DMG checksum;
filesystem and Spotlight each resolve exactly one active `/Applications/CodaKiller.app`. The
pre-install backup is `(C) pre-v3.1.0-install-2026-07-20-000233.db`, SHA-256
`91e8c3fe5295d4d652a18b4486c336c96688148bf95ed2f892fd750e239ddb25`; live before/after truth is
schema 10, integrity `ok`, FK 0, exactly 6 pieces / 63 blocks / 559 reps / 14 sessions.

**Next:** real Steinway acceptance using exact verdicts, `metronome stop`, one no-wake question,
and one selected-Region natural set request. Then build the complete typed capability registry for
Today/Goals/Calendar/session planning with preview → spoken readback → explicit confirm → durable
receipt → undo. Page-only targeting, durable unfinished drafts, history-at-scale, and the off-disk
private remote remain open.
