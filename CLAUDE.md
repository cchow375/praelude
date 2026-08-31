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

## Current source boundary

**v9.1.0 / schema 21 is a PACKAGED WINDOWS x64 CANDIDATE; NATIVE WINDOWS/RECIPIENT ACCEPTANCE
IS PENDING (2026-08-31).** Package source commit
`2d33004888a97c3ebcb4b7799bf54029efd15626` produced the unsigned current-user NSIS installer
`releases/v9.1.0/windows/CodaKiller-9.1.0-Windows-x64-Setup.exe`, **7,654,002 bytes**, SHA-256
`e2e2f3ae8846ef7aca6a6c04b2e1a2f346e97640f5d9089e6e49012365dc5dd4`, built
`2026-08-31T19:31:59Z`. The official Tauri local macOS cross-build, recursive blank/share-clean
scan and embedded PE32+ x86-64 identity pass. Frontend is 205 files with 1 skipped / 2,540 tests
with 1 skipped; TypeScript/build, Mac native 1,111/19 ignored, Mac format/strict Clippy, Windows
`cargo-xwin check` and strict all-target Clippy pass. Native Windows cargo tests were not run.
Real Windows 10/11 install/relaunch, picker/PDF, audio, Authenticode/SmartScreen and uninstall
acceptance remain PENDING. The installer is unsigned, so a SmartScreen warning is expected.

The package contains no personal files, DB, scores, Pieces Library, history or copyrighted
pedagogy payload. It contains no personal or unremapped host paths; remapped `/build-user` paths
intentionally remain. Inert historical schema/migration metadata and the existing `com.christian.codakiller`
identifier remain to support compatible upgrades, but Windows upgrade and data preservation have
**not** been exercised. This port excludes `hear`; Mic/voice, Listen Back, system TTS and volume
boost are unavailable. The GitHub workflow was removed because the current OAuth token lacked
workflow scope; `scripts/package-windows-cross.sh` is canonical. Its successful package run used
`C.UTF-8`; `LC_ALL=C` had caused a misleading `makensis` `std::bad_alloc` failure.

**v9.0.0 / schema 21 is a PACKAGED SHAREABLE CANDIDATE; NOT INSTALLED; CLEAN-RECIPIENT
ACCEPTANCE PENDING (2026-08-30).** The installed and published app remains **v8.2.1 / schema 20**.
v9 is one generic, share-clean build—not a friend
fork. Fresh users start with an empty app-owned Pieces root; upgrades keep the configured root or
conservatively infer it from existing piece rows. Pieces becomes the primary workspace with
**Library | History | Calendar**, nested logical folders, Unfiled, Active/Completed/Archived,
right-click/ellipsis actions, direct local-PDF intake and IMSLP only as an optional external link.
The embedded copyrighted pedagogy/quote payload and Quotes/Reader/Books/passage-helper UI are
removed. The external Knowledge and Resources folder and historical DB turns are not deleted.

Recorded test/build gates, two isolated fresh profiles, exact-copy schema-20→21 rehearsal and clean
source/app/mounted-DMG audits pass. Expected package identity is v9.0.0,
`com.christian.codakiller`, arm64/macOS 13+, ad-hoc and not notarized. Exact candidate DMG
`releases/v9.0.0/CodaKiller-9.0.0.dmg` is 10,736,628 bytes, SHA-256
`e5f3c2265cd962791a8267fee6a4e4e0c42a9a70775bbcc5729623a7aa443f06`; mounted strict CDHash is
`33ffc5fade7ecb090c5fd7b08818ae82164cbc21`. Full hear BSD, React/Tauri MIT and PDF.js Apache
notices are present top-level and byte-identical inside the app. Implementation commit
`709542023b3e3bf0c9e72189d145e5fd524eaacd`, lightweight tag `v9.0.0`, and private `main`/tag
push record the package boundary. Install, backup/rollback and clean-recipient proof are PENDING.
`npm run package:mac` invokes non-installing `scripts/package-macos.sh`; it does not quit,
launch or replace `/Applications/CodaKiller.app` or touch the live database. The installing release
path can do so and must not run during a live set/session.

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
- `docs/superpowers/plans/2026-08-30-v9.0.0-portable-pieces-library.md` — v9 product/data/privacy
  contract and pending release sequence.
- `docs/superpowers/plans/2026-08-31-v9.1.0-windows-x64.md` — Windows portability, NSIS and
  clean-recipient evidence plan.
- `docs/qa/v7.2.0/README.md` — source-candidate 720×520 evidence and its native/at-piano limits.
- `docs/qa/v8.1.0/README.md` — historical v8.1 browser/devMock and scoped native visual record;
  packaged-native microphone, storage and Steinway acceptance are explicitly not inferred.
- `docs/qa/v8.2.0/README.md` — Score/composer browser record at 720×520 and 1462×919 plus final
  package/data facts; native Score visual remains pending behind the ungranted Desktop permission.
- `docs/qa/v8.2.1/README.md` — compact-composer + B95 release/install/publication evidence; native
  Score feel remains separate.
- `docs/qa/v9.0.0/README.md` — v9 source/package evidence; replacement artifact identity,
  install and recipient gates remain explicitly PENDING.
- `docs/qa/v9.1.0/README.md` — exact Windows package and cross-target evidence; native Windows
  execution and clean Windows 10/11 acceptance remain explicitly PENDING.
- `docs/qa/(C) v2-narrated-replay-contract.md` — old-session speech/state-machine regression
  boundary; never a piano-grading benchmark.
- `docs/qa/` — acceptance records, regression contracts and screenshots.
- `.superpowers/sdd/progress.md` — local/gitignored per-task ledger + carry-notes. Its v8.2
  cold-start header is useful on this machine, but a clone may not contain it and it never
  outranks the tracked spec/plan or vault truth.
