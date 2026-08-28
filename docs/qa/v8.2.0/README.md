# v8.2.0 — Score and practice UI browser QA

> **Evidence class: browser/devMock source candidate.** These five frames prove that the named
> v8.2 source UI rendered and was visually inspected at the recorded viewport. They do **not**
> prove a packaged/signed app, WKWebView scrolling, native IPC/SQLite, the live schema-20 migration,
> microphone/Listen Back, voice-over-Steinway behavior or Christian's at-piano acceptance.
> Release source is `afe65f3b176a1c5da81eca6d2f65bd721726ee40`. The package/install/live
> migration passed, but the frames below remain browser evidence; packaged launch encountered a
> Desktop-folder permission prompt that was not granted, so no native Score frame is claimed.

## Accepted frames

| Frame | Viewport | What was accepted | What it does not prove |
| --- | --- | --- | --- |
| `ck-continuous-score-720x520.png` | 720×520 | Score occupies the bounded stage with no document-level overflow; the PDF is a continuous scroll, Tricky Sections owns its own rail, and the compact toolbar/dock leave the reading surface usable. | Packaged WKWebView wheel feel, native PDF decode performance, installed state or every score edition. |
| `ck-continuous-score-1462x919.png` | 1462×919 | The same hierarchy scales cleanly: compact one-line workspace header/toolbar, large continuous score pane, independently scrolling section rail and bottom dock without overlap. | Long-session memory behavior or every PDF page/shape. |
| `ck-practice-composer-auto-reveal-720x520.png` | 720×520 | Selecting/expanding a Tricky Section scrolls its practice composer into view inside the rail; the PDF pane does not jump with it. | Touchpad feel in the native WebView or persistence of a newly started live set. |
| `ck-compact-variants-720x520.png` | 720×520 | Variant presets stay on one horizontally scrollable chip row and configured variants render as compact inline rows rather than giant numeric boxes; multiple rows remain visible at once. | Voice control, saved native round-trip or an unbounded number of custom variants. |
| `ck-total-plays-720x520.png` | 720×520 | **Total plays** is a compact first-class target choice with preset count, fixed-tempo/no-variants explanation and a legible 0/N live HUD at the supported floor. | Native database migration or downstream mastery filtering by screenshot alone. |

## Interaction evidence

- Continuous reader wheel input moved the dominant page and page field while only the bounded
  visible/overscan window mounted PDF pages; direct page jumps targeted persistent slots.
- At 720×520 the document width matched the viewport with no page-level horizontal overflow. The
  PDF and section rail changed scroll positions independently.
- Five configured variant rows measured 32px high, including their count inputs; the chip presets
  remained a single scroll line.
- The target selector supports click plus roving keyboard focus with Arrow/Home/End behavior.
- The Total plays scenario started at 0/5, counted Clean + Sloppy + Again to 3/5 at unchanged BPM,
  Undo returned it to 2/5, then more mixed verdicts reached 5/5 and the bounded six-second close
  completed. Source tests separately pin that this outcome is target completion—not mastery—in
  Score history, Ledger/History, day aggregates, Universe and completion effects.
- Normal reader pages do not mount blank Pencil canvases; a Pencil overlay mounts only while
  drawing or when that page already has saved strokes.

## Automated and data gates

- Frontend: **2,678 passed / 1 skipped / 0 failed** (212 files passed / 1 skipped).
- Native: **1,109 passed / 19 ignored / 0 failed**.
- TypeScript, production build, format and strict Clippy: **PASS**.
- Disposable schema-19→20 rehearsal: 242 blocks/contracts, 2,184 reps, 47 sessions and 8,283
  events preserved; integrity OK; zero foreign-key violations.
- Five narrated corpora remain zero-false-mutation gates.

## Package/install evidence

- [x] Version agreement, app build/signature, one-copy audit and all eight macOS release gates.
- [x] Installed version/build 8.2.0, bundle `com.christian.codakiller`, strict signature PASS,
      CDHash `4f4a8e3947efc00e4845ee085564f2724ff378a6`.
- [x] DMG 10,903,545 bytes; SHA-256
      `1139ad6ed3452b2c004db3f4e8c22849eacb27e72fcbb0ddc93638d6720998eb`.
- [x] Pre-install DB backup 23,146,496 bytes / SHA-256
      `e2ba204263a9413b073ea5cab3b8fc2192ea7dcb42fda90012a0c0d08b660d0e`; outgoing v8.1 rollback
      10,041,913 bytes / SHA-256
      `2960fd90cda9e24583a4661d7ad2672041e896f533d2b979c0cf3897291c751b`.
- [x] Fresh installed launch and exact live schema-20 graph audit: counts preserved, integrity
      OK/FK0, zero open sessions/active contracts.
- [ ] Installed-native 720×520 Score/composer interaction pass.
- [x] Pushed lightweight tag `v8.2.0` at
      `5de8bf9e1e9bced09c3d5091acd4b42241edae28`; private `origin/main` pushed through the tagged
      release-doc commit. Later docs-only commits may advance `main` without changing the tag or
      runtime source `afe65f3…`.

## Current packaged acceptance checklist

Run this against `/Applications/CodaKiller.app`, not the old build-bundle path in the historical
P0–P2 record. Record exact misses and screenshots; do not turn an unchecked item into a claim.

1. Resize to 720×520. If macOS asks for Desktop-folder access because the selected external score
   lives there, Christian deliberately grants access or chooses a permitted score location.
2. In Score, wheel across several real pages; confirm the document remains continuous, the page
   field follows the dominant page, direct page entry lands exactly, and 2-page view remains a
   usable continuous overview.
3. Scroll Tricky Sections independently, expand a low section and confirm its composer reveals
   inside the rail without moving the PDF. Check compact Score tools, one-line dock and several
   32px variant rows at the same 720×520 floor.
4. Start a **Total plays · 5** set and mix Clean, Sloppy and Again. Confirm tempo does not move,
   Undo removes one, the live HUD says **Play target complete** at 5/5, and History/Universe do not
   treat it as mastery.
5. Start voice in the packaged app. Over the Steinway, exercise the live-set two-word verdicts,
   counted add/undo and metronome commands; the pass bar is intended commands once each and zero
   ambient/piano mutations.
6. With Review enabled, record one real take, listen before judging, and verify native STT yields
   and reacquires the microphone. Check useful playback, Keep persistence and temporary-take
   cleanup at session end.

Provider mapping remains a separate explicit-authorization gate: do not send an edition to a cloud
provider merely to complete this checklist.

## Next steps

Add packaged-native Score evidence only after the Desktop-folder permission is deliberately
handled by Christian. Then continue microphone/Steinway, explicitly authorized mapping and
sustained-motivation acceptance. Do not upgrade these browser frames into
microphone, provider-mapping or at-piano evidence they cannot supply.
