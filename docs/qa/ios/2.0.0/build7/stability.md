# iOS build7 stability and responsiveness repair

## October7 — build7 installed on the personal iPad

Guarded same-bundle refresh installs2.0.0/build7/schema5 from source `3e03330`. Independent full pre/post inventory review proves all11 owned files/7,981,365bytes identical by filename,size andSHA256, including scores, annotations, history, account ownership/privacy/preferences. Pre-launch schema5/revision1647 has5pieces/44passages/43historical sets/30sessions/255unique attempts; retained active set is completed, with no running set. No schema migration, import, restore, uninstall or Mac change occurred.

Actual signed device Release passes strict signature, app/profile/team agreement, signer-certificate membership/trust and helper device inclusion; fixture arguments/debug diagnostics/test plug-ins are absent. Profile expiresOctober10 at17:55:53UTC (1:55PM EDT). Automatic launch failed; subsequent read-only device inspection confirms Praelude running and schema5/revision1660. Independent post-launch review retains all255 attempts,44set IDs,30sessions and every original45ink record, plus exact profile/privacy/preferences. A completed set is archived and newer ink/reward/page activity is observed; no author or automatic-startup attribution is inferred. User screen-quality confirmation remains separate. Source/native simulator verification remains distinct from physical Pencil/audio/freeze/long-session/real-account two-device acceptance. Exact sanitized evidence: `docs/qa/ios/2.0.0/build7/personal-ipad-install.json`; private complete backups stay outside Git.

**Next steps:** use the installed build7 for real practice to verify sustained Pencil/eraser/Undo/layer/page transitions and responsiveness. Renew with the same app/team before the actual profile expiry.


Source: 2.0.0/build7/schema5, October6,2026; Git tag `ios-v2.0.0-build7-candidate`. Historical October6 pre-install candidate boundary: iPad then ran build6. Source format and source-page geometry are unchanged. Personal library and installed Mac app are untouched.

## Why this round

Christian reports freezes requiring force quit, persistent lag, disappearing/poor ink and crowded UI. Source audit found concrete failure mechanisms rather than assuming the earlier simulator passes established hardware quality. Three implementer lanes and a separate fresh-context verifier reviewed correctness, lifecycle, account isolation and resource bounds.

## Changes and feature coverage

| Feature family | Source repair or review | Evidence boundary |
|---|---|---|
| Drawing/eraser/lasso/layers/Undo | Deferred sample work, lifecycle flush, newest dirty conflict choice, bounded mask-aware identity, invalid-ink readonly recovery | Hosted regression plus synthetic finger UI; physical Pencil remains open |
| Passage selection/navigation/sections/measures/page tools/bookmarks/links | Save old geometry/layer before transitions; background bounded previews; pure link fit geometry | Core/native source-page/crop/rotation tests and UI regressions |
| Score reading/focus/performance/two pages | Removed unsafe speculative neighbor rendering; bounded overlay/glyph cache; compact scrolling annotation tools; short landscape stave-width annotation with portrait zoom restoration | Native hit routing and scoped portrait/landscape/large-text UI |
| Practice contracts/cold grading/techniques/tempo/Undo | Indexed persistence projections and ink diff; rules unchanged | Full Core, hosted arm/runtime and UI tests |
| Metronome/drone/tuner/recording/voice | Stable beat-row snapshots prevent live-meter Array traps; same-set background click retention, isolated animated beat displays, tuner in-flight admission and hostile-number guards; no automatic musical grading | Core/service/native tests; actual sound/routes/speech/interruptions open |
| Library/folders/setlists/import/scans/covers | Bounded background cover/page decoding, session index, photo PDF worker | Native file and UI tests; giant imports/selections remain limited |
| Today/warmups/routines/goals/calendar/history/progress/notebook/rewards | Resume strip above compact tabs, anchored short-window warmup controls, reorder menu, indexed sorting, captured notebook deletion IDs, reward catch-up batch with individual entries/rollback | Core/native suites and UI smoke; every UI flow is not exhaustively accepted |
| Auth/profile/privacy/sync/files/friends/studios | Canceled/old-account pull guards, yielding pulls, off-main SHA, debounced/stale-safe social/profile results and measure scan request tokens | Fake transport/hosted tests; actual hosted two-device/social acceptance open |
| Backup/restore/Mac transfer | Preserve schema5/backup4 and original archives; regression coverage unchanged | Core/Python/native fake-file tests; personal import not run |
| Share/print/export | Stable snapshot, per-page yielding, cancellation cleanup and bounded raster annotations | Native vector/crop/rotation/source-byte tests; complex page/final write still synchronous |

## Verification

