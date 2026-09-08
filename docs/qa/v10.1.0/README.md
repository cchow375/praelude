# Praelude v10.1.0 — saved variants and routines

Status: **SHIPPED + INSTALLED v10.1.0 / schema 21**.

Variants → Manage variants adds durable custom shortcuts and toggles visibility. Build/reorder a chain, adjust each stage’s clean count, then Save sequence as routine and name it. Selecting a saved routine replaces the draft with a copy. Libraries are global across pieces and persist in SQLite setting `practice.variant_library`; no practice schema/history migration. Reads never write defaults. Revision-checked saves reject stale/corrupt data rather than clobbering it.

Verification:
- Final frontend suite: **2,554 passed / 1 skipped**, 207 files passed / 1 skipped. TypeScript and 42 focused frontend/mock tests pass.
- Native library: 5 disk close/reopen, validation, corruption and concurrent-revision tests pass.
- Fresh-context rendered review: desktop and **720×520**, save/hide/show, duplicate rejection, stage order/counts, routine application, copy independence and composer remount pass. Screenshots: `verification-*`.
- Review found two pre-release defects: offscreen fixed deletion confirmation in the scrolling modal, and implicit form submission on Enter in chain fields. Inline confirmation and input Enter handling fix both; browser rechecks and regressions pass.
- Browser QA uses isolated devMock. It does not prove browser-reload persistence; native on-disk tests prove durable library storage. No QA practice data was written to the live DB.
- v10.0.5 native Score/bar was observed with actual Scherzo No.2 / Rolled Chords loaded this session; the preceding Desktop permission blocker has cleared for that launch.

Next steps: grant renewed Desktop-folder permission and inspect the native library surface; all release/install/data gates are complete. Microphone/Steinway acceptance and Windows native acceptance remain separate.

## Release evidence

**Last updated: 2026-09-07 — Praelude v10.1.0/schema 21 SHIPPED + INSTALLED.** Variants now has Manage variants for permanent custom shortcuts and show/hide controls, plus named ordered routines with saved stage clean counts. Selecting a routine copies it into the draft. Full frontend (2,554 passed / 1 skipped), native (1,088 passed / 17 ignored plus integrations), strict lint, builds, independent compact/desktop UI review, package/signature/one-copy and exact data-preservation checks pass. Next: Christian’s real-use verdict; Windows native acceptance and microphone/Steinway evidence remain separate.

DMG `releases/v10.1.0/Praelude-10.1.0.dmg`: 10,612,722 bytes, SHA-256 `9f1454b17d6a44890dda5b3959b38a1c3ff9fbcc267a3a109adf0e975b2b52c9`. Implementation `1543c06`; final release boundary is tag `v10.1.0`. Ad-hoc signed, not notarized.

Database remains schema 21, integrity OK/FK0, 11 pieces / 352 blocks / 3,237 reps / 63 sessions / 12,233 events / zero open sessions or blocks. Full logical graph and live bytes are unchanged. Backup `/Users/c3/Library/Application Support/com.christian.codakiller/backups/(C) pre-v10.1.0-install-2026-09-07-223602.db`, SHA-256 `539c600e35f838a44812a40792a4187fef6e9284e6b92ca2bbc6c30dca8a5946`; rollback `/Users/c3/Library/CodaKiller-rollbacks/Praelude-v10.0.5-rollback-2026-09-07-223602.app.tar.gz`, SHA-256 `1bfdc49159f4a6fe91866150bdab63663866f3d1d5972bdb6bd9aff211a42b2f`.

**Native launch limit:** v10.1.0 freshly launched and its database is unchanged, but Score is waiting at “Finding score editions…” for renewed macOS Desktop-folder permission. TCC logs at 22:43:01 explicitly show the old code requirement mismatch and Desktop prompt; Speech Recognition also re-prompted. Christian must click Allow on the Desktop prompt, then the native Variants surface check can finish. The computer-use tool cannot accept that OS permission window; browser QA is not native acceptance.

Installed ad-hoc CDHash: `586a04c7ca712e87e96c200e4812611bae9097b6`.
