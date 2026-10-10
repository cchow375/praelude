# Build10 — selection consistency across PDF page sizes

Updated October10, 2026. Build10 is a development candidate with production source frozen and final scoped checks passing. Installed native app
remains2.0.0/build9/schema5, source `2de2444`; Macv11.1.0/schema21 is unchanged.
Scoped verification is recorded below. Signed Release and independent signature/profile checks pass; installation and physical acceptance remain pending.

## Report and retained acceptance

After the earlier build9 confirmation that score pinch-zoom, Pencil marks → Done, two-finger Undo,
passage selection and button response work and feel responsive, the user reports a score-specific
failure: Prokofiev passage creation appears plain without corner dots and lags badly; Beethoven's
handles are smooth. Selection must remain usable across pieces. This is B146; the earlier named
acceptance is retained without generalizing it to every PDF.

The user separately reports that selection Cancel does not work (B147). The candidate makes explicit Cancel
discard only the draft immediately and return to the score; saved baseline passages must
remain unchanged. Navigating away keeps its separate confirmation guard.

## Confirmed input geometry and source findings

| Input | Confirmed PDF page size |
| --- | --- |
| Prokofiev page10 |5609.6×7764.01 points |
| Beethoven page4 |626.76×874.92 points |

The existing overlay minimum content scale of1 prevents the intended4-million-pixel cap from
constraining the Prokofiev-sized page: its area is about43.55 million pixels before any higher scale.
Selection handles measured as8 source points can become smaller than1 screen point when this page
is fitted to the display. These establish page-size-dependent rendering and visibility defects;
they are not a measured decomposition of every observed delay. Private score files stay outside Git.

## Repair and verification status

Overlay/state repairs are implemented. Production source is frozen, and two fresh source reviews
find no new blocker. Explicit Cancel now finishes draft discard directly; navigating away retains
its separate confirmation guard. Source coordinates and saved passage baselines remain the contract.
The overlay raster cap does not bound total PencilKit cache or process RAM, and no physical speedup
is inferred. A pre-existing cropped-resize limitation when the opposite edge is hidden remains;
move handling is repaired, but this round does not expand resize behavior.

| Run or gate | Result and exact boundary |
| --- | --- |
| Initial compile |Failed on ambiguous `convert(.zero)`; explicit `CGPoint.zero` repairs the compile ambiguity. |
| Fresh source review |Two independent reviews find no new blocker on frozen production source. |
| First iPad native run |One new case has three exact CGRect assertion failures from floating-point representation (`-125.351999999` vs `-125.352`). The fixture now compares with1e-6 tolerance; iPad3 subsequently passes all6 new cases. The original run remains failed. |
| Final selected native scope |PASS:48 selected tests on phone; iPad2 passes14 AnnotationInteraction plus28 ScoreMarkup and iPad3 passes6 new cases, all0 failures in those scopes. Do not infer a full native app-suite pass. |
| Phone1 selected native |PASS48 tests/0 failures in3.009s. |
| iPad ordinary selection UI |PASS23.679s: create/Done and double-tap. Local result: `/tmp/praelude-build10-ipad2.xcresult`. |
| iPad oversized selection UI |PASS24.433s: create, Cancel blank draft, Cancel drawn draft, Undo/Redo and save. Same iPad result bundle. |
| Phone1 ordinary selection UI |PASS28.855s. |
| Phone1 extended oversized UI |FAIL at immediate `removeBox.isEnabled` after editing a stored passage and tapping. The failure occurs before Cancel; coordinate/timing cause is unproven. It does not establish a Cancel failure or saved-baseline preservation. |
| Phone2 single-method filter |Executed0 tests despite TEST SUCCEEDED. This is a discovery failure and supplies no test evidence. |
| Final phone3 actual UI |PASS2 cases/0 failures: ordinary23.249s and extended oversized44.865s (68.114 total test seconds). Saved-edit Cancel adds a second box, cancels, then reopens and verifies the original one-box baseline. |
| Final iPad3 actual UI and new native cases |PASS2 UI cases/0 failures: ordinary47.643s and extended oversized46.439s (94.083 total test seconds); all6 new native cases pass. The saved-edit Cancel baseline is verified on iPad too. |
| Phone1 large-page pixel review |Root visual review sees visible handles and unclipped Cancel/Done. This screenshot review does not substitute for the saved-edit UI test. |
| Independent iPad and phone visual review |PASS for all4 ordinary/oversized screenshots: visible consistent handles/borders; Cancel/Done unclipped. Screenshots linked below. |
| Signed Release |PASS: independent strict signature, app/profile/team/device/signer trust, Release exclusions and matching app/dSYM. Profile expires October16 at23:56:11 UTC. |
| Guarded install / preservation |Pending; build9 remains installed. |
| Actual Prokofiev and Beethoven physical comparison |Pending; no measured speedup or universal score-consistency claim. |

Production source is unchanged after the initial `CGPoint.zero` compile correction. Later changes
are test-only: CGFloat tolerance and a saved-edit Cancel scenario that adds a second box instead
of depending on immediate select/remove readiness. Both devices verify the one-box baseline after
Cancel. The runs above are scoped native/UI checks, not a full-suite pass or latency measurement.

Accepted visual evidence: [iPad large page](screenshots/ipad-large-page-selection.png),
[iPad ordinary page](screenshots/ipad-ordinary-page-selection.png),
[phone large page](screenshots/phone-large-page-selection.png) and
[phone ordinary page](screenshots/phone-ordinary-page-selection.png). These confirm the shown
simulator layouts, not physical drag latency or sustained behavior.

**Next steps:** complete guarded delivery, then obtain a physical Prokofiev/
Beethoven selection and Cancel result. Retain failures
and precise run scopes; do not infer measured latency, sustained/week-long reliability or unrelated
microphone/two-device acceptance.
