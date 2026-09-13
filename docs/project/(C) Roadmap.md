# Praelude — Roadmap

**Last updated: 2026-09-13. Praelude v11.1.0 / schema 21 — SHIPPED + INSTALLED.** Installed at `/Applications/Praelude.app` at 16:58 EDT on 2026-09-08; implementation `c411e7b`. Fresh native launch, real Score and Variants dialog pass. All 46 database tables and DB bytes are unchanged from the fresh backup.

**Native boundary:** v11.1.0 launches and renders the real Beethoven Op.90 movement 2 score, selected passage and Variants dialog. The earlier Desktop/Score permission blocker is cleared. Progressive rep/set/chain effects passed independent live browser review; native audible quality, voice/chime overlap and Christian’s motivation verdict remain open. Cover-picker selection/save (B109), microphone/Steinway, real mapping and Windows acceptance remain separate.

## Maintenance — fresh-Mac development portability (completed 2026-09-13)

- The private code repository now includes a curated `docs/project/` mirror of every living
  project document and Markdown version record. A clone no longer depends on Christian's local
  Obsidian path for its operating manual or current product truth.
- Root README/AGENTS/CLAUDE entry points now route to repository-relative current documentation.
  A new-Mac guide covers Git access, toolchain evidence, lockfile setup, test/build/dev commands,
  permissions and the boundary between development source and personal app state.
- `npm run doctor`, `npm run setup:mac`, `npm run docs:sync` and `npm run docs:check` make the
  setup and mirror repeatable. Privacy ignore rules cover databases, environment files and signing
  material. The mirror excludes databases, scores, media, release artifacts and credentials.
- Current docs no longer ask for the already-cleared v11.0 Desktop permission gate. Release facts
  remain historical; v11.1 product/native boundaries are unchanged.

### Next steps

Test a clean clone on the second Mac. Treat transfer of Christian's live database and score tree as
a separate, encrypted migration: stored library/PDF paths are absolute and the relocation path has
not been accepted. Do not copy the live database into normal tests or Git.

## v11.1 — Progressive practice resonance (shipped 2026-09-08)

The Rep Counter now builds a luminous core, orbital arcs, a filling ring and progressively richer sparks as the current clean target fills. Sloppy/Again send falling fragments and deepen amber to coral on successive setbacks, capped at three. Set completion gets a larger radial bloom; a fully completed variant chain gets the largest gold finale. Original offline pluck/glass/air sounds rise and gain harmonics with progress, vary their ornaments, descend on setbacks and resolve into richer set/chain chords. Existing practice rules are unchanged: Total plays retains earned volume, and Again preserves variant-stage progress. No added XP penalty or automatic musical judgment.

Final frontend **2,614 passed / 1 skipped** (214 files passed / 1 skipped, four workers); native **1,106 passed / 18 ignored plus integrations**; TypeScript, production/native builds, strict Clippy and Rustfmt pass. Independent 1280×720 and 720×520 live review verifies clean/setback/undo, fifth-clean set completion and a Dotted 2 → Reverse dotted 3 chain. Audio-device failure, cleanup, gesture unlock and reduced-motion behavior have automated/source coverage. The sandboxed macOS speech probe and one concurrently loaded Listen Back assertion failed before authorized/native and four-worker full reruns passed; the QA ledger retains those limits.

### Next steps

Use the next real practice session to judge the escalating visual/audio rewards, native voice/chime overlap and motivation. Finish cover-picker selection → rendered cover → restart when controllable. Microphone/Steinway, real-provider mapping, accounts/social and Windows-native acceptance remain separate. Assistant stays OFF and ON HOLD.

## v11 — Studio and practical glass interface

**Requested:** Christian's September 7 overnight brief and handwritten ranked-room design. Implementation spec: repo `docs/superpowers/specs/2026-09-08-v11-studio-design.md`. Implementation `a338581`; released/installed 2026-09-07 at 23:53 EDT. Final evidence: repo `docs/qa/v11.0.0/README.md`.

- Studio replaces Universe with a quiet scalable room, ten musical ranks × ten divisions, continued Encore ranks, 25 earned-coin furnishings/palettes and local display name. One item equips per slot; the catalog is finite.
- 1 XP per 600 focused seconds; per-session completed-set milestones yield cumulative 1/2/4/6 XP at 3/5/7/10 sets. Rank 1 costs 100 XP/division, +50 per subsequent rank; each division earns 25 coins. Existing practice counts and corrections reconcile rewards without farming.
- Native SQLite atomic revisions persist profile, purchases and equipped items without changing schema 21 or practice history. Full 46-table copy rehearsal preserved every value except the Studio settings key; reopen proof passed.
- Today makes Score and today's notes primary. Pieces offers covers, chosen local artwork, search/sort, grid/list, folders and rest/restore. Glass shell/controls preserve readable music, keyboard focus and compact windows; Dark/Light/System follows system accessibility preferences.
- Accounts, sync and friends remain unbuilt; no credentials or fake social presence. Assistant remains off.

### Next steps

1. Release tag/private push are complete. Full-home app-copy enumeration remains incomplete after stalled directory reads; Spotlight and known install/build locations are verified. Frontend **2,595 passed / 1 skipped** across **212 passed files / 1 skipped**; native **1,106 passed / 18 ignored plus integrations** with four test workers; TypeScript, production/native builds, format and strict all-target/all-features Clippy pass. Final independent dock/library review found no remaining source blockers; broad dock/Shell checks passed 222, with the two additional policy cases included in the passing full suite. Package/install and exact 46-table/byte data gates pass; backup/rollback are retained.
2. Installed Score/Variants passed after the renewed Desktop prompt in v11.1. Today/Studio/rank path/practice record/Pieces/Settings and canceled purchase/profile previews passed across two fresh native launches.
3. Obtain Christian's sustained practice/motivation verdict. Keep microphone/Steinway, real mapping and Windows acceptance separate.
4. Revisit account infrastructure and social design when credentials/service configuration exist. Expand furnishings based on real use, not an implied infinite catalog.

## Current independent lanes

- **Windows v9.1.0:** exact historical unsigned x64 NSIS candidate remains unchanged. Windows-native cargo tests and real Windows 10/11 install, PDF/audio, persistence and uninstall are pending; no voice/Listen Back/system TTS/volume boost. A later branded package is a separate release.
- **Custom-cover picker:** automated browser image selection hung; the native chooser opened but could not be inspected by computer use, then was canceled with no saved image. Preprocessing/native persistence/validation pass; picker/render/restart acceptance remains pending (B109).
- **Native audio and mapping:** real microphone/Steinway and one authorized real-provider mapping still need their own evidence. No browser fixture closes them.
- **Sharing:** blank local-PDF Library and share-clean packaging exist; a new recipient's first-run usability remains its own acceptance test.
- **Assistant:** OFF / ON HOLD; broad Practice Operator work does not resume without Christian's word.

### Next steps

After v11 real-use review, take the first available native acceptance lane. Configure accounts only when the external dependency is actually available.

## Historical roadmap below

The version/phase map and phase narratives below record their original release boundaries. Mentions of “installed,” “current,” “next,” old app names or old open-session blockers in those historical narratives are scoped to their dates. They do not override the current status above. The former long handoff preamble is preserved in `versions/(C) pre-v11 Roadmap handoff — Historical Snapshot.md`; complete chronology remains in [[(C) Changelog]].


## Version ↔ phase map

