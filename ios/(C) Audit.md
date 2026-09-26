# (C) Audit — iPad app vs. Full Build Spec v2

**Date:** 2026-09-24 · **Baseline:** `ios/` 1.1.0/build2, schema2, commit `36838dd` · **Method:** code read of
`ios/Praelude/**` by four parallel read-only reviewers, then orchestrator review of their verdicts. Verdicts
come from code, not from doc claims. Anything that can only be proven at an instrument or on a device is
marked **UNVERIFIED** rather than _works_.

Legend: **W** = works · **P** = partially works · **M** = missing · **U** = code exists, acceptance unproven

## Summary

| Area                | W     | P   | M   | Notes                                                                          |
| ------------------- | ----- | --- | --- | ------------------------------------------------------------------------------ |
| §3 Design           | 1     | 4   | 2   | System fonts, SF Symbols, **indigo accent (banned)**, stock component look     |
| §4 Accounts / sync  | 0     | 0   | all | No backend code of any kind. No Supabase CLI or Docker on this Mac             |
| §5 Social           | 0     | 0   | all | —                                                                              |
| §6 Instruments      | 0     | 1   | 6   | Keyboard-only "hands"                                                          |
| §7 Library / reader | 11    | 5   | 17  | Solid PDF reading; annotation and page tools thin                              |
| §8 Passages         | 5     | 2   | 2   | Strongest existing area                                                        |
| §9 Voice            | 6 (U) | 1   | 3   | On-device fixed vocabulary exists; never accepted at a piano                   |
| §10 Practice loop   | 6     | 4   | 3   | Contracts, ladder, variants exist; no goals, defaults or next step             |
| §11 Rules R1–R15    | 0     | 1   | 14  | Mac has cold-open, retention and weighting logic to port                       |
| §12 Warmups         | 0     | 0   | all | Mac has warmups, rotation and a keyboard figure                                |
| §13 Audio tools     | 4     | 0   | 5   | Buffer-scheduled metronome; no count-in, background, tuner, drone or recording |
| §14 Rewards         | 4     | 1   | 5   | Verdict sounds and finales exist; no ranks, coins, Studio or badges            |
| §15 Today / history | 0     | 2   | 3   | —                                                                              |
| §16 Data views      | 0     | 0   | 4   | —                                                                              |
| §17 Testing         | P     |     |     | Core/app/UI tests exist; none of the §17a acceptance tests exist               |

**Blocking findings before any build commit**

1. **The GitHub repo `cchow375/praelude` is PUBLIC** (`gh repo view`: `isPrivate: false`), yet the docs call it
   private. Spec §0.6 forbids committing config until it is private. Nothing has been committed.
2. **Supabase needs Christian.** The CLI is not installed and there is no Docker (needed for local RLS tests).
   Christian must sign in (§4a).
3. **Existing device data:** the iPad has 1.1.0/build2 with an unmigrated schema1 ledger. The free signing
   profile expired on 2026-09-21. Any new build must migrate that ledger losslessly (§0.4).

---

## §3 Design

| Item                                                                       | Status       | Evidence / gap                                                                                                                                |
| -------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 3a Monochrome palette, one rare accent                                     | **P**        | Mostly system grays, but `Color.accentColor` (system blue) is used broadly and `.tint(.indigo)` appears at `Views/PassagePickerView.swift:50` |
| 3a Light "paper and ink" / dark "stage" designed separately                | **M**        | Only a system appearance picker (`SettingsView.swift:13`); no custom themes                                                                   |
| 3a Characterful engraving face + UI face; tabular figures                  | **P**        | System fonts only; tempo uses `.system(… .rounded).monospacedDigit()` (`MetronomeView.swift:20`)                                              |
| 3a Custom consistent iconography, no emoji                                 | **P**        | No emoji; SF Symbols only, no musical icon set                                                                                                |
| 3b No banned AI tells                                                      | **P (fail)** | Indigo tint; stock `.bordered`/`.borderedProminent` buttons and `Form`s are the "default component-library look"                              |
| 3c Spring and interruptible motion, spatial transitions                    | **P**        | Springs exist in the feedback view; no passage-expand, set-collapse or paper page-turn transitions                                            |
| 3c Reduce Motion, haptics                                                  | **W**        | `PracticeFeedbackView.swift:7,22`; `FeedbackService.swift:56–61`                                                                              |
| 3c 120 fps, no hitches with the metronome                                  | **U**        | Never profiled                                                                                                                                |
| 3d Edge controls, readable at 1 m, nothing over the music, one-tap actions | **P / U**    | Dock sits in the bottom safe-area inset (`ScoreWorkspace.swift:113`); legibility at 1 m is unmeasured; the HUD can't collapse                 |
| 3d Portrait, landscape, split view                                         | **P**        | Size-class adaptive; no split-view evidence                                                                                                   |

