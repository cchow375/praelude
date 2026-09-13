# CodaKiller v8.2.0 — Version Record

**Status:** SHIPPED + INSTALLED 2026-08-27  
**Release boundary:** Score/practice visual cleanse + honest Total plays contract  
**Version / schema:** v8.2.0 / schema 20  
**Installed app:** `/Applications/CodaKiller.app`  
**Final source commit:** `afe65f3b176a1c5da81eca6d2f65bd721726ee40`  
**Release tag / repository push:** pushed lightweight tag `v8.2.0` →
`5de8bf9e1e9bced09c3d5091acd4b42241edae28`; private `origin/main` contains later documentation-only
corrections, and its exact current tip must be read from Git  
**Installed identity / signing / CDHash:** bundle `com.christian.codakiller`; plist short/build
8.2.0 / 8.2.0; strict ad-hoc signature PASS; `4f4a8e3947efc00e4845ee085564f2724ff378a6`  
**DMG path / bytes / SHA-256:** `releases/v8.2.0/CodaKiller-8.2.0.dmg` · 10,903,545 bytes ·
`1139ad6ed3452b2c004db3f4e8c22849eacb27e72fcbb0ddc93638d6720998eb`  
**Pre-install DB backup:** `(C) pre-v8.2.0-install-2026-08-27-230720.db` in the vault ·
23,146,496 bytes · SHA-256
`e2ba204263a9413b073ea5cab3b8fc2192ea7dcb42fda90012a0c0d08b660d0e`  
**v8.1 rollback archive:** `~/Library/CodaKiller-rollbacks/CodaKiller-v8.1.0-rollback.app.tar.gz` ·
10,041,913 bytes · SHA-256
`2960fd90cda9e24583a4661d7ad2672041e896f533d2b979c0cf3897291c751b`  
**Fresh installed launch / live schema-20 audit:** PASS · integrity OK · FK0 · exact graph preserved

> Package/install, runtime-source and release-tag facts are frozen. Later `main` movement may be
> recorded only as a factual docs-only pointer correction; it does not change the immutable tag or
> runtime payload.

## What this release is

Christian's screenshots and real interaction verdict showed that the app's backend progress had
outpaced basic frontend usability. The score still felt pinned to one page with a giant empty
surface below it; the right-hand practice list was not a normal independent scroll; the variant
editor made compact data look like a stack of giant cards; and too many controls competed with the
music. He also wanted a low-friction volume goal—play something N times—without forcing every drill
into a clean-streak mastery contract.

v8.2 is a corrective release built around one principle: **friction is also time**. It changes no
product boundary about audio: Christian still judges every attempt; the app counts the verdicts.

## What is source complete

### Continuous virtualized Score

- The PDF is one continuous scroll. Every page in the selected whole-score/movement scope owns a
  stable size-correct slot, eliminating the single-page/blank-canvas posture.
- Only intersecting pages plus bounded overscan mount `PdfPage`, capped at five. Other slots retain
  cheap paper-sized placeholders, so document geometry and direct navigation stay stable. At the
  native fast path's 8-MP RGBA page cap, five × 32,000,000-byte resident canvases mean a
  160,000,000-byte (152.6 MiB) steady-state ceiling, excluding transient decode/blit scratch and
  the deep-zoom PDF.js fallback;
  five is deliberate to avoid blank/churn in tall two-column view.
- The page with the largest visible share becomes current; page field, score overlays and Pencil
  follow it. Previous/next, page entry and keyboard navigation scroll directly to a page slot.
- **2-page view** remains a continuous two-column overview.
- A Pencil canvas mounts only while Pencil is active or that page already holds strokes.

### Independent, revealed practice rail

- The PDF and Tricky Sections panel are two independently scrolling panes inside a bounded Score
  workspace. Neither scrolls or pins the other; the whole app window does not become the document.
- Expanding/selecting a section opens its Practice tab and scrolls the embedded composer into view
  within the rail. The rail remains collapsible at narrow sizes.

### UI cleanse

- The redundant large Score heading is visually removed and the workspace header is compact.
- Edition/movement, page navigation and zoom stay one-tap. Fit width, Fit page, 2-page view, Draw
  target, Pencil, Map score and Map measures live under **Score tools**, with active-mode summary.
- The bottom band is one line at 720×520: **Paused Sets** and **Rep Counter** direct, with Clock,
  Dynamics and Rotation under a keyboard-accessible **Tools** menu.
- Variant presets occupy one horizontal scrolling chip row. Configured variants are fixed 32px
  inline rows with order/name/consecutive-cleans/reorder/delete visible together.

### Total plays, without false mastery

- **Set target** is an accessible two-choice control: **Clean streak** or **Total plays**, with
  roving Tab focus and Arrow/Home/End behavior.