A native stamp-switching run reproduced a real freeze: a live main-thread sample stayed inside `ScorePageOverlay.refresh → PKCanvasView.setUserInteractionEnabled(false) → resignFirstResponder → UIView/UIResponder._setFirstResponder`. The simulator reached 100% CPU and stopped responding. Source removes the interaction-enabled toggle and routes placement/selection/read-only input in hitTest. Actual hosted PDF hierarchy checks exercise active-responder pen→stamp→text→pen and unchanged ink; native Place→Pen→finger stroke→Done now passes (45.777s), and213 hosted tests finish with1 live-account skip/zero failures. Physical Pencil acceptance remains separate. This diagnoses one mechanism, not every reported hardware freeze. The focused run was interrupted after four completed markup passes; it is not a full-suite pass.

Scoped native/Release gates are complete; failed aggregates below are retained as failures. A completed source/hosted run is not a substitute for native feature interactions.

| Scoped native attempt | Result and consequence |
|---|---|
| Repaired iPad (`/tmp/praelude-build7-ipad-repaired.xcresult`) |219 total:217 pass,1 live-account skip,1 UI fail. Hosted213 execute with zero failures. Ink/Undo/reopen, stamp sizing/Place→Pen→Done, tool rotation, in-set return and passage Done/double-tap pass. Invalid Menu coordinate requires repaired native hit regression. |
| Initial phone (`/tmp/praelude-build7-phone.xcresult`) |12 UI:7 pass/5 fail. Ink reopen, stamp→pen, compact practice/grading/Undo, largest-text practice and normal rotation pass. Real Common meters hit area defect plus outdated primary-navigation helpers require repair. |
| Phone layout (`/tmp/praelude-build7-phone-layout.xcresult`) |Hosted213/1 skip/zero hosted failures; normal intrinsic-height rotation passes. Live meter change crashes with Array bounds in a retained SwiftUI beat row. Largest-text helpers did not reveal the existing scrolling dock. |
| Phone expanded (`/tmp/praelude-build7-phone-final.xcresult`) |222 total:218 pass,1 skip,3 UI fail. Backup export/restore picker roundtrips, page/metronome, practice/Undo/pause/relaunch/completion, blank pieces and largest-text markup pass. Background click stop exposes delayed status observer; stamp query targets wrong accessibility type; Warmup→Close→More exposes resume banner covering the entire tab bar. |
| Phone correction (`/tmp/praelude-build7-phone-corrected.xcresult`) |216 total:213 pass,1 skip,2 UI fail. Hosted214/1 skip/zero failures including background retention. Menu option readiness and stamp picker accessibility type still fail; repaired by centered popup launch and preserving native Button semantics. |

The expanded phone acceptance attempt (`/tmp/praelude-build7-phone-accepted.xcresult`) remains failed:224 total,215 pass,8 UI fail,1 skip. Hosted215/1 skip/zero hosted failures cover actual PDF width-fit/portrait restoration. The UI attempt exposed test targeting defects (outer switch tap beyond nested toggle, scroller query excluding the footer itself, no reveal of Done in the legitimately scrolling large-text tray). A failed rotation left the simulator in landscape, contaminating later unisolated portrait tests. The surviving landscape warmup failure was a real defect: fixed vertical content placed Close partly above the screen. Source now anchors warmup header/dock and scrolls the center; each new native launch resets orientation, intentional landscape tests rotate afterward, and gestures target actual content viewports. Failed results are not counted as acceptance.

Further phone gates (`/tmp/praelude-build7-phone-gates.xcresult`) remain failed:225 total,222 pass,1 skip,2 UI fail. Largest-text pen/stamp, backup, library landscape, pages, practice, warmup portrait and normal rotation pass. A layout shift moved the nested keep-click switch before the test tap; wait for stable native switch bounds. The landscape warmup test exposed a real final List row hidden by a resume inset outside NavigationStack; the inset now belongs to screen content, including compact pushed destinations.

The final phone aggregate (`/tmp/praelude-build7-phone-final-gates.xcresult`) passes:223 total,222 pass,1 live-account skip,zero failures. Hosted215 execute; eight UI cases cover actual metronome live edits/background retention, backup/dialog/dark appearance, pages, practice/Undo/pause/relaunch, warmups/Rewards, landscape library/warmup and annotation rotation.

A stricter rotation rerun (`/tmp/praelude-build7-phone-rotation-strict.xcresult`) fails only the final Done action. True orientation, stable bounds, readable content width, complete Done/tray containment and portrait zoom restoration pass, with independently accepted static captures. It is not an overall pass. Score-mode44pt image labels now include rectangular hit shapes; this failure required the subsequent successful native exit rerun below.

