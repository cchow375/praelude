# Praelude — Flaws, Risks & Honest Limits

## October 16 — Build20 sync repair; device verification in progress

**Last updated: 2026-10-16. Source native 2.0.0/build20/schema5; personal iPad remains Build18 and phone Build19 until guarded delivery.** Christian requests the iPad update and reports connected iPad showing Offline plus phone Sync error 0. Fresh complete iPad backup has 13 files/29,081,951 bytes at schema5/revision4265: 6 pieces, 129 passages, 93 history sets, 57 sessions and 598 attempts, no active set. The phone backup has 3 files/109,341 bytes and no scores/practice records. Local profile ownership agrees across both devices and each sync state; this does not establish credential validity. Read-only hosted counts for that library are zero.

Confirmed repairs: account_preferences reads order by its actual owner_id; a durable account/version-marked prerequisite prefix repairs the 8,036-entry legacy FIFO without deleting or changing any original entry; new practice queues its score and passage ancestry before history in the same transaction. Download order puts tags/folders before pieces; related folders/passages merge atomically, preserving newer local edits and region/provenance relationships. Backend errors retain useful message/code without optional row details; only typed connectivity failures show Offline. First-login profile adoption prepares missing score references before synchronous publication, rechecking account and staged profile edits after the await. Score metadata and page edits merge atomically while retaining annotated-PDF replacement protection; split/merge provenance can cycle without becoming a false parent cycle. No backend schema migration or practice schema bump. Counter/photo features remain as described in the Build19 guide.

Core verification passes 552 cases/1 opt-in live-account skip/0 failures. Synthetic hosted rollback tests pass prerequisite failures/recovery, Undo and owner isolation with fixture cleanup. Final hosted native passes 371 cases/1 opt-in live-account skip/0 failures in 28.024 seconds; all seven new download/practice/profile regressions and four SDK request/error cases pass. The intermediate iPad live Score/Counter/Clean/Undo case passes in 70.654 seconds; no later UI geometry changed. Device tooling passes 57 tests. Actual signed-package audit and guarded same-bundle delivery are next. The initial native run had one newly written region fixture missing its PDF filename; the fixture is corrected, with the failure retained. Existing iPad scores, annotations, history and the entire original queue must remain intact. Friend iPad held; installed Mac unchanged.

**Next steps:** finish affected native/live/package checks, guarded iPad/phone updates, separate open/version/schema readback and actual account upload/download verification. Keep B170/B171/B172/B173 physical and two-device acceptance boundaries explicit; no zero-lag or full-convergence claim yet.


## October 16 — Build19 installed and opened on the personal iPhone

**Last updated: 2026-10-16. Personal iPhone: native 2.0.0/build19/schema5, installed, user-opened and observed running.** Personal iPad remains last verified Build18, friend held at Build12; Mac v11.1.0/schema21 is unchanged. Christian explicitly requested installation on the connected iPhone. After unlock/computer trust, the exact iPhone 16 Pro Max is discovered with Developer Mode and development services ready. Both preflight and the guarded helper find no existing Praelude: this is a true first install, with prior-library preservation and schema migration not applicable, rather than an invented pre/post hash pass.

The guarded helper builds/signs Release and reads back installed 2.0.0/build19. Its exit 1 is the subsequent automatic-launch denial, not an installation failure. Christian confirms Praelude opens; read-only process/version and complete postlaunch backup confirm running Build19, schema5/revision189, no active set and no pieces/passages/history/sessions/attempts/ink/text records. The three initial owned files total 109,341 bytes and are independently rehashed against the private backup manifest. Built-in app defaults are retained; no personal library or credentials were transferred.

Independent actual-helper package audit passes 35/35 checks: deep strict signature/trusted signer, original team/stable bundle, exact phone in provisioning, arm64/matching dSYM, 21 debug-marker absence and 13 expected files with no personal resources. Executable SHA-256 is `4f0755c427a0bef334f33dbbf454b08f43faf6abcc8006da09d673fa45b5ae0d`. Profile expires October 23 at 19:42:03 EDT (23:42:03 UTC). The complete signed app+dSYM private archive has 16 files/111,544,953 bytes; every archived filename/size/SHA-256 reads back exactly. No uninstall/reset/restore-over/physical termination workaround or Mac import occurs. Evidence: `docs/qa/ios/2.0.0/build19/personal-iphone-install.json` and `iphone-package-review.json`.

**Next steps:** use Build19 on the iPhone. Sign in locally to the same Praelude account on phone/iPad, allow complete private metadata/assets catch-up, then verify offline/reconnect convergence. Physical camera/Photos quality, audible feedback/haptics and sustained responsiveness remain separate acceptance gates; B170/B171/B172/B173 stay open. Refresh the Personal Team signature before its expiration. Keep the friend iPad held.



## 2026-10-16 — Build19 candidate acceptance and sync findings

- **B172 OPEN — phone/paper passage workflow acceptance.** Source adds Counter, camera/Photos crop and visual review cards, but actual camera/photo quality, phone/iPad touch/rotation/accessibility, audible feedback and sustained latency require separate evidence. Native/simulator outcomes are scoped in `docs/qa/ios/2.0.0/build19/practice-cards.md`; no zero-lag claim. B170/B171 remain open.
- **B173 OPEN — personal native sync not yet exercised.** Christian confirms iPhone/iPad are not signed in. Hosted pieces table is empty; no personal score upload or two-device convergence is claimed. Additive schema and isolated SQL/transport checks are not real-device acceptance. Sign in to the same account locally, then verify full private assets/history/annotations/offline changes.
- **Candidate findings repaired before shipment:** fixed folder UUID would have collided across accounts under a global primary key; replaced by random folders + synced photo-origin metadata. Also repaired corrupt queue-state fallback, account-switch-during-refresh routing, invalid/late cloud download publication, first-region crop quality, missing iPad destination and stale card-detail edits. Also repaired blank review artwork, delayed-asset refresh, Open score routing and a stopped click restarting on tempo refresh. Fixing source checkpoint is `ios-v2.0.0-build19-candidate`; candidate repairs do not close B172/B173 or the physical B170/B171 gates.

Candidate verification now passes within its recorded scope: 537 core cases and 2,340 deterministic service assertions, 360 hosted cases, 57 helper tests, all six affected flows on each simulator form factor, and a fresh independent same-card Score/Counter/Clean/Undo check. Each full core/hosted run has one opt-in live-account skip and zero failures. Unsigned arm64 Release/package inspection passes; signed delivery and physical/account acceptance remain open. Final findings and every retained intermediate failure are in `docs/qa/ios/2.0.0/build19/practice-cards.md`.

## October 15 — Build18 installed on the personal iPad; launch verified

**Last updated: 2026-10-15. Native 2.0.0/build18/schema5; installed on the personal iPad; launch verified.** Personal iPad is installed at native2.0.0/build18/schema5. Running Build18 process and full postlaunch backup are verified; all13files/23,655,615bytes and complete library JSON remain exact after launch, including schema5/revision4061 and576attempts. Friend iPad remains held at Build12; Mac v11.1.0/schema21 is unchanged. Christian reports Build17 recognition still fails too often at normal piano distance, approximately 2.5–3 feet with the iPad upright. B170 remains OPEN. The score page/rep pause (B171) has no new physical verdict.

Build18 adds quick **Look right → Next page**, **Look left → Previous page**, and **Look down → assigned command**, firing on measured onset before returning. A separate head-look interval defaults to 0.4 seconds, adjustable 0.25–1 second; measured neutral re-arms each direction. Versioned local-settings decoding moves page commands to right/left and an existing nod verdict to down, preserving other verdict assignments, opt-in and recognition preferences. Customized new mappings persist. Legacy nod/shake mappings show paused while quick looks use the same axis. These are head movements, not eye-only gaze.

Tracking now uses player-relative yaw signs, smaller-face head-pose gates and a same-camera Vision fallback after 0.3 seconds of AR tracking loss. Fallback remains selected for the session and recalibrates once. Recent signed motion can survive a short gap, but disappearance never issues a command; strong horizontal evidence plus measured neutral reacquisition can finish one page turn, never infer a rep. Source changes, multiple faces, dark/stale frames and prolonged loss block future recognition. An already recognized rep can finish saving through later tracking loss or automatic fallback; explicit Off, remapping, calibration, rotation and score-input gates still cancel pending commands. Frames and face measurements remain local and discarded. No practice schema or sync contract changes.

Core 520 cases/1 live-account skip/0 failures and 2,340 deterministic service assertions pass. Final native 337 cases/1 live-account skip/0 failures pass in 17.542 seconds; independent detector probes pass 15/15. Affected UI/live/package details, source provenance and retained earlier failures are recorded in the QA directory. Simulator/typechecks cannot prove actual sensor direction, distance throughput, recognition reliability or page/rep response. Guarded same-bundle refresh independently preserves all 13 app-owned files/23,655,615 bytes exactly by filename, size and SHA-256 before/after installation. Schema 5, revision 4061 and the full library are retained. No uninstall, reset, restore-over, app-termination workaround or Mac import occurs. See `docs/qa/ios/2.0.0/build18/personal-ipad-install.json`.

**Next steps:** real-camera acceptance at the stated upright 2.5–3 foot setup. Test quick right/left/down, misses/accidental commands, preview alignment and page/rep pauses separately. Keep the friend iPad held.

## Historical October 13 — Build18 delivery stopped before installation

**Last updated: 2026-10-13. Personal iPad remains running native2.0.0/build17/schema5; Build18 candidate is committed at ae1c34e / ios-v2.0.0-build18-candidate. Friend remains held at Build12; Mac v11.1.0/schema21 unchanged.** The guarded refresh stops during the initial data copy (CoreDevice7000/remoteservices11001/POSIX1), before any device-specific build or installation. The incomplete private copy is retained and has no verified manifest; no preservation/install pass is claimed. Subsequent read-only version/process inspection confirms Build17 running. The transport/copy cause is unproven and does not establish device lock state.

All final Build18 source/native/UI/live/generic signed-package checks retain their scoped passes below. The user was asked to unlock the personal iPad, open Praelude, pause any practice set and leave it idle before retrying the guarded workflow. No uninstall, reset, restore-over or physical app-termination workaround occurred. Evidence: `docs/qa/ios/2.0.0/build18/delivery-attempt1.json`.

**Next steps:** await explicit readiness, then guarded same-bundle retry with fresh complete backup, exact preservation and launch/schema readback; actual right/left/down reliability at upright2.5–3feet and page/rep response remain open. Keep the friend iPad held.

## Historical October 13 — Build18 candidate verified; personal installation next

**Last updated: 2026-10-13. Native 2.0.0/build18/schema5; candidate verified; personal installation next.** Personal iPad remains last verified running Build17/schema5. Friend iPad remains held at Build12; Mac v11.1.0/schema21 is unchanged. Christian reports Build17 recognition still fails too often at normal piano distance, approximately 2.5–3 feet with the iPad upright. B170 remains OPEN. The score page/rep pause (B171) has no new physical verdict.

Build18 adds quick **Look right → Next page**, **Look left → Previous page**, and **Look down → assigned command**, firing on measured onset before returning. A separate head-look interval defaults to 0.4 seconds, adjustable 0.25–1 second; measured neutral re-arms each direction. Versioned local-settings decoding moves page commands to right/left and an existing nod verdict to down, preserving other verdict assignments, opt-in and recognition preferences. Customized new mappings persist. Legacy nod/shake mappings show paused while quick looks use the same axis. These are head movements, not eye-only gaze.

Tracking now uses player-relative yaw signs, smaller-face head-pose gates and a same-camera Vision fallback after 0.3 seconds of AR tracking loss. Fallback remains selected for the session and recalibrates once. Recent signed motion can survive a short gap, but disappearance never issues a command; strong horizontal evidence plus measured neutral reacquisition can finish one page turn, never infer a rep. Source changes, multiple faces, dark/stale frames and prolonged loss block future recognition. An already recognized rep can finish saving through later tracking loss or automatic fallback; explicit Off, remapping, calibration, rotation and score-input gates still cancel pending commands. Frames and face measurements remain local and discarded. No practice schema or sync contract changes.

Core 520 cases/1 live-account skip/0 failures and 2,340 deterministic service assertions pass. Final native 337 cases/1 live-account skip/0 failures pass in 17.542 seconds; independent detector probes pass 15/15. Affected UI/live/package details, source provenance and retained earlier failures are recorded in the QA directory. Simulator/typechecks cannot prove actual sensor direction, distance throughput, recognition reliability or page/rep response. Candidate verification and exact result boundaries are in `docs/qa/ios/2.0.0/build18/`.

**Next steps:** guarded personal installation, full-file preservation, then manual launch/readback and real-camera acceptance. Test quick right/left/down, misses/accidental commands, preview alignment and page/rep pauses separately. Keep the friend iPad held.

## October 12 — Build17 installed on the personal iPad; launch verified

**Last updated:2026-10-12. Installed personal: native2.0.0/build17/schema5; user-opened and observed running; full postlaunch backup/readback verified. Friend remains held at Build12; Macv11.1.0/schema21 unchanged.** Guarded same-bundle refresh confirms Build17 and preserves all13 saved library files/19,972,391bytes exactly by filename/size/SHA-256, independently rehashed. Installation retained schema5/revision3509 and the paused active set,6pieces/77passages/75history sets/47sessions/487attempts/549ink rows/20stamps/6notes are retained. Postlaunch schema5/revision3513 retains all practice records and the paused set. The full comparison changes only one piece’s lastPage3→7/lastPageUpdatedAt, library revision, and outbound sync bookkeeping (queue5947→5955); all other library fields and files are exact. Postlaunch files are therefore not byte-identical to the install backup. No uninstall/reset/restore/termination workaround or Mac import occurred. Earlier Build16/candidate checkpoints below are historical.

Installed Build17 adds supported-device ARKit pose, bilateral smile/jaw/blink coefficients and a dense projected face mesh; Vision fallback uses denser landmarks/corner lift. Natural nod/shake/grin detection uses independent arming, calibrated noise floors, asymmetric sweeps, softer returns and short-dropout tolerance. Command-first customization is retained. Preview uses the capture session without restarting it and the score renderer is hidden behind sheets. Rep, bookmark, rules, checkpoint and reward preparation move off the UI actor, with originating context/revision checks and atomic save-before-publication. Old asynchronous feedback cannot replace a newer verdict. Final file replacement and audio startup still have unmeasured physical main-actor latency.

Core507/1skip/0fail,2,340 service assertions and final native331/1skip/0fail20.298s pass. Actual score click/grade/Stop/relaunch/review passes60.353s. Independent synthetic controls complete6preview/Done/overlay cycles,5settings reopens, exclusive mapping persistence and ordinary page/rep/reward saving. One initial quick switch input no-op is retained with cause unproven; no first-tap repair or real video/recognition accuracy is inferred. Generic Release67checks and actual-helper Release66checks pass; the actual installed executable is675b0c7f734eaec063477376ca665d2aa9c371c4d907f42a37ef7ed1b5d59629, profile expiry2026-10-17T16:14:24Z, full app/dSYM archive inventory readback exact. Evidence: `docs/qa/ios/2.0.0/build17/personal-ipad-install.json` and neighboring native/live/package reports.

**Next steps:** real-camera acceptance. Check natural nod/shake/grin labels in settings, then real page/rep response during practice. B170/B171 remain OPEN until physical feedback; preview rotation/alignment, interruptions, audio and sustained practice remain unaccepted. Keep the friend iPad held.

## October 12 — Build17 natural face input candidate verified; personal delivery next

**Last updated:2026-10-12. Personal iPad remains installed at native2.0.0/build16/schema5. Build17 candidate verification is recorded in `docs/qa/ios/2.0.0/build17/`; friend remains held at Build12 and Macv11.1.0/schema21 unchanged.** Build16 preview toggling has a scoped user pass, while natural nod/shake/grin recognition and roughly one-second score page/rep pauses remain user-reported failures (B170/B171 OPEN). These estimates are not measured accuracy or latency.

Build17 selects ARKit face tracking on supported hardware, with direct camera-relative pose, bilateral smile/jaw/blink coefficients and a dense projected mesh. Vision remains the fallback with denser landmarks and bilateral corner-lift measurements. Natural gestures use independent arming, calibrated noise floors, asymmetric shake sweeps, softer returns and brief missing-measurement recovery. Command-first mappings and sensitivity/hold/interval customization are retained. Preview renderers share the capture session and do not restart it when hidden; the score renderer is hidden behind sheets. Frames and face measurements stay local and are discarded.

Rep, page bookmark, practice-rule, timer-checkpoint and reward preparation now run away from the UI actor. Final revision/context checks and atomic write-before-publication remain on the UI actor. Originating set/page/passage/camera-context gates retire stale commands; old asynchronous confirmations cannot overwrite a newer verdict's feedback. Independent review found and repaired those concrete races. This is a source and scoped test result, not proof of real-device response time. Atomic replacement, AVAudioSession/AVAudioPlayer startup and physical AR preview/recognition latency remain unmeasured. No practice schema migration or data import is added.

**Next steps:** guarded personal delivery, exact full-file preservation and launch readback, then real-camera natural nod/shake/grin and score page/rep responsiveness acceptance. Keep the friend iPad held. Detailed pass/fail/untested boundaries and retained intermediate failures are in the Build17 QA record.

## October 12 — Build16 physical feedback; Build17 recognition and response repair in progress

- **B169 scope update:** user reports Build16 preview toggles responsive/no crash; sustained/rotation/interruption acceptance remains separate.
- **B171 — recognized camera actions pause the score about1second (OPEN):** user localizes the pause to page turn/record rep. Synchronous full-library persistence and reward follow-ups are confirmed code paths; exact on-device time attribution remains unmeasured. Build17 native persistence/response and package checks pass; physical score response remains unaccepted.

**Last updated:2026-10-12. Personal iPad remains installed/opened at native2.0.0/build16/schema5. Build17 source is in progress; friend held at Build12 and Macv11.1.0/schema21 unchanged.** Christian reports several Show live preview toggles stay responsive without crash: a scoped physical pass, not sustained acceptance. Recognition remains poor, estimated by the user around10% rather than measured, particularly nod/shake and natural grin (B170 remains OPEN). A recognized score action also pauses about1second, specifically page turning or rep recording (new B171 OPEN); settings-only recognition is not the reported stall.

Investigation finds overly rigid shared-neutral/trajectory gates and coarse Vision pose measurements. The personal iPad supports dedicated ARKit face tracking; Build17 adds direct tracked pose, bilateral smile/jaw/blink measurements and a dense projected mesh, retaining the Vision fallback. Detector work accepts independent natural trajectories with calibrated noise floors, asymmetric shakes and bounded dropouts. Score actions currently prepare/encode the entire library synchronously, including bookmark, rep, rules and reward follow-up transactions. Build17 moves immutable preparation off the UI actor while retaining revision/context checks and atomic write-before-publication. These changes are under verification and have not been installed or physically accepted.

**Next steps:** complete targeted adversarial detector/geometry/persistence and actual affected-flow checks, independently review the finished source/package, then guarded personal delivery and new real-camera/action-response acceptance. Keep the other iPad held. Evidence: docs/qa/ios/2.0.0/build17/physical-feedback-build16.json.

## October 12 — Build16 installed and opened on the personal iPad

**Last updated:2026-10-12. Installed personal: native2.0.0/build16/schema5, user-opened and observed running. Friend remains held at Build12; Macv11.1.0/schema21 unchanged.** After Christian explicitly confirms unlocked/open/idle readiness, guarded same-bundle refresh succeeds. Complete pre/post/post-launch backups independently rehash all13 files/19,919,467bytes identically by filename, size and SHA-256. The entire schema5/revision3477 library remains exact:6pieces/77passages/75historical sets/47sessions/549ink/20stamps/6notes, no active set. No migration, uninstall/reset/restore/app termination or Mac import occurs.

Automatic opening is declined after successful installation/preservation. Christian opens the app; read-only process inspection confirms running Build16. The actual helper Release executable is af3d3e49c4719e676509a0a9f0aaa73ef6b2b2d369ba65128580280cc1f36f5e, distinct from the retained first-attempt artifact. Fresh-context audit passes50/50 checks, including strict signature, signer trust/profile/entitlements, exact target, matching arm64 dSYM and71-marker absence. Its complete zipped app/dSYM inventory readback is exact; profile expires2026-10-17T16:14:24Z. Candidate source checkpoint is b61eb6e / ios-v2.0.0-build16-candidate, with all279 source hashes unchanged. Failed install/copy attempts remain recorded; this successful attempt supersedes their delivery blocker. Evidence: docs/qa/ios/2.0.0/build16/personal-ipad-install.json.

**Next steps:** obtain actual Show live preview hide/show and automatic neutral/expression recognition feedback at piano distance. B169/B170 remain open for physical acceptance; simulator/native/package success does not prove camera accuracy or sustained crash-free practice. Keep the other iPad held. Installed controls and limits: docs/qa/ios/2.0.0/build16/candidate-guide.md.

## October 12 — Build16 delivery stopped safely; personal iPad still Build15

**Last updated:2026-10-12. Source/candidate: native2.0.0/build16/schema5 at b61eb6e / ios-v2.0.0-build16-candidate. Installed personal iPad remains Build15; friend remains held at Build12; Macv11.1.0/schema21 unchanged.** The guarded update verifies a complete private backup of13 files/19,919,467bytes at schema5/revision3477, then builds/signs Release. The install command fails; read-only version check confirms Build15 remains. A guarded retry stops during backup copy with CoreDevice7000/POSIX60 timeout, before any second install. Its incomplete copy is retained and is not a verified backup. Explicit unlocked/open/idle readiness was requested before another retry; no uninstall/reset/restore/app termination occurred.

Independent audit of the actual helper-signed Build16 passes50/50 checks and all279 source hashes. Its executable is a193d72dba9af0167379a7e0908e32744fac4ae7dcdb9085ea61780f68a3f691; exact personal-target/profile inclusion, deep strict signature, signer trust/entitlements, matching arm64 dSYM, resources and71-marker absence pass. Profile expires2026-10-17T16:14:24Z. Complete archive inventory readback is exact. These checks establish package validity, not successful installation or physical camera acceptance. Candidate/source and all retained test failures remain as recorded below. QA: docs/qa/ios/2.0.0/build16/personal-ipad-install.json.

**Next steps:** wait for explicit personal-device unlocked/open/idle readiness, retry the guarded helper, verify full post-install preservation and launch, then check actual preview toggles and expression recognition. Keep the other iPad held. B169/B170 remain open for physical acceptance.

## October 12 — Build16 camera repair prepared for personal-device check

**Last updated:2026-10-12. Source: native2.0.0/build16/schema5. Personal iPad remains installed/opened at Build15; friend remains held at Build12. Macv11.1.0/schema21 unchanged.** Christian reports crashes/freezes specifically when toggling **Show camera preview**, a visible face rejected as unclear, no gesture actions, and requests command-first customization. B169/B170 remain open for physical acceptance.

Source repairs serialize background capture operations and main-actor preview changes through one asynchronous logical FIFO across workers, retain camera ownership until shutdown completes, and deliver capture notifications asynchronously without waiting for main. Explicit Vision rectangle revision3 supplies head pose before landmarks; missing individual metrics no longer disable every gesture. Capture uses720p when supported, with actual frame aspect for overlay mapping, finite geometry guards, per-frame recovery feedback, automatic neutral calibration and conservative recovery of missing metrics without moving existing neutral. Orientation epochs fence startup/rotation frames. Meaningful context changes reset motion; unrelated voice updates do not. Rep dispatch rechecks running set, focus and first-attempt state and reports a blocked context honestly.

Customization now fixes five commands (Next page, Previous page, Clean, Sloppy, Again), then selects an exclusive expression or Unassigned. Expressions include nod in either direction, head shake, grin, open mouth and deliberate both-eyes closure. Sensitivity, expression hold and cooldown are adjustable. Legacy local mappings decode; moving an expression unassigns its previous command explicitly. Camera settings remain device-local; no practice/schema/sync contract changes.

Core476 cases/1 skip/0 failures and32 targeted gestures pass. Final native316/1 skip/0 failures41.214s includes the logical-FIFO preview-ack regression. Command-first mapping/recognition-settings Save/relaunch passes335.073s. Independent live iPad navigation/reassignment/reopen plus six synthetic camera/preview cycles and mapping off/on pass; all synthetic library bytes stay exact with zero practice activity. iPhone portrait controls/one assignment/Done pass after an unexplained long presentation delay; manual lower-form scrolling is untested. Final4 retains one untraced preview-off state failure240.661s on its fifth camera cycle; its cause remains unproven and no production tap fallback was added. First-attempt neighbor65.536s retains intermediate scope. Current signed Release/package audit passes; exact-device delivery/readback and real camera acceptance remain pending. The final DEBUG camera fixture simulates capture/startup/measurements and preview controls; real preview graph/video requires physical acceptance. Device crash inventory contains nine older October7–10 reports, with no current Build15/October12 camera crash stack. Unsupported empty-graph attempts and their failures remain in QA.

- **B169 — physical camera preview toggles crash/freeze (OPEN; source hazards repaired, physical acceptance pending):** Christian identifies Show camera preview on installed Build15. Baseline main-thread preview session/connection changes overlap synchronous capture start/stop; synchronous `.main` capture notifications can create a circular wait. Stop releases capture ownership before actual shutdown, allowing competing sessions. Build16 queues preview/capture together and retains ownership through shutdown. Native tests exercise nonblocking notifications and delayed teardown. No current crash stack establishes the exact physical crash cause; live video/preview toggling still requires physical acceptance.
- **B170 — visible face rejected and every gesture disabled (OPEN for physical acceptance; source repair):** baseline requests only landmarks, turns absent pitch into NaN, then requires finite pitch/yaw/lips for every gesture. It also globally rejects smaller faces and normal dim conditions without explaining which metric failed. Build16 requests pose explicitly, calibrates metrics independently, exposes availability/reasons, recognizes nod in either direction and adds mouth/eye inputs plus customization. Core32 targeted cases pass; real-camera accuracy remains unaccepted.

**Next steps:** guarded personal-iPad delivery under the ongoing repair request, with fresh idle backup, actual helper artifact audit, complete-file preservation and launch/readback. Confirm actual live preview on/off, calibration and expression commands at piano distance separately. Keep the friend held. Full evidence: `docs/qa/ios/2.0.0/build16/README.md`.

## October 12 — Build15 installed on the personal iPad

**Last updated: 2026-10-12. Personal iPad: native2.0.0/build15/schema5 installed, user-opened and observed running; post-launch library exact. Friend iPad: last verified build12/schema5, still held. Mac v11.1.0/schema21 unchanged.** Christian explicitly requested last night's verified Build15 on the plugged-in personal iPad, lifting the earlier no-install hold for this target only.

