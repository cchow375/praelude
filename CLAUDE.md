# CodaKiller — code repo (docs live in the Obsidian vault)

This is the **code** for CodaKiller (Tauri v2, Rust + React/TS). The project's
**canonical documentation, operating manual, roadmap, flaws register, changelog, and
version history live in the Obsidian vault**, not here:

> **`~/Desktop/christian's universe/Piano Practice/CodaKiller/`**
> Start at `CLAUDE.md` there, then `(C) CodaKiller Command Center.md`. The portable
> whole-project summary is `CodaKiller.md`.

## 🔒 Binding rule (from the vault CLAUDE.md — the most important one)

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

**Installed is v1.3.0 (tag `v1.3.0`, 2026-07-13). Active work is P7 / v2.0.0, started 2026-07-15
from Christian's substantial real use: 481 attempts exposed wrong completion/recovery semantics,
unclear writes, score/history friction, real voice false-positive/negative evidence, a verbose
session-only Brain, and a UI/Universe that failed the user.** A verified schema-v7 snapshot is
preserved at `(C) pre-v2.0.0-feedback-2026-07-15-163528.db`. Implement in this locked order:
ledger/protocol → Score Atlas/history → voice replay/drafts/Brain → shell/Universe → full native /
adversarial release. v2 is not shipped and the installed app/tutorial remain v1.3.0. Off-disk
remote and packaged v2 Steinway acceptance remain open.
