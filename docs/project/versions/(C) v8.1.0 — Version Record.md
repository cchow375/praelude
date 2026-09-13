# CodaKiller v8.1.0 — Version Record

**Status:** SHIPPED + INSTALLED 2026-08-27  
**Release boundary:** combined remaining Aug 8 P3–P6 train + motivation correction  
**Version / schema:** v8.1.0 / schema 19  
**Installed app:** `/Applications/CodaKiller.app`  
**Final source HEAD:** `1a1e38bb7a3757cf90ee6ea814e93d5971c595d6` (atop release commit `9a4aeba1e55d1b51d6c2c8a18da0ada48181b921`)  
**Release tag / repository push:** tag `v8.1.0` points to `0a3d6a5d339955fd7e7318299eaa6c3063674415` and is pushed; first post-tag documentation baseline `da71efb5509afa36beb073050719ac1094751b98`; pushed cold-start handoff `d03a3d7b9820494b878336f7d18e5da94b821f68` had reached `origin/main` at that historical boundary; these docs-only commits do not change the tag/runtime payload  
**Installed identity / signing:** bundle id `com.christian.codakiller`; plist short/build `8.1.0` / `8.1.0`; strict signature PASS; ad-hoc local seal, not Developer ID signed/not notarized; CDHash `8655e9a45d83b7bb56e83a9d14bb477da7da39a9`  
**DMG path / bytes / SHA-256:** `releases/v8.1.0/CodaKiller-8.1.0.dmg` · 10,892,054 bytes · `e828b861b31d771fde66cd66d48987eb66110f0fd455306a6a12c2f80eb0a271`  
**Pre-install DB backup:** `(C) pre-v8.1.0-install-2026-08-27-123548.db` · 21,708,800 bytes · SHA-256 `2d06307f35a42be5a1911cbc9fbbd1c48b356449a31180c7000c7c4636448ddb`  
**v7.2 rollback archive:** `~/Library/CodaKiller-rollbacks/CodaKiller-v7.2.0-rollback.app.tar.gz` · 9,901,602 bytes · SHA-256 `e5ec3460e38a9637600e0bbbb6557c952fec6ee7743d7bd158ec4d2bc18513a1` · plist 7.2.0 / bundle id / strict signature valid

> This record is now immutable except for factual corrections. The tag and remote facts above are
> final; future post-tag documentation corrections do not change the tagged release commit.

## What this release is

Christian asked for the entire Aug 8 list to be finished and directly rejected the existing
Universe: progress remained hard to see and the app still did not feel gamified. The source audit
corrected the list denominator from 21 to **23** asks. This release supplies a concrete installed
answer or accepted boundary for each one, while preserving the product law: Christian judges his
piano; the app never grades audio.

It combines P3 Voice, P4 Score Map, P5 Warmups and P6 Review & Flow instead of manufacturing
intermediate releases that were never packaged. It also repairs B88/B89 and replaces the galaxy
with a canonical evidence dashboard.

## The 23-ask status matrix

| ID | Installed truth |
| --- | --- |
| A1 | Shipped: global + per-set inherit/off/local Sloppy demotion. |
| A2 | Shipped v7.2: variant chains govern every stage/mastery path. |
| A3 | Shipped v7.1/v7.2: compact composer hierarchy. |
| A4 | Shipped: prompt-only exact-block timed rotation. |
| A5 | Shipped: durable tuning plus running subdivision 1–16. |
| A6 | Shipped-corrected: saved hotkey remaps reach mounted HUD immediately. |
| A7 | Shipped v7.1: direct add/undo UI; P3 adds counted voice forms. |
| B1 | Shipped-corrected: v7.2 direct spots plus durable retry identity/fingerprint. |
| B2 | Shipped: movement first-page CRUD and score scoping. |
| B3 | Shipped v7.2: one memoized overlay path. |
| B4 | Shipped v7.0.1: small-window editor overlap fixed. |
| B5 | Flow shipped; real-provider/live acceptance still open. |
| C1 | Shipped: visual catalog, saved routines, real rep-engine runner. |
| C2 | Shipped; packaged mic/Steinway hardware acceptance open. |
| C3 | Shipped v7.0.1: labelled Mic/Muted control. |
| D1 | Shipped; voice-over-Steinway acceptance open. |
| D2 | Shipped: deterministic counted add-Clean/append-only undo by voice. |
| E1 | Shipped at accepted archive + recent-first/no-folders boundary. |
| E2 | Shipped: editable Sound target beside verdict work. |
| E3 | Shipped: galaxy replaced by evidence dashboard. |
| E4 | Closed by accepted decision: Assistant OFF, hidden and Rust-gated. |
| E5 | Shipped v7.1: session lifecycle race class closed. |
| E6 | Shipped for this round: XP/levels/badges/rails/cadence + earned moments. |