## §4 Accounts, profiles, sync — **all M**

No Supabase, auth, profile or sync code exists anywhere in `ios/`. Storage is a single local
`library.json` plus PDFs (`Core/PracticeStore.swift`). This applies to every item in 4a (project, migrations,
RLS, buckets), 4b (Apple, email, magic link, reset, sign-out, delete account, guest upgrade), 4c (all profile
fields, stats, per-field privacy, preview) and 4d (offline-first sync, append-only reps, field-level LWW,
stroke merge, status indicator).
**Architectural implication:** the model has no stable per-record `updatedAt`/tombstones or per-stroke identity
(ink is an opaque `PKDrawing` blob per page), so sync requires a schema3 migration.

## §5 Social — **all M**

Feed, presence, friend cards, reactions, comments, Notes, search, invites/QR, contacts, requests, private
accounts, shared repertoire, studios, leaderboards, report, block, text filter, moderation queue, privacy
settings and age gate are all absent.

## §6 Instruments

| Item                                                            | Status | Evidence / gap                                      |
| --------------------------------------------------------------- | ------ | --------------------------------------------------- |
| Onboarding instrument pick                                      | M      | No onboarding at all                                |
| Parts wording per instrument                                    | P      | Keyboard hands only (`SetComposerView.swift:72–77`) |
| Instrument-specific variant defaults                            | M      | —                                                   |
| Tuner / drone                                                   | M      | —                                                   |
| Transposition display                                           | M      | —                                                   |
| One-tap instrument switch; piece tied to an instrument          | M      | `Piece` has no instrument field                     |
| Voice works for winds, brass and voice (speak between attempts) | U      | The vocabulary is generic; never tested             |

## §7 Library and reader

| Item                                                   | Status | Evidence / gap                                                                    |
| ------------------------------------------------------ | ------ | --------------------------------------------------------------------------------- |
| Import from Files / iCloud Drive                       | W      | `AddPieceView` fileImporter; `NativeLibraryFiles.importPDF`                       |
| Share sheet, AirDrop, "Open in"                        | M      | No `onOpenURL` or document-type handling                                          |
| Cloud providers                                        | P      | Only through the Files picker (acceptable if providers install a Files extension) |
| Photo or camera scan to PDF                            | M      | No VisionKit                                                                      |
| Original kept                                          | W      | Copied into `Scores/`                                                             |
| Cover grid / list                                      | P      | List only                                                                         |
| Title, composer                                        | W      | —                                                                                 |
| Instrument, tags, difficulty, folders                  | M      | Not in the model                                                                  |
| Status Active / Resting / Completed                    | P      | No Completed                                                                      |
| Search, sort (recent / title / composer)               | W      | `LibraryViews`                                                                    |
| Auto and custom covers                                 | M      | —                                                                                 |
| Setlists                                               | M      | —                                                                                 |
| Sharp render, portrait single, landscape two-page      | W      | PDFKit `PagedScoreView`                                                           |
| Half-page turns                                        | M      | —                                                                                 |
| Swipe / tap-zone turning                               | P      | Swipe only                                                                        |
| Performance mode                                       | P      | Focus mode hides chrome but doesn't lock the UI                                   |
| Pencil + finger ink, undo/redo, never modifies the PDF | W      | `ScorePageOverlay`, separate `ScoreDrawing`                                       |
| Highlighter, eraser, colors, widths                    | P      | Pen only is surfaced                                                              |
| Lasso, stamps, text boxes, layers                      | M      | —                                                                                 |
| Page tools (crop, rotate, reorder, delete, insert)     | M      | —                                                                                 |
| Repeat / D.S. / coda links, bookmarks                  | M      | —                                                                                 |
| Annotated PDF export                                   | W      | `ScoreExport.annotatedPDF`                                                        |
| Share with a friend                                    | M      | Needs §5                                                                          |
| Resume position                                        | W      | `Piece.lastPage`                                                                  |

## §8 Passages