- `README.md` — user-facing build/run/first-launch.

## Cold-start guard for Claude Code

The v9.1 Windows source/package boundary is complete. Do not rebuild it or infer native Windows
acceptance from cross-compilation; run the exact hashed installer on real Windows 10/11 and record
install/relaunch, picker/PDF, audio, Authenticode/SmartScreen, persistence and uninstall. Never put
the Mac-only `hear` binary into the Windows bundle. Work from the main
worktree unless Christian explicitly assigns a historical lane. The registered
trees under `.claude/worktrees/` and `~/.ck-lanes/`, `.superpowers/sdd/task-*`, the old Foundation
context, and `.workflow/LEDGER.md` are retained phase evidence; their local status blocks do not
override this file or the vault. Do not restart P3–P6, restore the v7 galaxy, or resume Assistant
Plan C from those records.

Release tag `v8.2.0` is a pushed lightweight tag at
`5de8bf9e1e9bced09c3d5091acd4b42241edae28`. Private `origin/main` advanced after the tag
through documentation-only corrections; verify the exact current ref from Git. The immutable tag and runtime source
`afe65f3…` remain the release identities. The source, disposable-data, blank-profile and local
cross-package evidence is recorded. The 2026-08-30 19:25 EDT live audit is schema 20, integrity
OK/FK0 with 11 pieces, 255 blocks, 2,327 reps, 51 sessions and 9,241 events, but **one session and
one block are open**. Christian must close or deliberately preserve that live work in installed
v8.2.1 before the app is quit,
the current DB and v8.2.1 rollback are backed up/hashed, v9 is installed/audited, and the clean-
recipient Gatekeeper/first-piece pass runs. The v9 source/tag/private backup are already complete.
Then resume deliberate Desktop-folder access plus
installed-native Score acceptance, real WKWebView Listen Back and voice-over-Steinway use,
one explicitly authorized real-provider/current-edition measure map, and a sustained-use verdict
on XP, levels, milestones and cadence. Do not rebuild or reinstall the shipped source.

**v8.2.1 is shipped, installed and published.** B94's paired composer
controls and B95 are resolved. Installed v8.2.0 preserved closed session 48, then TCC aborted in
under one second because the auto-starting photo card requested camera access without a packaged
`NSCameraUsageDescription`; six retained v7.0–v8.2 reports share the signature. Plain End session
is now camera-free. Only confirmed End my day offers the inert photo card; camera access waits for
explicit **Use camera**, and synchronous/rejected requests fall back to file choice. The source
plist has the truthful key and the release script gates camera/mic/speech descriptions. Final
gates pass: frontend 2,684/1 skipped, native 1,109/19 ignored, TypeScript, strict Clippy,
production + native builds, five corpora and all eight release gates. Installed identity,
privacy strings, signature, DMG/checksum, backup/rollback, exact before/after DB and fresh launch
pass. Runtime source is `496033e677919757ef1f2a78cee32d3abedb4805`; pushed lightweight tag
`v8.2.1` points to `971a0d2dc7cf8f093527239e2394391dbbfec0a4`. Private `origin/main` was pushed
through that tagged commit and may advance through docs-only corrections. Schema stays 20.
Never upload a score merely to close B5—confirm the provider/key and Christian's authorization for
whole-edition egress first. Assistant remains OFF unless Christian explicitly reopens it.

## Build / run / test

```
npm install
npm run tauri dev                       # dev run
npm run tauri build -- --bundles app    # build ONLY the .app (the dmg step deletes the .app — see NOTES.md)
cd src-tauri && cargo test               # Rust suite
npm test                                 # frontend (vitest)
bash scripts/package-windows-cross.sh    # clean-source macOS -> unsigned Windows x64 package
```

Quit + relaunch the installed `.app` to run new code. First launch needs mic + Speech
Recognition Allow; macOS Dictation must be ON (`Code 201` = it's off). In v8.2.1,
camera permission is conditional and requested only after explicit **Use camera**.

## Status (mirror of the vault; keep in sync)

**v9.1.0 / schema 21 — PACKAGED WINDOWS x64 CANDIDATE; NATIVE WINDOWS/RECIPIENT ACCEPTANCE
PENDING 2026-08-31.** See the v9.1 plan and QA ledger. The exact package/source/hash,
cross-target compile/Clippy, recursive cleanliness and PE32+ x86-64 facts pass as recorded above.
Native Windows cargo tests and real Windows 10/11 interaction were not run. The Windows product
is keyboard/mouse-first; Mic/voice/Listen Back/system TTS/volume boost are unavailable.

**v9.0.0 / schema 21 — PACKAGED SHAREABLE CANDIDATE; NOT INSTALLED; CLEAN-RECIPIENT ACCEPTANCE
PENDING 2026-08-30.** The current candidate behavior and evidence are defined in “Current source
boundary” above and `docs/qa/v9.0.0/README.md`. The exact package identity is proved; installed
state, release commit/tag/push and recipient verdict are not claimed. The tutorial's main body
remains v8.2.1-exact and labels v9 as a not-yet-installed preview.

**v8.2.1 / schema 20 — SHIPPED + INSTALLED + PUBLISHED 2026-08-28.** Runtime source
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
no new crash report. Pushed lightweight tag `v8.2.1` points to
`971a0d2dc7cf8f093527239e2394391dbbfec0a4`; read the moving private `origin/main` tip from Git.
Pre-install backup
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
timing remains under Voice. **Historical v8.1 decision:** folders were a deliberate non-goal in
favor of archive + recent-first; Christian explicitly reversed that decision in the v9 request.

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
