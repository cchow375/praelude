# Build5 score workflow and shared data contracts

2.0.0/build5/schema5 development candidate, October 2, 2026. Installed physical build4 is separate.

## Scope and evidence

Physical feedback: Pencil recognition, black ink/stamp invisibility and annotation-entry freeze during an active set. Source mitigations do not close the hardware gate. Compact score modes, bottom Done/double-tap, colored hideable boxes, Library exit, stamp preview/magnifier, expanding notes, sections/measure assistance and practice controls. Original PDFs/recorded targets retain source-page identity.

Vision offers reviewed numeric hints, never automatic OMR. Player confirms measure/system geometry and numbers. PDF bookmarks suggest sections; manual ranges remain available. Bounded background thumbnail caches remove main-thread per-row PDF opens.

## Checks

- Hosted additive migrations24(score metadata/legacy keys),25(owner preferences),26(private covers/account cleanup),27(unknown future preference-key retention) applied to configured Praelude project.
- Rollback-only hosted tests use temporary users, leave no data, and pass owner preference isolation, legacy absent-field preservation, explicit array/null clears, future preference-key retention and private cover policy/cleanup checks.
- Final Core run: 385 tests and 2,211 deterministic service assertions pass, including exact ledger preservation, backup compatibility, two-device goal/routine deletion, nullable clears, preference clock normalization and confirmed geometry labels. Ten profile regressions cover existing-cloud identity/photo/privacy, guest/explicit edits, delayed hydration, failed staging/local saves, same-owner sign-out, other-account rejection, interrupted receipt writes and reverted retries before/after concurrent hydration. Fresh source review found no remaining blocker in those paths.
- Final Python run: 54 helper/exporter tests pass; schema5 preservation/update refusal coverage added. Project regeneration includes 168 app and seven UI-test source files.
- Final source native iPad app-hosted run: 193 tests executed, one live-account smoke skipped, zero failures. Seven distinct scoped iPad UI cases pass across runs: finger ink/Undo/relaunch, multi-page box persistence, stamp resize/confirm, active-set annotation/Library return, bottom Done/double-tap, pre-attempt click choice and Techniques hand selection/stable scrolling. Techniques initially failed tapping during picker dismissal; explicit readiness waits correct the test, and its native rerun passes.
- Phone: five scoped UI cases pass together with zero failures: active-set annotation/Library return, bottom Done/double-tap, actual stamp grow/shrink and one placement, pre-attempt click and Techniques hand selection/stable scrolling. These visual paths ran before the final profile-only recovery correction; the final native app rebuild/hosted suite and Core recovery tests cover that correction. No all-green full UI-scheme claim is made.
- Independent actual iPad CUA review confirms white score/black stamp preview and magnifier, actual placement, yellow note create/expand/Edit/Close, compact arm controls and annotation return retaining1/5 progress. No freeze observed in this synthetic path. CUA drag direction was inconsistent; the native XCTest resize pass supplies the gesture evidence, not a causal claim about CUA.
- Read-only physical status reports no connected iPad/iPhone. No physical installation, private library mutation or real-account signup/upload occurred.
- Actual phone CUA review confirms New note opens its editor directly, Cancel returns to Notebook, and Rewards leads with rank/division/recorded-practice progress. Synthetic screenshots show readable black stamp/palette, bottom confirmation and compact running controls.
- Final exact-source unsigned arm64 device Release passes for iOS17+, version2.0.0/build5. Inspected binary excludes test launch flags, fixture score, annotation diagnostics and test plug-ins. Hash/metadata: [Release inspection](build5/release-inspection.json). No signing, installation or physical-device acceptance is inferred from compilation.
- Project regeneration, whitespace validation and `npm run docs:sync` / `npm run docs:check` pass. The final read-only device-status check again reports no connected iPad/iPhone; no install can run in this round.
- Earlier integrated failures are retained: incomplete optional-date/Bool callback fixtures; future deletion timestamp and ISO8601 fixture precision; stale page-label expectation; and a duplicate-ID organization fixture trapping the old cache constructor. The cache now tolerates duplicate IDs; fixture identities are valid. The corrected Core suite passes. Native technique transition failure is described above rather than counted as a pass.
- First-profile review initially failed three cloud-avatar assertions: missing and explicit-null defaults compared differently, marking an empty local photo as an edit. Normalized nullable core/default payloads fix the cause; the original preservation assertions remain. Independent review then found staging-loss, sign-out and reverted-retry races; targeted failure/relaunch/concurrent-read regressions now pass.

## Screenshots

Synthetic fixtures only; visually inspected native output. No personal PDFs, libraries, device IDs or raw result bundles are committed.

- [iPad annotation](build5/ipad-annotation.png)
- [Bottom selection](build5/ipad-selection.png)
- [Page-grouped colored passages](build5/ipad-passages.png)
- [Magnified resized stamp preview](build5/ipad-stamp-preview.png)
- [Phone annotation palette](build5/phone-annotation.png)
- [Phone compact running practice](build5/phone-running.png)
- [Phone bottom selection confirmation](build5/phone-selection.png)
- [Phone stamp preview](build5/phone-stamp-preview.png)
- [Phone metronome before first attempt](build5/phone-metronome.png)
- [Phone hand techniques](build5/phone-hand-technique.png)

## Remaining acceptance

Physical Pencil, sustained annotation during piano practice, voice/audio and real-account two-device convergence remain open. Installed Mac lacks a native-sync adapter. Original imported Mac archive remains local/backed up; no rewriting/upload/replaying original history. Schema5 preserves exact originals; backupv4 is refused by old readers.

**Next steps:** guarded update with no open set when the iPad is connected, then physical/account acceptance.