The repaired strict phone rotation (`/tmp/praelude-build7-phone-rotation-hits.xcresult`) passes41.408s. Complete Done containment, readable landscape notation, return-to-portrait zoom and actual Done→practice exit pass. Independent final screenshot/source review accepts the scoped phone layouts, warmup controls and resume-strip/tab geometry. `phone-annotation-landscape-unscrolled.png` deliberately retains the earlier clipped, unscrolled capture; `phone-annotation-landscape.png` shows the reachable complete bottom row after tray scroll. The short tray is intentionally scrollable, not all controls simultaneously visible.

The final iPad aggregate (`/tmp/praelude-build7-ipad-final-gates.xcresult`) has220 total:218 pass,1 skip,1 UI fail. Hosted215 execute with1 live-account skip/zero failures. Largest stamp48.521s, largest-text pen/selection62.758s, landscape warmup→Rewards31.599s and strict annotation rotation/Done26.497s pass. The metronome case fails querying a virtualized offscreen button after settings scroll; its test now explicitly reveals the playback control before asserting state. The aggregate remains a failed run; the corrected scoped retry below supplies the completed metronome gate.

The iPad metronome retry (`/tmp/praelude-build7-ipad-metronome-reveal.xcresult`) passes95.031s with the same production source: actual live settings/meter/count-in changes, enabled background preference, background return with Stop still presented and explicit Stop. No production workaround was added for the offscreen query. Independent final iPad screenshot review accepts ordinary and largest-text annotation controls, Done, bounded glyphs and warmup header/dock. These are scoped native simulator results, not physical Pencil/audio acceptance. Machine-readable sanitized counts are in `native-summary.json`.

Independent review rejected blank footer bands in the earlier iPad captures. Intrinsic sizing removes those bands. Later phone review rejected miniature full-page notation in landscape even though the PDF container was large. The candidate now fits stave width only in short annotation windows, retains source/ink coordinates and deliberate manual zoom, and restores prior portrait zoom after an automatic fit. Strict native content-width/return-portrait checks now pass, and the refreshed captures pass independent review. Earlier rejected images remain before-fix evidence.

- Core:394 tests and service2,211 assertions passed before final native corrections.
- Python deployment/export helper suite:54 passed.
- Earlier native build attempts: catch-variable shadowing and generated-PDFPage actor return rejected by compiler; fixed without actor-safety suppression.
- Earlier hosted run:206 executed,1 live-account test skipped,3 failed assertions. Two expectations assumed old per-sample checkpoint behavior; one expected PDFKit text extraction to preserve underscore placement. Tests now assert deferred-no-write behavior and actual source/export text equivalence. Retain these as failed runs, not passes.

## Final device build

A fresh DerivedData directory builds unsigned generic-iOS Release successfully with two jobs and pinned cached package clones. Product is2.0.0/build7, arm64/iPhoneOS, iPhone+iPad families; schema remains5. Fixture arguments (`--uitesting`, `--seed`, `--reset`), DEBUG page-width diagnostics, test plug-ins and embedded provisioning are absent. Binary30,150,112bytes, SHA256 `c53c90b2e8d6ced8d2acb2c895531d8cd5522245928a39fe7f76d362d7ed12a6`. Sanitized build metadata is in `release-build.json`. Signing, device installation, complete preservation and physical acceptance are separate gates and were not performed.

Final source and screenshot review found no further scoped blocker. Source repairs do not close the physical Pencil/freeze, actual audio or real-account two-device gaps. Core/service/Python counts are not frame-rate benchmarks; duplicate native reruns are recorded by scope, not summed as unique test coverage.

## Remaining limits and next steps

Ordinary ink has a600ms idle autosave window: abrupt force quit before a checkpoint can lose the last unsaved marks. Lifecycle flushes minimize that window but are not a crash journal. Full JSON validation/encode/atomic saves and full import/backup/restore remain synchronous. A single complex export page and final rewrite can exceed frame budget. Cache limits for live/failed baselines are soft when preserving exact conflict tokens. Scan photo selections still hold input images. Higher-refresh opt-in follows [Apple’s ProMotion guidance](https://developer.apple.com/documentation/quartzcore/optimizing-iphone-and-ipad-apps-to-support-promotion-displays). iOS controls actual refresh rate; no fixed120fps or all-device lag-free guarantee is established.

Completed scoped native runs and independent screenshot review support this source candidate. The October7 guarded same-bundle install and complete preservation establish the physical build7 installation boundary; physical feature quality remains separate. Then test sustained Pencil/partial erase/Undo/layer/page transitions while practicing, large actual scores, interruption recovery and a real second account/device. Continue remaining persistence work from measured real-library traces.