| Item                                      | Status | Evidence / gap                          |
| ----------------------------------------- | ------ | --------------------------------------- |
| Draw a box = passage                      | W      | `ScorePageOverlay` pan gesture          |
| Multi-region, multi-page                  | W      | `Passage.regions: [PassageRegion]`      |
| Auto page turn while practicing           | M      | —                                       |
| Optional measure numbers                  | W      | `PassageEditorView`                     |
| Subtle outlines                           | W      | —                                       |
| Tap outline → practice immediately        | P      | Opens the `SetComposerView` modal first |
| Long-press edit / rename / delete         | W      | —                                       |
| Recolor, split, merge                     | M      | No color field; no split or merge       |
| Quick-create sub-passage while practicing | M      | Drawing is disabled during a set        |
| Delete archives history                   | W      | Snapshot kept in history                |

## §9 Voice

| Item                                                                                               | Status | Evidence / gap                                                                                                |
| -------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------- |
| Clean / Sloppy / Again / Undo; Start, Stop, Pause, Tempo N, Metronome on/off, Next, Slower, Faster | W (U)  | `Services/VoiceCommand.swift:16–37`                                                                           |
| Cold grading Clean / Shaky / Missed                                                                | M      | —                                                                                                             |
| On-device, offline, fixed vocabulary                                                               | W      | `requiresOnDeviceRecognition` (`SpeechCommandService.swift:80`); contextual strings (`:130`). US English only |
| Robust to a ringing acoustic instrument; click never misheard                                      | **U**  | Never tested in a room. Mac history (Flaws A1): missed words over the Steinway                                |
| ~0.5 s latency                                                                                     | P      | A 1.2 s silence timeout (`SpeechCommandService.swift:173`) makes >1.2 s likely                                |
| Visible + audible confirmation per command                                                         | P      | Visual flash and verdict tones exist; non-verdict commands have no sound                                      |
| Misrecognition log                                                                                 | M      | —                                                                                                             |
| Mic indicator + one-tap mute                                                                       | W      | `ScoreWorkspace.swift:431–438`                                                                                |
| Large fallback verdict buttons                                                                     | W      | `ScoreWorkspace.swift:400–410`                                                                                |
| Onboarding voice check                                                                             | M      | —                                                                                                             |

## §10 Practice loop

| Item                                                              | Status | Evidence / gap                                             |
| ----------------------------------------------------------------- | ------ | ---------------------------------------------------------- |
| ≤2 taps to practicing                                             | P      | Passage → composer sheet → Start is 3+ taps                |
| Defaults from rules and the last session                          | P      | Hard-coded 5 clean / 60 BPM (`SetComposerView.swift:8–15`) |
| One-gesture tempo (drag, ±1/±5, tap, voice), no modal or keyboard | P      | Steppers + tap tempo + voice; no drag on the number        |
| Clean-streak / Total-plays contracts                              | W      | `PracticeEngine.swift`                                     |
| Set goal (Tempo, Notes…) with non-tempo goals muting the click    | M      | —                                                          |
| Tempo ladder                                                      | W      | `SetComposerView.swift:86–99`, `PracticeEngine.swift:56`   |
| Variant chains with per-variant targets                           | W      | `VariantStage`                                             |
| Saved variants and routines reused across pieces                  | P      | `PracticeRoutine` model only                               |
| Pause / resume                                                    | W      | `SetStatus`, `togglePause`                                 |
| HUD content                                                       | P      | Rung not distinct; not readable at 1 m by design           |
| HUD at the edge                                                   | W      | Bottom safe-area inset                                     |
| HUD collapsible to a strip                                        | M      | —                                                          |
| One-line next step + reason after each set                        | M      | —                                                          |

## §11 Rules

| Rule                    | Status | Mac reference for porting                                      |
| ----------------------- | ------ | -------------------------------------------------------------- |
| R1 small chunks         | M      | —                                                              |
| R2 join seams           | M      | —                                                              |
| R3 cold grade           | M      | `src-tauri/src/rep/mod.rs` (cold-open), `store/practice_v2.rs` |
| R4 spaced review        | M      | `src-tauri/src/store/practice_v2.rs`, `rep/mod.rs`             |
| R5 streak goal by state | P      | Streak exists; no state-based targets                          |
| R6 slow down            | M      | `rep/mod.rs` setback handling                                  |
| R7 speed up (≤2/day)    | M      | `rep/mod.rs` ladder step                                       |
| R8 split weak spot      | M      | —                                                              |
| R9 stop grinding        | M      | `src-tauri/src/planner/`                                       |
| R10 performance-ready   | M      | `rep/mod.rs` cold-open gate                                    |
| R11 performance date    | M      | `src/features/calendar/`                                       |
| R12 variants when stuck | M      | `src-tauri/src/dynamics/weighting.rs`                          |
| R13 parts separately    | M      | `dynamics/weighting.rs`                                        |
| R14 pulse check         | M      | —                                                              |
| R15 session builder     | M      | `src-tauri/src/planner/`, `src/features/today/`                |