| Version      | Phases                                       | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                       | Status                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------ | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **v0.1.0**   | P0–P2                                        | Skeleton + metronome + voice loop                                                                                                                                                                                                                                                                                                                                                                                             | 🟢 shipped 2026-07-09 (tag `p2-done`)                                                                                                                                                                                                                                                                                                                                                  |
| **v0.2.0**   | P3                                           | Pieces + rep engine (the real product begins)                                                                                                                                                                                                                                                                                                                                                                                 | 🟢 shipped 2026-07-10 (tag `v0.2.0`)                                                                                                                                                                                                                                                                                                                                                   |
| **v0.3.0**   | P3.5                                         | Editable Foundation                                                                                                                                                                                                                                                                                                                                                                                                           | 🟢 shipped 2026-07-12 (tag `v0.3.0`)                                                                                                                                                                                                                                                                                                                                                   |
| **v0.3.1**   | P3.5 patch                                   | Release identity + single-app cleanup                                                                                                                                                                                                                                                                                                                                                                                         | 🟢 shipped 2026-07-12 (tag `v0.3.1`)                                                                                                                                                                                                                                                                                                                                                   |
| **v0.4.0**   | P4                                           | Real-PDF score viewer + light mapping                                                                                                                                                                                                                                                                                                                                                                                         | 🟢 shipped 2026-07-12 (tag `v0.4.0`)                                                                                                                                                                                                                                                                                                                                                   |
| **v0.5.0**   | P5                                           | Brain + knowledge graph                                                                                                                                                                                                                                                                                                                                                                                                       | 🟢 shipped 2026-07-12 (tag `v0.5.0`)                                                                                                                                                                                                                                                                                                                                                   |
| **v0.6.0**   | P5.5                                         | Goals/calendar + missed-day recovery                                                                                                                                                                                                                                                                                                                                                                                          | 🟢 shipped 2026-07-12 (tag `v0.6.0`)                                                                                                                                                                                                                                                                                                                                                   |
| **v1.0.0**   | P6                                           | Home + Practice Universe + references/polish                                                                                                                                                                                                                                                                                                                                                                                  | 🟢 shipped 2026-07-12 (tag `v1.0.0`)                                                                                                                                                                                                                                                                                                                                                   |
| **v1.0.1**   | P6 patch                                     | WebKit PDF reliability + bounded loading                                                                                                                                                                                                                                                                                                                                                                                      | 🟢 shipped 2026-07-13 (tag `v1.0.1`)                                                                                                                                                                                                                                                                                                                                                   |
| **v1.0.2**   | P6 patch                                     | Bundled scanned-PDF decoders + native pixel gate                                                                                                                                                                                                                                                                                                                                                                              | 🟢 shipped 2026-07-13 (tag `v1.0.2`)                                                                                                                                                                                                                                                                                                                                                   |
| **v1.1.0**   | P6 coherence                                 | Unified Tricky Sections, editable score marks, Calendar/constellation sync                                                                                                                                                                                                                                                                                                                                                    | 🟢 shipped 2026-07-13 (tag `v1.1.0`)                                                                                                                                                                                                                                                                                                                                                   |
| **v1.2.0**   | P6 workflow                                  | Row-local score actions, separate titles/notes, tutorial chapter mapping                                                                                                                                                                                                                                                                                                                                                      | 🟢 shipped 2026-07-13 (tag `v1.2.0`)                                                                                                                                                                                                                                                                                                                                                   |
| **v1.3.0**   | P6 intelligence/workspace                    | Compact scalable UI + contextual three-book/MusicXML Practice Brain                                                                                                                                                                                                                                                                                                                                                           | 🟢 shipped 2026-07-13 (tag `v1.3.0`)                                                                                                                                                                                                                                                                                                                                                   |
| **v2.0.0**   | P7 Practice OS                               | Score Atlas + rigorous protocols/ledger + voice/Brain actions + handcrafted UI + earned Universe                                                                                                                                                                                                                                                                                                                              | 🔵 backend done in source; superseded by v3.0.0 (never installed as v2.0.0)                                                                                                                                                                                                                                                                                                            |
| **v3.0.0**   | P7 backend + v3 frontend rework (P0–P8)      | Complete monochrome frontend rework: five-workspace shell, Score wizard, force-graph Universe, Brain fixed                                                                                                                                                                                                                                                                                                                    | 🟢 shipped 2026-07-16 (tag `v3.0.0`)                                                                                                                                                                                                                                                                                                                                                   |
| **v3.0.1–4** | Real-use repair sequence                     | Paged Score, nonblocking target dock, working Score Practice seam, UI/token/metronome visibility repair                                                                                                                                                                                                                                                                                                                       | 🟢 shipped 2026-07-16–17 (`v3.0.1`…`v3.0.4`)                                                                                                                                                                                                                                                                                                                                           |
| **v3.1.0**   | Hands-free stabilization                     | Ephemeral receipts, synchronized metronome, Today plan/guide, screen-grounded confirm-gated Brain set action                                                                                                                                                                                                                                                                                                                  | 🟢 shipped 2026-07-20 (tag `v3.1.0`)                                                                                                                                                                                                                                                                                                                                                   |
| **v3.2.0**   | Endurance + system coherence                 | Explicit metronome/session ownership, preserved plans/Score work, exact deep links/context, long-session proof                                                                                                                                                                                                                                                                                                                | 🟢 shipped 2026-07-20 (tag `v3.2.0`)                                                                                                                                                                                                                                                                                                                                                   |
| **v4.0.0**   | Practice Notebook OS (Phases A–D)            | Bug/perf fixes; UI overhaul + Assistant/History rename + Today-as-menu; the day-sheet Practice Notebook (schema v11); quotes/scholarly-reader, book library, IMSLP add-a-score, real mapping wizard                                                                                                                                                                                                                           | 🟢 shipped 2026-07-30 (tag `v4.0.0`)                                                                                                                                                                                                                                                                                                                                                   |
| **v4.0.1**   | v4 perf patch                                | Module-scope the first-page cache (a key-remount had been discarding the memory tier); gate the composer-candidate fetch behind the fold; correct an over-claimed benchmark figure in NOTES                                                                                                                                                                                                                                   | 🟢 shipped 2026-07-30 (tag `v4.0.1`, commit `b06ffb6`) — patch release, Changelog-only by the `versions/` rule; it had been undocumented everywhere until the 2026-08-20 audit                                                                                                                                                                                                         |
| **v5.0.0**   | Paper redesign + real perf fix               | Colour-depth-aware image decoding (real perf fix); paper design system; notebook Today; static Universe; freehand pencil drawing (schema v13); IMSLP UI fix; curated 134-quote set; Barber/Copland chamber split                                                                                                                                                                                                              | 🟢 shipped 2026-07-31 (tag `v5.0.0`, merge `3de140c`)                                                                                                                                                                                                                                                                                                                                  |
| **v6.0.0**   | Practice Core (S1–S10)                       | Cloud-vision measure mapping + review/Apply; sub-sections (dormant `target_meta.parent_region_id`); floating Practice Dock (rep counter / paused-sets tray / clock+timers); pause-across-days; day-scoped sessions; day-sheet date nav + carry-forward + time estimates; History day timeline; Calendar planned-vs-done; score goals banner; voice fast-path/chime/fuzzy + TTS recovery; Brain status/style fixes. Schema v14 | 🟢 **shipped + installed 2026-08-18** (tag `v6.0.0`, release `34c1a15`). Plans A+B+C+D all landed. Post-ship: in real use, but measure mapping has produced 0 rows on the live DB and no acceptance verdict is recorded                                                                                                                                                                |
| **v6.0.1**   | Real-Use Fixes (patch)                       | Score toolbar top-row overlap fix (B76); dock stacking-floor + defaults + Reset panel layout; B70 voice-misfire fix (suppress by routed intent); B72 BooksPanel nested-form fix; docs + backup                                                                                                                                                                                                                                | 🟢 **shipped + installed 2026-08-21** (tag `v6.0.1`, merge `d9fa0fe`, release `440200b`). Schema unchanged at 14. B70/B72/B76 RESOLVED; B77 (measure-map focus trap) found, pre-existing                                                                                                                                                                                               |
| **v7.0.0**   | Motivation Layer (Plans A+B+C)               | Living earned-only galaxy; streaks + end-of-day photo calendar (Liftoff-style); completion animations; full volume/dynamics checker (calibrated, loudness-only); Brain usefulness overhaul. Schema v14→v15                                                                                                                                                                                                                    | 🟢 **SHIPPED + INSTALLED 2026-08-24** (tag `v7.0.0`, DMG 10 MB). Galaxy, streaks, photo ritual, animations, full dynamics checker, B81 TTS fix, and an Assistant OFF switch. Schema 14→15, counts preserved 10/193/1814/40. Gates: vitest 2285/0, cargo 949/0, clippy+tsc clean. **Plan C (Assistant) ON HOLD, unmerged** — its numbers policy was refuted twice; C2/C3/C4 never built |
| **v7.0.1**   | P0 Stabilize & Reveal (Aug 8 overhaul train) | B56 end-session race narrowed at this boundary; B4/B77/B82/B83 fixed; C3 mic mute button + B1 sub-sections revealed; §4b visibility pass; D1 voice-latency instrument; `npm run qa:shots` harness. Schema unchanged at v15, no migration                                                                                                                                                                                          | 🟢 **SHIPPED + INSTALLED 2026-08-25** (tag `v7.0.1`, DMG 10 MB, SHA256 `95d534bb…`). Counts preserved 10/208/1915/43. Gates: vitest 2322/1 skipped/0 failed, cargo 959/0, clippy+tsc clean, all eight release-script gates PASS. **B56 was later fully closed in v7.1.0.** |
| **v7.1.0**   | P1 Practice Set Core                         | Tempo demotion engine (A1), variant-chain engine (A2), composer hierarchy (A3), schema-v16 set tuning model (A5), verdict hotkeys (A6), ± reps (A7), B56 fully closed. Important correction: global demotion controls and composer tuning controls were not exposed in the installed UI; per-stage composer copy still read as attempts. | 🟢 **SHIPPED + INSTALLED 2026-08-26** (tag `v7.1.0`, schema 15→16). Gates: frontend 2,383/1 skipped, native 994/0, tsc/clippy clean, five voice corpora zero false mutations. Christian's immediate use found B85–B87. |
| **v7.2.0**   | P2 Micro-Targets v2 + corrective release     | B85 direct atomic persistent spots + exact-region start/resume; B86 chain-governed mastery, stage attribution and cancellable auto-close/retry; B87 spoken acks opt-in/off by default; missing v7.1 global-demotion and per-set tuning/consecutive-clean surfaces; B3 unified overlay; E3 low-data Universe teaching. Schema remains 16. | 🟢 **SHIPPED + INSTALLED 2026-08-27** (tag `v7.2.0`, release `7a5061d`). DMG/signing/identity/launch/database preservation and all eight release gates passed. Frontend 2,499/1 skipped; native 1,049/19 ignored; build/tsc/clippy clean; five voice corpora zero false mutations. Native/at-piano interaction acceptance was still owed. B88/B89 were open at this historical boundary and closed in v8.1. |
| **v8.1.0**   | Combined P3–P6 + motivation correction       | Voice reliability/counted adjustment; movements + honest mapping activation; visual warmup routines; Listen Back; exact prompt-only rotation; archive/recent-first; Sound targets; evidence-based XP/levels/badges/cadence; live hotkey remaps; B88/B89 closures. Schema 16→19. | 🟢 **SHIPPED + INSTALLED 2026-08-27.** Final gates, live migration and installed-native Universe/Warmups 720×520 passed. Final runtime HEAD `1a1e38b`; pushed tag `v8.1.0` points to `0a3d6a5d339955fd7e7318299eaa6c3063674415`; first post-tag docs baseline `da71efb5509afa36beb073050719ac1094751b98`; pushed cold-start handoff at that boundary `d03a3d7b9820494b878336f7d18e5da94b821f68`. Native mic/Steinway and real mapping acceptance remain open. |
| **v8.2.0**   | Score/practice UI cleanse + Total plays      | Continuous virtualized Score; independent Tricky Sections scroll/auto-reveal; compact Score toolbar, one-line dock and 32px variants; accessible Clean streak/Total plays choice; fixed-tempo 5/10/15/25/Custom volume completion excluded from mastery. Schema 19→20. | 🟢 **SHIPPED + INSTALLED 2026-08-27** from `afe65f3b`; pushed lightweight tag `v8.2.0` → `5de8bf9e1e9bced09c3d5091acd4b42241edae28`; private `origin/main` contains later docs-only corrections, so read its current tip from Git. Browser 720×520/1462×919, all release/artifact gates and exact live migration pass. Native Score frame remains open behind ungranted Desktop permission. |
| **v8.2.1**   | Compact composer + safe day close            | Pair/compact composer controls; preserve one rail scroll owner; make plain End session camera-free; offer an inert photo card only after confirmed End my day; require explicit Use camera with file fallback; add/gate truthful camera/mic/speech plist descriptions. Schema stays 20. | 🟢 **SHIPPED + INSTALLED + PUBLISHED 2026-08-28.** Runtime `496033e`; pushed tag `v8.2.1` → `971a0d2dc7cf8f093527239e2394391dbbfec0a4`; frontend 2,684/1 skipped, native 1,109/19 ignored; all gates pass. |
| **v9.0.0**   | Portable Pieces Library + share-clean build  | Library-first Pieces workspace; direct local-PDF intake; nested logical folders; active/completed/archived; context actions; blank app-owned first install; preserved upgrade path/data; remove embedded copyrighted pedagogy and related UI; schema 20→21. | 🟠 **PACKAGED SHAREABLE CANDIDATE 2026-08-30; NOT INSTALLED; CLEAN-RECIPIENT ACCEPTANCE PENDING.** Source/build, clean-store, exact-copy migration, cleanliness, devMock and final package gates pass. Packaged implementation `709542023…`; release/docs commit `6a560eeae…` is the exact target of lightweight tag `v9.0.0` and private `origin/main`, with both pushes successful. Install/recipient remain pending. Installed remains v8.2.1/schema 20. |
| **v9.1.0**   | Windows x64 portability + NSIS distribution | Carry the same schema-21 blank/share-clean Pieces product onto Windows 10/11 x64; platform-correct score/file/browser paths; current-user NSIS; keyboard/mouse practice core; explicit no-voice/no-Listen-Back boundary. | 🟠 **PACKAGED SENDABLE CANDIDATE 2026-08-31; NOT INSTALLED OR NATIVE-ACCEPTED.** Exact 7,654,002-byte unsigned EXE and SHA-256 are recorded; recursive share-clean and PE32+ x64 checks pass. Cross-target check/strict Clippy and Mac/full frontend gates pass. Windows-native cargo tests and Win10/11 acceptance remain PENDING. Implementation `2d3300488…`; pushed tag `v9.1.0` and `origin/main` resolve to release/docs `f296f3c…`. |

| **v10.0.0** | Praelude identity and interface reset | Visible Praelude branding, neutral dark system and share-clean Library on schema 21. | Shipped + installed 2026-09-03; historical exact facts in Changelog/version record. |
| **v10.0.1–v10.0.5** | Practice/Score corrections | Earned feedback; centered page-first Score; in-flow bar; focused Passage tools; responsive direct Goal/metronome/tempo controls. | Shipped + installed successive patches; historical exact gates in Changelog. |
| **v10.1.0** | Saved variants and routines | Durable global custom shortcut library, visibility controls and named ordered routine snapshots; schema 21. | Historical installed baseline before v11; native Score permission was available and real Scherzo/regions were observed before the replacement. |
| **v11.0.0** | Studio and practical glass | Ranked furnished room, earned coins/local name, original vector scene, cover Library, Today launchpad and restrained glass/accessibility corrections; schema 21. | Shipped + installed 2026-09-07 23:53 EDT; implementation `a338581`. Full gates and exact data preservation pass. Native Score/Variants await renewed Desktop permission; current evidence is above and in the QA ledger. |

---

## 🟠 v9.1.0 — Windows x64 sendable installer — PACKAGED CANDIDATE / NATIVE ACCEPTANCE PENDING

**Why:** Christian wants to send the same blank practice app to a pianist using Windows 10 or 11,
not require that friend to own a Mac and not create a data-bearing personal fork.

- The exact per-user x64 NSIS Setup EXE is packaged through Tauri's documented macOS cross-build:
  `CodaKiller-9.1.0-Windows-x64-Setup.exe`, 7,654,002 bytes, SHA-256
  `e2e2f3ae8846ef7aca6a6c04b2e1a2f346e97640f5d9089e6e49012365dc5dd4`.
- Implementation is `2d33004888a97c3ebcb4b7799bf54029efd15626`. Release/docs commit
  `f296f3cb38ae5d29c1ae813493f5c37ea07ed9a6` is the exact target of pushed lightweight tag
  `v9.1.0`; private `origin/main` and the tag currently resolve to `f296f3c`.
- The product remains blank and share-clean: no Christian data, PDFs, database, recordings,
  photos, quotes, methods or Knowledge payload.
- The supported first-port surface is Pieces/PDFs, folders/states/actions, Score,
  keyboard/mouse verdicts, metronome/chimes, History, Calendar and local persistence.
- The Mach-O `hear` binary is excluded. Mic, hands-free commands, macOS `say`, system-volume
  boost and Listen Back are unavailable on Windows and must not appear to be working.
- Windows path, filename, score-protocol, picker/browser and cache/durability edges are handled
  explicitly instead of relying on Unix/macOS behavior.
- The installer is unsigned because no Windows certificate exists; SmartScreen is an honest
  distribution limit until real signing is obtained. WebView2 downloads only if missing.