Guarded same-bundle refresh from source `68d667f` / `ios-v2.0.0-build15-device-validation` passes exact target readiness, signing/profile inclusion, installation and complete-file preservation. All241 source hashes match the verified checkpoint. Private backups `20261012T162528Z-6f0225cd` and `20261012T162604Z-92f7b475` retain all13 files/19,420,130bytes exactly by filename/size/SHA-256. Ledger remains schema5/revision3423, with6 pieces/77 passages/73 historical sets/46 sessions/534 ink records/20 stamps/5 notes and a completed active-slot set. No running set was interrupted and no uninstall/reset/restore/termination occurred.

The helper rebuilt Release for this device; actual executable SHA-256 is `e176ae5ad22e32766d665127791b9984f12d02e54134ce26de228af1560f88ea`, distinct from the earlier generic package. Independent full-file/record, strict signature, signer trust, entitlement/profile, exact target,65-marker absence, resources and matching arm64 dSYM checks pass; profile expires2026-10-17T16:14:24Z. iOS declined automatic launch after successful install/preservation; the first read-only process check finds no running Praelude. Christian then confirms opening; the next read-only process query observes Praelude running. Complete post-launch backup `20261012T163008Z-91208583` retains all13 files/19,420,130bytes exactly, including unchanged schema5/revision3423, every original record, score, annotation, profile/privacy and preference. No migration occurs. No Mac import or physical Pencil/speech/camera/click/sustained-practice acceptance is claimed. Evidence: `docs/qa/ios/2.0.0/build15/personal-ipad-install.json`.

**Next steps:** use Build15 on the personal iPad; physical Pencil/speech/camera/click/sustained acceptance remains separate from this verified install/open/readback. Keep the other iPad held. Earlier preparation/hold and failed verification records below are historical; their evidence and physical-acceptance limits remain intact.

## October 11 — build15 follow-up; explicit no-install hold

**Current source: native2.0.0/build15/schema5; Build15 prepared for controlled device validation; installation HELD. Both iPads remain last verified installed at build12/schema5; Macv11.1.0/schema21 is unchanged. Last updated:2026-10-12.** All authorized affected UI, independent live and package gates pass, with zero current scoped simulator failures. Physical acceptance is separate. Neither iPad was queried, installed or operated; the explicit user no-install hold remains binding. Final18’s failed record is retained below.

**October12 affected-flow checkpoint:** final19 (app `8e533681…`, plugin `ff6e9a1b…`) finishes3 UI cases:1 pass/2 fail. The44pt Edit-padding/name/112.5-goal/Save/process-relaunch flow passes94.063s. Zoom fails70.791s with its resize cause proved: height927→901pt, minimum1.076655→1.046458 and scale2.433236→2.364990, while relative zoom stays2.259996; all other postconditions pass. Source preserves absolute manual zoom for height-only changes, excluding explicit refit, width/rotation and automatic short-landscape fitting. The passive20-launch tap diagnostic fails290.722s on launch14 after13 passes: the correct-center touch is received and allowed at began, but no `shouldBegin` or action follows; the coordinator remains healthy. Final20 passes4/4: actual zoom64.577s preserves absolute2.433236 before/after despite927→901pt, mounted height0.123s, existing landscape0.022s, and forwarding-lifecycle20 success395.020s. Final21’s original UIKit plus existing window trace completes20 actual executions, all passing (summary:1 unique aggregated case); all touches complete and none cancel. Final22 (app `f18c220c…`) captures launch3 began→cancelled in173ms before UIWindow forwarding, with an active key window and no ended touch. Matching simulator unified logs independently confirm the cause of three specific no-ops—final18’s fifth launch (PID4733), final19’s launch14 (PID8044), and final22’s launch3 (PID11364): testmanagerd’s Recap virtual digitizer disappears while contact remains touching/locked, then BackBoard soft-cancels one contact. These are harness input-transport failures; a production fallback on cancelled touches is not warranted. Earlier no-ops and physical behavior remain unproven. Final23 completes PASS (exit0;2 cases/0 failures/0 skips):20 passive-window delivery fresh launches424.045s and10 untraced native-UIKit fresh launches200.221s, using one120ms same-center contact without retries. The20 receipt rows contain20 began/20 ended/0 cancelled and one retained direct-ended touch each; the10 normal launches have protected-state receipts. App `f18c220c…`, plugin `bd8fbee…` and all241 compiled/installed source hashes match. No production gesture fallback was added. Independent live final24 now PASSES: normal Today→Sidebar/Pieces/card navigation, one-center Evenness arm, first-click lower44pt Edit padding, typed name/112.5 goal Save, Focus enter/exit retaining page/selection, and Close/new-PID relaunch→Passages Edit exact-name/goal reopen; Cancel and picker Close work first-click. The full union comparison changes only intended passage title/performanceTempo112.5/updatedAt plus revision7→8; every other record, PDF and artifact is exact with zero activity. Its independent one-real-pinch/pan/arm case passes70.062s (all16 predicates true), preserving absolute scale2.4332361227405377 exactly across927→901pt. Manual rotation changed only control casing and is not a manual Landscape pass; final18 actual rotation179.912s and current native height/landscape passes retain separate scope. Report: `independent-live-final24.json`. All authorized affected UI, independent live and generic Release/package gates now pass. Build15 is prepared for controlled device validation; installation remains HELD and both iPads untouched.

**Release/package gate PASS:** generic Release exits0 with all241 current source hashes matching. Executable SHA-256 is `b3c21602064f27282cf40e0d04f79a2445d6dae2424f179cb6fe4a9c2742f4f8`. Root29 signature checks and independent40/40 checks pass:65 DEBUG/test markers absent, two fonts exact, matching arm64 dSYM,13 bundle files and3 dSYM files. Profile expiry is2026-10-17T16:14:24Z. The ignored archive `releases/ios-build15-verified-20261012` includes zipped app/dSYM with extracted full-inventory readback exact and `installHold=true`. Evidence: `release-signature-final23.json`, `release-independent-final24.json`, `release-package-final23.json`.

**Checkpoint identity:** root will create `ios-v2.0.0-build15-device-validation` after commit as the fixing checkpoint for B165’s44pt Edit target and absolute-height zoom repair. The original `ios-v2.0.0-build15-candidate` tag remains the immutable failed-final18 checkpoint; no failed evidence is replaced.

**Explicit user install hold:** do not install on either iPad until Christian lifts this hold. Candidate readiness and the standing immediate-install preference do not override it.

**Final18 bounded historical verification (frozen app `0cfc8689…`; latest results are final19/20/21 above):**316 tests total:313 passed,2 failed,1 live-account skip. Native308 has307 passes/1 skip/0 failures (15.960s); eight actual UI cases finish6 pass/2 fail. This is a failed verification run, not readiness or physical acceptance.

| Result | Actual verification scope | Time |
| --- | --- | --- |
| Pass | Ink/Undo/new branch/save/process relaunch/reopen | 86.400s |
| Pass | Eight selected-box double-tap/Cancel cycles, triple-tap and ordinary edit | 167.412s |
| Pass | Rotation, Sidebar, focus and saved ink | 179.912s |
| Pass | New Text Dictate/Cancel and score-voice return | 80.870s |
| Pass | Ordinary Voice Check/Back | 112.620s |
| Pass | Saved-note Dictate/Cancel, restored owner, unchanged note text and fresh Clean | 106.990s |
| Fail | Normal ten-launch single-tap stress: first four pass, fifth remains Whole piece | 105.004s |
| Fail | Zoom combined predicate: correct passage is armed; final absolute-scale assertion fails | 69.327s |

**Final18 failure evidence (historical snapshot; retained unchanged):** on launch5 the actual Evenness target remains absent and Whole piece unchanged, so the all-saved-region routing repair (`74e757…`) is insufficient and B155 remains open. The zoom snapshot satisfies the armed-state and preceding checks, but lacks the full failed value. Pre-arm scale is2.433236/minimum1.076655 with viewport927pt; failed AX viewport is901pt. These partial readings do not prove a fit-ratio explanation, tap no-op or production zoom defect; complete zoom acceptance is not established.

**Final18 bounded stop (historical; superseded by the resumed final19/20/21 work above):** physical microphone recognition, camera gestures, Pencil, audible click and sustained practice; fresh manual verification of the latest source; and current build15 signed Release/package validation. The armed-passage pencil’s9.5×9.5pt accessibility target (B165) remains unrepaired and its padding behavior untested. The uncompiled44pt target repair, padding test, passive20 and full-capture additions were withdrawn and reverted to exact final18 source; all241 source hashes match. None was built or accepted. No final19 build/run, further manual/package run or installation will be represented as completed.

**Current physical/historical limits:** physical microphone recognition, camera gestures, Pencil, audible click, sustained practice and real-device OS behavior remain unaccepted. No manual Landscape-rotation pass is claimed; final18’s actual rotation179.912s and current native height/landscape checks retain separate scope. Final23’s30 fresh launches and final24’s live Edit/save/relaunch and real-pinch/pan/arm checks pass. The three matched historical failures are explained as harness transport cancellation; unmatched earlier no-op causes remain unproven. Package validation does not establish exact-device inclusion or physical feature acceptance.

**Earlier passes retain their scope:** passage dictation Cancel with prior unmuted/muted/Off state, Picker no-resume-until-Close, typed Save/reopen/fresh Clean, supported Undo, End/Cancel, first-attempt click and prior Sidebar repeats remain their recorded simulator checks. They do not erase the current B155 failure or establish physical recognition. Current result: `docs/qa/ios/2.0.0/build15/README.md`; full retained history: `docs/qa/ios/2.0.0/build15/functional-flows.md`.

**Current flaw dispositions (unshipped candidate; prior evidence retained below):**

- **B155:** scoped cause established for final18 launch5, final19 launch14 and final22 launch3: matched Recap-digitizer disappearance/BackBoard soft-cancel logs prove harness input-transport cancellation. Final22 records began→cancelled173ms before forwarding, with no ended touch. Final23’s one120ms same-center/no-retry contact passes30 fresh launches:20 window deliveries (20 began/20 ended/0 cancelled) plus10 untraced native-UIKit launches with protected-state receipts. No production cancelled-touch fallback was added. Independent live final24 now passes actual navigation/one-center arm/Edit/save/relaunch and the real-pinch/pan/arm check; its full union comparison finds only intended passage fields and revision7→8 changed, with every other record/artifact exact and zero activity. All current authorized scoped simulator/live/package gates pass. These named harness failures are explained and the affected tests accepted; unmatched historical no-op causes and broader physical reliability remain unproven. Original failures are retained, and both iPads remain on the explicit no-install hold.
- **B160:** recovery-control placement has scoped simulator passes; physical acceptance is untested.
- **B161:** asynchronous audio-notification handoff is implemented and native checks pass; physical audio behavior is untested.
- **B162:** mute/stale-input guards have scoped checks; physical recognition is untested.
- **B163:** actual ordinary Back and recorded End/mute checks pass within their tested scopes; this is not every-modal or physical acceptance.
- **B164:** armed-start tempo/allowed Next has its recorded simulator pass; audible click is untested.
- **B165:**44pt Edit target repair is simulator/live accepted: final19 lower-padding/name/112.5-goal/Save/process-relaunch passes94.063s, and independent final24 first-click padding/Save/relaunch/reopen passes. Fixing checkpoint is the planned post-commit `ios-v2.0.0-build15-device-validation` tag. Organizer/review/Today passes and the final18 unrepaired snapshot remain retained evidence; physical Pencil use remains unaccepted.
- **B166:** supported Undo refresh and two Clean→voice Undo cycles retain their native/injected-final passes; physical speech is untested.
- **B167:** active-practice End placement and actual End/Cancel have their recorded simulator pass; physical recognition is untested.
- **B168:** reached passage/picker/new-note/saved-note ownership-return checks pass. Saved-note text is unchanged and a fresh Clean succeeds; broader physical recognition remains untested.

**Next steps:** maintain the explicit user no-install hold on both iPads. No further diagnostics or tests are needed unless a concrete new failure appears or Christian authorizes controlled device acceptance. Preserve the verified package, original failed checkpoint, scoped evidence and physical-acceptance limits; no device operation is authorized by this preparation.

## Earlier October 11 — build15 intermediate verification checkpoints (historical)

**Historical checkpoint record:** the following text preserves the earlier Build15 status/evidence exactly. Its then-pending plans are superseded by the finished final18 result above; they are not commitments to further runs or source changes.


**Current source: native2.0.0/build15/schema5; diagnostic and functional follow-up in progress. Both iPads remain last verified installed at build12/schema5; Macv11.1.0/schema21 is unchanged. Last updated:2026-10-11.** Christian asks to fix taps that do nothing and finish testing actual flows, continuing until ready. B155’s cause remains under investigation; no tap-fix or readiness claim is made.

**Explicit user install hold:** do not install on either iPad until Christian lifts this hold. Candidate readiness and the standing immediate-install preference do not override it.

- **B160 — Hands-free recovery controls are buried below command examples (source change; verification pending).** The audit reaches Hands-free but cannot find the recovery error in its initial unscrolled viewport. Build15 moves recovery controls above the examples so error, permission and enable/mute actions are immediately reachable. The pre-B166 combined and manual flows reach visible initial recovery; final-source verification remains pending, and this does not explain B155’s earlier no-op taps.
- **B161 — synchronous audio notifications can deadlock the main queue (source risk repair; verification pending).** Metronome notification delivery on the main queue can meet a synchronous main-actor handoff and wait on itself. Build15 makes delivery asynchronous through the existing handoff. This is a concrete deadlock risk found in source, not a traced cause of the historical B155 failures. Final1 native checks pass below; physical audio acceptance remains separate.
- **B162 — mute can leave stale recognition or staged audio eligible for delivery (source repair; verification pending).** Build15 retires pre-mute partial/final callbacks and staged audio when mute changes, retaining capture for the existing listening session. Final1 native checks pass below; final9 passes prior-mute restoration, rejected Clean while muted and explicit Unmute. Final10 also passes prior mute/explicit Unmute with the owner-handoff repair; broader physical acceptance remains separate.
- **B163 — score voice ownership and modal guards need complete coverage (source safeguards; scoped UI passes, remaining verification).** Commands can otherwise change score practice history while customization/checks or other modal flows are open. Build15 adds a root-visible gate plus dispatch guard and extends score/camera command/context gating to system confirmations/errors, import/export, switching, discard/conflict dialogs, Quick Actions and inactive scenes. Voice-check recovery snapshots and reapplies the prior score voice state, including mute, with capture-ownership and deferred restoration guards. Final9 passes full nested gating and prior-mute restoration, but actual ordinary Back leaves Voice Off in an owner-release race. Pending-return retention/owner-ID observation with explicit-Off/exit/background cancellation is repaired in source and parse/review passes; final10 actual ordinary Back, prior mute/Unmute and End/Cancel checks pass with injected finals and tracing off. The separate passage-dictation Cancel failure is proved as B168; its repair source is frozen and final13 passes the reached passage/picker matrix, and final18 passes the new-note path; existing saved-note coverage remains pending. The real End-confirmation regression uses a test-only queued final-recognition batch.
- **B164 — voice/Space first-attempt Metronome can use retained tempo (source repair; verification pending).** An armed first attempt must start the click at its chosen start BPM. Build15 uses the armed start BPM for voice/Space preview instead of a previously retained tempo. The pre-B166 first-attempt UI case passes61.369s. Context-final2 voice first-attempt UI passes42.320s, using armed60 BPM instead of retained90 BPM and stopping without grading; audible physical acceptance remains separate.

- **B165 — passage organizer Edit exposes an undersized accessibility target (source repair; verification pending).** The intermediate untraced ScoreFocus Today passage-names case fails16.971s at line123 on the stale `Rename ` selector after the label changes to `Edit name and goal for`. The failure hierarchy confirms the organizer opened and reports a13.5×13.5pt Edit button despite its44pt image. Organizer and analogous review Edit labels now receive an explicit44pt content shape and plain style. The completed pre-B166 batch passes corrected organizer/review44pt padding checks; final-source verification remains pending. No prior padding attempt was made; this is an observed small target, not a demonstrated padding-tap failure or a proved cause of earlier B155 no-ops.
- **B166 — first verdict can leave supported voice Undo stale (source fix; native/actual Undo UI pass, delivery checks pending):** start an ungraded set and enable voice before the first Clean. The actual verdict records an attempt, but supported Undo does not refresh until an unrelated sheet, status or ID transition. Source now observes `hasUndoableAttempt` and refreshes context synchronously after recording or voice Undo. The final source now skips recognition renewal for a same-token Undo-only action-set delta, retaining capture and staged audio so the first Clean context refresh does not discard a successive, properly separated verdict. Other semantic context changes still renew recognition. Final1’s 308-case native suite passes with 1 live-account skip and 0 failures in 16.566s, including the two new regressions. The actual two-cycle touch Clean→voice Undo case passes60.509s with Undo-availability and raw-ledger assertions. Context-final2 later passes first-attempt tempo/stop with three cases failing before their intended actions; repaired settings/confirmation checks, release and physical acceptance remain separate.
- **B167 — End practice was buried beyond the visible menu (source repair; actual End/Cancel passes, delivery pending):** source moves the existing End action into the first Current practice section only while practice is active. Final9 fails57.856s in the fixture: the fully visible 224pt End row is rejected by a 214pt inset viewport, then an unnecessary drag dismisses the menu. Sanitized geometry evidence is `docs/qa/ios/2.0.0/build15/end-final9-geometry.json` plus its PNG. Final10 actual End/Cancel and confirmation protection pass89.430s with injected finals and tracing off; physical speech recognition remains separate.
- **B168 — Cancel after passage dictation does not restore prior score voice (source repair; passage/picker/new-note pass, saved-note scope pending):** matched baseline app `41a…`/runner `cce279…` fails `testPassageDictationCancelRestoresPriorScoreVoiceAndPracticeContext` in 63.117s. With score voice enabled, actual HUD-name double tap opens ordinary Rename; actual Dictate takes editor capture ownership, then actual Cancel returns to the visible score without restoring prior ownership/listening. Evidence: `/tmp/praelude-build15-dictation-final11.log` and QA `newdictation-final11` summary/provenance. Final13 later accepts reached passage/picker flows and final18 reaches New Text; saved-note and physical coverage remain pending.

**B163 ownership and modal safeguards under verification:** final9 passes the full nested gate/Voice Check/Done case and prior-mute restoration/reject-Clean/explicit-Unmute case, but ordinary Back leaves Voice Off in a real owner-release race (107.976s failure). The source repair retains pending return until the owner releases, observes owner-ID changes, and cancels restoration on explicit Voice Off, exit or background; prior mute is preserved and ownership is not stolen. Final10 passes actual ordinary Back (105.815s), prior mute/explicit Unmute (170.141s) and End/Cancel confirmation protection (89.430s). It uses injected recognition finals with tracing off, so this is scoped simulator acceptance. Existing score/camera modal/context dispatch gates are unchanged from final9; broader ownership and physical verification remain separate.

**Intermediate UI evidence, not latest-source validation:** the untraced `/tmp/praelude-build15-final` combined case fails34.025s at the goal-enabled coordinate tap with the keyboard open. Direct rename/112.5 goal/save/reopen passes96.799s, camera passes146.305s and first-attempt controls pass67.385s on that same intermediate compiled source. The failed tap has no event trace; its cause and the earlier B155 no-op cause remain unproven. These scoped passes do not establish readiness.

**Later intermediate UI evidence:** all seven untraced TapDelivery cases pass, covering eight review open/Done cycles, camera Done/reopen, sidebar, card padding, grid and Passages. Eight selected-box double-tap/Cancel cycles followed by triple-tap and ordinary dock editing pass in 215.496s. These runs precede the latest source safeguards and do not establish B155’s cause or candidate readiness.

**Stopped intermediate run:** the untraced run was stopped at the XCTest keyboard-animation wait (status143). Twenty UI cases completed:18 passed and2 failed;0 native tests ran. Its xcresult is incomplete, so it is not an overall pass. The app appeared responsive during the wait; this observation does not establish an app freeze or measured responsiveness. The unnecessary placeholder deletions prompted test changes.

**Completed pre-B166 batch1:** `/tmp/praelude-build15-flows-latest.xcresult` runs nine UI cases with normal flags on pre-B166 binary `78ffecee`:4 pass and5 fail. Passes are full combined rename/goal/dictation/ordinary-edit/attention→initial-recovery (147.951s), first-attempt controls (61.369s), urgent flow plus44pt review Edit padding (28.898s), and Today44pt organizer Edit padding plus rename without Practice (23.848s). Core451 (1 skip) and native306 (1 skip,0 failures;17.927s) also pass before the Undo extras. These results do not validate final B166 source.

**Earlier four voice-context cases stop before their first action:** failures at13.320–21.382s occur at the combined PDF hittability/full-containment guard; their exact cause is unproven despite rounded frames looking contained. The stronger fixture records17-digit frames and individual guard booleans, waits for a stable full page with0.5pt boundary tolerance, and makes one fixed-center tap while retaining the actual armed-state postcondition. Final1 passes the Undo case using this fixture; the subsequent context-final2 result is recorded below. The earlier guard failures do not test the intended voice-context protections.

**B155 historical alias focus failure retained; stronger flow passes:** the placeholder change avoids the old keyboard wait, but the earlier alias case fails55.151s because tapping the first field leaves focus in the third and typing reports no focus. Final1’s full alias customization passes132.807s with a helper that records the settled exact target and waits for focus without retrying. No production alias-focus patch was made, and the historical failure cause remains unproved. Independent CUA alias reproduction was not reached after a tool-generated8ms drag; no production scrolling failure is established.

**Scoped manual pre-B166 evidence:** one-click Sidebar/Pieces/card opening, Performance exit and badge→visible Recovery pass. The two seeded files and full library JSON remain exact. That manual flow does not establish alias focus or explain B155.

**Final1 verification checkpoint (310 tests total):** native308 (1 live-account skip,0 failures;16.566s), actual two-touch-Clean→voice-Undo cycles (60.509s) and full alias customization with the stronger fixture (132.807s). A fresh verifier confirms only in the final1 snapshot that `page.minY = 85.999999999999943` is below `score.minY = 86`, so strict containment is false while tolerant containment is true. This does not assign the causes of the four earlier guard failures retroactively.

**Context-final2 completes with 1 UI pass/3 pre-action failures (exit65):** the voice first-attempt click uses armed 60 BPM rather than retained 90 BPM and stops without grading (42.320s). End-practice fails74.391s because the helper uses AX menu content 1180pt tall inside an actual 520pt popover; its requested row at826–864 is clipped. Nested customization (44.707s) and mute/check (52.491s) fail before Customize/Check because the CollectionView container reports `isHittable = false` despite visible Enable/Mute children. Visible-viewport and child-scoping test corrections are underway; no production fault or acceptance of the settings/confirmation paths is established by these failures.

**Normal-final3 completes 17 actual UI cases:16 pass/1 fail (exit65; same final1 binary `96c291`).** The independent ink-location case passes branch bounds, Undo/Redo, Done/Save and Close. After a real process relaunch with a new PID, the actual Show Sidebar center tap at (32,54) at 62.87s leaves Today unchanged; the case fails73.594s. B155 is a current open no-op-tap defect, not merely historical. This case does not pass ink reopen. Summary: `docs/qa/ios/2.0.0/build15/normal-final3-summary.json`.

**Separate final3 passes:** the Gesture case passes actual draw→Undo→new branch, real pinch, save and reopen in70.881s. All seven TapDelivery cases pass, including eight review cycles and standalone Sidebar/camera/card-padding/grid/Passages. Selected passage eight double-tap/Cancel cycles pass168.357s; all four ScoreFocus cases pass. Combined flow passes147.444s, first click58.725s and urgent flow26.738s. These scoped passes do not close the post-relaunch Sidebar failure.

**Additional B165 scope: traced final4 Today session-card Edit passes 53.575s.** The observed 13.5pt target now has 44pt inside its button label. Actual lower-padding hit, name plus112.5 goal Save, relaunch and reopen pass in `/tmp/praelude-build15-today-final4.xcresult`. Retained actual-process traces prove this run used trace flags despite no NSLog output; it is not a normal-flags pass. An independent raw comparison finds only the target passage’s name, `updatedAt` and new `performanceTempo = 112.5` changed among passages; performance tempo was absent at baseline. The other passage is unchanged, and sets/attempts/sessions/coldGrades remain zero. Reward/revision startup differences are separate; a union-key audit remains underway.

**Earlier compiled-app scope:** final4 SHA prefix `2e6cbc…` differs from final3’s `96c291…` because of the Today44pt label repair and DEBUG-only diagnostics. Earlier passes retain their recorded binary and trace scope.

**Final7 checkpoint:** native308 passes with 1 live-account skip/0 failures in16.595s. Normal Today repeats the44pt lower-padding/name/112.5 goal/save/relaunch/reopen/no-practice flow and passes51.188s. The low-perturbation traced independent ink/new-branch/save/real-process-relaunch/reopen case passes86.907s. At that checkpoint the32-cycle/4-launch and original normal repeat remained pending; final9 results are recorded below and do not establish the historical causes.

**Final6 diagnostic limit:** the initial Sidebar `TouchCancelled` observation included 591ms of cold reflection before forwarding the touch. That diagnostic perturbation prevents using the observation as a production causal explanation. No B155 root cause is established.

**Final8 voice-context progress, not acceptance:** actual navigation reaches Voice Check and Clean count1. Tests then fail because the fixture expects value1 while accessibility exposes a merged Clean/count label. All three assertions are corrected to the exact merged label with full protected-state equality; no production counter failure is established. Final9’s corrected nested/mute results and separate ordinary-Back race are recorded below.

**Final9 checkpoint (app `2b116…`, runner `aa2…`):** native308 passes with1 live-account skip/0 failures in16.779s. Six actual UI cases finish with 4 pass/2 fail. Passes are normal independent ink/save/relaunch/reopen (82.450s), native Sidebar32 Show/Hide cycles/64 single taps across4 launches (435.694s), full nested gate/Voice Check/Done (268.090s), and prior mute restored/reject Clean/explicit Unmute (175.255s). Failures are the End fixture geometry above (57.856s) and actual ordinary Back leaving Voice Off (107.976s). This does not prove the earlier intermittent B155 causes.

**B155 app-owned path has scoped stress acceptance:** regular iPad uses app-owned 44pt Show/Hide controls that write the split-view binding directly; compact layouts retain native controls. Initial display and Close select detail-only without a score checkpoint or identity reset. Normal final12 passes 64 fixed-center single taps/32 cycles across 4 real process launches (450.429s) and the original normal independent ink/Undo/new-branch/save/Close/process-relaunch/reopen case (77.545s). Final18 actual rotation/Sidebar/focus/saved ink passes179.912s; historical native-control causes remain unproved, and compact-layout/physical acceptance remains pending. This is acceptance of the narrow owned path, not overall readiness; final13 later reproduces separate saved-box arming no-ops.

**Final10 passes 311 tests total including 1 live-account skip:** native308 has 0 failures in16.283s; three actual UI cases pass—End/Cancel89.430s, ordinary Back105.815s and prior mute/explicit Unmute170.141s. Matching app `41a1c1a…` and runner `fe5f77…` run without tracing and with injected recognition finals. The binary includes the app-owned Sidebar source; its later stress/ink result and pending rotation are recorded below. No signed build15 Release, commit or installation has occurred; independent live and physical verification remain pending.