Rule parameters in Settings, reasons, one-tap overrides and override logging: **M**.
Mac file references were checked to exist; their exact semantics are to be read during the port. The Mac rules
are a behavior reference and differ from the spec's R-numbering; the spec wins.

## §12 Warmups — **all M**

Library, rotation, favorites, last used, key picker and neglected keys are all absent.
Mac reference: `src/features/warmups/`, `src/features/rotation/`, `KeyboardFigure.tsx`.

## §13 Metronome, tuner, drone, recording

| Item                                                                          | Status | Evidence / gap                                                                                                 |
| ----------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------- |
| Sample-accurate scheduling                                                    | W (U)  | AVAudioEngine looping PCM buffer (`MetronomeService.swift:201–227`); 10-minute drift under load never measured |
| Meter, subdivisions, accents, several sounds, volume, visual pulse, tap tempo | W      | `MetronomePattern.swift`, `MetronomeService`                                                                   |
| Count-in                                                                      | M      | —                                                                                                              |
| A sound that cuts through a loud instrument                                   | U      | Wood/Click/Bell exist; not tested against an instrument                                                        |
| Background / locked-screen playback                                           | M      | No `UIBackgroundModes audio`; stops on background (`MetronomeService.swift:96`)                                |
| Pulse-check dropouts                                                          | M      | —                                                                                                              |
| Tuner, drone                                                                  | M      | —                                                                                                              |
| Recording, playback, compare, storage cleanup                                 | M      | —                                                                                                              |

## §14 Rewards

| Item                                                     | Status | Evidence / gap                             |
| -------------------------------------------------------- | ------ | ------------------------------------------ |
| Verdict sounds, set/chain finales, haptics, volume       | W      | `FeedbackService`, `PracticeFeedbackEvent` |
| Ranks and divisions, coins, Studio shop                  | M      | Mac: `src/features/studio/`                |
| Daily streak + freezes                                   | P      | Only the in-set streak                     |
| Honest reward economy (Sloppy never punished)            | M      | No economy yet                             |
| Milestone celebrations (perf-ready, piece, rank, streak) | M      | —                                          |
| Badges, feed sharing                                     | M      | —                                          |

## §15 Today, history, calendar, notebook

| Item                  | Status | Evidence / gap                                                       |
| --------------------- | ------ | -------------------------------------------------------------------- |
| Today                 | P      | Sessions and active set; no R15 session, due reviews or performances |
| Calendar              | M      | Mac: `src/features/calendar/`                                        |
| History               | P      | Session list only; no per-passage grade/tempo history                |
| CSV/JSON export       | M      | —                                                                    |
| Notebook, lesson prep | M      | `Piece.notes` only. Mac: `src/features/notebook/`                    |

## §16 Data views — **all M**

Heatmap, session summary, piece readiness and weekly recap are all absent.

## §17 Testing

Existing: `PraeludeCoreTests` (engine), `PraeludeAppTests` (feedback, export, markup, ink lifecycle, hit routing,
files), `PraeludeUITests` (practice flow, markup, verifier screenshots), `ServiceChecks`, and helper tests in
`ios/scripts`. Current run result: see "Build verification" below.

Missing: every §17a acceptance test (force-quit mid-set, sync parity, RLS, 10-minute drift, voice at an
instrument, R1–R15 staged, cross-page passages, annotation alignment) and the §17b `(C) UX Audit.md`.

## Build verification (this audit, 2026-09-24)

- `bash scripts/check.sh` → exit 0 in 37 s. Swift package: **29 tests, 0 failures**. ServiceChecks:
  **PASS, 2,166 assertions**. Simulator build: **BUILD SUCCEEDED** (Xcode 26.6, iOS Simulator SDK 26.5).
- Installed and launched on the iPad Pro 11-inch (M5) simulator: it launches to a blank **Today** screen
  ("Start practicing / Add your first piece"). The screenshot confirms the §3 findings: a stock system layout
  and an **indigo** primary button.
- Not run in this audit: app-hosted tests and UI tests (Xcode Product → Test). The Git repo-visibility blocker
  above is still open.