- Recursive share-clean inspection passes, and the embedded app is PE32+ x64. The package has no
  personal files/DB/scores/library/history, personal or unremapped host paths, or copyrighted
  pedagogy payload; intentional `/build-user` remapped build paths remain. Inert migration
  metadata/identifiers and the bundle id remain to support compatible upgrades, but Windows
  upgrade/data preservation has not been exercised.
- Frontend 205 files/1 skipped, 2,540 tests/1 skipped, TypeScript/build, Mac native 1,111/19
  ignored, Mac strict Clippy/format and Windows cross-target check/strict Clippy pass. Windows-
  native tests and real Windows acceptance remain pending.

### ⟶ Next steps

1. Verify the exact EXE on clean Windows 10 and 11 through Authenticode/SmartScreen, first launch,
   first PDF/Score, practice/audio,
   persistence and uninstall/reinstall.
2. Run Windows-native cargo tests and retain exact native picker, relaunch and persistence evidence.
3. Keep the record draft until those recipient gates pass; retain the Windows voice/audio gap as
   an explicit future phase.

## 🟠 v9.0.0 — portable Pieces Library + share-clean build — PACKAGED CANDIDATE / NOT INSTALLED

**Why:** Christian needs to hand the same normal app to another pianist. The current installed
Library is buried under History, adding a normal local PDF is needlessly organized around IMSLP,
and the distributable should not preload copyrighted book quotations or methods.

- One generic build, never a personal friend fork.
- Fresh installs are blank and app-owned; upgrades preserve Christian's stored/inferred Pieces
  root, database and score relationships.
- Pieces is primary, with **Library | History | Calendar**; History is nearby but subordinate.
- Arbitrarily nested logical folders and Unfiled never move physical score files.
- Active, Completed and Archived are reversible library projections; right-click/ellipsis exposes
  move, complete/return, archive/restore and remove.
- Add Piece takes title, optional composer/folder and a chosen or dropped PDF. It copies a
  validated PDF into the Pieces root and leaves the source file intact. IMSLP is optional and
  external, not the required import workflow.
- Remove moves an eligible app-owned piece folder to `.trash`; practice history stays queryable.
- Quotes/Reader/Books/passage-helper and the embedded book/method payload are absent from the
  distributable. The external source directory and historical DB text remain untouched.
- Candidate schema 21 is additive; an exact disposable schema-20 copy preserves 11 pieces, 255
  blocks, 2,315 reps, 51 sessions and 9,173 events with integrity OK/FK0.
- Distribution is Apple silicon/macOS 13+, ad-hoc signed and not notarized. Gatekeeper first-open
  friction is documented, not disguised as a notarized public release.
- Source/build/cleanliness, fresh-store-twice and 720×520 browser gates pass. The current live DB
  has one open session and block, so installed v8.2.1 and live data remain untouched.

### ⟶ Next steps

1. Close/preserve the live open session/block, repeat the audit, then take backup/rollback.
2. Install and verify exact before/after data, one-copy, fresh native launch and native file/UI flow.
3. Test a clean recipient install and freeze the version record only after acceptance; package
   commit/tag/private push are already complete.

## 🟢 v8.2.1 — compact composer + safe day-close correction — SHIPPED + INSTALLED

**Why:** the first installed v8.2.0 screenshot showed that generic field wrapping still wasted
vertical space and put Start after optional controls. Friction is also time.

- Measure and BPM controls stay in paired two-column rows.
- Focus/Metronome and target mode/count each share compact rows.
- Start is pinned in the form header; **+ Custom** reveals variant text entry only on demand.
- Tricky Sections remains the sole scroll owner; no nested form scrollbar or horizontal overflow.
- Installed v8.2.0 preserved closed session 48, then crashed in under one second. The photo card
  auto-requested camera while the packaged plist lacked `NSCameraUsageDescription`; macOS TCC
  delivered `SIGABRT`. Six retained reports from v7.0–v8.2 share the signature.
- Plain End session is camera-free. Only confirmed End my day offers the inert card; camera waits
  for explicit **Use camera** and sync/rejected requests fall back to file choice.
- The source plist declares camera use truthfully and release gates require camera/mic/speech
  descriptions. The crash-left orphan `hear` PID was cleaned.
- Full frontend 2,684/1 skipped, native 1,109/19 ignored, TypeScript, strict Clippy, production +
  native builds, five corpora and all eight release gates pass.
- Verified pre-install backup `(C) pre-v8.2.1-install-2026-08-28-132046.db`: 23,449,600 bytes,
  SHA-256 `2c99dec1c3bc14f595e69c92a9415076299752d46930eea0fa3c9f5a793379c7`; schema 20,
  integrity OK/FK0, 11 pieces, 246 blocks/contracts, 2,207 reps, 48 sessions, 8,391 events, zero
  open sessions/blocks.
- Installed identity/exact privacy strings/signature, DMG/checksum, rollback, exact before/after
  DB and fresh launch pass. Pushed tag `v8.2.1` points to
  `971a0d2dc7cf8f093527239e2394391dbbfec0a4`; native Score feel stays B91.
- Installed `/Applications/CodaKiller.app`: 8.2.1, bundle `com.christian.codakiller`, strict
  signature PASS, CDHash `f0460dcb3b62825ea29328a32489987364b19828`. DMG 10,907,287 bytes,
  SHA-256 `6ce58b77b32642c644df1c0b42d2c89ea745a75e28c7891a484190ad111c61dd`;
  v8.2 rollback 10,057,883 bytes, SHA-256
  `da29be1e96c120f2c27994fc2d83c26a5c8bc9a40c08b2f87097b0e82a117b71`.

### ⟶ Next steps

1. Repeat the composer walkthrough in the installed WKWebView, then continue the separate native
   Score, microphone/Steinway, authorized mapping and sustained-motivation gates.

## 🟢 v8.2.0 — Score/practice UI cleanse + Total plays — SHIPPED + INSTALLED

**Why:** Christian's screenshots showed basic practice-time friction that source checklists had
missed: a one-page Score with dead space, a non-obvious practice rail, enormous variant fields and
too much chrome. He also needed a volume target that did not pretend five sloppy repetitions were
mastery.

- Continuous document with stable page slots, maximum five mounted PDF pages and two-column
  overview; the visible page drives navigation.
- PDF and Tricky Sections scroll independently; expanded practice composer auto-reveals in the
  rail at the supported floor.
- Score tools and utility dock items are grouped without burying Paused Sets or Rep Counter;
  variants stay as one preset line plus compact 32px configured rows.
- Total plays has 5/10/15/25/Custom, fixed tempo, all-verdict counting and Undo. It can complete
  and auto-close but is filtered out of mastery copy, badges, day mastery counts and mastery FX.
- Schema-20 rehearsal preserves 242 blocks/contracts, 2,184 reps, 47 sessions and 8,283 events;
  integrity/FKs clean.
- Gates: frontend 2,678/1 skipped, native 1,109/19 ignored; build/type/format/clippy clean; five
  accepted browser frames and all eight release gates.
- Installed identity/signature, one-copy audit, DMG/checksum, backup/rollback and fresh schema-20
  graph all pass. Native Score visual is not claimed behind the ungranted Desktop prompt.
- Pushed lightweight tag `v8.2.0` points to
  `5de8bf9e1e9bced09c3d5091acd4b42241edae28`; private `origin/main` contains later
  documentation-only corrections, and its exact current tip must be read from Git.

### ⟶ Next steps

1. Run installed-native 720×520 Score/composer acceptance after Desktop access is deliberately handled.
2. Resume real microphone/Listen Back/Steinway acceptance.
3. Apply one explicitly authorized provider map, then judge motivation across sustained use.

## 🟢 v8.1.0 — P3–P6 completion + visible motivation — SHIPPED + INSTALLED

The release finishes the remaining train in one installed app:

- **P3:** verdict chime, persistent last-three heard feed, live-set-only `mark done`/`rep done`/
  `mark sloppy`/`mark again`, live settle timing, counted add/undo and live saved hotkey remaps.
- **P4 / schema 17:** movement CRUD and Score scope; provider/prerequisite-aware mapping entry.
  B5 remains externally unproven because no Anthropic key exists and the live table was last empty.
- **P5 / schema 18:** visual warmup catalog, named routines and exact rep-engine system-piece runner;
  its compact layout shrinks inside the effective 480px stage.
- **P6 / schema 19:** safe Listen Back with physical native STT suspension, temporary-by-default
  files and explicit Keep; exact prompt-only Rotation whose unsafe 720×520 position clamps to
  `y=164` above a 56px Tools reserve; archive/restore + recent-first; Sound target.
- **Motivation:** old galaxy removed; 1 XP/completed focused minute, deterministic levels, six
  badge tracks, exact next rails, 28-day cadence, progress/repertoire rails and technique evidence.
- **Corrections:** B88 per-set demotion + running subdivision; B89 durable spot identity/replay.
- **Accepted exclusions at the v8.1 boundary:** Assistant stays OFF/gated; its Settings guide was
  practice-only and Books stayed hidden while off; archive+recent-first replaced folders. The
  no-folders/Books payload decisions are explicitly reversed or retired by the v9 candidate.

**Rehearsal:** a disposable live-DB backup migrated 16→19 with integrity OK, historical graph
preserved, one hidden Warm-ups system row added and new feature tables empty. The installed
migration later reproduced that exact preservation.

**Release proof:** full gates passed; the live schema 16→19 graph preserved blocks/reps/sessions/
events and the one open session, adding only hidden Warm-ups. Installed-native Universe and
Warmups passed at 720×520; Warmups had no overlay/clipping, exposed **Restore Rep Counter** and
preserved the active set. Final HEAD is `1a1e38bb7a3757cf90ee6ea814e93d5971c595d6`;
frontend 2,650/1 skipped/0 failed and native 1,100/19 ignored/0 failed passed with every release
gate. Exact installed identity/artifact facts live in the version record.

### ⟶ Next steps

1. Obtain real WKWebView microphone/Listen Back and Steinway acceptance.
2. Run one real mapping only after Christian explicitly approves sending the whole current
   edition to the selected cloud provider.
3. Judge sustained motivation in use; do not infer it from screenshots or automated tests.

## 🟢 v7.2.0 — Corrective release + Micro-Targets v2 (P2) — SHIPPED + INSTALLED 2026-08-27

One corrective release atop v7.1.0; schema remains 16. Christian's v7.1 use defined the release:

- **B85:** select an anchored parent → **Isolate a spot** → drag one fully contained box. The
  child, parent link, colour, inferred measures and exact edition anchor commit atomically; no
  typing or second mapping pass. Spots persist, hide per parent, undo for about eight seconds,
  and **Practice this** refreshes blocks, resumes only the latest paused set with that exact
  `region_id`, or starts a three-clean set directly. Same-measure siblings cannot cross-resume;
  the already-running message is generic. The chip hides while another canvas pointer mode or
  save owns interaction.
  Conservative contained-box inference recovers exactly-one-parent legacy geometry without
  rewriting live rows.
- **B86:** the chain governs mastery across focus/target shapes; stage progress and durable
  attribution use the same clean-streak stage; ordinary/chained mastery holds for a six-second
  cancellable countdown and closes, with one bounded transient retry. Recovery cancels before
  IPC and the timer rechecks live eligibility. The stage chime is limited to genuine forward
  intermediate new-Clean transitions, including a one-clean opener—never undo/final/extra Clean.
- **B87:** spoken deterministic acknowledgements are opt-in, default off; the chime remains.
- **v7.1 surface correction:** global demotion controls in Settings; beat-unit label, beats per
  bar and subdivision in the set composer's Advanced section; explicit **Consecutive cleans**
  for new variants with legacy `reps` compatibility.
- **B3:** one memoized score overlay path for Regions/spots, mapping/create state and atlas draft.
- **E3:** honest low-data Universe teaching at zero–two evidenced systems; disappears at three
  and grants nothing.

**Ship proof:** DMG `releases/v7.2.0/CodaKiller-7.2.0.dmg` (10,739,055 bytes), SHA-256
`532868f089241e64d134b2fb3b645f2ddf7db8df838d8706d3a39d7d5b7dc77f`; installed plist 7.2.0,
strict signature, checksum and fresh launch verified. Live DB before/after: schema 16, integrity
OK, 10 pieces / 228 blocks / 2,026 reps / 44 sessions / 0 open, unchanged. Frontend 2,499 / 1
skipped; native 1,049 / 19 ignored; build/tsc/strict Clippy clean; five voice corpora zero false
mutations; all eight release gates PASS. Tag `v7.2.0` points to release commit `7a5061d`. The
720×520 workflow pass was browser/mock interaction evidence, not native or at-piano interaction
acceptance.

