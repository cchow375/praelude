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

**Last updated: 2026-09-13. Praelude v11.1.0 / schema 21 — SHIPPED + INSTALLED.** Installed at `/Applications/Praelude.app` at 16:58 EDT on 2026-09-08; implementation `c411e7b`. Fresh native launch, real Score and Variants dialog pass. All 46 database tables and DB bytes are unchanged from the fresh backup. The private Git repository now carries a curated copy of the complete living project manual, version records, a new-Mac guide and a machine doctor/bootstrap script; personal data remains deliberately outside Git.

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