- Clean streak keeps the existing 3/5/7/10/Custom presets, target tempo/ladder, Sloppy demotion,
  variant chains and verified-mastery semantics.
- Total plays offers **5 / 10 / 15 / 25 / Custom**. It holds the entered start tempo, has no target
  BPM or ladder/demotion/variant/review-boundary behavior, and keeps its composer visually spare.
- Every effective non-void **Clean, Sloppy and Again** adds one play. Undo reverses one. At N/N the
  existing six-second Set complete countdown may close the set.
- This boundary is deliberately **completion, not mastery**. History/Block rows and Score say
  total-play target complete/in progress; day mastered-set totals and Universe mastery evidence
  exclude these contracts; completion effects use a neutral set-complete event, not
  `mastery_landing`.
- Switching to Total plays does not destroy the current composer session's variant draft; switching
  back restores it. Persisted Total plays itself carries no variants.

## Schema 20 and live-data rehearsal

Schema 20 crash-atomically rebuilds `set_contract` to widen its `mastery_basis` CHECK with
`total_attempts`. Existing clean-streak contracts and history remain byte-for-semantic-byte the
same. Restore, pause, recovery and projection guards keep Total plays at fixed tempo and prevent
ladder state from reappearing.

An exact disposable copy of the pre-install live schema-19 database migrated successfully:

| Data | Before | After |
| --- | ---: | ---: |
| Pieces | 11 (10 repertoire + hidden Warm-ups) | 11 |
| Rep blocks | 242 | 242 |
| Set contracts | 242 | 242 |
| Reps | 2,184 | 2,184 |
| Sessions | 47 | 47 |
| Session events | 8,283 | 8,283 |
| Open sessions / blocks | 0 / 0 | 0 / 0 |

Integrity was OK and foreign-key violations were zero after rehearsal. The pre-install live
schema-19 graph also had zero measure maps, movements, warmup routines and replays. This rehearsal did not touch
the live DB and does not replace the release backup/installed before-after audit.

## Verification before packaging

- Frontend: **2,678 passed / 1 skipped / 0 failed** (212 files passed / 1 skipped).
- Native: **1,109 passed / 19 ignored / 0 failed**.
- TypeScript, production build, format and strict Clippy: **PASS**.
- Five narrated corpora: zero false mutations.
- Fresh-context verification found the initial downstream mastery leak and required the complete
  non-mastery projection described above; it also found the target choice needed actual radio
  keyboard behavior. Both were fixed and regression-tested before ship.
- Browser/devMock at **720×520 and 1462×919** accepted continuous Score, independent rail,
  composer auto-reveal, compact variants and Total plays. A mixed 5-play run exercised Clean,
  Sloppy, Again, Undo and bounded auto-close. Exact frames are in
  `~/codakiller/docs/qa/v8.2.0/README.md`.

## Release verification

- All eight macOS release-script gates: **PASS**.
- TypeScript and production build (282 modules): **PASS**, with the existing >500k chunk warning.
- Cargo fmt and strict Clippy: **PASS**. Five narrated corpora: zero false mutations.
- Installed identity/signature, one-copy audit, DMG checksum, pre-install backup and rollback:
  **PASS** with the exact header facts.
- Fresh launch migrated live 19→20 with all table counts above preserved, integrity OK/FK0, zero
  open sessions/active contracts and zero measure-map/movement/routine/replay rows.
- Packaged launch was visually seen, but macOS presented a Desktop-folder access prompt. The
  sensitive permission was not granted, so packaged-native Score visual/interaction acceptance is
  not claimed. Browser acceptance remains the exact UI evidence.
- Pushed lightweight tag `v8.2.0` at
  `5de8bf9e1e9bced09c3d5091acd4b42241edae28`; private `origin/main` contains later
  documentation-only corrections, and its exact current tip must be read from Git.

## Honest gaps at this release boundary

- Browser UI evidence does not prove packaged WKWebView scroll feel or native PDF performance; the
  native Score was gated by the ungranted Desktop-folder prompt.
- Real WKWebView microphone/Listen Back and voice-over-Steinway acceptance remain open from v8.1.
- Provider-backed measure mapping is still unproven: no Anthropic key and zero live map rows.
- Sustained use must still judge whether XP/levels/badges/cadence motivate.
- B78/B84 and recorded smaller residuals remain; no target-selector residual remains—the radio
  keyboard contract was fixed before ship.

## Next steps

1. Deliberately handle the Desktop-folder access choice, then run installed-native 720×520
   Score/composer/Total-plays acceptance.
2. Run real WKWebView microphone/Listen Back and voice-over-Steinway acceptance.
3. With explicit whole-edition egress authorization, review and Apply one real provider map.
4. Judge XP/levels/badges/cadence across sustained practice use.
