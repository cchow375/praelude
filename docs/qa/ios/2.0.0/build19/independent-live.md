# Build19 independent native interaction review

Date: 2026-10-16. Scope: current Build19 Debug iPad simulator, disposable `--uitesting` library only. The verifier independently designed the integrated scenario; the parent ran it serially after other simulator work. No physical device, personal library, account, credentials or installed Mac was accessed or changed.

## Result

**PASS for the scoped simulator workflow.** `CounterPracticeUITests/testIndependentCardScoreCounterCleanUndoPreservesUngradedReview` passed in **67.855 seconds**. It entered Passages through the actual sidebar, opened a card, checked that its review date and first-attempt history were empty, opened the real Score display, returned to that same card UUID, selected Counter, chose Start without grading, saved Clean, verified `1 of 5`, used Undo, verified `0 of 5`, paused, and reopened the same card to confirm the review date and first-attempt history remained empty.

The companion `PassageCardsUITests/testImageReviewDetailsAndReversibleDeferralDoNotGradePassage` passed in **50.771 seconds**. Its pixel check samples exposed artwork below the review navigation bar, so header/button text cannot substitute for score pixels. Combined final4 result: **2 tests, 0 failures, 118.626 seconds; TEST SUCCEEDED**.

Evidence: `/tmp/praelude-build19-ipad-final4.log` and `/tmp/praelude-build19-ipad-final4.xcresult`. The independent verifier read the sealed log and visually inspected these exported native screenshots under `/tmp/praelude-build19-ipad4-screens/`:

| Screenshot | Observation |
| --- | --- |
| `913D9919-72C1-49BC-9F1A-E895B21698C3.png` | Actual Score is selected; synthetic notation renders clearly with practice controls retained. |
| `2D819FE5-C22B-4621-9F2C-CCF5B1891DAA.png` | Same passage thumbnail, Clean confirmation, `1 / 5`, enabled Undo and readable Counter controls. |
| `3403D3E0-8296-42C4-B283-D89D84DC1673.png` | `0 / 5`, zero effective plays, Practice paused, click off and disabled verdicts after Undo/Pause. |
| `1C127B50-A223-48AD-B500-8788AE04BB86.png` | Same passage; no review date and no first-attempt grades after the ungraded repetition/Undo workflow. |

No blank Score, blocking modal error or lost passage context was observed in this workflow. These are simulator observations, not a measured latency or physical playing-distance verdict.

## CUA limitation and fallback

Before the XCTest fallback, native CUA successfully selected the correct Simulator window, inspected the launched Debug Today screen and used an accessible content action to open the empty review queue. CUA omitted the app navigation-toolbar controls from its accessibility tree. Two coordinate attempts at the visible sidebar button failed before input with `windowNotFoundAtPosition((493.0, 175.5))`, including after rebinding Simulator. Raising the native window did not add the missing controls. The requested CUA card-to-practice path was therefore **not completed**; no practice record was created through CUA.

The established XCTest driver was then explicitly authorized as the fallback. Only the new integrated test method was added; existing test helpers and product source were unchanged by this verification follow-up. Swift frontend parsing and whitespace checks passed before the parent executed it.

## Remaining boundary and next steps

This pass does not prove physical camera/Photos capture, sound or haptics, Pencil behavior, sustained frame pacing, B170/B171, or same-account/offline two-device convergence. Keep those gates open and use the guarded same-bundle workflow only for an authorized idle installation target. The candidate remains uninstalled by this review.
