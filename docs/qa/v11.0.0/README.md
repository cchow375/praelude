# Praelude v11.0.0 — QA and release evidence

**Last updated: 2026-09-08. Praelude v11.0.0 / schema 21 — SHIPPED + INSTALLED.** Installed at `/Applications/Praelude.app` on 2026-09-07 at 23:53 EDT; implementation `a338581`. Fresh native launch passed twice and all 46 database tables plus the DB bytes are unchanged.

**Native boundary:** Today, Studio, rank path, practice record, Pieces, Settings and canceled purchase/profile previews are verified in the installed app. The new ad-hoc build renewed macOS Desktop-folder and Speech permissions at 23:53:43; Score waits at “Finding score editions…” until Desktop access is allowed. Native Score/Variants remain pending that prompt, which computer-use tooling cannot accept. Custom-cover picker selection/save remains unverified (B109); the picker was canceled and no artwork or preferences changed.

## Scope and implementation

Studio replaces Universe with an original SVG room, ten musical ranks/ten divisions each and continued Encore progression, earned coins, 25 initial furnishings/palettes and durable local name/ownership. Today, glass shell, Dark/Light/System and cover Library are updated. Shared dialogs and shell-owned Rep Counter tucking preserve practical keyboard/panel behavior. Core practice, saved variants/routines and all retained evidence remain. Accounts/friends/sync are unbuilt; Assistant stays off.

## Gates

| Gate | Result / boundary |
| --- | --- |
| Full frontend | **2,595 passed / 1 skipped**, 212 passed files / 1 skipped. Includes final dock-policy cases. |
| Full native | **1,106 passed / 18 ignored plus integrations**, `RUST_TEST_THREADS=4`. Default high-parallel run exposed speech timing sensitivity; sandbox speech-probe denial is recorded, not hidden. |
| Build/lint | TypeScript, production/native builds, format/Rustfmt and strict all-target/all-features Clippy pass. |
| Fresh-context review | Studio fixes retained; final independent dock/library review PASS with no remaining source blockers. Broad dock/Shell checks: 222 passed before two final policy cases joined the full suite. |
| Native Studio store | Formula/rank/completion/correction, stale/corrupt state, duplicate/invalid purchase and on-disk profile/purchase/equipment reopen pass. |
| Copy rehearsal | `data-rehearsal.json`: 46 tables exact except `motivation.studio.v1` after profile/purchase; integrity OK/FK0. 204 XP / 198 qualifying completed sets / Prelude 3 / 50 coins before purchase. |
| Installed native | Fresh launch twice; Today, Studio, Rank path, Practice record, Pieces, Settings, purchase-preview Cancel and local-profile Cancel pass. No actual purchase/profile change made. |
| Installed data | `post-install-audit.json`: all 46 tables exactly unchanged and DB byte-identical; schema21/integrity OK/FK0; 11 pieces / 352 blocks / 3,237 reps / 63 sessions / 12,233 events / zero open. |
| Package identity | Installed arm64 v11.0.0 at `/Applications/Praelude.app`, strict ad-hoc seal, privacy strings verified; not notarized. Exact artifact below. |
| One-copy | Spotlight resolves exactly `/Applications/Praelude.app`. Broad filesystem audit still running; no final pass claimed yet. |
| Native Score / Variants | **Pending Desktop Allow.** Fresh TCC logs at 23:53:43 show renewed Desktop/Speech prompts/code requirement mismatch and microphone mismatch. Score waits at “Finding score editions…”. Computer use cannot accept the OS permission surface. |
| Custom-cover picker (B109) | **Pending.** Browser chooser hung; native picker opened but computer-use accessibility could not inspect it. Canceled and restarted with no image saved. Three native cover tests and frontend preprocessing/validation pass; those are not UI picker acceptance. |

## Native and browser evidence

Actual installed Studio shows **204 XP / Prelude 3 / 50 coins**. Practice record shows **198 completed sets / 21h 9m**. Library shows **4 Active / 5 Resting**. Purchase preview Cancel preserves the 50-coin balance; profile Cancel preserves the saved state. Two fresh launches and all canceled previews/pickers leave the DB unchanged.

