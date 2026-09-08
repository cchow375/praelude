# Praelude v10.1.0 — saved variants and routines

Status: implementation verified; native release gates running. Installed remains v10.0.5/schema 21 until the installation record below is finalized.

Variants → Manage variants adds durable custom shortcuts and toggles visibility. Build/reorder a chain, adjust each stage’s clean count, then Save sequence as routine and name it. Selecting a saved routine replaces the draft with a copy. Libraries are global across pieces and persist in SQLite setting `practice.variant_library`; no practice schema/history migration. Reads never write defaults. Revision-checked saves reject stale/corrupt data rather than clobbering it.

Verification:
- Final frontend suite: **2,554 passed / 1 skipped**, 207 files passed / 1 skipped. TypeScript and 42 focused frontend/mock tests pass.
- Native library: 5 disk close/reopen, validation, corruption and concurrent-revision tests pass.
- Fresh-context rendered review: desktop and **720×520**, save/hide/show, duplicate rejection, stage order/counts, routine application, copy independence and composer remount pass. Screenshots: `verification-*`.
- Review found two pre-release defects: offscreen fixed deletion confirmation in the scrolling modal, and implicit form submission on Enter in chain fields. Inline confirmation and input Enter handling fix both; browser rechecks and regressions pass.
- Browser QA uses isolated devMock. It does not prove browser-reload persistence; native on-disk tests prove durable library storage. No QA practice data was written to the live DB.
- v10.0.5 native Score/bar was observed with actual Scherzo No.2 / Rolled Chords loaded this session; the preceding Desktop permission blocker has cleared for that launch.

Next steps: complete full native/build/package gates, fresh zero-open audit/backup/rollback, install, exact data audit, and inspect the native library surface. Microphone/Steinway acceptance and Windows native acceptance remain separate.