**Historical residuals at the v7.2 boundary:** **B88** names the missing per-set demotion override and running-HUD quick
subdivision control. **B89** records that transactional spot creation lacks replay idempotency: a
lost post-commit IPC response plus retry could duplicate a spot despite the ordinary same-tick UI
guard. No occurrence has been observed; B85 remains resolved. Both are closed in the later
installed v8.1 release, not retroactively in v7.2.

### ⟶ Next steps

1. Run the exact B85/B86/B87 flows natively at 720×520 and obtain Christian's at-piano verdict.
2. Keep B67/B75/B78 and native acceptance open. B88/B89 are closed in installed v8.1; Assistant
   remains deliberately off.

## 🟢 v7.1.0 — Practice Set Core (P1) — SHIPPED + INSTALLED 2026-08-26

The Aug 8 overhaul train's second phase, per Christian's 2026-08-25 approval. Schema 15→16.

- **A1 tempo demotion engine** ("the punishment"), using global defaults in normal UI use.
- **A2 clean-streak variant-chain engine.**
- **A3 composer hierarchy** — variants/focus/clean target unburied.
- **A5 schema-v16 per-set tuning model.**
- **A6 verdict hotkeys** and **A7 ± reps**.
- **B56 fully closed** across every production rep/retention mutation path.

**Installed-scope correction:** v7.1 did not expose the global A1 demotion settings or A5 beat
unit/beats-per-bar/subdivision composer controls, and its per-variant numeric copy still presented
an attempts target rather than an explicit consecutive-clean requirement. Installed v7.2 supplies
those missing surfaces. A per-set demotion override and running-HUD quick subdivision remain absent.

**Gates at ship:** frontend 2,383 passed / 1 skipped; native 994 passed / 0 failed; tsc and strict
Clippy clean; five voice corpora zero false mutations; migration 15→16 rehearsed and installed
counts preserved. Christian's immediate use then found B85, B86 and B87; green ship gates had not
proven those workflows usable.

Christian's recorded answers feeding this phase (2026-08-25): tempo demotion counts sloppy only;
hotkeys Space / Right-Shift / Return confirmed; gamification stays deferred until he's lived with
v7 longer.

### ⟶ Next steps

1. Keep this v7.1 record honest: the corrected controls and workflows first shipped in v7.2.
2. Historical acceptance item, now consolidated: surviving set/spot/hardware proof belongs to the
   current installed v8.2 acceptance train, not a separate v7.2 task.
3. Historical next step, now complete: P3–P6 shipped together in installed v8.1.0. Do not reopen
   this v7.1 phase as current work.

## 🟢 v7.0.1 — Stabilize & Reveal (P0) — SHIPPED + INSTALLED 2026-08-25

The first phase of the approved Aug 8 overhaul train. Plan:
`~/praelude/docs/superpowers/plans/2026-08-25-p0-v7.0.1-stabilize-and-reveal.md`. **Schema
unchanged at 15 — no migration was run, and no migration rehearsal was performed** (none was
needed).

**Fixed:** B4 (section-editor measure fields overflowing "Save section" at small window sizes);
B77 (measure-map dialog focus trap — Tab escaped it and could land Enter on a rep verdict button
behind the scrim; now trapped, Escape closes, focus returns to opener); B82 NEW, most serious
(the Clean/Sloppy/Again buttons were not rendered at all at 720×520, the app's own configured
minimum — auto-collapse removed entirely, only the deliberate "Collapse set" toggle remains);
B83 NEW (two banned `window.confirm` call sites trapped the user in a dirty measure-map review
and silently no-op'd piece switching under wry/WKWebView — both now use the app's inline
two-step confirm). **B56 / E5 end-session race — NARROWED, NOT CLOSED:** the "is a set live?"
check now runs under the session lifecycle lock, closing the concurrent-open/checkpoint window
and blocking adoption of an ended session; a smaller opener-side window remains, scheduled for
v7.1.0. At this boundary B56 was not fixed; **v7.1 later resolved it completely.**

**Revealed:** C3 mic mute button (backend existed since v6, no button anywhere — now an
always-visible labelled control in the left rail); B1 sub-sections (built and tested but never
used on the live DB — the select-then-drag rule was undocumented and a drag starting inside a
selected box was swallowed; both fixed, plus a taught empty state and an opt-out default on
"+ Add"); the §4b visibility pass (dock pill row labelled "Tools"; day-streak zero-state teaches
the focused-minute threshold; disabled Map-measures buttons explain why).

**Added:** D1 voice-latency instrument (the "app" figure on the heard pill — explicitly excludes
how long the Mac itself took to hear you, since the "hear" pipe carries no timestamps);
`npm run qa:shots`, a 720×520 screenshot harness that found B82 within minutes.

**Gates at ship:** vitest 2322 passed / 1 skipped / 0 failed; cargo 959 passed / 0 failed
(filtered out: 0 on every target); `cargo clippy --all-targets --all-features -- -D warnings`
clean; `tsc --noEmit` clean; all five narrated corpus suites (griffes, scherzo1/2/3, voice
firewall) zero false mutations; all eight release-script gates PASS.

**Installed 2026-08-25:** tag `v7.0.1`, DMG `releases/v7.0.1/CodaKiller-7.0.1.dmg` (10 MB),
SHA256 `95d534bb3d8c3ab1df5b7178bc170334d1097ae509b2d653e0ebb41652192f30`. Installed app verified
`7.0.1`, `codesign --verify --deep --strict` OK, DMG checksum verifies. Live DB verified
read-only after install: integrity ok, `user_version` 15, **10 pieces / 208 rep_blocks / 1,915
reps / 43 sessions** — identical before and after. Pre-install backup `(C)
pre-v7.0.1-install-2026-08-25-162832.db`, SHA256
`ee91bba3dd81b90667ad1841bd8899376f49eb3eaa04e48d3b8111dba51c8b71`. v7.0.0 rollback tarballed to
`~/Library/CodaKiller-rollbacks/CodaKiller-v7.0.0-rollback.app.tar.gz`.

**Still open at the v7.0.1 boundary:** B56 was narrowed and scheduled for v7.1.0 (now resolved);
B67 — still no Anthropic
key in Keychain, Claude vision path still never run (Christian confirmed 2026-08-25); B75 —
`measure_map` still holds 0 rows on the live DB (B83's fix removed two failure modes that may or
may not have been the cause — nothing proves it); B78 — dock residuals, a concrete 720×520
repro recorded this round (Dynamics panel overlaps Rep Counter); the at-piano voice-latency
baseline (the instrument exists, the number needs Christian practising); the v7.0.0 acceptance
verdict is still owed, and now v7.0.1's too; no streak zero-state screenshot exists (the mock
seeds a non-zero streak — behaviour is pinned by unit tests only).

**Christian's spec-review answers (recorded 2026-08-25; historical, partly reversed 2026-08-30):** Assistant stays OFF and gated — zero
assistant work; gamification deferred until he's lived with v7; warmup visuals = keyboard
figures + text, no VexFlow; tempo demotion counts sloppy only; pieces get archive + recent-first
sort, no folders (**reversed by the v9 Pieces Library request**); unkept recordings deleted at session end; hotkeys Space / Right-Shift / Return
confirmed; no Anthropic key — build the rest of P4 and leave B75 honestly open, remind him once
at P4.

### ⟶ Next steps

1. **P1 "Practice Set Core" (v7.1.0) is next** — see the section above. Not yet started.
2. Keep reminding Christian about the missing Anthropic key once, at P4 (Score Map), per his own
   instruction — not before.
3. At-piano acceptance verdicts for both v7.0.0 and v7.0.1 are still owed; do not let a third
   release ship without one.

## 🟢 v7.0.0 — Motivation Layer — SHIPPED + INSTALLED 2026-08-24

Agreed-deferred out of v6.0.0 so Practice Core could ship. A same-day spec round on 2026-08-20
turned the July 31 intent into an approved design (three plans, schema v14→v15) written to
`~/praelude/docs/superpowers/specs/2026-08-20-codakiller-v6.0.1-fixes-v7-motivation-layer.md`
(commit `1994895`) — **still awaiting Christian's review of the written spec file.** No
implementation plan and no code exist yet. What follows below is the agreed _intent_ from
Christian's July 31 dump, left intact; see the spec file for the approved shape:

- **Plan A "Galaxy & Ritual"** — the living galaxy, day streaks, end-of-day photo calendar,
  completion animations.
- **Plan B "Dynamics Checker"** — opens with a throwaway feasibility spike (can `cpal` input and
  hear-CLI STT share one mic on the M2 Air?), then the calibrated loudness-only RMS meter.
- **Plan C "Assistant Usefulness"** — all four pillars: confirm-gated read tools, book-grounded
  coaching with citations, suggest-never-dictate planning, real-metadata piece knowledge.

- **A living, earned-only galaxy** — the Universe grows from real practice and cannot be filled
  any other way.
- **Streaks + an end-of-day photo calendar** (Liftoff-style) — the day closes with a visible mark.
- **Completion animations** — a set or a mastery landing should feel like something.
- **A full volume/dynamics checker** — calibrated, **loudness-only**. This does not weaken the
  durable non-goals at the bottom of this doc: it measures loudness; it does not transcribe,
  grade, or detect pitch. If that boundary ever blurs during design, the feature is wrong.
- **Assistant usefulness overhaul** — v6 made it truthful; this round is about making it worth
  asking.

### ⟶ Next steps

1. ~~A spec round of its own, the same shape that worked for v6: Christian's feedback → themes →
   approved design spec → per-plan implementation → verified slices.~~ **Done 2026-08-20** —
   spec written and committed (`1994895`); Christian's review of the file itself is the
   remaining gate before per-plan implementation plans get written.
2. **Do not start it until the v6.0.0 items above are closed** — in particular the acceptance
   verdict and the off-disk backup. Shipping a motivation layer on top of an unaccepted release
   with no backup would be building on sand. **Status 2026-08-20:** the acceptance-verdict half
   is satisfied — v6.0.0 was accepted with issues (see the Post-ship reality section below). The
   backup half is approved (private GitHub repo) but still pending Christian running
   `gh auth login`; B54 stays open until the push succeeds. **Status 2026-08-21:** the v6.0.1
   patch half of this gate is now satisfied — v6.0.1 shipped + installed 2026-08-21 (see the
   v6.0.1 section above). **Status 2026-08-23:** the off-disk backup half is now satisfied too —
   B54/C1 RESOLVED, private remote at https://github.com/cchow375/praelude (see [[(C) Flaws]]
   Resolved). **Both gates are now clear.** **Status 2026-08-23:** Christian cleared the spec-review gate ("push to v7"); all four implementation plans are written and committed (`a597ca7`); Foundations (B0 spike PASS + schema v15, rehearsed) is merged (`45070c9`); Plan A (Galaxy & Ritual) is in build. B0 verdict: coexistence PASS — Plan B proceeds as scoped, no push-to-measure fallback needed. **Status 2026-08-24:** A1 (living galaxy) and A2 (day streak) are MERGED (`a1e74e5`), and the whole of Plan B (B1–B4 dynamics checker) is MERGED (`d126c3f`); integrated main is green (vitest 2235/0, cargo 904/0, clippy + tsc clean) and pushed to the remote. Adversarial verification refuted the galaxy TWICE before it was allowed through — an earned-only violation (a never-practised piece rendered a glowing star tagged with a zero-valued evidence field) and an unguarded dense-floor claim (orbits left the canvas at 4+ mastered regions) — plus five surviving mutants killed, including one that would have displayed a long-dead streak as current. **Still owed:** A3 photo calendar, A4 completion animations, Plan C in full, 720×520 live QA, B75's real measure-mapping run, and the ship.

## 🟢 v6.0.1 — Real-Use Fixes — SHIPPED + INSTALLED 2026-08-21 (patch)

Driven by Christian's 2026-08-20 acceptance-with-issues verdict on v6.0.0 (four areas: score
top-row overlap, voice misfires, Assistant not worth asking, dock/panel ergonomics). This patch
closes the first, second, and fourth; the Assistant overhaul is v7 Plan C. Deliberately
schema-free — schema stayed at 14, no migration.

