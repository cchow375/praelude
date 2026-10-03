# Build6 compact practice controls

2.0.0/build6/schema5 development candidate. Installed build5 remains until guarded refresh; no schema, rules or sync changes.

## Requested correction

Christian’s installed build5 feedback: Start without grading, Techniques and More options consumed excessive vertical space, while a narrow dock left useful horizontal space empty. Score visibility takes priority.

Removed the760-point dock width cap. Wide setup shares metadata/tempo/secondary actions with cold grading or Start. Secondary actions retain44-point targets. Cold and running verdicts use horizontal icon/text and52-point targets. Running progress, directly adjustable tempo, transport and verdicts use one row when their measured widths fit, with readable narrow fallbacks. Expanded readout and accessibility wrapping/scrolling remain available.

## Native verification

- Six distinct iPad cases pass across the scoped initial/final runs: setup geometry, collapsed running geometry with actual Clean→1/Undo→0 and stable PDF bounds, largest-text complete labels/reachability, pre-attempt metronome edits, Techniques scrolling/hand choice, and completion→Another set→ordinary Start.
- Final geometry tests exercise portrait and landscape: ordinary and first-attempt setup143pt; collapsed running100pt. Secondary targets44pt; verdicts52pt. These are native accessibility dock bounds, excluding system safe-area/margins. Score viewports remain927/567pt during setup and970/610pt during collapsed running. The saved repetition and Undo leave all four score-frame components unchanged.
- Largest accessibility text uses the bounded scroll footer, keeps all labels/actions reachable and leaves score height554pt portrait/285.5pt landscape. Its dock content extends beyond the visible scroll viewport deliberately; normal-text height caps do not apply to it.
- Initial rotation waits failed for both ordinary setup and HUD while the simulator kept portrait geometry. Portrait geometry and actual Clean/Undo already passed. Restarting the synthetic simulator resolves that environment state; both real landscape geometries pass in the final run. No product hit-testing defect is inferred from the combined orientation predicate.
- Native visual review caught squeezed progress text; fixed-size statistics and lower-priority title compression retain the complete counter, tempo and expansion target. Final running height falls from120pt to100pt. Source review also caught the confirmation overlay sitting over the new verdict row; informational voice flashes now pass touches through.
- Phone collapsed running geometry and actual verdict/Undo pass both orientations:204pt portrait/152pt landscape. Independent visual review confirms readable full labels/counter/tempo and distinct transport controls. Phone setup initially hit a43.999999pt representation of a44pt frame;0.01pt numerical tolerance is now applied, and the setup rerun now passes portrait/landscape sizing plus an actual first-attempt save after clearing simulator rotation state. One prior landscape press did not save; a subsequent synthetic launch displayed rotated content in a portrait simulator shell. The complete unchanged-app rerun passes after restarting that simulator; the earlier failure is retained without claiming a proven product callback defect. Largest-text review prompted a stronger More options frame/label containment assertion; that targeted native rerun passes both orientations and the final capture shows its complete label. No all-green full UI-scheme, live voice/audio or physical pianist acceptance is claimed.

## Native captures

Synthetic fixture scores only. No personal PDF/data, device IDs, account names or raw result bundles are committed.

- [Build5 before](build6/ipad-build5-before.png)
- [Compact cold setup portrait](build6/ipad-cold-portrait.png)
- [Compact cold setup landscape](build6/ipad-cold-landscape.png)
- [Compact running portrait](build6/ipad-running-portrait.png)
- [Compact running landscape](build6/ipad-running-landscape.png)
- [Largest-text scroll fallback](build6/ipad-largest-text-landscape.png)
- [Phone running portrait](build6/phone-running-portrait.png)
- [Phone running landscape](build6/phone-running-landscape.png)
- [Native bounds](build6/layout-metrics.json)

## Guarded device update

The October3 refresh attempt stopped at the initial device data copy. No build or installation was attempted by that helper run. Its failed local copy is retained; installed build5 remains. No lock/trust cause is inferred beyond the helper’s copy failure.

The user then explicitly requested shipment again. A sandbox retry could not reach the device service; the host-access retry verifies11 files/6,212,619bytes with independent manifest/byte review, schema5/revision883 and no active set. Release compilation reaches code signing and fails with `errSecInternalComponent`; the same exact-identity signing probe fails on a plain temporary executable outside the sandbox. Two identities are valid; the selected certificate is unexpired and its code-signing trust check passes; the default keychain is unlocked. Native Xcode’s default Debug build stops earlier at an unrelated Helpers framework linker error and does not establish signing. The cause remains unresolved; no ACL/credential/trust change was performed. The user is asked to run `npm run ios:refresh` locally in Terminal and handle any signing prompt there. [Sanitized attempt](build6/device-update-attempt.json). No installation has been attempted.

## Next steps

Six distinct scoped iPad and two phone cases pass across the recorded runs; final independent visual review passes. Resolve the local signing step, then complete the guarded same-bundle build6 installation with full file preservation and actual practice judgment.
