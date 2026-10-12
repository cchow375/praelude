# Build15 — prepared for controlled device validation

## October 12 — Build15 installed on the personal iPad

**Last updated: 2026-10-12. Personal iPad: native2.0.0/build15/schema5 installed, user-opened and observed running; post-launch library exact. Friend iPad: last verified build12/schema5, still held. Mac v11.1.0/schema21 unchanged.** Christian explicitly requested last night's verified Build15 on the plugged-in personal iPad, lifting the earlier no-install hold for this target only.

Guarded same-bundle refresh from source `68d667f` / `ios-v2.0.0-build15-device-validation` passes exact target readiness, signing/profile inclusion, installation and complete-file preservation. All241 source hashes match the verified checkpoint. Private backups `20261012T162528Z-6f0225cd` and `20261012T162604Z-92f7b475` retain all13 files/19,420,130bytes exactly by filename/size/SHA-256. Ledger remains schema5/revision3423, with6 pieces/77 passages/73 historical sets/46 sessions/534 ink records/20 stamps/5 notes and a completed active-slot set. No running set was interrupted and no uninstall/reset/restore/termination occurred.

The helper rebuilt Release for this device; actual executable SHA-256 is `e176ae5ad22e32766d665127791b9984f12d02e54134ce26de228af1560f88ea`, distinct from the earlier generic package. Independent full-file/record, strict signature, signer trust, entitlement/profile, exact target,65-marker absence, resources and matching arm64 dSYM checks pass; profile expires2026-10-17T16:14:24Z. iOS declined automatic launch after successful install/preservation; the first read-only process check finds no running Praelude. Christian then confirms opening; the next read-only process query observes Praelude running. Complete post-launch backup `20261012T163008Z-91208583` retains all13 files/19,420,130bytes exactly, including unchanged schema5/revision3423, every original record, score, annotation, profile/privacy and preference. No migration occurs. No Mac import or physical Pencil/speech/camera/click/sustained-practice acceptance is claimed. Evidence: `docs/qa/ios/2.0.0/build15/personal-ipad-install.json`.

**Next steps:** use Build15 on the personal iPad; physical Pencil/speech/camera/click/sustained acceptance remains separate from this verified install/open/readback. Keep the other iPad held. Earlier preparation/hold and failed verification records below are historical; their evidence and physical-acceptance limits remain intact.

**The affected simulator flows, independent live verification, signed Release audit and archive readback pass. Installation remains HELD: both physical iPads are untouched.** Native2.0.0/build15/schema5 is prepared for the next authorized device-validation step; this is not physical acceptance or a bug-free claim. Mac11.1.0/schema21 is unchanged. Source checkpoint: `ios-v2.0.0-build15-device-validation`; the original `ios-v2.0.0-build15-candidate` preserves failed final18 and is not moved.

| Affected flow / gate | Actual result |
| --- | --- |
| One saved-passage contact per fresh process | PASS30 launches:20 with exactly one began/end and no cancellation(424.045s), then10 with all diagnostic hooks off(200.221s). Each arms Evenness/cold controls without practice/history/click/voice-owner changes. One120ms same-center contact, no retries. |
| Armed Edit outer padding → name/112.5 goal → Save → process relaunch | PASS94.063s in final19, plus independent visible-UI final24. The44×44pt hit area accepts padding outside the24pt glyph. Independent re-read opens exact name/goal; only intended passage title/goal/updatedAt and revision7→8 change, all other records/PDF exact. |
| Real pinch → real pan → one passage tap → panel resize | PASS final20 UI64.577s and independent final24 UI70.062s, all16 strict predicates. Absolute scale2.4332361227405377 is exactly unchanged across viewport927→901pt; the fit minimum changes correctly. Two affected mounted native layout cases pass0.123s/0.022s. |
| Normal navigation / Focus / Cancel / Close | Independent final24 PASS through Today→owned Sidebar→Pieces→card→score, one saved-box contact, Focus enter/exit, actual Close/process relaunch/reopen, and first-click editor Cancel/picker Close. |
| Signed generic Release15 | Root29 checks and independent40 checks PASS: strict signature, profile/team/entitlements/trust/private-key membership, arm64 app/dSYM match, fonts/resources and source/binary binding. All65 diagnostic/test markers absent. Profile valid through2026-10-17 16:14:24UTC. Exact-device inclusion is not queried or claimed. |
| Archive readback | PASS: ignored `releases/ios-build15-verified-20261012` app/dSYM ZIPs extract to exact full file inventories of the audited inputs. No app data is bundled. |