## Source payload

### P3 — voice and hands-on control

- Short verdict acknowledgement chime.
- Last-three final heard feed, including ignored speech.
- Live-set-only partial fast path for **mark done / rep done / mark sloppy / mark again**;
  routed-intent tail protection prevents duplicate settled action.
- Live Settings settle delay (300–2000 ms).
- Counted voice add-Clean and append-only undo with rejection-before-mutation.
- Verdict-hotkey remaps publish after Save to the already-mounted HUD.

### P4 / schema 17 — movements and honest mapping

- `piece_movement` CRUD stores only title + first PDF page; Piece Detail edits and Score toolbar
  scopes pages/current-edition sections. Zero rows preserves Whole score behavior.
- Reversible `piece.archived_at` is also introduced at this schema boundary.
- **Map measures** teaches loading/edition/page/provider prerequisites, identifies Claude/Gemini
  readiness, refuses Start with no key, states whole-edition upload and writes only after Apply.
- External gap: no Anthropic key and the last live database audit held zero map rows.

### P5 / schema 18 — Warmups

- Search/filter visual catalog with SVG keyboard figures + concise text, paged for 720×520; its
  layout/grid/heading children shrink inside the effective 480px stage.
- At the 720×520 floor Warmups reversibly tucks only the expanded Rep Counter, preserving the
  active set and respecting a user's restore/close.
- Named/reordered routines with per-item BPM and consecutive-clean target.
- Reserved hidden `id=0 · Warm-ups · system` piece and exact rep-engine runner.
- Authoritative verified mastery advances the exact expected item; full routine completes once.
- Real focus counts toward streaks and Universe technique evidence; system work stays out of
  repertoire/Score/Pieces.

### P6 / schema 19 — Listen Back and flow

- Review mode acquires a native capture lease before WebView recording, physically suspending STT;
  pending/failure blocks verdict mutation and teardown restores exact prior user mute.
- Piano-oriented mono capture with browser processing disabled and a ten-minute hard bound.
- Listen-before-verdict soft gate + explicit Judge anyway; next take starts automatically.
- Temporary bytes discard unless **Keep after verdict** is explicit. Kept exact-attempt files are
  confined/recoverable and play through output-only gain.
- Prompt-only Rotation owns/pause only the exact block it opened and validates the requested next
  target; full cycle celebrates once. At 720×520 unsafe restored/collision `y=360` clamps to
  `y=164`, leaving the bottom 56px Tools reserve reachable.
- Reversible Archive/Restore + recent-first groups; destructive path separately **Delete files…**.
- Editable **Sound target** beside the live verdicts.

### Motivation correction

The old galaxy is removed. The replacement derives only from canonical practice evidence:

- **1 Practice XP = 1 fully completed focused minute.** Quality/verdicts never add/remove XP.
- Deterministic triangular level curve.
- Badge cabinet + exact next rail for active days, best streak, focused hours, revisits, verified
  mastery and honest recovery.
- Zero-filled 28-day cadence, current progress rails, repertoire evidence and technique aggregate.
- Archived and file-deleted lifetime history remains real; hidden warmups remain technique only.
- Warmup routine, full rotation cycle and explicitly kept reference take are earned moments.
- Universe tucks the Rep Counter without ending the active set so progress is unobstructed.

