# Build18 — quick head looks at piano distance

## October 13 — Build18 candidate verified; personal installation next

**Last updated: 2026-10-13. Native 2.0.0/build18/schema5; candidate verified; personal installation next.** Personal iPad remains last verified running Build17/schema5. Friend iPad remains held at Build12; Mac v11.1.0/schema21 is unchanged. Christian reports Build17 recognition still fails too often at normal piano distance, approximately 2.5–3 feet with the iPad upright. B170 remains OPEN. The score page/rep pause (B171) has no new physical verdict.

Build18 adds quick **Look right → Next page**, **Look left → Previous page**, and **Look down → assigned command**, firing on measured onset before returning. A separate head-look interval defaults to 0.4 seconds, adjustable 0.25–1 second; measured neutral re-arms each direction. Versioned local-settings decoding moves page commands to right/left and an existing nod verdict to down, preserving other verdict assignments, opt-in and recognition preferences. Customized new mappings persist. Legacy nod/shake mappings show paused while quick looks use the same axis. These are head movements, not eye-only gaze.

Tracking now uses player-relative yaw signs, smaller-face head-pose gates and a same-camera Vision fallback after 0.3 seconds of AR tracking loss. Fallback remains selected for the session and recalibrates once. Recent signed motion can survive a short gap, but disappearance never issues a command; strong horizontal evidence plus measured neutral reacquisition can finish one page turn, never infer a rep. Source changes, multiple faces, dark/stale frames and prolonged loss block future recognition. An already recognized rep can finish saving through later tracking loss or automatic fallback; explicit Off, remapping, calibration, rotation and score-input gates still cancel pending commands. Frames and face measurements remain local and discarded. No practice schema or sync contract changes.

Core 520 cases/1 live-account skip/0 failures and 2,340 deterministic service assertions pass. Final native 337 cases/1 live-account skip/0 failures pass in 17.542 seconds; independent detector probes pass 15/15. Affected UI/live/package details, source provenance and retained earlier failures are recorded in the QA directory. Simulator/typechecks cannot prove actual sensor direction, distance throughput, recognition reliability or page/rep response. Candidate verification and exact result boundaries are in `docs/qa/ios/2.0.0/build18/`.

**Next steps:** guarded personal installation, full-file preservation, then manual launch/readback and real-camera acceptance. Test quick right/left/down, misses/accidental commands, preview alignment and page/rep pauses separately. Keep the friend iPad held.

## Verified scope

| Gate | Result | Boundary |
| --- | --- | --- |
| Core | 520 executed,1 live-account skip,0 failures;59 face cases | Synthetic trajectories/settings; not physical accuracy |
| Deterministic services | 2,340 assertions pass | Existing offline voice/metronome/reward contracts |
| Final native | 337 executed,1 live-account skip,0 failures;17.542s | Six new geometry/service cases including accepted downward command surviving later tracking loss |
| Independent detector | 15/15 pass | Exact reproducible probe in neighboring Swift/JSON files |
| Current affected UI | Two pass: mapping/customization/relaunch189.977s, six start/stop cycles and nine preview pairs469.423s | Atomic current uniquely named test; controls/core unchanged by final service epoch fix, covered by final native |
| Independent live | Final current-app smoke and broader unchanged-controls navigation/remap/relaunch/preview pass | Full synthetic2-file/97,084-byte library exact; zero practice activity. Manual head-look interval not reached; no product-scroll cause assigned |
| Final signed Release/package | 69/69 independent checks; all283 source/10resources exact | Strict signature/profile/trust/dSYM/resources/71marker absence and full app/dSYM zip readbacks. Saved-target inclusion; fresh personal-device gates belong to delivery |
| Physical recognition/latency | Pending | User-reported upright2.5–3feet; real right/left/down, sensor alignment, accidental commands, page/rep response and sustained practice |

Final Release executable: `83edcd72f640ad975145951d3552a48857eb2d2cfbfe8c6780edca2edd3262e7`; provisioning expires2026-10-17T16:14:24Z. Current source checkpoint: `ios-v2.0.0-build18-candidate`. Generic archives are private/ignored; sanitized inventories and hashes are in `release-package.json` and `release-independent.json`.

## Retained failures and source lineage

`verification-summary.json` preserves the initial missing-return compile failure, an outdated too-small-face fixture, the independent14/15 missing-axis failure and repair, all three earlier failed/unaccepted UI runs, and the compiler run cancelled before execution to respect Simulator ownership. Earlier UI output did not match changed fixture/selector source; disk equality alone did not prove loaded runner code. No tap cause or production touch repair is inferred. Atomic build+test with the uniquely renamed case and current Any-selector/single120ms contacts supplies final UI evidence.

The late accepted-command repair changes only tracking/source-driven epoch retirement: accepted input can finish saving through subsequent face loss/fallback; future motion/calibration still resets. Explicit Off/remap/calibrate/rotation/score gates cancel as before. Final native337 and independent current-app smoke verify the final source. Earlier336-case native, broader live controls and signed-package evidence remain separately named before-command-fix. No failed record is replaced, and no real-camera end-to-end pass is claimed.

Next steps: guarded personal delivery with exact full-file preservation and version/launch/schema readback, then physical acceptance at the piano. Keep the friend iPad held.