**B168 source frozen; passage/picker/new-note checks pass, saved-note scope pending:** ScoreWorkspace source hash prefix `11ec…` captures specific prior opt-in/mute state before presenting direct passage dictation, existing/new note dictation or PassagePicker. Restoration requires the editor closed, a free owner, unobstructed presentation and the same score; explicit Off, exit, background or End cancels it. Final13 passes direct unmuted/prior-muted/originally-Off Cancel, Picker Cancel without resuming until Close, and armed Dictate/Finish/typed Save/reopen/fresh Clean. Final18 reaches New Text Dictate/Cancel and passes80.870s, plus ordinary Voice Check/Back112.620s. Existing saved-note ID/text/fresh-Clean coverage is still pending; earlier passes retain their scope.

**Final13 full run (app `b7199ec…`, runner `0925fb…`, ScoreWorkspace `11ec…`):** 318 tests total:314 passed,3 failed,1 live-account skip. Native308 has0 failures/1 skip;10 actual UI cases finish7 pass/3 fail. Passes are independent ink/new branch/save/relaunch (87.659s), armed Dictate/Finish/typed Save/actual reopen/Start/fresh Clean (101.809s), direct unmuted Cancel (60.316s), prior-muted Cancel (106.142s), originally-Off Cancel (57.257s), Picker Cancel/no resume until Close (73.715s), and armed60-versus-retained90 click plus allowed bare Next (50.962s). Summary: `docs/qa/ios/2.0.0/build15/functional-final13-summary.json`.

**B155 saved-box failure history retained; hardening partly verified:** final13 New Text (21.905s) and ordinary Back (22.263s) fail at the actual initial single fixed-center saved-box arm; Whole piece remains unchanged before voice. These failures do not reach dictation or Voice Check/Back. Their cause is untraced; later unchanged-code passes do not close them. New routing hardening reaches New Text and ordinary Back in final18; ten-launch stress remains pending. Owned Sidebar stress remains a separate narrow pass.

**Rotation fixture history; final18 actual case passes:** final13 fails84.762s before rotation because its saved reading baseline wrongly expects PDFKit markup=false, although markup remains true for the overlay. The corrected reading predicate uses actual Annotate/Exit Focus controls and no Done. Final14 then reaches actual landscape Sidebar, focus and portrait, but fails136.508s on a fixture expectation for a hidden page indicator. The corrected fixture uses DEBUG actual PDF currentPage1 in all modes and the visible indicator while reading. Final18 subsequently passes actual rotation/Sidebar/focus/saved ink179.912s; these older failures do not establish a production rotation defect.

**Final14–17 repeat scope:** final14 diagnostic passes all stages in 17.222s. Four final15 full-trace runs pass17.003/17.668/19.355/18.206s; four final16 passive runs pass24.020/19.790/17.218/18.775s without swizzling, gesture-target additions or file logging, with the same recorded baseline hash. Final17 passes ten normal, untraced fresh-process single-center arm attempts in 215.627s on unchanged code. Neither the traces nor these repeats explain or close final13’s two normal no-op failures.

**B155 routing hardening frozen; final18 partly verified:** ScorePageOverlay source prefix `74e757…` routes reading-mode finger touches on any visible saved region through the existing app overlay, extending the previous selected-only route. Existing Pencil/nil-touch, note, read-only, hidden/crop and quick-edit/break guards remain; recognizer priorities are unchanged and actions are not duplicated. Fresh source review accepts the narrow change and the native guard matrix is updated. The exact historical cause remains unproved; final18 reached flows pass below, while all-saved-route ten-launch stress remains pending.

**Interim final18 (frozen app `0cfc8689…`):** original ink/relaunch passes86.400s; eight selected-box double-tap/Cancel cycles plus triple-tap/ordinary edit pass167.412s; actual rotation/Sidebar/focus/saved ink passes179.912s; New Text Dictate/Cancel passes80.870s; ordinary Voice Check/Back passes112.620s. Saved-note, ten-launch arm stress and native308 remain pending. These are scoped passes, not an overall suite or readiness pass.

**Final18 zoom combined-predicate failure (69.327s) remains unclassified:** the snapshot shows the correct Evenness passage armed with cold-grade controls, and queries reach the last absolute-scale condition. Exact scale readouts are still needed; a fit-relative zoom/resize fixture issue is one possibility. This failure does not establish a tap no-op or production zoom defect.

**Additional B165 scope; final19 padding test pending:** the armed-passage pencil exposes a 9.5×9.5pt accessibility target. A narrow repair puts 44pt and a Rectangle content shape inside its label (source prefix `d20340ac…`); a new actual padding test (prefix `4ea007…`) awaits final19. No actual padding acceptance is claimed yet.

**Candidate remains NOT READY:** remaining actual saved-note/ten-launch/native checks, zoom readouts, final19 padding, fresh live/manual verification and generic signed Release/package gates are pending. No build15 commit or installation is claimed; both iPads remain installed12 under the explicit hold.

**Final12 normal checkpoint (frozen app `41a…`, runner `cce279…`):** three actual UI cases finish 2 pass/1 pre-rotation fixture failure. Owned Sidebar stress passes450.429s and original independent ink/relaunch/reopen passes77.545s. Rotation fails86.064s before any rotation at the saved-PDF baseline because the TextView title is an accessibility value, not a label. The corrected fixture retains every original score/page/ink/source-bounds/mode/no-practice check and attaches complete predicate diagnostics; actual rotation remains pending.

**Delivery remains in progress:** no build15 Release, commit or installation has occurred. Independent live verification, generic signed Release and physical acceptance remain pending. Simulator checks do not establish physical speech recognition accuracy.

**Next steps:** finish final18 saved-note/ten-launch/native gates, obtain exact zoom readouts and execute final19 actual pencil padding, then finish preservation, fresh live/manual verification and generic signed Release/package checks. Retain the interim passes and zoom failure alongside final13’s7-pass/3-fail result and all earlier evidence; historical causes remain unproved. B155 hardening is partly verified, with ten-launch stress pending; B168 saved-note and physical coverage remain pending. Keep both iPads on the explicit user no-install hold until Christian lifts it; the candidate is NOT READY.

## Earlier October 11 — functional audit and build14 follow-up

- **B159 — ordinary rename inherits earlier passage dictation (source repair; functional check pending).** Source review confirms region triple tap leaves dictation intent true after Cancel/Save; direct dock/menu/running-HUD rename reuses it. Build14 routes all four entry paths through an explicit per-presentation helper, defaulting ordinary edits false, and clears intent on dismissal. Independent source review accepts this. Baseline live attempts stop before the score on navigation failures; no live reproduction is claimed. Fresh4 reaches triple→permission denial→Cancel→ordinary double tap; the editor is clear, but a global test query matches the underlying score caption. Fresh6 saves a dock-name/108.5 goal, then fails to open box editing, so the corrected combined regression and final neutral-error flow remain unaccepted. Final native304/1 live-account skip pass; generic signed package passes. Build13 is held from delivery; build14 is not installed.
- Additional review pixels/AX confirm the correct2 due count, overdue/due-tough URGENT labels and future Tough scheduledOctober13 without URGENT. Fresh9 queue opening fails despite a centered reported-row tap; fresh10 sidebar opening also fails. B155 remains unresolved. Evidence: `docs/qa/ios/2.0.0/build13/functional-audit.md`, `docs/qa/ios/2.0.0/build14/functional-follow-up.md`.

**Next steps:** diagnose B155 opening/box-edit reliability and complete the combined regression; retain every failure. Build14 is held despite native/signature passes. Physical speech/camera/Pencil/click/sustained acceptance and B155 remain open. No bug-free assurance.

## October 11 — build13 new acceptance boundaries

- **B156 — camera gesture reliability (open).** Optional local camera mappings/calibration/preview/light/context guards are implemented. Fresh review finds failed recalibration could retain an old baseline; repaired before release with a success→failed recalibration regression and explicit dispatch gate. Actual mapping, luminance thresholds, rotation, nod/shake/grin discrimination and false-action rate at the piano remain unaccepted. Do not promise perfect recognition.
- **B157 — tough Learning passages hidden from due count (source repair; physical open).** Today/session builder previously excluded Learning even after a Missed report scheduled a review. Build13 unifies factual due/tough priority, shows saved dates/reasons and marks overdue/due tough passages URGENT; future tough due dates remain future. Six core regressions and actual Missed→upcoming Tough/save/relaunch UI pass. Additional synthetic Today pixels/AX confirm overdue/due-tough URGENT and future Tough correctly nonurgent; All passage reviews opening fails under B155. Physical retention remains open.
- **B158 — first-attempt click toggle changed draft but produced no sound (source repair; physical sound open).** Build13 starts/stops actual idle metronome playback and cleans up previews without stopping newly started set audio. Actual audible click on iPad remains pending.


## October 10 — build12 installed; repairs not yet physically accepted

- **B149 — score focus/controls/page-navigation friction (open).** The reported focus counter, controls position, white-margin turns and page delay have implemented build12 repairs. Native unique-page timing/correctness and iPad focus/position/gutter UI pass; physical timing/acceptance remain pending.
- **B150 — drawing resurrection/sequential history/brush scale (open; exact build12 recurrence reproduced).** Source trace finds history eviction on PDF overlay detach and coalesced pending Undo/Redo; PencilKit also clamps oversized raw widths. Candidate repair preserves bounded page history and uses canonical canvas sizing; native width/history/race checks and actual simulator Undo/Redo/pinch/save/relaunch pass; physical Pencil acceptance remains open. October11 feedback confirms Undo→new draw resurrection on installed build12. A new live simulator regression reproduces1→0→2 before saving. Build13 replaces the native canvas at Undo/Redo; actual repaired branch through pinch/save/relaunch passes, with physical Pencil acceptance still open.
- **B151 — command access, recognition and customization (open; build13 recovery candidate).** Candidate context/confirmation/aliases/diagnostics do not prove commands over piano on an iPad. New feedback reports repeated Clean unresponsive and lingering red/off state. Source identifies stop-on-temporary-error and capture gaps during finalization; build13 adds bounded recovery, buffered handoff and final-only repeated-verdict guards. Build14 removes the remaining long red score error, replacing it with a neutral mic attention indicator that opens Hands-free details/recovery. Physical recognition over piano remains unverified.
- **B152 — practice-history dimensions and measure-map usability (open).** Inspected records lack full-tempo references/per-event hand capture and have zero measure anchors. Implemented additive fields/views preserve provenance; core/native and iPad full-tempo/quarter-speed/sparse-signal UI pass. Host scanning opens five actual PDFs, but no true bar-number/manual-map acceptance is claimed. Old history is not invented and playing quality is not inferred.
- **B153 — Transparent shortcut resets to yellow (candidate UI repair verified; physical open).** Build12 UI2 fails both ordinary/oversized Transparent assertions; two automatic-style buttons share a SwiftUI Form row. Independent bordered44pt buttons repair routing; strict UI3 ordinary/huge Transparent→Yellow→Transparent/save/relaunch/reopen checks pass. Build12 is installed/opened on the personal iPad; physical note acceptance remains open.
- **B154 — narrow score controls overflow (width repair verified; remaining phone acceptance open).** Phone1 finds width466pt in402pt app with Annotate x414. Native10 passes after a ViewThatFits two-row fallback; phone2 confirms the control row fits402pt and phone3 opens annotation on its ordinary tap. Largest-text stamp traversal and actual landscape remain unaccepted; an orientation request alone was not landscape evidence.
- **B155 — intermittent automation taps have no visible effect (unresolved).** Independent fresh2 records valid-coordinate taps that leave the focus menu open and annotation in reading. Fresh1 focus and fresh3 focus/note persistence pass on the same production binary. Build13 fresh5 also records a centered Camera gestures menu tap at(700,179.5) leaving the options menu open after relaunch; video/AX show no late transition. This follows successful explicit mapping selection; fresh6 mapping/save/relaunch/reopen/restore passes98.516s on unchanged production source. Additional centered review-queue/sidebar/grid/Passages opening taps fail, including build14 fresh5 at(38,209), while fresh4 opened that same Passages button. Build14 fresh6 single-box selection and dock-name editing/Save succeed, then selected-box double tap fails to open editing. The failures remain unexplained. No source cause or first-tap/sustained reliability verdict is established; retain failure evidence and verify physically.
- B148 note physical acceptance stays open. Build9–11 acceptance and failure scopes remain recorded below.

**Next steps:** exact19-item checklist and new evidence are in `docs/qa/ios/2.0.0/build12/practice-upgrade.md`; do not close physical reports from source review alone.

## October 10 — B148 sticky-note readability and customization

- **B148 — Sticky-note text is too difficult to read and boxes need resizing (physical acceptance open).** Build11 adds canonical page-width text sizing, readable note text, corner handles, lower scrollable formatting and shared vector export. Size/font/bold/italic/color/alignment persist through local saves, backups and the existing sync JSONB column. Legacy defaults do not rewrite files on opening; older clients may drop styling on rewrite. Core420 and final iPad5 native64 pass. Oversized actual UI passes1131.493s; ordinary fails184.170s before note interaction at `openScore` line19 amid host load144. No blanket UI, latency or physical acceptance follows.

Christian's separate build10 response, “good it works better,” remains qualified selection/Cancel improvement (B146/B147). Build11's earlier formatting hit miss, glyph mismatch, Save-not-committed failure and stale consecutive-drag receipt are retained in QA alongside their source repairs. Fresh source review accepts the final fixes; failed and zero-test runs remain recorded.

Build11’s source repair `646fd6cd26fd6fe6ef81df0dd22da9cdd59fb2d9` is installed on the friend’s `iPad (6)` as a fresh generic empty app. There was no prior app-owned inventory to compare; no personal data was copied. Friend launch is now user-confirmed; unavailable-device initial-library and physical note acceptance remain unverified. Personal iPad now has the same-source build11 through guarded refresh: independent review preserves13 files/13,568,473 bytes, revision2264 and its paused active set exactly. Personal launch/post-launch readback is pending. B148 stays open at the physical boundary.

**Next steps:** confirm personal launch and inspect post-launch data separately. The friend’s user-confirmed launch does not establish initial-library readback or physical note acceptance. Keep unmatched UI/accessibility and B148 acceptance open. Evidence: `docs/qa/ios/2.0.0/build11/`.

## October 10 — build10 installed; qualified physical improvement

**Installed iPad: native2.0.0/build10/schema5, source `b22d4bf`. Scoped native/UI checks and guarded installation pass; the user reports qualified improvement after the selection/Cancel comparison. Macv11.1.0/schema21 is unchanged.** After accepting the earlier named interactions, the user reports that Prokofiev passage creation has no visible corner dots and lags badly, while Beethoven handles are smooth. That earlier acceptance does not establish consistency across scores. This new defect is B146.

Confirmed PDF metadata differs sharply: Prokofiev page10 is5609.6×7764.01 points; Beethoven page4 is626.76×874.92 points. The old overlay's minimum content scale of1 defeats its4-million-pixel cap on the larger page, permitting about43.55 million pixels;8-source-point handles shrink below1 screen point. These identify page-size-dependent rendering and handle-visibility defects. Overlay/state repairs are implemented and two fresh source reviews find no new blocker. Final ordinary/oversized selection UI passes on both iPad and iPhone, including blank/drawn Cancel, Undo/Redo/save and adding a second box to a saved passage, canceling, then reopening the original one-box baseline. All48 selected native checks pass on phone; iPad passes42 existing plus6 new checks across the recorded runs. Four independently accepted screenshots show consistent handles/borders and unclipped Cancel/Done. These are scoped checks, not a full-suite or performance-rate claim; earlier failures and the zero-test run remain in QA. Build10 is installed. Christian now replies “good it works better” to the selection/Cancel comparison. This is qualified improvement, not measured latency or zero-defect acceptance. The raster cap does not bound total PencilKit cache/RAM; the pre-existing cropped-resize limitation when the opposite edge is hidden remains.

- **B146 — Oversized-score passage handles disappear and selection lags (open, physical report October10).** Prokofiev selection appears plain without corner dots and lags badly; Beethoven handles are smooth. Confirmed page geometry exposes an overlay scale floor defeating the4M-pixel cap and source-space handles shrinking below1 screen point. Build10 repair is implemented and source-reviewed; Final iPad/phone ordinary and oversized selection UI, selected native checks and independent visual review pass. Earlier failures remain in QA. The repair is installed from `b22d4bf` with independent exact-file preservation; the user reports “good it works better” in the comparison. This qualifies the improvement without closing every cross-score edge case.

- **B147 — Selection Cancel does not work (open, physical report October10).** Explicit Cancel must immediately discard only the draft and return to the score without changing a saved passage. The build10 repair keeps the separate navigation-away confirmation guard. Final actual iPad/phone empty/drawn Cancel and saved-edit baseline checks pass: a canceled added second box leaves the original one-box passage exact. Earlier pre-Cancel readiness failure remains in QA. The repair is installed from `b22d4bf`; the user reports “good it works better” in the comparison. This is qualified improvement, not an exhaustive Cancel acceptance matrix.

**Installed build10 checkpoint:** source `b22d4bf3e25ff7309ff55ad3b700d5bb5f2713ea`, tag `ios-v2.0.0-build10-candidate`, is installed by guarded same-bundle refresh. Independent complete pre/post audit verifies all13 owned files/13,350,814 bytes identical by filename, size and SHA-256. The preserved schema5/revision2198 snapshot has6 pieces/57 passages/54 historical sets/35 sessions/317 attempts/270 ink rows (213 active)/2 stamps/2 notes and no active set. Actual post-helper strict signing and app/dSYM checks pass; profile expires October16 at23:56:11 UTC (7:56 PM EDT). Automatic launch was denied, but a subsequent read-only process inspection confirms build10 running; this is not attributed to a user opening confirmation. Independent post-launch retention at October10 14:58:32 UTC also passes: all13 files/13,350,814 bytes and the complete schema5/revision2198 ledger are identical across all three snapshots, including profile/privacy/account/preferences, sync files and source PDFs. There is no active set or added persisted activity; authorship is not inferred. Christian subsequently reports “good it works better” in the selection/Cancel comparison; retain that qualified improvement without inferring every edge case or sustained reliability.

**Next steps:** retain the qualified selection/Cancel improvement and verify the separate sticky-note repair (B148). Installation, running-process observation and complete post-launch preservation pass. Preserve the earlier build9 acceptance and failure history. Evidence and pending checks: `docs/qa/ios/2.0.0/build10/selection-consistency.md`.

## Historical October 10 — build9 named physical interactions accepted

**Installed iPad: native2.0.0/build9/schema5 from `2de2444`. Launch/readback and named physical interactions pass. Broader acceptance remains scoped below. Mac:v11.1.0/schema21 unchanged.** On the iPad Pro12.9-inch (3rd generation, iPad8,5), iOS18.7.8, the prior build8 report was that the score cannot zoom while ink pans, Clean takes about one second, scrolling/menu/mode changes and warmup exit are delayed, passage selection updates about once every four seconds, and Pencil use crashes. These are physical observations, not accepted performance limits.

A45-second physical build8 Time Profiler capture records18.293 seconds of main-thread sampled CPU time, including12.276 seconds in `syncAll`. Instruments identifies14 hang/microhang intervals, the longest2.0187 seconds. The leading stack is `String(format:)` → `Data.praeludeHexLiteral` → `InkStrokeSyncRow` → `enqueueLibrarySnapshot` → scheduled `syncAll`. Inclusive samples overlap; hang duration is not measured touch-to-frame latency. These are build8 measurements, not evidence of build9 improvement. Sanitized evidence is `docs/qa/ios/2.0.0/build9/build8-physical-performance.json`.

Installed build9 source repairs: PDFKit owns page pan/zoom while the drawing canvas stays fixed; bounded app-owned drawing-value history replaces native tile Undo registrations; durable practice sync entries batch in parent-before-child order with debounced draining and account/revision-scoped snapshot reuse; a byte lookup replaces per-byte NSString formatting while retaining the existing hex wire format. Core412 and full native258 (1 live-account skip,0 failures) pass before the final gesture-priority change; two iPad practice/selection UI cases also pass. The earlier actual pinch failure is retained in QA. Undo now waits for the native pinch recognizer to fail and cannot recognize simultaneously. All14 targeted native interaction tests and fresh source review pass after that change. Actual UI5x pinch raises PDF scale to2.3177427145 from minimum1.0255516841 with the ink stroke retained; independent before/after pixel review accepts score/ink alignment and the settled palette. Actual two-finger Undo passes in Draw and reading. Two attempts to place the zoomed two-finger tap through XCTest fail because the target lies in a clipped viewport; this does not establish a production failure or a pass. The final gesture UI passes70.518 seconds: actual stroke, two-finger Undo in Draw/reading, Redo, mode change, strict real PDF pinch with unchanged ink, toolbar Undo/Redo at zoom, Done and saved ink after relaunch. Physical two-finger Undo at zoom remains pending. Source is frozen. Signed device build9 Release and strict app/profile/team/device/signer-trust and Release fixture/debug-exclusion checks pass. The same-bundle profile expires October16 at23:56:11 UTC (7:56 PM EDT). Independent signed-artifact verification and guarded installation also pass. Build9 is installed and running; independent post-launch preservation passes. On October10, the user confirms score pinch-zoom, Pencil marks → Done, two-finger Undo, passage selection and button response: “Those actions work and feel responsive.” These named interactions are user-accepted on source `2de2444`; measured latency, Undo specifically while zoomed, microphone/two-device behavior and sustained or week-long reliability remain unverified.

- **B145 — Build8 pan/zoom and latency failures (named repaired interactions user-accepted October10; broader paths unverified).** On build8, the score could not zoom while ink panned; Clean, scrolling, menus, modes, warmup exit and passage selection were delayed on the actual iPad8,5/iOS18.7.8. The45-second trace measures18.293 main-thread CPU seconds and repeatedly reaches NSString formatting through ink hex encoding in scheduled full-library sync. Build9 source/native/scoped UI checks pass. On October10, the user accepts score pinch-zoom, Pencil marks → Done, two-finger Undo, passage selection and button response on fixing source `2de2444`: “Those actions work and feel responsive.” This does not convert the build8 trace into a measured latency improvement. The earlier build9 actual pinch failure is retained. After Undo waits for native pinch failure without simultaneous recognition,14 native interaction checks and actual UI5x pinch/score-ink alignment pass; core412/native258 precede that final gesture change. Final build9 gesture UI passes70.518 seconds, including toolbar Undo/Redo at actual zoom and saved ink after relaunch. Build8 physical acceptance remains failed in the historical record. Build9 is now installed with exact13-file preservation, including the paused set; launch/readback now pass, while physical two-finger Undo at zoom remains pending. Signed Release and independent artifact verification pass.

**Installed build9 checkpoint:** source `2de2444a782cb54a5cd31966ecc33257e4511dd0`, tag `ios-v2.0.0-build9-candidate`, is installed through the guarded same-bundle refresh. Independent review verifies all13 owned files/12,960,329 bytes identical by filename, size and SHA-256 before launch. Schema5/revision2167 retains6 pieces/53 passages/54 set IDs (53 historical plus1 paused active set)/35 sessions/317 attempts/259 ink records (202 active)/2 stamps/2 notes. The paused set is preserved; it is not a running set or an empty active slot. Actual post-helper Release signing/profile checks pass; expiry remains October16 at23:56:11 UTC (7:56 PM EDT). iOS denied automatic launch, then the user confirmed opening build9 and read-only process inspection confirmed it running. Independent complete post-launch readback at October10 00:57:50 UTC (October9 8:57:50 PM EDT) verifies the same13 files/12,960,329 bytes unchanged, schema5/revision2167 and every original record including the paused set. Undo specifically while zoomed and sustained practice remain unverified. Both build9 traces completed but were effectively idle: the45-second trace has12 all-thread samples/5 main-thread CPU milliseconds; the120-second trace has15 all-thread samples/8 main-thread samples (8 milliseconds). Neither reports potential hangs, but neither proves active score gestures or a speedup; foreground lifecycle is unknown. The October10 user confirmation accepts the named actions separately from these inconclusive traces. Evidence: `docs/qa/ios/2.0.0/build9/personal-ipad-install.json`.

**Next steps:** continue practice with the accepted interactions; separately verify combined zoomed Undo, microphone/two-device paths and sustained use. Capture active-use profiling if a latency issue recurs. Preserve the paused set and keep installation/preservation separate from physical acceptance. No week-long or zero-defect claim is supported.

Evidence and planned checks: `docs/qa/ios/2.0.0/build9/responsiveness-regressions.md`; the separate Undo repair ledger is `docs/qa/ios/2.0.0/build9/undo-repair.md`.

## October 9 — build8 repairs do not close physical acceptance

**Installed iPad:2.0.0/build8/schema5. The user confirmed opening it, then reported a confirmed native Undo crash.** Christian still reports mark-confirmation freezing, lag, pixelated ink, inaccessible tempo/goals, awkward note/passage editing and microphone crashes. B124 and the physical portions of B129–B136 remain open. Six physical build7 watchdog reports (three each from October 7 and October 9) and a 90-second CPU report identify the same SwiftUI responder/AttributeGraph cycle: synchronous `PDFView.go(to:)` in `PagedScoreView.updateUIView` removes a focused overlay while SwiftUI is already updating. Matching-dSYM symbolication establishes this path; it does not attribute every reported freeze or the separate microphone complaint. Build8 defers and coalesces PDF reconfiguration until that update unwinds, explicitly observes the state its deferred coordinator reads, and retains failed-checkpoint guards. Detailed evidence is in `docs/qa/ios/2.0.0/build8/crash-analysis.md`.

