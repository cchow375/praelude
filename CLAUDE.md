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
- `docs/superpowers/plans/2026-08-26-p2-micro-targets-v2-and-set-completion.md` — historical v7.2
  corrective plan and verifier amendments; its B89 residual is fixed in the installed v8.1 source.
- `docs/superpowers/plans/2026-08-27-v8.1.0-p3-p6-completion.md` — shipped ledger for the
  combined P3–P6 release and its remaining external acceptance facts.
- `docs/superpowers/plans/2026-08-27-v8.2.0-ui-cleanse-and-total-plays.md` — current corrective
  release ledger: continuous Score, compact practice UI and non-mastery Total plays contract,
  plus the v8.2.1 density-correction addendum.
- `docs/qa/v7.2.0/README.md` — source-candidate 720×520 evidence and its native/at-piano limits.
- `docs/qa/v8.1.0/README.md` — historical v8.1 browser/devMock and scoped native visual record;
  packaged-native microphone, storage and Steinway acceptance are explicitly not inferred.
- `docs/qa/v8.2.0/README.md` — Score/composer browser record at 720×520 and 1462×919 plus final
  package/data facts; native Score visual remains pending behind the ungranted Desktop permission.
- `docs/qa/v8.2.1/README.md` — compact-composer + B95 release/install evidence; tag pending and
  native Score feel remains separate.
- `docs/qa/(C) v2-narrated-replay-contract.md` — old-session speech/state-machine regression
  boundary; never a piano-grading benchmark.
- `docs/qa/` — acceptance records, regression contracts and screenshots.
- `.superpowers/sdd/progress.md` — local/gitignored per-task ledger + carry-notes. Its v8.2
  cold-start header is useful on this machine, but a clone may not contain it and it never
  outranks the tracked spec/plan or vault truth.
- `README.md` — user-facing build/run/first-launch.

## Cold-start guard for Claude Code

Work from the main worktree unless Christian explicitly assigns a historical lane. The registered
trees under `.claude/worktrees/` and `~/.ck-lanes/`, `.superpowers/sdd/task-*`, the old Foundation
context, and `.workflow/LEDGER.md` are retained phase evidence; their local status blocks do not
override this file or the vault. Do not restart P3–P6, restore the v7 galaxy, or resume Assistant
Plan C from those records.

Release tag `v8.2.0` is a pushed lightweight tag at
`5de8bf9e1e9bced09c3d5091acd4b42241edae28`. Private `origin/main` advanced after the tag
through documentation-only corrections; verify the exact current ref from Git. The immutable tag and runtime source
`afe65f3…` remain the release identities. The next honest work is deliberate Desktop-folder access
plus installed-native Score acceptance, then real WKWebView Listen Back and voice-over-Steinway use,
one explicitly authorized real-provider/current-edition measure map, and a sustained-use verdict
on XP, levels, milestones and cadence. Do not rebuild or reinstall the shipped source.

**v8.2.1 is shipped and installed; tag/publication remains pending.** B94's paired composer
controls and B95 are resolved. Installed v8.2.0 preserved closed session 48, then TCC aborted in
under one second because the auto-starting photo card requested camera access without a packaged
`NSCameraUsageDescription`; six retained v7.0–v8.2 reports share the signature. Plain End session
is now camera-free. Only confirmed End my day offers the inert photo card; camera access waits for
explicit **Use camera**, and synchronous/rejected requests fall back to file choice. The source
plist has the truthful key and the release script gates camera/mic/speech descriptions. Final
gates pass: frontend 2,684/1 skipped, native 1,109/19 ignored, TypeScript, strict Clippy,
production + native builds, five corpora and all eight release gates. Installed identity,
privacy strings, signature, DMG/checksum, backup/rollback, exact before/after DB and fresh launch
pass. Runtime source is `496033e677919757ef1f2a78cee32d3abedb4805`; only tag/publication remains
pending. Schema stays 20.
Never upload a score merely to close B5—confirm the provider/key and Christian's authorization for
whole-edition egress first. Assistant remains OFF unless Christian explicitly reopens it.

## Build / run / test

```
npm install
npm run tauri dev                       # dev run
npm run tauri build -- --bundles app    # build ONLY the .app (the dmg step deletes the .app — see NOTES.md)
cd src-tauri && cargo test               # Rust suite
npm test                                 # frontend (vitest)
```