The fifth-launch failure is explained, not hidden: matching final18 launch5, final19 launch14 and final22 launch3 system logs show XCTest's virtual digitizer disappearing while its contact is still down; BackBoard cancels it. Final22 observes began→cancelled173.318ms before original window forwarding, with no ended event. The test request asked for a50ms up, but completion notification did not prove delivery. The corrected single120ms test contact passes the delivery checks; bounded final23 OS logs show30 empty-contact teardowns and0 live-contact cancellations. No production passage action is fired from cancelled input. Exact Apple-internal race origin and unmatched historical failures remain unproven.

The production fixes are the armed Edit label's rectangular44pt hit area and preservation of absolute manual magnification on height-only HUD changes. At-fit layout still follows fit; width/rotation, explicit refits and automatic short-landscape transitions retain their existing behavior. Original failed zoom shrank2.433236→2.364990 at constant relative zoom; the strict absolute assertion was retained and now passes.

Latest simulator app: `f18c220c56eed9d2d30bc3b68e2c3e315e5fa79f7a17c20c75daa83c196fe645`; UI plugin: `bd8fbeeeca9b4046b66ffff2bc962a8535c6acc255ace8891772afc2b96adb9c`. Generic signed Release executable: `b3c21602064f27282cf40e0d04f79a2445d6dae2424f179cb6fe4a9c2742f4f8`. All241 tested source hashes match. Runtime: iPad Air11-inch(M3), iOS26.5 simulator. Wall times are automation duration, not touch latency or frame-rate measurements.

Actual inspected screenshots: [saved name/112.5 after independent relaunch](screenshots/independent-name-goal-reopened-final24.png), [independent zoom after arming](screenshots/independent-zoom-armed-final24.png).

Evidence: [30-launch delivery](tap-delivery-final23.json), [result](tap-input-final23-summary.json), [source/binaries](tap-input-final23-provenance.json), [causal cancellation capture](tap-cancellation-cause-final22.json), [independent live report](independent-live-final24.json), [independent zoom summary](independent-zoom-final24-summary.json), [signature](release-signature-final23.json), [independent Release audit](release-independent-final24.json), [archive/package](release-package-final23.json), [retained complete history](functional-flows.md).

## Historical bounded final18 verification

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

## What remains untested / unaccepted

- Physical speech over piano, camera gestures/landmarks/low light/false actions, Pencil, audible metronome, actual-device OS behavior and sustained practice. No current-device inclusion, backup, install, file preservation or launch/readback gate was attempted.
- Manual landscape rotation was not established by the independent CUA attempt: only simulator casing changed. The separately recorded final18 actual rotation/Sidebar/Focus/saved-ink UI pass179.912s and current affected native landscape pass retain their exact scopes; the manual attempt is not counted as another pass or an app defect.
- Unmatched historical no-ops and alias-focus failures retain their recorded uncertainty. The three explicitly matched virtual-digitizer cancellations do not retroactively explain every old failure. No blanket physical or zero-defect acceptance is supported.

The earlier note, Voice Check Back, rotation, Undo/new-stroke and double/triple-tap scoped passes remain in final18's frozen-source record below; they were not broadly repeated after the user narrowed scope. Speech inputs in those tests were synthetic, not microphone recognition acceptance.

## Evidence

- [Executed result summary](functional-final18-summary.json)
- [Source and built/installed binary provenance](functional-final18-provenance.json)
- [Independent result audit](final18-independent-review.json)
- [Fifth-launch tap failure screenshot](screenshots/saved-box-fifth-launch-noop-final18.png)
- [Zoom failure screenshot showing the correctly armed passage](screenshots/zoom-passage-armed-final18.png)
- [Full scoped history, including failed and excluded runs](functional-flows.md)

Raw log/result/attachments remain outside Git at `/tmp/praelude-build15-functional-final18.{log,xcresult}` and `/tmp/praelude-build15-functional-final18-attachments/`. Only synthetic, privacy-safe evidence is committed.

## Next steps

Maintain the explicit no-install hold on both iPads. No further diagnostic sweep is required for this completed affected-flow checkpoint. When the user later authorizes device validation, use the guarded same-bundle protocol with exact target/profile checks, a fresh idle/paused backup, complete file comparison and separate launch/readback and physical acceptance. Never substitute this generic package/simulator pass for those gates.
