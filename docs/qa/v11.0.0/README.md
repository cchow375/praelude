# Praelude v11.0.0 — QA and release evidence

**Last updated: 2026-09-07. Status: v11.0.0 / schema 21 SOURCE CANDIDATE; release/install verification in progress.** Installed remains v10.1.0 at `/Applications/Praelude.app`. The existing v10.1 native Score permission is now available: this session opened the real 25-page Scherzo score and 51 saved regions. A new v11 launch may re-prompt; its package/install/native facts remain pending until tested.

## Scope

Studio replaces visible Universe with an original SVG practice room, ten musical ranks/ten divisions each and continued Encore progression; earned coins, 25 furnishings/palettes, local profile and durable ownership. Today, shell materials, Dark/Light/System and library grid/list/custom covers/search/sort/resting are updated. Core practice contracts and saved variants/routines remain. Accounts/friends/sync are unbuilt; Assistant stays off. No claim is made that an entire mature codebase is flawless.

## Evidence available

| Gate | Result / boundary |
| --- | --- |
| Native Studio model | Formula/rank boundaries, completion projection, corrections, stale/corrupt state, invalid/duplicate purchase and durable profile/purchase reopen tests pass. |
| Full native suite | 1,106 passed / 18 ignored plus integrations with `RUST_TEST_THREADS=4`. Initial default high-parallel run exposed speech timing sensitivity; sandbox denied the speech probe. The passing four-worker run is the stated result. |
| Strict Clippy | All-target/all-features pass. |
| Dock/Shell broad checks | 222 passed. Ephemeral user-action provenance differentiates RepPanel automatic reveal; manual restore/minimize/close remain respected, including persisted and delayed-load cases. Two additional policy cases are included in the running final full frontend suite. |
| TypeScript / production build / Rustfmt | Pass. |
| Full frontend | Final run in progress after all dock/library fixes and two additional dock-policy cases. No final count is claimed yet. |
| Independent UI review | Final dock/library review PASS, no remaining source blockers. Earlier Studio review fixes retained; B104–B106 record diagnosis and source verification. |
| Copy data rehearsal | `data-rehearsal.json`: integrity OK/FK0; 46 tables compared; exact practice graph unchanged, only setting key `motivation.studio.v1` changes for local profile/purchase. Derived 204 XP / 198 qualifying completed sets / Prelude 3 / 50 coins before purchase. Native reopen passes. |
| Browser frames | `today-desktop.png`, `library-desktop.png`, `studio-preview.png`, `studio-desktop.png`, `studio-compact.png`, `studio-rank-path.png`. Development fixture renders are not installed-native evidence. |
| Existing installed v10.1 native Score | Real Scherzo PDF (25 pages) and 51 saved regions opened through computer use; old Desktop permission blocker cleared. Fresh v11 launch may renew it. |
| Custom-cover UI picker | Unverified: automated browser image file chooser hung. Preprocessing and native save/reopen/invalid-payload tests pass; actual picker selection/render/restart must still be exercised (B109). |
| Pre-install | Native app quit verified; backup/rollback retained. `pre-install-audit.json`: schema21/integrity OK/FK0, 11 pieces / 352 blocks / 3,237 reps / 63 sessions / 12,233 events / zero open. |
| Package / install | Pending final source commit/build/package, signature/share-clean, one-copy, exact after-install data and fresh-launch boundary. |

## Adversarial findings

- **B104:** Studio profile/purchase errors could sit behind an active dialog; refreshes during mutations could be dropped. Dialog-local alerts/retry and queued refresh retain visible recovery and the latest evidence.
- **B105:** Shared dialogs could let keyboard focus/background interaction escape; workspace scroll could carry into another surface. Shared focus/background isolation and scroll handling pass independent final review. Shell-owned Rep Counter tucking replaces Studio-local cleanup so the dock does not reopen over browsing views; manual restore/minimize/close stays respected through ephemeral user-action provenance, including persisted and delayed-load cases.
- **B106:** Library context menus had keyboard Tab/focus and folder rename/save hazards. Menu/form focus and stale/open-menu handling are fixed in source; independent final UI review passes with no remaining source blockers; final full frontend run remains in progress.

## Backup and rollback

Pre-install audit at 2026-09-07 23:41 EDT: schema 21, integrity OK/FK0; 11 pieces / 352 blocks / 3,237 reps / 63 sessions / 12,233 events, zero open sessions/blocks; the native app is quit. Backup `/Users/c3/Library/Application Support/Praelude Release Backups/v11.0.0-2026-09-07-2340/pre-v11.0.0.db` (35,004,416 bytes), SHA-256 `b285c5a0624769aeccc27a2543f9b414eb1b22750fa2c551e60f02cfee553cb4`; rollback `/Users/c3/Library/Application Support/Praelude Release Backups/v11.0.0-2026-09-07-2340/Praelude-10.1.0-rollback.zip` (9,778,474 bytes), SHA-256 `1b9647ce671feab84e23c0da66d0fd5351e19c1f2fc8e2908432e252a7e24d40`. Full table hashes are in repo `docs/qa/v11.0.0/pre-install-audit.json`. Install remains pending.

## Acceptance limits

The new economy uses an event-derived focused-time estimate and proven completed sets, not audio analysis or musical ability. Historical practice contributes under the new rules; corrections can reduce balance while possessions remain. The shop has 25 initial items and one equipped item per slot, not free placement or an endless item library.

Accounts, email/password login, friends, presence, sync and leaderboard are unbuilt. Local profile stores only a display name. Apple-inspired glass is CSS in Tauri/WKWebView, not Apple's native Liquid Glass framework. Real microphone/Listen Back/Steinway, real-provider mapping, clean-recipient install and the exact Windows v9.1.0 native acceptance remain separate. Christian's sustained UI/motivation verdict is pending.

## Next steps

Record the final full frontend result, source commit and exact package/install/data evidence; source review, TypeScript/build and lint gates already pass. Verify installed Today, Score, Variants, Pieces and Studio as OS permissions permit. Finish living docs, source/release commits and tag only at the real release boundary; then obtain Christian's practice verdict.
