# v3 Parity Inventory — what the rewrite must not silently drop

> Source of truth for Phase 8's audit. Every row must be reachable in the v3 frontend or carry an explicit **[approved removal]**. Derived from the v2.0.0 frontend (`src/features/*`) + the backend IPC contract (`src-tauri/src/lib.rs` handler registry). Status column filled during Phase 8.

## A. Workspaces (top-level nav)

| Workspace | Main component                            | Must reach parity on                                                                                                  | v3 status |
| --------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | --------- |
| Today     | `features/today/TodayWorkspace.tsx`       | Session Composer, session-plan review/start, retention queue, active-block HUD, receipts                              | ⬜        |
| Score     | `features/score/ScoreView.tsx` (+ atlas)  | PDF view, region overlays, annotations, **mapping wizard (new)**                                                      | ⬜        |
| Brain     | `features/brain/BrainWorkspace.tsx`       | typed Q&A, per-piece thread memory, intake-apply proposals, work suggestions, **status line + test-connection (new)** | ⬜        |
| Ledger    | `features/ledger/LedgerWorkspace.tsx`     | piece→block→rep history drill-in, anomaly panel, inline edit                                                          | ⬜        |
| Calendar  | `features/calendar/CalendarWorkspace.tsx` | week daily-work, recovery review, capacity                                                                            | ⬜        |
| Universe  | `features/universe/UniverseWorkspace.tsx` | earned-signal graph → **draggable force graph + detail panel (new)**                                                  | ⬜        |

## B. Cross-cutting features (shared panels)

| Feature     | Component                                                                                                    | Capability to preserve                                                                                                                        | v3 status |
| ----------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| Rep HUD     | `features/rep/RepHud.tsx` (`useRep.ts`)                                                                      | live snapshot, verdict/tempo/undo/restart, pause-aware focus time, ladder                                                                     | ⬜        |
| Receipts    | `features/receipts/ReceiptCenter.tsx`                                                                        | unmissable success/error receipt for every `MutationReceipt<T>`, idempotency                                                                  | ⬜        |
| Composer    | `features/composer/SessionComposer.tsx`                                                                      | candidate blocks, editable routine, confirm-gated Start (only write)                                                                          | ⬜        |
| Retention   | `features/retention/RetentionQueue.tsx`                                                                      | due list, snooze/confirm/lower/reopen (typed)                                                                                                 | ⬜        |
| Voice       | `features/voice/VoiceToast.tsx`, `ActionDraftCard.tsx`                                                       | STT toast, mic-mute glyph, wake-cue proposed-action confirm card                                                                              | ⬜        |
| Pieces      | `features/pieces/*` (PieceDetail, PiecesPanel, HistoryPanel, IntakeForm, BlockRow, GoalsPanel, RegionEditor) | intake form, goals editor, region/block inline edit, block history                                                                            | ⬜        |
| Score svc   | `features/score/*` (PdfPage, RegionOverlay, anchors.ts, geometry.ts, atlas/)                                 | PDF render, overlays, edition→measure anchors, target calibration/fingerprint                                                                 | ⬜        |
| Settings    | `features/settings/SettingsPanel.tsx`                                                                        | theme, brain/TTS provider, wake-word, metronome sound/boost, ladder defaults, calendar capacity, vault dir, verdict aliases, API-key presence | ⬜        |
| Tutorials   | `features/tutorials/TutorialPanel.tsx`                                                                       | video metadata, region clip mapping, local playback, CRUD                                                                                     | ⬜        |
| References  | `features/references/ReferenceButtons.tsx`                                                                   | external reference/book/method open                                                                                                           | ⬜        |
| Metronome   | `features/metronome/MetronomePopover.tsx`                                                                    | BPM, boost, sound, live state, intent guard                                                                                                   | ⬜        |
| Session bar | `features/session/SessionBar.tsx`                                                                            | current-session event log (newest-first cap), end/export                                                                                      | ⬜        |

## C. IPC contract (every command the frontend may call — none may be invented)

Registered in `src-tauri/src/lib.rs` (~lines 1235–1324). New in v3: `brain_status`, `brain_test_connection` (Phase 1).

- **Settings/keys:** `get_setting`, `set_setting`, `settings_snapshot`, `settings_update`, `api_key_save`, `api_key_clear`
- **Brain:** `brain_ask`, `brain_thread_resume`, `brain_thread_clear`, `brain_intake_apply`, `brain_plan_preview`, `brain_status` (new), `brain_test_connection` (new)
- **Rep/practice:** `rep_open`, `rep_check`, `rep_undo`, `rep_correct`, `rep_adjustment_reverse`, `rep_restart`, `rep_close`, `rep_state`, `rep_pause`, `rep_resume`, `rep_checkpoint`, `rep_reflect`, `rep_safety_stop`, `rep_recovery`
- **Retention:** `retention_due`, `retention_snooze`, `retention_confirm`, `retention_lower`, `retention_reopen`
- **Score atlas:** `score_pdf_editions`, `score_pdf_select`, `score_pdf_bytes`, `score_atlas_target_save`
- **Universe:** `universe_snapshot`
- **Session/composer:** `session_current`, `session_end`, `session_plan_start`
- **Pieces:** `pieces_scan`, `pieces_list`, `piece_get`, `piece_select`, `piece_intake_save`, `piece_field_update`, `progress_summary`
- **Regions:** `region_list`, `region_create`, `region_update`, `region_delete`, `region_merge`, `region_split`
- **Blocks/reps:** `rep_blocks_for_piece`, `block_update`, `block_delete`, `rep_update`, `rep_delete`, `reps_for_block`
- **Goals:** `goal_list`, `goal_create`, `goal_update`, `goal_delete`, `goal_reorder`
- **Tutorials:** `tutorial_video_list/scan/upsert/update/delete/reveal`, `tutorial_clip_create/update/delete`
- **Calendar/recovery:** `daily_work_list/create/update/delete`, `recovery_preview`, `recovery_apply`, `calendar_capacity_set`
- **Ledger:** `anomalies_list`
- **References:** `reference_open`
- **Layout:** `layout_get`, `layout_set`
- **Voice/metronome:** `voice_mute`, `voice_state`, `metro_start`, `metro_stop`, `metro_set`, `metro_state`

## D. Frontend infrastructure to keep

- IPC seam: `src/services/command.ts` (`executeCommand`, `normalizeCommandError`, pluggable `CommandInvoker`) — keep for mock/real swap.
- Dev QA harness: `src/devMock/tauriDevMock.ts`, `npm run dev:mock` (`VITE_DEV_MOCK=1`, intercepts `window.__TAURI_INTERNALS__`). Static-render only; not functional acceptance.
- Tests: collocated `**/*.test.ts(x)` under vitest.

## E. Design tokens to DELETE in the retheme (Phase 2)

- Serif stacks in `src/design/tokens.css`: "New York", "Iowan Old Style", "Palatino Linotype", Baskerville, Georgia.
- Terracotta/brown/off-white hexes: `#9f4937`, `#cf7862`, `#ead8d0`, `#fbf8f2`, `#2e2924`, `#4c2d25`.
- Any outlined/border-only button style.
- The light-theme branch in `theme.ts` (dark-only in v3).