- **B137 — Essential practice controls and movement targets are difficult to reach (open; installed repair; physical acceptance open).** Build8 adds exact/tap tempo, visible tempo goals, immediate hands, clearer techniques, practice during drawing/selection, explicit warmup exits, direct movement entries and immutable movement history snapshots. Native testing additionally reproduced movement-page caret entry producing 21 instead of 2; source now selects the old number on focus and retains invalid drafts with Save disabled. UI3 retained this numeric append failure and toolbar identifier inheritance; after their source repairs and the cleared UI4 stale-runner boundary, UI6 passes actual movement typing/invalid-input guards/steppers/list/grid/correct-page navigation. UI7 passes 72→88 goal, Left hand and Start/Clean/Undo. Largest-text portrait/landscape reachability also passes after explicit header glyph fonts. UI9 repeats the successful 72→88 goal/hands/grade/Undo flow after the larger goal sheet and full-value compact context; independent visual review accepts both goal screenshots. A week of pianist/teacher use is unproven.
- **B138 — Annotation quality, tool placement and direct editing obstruct practice (open; installed repair; physical acceptance open).** Build8 uses native zoomed PencilKit layers, distinct widths, lighter highlighter, a movable/collapsible palette with all six tools visible at 44-point targets, two-finger Undo, repositionable notes and discoverable rename/dictation gestures. UI5 passes both continuity cases, all three markup cases, two-finger Undo/Redo and double-tap rename. Sticky-note touch fails UI5/6/7: UIKit resets pan translation and overlay single taps compete with parent multi-taps. UI8 passes 13 selected native tests and confirms the real drag reaches its destination, but double-tapping the moved note still fails; UI9 repeats that sticky failure. UI10 failed before reaching sticky editing because Annotate did not reveal the palette. Unchanged UI11 reproduced the note-edit failure and identified a winning single-tap recognizer. Local note multi-tap ownership now passes actual UI12 drag/double-tap/edit/relaunch in52.404 seconds. Keep physical sticky-note acceptance open. UI13 later fails two assertions in one note-frame case and cannot find the new triple-tap accessibility target. UI14 passes the complete actual sticky create/hold-drag/double-tap-edit/relaunch/triple-tap/permission-denied recovery flow in 71.060 seconds. Its native suite executes 245 tests with 1 live-account skip and the same 2 zoom-frame assertion failures in one case; all other native cases pass, including PDF accessibility publication and hidden-wrapper guards. The aggregate does not pass. UI15 repeats the complete actual sticky triple-tap/recovery flow successfully in 59.539 seconds. Native245/1 live-account skip still has two frame assertions failing in one case, now with a zero frame. A detached test fixture is suspected; the test now asynchronously mounts a real UIWindowScene/window and asserts overlay.window identity before applying the transform. Only the test fixture changed after the UI15 production source. The final strict native run now passes245 tests/1 live-account skip/0 failures in16.881s; mounted-scene/window identity and crop/zoom assertions pass. Simulator results cannot establish physical Pencil latency, legibility or sustained reliability.
- **B139 — Reported microphone crash and capture lifecycle reliability (open; installed repair; physical acceptance open).** Speech callbacks now explicitly cross to the UI actor, shared capture has permission/route/ownership guards, and stale callbacks cannot restart canceled listening. The six retrieved crashes identify the separate PDFKit responder cycle; they do not establish a speech/audio cause. Microphone-specific physical reproduction and acceptance remain open.
- **B140 — PDF page change reenters a live SwiftUI responder update (physically diagnosed; installed repair; physical acceptance open).** All six matching-dSYM build7 watchdog reports point to `PagedScoreView.updateUIView` calling `PDFView.go(to:)`; overlay removal/responder resignation cycles through SwiftUI/AttributeGraph. Deferring/coalescing reconfiguration and teardown, plus explicit dependency observation, passes hosted9 (241 tests, 1 live-account skip, 0 failures), followed by the UI6 full native checkpoint (242 tests, 1 live-account skip, 0 failures), including real focused-canvas navigation/document/mode changes and failed-checkpoint refusal. Physical build8 repetition remains pending; these historical reports cannot prove every freeze is eliminated.
- **B141 — Accessibility-size selection Done becomes unreachable on phone (reproduced; installed repair; physical acceptance open).** Phone1 passes goal setup and warmup Finish but fails selection Done at accessibility text size. `ScoreWorkspace` pins selection tools outside scrolling practice controls within the same 60% total-height budget; narrow actions reflow into two rows. Independent source review passes. Phone1 finishes242 native/1 live-account skip/0 failures with three of four UI passes; its selection failure is retained. Repaired iPad UI12 passes accessibility portrait/landscape in67.236 seconds and its full native suite243/1 skip/0 failures. Phone2 reaches selection Done in both phone orientations; its complete accessibility case fails later in annotation, tracked as B142. The actual passage rename passes52.388s. Phone3 subsequently passes the complete accessibility portrait/landscape case in 71.631 seconds after the drawing-layout repair. Physical acceptance remains separate.
- **B142 — Short landscape annotation leaves an unusable tool viewport (Phone2 reproduced; installed repair; physical acceptance open).** Phone2 passes actual passage rename and reaches selection Done in both orientations, then exposes only3 pixels of drawing-tool viewport: score63/footer202 of337 workspace. Short writing windows now cap the practice footer at30%; reading/selection remain60%. Palette header title is13 points within a44-point header; body accessibility text remains adaptive. Cancel/Done spacing is12 points with6-point side padding per action. Phone3 now passes actual accessibility portrait/landscape in 71.631 seconds, and independent review accepts all four selection/palette screenshots. This closes the scoped simulator layout defect; installed-device acceptance remains open.
- **B132 narrowed, not resolved.** Idle annotation saves now prepare immutable stroke records and full JSON off the UI actor, then recheck revision/original ink before a synchronous atomic write. Coordinator generations keep older work from clearing newer strokes. Explicit transition checkpoints, the atomic write itself, imports/backups/restores and complex PDF operations still require actual-library profiling; long-session responsiveness and fixed refresh-rate claims remain unsupported.

- **B143 — Build8 signing interrupted by signed-out Xcode account (resolved for source `a23cdec`, October9).** The first two signed Release attempts stopped before compilation with No Accounts / No Profiles. User sign-in restored the original account, independent signed Release checks passed and the guarded update installed build8. Renewed profile validity ends October16 at23:56:11 UTC. Retain failed attempts as history; future updates must revalidate signing.

- **B144 — Native two-finger Undo crashes build8 (reported October9; repaired interaction user-accepted October10).** After user-confirmed opening, a23:59:53 UTC crash and matching build8 dSYM identify main-thread EXC_BAD_ACCESS at0x10 in PKTiledView.performUndo tile update, called through connectControls Undo and twoFingerTapped. The user reported “Opened, but something still fails” at19:59:56 EDT; exact preceding actions remain pending. This is distinct from the six build7 PDF navigation watchdogs. Independent13-file/12,788,247-byte installation preservation and full ledger retention at23:59:40 UTC pass, but that readback precedes the crash and cannot prove post-crash retention. The repair is now installed in build9/source `2de2444`; native, scoped UI and independent launch/readback checks pass. On October10, the user confirms the named two-finger Undo and Pencil marks → Done flows work and feel responsive. This accepts those repaired interactions; the precise old triggering sequence, Undo specifically while zoomed and sustained crash-free use are not established.

**Next steps:** retain the build8 crash and pre-crash readback as historical evidence. The named repaired actions are now user-accepted in build9; verify untested combinations, microphone, large-score and sustained-use paths separately.

**October 7 user confirmation:** Christian confirms the update reached the iPad. This confirms installation; sustained Pencil, audio, freeze recovery, refresh rate and real two-device behavior still require physical acceptance. The complete implementation, verification and deployment handoff is `docs/qa/ios/2.0.0/build7/session-handoff.md` (source `3e03330`, installation record `2227817`).

**October7 installed boundary:** build7 is installed with exact11-file preservation and verified signing. Automatic launch failed; subsequent device running-process/schema5 readback pass, with exact original history/marks retained. B124 and physical acceptance portions of B129–B136 remain open; source/native fixes do not establish sustained real-Pencil/piano success.

## October6 mobile stability findings

- **B136 — Short landscape warmups clip Close offscreen (reproduced, source repair candidate).** The native phone case showed the fullscreen Close button partly above the window because fixed header/readout/dock content exceeded the available height. Build7 anchors header/dock and scrolls the central readout and failure messages. Strict short-landscape verdict/Close/resume/tab navigation verification is required; physical usability remains separate.

- **B135 — Resume banner blocks compact tabs (reproduced, source repair candidate).** The native warmup test showed the whole tab bar covered after closing a live warmup; tapping More reopened the active set. Build7 places the banner on each compact screen’s content inside its navigation stack above the native tab bar, including pushed secondary screens. Keeping the inset outside the navigation stack hid final List rows even at maximum scroll; the content inset now lets those rows scroll fully clear. A strict banner/tab geometry and actual Warmups→Close→More→Rewards regression covers the source fix.

- **B134 — Live meter change traps an obsolete beat row (reproduced, source repair candidate).** The native customization test caught an Array bounds crash when changing from 6/8 to a shorter meter during playback. SwiftUI retained an older row while its shared accent list changed. Build7 rows capture their own accent values; button mutations retain bounds guards. A delayed foreground observer also stopped a click retained by the background preference; same-set retention now survives that delivery without restarting explicit Stop. Native regressions and final source boundary are in the build7 QA ledger.

- **B133 — Stamp/tool transition traps UIKit in responder recursion (reproduced, source repair candidate).** Native iPad mini test freezes when a focused PencilKit canvas is disabled while switching to Stamp. A live sample stays in `setUserInteractionEnabled → resignFirstResponder → _setFirstResponder`; CPU reaches 100%. Build7 routes input by the overlay without disabling the canvas. Native Place→Pen→Done and actual-PDF hosted regressions pass; physical confirmation remains required; this does not establish the cause of every B124 freeze.

- **B129 — Long/partially erased ink fails persistence or restores old marks (source repair candidate).** Raw point fingerprints exceeded the 8KiB validator limit for ordinary long strokes; clipping masks were omitted and could reuse un-erased bytes. Build7 hashes oversized keys and includes mask geometry while keeping short unmasked identities compatible. Dirty-canvas/failed-checkpoint/layer/page transitions now preserve newest ink; corrupt rows remain read-only. Native regression evidence and fixing source boundary are in `docs/qa/ios/2.0.0/build7/stability.md`. Sustained physical Pencil/freeze acceptance remains open, including B124.
- **B130 — Drawing, history and previews schedule excessive UI work (source repair candidate).** Drawing samples serialized whole canvases; saves performed quadratic ink/session lookup; reward catch-up rewrote whole ledgers per award; cover/PDF work and file hashes ran in UI paths; tuner queued unlimited windows; animated metronome progress rebuilt settings. Notebook multi-delete used shifting filtered indices, and profile/measure results could outlive their request. Build7 coalesces checkpoints, indexes matching/projections, batches awards and bounds/serializes image and analysis work. Source tests establish these mechanisms; actual device memory/frame-time acceptance remains open.
- **B131 — Annotation trays and Today arrows impede small screens (source repair candidate).** Build7 uses a shallow annotation strip, bounded scrolling footer and 44-point reorder menu. Independent review caught blank footer bands and strengthened intrinsic-height checks. Native testing also caught a metronome Menu whose advertised full row exceeded its real label hit target; its full-width44pt target is repaired in source. Normal phone landscape annotation also fitted notation to a tiny thumbnail; short annotation viewports now fit stave width while preserving mark coordinates, manual pinch and automatic return-to-portrait zoom. Strict rotation also exposed an advertised44pt Done image whose label lacked a full hit shape; score mode icon labels now have explicit rectangular targets. Music stamps now retain their explicit geometric size at accessibility text sizes, with whole-button labels and hit targets; the fallback cap excludes safe-area allowances. Actual phone/iPad and accessibility verification is recorded in the build7 QA ledger; physical usability remains separate.
- **B132 — Remaining synchronous large-data work (open).** Full-library JSON encoding/atomic saves, native PDF import/full backup/restore, an individual complex export page and final PDF rewrite remain synchronous. Very large selections retain scan images, and long books need physical memory/Pencil profiling. Do not call the entire app lag-free or claim a fixed high-refresh rate. Follow-up requires preserving transactional failure semantics and profiling the real library before a persistence redesign.


**Last updated: 2026-10-10. Praelude v11.1.0 / schema 21 — SHIPPED + INSTALLED.** Installed at `/Applications/Praelude.app` at 16:58 EDT on 2026-09-08; implementation `c411e7b`. Fresh native launch, real Score and Variants dialog pass. All 46 database tables and DB bytes are unchanged from the fresh backup.

**Native boundary:** v11.1.0 launches and renders the real Beethoven Op.90 movement 2 score, selected passage and Variants dialog. The earlier Desktop/Score permission blocker is cleared. Progressive rep/set/chain effects passed independent live browser review; native audible quality, voice/chime overlap and Christian’s motivation verdict remain open. Cover-picker selection/save (B109), microphone/Steinway, real mapping and Windows acceptance remain separate.

This is the no-faking register. Never delete a flaw silently; resolved defects retain their diagnosis, fix and commit. Historical version references below are dated evidence, not the current installed boundary.

**Current acceptance:** v11.1 source/browser checks and exact native installation pass; native audible quality, voice/chime overlap, sustained motivation, microphone/Steinway, real mapping, cover-picker and Windows acceptance remain open. Score/Variants now render in the freshly installed app. Earlier release limitations below are retained as dated evidence.

## Mobile build6 installation blocker

- **B128 — Signing recovery (resolved October3; renewal/install evidence commit `a969c92`).** Stale local profiles excluded trusted signing keys. A precisely matching cached profile was archived reversibly; reopening native Xcode issued a fresh same-app/team/device profile valid untilOctober10 at17:55:53UTC with2 trusted/unexpired certificates. Local Keychain authorization completed; actual Release signing/profile checks, guarded build6 installation and complete11-file preservation now pass. Christian confirms launch; direct schema5/revision883 read passes. Earlier revoked-certificate and failed-build evidence remains in `docs/qa/ios/2.0.0/build6/device-update-attempt.json`; renewal/install proof is `docs/qa/ios/2.0.0/build6/personal-ipad-install.json`. No trust override/revocation/device reset.

## Mobile build6 practice dock correction

- **B127 — Practice dock still wastes score height (implemented candidate, physical acceptance open).** Build5 stacked tall verdict/secondary rows under a760-point maximum width. Build6 removes the width cap, shares wide setup/transport rows and retains44-point secondary/transport and52-point verdict targets. Narrow/accessibility fallback remains. Six scoped native iPad cases pass, including portrait/landscape143pt setup and100pt running geometry, saved first attempt, actual verdict/Undo and largest-text reachability. Two scoped phone geometry/action cases and independent final visual review also pass. Guarded build6 installation and exact complete-file preservation now pass after provisioning renewal. Actual pianist acceptance stays separate.

## Mobile build5 repair candidate — October2 physical feedback

- **B124 — Pencil/black annotation and in-set annotation freeze (physical defect, acceptance open).** Christian reports Pencil cannot draw without finger mode, black marks/stamps are invisible and opening the pen freezes build4. Build5 repairs unresolved Pencil hit routing, pins paper-light rendering, defers responders and preserves read-only decode failures. Guarded personal build5 installation preserves every file, and schema5 migration retains the exact original. Native synthetic checks and installation do not close actual Pencil/freeze acceptance.
- **B125 — Score organization/workflow friction (implemented candidate, acceptance open).** Crowded score bars/unclear exit, slow ambiguous passages and movement/page numbering, limited stamp positioning and sprawling reminders. Build5 implements bottom modes/confirmation, visible Library, color/hide settings, movement ranges, reviewed measure hints/anchors, cached background previews and compact expandable notes. Exact automatic scanned bar segmentation/OMR remains unbuilt.
- **B126 — Shared sync/file identity gaps (implemented candidate, acceptance open).** Goals/routines/preferences/covers/new score fields lacked coverage; uppercase UUID storage folders could violate lowercase owner policies; repeated unchanged pulls rewrote data and nullable clears needed explicit wire nulls. First sign-in could publish default identity/privacy before reading the account; failed profile staging, sign-out and reverted retries could lose or revive edits. New contracts/tombstones/canonical paths/no-op adoption/legacy field preservation and durable account-bound profile intent address source paths. Real-account two-device sync and a continuous Tauri adapter remain open. Original Mac archives stay local/backed up.

## Mobile build4 follow-up (2026-10-02)

- **B120 — Tempo edits reinterpreted previously earned practice.** Changing startBPM and replaying old reps could turn a requested64→65 into69 and rewind/reclassify stages. Durable boundary-anchored tempo events preserve the original contract, actual attempt tempos and earned progress through Undo/reopen. Repeat/relaunch defaults also need the current effective ceiling. Source fix implemented; final scoped checks/commit pending. Schema4 and backupv3 protect the new semantics from older readers; mixed-version cloud clients remain unsupported.
- **B121 — Suggested visual join could hide both original targets.** Duplicate box IDs rejected the new passage while swallowed save errors still archived both sources. One atomic merge with fresh region identities now retains sources on failure. Source/core/native checks and guarded installation pass; fixing source commit `aeda81b`; hardware acceptance remains open.
- **B122 — First-attempt grading could partially save.** Set, grade, schedule, rule events and first rep used separate writes with ignored errors. They now commit together; a failed write leaves the original ledger/arm intact. A playing click at a different tempo requires a deliberate new cold attempt before any grade is saved. Source/core/native checks and guarded installation pass; fixing source commit `aeda81b`; hardware acceptance remains open.
- **B123 — Practice convenience and metronome control gaps.** Before-grade settings were hidden, More options/another set discarded chosen settings, active passage taps could change visible target without changing the ledger, and passages lacked search/current-page priority. Technique chains showed an unused general count instead of actual stage targets. Count-in/lock choices were hidden, the background pause could silence requested lock playback, 6/8 dotted pulse was unclear, click edits restarted beat1 and custom mute could silence count-in. Candidate fixes these paths; current QA retains actual passes, failures and physical timing/voice/locked-screen limits. Core/native runtime and largest-text checks pass; build4 installed with exact data preservation. Normal toolbar-opening automation remains unaccepted; further phone work deferred at user request. Fixing source commit `aeda81b`.

## Mobile 2.0 findings (2026-10-02)

- **B116 — Mac/mobile continuity remains partial.** A complete snapshot is preserved locally, but original Mac history retains its own semantics and does not populate native reward/insight calculations. No continuous Mac↔iOS adapter exists. Native goals/routines are not cloud-wired. One missing Mac score is flagged, not reconstructed. Follow `docs/qa/ios/2.0.0/README.md`.
- **B117 — Real-account/two-device Supabase acceptance remains open.** Source fixes address pagination, failed-save acknowledgment, guest catch-up, undo and file retries. Server piece metadata upserts can still overwrite a newer independent page clock; no server receive sequence/file content version exists. Current source full-pulls supported tables; an account switch is deliberately refused to preserve private ownership. Hosted migrations/security regressions were not reverified this session.
- **B118 — Native backup omitted recording bytes (found/fixed in current candidate).** Metadata-only recording backups could restore dangling records. Current backup includes exact audio bytes and fails safely on missing originals/legacy incomplete backups. Size remains bounded (210 MB owned payload, 280 MB encoded JSON); unusually large or repeated full Mac snapshots are refused. Fixing commit: `635a5ae`; current QA tracks scoped checks and remaining hardware limits.
- **B119 — Piano-use interface friction (found/fixed in current candidate).** A fixed-width HUD overflowed narrow screens; repetition cards resized notation; verdicts unexpectedly advanced passage pages; plan start skipped warmups; ten phone tabs hid actions; initial voice enable needed a second tap; Performance exit was undiscoverable. Current candidate fixes these behaviors. Fixing commit: `635a5ae`. Physical voice, Pencil, interruptions and sustained music-reading acceptance remain open. Intermittent simulator Today-row taps after scrolling did not invoke navigation; final isolated phone tempo/navigation passes without retry, but the cause remains unproven and needs a hardware cold-start check.

## Native iPhone/iPad candidate findings

- **🟠 B115 — Native mobile launch, migration, physical acceptance and parity remain open (2026-09-14).** Current source is 1.1.0/build2/schema2 at `124707d`; the iPad now reports 1.1.0/build2 installed with complete file preservation verified. Controlled launch and first-launch migration remain pending; installation does not establish physical-feature acceptance.
  - **Historical 1.0 baseline:** The SwiftUI target implements local pieces/PDFs, passages, deterministic rep contracts, tempo/variants/routines, goals/calendar/history, optional on-device speech and backups with an independent schema1 JSON store. Swift 6 compilation, unsigned Release arm64 device build, 22 core tests, 2,041 service assertions and 13 native app-hosted tests pass on each iPhone and iPad simulator. All eight iPad UI scenarios and seven of eight phone scenarios pass across regression runs, including corrected large-text checks; the final exact-source unsigned Release build passes, with fixture flags/test plug-ins absent. `docs/qa/ios/device-build.json` records hashes and zero signing identities/connected devices at the earlier unsigned-build gate; exact evidence is in repo `ios/README.md` and `docs/qa/ios/README.md`. No physical iPhone/iPad, TestFlight or App Store shipment is claimed. Closing the device boundary requires signed-device import/relaunch/persistence/backup, VoiceOver/Dynamic Type, real audio/voice/interruption and musician acceptance. Mac schema21 migration/sync, Listen Back, cloud mapping, furnished Studio/coin economy, desktop warmups and full history repair remain unported scope; native backup is not Mac-data migration. Assistant remains OFF/ON HOLD. The installed Mac v11.1 and its live database are unchanged by this target.
  - **Current 1.1 evidence (scoped simulator and signed-build checks passed):** 29 core tests, 2,166 service assertions, 28 fake-device helper tests and 36/36 native hosted tests on each simulator pass. The final-toolbar iPad9 selected run passes 3/3: finger 59.497 s, meter 61.653 s, Focus 23.719 s. iPad7 supplies box editing/relaunch and accessibility markup in both orientations; five targeted iPad scenarios pass across runs. Phone3 passes 36 hosted plus 3 selected UI, and Phone2 supplies the other four UI passes: seven distinct phone scenarios pass across runs. Phone4 also passes its final-toolbar finger 91.652 s/meter 84.624 s recheck. Final exact-source signed Release verification passes. Earlier failed runs remain failed; no all-green full-scheme or physical-feature claim is made. Phone3 pre-Undo/after-Redo images show ink; the earlier iPad blank capture remains unexplained. Current QA is `docs/qa/ios/1.1.0/README.md`.
  - **Post-install PDF verification gap (fixed in candidate helper source `124707d`):** the first helper checked only the ledger after installation, so a missing or same-size changed PDF could have escaped verification. It now makes a second complete copy and compares all file names, byte counts and SHA-256 before launch; failure reports installed-but-unverified, retains both copies and performs no restore/uninstall. All 28 fake-device tests pass, including PDF deletion/mutation, copy failure and empty-library changes; independent source review passes. Exactly two full copies per refresh are asserted.
  - **Physical update hold cleared; launch pending:** earlier PDF-copy probes failed with CoreDevice7000/POSIX1 EPERM. The 20:50 guarded refresh again failed the complete copy before installation, with only a generic failure reported. At 20:52 Xcode Download Container failed with CoreDevice7000/POSIX1 on a SplashBoard snapshot cache and yielded only partial caches. Cause remains unproven. After the user reported ready, the complete pre-install copy at 20:55:48 EDT succeeded. The helper installed 1.1.0/build2; the complete post-install copy at 20:56:18 matched all owned file names, byte counts and SHA-256. Both copies stay private. Automatic launch was denied with a generic security/unlock error; unlock/open and conditional Developer App trust are pending. The preserved ledger remains schema1, so first-launch schema2 migration and physical in-app backup/restore remain unaccepted. No deletion, reset, restore or explicit termination was used. Guide: `ios/docs/INSTALL_ON_IPAD.md`.
  - **Phone finger gestures (fixed in candidate source `124707d`):** Phone2 produced zero actual strokes because PDF pan competed with the PencilKit drawing recognizer. The pan recognizer now waits for drawing. Phone3 passes finger stroke/Undo/Redo/Done/relaunch in 52.960 s; native pre-Undo/after-Redo images show the black stroke. Independent source review found no concrete side effect, and 36 phone-hosted tests pass, including reading/pinch across ink modes. iPad9 finger persistence also passes in 59.497 s; Phone4 also passes 91.652 s on the final toolbar; physical Pencil precision remains unaccepted.
  - **Final signed candidate verified:** ignored `releases/ios-personal-1.1.0/Praelude.app` passes strict signature, profile, fixture exclusion and copied-file checks, with profile expiry 2026-09-21 21:24:58 UTC. The older signed 1.0 tree is unchanged. The final rebuild includes the diagnostics and gesture/toolbar corrections, with stable production input hashes and strict verification. The 1.1 installation and complete file preservation are verified separately; launch, physical-feature and distribution acceptance remain open.

  - **Historical cable-install boundary (installed; initial launch encountered trust, 2026-09-14):** free Personal Team Release 1.0.0/build1 installed via devicectl at 17:51 EDT after the earlier device-unavailable attempt. The installed listing confirms version/build on iPad Pro 12.9-inch (3rd generation), iPadOS 18.7.8, with Developer Mode enabled. First launch was denied by a security/trust message; Developer App trust under Settings → General → VPN & Device Management is pending. Installation is verified; launch and hardware feature acceptance are not. The profile expires 2026-09-21 at 21:24:58 UTC; fixtures/test plug-ins are excluded. The signed app stays at ignored `releases/ios-personal/Praelude.app`; the sanitized Personal Team manifest records install separately from launch. Historical unsigned evidence and Mac app/data are unchanged; private signing/device identifiers stay local.
  - **Complete phone backup UI scenario (simulator acceptance verified in 1.1, 2026-09-14):** Phone3 export/cancel/restore/cancel passes in 62.827 s after the harness filters inactive zero-frame Settings elements; this closes the historical UI gap without changing production backup routing. The following earlier 1.0 failure evidence is retained: final iPad export/cancel/restore passes in 71.983 s. An earlier phone run logged three Settings callbacks, export/native dismissal and Restore Recents/Cancel but failed obsolete picker assertions. The corrected final phone rerun failed at initial Settings navigation in 37.965 s before either picker, leaving complete phone acceptance open. The explicit 44×44 plain Settings target is an ergonomic/source improvement, not proof of a cure for intermittent input. Provider-aware selector corrections did not change production picker routing. Native hosted storage/PDF recovery tests pass on both simulators. Manual CUA captured no usable app surface and activated no controls, so no manual pass is claimed.
  - **Maximum Dynamic Type iPhone geometry (candidate source fix visually verified, 2026-09-14):** landscape verdict text escaped its button backgrounds, while portrait page indices truncated and the score could collapse to zero height. Earlier 44-point checks did not prove visible text fit. The candidate keeps the requested text size, reserves score space, caps a scrolling accessibility practice panel at 60% of the workspace/520 points, uses intrinsic-height text controls with Clean first, and simplifies passage/page chrome. Independent native iPhone PNG review now verifies label containment/reachability and visible score in both orientations. Post-fix geometry/PDF/interaction/metronome checks passed; six stale child-StaticText selectors failed because SwiftUI exposes combined button labels. The corrected full-label phone case passes in 63.975 s; the strengthened iPad case passes in 55.432 s with independent PNG review. Simulator evidence accepts this candidate fix; pre-fix results are not used as proof and physical-device accessibility remains open.
  - **Recovery defect found and fixed in the candidate source:** an unreadable/newer ledger previously exposed an empty fallback for export while the generic read-only guard blocked deliberate recovery. Export now refuses that fallback. Explicit validated backup restore copies and byte-verifies the original regular ledger before atomic replacement; preservation/write failure keeps read-only mode and the original remains retained. Core recovery tests and the native app-hosted PDF recovery case pass on both simulators; complete phone backup UI acceptance remains a separate open finding above.

## v11.1 feedback findings

