# Functional audit after the user's testing challenge — October 11, 2026

The user asks whether this is bug-free and fully functional before connecting an iPad. **No.** Build success and the signed package do not establish that. Real simulator interaction tests exist, but their scope is narrower than full feature acceptance. Neither iPad has received build13.

## Evidence checked again

| Area | Actual evidence | Limit |
|---|---|---|
| Undo branch | Baseline actual drawing reproduces 1 → Undo 0 → new stroke 2. Repaired actual strokes, pinch, Undo/Redo, save and relaunch pass; independent source bounds confirm the new branch. | Simulator, not physical Pencil or sustained latency. |
| Passage editing | Actual name and decimal 112.5 BPM goal, Save, app relaunch and reopening pass. | Combined double/triple gesture sequence was absent from the original build13 checks. |
| First attempt | Actual preview On/Off state, ungraded attempt, Missed report, future Tough queue and relaunch pass. | Audio engine/controller is tested; audible click quality on the iPad has not been heard. |
| Review priority | Core rules and real Missed → future Tough flow pass. | Original build13 UI did not exercise an overdue or due-today URGENT row. Additional audit below. |
| Camera | Actual Off/minimized/mapping/defaults, action selection, Save, relaunch, reopen and restoration pass. | Detector tests use synthetic measurements. No real face, video capture, landmark alignment, piano posture, low light or false-action reliability acceptance. |
| Voice | Deterministic routing and native owner/recovery/staging/final-dispatch checks pass. | Recognition results and permission/capture paths are injected. Actual repeated Clean over piano, interruptions and physical microphone reliability remain unverified. |

The core451 cases and native304 cases are mostly logic and service checks. They are not hundreds of full practice sessions. The native live-account test is skipped. `practice-reliability.md` retains exact runs, failures and screenshots.

## Additional audit

- Two focused actual-touch tests are added over an explicitly disposable DEBUG library: combined dock/box double-tap name/goals, real selected-box triple-tap and recovery; and overdue/due-today/future review rows. Explicit `--audit-gesture-preservation` / `--audit-review-priority` launch arguments leave the ordinary fixture unchanged. An initial JSON snapshot permits independent protected-ledger comparison.
- Fresh7 fails during compilation before tests: XCTest coordinates do not support the attempted numbered-tap API. This is zero executed tests. The test is corrected to synthesize triple touches through the actual page element, with an audit-only selected box at the visible page center.
- Fresh8 executes one test, failing42.883s before the target flow: the opening helper skips Pieces when the iPad has a sidebar rather than a tab bar and taps a similarly named Today row. The hierarchy stays on Today. No double/triple-tap feature verdict is inferred.
- Fresh9 executes the review case, failing31.601s at the All passage reviews opening postcondition. The single tap at(410,827) lies inside the reported row(20,801,780,52), to the right of the visible label; the app remains on Today. The hierarchy and exported21s frame independently show the correct2 due count, overdue/due-tough URGENT labels and the future Tough passage scheduledOctober13 without URGENT. Root visually verifies all three rows. `screenshots/build13-urgent-today-audit.png` retains that synthetic screen. Correct priority rendering is separate from the failed queue-opening flow; wide accessibility bounds versus a smaller actual hit region is a hypothesis, not an established cause.
- Independent fresh9 before/after JSON comparison retains all passages/schedules and the3 seeded cold grades, with zero sets/sessions/attempt events/annotations. Startup also normalizes reward rank Unranked→Prelude and materializes3 reward rows from the seeded grades (+15XP/+8coins each), revision12→14; `RewardsRuntime.awardOnTimeReviews` establishes that bootstrap path. This is not byte-identical state or an all-record preservation pass; the comparison correctly reports `protectedRecordPreservationPassed: false` because the reward ledger changed. No new practice grade is created by queue viewing. Evidence: `synthetic-priority-preservation.json`.
- Independent source review finds a real stale-intent defect: region triple tap sets `dictatePassageName = true`; Cancel/Save dismisses the sheet without clearing that flag. Dock/menu/running-HUD rename directly sets only the passage. The next ordinary rename can request dictation again. Build14 routes all entries through an explicit per-presentation intent helper and clears on dismissal; strict same-workspace live verification is pending. Build13 is held from delivery.
- Fresh10's one corrected baseline gesture attempt fails27.819s before the score: Show Sidebar does not expose Pieces. No double/triple gesture runs, so this is not a baseline live repro of stale intent. Protected practice/passages/schedules/annotations stay exact; only startup rank Unranked→Prelude and revision6→7 change.

## Remaining known failure

B155 remains unresolved: build13 fresh5 records a centered valid Camera gestures menu tap leaving the menu open after relaunch. Fresh6 passes the same scoped flow on unchanged production source. Fresh9's All passage reviews opening also fails as described above. A later pass does not explain either failed tap or establish first-tap reliability.

## Next steps

Repair stale passage-dictation intent, finish the focused gesture/URGENT checks and independent saved-ledger audit, then record the successor source/package separately. Wait for the user's explicit device readiness. Physical camera discrimination, speech over piano, Pencil branching, audible click and sustained practice remain acceptance gates; no zero-defect claim is supported.