**Five fixes, all shipped:** B70 (fast-path tail guard now suppresses by routed intent,
consume-on-use, clear-on-dispatch — commits `c1d16a8`, `1a0a3c1`); B76 (score toolbar top-row
overlap — flex-wrap + `flex: 0 1 auto`, reflow breakpoint moved to its own 1200px query — commits
`b05b0db`, `c3cc6e4`, `71f7902`); dock mount-time re-clamp using each panel's real configured
width, non-open panels skipped (commits `51abd62`, `2514aa6`); the dock stacking floor —
`DOCK_Z_BASE` 10 / `DOCK_Z_CEILING` 39, rank-based mapping, plus new Settings → Appearance →
"Reset panel layout" (commits `59af6c5`, `3033eb8`, `c5f878d`, `92694bd`); B72 (BooksPanel nested
form → `role="group"` — commits `274aa0c`, `3f28ed0`). Full root-cause detail in
[[(C) Flaws]]'s Resolved section for B70/B72/B76.

**Gates at ship (`92694bd`):** vitest 2125/0 (1 skipped, 169 files), cargo 898/0 (19 ignored),
clippy + tsc + build clean, all six narrated-corpus/firewall/complaint suites zero false
mutations, `FAST_PATH_PHRASES` untouched, CSS custom properties 139 before/after (none removed).
Mutation-tested the new stacking guard: 8 mutations, 7 killed, 1 survivor exposed the guard only
scanned `ScoreView.css` — widened to every stylesheet under `src/`.

**Installed 2026-08-21:** tag `v6.0.1`, merge `d9fa0fe` on main, release `440200b`. Installed to
`/Applications`, re-signed adhoc, launched clean. Live DB verified after install: integrity ok,
`user_version` 14, **9 pieces / 179 rep_blocks / 1,710 reps / 37 sessions** (was 173/1,660/36 at
the 08-20 audit). Pre-install backup `(C) pre-v6.0.1-install-2026-08-21-121450.db`, SHA-256
`024610394c4f4deec7f11251f6824d055bcda795df05b1e1602451ec28291b94`, 18MB. Rollback archived to
`~/Library/CodaKiller-rollbacks/CodaKiller-v6.0.0-rollback.app.tar.gz`, per the one-copy rule.

**New flaw found, pre-existing:** B77 — the measure-map dialog has no focus trap (Tab reaches
dock-panel controls behind its scrim, including Clean/Sloppy/Again). Verified pre-existing
(`MeasureMapPanel.tsx` byte-identical to `fa086b7`); v6.0.1 neither causes nor worsens it, but it
was rated the most serious item in the final review's triage. See [[(C) Flaws]] B77.

**Honest residuals (not fixed in this patch):** a panel previously left over the score toolbar
comes to the front on first launch after upgrade (the fix working — muscle-memory click risk,
rep has Undo); the rep/clock panels still overlap ~15px at the 720×520 dense floor (proven
unavoidable within ~6px); the rep panel still overlaps some score-page controls (all
navigational/read-only, panel is now the visible coverer, zero fall-throughs in a 3,300-point
sweep); `dockPanelZIndex` degrades past 30 panels (dock ships 3); `FloatingPanel.tsx:163` still
renders a raw focus rank but is unused/inert, logged as a re-arming trap; below 900px the zoom
control group no longer centres on its own row (no overlap, but no design sign-off); modal scrims
now correctly cover dock panels (intended, worth a glance at-piano). Full list: [[(C) Flaws]]
B78/B79.

**Process note:** branch ran subagent-driven with a fresh-context adversarial review per task.
Reviews REFUTED work three separate times and caught five real defects, two of which the
orchestrator had already accepted by ruling. Full engineering account in
`~/praelude/NOTES.md`.

### ⟶ Next steps

1. **Christian's at-piano acceptance of v6.0.1** — owed, same as every release before it.
2. ~~Off-disk git backup (B54/C1)~~ **DONE 2026-08-23** — no longer a gate before v7
   implementation. See [[(C) Flaws]] Resolved.
3. **B77** — give the measure-map dialog the same focus trap the piece picker already has.
4. **v7.0.0 implementation plans** — the only remaining gate before v7 build; not yet written.

## 🟢 v6.0.0 — Practice Core — SHIPPED + INSTALLED 2026-08-18 (Plans A+B+C+D)

Christian's July 31 goal dump (fifth real-use feedback round, 19 items — quoted in
[[(C) Changelog]]), interpreted into four themes and brainstormed to an approved design:
the score knows where measures are (cloud-vision mapping, sub-sections, snap selection);
tracking becomes small floating panels (rep counter, paused-sets tray, clock/timers);
plans and history respect time (date navigator, carry-forward, time estimates, day-timeline
History, planned-vs-done Calendar, day-scoped sessions, score goals banner); and the broken
basics get fixed (voice/metronome fast-path + chime acks + fuzzy variants under the
narrated-corpus zero-false-mutation gate, TTS auto-recovery, Brain status/style). Full
detail: `~/praelude/docs/superpowers/specs/2026-08-05-codakiller-v6-practice-core.md`.

**Plan A "Practice Surfaces" — built + verified on `v6/plan-a`, merged to main `d0bb001` (2026-08-06).**
Schema v14, the floating Practice Dock, pause-across-days, day-scoped sessions, day-sheet date
nav/carry-forward/estimates, and the score goals banner are code-complete, subagent-built with
per-task review gates: three ABBA deadlock classes and phantom-session minting caught and fixed
before landing, final whole-branch review APPROVE-contingent-on-a-12-item-fix-wave (all 12
closed), and two live-QA rounds at 720×520 that found and fixed a real unreachable-clock-panel
bug and a devMock checkpoint crash loop unit tests couldn't have caught. Gates at `f77c199`:
vitest 1808/1 skipped, cargo 718/0, tsc/clippy/build clean. One small residuals commit
(dock-layout only) is landing next. Full detail: [[(C) Changelog]] 2026-08-06 entry,
`~/praelude/.superpowers/sdd/2026-08-05-codakiller-v6-plan-a-practice-surfaces/`.

**Plan B "Read Models" — built + verified on `v6/plan-b`, MERGED to main `73b415d` (commits
`eb98a2f..fe34566`, 2026-08-06).** Two pure read models, no schema change, no migration, zero new write
paths: `history_days`/`history_day_detail`/`day_sheets_range` (Rust, localtime-day bucketing
matching A5's session convention) back a new **Days** default view in History (collapsed day
cards, disclosure detail, 21-day paging; the old piece-indexed view lives behind a **Pieces**
toggle, untouched) and stacked planned-vs-done bars in Calendar day cells (today's cell no
longer sits empty). Whole-branch review + live QA caught and fixed a CSS flex-shrink
renormalization bug jsdom couldn't see, a stale-closure week-nav bug that dropped rapid clicks,
a deep-link regression landing on Days while the hidden Pieces view still fired a piece-select,
and a contract test that only passed via test-order localStorage pollution. Gates: vitest
1886/0 (1 skipped), cargo 727/0, tsc/clippy/build clean. Full detail: [[(C) Changelog]]
2026-08-06 entry, `~/praelude/.superpowers/sdd/2026-08-06-codakiller-v6-plan-b-read-models/`.
Three deliberate spec deltas recorded in [[(C) Flaws]] B65 (also noted here): paging instead of
virtualization; Days view drops piece-scoped filters in v1; day-expand shows per-set
aggregates, not individual attempt rows (attempts stay reachable via the Pieces view). The
400-day History reach ceiling (real ~mid-2027) is tracked as [[(C) Flaws]] B64.

**Plan C "Score Intelligence" — built + verified on `v6/plan-c` (commits `82c87cf..7b1bd73`),
MERGED to main 2026-08-08 (merge `9bae13f`).** Opt-in cloud-vision measure mapping (Map measures button →
per-page scan via Claude/Gemini vision → strict JSON → deterministic reconciliation → human
review with page raster + conflicts + renumber/drag/skip-page → Apply gate → tiny per-bar
overlay numbers, stale maps always surfaced), snap selection prefilling region creation from
mapped bars, and one-level sub-sections on `target_meta.parent_region_id` (child sets default
to 3-in-a-row). **The acceptance story is worth telling straight:** the real-API Scherzo run
took four evidence-directed algorithm iterations (C6→C6d — forward-only → system-start
brackets → cross-page brackets + XML end anchor → positional system-start classification)
before the controller closed it done-with-documented-limits. Printed-number OCR was ~flawless
throughout (22/22, then 24/25 digit-exact); it is barline-geometry COUNTING that stays
unreliable, worst on multi-staff systems. Final state: 5 of 6 sampled pages exact (the miss
was one rate-limited page), landmarks m.67/m.95 located exactly, 781 mapped vs 780 XML bars.
Live QA (post-review) caught a Critical — a local renumber wiped unrelated blocking
conflicts, letting Apply commit malformed geometry through the non-validating devMock — fixed
and regression-locked in the final fix wave, which also brought devMock apply validation to
parity, added a derived-bar-count amber band + interpolated-bar styling, and added per-page
partial-Apply skipping. **Every scan in the acceptance run went through Gemini only — no
Anthropic key exists in this Mac's Keychain, so Claude vision (the intended primary provider)
has never actually been exercised.** Standing action item for Christian. Gates at `7b1bd73`:
vitest 1999/0, cargo 815/0, tsc/clippy/build clean. New honest limits in [[(C) Flaws]]
B66–B69. Full detail: [[(C) Changelog]] 2026-08-08 entry,
`~/praelude/.superpowers/sdd/2026-08-06-codakiller-v6-plan-c-measure-mapping/`, acceptance
evidence `~/praelude/docs/qa/plan-c-scherzo-acceptance.md`.

**Plan D "Voice & Brain" — built, twice-verified, and SHIPPED 2026-08-18** (fix wave `fbe3f6d`,
release `34c1a15`, tag `v6.0.0`). Metronome commands now act on the PARTIAL transcript for
"metronome on / off / stop" (target <1 s, was ~5 s); routine acks became a 120 ms two-partial
chime while info-bearing outcomes still speak; natural phrasing and ASR mangles route through the
same byte-identical ambient firewall; a heard-text pill shows everything the app heard, including
speech it ignored; the default cloud voice moved Kore→Aoede with a cooldown-not-lockout retry and
a "Voice degraded" pill; and the Assistant's grounding copy became honest ("No book excerpts
matched this question" rather than anything implying hidden content). B58 — which had been
blocking the migration rehearsal gate — turned out to be a HARNESS bug, not a data problem: it
misread the legitimate July chamber-split as corruption. Fixed, so v13→v14 rehearsed green on a
fresh copy of the live DB immediately before install.

**The verification story, told straight:** the first fresh-context adversarial pass REFUTED the
build. The fast path's bare single words ("stop", "again", "clean"…) fired on progressive prefix
partials at the head of ordinary sentences — four lines of Christian's own narrated corpus
produced phantom rep writes, with the tail guard then suppressing the real final so the error was
invisible. The allowlist was cut to multi-word metronome phrases only (0 collisions across 1,309
utterances, independently re-swept) and partial-STREAM replay tests were added as the regression
lock. The second pass returned SHIP. Standing rule: **no bare prefix word may ever join the
fast-path allowlist**, and a finals-only replay corpus is structurally blind to this class of
defect.

**Gates at ship:** vitest 2101/0 (1 skipped), cargo 855/0, six narrated-corpus/firewall suites
with zero false mutations, `tsc` + clippy clean. The live DB migrated 13→14 in place; integrity
ok; counts identical across the migration (9 pieces / 171 blocks / 1,640 reps / 34 sessions).
Pre-install backup `(C) pre-v6.0.0-install-2026-08-18-101647.db` (SHA `c142f70a…`); the v5.0.0
rollback was archived to `~/Library/CodaKiller-rollbacks/`. New honest limits: [[(C) Flaws]]
B70–B73.

### ⟶ Post-ship reality — audited read-only 2026-08-20

This is what is **true**, not what was hoped. Every figure below came from a read-only query
against the live database, not from a previous document.

- **The app is genuinely in use.** Live DB: schema 14, integrity ok, **9 pieces / 173 rep_blocks
  / 1,660 reps / 36 sessions**. Two sessions since install — a **24-second** launch poke on
  2026-08-18, and a real **37-minute, 20-rep session on 2026-08-20 (02:20→02:57Z)**. That second
  one is the first genuine at-piano use of v6.0.0.
- **Acceptance recorded 2026-08-20: ACCEPTED WITH ISSUES.** After the 37-minute session above,
  Christian gave the first considered at-piano verdict any release of this app has ever had —
  four issue areas: score toolbar top-row overlap ([[(C) Flaws]] B76), voice misfires (the B70
  class), the Assistant still not worth asking, and dock/panel ergonomics. This satisfies the
  "no v7 before a verdict" gate below; see [[(C) Changelog]] for the full entry.