- **B110 — Feedback felt underwhelming (implemented, musician acceptance open).** Christian rejected the small blue box and repeated generic sounds on September8. Runtime `c411e7b` adds contract-based charge, escalating finite particles, bounded amber/coral setbacks, large set/gold-chain finales and varied layered musical cues. Independent live browser review passes; whether this is rewarding at the piano requires Christian's verdict.
- **B111 — Web Audio could never initialize (resolved, `c411e7b`).** The old optional-chain guard returned null on first access because `undefined !== "closed"`. Explicit context guarding now creates it; gesture unlocking, unavailable/closed/suspended-device, stale resume and cleanup tests pass. No durable rep write depends on sound.
- **B112 — History repairs could replay completion rewards (resolved, `c411e7b`).** A corrected mastered clean could become unsatisfied, then satisfied again on undo/reversal with the same attempt ID. Shell formerly replayed its fanfare. Both local and Shell feedback now require fresh saved attempt high-water edges; regression tests cover corrections, undo/redo, polling and remounts.
- **B91 follow-up — native Score permission boundary cleared for v11.1.** Fresh installed app renders the real Beethoven score pages1/3 and opens/closes Variants without data writes. The historical v11.0 permission evidence below remains a dated record.

## Project portability findings

- **B113 — The binding project manual was local-only and first-read repo docs were stale (resolved 2026-09-13).** The editable Obsidian folder was not a Git repository, while repo AGENTS/README/CLAUDE depended on its absolute path or described old v8-v10 states. A fresh clone lost the current Changelog, Roadmap, tutorial, flaw registry and version records. The private repo now carries a curated `docs/project/` Markdown mirror, repository-relative entry points, a new-Mac guide, setup doctor/bootstrap and a sync/check command. The mirror excludes the vault's personal databases, score PDF, output and local agent logs.
- **🟠 B114 — Personal practice-state relocation between Mac usernames/paths is unverified (open migration limit).** Git portability does not move the live SQLite database, Pieces tree, covers, photos, recordings, permissions or Keychain items. Current settings and piece/PDF records can contain absolute `/Users/c3/...` paths; copying only the database to a different username can strand scores. Closing this requires an encrypted backup, exact pre/post integrity and count comparison, file-tree preservation, a designed path-rewrite or same-path strategy, fresh macOS permission grants and real Score/relaunch acceptance. Until then, a second Mac is accepted for source development only—not as a byte-for-byte continuation of Christian's installed practice environment.

## v11 findings and explicit scope

- **B107 — Accounts and social infrastructure are unbuilt (open scope limit).** Studio stores only a private local display name. No email/password login, account recovery, sync, friends, friend practice presence or leaderboard exists. No Supabase/service is configured, so no credentials are collected. Closing this requires an actual configured service, privacy/auth design and end-to-end tests; a local name is not account acceptance.
- **B108 — Studio's sustained motivation and content depth remain unproven (open acceptance/scope limit).** v11 implements continued Encore rank progression, but has 25 initial catalog items and one item per slot, with no free placement. Correct economy math and rendered QA do not establish long-term motivation or an Apple-native experience. This is an original CSS/SVG Tauri interface inspired by materials, not the native Liquid Glass framework. Christian's practice verdict and later catalog expansion remain open.

- **B109 — Custom-cover file chooser interaction still lacks end-to-end evidence (open verification limit).** The automated browser chooser hung. The installed native chooser then opened, but computer-use accessibility inspection could not read the window; it was canceled and the app restarted with no image or preference saved. Actual image selection/save/restart has not been accepted. Cover preprocessing, native save/reopen and invalid-payload tests pass; they do not substitute for choosing an image in the real picker and seeing it survive app restart. Re-run that UI path when the browser/native picker can be controlled.

Severity legend: 🔴 fundamental / could invalidate the approach · 🟠 serious / limits real-world
use · 🟡 minor / known and bounded · ⚪ hard constraint (not a bug — a fact of the environment we
design around).

---

## A. Product-level (the ones that matter most)

**🔴 A1 — Real use disproved earlier voice/practice contracts; the narrowed contract still
needs current v8.2 hardware acceptance.**
The previous register incorrectly said Christian had never used CodaKiller at his Steinway. The
July 15 database contains **481 attempts across 48 blocks and 8 sessions**, and his notes describe
live use. That is material evidence for “user is the sensor; app is the memory”—he still explicitly
does not want the app to grade piano audio. It is also evidence that the implementation is not yet
trustworthy: “done” is missed over the piano, ambient conversational fragments reached failed-rep
notes, rapid corrections are awkward, and v1 can present an attempt-count target as completion
without a clean-streak standard. Narrated recordings can reproduce speech/state-machine hazards,
but only the installed v8.2 app over the live Steinway can prove acceptable recognition. The open
questions are now narrower and evidence-based:

- Does the current fast two-word verdict / acknowledgement / correction path recover a missed “done”
  without double-logging rapid reps?
- Can the strict grammar keep conversation, phone audio, page turns, and piano inert while still
  recognizing Christian's intended verdicts?
- Are terse receipts audible/visible enough at the piano without interrupting practice?
- Does the metronome remain usable against the live instrument?

**The v8.1 implementation, inherited by installed v8.2, narrows but does not close this acceptance
thread.** It adds live-set two-word
verdict fast paths, a persistent last-three heard feed, live settle timing, counted voice
adjustment and Listen Back's physical STT capture lease. All five narrated corpora and ownership
tests pass, and the package is installed; only native microphone use and a real session at the
Steinway can answer the four questions above.

**Moved to Resolved 2026-07-16 (v3.0.0 install) — see §Resolved.** At that boundary the
black-and-white theme, five-workspace layout, disclosure-first Ledger, shell-level Rep
HUD/receipts and d3-force Universe directly addressed the original messiness, genericness and
static-Universe complaints. v8.1 has since replaced the galaxy with evidence-only levels, badges,
next rails, cadence, repertoire and technique progress. Whether that result actually _motivates_
Christian day to day still requires sustained real use; the open acceptance remains recorded here
rather than silently declaring the design successful.

**🟠 A5 — Several original practice bets are fixed; the remaining real-use risks are voice and
resume friction** (updated 2026-07-20):

- **Conversational intake is deliberately narrow in v1.0.0.** It reviews current state, deadline,
  target tempo, and notes only; Goal/Calendar work uses deterministic explicit forms. Exact trigger wording is
  still required, and real use may show that the parser needs more natural variants.
- **Write trust is now installed.** Routine practice receipts are visible, pointer-through, and
  disappear after 1.5 seconds; errors/confirmations remain until explicitly dismissed, even under
  rapid rep traffic. Durable receipts and idempotency cover the practice/session/Settings paths.
  The open debt is auditing any future mutation surface into the same contract, not the former
  silent-button failure.
- **The v1 attempt-count completion failure is installed-fixed.** PracticeContract mastery requires
  the configured consecutive clean streak; flawed/failed reset it; planned attempts are a review
  boundary only; correction, restart, recovery, and retention are append-only. v3.2's 220-attempt
  simulation proves this through relaunch and export.
- **Rep vocabulary/firewall needs redesign:** intended “done” can be missed over the piano while
  ambient phrases can become failed notes. Custom aliases alone cannot solve command-boundary and
  acknowledgement issues.
- **Spot resume is now direct in v7.2.** **Practice this** on a child spot resumes its newest
  paused set, or starts a contextual three-clean set when none exists; an active different set
  explains the conflict and writes nothing. Broader non-spot resume still lives in the Paused
  Sets tray/history. The new spot interaction still awaits native/at-piano acceptance.

## B. Technical debt & observed defects


> B21–B28 were the historical v2 blocker group. This section now mixes preserved diagnoses with
> current residuals; the Windows v9.1 boundary starts at B97 below, the Mac v9.0 candidate is B96,
> and resolved items live
> in §Resolved.

**B85, B86 and B87 moved to Resolved 2026-08-27 (v7.2.0 install) — see §Resolved.** Their
originating real-use reports, causes, exact installed behavior and remaining native/at-piano
acceptance boundary are preserved there.

**🟠 B97 — v9.1 is packaged, but Windows-native tests and Windows 10/11 acceptance are unproved
(opened 2026-08-31; narrowed 2026-08-31).** The exact current-user NSIS candidate is
`CodaKiller-9.1.0-Windows-x64-Setup.exe`, 7,654,002 bytes, SHA-256
`e2e2f3ae8846ef7aca6a6c04b2e1a2f346e97640f5d9089e6e49012365dc5dd4`, packaged at
`2026-08-31T19:31:59Z` from implementation `2d33004888a97c3ebcb4b7799bf54029efd15626`.
Release/docs commit `f296f3cb38ae5d29c1ae813493f5c37ea07ed9a6` is the exact target of pushed
lightweight tag `v9.1.0`; private `origin/main` and the tag currently resolve to `f296f3c`. These
publication facts do not close the native-acceptance flaw.
Recursive share-clean inspection passes and the embedded app is PE32+ x64. Frontend,
TypeScript/build, Mac native 1,111/19 ignored, Mac strict Clippy/format and Windows cross-target
check/strict Clippy pass. The path claim is limited to no personal or unremapped host paths;
intentional `/build-user` remapped build paths remain. Inert migration metadata/identifiers and
the bundle id remain to support compatible upgrades, but Windows upgrade/data preservation has
not been exercised. **Windows-native cargo tests were not run.** Clean Windows 10/11
install/relaunch, picker/PDF/Score, metronome/audio, persistence and uninstall/reinstall are all
pending. Keep this open until both recipient systems are recorded; do not infer native behavior
from a successful macOS cross-build.

**⚪ B98 — the first Windows build deliberately lacks voice and Listen Back parity (opened
2026-08-31).** The existing `hear` recognizer is a macOS Mach-O executable; the STT process-group,
system TTS, automatic system-volume boost and WebView microphone-ownership/Listen-Back contract
are not ported. Shipping those controls as apparently live would be worse than a smaller honest
product, so Windows presents Mic/hands-free commands, Listen Back, system TTS and volume boost as
unavailable and excludes `hear` from the bundle. Its supported promise is Pieces/PDFs, Score, keyboard/mouse
verdicts, metronome/chimes, History, Calendar and local persistence. This is a documented product
limit, not an assertion that Windows audio is impossible; closing it requires a separately
designed, native-tested Windows STT/capture/lease/TTS implementation.

**🟠 B99 — the exact Windows installer is unsigned and SmartScreen behavior is unaccepted
(opened 2026-08-31; narrowed 2026-08-31).** No Windows code-signing certificate exists, and the
7,654,002-byte current-user NSIS candidate was built without signing. Native Authenticode status
and Microsoft Defender SmartScreen behavior have not been measured on Windows. Self-signing would
not create public trust and must not be used to claim the warning is solved. Record the exact
Windows 10/11 warning, filename/hash verification, **More info → Run anyway** path and
uninstall/reinstall behavior from this hashed EXE. Keep B99 open until a real trusted signing/
reputation path exists; recipient acceptance may document the warning but does not resolve the
unsigned-distribution limitation.

**🟠 B96 — v9 is a verified packaged shareable candidate, but install/native/recipient acceptance
remains unproven (opened 2026-08-30; narrowed 2026-08-30).** The source identifies as
v9.0.0/schema 21 and implements
the Library-first Pieces surface, nested logical folders, direct local-PDF intake, status/context
actions, blank app-owned first install, upgrade-preserved configured/inferred root, and removal of
the embedded copyrighted pedagogy/quote payload plus Quotes/Reader/Books/passage-helper UI. None
of that is installed acceptance. Now proved: frontend 204 files/2,525 tests passed with one file/
test skipped; native 1,077/17 ignored/0 failed plus integrations; TypeScript/build, five corpora,
format, strict Clippy and native build; independent content review; isolated on-disk blank-store
contract twice; exact disposable schema-20→21 preservation; and the 720×520 devMock walkthrough
after one clipped folder menu was fixed/retested 4/4. The final 10,736,628-byte DMG verifies at
SHA-256 `e5f3c2265cd962791a8267fee6a4e4e0c42a9a70775bbcc5729623a7aa443f06`; mounted identity,
strict ad-hoc signing (CDHash `33ffc5fade7ecb090c5fd7b08818ae82164cbc21`), exact four-entry
layout, full dependency notices and share-clean scans pass.

Still owed: fresh backup and v8.2.1 rollback; safe install with exact before/after integrity/FKs/
counts; one-copy/fresh native launch; native picker/drop/persistence and 720×520 Library behavior;
clean-recipient Control-click/Open Anyway + first piece. Package implementation commit
`709542023b3e3bf0c9e72189d145e5fd524eaacd` is packaged; release/docs commit
`6a560eeae328e7cb44019058c319f0617aa5372e` is the exact target of lightweight tag `v9.0.0`
and private `origin/main`, and both pushes succeeded. These are package-boundary facts, not
acceptance evidence. The **2026-08-30 19:25 EDT** live
read-only audit is schema 20/integrity OK/FK0 with 11
pieces/255 blocks/2,327 reps/51 sessions/9,241 events and **one open session + one open block**,
so installation was correctly not run and installed v8.2.1/live data remain untouched.

The candidate is bounded to Apple silicon and macOS 13+. It is ad-hoc signed, not Developer-ID
signed or notarized, so Gatekeeper friction is expected; Intel, Windows, automatic updates and a
warning-free public distribution are not supported claims. The release script can quit and replace
the installed app, so it must not run through a live set/session. The privacy cleanup is
non-destructive by design: it does not delete Christian's external `Knowledge and Resources`
folder or historical `brain_turn` rows that may contain prior citations/excerpts. Close B96 only
after retained install/recipient evidence exists, not because the package gates are green.

**🟡 B91 — v8.2 browser Score/composer acceptance is complete; packaged-native feel is blocked
behind a Desktop-folder permission prompt (found 2026-08-27).** Five exact browser frames passed
at 720×520 and 1462×919, including continuous Score, independent section composer reveal, compact
variants and Total plays. The packaged 8.2 app launched, but macOS asked for access to the Desktop
folder that contains Christian's score vault. That sensitive permission was deliberately not
granted during automated release work. Therefore no native Score screenshot or interaction verdict
is claimed. This does not invalidate the package, migration or browser UI proof; it keeps one
specific acceptance gate honest. Close B91 only after Christian grants/declines the permission in
person and judges scrolling, rail reveal, variants and a mixed-quality five-play set at 720×520.

**🟠 B90 — historical v8.1 release proof is complete; native audio and at-piano acceptance remain
open against the current installed v8.2.1 binary (found 2026-08-27, narrowed after install).** The
v8.1 release's final installed HEAD was
`1a1e38bb7a3757cf90ee6ea814e93d5971c595d6`. Frontend **2,650 passed / 1 skipped / 0 failed**
across 209 files (1 skipped); native **1,100 passed / 19 ignored / 0 failed**. TypeScript,
production build, strict Clippy, formatting, all five narrated corpora and all eight release gates
passed. `/Applications/CodaKiller.app` launched fresh and
reports bundle ID `com.christian.codakiller` and plist short/build `8.1.0`; strict signature
verification passed with an **ad-hoc local seal**, not Developer ID and not notarized (CDHash
`8655e9a45d83b7bb56e83a9d14bb477da7da39a9`). The 10,892,054-byte DMG at
`/Users/c3/codakiller/releases/v8.1.0/CodaKiller-8.1.0.dmg` verifies SHA-256
`e828b861b31d771fde66cd66d48987eb66110f0fd455306a6a12c2f80eb0a271`.

The live database migrated 16→19 with integrity OK and **0 foreign-key violations**. Pieces moved
10→11 solely because hidden `id=0` is the Warm-ups system row; blocks 230, reps 2,034, sessions 46,
events 7,873 and **one open session** were preserved. `measure_map` remains 0 rows. That closes
B90's build/package/migration half. Release tag `v8.1.0` points to
`0a3d6a5d339955fd7e7318299eaa6c3063674415` and is pushed. The first pushed post-tag docs
baseline was `da71efb5509afa36beb073050719ac1094751b98`; pushed cold-start handoff
`d03a3d7b9820494b878336f7d18e5da94b821f68` had reached `origin/main` at that boundary. These docs-only commits
do not change the tag/runtime payload.

The release matrix is **22 delivered / 1 external-only (Aug 8 ask B5, real-provider mapping) /
0 absent**. That ID belongs to the Aug 8 ask matrix and is unrelated to flaw-register B5 above.
Native Universe and
Warmups at 720×520 are accepted; the Warmups frame has no overlay or clipping, Tools offers
**Restore Rep Counter**, and the active set remains unchanged. C2 is delivered in source. The open
half is physical and must now be exercised in installed v8.2: C2's real WKWebView, microphone and
Steinway acceptance remain external;
browser/devMock frames and automated ownership tests cannot prove that
native STT releases the microphone reliably, WKWebView MediaRecorder permission/device ownership
works through real repetitions, kept playback is useful over the Steinway, or the voice grammar
survives the instrument. Keep B90 open until Christian completes packaged-native microphone,
Listen Back and at-piano voice acceptance in the current binary.

**🟠 B84 — devMock coverage is still incomplete, and one gap was actively hiding a bug.**
`region_update` — the command that writes a section's box and colour — had no dev-mock handler,
so offline QA accepted `region_create` and then **silently dropped the geometry**: a section with
no box, indistinguishable from B85's symptom. Found 2026-08-26 while checking whether the
micro-target rebuild would even be visible in the screenshot harness (it would not have been).
**That handler is now written and tested** (`tauriDevMock.regionUpdate.test.ts`, commit
`a44199d`). v7.2 also added faithful `score_micro_target_create` and `rep_close` lifecycle
handlers; **`rep_close` is no longer missing.** A current dispatcher audit still finds **14**
frontend commands without a mock handler: `rep_correct`, `rep_update`, `rep_delete`,
`rep_restart`, `rep_reflect`, `rep_recovery`, `rep_safety_stop`, `rep_adjustment_reverse`,
`session_end`, `session_plan_start`, `retention_confirm`, `retention_lower`, `retention_reopen`
and `retention_snooze`. Each returns typed state or mutates lifecycle truth, so a null stub would
be dishonest. Consequence: browser QA still cannot prove those paths. The B80 rule stands:
devMock must cover every command the frontend calls, and an automated frontend-command ↔
dispatcher parity gate is still missing.


**Moved to Resolved 2026-07-16 (v3.0.0 install) — see §Resolved.** The consecutive-clean
mastery contract, correction/restart, and the durable receipt loop are now installed, not just
proven in source. Voice-over-Steinway acceptance of this behavior remains open under B24.

**Moved to Resolved 2026-07-16 (v3.0.0 install) — see §Resolved.** The read-only anomaly
disclosure panel is now installed in the Ledger workspace, and the live database has passed
integrity/FK checks post-injection. The audited archive/correction (write) flow is still
future work — anomalies remain projected, never repaired, by design.

**Moved to Resolved 2026-07-16 (v3.0.0 install) — see §Resolved.** The global Receipt Center
(unmissable green/red save receipts) and durable `MutationReceipt`s are now installed at shell
level across every workspace. Undo descriptors and all-write audit coverage of any remaining
surfaces stay open as smaller future work.

**🟠 B24 — Voice isolation has real false-negative and false-positive evidence.** Christian reports
missed “done” over the piano. Three production failed-rep notes contain ordinary conversational
phrases; narrated sessions also show natural negatives and rapid micro-drill repetitions that the
2.5-second identical-final dedup can swallow. The grammar must distinguish explicit verdict acts
from ambient fragments, support immediate correction/restart, and preserve a deterministic local
hot loop. A first source fixture now rejects colon timestamps, `no thanks` / `no thank you`, and
ambient `again that I…` / `again like…` / `again just to…` while retaining genuine `again` and
explicit failure cues. UI correction/restart and the shared Rust attempt path now exist, and as of
2026-07-16 every transcript delivery carries the backend's authoritative routing outcome — the
natural-language draft lane can no longer double-open a set the deterministic loop already owns,
and duplicate/stale deliveries surface concise feedback. **The full narrated corpus is now proven
(end of 2026-07-16): all four sessions — 1,309 segments — replay through production routing with
zero false mutations, verbatim fidelity machine-checked.** This is the strongest false-positive
guard the app has: every buried command token, garbled measure number, and conversational
verdict correctly stays inert. **But it exposes the real gap honestly:** these recordings are
conversational narration, not command grammar, so the deterministic firewall (correctly) turns
almost none of Christian's real spoken practice into tracked state. **The first cut of the fix
shipped in v3.1.0**: clearly assistant-directed questions work without a wake phrase, and a
selected-Region natural set request becomes an editable spoken draft requiring `confirm` or
`cancel`; the hot loop stays untouched, malformed proposals drop, and bare yes/no never approve
drafts. Exact `metronome stop` is pinned and its recognized text/state transition is retained for
diagnosis. Still open: live-room recognition/FEEL, conversational corrections beyond the one set
draft, and Goals/Calendar/session-plan actions. Recordings prove state-machine behavior only,
never acoustic grading.

**🟠 B25 — History and workspace architecture do not scale to the data already present.** The
Score view has 34 local state hooks, Shell owns multiple unrelated systems, history requires long
scrolls, Calendar forces an 88rem minimum grid, and Goals fetches all dates from year 1 to 9999.
The app has 559 attempts and already feels unorganized. Future work needs shared typed query boundaries,
disclosure/filter/virtualization, and 720×520 dense fixtures before cosmetic polish.
**v8.2 materially narrows the Score-rendering half:** page slots are virtualized with at most five
nearby `PdfPage` mounts and both Score panes own bounded scrolling. It does not reduce the 34-hook
component or close the History/Calendar/Goals/Shell architecture debt, so B25 remains open.

**🟡 B26 — Brain sees the semantic screen and has one real action, but full operator authority is
unbuilt.** v3.2.0 supplies a visible `Coda sees` receipt for piece, selected Region/range, page,
exact edition, active set,
Today plan, goals/history, notation, and sources; clearly assistant-directed questions work without
a wake phrase; and one selected-Region set request receives editable spoken confirm/cancel. The
model still cannot infer measures from a page alone, edit Goals or Calendar work, persist an
unfinished draft across relaunch, or execute arbitrary UI actions. Those require a complete typed
capability registry—not DOM clicking—and live Steinway FEEL remains open under B24/A1. The Brain
still cannot infer a physical cause or playing quality from notation.

**🟡 B28 — No packaged end-to-end UI suite.** Component coverage is substantial, but there is no
checked-in Playwright/Cypress/native flow suite for score selection, Brain drawer, migration, and
global feedback inside the installed WKWebView. v2's acceptance matrix requires packaged-native
interaction and pixel gates in addition to React tests.

**🟡 B42 — Piece-switch first-decode latency remains after the zoom overhaul (v4 Phase A, source,
unreleased).** The new transform-first pipeline (commit `7d7945a`) fixed zoom/selection: the page
box now scales on the same frame with zero decode work on the zoom-input path, so an in-flight
zoom no longer cancels the render and blanks the canvas. That work never touched piece switching —
opening a different piece still pays PDF.js's initial parse + decode cost cold. **Moved to
Resolved 2026-07-30 (commit `a5ac7a9`, fresh-verifier CONFIRMED, merged):** a fitted first-page
bitmap cache (6-entry memory LRU + bounded 24-entry disk cache under the OS app-cache dir via
`score_page_cache_load/save`) paints an instant display-only preview on switch while the real
page decodes and swaps in on its first raster. Warm first paint is flat ~10–12 ms in the modeled
bench regardless of decode cost (cold tracks the full decode); the real scanned-edition wall
clock is verified at ship QA. Honest residuals (bounded, cosmetic): the disk index write is not
concurrency-locked (a rapid switch race can waste or mislabel one preview entry, retired within
a second by the real raster), and a page-1 render error can leave the preview visible over the
same piece until the next switch.

> **⚠️ CORRECTION, 2026-07-31 (v5.0.0) — the 2026-07-30 resolution above was premature, and the
> record is left standing so the mistake is visible.** The bitmap cache did not fix this; it hid
> it on _warm_ switches while the cold cost stayed catastrophic. Christian re-opened it the next
> day in the strongest terms: _"it was supposed to fix the immense lag the app had. Now it is even
> laggier."_ He was right. Measurement on the real vault found the cold cost was never PDF.js
> "parse + decode" in general — it was **rasterizing a 24-bit colour scan**: Barber _Pas de Deux_
> took **43.13 s** for page 1, Copland _Cowboys with Lassos_ **14.74 s**. Note what the earlier
> diagnosis missed: every **1-bit** scan is fast even at 38.1 MP (Henle, 0.47 s), and an embedded
> **ICC profile is a ~15× multiplier** (Barber 43.13 s vs Prokofiev 2.84 s at near-identical pixel
> counts). File size predicts nothing. **Two process lessons, both already paid for twice:**
> (1) the "modeled bench" figures quoted above were never real wall clock, and a modeled bench is
> what let a 43-second defect ship as _resolved_ — benchmark the real vault files or do not quote a
> number; (2) a cache that makes the warm path fast is not a fix for a slow cold path.
> **Genuinely resolved 2026-07-31 (v5.0.0, commit `771e7d3`):** Rust recognises the
> single-image page and decodes it straight to screen resolution — Barber **87 ms cold / 15 ms
> warm**, Copland **45 ms / 13 ms**, peak RSS 374→159 MB. See B47 for the one residual
> (no live browser QA of the fast path yet).

**🟡 B43 — Auto-OMR is still honestly out of scope (score mapping).** Phase D's wizard finally
renders the **real** PDF page with a parallel measure strip, two-way highlight, and real MusicXML
landmarks (`score_xml_measure_facts`) — but it still does **not** read printed measure numbers off
a scanned page image. A scanned edition with no text layer only gets calibration anchors and
prediction; the human still confirms each line. The wizard removes the pain of a blank placeholder
pane, not the need for a ~2-minute mapping pass. (Ledger 31; commits `81c8c99`/`04220aa`.)

**🟡 B44 — IMSLP downloads require the user's browser, by design.** In installed v8.2.1, the in-app IMSLP flow does
search and edition selection in-app, but the actual file download **hands off to the system
browser** because IMSLP CAPTCHA-gates its download links. This is verified reality, **not
bypassed** — the app asserts an `https` scheme before handoff and then auto-matches the finished
file from Downloads (with picker/drag-drop/paste-URL fallbacks). It is not a silent one-click
import, and it cannot be, without defeating IMSLP's bot check. (Ledger 29; commits
`ee95ce6`/`923333e`/`4c8aa08`.)

**v9 candidate correction:** the normal path is now direct title/composer + local PDF import;
IMSLP is only an optional external public-domain link. The browser/CAPTCHA boundary still exists,
but it no longer makes adding an already-downloaded score complicated. Keep B44 open until the
v9 install/recipient path proves that new flow.

**🟡 B45 — Heading-less books return whole-book excerpts; the reader windows client-side.** For a
huge or heading-less source, `book_excerpt` cannot return a tight section, so it returns the
whole-book (or wide) match and the **reader** windows ±paragraphs around the anchored quote on the
client. The quote is always correct and verbatim (honesty-gate tested), but the surrounding context
is a client-side window, not a real chapter boundary the backend understood. (Ledger 28/30;
`caf54f6` whitespace-normalized the match so hard-wrapped sources still resolve.)

