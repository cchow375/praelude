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

**Installed is v6.0.0 "Practice Core" (tag `v6.0.0`, 2026-08-18) — all four plans: A Practice
Surfaces (dock/pause/sessions/plans/banner, schema v14), B Read Models (History timeline,
Calendar planned-vs-done), C Score Intelligence (cloud-vision measure mapping + snap selection
+ sub-sections), D Voice & Brain (fast-path metronome commands, chime acks, looser matching
with the firewall intact, heard-text pill, TTS cooldown + Aoede + degraded pill, honest
Assistant grounding copy).** Schema 13→14, rehearsed on a fresh live copy immediately before
install (B58 fixed first — the harness had misread the historic July chamber-split). Gates:
vitest 2101/0, cargo 855/0, six corpus/firewall suites zero false mutations, tsc + clippy
clean. TWO fresh-context adversarial verification passes: pass 1 refuted the fast path
(prefix-partial phantom mutations on four corpus lines — fixed: multi-word metronome phrases
only), pass 2 = SHIP. Open: Flaws B70 (prefix-keyed final suppression — "metronome on 96"
loses its tempo; say "metronome 96"), B71–B73, B67 (no Anthropic key — Claude vision still
never exercised). Rollbacks now live in `~/Library/CodaKiller-rollbacks/` (the release
one-copy rule scans `~`). Pre-install backup `(C) pre-v6.0.0-install-2026-08-18-101647.db`
SHA `c142f70a…`.

**Next: v7.0 "Motivation Layer"** (living earned-only galaxy, streaks + photo calendar,
completion animations, full dynamics checker, Assistant usefulness) — scoped in the v6 spec's
non-goals, awaiting its own spec round.
