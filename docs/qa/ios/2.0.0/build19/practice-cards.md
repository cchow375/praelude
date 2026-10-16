# Build19 verification ledger

Date: 2026-10-16. Native 2.0.0/build19/schema5 candidate; installation unchanged. User request: a phone-first rep counter and metronome, image-based PDF/photo passage cards, understandable review scheduling, complete native sync, clean adaptive controls and ten additional pianist tools.

## Implementation boundary

- Counter on iPhone, Score on iPad by default; both can switch. PDF rendering is released while Counter is visible. Existing score/Pencil/first-attempt/history contracts remain.
- Photo input via camera/Photos, bounded background orientation/crop/PDF processing, retake, rotation, contrast and accessible crop sliders. Atomic piece+passage publication; failed precommit saves remove the unique staged file.
- First stored selection region renders directly at bounded high resolution. Cards, Today and review queue share artwork. Search/filter/shuffle/recall and image enlargement; explicit review details/history and reversible one-day hiding.
- One calendar for Progress and Calendar; recorded-day streak derives from synced work, with DST-aware arithmetic, effective reps, practice dots, month totals and session drill-down.
- Sync account refresh/queue corruption/download integrity hardening plus additive planning/photo-origin fields. See sync-verification.json and sync-contract.md for the deployed schema, field matrix and account boundary.

## Findings repaired before acceptance

Independent review found a fixed folder UUID that would collide across users under global server primary keys. It was replaced by random library folder IDs and explicit Codable/synced photo-origin metadata. Review also found missing iPad card navigation, shadowed root navigation state, stale card editor snapshots, disabled-rule explanation mismatch, deleted pieces in the performance picker, fractional-tempo rounding, and low-resolution small crops. Their repairs are source changes, with checks recorded below. Later review repaired blank List artwork after deferral, delayed-file previews, phone Open score routing, a manual metronome-Off override that tempo changes could restart, and inherited accessibility identifiers that obscured Counter controls. Each finding was retained rather than counted as an initial pass.

Retained intermediate failures:

- Native1 compiled against concurrently evolving storage-test signatures; native2 found ambiguous test CGFloat.nan; native3 found a non-Sendable XCTest self capture. The test fixtures were corrected and serial runs resumed.
- The first core run had two old assertions declaring the tempo goal local-only. They were updated to the new synced contract while retaining legacy missing-key preservation tests.
- Phone-final1 exposed an actual ancestor accessibility identifier overriding leaf controls; the source was repaired and that run stopped. Phone-final2 retained three UI failures caused by launch-argument mode locking and gestures targeting the wrong scroll view/covered navigation area. Scoped selectors and actual UI mode selection replaced those helpers; final3 passed all five then-current cases.
- A final3 review screenshot still showed blank artwork despite loaded metadata. The repair gives images an explicit layout and tests actual music pixels before and after deferral. The first landscape screenshot also has a black compositor region; it is not accepted as visual evidence merely because interactions passed.
- Phone-final4 stopped at compile time because the enlarged ScoreWorkspace modifier expression exceeded Swift's type-check budget. Splitting the unchanged lifecycle modifier chain into three computed view stages preserved order and identity; independent review confirmed the split.
- Phone-final5 passed both new UI flows, including actual review-image pixels and calendar/session navigation, but its native suite reported 7 assertion failures within one new storage test. A Foundation-only reproduction confirmed its URL-parent equality guard rejected a trailing-slash variant of the same fixture directory. Normalized path comparison repaired the observer fixture; the complete-byte/before-receipt/failure assertions remain.
- iPad-final1 passed all four Counter/default/calendar flows. Both card cases failed before entering Passages because their helper did not open the collapsed sidebar; the captured Today hierarchy exposes showAppSidebar. The helper now uses that visible control before selecting Passages; Final2 entered Passages, cropped/saved a visible card, and passed review pixels before deferral. It then found two further tablet helper assumptions: native search was a toolbar Search button, and a virtualized offscreen image had no AX frame from which to infer scroll direction. The helper now taps Search and explicitly scrolls upward for the image recheck; final3 reruns only the two card cases. No product source was changed for these tablet helper repairs.
- Hosted SQL07 initially omitted a mandatory synthetic title on an upsert fixture and failed with 23502. The fixture was corrected without weakening validation; its rollback run passed.