**v9 candidate status:** the Books/Reader path is removed from the distributable UI/source, so
this limitation becomes historical after v9 is actually installed. It is not moved to Resolved
while v8.2.1 remains installed, and historical DB turns are not purged.

**🟡 B46 — `region_id` is plumbed but not passed by the passage-helper hosts.** The
passage-helper/assistant contract carries a `region_id` so a strategy can be tied to an exact
Region, but the current host surfaces (day sheet + Score Plan tab) do **not** yet pass it — so an
accepted strategy appends a plain checkbox line rather than one bound to a specific Region. The
wiring exists; the callers don't use it yet. (Ledger 15; commit `ce9c72d`.)

**v9 candidate status:** passage-helper hosts are removed with the copyrighted pedagogy surface.
That retires the reachable defect only after release/install; it does not justify rewriting old
version records or deleting historical Assistant rows.

**🟡 B47 — Image fast path never exercised in a real browser QA run (v5.0.0).** The dev mock
returns empty for `score_page_image`, so every QA pass this release went through the PDF.js
fallback rather than the new colour-depth-aware decode path — the actual fix Christian asked for
has not been visually confirmed live. Owed: one at-piano check on the Barber. (Commits
`da366dc`/`771e7d3`.)

**🟡 B48 — `stale_marks` (older pencil marks hidden after a re-scan) only surfaces while pencil
mode is on (v5.0.0).** Re-scanning a score orphans its old freehand marks against the new file
fingerprint; the notice that explains this is gated behind pencil mode, so someone who never picks
up the pencil never sees it and may simply believe their marks vanished. (Commit `35c9572`.)

**🟡 B49 — Rare residual in the chamber split: a collision can leave a silent stuck migration
(v5.0.0).** If a collision forces the Barber/Copland split migration to decline, it still stamps
`user_version` 12 and never retries, with no warning surfaced. Cannot fire on Christian's current
data — flagged for completeness, not urgency. (Commit `da366dc`.)

**🟡 B50 — Fast-path refusal costs ~8ms/page, uncached in Rust (v5.0.0).** When the new image
decode path refuses (unfamiliar page shape) and falls back, the vector edition re-parses every
page turn rather than caching the refusal decision. Negligible in practice but real. (Commits
`da366dc`/`771e7d3`.)

**🟡 B51 — Map-this-score wizard's page pane still renders through PDF.js, deliberately
(v5.0.0).** The new colour-depth image fast path was not extended into the mapping wizard's
preview pane this round — that pane intentionally keeps the older PDF.js render path.

**🟡 B52 — `.anomalies-badge-warning` fails AA contrast at small size (pre-existing, out of
scope this round).** `AnomaliesPanel.css` measures **4.47:1 at 11px** — below WCAG AA. Known
before v5.0.0; not touched by this release.

**🟡 B53 — Today's screen still duplicates the shell nav rail (v5.0.0).** The main-menu-style
Today screen (Today's Practice / Score / Assistant / History / Universe / Settings) repeats
entries already reachable from the shell's left rail — redundant navigation, not yet resolved.

**🟡 B55 — At-piano acceptance of the whole v5 UI direction still owed (v5.0.0).** The paper
design system, notebook Today, static Universe, and freehand pencil have not yet had Christian's
hands-on/design verdict — screenshots verdict + a real Steinway session are still open.

**B56 — historical diagnosis; RESOLVED in v7.1.0 (see §Resolved).**
`end_session_and_export` no longer serialised against a concurrent open in v6 Plan A.
Discovered during A5's deadlock-fix rounds: once the ABBA lock
classes were resolved, `end_session_and_export` stopped taking `active` under `lifecycle`,
which removes its serialization against a session opening concurrently. Not new data loss — a
mis-attribution window (a rep can land against the wrong session record) — but it's a real,
currently-unfixed race, not a hypothetical. Fix shape recorded: re-check `active` under
`lifecycle` before export commits. Same finding surfaced a second, smaller gap:
`session_last_event_and_same_local_day` is missing an `ended_at IS NULL` filter. Both are on
the fix backlog for the merge, not fixed on this branch.

> **UPDATE 2026-08-25 (v7.0.1) — PARTIALLY ADDRESSED, DELIBERATELY NOT CLOSED.** The
> exporter-side race described above is fixed: the rep engine's "is a set live?" check now runs
> **inside** `SessionService::end_and_export_guarded`, i.e. with the `lifecycle` lock already
> held, which is lattice order (`lifecycle < current < pause_hook < active < store.conn`) and so
> keeps the round-2 ABBA deadlock class fixed. The second gap named above is also closed:
> `session_last_event_and_same_local_day` gained the missing `ended_at IS NULL` filter, so an
> ended session can never look adoptable.
>
> **A narrower opener-side window remains, and is stated here rather than glossed.** In
> `RepEngine::open_from`, `ensure_session()` returns and releases `lifecycle` at
> `rep/mod.rs:277`, and `self.active` is only locked on the next line, `:278`. Between those two
> lines an exporter holding `lifecycle` can still observe `active == None`, export, and end
> session S — while the opener already holds S and writes its new block against it at `:288`.
> Same mis-attribution class, much smaller window (a few synchronous instructions rather than an
> entire cross-thread call). The same shape exists in the other rep mutations.
>
> Closing it completely means holding `lifecycle` across `[resolve session -> mutate active]` for
> all of `open`/`check`/`undo`/`close`/`checkpoint` — a refactor of the exact hot path that has
> already produced **three separate deadlock classes over three fix rounds**. That was judged too
> risky to improvise inside a stabilization patch, and is scheduled as its own design pass in
> **v7.1.0**. Two candidate complete fixes are recorded in `~/praelude/NOTES.md`: symmetric
> `lifecycle`-holding rep mutations, or pushing the invariant into the store so `v2_open_set`'s
> own transaction refuses to attach a write to a session that is no longer open.
>
> One consequence worth knowing: a pre-existing regression test's assertion was deliberately
> widened. `end_session_and_export_does_not_deadlock_with_a_concurrent_day_boundary_rollover`
> asserted the export always succeeded, which encoded the OLD racy semantics as a requirement —
> with the fix, a concurrent open can legitimately win and the export then correctly refuses
> ("close the active set before ending the session"). It now asserts no-deadlock plus "any error
> is exactly that refusal". Do not restore the old assertion.

> **UPDATE 2026-08-26 (v7.1.0) — RESOLVED.** Every production rep mutation path and both
> retention paths now resolve/adopt their session while the lifecycle lock is held across the
> active-set mutation. The formerly unsafe store entry point is test-only, so production code
> cannot bypass the invariant. The complete evidence is retained under §Resolved.

**🟡 B57 — `resume(Some set_id)` can mint/roll a session before target-set validation (v6 Plan
A, branch).** The A4b resume path calls `ensure_session` before it validates the requested
`set_id` exists/is resumable; a doomed resume call can still leave behind a minted or rolled
session row. Bounded today because the only caller (the Paused Sets tray) only ever passes IDs
it already knows are valid — but the function itself doesn't enforce that, so a future caller
could trip it.

**🟠 B58 — Rehearsal harness cannot green-run on current live-DB copies.**
**Moved to Resolved 2026-08-18 (v6.0.0 install) — see §Resolved.** The 118 "reattributed" rows
were the legitimate July v12 merged→Copland move; the harness resolved the merged piece by its
pre-split title, which exists on no post-split database, so it misread the historic move as
corruption. Harness made split-aware (no production code touched); the migration gate is
trustworthy again and gated the v6.0.0 install.

**🟡 B59 — A5 day-boundary rollover isn't atomic with the write it protects (v6 Plan A,
branch).** The rollover work happens 5 transactions ahead of the write transaction it's meant to
gate — self-healing (a later read reconciles it) but not atomic. Riding along in the same
cluster: `SESSION_START` lost its replay-idempotency `command_id` somewhere in the fix rounds;
`SESSION_START`/`SESSION_END` stamp `datetime('now')` rather than the injected test clock (so
a `SESSION_END` written during a retro-close can show a timestamp inconsistent with its own
record); and the N2 regression test for the deadlock this rollover was involved in originally
hung on an unbounded `join()` ahead of a bounded `recv_timeout` (fixed in the final wave — now
fails cleanly instead of wedging the whole suite if the deadlock ever comes back).

**🟠 B60 — Mounted-hidden staleness is a CLASS, not a one-off (v6 Plan A, branch).** `Shell`
keeps workspace surfaces mounted-hidden rather than unmounting them on tab switch. A11 hit this
concretely: pinning a banner from Today never refreshed the Score tab's `ScoreBanner` if Score
was already mounted-hidden, because nothing published the change anywhere the hidden instance
could see it — fixed for banners specifically with a new `bannerStore` pub/sub seam. The general
lesson: **any future per-piece surface that can be mounted-hidden alongside a writer somewhere
else needs the same store/pub-sub pattern**, or it will silently show stale data with no error,
no crash, nothing — just wrong. Recorded here so Plans B–D don't rediscover this the hard way.

**🟡 B61 — v6 Plan A accepted-minor appendix (branch, all individually bounded, swept here
instead of one entry each).** Dock: live-resize reclamp is a CSS backstop only (no JS resize
listener), and its JS 24px vs CSS 12px safety margin don't match; `loadDockState` still loads
unvalidated shapes from `localStorage` (pre-existing pattern, extended, not newly introduced);
tray auto-open on relaunch overrides a persisted closed panel state (possibly intended — an
at-piano question, not resolved here). Rep/session: `cdRunning` isn't auto-cleared on a
countdown's natural completion (costs one extra click); a provenance check anchors with
`.includes()` instead of `.endsWith()` (safe-direction only); an optimistic "added ✓" toast
doesn't roll back on an eventual save failure (a disclosed trade-off, not silent); `pass_seconds`
past 3600 surfaces the raw backend error instead of client-side bounds feedback; the devMock
doesn't replicate the real `1–3600 CHECK` constraint. Day-sheet: read-only rendering shows "Goal
#id" instead of the goal's title (disclosed scope cut). Autosave: the pre-existing
`useAutosavedDocument` edge (a pending edit exactly at a key-change mid-save can drop) carries
forward untouched by this branch.

**🟡 B62 — Three spec-coverage deltas, decided not silent (v6 Plan A, branch).** Recorded as
decisions, not defects: **S3 snap-to-edge selection was not built** (selection boxes clamp to
score bounds; they do not snap to detected bar edges — that's Plan C's measure-mapping
territory). **S5's date PICKER was not built** (the day-sheet navigator ships arrow-step +
"Today" only, no calendar-grid picker). **S5's "estimate flows into a day-sheet BlockLine's
minutes when planned from the sheet" clause is N/A** — no such flow exists anywhere in the app
to wire it into; the spec's phrasing assumed a mechanism that doesn't exist. Deviation, not a
delta: S3's practice chime uses the webview's native `new Audio()` rather than the Rust audio
output engine — better process isolation, and the mic input path is untouched either way.

**🟡 B63 — Nested `<form>` in Settings/BooksPanel (pre-existing, found by Plan A's final QA
sweep, 2026-08-06).** `BooksPanel.tsx` (~~:154) renders a `<form>` inside `SettingsPanel.tsx`'s
(~~:189) `<form>` — React DOM fires repeated "form cannot be a descendant of form" validation
errors the moment Settings opens, and nested forms have genuinely undefined submit semantics in
HTML. Unrelated to the v6 Plan A surfaces (reproduces on Settings alone); out of Plan A's scope
by ruling. Fix when Settings is next touched: the inner form becomes a fieldset/div with its own
submit handler.

**v9 candidate status:** `BooksPanel` is removed, so this DOM defect is absent from candidate
source. Keep it here until the candidate is installed; installed v8.2.1 still owns the old UI.

**🟡 B64 — History's day-timeline has a 400-day reach ceiling (v6 Plan B, branch, becomes real
~mid-2027).** The Days view pages 21 days at a time via "Earlier days"; paging stops at a 400-day
window, and days older than that are currently unreachable through the UI regardless of how many
times "Earlier days" is clicked. This is honest today only because Christian's practice history
doesn't span 400 days yet — the day it does, the oldest days quietly become unreachable. The
end-state copy was dishonest until the final fix wave (was "You've reached the end of history.",
now "Showing the last 400 days."); the ceiling itself is not yet fixed, only truthfully labeled.
Fix direction recorded: windowed pagination past the cap (fetch further back on demand instead of
a fixed 400-day `history_days` range), not raising the constant. Also folded in here: 400-day
end-state, persistence, and keyboard-navigation behavior at the cap are untested (only paging
within the window is covered).

**🟡 B65 — v6 Plan B accepted-minor appendix (branch, all individually bounded, swept here
instead of one entry each).** A UTC-boundary localtime-bucketing test is blind on TZ=UTC CI
runners (same class as B58's rehearsal-harness note — the test proves the bucketing logic on a
TZ-aware runner but can't self-detect a UTC runner silently no-op'ing the assertion). The new
`history_day_detail` fetch on day-expand lacks a cancelled/stale-response guard that other fetch
seams in the app carry (asymmetry, not a reported bug — bounded because disclosure fetches are
cheap and idempotent). Days-view state resets on tab switch **by design, not an oversight**: B2
deliberately remounts fresh rather than keeping History mounted-hidden, on the B60 lesson from
Plan A (mounted-hidden staleness is a class of bug) — the cost is losing paging progress on
tab-away, which reads as acceptable against showing stale counts. `day_candidates` is a full
UNION scan with no new index, consistent with the plan's stated no-index rule at current data
volume (~1.4k reps, ~30 sessions). The devMock's `history_days`/`history_day_detail`/
`day_sheets_range` handlers don't replicate real range-validation behavior (malformed
`from`/`to` isn't rejected in dev:mock the way the Rust command would reject it).

**🟠 B66 — Cloud-vision measure mapping's honest limits (v6 Plan C, branch, not shipped).**
The real-API acceptance run (Chopin Scherzo No. 2, four evidence-directed algorithm
iterations, C6→C6d) proved printed-number OCR essentially flawless (22/22, then 24/25
digit-exact) but bar-line COUNT geometry unreliable, worst on multi-staff/grand-staff
systems — this is the part of the feature that is genuinely hard, not a bug to be fixed
later. Concretely: expect roughly **9 review pins per 25-page score** (the Scherzo run's
rate); positions the model gets wrong are corrected by drag, which is the designed fallback,
not a degraded mode; each scan is a real per-page API call, so cost and rate-limit
sensitivity are real (2 of 26 Ekier pages were unobtainable within the acceptance run's call
budget after repeated 429s, recorded as a legal partial map); da-capo repeat numbering is out
of scope (print-order numbering only); beats within a measure are not mapped, only bar
boundaries. None of this blocks Apply — it is exactly what the human review gate exists to
catch — but it means mapping a score is real, recurring manual review work, not a one-click
solve.

**🟠 B67 — Claude vision was never exercised; no Anthropic key in Keychain (Christian action
item).** Plan C's provider chain is Claude-primary/Gemini-fallback, matching the existing
Brain plumbing. `security find-generic-password -s codakiller -a claude -w` returns "item not
found" on this Mac — only a Gemini key (`-a gemini`) is configured — so every call in the
entire C6 acceptance run went through Gemini only. The evidence base above (OCR flawless,
barline counting unreliable) is a **Gemini-only read**, not a comparison between the two
providers, and not proof of how Claude vision would perform on the same pages. Add an
Anthropic API key to Keychain (service `codakiller`, account `claude`) to actually exercise
the intended primary path before trusting the feature's real-world accuracy claims.

**🟡 B68 — devMock's mapping reconciliation only demos the C6b subset (v6 Plan C, branch, not
shipped).** The offline dev-mock flow (used for 720×520 QA without real API calls) implements
the system-start-bracket reconciliation algorithm from C6b, not the full C6d algorithm that
actually shipped (cross-page brackets, the MusicXML total as a virtual end anchor, and
positional X-based system-start classification are real-Rust-only). No offline scan-derived
`continuity_break` fixture currently exists in devMock either. Practically: the offline demo
is honest about the _shape_ of the review/Apply flow but understates how good the real
algorithm's reconciliation is on cross-page and pickup-heavy scores. Bringing devMock to full
parity is future work, not required for Plan C to be considered done.

**🟡 B69 — Plan C accepted-minor appendix (branch, all individually bounded, swept here
instead of one entry each).** `measure_map_apply`'s FK violation (applying a map against a
piece/edition that doesn't exist) surfaces sqlite's raw constraint-violation string rather
than a friendly message. `ScanPageOutput` doesn't itself enforce `y_top` ordering across
systems pre-reconcile (reconciliation still catches genuine overlaps; this is a missing input
guard, not a correctness gap). Two printed numbers landing on the exact same bar keep the
first and silently drop the second rather than raising a conflict. A narrow navigation-discard
edge case exists when `scorePracticeContext` is `null` at the moment of a piece switch away
from an open review. The vision prompt's `max_tokens=4096` ceiling is a known truncation risk
on unusually dense pages — watch for it if a future score's pages routinely exceed typical
system counts. **Parked by ruling at the C7 wave re-review (2026-08-08):** a renumber on an
unrelated page can still silently clear a MODEL-derived `continuity_break` (the local TS
reconcile can only reconstruct user-anchor breaks — a blind spot that predates the wave and
was narrowed, not closed, by it); the backend's whole-payload validation backstops the
non-monotonic class, so no malformed map can persist, but the review list can under-report.
Fix shape: retain conflicts keyed by origin (model vs local) across local edits. Also: the
devMock's apply-validation mirror omits only the 256 KB size-cap invariant (unreachable in
mock payloads).

**🟡 B3 — Progressive-revision metronome artifact.** If `hear` emits a fast non-prefix revision
(`Metronome 90` → `Metronome 96`, 213 ms apart, faster than the 600 ms settle), the settler
finalizes the intermediate `90` first, so the metronome briefly starts at 90 then corrects to 96.
Final tempo is correct; the blip is visible/audible. Left as-is because safely collapsing fast
revisions risks merging genuine back-to-back commands. (`NOTES.md`, Task 13.)

**🟡 B4 — The ASR re-send dedup is a coupling, not an invariant.** `hear` re-sends identical finals
0.5–2.3 s later; we dedup on a 2.5 s window keyed on transcript time. P4's page/measure navigation
is deliberately **silent**, so the old safety assumption (“every ack closes the STT gate”) now has
an explicit exception: an intentional identical navigation repeated inside 2.5 s can be swallowed.
That is bounded and preferable to double-jumping on an engine resend, but must be revisited if more
silent commands are added. (`NOTES.md`.)

**🟡 B5 — Homophone / ASR-ism folding is heuristic.** "bump it up four" → `Bumped it up for`;
handled by verb-folding + number-slot homophone maps (`for`→4, `to`/`too`→2), gated on a confirmed
command shape. A curated list, not a general model — new ASR-isms in real use will need adding.
Over-eager folding is guarded ("up to 100" must not become +100) but the guard is rule-based.

**🟡 B6 — `kill -9` can orphan `hear` and strand boost volume.** SIGTERM/close/quit/Drop all clean
up (signal handler kills the `hear` process group; boost volume restores). But an uncatchable
`SIGKILL` skips all of it: a leaked `hear` can hold the mic, and system volume can stay raised.
Documented limitation, same class for both. (`NOTES.md`.)

**🟡 B7 — `say`-fallback test is non-hermetic; Gemini key held as a plain `String` (not
zeroized).** Minor security/robustness notes from review; logged for a later pass.

**🟡 B8 — Region back-fill is an informed guess.** v3 clusters existing blocks whose measure
ranges overlap or touch. This immediately organizes old history, but musical phrases do not
always follow that geometry; Christian may need to rename, split, merge, or reassign the first
time he opens each piece. The cleanup tools exist in v0.3.0; auto-clustering is not claimed to
understand the score.

**🟡 B12 — Brain grounding reduces error; it does not make prose true.** Provider output is bounded
to canonical selected-piece/Region/history/MusicXML/method context, external book chunks are
retrieved locally, citations are allowlisted, and uncited responses fall back offline. Adversarial
reviews hardened forbidden action/hearing/verdict paraphrases and privacy across conversation
turns. The semantic output policy is still a heuristic rather than formal verification, and lexical
retrieval does not prove the model interpreted a passage correctly. A false block is acceptable;
an authoritative-sounding wrong answer remains possible. Inspect the grounding receipt and source,
disagree when needed, and keep human judgment.

**v9 candidate narrowing:** embedded methods/book retrieval/citations are removed. General model
prose can still be wrong if the separate Assistant is enabled, so B12 does not disappear.

**🟡 B20 — The contextual Brain is deliberately bounded and external.** The installed app
indexes exactly four known converted Markdown books as direct regular files in Christian's
external `Knowledge and Resources` folder; the copyrighted books are not bundled. Missing/renamed/
symlinked/oversized files degrade visibly. Retrieval is cached lexical ranking with aliases and
source balancing—not embeddings or universal search—and only up to six hits/two per source are
considered. Conversation keeps a bounded per-piece thread and persists across relaunch; Clear starts
a new thread without deleting the old audit rows. MusicXML
context is notated data for at most 24 selected measures, not performance diagnosis; its edition or
measure numbering may disagree with the PDF, and compressed `.mxl` is not analyzed. These are
honest constraints, not “complete musical understanding.”

**v9 candidate status:** the four-book index and Books UI are removed from the distributable.
The external source folder and historical thread rows are intentionally left in place; v8.2.1
still exposes this behavior until v9 is installed.

**🟡 B17 — Tutorial mapping is manual, local, and source-dependent.** v1.2.0 validates video files
inside a piece's `tutorials/` folder and maps reusable timestamp chapters to Regions; it does not
transcribe a teacher, infer measure numbers automatically, download a source, or guarantee that a
renamed/deleted file still exists. A missing file produces a visible error with confirmed
**Forget broken video** cleanup; Rescan/re-map is deliberate. The Scherzo boundaries were checked
against title cards and score images, but the mm. 551–552 boundary is medium-confidence and the
presenter provides only the name Paul—no surname is invented.

**🟡 B71 — Acks are inaudible when the audio engine is down (pre-existing class, restated for
the v6 chime).** With no metronome engine running, `tts_enqueue` is a no-op, so a rep
check-off in a metronome-off block chimes into silence — exactly as its spoken ack did in v5.
Not a regression; making acks audible engine-down needs a second cpal output stream, which is
an architecture decision deliberately not taken inside a plan lane. The gate cycle still runs,
so dedup safety is unaffected — this is audibility only.

**🟡 B73 — FallbackTts probation admits one retry per CONCURRENT caller (unreachable today).**
The TTS cooldown's probation window is guarded by state that assumes one caller; if
`FallbackTts::synth` were ever called from two threads, each could take a probation attempt.
Today the single Speaker worker serializes all synthesis, so this cannot happen — recorded so
nobody adds a second caller without seeing this.

**🟠 B75 — Cloud-vision measure mapping has never been run on the live database (found
2026-08-20, live read-only audit).** `measure_map` holds **0 rows**. The headline feature of
v6.0.0 has produced exactly zero mappings outside the test suite and the one branch-era Gemini
acceptance run on the Scherzo. Combined with B67 (no Anthropic key, so the Claude path has never
executed at all), the honest position is: measure mapping is **proven in tests, unproven in use**.
Nothing in the docs may describe it as working in practice until a real mapping exists on the live
DB. This is not evidence the feature is broken — only that it is unexercised. v8.1 made the entry
reachable, and current v8.2 retains the explicit provider/prerequisite state, whole-edition upload and the
review/Apply gate. The post-install live audit still found `measure_map = 0`; reachability removes
invisibility, not this empirical gap.

**🟢 B74 — `session.focused_seconds` has never been written (found 2026-08-20). Moved to
Resolved 2026-08-23 (schema v15, v7 Foundations) — see §Resolved.** The dead column was
dropped by the v15 migration; every focus figure was already derived from `event` rows via
`metrics::focused_seconds`, which is now the schema-visible single source of truth.

**B77 — historical measure-map focus-trap diagnosis; RESOLVED in v7.0.1.** The original defect
let Tab reach verdict controls behind the dialog scrim. It is no longer a live path; the complete
diagnosis, fix and honest hidden-focusable residual are retained in §Resolved below.

**B81 — historical silent-`say` diagnosis; RESOLVED in v7.0.0.** The system default voice had
yielded 5 ms of audio when no explicit voice was passed (found 2026-08-24, environmental + code). Diagnosed
while investigating a red `cargo test`. `src-tauri/src/tts/say.rs:73-79` invokes
`say -o <tmp>.wav --data-format=LEI16@22050 -- <text>` and only adds `-v <voice>` when a voice is
configured. With no voice configured it relies on the macOS **default** voice, which on this
machine is degenerate: the app's exact invocation returns **118 frames = 0.005 s** for "test one
two". With an explicit voice the same command is healthy — Samantha 20,734 frames (0.94 s), Alex
0.94 s, Daniel 1.06 s. So this is not a decode bug and not a format bug: the decoded rate is
correct at 22,050 Hz; the synth simply produces near-nothing. Not a wedged service either — it
survives killing every `say`/SpeechSynthesisServer process.

**Why it matters beyond the test.** Since v6, `say` is the FALLBACK when Gemini TTS fails
(cooldown-retry replaced the old session-lifetime lockout). If Gemini is down or the key is
absent, the app will believe it is speaking while emitting 5 ms of silence, and the user gets no
audible answer and no signal that anything failed. The existing "degraded" pill only reflects
Gemini's state, not a hollow `say`.

**Fix shape (two parts).** (1) Pass an explicit voice: use the configured voice when set,
otherwise a known-good installed en_US voice, falling back to no `-v` only if none resolves —
never silently depend on an unset system default. (2) Treat an implausibly short synth for the
given text as a DEGRADED result and surface it through the existing degraded-state UI rather than
"speaking" silence. Part 2 is the honest-over-impressive half: the app must not claim to have
spoken when it produced nothing.

**Historical gate impact:** `tts::say::tests::say_synthesizes_decodable_pcm` failed repeatedly and
blocked release step 3 until the fallback chose a known-good voice and rejected implausibly short
output. v7.0.0's complete release gate then passed; this is not a current red test or blocker.

**🟢 B80 — `brain_intake_apply` has no devMock handler, so the Assistant's only write path
cannot be exercised in `dev:mock` (found 2026-08-24, pre-existing).** The frontend calls it
from `src/features/brain/api.ts:18` and Rust registers it (`lib.rs:1962`, handler list
`lib.rs:2411`), but `src/devMock/tauriDevMock.ts` has no case for it — every other brain
command the frontend calls (`brain_ask`, `brain_plan_preview`, `brain_thread_clear`,
`brain_thread_resume`) does have one. Consequence: in the browser mock harness, accepting a
confirm-gated intake review — the single sanctioned write path out of the Assistant — hits the
mock's unknown-command fallback instead of a real handler, so that flow cannot be QA'd without
the native app. Severity is low (it is a dev-harness gap, not a shipping defect: the real Tauri
command exists and works), but it sits squarely in the class `NOTES.md` warns about — "jsdom
green ≠ app works", and the binding rule that the devMock must cover every command the frontend
calls. Verified pre-existing, not introduced by v7. Found while checking a v7 Plan C executor's
claim that `brain_ask` had no devMock case at all — that claim was wrong (`brain_ask` is
covered); this is the real gap next to it, which is why executor findings get re-checked rather
than filed as-is.