- **The headline v6 feature has never run on real data.** The live `measure_map` table holds
  **0 rows** ([[(C) Flaws]] B75). Cloud-vision measure mapping is proven in the test suite and in
  one branch-era Gemini acceptance run on the Scherzo; it has produced nothing at all on the real
  vault. And with no Anthropic key in Keychain, the Claude vision path — the intended _primary_
  provider — has never executed even once ([[(C) Flaws]] B67).
- **What is actually being used:** reps, sessions, and the pencil (15 `score_page_mark` rows).
- **Dead schema found by the audit:** `session.focused_seconds` is NULL for all 36 sessions ever
  recorded; every focus figure the UI shows is derived from `event` rows instead
  ([[(C) Flaws]] B74). Harmless today, misleading to anyone reading the schema.

### ⟶ Next steps

1. ~~Christian's at-piano acceptance verdict on v6.0.0 — written down.~~ **Done 2026-08-20** —
   ACCEPTED WITH ISSUES; see above and [[(C) Changelog]].
2. **Add an Anthropic API key to Keychain** (service `codakiller`, account `claude`) and run one
   real measure-mapping pass on a live piece — that closes B67 and B75 together and finally tests
   the feature v6 was named for.
3. ~~Off-disk git backup~~ **DONE 2026-08-23** — `gh auth login`, then `gh repo create
codakiller --private --source=. --push`; private remote at
   https://github.com/cchow375/praelude. See [[(C) Flaws]] B54/C1 Resolved.
4. ~~B70~~ **Fixed 2026-08-21, v6.0.1** — the fast-path tail guard now suppresses on routed
   intent rather than by prefix; "metronome on 96" no longer loses the tempo. See [[(C) Flaws]]
   Resolved.
5. ~~Decide B74~~ **Decided 2026-08-20: DROP** the column, in schema v15 alongside v7.0.0's
   migration, not in the v6.0.1 patch.
6. ~~v6.0.1 "Real-Use Fixes"~~ **Shipped + installed 2026-08-21** (tag `v6.0.1`). See the
   v6.0.1 section above.
7. **v7.0.0 "Motivation Layer"** — design approved + spec written 2026-08-20, awaiting
   Christian's review of the spec file before implementation plans are written.

## 🟢 v4.0.0 — Practice Notebook OS — SHIPPED + INSTALLED 2026-07-30 (started 2026-07-27)

Christian's July 27 goal dump. Requirements ledger: `~/praelude/.workflow/LEDGER.md`; spec:
`docs/superpowers/specs/2026-07-27-codakiller-v4-practice-notebook.md`. Four phases, all merged to
`main`, each lane fresh-verifier CONFIRMED, and now **installed** at `/Applications/CodaKiller.app`
(tag `v4.0.0`, release commit `ab7828a`; rollback preserved at `~/CodaKiller-v3.2.0-rollback.app`).
See [[(C) v4.0.0 — Version Record]] for full ship detail.

- **Phase A — bug + perf** — ✅ done in source: universe click/teleport fix (`502eaab`),
  rep rung-completion display fix (`998ff93`), transform-first score zoom + trackpad pinch
  (`7d7945a`). Honest carry-over: piece-switch first-decode latency still open (ledger 21 / B42).
- **Phase B — UI overhaul** — ✅ done in source: collapsed practice form with byte-identical
  payload (`01fbe03`), metronome quick bar + no-scroll icon popover (`591310b`), 148px icon rail +
  `.ck-fit` text-fit (`e10e77e`), Today rebuilt as the app main menu with a Today's-Practice window
  (`dd25305`), and the **Brain→Assistant / Ledger→History** purge via `src/shell/terms.ts` over
  three verify→fix cycles (`7f983f2`+`6ce658c`+`672e103`).
- **Phase C — the Practice Notebook** — ✅ done in source: schema v11 `day_sheet`/`piece_plan`
  (`720abac`/`b440cca`), the cursor-first paper-like day-sheet editor with the chips-insert-text law
  (`16a11ce`), the Score **Plan** tab with two-way sync + calendar past-day sheets (`145b75f`), the
  ⚑ goal promotion, the Assistant passage-helper with accept-as-only-write (`ce9c72d`), and the
  per-piece Schedule surface (`617174c`). Browser QA 10/10.
- **Phase D — quotes / books / IMSLP / mapping** — ✅ done in source: 182 verbatim-verified quotes
  - scholarly windowed reader (`2b1f2a5`, rotation fix `4b1cfb9`), data-driven `books.json` library
  - Settings Books panel (`0bf9b27`+`caf54f6`+`27805e2`), IMSLP search + browser-handoff download +
    typed-name archive (`ee95ce6`+`923333e`+`4c8aa08`), and the mapping wizard's **real** page pane +
    measure strip + XML landmarks via `score_xml_measure_facts` (`81c8c99`+`04220aa`).

### ⟶ Next steps

1. **Christian's at-piano + design acceptance of v4.0.0:** a design verdict from screenshots,
   then a real Steinway session covering the new notebook flow and the v3.2 voice items still
   owed (exact verdicts, `metronome stop`, one no-wake question, one selected-Region set request).
   First re-grant Microphone + Speech Recognition (fresh binary reset TCC) and confirm Dictation
   ON.
2. **Then** the still-open lanes: piece-switch cached-bitmap (B42), off-disk git remote,
   Goals/Calendar/session voice capability registry, history-at-scale reflow, durable Universe layout.

---

## 🟢 v5.0.0 — the paper redesign + real perf fix — SHIPPED 2026-07-31

Driven directly by Christian's July 30 hands-on feedback (quoted in full in [[(C) Changelog]]):
v4's perf work made the app _laggier_, not faster; the "fast path" bytes/megapixels theory was
wrong; Today read as a form, not a notebook; IMSLP search was dead from the UI; the Tanglewood
chamber pieces were wrongly merged; the quotes didn't land; and the UI itself needed first-class
attention. Commits `da366dc`, `771e7d3`, `ccd35f8`, `35c9572`.

- **The real perf fix** — ✅ done: colour-depth-aware image decoding (`da366dc`/`771e7d3`). The
  lag was never bytes or megapixels — it's pixel colour depth, with an embedded ICC profile acting
  as a ~15× multiplier. New Rust image fast path (`scanned_page.rs`, `page_image.rs`), frontend
  wiring in `pageImage.ts`/`PdfPage.tsx`/`ScoreView.tsx`. Full measurement table in
  `~/praelude/NOTES.md`.
- **Paper design system** — ✅ done: shell/Today/Score/Universe repainted from monochrome dark to
  warm paper, by Christian's explicit direction choice (`da366dc`/`771e7d3`).
- **Today rebuilt as a notebook, not a form** — ✅ done (`771e7d3`, hardened `ccd35f8`): the
  day-sheet editor now reads as an actual notebook page; `ccd35f8` fixed the practice page
  rendering as a modal dimming the app instead of its own page.
- **Universe made static** — ✅ done (`771e7d3`): the force-directed physics simulation is gone,
  by Christian's explicit choice.
- **Freehand pencil drawing on the score — NEW** — ✅ done (`35c9572`, schema v13): toggle,
  undo, clear-page with confirm, Escape to put the pencil down; marks tied to file fingerprint per
  piece+edition+page. Highlighter, sticky notes, and per-stroke eraser explicitly declined.
- **IMSLP UI fix** — ✅ done (`da366dc`): in-app search actually works now.
- **Quotes curated** — ✅ done (`da366dc`): 134 verbatim-verified quotes from 4 pedagogues,
  replacing the noisier 182-quote v4 set.
- **Chamber split** — ✅ done (`da366dc`): Barber Pas de Deux / Copland Cowboys with Lassos
  separated via `scripts/split-tanglewood-folders.sh`.
- **Schema migrated v11 → v13.** Gates: `tsc` clean; vitest **1643 passed / 1 skipped** (was
  1,270 at v4.0.0); cargo **668 passed / 14 ignored** (was 580); `cargo clippy --all-targets --
-D warnings` clean.

### ⟶ Next steps (9 known-open gaps — full entries in [[(C) Flaws]] B47–B55)

1. **Christian's at-piano + design acceptance of the whole v5 UI direction** — still owed
   (screenshots verdict + a real Steinway session).
2. **One real at-piano check of the image fast path on the Barber** — the dev mock returns empty
   for `score_page_image`, so every QA pass so far went through the PDF fallback; the fast path
   itself has never been exercised in a real browser.
3. `stale_marks` (older pencil marks hidden after a re-scan) only surfaces while pencil mode is
   on — someone who never picks up the pencil never sees the notice.
4. A rare chamber-split migration residual: a collision that forces the migration to decline
   still stamps `user_version` 12 and never retries, with no warning surfaced (cannot fire on
   Christian's current data).
5. The fast-path refusal costs ~8ms/page, uncached in Rust — the vector edition re-parses every
   page turn. Negligible but real.
6. The Map-this-score wizard's page pane still renders through PDF.js, deliberately.
7. `.anomalies-badge-warning` (`AnomaliesPanel.css`) measures 4.47:1 at 11px — below AA,
   pre-existing, out of scope this round.
8. Today's screen still shows a menu (Today's Practice / Score / Assistant / History / Universe /
   Settings) duplicating the shell nav rail — redundant, not yet resolved.
9. ~~Off-disk backup is still absent~~ — RESOLVED 2026-08-23: private remote at
   https://github.com/cchow375/praelude (see [[(C) Flaws]] B54/C1 Resolved section). Note the
   Obsidian vault itself is still not backed up.

**Then:** the off-disk private git remote, the Goals/Calendar/session voice capability registry,
and history-at-scale reflow — all carried forward unchanged from v4.0.0.

## 🟢 P0 — Skeleton — DONE

Tauri scaffold, dark/light shell, settings store, sqlite schema v1, toolchain (Rust via brew,
vendored `hear` 0.8), `.app` builds. (Tasks 1–4.)

## 🟢 P1 — Metronome — DONE

Sample-accurate cpal audio engine (fractional clock + mixer, lock-free RT thread), 6 synthesized
click sounds, accents/subdivisions/gain, boost mode (crash-safe volume restore), popover UI.
Daily-usable. (Tasks 5–8.)

## 🟢 P2 — Voice loop — DONE

`hear` STT supervisor + half-duplex gate + deterministic intent router + Gemini TTS (with `say`
fallback) + Keychain key handling. Spoken commands drive the metronome; never hears itself; 60 s
real-piano-plus-narration → zero false intents. (Tasks 9–14.) Ships as **v0.1.0**.
**⚠️ Historical acceptance caveat:** at that boundary, proof was automated tests +
`say`-through-speakers only and the old P0–P2 checklist was pending. That checklist is now a
superseded evidence record, not the current v8.2 flow.

### ⟶ (P2-era next steps — superseded 2026-07-10)

1. ~~At-piano acceptance of v0.1.0~~ → folded into the **v0.2.0 acceptance run** (P3 block
   below): tonight's real practice session tests metronome + voice loop + rep tracker at once.
2. **Off-disk git remote** — still open ([[(C) Flaws]] C1; needs `brew install gh` + auth).
3. ~~Carry the two P2→P3 debts~~ → both paid in v0.2.0 (B1, B2 → Resolved).

---

## 🟢 P3 — Pieces + rep engine — DONE — shipped 2026-07-10 as **v0.2.0**

The real product exists now. Shipped (full record: [[(C) v0.2.0 — Version Record]]):

