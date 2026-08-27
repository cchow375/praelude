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
  corrective plan and verifier amendments; its B89 residual is now fixed in the v8.1 source.
- `docs/superpowers/plans/2026-08-27-v8.1.0-p3-p6-completion.md` — shipped ledger for the
  combined P3–P6 release and its remaining external acceptance facts.
- `docs/qa/v7.2.0/README.md` — source-candidate 720×520 evidence and its native/at-piano limits.
- `docs/qa/v8.1.0/README.md` — current browser/devMock visual record; packaged-native microphone,
  storage and Steinway acceptance are explicitly not inferred.
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

**v8.1.0 / schema 19 — SHIPPED + INSTALLED 2026-08-27.** The release closes the remaining Aug 8
train in one coherent app: P3 voice chimes/feed/fast phrases/live settle and counted add/undo; P4
movement CRUD/score scoping plus clear provider readiness for mapping; P5 the visual catalog,
saved routines and real rep-engine runner; P6 Listen Back, prompt-only exact-block rotation,
reversible archive/recent-first sort and Sound targets. It replaces the old galaxy with canonical
focused-minute XP, levels, six badge tracks, exact next milestones, a 28-day cadence, repertoire
progress and technique evidence. Warmup and rotation completions use earned completion moments.

The release closes **B88** (per-set demotion override and live-HUD subdivision)
and **B89** (durable micro-target command identity, payload-fingerprint conflict check
and one bounded same-identity retry). Verdict-hotkey remaps publish after Settings Save, so the
already-mounted HUD uses the new keys without a reload. The Assistant remains OFF and gated;
its off-state Settings guide is practice-only, Books/provider furniture is hidden, and settle
timing remains under Voice. Folders remain a deliberate non-goal in favor of archive + recent-first.

Final source HEAD `1a1e38bb7a3757cf90ee6ea814e93d5971c595d6`; frontend
**2,650 passed / 1 skipped / 0 failed** (209 files passed / 1 skipped), native
**1,100 passed / 19 ignored / 0 failed**; TypeScript, format, strict Clippy, build, five
corpora and all eight release gates passed. The installed ad-hoc locally signed 8.1.0 app/DMG
verified, and fresh launch migrated schema 16→19 with integrity/FKs clean and the historical graph
preserved; only hidden `id=0` Warm-ups was added. Installed-native Universe and Warmups passed at
720×520 without losing the active set. Release tag `v8.1.0` points to
`0a3d6a5d339955fd7e7318299eaa6c3063674415` and is pushed; private `origin/main` is current through
the post-tag documentation correction. Browser/devMock and scoped
native visual evidence cannot prove microphone or Steinway behavior. B67/B75 remain open: no
Anthropic key and no live measure mapping. Packaged-native Listen Back/voice and at-piano
acceptance remain owed. The 23-ask boundary is **22 delivered / 1 external-only (B5) / 0 absent**;
C2 source is delivered, while real WKWebView microphone and Steinway acceptance remains external.

**Assistant stays OFF and gated.** Off is enforced in Rust for provider-reaching commands, and
the voice→LLM fallback lives in `Shell.tsx`, not `voice_loop.rs`. Plan C remains on hold and must
not be resumed without Christian's explicit word. B67 (no Anthropic key), B75 (no live measure-map
rows), broader B84 mock parity and the remaining installed/at-piano acceptance verdicts remain open.