**🟡 B78 — v6.0.1 dock-stacking fix: honest residuals, not fully clean (found 2026-08-21, final
review of the dock stacking floor fix).** The headline v6.0.1 dock fix (`DOCK_Z_BASE`
10/`DOCK_Z_CEILING` 39) leaves several bounded, verified-safe residuals rather than a fully clean
result: (a) on first launch after the upgrade, a panel previously left over the score toolbar
comes to the FRONT — the fix working as intended, but a muscle-memory click could land on a
now-visible verdict button; rep has Undo. (b) At the 720×520 dense floor the rep and clock panels
still overlap by ~15px (Clock's drag handle over rep's bottom padding; no rep control sits in
that band) — proven unavoidable within ~6px given the topbar clearance requirement. (c) The rep
panel still overlaps score-page controls at some sizes; all are navigational/mode/read-only, and
the panel is now the opaque, visible coverer (WYSIWYG) — verified by a 3,300-point click-through
sweep finding zero fall-throughs. (d) `dockPanelZIndex` strict-top ordering degrades past 30
panels (the dock ships 3, so unreachable today). (e) Modal scrims (z 40) now correctly cover dock
panels — intended, but a behaviour change worth a glance during at-piano QA. (f) Below 900px the
zoom control group (part of the B76 toolbar-reflow fix) no longer centres on its own row; it sits
left-aligned in column 2 — measured no overlap, nothing clipped, but it never had design sign-off.

**🟡 B79 — `FloatingPanel.tsx:163` still renders a raw focus rank — the exact defect B76/dock-fix
just fixed elsewhere (found 2026-08-21, left as a re-arming trap).** This file is UNUSED (a
type-import only, never mounted in the live DOM), so it is inert today and was deliberately left
untouched in a patch. If it is ever wired into the live DOM without also picking up
`DOCK_Z_BASE`/`DOCK_Z_CEILING`, it reintroduces the below-page-content stacking defect. Logged so
nobody re-arms it unknowingly.

**🔴 B82 — the verdict buttons were NOT RENDERED at the app's own minimum window size (found
2026-08-25 with the new 720×520 screenshot harness) — RESOLVED same day, v7.0.1.** `Shell.tsx`
seeded the rep HUD collapsed whenever the window was `<= 800` wide **or** `<= 620` tall, and the
collapsed HUD's CSS (`RepHud.css:125-128`) hides every direct child that is not the context row,
the main row, or explicitly marked compact-visible — which included `.rep-hud-entry`, the row
holding **Clean / Sloppy / Again**. `tauri.conf.json` sets `minWidth: 720, minHeight: 520`, so
**every window at or near the app's own supported minimum** met the collapse condition. Measured
in the running app: the three buttons were **0×0**; after clicking "Expand set" they were 131×52 /
117×52 / 117×52 ending at y=365 in a 520 px viewport — **155 px of headroom**, so the collapse was
not buying space it needed. The seed was computed once at mount and never re-evaluated, so a
window grown after launch stayed collapsed forever. The collapsed state kept the pain-safety
button visible while hiding the primary action. **This hid the single action the entire product
exists to record.** Fixed by marking the verdict row compact-visible and deleting the
auto-collapse outright (the OS enforces the 520 px floor and the expanded HUD fits there), leaving
only the deliberate "Collapse set" toggle. Evidence:
`~/praelude/docs/qa/v7.0.1/B82-verdicts-hidden-by-default-720x520.png` and
`B82-fixed-verdicts-visible-720x520.png`. **Why no gate caught it:** ~2,300 passing tests never
could — jsdom applies no CSS and has no layout. It was found within minutes of pointing a real
browser at the supported minimum size, which is why `npm run qa:shots` now exists.

**🟠 B83 — two banned `window.confirm` call sites survived the ban, both failing silently (found
2026-08-25, code audit) — RESOLVED same day, v7.0.1.** `window.confirm` was removed from this
codebase because wry/WKWebView may silently return falsy, and the engineering notes claimed "grep
stays clean". That claim was false. Two live call sites remained, and each failed in a way the
user experiences as "the app ignored me":
(a) `MeasureMapPanel.tsx` guarded discarding a dirty measure-map review — a falsy return made the
discard handler bail, so the **×, Cancel and Escape paths all no-op and the user is trapped in a
dialog they cannot close**.
(b) `ScoreWorkspace.tsx` guarded switching pieces with a dirty review — a falsy return meant
picking a different piece did **nothing at all**, the dropdown snapping back with no explanation.
Both are plausible contributors to B75 (measure mapping has never produced a row on the live DB),
though nothing proves it. Both replaced with the codebase's inline two-step confirm, styled to
read as an active question. Grep now returns only the four comments documenting the ban.
**Process lesson: a prose claim that a grep is clean is not a gate.**

## C. Infrastructure & process

**🟡 C2 — Single user, single machine evidence.** The v9 candidate is deliberately packaged for
another pianist and documents Apple silicon/macOS 13+, blank first install and Gatekeeper's
Control-click/Open Anyway path. That is a design/support claim, not evidence yet: it has still
only been built/tested on Christian's 8 GB M2 Air, macOS 15, and has no Developer ID/notarization.
First-launch TCC prompts (mic + speech) and Dictation remain conditional voice prerequisites.
Keep C2 open until a clean recipient Mac/account completes the install and first-piece flow.

## D. Hard constraints (⚪ — not bugs; facts we design around)

- **⚪ D1 — 8 GB M2 Air.** No local ML runtimes, ever. `hear` uses the OS's own on-device engine
  precisely because we can't host a model. This constraint shaped the entire user-as-sensor design;
  loading heavy models froze the old app's Mac.
- **⚪ D2 — MacBook mic can't grade an acoustic piano** (35–52% note accuracy, timing σ in seconds).
  This is _why_ the app doesn't listen to music — the founding fact, not a bug.
