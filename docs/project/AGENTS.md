# Praelude — Project Context & Operating Manual

> A piano **practice & rep tracker** for a serious pianist, built native with Tauri v2. The
> installed Mac product is voice-first; the first Windows port is keyboard/mouse-first. Not a
> coach that listens to the piano — the last app tried
> that and it was the fatal flaw. **The user is the sensor; the app is the memory.**
> Christian speaks what happened (tempo changes, reps, mistakes); Praelude counts,
> times, remembers, structures, runs the metronome, and organizes practice — hands-free.

**This folder is the editable project home** (the docs). **The code lives in the git repo at
`~/praelude`.** A privacy-safe copy of this manual, every living project document and every
Markdown version record is committed under `~/praelude/docs/project/`, so a Git clone is enough
to resume work on another Mac. On this Mac, edit the vault first and run `npm run docs:sync` plus
`npm run docs:check` before committing. On a Mac without the vault, the checked-in mirror is the
binding fallback; reconcile any edits back into the vault before a later sync. This file is the
entry point for every session — read it, then jump to
[[(C) Praelude Command Center]] for the live map. If you read one other doc, read
[[Praelude]] (the whole project in one page).

## Where everything lives (docs here, code there)

- **Native iPhone/iPad (`~/praelude/ios/`):** SwiftUI source/project, independent native core and tests; read `ios/README.md` for setup, current scope and acceptance. The installed Mac remains the separate Tauri product.
- **Docs (this vault folder, `Piano Practice/Praelude/`):** this AGENTS.md, the portable
  summary [[Praelude]], the hub [[(C) Praelude Command Center]], [[(C) Motivation]],
  [[(C) Roadmap]], [[(C) Flaws]], [[(C) Changelog]], and `versions/` (immutable per-version
  records). Old app's docs preserved in the `PianoCoach/` subfolder — **reference for
  lessons only; never a template.**
- **Code (`~/praelude`, git repo):** the Tauri app. Its own engineering docs stay with
  the code: `~/praelude/NOTES.md` (decisions/gotchas/empirical facts),
  `~/praelude/docs/superpowers/specs/` (the approved design specs),
  `~/praelude/docs/superpowers/plans/`, `~/praelude/docs/qa/` (acceptance +
  screenshots), `~/praelude/.superpowers/sdd/progress.md` (per-task ledger). The repo has
  a short `AGENTS.md` pointing back here.

---

## The one-sentence thesis

> The old app failed because it tried to _hear_ piano on hardware that can't (MacBook mic
> ⇒ 35–52% accuracy, timing error in whole seconds). Praelude **never interprets audio as
> music.** It removes an entire family of bugs by design — and spends its effort on what
> computers are actually good at: counting, timing, memory, structure, and knowledge.

## Lineage — how this "merges" with the old piano coach

Praelude is the **successor** to PianoCoach (`~/piano-coach`; its vault docs are in the
`PianoCoach/` subfolder here). Merged with it **in mission and in lessons, never in code or
UI:**

