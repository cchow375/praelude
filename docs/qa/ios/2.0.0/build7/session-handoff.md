# Build7 implementation, verification and iPad handoff

Last updated: October 7, 2026. Installed mobile version: 2.0.0/build7/schema5.
Christian confirms the update reached the iPad. The installed Mac remains v11.1.0/schema21.

## Implementation record

Source commit: `3e03330ac6df952a7c830ca18b6b890f6fa9f505`; candidate tag: `ios-v2.0.0-build7-candidate`.
Its complete Git diff is the authoritative file-by-file implementation record.

- Drawing: repaired the reproduced stamp-switch responder recursion freeze; removed repeated drawing serialization from sample callbacks; added idle autosave, lifecycle checkpoints and failed-save recovery. Preserved newest dirty ink during conflicts, partial erase identity and source-page/layer geometry.
- Responsiveness: bounded background cover/passage decoding, cache work, indexed history/projections and batched reward catch-up. Guarded canceled account pulls, moved file hashing off the main thread, bounded tuner admission and canceled stale social/profile/scan requests.
- Score/UI: compact scrolling annotation tools, reliable button hit areas, phone landscape stave-width fitting with portrait zoom restoration, warmup header/dock anchoring and a resume strip above tabs and list content.
- Practice/audio: fixed a live meter-change array crash and delayed background-stop delivery. Captured beat-row values, retained explicit Stop behavior and isolated beat animation updates. Practice verdict rules remain deterministic and user supplied.
- Other fixes: captured notebook deletion identifiers, background photo-PDF preparation, yielding/cancelable score export and pure link-fit geometry.

The [stability ledger](stability.md) maps every feature family to repairs, review coverage and gaps; it retains failed runs and subsequent corrections. This is broad regression work, not acceptance of every feature on every physical device.

## Final verification and failed attempts

- Core: 394 tests; services: 2,211 assertions; Python helpers: 54 tests pass.
- Hosted native: 215 tests execute per form factor, one live-account test skipped, zero hosted failures. Counts from repeated runs are not summed as unique coverage.
- Phone: final eight-case aggregate passes; subsequent strict rotation/Done repair passes.
- iPad: four scoped UI cases pass; corrected metronome retry passes after revealing its virtualized offscreen button. The earlier aggregate remains a failed run.
- Independent source and screenshot review accepts the scoped layouts. Fresh unsigned arm64 device Release passes with test fixtures/diagnostics absent; later actual signed installation is a separate result.

[Native run summary](native-summary.json), [unsigned source build](release-build.json) and [screenshots](screenshots/) retain their original evidence boundaries. The stability ledger records compiler errors, failed assertions, test targeting errors and real defects found during successive native runs; these failures are not counted as passes.

## Physical installation and preservation

Installation documentation commit: `2227817`; tag: `ios-v2.0.0-build7-ipad-installed`.
[Installation proof](personal-ipad-install.json) and [attempt record](device-update-attempt.json) distinguish connection/build/signing, installation, preservation and launch.

Guarded same-bundle refresh installed build7 over build6. Independent comparison proves all 11 owned files / 7,981,365 bytes identical by filename, size and SHA-256 before launch. Practice history, original marks, account ownership, privacy and preferences were retained. No uninstall, reset, restore, app termination workaround, Mac installation or credential/key change occurred. Private full backups and ledger readbacks remain excluded from Git.

Actual signed Release passed signature/profile/team/device/signer trust checks. Provisioning expires October 10, 2026 at 17:55:53 UTC (1:55 PM EDT); this installation reused a valid profile.

Automatic launch failed. Later read-only inspection found Praelude running and schema5/revision1660. All 255 attempts, 44 set IDs, 30 sessions and original 45 ink rows remain; profile/privacy/preferences match. Archiving the completed set and newer ink/reward/page activity are separately observed post-launch changes, not byte-identical installation evidence or inferred user actions. Christian subsequently confirmed receipt on the iPad; explicit manual-opening and sustained feature-quality acceptance were not separately supplied.

## Remaining limits and next steps

Physical Pencil, actual audio/routes, sustained freeze recovery, frame-rate measurement, large real-library behavior and actual two-device/account continuity remain open. iOS controls the refresh rate; a fixed 120fps or lag-free guarantee has not been established.

The 600ms ordinary idle autosave is not a crash journal; force quit before a checkpoint can lose unsaved marks. Whole-library JSON validation/encoding/atomic saving and full import/backup/restore remain synchronous. A complex export page/final write may still exceed frame budget. Further persistence work should follow measured real-library traces.

Next steps: use installed build7 for sustained Pencil/eraser/Undo/layer/page switching during real practice, interruptions and large scores; test actual second-device continuity. Renew the same app/team provisioning before the recorded expiry. Continuous Mac/native sync still requires its separate desktop adapter; Assistant remains on hold.
