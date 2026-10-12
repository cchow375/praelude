# Build15 — bounded functional verification

**Result: NOT READY. Both physical iPads remain untouched and last verified at build12.** The user requested a bounded report after the current tap, note, Back and rotation checks, with no further scope expansion or diagnostic loops. Mac11.1.0/schema21 is unchanged.

The completed final18 run executes **316 tests:313 passed,2 failed,1 skipped**. This consists of8 actual simulator UI cases (6 passed,2 failed) and308 native tests (1 live-account skip,0 failures;15.960s). All selected UI cases omit window tracing and passive branch tracing. Speech capture/finals use explicit synthetic test inputs; those are routing/ownership checks, not microphone recognition acceptance.

| Actual UI flow | Result | Evidence and limit |
| --- | --- | --- |
| Ink → Undo → new stroke → save → close → process relaunch → reopen | PASS86.400s | New location persists; undone marks do not return in this case. Physical Pencil remains untested. |
| Eight selected-box double-tap/edit/Cancel cycles, then triple-tap dictation and ordinary editing | PASS167.412s | Actual touches and resulting editors; no action retry. Does not establish every initial tap. |
| Saved ink → landscape → owned Sidebar show/hide → portrait → Focus/exit | PASS179.912s | Actual landscape geometry, same score/page/ink retained; reading controls restored. |
| New-note Dictate → Cancel → score voice return | PASS80.870s | No note saved; protected practice state retained; fresh Clean accepted exactly once. |
| Voice Check → Back → score listening | PASS112.620s | Check-only input does not grade practice; prior score listening returns and a fresh Clean records once. |
| Saved-note edit → Dictate → Cancel → score voice return | PASS106.990s | Same saved note/text retained; practice/page/click/ink protected; fresh Clean accepted exactly once. |
| One saved-box center tap per fresh process, planned10 launches | **FAIL105.004s on launch5** | First4 launches pass. On launch5 a fully visible, settled, hittable page receives one fixed center tap at410,523.5; Whole piece remains and the saved passage is absent. The all-saved-region routing change is insufficient. Loss point remains unknown. |
| Unselected saved box → real pinch → real pan → one tap at zoom | **FAIL69.327s at combined final zoom assertion** | Pinch increases actual scale and pan moves the page. The tap DOES arm the correct passage and cold-grade controls. Queries reach the final absolute-scale comparison; the taller panel changes the viewport927→901pt. Full failed scale/minimum values were not captured, so exact zoom preservation and the cause of the final comparison failure remain unaccepted. This is not classified as another tap no-op. |

Frozen simulator executable: `0cfc86896420bbd925aaa48e10786bd5bf411f43d83f74bfcb13de348164501b`. Built and installed UI plugin: `61c0da187a5a4a7e5920eb9a98887685e7c562c5df8abc3afc0a8dfe13b9fc74`. Runtime: iPad Air11-inch(M3), iOS26.5 simulator. Test wall times include automation/attachments and are not touch latency measurements. Checkpoint tag `ios-v2.0.0-build15-candidate` identifies this held, failed verification state; it is not a shipped release.

## What remains open

- B155: intermittent initial saved-passage tap failure. Successful repetitions do not close the concrete fifth-launch failure.
- Exact zoom preservation after the practice-panel resize; the final18 combined assertion is failed, not waived.
- Armed-passage pencil Edit has a9.5×9.5pt accessibility target in the failure capture. A proposed shape/test addition was never compiled or run and was reverted when the user narrowed scope. It remains unrepaired and untested.
- Fresh independent manual verification of this final binary and a signed build15 Release package audit were not performed. Earlier manual/package evidence has a different source/binary scope.
- Physical speech over piano, camera gestures/landmarks/lighting/orientation/false actions, Pencil, click audibility, personal-device OS behavior and sustained practice remain untested. No latest-source physical update or preservation claim is made.

No final19 run, additional diagnostic sweep, generic Release build or physical-device tooling follows this bounded report. The final source is returned to the exact final18 test provenance. Any future implementation/verification must preserve these failures; delivery remains explicitly prohibited until the user lifts the hold.

## Evidence

- [Executed result summary](functional-final18-summary.json)
- [Source and built/installed binary provenance](functional-final18-provenance.json)
- [Independent result audit](final18-independent-review.json)
- [Fifth-launch tap failure screenshot](screenshots/saved-box-fifth-launch-noop-final18.png)
- [Zoom failure screenshot showing the correctly armed passage](screenshots/zoom-passage-armed-final18.png)
- [Full scoped history, including failed and excluded runs](functional-flows.md)

Raw log/result/attachments remain outside Git at `/tmp/praelude-build15-functional-final18.{log,xcresult}` and `/tmp/praelude-build15-functional-final18-attachments/`. Only synthetic, privacy-safe evidence is committed.

## Next steps

Report the passes, the remaining tap failure and untested boundaries. Keep both iPads untouched. Further repair or diagnostic work is outside this bounded verification checkpoint.