Native screenshots: `native-studio.png`, `native-rank-path.png`, `native-library.png`, `native-settings.png`, `native-purchase-preview.png`. Development screenshots: `today-desktop.png`, `library-desktop.png`, `studio-preview.png`, `studio-desktop.png`, `studio-compact.png`, `studio-rank-path.png`. Development fixtures do not prove native score-file or microphone acceptance.

The prior installed v10.1 Score did load the real 25-page Scherzo and 51 saved regions earlier in this session. The v11 ad-hoc replacement renewed the Desktop permission, so that prior proof does not cover the freshly installed v11 Score/Variants surface.

## Resolved adversarial findings

All three are fixed by `a33858139430b99bd22c8a2d0fa06fa6b1b2f4f1` and retained in the vault Flaws register:

- **B104:** dialog-local mutation errors/retry and queued refresh avoid hidden failure or dropped evidence updates. Stale writes refuse and retries cannot double-charge.
- **B105:** shared background/focus isolation, workspace scroll reset and shell-owned Rep Counter tucking remove keyboard/background escape and unwanted reopen over browsing views. Ephemeral user-action provenance distinguishes automatic reveal and respects manual restore/minimize/close through persisted/delayed loads.
- **B106:** Library menu Tab/focus, folder rename/Save and invalidated-anchor behavior pass independent final interaction review.

## Artifact and source

DMG `releases/v11.0.0/Praelude-11.0.0.dmg`: **10,691,711 bytes**, SHA-256 `dc51618396ecf532efa0a058a86f77a7451e186cac610c9d745f28da2d610417`. Runtime implementation `a33858139430b99bd22c8a2d0fa06fa6b1b2f4f1`; the app was built from the same unchanged production files immediately before that commit. Installed arm64 CDHash `eb19805326b4008e3a5cac1ed6bfcf472c870e98`; ad-hoc signed, not notarized; privacy strings verified. Release tag `v11.0.0` is to be placed on the final release-doc commit; private-origin push is planned, not yet claimed.

## Data, backup and rollback

Post-install `post-install-audit.json` confirms schema 21, integrity OK/FK0, exact equality of all 46 tables and byte-identical DB SHA-256 `b285c5a0624769aeccc27a2543f9b414eb1b22750fa2c551e60f02cfee553cb4`. Counts remain **11 pieces / 352 blocks / 3,237 reps / 63 sessions / 12,233 events / zero open sessions or blocks**. Both fresh launches and canceled profile/purchase/picker checks made no practice or preference changes.

Backup `/Users/c3/Library/Application Support/Praelude Release Backups/v11.0.0-2026-09-07-2340/pre-v11.0.0.db` (35,004,416 bytes), SHA-256 `b285c5a0624769aeccc27a2543f9b414eb1b22750fa2c551e60f02cfee553cb4`; rollback `/Users/c3/Library/Application Support/Praelude Release Backups/v11.0.0-2026-09-07-2340/Praelude-10.1.0-rollback.zip` (9,778,474 bytes), SHA-256 `1b9647ce671feab84e23c0da66d0fd5351e19c1f2fc8e2908432e252a7e24d40`. Pre-install audit was captured 2026-09-07 at 23:41 EDT with the native app quit and zero open rows.

## Acceptance limits and next steps

Allow the renewed Desktop prompt and verify installed Score/Variants; finish the custom-cover picker → rendered cover → restart path when controllable. Obtain Christian’s real practice and sustained motivation verdict. Accounts, real microphone/Steinway, real-provider mapping, clean-recipient and Windows-native acceptance remain separate.

The event-derived focused-time estimate and commitment ranks do not assess playing. Corrections may lower spendable balance while ownership remains. The catalog has 25 initial items and one item per slot; continued Encore progression is not an endless furnishing library. Accounts/friends/cloud and the native SwiftUI Liquid Glass framework are not claims. The broad filesystem one-copy audit, final release-doc tag and private-origin push are still to be finalized at this documentation boundary.
