# Build22 — finite daily passage practice

Date: 2026-11-15. Native 2.0.0/build22/schema5 development candidate. Not installed on a physical device.

Christian's spoken feedback and handwritten notes drive this change. The problem, behavior and acceptance contract are in [daily-practice-design.md](daily-practice-design.md).

## Behavior

Today presents one round of up to five distinct passages. Hard-won target work returns for a delayed recall, failed checks remain actionable until a set finishes, and completed slow work counts without granting mastery. Finished work consumes a daily slot instead of refilling the list indefinitely. Clean checks below target hold the interval step. Recorded ungraded work prevents a later same-day attempt from being called cold. Recovery restarts the shortest configured confidence interval, preserving custom ladder values. Readiness evidence must follow the latest failed/below-target report or effective Sloppy rep and cannot come from the future.

Rows identify the piece, passage, confirmed measure/page and music preview. The full passage library is grouped by piece. Secondary navigation, optional time planning and extra Counter tools are collapsed. Piece targets are shared, new unchosen practice starts around 75%, and an explicit target action makes a deliberate target check possible. The metronome has numbered Beats, Flash, Bounce and Off, with a Reduce Motion fallback.

## Verification boundaries

- Core, native runtime and UI results are recorded below after their final runs. All UI fixtures use the disposable DEBUG store; normal libraries remain blank on first installation.
- Independent source review and actual native phone interaction found and corrected Total plays tempo validity, unresolved check carryover, post-warmup cold grading, Later navigation, repeated per-row history projection, target override wording and first-presentation planner state.
- Simulator screenshots and interactions do not establish physical sound quality, flash/audio synchronization at the piano, haptics, camera/Pencil behavior, real-account convergence or Christian's subjective practice verdict.
- No schema/backend migration, deletion, personal-data write, signing/account change or installed Mac operation. Phone last verified Build21; personal iPad last recorded Build20; friend Build12; Mac11.1.0/schema21.

## Verified results — candidate accepted for source handoff

- Full final Core: 580 cases, one optional private-library timing skip, zero failures (`/tmp/praelude-tempo-core-all-final.log`).
- Full final app-hosted native runtime: 380 cases, one optional live-account skip, zero failures in 18.411 seconds (`/tmp/praelude-build22-ipad3.log`, result bundle `ipad3.xcresult`). This includes the midnight, old-default and attempted-set/history preservation regressions.
- Deterministic service checks: 2,349 assertions pass.
- iPad3: all three selected UI cases pass together (target/75%/visual/Score continuity; full-width largest-text planner; failed-check/saved-date/rename-cancel). iPad2 separately passes the complete finite daily-work flow, compact navigation, target visual control, detailed meter/count-in/background continuation and maximum-tempo accessibility.
- Phone3 separately passes finite daily order/clear/Tomorrow, compact grouped navigation, and target/visual continuity. Phone2 passes actual same-card Score/Counter/Clean/Undo/ungraded-history preservation, landscape grading and reversible review deferral. Phone4 passes saved-date/rename-cancel and maximum-tempo accessibility. Phone5 also passes the final full-width long-title accessibility planner; its meter test reached the final rep-preservation check, where a Score-only exact label needed to accept the equivalent Counter label. Phone6 finally passes the detailed meter/count-in/background-continuation case after querying the shared progress identifier rather than a Score-only label. These are scoped UI runs, not a claim that the entire historical UI suite passed together.
- Independent review: adversarial source review plus actual native phone interaction and phone/iPad screenshots. Every reported issue is repaired. Final phone5 and iPad3 accessibility planner images and the corrected Score HUD target have independent visual approval. No remaining review blocker within this simulator-tested scope.
- Unsigned simulator build is 2.0.0/build22; project generation and diff whitespace checks pass. No physical installation or Release signing/package claim.

## Native previews

All images use synthetic DEBUG library content.

[Phone daily order](screenshots/phone-today.png) · [Collapsed iPad sidebar](screenshots/ipad-sidebar.png) · [Grouped passages](screenshots/ipad-passages.png) · [Counter and visual click](screenshots/ipad-counter.png) · [Score target](screenshots/ipad-score-target.png) · [Largest-text iPad planner](screenshots/ipad-planner-accessibility.png) · [Largest-text phone planner](screenshots/phone-planner-accessibility.png).