Local raw logs/xcresults retain the complete failed runs; no intermediate failure is presented as physical acceptance.

## Validation

| Gate | Result | Evidence / scope |
| --- | --- | --- |
| Foundation core | PASS: 537 cases, 1 opt-in live-account skip, 0 failures, 8.079s | /tmp/praelude-build19-deterministic-final.log; store/sync/review/calendar tests |
| Deterministic service harness | PASS: 2,340 assertions | Same log; click/tap tempo/voice/reward/PCM |
| Python helpers | PASS: 57 cases, 0.230s | /tmp/praelude-build19-tools.log |
| Final hosted native | PASS: 360 cases, 1 live-account skip, 0 failures, 16.159s | phone-final6.log/.xcresult; includes capture/first-region pixels, camera reservation, click-Off preservation, corrupted queue, validated publication, arrival pixels and 11 storage cases |
| iPhone affected UI | PASS: all 6 distinct flows across final3/final5/final6 | Final3: Counter save/Undo/rest/switch 50.145s, device default 16.901s, photo crop/save/practice/relaunch 45.265s. Final5: calendar/session 45.083s and review pixels/defer/Open score 36.059s. Final6: landscape 32.953s. Earlier versions of repeated cases are not double-counted. |
| iPad affected UI | PASS: all 6 corresponding flows plus an independent integration case | Final1: landscape 34.892s, Counter save/Undo/rest/switch 43.160s, calendar/session 45.180s, Score default 23.776s. Final3: photo workflow 47.306s, review 48.027s. Final4: independent same-card Score/Counter/Clean/Undo/ungraded-schedule check 67.855s; strengthened exposed-music pixel test 50.771s. No repeated case is double-counted. |
| Hosted schema / SQL | PASS | Migrations28/29 deployed; SQL07 rollback and catalog/RLS/private-bucket/zero-fixture-owner checks; sync-verification.json |
| Independent review | PASS within source/synthetic visual scope | Phone, card and sync executors plus fresh final reviewer. Repairs re-reviewed; independent integrated native UI check passes (independent-live.md); no remaining actionable source finding. |
| Generic arm64 Release | PASS: unsigned build19 arm64; 8 scoped package checks | release-package.json records identifier/version/device families/privacy text, no test plugins and no debug fixture markers. Binary SHA-256 ba08abdf60f1532299835ba619734eb00c49c7dcae5f71ad76499d5e4e3b53a2. Signing and physical delivery remain separate. |
| Docs mirror | PASS | Vault-first updates; docs:sync/docs:check confirms current mirror, 32 version records and 18 lineage documents. |

Reviewed synthetic screenshots are in screenshots/. Phone6 landscape uses XCUIScreen whole-screen capture and displays the full canvas correctly; the earlier app.screenshot rotation/crop image remains a rejected capture, not a claimed product defect. In landscape, upper counter content can be above the current scroll position; this is a reachability/visual pass, not a claim that all controls and count fit simultaneously. Phone5 calendar screenshot precedes a final singular/plural copy fix (1 day/1 rep), which is included in final source. No personal score/photo is in these artifacts. Final4 further excludes the modal navigation-glass area from the sampled artwork, so header text cannot pass for music. The independent live-review method and CUA tooling limitation are recorded in independent-live.md; it is simulator/XCTest evidence, not a manual physical-device verdict.

## Physical and account gates

Not installed in this change. No personal library/credentials/active practice or installed Mac is modified. Actual camera permission/capture quality, Photos/iCloud transfer, haptics/sounds/audible click, sustained frame pacing, real-world head gesture reliability (B170), score page/rep pauses (B171), and two physical devices converging through the same account remain distinct acceptance gates. Legacy active-set handoff and continuous Mac/native sync are unsupported. No claim of flawless or zero-lag operation.

## Next steps

Prepare signed target-specific packaging and guarded same-bundle delivery only for an authorized idle physical target. Then verify camera/Photos/audio/haptics/latency and same-account two-device/offline convergence. Keep the friend's iPad held.