Quit + relaunch the installed `.app` to run new code. First launch needs mic + Speech
Recognition Allow; macOS Dictation must be ON (`Code 201` = it's off). In v8.2.1,
camera permission is conditional and requested only after explicit **Use camera**.

## Status (mirror of the vault; keep in sync)

**v8.2.1 / schema 20 — SHIPPED + INSTALLED 2026-08-28; TAG/PUBLICATION PENDING.** Runtime source
`496033e677919757ef1f2a78cee32d3abedb4805` atop B94
`d1e7ac6d09528f22d8becb378f26c66d751ac297` fixes B94's composer density and B95, the fatal camera/TCC abort after session
48 closed. Session data was preserved. Manual close paths are now deliberately separate: plain
**End session** is camera-free; confirmed **End my day** may show the optional photo card; merely
showing it requests nothing; **Use camera** is explicit; and unavailable/denied access falls back
to file choice. Source plist/release gates now require truthful camera, microphone and speech
descriptions. Final gates: frontend **2,684/1 skipped**, native **1,109/19 ignored**, TypeScript,
strict Clippy, production + native builds, five corpora and all eight release gates pass. Installed
8.2.1 identity, exact privacy strings, strict signature, DMG/checksum, backup/rollback,
before/after DB and fresh launch pass; app PID 46013 remained live with its owned `hear` child and
no new crash report. Only tag/publication remains pending. Pre-install backup
`(C) pre-v8.2.1-install-2026-08-28-132046.db` is
23,449,600 bytes, SHA-256 `2c99dec1c3bc14f595e69c92a9415076299752d46930eea0fa3c9f5a793379c7`,
schema 20/integrity OK/FK0 with 11 pieces, 246 blocks/contracts, 2,207 reps, 48 sessions, 8,391
events and zero open sessions/blocks.

**v8.2.0 / schema 20 — SHIPPED + INSTALLED 2026-08-27**, source
`afe65f3b176a1c5da81eca6d2f65bd721726ee40`. v8.2 replaces the single-page Score posture with a continuous virtualized reader;
gives the PDF and Tricky Sections rail independent scrolling; reveals an expanded section's
composer; condenses Score tools, the bottom dock and variant rows; and adds a keyboard-correct
Clean streak / Total plays target selector. Total plays offers 5/10/15/25/Custom, holds fixed tempo,
counts every effective Clean/Sloppy/Again, reverses with Undo and completes without mastery badges,
mastery copy or mastery animation. Existing streak/chain contracts retain their exact semantics.

Final gates: frontend **2,678 passed / 1 skipped / 0 failed** (212 files passed / 1 skipped), native **1,109 passed / 19
ignored / 0 failed**; TypeScript, format, strict Clippy and build clean. Disposable schema-19→20
rehearsal preserved 242 blocks/contracts, 2,184 reps, 47 sessions and 8,283 events; integrity OK,
zero FK violations. All eight release-script gates, installed version/bundle/signature, one-copy
audit, DMG/checksum, backup/rollback, fresh launch and live schema-20 count/integrity audit passed.
Browser visual QA passed at 720×520 and 1462×919. Packaged launch was seen, but the Desktop-folder
permission prompt was not granted, so packaged-native Score visual acceptance is not claimed.
Release tag `v8.2.0` is pushed as a lightweight tag at
`5de8bf9e1e9bced09c3d5091acd4b42241edae28`; the immutable runtime source remains `afe65f3…`.
Private `origin/main` advanced after the tag through documentation-only corrections; verify the
exact current ref from Git. The immutable tag and runtime source remain the release identities.

**Historical v8.1 boundary: v8.1.0 / schema 19 — SHIPPED + INSTALLED 2026-08-27.** The release closes the remaining Aug 8
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
`0a3d6a5d339955fd7e7318299eaa6c3063674415` and is pushed; at that historical boundary, private
`origin/main` had reached the post-tag documentation correction. Browser/devMock and scoped
native visual evidence cannot prove microphone or Steinway behavior. B67/B75 remain open: no
Anthropic key and no live measure mapping. Packaged-native Listen Back/voice and at-piano
acceptance remain owed. The 23-ask boundary is **22 delivered / 1 external-only (B5) / 0 absent**;
C2 source is delivered, while real WKWebView microphone and Steinway acceptance remains external.

**Assistant stays OFF and gated.** Off is enforced in Rust for provider-reaching commands, and
the voice→LLM fallback lives in `Shell.tsx`, not `voice_loop.rs`. Plan C remains on hold and must
not be resumed without Christian's explicit word. B67 (no Anthropic key), B75 (no live measure-map
rows), broader B84 mock parity and the remaining installed/at-piano acceptance verdicts remain open.