## Retained intermediate failures

1. Initial generic simulator compilation found two new `AnyLayout` ternaries with unmatched concrete layout types. Both branches are now erased individually to `AnyLayout`.
2. Initial core runs retained obsolete overdue-copy/order assertions, an unsafe old test index after the finite limit and random UUID fixture ordering. Expectations/fixtures were made explicit; no failed run is counted as a pass.
3. Phone1: 3 of 4 UI cases passed. The finite-round test asserted a virtualized Later row before scrolling. Hosted 31 of 32 passed; its tempo failure used a SessionRules object compiled seven seconds before the final source fix. Current-source regression and recompilation resolve that discrepancy.
4. Phone2: 6 of 7 UI cases passed. The finite-round test scrolled in the wrong direction while searching for a virtualized Start button after inspecting Later; the harness now specifies return-to-top. Full native runtime: 378 cases, one optional skip and one failure in a pre-existing sync fixture whose two reps shared the same timestamp, making expected order depend on random UUIDs. The fixture now uses distinct rep timestamps; production sync ordering is unchanged.
5. Independent screenshot inspection found that the optional planner first opened empty. The first on-appearance fix alone was insufficient in iPad1: the sheet still captured an unobserved empty array. The sheet now explicitly captures its item state at construction, refreshes on appearance, and the strengthened native test requires actual planned work. The pre-fix screenshots remain in the local phone1/phone2 result bundles.
6. An added new-passage-limit test initially expected five while deliberately setting the existing maximum to one. Its assertion now checks the configured limit in both Today and the time planner.

Raw logs/result bundles stay outside Git under `/tmp/praelude-build22-*`; DerivedData is local-only. Selected nonpersonal native screenshots are retained beside this report after final visual review.

7. iPad1: the two Counter cases and compact navigation passed, as did all 378 hosted cases (one optional skip). The finite-queue harness incorrectly queried the idle tempo as Button instead of its native Other type. The strengthened planner exposed the remaining first-presentation issue; metronome tests still selected a new Today passage instead of the intended whole-piece row. Harness navigation/type queries were corrected and the planner state dependency was fixed.

8. Phone3 passes all three daily-flow cases and target/metronome-style Counter interaction; all378 hosted cases pass with one optional skip. Extra legacy checks expose stale accessibility assumptions: the metronome harness force-unwraps a StaticText that is natively Other, and the saved-date row combines its label/value. Queries are now scoped by stable IDs without forced unwraps. Independent inspection of the populated largest-text planner catches narrow text columns despite reachability passing; planner rows now stack vertically with uncapped titles at accessibility sizes. The updated test checks full-row title width and captures both first item and session start.

9. iPad2 passes the central daily flows, target/visual Counter case and both detailed metronome cases; the date-reader harness overscrolls a read-only row. Its bounded directional viewport scroll fix passes on phone4. Phone4's full native runtime passes379 cases/one optional skip/zero failures. Its largest-planner width check initially picked a short warmup title; the regression now targets the known long passage title. The phone metronome harness's center-anchor scroll oscillates past a visible meter menu; smaller bounded gestures correct the harness.
10. Independent iPad screenshots reveal a new Score HUD target label compressed into vertical letters. The target now retains a single-line intrinsic width, occupies its own identity line in the collapsed HUD, and the adaptive dock allocates a larger minimum status width. Current source also removes the stale saved-at-target default exception and expires unstarted draft choices across local midnight; active/history bytes remain protected by native regressions.

11. Phone5's populated, readable long-title planner passes and receives independent visual approval. Its final metronome assertion expected the Score label “1 of5 clean” while Counter correctly exposes “1 of5 clean in a row.” The harness now checks the saved count through `repProgress`; phone6 passes the entire case including actual background continuation. No production change was needed for that last assertion.

## Next steps

The source candidate, scoped native checks and independent visual review are complete. Core580 and native380 each have one optional skip and zero failures; phone6 passes its final single metronome case in76.129seconds. Source checkpoint: `ios-v2.0.0-build22-candidate`, branch `codex/ios-daily-practice`. Keep this candidate and its mirrored manual together. Physical delivery remains a separate guarded same-bundle update to an authorized idle device with complete backup, exact preservation, package verification and launch/readback; then judge real piano use and two-device continuity separately.