- **Pieces** seeded from the vault (all 5 found; XML detection right) + **typed intake
  interview** on first open. _Verbal_ intake deferred to P5 by design (it's a conversation —
  the brain's job).
- **Rep tracker:** blocks over measure ranges, voice-opened ("open a rep tracker, measures 40
  to 56, start at 80, target 120") or by form; auto/manual ladders; variant lanes; three-way
  verbal check-off with note capture; minimal speak-back ("Twelve of thirty. Up to
  eighty-four."); metronome follows ladder steps. Rep HUD + block history in the UI.
- **Sessions:** auto-started timeline; end by voice/UI/app-exit → append-only summary markdown
  per practiced piece (`(C) codakiller-sessions.md` in the piece folder — supersedes the spec's
  `CodaKiller 2/` namespace note; recorded in `NOTES.md`).
- **Both P2 debts paid:** runtime Gemini→`say` fallback ([[(C) Flaws]] B1 → Resolved) and
  mic-permission-denied guidance banner (B2 → Resolved).
- Schema v2 (incl. dormant `spot_review` for the P5 planner). Suites: cargo 176 lib + 13
  integration, clippy clean, npm 12 files/90; hero-flow e2e through the real STT supervisor.
- Plan: `~/praelude/docs/superpowers/plans/2026-07-10-codakiller-p3.md` (tasks 15–21).

### ⟶ Immediate next steps (after v0.2.0)

1. **Christian: tonight's at-piano session IS the acceptance run** — intake a real piece,
   voice-open a block on a real hard spot, check off reps hands-free, end the session, read
   the export. Supersedes the v0.1.0-only checklist as the top thread.
2. Feed real-use friction back into a fix round (expect rep-vocab/ladder tuning).
3. Off-disk backup (still open, C1).

## 🟢 P3.5 — Editable Foundation — DONE — shipped 2026-07-12 as **v0.3.0**

The app Christian already uses stops being write-once. Full record:
[[(C) v0.3.0 — Version Record]]. Shipped:

- Schema v3: Region + Goal + canonical Event graph; existing blocks auto-clustered into regions;
  canonical exports; derived progress metrics; nullable tempo for non-tempo work.
- Full CRUD: piece state, goals, regions, blocks, individual reps; consistent inline edits and
  confirmation-before-delete.
- Region-grouped history with summaries, search/sort, rep drill-in, rename/recolor/merge/split,
  and block movement.
- Draggable/resizable/collapsible/snap-to-edge Rep + Session windows, persisted layouts, reset.
- Independent practice focus and metronome controls. Tempo ladders advance without requiring the
  click; notes/phrasing/dynamics/memory/hands blocks can carry no BPM at all.
- Practice Universe readiness: honest metrics reward time, consistency, coverage, and quality
  without making self-reported “clean” reps the currency.

### ⟶ Immediate next steps (after v0.3.0)

1. **Christian: run the real at-piano acceptance session on v0.3.0** — edit one mistake after
   logging, expand its region down to reps, move both floating panels, and try a phrasing block
   with the metronome off.
2. Fix any real-use friction before expanding scope.
3. ~~Plan P4 with a real-PDF/light-mapping spike~~ → shipped in v0.4.0.

## 🟢 P4 — Score viewer — DONE — shipped 2026-07-12 as **v0.4.0**

The real PDF is now the piece's hero surface. Shipped:

- Bundled PDF.js + local worker; continuous pages with visible-page ±1 canvas virtualization,
  cancellable rendering, HiDPI cap, fit-width/manual zoom, page controls, and readable editions.
- Rust-only PDF discovery and path validation. Exact bytes cross raw Tauri IPC; no filesystem
  scope, base64, traversal, symlink escape, or cross-piece edition access.
- Edition preference survives rescans. Region anchors store normalized rectangles per edition
  fingerprint; changed editions say **remap** rather than showing a false highlight.
- Region sidebar + active-block highlighting + selected Region block history + prefilled
  **Practice this Region** form. Mapping supports multiple boxes, undo, save, clear, merge, and
  safe invalidation on split.
- Silent deterministic voice navigation: **“go to/show page N”** and **“go to/show measure N.”**
- Real fixtures: seven Scherzo editions up to 20.3 MB / 28 pages and an 85-page Cortot volume.
  Frontend 28 files / 145 tests; Rust 228 unit + 13 integration passed; strict clippy and
  production build green. Visual mapping flow passed in dark mode.

**Honest boundary:** mapping is manual page geometry, not note recognition. A native real-score
at-piano pass is still part of Christian's standing acceptance run.

### ⟶ Next steps

1. Christian maps one Scherzo Region, switches editions, voice-jumps to its measure, and opens a
   practice block from the score during the real-piano acceptance run.
2. Build P5's grounded brain and knowledge graph; do not put an LLM in score navigation.

## 🟢 P5 — Brain + knowledge library — DONE — shipped 2026-07-12 as **v0.5.0**

Typed + wake-word grounded Q&A now uses Claude-native → Gemini-native → cited-offline fallback;
the local graph contains 28 practice methods, 13 symptom routes, 10 psychology principles, and 18
primary/authoritative sources. Bounded selected-piece context excludes paths/secrets. A visible,
read-only Next work trace ranks due goals, open blocks, weak/recently missed Regions, and spaced
revisits. Intake conversation proposes expiring one-time field diffs; only explicit Save mutates.
The Brain has no verdict/navigation/tempo/scheduling/tools authority. Three fresh reviews closed
semantic policy, authorization, data-sync, and planner visibility gaps. Full record:
[[(C) v0.5.0 — Version Record]].

### ⟶ Next steps

1. Build P5.5's nested Goal + seven-day daily-work layer on top of the deterministic planner.
2. Recovery must preview first and apply atomically only after Christian chooses Move / Done /
   Dismiss / Leave; no broken-streak punishment and no automatic rescheduling.

## 🟢 P5.5 — Goals + calendar — DONE — shipped 2026-07-12 as **v0.6.0**

Schema v5 adds strict daily work with immutable origins and audit events. Nested Goals expose
subgoal completion plus Calendar-work summaries. The seven-day Calendar supports explicit CRUD,
capacity, and Goal paths. Missed work previews without writes, then one optimistic atomic Apply
handles Move / Done / Dismiss / Leave under deadline, horizon, and exact half-capacity rules.
Deterministic Goal suggestions gain an explicit Schedule form; providers still have no scheduling
authority. Full record: [[(C) v0.6.0 — Version Record]].

### ⟶ Next steps

1. Backfill reconstructable `session_event` history into canonical events idempotently before the
   Universe reads metrics; do not claim old work never happened.
2. Execute P6: honest Home/Universe, references, deep settings, icon, automated sealed DMG.

## 🟢 P6 — Home + Practice Universe — DONE — shipped 2026-07-12 as **v1.0.0**

Home now opens on an honesty-first Practice Universe backed by schema-v6 canonical history. Focused
time, 28-day active dates, Region breadth, and revisits drive accessible star systems; quality is
only a narrow text-equivalent brightness tint, never a score. P6 also ships fixed-origin reference
searches, deep typed Settings with native write-only keys, verdict aliases, final icon, restrictive
CSP, and one rollback-safe app/DMG/checksum release path. Full record:
[[(C) v1.0.0 — Version Record]].

**v1.0.1 reliability patch:** the v1.0.0 score spinner was traced to PDF.js's modern module
worker under WKWebView/Tauri's custom protocol—not to corrupt PDFs. The matching legacy display +
in-process loopback worker now renders the actual 25-page Scherzo, and bounded loading exposes a
retryable error instead of hanging. Full record: [[(C) v1.0.1 — Version Record]].

**v1.0.2 scanned-PDF patch:** Christian's screenshot caught the remaining acceptance hole:
page metadata worked while real image-backed music pages painted white. The exact PDF.js 6.1.200
WASM/CMap/font/ICC runtime is now bundled and configured for same-origin WebKit use. A packaged
native pixel gate visibly painted representative JBIG2, JPEG/ICC, and CCITT pages. Full record:
[[(C) v1.0.2 — Version Record]].

**v1.1.0 coherence release:** one canonical Region/Tricky Section now drives Score and Details
editing, explicitly linked score practice, color-coded box/highlight/text-note overlays, block
history, and Calendar associations. Big Goal deadlines appear as Calendar milestones; stars open
their exact piece; async loaders reject stale selections. Region split is atomic and Region graph
deletes/merges preserve linked history. Full record: [[(C) v1.1.0 — Version Record]].

**v1.2.0 actionable-score release:** each measure-sorted section is now an accordion with its own
Practice, Edit, Score marks, and Tutorial tools; title and Practice notes are separate shared
fields; score density adds Fit page, 2-page, 25–200% zoom, search, and hide/show sections. Schema 7
adds reusable local-video chapters mapped many-to-many to Regions. The analyzed 39:57 Scherzo
tutorial is mapped to all 12 live sections. Full record: [[(C) v1.2.0 — Version Record]].

**v1.3.0 compact-workspace/Brain release:** Settings now scales the complete interface from 75–125%
(90% default); the score rail and persistent Brain drawer collapse without discarding context;
floating practice no longer reserves a permanent gutter; the native window reaches 720×520. The
Brain performs cached bounded read-only retrieval across three supported practice books, extracts
bounded notated facts from the exact selected MusicXML measure range, combines canonical goals/
Regions/reps/session state, and exposes a visible per-answer grounding receipt. Retrieved book
excerpts cross to Claude/Gemini only with the explicit sharing setting; offline book prose cannot
leak through later conversation history. Full record: [[(C) v1.3.0 — Version Record]].

### ⟶ Next steps

1. Christian runs the complete v1.3.0 path: narrow/scale the window → Scherzo section → collapse
   score rail → Brain → describe a real failure → verify grounding → disagree/request an
   alternative → manually record the chosen experiment.
2. Tune only what real use proves weak; do not expand scope before that evidence.
3. Add the off-disk private git remote.

## 🟢 P7 — Practice OS transformation — SHIPPED inside **v3.0.0**

Christian's July 15 feedback and the live database replaced the old “wait for first use” plan with
direct evidence. v1.3.0 has been used for **481 recorded attempts across 48 blocks**. The issue is
not missing scope at the edges: the core completion contract, score-location workflow, history
scale, voice firewall, Brain ergonomics, interface, and Universe all need a coordinated rebuild.

Locked product systems (full contract: [[(C) v2 Transformation Brief]]):

1. **Practice Ledger + Protocol Engine** — immutable attempts; configurable consecutive-clean /
   adaptive-recovery gates; current/best streak; honest accuracy; undo/correct/restart; focus,
   breaks, safety, stages, tempo-down recovery, and cold retention.
2. **Score Atlas** — selection-first targets, exact MusicXML identity where compatible, visible
   calibration/confidence/correction for scanned PDFs, nested/overlapping targets, aesthetic notes,
   and one-action resume from the score.
3. **Compact Session Desk** — global write receipts, scalable filtered/disclosed history, precise
   summaries, editable 20-minute routines, and canonical Markdown projections.
4. **Two-lane Voice + Brain** — deterministic terse hot loop; validated/confirmed/undoable
   natural-language action drafts; narrated-recording replay; concise durable score/corpus/history-
   grounded answers and narrowly typed tools.
5. **Handcrafted Practice OS + earned Universe** — off-white/ink/terracotta operational language,
   asymmetrical matte surfaces and restrained motion; zoomable/pannable graph whose dense color is
   earned through time, consistency, coverage, recovery, mastery contracts, and retention.

Execution is gated in that order because history, Brain, and Universe must derive from the corrected
practice semantics—not from v1's “every attempt advances completion” model. The row-level proof
contract lives in [[(C) v2 Acceptance Matrix]].

**Historical source gate, subsequently installed in v3.0.0:** schema-v8 sidecars plus
the schema-v9 one-live-set invariant; transactional RepEngine/store/IPC writes; configurable
consecutive-clean mastery; exact tries/streak/reset/accuracy/tempo/review projections; append-only
undo/correct/reverse/restart; relaunch recovery; immutable historical set rows; and one Rust-owned
projection across the HUD, history, metrics, planner, export, Brain context, and voice verdict
adapter. Disposable copies of the July 15 backup preserve every legacy row/hash, project **792**
explicit anomalies, and keep all 127 legacy non-tempo BPM sentinels physically exact while showing
them semantically as not applicable. Christian's live database is now schema 10; v3.2.0's release
audit preserved it exactly at 6 pieces / 63 blocks / 559 reps / 14 sessions.

This closes the central “attempts are mastery” source defect. **2026-07-16 — the practice loop
itself is now durable and proven in source** (recovered from the interrupted overnight build and
re-verified blocker by blocker): command receipts/idempotency, pause-aware active time with
one-minute suspension caps and backward-clock rejection, a fail-safe idempotent safety stop,
physically-anchored recovery, validated typed retention, and terminal mastered sets (the one real
defect found — history repairs reopening a mastered set — is fixed and regression-locked). The
same slice made Score Atlas target save real end to end (no schema change; rehearsals now land
**schema 10** exactly), gave the two voice lanes a single owner for set-opening, and confirmed
the five-workspace shell/Universe render only earned, real-backend signals. Later the same day,
the Session Composer gained its receipted `session_plan_start` backend and an honest Today mount
(explicit per-item starts, plan recorded in the receipt itself). By the end of the day the
**entire narrated corpus — all four sessions, 1,309 segments (griffes 79 + scherzo 721/201/308)
— replays through production routing with zero false mutations** (verbatim fidelity
machine-checked), and a read-only **anomaly disclosure panel** landed in the Ledger workspace.
The v3.1/v3.2 releases subsequently shipped the first Tier B natural set draft, durable Brain
threads, interactive browser QA, and packaged-native proof. Full Goals/Calendar/session authority
and live Steinway recognition remain open.

**v3.2.0 endurance/coherence gate (2026-07-20):** explicit native metronome ownership now
coordinates manual and practice clicks through pause/resume/close/restart/safety/relaunch; session
end rejects a live set and graceful quit closes before export; a 220-attempt simulation crosses
retries, variants, corrections, recovery, retention, a three-minute relaunch gap, and export with
exact immutable truth. Reviewed plans and Score work survive workspace navigation; repeat deep
links carry the exact piece/surface; hidden Score cannot capture keys; Brain shows the exact
semantic context it sees; routine receipts remain nonblocking while every error/confirmation stays
until dismissal. Final gates: 1,025 frontend and 529 Rust/integration tests, strict clippy,
interactive mock drive, real-database rehearsal, sealed package, and fresh-verifier Ship.

**The corpus finding that sets the next priority:** the deterministic hot-loop firewall is
rock-solid — 1,309 real segments of buried command tokens, ASR corruption, and conversational
verdicts all correctly stay inert — but that is precisely why almost none of Christian's spoken
practice becomes tracked state today. Tier A already handles verdicts/undo/restart/tempo in
_command_ grammar; the gap is _conversational_ phrasing ("forget the last one" vs "undo last
rep"), and the contract's answer for that is the **Brain proposing typed drafts Christian
confirms** (Tier B/C) — not more regex, which overfits (the corpus proves conversational speech is
unboundedly varied). **The first cut shipped in source 2026-07-16** on the wake-cue trigger model
Christian chose: on "Coda, ..." the Brain proposes a typed, confirm-gated draft (verdict / tempo /
undo / restart — session-goal deferred, no backend home) into a slim card; the hot-loop is
untouched, malformed proposals drop, nothing mutates without explicit Confirm, and non-wake-cue
speech never drafts (independently adversarially verified). The Brain's _answer-quality_ half
(one-glance, memory, retention/ledger grounding) shipped the same day. **What's left is the FEEL,
not the mechanism:** how the confirm cards read back and how Christian approves them hands-free —
that needs his ear at the Steinway.

### ⟶ Next steps

1. Run v3.2.0 at the Steinway: exact verdicts, `metronome stop`, one no-wake question, and one
   selected-Region natural set request; capture every failed phrase verbatim.
2. Build the semantic capability registry for Today/Goals/Calendar/session planning. Every write
   must use preview → spoken readback → explicit confirm → durable receipt → undo; the deterministic
   hot loop remains unchanged.
3. Add page/edition-to-Region clarification and durable draft history, then address B25 only when
   real dense-history use supplies the performance/interaction fixture.

### v3 frontend rework (running inside P7) — phase status

Approved 2026-07-16: a full monochrome dark retheme, score-mapping wizard, and force-graph
Universe, on top of the Brain online fix. Eight phases, tracked here so "what's next" stays clear:

- **P0 — Parity inventory** — ✅ done (every existing control/view catalogued before any rebuild).
- **P1 — Brain online fix** — ✅ done and verified in source (invalid default model, swallowed
  5xx, emptied Keychain key all fixed; commits `550af13`, `c3b5271`, `3028d3e`, `92dbed1`).
- **P2 — Design system + shell + Settings** — ✅ done and verified in source: monochrome-only
  token system (`src/design/tokens.css`), the `src/ui/` component kit (no outlined-button
  variant, enforced by test), the new five-workspace shell (Today/Score/Brain/Ledger/Universe +
  Settings), and Settings rebuilt disclosure-organized with full parity plus a truthful
  BrainConnection block. Adversarial verifier CONFIRMED all 7 sub-claims; 629/630 tests (1
  pre-existing, unrelated failure); commits `703788e`, `01451a5`, `0b2a389`, `0b7386b`.
- **P3 — Brain workspace rebuild** — ✅ done and verified in source (2026-07-16): single-column
  chat transcript with typed Q&A (one-glance answers + citation chips), a persistent truthful
  status line (`● online — gemini` / `○ offline — <reason>` via `brain_status`), per-piece
  conversation memory (resume/clear), intake-review + work-suggestion surfaces preserved behind
  disclosures, wake-cue voice UI deliberately excluded from this tab. Dead v2 `Shell.tsx` (+ test
  - css) deleted after proving zero importers, removing the stale "Version 1.3.0" failing test;
    commit `68213d5`; suite 744 passed / 0 failed / 9 todo, tsc clean, headless QA clean; fresh
    adversarial verifier CONFIRMED 7/7.
- **P4 — Score workspace + score-mapping wizard** — ✅ done: wizard + calibration IPC + all 6
  pieces pre-mapped, 288 anchors.
- **P5 — Today workspace + practice surfaces** — ✅ done and verified in source (2026-07-16):
  Rep HUD rebuilt with mono numerals (measures/N-of-M/streak/focus clock/tempo), Clean as the
  single solid primary action, pause-aware focus time, ladder state, no decorative rings; the
  Receipt Center gets an unmissable green/red save-receipt restyle (CSS-only, logic byte-
  identical); the Session Composer's candidates → editable routine → Start flow keeps Start as
  the ONLY write (receipted `session_plan_start`), machine-verified unchanged; the retention
  queue and voice surfaces (mic/STT toast, wake-cue confirm card) plus the session event bar
  now live at SHELL level so they persist across every tab, voice wiring token-identical to the
  old v2 shell. Commits `29d88f2`/`75acdc5`/`78eb5e8`/`da468bf`, follow-up fixes `b3e53f2`. Suite
  691/0, headless QA zero console errors. Fresh adversarial verifier CONFIRMED 7/7. The same day,
  a frontend performance audit (session ledger items 12–18, report at
  `~/praelude/docs/qa/2026-07-16-frontend-perf-audit.md`) produced 14 findings that a
  fresh-context verification pass mostly killed (invented cost models, fixes that couldn't work,
  findings in code Phase 7 replaces); ONE real bug survived — a Tauri `listen()` cleanup race in
  ScoreView's `score://navigate` subscription — fixed same day (`b3e53f2`) with an alive-guard
  pattern now the repo standard. Overall async hygiene verdict: genuinely good.
- **P6 — Ledger + Calendar workspaces** — ✅ done and verified in source (2026-07-16, commits
  `7a7b590`/`37002b5`/`05353b1`): Ledger rebuilt disclosure-first (piece → block → attempts
  loaded on expand), read-only anomaly panel preserved, inline SET-TITLE editing (`block_update`)
  for block labels while attempts stay append-only immutable evidence — corrections/voids keep
  the original visible ("The original stays in the ledger"); destructive block-delete
  deliberately not surfaced. Calendar rebuilt monochrome (week view, recovery review, capacity
  control), mounted with Ledger in ONE nav slot behind a quiet Ledger|Calendar switch — the
  five-tab shell contract stays intact. `devMock` gained `rep_check`/`reps_for_block` handlers.
  Old hued CSS remapped to monochrome via scoped token aliases; the verifier traced every alias
  to its resolved value — all neutral except the two signal colors. Suite 695/2 todo, cargo
  484/0 (backend untouched), zero console errors. Fresh adversarial verifier CONFIRMED in
  substance; accuracy notes: a second pre-existing load-contention test flake
  (`RetentionQueue.test.tsx` "validates snooze dates," fails full-parallel/passes isolated —
  same class as the `pdf-assets` flake), and `RegionEditor.tsx`'s 7-color region palette being
  allowed user-data color on the score, not a monochrome violation.
- **P7 — Universe force-graph rebuild** — ✅ done and verified in source (2026-07-16, commits
  `0d076d9`/`11dff60`, wheel-zoom fix `705f872`, the last workspace): a live, movable d3-force
  galaxy — pieces are suns (size = earned focused time, log scale), practice sections are
  planets (size/brightness = honest mastery state), sessions are satellites that aggregate into
  expandable clusters; drag with spring physics (pin/reheat/settle), pan + bounded zoom, hover
  highlights a node's neighborhood, click opens a detail panel (reps, cleans, mastery,
  last-practiced, jump-to-Ledger, jump-to-score). All the app's color now lives in this one view
  against pure black; the rest of the chrome stays monochrome. Earned-growth/anti-gaming logic
  untouched (frontend-only). Engineered for Christian's 8GB machine (event delegation, memoized
  gradients, one state update per animation frame, sleeps at rest, full teardown on tab close) —
  verified stable positions at rest, zero background CPU, clean unmount. Fresh-context
  adversarial verifier returned CONFIRMED with one narrow issue — a benign console error on
  every wheel-zoom tick from React 19's passive root wheel listeners — fixed same day via a
  non-passive ref-attached listener (`705f872`); full suite after the fix: 704 passed/0
  failed/2 todo. Honest caveats: node positions persist only for the app session (deterministic
  seeding keeps the sky visually stable across opens; durable per-node layout persistence is
  deferred to Phase 8+, needs a small new backend command), and the detail panel only shows
  fields the earned-growth snapshot carries (reps/cleans/mastery/last-practiced), not streak or
  tempo detail (that's Ledger's job).
- **P8 — Package + install v3** — ✅ done: the 288 pre-mapped anchors were injected into
  Christian's live database through the validated `score_calibration_save` path (rehearsed on
  a disposable copy first, with a fresh backup `(C) pre-v3.0.0-install-2026-07-16.db`, SHA
  prefix `3d18c0ba`, taken immediately before); a parity audit checked every row of the P0
  inventory against the final app (checked off or approved as a deliberate removal); final
  gates npm 706/0/2 todo, cargo 518/0, tsc clean; installed and verified running at
  `/Applications/CodaKiller.app`, tagged **v3.0.0** (commits `56dada3`/`c53230a`/`b2e751f`).

**Design checkpoint: PASSED.** Christian approved the new monochrome shell from the P2
screenshots, clearing Phase 3 (and now every later phase through 8) to proceed.

**v3.0.0 shipped the transformation; v3.1.0 added the first safe Practice Operator slice;
v3.2.0 hardens the whole app for long-session coherence.** See
[[versions/(C) v3.0.0 — Version Record]], [[versions/(C) v3.1.0 — Version Record]], and
[[versions/(C) v3.2.0 — Version Record]].
**Next:** at-piano v3.2 acceptance, the complete Goals/Calendar/Today/session capability registry,
page/edition clarification, durable drafts, and the off-disk private git remote.

---

## Historical standing to-dos (current lanes are above)

- [x] **First substantial real use received** — July 15 live history + feedback now drives P7.
- [ ] **At-piano acceptance, written down, for the CURRENT INSTALLED release (v8.2.1).** Automated replay
      does not prove `done`, `metronome stop`, or no-wake/operator speech over the Steinway. This
      item has been open and re-worded since v3.2 without ever being completed for any release —
      v6.0.0 had one real 37-minute session (2026-08-20), but the current packaged microphone,
      Listen Back, two-word verdict and native Score behavior remain unaccepted. Run the current
      packaged checklist in `~/praelude/docs/qa/v8.2.0/README.md` and log verbatim misses in
      [[(C) Changelog]]. The old `docs/qa/p2-acceptance.md` checklist is historical only.
- [ ] **One real measure-mapping pass on the live vault.** `measure_map` is empty; the headline
      v6 feature has never run on real data ([[(C) Flaws]] B75). First obtain Christian's explicit
      approval to send the whole current edition to a selected cloud provider; then use any
      configured provider and keep the review/Apply gate human-controlled.
- [ ] **Provider choice/key is conditional, not a standalone task.** The Claude vision path has
      never executed because no Anthropic key exists ([[(C) Flaws]] B67). Add that Keychain item
      only if Christian selects Claude for the explicitly authorized mapping; an existing Gemini
      path does not waive the cloud-egress approval.
- [x] **Off-disk git backup** — DONE 2026-08-23, the project's oldest unfixed risk, resolved.
      Private remote at https://github.com/cchow375/praelude. See [[(C) Flaws]] B54/C1
      Resolved. Caveat: the Obsidian vault itself is still not backed up, only the git repo.
- [x] P6 task plan executed and checked at
      `plans/(C) 2026-07-12-codakiller-p6.md`.
- [ ] Keep [[(C) Flaws]] current as real use surfaces issues.

## Durable non-goals — do not build these

Transcription/grading/pitch-detection of playing; a local LLM; any LLM in the hot command loop;
auto-imposed drills or plans; an always-on web server / cache-busting deploys. v2 may add local
retrieval and confirmed typed language actions, but it does not weaken these boundaries. (Full
rationale in the design spec §1 and [[(C) Flaws]] D2.)
