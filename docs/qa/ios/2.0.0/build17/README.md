# Build17 — natural face input and score response

## October 12 — Build17 natural face input candidate verified; personal delivery next

**Last updated:2026-10-12. Personal iPad remains installed at native2.0.0/build16/schema5. Build17 candidate verification is recorded in `docs/qa/ios/2.0.0/build17/`; friend remains held at Build12 and Macv11.1.0/schema21 unchanged.** Build16 preview toggling has a scoped user pass, while natural nod/shake/grin recognition and roughly one-second score page/rep pauses remain user-reported failures (B170/B171 OPEN). These estimates are not measured accuracy or latency.

Build17 selects ARKit face tracking on supported hardware, with direct camera-relative pose, bilateral smile/jaw/blink coefficients and a dense projected mesh. Vision remains the fallback with denser landmarks and bilateral corner-lift measurements. Natural gestures use independent arming, calibrated noise floors, asymmetric shake sweeps, softer returns and brief missing-measurement recovery. Command-first mappings and sensitivity/hold/interval customization are retained. Preview renderers share the capture session and do not restart it when hidden; the score renderer is hidden behind sheets. Frames and face measurements stay local and are discarded.

Rep, page bookmark, practice-rule, timer-checkpoint and reward preparation now run away from the UI actor. Final revision/context checks and atomic write-before-publication remain on the UI actor. Originating set/page/passage/camera-context gates retire stale commands; old asynchronous confirmations cannot overwrite a newer verdict's feedback. Independent review found and repaired those concrete races. This is a source and scoped test result, not proof of real-device response time. Atomic replacement, AVAudioSession/AVAudioPlayer startup and physical AR preview/recognition latency remain unmeasured. No practice schema migration or data import is added.

**Next steps:** guarded personal delivery, exact full-file preservation and launch readback, then real-camera natural nod/shake/grin and score page/rep responsiveness acceptance. Keep the friend iPad held. Detailed pass/fail/untested boundaries and retained intermediate failures are in the Build17 QA record.

## Verified scope

| Gate | Result | Boundary |
| --- | --- | --- |
| Core | 507 executed,1 live-account skip,0 failures;46 targeted gesture cases | Synthetic trajectories and persistence, not measured physical accuracy |
| Deterministic services | 2,340 assertions pass | Voice/metronome/reward/PCM contracts |
| Final5 native | 331 executed,1 live-account skip,0 failures;20.298s | Includes6 asynchronous runtime integrations,6 AR geometry tests and frame/context regressions |
| Final4 actual UI | First-attempt click/grade/Stop/process-relaunch/review passes60.353s | Camera off; ordinary score/practice neighbor |
| Independent manual | Six preview/Done/overlay cycles, five settings reopens, exclusive mapping, ordinary page save and one touch Clean/reward pass | One initial quick input no-op retained; cause unproven. Neutral-only synthetic frames; no AR video graph or changing-face→score-command acceptance |
| Generic signed Release | 67/67 independent checks and complete app/dSYM archive readbacks pass | All187 production Swift/10resources exact; post-build test-only preference isolation delta documented |
| Personal delivery | Pending | Current personal installation remains Build16 |
| Real camera and score response | Pending | Natural nod/shake/grin, AR alignment/orientation, page/rep latency, sustained practice |

`verification-summary.json` retains intermediate324/330-case passes and final4's331-case run with one new-test fixture failure: setting hold=.6 was a no-op because the shared preferences already held.6. The corrected isolated preferences test and all331 cases pass in final5. A test-only private teardown API compile failure was repaired before native execution; no failed result is replaced. Production/resources are exact between the final4 signed Release and final5 native tests. Evidence: `source-final4-provenance.json`, `native-final5-provenance.json`, `release-independent-final4.json`, `release-package-final4.json`.

Independent details: `independent-live-final5.json`. Settings/camera cycles leave all library bytes exact; ordinary page/rep testing changes only intended pieces/history/revision/rewardLedger/sessions. One initial default quick switch-center input does not change state; a bounded120ms thumb contact succeeds and subsequent cycles succeed. No cause or first-tap reliability repair is inferred.
