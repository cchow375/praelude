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
- `docs/superpowers/specs/2026-08-24-aug8-practice-overhaul-design.md` — the approved current
  release-train spec.
- `docs/superpowers/plans/2026-08-25-p1-v7.1.0-practice-set-core.md` — shipped P1 plan and its
  explicit v7.1 A1/A5 scope correction.
- `docs/superpowers/plans/2026-08-26-p2-micro-targets-v2-and-set-completion.md` — current v7.2
  corrective plan and verifier amendments.
- `docs/qa/v7.2.0/README.md` — source-candidate 720×520 evidence and its native/at-piano limits.
- `docs/qa/(C) v2-narrated-replay-contract.md` — old-session speech/state-machine regression
  boundary; never a piano-grading benchmark.
- `docs/qa/` — acceptance records, regression contracts and screenshots.
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

**Installed: v7.2.0** (shipped and installed 2026-08-27, schema 16 unchanged). It is one
corrective release, not a v7.1.1 + v7.2 split. It resolves B85 (one-drag, form-free, atomically
persisted parent-scoped spots with direct start/resume), B86 (chain-aware mastery, stage-correct
attribution, recovery-debt integrity and visible six-second auto-close) and B87 (spoken
acknowledgements opt-in, short chime retained). It also unifies the score overlay (B3), adds the E3
low-data Universe teaching pass, exposes global demotion settings and exposes beat-unit / beats-
per-bar / subdivision controls in the composer. **Still absent:** a per-set demotion override and
a RepHud quick-subdivision control.

Release gates: **2,499 frontend passed / 1 skipped / 0 failed**; **1,049 native passed / 19
ignored / 0 failed**, with `filtered out: 0` on every target; `tsc --noEmit` and strict clippy
clean; all five narrated corpus suites at zero false mutations; all eight release-script gates
passed. The installed plist/version and identifier are correct, codesign and the DMG checksum
verify, a fresh installed process launched, and the live DB stayed schema 16/integrity OK with
identical counts (10 pieces / 228 blocks / 2,026 reps / 44 sessions / 0 open). No migration or
rehearsal ran. Browser-mock QA at 720×520 is in `docs/qa/v7.2.0/README.md`; it does not substitute
for native speech/audio or Christian's at-piano acceptance verdict.

**Assistant stays OFF and gated.** Off is enforced in Rust for provider-reaching commands, and
the voice→LLM fallback lives in `Shell.tsx`, not `voice_loop.rs`. Plan C remains on hold and must
not be resumed without Christian's explicit word. B67 (no Anthropic key), B75 (no live measure-map
rows), broader B84 mock parity and the installed/at-piano v7.2 verdict remain open.