- **Same mission:** help Christian master real repertoire on his **Steinway acoustic baby
  grand** (NEC-prep; his teacher says pulse is his #1 problem).
- **Inherits the lessons, not the code.** The old app's whole v1→v4 arc (in `PianoCoach/`)
  taught one thing the expensive way: _the mic can't grade an acoustic piano, so stop
  grading and start tracking._ Praelude is that lesson, built clean. See [[(C) Motivation]].
- **Zero UI inspiration. Zero shared code.** New stack (Tauri v2 / Rust + React), new design
  language (apple.com-grade), small testable modules instead of the old 2,406-line
  `server.py` god object. Do **not** port the old UI, its web-server model, its cache-bust
  versioning, or its perception-first architecture.
- **Family tree:** PianoCoach (dead-end architecture, live-on lessons) → **Praelude** (the
  focused piano tool, done right) and → [[Cadencify]] (the generalized AI tutor; the old
  coach is also _its_ "grounding seed"). Praelude and Cadencify are cousins.

## Design stance (non-negotiable)

- **User-as-sensor.** The app never judges playing it cannot hear. He gives every verdict.
- **Deterministic in the hot loop.** Rep check-offs and metronome control are instant,
  offline, regex-routed. The LLM ("brain") is for open questions only, never in the loop.
- **Suggest, never dictate.** No auto-imposed drills or plans (the old app's v4 lesson).
- **Small, testable modules.** One purpose each, unit-tested. No god objects.
- **Honest over impressive.** If something is unproven, unbuilt, or broken, the docs say so
  plainly. Christian explicitly values this. Never dress a gap up as "done."
- **Christian remains the design authority.** v9 makes the same generic app blank and usable for
  another pianist; never create a personal friend fork or bundle Christian's data/content.

---

## 🔒 THE UPDATE PROTOCOL (binding — run after EVERY change, EVERY session)

**The most important rule here.** Any time anything changes — code, docs, a decision, a fix,
a discovered flaw, processed feedback — before reporting the work done, you MUST:

1. **Log it in [[(C) Changelog]].** Date · what changed · why / what drove it · files or
   modules touched. Newest first. No change too small. Big rounds of work = a new **version**
   (see the version system); small fixes = entries under the current version.
2. **Refresh [[Praelude]]** — the portable one-page summary. It must ALWAYS reflect current
   truth (what it is, how it works, current state, honest flaws, roadmap, version digest) and
   its `Last updated:` line. Keep it fully self-contained (no vault links an outside AI can't
   follow) — Christian pastes it into other AIs for outside opinions.
3. **Update every affected living doc:**
   - phase/status/next-steps changed → [[(C) Roadmap]] **and** the status + open threads in
     [[(C) Praelude Command Center]].
   - **anything Christian faces changed** — a voice command or vocabulary word added/renamed/
     removed, a UI flow or view changed, a default (ladder step, rep count, TTS voice…)
     changed, a new permission or setup step → **[[(C) How To Use]]** (the tutorial) **and its
     `Matches: vX.Y.Z` line.** The tutorial must always describe the _installed_ app exactly;
     a stale tutorial is a bug of the same severity as a stale summary.
   - a flaw found / fixed / newly understood → [[(C) Flaws]] (add, or move to Resolved with
     the fixing commit). **Never delete a flaw silently.**
   - an engineering decision, gotcha, or empirical fact → `~/praelude/NOTES.md` (keep its
     existing style).
   - this file's Status section (below).
4. **Version records are immutable once shipped** (`versions/*`) — factual corrections only.
5. **Commit the code in git** with a descriptive message; **tag on a version bump** (e.g.
   `git tag v0.2.0`). Update the memory file if a durable fact changed.
6. **Refresh the Git-backed manual:** from `~/praelude`, run `npm run docs:sync` and
   `npm run docs:check`, then include `docs/project/` in the same commit. This mirror contains
   Markdown only. Never copy vault databases, scores, output files, credentials or app backups
   into Git.

**If a session ends without steps 1–3 done, the session is not done.** A future you must be
able to re-enter cold and trust these docs completely.

**Standing install preference (Christian, 2026-09-03):** install completed Mac changes immediately
after their normal release, data-safety and fresh-context verification gates pass. Do not defer an
otherwise-ready install merely to batch it with later work; an active/open practice set, a failed
gate or an explicit hold remains a real safety blocker.

## 🏷️ The version system (so "what's next" is always clear)

- **App version (semver-ish)** = a shipped milestone of the `.app`. Installed is **Praelude v11.1.0 / schema21**, installed 2026-09-08 at 16:58 EDT; implementation `c411e7b`. Progressive practice resonance is shipped, with exact 46-table/DB-byte preservation. Native Score/Variants now pass; native audio/motivation verdict remains open. See Status/Changelog and `docs/qa/v11.1.0/`. Hidden `com.christian.codakiller` storage identifiers preserve compatibility.
  The historical **v9.1.0/schema 21 Windows x64 candidate** is unchanged: exact unsigned current-user NSIS installer 7,654,002 bytes, SHA-256 `e2e2f3ae8846ef7aca6a6c04b2e1a2f346e97640f5d9089e6e49012365dc5dd4`; package implementation `2d33004888a97c3ebcb4b7799bf54029efd15626`, tag `v9.1.0` at `f296f3cb38ae5d29c1ae813493f5c37ea07ed9a6`. Native Windows tests/Windows 10/11 acceptance remain pending; no voice/Listen Back/system TTS/volume boost. Read Git for the moving private `origin/main` tip. Historical Mac package/tag identities remain in Changelog and version records, not as current install blockers.
- **Phases `P0`–`P7`** = the build plan ([[(C) Roadmap]]). Mapping: P0–P2 → `v0.1.0`;
  P3 → `v0.2.0`; P3.5 Foundation → `v0.3.0`; P4 → `v0.4.0`; P5 → `v0.5.0`;
  P5.5 → `v0.6.0`; P6 → `v1.0.0`; P7 was planned as `v2.0.0` but shipped inside the v3.0.0
  frontend transformation; v3.1.0 is the real-use hands-free stabilization and v3.2.0 the
  long-session/system-coherence release; v4.0.0 is the Practice Notebook OS, v5.0.0 the paper
  redesign + colour-depth perf fix, and v6.0.0 the Practice Core. Keep the mapping written down.
- **`versions/`** = one immutable note per shipped **minor/major** version (e.g. `(C) v0.1.0 —
Version Record`) with what it is, what shipped, what was verified, honest gaps, and
  **explicit NEXT STEPS**. Patch releases live in [[(C) Changelog]] only.
  **Honest coverage note (audited 2026-08-27):** records exist for v0.1.0–v1.3.0, v3.0.0,
  v3.1.0, v3.2.0, v4.0.0, v5.0.0, v6.0.0, v7.0.0, v7.1.0, v7.2.0, v8.1.0 and v8.2.0. A
  **draft** v9.0.0 record exists but is not immutable until shipment. Records do **not** exist for the patch tags
  `v3.0.1`–`v3.0.4` and `v4.0.1`, which are Changelog-only by the rule above. The living
  codebase is the git repo; old code lives as **git tags** (`p2-done`), never duplicate folders.
  A **draft v9.1.0 Windows record** exists too; its exact installer is proved, but it remains
  mutable until the Windows 10/11 native-acceptance boundary is proved. Records for Praelude v10.0.0 and v10.1.0 also exist; the v11.0.0 and v11.1.0 records retain their shipped/installed boundaries and are immutable. The pre-v11 Roadmap/Tutorial snapshots are explicitly historical documentation archives, not extra shipped versions.

Every version record and every roadmap phase MUST end with a clear "Next steps" block.

## How to work here (the process that worked for P0–P2)

- **Subagent-driven with per-task review gates.** Orchestrator plans; executors implement one
  task; a **fresh-context verifier adversarially tests every non-trivial change** (live app,
  not just unit tests) before it counts as done; security-executor handles keys/Keychain.
  This caught real bugs (a verifier found `+inf` bpm would infinite-loop the audio callback).
  Keep it.
- **Build/run/test (in `~/praelude`):**
  ```
  npm install
  npm run tauri dev                       # dev run
  npm run tauri build -- --bundles app    # build ONLY the .app (the dmg step deletes the .app dir — see NOTES)
  cd src-tauri && cargo test               # Rust suite
  npm test                                 # frontend (vitest)
  ```
- Before trusting a change on the real app, **quit + relaunch** the installed `.app` (a
  running instance serves old code). First launch needs mic + Speech Recognition Allow;
  Dictation must be ON (`kLSRErrorDomain Code=201` means it's off).

## ⚠️ Known project-level risks (full list in [[(C) Flaws]] — read it)

- **Real use confirms the direction and continues to expose interaction defects.** The final installed v11.1.0 audit (2026-09-08) is schema21, integrity OK/FK0 with 11 pieces / 353 blocks / 3,242 reps / 64 sessions / 11,804 session events and zero open sessions/blocks. All 46 tables and DB bytes match the pre-install backup exactly. Recheck current rows and retain fresh backup/rollback before any future installation.
- **Voice-over-Steinway and Listen Back are not accepted for the current release.** v6.0.0 had one genuine
  37-minute/20-rep session and an accepted-with-issues direction verdict, but that does not prove
  the microphone ownership, Listen Back or two-word verdict paths inherited by subsequent Mac releases. Narrated replay hardens
  intent behavior; it does not substitute for the current hardware verdict.
- **Cloud-vision measure mapping is unproven on real data.** The live `measure_map` table holds
  **0 rows**: the headline v6 feature has never produced a mapping outside tests and one
  branch-era Gemini acceptance run. No Anthropic key is in Keychain, so the Claude vision path
  has never run at all ([[(C) Flaws]] B67).
- **The broad Practice Operator is not built and is ON HOLD.** Page-only targeting,
  Goals/Calendar/session-plan voice actions, durable unfinished drafts, and the complete
  capability/audit registry remain, but Assistant work does not resume without Christian's word.
- **Off-disk backup — RESOLVED 2026-08-23.** A private GitHub remote exists at
  https://github.com/cchow375/praelude ([[(C) Flaws]] B54/C1, the project's oldest unfixed
  risk, now resolved). Scope limit: this backs up the git repo only — the Obsidian vault itself
  is still not backed up off-disk.
- **Windows v9.1 is packaged but not native-accepted.** The exact unsigned x64 NSIS installer,
  hash, recursive cleanliness and PE32+ payload are proved. Windows-native cargo tests and clean
  Windows 10/11 install/relaunch/picker/PDF/audio/persistence evidence are pending. SmartScreen
  friction is expected; voice, Listen Back, system TTS and volume boost are unavailable.

## Status

## October 9 — build9 installed and opened; physical acceptance pending

**Installed iPad: native2.0.0/build9/schema5 from `2de2444`. Launch/readback pass; physical acceptance remains pending. Mac:v11.1.0/schema21 unchanged.** On the iPad Pro12.9-inch (3rd generation, iPad8,5), iOS18.7.8, the prior build8 report was that the score cannot zoom while ink pans, Clean takes about one second, scrolling/menu/mode changes and warmup exit are delayed, passage selection updates about once every four seconds, and Pencil use crashes. These are physical observations, not accepted performance limits.

A45-second physical build8 Time Profiler capture records18.293 seconds of main-thread sampled CPU time, including12.276 seconds in `syncAll`. Instruments identifies14 hang/microhang intervals, the longest2.0187 seconds. The leading stack is `String(format:)` → `Data.praeludeHexLiteral` → `InkStrokeSyncRow` → `enqueueLibrarySnapshot` → scheduled `syncAll`. Inclusive samples overlap; hang duration is not measured touch-to-frame latency. These are build8 measurements, not evidence of build9 improvement. Sanitized evidence is `docs/qa/ios/2.0.0/build9/build8-physical-performance.json`.

Build9 source repairs are frozen for final verification: PDFKit owns page pan/zoom while the drawing canvas stays fixed; bounded app-owned drawing-value history replaces native tile Undo registrations; durable practice sync entries batch in parent-before-child order with debounced draining and account/revision-scoped snapshot reuse; a byte lookup replaces per-byte NSString formatting while retaining the existing hex wire format. Core412 and full native258 (1 live-account skip,0 failures) pass before the final gesture-priority change; two iPad practice/selection UI cases also pass. The earlier actual pinch failure is retained in QA. Undo now waits for the native pinch recognizer to fail and cannot recognize simultaneously. All14 targeted native interaction tests and fresh source review pass after that change. Actual UI5x pinch raises PDF scale to2.3177427145 from minimum1.0255516841 with the ink stroke retained; independent before/after pixel review accepts score/ink alignment and the settled palette. Actual two-finger Undo passes in Draw and reading. Two attempts to place the zoomed two-finger tap through XCTest fail because the target lies in a clipped viewport; this does not establish a production failure or a pass. The final gesture UI passes70.518 seconds: actual stroke, two-finger Undo in Draw/reading, Redo, mode change, strict real PDF pinch with unchanged ink, toolbar Undo/Redo at zoom, Done and saved ink after relaunch. Physical two-finger Undo at zoom remains pending. Source is frozen. Signed device build9 Release and strict app/profile/team/device/signer-trust and Release fixture/debug-exclusion checks pass. The same-bundle profile expires October16 at23:56:11 UTC (7:56 PM EDT). Independent signed-artifact verification and guarded installation also pass. Build9 is installed and running; independent post-launch preservation passes. Active-use responsiveness evidence and physical acceptance remain pending. No measured speedup or physical-crash closure is claimed.

**Installed build9 checkpoint:** source `2de2444a782cb54a5cd31966ecc33257e4511dd0`, tag `ios-v2.0.0-build9-candidate`, is installed through the guarded same-bundle refresh. Independent review verifies all13 owned files/12,960,329 bytes identical by filename, size and SHA-256 before launch. Schema5/revision2167 retains6 pieces/53 passages/54 set IDs (53 historical plus1 paused active set)/35 sessions/317 attempts/259 ink records (202 active)/2 stamps/2 notes. The paused set is preserved; it is not a running set or an empty active slot. Actual post-helper Release signing/profile checks pass; expiry remains October16 at23:56:11 UTC (7:56 PM EDT). iOS denied automatic launch, then the user confirmed opening build9 and read-only process inspection confirmed it running. Independent complete post-launch readback at October10 00:57:50 UTC (October9 8:57:50 PM EDT) verifies the same13 files/12,960,329 bytes unchanged, schema5/revision2167 and every original record including the paused set. Physical zoomed two-finger Undo, responsiveness and sustained practice remain pending. Both build9 traces completed but were effectively idle: the45-second trace has12 all-thread samples/5 main-thread CPU milliseconds; the120-second trace has15 all-thread samples/8 main-thread samples (8 milliseconds). Neither reports potential hangs, but neither proves active score gestures or a speedup; foreground lifecycle is unknown. User gesture feedback remains pending. Evidence: `docs/qa/ios/2.0.0/build9/personal-ipad-install.json`.

**Next steps:** obtain feedback on the actual practice/Pencil/zoom/Undo flows and capture verified active-use profiling if needed. Physical lag and zoomed two-finger Undo remain open. Preserve the paused set and keep installation/preservation separate from physical acceptance. No week-long or zero-defect claim is supported.

Evidence and planned checks: `docs/qa/ios/2.0.0/build9/responsiveness-regressions.md`; the separate Undo repair ledger is `docs/qa/ios/2.0.0/build9/undo-repair.md`.


## October 9 — build8 usability repair, INSTALLED — PHYSICAL FAILURE REPORTED

**Current source: native 2.0.0/build8/schema5. Installed iPad:build8/schema5, October9. The user reports a confirmed native Undo crash after opening. Mac remains v11.1.0/schema21.** Christian's current feedback still reports annotation-confirmation freezes, poor drawing quality, inaccessible tempo/goals, crowded controls and microphone crashes. Build7's earlier test and preservation results do not close those reports.

Build8 exposes exact tempo entry, tap tempo, a visible Tempo goal and L/Both/R controls; keeps practice available during drawing and passage selection; adds a movable, collapsible drawing palette, two-finger Undo, direct rename/dictation and repositionable notes; uses native PencilKit zoom/layer rendering; and makes movement practice and warmup exits explicit. All six annotation tools have visible 44-point targets, compact tempo displays include BPM with distinct Start/Goal spoken labels, and tempo/page numeric fields select the old value on focus; invalid page drafts keep Save disabled. Movement entries share the original score and retain a validated title/source-page-range snapshot in practice history without duplicating PDFs, ink, passages or repetitions. Existing schema5 and native sync contracts remain in use.

Idle annotation saves prepare stroke records and JSON away from the UI actor, then recheck the current library revision and original ink before atomic publication. A stale task cannot clear newer drawing. Explicit page/mode/layer/exit checkpoints remain synchronous and refuse transitions on failed saves; atomic writes, imports, backups and complex PDF work still need physical latency testing. Speech callbacks explicitly return to the UI actor, and microphone permission/route/ownership guards keep failure recoverable.

**Crash diagnosis:** Six physical build7 watchdog reports (three each from October 7 and October 9) and a 90-second CPU report identify the same SwiftUI responder/AttributeGraph cycle: synchronous `PDFView.go(to:)` in `PagedScoreView.updateUIView` removes a focused overlay while SwiftUI is already updating. Matching-dSYM symbolication establishes this path; it does not attribute every reported freeze or the separate microphone complaint. Build8 defers and coalesces PDF reconfiguration until that update unwinds, explicitly observes the state its deferred coordinator reads, and retains failed-checkpoint guards. Detailed evidence is in `docs/qa/ios/2.0.0/build8/crash-analysis.md`.

**Verification and delivery:** 406 core tests, 2,211 deterministic service assertions and 57 Python helper tests pass. The final native run executes 245 tests with 1 live-account skip and 0 failures in 16.881 seconds; the mounted-scene fixture proves window identity before its strict crop/zoom checks. UI15 passes the complete actual sticky create/hold-drag/double-tap-edit/relaunch/triple-tap/permission-denied recovery flow in 59.539 seconds on the same final production source. Phone3 passes accessibility portrait/landscape in 71.631 seconds, with four independently accepted screenshots. Earlier scoped passes cover exact 72→88 BPM goals, hands, grading/Undo, movement editing/navigation, warmup Finish, score continuity, markup and two-finger Undo/Redo. Source review and scoped layout review pass; source is frozen. The 45-item QA report preserves UI13–15 native frame failures, earlier UI failures, stale-runner evidence and the test-fixture correction instead of replacing them with a blanket pass. Build8 is installed; the user reports a physical failure, and no week-long teacher trial has occurred. Exact run scopes, failures and remaining gates belong to `docs/qa/ios/2.0.0/build8/usability-review.md`. The device is connected. The deployment helper can activate an on-demand connection with a read-only details request to the exact named device; three new regressions bring its suite to 57 tests. This does not establish app acceptance or permit switching devices. Final source/native review and actual Release signing checks pass. Guarded installation and helper-confirmed full-file preservation pass; independent inventory/count audit passes for the pre-crash snapshots. No week-long teacher trial or zero-defect claim is supported.

**Installed build8 — physical Undo crash remains open:** native2.0.0/build8/schema5 from `a23cdec4f4f9acf42e8e5c724b6a386430dddca5` is installed. Independent review verifies all13 owned files/12,788,247 bytes unchanged by filename, size and SHA-256 before launch. Automatic launch was declined; the user opened the app. The23:59:40 UTC readback retains schema5/revision2086 (from2079),6 pieces/51 passages/50 sets/31 sessions/304 attempts/255 ink records (199 active)/2 stamps/2 notes. Original records remain exact except one piece page bookmark; profile/privacy/account/score data are exact. This readback precedes the23:59:53 UTC crash and is not post-crash retention proof. The user reported failure at19:59:56 EDT. Matching build8 dSYM identifies main-thread `EXC_BAD_ACCESS` at0x10 in `PKTiledView.performUndo` tile update, reached through the two-finger Undo action; this is distinct from the build7 PDF watchdog. Exact user sequence remains pending and the crash is unclosed. Signed Release checks pass, with profile valid through October16 at23:56:11 UTC (7:56 PM EDT). Sanitized evidence: `docs/qa/ios/2.0.0/build8/personal-ipad-install.json`. Mac v11.1.0/schema21 is unchanged.

**Next steps:** obtain the exact user sequence and reproduce the confirmed native two-finger Undo crash before accepting its repair. Keep the23:59:40 UTC readback separate from post-crash retention. Keep physical Pencil, microphone, large-score and sustained-use acceptance open; do not treat installation as task completion.

## October7 — build7 installed on the personal iPad

**October 7 user confirmation:** Christian confirms the update reached the iPad. This confirms installation; sustained Pencil, audio, freeze recovery, refresh rate and real two-device behavior still require physical acceptance. The complete implementation, verification and deployment handoff is `docs/qa/ios/2.0.0/build7/session-handoff.md` (source `3e03330`, installation record `2227817`).

Guarded same-bundle refresh installs2.0.0/build7/schema5 from source `3e03330`. Independent full pre/post inventory review proves all11 owned files/7,981,365bytes identical by filename,size andSHA256, including scores, annotations, history, account ownership/privacy/preferences. Pre-launch schema5/revision1647 has5pieces/44passages/43historical sets/30sessions/255unique attempts; retained active set is completed, with no running set. No schema migration, import, restore, uninstall or Mac change occurred.

Actual signed device Release passes strict signature, app/profile/team agreement, signer-certificate membership/trust and helper device inclusion; fixture arguments/debug diagnostics/test plug-ins are absent. Profile expiresOctober10 at17:55:53UTC (1:55PM EDT). Automatic launch failed; subsequent read-only device inspection confirms Praelude running and schema5/revision1660. Independent post-launch review retains all255 attempts,44set IDs,30sessions and every original45ink record, plus exact profile/privacy/preferences. A completed set is archived and newer ink/reward/page activity is observed; no author or automatic-startup attribution is inferred. User screen-quality confirmation remains separate. Source/native simulator verification remains distinct from physical Pencil/audio/freeze/long-session/real-account two-device acceptance. Exact sanitized evidence: `docs/qa/ios/2.0.0/build7/personal-ipad-install.json`; private complete backups stay outside Git.

**Next steps:** use the installed build7 for real practice to verify sustained Pencil/eraser/Undo/layer/page transitions and responsiveness. Renew with the same app/team before the actual profile expiry.


## Historical October 6 — build7 stability and responsiveness candidate

**Historical build7 source: 2.0.0/build7, schema5, DEVELOPMENT CANDIDATE at that boundary. Personal iPad now has build7 (October7); device running-process and schema5 readback are confirmed.** Christian reports freezes requiring force quit, lagging/disappearing ink and crowded controls. This repair preserves the native format, score source geometry and user-supplied practice verdicts.

Native testing reproduced a stamp-switch freeze in UIKit responder teardown. The canvas stays enabled; overlay hit routing handles selection/stamps/text/read-only states without disabling the focused canvas.

Drawing samples now mark a canvas dirty without repeatedly serializing it or rewriting practice data. Autosave waits for a 600ms idle interval; page/mode/layer/background/exit transitions still require a successful save. Failed checkpoints remain recoverable, and Keep my drawing uses the newest dirty canvas. Long strokes receive bounded content identities; partial-erasure masks participate in identity. Corrupt saved ink stays read-only instead of masquerading as an empty page. A non-observed drawing cache avoids recursive view invalidation and evicts old pages while pinning live/failed-save baselines.

Page/link/passages/cover/heatmap previews use serial background renderers, bounded pixels and image-memory costs. Offscreen cover requests cancel queued work after their last viewer leaves, while shared visible requests survive cancellation. Neighbor-page speculative rendering no longer races the displayed PDF. Stamp glyphs and inactive-layer images have bounded retention. Annotation tools use a shallow icon strip with accessible names; long tool trays scroll within half the usable workspace height. Geometric stamps retain fixed size with named44-point buttons. Short landscape annotation starts at stave width, restores prior portrait zoom after automatic fitting, and preserves a deliberate pinch. The phone resume banner stays above the tab bar, including secondary screens. Warmup Close and practice controls remain anchored while the central readout scrolls in short windows. Today uses a 44-point reorder menu. The metronome preset row now has a full-width44-point hit target. Independent native screenshots drive intrinsic annotation-footer sizing, preserving score space. Compatible iPhones opt into higher refresh rates; iOS still chooses actual frame pacing.

Ink matching and session validation/projection use indexes; reward catch-up batches writes without combining or inventing awards. Tuner analysis admits one window at a time. Sync rejects canceled/old-account pulls, yields during large pulls and hashes private files off the UI actor. Search/avatar/profile previews and measure scans cannot overwrite newer requests. Notebook multi-delete captures IDs before the list changes. Metronome settings no longer subscribe to animated beat progress. Live meter rows capture stable accents so an older SwiftUI row cannot index a changed list. A retained background click survives a delayed foreground pause observer, while explicit Stop and later manual pauses still stop it. Annotated sharing captures saved data, yields between pages and cleans partial canceled output; photo-to-PDF composition runs off the UI actor.

**Verification:**394 core tests,2,211 service assertions and54 Python tests pass. Native hosted215 execute per form factor with1 live-account skip/zero failures. Eight phone UI cases and a stricter rotation/Done rerun pass; four iPad UI cases plus the corrected metronome retry pass. Independent final phone/iPad visual review accepts these scoped layouts. A fresh arm64 device Release compiles as2.0.0/build7 with fixture arguments, debug diagnostics and test plug-ins excluded. Failed aggregates remain recorded in `docs/qa/ios/2.0.0/build7/stability.md`; source tag is `ios-v2.0.0-build7-candidate`. Physical installation and complete-file preservation pass; physical Pencil, sustained refresh-rate and real-account/two-device acceptance remain open.

**Open limits:** full-library JSON encoding/atomic writes, large import/backup/restore and a single complex PDF page/final export rewrite can still block the UI. These require a separate persistence/rendering design and real-device profiling. Background work and simulator screenshots cannot prove a fixed 120fps rate or eliminate every freeze. Mac remains v11.1.0/schema21; Assistant remains on hold.

**Next steps:** verify sustained real Pencil/practice behavior on the installed build7 after the completed guarded update and schema readback. Verify sustained physical Pencil/eraser/layer/page transitions during practice, large actual scores, interruptions and real-account second-device continuity.


**Historical October3 mobile source: 2.0.0/build6, schema5, DEVELOPMENT CANDIDATE.** Christian's physical build4 feedback drives this round: Pencil did not draw without finger mode, black marks/stamps were invisible, annotation could freeze during a set, passage navigation was slow and ambiguous, and score chrome took too much space. Build5 implements fixes and new controls and is personally installed on the iPad. Complete pre-launch file preservation and actual schema5 upgrade pass; physical Pencil/freeze acceptance remains open.

**Build6 compact practice correction:** Christian found build5’s dock still too tall, especially Start without grading, Techniques and More options. The fixed width cap is removed. Wide setup uses two columns; those secondary actions share a shallow44-point row. Grading/verdict buttons use horizontal icon/text and52-point targets; running status, direct tempo, transport and verdicts share a row when the available width fits. Narrow windows reflow and accessibility text retains wrapping/scrolling. Six scoped iPad cases pass, including actual grading/Undo, portrait/landscape geometry and largest-text reachability. Setup is143pt and running100pt; secondary controls44pt, verdicts52pt. Two scoped phone cases also pass portrait/landscape geometry and actual grading/Undo. Independent final visual review passes. Build6 is now installed on the physical iPad after the October3 guarded update. Renewed provisioning is valid until October10 at17:55:53UTC (1:55PM EDT); actual Release signature/profile/team/device checks pass. Independent review confirms all11 owned files/6,212,619bytes exactly preserved, including practice history and account ownership/privacy. Pre-launch schema5/revision883 has5pieces/30passages/24historical sets/15sessions/114attempts and no active set. Automatic launch was declined; Christian confirms Praelude opened, and a direct ledger read confirms schema5/revision883. Native Pencil/freeze/piano and actual two-device acceptance remain open. Earlier signing attempts and renewal recovery are retained in `docs/qa/ios/2.0.0/build6/device-update-attempt.json`; installed evidence is `docs/qa/ios/2.0.0/build6/personal-ipad-install.json`. Layout evidence: `docs/qa/ios/2.0.0/compact-practice.md`.

**Score workflow:** a visible Library exit and compact bottom Practice / Select / Draw controls; passage Done at the bottom or score double-tap; distinct editable passage colors and an account-synced hide-boxes setting. Entering annotation retains the active set and its saved progress. PencilKit uses paper-light traits and deferred responder setup; finger navigation and optional finger drawing remain separate. Stamps have movable sized previews and a magnifier before Place. Yellow note chips expand locally with Edit/Close; failed saves retain the note text or stamp preview.

**Organization:** reviewed movement/book page ranges keep source PDFs, marks and history anchored while labels restart at section page1. PDF contents/bookmarks suggest sections; local Vision offers printed-number hints for review. Users confirm a measure or system region and its first/last numbers; newly drawn boxes inherit confirmed ranges, and older unlabeled passage/history displays derive fully covered confirmed ranges without rewriting snapshots. This is assisted mapping, not automatic optical music recognition. Passage lists group by page, sort measure numbers, and use bounded background thumbnail caches; history shows meaningful locations.

**Practice:** per-piece default tempo, visible pre-start metronome On/Off, stable Techniques with explicit Left hand/Right hand, less dock padding, a compact initial practice readout and width-fit Focus. Notebook New note opens directly. Rank progress leads Rewards; Studio stays secondary.

**Sync and preservation:** native profiles/privacy, instruments, practice records, score marks, goals/routines with deletion tombstones, movement/measure metadata, default tempo, account preferences and private score/recording/cover files have shared Supabase contracts. First sign-in reads the account before publishing defaults. Name/photo/privacy edits stage durably before local save and remain recoverable through failed saves, concurrent hydration, reverted retries and same-account sign-out. Local edits request debounced sync; unchanged remote adoption does not rewrite the ledger. Canonical lowercase owner-folder UUIDs fix a file-policy mismatch. Absent SQL columns and unknown preference keys survive older clients; other nested schemas remain versioned. Nullable clears remain explicit. Schema5 preserves the exact old ledger; backups require version4. Hardware permissions/audio state stay device-local.

**Mac boundary:** the additive read-only snapshot transfer still preserves all46 original Mac tables and history/contracts, without replaying them under mobile rules or granting rewards. The original Mac archive stays local and in native backups. Continuous Mac↔native synchronization still needs a desktop adapter; the installed Tauri product is unchanged. Future clients must follow the shared ownership, source-page, LWW and append-only contracts.

**Installed-device boundary:** Build6 is now installed on the physical iPad after the October3 guarded update. Renewed provisioning is valid until October10 at17:55:53UTC (1:55PM EDT); actual Release signature/profile/team/device checks pass. Independent review confirms all11 owned files/6,212,619bytes exactly preserved, including practice history and account ownership/privacy. Pre-launch schema5/revision883 has5pieces/30passages/24historical sets/15sessions/114attempts and no active set. Automatic launch was declined; Christian confirms Praelude opened, and a direct ledger read confirms schema5/revision883. Native Pencil/freeze/piano and actual two-device acceptance remain open. Earlier signing attempts and renewal recovery are retained in `docs/qa/ios/2.0.0/build6/device-update-attempt.json`; installed evidence is `docs/qa/ios/2.0.0/build6/personal-ipad-install.json`. Layout evidence: `docs/qa/ios/2.0.0/compact-practice.md`.

**Build5 verification:** 385 core tests, 2,211 service assertions and 54 Python tests pass; the final native app-hosted run executes 193 tests with one live-account test skipped and zero failures. Seven distinct iPad and five phone UI cases pass across scoped runs. Final arm64 device Release compiles with fixture flags/test plug-ins absent; a later guarded physical update is recorded below. Exact evidence and remaining acceptance are in `docs/qa/ios/2.0.0/score-workflow.md`.

**Next steps:** use the installed build6 to verify Pencil, black ink, sustained annotation during practice, reviewed movement/measure mapping and actual second-device continuity. Continuous desktop sync needs its separate adapter; Assistant remains on hold.

**Last updated: 2026-10-09. Praelude v11.1.0 / schema 21 — SHIPPED + INSTALLED.** Installed at `/Applications/Praelude.app` at 16:58 EDT on 2026-09-08; implementation `c411e7b`. Fresh native launch, real Score and Variants dialog pass. All 46 database tables and DB bytes are unchanged from the fresh backup. The private Git repository now carries a curated copy of the complete living project manual, version records, a new-Mac guide and a machine doctor/bootstrap script; personal data remains deliberately outside Git.

**Native boundary:** v11.1.0 launches and renders the real Beethoven Op.90 movement 2 score, selected passage and Variants dialog. The earlier Desktop/Score permission blocker is cleared. Progressive rep/set/chain effects passed independent live browser review; native audible quality, voice/chime overlap and Christian’s motivation verdict remain open. Cover-picker selection/save (B109), microphone/Steinway, real mapping and Windows acceptance remain separate.

The Rep Counter now builds a luminous core, orbital arcs, a filling ring and progressively richer sparks as the current clean target fills. Sloppy/Again send falling fragments and deepen amber to coral on successive setbacks, capped at three. Set completion gets a larger radial bloom; a fully completed variant chain gets the largest gold finale. Original offline pluck/glass/air sounds rise and gain harmonics with progress, vary their ornaments, descend on setbacks and resolve into richer set/chain chords. Existing practice rules are unchanged: Total plays retains earned volume, and Again preserves variant-stage progress. No added XP penalty or automatic musical judgment.

Final frontend **2,614 passed / 1 skipped** (214 files passed / 1 skipped, four workers); native **1,106 passed / 18 ignored plus integrations**; TypeScript, production/native builds, strict Clippy and Rustfmt pass. Independent 1280×720 and 720×520 live review verifies clean/setback/undo, fifth-clean set completion and a Dotted 2 → Reverse dotted 3 chain. Audio-device failure, cleanup, gesture unlock and reduced-motion behavior have automated/source coverage. The sandboxed macOS speech probe and one concurrently loaded Listen Back assertion failed before authorized/native and four-worker full reruns passed; the QA ledger retains those limits.

Post-install comparison proves all **46 tables** and DB bytes exactly equal to the fresh backup: schema21, integrity OK/FK0, **11 pieces / 353 blocks / 3,242 reps / 64 sessions / 11,804 session events / zero open sessions or blocks**. DB SHA-256 `7aa93e4ef23834875e60b2c9a3946ddf2c522116044cf4cd54900bc6a71594b5`. No synthetic practice or preference changes were written for acceptance.

DMG `releases/v11.1.0/Praelude-11.1.0.dmg`: **10,694,680 bytes**, SHA-256 `511a281f4bfc9684cb55fc3a0f3ea93351c0d2c9333344cc4871e576b5ab9a0a`. Installed arm64 CDHash `bf6e9c2a969ffe2f5cdc9adf69614a71b7644b6c`; ad-hoc signed, not notarized. Runtime `c411e7b`; exact gates, archived v11.0 rollback, backup and manifest are in repo `docs/qa/v11.1.0/`.

**Next steps:** Use the next real practice session to judge the escalating visual/audio rewards, native voice/chime overlap and motivation. Finish cover-picker selection → rendered cover → restart when controllable. Microphone/Steinway, real-provider mapping, accounts/social and Windows-native acceptance remain separate. Assistant stays OFF and ON HOLD.

## Codex's job here

Build the versions Christian's feedback asks for; keep every document current per the update
protocol above; stay blunt about difficulty and gaps. The old app died of optimism about
what the mic could do — do not repeat that. Ambitious target + honest attack plan is the
format for everything here.

## Parent

- [[(C) START HERE]] (Piano Practice hub) · cousin project: [[Cadencify]]