- **⚪ D3 — API TTS needs network.** Offline practice falls back to the system voice automatically
  (quality drop, but never silent — modulo B1's mid-session case).
- **⚪ D4 — Metronome can't exceed hardware max loudness.** Boost mode + limiter-maximized samples
  is the physical ceiling against a loud grand.
- **⚪ D5 — Preview-API rot.** Gemini TTS uses preview endpoints/models; the real response shape had
  to be reverse-engineered against the live API (the docs were wrong). These can change without
  notice — re-verify before touching `tts/`.
- **⚪ D6 — Swift toolchain is broken on this Mac** (no full Xcode; SwiftBridging modulemap + SPM
  link failures). Native SwiftUI is not buildable here — a hard reason the stack is Tauri, not
  native.
- **⚪ D7 — TCC + Dictation prerequisites.** First launch needs one Allow each for Microphone and
  Speech Recognition, and macOS Dictation must be ON (`Code 201` otherwise). **And this repeats
  after every rebuild** (added 2026-07-10): reinstalling a rebuilt ad-hoc-signed `.app`
  invalidates the TCC grants, and the denial is _silent_ — the app looks fine, `hear` runs, but
  no speech ever arrives. Reset (`tccutil reset Microphone com.christian.codakiller`, same for
  `SpeechRecognition`) → fresh prompts → Allow twice. Diagnosis trick: a terminal-launched
  instance inherits the terminal's grant and works, which isolates TCC from pipeline bugs.

---

## Resolved (kept for the honest record)

- **B104 — Studio mutation errors and refresh races (RESOLVED in installed v11.0.0).** Fresh-context review found that profile/purchase errors could appear behind the modal and an evidence refresh arriving during a mutation could be lost. Dialog-local alerts/retry and queued refresh make failures recoverable without hiding changed progress. Stale writes refuse; repeat clicks cannot double-charge. Fixed by `a33858139430b99bd22c8a2d0fa06fa6b1b2f4f1`; independent UI recheck and full frontend/native gates pass.

- **B105 — shared modal focus/background and workspace scroll defects (RESOLVED in installed v11.0.0).** Keyboard focus could escape an open dialog and background interaction/old scroll offsets could survive workspace changes. The shared dialog isolates its background, traps/restores focus, and navigation resets workspace scroll. Studio-local cleanup also reopened the Rep Counter over other browsing views; shell-owned tucking now preserves manual choices and restores auto-tucked panels only on Score/Warmups. Ephemeral user-action provenance differentiates automatic panel reveal and preserves manual restore/minimize/close through persisted and delayed-load cases. Final independent dock review passes; 222 broad dock/Shell checks pass. Fixed by `a33858139430b99bd22c8a2d0fa06fa6b1b2f4f1`; independent UI recheck and full frontend/native gates pass.

- **B106 — Library menu keyboard and folder rename hazards (RESOLVED in installed v11.0.0).** The new anchored menus exposed Tab/focus restoration and rename-input/Save defects. The applied fix preserves focus through rename edits, dismisses coherently on Tab and invalidates menus when their piece/folder anchor disappears. Final fresh-context menu/form and library interaction review passes with no remaining source blockers. Fixed by `a33858139430b99bd22c8a2d0fa06fa6b1b2f4f1`; independent UI recheck and full frontend/native gates pass.

- **B103 — routine editor hazards found during v10.1.0 review.** Fixed in `1543c06`: deletion confirmation could scroll outside the compact transformed dialog, and Enter in editable chain fields could implicitly start practice. Inline confirmation and input Enter suppression preserve editing. Fresh-context 720×520 browser reproduction/rechecks and regression tests pass.

- **B102 — oversized/incomplete practice bar and overlap in ordinary windows (2026-09-07).** Fixed by implementation `58b0413`, installed v10.0.5. Bounded identity, direct Goal/metronome/tempo fields and measured workspace-width reflow replace the v10.0.4 layout. Fresh-context rendered QA covers minimum/normal/wide-short windows, long labels, active notices and dialogs; all release/data gates pass. Native v10.0.5 real Score/bar was observed on Scherzo No.2 / Rolled Chords on 2026-09-07 after the Desktop permission blocker cleared. Broader real-use/Steinway gates remain separate.

- **B101 — a short Score viewport could force the selected-passage desktop strip into a mobile
  layout and overlap Practice set controls — RESOLVED IN INSTALLED v10.0.4, 2026-09-04,
  implementation/tag `48e7d00`.** Christian’s 2,648×390 screenshot showed the height media
  query collapsing a wide desktop into two columns, leaving Practice set, its summary, Start set,
  Variants and Settings visually competing. The repair removes height as a compact-layout trigger,
  assigns explicit wide-strip slots, gives the active-set message its own row and uses named areas
  only below 800px. Rendered QA at 2,048×390 and 2,648×390 found no overlap or clipping; a
  fresh-context review, focused ScoreView tests, full frontend/native release gates and fresh
  installed launch pass. This closes the concrete collision; Christian’s overall real-use feel
  verdict remains open.

- **B100 — centered practice dialogs and the compact passage surface could be clipped by their
  transformed Score ancestor — RESOLVED before Praelude v10.0.0 ship, 2026-09-03, implementation
  `e67b3c2`.** Desktop and 720×520 visual QA found that a backdrop filter changed the containing
  block for fixed dialogs, then found the compact passage sheet could hide its lower controls.
  The final UI removes that transformed ancestor and anchors the compact sheet to the usable
  viewport with bounded vertical scrolling. Variant and Settings dialogs center over the full app
  with a blurred scrim; all essential passage controls remain reachable. This closes the concrete
  containment defect, not the still-open Christian real-use feel verdict.

- **B95 — installed v8.2.0 could terminate immediately after ending a session because its camera
  privacy manifest was incomplete — RESOLVED IN INSTALLED v8.2.1, 2026-08-28.** Session 48 closed
  successfully and its data persisted, then the app exited less than
  one second later. The ordinary **End session** path mounted `DayPhotoCapture`, which
  automatically called the camera API while the packaged Info.plist lacked
  `NSCameraUsageDescription`; macOS TCC raised `SIGABRT` before JavaScript could handle a
  rejection. Six retained reports spanning v7.0–v8.2 share the signature. Source now separates
  manual close intent: plain End session never offers the ritual or requests camera; only
  confirmed End my day offers the photo card; merely showing it requests nothing; explicit
  **Use camera** acquires the stream; and synchronous/rejected camera failures fall back to file
  choice. The source plist carries a truthful camera description, and the release script checks
  camera, microphone and speech-recognition descriptions in the built bundle. The crash-left
  orphan `hear` PID was cleaned. Final frontend 2,684/1 skipped, native 1,109/19 ignored,
  TypeScript, strict Clippy, production + native builds, five corpora and all eight release gates
  pass. Installed exact Camera/Mic/Speech strings, signature, artifact/data and fresh launch pass.
  Pre-install backup
  `(C) pre-v8.2.1-install-2026-08-28-132046.db` is 23,449,600 bytes, SHA-256
  `2c99dec1c3bc14f595e69c92a9415076299752d46930eea0fa3c9f5a793379c7`; schema 20,
  integrity OK/FK0, 11 pieces, 246 blocks/contracts, 2,207 reps, 48 sessions, 8,391 events, zero
  open sessions/blocks. Fresh v8.2.1 launch stayed live as PID 46013 with its owned `hear` child
  and no new crash report. B95 is package-resolved; tag `v8.2.1` is pushed at
  `971a0d2dc7cf8f093527239e2394391dbbfec0a4`.

- **B94 — v8.2.0's Score composer still wasted vertical space and buried Start — RESOLVED IN
  INSTALLED v8.2.1, 2026-08-28.** Christian's installed screenshot
  showed the real narrow rail, where generic flex wrapping turned From/To, Start/Target BPM and
  Focus/Metronome into six full-width rows. Start sat after optional controls, and the always-open
  custom-variant field added another row. Installed v8.2.1 uses explicit paired measure/BPM
  grids, compact Focus/Metronome and target mode/count rows, a pinned header-level Start action,
  and **+ Custom** disclosure with focus. Tricky Sections remains the sole scroll owner. Browser
  verification at 720x520 found Start immediately reachable and no horizontal overflow; frontend
  2,680/1 skipped and TypeScript/build pass; final v8.2.1 gates later pass at frontend 2,684/1
  skipped and native 1,109/19 ignored. The broader installed WKWebView Score-feel verdict remains
  B91, not B94.

- **B92 — Total plays initially leaked into mastery truth, and its target selector initially lacked
  true radio keyboard behavior — RESOLVED before v8.2 ship, 2026-08-27, fixing source
  `afe65f3b176a1c5da81eca6d2f65bd721726ee40`.** Fresh-context verification showed that five mixed
  or sloppy plays could finish correctly in the HUD yet still feed downstream mastered-set counts,
  Universe mastery evidence/badges and `mastery_landing` completion FX; Score/History copy also
  called the result mastery. The same pass found the visual two-choice target control was not a
  complete radio interaction. The final release propagates `mastery_basis`, labels total-play
  history as target completion, filters it from mastery aggregates/evidence, uses neutral
  set-complete FX and preserves clean-streak behavior. The selector now has roving Tab focus and
  Arrow/Home/End behavior. Regression tests cover both. There is no remaining target-radio flaw.

- **B93 — Score/practice UI consumed time with a one-page/blank-canvas posture, non-revealing rail,
  giant variants and excessive chrome — RESOLVED in installed v8.2.0, 2026-08-27, source
  `afe65f3b176a1c5da81eca6d2f65bd721726ee40`.** Christian's screenshots were the acceptance input.
  Score is now a continuous bounded virtualized document; PDF and Tricky Sections scroll
  independently; expanded practice auto-reveals; normal pages do not mount blank Pencil canvases;
  Score tools and utility dock items are grouped; variants are one preset line plus 32px rows.
  Browser frames pass at 720×520 and 1462×919. Installed-native feel remains separately open as
  B91 rather than being overclaimed here.

- **B88 — no per-set demotion override or quick running-HUD subdivision — RESOLVED 2026-08-27,
  v8.1.0, fixing commit `9a4aeba1e55d1b51d6c2c8a18da0ada48181b921`.** That behavior, retained in
  current v8.2, lets one set inherit the global Sloppy thresholds, disable demotion, or use its own first and
  later thresholds. The running Rep Counter exposes bounded **sub N** −/+ controls from 1–16 and
  retunes the live click without changing the entered BPM's beat-unit meaning. The v8.1 package,
  schema-19 install and full release gates passed; this closes the v7.2 interaction gap without
  rewriting that release's historical limitation.

- **B89 — a lost spot-create reply could be manually retried into a duplicate — RESOLVED
  2026-08-27, v8.1.0, fixing commit `9a4aeba1e55d1b51d6c2c8a18da0ada48181b921`.** Every drag now
  owns one durable command ID and payload fingerprint. The frontend retries once with the exact
  same identity/payload; the store returns the already-committed Region receipt, while reuse of
  that identity with different geometry conflicts. devMock mirrors the contract. The installed
  schema-19 package and release gates passed; no duplicate had been observed before the fix.

- **B85 — Micro-target creation required six steps and could leave no persistent box — RESOLVED
  2026-08-27, v7.2.0, fixing commit `7a5061d`.** Christian's v7.1 report was blunt and correct: the flow demanded a title,
  two measure numbers and a second drag, while child boxes rendered without parent gating. v7.2's
  installed flow is select an anchored parent → **Isolate a spot** → drag one contained box.
  Pointer-up atomically writes the child Region, explicit parent, automatic monotonic `Spot N`
  name, calm colour, inferred measures and matching edition/fingerprint anchor. There is no form,
  typing or redraw. Undo lasts eight seconds; children show only with their parent/child selected;
  **Hide spots** persists per parent. **Practice this** resumes the latest paused spot set or
  starts a contextual three-clean set, while an active-set conflict explains itself without a
  write. The direct action refreshes the block list before choosing a paused set and matches the
  exact `region_id`, so two sibling spots with the same inferred measure range cannot resume each
  other's set; the already-running message stays generic. The **Practice this** chip disappears
  while target drawing, measure mapping, Pencil, spot drawing, or an in-flight save owns the
  score pointer. Legacy unlinked boxes are inferred only when strict measure containment, same-edition
  geometry and every child-rect centre identify exactly one parent; inference never rewrites the
  database. The unified overlay carries Regions, creation/mapping state and atlas drafts through
  one pointer/render path.

- **B86 — a variant chain could declare mastery after its first stage and never close — RESOLVED
  2026-08-27, v7.2.0, fixing commit `7a5061d`.** The old mastery rule ignored the chain whenever a target tempo existed,
  exactly the normal real-use case, and completion animation never closed the set. Now a nonempty
  chain governs every focus and target shape. The HUD shows the projected stage and consecutive
  cleans; Flawed resets that stage, Failed/Again neither advances nor resets it, and durable
  attribution uses that same stage. Legacy `reps` remains the fallback when `clean_streak` is
  absent. Ordinary and chained mastery hold for a cancellable six-second countdown with **Stay
  open**, then close; one transient close failure gets exactly one bounded retry. Recovery,
  correction and undo replay the same truth. Recovery synchronously cancels a pending auto-close
  before its IPC begins, and the timer rechecks live eligibility before closing. The stage chime
  fires only for a genuine forward, intermediate transition caused by a new Clean—including a
  one-clean opening stage—and never for undo, final mastery or extra Clean attempts.

- **B87 — deterministic acknowledgements spoke when Christian wanted quiet — RESOLVED
  2026-08-27, v7.2.0, fixing commit `7a5061d`.** **Speak confirmations aloud** is now an immediate Settings switch,
  default off. Routine acknowledgements use the existing short chime when speech is off, including
  the direct `voice_speak` path. Voice input is unchanged and the Assistant remains separately
  off/gated.

  **Acceptance boundary for B85–B87:** the signed v7.2 app installed and launched, database
  preservation and all release gates passed, and the complete 720×520 workflow passed in the
  browser/devMock. Christian has not yet accepted these interactions in packaged-native use or at
  the Steinway; that release-level evidence remains owed.

- **B56 — session-end/open race — RESOLVED 2026-08-26, v7.1.0.** v7.0.1 fixed the exporter
  side but deliberately left a smaller opener window. v7.1.0 closed that window across all 14
  rep mutation paths and both retention paths by holding session lifecycle ownership through
  resolution and the active-set mutation. The unsafe lower-level API is `#[cfg(test)]`, making
  the production invariant compiler-enforced. Concurrency regressions cover open/checkpoint,
  day rollover, close/export refusal and ended-session adoption without reviving the earlier
  ABBA deadlocks.

- **B77 — measure-map dialog had no focus trap (found 2026-08-21) — RESOLVED 2026-08-25, v7.0.1.**
  `MeasureMapPanel.tsx` was `role="dialog"` without `aria-modal`, so Tab from inside it reached
  ~25 dock-panel controls behind the scrim — **including Clean/Sloppy/Again, where Enter recorded
  a real rep**. Now `aria-modal="true"`, Tab and Shift+Tab cycle within the dialog, Escape closes
  through the panel's own dirty-confirm path, and focus returns to whatever opened it. A first
  implementation of the trap introduced a fresh bug — its effect depended on a callback that
  changes whenever the review becomes dirty, so it tore down mid-use and yanked focus to a button
  *behind the scrim*; that was caught in review and fixed by holding the handler in a ref.
  **Honest residual:** the trap's focusable-element query does not filter CSS-hidden elements
  (jsdom cannot see them, so a filter made the tests meaningless). No element in this dialog is
  currently hidden-but-present, so it is not exploitable today — but a future contributor adding
  a CSS-hidden focusable control would silently break the trap in a real browser while the tests
  stayed green.

- **B4 — the "Save section" editor overlapped at small window sizes (reported from real use,
  Aug 8) — RESOLVED 2026-08-25, v7.0.1.** The cause was not what was first assumed. The editor's
  measure fields (`.region-measure-fields`) are a non-wrapping row of two fixed 5rem inputs (~170
  px) sitting in a grid column declared `minmax(0, 1fr)` — which explicitly permits the column to
  shrink **below** its content's width. In the score view's narrow sections panel at the 720 px
  floor, that row overflowed its column and spilled rightward across the "Save section" button in
  the next column. Fixed: the grid collapses to a single column when narrow, the measure row
  wraps, and the inputs shrink. **Honest limit:** the fix was pinned by a test that reads the
  stylesheet as text, because this project's test environment has no layout engine and does not
  load CSS — and the wide-window behaviour was reasoned about rather than measured, so it is
  worth an eye on the installed app.

- **B74 — dead `session.focused_seconds` column (found 2026-08-20) — RESOLVED 2026-08-23
  (schema v15, commit `5ba6583`, merged `45070c9`).** The column (added in schema v3, NULL on
  every session ever recorded) is dropped by the v15 migration, per the 2026-08-20 decision.
  Two runtime guards precede the DROP: a SQLite ≥3.35 check and a `sqlite_master` scan
  refusing the step if any index/view/trigger still references the column. Rehearsed on a
  fresh copy of the 2026-08-21 backup: `user_version` 15, integrity ok, row counts preserved
  (9/179/1710/37), the three new v7 tables present (`day_photo`, `dynamics_profile`,
  `dynamics_calibration_point`). The event-derived `metrics::focused_seconds` heuristic is now
  the schema-visible single source of truth, not just the de-facto one.

- **B54 / C1 — No off-disk backup (open since 2026-07-30, the project's oldest unfixed risk)
  — RESOLVED, 2026-08-23.** `git remote` was empty and the repo was local-only on `main`; a
  disk failure would have lost the entire project. Fixed: Christian ran `gh auth login`
  (authenticated as `cchow375`); `gh repo create codakiller --private --source=. --push`
  created the private remote at https://github.com/cchow375/praelude and pushed `main`. A
  follow-up `gh auth setup-git` was required before plain `git push --tags` could
  authenticate — the initial push had used `gh`'s own credentials, so raw `git` failed with
  "could not read Username" on `push --tags`; once `gh auth setup-git` ran, tags pushed
  successfully. Verified state: 373 commits; 25 local tags / 25 remote tags (all release tags
  through v6.0.1); remote `main` at `d9fa0fe`, identical to local HEAD; `.git` is 49MB. `docs/`
  is tracked in the repo, so the repo's own engineering docs (specs, plans, QA records,
  `NOTES.md`) are included in the backup. **Scope limit, stated plainly:** this backs up the
  git repo only — the Obsidian vault itself (these markdown files, which live outside the git
  repo) and untracked build artifacts are still NOT backed up anywhere off-disk.

- **B76 — Score toolbar top row overlaps at real window widths (v6.0.0, reported from real use
  2026-08-20) — RESOLVED (installed), 2026-08-21, v6.0.1 (commits `b05b0db`, `c3cc6e4`,
  `71f7902`).** `.score-edition-group` (`ScoreView.tsx:2566`) holds six controls in a
  no-wrap flex row (`ScoreView.css:81-100`); the only narrow-width media query (900px) restacks
  `.score-zoom` but never reflows the edition group, so its controls collide/overflow at real
  window widths Christian actually uses. Found in the first genuine at-piano session on v6.0.0
  (2026-08-20). Fix scheduled first in v6.0.1: wrap + narrow reflow, an overflow menu only if
  still needed by eye, 720×520 screenshot QA. **Root causes were two:** `.score-edition-group`
  had no `flex-wrap`, and `.score-edition`'s `flex: 1` let the label shrink below its content so
  the Edition `<select>` painted over the "Draw target"/"Cancel drawing" button. Fixed with wrap
  - `flex: 0 1 auto`; the armed-target hint takes its own line. The reflow breakpoint moved to its
    own `@media (max-width: 1200px)` (measured natural crossover 1145px, +55px headroom) because at
    900px the toolbar was TALLER at 910px than at 900px; `.score-body { --score-sidebar-width:
340px }` deliberately stays at 900px. Verified overlaps: NONE across a 720→1600 sweep, idle and
    target-armed, plus a 70-char edition-label stress case. One regression the fix itself
    introduced was caught and fixed: `overflow: hidden` clipped the select's keyboard focus ring on
    three sides (WCAG 2.4.7). See also B78 for the below-900px zoom-row residual this fix left
    without design sign-off.

- **B72 — Settings nests a form inside a form (pre-existing since v5.0.0, surfaced by v6
  smoke QA) — RESOLVED (installed), 2026-08-21, v6.0.1 (commits `274aa0c`, `3f28ed0`).**
  BooksPanel's "Add a book" `<form>` sits inside the settings `<form>` — invalid
  HTML that React flags as an error in dev builds. Everything works in practice, but nested-form
  submit semantics are browser-defined; the books add-row should become a non-form group. Low
  risk, cheap fix, first v6.0.x candidate. Fixed by making the form a `role="group"`;
  Enter-to-submit explicitly wired on every text input (title, path, author). The Kind `<select>`
  is deliberately excluded: modern browsers don't implicitly submit through a closed select, so
  that is parity, not a regression.

- **B70 — Fast-path tail guard suppresses by prefix, not by routed intent (v6.0.0, shipped,
  found by the second adversarial verification) — RESOLVED (installed), 2026-08-21, v6.0.1
  (commits `c1d16a8`, `1a0a3c1`).** The voice fast path (the thing that makes
  "metronome off" act in under a second) fires on a partial transcript and then swallows the
  settled final for 2.5 s so the command doesn't double-fire. But the swallow is keyed on the
  PREFIX, not on whether the final means the same thing. Two proven consequences: (a)
  "metronome on ninety six" starts the click at the OLD tempo — the "ninety six" arrives in the
  suppressed final and is silently lost; (b) an ambient sentence beginning exactly with
  "metronome off …" ("metronome off the whole time honestly") stops the click even though the
  full sentence routes to Ignored, and the heard pill never shows the full sentence. Zero
  occurrences across the 1,309-utterance corpus, so this shipped as a documented limit rather
  than blocking the install; say "metronome 96" (which is safe and routes with the tempo) rather
  than "metronome on 96" until fixed. The fix shape is known: suppress the final only when its
  ROUTED INTENT matches what the fast path already did. **Fixed:** the fast-path tail guard now
  suppresses a settled final by ROUTED INTENT instead of text prefix, is consumed on use, and is
  cleared by any acted command. "metronome on ninety six" now sets 96 (the workaround "metronome
  96" is no longer needed); an ambient sentence starting "metronome off …" that routes to Ignored
  neither stops the click nor gets swallowed from the heard pill. Adversarial review REFUTED the
  first attempt: suppressing by intent alone silently lost a genuine re-phrased command ("turn
  the metronome off") inside the 2.5s window — action AND transcript — which the
  consume-on-use + clear-on-dispatch rules fixed. A deliberate, documented consequence: an
  out-of-vocab tail (e.g. "metronome off now ok") now surfaces honestly as a second
  handled=false final rather than being hidden; the module invariant is now "at most one ACTED
  final per utterance".

- **B40 — Universe click/teleport: clicking a galaxy ball recentred it instead of opening the
  piece — RESOLVED (source, unreleased), 2026-07-27/28, v4 Phase A (commit `502eaab`).** Root
  cause: v3.2.0's `853f440` made nodes keyboard-focusable; a mouse press focused the node and the
  browser's native focus-scroll recentred it (~750px), swallowing the perceived click. Fix:
  `preventDefault()` in the delegated `onPointerDown` (Tab/Enter accessibility preserved) plus a
  biting regression test. `universe/UniverseWorkspace.*`.

- **B41 — Rep-counter/rung-completion display reset-to-0 on success — RESOLVED (source,
  unreleased), 2026-07-27/28, v4 Phase A (commit `998ff93`).** No mechanical defect exists —
  engine, tempo ladder, two-streak projection, and metronome ownership are all correct (79/79 +
  11/11 targeted tests confirmed it; the perceived "lag" is an intentional 150 ms drag throttle).
  Root cause of "my clean didn't count / it reset": on the clean that _completes_ a rung, the
  tempo steps and the HUD headline dropped to 0/N at the moment of success, reading as a wipe.
  Fix (display-only): a ~1.2 s filled-rung hold — "N/N ✓ → ♩next" — before the new rung shows, and
  the "Streak reset" pulse now only fires when a real streak (>0) broke. `rep/RepHud.*`.

- **B39 — Tempo-set clean-streak headline sat frozen at "0/N" while climbing to target —
  RESOLVED (installed), 2026-07-22, v3.2.0 hotfix (commit `f57cebe`).** On a Tempo set climbing
  to a higher target BPM, the HUD's big number showed the **target-mastery** streak
  (`mastery_progress_streak`), which is legitimately 0 until the working tempo reaches the target —
  so every logged clean _below_ target looked ignored (the number never moved) while the streak
  that actually advanced (the rung, `current_clean_streak`) was hidden in the Details fold. Christian
  hit this live climbing 45 → 52 and abandoned two sets (DB blocks 70/71). Fix (display only,
  `src/features/rep/RepHud.tsx`): while below target the headline is now the **rung** streak that
  moves per clean (`current rung / cleans-to-step`) with a "Climbing to ♩{target} — then {N} clean in
  a row" caption and a ♩{bpm} → {target} hint; at/above target it reverts to the N-in-a-row target
  proof. Never renders a _false_ mastery fraction — shows the honest rung fraction — and now agrees
  with the spoken "Rung X of N". No data/schema/engine change. Gates: tsc clean, frontend 1026/0, rep
  suite 69/0 (2 new regression tests), fresh-context verifier CONFIRMED. Root cause in
  `src-tauri/src/store/practice_v2.rs` + test `sub_target_speech_reports_rung_not_a_false_mastery_fraction`.

- **B38 — Long-session systems disagreed about ownership, destinations, and preserved work —
  RESOLVED (installed), 2026-07-20, v3.2.0 (commit `853f440`).** A manual click and a practice
  set now have explicit native metronome ownership; live sets block session end and close before
  graceful export; reviewed multi-item plans and Score page/Region/edit/zoom state survive normal
  workspace switches; Today/Universe links carry the exact inner surface and piece on every request;
  hidden Score cannot capture paging/voice events; Ledger Pieces publishes exact Brain context;
  Settings returns where opened; Universe and nested tabs have keyboard semantics; and sticky
  errors/confirmations cannot be evicted. A 220-attempt relaunch/recovery/export simulation,
  interactive mock drive, 1,025 frontend tests, 529 Rust/integration tests, and a fresh verifier
  passed. Real Steinway recognition remains A1/B24, not silently claimed resolved.

- **B37 — No obvious daily intention or trustworthy in-app guide; compact HUD could cover the
  workspace — RESOLVED (installed), 2026-07-20, v3.1.0 (commit `36f21fd`).** Today now has a
  date-scoped plain-language plan box included in Brain context; Settings contains the exact golden
  loop, command examples, confirmation rules, and limits; and at 720×520 the active-set HUD enters
  normal page flow while preserving the emergency safety stop. Honest remainder: Today's plan is
  local WebView storage, not SQLite/export/Goal/Calendar state.
- **B36 — v3 shell left the Brain disconnected from the visible Score and required memorized wake
  phrasing — RESOLVED for the first safe operator slice (installed), 2026-07-20, v3.1.0 (commit
  `36f21fd`).** Brain now receives the visible piece/Region/page/exact edition/active set/Today plan,
  assistant-directed questions work without a wake phrase, and a selected-Region natural set request
  becomes an editable spoken draft with exact-once voice `confirm`/`cancel`. The broader operator
  gap remains open as B26; this entry does not claim arbitrary UI control.
- **B35 — Metronome start/stop/set-open paths fought one another and could publish stale state —
  RESOLVED (installed), 2026-07-20, v3.1.0 (commit `36f21fd`).** Opening a set now starts once,
  live-retunes, or no-ops from authoritative state. UI, voice, ladder, and safety paths share one
  serialized native mutate→persist→publish boundary. Exact stop phrases are regression-locked and
  their recognized text plus before/after state is retained. Real-room recognition remains B24.
- **B34 — Routine save/rep receipts blocked the app until manually dismissed — RESOLVED
  (installed), 2026-07-20, v3.1.0 (commit `36f21fd`).** Routine committed/undone/duplicate receipts
  disappear after 1.5 seconds and do not intercept the workspace. Errors and confirmation-required
  cards correctly remain persistent and dismissible.
- **B27 — Installed app silently excluded the fourth practice book — RESOLVED (installed),
  2026-07-16 and user-copy reconciled in v3.1.0.** Gieseking/Leimer joins Roskell, Gebrian, and
  Breth with exact metadata, mental-practice/score-study routing, visual-dependency labeling, and
  a historical-pedagogy caveat. Four-book synthetic/real retrieval gates pass and the current
  guide says four.
- **B33 — v3.0.0-3.0.3 legacy-token blackout: invisible metronome, unstyled practice form
  ("gradient buttons"), plus a text-clutter regression set — RESOLVED (installed),
  2026-07-17, v3.0.4 (commit `780b2d0`).** Found by Christian 2026-07-17 as five symptoms:
  Score tab laggy + always defaulting to the BUTI chamber piece, unreadable text-wall
  Practice tab, "gradient buttons for selections", a metronome that opened low-opacity and
  clipped in the corner, and general text clutter. Root cause for the first-class breakage:
  v1-era stylesheets consume ~40 legacy token names that the v3 retheme aliased only inside
  specific scopes — anything mounted outside them (the popover shell at the app root, the
  practice form in the Score tab) rendered transparent/unstyled; the "gradients" were raw
  macOS native selects/checkbox showing through. Fixed by defining the legacy alias set
  globally, flipping popovers above their trigger when out of room, extracting the form kit
  to a shared stylesheet with flat monochrome controls, compacting the practice HUD behind
  a Details fold (and stopping the recovery desk auto-open), remembering the last Score
  piece, deferring neighbor-page decodes, and cutting aphorism/explainer copy across
  Today/Ledger/Universe. Verified by before/after headless screenshots + adversarial
  verifier.
- **B32 — v3.0.0-3.0.2 the Score tab's Practice button did nothing at all — RESOLVED
  (installed), 2026-07-17, v3.0.3 (commit `5a521a1`).** Found by Christian 2026-07-17
  ("trying to practice the Griffes… if I click Practice, nothing shows up, literally
  nothing"), fixed within the hour. Root cause: the Practice tab inside the score's section
  inspector only renders its start-a-set form when the shell's practice-open handler is
  passed in — and the v3 Score tab mounted the score workspace without it, so the tab showed
  the tab strip and then literally nothing. (Practice still worked via Ledger → Pieces,
  which is why the v3 parity audit missed it: it checked that surfaces mount, not that this
  seam was threaded on the new Score tab path.) Now the shell passes its rep-open seam into
  the Score workspace, so Practice on any section shows the block form and an opened set
  appears in the shell-level practice HUD — identical behavior to the Pieces path. Guarded
  by two new wiring tests (workspace-level and shell-level).
- **B31 — v3.0.0-3.0.1 target-draft dock blocked the Score view's top corner when empty —
  RESOLVED (installed), 2026-07-17, v3.0.2 (commit `6a32bc8`).** Found by Christian
  2026-07-17, fixed same session. The target-draft dock ("Mark the music first.") used to
  float pinned over the Score view's top corner even with no box drawn, unmovable, blocking
  controls. Now no floating panel exists until a box is drawn (a quiet toolbar hint carries
  discoverability instead); once a draft exists the dock is collapsible to a slim bar and
  repositionable (top-right ⇄ bottom-right corner toggle) and structurally cannot cover the
  page controls.
- **B30 — v3.0.0's Score view rendered all PDF pages as one continuous strip — RESOLVED
  (installed), 2026-07-16, v3.0.1 (commit `92cfdb7`).** Christian found this in his first
  hands-on testing, within the hour of the v3.0.0 install: the whole 25-page score rendered
  as one long scrolling strip (laggy) and the tricky-sections panel pinned/scrolled with it
  instead of scrolling independently. Fixed the same night: Score view is now a true paged
  reader — one page fit to the window, navigation via ‹ › buttons, a typed page number, or
  PageUp/PageDown/←/→, only current page ±1 ever rendered (never more than 3 canvases,
  verified on the real 25-page document), zoomed pages scroll within their own pane, and the
  sections panel scrolls independently. **Honest caveat:** this resolves the rendering-
  performance/independent-scroll defect only; Christian's broader at-piano acceptance of
  v3.0.0/v3.0.1 (voice, wizard feel, Universe) remains open under A1.
- **B21 — v1's completion could report success with zero clean attempts — RESOLVED (installed),
  2026-07-16, v3.0.0 (commits `56dada3`/`c53230a`/`b2e751f`).** `reps_done` used to increment for
  every verdict and `cleans_at_step` accumulated non-consecutive cleans, so a block could exhaust
  its target with zero clean attempts. The installed PracticeContract RepEngine now requires a
  real configurable consecutive-clean streak for mastery; flawed/failed attempts reset it;
  correction/restart/undo are append-only and auditable. **Honest caveat:** this resolves the
  completion-semantics defect; voice-over-Steinway acceptance of the same behavior is tracked
  separately under B24/A1.
- **B22 — Live schema data anomalies were unexplained to the user — RESOLVED (installed),
  2026-07-16, v3.0.0.** The read-only anomaly disclosure panel (792 rows grouped by kind, each
  with a plain-language "what this means"/"why it is disclosed, not repaired") now lives in the
  installed Ledger workspace. The live database passed integrity/FK checks after the v3.0.0
  anchor injection. **Honest caveat:** the audited archive/correction (write) flow remains
  deliberately unbuilt — anomalies stay projected, never repaired.
- **B23 — Important write failures could be invisible — RESOLVED (installed), 2026-07-16,
  v3.0.0.** The global Receipt Center (unmissable green/red save receipts, durable
  `MutationReceipt`s with command IDs and idempotent replay) is now installed at shell level
  across every workspace, not just the practice-semantic path. **Honest caveat:** undo
  descriptors and all-write audit coverage of any remaining minor surfaces are smaller future
  work, not release-blocking.
- **A3 — v1's product organization, visual language, and static Universe failed first
  sustained use — RESOLVED (installed), 2026-07-16, v3.0.0.** The pure black-and-white theme,
  the five-workspace tab reorganization (Today/Score/Brain/Ledger/Universe), disclosure-first
  Ledger, the shell-level Rep HUD/receipts that follow across tabs, and the live d3-force
  Universe are all installed. **Honest caveat:** whether this actually motivates Christian day
  to day, not just looks better, is something only sustained real use can confirm — tracked
  under A1's at-piano acceptance thread rather than re-opened here.
- **B10 — PDF Region mapping was geometry only, not understood measures — RESOLVED (installed),
  2026-07-16, v3.0.0.** Boxes, highlights, and text notes could be added directly over a page and
  moved/resized/retyped/recolored/deleted, but they only marked page geometry — never an
  automatically understood printed measure. Fixed by commits `36b8bd9` and `1a8ddd9`: the
  long-orphaned `score_edition_calibration` table (existed since schema v8 with no IPC command
  ever able to read or write it) is now reachable through validated `score_calibration_save`/
  `score_calibration_get` commands, and the Map-this-score wizard lets Christian click each
  system's start, type its measure, and have drawn boxes resolve live to an editable measure
  range via interpolation — replacing the old dead-end "Mapping required" button, which no
  longer exists in production code. All six of Christian's pieces were additionally pre-mapped
  from their real PDF editions (commit `b88c7ae`, 288 anchors total), and injected into
  Christian's live database at v3.0.0 install time. **Honest scope note:** this is
  user-confirmed mapping via the wizard + pre-supplied anchors; auto-OMR (S2) is still open.
- **B29 — Brain always fell back to offline despite a configured Gemini key — RESOLVED
  (installed), 2026-07-16, v3.0.0.** Three compounding root causes, diagnosed live against the real Gemini API:
  (1) the default model was `gemini-3.5-flash`, which is NOT a listed model for this account
  despite the code's "verified" comment — every request 404/failed; (2) transient 5xx and
  transport errors were swallowed with only `eprintln!` and no retry, so one transient 503
  permanently dropped the session to offline; (3) the stored Keychain key (`codakiller`/`gemini`)
  had been overwritten with an EMPTY value, so no provider was ever actually configured. Fixed by
  commits `550af13`, `c3b5271`, `3028d3e`, `92dbed1`: default model → `gemini-flash-latest`;
  `ProviderChain::ask` retries the same provider once on transport-error/5xx before falling
  through; offline failures return a truthful reason instead of being swallowed; `api_key_save`
  rejects an empty/whitespace key; new `brain_status`/`brain_test_connection` IPC expose real
  status. Full Rust suite 473/0, a live round-trip succeeded on retry, fresh-context adversarial
  verifier CONFIRMED. **Now installed** — the Brain shows `● online — gemini` in the shipped
  v3.0.0 app.
- **A3 (Universe half) — static/non-interactive Universe view — RESOLVED (installed),
  2026-07-16, v3.0.0.** The Universe view is now a live d3-force galaxy: pieces are suns sized by earned
  focused time on a log scale, sections are planets sized/brightness-coded by honest mastery
  state, and sessions are satellites that aggregate into expandable clusters for older ones.
  Everything drags with spring physics (pin-on-drag, reheat on release, settle-after-release), plus
  pan and bounded zoom. Hover lights up the neighborhood and dims the rest; click opens a detail
  panel (reps/cleans/mastery/last-practiced + jump-to-Ledger/jump-to-score links). All the app's
  color now lives here against pure black — the rest of the app stays monochrome. Backend/
  earned-growth logic is untouched; this is a frontend-only change. Commits `0d076d9` and `11dff60`
  built the galaxy; commit `705f872` fixed a bug found after: React 19 registers root wheel
  listeners as passive by default, which broke preventDefault-based zoom — fixed by attaching a
  non-passive wheel listener via a ref. Full suite after the fix: 704 passed, 0 failed, 2 todo.
  **Honest caveat:** session-scoped position persistence only (durable cross-session
  layout = small backend command, deferred). The detail panel only shows fields the earned-growth
  snapshot carries (reps/cleans/mastery/last-practiced) — no streak/tempo detail, since that lives
  in the Ledger view. The rest of A3 (messiness, scroll-heaviness, visual genericness, slow-to-
  target, unclear-after-writes, unmotivating) remains open under P7 — see A3 above.
- **B18 — Score section headers and notes were conflated; actions were detached below the list —
  RESOLVED v1.2.0.** Region `name` now owns the visible header and Region `notes` owns the longer
  practice cue. Score and Details update the same row. A measure-sorted searchable accordion puts
  Practice/Edit/Score marks/Tutorial directly beneath the clicked section, and the duplicate block
  label field is removed from that flow. A custom nullable-patch decoder also restores the intended
  absent-vs-JSON-null distinction, so clearing notes/colors/anchors really clears them.
- **B19 — Tutorial graph mutations could orphan or partially edit shared chapters — RESOLVED
  v1.2.0.** Merge transfers/deduplicates links, delete removes links and orphan chapters, shared
  chapter edits warn that every linked section changes, and updates are transactional with injected-
  failure rollback coverage. Video reveal accepts a validated database ID, not a caller path.

- **B16 — Duplicate/disconnected Tricky Section, practice, Goal, and score entry paths — RESOLVED
  v1.1.0.** Region is now the sole editable Tricky Section record. Score and Details share its
  editor and colors; score-started practice carries the explicit Region ID; intake hard spots
  backfill into Regions once and disappear as a second UI/Brain truth. Big Goal names resolve live
  in Calendar while Daily Work title is explicitly the separate action. Constellation stars open
  the exact piece, with stale-response guards on piece and score selection.
- **B9 — Region split was a non-atomic UI sequence — RESOLVED v1.1.0.** Split is now one database
  transaction that changes both Regions, block ownership, Calendar links, order, and history
  together. Injected failure proves rollback. Geometry is cleared on both halves because the app
  cannot infer which score marks belong to which result, and the confirmation states that cost.

- **B15 — PDFs parsed but scanned pages painted completely white — RESOLVED v1.0.2.** v1.0.1
  proved a vector cover could render but did not exercise the actual scores' image codecs. Real
  pages use CCITT, JBIG2, and JPEG/ICC data; PDF.js 6.1.200 needed its matching WASM decoders,
  CMaps, standard fonts, and ICC resources, but those assets and URLs were absent. v1.0.2 vendors
  every exact runtime file, configures same-origin paths, enables WASM, selects stable WebKit paths,
  and narrowly permits those reads/compilation in CSP. The corrected packaged app visibly painted
  Scherzo page 2 (JBIG2), Prokofiev page 1 (JPEG/ICC), and Beethoven page 3 (CCITT) through real
  native IPC. This is also a process correction: page metadata plus a resolved render promise is
  no longer accepted as PDF proof; the gate must observe nonwhite pixels from representative pages.
- **B14 — PDF score could remain on Loading forever — RESOLVED v1.0.1.** The v1.0.0
  production bundle used PDF.js 6's modern display build and tried to start an ES-module worker
  through Tauri's custom app protocol. On this Mac's WKWebView that worker handshake never settled,
  and the UI had no deadline. v1.0.1 uses the matching legacy display + in-process loopback worker,
  handles cross-realm binary data, and converts stalled reads/renderer startup into a retryable
  error while destroying failed/late tasks. The actual 25-page Scherzo rendered natively at page
  1 of 25 (1664 × 2314); regression tests cover both a permanent stall and a real parsed PDF.
- **A2 / A4 — P6 finish and executed plan missing — RESOLVED v1.0.0.** The checked P6 plan,
  accessible Practice Universe, references, deep Settings, icon, and full local release path are
  shipped. Remaining acceptance risk is A1 (human at-piano proof), not missing product scope.
- **B11 — Manual signing/release repair — RESOLVED v1.0.0.** `npm run release:mac` builds, stages,
  seals, strictly verifies, rollback-installs, packages, hashes, cleans LaunchServices, and rejects
  duplicate bundle identifiers. Honest limit remains: local ad-hoc signature, no notarization.
- **B13 — Sparse canonical history — RESOLVED v1.0.0.** Schema v6 ledgered all 249 real legacy
  rows, mapped 190 exact practice rows (including five deleted-block rows at piece level), skipped
  59 unsupported rows, and preserved every graph count. New blocks/reps + feed/canonical/ledger/
  tempo-step rows now commit in one transaction; injected-failure tests prove rollback.

- **✅ Duplicate indexed build bundle + invisible release identity** _(resolved in v0.3.1,
  commit `28940ab`)_.
  v0.3.0's installed binary was correct, but Tauri's generated `.app` remained under the repo and
  Spotlight indexed both it and `/Applications`; meanwhile the landing screen looked unchanged.
  The post-install flow now unregisters/deletes the generated bundle, registers the installed
  copy, and the UI visibly shows both `v0.3.1` and **Foundation installed**.

- **✅ Write-once practice data / flat endless history / blocking overlays / tempo-only blocks**
  _(resolved in v0.3.0, Foundation commits `6343289` through `62cfa16`)_. Piece metadata, goals,
  regions, blocks, and individual reps are editable/deletable; history drills in by Region with
  search/sort; Rep + Session are movable persisted panels with a reset and nonblocking defaults;
  focus and metronome are independent, including metronome-free blocks with NULL tempo.
- **✅ UI metronome toggle initially only changed metadata** _(found in final review, fixed in
  `0296c49`)_. Opening a block from the form now starts the click when opted in, and a UI-logged
  ladder step retunes it; off means off. The same review fixed a panel z-order regression where a
  drag could undo its own raise-to-front.

- **✅ AppleEvent quit bypassed ALL graceful cleanup** _(found AND fixed during the v0.2.0
  ship smoke, commit `5452a59`)_. `osascript 'quit app'` (an NSApp terminate) delivered
  neither `RunEvent::ExitRequested` nor any POSIX signal, so quitting that way orphaned
  `hear` (holding the microphone until a chance SIGPIPE), stranded the boosted system volume
  at 85, and skipped the session export — every quit, silently. Fixed with a `libc::atexit`
  backstop (path-independent: kills the `hear` group + restores the pre-boost volume on any
  normal exit) plus session export on window close; abruptly-orphaned sessions are adopted
  and exported by the next launch. Live-verified before and after. The pre-existing SIGKILL
  limitation (B6) still stands — `atexit` does not run on `kill -9`.
- **✅ B1 — No runtime TTS fallback** _(resolved in v0.2.0, commit `0207ed7`)_. `FallbackTts`
  wraps the providers: a failed Gemini synth retries through `say` for that same utterance
  (nothing is silently dropped), and after 2 consecutive Gemini failures the session drops to
  `say` outright. The half-duplex gate ordering is untouched (fallback happens at synth time,
  gate still open). The coach can no longer go silent mid-practice from an API outage.
- **✅ B2 — Mic-permission-denied guidance was generic** _(resolved in v0.2.0, commit
  `8219d6b`)_. `hear`'s real denial strings (pulled from the vendored binary + its source:
  "Speech recognition authorization denied/restricted/not determined", "Failed to start audio
  engine") now map to a distinct MicDenied state with a persistent, dismissible banner giving
  the exact System Settings path; restart-storm guidance names mic permission as a likely
  cause. Disjoint from the Code=201 Dictation case, which stays separately handled.
- **✅ `-m` flag starved the line reader** (`\r`+ANSI, zero newlines → no transcript ever delivered
  → the voice loop was dead). Root-caused and removed in Task 13; plain pipe line-buffers promptly,
  no `stdbuf` needed. (commit `14d4dd2`.)
- **✅ Engine re-send double-fire** — identical finals re-sent 0.5–2.3 s later fired intents twice.
  Fixed with the unified 2.5 s time-keyed dedup; regression test proven to fail under the buggy
  version. (`14d4dd2`.)
- **✅ Zombie `hear` on raw SIGTERM/SIGINT** — a POSIX kill of the app didn't fire Tauri's
  close/exit events, orphaning the `hear` process group to launchd (holding the mic). Fixed with an
  async-signal-safe termination handler that kills the group then re-raises. (Task 13.)
- **✅ `+inf`/negative bpm infinite-loop** in the audio callback — a fresh-context verifier found a
  garbage tempo would stall the real-time loop; bpm now clamped to `[1,1000]` before use,
  regression-tested. (Task 5.)
- **✅ `do_set` Busy-arm state lie** — a refused sound-change left `state.sound` claiming the new
  sound while the engine kept the old; now reverted in that arm, seam-tested. (Task 11.)
- **✅ DMG bundler deletes the `.app`** — the default build's dmg step cleans the `.app` output;
  documented, and we build with `--bundles app` when the `.app` must persist.

- **B58 — Rehearsal harness could not green-run on live-DB copies — RESOLVED 2026-08-18,
  v6 Plan D lane H (commit `bb20f55`), gating the v6.0.0 install.** Root cause was the harness,
  not the data: it resolved the merged Tanglewood piece by the title `'Chamber Pieces
Tanglewood'`, which exists on NO post-split database (v12 renamed that row to 'Pas de Deux',
  keeping its id), so the 118 ledgered events of the legitimate July merged→Copland move
  (100 rep_checkpoint + 14 rep + 2 rep_open + 2 rep_close, all 2026-07-27) counted as
  "wrongly attributed". Fix: split-aware resolution + a pre-migration snapshot of the exception
  count asserted UNCHANGED across the new migration, plus the `com.christian.codakiller` path
  guard both `CODAKILLER_MIGRATION_COPY` consumers had been missing. Deliberately NOT asserted
  post-split: "the Barber owns nothing" — Christian has practised the Barber since July; that
  assertion is only true at the instant v12 runs. The v13→v14 rehearsal then ran green on a
  fresh live copy (every preserved table byte-stable) immediately before the v6.0.0 install.

## How to use this doc

Add every new flaw the moment it's understood (even mid-task). Give it a severity and, where
possible, a file/`NOTES.md` reference. When you fix one, move it to **Resolved** with the commit —
don't just delete it; the fix history is itself valuable. A flaw with no plan is still worth
listing: honesty first, plan second.