### Corrective integrity work

- **B88 closure:** set-local demotion + live-HUD subdivision.
- **B89 closure:** durable spot command id, payload fingerprint, committed-receipt replay,
  conflict rejection and one bounded exact-id retry.
- **E4 accepted cleanup:** while Assistant is OFF, Settings teaches only the practice-command lane,
  hides provider-only confirmation copy and Books, keeps settle timing under Voice and leaves the
  Assistant enable switch discoverable.
- Replay file recovery quarantines unverifiable content, rejects symlinks/path escape and keeps a
  file-first delete failure retryable.

## Data rehearsal

A disposable SQLite `.backup` of the live schema-16 database rehearsed through schema 19. The
source relationship graph remained intact and integrity stayed OK. The only new piece was the
designed hidden system row; movement/routine/replay tables began empty. The installed migration
then reproduced that preservation on the live database.

Pre-install safety preparation now exists. The schema-16 live snapshot was integrity OK at
10 pieces / 230 blocks / 2,034 reps / 46 sessions / 7,873 session events / **1 open session** /
0 measure-map rows. The exact backup and outgoing v7.2 rollback facts are recorded in the header.
Fresh installed launch migrated schema 16→19 with integrity OK and zero foreign-key violations.
Pieces changed 10→11 solely because of hidden id0 Warm-ups; 230 blocks / 2,034 reps / 46 sessions /
7,873 session events / 1 open session were unchanged. Movement/routine/replay tables and
`measure_map` remained empty. The open session was intentionally preserved.

## Verification at ship

- Frontend: **2,650 passed / 1 skipped / 0 failed**; 209 files passed / 1 skipped.
- Native all-target/all-feature: **1,100 passed / 19 ignored / 0 failed**.
- TypeScript, format, strict Clippy and production Vite build: **PASS**.
- Five narrated corpora: **PASS with zero false mutations**.
- Eight macOS release-script gates: **PASS**.
- Browser/devMock QA record: `docs/qa/v8.1.0/README.md` records eight accepted frames—Universe
  (720 + 1280), shelf, empty teaching, Warmups, Listen Back, movement and Rotation at 720×520.
  Rotation is fully above its Tools reserve; Warmups fits the effective 480px stage. The record is
  explicitly non-native. Assistant-off Settings cleanup is focused-test evidence, not a claimed
  screenshot.
- Installed plist/version/bundle/signature/launch: **PASS** with the exact header facts above.
- Live schema-19 integrity/FK/relationship/count verification: **PASS** with the exact graph
  above.
- Installed-native 720×520: Universe accepted at Level 7 / 831 XP / 95% / 9 XP to Level 8,
  quality-neutral copy, tucked Rep Counter and no clipping. Warmups accepted with no overlay or
  clipping, **Restore Rep Counter** in Tools and active set unchanged.

## Honest gaps at this release boundary

- Real-provider measure mapping remains unproven on current live scores; Claude path never ran.
- Listen Back's native permission/device ownership and piano-useful playback remain unaccepted.
- Voice-over-Steinway and most native interaction flows remain unaccepted. Installed-native
  Universe and Warmups at 720×520 are accepted.
- Sustained use must decide whether the earned motivation dashboard actually changes behavior.
- Assistant remains OFF by product decision; folders remain declined, not forgotten.
- B78/B84 and the recorded smaller residuals remain open.

## Next steps

1. Obtain Christian's real WKWebView microphone/Listen Back and voice-over-Steinway verdicts.
2. Keep Aug 8 ask B5 external-only until Christian explicitly approves whole-edition cloud
   egress and one real provider/current-edition mapping is applied.
3. Judge sustained motivation after real use of XP, levels, badges and cadence.

**Final denominator:** **22 delivered / 1 Aug 8 B5 external-only / 0 absent**. C2 source is delivered;
its real WKWebView microphone and Steinway acceptance remains external.
