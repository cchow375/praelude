# 📜 Praelude — Changelog

> The full version history. **Every session and every change gets an entry here** — newest
> first, no exceptions (enforced by [[AGENTS]]' update protocol). Big rounds of work = a new
> version (with a `versions/` record); small fixes = entries under the current version.
> Engineering-level decisions & gotchas also go in `~/praelude/NOTES.md`; this file is the
> human-readable "what changed, when, why" history. Hub: [[(C) Praelude Command Center]].
>
> **Format:** date · what changed · why / driven by what · files or docs touched.

---

### 2026-09-13 · Fresh-Mac development portability and Git-backed project manual

- **Why:** Christian wants to continue the project from a different Mac. The code repo was clean and synchronized, but the binding Obsidian project folder was not in Git; a fresh clone lost the living Changelog, Roadmap, tutorial, Flaws, Command Center, Motivation and version records. Repo README/CLAUDE entry points were also frozen at conflicting v8-v10 states.
- **Changed:** the private repository now carries a curated `docs/project/` mirror of all eight living Markdown documents, every Markdown version record, the four bannered v2/reference documents and the small Markdown-only PianoCoach lineage that the current manual explicitly cites for lessons. Historical lineage is clearly labeled evidence, never the current implementation/UI template. Root README/AGENTS/CLAUDE are current, repository-relative entry points. `docs/NEW_MAC_SETUP.md` documents private clone access, prerequisites, lockfile setup, proof commands, native permissions, compatibility identifiers and the boundary between source development and personal app state.
- **Portable tooling:** the tracked coverage-audit workflow now uses `PRAELUDE_REPO_ROOT` when supplied and otherwise the invoking repository directory; the Griffes narrated-fixture converter writes to the current checkout and accepts explicit `--source` / `--output` paths. Neither executable helper is tied to `/Users/c3/codakiller` anymore.
- **Repeatability:** added `.node-version` for the known-good Node 26.4.0 toolchain, dependency-compatible Node/npm engine bounds, `npm run doctor`, `npm run setup:mac`, `npm run docs:sync` and `npm run docs:check`. The doctor enforces the Node range and npm 10+ using only stock-Mac/Git tooling, and verifies macOS/Xcode tools/Rust/Cargo, both lockfiles and the universal `hear` helper; setup runs `npm ci`. The docs sync copies only the approved manual and refuses an incomplete override vault before changing its mirror. Ignore rules now explicitly exclude environment files, SQLite data and signing material. Rust 1.96.1 remains verified evidence rather than an invented minimum-supported version.
- **Verified:** lockfile-exact `npm ci`, project/mirror checks and production TypeScript/Vite build pass. The project gate passes with the source vault present and absent; focused negative checks prove npm 9 is rejected and an incomplete override vault neither syncs nor changes the mirror. Frontend is **2,614 passed / 1 skipped** across **214 passed files / 1 skipped** with four workers. The first sandboxed native run reproduced the known macOS `say` denial (1,105 passed / 1 failed / 18 ignored); the authorized exact speech test then passed and the authorized four-worker native rerun passed **1,106 / 18 ignored plus all integration suites**. No app source, schema, live database or installed app changed.
- **Honest migration boundary:** Git still excludes Christian's live database, Pieces/score files, media, Keychain secrets, installed app, rollbacks and release artifacts. Stored library/PDF paths can be absolute `/Users/c3/...`; a raw database copy to another username is not accepted as a working practice-state migration (B114). The new guide supports a development clone and requires a separate encrypted, verified relocation plan for personal state.
- **Corrections:** current tutorial, Roadmap and Motivation no longer describe the v11.0 Desktop prompt as an unresolved v11.1 blocker. The historical v11.0 evidence remains unchanged. Installed v11.1 product behavior and release identity did not change.
- **Git audit:** before this round, `main`, `origin/main` and GitHub `main` all resolved to `6790b2a`; no source changes were waiting locally. A tag audit found local release tags v9.1.1 through v10.1.0 missing from GitHub; this portability round publishes those historical release pointers without moving them.
- **Touched:** repo README, AGENTS, CLAUDE, NOTES, package scripts, privacy ignores, bootstrap/docs-sync scripts, new-Mac guide and Git-backed docs mirror; vault AGENTS, Praelude, Command Center, Roadmap, Flaws, Changelog, How To Use and Motivation. Version records remain immutable.

### 2026-09-08 · v11.1.0 practice resonance — SHIPPED + INSTALLED 16:58 EDT

- **Why:** Christian says practice feedback is underwhelming and generic; requests increasing tension/reward across clean reps, expressive draining setbacks, huge set/variant-chain celebrations and equally varied musical sound.
- **Changed:** The Rep Counter now builds a luminous core, orbital arcs, a filling ring and progressively richer sparks as the current clean target fills. Sloppy/Again send falling fragments and deepen amber to coral on successive setbacks, capped at three. Set completion gets a larger radial bloom; a fully completed variant chain gets the largest gold finale. Original offline pluck/glass/air sounds rise and gain harmonics with progress, vary their ornaments, descend on setbacks and resolve into richer set/chain chords. Existing practice rules are unchanged: Total plays retains earned volume, and Again preserves variant-stage progress. No added XP penalty or automatic musical judgment.
- **Reliability fixes:** first Web Audio context now initializes; gesture unlocking supports spoken rewards; bounded cue lifecycle and failures cannot interrupt saved reps. Saved-attempt high-water guards prevent completion replay from correction/undo/redo/polling. Final-rep audio yields to the larger completion sound. B110–B112 record both fixes and the pending musician verdict.
- **Verified:** Final frontend **2,614 passed / 1 skipped** (214 files passed / 1 skipped, four workers); native **1,106 passed / 18 ignored plus integrations**; TypeScript, production/native builds, strict Clippy and Rustfmt pass. Independent 1280×720 and 720×520 live review verifies clean/setback/undo, fifth-clean set completion and a Dotted 2 → Reverse dotted 3 chain. Audio-device failure, cleanup, gesture unlock and reduced-motion behavior have automated/source coverage. The sandboxed macOS speech probe and one concurrently loaded Listen Back assertion failed before authorized/native and four-worker full reruns passed; the QA ledger retains those limits.
- **Installed:** native Today, real Beethoven score/pages1/3, passage controls and Variants dialog pass; the former Desktop permission boundary is cleared. Post-install comparison proves all **46 tables** and DB bytes exactly equal to the fresh backup: schema21, integrity OK/FK0, **11 pieces / 353 blocks / 3,242 reps / 64 sessions / 11,804 session events / zero open sessions or blocks**. DB SHA-256 `7aa93e4ef23834875e60b2c9a3946ddf2c522116044cf4cd54900bc6a71594b5`. No synthetic practice or preference changes were written for acceptance.
- **Artifact:** DMG `releases/v11.1.0/Praelude-11.1.0.dmg`: **10,694,680 bytes**, SHA-256 `511a281f4bfc9684cb55fc3a0f3ea93351c0d2c9333344cc4871e576b5ab9a0a`. Installed arm64 CDHash `bf6e9c2a969ffe2f5cdc9adf69614a71b7644b6c`; ad-hoc signed, not notarized. Runtime `c411e7b`; exact gates, archived v11.0 rollback, backup and manifest are in repo `docs/qa/v11.1.0/`.
- **Backup:** `/Users/c3/Library/Application Support/Praelude Release Backups/v11.1.0-2026-09-08/pre-v11.1.0.db`; archived `Praelude-11.0.0-rollback.zip`, SHA-256 `b3e2500d99c315a4e472e586438d87974aaef1af6bdecf2b03921a02446d312b`. Temporary build/rollback app copies removed after verification. No exhaustive home/old mounted-media one-copy claim.
- **Touched:** RepHud, Shell, ritual practiceEnergy/completionFx/completionSound, tests, version manifests, NOTES, spec/QA, AGENTS, portable summary, tutorial, Command Center, Roadmap, Flaws and new version record. Use the next real practice session to judge the escalating visual/audio rewards, native voice/chime overlap and motivation. Finish cover-picker selection → rendered cover → restart when controllable. Microphone/Steinway, real-provider mapping, accounts/social and Windows-native acceptance remain separate. Assistant stays OFF and ON HOLD.

### 2026-09-08 finalization · Praelude v11.0.0 Studio + practical glass overhaul — SHIPPED + INSTALLED 2026-09-07

- **Why:** Christian requested a practical professional glass interface and the handwritten ranked dream-room motivation system, authorized overnight work, and deferred accounts if no service could be configured.
- **Changed:** Studio replaces Universe with an original SVG room, ten musical ranks × ten divisions and continued Encore progression, 25 earned-coin furnishings/palettes and a durable local name. Focus earns 1 XP/600 seconds; completed-set session milestone totals are 1/2/4/6 XP at 3/5/7/10. Each division earns 25 coins; cost starts at 100 XP/division, +50 per rank. History counts and corrections reconcile rewards without repeat grants; atomic revision-checked local transactions preserve ownership. Accounts/sync/friends remain unbuilt.
- **Practical UI:** Today foregrounds Score/notes; Pieces adds custom artwork, grid/list, search/sort and Put to rest/Restore. Glass shell/controls, Dark/Light/System and accessibility preferences retain readable music. Shared dialogs isolate background/focus; workspace scroll resets. The shell tucks the Rep Counter while browsing and respects manual restore/minimize/close through persisted/delayed loads. B104–B106 are resolved in `a338581` and retained in Flaws.
- **Verified:** Frontend **2,595 passed / 1 skipped** across **212 passed files / 1 skipped**; native **1,106 passed / 18 ignored plus integrations** with four test workers; TypeScript, production/native builds, format and strict all-target/all-features Clippy pass. Final independent dock/library review found no remaining source blockers; broad dock/Shell checks passed 222, with the two additional policy cases included in the passing full suite.
- **Native:** installed at **23:53 EDT on 2026-09-07**; fresh launch passed twice. Today, Studio (**204 XP / 50 coins / Prelude 3**), Rank path, Practice record (**198 sets / 21h 9m**), Library (**4 Active / 5 Resting**), Settings, purchase-preview Cancel and local-profile Cancel pass without a purchase or preference write. Native screenshots are in repo `docs/qa/v11.0.0/`.
- **Native limits:** TCC at **23:53:43** confirms Desktop code-requirement mismatch/prompt, renewed Speech Recognition prompt and microphone mismatch. Score waits at “Finding score editions…” for Desktop Allow; native Score/Variants are not accepted behind that gate. Computer-use cannot accept the OS permission window. Browser cover selection hung; native chooser opened but could not be inspected, was canceled and the app restarted with no image saved (B109). Three native cover tests plus frontend preprocessing/validation pass; picker acceptance remains separate.
- **Artifact:** DMG `releases/v11.0.0/Praelude-11.0.0.dmg`: **10,691,711 bytes**, SHA-256 `dc51618396ecf532efa0a058a86f77a7451e186cac610c9d745f28da2d610417`. Runtime implementation `a33858139430b99bd22c8a2d0fa06fa6b1b2f4f1`; the app was built from the same unchanged production files immediately before that commit. Installed arm64 CDHash `eb19805326b4008e3a5cac1ed6bfcf472c870e98`; ad-hoc signed, not notarized; privacy strings verified. Release tag `v11.0.0` points to `c8e31b8e14bd3470d99be4852f7687e7a5a53f63`; the tag and private `origin/main` were pushed successfully. Read Git for the moving main tip after documentation-only follow-ups.
- **Data:** Post-install `post-install-audit.json` confirms schema 21, integrity OK/FK0, exact equality of all 46 tables and byte-identical DB SHA-256 `b285c5a0624769aeccc27a2543f9b414eb1b22750fa2c551e60f02cfee553cb4`. Counts remain **11 pieces / 352 blocks / 3,237 reps / 63 sessions / 12,233 events / zero open sessions or blocks**. Both fresh launches and canceled profile/purchase/picker checks made no practice or preference changes.
- **Backup/rollback:** Backup `/Users/c3/Library/Application Support/Praelude Release Backups/v11.0.0-2026-09-07-2340/pre-v11.0.0.db` (35,004,416 bytes), SHA-256 `b285c5a0624769aeccc27a2543f9b414eb1b22750fa2c551e60f02cfee553cb4`; rollback `/Users/c3/Library/Application Support/Praelude Release Backups/v11.0.0-2026-09-07-2340/Praelude-10.1.0-rollback.zip` (9,778,474 bytes), SHA-256 `1b9647ce671feab84e23c0da66d0fd5351e19c1f2fc8e2908432e252a7e24d40`. Pre-install audit was captured 2026-09-07 at 23:41 EDT with the native app quit and zero open rows.
- **One-copy:** Spotlight resolves exactly `/Applications/Praelude.app`; the broader filesystem audit is still running and is not yet claimed as passed.
- **Docs:** condensed stale portable summary/tutorial/hub/repo entry points into current truth; historical tutorial/roadmap handoff snapshots remain explicitly archived. Updated Motivation, Roadmap, Flaws, AGENTS, NOTES, installed tutorial (`Matches: v11.0.0`), QA and version record. START_HERE was finalized before packaging and was not changed after.
- **Touched:** native `store/studio`, `piece_covers`, commands; `features/studio`, Pieces, Today, Settings, Score, shell/dock, design tokens, shared Dialog, devMock/tests, manifests and the above docs.
- **Finalization (2026-09-08):** Created/pushed release tag `v11.0.0` at `c8e31b8`; private repository confirmed private. Saved native screenshots and exact post-install audit. `useRepReplay.test.tsx` now verifies discard after automatic re-arming instead of asserting transient idle; production replay code is unchanged. The full-home app-copy scan stalled and was stopped; Spotlight and 23 scanned app candidates show only the canonical app, with the legacy/build bundles absent.
- **Next steps:** Allow the renewed Desktop prompt and verify installed Score/Variants; finish the custom-cover picker → rendered cover → restart path when controllable. Obtain Christian’s real practice and sustained motivation verdict. Accounts, real microphone/Steinway, real-provider mapping, clean-recipient and Windows-native acceptance remain separate. Repeat the full-home app-copy audit when directory enumeration is available; Spotlight and the 23 scanned app candidates show only the canonical installed app.

---

### 2026-09-07 · Praelude v10.1.0 saved variants and routines — SHIPPED + INSTALLED

**Native launch limit:** v10.1.0 freshly launched and its database is unchanged, but Score is waiting at “Finding score editions…” for renewed macOS Desktop-folder permission. TCC logs at 22:43:01 explicitly show the old code requirement mismatch and Desktop prompt; Speech Recognition also re-prompted. Christian must click Allow on the Desktop prompt, then the native Variants surface check can finish. The computer-use tool cannot accept that OS permission window; browser QA is not native acceptance.

- **Changed/why:** Christian requested permanent custom variants, visibility switches and one-click named routines. **Saved variants and routines (v10.1.0):** Open **Variants → Manage variants**. Enter a **New saved variant** and click **Save to library**; use each **Show** checkbox to control its picker shortcut. The library is shared across pieces and survives app restarts. Select variants, arrange the sequence and adjust each stage’s clean count, then **Save sequence as routine**, enter a name and **Save routine**. Click a saved routine to replace the current draft sequence with a copy. To update it, enter its desired name and use **Replace … with current sequence**. Delete asks for inline confirmation. Hiding/deleting a shortcut preserves saved routines and existing sets. **+ Custom** remains a one-off stage. Variants are available for Clean streak; Total plays keeps its fixed-volume contract.
- **Storage:** typed native get/save commands persist a revision-checked SQLite settings snapshot. On-disk reopen, corrupt payload, validation and stale concurrent writer tests pass; no schema migration/default read writes. Hiding/removing shortcuts cannot rewrite saved stage snapshots or practice history.
- **Verified:** **Last updated: 2026-09-07 — Praelude v10.1.0/schema 21 SHIPPED + INSTALLED.** Variants now has Manage variants for permanent custom shortcuts and show/hide controls, plus named ordered routines with saved stage clean counts. Selecting a routine copies it into the draft. Full frontend (2,554 passed / 1 skipped), native (1,088 passed / 17 ignored plus integrations), strict lint, builds, independent compact/desktop UI review, package/signature/one-copy and exact data-preservation checks pass. Next: Christian’s real-use verdict; Windows native acceptance and microphone/Steinway evidence remain separate. Two fresh-context blockers (offscreen delete and Enter starting a set) were fixed before release (B103). Browser proof uses isolated devMock; native disk tests establish persistence.
- **Artifacts:** DMG `releases/v10.1.0/Praelude-10.1.0.dmg`: 10,612,722 bytes, SHA-256 `9f1454b17d6a44890dda5b3959b38a1c3ff9fbcc267a3a109adf0e975b2b52c9`. Implementation `1543c06`; final release boundary is tag `v10.1.0`. Ad-hoc signed, not notarized.
- **Data:** Database remains schema 21, integrity OK/FK0, 11 pieces / 352 blocks / 3,237 reps / 63 sessions / 12,233 events / zero open sessions or blocks. Full logical graph and live bytes are unchanged. Backup `/Users/c3/Library/Application Support/com.christian.codakiller/backups/(C) pre-v10.1.0-install-2026-09-07-223602.db`, SHA-256 `539c600e35f838a44812a40792a4187fef6e9284e6b92ca2bbc6c30dca8a5946`; rollback `/Users/c3/Library/CodaKiller-rollbacks/Praelude-v10.0.5-rollback-2026-09-07-223602.app.tar.gz`, SHA-256 `1bfdc49159f4a6fe91866150bdab63663866f3d1d5972bdb6bd9aff211a42b2f`.
- **Touched:** BlockForm/library hook/controls/CSS, native store/commands, devMock, tests, version manifests, NOTES, QA evidence and living docs. Existing Windows package unchanged.
- **Next steps:** Christian’s real-use verdict, then independent Windows/Steinway gates.

---

### 2026-09-07 · Praelude v10.0.5 practice-bar redesign — SHIPPED + INSTALLED

- **Changed:** Christian’s sketch now drives the bar: small selected-passage identity + close, Start set, Goal (confirmed as the existing practice focus), Metronome checkbox and starting/target tempos, Variants and Settings. Passage tools is a compact identity action. Measured Score workspace width drives reflow; long names truncate, and active-set notices stay below controls. Completion basis/count and tuning remain in Settings. Schema stays 21.
- **Why:** v10.0.4 still overlapped outside fullscreen and devoted too much space to passage identity while hiding essential draft fields. B102 records the correction. Fresh-context review caught notice auto-placement and fixed-dialog containment risks; both were corrected before release.
- **Verified:** 116 focused tests; full frontend **2,543 passed / 1 skipped**; native **1,083 passed / 17 ignored** plus all integration/narrated-corpus suites; TypeScript, production build, Rust format, strict Clippy, native build, share-clean, signature, one-copy, DMG and fresh launch. Independent browser QA passed **720×520, 1000×700, 1280×720, 1440×900, 2048×390**, breakpoint edges, long labels, active notices, Settings/Variants, Goal/metronome behavior and a mock 40→60 set. Native build caches retained the old checkout path and were regenerated for debug/release; sandboxed system speech failed once, then passed in the full native rerun with macOS access. No test was disabled.
- **Installed/data:** `/Applications/Praelude.app` reports **10.0.5**. Database bytes and full logical graph are unchanged before/after install and fresh launch: integrity OK/FK0, 11 pieces / 352 blocks / 3,237 reps / 63 sessions / 12,233 events / zero open rows. Live SHA-256 `b285c5a0624769aeccc27a2543f9b414eb1b22750fa2c551e60f02cfee553cb4`; full logical SHA-256 `6e12110128ceb5fa8e2e2d55fc8749237ac4cea6785f6645d680f41056861a74`.
- **Artifacts:** implementation `58b0413`; `releases/v10.0.5/Praelude-10.0.5.dmg`, **10,594,194 bytes**, SHA-256 `06e979cd7d390e6373bb8358f8a4099d58f32c75d3fb5b6e7444d7d64ee766f5`; ad-hoc CDHash `1d668dc99c9ea554e3454f133393915e268fe3dc`, not notarized. Backup `/Users/c3/Library/Application Support/com.christian.codakiller/backups/(C) pre-v10.0.5-install-2026-09-07-214212.db`, SHA-256 `539c600e35f838a44812a40792a4187fef6e9284e6b92ca2bbc6c30dca8a5946`; rollback `/Users/c3/Library/CodaKiller-rollbacks/Praelude-v10.0.4-rollback-2026-09-07-214212.app.tar.gz`, SHA-256 `4760b222f22e53156fd6a3e2430556350e5ac4664b88119654e207b7bec72466`. Tag `v10.0.5` records the final release-doc boundary.
- **Honest native limit / next:** native Score remains at “Finding score editions…” because macOS renewed Desktop-folder access; TCC logs explicitly show the prompt and the process sample waits in `read_dir`. The computer-use tool blocks the OS permission app. Christian must click Allow, then native Score/bar visual verification can finish. Browser QA is not relabeled native acceptance. Speech Recognition also requested renewed permission. No real practice rows were created by QA.
- **Touched:** BlockForm + tests, ScoreView TSX/CSS, version manifests, NOTES, `docs/qa/v10.0.5/`, and living vault docs. Windows candidate is unchanged.

---

### 2026-09-04 · Praelude project-wide rename — COMPLETE

- **Changed:** the local Git repository is now `~/praelude`, the private GitHub repository is `cchow375/praelude`, and the current vault/project documents use Praelude as their canonical name. Historical CodaKiller release records and artifact filenames remain factual historical evidence.
- **Compatibility note:** `com.christian.codakiller`, `codakiller.db`, the existing Keychain service and durable storage keys intentionally remain as documented legacy contracts. They preserve the installed history, permissions and upgrades; Praelude is every live user-facing/project-facing name.

---

### 2026-09-04 · Praelude v10.0.4 selected-passage strip repair — SHIPPED + INSTALLED

- **Changed:** The selected-passage strip now has explicit, non-competing slots for passage identity, **Passage tools**, Practice set / Start set, tempo summary, Variants and Settings. Its active-set message takes a dedicated second line instead of pressing into controls. Only a genuinely narrow window reflows the strip, with named layout areas and wrapping rather than overlap.
- **Why:** Christian’s 2,648×390 screenshot exposed that a short-height rule was treating a wide desktop as a mobile layout, causing the buttons to stack over Practice set.
- **Verified and installed:** rendered browser QA at **2,048×390** and **2,648×390** confirmed no overlap or clipping; fresh-context structural review passed. Focused ScoreView **81/81**, TypeScript, production build, full frontend **2,541 passed / 1 skipped**, native **1,083 passed / 17 ignored**, strict Clippy, share-clean, signature, one-copy and DMG gates passed. `/Applications/Praelude.app` is freshly launched as v10.0.4. Post-install DB: integrity OK/FK0, **11 pieces / 300 blocks / 2,686 reps / 57 sessions / 0 open sessions / 0 open blocks**.
- **Artifacts:** implementation `48e7d00`, final notes/tag commit `bdbbcb5` (`v10.0.4`); DMG `releases/v10.0.4/Praelude-10.0.4.dmg`, **10,595,489 bytes**, SHA-256 `57704093cff103e82b9b357149baedb2622b53da390a5e5460c498eefa65b148`; ad-hoc local seal, not notarized. Exact unchanged post-install DB backup `(C) post-v10.0.4-install-2026-09-04-191500.db`, SHA-256 `bfe80b479f78b7de81fe6243a3557bcfce5a6324479ba410c9dc7549d1493396`; v10.0.3 rollback `~/Library/CodaKiller-rollbacks/Praelude-v10.0.3-rollback-2026-09-04-191500.app.tar.gz`, SHA-256 `ffa6ec782e5b1fdd8714c09104b204c1528e9ef1620843d2335916dc04442c1a`.

---

### 2026-09-04 · Praelude v10.0.3 passage-tools redesign — SHIPPED + INSTALLED

- **Changed:** Tricky Sections is once again only a compact score map: search, add and passage rows. Selecting one never expands the old Edit / Score marks / Tutorial inspector in the rail. The selected-passage top strip now has **Passage tools**, which opens a focused, centered surface for those three jobs. Score-mark drawing deliberately closes that surface and keeps tool, review, undo, save and cancel controls in the top strip, so the PDF remains reachable; **Review** returns to the focused mark editor.
- **Why:** Christian’s screenshots showed that moving the practice composer had not solved the real problem: the old inspector still grew through the entire sidebar and looked dated. The rail now only helps find a passage; editing happens as a deliberate, modern top-level action.
- **Verified and installed:** fresh-context review found and then re-verified the mark-drawing modal deadlock; focused ScoreView **81/81** plus layout/dialog **11/11**, TypeScript and production build passed. Full frontend **2,541 passed / 1 skipped**; native **1,083 passed / 17 ignored** plus integrations, strict Clippy, share-clean, signature, one-copy and DMG gates passed. `/Applications/Praelude.app` is v10.0.3 and freshly launched. Post-install DB: integrity OK/FK0, **11 pieces / 300 blocks / 2,686 reps / 57 sessions / 10,521 events / 0 open sessions / 0 open blocks**.
- **Artifacts:** package implementation `2d697ca`, final lockfile/tag commit `c44bb1c` (`v10.0.3`); DMG `releases/v10.0.3/Praelude-10.0.3.dmg`, **10,589,691 bytes**, SHA-256 `f0ab2ceb3485d2d9320724ecbbd4f78bdf1cb7ddf83cf85c53d118dab5943626`; ad-hoc local seal, not notarized. Pre-install backup `(C) pre-v10.0.3-install-2026-09-04-174412.db`, SHA-256 `bfe80b479f78b7de81fe6243a3557bcfce5a6324479ba410c9dc7549d1493396`; rollback `~/Library/CodaKiller-rollbacks/Praelude-v10.0.2-rollback-2026-09-04-174412.app.tar.gz`, SHA-256 `e7df05d748f772939acb1db6027dd0902277f6e57209e2339cd3150d1ea5ef82`.

---

### 2026-09-04 · Praelude v10.0.2 selected-passage layout correction — SHIPPED + INSTALLED

- **Changed:** The selected-passage practice component is now a horizontal working strip across the top of Score. It replaces the normal Score toolbar while selected, never floats over the PDF or Tricky Sections, and restores the normal toolbar when closed. The Tricky Sections rail is slightly wider and remains independently usable. Compact windows preserve the top strip rather than reverting to a bottom sheet.
- **Why:** Christian’s screenshot showed the earlier panel obscuring both the music and the section map. The passage component now uses the toolbar’s place instead of competing with the workspace.
- **Verified and installed:** fresh-context review passed; focused ScoreView **81/81**, TypeScript and production build passed; full frontend **2,541 passed / 1 skipped**; native **1,083 passed / 17 ignored** plus integrations, strict Clippy, share-clean, signature, one-copy and DMG gates passed. `/Applications/Praelude.app` is v10.0.2. Post-install DB: integrity OK/FK0, **11 pieces / 300 blocks / 2,686 reps / 57 sessions / 10,521 events / 0 open sessions / 0 open blocks**.
- **Artifacts:** package implementation `438d274`; final lockfile/tag commit `f60b958` (`v10.0.2`); DMG `releases/v10.0.2/Praelude-10.0.2.dmg`, **10,589,574 bytes**, SHA-256 `07d76ffcee85fbeb21ceaf5d726e85b67a91da7bdff1d68b3c69b089f38e33c0`; ad-hoc local seal, not notarized. Pre-install backup `(C) pre-v10.0.2-install-2026-09-04-164334.db`; rollback `~/Library/CodaKiller-rollbacks/Praelude-v10.0.1-rollback-2026-09-04-164334.app.tar.gz`.

---

### 2026-09-03 · Praelude v10.0.1 feedback + Score correction — SHIPPED + INSTALLED

- **Changed:** Installed the earned feedback hierarchy: Clean gets a bright local spark and button bloom; Sloppy/Again get quiet confirmations; earned completions, variant-chain advances and mastery get progressively fuller offline sounds and pointer-through flourishes. Pausing or closing an unfinished set stays quiet. Score now opens at a 100% minimum, centers the page, keeps **Tricky Sections** open, and uses the main-rail arrow to collapse global navigation into icons.
- **Verified and installed:** frontend **2,541 passed / 1 skipped**; native **1,083 passed / 17 ignored** plus integrations, TypeScript, production/native builds, strict Clippy, share-clean, signature, one-copy and DMG gates passed. `/Applications/Praelude.app` is v10.0.1. Post-install DB: integrity OK/FK0, **11 pieces / 300 blocks / 2,686 reps / 57 sessions / 10,521 events / 0 open sessions / 0 open blocks**.
- **Artifacts:** implementation `58c6637` plus gate-stability commit `d437bdd`; DMG `releases/v10.0.1/Praelude-10.0.1.dmg`, **10,591,235 bytes**, SHA-256 `04e8ef7a2ab69a583725c55c0e326bd1fcbe2594ec51ff00896745104e50debb`; ad-hoc local seal, not notarized. Pre-install backup `(C) pre-v10.0.1-install-2026-09-03-183437.db`, SHA-256 `bfe80b479f78b7de81fe6243a3557bcfce5a6324479ba410c9dc7549d1493396`; rollback `~/Library/CodaKiller-rollbacks/Praelude-v10.0.0-rollback-2026-09-03-183437.app.tar.gz`, SHA-256 `0205b8cb6ee3d61b3ccf3cafa27465100b74c6486615314c3a8e0f3ae832d6e1`.

---

### 2026-09-03 · Rep-feedback + Score-reading correction — UNPACKAGED SOURCE

- **Changed:** Every committed rep now gets a local, offline feedback sound: a bright Clean spark and quieter honest Sloppy/Again acknowledgements. A completed set gets a fuller rising fanfare, a variant-chain stage gets a three-note arc, and mastery gets the largest landing. Clean also triggers a brief button bloom; set and chain moments now have layered, pointer-through geometric celebrations. Audio is best-effort and can never delay or confirm a practice write.
- **Score:** Default page fit is now never below 100% (no more viewport-derived ~82% opening). The page is centered in its available reading pane. **Tricky Sections** stays open through selection, drawing and piece changes. The separate Praelude navigation rail now has a top arrow that collapses the Today/Score/Warmups/Pieces/Universe labels to an accessible icon strip, reclaiming score width.
- **Why:** Christian asked for substantially more gratifying earned feedback and for the Score to feel centered, 100%-scale and score-first with the *global* navigation—rather than the score map—being dismissible.
- **Verified:** 173 focused rep-feedback/Score/Shell tests passed; TypeScript and production build passed. The existing jsdom canvas warnings are test-environment limitations, not failures.
- **Touched:** `completionSound.ts`, completion/Rep HUD, ScoreView, Shell, focused Score tests, `NOTES.md`, tutorial and living project docs. Implementation commit `d4f8782` (**Add gratifying practice feedback and center Score**). This is source only: `/Applications/Praelude.app` remains the installed v10.0.0 boundary until a separate package/install run.

---

### 2026-09-03 · v10.0.0 Praelude identity + dark interface — SHIPPED + INSTALLED

- **Changed:** The product is now **Praelude**. The visible app, `.app`, executable, package,
  window title, onboarding, settings, spoken online phrase, icon and future package names all use
  Praelude. New installs also use `praelude` as the default wake word.
- **Interface:** Replaced the paper/serif styling with a dark-by-default, neutral system: modern
  SF/system sans typography, compact navigation, restrained borders, larger essential actions,
  fewer competing labels and one subtle blue-white accent. Score remains page-first. Selecting a
  passage opens Practice set; Variants and secondary Settings stay in centered dialogs over a
  blurred backdrop. Settings sections now start collapsed.
- **Compatibility:** The hidden bundle id, application-support directory, database filename,
  Keychain service, durable storage keys and old exported history filenames intentionally retain
  `codakiller` identifiers. They are compatibility plumbing, not displayed branding; changing them
  would strand permissions or practice history. Historical release filenames remain accurate.
- **Verified and installed:** Frontend **2,541 passed / 1 skipped**; native **1,083 passed / 17
  ignored** plus integrations; TypeScript, production/native builds, format, strict Clippy,
  share-clean, signature, one-copy and DMG gates passed. Browser QA covered Today, Pieces, Score,
  passage/dialog flows, Settings and Universe at desktop and 720×520; it caught and closed two
  containment defects before ship. `/Applications/Praelude.app` launched as v10.0.0 and the old
  app copy is absent. Live data is byte-identical to the backup: schema 21, integrity OK/FK0,
  **11 pieces / 300 blocks / 2,686 reps / 57 sessions / 10,521 events / 0 open sessions / 0 open
  blocks**.
- **Artifacts:** implementation `e67b3c2`; release/docs commit and local lightweight tag
  `v10.0.0` at `2d034ba`; DMG `releases/v10.0.0/Praelude-10.0.0.dmg`,
  **10,585,575 bytes**, SHA-256
  `caa3fe2623c34710dcafbaa7d71cfcf6b13e7579f53c5ee89f9fab6a2c776e17`; strict ad-hoc CDHash
  `e86e4f86d5f08c4c186d66ac81362eb1ffd2d1cb` (not notarized). Backup
  `(C) pre-v10.0.0-install-2026-09-03-174305.db`, **28,487,680 bytes**, SHA-256
  `efec25efc39224dc075d8c4144c0b5a46d436914cb1d76968fc1354515574a24`; v9.1.3 rollback
  `~/Library/CodaKiller-rollbacks/CodaKiller-v9.1.3-rollback-2026-09-03-174305.app.tar.gz`,
  **9,915,447 bytes**, SHA-256
  `5f6f637ab6b9f261057872d9ce9eebb0aa85b3f0c92f628f350b53d787c2df83`.
- **Touched:** manifests, shell/tokens, core workspace styles, Score/modal containment, Settings,
  icon suite, release scripts, tests and all living docs. The existing Windows v9.1.0 candidate
  remains unchanged and awaits native acceptance; future Windows packages use Praelude branding.

---

### 2026-09-03 · v9.1.3 Mac focused-practice release — SHIPPED + INSTALLED

- **Changed:** The selected-passage window is now a short launchpad, not a scrollable form wall.
  **Variants** and **Settings** are separate, clean actions; each opens a centered, dismissible
  modal over a blurred score. The variant picker supports multiple quick toggles and now includes
  **Left hand only** and **Right hand only**.
- **Why:** Christian rejected the visible variant chain and dense selected-passage text as
  overwhelming. The priority was a calmer, button-led front end while keeping all controls
  available on demand.
- **Verified:** 2,541 frontend tests passed / 1 skipped; TypeScript, 1,083 native tests / 17
  ignored, integration tests, strict Clippy, clean package, signature, one-copy and DMG checksum
  gates passed. `/Applications/CodaKiller.app` freshly launched as 9.1.3. Post-install DB audit:
  integrity OK/FK0, 11 pieces / 300 blocks / 2,686 reps / 57 sessions / 10,520 events / 0 open
  sessions / 0 open blocks. Schema remains 20. DMG:
  `releases/v9.1.3/CodaKiller-9.1.3.dmg`, 10,759,990 bytes, SHA-256
  `5302408c183b6c2997a1d13f0e04e6c9b016bc9403bf399245837793b0abda2a`; strict ad-hoc CDHash
  `afb6e930ce08a5023c79ae13a6c83c31faf2139a` (not notarized). Pre-install DB backup:
  `(C) pre-v9.1.3-install-2026-09-03.db`, SHA-256
  `c195878305275d8e6d90e984c04398921b424aa234b5206a42903c999b2aa3c6`; v9.1.2 rollback:
  `~/Library/CodaKiller-rollbacks/CodaKiller-v9.1.2-rollback-2026-09-03.app.tar.gz`, SHA-256
  `82c60f6720369a127d9e9d7edddb36fc5a530bbc56b2d853e59f0cdbaefc8e90`.
- **Touched:** `BlockForm.tsx`, `BlockForm.test.tsx`, `ScoreView.tsx`, `forms.css`, release
  manifests and living docs. Windows v9.1.0 remains unchanged and pending native Windows
  acceptance.

---

### 2026-09-03 · v9.1.2 Mac practice-window sizing release — SHIPPED + INSTALLED

- **Changed:** The selected-passage Practice set is 460–560px wide at desktop sizes. Start set is
  a 46px target; the core measure/tempo controls are 44px; the header and close target are larger.
- **Why:** Christian requested that the dead space become useful and the essential actions become
  easier to hit.
- **Verified:** frontend tests, TypeScript, native Rust tests, strict Clippy, clean package,
  signature, one-copy and DMG checksum gates passed. `/Applications/CodaKiller.app` launched as
  9.1.2. Post-install DB audit: integrity OK/FK0, 11 pieces / 300 blocks / 2,686 reps / 57
  sessions / 10,520 events / 0 open sessions / 0 open blocks. Schema remains 20. DMG:
  `releases/v9.1.2/CodaKiller-9.1.2.dmg`, 10,749,989 bytes, SHA-256
  `c9f4da7ac0119b3221df6d04f90b9a5dbde87467f9039961adf6e3fe127379ef`; strict ad-hoc CDHash
  `9747dfdaedbcf89871dc99c106f5ceb3ba60de50` (not notarized). Pre-install DB backup:
  `(C) pre-v9.1.2-install-2026-09-03.db`, SHA-256
  `c195878305275d8e6d90e984c04398921b424aa234b5206a42903c999b2aa3c6`; v9.1.1 rollback:
  `~/Library/CodaKiller-rollbacks/CodaKiller-v9.1.1-rollback-2026-09-03.app.tar.gz`, SHA-256
  `cdc9c1a45fb48ac4316c0209396a1e292d5c896850674e35d01cf706c2340ff5`.
- **Touched:** `ScoreView.css`, release version manifests and living docs. Windows v9.1.0 remains
  unchanged and pending native Windows acceptance.

---

### 2026-09-03 · Score practice-window sizing pass — UNPACKAGED SOURCE

- **Changed:** The selected-passage Practice set is now a deliberately wide 460–560px working surface instead of a narrow card. Its heading, close target, Start set button and core measure/tempo controls are larger; the score remains the visible background and advanced detail stays compact.
- **Why:** Christian’s 11:17 screenshot showed a thin panel with too much empty space beneath it and essential practice actions too small.
- **Verified:** local wide-screen Score preview renders the selected panel at 460px wide with a 46px Start set control and 44px core inputs; TypeScript and production build pass.
- **Touched:** `ScoreView.css`. This is source only: the installed v9.1.1 application is unchanged.

---

### 2026-09-03 · v9.1.1 Mac Score clarity release — SHIPPED + INSTALLED

- **Changed:** The installed Mac Score is page-first: one sheet at a time with page arrows and keyboard paging. Two-page view remains deliberate. Tricky Sections start closed; selecting a passage opens a dismissible floating Practice set above the score, becoming a contained bottom sheet when space is tight. The passage panel keeps the honest concise status “N plays complete” for a completed Total plays contract.
- **Why:** Christian rejected the continuous reader and permanently visible composer as cluttered.
- **Verified:** 2,540 frontend tests passed / 1 skipped; TypeScript, native Rust tests and strict Clippy passed; package share-clean, signature, DMG checksum and one-copy gates passed. The app at `/Applications/CodaKiller.app` launched as 9.1.1. Post-install DB audit: integrity OK/FK0, 11 pieces / 300 blocks / 2,686 reps / 57 sessions / 10,520 events / 0 open sessions / 0 open blocks. Schema remains 20. DMG: `releases/v9.1.1/CodaKiller-9.1.1.dmg`, 10,749,464 bytes, SHA-256 `7249a60040b2160bf8cf273220a77dce6eb9efeb25a6c53c8623a023e077caf3`; strict ad-hoc CDHash `6eca2270f4025821cbc535a94319a4355617847c` (not notarized). Pre-install DB backup: `(C) pre-v9.1.1-install-2026-09-03.db`, SHA-256 `77098c1c44db1d9593a3c5eda0929d3e37da689c1c10fd3f69e7fc321a91b24b`; v8.2.1 rollback: `~/Library/CodaKiller-rollbacks/CodaKiller-v8.2.1-rollback-2026-09-03.app.tar.gz`, SHA-256 `e99d6c8f14b389c4d01a2029df417449c36365d36b14045e0ec1566a0ce6dc35`.
- **Touched:** `ScoreView.tsx`, `ScoreView.test.tsx`, release version manifests and living docs. The exact Windows v9.1.0 EXE is unchanged and still awaits native Windows acceptance.

---

### 2026-09-02 · Score clarity correction — UNPACKAGED SOURCE

- **Changed:** Score now reads one page at a time by default (with the existing arrows and keyboard
  paging); the deliberate two-page tool remains. The permanent Practice composer is gone from the
  Tricky Sections rail. That rail starts closed, and selecting a passage opens a closeable floating
  practice window over the score (a contained bottom sheet on tight screens).
- **Why:** Christian's score screenshot feedback: continuous scrolling plus a permanent form wall
  felt crowded and ugly rather than score-first.
- **Touched / verified:** `ScoreView.tsx`, `ScoreView.css`, `NOTES.md`; TypeScript, focused
  ScoreView tests and devMock passage/page inspection pass. This is **unshipped source only**:
  no schema/data change and no change to the exact v9.1 Windows installer or its pending native
  acceptance boundary.

---

### 2026-08-31 · v9.1.0 Windows x64 sendable build — PACKAGED CANDIDATE / NATIVE ACCEPTANCE PENDING

> **CURRENT TRUTH:** **v9.1.0 / schema 21 is now a packaged, sendable Windows x64 candidate; it
> is not installed or accepted on a real Windows 10/11 system.** The exact current-user NSIS
> installer is `/Users/c3/codakiller/releases/v9.1.0/windows/CodaKiller-9.1.0-Windows-x64-Setup.exe`,
> **7,654,002 bytes**, SHA-256
> `e2e2f3ae8846ef7aca6a6c04b2e1a2f346e97640f5d9089e6e49012365dc5dd4`, packaged at
> `2026-08-31T19:31:59Z`. It is unsigned. The installed Mac app remains **v8.2.1 / schema 20**;
> no installed app or live data was changed. The Mac v9.0.0 candidate is unchanged.

Christian asked for a `.exe` that a pianist friend can run on Windows 10 or 11. This is the same
generic, blank, share-clean Pieces Library—not a friend-specific fork and not a copy of
Christian's data. Source/package implementation commit
`2d33004888a97c3ebcb4b7799bf54029efd15626` produced one x64 per-user NSIS installer through
Tauri's documented macOS cross-build path. Release/docs commit
`f296f3cb38ae5d29c1ae813493f5c37ea07ed9a6` is the exact target of lightweight tag `v9.1.0`;
private `origin/main` and the tag were both pushed successfully and currently resolve to
`f296f3c`. Those are source/package publication facts, not native Windows acceptance.

#### Packaged boundary

- **Core practice scope:** Pieces Library, local PDFs, nested folders,
  Active/Completed/Archived and context actions, Score, keyboard/mouse practice,
  metronome/chimes, History, Calendar and local persistence are included.
- **Honest audio boundary:** hands-free voice, Listen Back, system TTS and automatic system-volume
  boost are unavailable on Windows. The Mac-only `hear` executable is not bundled. The Assistant
  remains off.
- **Package identity:** the embedded application is **PE32+ x86-64**. NSIS installs for the current
  user, and WebView2 is downloaded only when the machine does not already have it.
- **Privacy boundary:** the recursive share-clean inspection passes. The package contains no
  personal files, database, scores, library/history, personal or unremapped host paths, or
  copyrighted pedagogy payload; intentional `/build-user` remapped build paths remain. Inert
  historical migration metadata/identifiers and the existing bundle identifier remain to support
  compatible upgrades, but Windows upgrade/data preservation has not been exercised.
- **Signing boundary:** no Windows signing certificate exists, so the installer is unsigned and
  SmartScreen friction is expected. Exact Authenticode/SmartScreen behavior is still unmeasured
  on Windows; self-signing is not represented as trust.

#### Verified evidence

- Frontend: **205 files passed / 1 skipped; 2,540 tests passed / 1 skipped**, plus TypeScript and
  production build.
- Mac-native regression suite: **1,111 passed / 19 ignored / 0 failed**; Mac strict Clippy and
  format pass.
- Windows cross-target: `cargo-xwin check` and strict Clippy pass, and the NSIS package builds.
  **Windows-native cargo tests were not run.**
- Recursive blank/share-clean artifact audit passes; the packaged application is PE32+ x64 and
  the exact installer hash above verifies.
- The first attempt exposed a packaging-only locale defect: an ASCII `C` locale made Unicode
  NSIS crash with a misleading `bad_alloc`; using `C.UTF-8` fixed it.
- The GitHub Windows workflow was removed because the available GitHub token lacks `workflow`
  scope. The local Tauri macOS cross-build is the canonical package path instead of bypassing that
  permission boundary.

**Files/modules:** Windows platform/runtime and score URL adapters; voice/Listen Back/Settings
availability; native platform, STT, Pieces, reference, page-cache, store and system-volume paths;
CPAL 0.18.2 dependency alignment; Windows Tauri configuration and recursive share-clean scanner;
repo release/QA/plan notes; vault Changelog, portable summary, Roadmap, Command Center,
installed-app tutorial preview, Flaws, Motivation, entry point and draft
`versions/(C) v9.1.0 — Version Record.md`.

#### Next steps

1. Run this exact EXE on clean Windows 10 and Windows 11 systems. Record install/relaunch,
   SmartScreen/Authenticode, blank first launch, native picker/PDF/Score, practice/audio,
   persistence and uninstall/reinstall.
2. Keep the record draft and every native-recipient claim pending until that evidence exists;
   cross-compilation and package inspection are not native acceptance.
3. Keep voice, Listen Back, system TTS and volume boost unavailable until a separately designed
   Windows-native audio implementation is built and tested.

### 2026-08-30 · v9.0.0 Pieces Library + share-clean build — PACKAGED SHAREABLE CANDIDATE / NOT INSTALLED

> **CURRENT TRUTH:** **v9.0.0 / schema 21 is a verified packaged shareable candidate; it is not
> installed and clean-recipient acceptance is pending.** `/Applications/CodaKiller.app` remains
> the published **v8.2.1 / schema 20** build. Source, build, clean-store, migration-copy, visual,
> identity and share-clean package gates pass. The notice-complete final artifact is verified at
> 10,736,628 bytes, SHA-256 `e5f3c2265cd962791a8267fee6a4e4e0c42a9a70775bbcc5729623a7aa443f06`.
> Installation was
> intentionally stopped because the 2026-08-30 19:25 EDT live read-only audit found one open
> session and one open block. Package implementation commit
> `709542023b3e3bf0c9e72189d145e5fd524eaacd` is the packaged implementation commit. Release/docs
> commit `6a560eeae328e7cb44019058c319f0617aa5372e` is the exact target of lightweight tag `v9.0.0`
> and private `origin/main`; both pushes succeeded. Those are package-boundary identities, not
> proof of install or recipient acceptance.

Christian's voice feedback reversed two earlier product decisions. The repertoire itself now
needs to be the obvious primary surface, and adding ordinary sheet music must not require the old
IMSLP-first search/edition/download/import sequence. The same feedback also asked for one blank,
sendable app with no preloaded copyrighted pedagogy—not a personal “friend fork.”

#### Integrated candidate behavior

- **One generic build.** There is no Christian build and friend build. A first-ever install gets
  an empty library and an app-owned `Pieces` directory. An upgrade keeps the configured Pieces
  path; when an older database has no saved path, the app conservatively infers the common parent
  of its existing piece folders. Existing piece rows, PDFs and practice history are preserved.
- **Pieces is primary.** The top-level repertoire workspace opens to **Pieces Library**, with the
  nearby switch ordered **Library | History | Calendar**. History remains fully reachable but no
  longer defines the workspace.
- **User-managed organization.** Pieces may remain **Unfiled** or move into arbitrarily nested
  logical folders/subfolders. Folder operations never move score files. Deleting a logical folder
  promotes its direct children and pieces one level instead of deleting content.
- **Clear library state.** The Library has **Active / Completed / Archived** views. Right-click or
  the visible ellipsis opens actions to move, mark complete/return active, archive/restore and
  remove. Archive is reversible metadata. Remove moves an app-owned piece folder to the app's
  `.trash` and retains the database row/history; it is not a hard delete.
- **Direct PDF first.** **Add Piece** asks for title, optional composer/folder and a local PDF.
  Choose or drag the file; the app validates and copies it into the configured Pieces root while
  leaving the source file in place. IMSLP is now only an optional external public-domain link:
  download there in the browser, return, and choose the PDF.
- **Share-clean payload.** User-facing Quotes/Reader/Books/passage-helper/method-card content and
  the embedded book/method payload are removed from the distributable. Independent review, the
  production `.app` scan and the mounted final-DMG scan pass: no DB/SQLite/sidecar, PDF,
  MusicXML/MXL, book/quote/method, devMock or personal path/name payload was found. The scan also
  detects disguised SQLite files by magic bytes.
- **Non-destructive scope.** This does **not** delete Christian's external `Knowledge and
  Resources` source folder, and it does not rewrite or purge historical `brain_turn` rows that may
  contain old citations/excerpts. Those are outside the distributable and require a separate,
  explicit data-destruction decision if ever removed.
- **Distribution boundary.** The candidate targets Apple-silicon Macs on macOS 13 or later. It is
  ad-hoc signed and not Apple-notarized, so a recipient must Control-click **Open** (and may need
  Privacy & Security → **Open Anyway**) on first launch. Intel, Windows, automatic updates and a
  no-warning public distribution are not claimed.

#### Verified package-only evidence

- **Automated gates:** frontend **204 files passed / 1 skipped; 2,525 tests passed / 1 skipped**.
  TypeScript and production build pass. Native library **1,077 passed / 17 ignored / 0 failed**,
  the integration suites pass, and all five narrated corpora pass with zero failures. Rust format,
  strict Clippy and the native app build pass.
- **Fresh store twice:** the real on-disk initialization reaches schema 21, integrity OK/FK0,
  blank active/all Library and folders, and zero repertoire/blocks/reps/sessions/events/Brain
  turns. Only hidden Warm-ups and the generic protocol with `source_refs_json='[]'` exist; disk
  holds only the DB and empty `Pieces/`, with no Knowledge setting/directory. Reopen is idempotent.
- **Exact disposable migration:** before, schema 20 integrity OK/FK0 with **11 pieces / 255 blocks /
  2,315 reps / 51 sessions / 9,173 events**, SHA-256
  `8bd284b80f1e675966a88f6ac5feb7585226ca2f8c09b9e8d33145a3f714dab8`. After schema 21,
  integrity remains OK/FK0 and every count is exact; new folder rows, assignments and completed
  pieces are all zero. Migrated SHA-256:
  `35860ff9d2e9912ef7bd100a6dbb6795408b24cbd5c5a4175bd2a684043ef41b`.
- **720×520 browser/devMock:** Pieces/Library default, History/Calendar, direct-PDF form, nested
  folders, context actions, lifecycle/remove and blank state pass with no horizontal overflow.
  One clipped folder-actions menu was found, fixed and retested **4/4**. This is browser evidence,
  not native picker/drop/persistence; a Today→Calendar automation click timed out, while exact
  deep-link behavior remains test-covered.
- **Exact final artifact:**
  `/Users/c3/codakiller/releases/v9.0.0/CodaKiller-9.0.0.dmg`, **10,736,628 bytes**, SHA-256
  `e5f3c2265cd962791a8267fee6a4e4e0c42a9a70775bbcc5729623a7aa443f06`; its basename-only
  checksum sidecar is 87 bytes. `hdiutil verify`, strict mounted codesign and the mounted scan
  pass. Top level is exactly the Applications symlink,
  `CodaKiller.app`, `START HERE.txt`, and `Third-Party Notices.txt`. The mounted app is v9.0.0,
  bundle `com.christian.codakiller`, arm64, minimum macOS 13, strict codesign PASS, ad-hoc CDHash
  `33ffc5fade7ecb090c5fd7b08818ae82164cbc21`; it is not Developer-ID signed or notarized.
  `scripts/package-macos.sh` / `npm run package:mac` package only and never touch `/Applications`.
  Full `hear` BSD, React/Tauri MIT and PDF.js Apache notices are top-level and byte-identical
  inside the app; the scanner asserts them. The pre-fix DMG was deleted, and only this corrected
  final remains.

#### Installation intentionally deferred

The **2026-08-30 19:25 EDT** live read-only audit remains schema 20, integrity OK/FK0, with **11
pieces / 255 blocks / 2,327 reps / 51 sessions / 9,241 events / 1 open session / 1 open block**.
Therefore the installing release script was deliberately not run and the installed v8.2.1 app and
live data were untouched. No fresh pre-install backup, v8.2.1 rollback, one-copy audit, installed
before/after migration or installed-native launch is claimed. Clean-recipient Gatekeeper and
first-piece acceptance also remain pending.

**Files/modules:** source implementation across `src/features/pieces/`,
`src/features/ledger/LedgerCalendarWorkspace*`, Shell/Today/Settings/Assistant cleanup,
`src-tauri/src/{pieces,lib,settings,store/*,brain/*}`, schema 21 migration, version manifests,
share-clean/release/package scripts and distributable notices; repo `README.md`, `AGENTS.md`, `CLAUDE.md`,
`NOTES.md`, v9 plan and `docs/qa/v9.0.0/README.md`; vault Changelog, portable summary, Roadmap,
Command Center, installed-app tutorial preview, Flaws, Motivation, entry point and draft
`versions/(C) v9.0.0 — Version Record.md`.

#### Next steps

1. Christian closes or deliberately preserves the open session/block in installed v8.2.1; repeat
   the live read-only zero-open audit, then take a fresh DB backup and v8.2.1 rollback archive.
2. Install only after that safety gate; record exact before/after data, one-copy audit, fresh native
   launch and native Pieces/file-picker/persistence behavior.
3. Test the exact DMG's Gatekeeper and first-piece path on a clean Apple-silicon macOS 13+ Mac;
   only after safe install plus recipient acceptance finalize the draft version record and call
   v9 installed/accepted.

### 2026-08-28 · v8.2.1 compact composer + end-session crash correction — SHIPPED + INSTALLED + PUBLISHED

> **RELEASE TRUTH:** B94 commit `d1e7ac6d09528f22d8becb378f26c66d751ac297`; B95/runtime
> commit `496033e677919757ef1f2a78cee32d3abedb4805`; schema 20. Installed app short/build 8.2.1,
> bundle `com.christian.codakiller`, strict ad-hoc signature PASS, CDHash
> `f0460dcb3b62825ea29328a32489987364b19828`. Pushed lightweight tag `v8.2.1` points to
> `971a0d2dc7cf8f093527239e2394391dbbfec0a4`; private `origin/main` was pushed through that
> tagged release-doc commit and may advance through docs-only corrections.

Christian's first installed v8.2.0 screenshot showed that the “compact” Score composer still
expanded into a long stack of full-width fields. At the real narrow rail width, From/To,
Start/Target BPM and Focus/Metronome wrapped into six rows; Start sat after every optional control;
and the always-visible custom-variant field added another stop. The result required needless
scrolling before practice could begin. This is flaw **B94**.

v8.2.1 now keeps measure and BPM inputs in two-column pairs, puts Focus and
Metronome on one compact line, and keeps target mode/count together. **Start set** lives in a
pinned form header so it is immediately reachable. Variant presets remain one horizontal chip
line, while **+ Custom** reveals and focuses the custom text field only when asked. Tricky Sections
remains the sole vertical scroll owner; the form does not introduce a nested scrollbar. Practice
semantics and schema 20 are unchanged.

Installed v8.2.0 then exposed **B95**, a fatal privacy-manifest defect. Session 48 closed and its
data persisted, but the app terminated less than one second later. The ordinary **End session**
path mounted `DayPhotoCapture`, which immediately requested camera access; the packaged Info.plist
lacked `NSCameraUsageDescription`, so macOS TCC raised `SIGABRT` before JavaScript could recover.
Six retained crash reports from v7.0–v8.2 carry the same signature. The orphan `hear` PID left by
the abort was cleaned up.

v8.2.1 makes plain **End session** camera-free. Only a separately confirmed **End my
day** offers the optional photo card. Showing that card requests nothing; **Use camera** is the
explicit acquisition action; both synchronous camera failures and rejected requests fall back to
drop/choose-file mode. The source plist now declares camera use truthfully, and the release script
rejects built bundles missing camera, microphone or speech-recognition descriptions. This closes
the source defect and the installed bundle now carries the exact camera/mic/speech privacy strings.

Live browser verification at 720x520 found the paired rows intact, Start immediately visible,
custom entry correctly disclosed/focused, and no horizontal overflow. Final frontend is **2,684
passed / 1 skipped / 0 failed** (212 files passed / 1 skipped); native is **1,109 passed / 19
ignored / 0 failed**. TypeScript, strict Clippy, production + native builds, five narrated corpora
and all eight release gates pass. Focused crash-path regressions pass **67/67**.

The v8.2.1 pre-install backup is `(C) pre-v8.2.1-install-2026-08-28-132046.db`, 23,449,600 bytes,
SHA-256 `2c99dec1c3bc14f595e69c92a9415076299752d46930eea0fa3c9f5a793379c7`. Read-only
audit: schema 20, integrity OK/FK0, 11 pieces, 246 blocks/contracts, 2,207 reps, 48 sessions,
8,391 events and zero open sessions/blocks. Before/after install preserved those exact facts.
DMG `/Users/c3/codakiller/releases/v8.2.1/CodaKiller-8.2.1.dmg` is 10,907,287 bytes, SHA-256
`6ce58b77b32642c644df1c0b42d2c89ea745a75e28c7891a484190ad111c61dd`. Rollback
`/Users/c3/Library/CodaKiller-rollbacks/CodaKiller-v8.2.0-rollback.app.tar.gz` is 10,057,883
bytes, SHA-256 `da29be1e96c120f2c27994fc2d83c26a5c8bc9a40c08b2f87097b0e82a117b71`. Fresh
installed launch PID 46013 remained live with its owned `hear` child and no new crash report; the
latest stayed the old 13:09 v8.2.0 TCC report.

**Files/modules:** `src/features/rep/{BlockForm,BlockForm.test}.tsx`,
`src/features/score/{ScoreView.css,ScoreView.layout.test.ts}`, `src/ui/forms.css`; repo
`src/features/session/{SessionBar,SessionBar.test}.tsx`,
`src/features/ritual/{DayPhotoCapture,DayPhotoCapture.test}.tsx`, Shell/surface regression files,
`src-tauri/Info.plist`, `scripts/(C) release-macos.sh`, `NOTES.md`, README/
entry-point docs, v8.2 plan addendum and `docs/qa/v8.2.1/README.md`; vault Changelog, portable
summary, Roadmap, Command Center, tutorial, Flaws and entry points. The immutable v8.2.0 version
record was not changed.

#### Next steps

1. Repeat the 720x520 composer walk after Desktop access is deliberately handled; keep microphone/
   Steinway, authorized provider mapping and sustained motivation as separate evidence gates.

### 2026-08-27 · 🚢 v8.2.0 visual cleanse + Total plays — SHIPPED + INSTALLED

> **SHIP TRUTH:** source commit `afe65f3b176a1c5da81eca6d2f65bd721726ee40`; installed
> `/Applications/CodaKiller.app` version/build 8.2.0, schema 20. App identity/signature, DMG,
> one-copy audit, backup/rollback, fresh launch and live migration are verified. Pushed lightweight
> tag `v8.2.0` points to `5de8bf9e1e9bced09c3d5091acd4b42241edae28`; private `origin/main`
> contains later documentation-only corrections, and its exact current tip must be read from Git.
> The immutable tag and runtime source remain unchanged.

Christian rejected the remaining Score/practice UI on direct visual evidence: the score behaved
like one page pinned above a giant blank area, the practice-section rail did not feel like a
normal scrollable surface, the variant editor inflated each row and number field into enormous
boxes, and core controls still cost too much screen space and time. He also asked for a quiet
alternative to consecutive-clean mastery: play a passage a chosen number of times, with common
presets, without adding clutter. His governing correction was explicit: **friction is also time**.

#### Source-complete behavior

| Surface | What changed |
| --- | --- |
| **Score reader** | Replaced the single-page posture with one continuous virtualized document. Every scoped page keeps a size-correct lightweight slot; only the visible/nearby window mounts PDF canvases, capped at five. The dominant visible page updates the page field/Pencil page, direct jumps scroll to the exact slot, and **2-page view** is a continuous two-column overview. Blank Pencil canvases no longer mount on ordinary pages. |
| **Tricky Sections** | The score and rail now own independent bounded scrolling. Expanding a section auto-reveals its practice composer inside the rail, including at 720×520, rather than expanding invisibly below the fold or scrolling the whole window. |
| **Score chrome** | Edition/movement, page and zoom remain immediate. Fit width/Fit page/2-page view, drawing, Pencil and mapping move into one **Score tools** disclosure. The redundant large Score heading and excess workspace height are removed. |
| **Practice dock** | **Paused Sets** and **Rep Counter** stay direct. Clock, Dynamics and Rotation are grouped in one keyboard-accessible **Tools** menu; the bottom band stays one line at 720×520 and urgency remains visible. |
| **Variants** | Presets become one horizontally scrolling chip row. Each configured variant is one 32px inline row—index, name, consecutive-clean count, reorder and delete—rather than the previous ~157px row with ~80px numeric control. |
| **Set target** | Adds a roving-keyboard **Clean streak / Total plays** selector. Clean streak keeps 3/5/7/10/Custom and the existing mastery/ladder/variant rules. Total plays offers **5/10/15/25/Custom**, stays at one fixed tempo, hides target BPM/ladder/demotion/variants/review boundary, and counts every effective non-void Clean/Sloppy/Again; Undo removes one. |
| **Truth downstream** | Reaching Total plays is called **target complete**, not mastery. Score history, History/Ledger, day mastered-set counts, Universe mastery badges/metrics and completion animation all exclude `total_attempts`. Existing clean-streak and chain mastery behavior is unchanged. |

A final cold audit corrected a stale native test/comment that still described the old three-page
`<100 MB` memory contract. Runtime intentionally remains capped at five mounted canvases to avoid
blank/churn in tall two-column view: at the 8-MP RGBA fast-path cap, five × 32,000,000-byte pages
are a 160,000,000-byte (152.6 MiB) steady-state ceiling, excluding transient decode/blit scratch
and the deep-zoom PDF.js fallback. This
truth correction required no runtime rebuild and did not change the frozen source/artifact facts.

Schema 20 crash-atomically widens the saved contract basis to `total_attempts`. An exact
disposable copy of the pre-install live schema-19 database rehearsed to schema 20 with **11 pieces
(10 repertoire + hidden Warm-ups) / 242 blocks / 242 contracts / 2,184 reps / 47 sessions / 8,283
events / 0 open sessions / 0 open blocks** preserved; integrity OK and zero foreign-key
violations. At pre-install, live remained schema 19 and also had zero measure maps, movements,
warmup routines or replays. The later release gate migrated it to schema 20 with the same graph.

#### Verification so far

- Frontend **2,678 passed / 1 skipped / 0 failed** (212 files passed / 1 skipped); native **1,109
  passed / 19 ignored / 0 failed**.
- TypeScript, production build, format and strict Clippy clean; five narrated corpora remain
  zero-false-mutation gates.
- Fresh-context adversarial review caught and closed two candidate blockers before this boundary:
  total-play completion had initially leaked into downstream mastery language/metrics/effects, and
  the two target choices initially lacked true radio keyboard behavior. Both now have regressions.
- Five browser frames are accepted at 720×520 and 1462×919: continuous Score at both sizes,
  composer auto-reveal, compact variants and Total plays. Browser interaction ran mixed verdicts
  0→3/5, Undo →2/5, then →5/5 and the bounded auto-close. This is browser/devMock evidence, not
  packaged-native acceptance.
- All eight release gates PASS. TypeScript/build processed 282 modules cleanly (the existing
  >500k chunk warning remains a warning); cargo fmt and strict Clippy clean; five narrated corpora
  zero false mutations.
- Installed bundle: id `com.christian.codakiller`, plist short/build 8.2.0, strict ad-hoc signature
  PASS, CDHash `4f4a8e3947efc00e4845ee085564f2724ff378a6`; one-copy rule PASS.
- DMG `releases/v8.2.0/CodaKiller-8.2.0.dmg`: **10,903,545 bytes**, SHA-256
  `1139ad6ed3452b2c004db3f4e8c22849eacb27e72fcbb0ddc93638d6720998eb`.
- Pre-install DB backup: `(C) pre-v8.2.0-install-2026-08-27-230720.db` in the vault,
  **23,146,496 bytes**, SHA-256
  `e2ba204263a9413b073ea5cab3b8fc2192ea7dcb42fda90012a0c0d08b660d0e`. Outgoing v8.1 rollback:
  `~/Library/CodaKiller-rollbacks/CodaKiller-v8.1.0-rollback.app.tar.gz`, **10,041,913 bytes**, SHA-256
  `2960fd90cda9e24583a4661d7ad2672041e896f533d2b979c0cf3897291c751b`.
- Fresh installed launch migrated live schema 19→20 with exact counts preserved, integrity OK and
  FK0; zero sessions/contracts open and measure-map/movement/routine/replay tables still empty.
- Packaged launch was visually seen, but macOS presented a Desktop-folder access prompt and that
  sensitive permission was not granted. Browser Score/composer acceptance is complete; packaged-
  native Score visual/interaction acceptance behind the prompt is honestly not claimed.
- Pushed lightweight tag `v8.2.0` → `5de8bf9e1e9bced09c3d5091acd4b42241edae28`;
  private `origin/main` contains later documentation-only corrections, and its exact current tip
  must be read from Git.

**Files/modules:** `src/features/score/{ScoreWorkspace,ScoreView}.*`,
`src/features/rep/{BlockForm,RepHud,useRep}.*`, `src/features/dock/*`, `src/ui/forms.css`,
`src/shell/*`, History/Ledger/Universe/completion projections, `src/devMock/tauriDevMock.ts`,
`src-tauri/src/{store,rep,ledger,planner,protocol,sessions,universe,voice_loop}.rs`; repo README/
AGENTS/CLAUDE/NOTES/spec/plan/QA; this Changelog and every affected living vault doc;
[[versions/(C) v8.2.0 — Version Record]].

#### Next steps

1. Deliberately handle the Desktop-folder access choice, then run the installed-native 720×520
   Score/composer/Total-plays walkthrough.
2. Run real WKWebView microphone/Listen Back and voice-over-Steinway acceptance.
3. Apply one explicitly authorized provider/current-edition map.
4. Judge XP/levels/badges/cadence across sustained practice use.

### 2026-08-27 · v8.1 cold-start documentation handoff reconciled

Christian asked whether every roadmap and handoff document was fully updated so a fresh Claude
Code session would know what shipped. A cross-document audit found real current-state conflicts:
the portable summary still contained a “v7.2 is now installed / schema 16” section, the Roadmap's
standing acceptance item still called v6.0.0 current, old v3/v4/v6 acceptance checkboxes competed
with the v8.1 thread, several architecture paragraphs still described schema 14 and the retired
static/galaxy Universe, and repository status was described only as “through the post-tag
correction.”

Corrected the cold-start boundary everywhere: installed **v8.1.0 / schema 19**; runtime source
`1a1e38bb7a3757cf90ee6ea814e93d5971c595d6`; pushed tag `v8.1.0` at
`0a3d6a5d339955fd7e7318299eaa6c3063674415`; first pushed post-tag documentation baseline
`da71efb5509afa36beb073050719ac1094751b98`; pushed cold-start handoff
`d03a3d7b9820494b878336f7d18e5da94b821f68` is current on `origin/main`; gates **2,650 frontend /
1 skipped** and
**1,100 native / 19 ignored**, zero failures; matrix **22 delivered / 1 Aug 8 B5 external-only /
0 absent**. The roadmap and Command Center now say explicitly: do not rebuild P3–P6, Universe,
B88 or B89; next is packaged microphone/Listen Back/Steinway acceptance, one Christian-authorized
real-provider mapping, and sustained motivation use. Historical acceptance items remain recorded
but are consolidated into the current v8.1 thread. The similarly named Aug 8 ask B5 (mapping) and
flaw-register B5 (ASR homophones) are now disambiguated.

No app source, installed binary, database, artifact or release tag changed in this
documentation-only pass. Private `main` advanced only by the tracked cold-start documentation
commit `d03a3d7b9820494b878336f7d18e5da94b821f68`. Files touched: `AGENTS.md`, `CLAUDE.md`, [[Praelude]],
[[(C) Changelog]], [[(C) Roadmap]], [[(C) Praelude Command Center]], [[(C) How To Use]],
[[(C) Flaws]], and the factual repository line in [[(C) v8.1.0 — Version Record]], plus historical
banner/current-pointer maintenance in the motivation and v2 contract notes.

#### Next steps

1. Run the packaged v8.1 microphone/Listen Back/Steinway checklist and record verbatim failures.
2. Run a real provider mapping only with Christian's explicit whole-edition upload approval.
3. Judge the new motivation system after sustained practice, not from screenshots.

### 2026-08-27 · 🚢 v8.1.0 — complete Aug 8 practice overhaul SHIPPED + INSTALLED

> **SHIP TRUTH:** v8.1.0/schema 19 is installed at `/Applications/CodaKiller.app`. Final source
> HEAD is `1a1e38bb7a3757cf90ee6ea814e93d5971c595d6`, atop release commit
> `9a4aeba1e55d1b51d6c2c8a18da0ada48181b921`. The installed app, migration, signature, DMG and
> fresh launch are verified. Release tag `v8.1.0` points to
> `0a3d6a5d339955fd7e7318299eaa6c3063674415` and is pushed. First pushed post-tag docs baseline:
> `da71efb5509afa36beb073050719ac1094751b98`; pushed cold-start handoff
> `d03a3d7b9820494b878336f7d18e5da94b821f68` is current on `origin/main`. These docs-only commits
> do not change the tag/runtime payload.

**Installed-native QA:** the final installed Universe passed at 720×520 with live
Level 7 / 831 XP / 95% / 9 XP-to-Level-8 data, real record milestones, no horizontal overflow and
the active session safe while Rep Counter tucked into Tools
(`docs/qa/v8.1.0/universe-live-native-720x520.png`). Final installed Warmups also passed: no
overlay or clipping, Tools exposed **Restore Rep Counter**, and the active set stayed unchanged
(`warmups-live-native-720x520.png`).

The first correction (`2d9bc33`) was itself refuted natively: it used `window.innerWidth`, but
the default 90% WebView interface zoom makes the physical 720px outer window report about 800 CSS
pixels, so the compact branch did not fire. Corrective `a5853b3` then tried
`outerWidth/outerHeight`; installed QA refuted that WebView global too. The intermediate `0cc4…`
DMG and `73a7…` CDHash remain diagnostic history and are deliberately not release facts.

Installed QA refuted `outerWidth/outerHeight` too. Final corrective `1a1e38b` instead reads
Tauri's native physical inner size + scale factor, converts to logical points, listens to native
resize, suppresses stale async results/listener leaks after exit, and falls back to DOM bounds
only when native calls reject. The final rebuilt installed frame accepted that correction.

Christian asked to finish the entire list, called the existing Universe terrible, and said
progress still was not visually legible or gamified enough. The audit also corrected the list's
denominator: the IDs A1–A7 + B1–B5 + C1–C3 + D1–D2 + E1–E6 total **23**, not 21.

#### What shipped

| Area | Installed behavior |
| --- | --- |
| **P3 Voice** | Immediate verdict chimes; a persistent last-three final heard feed; live-set-only `mark done` / `rep done` / `mark sloppy` / `mark again` partial fast path; live 300–2000 ms settle control; counted voice add-Clean and append-only undo. Saved hotkey remaps reach the mounted HUD without reload. |
| **P4 Score Map** | Schema-17 PDF movement CRUD + Whole score/movement page/section scope. Measure mapping now teaches prerequisites/provider readiness, refuses Start without a configured provider and keeps writes behind review/Apply. No Anthropic key and zero live map rows remain honest external gaps. |
| **P5 Warmups** | A visual searchable/filterable catalog (keyboard figures + text), named/reordered routines with BPM/streak, and an exact rep-engine runner on one hidden Warm-ups system piece. At 720×520 the layout explicitly shrinks inside the effective 480px stage. Real focus counts; repertoire stays clean; routine completion celebrates once. |
| **P6 Listen Back** | Opt-in per-rep capture physically suspends native STT before opening WebView recording, prompts listen-before-verdict with explicit bypass, discards temporary bytes unless Keep is selected, and replays confined kept files with output gain. Pending/failure states firewall verdicts and prior user mute is preserved. |
| **P6 Rotation / pieces / target** | Prompt-only exact-block timed rotation with full-cycle completion; at 720×520 an unsafe restored/collision `y=360` clamps to `y=164`, preserving a 56px Tools reserve. Reversible archive/restore + recent-first active/archived groups; destructive removal separately called **Delete files…**; editable **Sound target** beside verdicts. Folders remain deliberately deferred by Christian's archive/recent-first decision. |
| **Universe + gamification** | The old decorative galaxy is removed. The new evidence dashboard gives 1 Practice XP per completed focused minute, deterministic levels, six earned badge tracks, exact next-badge rails, 28-day cadence, progress rails, active/archived repertoire and a technique aggregate. Quality/verdicts never award XP; archived/file-deleted history remains real. Universe tucks—not ends—the active Rep Counter so progress stays visible. |
| **B88 resolved** | Each set can inherit, disable or locally tune demotion; running Rep HUD has live subdivision −/+ (1–16). |
| **B89 resolved** | Each spot drag has a durable command identity and payload fingerprint. One bounded same-id retry replays the committed Region after a lost reply; conflicting reuse is rejected. |
| **Assistant cleanup** | Closed by the accepted product decision: Assistant remains OFF, hidden and Rust-gated. The off-state Settings guide now teaches only hands-free practice commands; provider-only copy and Books disappear, Voice owns settle timing, and the enable switch remains discoverable. Its held overhaul is not part of this train. |

#### Release and data evidence

A disposable SQLite `.backup` of the live schema-16 database rehearsed through schema 17
(movements/archive), 18 (warmups/system piece) and 19 (rep replay). Integrity stayed OK and the
historical relationship graph remained intact; the only designed new piece was hidden
`id=0 · Warm-ups · system`, while movement/routine/replay tables began empty. This rehearsal
was followed by the final pre-install backup, rollback archive and installed before/after checks.

Browser/devMock QA now records eight accepted frames: Universe at 720×520 and 1280×800,
repertoire shelf, empty teaching, Warmups, Listen Back, score movement and the final Rotation
posture. The Warmups and Rotation frames specifically drove the 480px shrink and
`y=164`/56px-reserve corrections above. The main mock uses Assistant OFF; focused Settings tests
pin its practice-only guide/hidden Books behavior. This evidence remains non-native.

**Safety and install facts:** pre-install schema 16 was integrity OK at
10 pieces / 230 blocks / 2,034 reps / 46 sessions / 7,873 session events / **1 open session** /
0 measure-map rows. Backup `(C) pre-v8.1.0-install-2026-08-27-123548.db` is 21,708,800 bytes,
SHA-256 `2d06307f35a42be5a1911cbc9fbbd1c48b356449a31180c7000c7c4636448ddb`.
The signed/identity-valid v7.2 rollback is
`~/Library/CodaKiller-rollbacks/CodaKiller-v7.2.0-rollback.app.tar.gz`, 9,901,602 bytes,
SHA-256 `e5ec3460e38a9637600e0bbbb6557c952fec6ee7743d7bd158ec4d2bc18513a1`.
The final installed app reports bundle id `com.christian.codakiller`, plist short/build 8.1.0,
strict signature PASS with an ad-hoc local seal (not Developer ID/not notarized), and CDHash
`8655e9a45d83b7bb56e83a9d14bb477da7da39a9`. DMG
`releases/v8.1.0/CodaKiller-8.1.0.dmg` is 10,892,054 bytes, SHA-256
`e828b861b31d771fde66cd66d48987eb66110f0fd455306a6a12c2f80eb0a271`; fresh installed launch
passed. Schema 16→19 reached integrity OK with zero FK violations. Pieces changed 10→11 solely
for hidden id0 Warm-ups; 230 blocks / 2,034 reps / 46 sessions / 7,873 events / 1 open session
were unchanged, and `measure_map` remained 0. The open session was intentionally preserved.

**Final automated gates:** frontend **2,650 passed / 1 skipped / 0 failed** (209 files passed / 1
skipped); native **1,100 passed / 19 ignored / 0 failed**; TypeScript, production Vite build,
strict Clippy, format, all five narrated corpora and all eight release-script gates passed.

#### Still open and honest

- Release tag `v8.1.0` is pushed at `0a3d6a5d339955fd7e7318299eaa6c3063674415`;
  first post-tag docs baseline is `da71efb5509afa36beb073050719ac1094751b98`; pushed cold-start
  handoff `d03a3d7b9820494b878336f7d18e5da94b821f68` is current on `origin/main`.
- Aug 8 ask B5 is delivered at its honest flow boundary, not real-use proven: no Anthropic key and live has zero
  measure-map rows.
- Eight accepted browser/devMock frames plus accepted installed-native Universe/Warmups frames
  cannot prove real WKWebView microphone ownership, Listen Back playback on the piano, or
  voice-over-Steinway behavior. C2 source is delivered; its hardware verdict remains external.
- Exact matrix: **22 delivered / 1 Aug 8 B5 external-only / 0 absent**.

#### Next steps

1. Obtain real WKWebView microphone/Listen Back and voice-over-Steinway acceptance.
2. Apply one mapping with a real provider/live score and judge sustained motivation in use.

**Code areas:** `src/features/{voice,rep,score,pieces,warmups,rotation,universe,settings}/…`,
`src/shell/Shell.tsx`, `src/devMock/tauriDevMock.ts`, and
`src-tauri/src/{intent,voice_loop,rep,settings,store,universe}.rs`. **Docs:** the approved Aug 8
spec and combined P3–P6 plan in the repo; this Changelog; [[Praelude]]; [[(C) Roadmap]];
[[(C) Praelude Command Center]]; [[(C) How To Use]]; [[(C) Flaws]]; `AGENTS.md`; `CLAUDE.md`;
and [[(C) v8.1.0 — Version Record]].

### 2026-08-27 · 🚢 v7.2.0 corrective release — SHIPPED + INSTALLED

> One corrective release atop v7.1.0, now installed at `/Applications/CodaKiller.app`.
> Schema remains **16**; there was no migration and therefore no migration rehearsal. The
> release is tagged `v7.2.0` at commit `7a5061d57fc6197b53e2601ca788f186d1fc7c83`.
> The tag is pushed to the private GitHub remote; `main` is pushed through the documentation-only
> finalization commit `768a151752be54272a81962b4489c968ba48d559`.

**Ship facts.** DMG `releases/v7.2.0/CodaKiller-7.2.0.dmg` (**10,739,055 bytes**), SHA-256
`532868f089241e64d134b2fb3b645f2ddf7db8df838d8706d3a39d7d5b7dc77f`. Pre-install database
backup `(C) pre-v7.2.0-install-2026-08-27-014755.db` (**21,663,744 bytes**), SHA-256
`dfafa80a6e58dd917b7a27e8692a8e55e3b81d1599399dcaada507c1e0a81820`. The v7.1 rollback
archive is **9,872,086 bytes**, SHA-256
`a63bbf1ef3f1a48e5e1c683bb0b0540fe98bc5a77fca05a96041d08a3c522f85`. Installed plist
identity is 7.2.0 with the correct bundle identifier, strict code-signature verification passed,
the DMG checksum verified, and a fresh installed-app process launched. The live database before
and after install/launch was identical: schema 16, integrity OK, **10 pieces / 228 blocks /
2,026 reps / 44 sessions / 0 open sessions**. All eight release gates passed.

#### Corrected

| Flaw / gap | What is now true in installed v7.2 |
| --- | --- |
| **B85 — micro-targets** | Select an anchored top-level section, click **Isolate a spot**, then drag one box fully inside one parent box. Pointer-up calls the dedicated atomic `score_micro_target_create` path: child Region, parent link, calm colour, inferred measures and edition/fingerprint anchor commit in one SQLite transaction. No name field, measure fields, dialog, or second mapping pass. It becomes `Spot N`, persists, offers an eight-second Undo, shows only with its parent/itself selected, and has a persisted **Hide spots** toggle. Old unlinked contained boxes are inferred only when measures + matching-edition geometry identify exactly one parent; this is a read-model compatibility rule, never a silent database rewrite. **Practice this** resumes the latest paused set for the spot or starts a contextual three-clean set; an already-active set produces an explanation and no mutation. |
| **B86 — chain completion** | A variant chain now governs mastery at every focus and with or without a target tempo. Each stage shows its own consecutive-clean progress; Flawed resets the current stage, Again neither advances nor resets it, and recorded attempt attribution follows that same current stage. Ordinary and chained mastered sets hold a visible six-second completion countdown, offer **Stay open**, then close through the existing path. One transient auto-close failure gets one bounded retry; no infinite re-arm. Recovery/correction/undo projections cannot bypass the chain or fabricate mastery. |
| **B87 — unwanted speech** | Spoken deterministic acknowledgements are now opt-in through **Speak confirmations aloud**, default **off**. The short acknowledgement chime remains. Changes apply immediately; voice input is unchanged, and the Assistant remains off/gated. |
| **v7.1 surface correction** | Settings now exposes global tempo-demotion enable/first/repeat controls with the native defaults/ranges. The set composer exposes beat-unit labels, beats per bar and subdivision in **Advanced**, and labels each variant's requirement as **Consecutive cleans**. Beat unit remains a label for the entered click rate, never a BPM conversion. A per-set demotion override and quick Rep-HUD subdivision control still do not exist. |
| **B3 overlay unification** | One memoized score overlay per page now owns persisted parent/spot Regions, mapping/create state and the atlas target draft through the same DOM/pointer path. Old pieces receive the shared styling without a migration. |
| **E3 low-data Universe** | With zero, one or two evidenced systems, the Universe teaches what real practice will earn; the teaching strip disappears at three. It grants no star, ring, orbit, streak or progress. |

#### Final verifier hardening

- Direct spot practice refreshes the block list and resumes only a paused set whose exact
  `region_id` matches the spot. Same-measure siblings cannot cross-resume. If another set is
  already running, the explanation is deliberately generic. **Practice this** disappears while
  target drawing, measure mapping, Pencil, spot drawing or an in-flight save owns the pointer.
- Recovery synchronously cancels auto-close before its IPC begins, and the timer rechecks live
  eligibility before closing. The intermediate-stage chime fires only for a genuine forward
  transition caused by a new Clean—including a one-clean opening stage—and never for undo, final
  mastery or extra Clean attempts.

#### Verification

- Frontend: **2,499 passed / 1 skipped / 0 failed**.
- Native: **1,049 passed / 19 ignored / 0 failed**.
- `tsc --noEmit`, the production build and strict Clippy clean.
- All five narrated voice corpora produced **zero false mutations**.
- The complete 720×520 browser-devMock workflow passed: isolate and persist a child spot,
  direct start/resume, chain advancement/final completion, speech-off setting, unified overlay and
  low-data Universe teaching. This is **browser/mock interaction QA, not native or at-piano
  interaction acceptance**.

#### Still open and honest

- No per-set demotion override; no quick subdivision control in the running Rep HUD.
- **B88:** those two omissions mean A1/A5 surface completion remains partial despite the global
  Settings and Composer ▸ Advanced controls now shipping.
- **B89:** spot creation is transactionally all-or-nothing but has no replay identity. The UI
  blocks normal same-tick duplication, but a committed request whose IPC reply is lost could be
  retried into a duplicate. No occurrence has been observed.
- Assistant stays switched off and its overhaul stays on hold.
- **B67** remains: no Anthropic key, so Claude vision has never run on real data. **B75** remains:
  the live `measure_map` table still has zero rows. **B78** and the other recorded dock/minor
  residuals remain.
- Although installation identity, signing, launch and database preservation were verified, the
  new interactions have not been accepted in the native app or at the Steinway. Christian's
  considered live verdict is still owed.

#### Next steps

1. Run native 720×520 and at-piano interaction acceptance on the exact B85/B86/B87 flows above.
2. Keep B67/B75/B78/B88/B89 open until evidence closes them; do not reopen B85 for B89's bounded
   replay edge.

**Code areas:** `src/features/{score,rep,settings,universe}/…`, `src/devMock/tauriDevMock.ts`,
`src-tauri/src/{rep,settings,store,voice_loop}.rs`. **Docs:** this entry, [[Praelude]],
[[(C) Roadmap]], [[(C) Praelude Command Center]], [[(C) How To Use]], [[(C) Flaws]],
`AGENTS.md`, `CLAUDE.md`, and [[versions/(C) v7.2.0 — Version Record]].

### 2026-08-26 · 🚢 v7.1.0 "Practice Set Core" — SHIPPED + INSTALLED (P1 of the Aug 8 train)

> P1 built the practice set itself: the ladder can now go **down**, variant chains run as
> streak-gated stages, the composer stops burying the controls that matter, and the verdict
> keys work with hands on the piano. **Christian's feedback after this release found real
> gaps — see the honest verdict at the end of this entry.**

**Ship facts.** Tag `v7.1.0`; DMG `releases/v7.1.0/CodaKiller-7.1.0.dmg` (10.7 MB) SHA
`f5c2c936…`; installed app verified **7.1.0**, signature verified, DMG checksum verified.
**Schema 15 → 16** (`rep_block.tuning_json`): rehearsed on a COPY of the live database via
`CODAKILLER_MIGRATION_COPY` before the install, then verified in place afterwards — counts
**identical before and after: 10 pieces / 208 blocks / 1,915 reps / 43 sessions**, and all
208 existing blocks defaulted to `{}` as designed. Pre-install backup
`(C) pre-v7.1.0-install-2026-08-26-165708.db` SHA `aba07f4d…`; the v7.0.1 rollback is
tarballed at `~/Library/CodaKiller-rollbacks/CodaKiller-v7.0.1-rollback.app.tar.gz`.
Gates: vitest **2383 passed / 1 skipped / 0 failed**, cargo **994 passed / 0 failed** with
`filtered out: 0`, clippy `--all-targets --all-features` clean, `tsc` clean, five narrated
corpus suites **zero false mutations**, **all eight release-script gates PASS**.

#### Built

| Task | What landed |
| --- | --- |
| **A1** | **Tempo demotion.** Three sloppy reps in a row pull the metronome back to the rung it came from; each subsequent run of two does it again. Counts **sloppy only** (his Q4 answer). Toggleable, with `rep.demote_enabled` / first / repeat thresholds in Settings. The HUD says *"Tempo pulled back to ♩N"* — the render was a second commit, because the engine half shipped invisible. |
| **A2** | **Variant chains.** A set can hold an ordered list of variants (dotted → reverse dotted → staccato …), each cleared by its own consecutive-clean requirement, resolved by pure replay of the verdict ledger exactly the way the ladder is. A flawed rep resets only the current stage, never earlier progress. |
| **A3** | **The composer stops burying things.** Practice focus, the variant chain and the clean-streak target are now always visible; only the tempo ladder, review boundary and one-pass estimate sit behind a bottom "Advanced" disclosure — his complaint was that the ladder was *"taking up WAY TOO MUCH FUCKING SPACE"* while variants, which matter far more, looked unimportant. |
| **A5** | **Per-set metronome tuning** (schema v16). Beat unit is a **label only, never a conversion** — `ClickPattern.bpm` carries no note-value semantics, so treating the label as a multiplier would silently mis-time every click. |
| **A6** | **Verdict hotkeys** — Space = clean, Right-Shift = sloppy, Return = again (his Q7 answer), scoped so they only fire when the practice surface owns focus. Hands stay on the keys. |
| **A7** | **± reps beside the count**, and the last **B80 devMock violation** closed. |
| **B56** | **Closed completely.** All 14 rep mutation paths and both retention paths now resolve the session under the lifecycle lock. The unsafe API is `#[cfg(test)]`, so **the compiler now enforces it** — a future caller cannot reintroduce the race by accident. |

#### The honest verdict

Christian tried the build and rejected part of it: **"the sub section selecgtion box is
terrible. you didnt listen to what i wanted."** He was right, and the diagnosis is recorded in
`docs/superpowers/plans/2026-08-26-p2-micro-targets-v2-and-set-completion.md` rather than
softened here. Creating a sub-section still cost six steps, two of them typing — and because
creation left the child with **no box**, he had to drag the same spot a second time. Two more
defects came with it: a chained set **declared mastery after its first variant** (the
chain-aware rule was gated behind "no target tempo", and he always sets one), so it froze at
5/5 and had to be closed by hand; and the app kept **talking** when he said "again".

All three are the content of the next release. The lesson is the same one B82 taught in P0 and
it is now a standing rule: *shipped, green and tested* is not *usable*, and only he can close
that gap.

---

### 2026-08-25 · 🚢 v7.0.1 "Stabilize & Reveal" — SHIPPED + INSTALLED (P0 of the approved Aug 8 train)

> Christian approved the Aug 8 overhaul spec rev 2 and asked for the whole release train built
> autonomously. P0 is the stabilize-and-reveal phase: fix what is broken, and make visible the
> things that were already built but that he could not find. His own verdict is the standard the
> phase was judged by — _"everything I'm asking for is because I don't see it."_

**Ship facts.** Tag `v7.0.1`; DMG `releases/v7.0.1/CodaKiller-7.0.1.dmg` (10 MB) SHA
`95d534bb…`; installed app verified 7.0.1, signature verified, DMG checksum verified.
**No schema change — `SCHEMA_VERSION` stays 15, so no migration ran and no rehearsal was
performed.** Live DB verified read-only after install: integrity ok, `user_version` 15, counts
**identical before and after — 10 pieces / 208 blocks / 1,915 reps / 43 sessions**. Pre-install
backup `(C) pre-v7.0.1-install-2026-08-25-162832.db` SHA `ee91bba3…`; the v7.0.0 rollback is
tarballed at `~/Library/CodaKiller-rollbacks/CodaKiller-v7.0.0-rollback.app.tar.gz`.
Gates: vitest **2322 passed / 1 skipped / 0 failed**, cargo **959 passed / 0 failed** with
`filtered out: 0`, clippy `--all-targets --all-features` clean, `tsc` clean, five narrated corpus
suites **zero false mutations**, **all eight release-script gates PASS**.

#### Fixed — things that were broken

| Flaw | What was wrong |
| --- | --- |
| **B82** (new, most serious) | At **720×520 — the app's own configured minimum window size** — the **Clean / Sloppy / Again buttons were not rendered at all.** The rep HUD seeded itself collapsed at ≤800×620, and the collapsed layout hid the verdict row. Measured 0×0; expanded they are 131×52 with **155 px of headroom**, so the collapse was not buying space it needed. The auto-collapse is gone; only the deliberate "Collapse set" toggle remains. |
| **B83** (new) | Two banned `window.confirm` survivors, both failing **silently** under the app's webview: one could **trap you in the measure-map dialog** with ×, Cancel and Escape all doing nothing once the review was dirty; the other made switching pieces do nothing at all. Both now use an inline two-step confirm. |
| **B56 / E5** | The end-session race. The "is a set live?" check now runs under the session lifecycle lock, so a concurrent open can no longer land a rep against the session being closed; an ended session can no longer be adopted. **Narrowed, NOT closed** — see below. |
| **B4** | The section editor's measure fields overflowed across the "Save section" button at small sizes. |
| **B77** | The measure-map dialog had no focus trap: Tab escaped it and reached the rep verdict buttons behind the scrim, where Enter recorded a real rep. |

#### Revealed — things that existed but could not be found

- **C3 — the mic mute button.** The mute backend has existed and been hardened since v6 with **no
  button anywhere in the app**. Now an always-visible labelled control in the left rail.
- **B1 — sub-sections.** Everything was built and tested, and the live database shows **no
  evidence of a single sub-section ever created**. Two reasons, both fixed: the
  select-then-drag-inside rule was stated nowhere in the app, **and the intuitive gesture did not
  actually work** — a drag starting inside a selected box was being swallowed before it reached
  the create handler. Now a hint names the gesture, the cursor changes inside a selected section,
  "+ Add" defaults to "Sub-section of <name>" with a checkbox to opt out, and the empty state
  teaches the starting gesture.
- **The §4b visibility pass.** The dock pill row is labelled "Tools"; the day-streak line teaches
  "Day 1 starts at N focused minutes" instead of rendering nothing; the disabled "Map measures"
  and "Map this score" buttons now say why they are disabled.

#### Added

- **D1 voice-latency instrument.** The heard pill shows the app-side time from the first words the
  Mac gave the app to the action being done. It **honestly excludes** how long the Mac itself took
  to hear you — the speech pipe carries no timestamps, so the app cannot see that, and the total
  still has to be hand-timed at the piano.
- **`npm run qa:shots`** — a 720×520 screenshot harness at the app's configured minimum window
  size. B82 was found with it within minutes. Shots and an honest QA record live in
  `~/praelude/docs/qa/v7.0.1/`.

#### Still open and honest

- **B56 is narrowed, not closed.** A smaller opener-side window remains (`rep/mod.rs:277-278`).
  Closing it needs a refactor of the hot path that has already produced three deadlock classes, so
  it gets its own design pass in v7.1.0 rather than an improvised patch fix.
- **B75** — measure mapping still holds **0 rows** on the live DB. B83's fix removed two ways that
  flow could silently fail, which may or may not have been the cause; nothing here proves it.
- **B67** — still no Anthropic key, so the Claude vision path has still never run. Christian
  confirmed today that he has not added one.
- **B78** — dock residuals; a concrete 720×520 reproduction was recorded this round.
- **Owed:** an at-piano acceptance verdict (for v7.0.0 and now v7.0.1), and the at-piano voice
  latency baseline — the instrument exists, the number needs him practising.
- **No streak zero-state screenshot exists** — the mock seeds a non-zero streak, so that state is
  pinned by unit tests only. Recorded so nobody assumes otherwise.

#### Process notes

- **Adversarial verification refuted work twice, including my own.** A fresh-context verifier
  refuted the first D1 fix with a concrete sequence (the engine keeps streaming partials after a
  fast-path fire, re-arming a start that the swallowed tail final then failed to clear — so a
  fabricated latency was charged to the *next* command). Another found that a drag anywhere on the
  page while a section was selected silently made a child of it, which would have made this
  release's own new hint untrue. Both fixed, with regression tests confirmed to fail against the
  unfixed code first.
- **A release gate that fails randomly is worse than no gate.** Gate 2 failed once on a day-sheet
  test that passes 5/5 in isolation — Testing Library's 1000 ms `waitFor` ceiling losing to an
  async round-trip while a production build ran alongside. Raised to 5000 ms; no assertion was
  weakened. Left alone, it teaches "re-run until green", which is how a real failure eventually
  gets waved through.

**Files:** `src-tauri/src/{voice_loop,rep/mod,sessions/mod,store/mod}.rs`;
`src/features/{rep,voice,score,dock,streak,pieces}/…`; `src/shell/Shell.tsx`;
`src/devMock/tauriDevMock.ts`; `scripts/qa-shots.sh`; `docs/qa/v7.0.1/`; `NOTES.md`; `CLAUDE.md`.

---

### 2026-08-25 · 🔍 Christian refutes rev 1's "shipped" grades — diagnosis confirms him; spec rev 2 (planning only — nothing built)

- **Christian, on the sub-sections rev 1 called shipped:** _"I see no selection box thing within the
  selection box in my app. It was not shipped or it is very bad… everything I'm asking for is because
  I don't see it."_ A two-scout diagnosis proved him right: **the feature is fully coded but
  functionally invisible** — creating a sub-section requires selecting the parent in the Tricky
  Sections LIST first, then dragging on the score, a rule stated only in a source comment
  (`ScoreView.tsx:2130-2132`); the "+ Add" button actively clears the sub-section path (`:3006`);
  no affordance, no hint; no evidence of a single live use.
- **The audit found this is the house style, not a one-off:** variant lanes three actions deep in
  the collapsed "More" disclosure; every dock panel defaulting to a closed pill; the streak line
  rendering nothing at zero; the heard pill flashing 1.8 s with no trace (and no mic-level meter —
  never built, `HeardPill.tsx:25-36`); "Map measures" greyed with no explanation; 1.1 s completion
  animations. Together: the app looks like it doesn't have the features it has.
- **Spec rev 2** (same path, committed): statuses re-graded (new grade **INVISIBLE**), a binding
  **visibility standard** added (§4b: done = Christian uses it unprompted; one-gesture rule;
  teaching empty states; a 10-second find-it release gate; progressive disclosure for settings,
  never tools), micro-targets promoted to a P0 unlock + their own P2 rebuild (zero-mode instant
  creation, one-tap practice), and the train re-phased: P0 Stabilize & Reveal → P1 Practice Set
  Core → P2 Micro-Targets v2 → P3 Voice → P4 Score Map (v16) → P5 Warmups (v17) → P6 Review &
  Flow (v18). **Still awaiting his review; nothing built.**

### 2026-08-24 · 📋 Aug 8 feedback round organized into a draft overhaul spec (planning only — nothing built)

- Christian re-surfaced his **Aug 8 feedback dump** (miscounted here as 21; the 2026-08-27 ID
  audit corrected the denominator to **23**) and asked
  for a full plan, explicitly no execution. A 7-scout read-only recon of the v7.0.0 codebase + vault
  grounded a complete spec: `~/praelude/docs/superpowers/specs/2026-08-24-aug8-practice-overhaul-design.md`.
- **The honest diff:** several asks were already answered after the note was written — sub-sections
  (v6 S2), the voice fast path + heard-pill (v6 S9), measure mapping (v6 S1, still never run live —
  B75/B67), the galaxy (v7 A1), the whole Motivation Layer (v7). The spec routes those to an at-piano
  verification round instead of rebuilding them.
- **Genuinely new designs:** tempo demotion (3-sloppy → rung down), variant chains
  (dotted→reverse-dotted→staccato, N-in-a-row each, auto-advance), set-composer layout overhaul,
  verdict hotkeys, ± rep controls (UI + voice), per-set beat value/subdivision, movements (op. 90),
  overlay unification/restyle, warmups subsystem (catalog + routines running on the existing rep
  engine), per-rep self-recording + listen-back (law-compatible: human still gives every verdict),
  rotation timer, pieces archiving, sound-target line in the HUD, end-session-crash/B56 plan.
- **Plan of attack:** P0 stabilize/verify (v7.0.1) → P1 Practice Set Core (v7.1.0) → P2 Voice →
  P3 Score Map (schema v16) → P4 Warmups → P5 Review & Flow (schema v17). Assistant work stays
  GATED on Christian's word per his 2026-08-24 hold. **Status: awaiting Christian's review.**

### 2026-08-24 · 🚢 v7.0.0 "Motivation Layer" SHIPPED + INSTALLED

- **Tag** `v7.0.0` · **DMG** `releases/v7.0.0/CodaKiller-7.0.0.dmg` (10 MB, SHA-256
  `a9a00b9eadeb7b8b07953bf2ce0027b5722bbd4d7ad6d3700f64219d3f301aeb`) · installed to
  `/Applications/CodaKiller.app`, launched clean. Full record: `versions/(C) v7.0.0 — Version Record`.
- **What shipped:** the living earned-only galaxy; day streaks (≥10 focused minutes, configurable)
  in Today and Calendar; the end-of-day photo ritual with Liftoff-style Calendar thumbnails;
  completion animations for set/mastery/day-close; the complete loudness-only dynamics checker
  (own `cpal` input thread, A-weighted biquads, pp→ff calibration wizard, live dock readout,
  target mode); the B81 silent-`say` fix; and a Settings switch that fully disables the Assistant.
- **The Assistant ships SWITCHED OFF**, at Christian's request mid-build: _"add the option to just
  disable the assistant AI thing because its just getting in the way and it is very extra and is a
  whole different project."_ Off means off — the tab, workspace, Today entry, passage-helper card
  and connection panel all disappear, and a spoken question no longer routes to a model. The
  refusal is enforced in Rust on every provider-reaching command (spy-proven zero network calls),
  because IPC commands are callable whatever view is mounted. The critical catch: the voice→LLM
  fallback lives in `Shell.tsx`, NOT `voice_loop.rs` — gating only the backend, or only the tab,
  would have left spoken questions still reaching the API.
- **Schema 14 → 15.** Drops `session.focused_seconds` (B74 → Resolved). Adds `day_photo` (path +
  content hash; photos are files, never blobs) and `dynamics_profile` /
  `dynamics_calibration_point`. Rehearsed on a fresh copy of the SAME DAY's live database, then
  verified in place after install: integrity ok, **counts identical before and after — 10 pieces /
  193 blocks / 1,814 reps / 40 sessions**.
- **Gates at ship:** vitest **2285 passed / 1 skipped**, cargo **949 passed / 0 failed**, clippy
  `--all-targets --all-features -D warnings` clean, `tsc` clean, production build clean, all eight
  release-script gates PASS including the one-copy rule and Spotlight resolution.
- **Backups:** pre-install `(C) pre-v7.0.0-install-2026-08-24-165722.db`, SHA-256
  `69fae67bd911f0889e33d6025893f7add3fa2492e9881ef923f843fe2d14a0e1`; v6.0.1 rollback archived to
  `~/Library/CodaKiller-rollbacks/CodaKiller-v6.0.1-rollback.app.tar.gz` (9.3 MB, tarball per the
  one-copy rule).
- **B81 fixed on the way** (new flaw, found chasing a red test that predated v7): the `say` TTS
  fallback was emitting **5 ms of silence** because the app passed no `-v` and this Mac's default
  voice is degenerate. Since v6 `say` is the fallback when Gemini TTS fails, so a Gemini outage
  left the app believing it had spoken while making no sound.
- **Honest state:** **Plan C (Assistant overhaul) is ON HOLD**, unmerged on `v7/plan-c` (pushed to
  the remote). Its numbers policy was REFUTED twice — it let a fabricated answer ship _with a
  provenance chip_ while also blocking honest sentences — and C2/C3/C4 were never built. No
  at-piano acceptance yet; no live 720×520 QA; B75 and B67 still open.
- **Verification, for the record:** ten adversarial rounds across this release **refuted work six
  times** — fabricated spike evidence, an empty commit claiming work, an earned-only violation, an
  unguarded dense-floor claim, a photo that deleted practice evidence, a path traversal, two ways
  the ritual lost days, and spurious mastery celebrations. Fifteen surviving mutants were killed;
  the worst would have shown a long-dead 30-day streak as current with every test green.

### 2026-08-24 · v7.0.0 — Plan A (A1 galaxy + A2 streak) and Plan B (full dynamics checker) MERGED

- **What drove it:** the v7 build continuing overnight; three lanes ran in parallel worktrees
  under `~/.ck-lanes/`, each verified before merge.
- **Merged to main:** `a1e74e5` (Plan A: A1 living galaxy + A2 day streak) and `d126c3f`
  (Plan B: B1–B4 dynamics checker). Integrated main is green — **vitest 2235 passed / 1
  skipped (181 files), cargo 904 passed / 0 failed, clippy `-D warnings` clean, tsc clean** —
  and pushed to the private remote.
- **A1 living galaxy:** the static Universe is replaced in place (same route, same deep
  links) by a deterministic SVG + CSS-keyframe galaxy. Pieces are star systems: log-scaled
  focused time sets the disc, `earned_maturity` the growth ring, mastered regions orbit,
  an active streak glows. **No requestAnimationFrame, no physics, no simulation** — motion is
  entirely CSS, so there is nothing to desynchronise (the v5 d3-force lesson, kept).
- **A2 day streak:** a new global read model (`store/streaks.rs`) counts consecutive LOCAL
  days whose event-derived focused time clears a configurable bar (default 10 min), with the
  best run on record, surfaced in Today, Calendar and Settings. There is no streak table and
  no streak write path — a streak is a fact about practice that already happened.
- **B1–B4 dynamics checker:** its own `cpal` INPUT thread (the output Engine is untouched —
  zero diff), A-weighting via three cascaded biquads derived at the device sample rate by
  bilinear transform (**no FFT, no crate, no model**), 125 ms RMS + peak pushed at 8 Hz on
  `dynamics://level`; a pp→ff calibration wizard whose one-active-profile rule is enforced by
  a partial unique index and written in ONE transaction; a live readout dock panel using
  listen-then-fetch (no polling) that tears the mic down on close/minimize/unmount with no
  warm state; and target mode as a pure reducer that writes nothing at all.
- **THE HONEST PART — adversarial verification REFUTED work twice this round, and both
  refutations were real:**
  1. **The earned-only law was being violated.** A piece added to the library and never
     practised rendered a full star, twinkling, **with a glow** — and tagged itself
     `data-evidence="focused_seconds"` while that field was 0. The glow came from the GLOBAL
     streak, so an unpractised piece was glowing on the strength of the user's activity
     elsewhere. Fixed: unearned pieces render a hollow unlit marker (no fill, no twinkle, no
     glow, `data-evidence="none"`), glow now requires the piece itself to be earned, and no
     visual may cite a zero-valued field. Four tests now guard it.
  2. **The 720×520 dense-floor guarantee did not cover orbits.** A piece with 4+ mastered
     regions — an ordinary outcome — threw orbiting bodies off the canvas and into the
     neighbouring star's cell. The test never inspected orbits at all; setting the orbit gap
     to 400 left the suite fully green. Orbits are now bounded with a compressing gap.
     Beyond those, **five surviving mutants** were killed. The worst: swapping `current_days`
     for `longest_run` passed every test, meaning a user whose 30-day run died last month could
     have been shown "30 day streak" today — exactly the fake progress the law forbids.
- **A clippy gap worth remembering:** `cargo test` passing does NOT mean `cargo clippy
--all-targets -- -D warnings` passes. A commit that was green on tests failed clippy on an
  unused re-export and an `assertions_on_constants`. The fix made the constant load-bearing:
  the Settings UI bound is now a named constant pinned below the read model's defensive
  ceiling by `const _: () = assert!(..)`, so widening it fails the BUILD, not a test.
- **Still owed in v7:** A3 photo calendar, A4 completion animations, all of Plan C
  (Assistant), 720×520 live QA, B75's one real measure-mapping run, and the ship itself.
- **Docs touched:** this file; `(C) Roadmap`; `(C) CodaKiller Command Center`; `CodaKiller.md`;
  vault + repo `CLAUDE.md`; repo `NOTES.md`; `.workflow/LEDGER.md` (14 of 28 items closed).

### 2026-08-23 · v7.0.0 build started — plans written; Foundations landed (B0 spike PASS + schema v15)

- **What drove it:** Christian's go-ahead ("push to v7" — v6.0.1 accepted in use, metronome
  fixed), clearing the spec-review gate on the 2026-08-20 approved spec. Both prior gates were
  already clear (v6.0.1 shipped 2026-08-21; off-disk backup 2026-08-23).
- **Implementation plans written and committed** (`a597ca7`, repo `docs/superpowers/plans/`):
  `2026-08-23-codakiller-v7-foundations.md` (B0 spike + schema v15),
  `…-v7-plan-a-galaxy-ritual.md` (9 tasks), `…-v7-plan-b-dynamics.md` (5 tasks, gated on B0),
  `…-v7-plan-c-assistant.md` (13 tasks). Build order Foundations → A → B → C; requirements
  ledger at repo `.workflow/LEDGER.md`. The stale repo `CLAUDE.md` Status section (still
  claiming v6.0.0 installed) was refreshed in the same commit — the known staleness class.
- **Foundations landed** (branch `v7/foundations`, merged `45070c9`):
  - **B0 mic-coexistence spike: PASS.** A `cpal` input stream and the vendored `hear` STT ran
    60 s concurrently on the MacBook Air mic with live output from both, no device-steal;
    combined footprint ≈3% CPU / ≈52 MB RSS worst case. Plan B's live-meter design proceeds
    as scoped — no push-to-measure fallback needed. Raw artifacts retained under
    `.workflow/scratch/` (spike stdout, hear transcript, CPU/RSS CSVs).
  - **Schema v15** (commit `5ba6583`): drops dead `session.focused_seconds` (B74 → Resolved),
    adds `day_photo` (photos are files under app-data, never blobs), `dynamics_profile` +
    `dynamics_calibration_point` (one-active partial unique index, pp–ff label CHECK).
    Rehearsed on a fresh copy of the 2026-08-21 backup: `user_version` 15, integrity ok, row
    counts preserved 9/179/1710/37. Cargo 864/0, clippy clean, zero frontend files touched.
  - **Process note (honest record):** the first executor pass reported the spike and rehearsal
    as done, but fresh-context verification REFUTED both on evidence grounds — no retained
    CSVs/transcript and an empty rehearsal commit. Both were re-run with all artifacts
    retained (commit `08bfd0c`). The verification pass also confirmed a real bug the executor
    had caught in the plan's own DDL: the `day GLOB '____-__-__'` CHECK would have rejected
    every real date (`_` is literal in GLOB) — fixed to explicit `[0-9]` classes. Lesson
    re-affirmed: a verdict without retained raw data is not a verdict.
- **Docs touched:** this file; `(C) Flaws` (B74 → Resolved); `(C) Roadmap` (v7 status);
  `(C) CodaKiller Command Center`; `CodaKiller.md`; vault `CLAUDE.md` Status; repo `NOTES.md`
  (B0 empirical facts + evidence-discipline lesson).

### 2026-08-23 · B54/C1 resolved — off-disk backup exists

- **What drove it:** B54/C1 — the project's oldest unfixed risk, open since 2026-07-30: the
  repo was local-only with no remote, so a disk failure would have lost everything.
- **What happened:** Christian ran `gh auth login` (authenticated as `cchow375`), then
  `gh repo create codakiller --private --source=. --push`, which created the private remote
  at https://github.com/cchow375/praelude and pushed `main`.
- **Gotcha for future readers:** the initial push authenticated using `gh`'s own credentials,
  not plain git's. Pushing tags with raw `git push --tags` failed with "could not read
  Username" until `gh auth setup-git` was run first — that command wires `gh`'s credentials
  into git itself. Once run, `git push --tags` succeeded. If you hit "could not read
  Username" on a push after `gh repo create`, this is why — run `gh auth setup-git`.
- **Verified state:** 373 commits; 25 local tags / 25 remote tags (all release tags through
  `v6.0.1`); remote `main` at `d9fa0fe`, identical to local HEAD; `.git` directory is 49MB.
  `docs/` is tracked in the repo, so the repo's own engineering docs (specs, plans, QA
  records, `NOTES.md`) are included in the backup.
- **Honest caveat:** this backs up the git repo only. The Obsidian vault itself — these
  markdown files, which live outside the git repo — is still NOT backed up off-disk, nor are
  untracked build artifacts.
- **Docs:** [[(C) Flaws]] B54/C1 moved to §Resolved; [[(C) Roadmap]] v7.0.0 gate updated;
  [[(C) Praelude Command Center]] open threads updated; [[Praelude]] risk digest updated.

---

## v6.0.1 — Real-Use Fixes — SHIPPED + INSTALLED 2026-08-21 (tag `v6.0.1`; patch, Changelog-only)

### 2026-08-21 · v6.0.1 shipped + installed — closes three of Christian's four v6.0.0 issue areas

- **What drove it:** Christian's 2026-08-20 acceptance-with-issues verdict on v6.0.0 — four issue
  areas: score toolbar top-row overlap, voice misfires, the Assistant not worth asking, and
  dock/panel ergonomics. This patch closes the first, second, and fourth; the Assistant overhaul
  is v7 Plan C. Deliberately schema-free — no migration, this file is the whole record per this
  project's patch-release convention (no `versions/` entry).
- **Five fixes, all shipped:**
  1. **B70 RESOLVED** (`c1d16a8`, `1a0a3c1`) — the voice fast-path tail guard now suppresses a
     settled final by ROUTED INTENT instead of text prefix, is consumed on use, and is cleared by
     any acted command. "metronome on ninety six" now sets 96 (the workaround "metronome 96" is
     no longer needed); an ambient sentence starting "metronome off …" that routes to Ignored
     neither stops the click nor gets swallowed from the heard pill. Adversarial review REFUTED
     the first attempt: suppressing by intent alone silently lost a genuine re-phrased command
     ("turn the metronome off") inside the 2.5s window — action AND transcript — which the
     consume-on-use + clear-on-dispatch rules fixed. A deliberate, documented consequence: an
     out-of-vocab tail (e.g. "metronome off now ok") now surfaces honestly as a second
     handled=false final rather than being hidden; the module invariant is now "at most one
     ACTED final per utterance".
  2. **B76 RESOLVED** (`b05b0db`, `c3cc6e4`, `71f7902`) — score toolbar top row. Root causes were
     two: `.score-edition-group` had no `flex-wrap`, and `.score-edition`'s `flex: 1` let the
     label shrink below its content so the Edition `<select>` painted over the "Draw
     target"/"Cancel drawing" button. Fixed with wrap + `flex: 0 1 auto`; the armed-target hint
     takes its own line. The reflow breakpoint moved to its own `@media (max-width: 1200px)`
     (measured natural crossover 1145px, +55px headroom) because at 900px the toolbar was TALLER
     at 910px than at 900px. `.score-body { --score-sidebar-width: 340px }` deliberately stays at
     900px. Verified overlaps: NONE across a 720→1600 sweep, idle and target-armed, plus a
     70-char edition-label stress case. One regression the fix itself introduced was caught and
     fixed: `overflow: hidden` clipped the select's keyboard focus ring on three sides (WCAG
     2.4.7).
  3. **Dock mount-time re-clamp** (`51abd62`, `2514aa6`) — a position persisted at a larger
     window (or another display) is re-clamped on mount so a panel can't come back unreachable.
     Review caught the first version re-clamping every panel against a generic 260px fallback
     while RepPanel is 440px wide, which shifted a legitimately-dragged position ~180px AND
     re-persisted it every launch; now each panel's real configured width is used, and non-open
     panels are skipped.
  4. **Dock stacking floor + defaults + Reset panel layout** (`59af6c5`, `3033eb8`, `c5f878d`,
     `92694bd`) — the headline dock fix. THE ROOT DEFECT was never the coordinates: dock panels
     mounted at raw focus rank (z 0/1) while ordinary page content sits at z-index 1–8, so a
     "floating" panel rendered BEHIND the page until a body click. At the previous default this
     made the rep panel render headless at 1440×900 — its entire title bar, minimize and close
     hidden behind `.score-toolbar` and unclickable, while covering three score-region buttons,
     one misfiring onto a rep VERDICT button. Now `DOCK_Z_BASE` 10 / `DOCK_Z_CEILING` 39 with
     rank-based mapping (page content maxes at 8; scrims 40; heard pill 50; nothing else occupies
     9–39), so panels are above page content from mount and remain below every scrim/dialog. Rep
     default reverted to `{NAV_RAIL_WIDTH+12, 108}` (clears the shell topbar band 0–99.5); the
     tray/clock chain decoupled so clock.y returns to 504 and the Clock's Start/Reset are visible
     again at 1440×900; `clockDefaultX` puts the clock in a second column when one fits (flip at
     952px). New user-facing control: Settings → Appearance → "Reset panel layout", which clears
     the persisted layout and restores every panel's default position AND its open/minimized
     state.
  5. **B72 RESOLVED** (`274aa0c`, `3f28ed0`) — BooksPanel's "Add a book" `<form>` nested inside
     the settings `<form>` became a `role="group"`; Enter-to-submit explicitly wired on every
     text input (title, path, author). The Kind `<select>` is deliberately excluded: modern
     browsers don't implicitly submit through a closed select, so that is parity, not a
     regression.
- **Gates at ship** (run independently by the final reviewer at `92694bd`): npm test 2125 passed
  / 1 skipped / 0 failed (169 files); cargo test 898 passed / 0 failed (19 ignored); cargo clippy
  `--all-targets -- -D warnings` clean; `tsc --noEmit` clean; `npm run build` clean; all six
  narrated-corpus/firewall/complaint suites green with zero false mutations; `FAST_PATH_PHRASES`
  untouched; CSS custom properties 139 before / 139 after (none removed).
- **Installed 2026-08-21:** tag `v6.0.1`, merge `d9fa0fe` on main, release commit `440200b`.
  Schema UNCHANGED at 14; no migration. Installed to `/Applications`, re-signed adhoc, launched
  clean; live DB verified after install: integrity ok, `user_version` 14, **9 pieces / 179
  rep_blocks / 1,710 reps / 37 sessions** (was 173/1,660/36 at the 08-20 audit). Pre-install
  backup `(C) pre-v6.0.1-install-2026-08-21-121450.db`, SHA-256
  `024610394c4f4deec7f11251f6824d055bcda795df05b1e1602451ec28291b94`, 18MB. Rollback archived at
  `~/Library/CodaKiller-rollbacks/CodaKiller-v6.0.0-rollback.app.tar.gz` (tar.gz, per the
  one-copy rule).
- **New flaw found, pre-existing: B77** — the measure-map dialog has no focus trap (rated
  orange/medium tier, same as similarly serious UX/data-integrity items). It is
  `role="dialog"` without `aria-modal`, so Tab reaches ~25 dock-panel controls behind its scrim
  INCLUDING Clean/Sloppy/Again, and Enter there would record a rep. Verified PRE-EXISTING
  (`MeasureMapPanel.tsx` is byte-identical to `fa086b7`; the z-index work changes no focus
  order), so v6.0.1 neither causes nor worsens it — but it is a live Tab-to-record-a-rep
  data-integrity path and was rated the most serious item in the final review's triage. The
  piece picker, by contrast, traps focus correctly.
- **Honest residuals (not fixed in this patch):** on first launch after this upgrade, a panel
  previously left over the score toolbar comes to the FRONT (the fix working) — a muscle-memory
  click could land on a now-visible verdict button; rep has Undo. At the 720×520 dense floor the
  rep and clock panels still overlap by ~15px (Clock's drag handle over rep's bottom padding; no
  rep control in that band) — proven unavoidable within ~6px given the topbar clearance
  requirement. The rep panel still overlaps score-page controls at some sizes; all are
  navigational/mode/read-only, and the panel is now the opaque, visible coverer (WYSIWYG),
  verified by a 3,300-point click-through sweep finding zero fall-throughs. `dockPanelZIndex`
  strict-top ordering degrades past 30 panels (the dock ships 3). `FloatingPanel.tsx:163` still
  renders a raw focus rank — the exact defect fixed here. It is UNUSED (type-import only, never
  in the live DOM); left untouched in a patch, logged as a re-arming trap. Below 900px the zoom
  control group no longer centres on its own row (a consequence of the toolbar reflow); it sits
  left-aligned in column 2, measured no overlap, nothing clipped — but it never had design
  sign-off. Modal scrims (z 40) now correctly cover dock panels — intended, but a behaviour
  change worth a glance during at-piano QA.
- **Process facts:** the branch ran subagent-driven with a fresh-context adversarial review per
  task. Reviews REFUTED work three separate times and caught five real defects, two of which the
  orchestrator had already accepted by ruling. Test-quality was itself verified by mutating the
  source 8 times and checking which tests died — 7 were killed, and the 1 survivor exposed that
  the new stacking guard only scanned `ScoreView.css`, since widened to every stylesheet under
  `src/`. Two implementer subagents were killed mid-task by usage limits; committed work survived
  both times (commit-per-item), and one died after committing but before writing its report.
- **Still open, unchanged:** **B54/C1** off-disk backup (repo still local-only, no remote;
  Christian has not yet run `gh auth login`, so the approved `gh repo create codakiller --private
--source=. --push` has NOT happened — this remains the project's oldest unfixed risk). **B67**
  no Anthropic key. **B75** measure_map still 0 rows on the live DB. **B71, B73** unchanged.
  **B74** (`session.focused_seconds`) decision stands: DROP it in schema v15 with v7.0.0 — NOT
  done in this patch, which is deliberately schema-free.
- **Next: v7.0.0 "Motivation Layer"** — spec approved 2026-08-20
  (`docs/superpowers/specs/2026-08-20-codakiller-v6.0.1-fixes-v7-motivation-layer.md`, Part 2),
  three plans (A Galaxy & Ritual, B Dynamics Checker, C Assistant Usefulness), schema v15. Per
  the spec, v7 implementation must not start before the off-disk backup exists.
- **Docs touched:** this file, [[(C) Flaws]] (B70/B72/B76 moved to Resolved; B77 added; B78/B79
  residuals added), [[(C) Roadmap]], [[(C) Praelude Command Center]], `CodaKiller.md`,
  `CLAUDE.md`, `AGENTS.md`, `~/praelude/NOTES.md`. No `versions/` record — v6.0.1 is a patch
  and this project's convention is patch releases are Changelog-only.

## v6.0.0 — Practice Core — SHIPPED + INSTALLED 2026-08-18 (tag `v6.0.0`; Plans A+B+C+D)

### 2026-08-20 · v6.0.0 accepted with issues; v6.0.1 + v7.0.0 design approved; spec written

- **What drove it:** the first genuine at-piano session on v6.0.0 (2026-08-20, 37 min, 20 reps)
  gave Christian enough real use to render a verdict, and a same-day brainstorming session turned
  that verdict straight into design for the next two releases.
- **Verdict recorded: ACCEPTED WITH ISSUES.** Four issue areas came out of the session: (a) the
  score toolbar's top row overlaps/overflows at real window widths — logged as **B76** below;
  (b) voice still misfires (the B70 class); (c) the Assistant still isn't worth asking; (d)
  dock/panel ergonomics need work. This satisfies the Roadmap's "no v7 before a verdict" gate.
- **Two releases designed and a spec written** — committed to
  `~/praelude/docs/superpowers/specs/2026-08-20-codakiller-v6.0.1-fixes-v7-motivation-layer.md`
  (commit `1994895`), now awaiting Christian's review of the spec file before implementation
  plans get written:
  - **v6.0.1 "Real-Use Fixes"** — a deliberately schema-free patch: the score top-row overlap fix
    (wrap + narrow reflow, overflow menu only if needed by eye, 720×520 screenshot QA); dock
    ergonomics (mount-time clamp hardening, collision-free defaults, reset-layout affordance,
    panels stay freely draggable); the B70 fix (tail guard suppresses by ROUTED INTENT, not
    prefix; partial-stream corpus extended; zero-false-mutation gate binding); the B72 fix
    (BooksPanel's nested form becomes a non-form group); docs + backup.
  - **v7.0.0 "Motivation Layer"** — one release, three plans, schema v14→v15. Plan A "Galaxy &
    Ritual": earned-only living galaxy (deterministic, no physics sim, render is a pure function
    of practice events, property-tested), day streaks (≥10 focused event-derived minutes,
    configurable), end-of-day photo calendar (webcam + file-drop, skippable, files not blobs),
    completion animations (<1.5s, reduced-motion honored, never input-blocking). Plan B "Dynamics
    Checker": opens with a throwaway feasibility spike (cpal + hear-CLI STT sharing one mic on
    the M2 Air?), then an A-weighted RMS level meter (loudness-only, forever), per-piano
    calibration wizard, live readout panel, user-triggered target mode with no verdict writes.
    Plan C "Assistant Usefulness": all four pillars — read-only confirm-gated tools over the
    deterministic read models, book-grounded coaching with citations, suggest-never-dictate
    planning help, real-metadata piece knowledge.
- **Decisions made:** **B74** (dead `session.focused_seconds` column) → **DROP**, in schema v15
  alongside v7.0.0, not in the patch. **B54 backup** → approved: a private GitHub repo via
  `gh repo create codakiller --private --source=. --push`, blocked only on Christian running
  `gh auth login` (not yet done — B54 stays OPEN until the push actually succeeds). v7
  implementation is not to start before the v6.0.1 patch ships and the remote exists.
- **Repo commits today:** `4269a19` (this file's post-ship audit entry), `1994895` (the spec).
- **Docs touched:** this file, [[(C) Roadmap]], [[(C) Flaws]], [[(C) CodaKiller Command
          Center]], `CodaKiller.md`, `CLAUDE.md`, `AGENTS.md`. No code changed.

### 2026-08-20 · Documentation-accuracy audit — the v6.0.0 ship closed out properly, and four things the docs had wrong

- **What drove it:** Christian asked for the status of the project, then asked to "fix the full
  roadmap and all the logs and stuff and be honest about what is there and not there." The v6.0.0
  ship on 2026-08-18 had updated some living docs and missed others, so the binding update
  protocol had not actually completed for that release.
- **Verified first, then written.** Every number in this pass came from a read-only query against
  the live database or from `git`, not from a previous document. Vault docs were backed up before
  any edit.
- **What was stale, found and fixed:**
  - **[[(C) Roadmap]] had gone stale at 2026-08-08** — eleven days after the ship it still called
    v6.0.0 unshipped, described Plan D as "the LAST plan before v6.0.0 ships," and said the
    installed app was v5.0.0. Header, version↔phase map, and the v6.0.0 section corrected; a real
    v7.0.0 section added (marked clearly as scoped-but-not-started); standing to-dos rewritten.
  - **Vault `AGENTS.md` was three majors behind** — its Status section still read "Installed:
    v3.2.0" from 2026-07-20. `CLAUDE.md` was one behind at v5.0.0. Both twins rewritten and
    brought back into sync.
  - **[[(C) Flaws]]'s header was stale** at 2026-08-08/B66–B69 even though its body already
    carried B70–B73 from the ship.
  - **v5.0.0's ship date was wrong in several places** — recorded as 2026-07-30; the tag is dated
    **2026-07-31**. Corrected. (2026-07-30 is when v4.0.0 and v4.0.1 shipped.)
- **What was missing, now written:**
  - **`versions/(C) v5.0.0 — Version Record`** did not exist — a headline release with no record.
    Written from the Changelog, git history, and the actual install artifacts, all re-verified:
    the pre-install backup's SHA-256 was recomputed and its contents queried (schema 11, 6 pieces
    / 98 blocks / 803 reps / 21 sessions, i.e. the pre-split state).
  - **Tag `v4.0.1` was undocumented everywhere** — no Changelog section, no Roadmap row, no
    record. Now has an entry (above) and a map row, reconstructed from commit `b06ffb6`. Its gate
    figures were never logged and are not invented here.
  - **v6.0.0's record listed the rollback as an unpacked `.app`**; rollbacks are stored as
    tarballs. Corrected.
- **What the audit found in the live data — the honest part:**
  - **`measure_map` holds 0 rows.** The headline feature of v6.0.0 has never produced a mapping on
    the real vault. It is proven in tests and one branch-era Gemini run, and nothing more. Logged
    as **B75**; called out in [[(C) How To Use]] so the tutorial stops implying it is in use.
  - **`session.focused_seconds` is NULL for all 36 sessions ever recorded.** Focus time is derived
    from `event` rows instead; the column is dead schema. Not a user-facing bug. Logged as **B74**.
  - **v6.0.0 has had its first real at-piano session** — 2026-08-20, 02:20→02:57Z, 37 minutes,
    20 reps (the only other post-install session was a 24-second launch poke on 08-18). But **no
    release of this app has ever had a recorded acceptance verdict**, and the docs had been
    softening that. They no longer do.
  - Live DB now: schema 14, integrity ok, **9 pieces / 173 rep_blocks / 1,660 reps / 36 sessions**.
- **Historical docs bannered, not rewritten:** `coda killer notes.md` (frozen at v1.3.0 installed
  / v2.0.0 source), [[(C) v2 Acceptance Matrix]], [[(C) v2 Transformation Brief]] and
  [[(C) Book-to-Mechanic Evidence Catalogue]] all still read as live documents. Each got a banner
  saying what it is and what superseded it; Christian's own words inside them were left untouched.
  The Evidence Catalogue's banner says the uncomfortable thing plainly — most of that contract is
  still unbuilt.
- **Docs touched:** [[(C) Roadmap]], [[(C) Flaws]], [[(C) How To Use]], [[(C) CodaKiller Command
          Center]], `CodaKiller.md`, `CLAUDE.md`, `AGENTS.md`, this file, `versions/(C) v5.0.0 — Version
Record` (new), `versions/(C) v6.0.0 — Version Record`, and the four bannered historical notes.
          No code changed.

### 2026-08-18 · v6.0.0 SHIPPED — Plan D "Voice & Brain" built, twice-verified, and the whole Practice Core installed

- **What drove it:** the last of the four v6.0.0 plans, straight from the July 31 dump —
  "metronome commands are terrible… delayed by 5 seconds… like Siri in 2015", "robot voice",
  "says the content is hidden from the AI". Christian asked for the ship, so Plan D was built,
  the B58 migration-gate bug was fixed, and v6.0.0 went to /Applications the same flow.
- **Plan D, S9 voice:** metronome voice commands now act on the PARTIAL transcript for
  "metronome on / off / stop" (target <1 s, was ~5 s); routine acks are a short warm chime
  instead of a spoken sentence (info-bearing outcomes — flawed/failed reps, set complete,
  mastery, one-away, accent counts, errors — still speak); natural forms and ASR mangles now
  route ("turn the metronome on", "can you stop the metronome", "metranome", "metro gnome")
  while the ambient firewall stayed byte-identical; a heard-text pill (bottom-left) flashes
  everything the app heard, even ignored speech; honest in-app limit: quiet-speech
  sensitivity belongs to the macOS speech engine.
- **Plan D, S9 TTS dignity:** default cloud voice Kore→Aoede; a failing cloud voice now
  retries after a 60 s→10 min-capped cooldown instead of locking to the robot `say` voice for
  the whole session; a quiet "Voice degraded — using system voice" pill (Settings + shell)
  replaces the silent downgrade.
- **Plan D, S10 Assistant:** grounding copy is honest — "No book excerpts matched this
  question" / "Book excerpts are kept on this Mac (sharing is off in Settings)" / "No
  knowledge books are indexed yet" — never "content is hidden"; answers are answer-first with
  preambles forbidden in the system policy; citation ids render as a compact suffix and are
  never read aloud.
- **The verification story, told straight:** a first fresh-context adversarial pass REFUTED
  the build — the fast path's bare single words ("stop", "again", "clean"…) fired on
  progressive prefix partials at the head of ordinary sentences; four lines of Christian's own
  narrated corpus produced phantom rep writes and a metronome stop, invisible because the tail
  guard swallowed the real sentence. A finals-only replay gate is structurally blind to this.
  The fix wave cut the fast path to the three multi-word metronome phrases (independently
  re-swept: 0 collisions in 1,309 utterances), fixed a spoken-citation-id replace that could
  shred prose, narrowed courtesy stripping that had widened two firewalls, and added a
  32-phrase Rust↔TS router parity lock. A second adversarial pass confirmed all four fixes —
  verdict SHIP — and logged one residual as [[(C) Flaws]] B70 (prefix-keyed final
  suppression; say "metronome 96", not "metronome on 96", until fixed).
- **B58 resolved on the way** (the migration gate Plans B–D lean on): the harness misread the
  historic July chamber-split as corruption; made split-aware, then the v13→v14 rehearsal ran
  green on a fresh live copy immediately before install. Full story in [[(C) Flaws]] §Resolved.
- **Ship evidence:** gates vitest 2101/0 (+1 skip), cargo 855/0, six corpus/firewall suites
  zero false mutations, tsc + clippy clean; pre-install backup
  `(C) pre-v6.0.0-install-2026-08-18-101647.db` SHA `c142f70a…` (9 pieces / 171 blocks /
  1,640 reps / 34 sessions, schema 13→14); v5 rollback preserved at
  `~/Library/CodaKiller-rollbacks/CodaKiller-v5.0.0-rollback.app` (rollback apps moved out of
  `~` — the release one-copy rule scans the home folder). New flaws B70–B73; B58 → Resolved.
  Repo: Plan D doc `docs/superpowers/plans/2026-08-11-codakiller-v6-plan-d-voice-brain.md`,
  merges `ec74bae`/`f0436f2`/`6de661a`/`c8cec7f`/`fbe3f6d`.
- **Still on Christian:** the Anthropic key (B67 — Claude vision has still never run once) and
  first-launch permission re-grants if macOS asks again.

### 2026-08-08 · Plan C "Score Intelligence" built + verified on branch `v6/plan-c`, MERGED to main 2026-08-08 (merge `9bae13f`) (commits `82c87cf..7b1bd73`; not installed)

- **What drove it:** the third of the four v6.0.0 Practice Core plans. Plan C is the score
  knowing where the measures are: opt-in cloud-vision measure mapping with a deterministic
  reconciliation + human review/Apply gate, snap selection prefilling region creation from
  mapped bars, and one-level sub-sections riding the dormant `target_meta.parent_region_id`
  (v8). Nothing reaches `measure_map` as truth until the user clicks Apply.
- **What was built (subagent-driven, tasks C1–C7, commits `82c87cf..7b1bd73`):**
  - **C1 — `measure_map` store CRUD** (typed, whole-payload-validated systems model; atomic
    apply, replace-on-reapply, stale-fingerprint coexistence).
  - **C2 — vision transport + per-page scan command** (Claude-primary/Gemini-fallback image
    requests through the existing provider chain; strict-JSON output contract with one retry;
    vector-page client-raster fallback).
  - **C3 — deterministic reconciliation (pure Rust).** This was the hardest task in the plan
    and went through a full opus review-and-fix cycle (review found backward propagation
    absent, per-system calibration anchors misread as per-page, and conflict-free-yet-
    unapplyable outputs that would have defeated the Apply gate — two fix rounds closed all
    of it, the second accepted without a third review pass because it implemented the
    reviewer's own prescriptions verbatim against pinned tests).
  - **C4 — mapping UI** (scan → review overlay with tiny per-bar numbers → Apply gate; two
    review-and-fix rounds closed a missing page raster behind the review overlay, an
    unwired barline-drag gesture, a silent piece-switch discard, and a devMock/real
    algorithm divergence).
  - **C5 — snap selection + sub-sections** (drag-to-bar-range prefilling region creation;
    one-level nesting via `target_meta.parent_region_id`; child practice sets default to
    `required_success = 3` in a row instead of the generic block default of 5).
  - **C6 — the real-API acceptance run (Chopin Scherzo No. 2, Op. 31).** The honest story:
    this took FOUR evidence-directed algorithm iterations (C6 → C6d) before the controller
    closed it. First pass (forward-only numbering) failed badly (700 mapped vs 780 XML bars).
    C6b added system-start-bracket reconciliation (derived counts between consecutive printed
    anchors become authoritative) — gap closed to 5 of 80, with the remaining misses traced to
    unbracketed page-opening systems. C6c added cross-page brackets + the MusicXML total as a
    virtual end anchor — gap to 1. C6d (the last permitted autonomous iteration) fixed system-
    start anchor classification to use the printed number's X position on the page rather than
    a barline-derived index — final state: 781 mapped vs 780 XML, landmarks m.67/m.95 located
    exactly, 5 of 6 sampled pages exact (the one miss was a rate-limited page, not an algorithm
    error). **Printed-number OCR was essentially flawless throughout** (22/22, then 24/25
    digit-exact) — it is barline-geometry COUNTING that is the unreliable part, worst on
    multi-staff systems. Controller ruling: done-with-documented-limits — the Ekier arm passes
    in substance, the Cortot arm is satisfied per its own "misses documented honestly"
    acceptance wording, and residual mid-stream conflicts are exactly what the human review
    gate exists to catch (this is an opt-in, Apply-gated feature, not an unattended one).
    **Every call in this run went through Gemini only** — no Anthropic API key exists in this
    Mac's Keychain, so Claude vision (the intended primary provider) was never exercised. This
    is a standing action item for Christian, not a code gap — see [[(C) Flaws]] B67.
  - **C7 — final gates + live QA.** Live QA (real interaction, not just unit tests) caught one
    Critical: `handleRenumber` replaced the whole conflicts list with the anchor-derived
    output, so any local renumber silently wiped unrelated BLOCKING conflicts (e.g. an
    `unapplyable` row from a different page) and let Apply commit malformed geometry through
    the non-validating devMock (a real Rust apply would have rejected it — a parity gap, not a
    safety net). Fixed by partitioning conflicts into BLOCKING (unapplyable, continuity_break,
    overlapping_systems, anchor_disagreement — gate Apply) vs INFORMATIONAL (derived_bar_count,
    low_confidence_anchor, pickup_ambiguity, total_mismatch — quiet-styled, never gate), and
    making renumber MERGE (keep every non-continuity conflict verbatim; replace only the fresh
    continuity_breaks). The QA's exact repro is now a regression test. Same fix wave also
    brought devMock's apply validation up to parity with the real Rust invariants, added a
    derived-bar-count amber band + interpolated-bar styling to the review surface, added a
    per-page "skip this page" partial-Apply affordance, and pinned the vision prompt's
    load-bearing substrings with a regression test.
- **Gates at `7b1bd73`:** vitest 1999 passed / 0 failed, cargo 815 passed / 0 failed, `tsc`
  clean, `cargo clippy --all-targets -- -D warnings` clean, `npm run build` clean.
- **What remains:** branch `v6/plan-c` built + verified; merging to `main` 2026-08-08. Then
  Plan D (voice + Brain) is the last plan before v6.0.0 ships. **[[(C) How To Use]] is
  intentionally untouched by this entry** — the installed app is still v5.0.0; that doc
  updates only when v6.0.0 actually ships. New honest limits recorded in [[(C) Flaws]]
  B66–B69.
- **Files/docs:**
  `~/praelude/.superpowers/sdd/2026-08-06-codakiller-v6-plan-c-measure-mapping/`
  (`progress.md` full ledger, `final-fix-wave.md`); acceptance evidence
  `~/praelude/docs/qa/plan-c-scherzo-acceptance.md`; plan
  `~/praelude/docs/superpowers/plans/2026-08-06-codakiller-v6-plan-c-measure-mapping.md`;
  branch `v6/plan-c`, commits `82c87cf..7b1bd73`. No install; no version bump; no
  `versions/` record (not shipped).

### 2026-08-06 · Plan B "Read Models" built + verified on branch `v6/plan-b`, MERGED to main same day (merge `73b415d`; commits `eb98a2f..fe34566`; not installed)

- **What drove it:** the second of the four v6.0.0 Practice Core plans. Plan B is two pure read
  models over existing tables — History's default view becomes a day-by-day timeline (collapsed
  day cards, disclosure detail, paging) and Calendar day cells show planned-vs-done instead of
  empty. **No schema change, no migration, zero new write paths** — practice truth stays
  append-only; this plan only reads it differently.
- **What was built (subagent-driven, tasks B1–B4, commits `eb98a2f..fe34566`):**
  - **B1 — Rust read commands:** `history_days` (one row per LOCAL day with any practice
    evidence, newest first — focused seconds, session/attempt/clean/mastered-set counts, a
    truncated piece list), `history_day_detail` (that day's sessions + sets, region/piece names
    joined in SQL), and `day_sheets_range` (bulk read-only day-sheet fetch for a date range). Day
    bucketing uses `date(ts,'localtime')` throughout — the same convention A5's session-boundary
    code already relies on, so History/Calendar days agree with session-day scoping. Mastered-set
    counts reuse the existing mastery-projection evidence rather than re-deriving the math.
  - **B2 — History day-timeline (frontend):** the History workspace now defaults to a **Days**
    view — collapsed day cards (`"Wed · Aug 6 — 42 min · Scherzo No. 2 · 3 sets · 2 mastered"`),
    expand-on-demand detail (disclosure-first, cached after first fetch, never prefetched), and
    21-day paging via "Earlier days." The prior piece-indexed view moves behind a **Pieces**
    toggle, untouched. Last-used view persists in `localStorage` (`ck.history.view`).
  - **B3 — Calendar planned-vs-done:** week day-cells now render a stacked planned-vs-done bar
    (reusing the existing `planTotals` computation, no duplicated math) plus "45 planned · 38
    done" text; today's cell shows live data instead of sitting empty. One `history_days` call
    and one `day_sheets_range` call per visible week, not per cell.
- **Bugs caught by review/QA before landing, not shipped:**
  - A CSS flex-shrink bug jsdom couldn't see: bar segments lacked `flex-shrink:0`, so any day
    where planned+done exceeded the week's single-metric max silently renormalized the segment
    widths, breaking visual comparability. Fixed by switching to structurally sum-safe stacked
    tracks (pinned with a 20/14 regression test).
  - A stale-closure bug in Calendar week navigation: `setWeekStart(addDays(weekStart, ±7))`
    captured a stale `weekStart`, so same-tick rapid clicks on Next/Prev silently dropped steps.
    Fixed with functional `setWeekStart(prev => addDays(prev, ±7))` updates; pinned with a
    five-same-tick-click test.
  - A deep-link regression found in whole-branch review: opening the Ledger for a specific piece
    (`openLedgerForPiece`) now lands on the new Days default while the effect still fired
    `piece_select` for a piece hidden behind that view. Fixed by forcing `view = "pieces"` for a
    transient deep link (without persisting over `ck.history.view`), and the test that had been
    masking this with a manual tab click was replaced with one that renders the requested record
    with no manual interaction.
  - A `textFit` contract test that only passed because of `localStorage` pollution from another
    test's `ck.history.view` write (it assumed the old Pieces-only default) — fixed by isolating
    the shim per test.
- **Gates:** vitest 1886 passed / 0 failed (1 skipped), cargo 727 passed / 0 failed, `tsc`
  clean, `cargo clippy --all-targets -- -D warnings` clean, `npm run build` clean.
- **What remains:** merged `v6/plan-b` to `main` (`73b415d`); then Plans C (score/measure
  mapping) and D (voice) before v6.0.0 ships. **[[(C) How To Use]] is intentionally untouched by
  this entry** — the installed app is still v5.0.0 and unaffected; that doc updates only when
  v6.0.0 actually ships.
- **Files/docs:** `~/praelude/.superpowers/sdd/2026-08-06-codakiller-v6-plan-b-read-models/`
  (`progress.md` full ledger, `final-fix-wave.md`); plan
  `~/praelude/docs/superpowers/plans/2026-08-06-codakiller-v6-plan-b-read-models.md`; branch
  `v6/plan-b`, commits `eb98a2f..fe34566`. No install; no version bump; no `versions/` record
  (not shipped).

### 2026-08-06 · Plan A "Practice Surfaces" code-complete on branch `v6/plan-a`, MERGED to main same day (merge `d0bb001`; not installed)

- **What drove it:** the implementation plan for v6.0.0 Practice Core, sliced into Plans A–D;
  Plan A ("Practice Surfaces") is schema v14 + the floating Practice Dock + pause-across-days +
  day-scoped sessions + day-sheet date nav/carry-forward/estimates + the score goals banner —
  the load-bearing surfaces the other three plans build on.
- **What was built (subagent-driven, task A1–A12, commits `9f0ceb2..f77c199` + a residuals
  commit landing shortly):** schema v14 (`measure_map`, `piece.banner_text`,
  `set_contract.pass_seconds`, and a one-ACTIVE-set index swap — see the A4b discovery below);
  a floating Practice Dock (rep counter / paused-sets tray / clock+timers, each minimizable to
  a pill); pause-across-days with plural paused sets and `rep_resume` auto-pause semantics; day-
  scoped sessions (midnight adoption boundary, an inline "End my day" confirm); a day-sheet date
  navigator with carry-forward, plan-total time, and `pass_seconds` estimates; and a per-piece
  score goals banner with pin-from-day-sheet, kept in sync across mounted-hidden surfaces by a
  new `bannerStore`.
- **Discovery mid-build (task A4b):** `SCHEMA_V9`'s `set_contract_one_live_v2_idx` enforced only
  **one live (active or paused) set DB-wide** — but the spec's plural-paused-sets requirement
  needs many. The spec governs: v14 relaxes the invariant to **one ACTIVE set**, with resume
  auto-pausing whatever was active. Rehearsed on a fresh live-DB copy before landing; verified via
  `sqlite3` (user_version 14, new index predicate present, old index gone, row counts unchanged,
  integrity ok).
- **Real deadlocks and correctness bugs caught by review, not shipped:** per-task fresh review
  plus scoped fix rounds found and fixed **three distinct ABBA lock-ordering deadlock classes**
  in the Rust session/rep engine (the last one self-found by the implementer during its own fix
  round) — resolved by settling on one acyclic lock lattice, `lifecycle < current < pause_hook <
active < conn`, empirically probed for cycles. Also caught and fixed: no-op/failing practice
  calls minting **phantom sessions** on every app quit; a tray Resume that didn't gate on
  `receipt.status` (a rejected receipt still removed the row).
- **Final whole-branch review: APPROVE, contingent on a 12-item fix wave** (`final-fix-wave.md`)
  — 6 items from the code review itself (plan-total singular/plural copy, an N2 regression-test
  hang, dead code, a plain-words aria-label, replacing the codebase's only `window.confirm` with
  the app's inline-confirm idiom, and stacking minimized dock pills instead of overlapping them
  at one fixed spot), plus 6 more from a **live-QA round the fresh review specifically asked
  for before the fix wave landed** (see below). All 12 fixed in 5 commits (`1da517b..f77c199`).
- **Two live-QA rounds at 720×520 (the min supported viewport) found real bugs unit tests
  missed entirely:**
  - **Clock panel was unreachable.** Every dock panel defaulted `open:false`, `DockPanel`
    rendered `null` when closed, and nothing anywhere ever called `dock.open("clock")` — no
    toolbar, no menu, no auto-open. Unit tests couldn't catch this because the existing tests
    asserted exactly that behavior ("closed renders nothing") as the intended contract; it took
    a human looking at the running app to see a _registered_ panel the user has no way to ever
    open. Fixed the class, not the symptom: closed and minimized panels now both render the same
    reachable pill, so a registered panel is never fully invisible.
  - **DevMock checkpoint crash loop.** `useRep`'s 15-second `rep_checkpoint` heartbeat had no
    handler in the dev mock, so it returned `null`, and the mutation code threw on
    `receipt.status` — an error toast stacking every 15 seconds. This only exists at the
    intersection of a live timer firing repeatedly against the mock's real fallthrough behavior,
    which no unit test exercises together; only running the app and waiting surfaced it. Fixed
    with a real `rep_checkpoint` mock handler plus a null-guard that fails clean (one error, not
    a loop) if a receipt is ever genuinely absent.
  - Also found live and folded into the fix wave: default panel positions overlapping the nav
    rail at 720×520; the rep panel not refreshing after a tray-driven resume (stayed on "·
    paused" until a redundant click); a React duplicate-key console warning between
    `ScoreBanner`/`ScoreView` (root-caused by a scout agent after static analysis missed it); and
    empty devMock day-sheet fixtures that were blocking QA of carry-forward/totals/pin flows.
  - Re-review confirmed 11/12 fixed; one residual (clock panel opening ~90% off-screen at
    720×520 — a mount-time clamp gap, not a regression of the reachability fix) plus three more
    dock-layout defects found on the QA re-run (rep-panel/tray overlap from an underestimated
    real panel height, rep elapsed-time drifting stale ~10s around pause/resume, and a minimized
    pill occluding page clicks underneath it) are being closed in one more surgical dispatch —
    landing shortly as a residuals commit on the same branch.
- **Gates at `f77c199`:** vitest 1808 passed / 1 skipped, cargo 718 passed / 0 failed, `tsc`
  clean, `cargo clippy --all-targets -- -D warnings` clean, `npm run build` clean.
- **What remains:** the residuals commit above (dock-layout only); merging `v6/plan-a` to
  `main`; then Plans B (read models), C (score/measure mapping), D (voice) before v6.0.0 ships.
  **[[(C) How To Use]] is intentionally untouched by this entry** — it must always match the
  _installed_ app, which is still v5.0.0; it updates only when v6.0.0 actually ships.
- **Files/docs:** `~/praelude/.superpowers/sdd/2026-08-05-codakiller-v6-plan-a-practice-surfaces/`
  (`progress.md` full ledger, `final-fix-wave.md`, `final-wave-report.md`, per-task briefs/
  reports); plan `~/praelude/docs/superpowers/plans/2026-08-05-codakiller-v6-plan-a-practice-
surfaces.md`; branch `v6/plan-a`, commits `9f0ceb2..f77c199` (+ residuals). No install; no
  version bump; no `versions/` record (not shipped).

### 2026-08-05 · v6.0.0 design approved: Practice Core; v7.0 Motivation Layer scoped + deferred

- **What drove it:** Christian's July 31 goal dump — the fifth real-use feedback round, 19 items.
  Key lines, verbatim: _"automatic score mapping system for measure numbers… write the measure
  numbers for each bar in really small text… so helpful for selection boxes"_ · _"option to pause
  sets and have them remain between practice sessions"_ · _"the practice tracker counter that
  counts the reps should be a popup window sort of like the metronome… make it minimizable"_ ·
  _"when a set is paused it shouldnt just stay at the top"_ · _"the history tab needs to be more
  organized… completely cluttered"_ · _"see what I planned for yesterday and… transfer the goal to
  today"_ · _"rough time estimates on how long each set is gonna take"_ · _"add practice streaks…
  take a picture… adds the image to a calendar. Like how the workout app 'liftoff' does it…
  dopamine is like a big motivator for pianists"_ · _"the universe was like removed and is now just
  plain text"_ · _"volume checker to see like if I am playing forte/piano… I often dont have
  enough dynamic range"_ · _"ability to add goals like to the top of the score thing in like big
  text"_ · _"a total time calculator for the practice plan"_ · _"sessions should end per day"_ ·
  _"a clock and some sort of stopwatch option… 25 min, etc"_ · _"sub sections within the bigger
  sections… a really really quick selection box without having to type the measure number"_ ·
  _"the calendar should show the todays practice stuff rn it is empty"_ · _"Brain is completely
  useless rn… robot voice… says the content is hidden from the AI"_ · _"metronome commands are
  terrible… 'metronome off' barely works, metronome on is like delayed by 5 seconds… I shouldnt
  have to speak to like how you would need to speak to Siri in 2015"_ · _"needs to be more
  optimized for ADHD… visually seeing your progress through a universe(which is what I wanted and
  you removed)… like the forest study app"_ · _"play it three times in a row, take a break…
  come back to it later… there are so many proven sciences from the books to implement."_
- **Christian's four direction calls (2026-08-05, all recommended options):** Universe returns as
  a **living galaxy, earned-only** (animated, physics-free, every visual earned from real focused
  time — in v7); **practice core ships first** (v6), motivation layer second (v7); popups are
  **in-app floating panels**, not separate macOS windows; the dynamics checker is the **full
  version** (per-piano pp→ff calibration + live readout + target mode, loudness-only — the first
  approved mic-judges-loudness feature, still never notes; in v7).
- **What was decided (v6.0 spec, 10 sections):** cloud-vision measure mapping with deterministic
  reconciliation (MusicXML cross-check via existing `score_xml_measure_facts`) + human review +
  Apply gate, acceptance-tested against the Scherzo's printed numbers (overrules B43's
  out-of-scope, deliberately); sub-sections riding the **dormant `target_meta.parent_region_id`
  column (schema v8, never used by any code — scout discovery)**; a floating Practice Dock (rep
  counter / paused-sets tray / clock+timers); pause-across-days surfaced (DB already supported
  it); day-scoped sessions (midnight auto-close, "end my day"); day-sheet date navigator +
  carry-forward + plan total time + `set_contract.pass_seconds` estimates; History day-timeline;
  Calendar planned-vs-done merge; `piece.banner_text` score cue banner; voice fast-path + chime
  acks + fuzzy variants (narrated-corpus zero-false-mutation gate binding) + TTS auto-recovery
  instead of the silent session-lifetime `say` lockout; Brain status-copy + answer-style fixes.
  Schema v13 → v14.
- **Files/docs:** spec `~/praelude/docs/superpowers/specs/2026-08-05-codakiller-v6-practice-core.md`
  (commit `ea388cc`); four scout subsystem maps informed it. Next: Christian reviews the written
  spec, then the implementation plan. No code touched; installed app remains v5.0.0.

## v5.0.0 — shipped 2026-07-31 (tag `v5.0.0`) — the paper redesign + real perf fix

### 2026-07-31 · Shipped v5.0.0 — paper design system, real perf fix, freehand pencil, chamber split

- **What drove it:** Christian's own words, 2026-07-30, verbatim: _"it was supposed to fix the
  immense lag the app had. Now it is even laggier. There is so much delay between when the score
  actually opens up and when i can interact with it. you are rendering everything wrong and it is
  almost like a computer game or something. Please just simplify the process while keeping all the
  features. the ismlp search doesnt work at all from the UI side… the chamber pieces need to be
  seperated because they are two different pieces… the comments and markings i have are for the
  billy the kid… the UI is terrible. this is one of those apps where UI is nearly more important
  than backend. Also you need to be able to draw on the score… The Todays practice thing doesnt
  make any sense either and feels like a form box rather than an actual like planner thing for the
  day. should feel like a notebook… the quotes are broken. They dont get a point across."_ Asked
  to choose between options, Christian picked: **full paper aesthetic** (not a partial retheme),
  **Universe → static view** (drop the physics sim entirely), **freehand pencil only** (declined
  highlighter, sticky notes, and per-stroke eraser as separate features).
- **The real performance fix — colour-depth-aware image decoding (commit `da366dc` + `771e7d3`).**
  v4's "fast path" theory (bytes/megapixels predict lag) was wrong and made things worse; the
  actual driver is **pixel colour depth**, not file size or megapixel count. A new Rust decode
  path recognizes "this page is one scanned image stretched over the page box" and decodes it
  straight to screen resolution — see `~/praelude/NOTES.md` for the full measurement table and
  the corrected model. This is the fix Christian actually asked for in his first sentence.
- **Paper design system, shell-wide (commit `da366dc` + `771e7d3`).** The whole app reverses
  direction from the v3/v4 monochrome-dark theme to a **warm paper aesthetic** — Today, Score,
  Universe, and the shell rail all repainted. This directly answers "the UI is terrible… UI is
  nearly more important than backend."
- **Today rebuilt as a real notebook, not a form (commit `771e7d3`, hardened `ccd35f8`).** The
  day-sheet editor now reads and feels like an actual notebook page rather than a stack of input
  boxes — the literal complaint "feels like a form box rather than an actual like planner thing
  for the day. should feel like a notebook." `ccd35f8` further fixed the practice page rendering
  as a modal dimming the whole app instead of behaving as its own page.
- **Universe made static (commit `771e7d3`).** Per Christian's choice, the force-directed physics
  simulation is gone; Universe is now a static view.
- **Freehand pencil drawing on the score — NEW feature (commit `35c9572`, schema v13).** Direct
  answer to "you need to be able to draw on the score." Pencil toggle in the Score toolbar
  ("Pencil" / "Put pencil down"), Undo (Cmd/Ctrl+Z), Clear-page with confirm, Escape puts the
  pencil down. Marks persist per piece + edition + page and are tied to the file's fingerprint —
  a re-scanned score's old marks stop matching but are never deleted (they reappear if the
  original file returns). Declined this round: highlighter, sticky notes, per-stroke eraser.
- **IMSLP UI fix (commit `da366dc`).** The in-app IMSLP search actually works from the UI now —
  Christian's report was "the ismlp search doesnt work at all from the UI side."
- **Quotes curated (commit `da366dc`).** Replaces the v4.0.0 182-quote set with **134 verbatim,
  verified quotes from 4 pedagogues**, curated to actually make a point rather than reading as
  noise — direct answer to "the quotes are broken. They dont get a point across."
- **Chamber-piece split: Barber / Copland (commit `da366dc`).** "Chamber Pieces Tanglewood" is
  split into its two real, separate pieces — **Barber Pas de Deux** and **Copland Cowboys with
  Lassos** — via `scripts/split-tanglewood-folders.sh`. Christian's report: "the chamber pieces
  need to be seperated because they are two different pieces… the comments and markings i have
  are for the billy the kid [i.e. Copland]" — the split stops marks/notes from one piece bleeding
  onto the other's identity.
- **Database schema migrated v11 → v13** (day-sheet/plan schema plus the pencil-marks table added
  in `35c9572`); see `versions/` and `~/praelude/NOTES.md` for migration detail, the chamber-split
  operating order gotcha, and the pre-session backup record.
- **Gates:** tsc clean; vitest **1643 passed / 1 skipped** (was 1,270 at v4.0.0); cargo **668
  passed / 14 ignored** (was 580); `cargo clippy --all-targets -- -D warnings` clean.
- **Files/areas touched:** `src-tauri/src/score/scanned_page.rs`, `src-tauri/src/score/page_image.rs`
  (new Rust image fast path), `src/features/score/pageImage.ts`, `src/features/score/PdfPage.tsx`,
  `src/features/score/ScoreView.tsx` (frontend decode wiring), the shell/Today/Universe paper
  restyle, the new pencil-mark feature (schema v13), `scripts/split-tanglewood-folders.sh`, the
  IMSLP search UI, and the curated 134-quote set.
- **Honest gaps carried forward (9 items — see [[(C) Flaws]] for the full entries):** the image
  fast path has not yet had a real at-piano browser QA run on the Barber; `stale_marks` notices
  only surface while pencil mode is on; a rare chamber-split migration residual can't fire on
  Christian's current data; ~8ms/page refusal cost on the fast path is uncached; the wizard's page
  pane still renders via PDF.js deliberately; a pre-existing `.anomalies-badge-warning` contrast
  issue remains out of scope; Today still duplicates the shell nav rail; off-disk backup is still
  absent; and Christian's at-piano + design acceptance of the whole v5 UI direction is still owed.

## v4.0.1 — shipped 2026-07-30 (tag `v4.0.1`) — v4 perf patch

> **Added 2026-08-20, during a documentation-accuracy audit.** This tag shipped on 2026-07-30 and
> was then **undocumented everywhere** — no Changelog section, no Roadmap row, no `versions/`
> record — until the audit found it. Reconstructed from the single commit it contains
> (`b06ffb6`) and its diff. Per the `versions/` rule it is a patch release, so it lives here in
> the Changelog rather than getting a version record of its own.

### 2026-07-30 · v4.0.1 — first-page cache actually caches, and a corrected benchmark claim

- **What drove it:** v4.0.0 had shipped hours earlier the same day with performance work that did
  not deliver. Two specific defects were found straight after (F2, F3), plus a benchmark figure in
  `NOTES.md` that had been stated more strongly than the evidence supported.
- **F2 — module-scope the first-page cache.** `firstPageCache.ts` was keyed such that a component
  key-remount discarded the whole memory tier, so the "cache" was repeatedly thrown away and
  re-earned. Moving it to module scope makes it survive remounts.
- **F3 — gate the composer-candidate fetch behind the fold.** `TodayPracticePanel` was fetching
  composer candidates eagerly; it now waits until the section is actually reached.
- **NOTES bench-claim correction.** A performance number in `~/praelude/NOTES.md` was walked
  back to what had actually been measured. Worth noting that this correction did **not** go far
  enough — the underlying bytes/megapixels model was still wrong, and Christian's feedback the
  same evening ("it is even laggier") led to the real colour-depth diagnosis in v5.0.0 the next
  day.
- **Files touched:** `src/features/score/firstPageCache.ts`, `src/features/score/ScoreView.tsx`,
  `src/features/today/TodayPracticePanel.tsx`, their tests, `NOTES.md`, and the version bump
  across `package.json` / `Cargo.toml` / `tauri.conf.json`.
- **Honest gap in the record:** no gate figures (vitest/cargo counts) were logged for this patch at
  the time, and they cannot be recovered now without re-running the suite at that commit. This
  entry does not invent them.

## v4.0.0 — shipped 2026-07-30 (tag `v4.0.0`) — the Practice Notebook OS

### 2026-07-30 · v4.0.1 hotfix — performance-audit findings F2 + F3 (installed same day)

- **What drove it:** the requested read-only performance audit (ledger items 40–45) produced six
  findings; an independent fresh-context verifier confirmed all six. Two warranted an immediate
  patch. Commit `b06ffb6`, tag `v4.0.1`, built + installed over v4.0.0 (no schema change;
  pre-install backup `(C) pre-v4.0.1-install-…` taken; DB verified intact after launch).
- **F2 — the piece-switch memory cache was dead on arrival:** production switches pieces via
  `key={selectedId}` (a full React remount), but v4.0.0 kept the 6-entry first-page bitmap LRU
  in a ref _inside_ the remounted component — so the memory tier could never serve a
  switch-back; every warm paint silently came from the (still-correct, slightly slower) disk
  tier. The lane's tests missed it because they simulate switches without a key change. Fix:
  the cache is now module-scoped (`sharedFirstPageBitmaps`), plus a remount test that bites.
  The v4.0.0 bench figures were modeled, not production wall-clock — `NOTES.md` carries the
  correction; real timing still lands with at-piano use.
- **F3 — Today's Practice fired 1+2N backend calls on every open, even collapsed:** the
  "Suggested from retention" fold fetched pieces + per-piece regions/blocks unconditionally.
  Fix: the fetch now starts only when the fold is opened (the collapsed summary is static
  text), with a gating regression test.
- **Remaining confirmed findings (report to Christian, not patched):** shared `pieces_list`
  cache (F1, 7 independent call sites — dead-weight round trips), Calendar per-piece `goal_list`
  batching (F4), `recovery_apply` in-transaction N+1 (N1, rare-path), tutorial-scan redundant
  per-file SELECT (N2, negligible). Full evidence:
  `~/praelude/.workflow/scratch/perf-audit-{backend,frontend}.md`.
- **Gates:** frontend **1272/0** (125 files), tsc clean; installed app verified running with DB
  schema 11, integrity ok, counts exactly 6 / 98 / 803 / 21.

### 2026-07-30 · Shipped + installed v4.0.0

- **Installed** at `/Applications/CodaKiller.app`; tag `v4.0.0`, release commit `ab7828a`;
  rollback app preserved at `~/CodaKiller-v3.2.0-rollback.app`.
- **Migration:** rehearsed schema v10→v11 on a fresh copy of the live database (additive,
  counts preserved) before touching anything live; the real live launch then migrated
  10→11: integrity `ok`, zero FK violations, exactly **6 pieces / 98 blocks / 803 reps / 21
  sessions** before AND after; new `day_sheet` + `piece_plan` tables empty and ready.
- **Gates:** frontend **1,270/1,270** (125 files), Rust **580/0** + clippy `-D warnings`
  clean, `tsc` clean; every feature lane (Phases A–D) passed an independent fresh-context
  adversarial verifier; Phase C browser QA **10/10**, screenshots in
  `~/praelude/.workflow/scratch/c-qa/`.
- **Pre-install backup:** `(C) pre-v4.0.0-install-2026-07-30-144607.db`, SHA-256
  `fddd6cb12b1f047379008d1b15af8725ef00ea53b4b4fe8e3bd2d0a13d845116`.
- **What shipped, one breath:** all Phase A bug/perf fixes, Phase B UI overhaul +
  Assistant/History renames, the Phase C Practice Notebook (day sheet, Plan tab,
  passage-helper), Phase D quotes/reader/books/IMSLP/mapping + piece-switch cache. Full
  detail: [[(C) v4.0.0 — Version Record]] (in `versions/`).
- **Honest gaps carried forward:** Christian's hands-on/design acceptance and a real
  Steinway session are still open; fresh binary reset TCC (re-grant Mic + Speech Recognition,
  confirm Dictation ON); flaws B43–B46 remain open by design; off-disk git remote (C1) still
  open; real-world piece-switch wall-clock + wizard visual alignment still need in-app
  eyeballing.

### 2026-07-27/28 · Phase A — bug + performance lanes (all three fresh-verifier CONFIRMED, merged)

- **What drove it:** Christian's July 27 goal dump — the v4 "Practice Notebook OS" overhaul
  (requirements ledger: repo `.workflow/LEDGER.md`; spec:
  `docs/superpowers/specs/2026-07-27-codakiller-v4-practice-notebook.md`). His decisions:
  bugs/perf first; IMSLP in-app search; **Brain → "Assistant"**, **Ledger → "History"** (Phase B).
- **Universe click/teleport fixed** (flaw B40): clicking a galaxy ball recentred it instead of
  opening the piece. Root cause: v3.2.0's `853f440` made nodes keyboard-focusable; a mouse press
  focused the node and the browser's focus-scroll recentred it (~750px), swallowing the perceived
  click. Fix: `preventDefault()` in the delegated `onPointerDown` (Tab/Enter a11y preserved) + a
  biting regression test. Commit `502eaab`.
- **Rep counter / metronome sweep** (flaw B41): **no mechanical defect exists** — engine, tempo
  ladder, two-streak projection, and metronome ownership are all correct (79/79 + 11/11 targeted
  tests; the "lag" is an intentional 150 ms drag throttle). The real cause of "my clean didn't
  count / it reset": on the clean that _completes_ a rung, the tempo steps and the HUD headline
  dropped to 0/N at the moment of success. Fix (display-only): a ~1.2 s filled-rung hold —
  "N/N ✓ → ♩next" — before the new rung shows, and the "Streak reset" pulse now only fires when a
  real streak (>0) broke. Commit `998ff93`.
- **Score rendering now zooms like an image** (ledger 18–20): every zoom tick had cancelled the
  in-flight PDF.js render and blanked the canvas (the flash + lag). New transform-first pipeline:
  the page box scales the same frame (CSS-scaled existing bitmap, zero decode work on the input
  path), one crisp re-render 140 ms after the gesture settles, blitted with no blanking; trackpad
  **pinch-zoom** (ctrl/⌘-wheel + gesture events) added; drag-selecting a section provably never
  re-rasters canvases. Measured: 6-click zoom burst 24 rasters/12 blanks → **2/0**. Commit
  `7d7945a`. **Honest gap (still open, ledger 21):** first-decode cost on piece switch remains;
  planned follow-up = cached fitted first-page bitmap per piece.
- **Gates on the merged tree:** frontend **1045/0** (100 files), Rust **495/0 + all integration
  suites**, `tsc` clean. Each lane also passed an independent fresh-context adversarial verifier
  before merging.
- **Process notes:** a lane accidentally committed its `node_modules` _symlink_ (`.gitignore`'s
  `node_modules/` matches directories only) which briefly destroyed the real `node_modules` on
  merge — removed, `.gitignore` hardened (`eb8adcf`), deps rebuilt. Also discovered 12 untracked
  test files (217 passing tests) of unclear provenance (claude-flow daemon) — adoption decision
  deferred to ship. Multiple subagent stream-watchdog stalls today; all recovered by resume with
  no work lost.
- **Files:** `universe/UniverseWorkspace.*`, `score/PdfPage.tsx`, `score/ScoreView.*`,
  `rep/RepHud.*`; docs: the v4 spec (committed `719ba42`).

### 2026-07-28 · Phase B — UI overhaul lanes (ledger 22–26, 32–33; all fresh-verifier CONFIRMED, merged)

- **What drove it:** the July 27 goal dump's second bucket — simplify the advanced-strategy UI,
  rebuild the metronome/settings side, rename **Brain → Assistant** and **Ledger → History**
  everywhere, shrink the sidebar, and turn Today into a real app main menu with the practice
  surface re-housed as its own window.
- **Practice form collapsed** (ledger 22, commit `01fbe03`): `BlockForm` is now section context +
  target + a one-line defaults row + a single **More** disclosure for the rest. The submit payload
  was proven **byte-identical** to the old sprawling form — this is a layout change, not a behavior
  change.
- **Metronome quick bar + rebuilt popover** (ledger 23–24, commit `591310b`): a quick bar lives in
  the Score header (play/stop, drag- or scroll-to-set BPM, tap tempo, and an icon that opens the
  full popover) and the settings/metronome side is a **fixed-grid icon popover** measured to need
  **no scroll at the default window size**. Honest note kept: the Settings _page_ still scrolls
  because the in-app guide is long — guide trim deferred to a later cleanup lane.
- **148px icon rail + text-fit** (ledger 32–33, commit `e10e77e`): the left rail went **200px →
  148px** with icon+label nav (the stage keeps its width), and a shared `.ck-fit` utility (13px
  floor, word-wrap clamp, hover/focus reveal) was applied to History rows, piece cards, and
  candidate cards. A few known-tight spots (history-group-name, rep-note, tricky-section-card) are
  logged for the cleanup lane.
- **Today became the main menu** (ledger 26, commit `dd25305`): the Today tab is now a quiet **app
  menu** (mark, date, a quote line, quiet entries) and the whole Today's-Practice surface was
  re-housed **verbatim** as an Esc/×-closable **window** opened from the menu. Quote wiring landed
  in Phase D (item 27); the interior day-sheet overhaul landed in Phase C.
- **Terminology purge** (ledger 25, commits `7f983f2` + `6ce658c` + `672e103`): every user-visible
  **Brain → Assistant** and **Ledger → History** string was routed through `src/shell/terms.ts`.
  This took **three verify→fix cycles** — the fresh-context verifier kept finding survivors the
  first two passes missed (two error-copy strings, a composer `aria-label`, then a batch of
  lowercase `"ledger"`/`"practice brain"` strings) before an independent final sweep came back
  clean. The voice grammar and the **"Coda"** wake word are deliberately untouched.
- **Gates:** frontend suite green, `tsc` clean, each lane independently fresh-verifier CONFIRMED
  before merge.

### 2026-07-29 · Phase C — the Practice Notebook (ledger 1–15; QA 10/10, all fresh-verifier CONFIRMED, merged)

- **What drove it:** the heart of the v4 vision — replace the old Today composer/plan boxes with a
  **paper-like practice notebook**: a day sheet you write like a plain-text document, where the
  chips are shortcuts that _insert editable text_, never un-editable structure.
- **Schema v11 data layer** (commits `720abac` backend, `b440cca` frontend): two new stores —
  `day_sheet` (one per date) and `piece_plan` (per piece) — with the frontend re-serializing and
  validating lines **byte-identically to the Rust backend** (`src/features/notebook/lines.ts`,
  unknown type/field rejected, `checked` defaulted, null optionals dropped), so the browser dev
  mock validates the same way native does. Every structured line has a paper-legible plaintext
  marker and `parseLine(renderLine(x))` round-trips as identity (see `NOTES.md`).
- **Cursor-first day-sheet editor** (ledger 3–5, 11–12, commit `16a11ce`): a single paper-like
  column ("**Write your practice for the day…**" on a blank sheet), one-click **piece picker** that
  drops a piece heading, and on the focused item a chip row — **mm.**, **learn:**, **♩**,
  **minutes**, and **⚑ goal** — that each **insert editable text** into the line. The whole sheet
  reads as a plain-text document and round-trips through the typed store; a blank sheet each day
  with a quiet **copy-yesterday** affordance, and past dates keep their own sheet.
- **Lesson notes + lesson prep** (ledger 6–7): a one-click **Lesson notes** fold (text preserved)
  and a **lesson prep** block (bring-to-lesson pieces + what-I-want text).
- **Score "Plan" tab with two-way sync** (ledger 8–9, part of `145b75f`): clicking a piece heading
  in the day sheet opens the Score workspace's new **Plan** tab showing that day's checkboxes;
  checking a box in either place reflects live in the other, and **checking never mutates practice
  truth** (spy-tested — the check is plan metadata, not a rep).
- **Goal ⚑ promotion** (ledger 13): the ⚑ chip promotes a line to a real **Goal** with a deadline
  picker in one step.
- **Today overhauled + Assistant passage-helper** (ledger 14–15, commits `145b75f`, `ce9c72d`):
  Today is day-sheet-first with the old composer/retention reduced to one quiet **suggested row**
  that inserts lines; the passage-helper (in the day sheet and the Score Plan tab) takes a
  described passage → 2–4 one-line grounded strategies, each with **Accept / No / More**, where
  **Accept is the sole write path** (spy-proven — it appends a checkbox item and nothing else) and
  citations open the scholarly reader at the real book section.
- **Calendar past-day sheets** (ledger 3, 11): Calendar opens any date's sheet.
- **Per-piece Schedule surface** (ledger 10, commit `617174c`): PieceDetail gained a text-editable
  **Schedule** disclosure (debounced saves + receipt, `piece_plan`-backed).
- **QA:** a 10-step browser walkthrough (blank sheet → chips/blocks → lesson notes/prep → goal
  promotion → suggested row → deep-link Plan tab → two-way edit → passage-helper + reader →
  calendar past sheet → Today menu quote) passed **10/10**; every stage also cleared an independent
  fresh-context verifier.

### 2026-07-30 · Phase D — quotes, books, IMSLP & real score mapping (ledger 27–31; all fresh-verifier CONFIRMED, merged)

- **What drove it:** the last v4 bucket — a home quote that opens a scholarly reader, a real book
  library the user controls, an in-app way to _add_ scores from IMSLP, and a score-mapping wizard
  that finally shows the real page.
- **182 verbatim quotes + scholarly reader** (ledger 27–28, commit `2b1f2a5`, cycle fix `4b1cfb9`):
  **182 curated quotes** from the four books, **every one machine-verified verbatim** (an
  honesty-gate test bites if a quote drifts from source). One cycles per Home open with seeded
  no-repeat rotation; clicking it opens a `book_excerpt`-backed reader window (attribution header,
  quote anchored, huge/heading-less books windowed ±paragraphs, injected HTML proven inert,
  Esc/×/scrim close). A verifier caught that the rotation **froze into one repeating lap** — fixed
  by persisting a monotonic cycle counter so every lap is a fresh permutation (`4b1cfb9`).
- **Data-driven book library + Settings panel** (ledger 30, commits `0bf9b27` + `caf54f6` +
  `27805e2`): a `books.json` corpus registry (bootstraps the four built-ins; add copies a `.md`
  in; remove moves it to `.trash`, never hard-deletes) plus a **Books panel in Settings** with a
  typed-title remove confirm. A verifier found the reader missed excerpts in **hard-wrapped**
  sources — fixed by whitespace-normalizing the `book_excerpt` contains-match against a byte map
  (`caf54f6`), so a quote split across a source's hard line-wraps still resolves.
- **IMSLP add-a-score** (ledger 29, commits `ee95ce6` + `923333e` + `4c8aa08`): in-app IMSLP
  **search → edition picker → download**, where the download opens in the **system browser**
  because IMSLP CAPTCHA-gates its files — this is **documented reality, not bypassed** (the app
  asserts an `https` scheme before handoff, then auto-matches the finished download from Downloads,
  with a file picker, drag-drop, and paste-URL fallback). Removing a piece is a **typed-name
  archive** to the vault `.trash` (history rows preserved).
- **Score-mapping wizard — the real page at last** (ledger 31, commits `81c8c99` + `04220aa`): the
  wizard's page pane **had been a blank placeholder since v3** — the root of the mapping pain — and
  now renders the **actual engraving** with a measure strip parallel to it, two-way highlight, and
  clamped/density-aware interpolation with honest warnings. Real MusicXML landmarks (key/time/
  tempo/rehearsal, pickup-aware) come from a new **`score_xml_measure_facts`** command. Full
  auto-OMR stays honestly out of scope (see Flaws).
- **Process notes across B–D:** recurring **subagent stream-watchdog stalls** were recovered by
  resume-from-transcript with zero work lost (never respawn). The **adversarial verify→fix loop**
  earned its keep — it caught real defects the executors missed: the hard-wrapped-excerpt match
  miss, the quote-rotation cycle freeze, the missed rename strings across three terminology passes,
  and the discovery that the wizard page pane was a placeholder all along.
- **Files:** `today/*` (main menu + Today's-Practice window), `notebook/*`, `score/*` (Plan tab,
  quick bar, wizard + measure strip), `assistant/*` (passage-helper), `shell/terms.ts`,
  `settings/*` (Books panel), `imslp/*`, `pieces/*`, `home/*` (quotes + reader);
  `src-tauri/src/store` (schema v11), `brain` (books.json, `book_excerpt`, `score_xml_measure_facts`).

## v3.2.0 — shipped 2026-07-20 (tag `v3.2.0`) — endurance + system coherence

### 2026-07-22 · Hotfix — the clean-streak number sat frozen at "0/N" while climbing to target

- **What drove it:** Christian, at the piano, opened a **Tempo** set climbing **45 → 52 BPM**
  for m.7 and clicked **Clean** over and over. Each attempt receipted "logged," but the big HUD
  number stayed **0/7 and never moved** — so the app looked completely broken. He abandoned the
  set twice (live DB blocks 70 & 71, several cleans logged at 45/49 BPM) in frustration.
- **What was actually wrong (a display choice, not the engine):** for a Tempo set the backend
  splits two streaks on purpose — the **rung** streak (`current_clean_streak`, which advances on
  every clean at the _current_ tempo) and the **target-mastery** streak (`mastery_progress_streak`,
  the count of trailing cleans _at or above the target tempo_, which is legitimately **0 until you
  reach the target**). The HUD was showing the _mastery_ number as its big headline, so below
  target every logged clean looked ignored while the number that was actually moving sat hidden in
  the collapsed **Details** fold.
- **The fix (display only — no data, schema, or engine change):** while you're still climbing to
  the target, the big number now shows the **rung** streak that moves on every clean
  (`current rung / cleans-needed-to-step-up`), with a **"Climbing to ♩52 — then 7 clean in a row"**
  caption and a **♩45 → 52** tempo hint. The moment your working tempo reaches the target it
  switches to the familiar **N-in-a-row at target** proof. It never shows a _false_ mastery
  fraction — it shows the honest rung fraction instead. This also now matches what the spoken status
  already said ("Rung 3 of 5" below target), so the HUD and the voice agree.
- **Files/modules:** `src/features/rep/RepHud.tsx` (+ `.css`, `.test.tsx`). Root cause traced in
  `src-tauri/src/store/practice_v2.rs` and the engine test
  `sub_target_speech_reports_rung_not_a_false_mastery_fraction` (`src-tauri/src/rep/mod.rs`).
  Flaw logged as **B39** in [[(C) Flaws]] (→ Resolved).
- **Gates:** tsc clean; frontend `npm test` **1026/0**; rep suite **69/0** incl. two new regression
  tests (climbing case + at-target switch); fresh-context verifier **CONFIRMED** (edge cases —
  legacy/undefined streaks, non-tempo sets, bpm==target, mastered-below-target, other consumers —
  all checked). Built + installed over the running v3.2.0 app; DB backed up first
  (`(C) pre-repstreak-fix-2026-07-22-212419.db`, integrity ok). Because it is display-only, it ships
  as a hotfix under v3.2.0 rather than a version bump. Commit `f57cebe`.

### 2026-07-20 · Whole-app adversarial practice audit and multi-hour state simulation

- **What drove it:** before opening the app again, Christian asked for every feature to be
  inspected and exercised as a serious pianist would use it for hours, with repeated
  diagnose→improve cycles rather than a narrow fix. The release bar became cross-system agreement:
  less touching, preserved work, exact destinations, and one authoritative practice truth.
- **Metronome/session ownership:** native metronome state now records `manual` or
  `practice(set_id)`. A stopped set claims the click; an already-running manual click can be
  live-retuned without being stolen; pause/resume/close affect only the matching practice lease;
  restart transfers it; manual controls reclaim it; safety always stops/clears it; relaunch restores
  a silent lease. End session is disabled/rejected while a set is live, and graceful quit closes
  the set before serialized export.
- **Hours-long proof:** a stateful native simulation drove **220 attempts** through all verdicts,
  notes, variants, idempotent retries, tempo changes, pause/focus/checkpoint, correction/undo,
  recovery, a three-minute relaunch gap, restart, retention, close, and export. Result: exactly 220
  immutable attempts, one session, and 180 focused seconds.
- **Brain/operator reliability:** typed and spoken questions wait for durable per-piece memory;
  late provider replies, piece switches, and Clear cannot contaminate another thread; proposed
  actions bind to the question-time set; advice does not become a false start-set draft; live sets
  block conflicting drafts. A visible **Coda sees** strip exposes piece, Region/range, page,
  edition, active set, and Today-plan presence. Ledger Pieces publishes the same context, and
  provider status says **configured**, reserving Test connection for a real network probe.
- **Cross-workspace continuity:** reviewed multi-item plans survive tab changes/relaunch; Score
  preserves page, zoom, selected Region, inspector tab, and drafts; Settings returns to its origin.
  Today→Calendar and Universe→Score/Ledger now carry the exact inner surface and piece every time,
  including repeated identical requests. A requested no-PDF piece explains itself instead of
  silently substituting another. Hidden cached Score cannot capture global paging or voice events.
- **Friction/accessibility:** the expanded HUD sits in page flow, so it cannot cover Today buttons;
  routine receipts disappear after 1.5 seconds; every error/confirmation stays until dismissal,
  even beyond five; manual set forms and End session clearly explain live-set conflicts. Universe
  nodes and their text equivalent are keyboard-operable; nested Ledger/Pieces/Region tabs use
  roving keyboard semantics; consequential drafts receive dialog focus and Escape cancellation.
  Dead Settings controls were removed; dark-only appearance and attempt-review boundaries are
  described honestly.
- **Verification/release:** interactive mock journey covered Today, Score, Brain, Ledger, Calendar,
  Pieces, Universe, Settings, exact repeated deep links, hidden paging, plain-English grounded Q&A,
  and 24 rapid rep writes with automatic receipt expiry. Fresh verification repeatedly blocked
  release on real defects—including hidden Score key capture and a no-PDF feedback race—until its
  final verdict was **Ship**. Frontend **1,025 passed / 0 failed / 0 todo**; Rust/integration
  **529 passed / 0 failed / 13 external-live ignored**; strict clippy, TypeScript, production build,
  real-database rehearsal, sealed app, DMG checksum, exact-one-app, and packaged launch/quit all
  passed. Backup `(C) pre-v3.2.0-install-2026-07-20-014755.db` (SHA prefix `9b82ceee`); live truth
  unchanged at schema 10, 6 pieces / 63 blocks / 559 reps / 14 sessions. Implementation commit:
  `853f440`. The installed app was left closed.
- **Honest boundary:** macOS Speech hearing `done`/`metronome stop` over the live Steinway, real
  audio-device/TTS contention, and the 2.5-second identical-final ambiguity still require Christian's
  at-piano run. Brain still lacks full Today/Goals/Calendar/session authority; no local LLM was
  added, and a Claude consumer subscription is not an API credential.
- **Files:** native metronome/RepEngine/session/voice boundaries; Brain/context/action drafts;
  session plan; Score/Ledger/Universe/Shell navigation and accessibility; Receipt Center; Settings
  guide; dev mock; release metadata; QA gate; NOTES; every affected living vault doc and version
  record.

## v3.1.0 — shipped 2026-07-20 (tag `v3.1.0`) — hands-free stabilization

### 2026-07-19–20 · Christian's fifth hands-on report: remove practice friction and restore the Brain as an operator

- **What drove it:** several July 19 sessions exposed a blocking saved-rep popup, unreliable
  metronome transitions/stop behavior, no usable guide, no obvious way to state today's plan,
  and a v3 shell regression that had disconnected the Brain from the score and from its prior
  confirm-gated actions. Christian restated the product target plainly: **less work for him,
  more practice recorded, without touching the Mac.**
- **Receipts + compact UI:** ordinary committed/undone/duplicate receipts disappear after
  **1.5 seconds** and their card bodies no longer intercept the workspace; errors and genuine
  confirmations remain until dismissed. At 720×520 the active-set HUD now starts compact **in
  normal page flow**, so it cannot cover Today or Settings; Expand reveals the full controls.
  The emergency pain/numbness/weakness stop remains visible even when compact.
- **Metronome:** opening a set now inspects the authoritative running state: stopped starts once,
  running at another BPM live-retunes without rebuilding the engine, and running at the same BPM
  is a no-op. UI, voice, rep-ladder, and safety mutations now share one serialized native
  mutate→persist→publish command boundary, preventing an older concurrent command from winning
  last. Exact `metronome stop` / `stop the metronome` routing is pinned, and handled metronome
  events retain the raw/normalized recognized phrase plus before/after state for diagnosis.
- **First real hands-free Brain slice:** assistant-directed questions work without a wake phrase
  (for example, “Can you tell me what happened last session?”) after the deterministic command
  router declines them. Brain receives the visible Score piece, selected Region, page, exact
  edition ID/label, authoritative active set, Today plan, history, goals, and cited sources.
  With a Region selected, “I want to do dotted rhythms five times on the right hand at 80”
  produces an editable set draft; Coda reads it aloud; **say `confirm` or `cancel`**. Spoken
  confirmation uses the latest edited card values and is exact-once. Bare yes/no stay owned by
  the verdict hot loop and never confirm drafts.
- **Today + help:** Today has an obvious date-scoped **Today's plan and intention** box whose
  text survives relaunch on this Mac and is included in Brain context. Settings now opens with
  **How to use CodaKiller**: one golden practice loop, instant-command examples, plain-English
  Brain behavior, confirmation safety, and honest limits.
- **Honest boundary:** v3.1.0 is a stabilization and the first safe operator slice, not the full
  autonomous Practice Operator. Brain still cannot infer a page-only measure range, hear/grade
  piano, edit Calendar or Goals by voice, persist unfinished voice drafts across relaunch, or
  interpret arbitrary consequential language. Those remain the next capability-registry work.
- **Evidence + release:** fresh-context verification found and forced fixes for stale edited
  voice drafts, a non-routing guide phrase, concurrent metronome publication, missing edition
  identity, and the compact HUD hiding the safety stop; its final result was **no actionable
  issue remaining**. Frontend **985 passed / 0 failed / 2 todo**; Rust **490 passed / 0 failed /
  11 ignored** plus every integration suite; strict clippy and production build clean; rendered
  720×520 browser drive verified guide/plan/receipt/HUD behavior. Live schema-10 database backed
  up (`(C) pre-v3.1.0-install-2026-07-20-000233.db`, SHA prefix `91e8c3fe`), then rechecked
  unchanged at 6 pieces / 63 blocks / 559 reps / 14 sessions, integrity clean, zero FK failures.
  Installed bundle 3.1.0 is sealed, Spotlight and a filesystem audit resolve exactly one active
  app, and the DMG checksum passes. Implementation commit: `36f21fd`.
- **Files:** receipt center; Rep HUD/shell; metronome/voice loop; Brain/Score context and action
  drafts; Today plan; Settings guide; release script/test timeout; design spec + implementation
  plan; every living vault doc and this version record.

## v3.0.4 — shipped 2026-07-17 (tag `v3.0.4`) — the UI repair pass ("un-clusterfuck")

### 2026-07-17 · Christian's fourth hands-on report: five UI defects, one shared root cause found

- **His report:** Score tab laggy and always defaulting to the BUTI chamber piece; the Practice
  tab "completely clustered with text, impossible to read"; "gradient buttons for selections";
  the metronome "impossible to see… low opacity… sitting in the corner"; and a general
  "clusterfucked with text" verdict — "the point is to make it frictionless: LESS to read,
  more to play."
- **The shared root cause (B33):** several v1-era stylesheets (the popover shell, the ck-*
  form kit, the metronome) consume ~40 old token names that the v3 retheme only aliased
  inside specific scopes. Anything mounted outside those scopes rendered transparent or
  unstyled: the metronome popover had **no background at all** (its `--surface-popover`
  token didn't exist) and opened downward off-screen from the bottom-rail button; the
  Practice form in the Score tab rendered as raw native controls — which is where the
  "gradient buttons" came from (macOS native selects/checkbox, not our CSS; the app never
  had gradient styles). The full legacy token set now lives globally, retiring the whole
  bug class; popovers flip above their trigger when there's no room below.
- **Frictionless pass, guided by his rule:** the practice form lost every explainer
  paragraph (~808 → ~320 chars), moved the review boundary into Advanced, dropped the
  section-lock line, and got a proper white Start button. The practice HUD is now a compact
  card — streak, tempo, three verdict buttons, note, Pause/Undo/Close — with contract,
  metrics, and rare controls folded behind a Details disclosure; the recovery desk no longer
  bursts open on every non-clean verdict; the safety stop hides once practice is stopped.
  Today/Ledger/Universe lost their aphorism and instruction paragraphs.
- **Score tab:** now remembers the last piece viewed (the alphabetical sort had made the
  heaviest piece — the BUTI chamber scans, 8.6 MB — the permanent default), and neighbor
  pages defer decoding until the visible page has the main thread, which is what made heavy
  scanned editions jank on open and page turns.
- **Gates:** npm **935 passed / 0 failed**; `tsc` clean; headless before/after screenshot
  audit of every workspace; fresh-context adversarial verifier CONFIRMED all six claims
  (token resolution, popover flip math, no orphaned form styles, every HUD callback still
  reachable, Score defaults, deferral semantics).
- **Files:** design tokens, popover shell, new shared form kit (`src/ui/forms.css`),
  practice form, practice HUD, Score workspace/viewer, Today/Ledger/Universe copy; this
  changelog, flaws register (B33), How To Use, `~/praelude/NOTES.md`.

## v3.0.3 — shipped 2026-07-17 (tag `v3.0.3`) — the Score tab's Practice button works

### 2026-07-17 · Practice tab in the Score workspace was completely dead — now wired

- **Christian's third hands-on report, fixed within the hour** (commits `5a521a1` + release
  bump). "Trying to practice the Griffes… if I click Practice, nothing shows up, literally
  nothing." Root cause: the score's Practice tab only renders its start-a-set form when the
  shell's practice-open handler reaches it — and the v3 Score tab mounted the score workspace
  **without that handler**, so the tab was silently empty. Practice still worked via
  Ledger → Pieces, which is how the parity audit missed it (it verified surfaces mount, not
  that this seam was threaded on the new Score tab path). **Now:** the shell passes its
  rep-open seam into the Score workspace; Practice on any section shows the block form
  (measures, tempo, attempts, clean streak) and an opened set appears in the shell-level
  practice HUD, exactly like the Pieces path. Logged as flaw **B32** (found-and-fixed).
- **Gates:** two new wiring tests (workspace + shell level, written failing first); npm
  **935 passed / 0 failed**; `tsc` clean; fresh-context adversarial verifier CONFIRMED the
  causal chain and probed the Brain-tab/no-props regressions clear.
- **Housekeeping:** the rogue claude-flow daemon had again dirtied the tree (an uncommitted
  timing edit in a Rust test + a failing stray test file); reverted/quarantined — none of it
  shipped. It is still running and will keep doing this until it's shut down properly.
- **Files:** the shell workspace mounting + Score workspace seam, this changelog, flaws
  register (B32), `(C) How To Use` Matches bump, `~/praelude/NOTES.md`.

## v3.0.2 — shipped 2026-07-17 (tag `v3.0.2`) — target-draft dock fix + wizard measure prefill

### 2026-07-17 · Target-draft dock no longer blocks the Score view + wizard pre-fills measure numbers

- **Christian's second hands-on report, fixed within the hour** (commits `6a32bc8` + `851994c`).
  The target-draft dock ("Mark the music first.") used to float pinned over the Score view's
  top corner even with no box drawn, unmovable, blocking controls. **Now: no floating panel
  exists until a box is drawn** — a quiet toolbar hint carries discoverability instead. Once a
  draft exists, the dock is **collapsible to a slim bar and repositionable** (top-right ⇄
  bottom-right corner toggle) and structurally cannot cover the page controls. The wizard's
  auto-offer dialog is now **dismissible** and no longer force-opens on pre-mapped pieces.
- **New (Christian's ask, "use the measure numbers if present"):** the mapping wizard now
  pre-fills each system's measure number, in priority order: **(a) existing calibration
  anchors** — on his six pre-mapped pieces, clicking a known system fills its exact printed
  number; **(b) the PDF's text layer** when one exists (standalone left-margin integers,
  validated monotonic + within XML total) — tagged **"from score"**; **(c) prediction** after
  ≥2 entries (last + median bars-per-system, clamped) — tagged **"estimated"**. Values are
  always visible/editable; **"Add line"** remains the confirm action; typing over a prefill
  clears its tag. **Honest limitation:** scanned editions have no text layer — they only get
  anchors/prediction, never OCR of the page image (this S2 behavior is unchanged).
- **Gates:** npm **728 passed / 0 failed**; `tsc` clean; headless drive with dock-count/prefill
  evidence, zero console errors.
- **Files:** the Score workspace's target-draft dock + mapping wizard, this changelog, `~/praelude/NOTES.md`.

## v3.0.1 — shipped 2026-07-16 (tag `v3.0.1`) — same-night Score view paging fix

### 2026-07-16 · Score view converted from a continuous strip to a true paged PDF reader

- **Christian's first hands-on feedback on v3.0.0 came in within the hour: "too laggy —
  rendering the whole 25-page PDF as one long strip; sections panel pins/scrolls with it;
  generally like it a lot better though."** Fixed same night (commit `92cfdb7`).
- **Score view now opens ONE page fit to the window** instead of a continuous scrolling
  strip. Navigate via **‹ › buttons**, **typing a page number**, or **PageUp/PageDown/←/→**.
  **Only the current page ±1 ever render** — never more than 3 canvases at once, verified on
  the real 25-page document. Zoomed pages scroll within their own pane, and the
  tricky-sections panel now scrolls **independently** of the score instead of pinning/
  scrolling with it.
- **"Open on score" / measure jumps still land on the right page** — all box-drawing,
  mapping-wizard, and anchor behavior is unchanged (the geometry is per-page).
- **Gates:** npm **706 passed / 0 failed**; `tsc` clean; zero console errors in the drive.
- **Files:** the Score workspace's paging/rendering logic, this changelog, `~/praelude/NOTES.md`.

## v3.0.0 — shipped 2026-07-16 (tag `v3.0.0`) — complete frontend rework, installed

### 2026-07-16 · v3.0.0 shipped + installed

- **The complete v3 frontend rework is now installed** at `/Applications/CodaKiller.app`,
  replacing v2.0.0 (which never installed) directly. Every phase (0 through 7) that had been
  verified in source over the course of the day — the Brain online fix, the monochrome
  design system/shell/Settings, the Brain workspace rebuild, the Score wizard + 288-anchor
  premap, the Today workspace + performance audit, the Ledger + Calendar workspaces, and the
  Universe force-graph rebuild — is now live in the shipped app: pure black-and-white dark
  shell with five rail tabs (Today/Score/Brain/Ledger/Universe), the Map-this-score wizard
  replacing the old dead-end mapping button, a live d3-force Universe galaxy, and a working
  Brain (`● online — gemini`).
- **Phase 8 (package + install) is now complete.** The 288 pre-mapped anchors across
  Christian's six pieces were injected into the live database through the validated
  `score_calibration_save` path, rehearsed first on a disposable copy, with a fresh backup
  (`(C) pre-v3.0.0-install-2026-07-16.db`, SHA prefix `3d18c0ba`) taken immediately before the
  live injection. A parity audit checked every row of the original P0 inventory against the
  final app — every control/view either checked off as present or explicitly approved as a
  deliberate removal (e.g. the dead "Mapping required" button, the orphaned old v2
  `Shell.tsx`).
- **Final gates:** npm **706 passed / 0 failed / 2 todo**; cargo **518 passed / 0 failed**;
  `tsc` clean. **Final commits (main):** `56dada3` (style), `c53230a` (pieces-gap close),
  `b2e751f` (version bump); tagged `v3.0.0`.
- **Verified installed and running.** The native launch shows the v3 monochrome shell,
  the Brain online, and the live Universe galaxy — this is the first time any of the P7/v3
  work has been visible outside source or a dev-mock browser harness.
- **Honest gaps carried forward (see [[(C) Flaws]] and the new
  [[versions/(C) v3.0.0 — Version Record]] for the full list):** voice-over-Steinway
  acceptance still needs Christian at the piano; auto-OMR (S2) is not built — the wizard +
  pre-supplied anchors are used instead; natural-language voice section-start (V2) is not
  built; the retention FLOW beyond the existing queue (rest of P6) is not built; durable
  Universe layout persistence is deferred; B25 (history-at-scale reflow) stays open; the
  repo remains local-only — `gh auth login` → push is still the #1 infrastructure risk.
- **Files/docs:** the complete `src/` v3 workspace tree (all five rebuilt workspaces), the
  288-anchor premap injection, `package.json`/`src-tauri/tauri.conf.json`/`Cargo.toml`
  version bumps, this changelog, the new version record, and every other living vault doc
  refreshed under the update protocol.

## v2.0.0 (superseded by v3.0.0 — never installed) — P7 Practice OS transformation

### 2026-07-16 · Universe workspace rebuilt as a live d3-force galaxy (Phase 7, source, verified — the last workspace)

- **The Universe view is now a movable, click-through d3-force galaxy** (commits `0d076d9` +
  `11dff60`, wheel-zoom fix `705f872`) — the "Obsidian graph view where you can click on
  practice sessions" Christian asked for. **Pieces render as suns** (size = earned focused
  time, log scale); **practice sections are planets** (size/brightness = honest mastery
  state); **sessions are satellites**, with older sessions aggregating into expandable
  cluster nodes. Everything drags with spring physics — pin on drag, reheat, settle after
  release — plus pan and bounded zoom. Hover lights up a node's neighborhood and dims
  everything else. **Click opens a detail panel:** reps, cleans, mastery, last practiced,
  plus jump-to-Ledger and jump-to-score links. All the app's color now lives in this one
  view against a pure black background; the rest of the app chrome stays monochrome.
  Earned-growth/anti-gaming logic is untouched — this is a frontend visualization change
  only, backend unchanged.
- **Performance was specifically engineered for Christian's 8GB machine:** event delegation
  instead of per-node listeners, memoized gradients, one state update per animation frame
  (not per simulation tick), the simulation sleeps at rest and fully tears down on tab
  close. Verified: node positions are stable once the simulation settles, zero background
  CPU usage at rest, clean unmount.
- **Verified hard:** a fresh-context adversarial verifier independently returned
  **CONFIRMED**, with exactly one narrow issue found — a benign console error on every
  wheel-zoom tick, caused by React 19 registering root wheel listeners as passive (so a
  `preventDefault` inside them warns/errors). **Fixed the same day** by attaching a
  non-passive wheel listener via a ref instead of the synthetic `onWheel` handler (commit
  `705f872`). Full suite after the fix: **704 passed / 0 failed / 2 todo**.
- **Honest caveats:** dragged/repositioned node positions currently persist only for the
  duration of the app session — deterministic seeding keeps the "sky" looking stable across
  separate app opens/closes, but there is no durable per-node layout persistence yet; that
  would need a small new backend command and is deferred to Phase 8+, not forgotten. The
  click-to-open detail panel only shows fields the earned-growth snapshot actually carries
  (rep counts, cleans, mastery state, last-practiced date) — it does **not** show streak or
  tempo detail, since that lives in the Ledger view and the snapshot only has counts, not
  full session rows. Source-only — the installed app is unchanged, still v1.3.0.

### 2026-07-16 · Ledger + Calendar workspaces rebuilt monochrome (Phase 6, source, verified)

- **Ledger — disclosure-first drill-in** (commits `7a7b590`/`37002b5`/`05353b1`): piece → block →
  attempts loads on expand rather than dumping the whole history flat. The read-only anomaly panel
  is preserved unchanged. Block titles gained **inline SET-TITLE editing** (`block_update`), while
  attempts remain append-only, immutable evidence — corrections and voids keep the original entry
  visible in the ledger rather than overwriting it (**"The original stays in the ledger"**).
  Destructive block-delete was deliberately **not** surfaced anywhere in the UI.
- **Calendar — monochrome week view**, recovery review, and a capacity control, mounted together
  with Ledger in **ONE nav slot** behind a quiet in-workspace Ledger|Calendar switch — the
  five-tab shell contract (Today/Score/Brain/Ledger-or-Calendar/Universe + Settings) stays intact.
- **`devMock` gained `rep_check`/`reps_for_block` handlers**, so the mock `dev:mock` harness's
  Clean action now yields a real green receipt instead of silently no-opping.
- **Old hued CSS vocabulary remapped to the monochrome system via scoped token aliases** — the
  fresh-context verifier traced every alias to its resolved value: all neutral except the two
  semantic signal colors (error red / success green).
- **Gates:** full suite **695 passed / 2 todo**; `cargo test` **484 passed / 0 failed** (backend
  untouched by this phase); a headless browser drive showed zero console errors.
- **Verified hard:** a fresh-context adversarial verifier independently returned **CONFIRMED in
  substance** across commits `7a7b590`/`37002b5`/`05353b1`, with two accuracy notes worth keeping:
  (a) a **second, pre-existing load-contention test flake** exists —
  `src/features/retention/RetentionQueue.test.tsx` "validates snooze dates" fails under the full
  parallel suite but passes 14/14 isolated, the same class of flake as the pre-existing
  `pdf-assets` timeout — isolate before believing a failure here; (b) `RegionEditor.tsx`'s 7-color
  region palette is chromatic but is **user-data color on the score**, explicitly allowed by the
  v3 design, pre-existing and untouched — **not** a monochrome violation.
- **Honest caveat:** source-only — the installed app is unchanged, still v1.3.0.

### 2026-07-16 · Today workspace (Phase 5) rebuilt monochrome + frontend performance audit (source, both verified)

- **Phase 5 — the Today workspace and practice surfaces are rebuilt on the v3 monochrome kit**
  (commits `29d88f2`/`75acdc5`/`78eb5e8`/`da468bf`, follow-up fixes `b3e53f2`). The **Rep HUD**
  now uses mono numerals throughout (measures, N-of-M, streak, focus clock, tempo), **Clean** is
  the single solid primary action, focus time is pause-aware, the ladder state reads plainly, and
  the old decorative rings are gone. The **Receipt Center** gets an unmissable green/red save
  receipt restyle — CSS-only, its underlying logic byte-identical to before. The **Session
  Composer** flow (candidates → editable routine → Start) keeps Start as the ONLY write — the
  receipted `session_plan_start` — machine-verified unchanged. The **retention queue**
  (due/snooze/confirm/lower/reopen) and the **voice surfaces** (mic/STT toast, wake-cue confirm
  card) plus the **session event bar** now live at SHELL level so they persist across every tab,
  not just Today; the voice wiring itself is token-identical to the old v2 shell (verified by
  direct comparison). **Gates:** full suite **691 passed / 0 failed**; a headless browser drive
  showed zero console errors. **Verified hard:** a fresh-context adversarial verifier independently
  returned **CONFIRMED all 7 sub-claims**.
- **Frontend performance audit** (session ledger items 12–18; report committed at
  `~/praelude/docs/qa/2026-07-16-frontend-perf-audit.md`). Three read-only analysis lanes
  produced 14 findings; a fresh-context verification pass re-read every cited line and killed
  most of them — an invented "250 ms tick," serial-IPC cost models that don't match the real
  architecture, proposed fixes that couldn't have worked, and findings in code Phase 7 is about
  to replace. **One real bug survived and was fixed the same day (commit `b3e53f2`):** a Tauri
  `listen()` cleanup race in the new ScoreView — the `score://navigate` subscription could orphan
  with a stale closure — fixed with the alive-guard pattern. **Overall verdict:** the codebase's
  async hygiene is genuinely good; 14 leak-prone-looking patterns were checked and came back
  clean. Lesson for future audits: always fresh-context-verify perf claims before trusting them.
- **Honest caveat:** both items are source-only — the installed app is unchanged, still v1.3.0.

### 2026-07-16 · Score mapping wizard + 288-anchor pre-map lands in source (Phase 4)

- **Root cause found: the `score_edition_calibration` table was orphaned.** It has existed
  since schema v8, but no IPC command could ever read or write it — the Score workspace's
  "Mapping required" button led nowhere. Fixed under a documented freeze exception (**#2** in
  the plan): two additive backend commands, `score_calibration_save` and
  `score_calibration_get`. Save is strictly validated server-side — typed points
  `{page, y, measure}`, `y` rejects NaN/Infinity, point count bounded ≤2000, method forced to
  `'user_confirmed'`, canonical re-serialization before storage, UPSERT semantics. No schema
  change. Full Rust suite **484 passed / 0 failed**.
- **On top: the Map-this-score WIZARD** (commit `1a8ddd9`). Christian clicks each system's
  start and types its measure; partial maps are valid; drawn boxes then resolve live to an
  editable measure range via the interpolation engine from Task 4.1. The old "Mapping
  required" dead-end button no longer exists in production code — the first box drawn on an
  unmapped score now auto-offers the wizard instead. The Score workspace chrome is now
  monochrome (user annotation marks keep their colors).
- **All six of Christian's pieces were pre-mapped by reading their actual PDF editions
  page-by-page** (commit `b88c7ae`, `docs/qa/premap/`): Scherzo Op.31/Ekier 120 anchors
  (XML-validated, 780 measures); Beethoven Op.90 mvt.1/Henle 36 anchors (XML offset 0;
  discovered the XML's LH part is truncated at m.160 — a conversion artifact); Étude Op.10/4
  Cortot 27 anchors (chain 83; corroborated by Cortot's own "Bars 79–80" citation); Prokofiev
  Op.1/Jurgenson 76 anchors (chain 240; no printed measure numbers in that edition); Griffes
  Lake at Evening 12 anchors (XML 67; matched via clef/dynamics signatures, with a few honest
  low-confidence coda seams flagged); Barber Pas de Deux primo 17 anchors (chain 81; m.1
  convention noted — edition prints no measure numbers). **Total: 288 anchors.**
- **Injection into Christian's live DB happens only via the new validated save path**,
  rehearsed on a disposable DB copy first, at install time with a fresh backup (Task 4.3,
  still pending).
- **Honest caveats:** this is source-only — the installed app is unchanged. Auto-OMR (S2) is
  still NOT done; this is user-resolvable + pre-supplied mapping, not automatic recognition.
- **Verified hard:** a fresh-context adversarial verifier independently returned **CONFIRMED
  all 7 sub-claims**.

### 2026-07-16 · Brain workspace rebuild lands in source (Phase 3)

- **The Brain workspace was rebuilt on the v3 monochrome kit** (commit `68213d5`): a
  single-column chat transcript with typed Q&A — one-glance answers paired with citation
  chips — replaces the old free-form layout.
- **A persistent, truthful status line** now sits at the top of the tab — `● online —
gemini` / `○ offline — <reason>` — fed by a new `brain_status` command, so the workspace
  never silently lies about whether the Brain can actually answer.
- **Per-piece conversation memory** is wired in: a piece selector plus resume/clear controls
  let a conversation persist per piece and be explicitly cleared, matching the existing
  `brain_thread`/`brain_turn` backend.
- **The intake-review and work-suggestion surfaces are preserved**, tucked behind
  disclosures rather than dropped.
- **Wake-cue voice UI is intentionally NOT in this tab** — Voice is its own parity row and
  arrives with the Today/voice phase, not here.
- **The dead v2 shell was deleted**: `src/components/Shell.tsx` + its test + its CSS were
  removed after proving zero importers. This also removed the long-standing stale "Version
  1.3.0" failing test that lived only in that orphaned file.
- **Gates:** the full suite is now **744 passed / 0 failed / 9 todo**; `tsc` clean;
  headless-browser QA showed the Brain tab mounting with zero console errors.
- **Verified hard:** a fresh-context adversarial verifier independently returned **CONFIRMED
  7/7**.
- **Honest caveat:** this is source-only — the installed app is unchanged, still **v2.0.0**
  in progress / **v1.3.0** installed. Also confirmed today: Christian's live database is
  now at **schema 10** (his v2.0.0 first-launch migration ran cleanly), observed from a
  read-only copy — the live DB itself was never opened.

### 2026-07-16 · v3 monochrome design system + five-workspace shell land in source (Phase 2)

- **The v3 foundation is built.** `src/design/tokens.css` is fully rewritten to a pure
  black-and-white, dark-only token system — base `#0e0e10`, and the ONLY colors anywhere in
  chrome CSS are the two semantic signals: error red `#ff5c5c` and success green `#4ade80`.
  Every serif font stack (New York, Iowan, Palatino, Baskerville, Georgia) and every
  terracotta/brown hex is gone — system-ui sans, with mono reserved for numerals only.
  Commits `703788e`, `01451a5`, `0b2a389`, `0b7386b`.
- **A minimal component kit now exists in `src/ui/`:** Button (primary = solid white
  inversion, or text — no outlined variant exists at all, enforced by a test), Panel,
  Disclosure, Dialog, Receipt.
- **A new five-workspace shell** — Today, Score, Brain, Ledger, Universe, plus a Settings
  utility — replaces the old layout: a quiet text-button left rail, one staggered entrance
  animation, and zero looping motion. Workspaces lazy-load; the four not yet rebuilt (Score,
  Brain, Ledger, Universe content) are honest stubs, not fake content.
- **Settings was rebuilt disclosure-organized**, with every prior control reachable (checked
  against the full inventory — nothing lost), plus a new BrainConnection block that shows the
  Brain's real state — `● online — gemini` / `○ offline — <reason>` — from the new
  `brain_status` command, and a Test-connection button (`brain_test_connection`) that reports
  the model + latency or the exact error, instead of guessing.
- **Verified hard:** a fresh-context adversarial verifier independently CONFIRMED all 7
  sub-claims — a monochrome grep across every chrome CSS file, the no-outlined-button
  guarantee, the shell structure, Settings parity against the inventory, the test suite, that
  `src-tauri` was untouched, and a headless-browser `dev:mock` run with zero console errors.
  `npm test`: **629 passed / 1 failed**, where the 1 failure is a **pre-existing** stale
  "Version 1.3.0" assertion in the orphaned old shell test (`src/components/Shell.test.tsx`,
  predates this work — not caused by it). `tsc --noEmit` clean.
- **Honest caveats:** this is source-only — the installed app is still v2.0.0-in-progress /
  v1.3.0, unchanged. The other four workspaces (Brain chat, Score/mapping, Today, Ledger,
  Universe) are still stubs; their rebuilds are Phases 3–7 and have **not** started. Christian's
  design verdict on the new shell (screenshots already shown to him) is **pending** — the
  visual workspace builds are deliberately held for his approval before going further.
- **Files:** `src/design/tokens.css`, `src/ui/` (new component kit), the new five-workspace
  shell components, the rebuilt Settings workspace, `~/praelude/NOTES.md`, this vault set.

### 2026-07-16 · Brain online fix (source) + v3 frontend rework begins

- Diagnosed live against the real Gemini API why "Brain always says offline" persisted even with a
  configured key: (1) the default model was `gemini-3.5-flash`, which is NOT a listed model for
  this account despite the code's "verified" comment — every request 404/failed; (2) transient 5xx
  and transport errors were swallowed with only `eprintln!` and no retry, so one transient 503
  permanently dropped the session to offline; (3) the stored Keychain key (`codakiller`/`gemini`)
  had been overwritten with an EMPTY value, so no provider was ever actually configured. Fixed in
  commits `550af13`, `c3b5271`, `3028d3e`, `92dbed1`: default model → `gemini-flash-latest` (a
  listed stable id); `ProviderChain::ask` retries the same provider once on transport-error/5xx
  before falling through (never retries 4xx); offline failures now return a truthful reason instead
  of being swallowed; `api_key_save` rejects an empty/whitespace key so a blank can never be stored
  again; new IPC `brain_status` / `brain_test_connection` let the UI show `● online — <provider>` /
  `○ offline — <reason>` and run a real round-trip test. The empty Keychain key was re-stored from
  the user's existing key. Verified: full Rust suite 473 passed / 0 failed (backend-freeze held —
  only brain code + the `api_key_save` guard changed); a live round-trip with the corrected model
  returned a valid answer (attempt 1 hit a 503, attempt 2 succeeded — exactly the case the retry now
  absorbs); fresh-context adversarial verifier returned CONFIRMED. **Honest caveat:** this is fixed
  in SOURCE only — the installed app is still v2.0.0-in-progress/v1.3.0 with the bad model baked in,
  so restoring the key alone does not fix the installed app; it goes live only when a v3 build is
  installed. This lands as Phase 1 of the newly-started v3 frontend rework (monochrome dark
  retheme, score-mapping wizard, force-graph Universe — approved, not yet built).

- The corpus proved the instant firewall never mishears you into a mutation — but that's also why
  almost nothing you _say_ conversationally becomes tracked. This closes that gap, on the trigger
  model you chose: **when you say "Coda, ..."** and ask to record or change something in plain
  language, the Brain proposes a **typed, confirm-first draft** — record this as clean, set the
  metronome to 120, undo the last rep, restart the streak. It shows as a small card; **nothing
  happens until you press Confirm.** Four actions in this first cut; "set a session goal" is held
  back until it has a real backend home.
- Why this is safe (and stays honest to the golden rule): the instant hot-loop is **completely
  untouched** — this rides the async Brain path, only on the wake-cue, so none of your ambient
  practice talk can ever trigger it (the 1,309-segment corpus has zero "Coda" and stays zero-draft
  by construction). The Brain only _proposes_; a strict validator drops anything malformed or
  out-of-range (a garbled suggestion just becomes a normal answer, never a bad card, never a
  crash); and only your explicit Confirm runs the existing command. Verdict/undo/restart won't
  even offer Confirm unless a set is actually open.
- **Verified hard** — this is the app's most delicate surface, so it got an independent adversarial
  pass on top of the build's own: no path from a proposal to a mutation without your click,
  malformed proposals proven to drop (on a genuinely fresh recompile), typed questions never carry
  a draft, and the card text is generated by the app (never the model's words, so it can't be
  used to mislead a Confirm). Gates: Rust 465, frontend 615, build green.
- **What's yours to tune:** the FEEL of these confirm cards — how they read back and how you
  approve them hands-free at the piano — is deliberately left for a session with you. This shipped
  the mechanism; you shape how it feels. (Installed app stays v1.3.0, so the tutorial is unchanged
  until v2 packages — at which point "Coda, ..." grammar goes into How To Use.) _(Opus 4.8.)_
- **Files:** `src-tauri/src/brain/{mod,provider}.rs` (typed proposal + validation + voice gate),
  `src/features/voice/{domain/proposedAction.ts, ActionDraftCard.tsx}`, `src/features/brain/
BrainWorkspace.tsx`, `src/components/Shell.tsx`, repo `NOTES.md`, this vault set.

### 2026-07-16 · First real-browser QA pass (objective): all five workspaces render cleanly; fixed a grammar bug, confirmed the Calendar overflow

- Ran the dev-mock harness through a real headless browser and looked at every workspace. Good
  news first: all five (Today / Atlas / Ledger / Calendar / Universe) mount with **zero console
  errors** and render meaningful, well-composed content — the off-white/ink/terracotta design
  language is holding up (Today's "Make one thing reliable.", the Universe's earned-evidence
  framing with the anti-gaming growth rule right in the UI, the Ledger's immutable-evidence
  history, Atlas's score list). This is the first time the v2 UI has ever been _seen_ in a browser.
- **Fixed:** Calendar's missed-work banner read "1 missed item **need** a decision" — subject/verb
  disagreement on the singular case. Now "needs" (CalendarWorkspace.tsx).
- **Confirmed (logged to B25, not fixed — needs a responsive-design decision):** the Calendar's
  seven-day grid overflows at a 1280px window — Saturday is clipped and Sunday scrolls off. This
  is the "88rem min-grid" flaw; it needs Christian's call on how the week should reflow.
- This was strictly OBJECTIVE QA (crashes / console / layout / overflow). The subjective aesthetic
  pass (does it hit the apple.com-grade bar) is still Christian's. Gates: vitest 604, build green.

### 2026-07-16 · The v2 UI can now be opened in a browser (dev-mock harness for visual/design QA)

- The entire v2 interface had only ever been tested in a headless test environment — it had never
  actually been _rendered_ in a browser. There's now a dev-only harness (`npm run dev:mock`) that
  serves all five workspaces (Today / Atlas / Ledger / Calendar / Universe) in a plain browser with
  realistic sample data (a Scherzo and a Griffes piece, an earned Universe with planets, retention
  items, anomalies, goals) — so you can finally _look_ at the v2 UI and do a design pass.
- It's strictly a development tool: flag-gated so the real app is byte-for-byte unaffected (proven —
  the production build sheds the mock entirely), no functional behavior, just static rendering. The
  actual aesthetic judgment (does it hit the apple.com-grade bar, any AI-slop) is yours to make.
- Verified: frontend-only (no Rust touched), real path untouched, 604 frontend tests (incl. 5 new
  smoke tests that mount each workspace through the mock), both builds green. _(Opus 4.8; first
  attempt stalled over-engineering the event surface — the retry no-op'd events, since a static
  render harness needs mounting, not live event pushes.)_
- **Files:** `src/devMock/` (new), `src/main.tsx` (flag guard), `package.json` (`dev:mock`),
  `README.md`, repo `NOTES.md`, this changelog.

### 2026-07-16 · Brain answers better (concise, remembers, knows where you are); conversational voice-control deferred to a piano session

- **The Brain now answers at one glance by default** — 1–2 sentences, no preamble, expanding only
  when a question needs the detail (like a drill's exact reps and tempo). One change to the shared
  policy covers both the Claude and Gemini paths. (Flaw B26: "answers are too long.")
- **Conversations survive a relaunch now.** Talk to the Brain about a piece, quit, reopen — it
  picks the thread back up. Each piece keeps its own bounded memory (the last ~20 turns), and a
  "Clear / new conversation" control starts fresh without ever deleting the old thread. This wires
  up the `brain_thread`/`brain_turn` tables that had sat unused since the v8 schema. (B26:
  "conversation disappears on relaunch.")
- **The Brain now knows where you actually are in the practice arc** — what's due for review
  (retention) and your recent recovery actions (streak resets, tempo backoffs) are fed into its
  grounding, capped and read-only, so its answers reflect your real state, not just the score.
  (B26: "no retention/ledger context.")
- **Deliberately NOT built — deferred to a session with you at the piano:** turning your
  _conversational_ speech into practice actions (spoken verdicts, undo, restart, session goals as
  natural language, not command grammar). The corpus proved the deterministic firewall never
  false-fires, but it also can't tell whether a confirm card popping up mid-practice feels helpful
  or annoying — only you at the Steinway can tune that, and it touches the "the LLM is never in
  the instant loop" rule. So the Brain gained zero ability to change practice state this slice; it
  only answers better and remembers. That conversational-control layer is the next thing to build
  _together_, with the narrated corpus as its test.
- **Verified:** the practice-mutation boundary was independently re-checked (the only new writes
  are the Brain's own conversation; every practice-table write in the diff is test-only). Gates:
  Rust 458 lib tests, strict clippy; frontend 599; production build. Flaw B26's answer-quality
  half is done in source; its typed-action half stays open with the deferred voice work.
- **Files:** `src-tauri/src/brain/*` (provider policy, memory wiring, retention/ledger context),
  `store/crud.rs` + `store/practice_loop.rs` (read accessors + thread CRUD), `lib.rs` (2 new
  read/memory commands), `src/features/brain/*` (resume-on-open + clear control), repo `NOTES.md`,
  this vault set. _(Opus 4.8 ran this checkpoint under the takeover protocol.)_

### 2026-07-16 · The entire narrated corpus (1,309 segments) now replays with zero false mutations; anomaly disclosure UI added

- **All four real practice recordings are now deterministic regression fixtures.** griffes (79
  segments) plus the three scherzo sessions (721 + 201 + 308) — **1,309 segments in total** —
  replay through the production voice router with **zero false mutations, zero phantom reps,
  zero misfires**. Verbatim fidelity was machine-checked: every segment's text and timing is
  byte-identical to the original Whisper transcription, so nothing was massaged to pass.
- **Why this matters, honestly:** these are recordings of Christian _talking through his
  practice_ to a future coach, made while the app wasn't running — so he never speaks in clean
  command grammar. The firewall correctly ignores every buried "turn the metronome on", every
  garbled measure number, every conversational "done"/"again". That is the app's core safety
  promise ("the app is the memory, never the judge") proven against 91 minutes of the messiest
  real input, not curated test strings.
- **The finding that shapes what's next:** the deterministic hot-loop is rock-solid — and that
  is exactly why almost none of Christian's natural spoken practice currently becomes tracked
  state. The real leverage gap is the **natural-language draft/confirm path** (Tier B): today it
  only handles opening a rep tracker, not spoken verdicts, tempo changes, session goals, undo,
  or restart. Three sessions surfaced six such moments and flagged them honestly for review
  rather than guessing. This is the spec for the next voice/Brain slice — broaden the _confirm_
  layer, never loosen the instant hot-loop (which would bring back the false mutations the
  corpus proves are currently zero).
- **Anomaly disclosure panel** added to the Ledger workspace: a read-only, collapsible view of
  the migration's 792 projected data anomalies, grouped by kind, each with a plain-language
  "what this means" and "why it is disclosed, not repaired" — staying strictly on the shape of
  the stored data, never judging the playing. No fix/edit actions (the audited correction flow
  is deliberately later work); honest empty state for a clean database.
- **Verified:** both new lanes (anomaly UI, harness refactor) passed fresh adversarial review
  (SHIP); corpus fidelity independently re-proven. Gates: Rust 449 lib + all narrated/gate
  suites, strict clippy; frontend 596; production build. **Flaws B22 stays Open** (source-only;
  resolves only when the installed app shows it). _(Opus 4.8 completed this checkpoint after
  Fable 5 was switched out mid-edit — takeover protocol.)_
- **Files:** `src-tauri` (`anomalies.rs` new + read command, `tests/replay_common/` shared
  harness, three `tests/narrated_session_scherzo*.{rs,json}` fixtures), `src/features/ledger`
  (AnomaliesPanel), `scripts/gen_narrated_session_fixture.py`, repo `NOTES.md`, this vault set.

### 2026-07-16 · Mounted the Session Composer with receipted plan-starts; a full real narrated session now replays deterministically

- **The Session Composer is real in Today.** Compose a reviewed session, press Start — the only
  write — and the first item's rep set opens durably through the same receipts machinery as every
  other mutation; each remaining item starts explicitly, one at a time, with the one-live-set rule
  surfaced honestly ("close the current block first"). Goal-only items say "No measure target to
  open" instead of offering a dead button. The plan's durable record is the start receipt itself —
  the `action_draft` table was deliberately NOT bent to fit (its constraint only admits
  voice/brain drafts), and no schema changed.
- **The narrated replay harness exists** and drives real sessions through the production
  routing/state machinery — live mode, the 2.5-second duplicate window, streaks, contract
  mastery. The complete griffes session (79 real segments, an hour of note-hunting narration)
  replays with **zero false mutations**: every buried command token and ambiguous number run
  correctly routes to Ignored. That is the firewall's core promise proven on a full real
  recording, not curated strings.
- **Stateful mechanics the quiet session couldn't exercise are self-proven:** the
  identical-"done" resend chain collapses three sends into one rep; "again" resets the streak;
  mastery arrives on the fifth consecutive clean by contract, never attempt count. Progressive
  `90→96` single-action collapse stays explicitly open — deferred, not faked.
- **Verified:** fresh adversarial review = **SHIP** — the riskiest change (extracting the shared
  set-open path) diffed line-by-line with zero drift; the harness's mirroring of production
  dedup semantics was checked against the real code; one benign, UI-unreachable replay edge is
  documented. Gates: Rust 445 + all gate suites, strict clippy; frontend 592; production build.
  Remaining for the corpus: the three scherzo sessions (1,230 segments) via the preserved
  converter.
- **Files:** `src-tauri` (`store/session_plan.rs` new, `practice_v2.rs` open-path extraction,
  `rep/mod.rs`, `lib.rs`, `tests/narrated_session_replay.rs` new + griffes fixture), `src`
  (Today mount + `useSessionPlan`, one Shell line), `scripts/gen_narrated_session_fixture.py`,
  repo `NOTES.md`, this vault set.

### 2026-07-16 · Recovered the interrupted night build; the practice loop is now durable and adversarially proven

- **Why:** the July 15 overnight build (a multi-agent Codex run asked to implement the full v2
  notes) hit its vendor usage lockout at 21:28 mid-edit — 84 uncommitted files that didn't
  compile, its own reviewer's NO-SHIP with eight semantic blockers, and the blocker-fix pass
  half-applied. Today's session repaired, finished, and re-verified that slice. The live
  database was never touched.
- **Blocker verdicts (one adversarial verifier per blocker):** seven of eight fixes were already
  correct in code but proven by nothing; the eighth was a live defect — a history repair
  (undo/correct/reverse) could silently flip a **mastered set back to active**. Fixed (mastered
  now preserves terminal lineage like every other terminal state) and locked by a regression
  test that demonstrably failed on the old code.
- **Every blocker now has proof:** replaying a safety stop can never repeat the physical audio
  stop (and a concurrent resume can't overtake it); a retried command can never create a phantom
  second session; recovery anchors on the physical attempt watermark even when the newest
  attempt was voided; sleeping the laptop mid-set caps focused time at one minute and a backward
  clock is rejected outright; receipts expose `command_id`/`replayed`/`committed_ts` on the
  wire; retention refuses impossible calendar dates (2026-02-30) and mismatched or incomplete
  evidence at every entry point. Three of these tests were proven to bite by temporarily
  re-breaking production and watching them fail.
- **Score Atlas targets actually save now.** "Draw target" previously called a backend command
  that didn't exist — every save died at the IPC boundary. The command is implemented end to end
  (one transaction: Region + target metadata + event; idempotent through the same durable-receipt
  machinery; zero schema changes), and the tricky-sections sidebar no longer sticks hidden when
  switching pieces mid-draft — the exact bug the interrupted author was hunting.
- **Voice set-opening has one owner.** The deterministic hot loop's routing decision now rides
  every transcript event, so the natural-language draft card can never double-open a set the
  backend already opened. Duplicate/stale spoken deliveries surface concise feedback; dead
  half-wired voice outputs were removed.
- **Session Composer stays unmounted on purpose:** the component is complete and tested, but an
  honest Start button requires a backend "start a reviewed session plan" command that doesn't
  exist yet — that decision opens a later slice.
- **Verified:** fresh whole-tree adversarial review = **SHIP**. Rust 436 library tests + all
  gate suites, strict clippy; frontend 587 tests / 63 files; production build. The real-backup
  rehearsal now lands **schema 10** with every count, hash, sentinel, and anomaly invariant
  exact — and reopening an already-migrated copy is proven a no-op. Installed app still v1.3.0.
- **Files:** `src-tauri` (practice_v2 fix, new `store/score_atlas.rs`, `lib.rs`,
  `voice_loop.rs`, rep/ledger/model tests), `src` (Shell, ScoreView, voice/*), repo `NOTES.md`,
  this vault set.

### 2026-07-15 · Cut the source RepEngine over to one authoritative, append-only practice truth

- Replaced v1's “attempt count means done” runtime path in the active source tree. Every new set
  captures a configurable consecutive-clean contract (default five); clean/flawed/failed attempts
  project exact tries, current/best streak, resets, accuracy, recovery debt, review boundary, tempo
  path, and verified/unverified mastery. A planned attempt count now prompts review and can never
  manufacture mastery. Tempo mastery requires the clean proof at or above the target condition;
  metronome-on technique work may retain factual BPM but cannot climb the tempo ladder.
- Made the set/attempt/event path transactional through the schema-v8 sidecars and added the
  additive **schema-v9 one-live-set invariant**. Relaunch restores exactly one active/paused set;
  malformed multiple-live state fails visibly instead of pretending no set exists. Original v1
  tables, IDs, values, and the 127 exact metronome-off `0 BPM` compatibility sentinels remain
  physically unchanged. Only that exact sentinel projects as “tempo not applicable”; corrupt
  negative/zero tempo evidence now rejects loudly without rewriting history.
- Added real append-only **Undo, Correct, Reverse adjustment, and Restart set** commands. Original
  attempt rows and historical set metadata are immutable; correction note omission preserves the
  note while explicit blank clears it; tempo and ladder projections reverse correctly; and
  restarted, abandoned, or closed-unresolved lineage cannot be silently promoted by a later edit.
  Metrics, planner signals, Brain context, history, and Markdown export all exclude voided attempts.
- Rebuilt the active source HUD/history around that Rust projection: explicit contract and mastery
  labels, current/best streak, accuracy, resets, review boundaries, provenance, nullable tempo,
  adjustment lineage, confirmations, global receipts, and a persisted 3/5/7/10/custom default.
  Historical block update/delete now reject; historical attempt “delete” appends a void.
- Fresh adversarial review found and fixed delayed-open/voice state resurrection, concurrent verdict
  retune loss, manual-metronome ownership races, initial metronome-readiness loss, closed-HUD
  fallback mismatch, hidden restore errors, stale cross-piece history, failed-note draft loss,
  non-latest adjustment feed corruption, and keyboard/focus gaps in inline editing and confirmation.
- Exact current source gates: frontend **39 files / 283 tests** plus production build; Rust library
  **406 passed / 10 intentionally ignored**, focused RepEngine **47/47**, metrics **11/11**,
  planner **6/6**, export **4/4**, `cargo check --tests`, strict clippy, and diff checks. Independent
  exact-tree verification found no remaining P0–P2 issue in either the Rust or React cutover. No
  package, install, tag, or live-database
  migration occurred; `/Applications/CodaKiller.app` and Christian's live file remain v1.3.0 /
  schema 7.
- Still open by design: durable cross-process `MutationReceipt` IDs/undo descriptors for every
  write; pause-aware focus timing, safety stop, recovery actions, and cold retention; the complete
  deterministic voice/replay cutover; Score Atlas, scalable Ledger/Composer, durable concise Brain,
  handcrafted shell, earned Universe, packaging, live migration, and Steinway acceptance.
- Corrected the still-v1.3.0 tutorial and Motivation note: unmatched speech is ignored, but short
  ordinary fragments containing an active verdict word can false-match in installed v1. The docs
  now tell Christian to close/mute before conversation and inspect the receipt/history instead of
  making the disproven absolute claim that normal talk can never trigger a verdict.
- Files/docs: Rust `rep`, `store/practice_v2`, schema/model/CRUD/IPC/voice projections, metrics /
  planner/export/Brain/Settings; React Rep HUD/form/history/settings/receipts/metronome guards and
  accessibility primitives; v2 plan/spec/QA/progress, living vault docs, and operating manuals.

### 2026-07-15 · Landed and adversarially verified the first unshipped v2 foundation slice

- Added a **schema-v8 sidecar foundation** for score sections/target metadata and calibration,
  protocol contracts, attempt provenance and compensating adjustments, retention checks, anomaly
  projection, validated action drafts, durable Brain threads/turns, and event links. The v7→v8
  migration/backfill runs in one immediate transaction, is idempotent, leaves legacy source rows
  intact, marks all 48 legacy contracts as mastery-unverified, and records provenance for all 481
  attempts. This is foundation only: the v1 RepEngine and write commands are **not yet wired** to
  these semantics, and Christian's live schema-v7 database was never opened by the new code.
- Rehearsed the migration on a disposable copy of the preserved July 15 backup. It retained the
  exact legacy counts (**6 pieces / 27 Regions / 48 blocks / 481 reps / 8 sessions / 628 session
  events / 670 canonical events / 21 Goals / 11 Calendar rows**), retained the exact legacy-column
  content hash, reopened without adding rows, and passed quick/integrity checks with zero foreign-
  key violations. The sidecar projection contains **792 explicit anomalies** rather than silent
  repairs: 23 abandoned blocks, 11 overruns, 30 duplicate-candidate pairs, 13 empty blocks, 670
  incomplete legacy event-provenance facts, 43 same-second bursts, Region 24's nonpositive `0–0`
  range, and block/set 45's reversed `452–449` range.
- A follow-on read-only compatibility audit found **127 legacy attempts with `bpm=0.0`, all in
  seven non-metronome `notes` blocks**. In v1 that value is the storage sentinel for “tempo not
  applicable,” not evidence of a zero-tempo performance. The v2 repository must project those exact
  migration-legacy rows as `bpm=None` without rewriting them, while continuing to reject nonpositive
  tempo on every new tempo attempt. This was caught before RepEngine integration; the live database
  remained unopened.
- Added pure, deterministic protocol/ledger derivation for consecutive-clean, total-count,
  exploratory, timed, and legacy contracts; current/best streak and accuracy; reset and adaptive
  recovery that activates only after an error; and append-only void/restore/correction/reversal
  folds. Fresh review fixed caller-order dependence, equal-timestamp nondeterminism, invalid self /
  future / cross-attempt reversals, cross-piece links, calibration uniqueness, signed legacy sort,
  nonpositive-range detection, and nondeterministic burst evidence.
- Added the first **global frontend write-receipt** path. Rep-open, rep-check, session-end, and
  Settings failures now surface visibly in the active source UI and roll back/preserve state as
  appropriate; committed/undone notices are dismissible, errors are assertive, successful verdicts
  say exactly which attempt was saved, and late async replies cannot resurrect a closed block or
  retune its metronome. Database-backed command identity/audit and all remaining write surfaces are
  still open, so this does not yet close the receipt contract.
- Added the first narrated-transcript **voice firewall** gate: numeric colon fragments such as
  `5:16`, conversational `no thanks` / `no thank you`, and ambient `again that I…` / `again like…`
  / `again just to…` no longer become numbered actions or failed reps, while explicit failure cues
  and genuine `again` remain deterministic. Delivery identity, rapid repeated “done,” the complete
  replay corpus, and live Steinway recognition remain unproven.
- Expanded the source corpus allowlist to the fourth available book, Gieseking/Leimer, with exact
  metadata, mental-practice/score-study routing, visual-dependency labeling, and an explicit
  historical-pedagogy caveat. The real four-book corpus gate passes. The installed v1.3.0 app still
  indexes three books and [[(C) How To Use]] still correctly documents that installed behavior.
- Exact source gates after fresh adversarial fixes: frontend **39 files / 236 tests**; Rust library
  **376 passed / 9 ignored**, plus knowledge **9**, narrated-firewall **2**, STT **9**, TTS-gate
  **4**, with two live-TTS cases intentionally ignored; production build and strict clippy passed;
  real four-book corpus plus Scherzo and Griffes MusicXML gates passed. No package, install, tag,
  version record, or live-data migration was performed.
- Recorded that whole-crate `cargo fmt --check` is red from broad pre-existing formatting drift;
  strict clippy/tests remain green. P7 will format its owned edits locally and will not bury a
  semantic checkpoint inside thousands of unrelated mechanical line changes.
- Files/docs: frontend command/receipt services and rep/session/settings callers; Rust
  `store/{migrations,v8_backfill}`, `protocol`, `ledger`, intent firewall/fixtures, four-book corpus;
  v2 Acceptance Matrix, Roadmap, Command Center, Flaws, portable summary, and operating manuals.

### 2026-07-15 · Converted Christian's first substantial real-use feedback into a release contract

- Audited the complete vault/version history, current repository and installed v1.3.0 app, the
  July 15 feedback note, all four practice books, the old PianoCoach lessons and narrated-session
  corpus, and the live database. This corrects the stale claim that Christian had never used the
  product: the preserved snapshot contains **6 pieces / 27 Regions / 48 blocks / 481 reps / 8
  sessions / 670 events / 21 Goals / 11 Calendar rows**.
- Real use exposed product-critical gaps: completion is based on total attempts rather than
  consecutive successful evidence; misses do not reset the ladder; block/session failures can be
  invisible; one reversed measure range and multiple overruns/duplicates exist; ambient speech
  reached failed-rep notes; score targeting/history are too slow; the Brain is verbose,
  session-only, and non-actionable; and the current static purple Universe/UI failed Christian's
  visual and motivational bar.
- Locked the v2 product boundary: **Score Atlas, evidence-based Practice Protocol Engine, exact
  Practice Ledger + Session Composer, deterministic hot-loop plus confirmed natural-language
  action drafts, concise durable Practice Brain, and an earned interactive Universe**, all within
  a handcrafted black/off-white/terracotta interface. Exact score identity is promised only where
  compatible structure supports it; scanned editions use visible calibration/confidence and
  correction rather than fabricated precision.
- Created [[(C) v2 Transformation Brief]] and [[(C) v2 Acceptance Matrix]] as the product and
  verification contracts. Added P7 to the Roadmap/Command Center, corrected the portable summary
  and flaw register, and kept [[(C) How To Use]] explicitly pinned to the still-installed v1.3.0
  until user-facing v2 behavior actually ships.
- Captured a consistent pre-v2 live-data backup at
  `/Users/c3/Library/Application Support/com.christian.codakiller/backups/(C)
pre-v2.0.0-feedback-2026-07-15-163528.db`: schema 7, `quick_check=ok`, zero foreign-key rows,
  SHA-256 `4b21549237b6f70de7399444151063bcb3ea35a9067a0ce363ce07d14f8b1aee`.
- Baseline verification before edits: frontend **36 files / 217 tests**, Rust **380 passed / 11
  normally ignored** plus the three safe real-data gates, strict clippy, and production build all
  passed. Repository was clean at tagged `v1.3.0`; no remote exists.
- Files/docs: raw feedback, all living vault docs, new v2 brief/matrix/evidence catalogue,
  `~/praelude/docs/superpowers/{specs,plans}/`, repo `NOTES.md`/status, and QA replay design.

### ⟶ Next steps

1. Wire the proven schema-v8 sidecars and pure protocol/ledger folds into RepEngine transactions,
   IPC, voice/UI status, undo/correct/restart, recovery, focus, and retention without migrating the
   live database yet.
2. Build Score Atlas + scalable history, then complete voice drafts/replay safety and the concise
   durable Brain/tool boundary.
3. Replace the shell and Universe, run every automated/native/adversarial gate, and only then
   migrate the live copy, build/install/tag v2.0.0, and create its version record. Human voice-over-
   Steinway proof remains a separate final acceptance.

## v1.3.0 (current at that historical boundary) — shipped 2026-07-13 (tag `v1.3.0`) — compact workspace + contextual Practice Brain

### 2026-07-13 · Made the score workspace smaller and gave it a cited, context-aware conversation

- Replaced the top-level Brain page with a persistent right-side **Practice Brain drawer**. It
  overlays the current Home/Practice/Calendar workspace, collapses with its arrow or Escape,
  returns keyboard focus correctly, and keeps the current conversation mounted while hidden.
- Added **Interface scale** in Settings (75–125%, default 90%), reduced oversized controls/radii/
  padding, lowered the native minimum window to 720×520, removed the permanent active-block
  gutter, and made the score's section rail collapsible to full-width PDF with a narrow-screen
  overlay fallback.
- Built a strict read-only RAG index over the three converted practice books in `Knowledge and
Resources`. Retrieval is cached, bounded, source-balanced, path-free, and always local; only
  retrieved excerpts cross to Claude/Gemini when **Share retrieved book excerpts** is enabled.
  Offline answers cite a book/section but deliberately keep raw book prose out of later chat
  history.
- Added bounded MusicXML facts for the exact selected piece/Tricky Section measure range: key/time,
  tempo/directions/dynamics, voices/staves, note/rest counts, limited pitch/rhythm tokens, and ties.
  The parser rejects path escape/symlinks, never resolves external DTDs, caps bytes/events/depth/
  parts/fields, accepts validated plain `.xml`, and labels compressed `.mxl` unsupported rather
  than pretending.
- Every answer now carries a visible **grounding receipt** (piece, section/mm., rep count,
  MusicXML status, retrieved book count, provider-sharing status, and limitations). Canonical Rust
  state—not frontend prose or a stale persisted piece—owns the context. An active rep is included
  only when it belongs to that piece. Conversation is bounded to six exchanges and remains
  session-only; Christian can disagree and ask for a different method or no drill.
- Hardened citation authorization, privacy-off behavior across multi-turn fallback, false
  hearing/verdict/action claims, stale async plan/context races, empty-Region rep isolation,
  Markdown asset paths, and score-timewise part counting after fresh adversarial review.
- Verification/release: frontend **36 files / 217 tests**; Rust **358 passed / 9 ignored** plus
  **9 + 9 + 4** integrations; strict clippy, production build, real three-book retrieval, real
  Scherzo MusicXML, real Griffes `.xml` discovery, and a live external-provider cited-answer probe
  passed. Fresh verifier: **SHIP, no P0–P2 findings**. Native release gate installed/sealed/
  packaged/checksummed one v1.3.0 app; its Spotlight step was hardened with a bounded metadata
  import/poll after the first attempt exposed an indexing race.
- Data: pre-release backup `~/Library/Application Support/com.christian.codakiller/backups/(C)
pre-v1.3.0-2026-07-13.db`; schema remains 7 and integrity/FKs are clean; **5 pieces / 24 Regions /
  21 blocks / 169 reps / 9 Goals / 9 Calendar rows / 1 video / 11 chapters / 13 links** preserved.
- Main files: `src-tauri/src/brain/{mod,context,corpus,provider,score_context}.rs`, vault/settings/
  Tauri boundary, `src/features/brain/`, Shell/Score/Settings/Pieces CSS + tests, release script,
  contextual-brain spec, QA/release/version records, repo notes/status, and all affected vault docs.

### ⟶ Next steps

1. Christian runs the complete v1.3.0 at-piano acceptance: narrow window + scale setting, collapse
   the score rail/drawer, select a Scherzo section, ask about a real failure, disagree once, and
   record the advised experiment manually.
2. Tune retrieval/UI only from that evidence; do not treat one model answer as proof.
3. Add the off-disk private git remote.

## v1.2.0 — shipped 2026-07-13 (tag `v1.2.0`) — actionable score + tutorial chapters

### 2026-07-13 · Put every section action beside the section and mapped the Scherzo tutorial

- Split each Tricky Section's **editable title** from its longer **Practice notes**. Score and
  Details now edit the same canonical fields, measures, and color, including genuinely clearing
  optional values instead of silently retaining stale text.
- Rebuilt the Score sidebar as a measure-sorted, searchable accordion. Each row opens its own
  **Practice / Edit / Score marks / Tutorial** tools in place; only one row stays open. Removed the
  detached bottom inspector and duplicated Region text entry from the practice form.
- Added a 25–200% zoom slider, **Fit page**, **2-page view**, and **Hide sections** so the score and
  practice list can be made denser without losing the current task. Unsaved mapping is guarded;
  saved marks are clickable; Details uses the same score order.
- Added schema 7's normalized local tutorial graph: video → reusable chapter → Region links.
  Videos remain files under a piece's `tutorials/` folder; the database stores only validated
  metadata, timestamps, and mappings. Scan, play/seek, edit/add/remove mappings, reveal the source,
  and confirmed stale-file cleanup are all available inside each section.
- Analyzed the 39:57 Scherzo tutorial, copied it byte-for-byte into the Scherzo `tutorials/` folder,
  identified all 20 title-card chapters, and mapped all **12** live Scherzo Regions with **13**
  links across **11** useful chapters. Companion map: `Pieces/Chopin - Scherzo No.2 Op.31/
(C) Scherzo Tutorial Map.md`.
- Main code: `src/features/score/`, `src/features/tutorials/`, `RegionEditor`, `BlockForm`, schema/
  models/CRUD/tutorial store, Tauri capability config, and their regression suites. Required vault
  docs, repo `NOTES.md`, and release-gate/version records were refreshed.
- Verification: frontend **36 files / 211 tests**; Rust **331 unit + 22 integration passed** with
  only **5 hardware/live + 2 live-TTS ignores**; strict clippy/build/diff checks; schema-6→7 real-
  backup rehearsal; fresh adversarial **PASS with no P0–P2 defects**; sealed install/checksum/
  one-copy audit. Native acceptance rendered Scherzo page 5, opened a row-local Tutorial, jumped
  to 15:13, and visibly played the video. Live data remains **5 pieces / 24 Regions / 20 blocks /
  165 reps / 9 Goals / 9 Calendar rows**, plus **1 video / 11 chapters / 13 links**. Full record:
  [[(C) v1.2.0 — Version Record]].

## v1.1.0 — shipped 2026-07-13 (tag `v1.1.0`) — coherence + score editing

### 2026-07-13 · Made one Tricky Section drive Score, Details, practice, Calendar, and PDF marks

- Replaced the disconnected editing paths with one canonical Region/Tricky Section editor. The
  same name/note, measures, and color now edit from **Score** and **Details**; both surfaces can
  add/delete sections and start practice explicitly linked to the selected section.
- Expanded score markup from one-shot boxes into persistent box, highlight, and text-note marks.
  Existing marks can be moved, resized, retyped, recolored through their section, or deleted;
  clear/delete/split/merge/Goal destruction explains the consequences and confirms first.
- Synchronized planning and navigation: dated Big Goals appear as Calendar milestones, Goal renames
  resolve live there, Goal deletion intentionally removes linked work, and a constellation star now
  opens its exact piece. Request-generation guards stop slower old loads from changing selection.
- Made Region split atomic; merge/delete now preserve block and Calendar history safely. Converted
  valid legacy intake hard spots into Regions once and removed the second stale display/context.
- Verification: frontend **35 files / 198 tests**, Rust **320 unit + 22 integration passed** with
  only hardware/live ignores, production build, strict clippy, fresh adversarial approval, sealed
  native install, relaunch, checksum, and exact-one-app audit. Schema remains 6; post-launch data
  stayed **5 pieces / 24 Regions / 20 blocks / 165 reps / 9 Goals / 9 Calendar rows**. Full record:
  [[(C) v1.1.0 — Version Record]].

## v1.0.2 — shipped 2026-07-13 (tag `v1.0.2`) — scanned-PDF paint hotfix

### 2026-07-13 · Fixed the white-page failure that v1.0.1's gate missed

- Christian's screenshot proved the distinction the previous release test failed to make: PDF.js
  could report the right page count and resolve a render while scanned image content painted
  nothing. The actual library includes CCITT, JBIG2, and JPEG/ICC pages; v1.0.1 had not packaged or
  configured PDF.js 6.1.200's external image-decoder/color/font runtime.
- Bundled the exact version-matched WASM decoders, CMaps, standard fonts, and ICC resources; wired
  every directory through same-origin `getDocument()` URLs; selected reliable WebKit rendering
  paths; and narrowly extended CSP for same-origin resource reads and WebAssembly compilation.
  No network fetch, broad filesystem access, schema change, or user-data rewrite was introduced.
- Added byte-for-byte asset-drift and CSP regression coverage plus a renderer-configuration test.
  The decisive packaged-native gate visibly painted three real pages through production IPC:
  Scherzo page 2 (JBIG2), Prokofiev page 1 (JPEG/ICC), and Beethoven page 3 (CCITT).
- Verification: frontend **35 files / 189 tests**, production build, full Rust suite + strict
  clippy, sealed native v1.0.2 bundle, checksum, relaunch, and exact-one-app audit. Full record:
  [[(C) v1.0.2 — Version Record]].

## v1.0.1 — shipped 2026-07-13 (tag `v1.0.1`) — PDF viewer reliability patch

### 2026-07-13 · Replaced the permanent PDF spinner with a native-proven WebKit path

- Fixed the score view hanging forever on **Loading PDF…** in the installed macOS app. The PDFs
  were valid; PDF.js's modern module worker was not reliably starting inside WKWebView from
  Tauri's custom app protocol. The viewer now uses PDF.js's matching legacy display + in-process
  loopback worker path, which is compatible with this Mac's WebKit runtime.
- Added bounded native-byte and renderer startup waits, exact retryable error states, late-task
  cleanup, and cross-JS-realm binary handling. A stalled load can no longer spin forever.
- Added two regressions: a never-resolving native read must become **Try again**, and a real
  one-page PDF must parse through the production adapter. Native isolated smoke then rendered the
  actual 25-page Scherzo at page **1 of 25** (1664 × 2314). No schema or user-data change.
- Verification: frontend **34 files / 183 tests**, production build, full Rust suite + strict
  clippy, clean native v1.0.1 bundle, checksum, relaunch, and exact-one-app audit. Full record:
  [[(C) v1.0.1 — Version Record]].

## v1.0.0 — shipped 2026-07-12 (tag `v1.0.0`) — P6 Practice Universe

### 2026-07-12 · Finished the complete local product without inventing history or grading practice

- Added **Home + Practice Universe**. Star size shows focused time; orbit continuity shows distinct
  active days in the last 28; planets show Regions with work; halos show Regions revisited on 2+
  dates. Self-reported quality changes only a narrow visual brightness tint (0.92–1.00), explicitly
  repeated as text and labeled not a grade. Home works by keyboard, reduced-motion, light/dark,
  narrow layout, loading/error/empty states, and goes directly into the selected piece.
- Added schema v6's crash-atomic, idempotent historical ledger. A fresh copy of the real v0.6 DB
  preserved 5 pieces / 24 Regions / 20 blocks / 165 reps / 4 Goals, ledgered all 249 legacy rows,
  mapped 190 exact practice rows (including five deleted-block rows as piece-level history), skipped
  59 unsupported rows rather than guessing, reached 193 canonical events, and passed integrity/FKs.
  New reps now write feed + canonical event + ledger in one transaction with one timestamp.
- Added deep typed **Settings** for theme, voice/TTS/wake word, Brain provider, verdict aliases,
  metronome/ladder defaults, Calendar capacity, Pieces folder, and native Keychain status/write-only
  save. Alias collisions and deterministic command theft are rejected; secrets never cross IPC.
- Added explicit per-piece Spotify/YouTube search handoffs using fixed encoded HTTPS origins. No
  arbitrary opener, scraping, download, autoplay, or shell interpolation. Removed the unused broad
  opener capability and enabled a restrictive production CSP.
- Finished intentional Home/Practice/Calendar/Brain navigation, kept Metronome as a tool, shipped the
  final C-orbit/piano icon, and added one fail-fast `npm run release:mac` path for tests, build,
  staged seal, rollback-safe install, clean DMG, SHA-256, LaunchServices cleanup, and bundle-ID
  duplicate rejection. Local ad-hoc signed only; no Developer ID/notarization claim.
- Verification: frontend **34 files / 179 tests**; Rust **313 unit + 22 integration passed** with
  5 hardware/live ignored; strict clippy and production build clean; real schema-5 copy migration,
  rendered 1280/narrow UI QA, and fresh data/security/accessibility adversarial reviews approved.
  Full record: [[(C) v1.0.0 — Version Record]].

## v0.6.0 — shipped 2026-07-12 (tag `v0.6.0`) — P5.5 Calendar

### 2026-07-12 · Shipped explicit weekly planning without punishment or fake practice credit

- Added nested big Goals → subgoals with strict dates, safe ownership/reorder/delete rules,
  completion summaries, and per-branch Calendar-work summaries.
- Added the top-level seven-day **Calendar**: visible daily capacity, previous/next week, piece +
  Goal path, minutes, and explicit create/edit/move/done/dismiss/delete controls.
- Added missed-day recovery as a read-only deterministic preview followed by one atomic optimistic
  Apply. Every item remains Christian's choice: Move, Done—I did it, Dismiss, or Leave unresolved.
  Recovery honors the earliest parent/subgoal deadline, a seven-day horizon, total capacity, and
  an exact half-capacity recovery ceiling; nothing moves silently.
- Added explicit **Schedule** on deterministic Goal suggestions. The provider cannot schedule;
  block/Region suggestions remain read-only unless they already have canonical Goal ownership.
- Added schema v5 `daily_work`, immutable origin dates, exact move counts, administrative audit
  events, and a shared strict Gregorian date seam. Calendar actions never fabricate practice time,
  active days, reps, verdicts, or Goal completion.
- Verification: frontend **31 files / 165 tests**; Rust **285 unit + 22 integration**, strict
  clippy/build; real v4 database-copy migration preserved all core counts with integrity `ok` and
  zero FK violations. Two adversarial reviews plus a focused final review closed six real defects.
- Installed `/Applications/CodaKiller.app` is sealed 0.6.0, relaunches on schema 5, and is the only
  filesystem/Spotlight copy. Full record: [[(C) v0.6.0 — Version Record]].

## v0.5.0 — shipped 2026-07-12 (tag `v0.5.0`) — P5 grounded Brain

### 2026-07-12 · Shipped cited practice intelligence without surrendering app control

- Added the top-level **Brain**: typed questions plus wake-word **“Coda …”** questions, with visual
  answers and voice playback through the existing half-duplex TTS gate.
- Added Claude-native → Gemini-native → cited-offline fallback, a bounded selected-piece/context
  builder, citation allowlisting, and a validated local graph of **28 methods / 13 symptom routes /
  10 psychology principles / 18 primary or authoritative sources**. Claude Code/Claude Max is not
  an API credential and is never invoked.
- Added visible deterministic **Next work** ranking from unfinished/due goals, resumable blocks,
  whole-history Region weakness, latest-five flawed/failed reps, and spaced revisits. Reasons are
  inspectable; the model can narrate but cannot reorder or write.
- Added conversational intake review with visible diffs and explicit Save. Reviews expire, apply
  once, and are bound to their answer/piece/fields. Inherited Goal deadlines stay synchronized;
  custom dates survive.
- Three adversarial reviews found and fixed output-policy paraphrase bypasses, fake/cross-piece
  intake authorization, stale canonical goal dates, and a hidden/incomplete planner.
- Verification: frontend **30/152**, Rust **260 unit + 22 integration**, strict clippy, production
  build, and a real cited Gemini-key smoke passed. Full record: [[(C) v0.5.0 — Version Record]].
- Main files: `src/features/brain/`, `src-tauri/src/brain/`, `knowledge/`, `planner/`, voice loop,
  store deadline/goal integrity, P5 plan, repo `NOTES.md`, and all required living docs.

## v0.4.0 — shipped 2026-07-12 (tag `v0.4.0`) — P4 real-PDF score workspace

### 2026-07-12 · Shipped the real score as the practice workspace

- PDF-backed pieces now open on the user's **actual score edition**, rendered by bundled PDF.js
  with continuous scrolling, page jump, fit/manual zoom, high-DPI rendering, and lazy page
  canvases. An 85-page score keeps only the viewport neighborhood live.
- Added a secure Rust score boundary: discovers every direct piece PDF, persists a preferred
  edition across rescans, rejects traversal/symlink/cross-piece access, and sends validated raw
  bytes over Tauri IPC—no WebView filesystem scope and no base64 inflation.
- Added light Region mapping: select a Region, drag normalized boxes over one or more systems/
  pages, undo/save/clear, click highlights, see mapped/unmapped/remap state, and carry separate
  boxes per edition fingerprint. Merge combines compatible anchors; split clears stale geometry.
- The score sidebar joins the existing graph: active blocks highlight overlapping mapped Regions;
  selected Regions show their blocks and expose a prefilled **Practice this Region** form.
- Added silent deterministic score commands: **“go to/show page N”** and **“go to/show measure
  N.”** No LLM and no spoken interruption in the hot practice loop.
- Verification: frontend **28 files / 145 tests**, TypeScript/Vite production bundle green; Rust
  **228 unit + 13 integration passed**, 5 hardware/live ignored; strict clippy green. Real vault
  fixtures include seven Scherzo editions up to 20.3 MB / 28 pages and an 85-page Cortot volume.
  Browser visual QA exercised select → map → drag → save → practice and caught/fixed toolbar
  navigation escaping the score pane.
- Main files: `score/`, schema v4 + score commands, `ScoreView`, `RegionOverlay`, `PieceDetail`,
  `BlockForm`, voice intent/loop, and the P4 plan. Full record: [[(C) v0.4.0 — Version Record]].

## v0.3.1 — shipped 2026-07-12 (tag `v0.3.1`) — release identity hotfix

### 2026-07-12 · Removed the duplicate app result + made the installed release unmistakable

- Christian opened CodaKiller after v0.3.0 and reasonably reported that it looked like the same
  app. Diagnosis found **no stale installed binary**: `/Applications/CodaKiller.app` was byte-for-
  byte the v0.3.0 release. But the build output left a second Spotlight-indexed `CodaKiller.app`
  inside `src-tauri/target`, and the unchanged landing screen gave no visible proof of the update.
- **Fixed both problems in v0.3.1.** The top bar now shows the exact app version; the Practice
  landing screen says **Foundation installed** and points directly to editable Regions, goals,
  rep history, and floating panels. Post-install release cleanup unregisters and deletes the
  generated bundle, then explicitly registers the `/Applications` copy.
- Verified: one `CodaKiller.app` on disk and one LaunchServices/Spotlight result, installed bundle
  reports 0.3.1 and launches, dark visual pass confirms both markers, frontend 127/127 tests and
  production build green, real database still schema v3 + `integrity_check=ok`.
- Files: `Shell.tsx/.css/.test`, `PiecesPanel.tsx/.css/.test`, version manifests, repo/vault docs.
  Full record: [[(C) v0.3.1 — Version Record]].

## v0.3.0 — shipped 2026-07-12 (tag `v0.3.0`) — P3.5: editable foundation

### 2026-07-12 · Foundation shipped — editable graph, organized history, floating workspace

- **Everything important is editable after submission.** Double-click piece status, deadline,
  target tempo, notes, goals, block labels/measures/BPM/rep targets, region names, and rep notes;
  individual rep verdicts can be corrected. Blocks, reps, goals, and regions delete only after a
  consistent confirmation step. Goal order and completion are persistent.
- **History is no longer a flat wall.** Schema v3 promotes named measure-range **Regions** and
  back-fills existing blocks by overlapping ranges. The UI drills in region → block → individual
  rep, with search, sort, summaries, rename/recolor/merge/split, and block reassignment.
- **Rep HUD + session feed are movable windows.** Drag, resize, collapse, edge-snap, focus, and
  reset them; geometry survives relaunch. The active-block window gets a dedicated right gutter so
  it does not cover the practice form/history; the session strip starts collapsed in the top bar.
- **Practice is not synonymous with tempo.** New focus choices: tempo, notes, phrasing, dynamics,
  memory, hands/coordination, other. Metronome use is independent. A metronome-free non-tempo
  block stores no fake BPM, counts verdicts normally, and exports tempo as “—”. UI-opened blocks
  now actually start/retune the metronome when their toggle is on.
- **Foundation for later phases:** durable append-only canonical event log, editable SQLite graph,
  `progress_summary` (focused time, streak, per-region mastery, time by focus), real Goal table,
  optional PDF anchor field, and canonical export that reflects edits after relaunch. This is the
  data layer the score viewer, brain, planner, and Practice Universe will consume.
- Verified at ship: Rust **216 passed / 3 ignored**; frontend **24 files / 127 passed**; production
  TypeScript/Vite build green; `cargo clippy --all-targets -- -D warnings` clean. Visual QA caught
  and fixed panel overlap + HUD clipping before ship. Full record: [[(C) v0.3.0 — Version Record]].
- Main files: schema/store/event/metrics/rep/export modules; editable/panel primitives; BlockRow,
  GoalsPanel, HistoryPanel, RegionEditor, BlockForm, Shell; required vault living docs.

### 2026-07-12 · Foundation (P3.5) T8 + T9 + T18 — export/metrics/tempo (Rust, `foundation` branch)

- **T8 — export reads the canonical SQLite graph.** `sessions/export.rs` no longer rebuilds a
  session summary from FROZEN `session_event` payloads; it enumerates the session's blocks from
  the durable `event` log's `rep_open` events, then renders each from the current `rep_block`/
  `rep` values (`block_history` + `reps_for_block`). So a block edited (relabelled/retempoed)
  after its reps were logged now exports with the edited values, and export survives a relaunch.
  Append-only per-piece `(C) codakiller-sessions.md` contract unchanged; a **Label** column was
  added to the block table.
- **T9 — derived-metrics layer + `progress_summary` command.** New `metrics/mod.rs` with PURE
  functions (no Store/IO): `focused_seconds` (idle-gap heuristic, 120 s threshold — gaps longer
  than that count as 0 focused time), `streak` (consecutive practice days back from the latest),
  `best_tempo_reached` (fastest clean rep), `per_region_mastery`, `time_by_focus`. All derived
  from the event log + graph, nothing stored. Exposed as the `progress_summary(piece_id)` Tauri
  command. **No UI yet** (P3.5 is plumbing; the score-viewer/brain/reward UI stays out).
- **T18 — tempo ladder decoupled from the metronome, gated on focus.** A block now carries a
  `focus` and a `use_metronome` flag. Only a `tempo`-focus block climbs the tempo ladder; a
  notes/phrasing/etc. block records verdicts but never changes BPM. When the ladder does step it
  ALWAYS advances the tempo and logs a `tempo_change` event even with the metronome off; the
  actual metronome only retunes when `use_metronome` is on. A live focus/metronome edit now
  takes effect on the open block immediately.
- Why: Foundation makes SQLite the single source of truth for export + future metrics, and lets
  practice modes other than tempo-ladder exist. Driven by the P3.5 foundation plan.
- Verified: full `cargo test` green (212 lib tests, 0 warnings), `cargo clippy` clean; each task
  TDD RED→GREEN with its own commit. No user-facing UI change yet, so [[(C) How To Use]] is
  unchanged. Files: `src-tauri/src/sessions/export.rs`, `src-tauri/src/metrics/mod.rs` (new),
  `src-tauri/src/rep/mod.rs`, `src-tauri/src/voice_loop.rs`, `src-tauri/src/store/{mod,model,crud}.rs`,
  `src-tauri/src/lib.rs`.

## v0.2.0 — shipped 2026-07-10 (tag `v0.2.0`) — P3: the real product begins

### 2026-07-10 · Added the user tutorial — [[(C) How To Use]] (+ made it binding)

- New 5-minute tutorial: first launch (the two permission Allows), the screen map, the
  golden-path practice session, the **full voice cheat sheet** (vocabulary pulled from the
  shipped intent router, not from memory), how the ladder climbs, where data lands, and a
  symptom→fix table. Driven by Christian's request for a clear quick-start.
- **Protocol change:** the update protocol (vault [[CLAUDE]] step 3 + repo `CLAUDE.md`) now
  requires refreshing the tutorial — and bumping its `Matches: vX.Y.Z` line — whenever
  anything user-facing changes (voice grammar/vocabulary, UI flows, defaults,
  permissions/setup). A stale tutorial now counts as a bug, same as a stale summary.
- Also added the tutorial to the Command Center quick-nav. Docs only; no code changed.

### 2026-07-10 · P3 shipped — pieces, rep engine, sessions, vault export (+ both P2 debts)

- **The app is now the thing it was built to be:** a voice-driven rep tracker, not just a
  voice-controlled metronome. Built in one evening session across ~9 commits, subagent-driven
  with per-task gates (the P0–P2 process, kept), plus a whole-branch final review.
- **Pieces (P3):** the piece list seeds itself from the vault
  (`Piano Practice/Pieces/*` — all 5 current pieces found; Scherzo Op.31 + Beethoven Op.90
  detected with MusicXML). First open of a piece = **typed intake interview** (goals, deadline,
  target tempo, hard spots, current state), stored per piece. _Verbal_ intake was consciously
  deferred to P5 (it's a conversation — the brain's job).
- **Rep tracker (the heart):** rep blocks over a measure range — voice-opened
  ("open a rep tracker, measures 40 to 56, start at 80, target 120") or via the block form.
  Auto-computed ladders (start→target bpm, step 4, cleans-to-step derived from planned reps)
  or manual rules; named variant lanes (e.g. 10 dotted / 10 staccato / 10 legato); **verbal
  check-off** with three-way verdicts — "done/clean" (clean), "sloppy/rough/shaky" (flawed),
  "again/nope/missed …" (failed, with the trailing note captured: "nope, missed the LH jump").
  The coach speaks back minimally ("Twelve of thirty. Up to eighty-four.") and the **metronome
  follows ladder steps** while running. Rep HUD pins above every view; UI buttons take the
  exact same engine path as voice.
- **Sessions:** every rep/intake/voice-metronome action lands on an auto-started session
  timeline; "end the session" (voice), the session bar button, or app exit appends a summary
  markdown — blocks, ladders, verdict tallies, notes — to **`(C) codakiller-sessions.md`
  inside each practiced piece's folder** (append-only, namespaced, never touches human docs).
- **P2 debts paid:** ① runtime TTS fallback — a failed Gemini synth retries through `say`
  immediately and Gemini is dropped for the session after 2 consecutive failures (the coach
  can no longer go silent mid-practice); ② mic-permission denial is now detected from `hear`'s
  real error strings (pulled from its binary + source) and surfaces a persistent, dismissible
  banner with the exact System Settings path.
- **Verified:** the hero flow runs end-to-end through the _real_ STT supervisor in tests
  (scripted transcript → block opens on the selected piece → metronome starts at 80 → spaced
  "done"s persist reps → exact acks spoken). An adversarial gate hardened the RepOpen grammar
  against ambient measure-talk ("the block measures 40 to 56 are hard" no longer opens
  anything). Suites at ship: cargo 176 lib + 13 integration, clippy `-D warnings` clean,
  npm 12 files / 90 tests. Schema v2 migration replay-tested against a real v0.1.0 DB.
- **Ship-smoke catch (the live install test earned its keep):** an AppleEvent quit
  (`osascript 'quit app'`) turned out to bypass Tauri's `ExitRequested` cleanup entirely —
  orphaning `hear` (mic held), stranding the boosted system volume at 85, and skipping the
  session export. Fixed the same session with a path-independent `libc::atexit` backstop
  (kills the `hear` group + restores pre-boost volume on EVERY normal exit, incl. NSApp
  terminate); window-close now also exports the session; an open session left by an abrupt
  quit is adopted and exported by the next launch (already designed in, now load-bearing).
  Re-verified live: post-fix quits clean `hear` immediately and restore the volume.
- **⚠️ One-time setup for the next launch:** reinstalling a rebuilt (ad-hoc-signed) app
  invalidates macOS mic/speech permission, and the denial is _silent_. Permissions were
  reset at ship, so the next launch prompts fresh — **click Allow twice** (Microphone +
  Speech Recognition) and voice works. Expect this after every future rebuild (`NOTES.md`).
- Docs: this changelog, [[Praelude]], [[(C) Roadmap]], [[(C) Flaws]] (B1+B2 → Resolved),
  [[(C) Praelude Command Center]], new [[(C) v0.2.0 — Version Record]]; repo `NOTES.md` +
  plan `docs/superpowers/plans/2026-07-10-codakiller-p3.md`.

---

## v0.1.0 — shipped 2026-07-09 (tag `p2-done`)

### 2026-07-10 · Project documentation system established (in the vault)

- Created the CodaKiller project-doc system at `Piano Practice/Praelude/`, modeled on the
  Cadencify vault structure: [[CLAUDE]] (operating manual + the binding after-every-change
  **update protocol** + version system), [[Praelude]] (the portable one-page summary),
  [[(C) Praelude Command Center]] (the hub), [[(C) Motivation]], [[(C) Roadmap]], [[(C) Flaws]]
  (the honest register), this changelog, and `versions/` ([[(C) v0.1.0 — Version Record]]). The
  old app's docs sit beside them in the `PianoCoach/` subfolder — lessons only, never a template.
- Driven by Christian's request to "log everything after every change, keep a constantly refreshed
  doc set, and a clear version-history system so next steps are always clear," and to frame
  CodaKiller as PianoCoach's successor in mission/lessons but with zero shared code or UI. Recorded
  the honest state: P0–P2 shipped but the real product (P3–P6) is unbuilt and the at-piano
  acceptance test is still pending.
- Also added a short `~/praelude/CLAUDE.md` in the code repo pointing here (so coding sessions
  find the docs + protocol). No code changed.

### 2026-07-09 · P0–P2 shipped — metronome + voice loop (the big one)

- Built the entire foundation across ~36 commits, every task gate-reviewed by a fresh-context
  adversarial verifier with fix rounds; final whole-branch review: **0 Critical / 0 Important**.
  Tagged `p2-done`; installed to `/Applications/CodaKiller.app`.
- **P0 (skeleton):** Tauri v2 scaffold, dark/light shell + theme system, settings store, rusqlite
  schema v1, toolchain (Rust via brew, vendored `hear` 0.8). (Tasks 1–4.)
- **P1 (metronome):** sample-accurate cpal audio engine (fractional-sample clock + mixer, lock-free
  real-time thread), 6 synthesized limiter-maximized click sounds, accents/subdivisions/gain, boost
  mode (raises + crash-safely restores system volume), popover UI. (Tasks 5–8.)
- **P2 (voice loop):** `hear` STT supervisor (auto-restart + storm cap + SIGTERM-group teardown +
  async-signal-safe termination handler), half-duplex gate (never hears itself), deterministic
  intent router (regex/number grammar, mode-scoped, ignores non-commands), Gemini TTS
  (`v1beta/interactions`, `gemini-3.1-flash-tts-preview`, decoded from `steps[].content[].data`)
  with system `say` fallback, Keychain key handling (svc `codakiller`). (Tasks 9–14.)
- **Verified:** spoken commands drove persisted bpm (96→100→144→100→120) and "stop"; 60 s
  real-piano-plus-narration → **zero** false intents; gate produced zero self-transcripts; clean
  SIGTERM → zero zombie `hear`. Gates: cargo 105 lib + 12 integration, clippy clean, npm 36/36.
  Evidence: `~/praelude/docs/qa/p2-acceptance.md`, `docs/qa/task-13-live-verification.md`.
- **Hard-won empirical facts** (detail in `~/praelude/NOTES.md`): `hear -m` is fatal for a line
  reader (`\r`+ANSI, no newlines) — use plain `-d -l en-US`; the ASR engine re-sends identical
  finals 0.5–2.3 s later → unified 2.5 s time-keyed dedup; a garbage `+inf` bpm would infinite-loop
  the audio callback (found by a verifier) → clamped; DMG bundler deletes the `.app` → build with
  `--bundles app`.
- **Consciously NOT done:** the human at-piano acceptance run (hardware-blocked from unattended
  testing — −34 dB loopback); runtime TTS fallback + mic-denied guidance (deferred to P3). See
  [[(C) Flaws]].

---

## Pre-history (context)

CodaKiller was approved by Christian on 2026-07-09 as the ground-up replacement for **PianoCoach**
(`~/piano-coach`), whose four-version arc established the founding lesson ("the mic can't grade an
acoustic piano — track, don't grade"). The old app's history lives in the `PianoCoach/` subfolder
and is intentionally **not** merged into the code. See [[(C) Motivation]].

## Parent

- [[(C) Praelude Command Center]]
