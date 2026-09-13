export const meta = {
  name: "test-coverage-audit",
  description:
    "Find real test-coverage gaps (not just missing files) per feature cluster across frontend + Rust backend + IPC boundary, verify each, draft skeletons",
  phases: [{ title: "Find gaps" }, { title: "Verify gaps" }],
};

const ROOT = process.env.PRAELUDE_REPO_ROOT ?? process.cwd();

const CLUSTERS = [
  {
    key: "pieces",
    src: [
      "src/features/pieces/BlockRow.tsx",
      "src/features/pieces/GoalsPanel.tsx",
      "src/features/pieces/HistoryPanel.tsx",
      "src/features/pieces/IntakeForm.tsx",
      "src/features/pieces/PieceDetail.tsx",
      "src/features/pieces/PiecesPanel.tsx",
      "src/features/pieces/RegionEditor.tsx",
      "src/features/pieces/AddScore.tsx",
      "src/features/pieces/ConfirmArchive.tsx",
      "src/features/pieces/imslpText.ts",
      "src/features/pieces/types.ts",
    ],
    test: [
      "src/features/pieces/BlockRow.test.tsx",
      "src/features/pieces/GoalsPanel.test.tsx",
      "src/features/pieces/HistoryPanel.test.tsx",
      "src/features/pieces/IntakeForm.test.tsx",
      "src/features/pieces/PieceDetail.test.tsx",
      "src/features/pieces/PiecesPanel.test.tsx",
      "src/features/pieces/RegionEditor.test.tsx",
      "src/features/pieces/AddScore.test.tsx",
      "src/features/pieces/ConfirmArchive.test.tsx",
      "src/features/pieces/imslpText.test.ts",
    ],
    hint: "types.ts is type-only, skip it. IntakeForm.test.tsx is a newly added, uncommitted test file — check it carefully rather than assuming it is complete. AddScore.tsx/ConfirmArchive.tsx/imslpText.ts are the newer IMSLP add-a-score + typed-name-archive flow (ledger #29) — each already has its own test file, so this is a verify-depth pass: check specifically for CAPTCHA-gated download fallback paths (system-browser handoff, Downloads auto-match, drag-drop, paste-URL), and that ConfirmArchive's typed-name confirmation genuinely gates the archive (never a hard delete) rather than just rendering a dialog.",
  },
  {
    key: "score-core",
    src: [
      "src/features/score/PdfPage.tsx",
      "src/features/score/RegionOverlay.tsx",
      "src/features/score/ScoreView.tsx",
      "src/features/score/ScoreWorkspace.tsx",
      "src/features/score/anchors.ts",
      "src/features/score/geometry.ts",
      "src/features/score/types.ts",
    ],
    test: [
      "src/features/score/PdfPage.test.tsx",
      "src/features/score/RegionOverlay.test.tsx",
      "src/features/score/ScoreView.test.tsx",
      "src/features/score/ScoreWorkspace.test.tsx",
      "src/features/score/anchors.test.ts",
      "src/features/score/geometry.test.ts",
    ],
    hint: "types.ts is type-only, skip it. PdfPage.test.tsx is a newly added, uncommitted test file — check it carefully rather than assuming it is complete.",
  },
  {
    key: "score-atlas",
    src: [
      "src/features/score/atlas/calibration.ts",
      "src/features/score/atlas/draft.ts",
      "src/features/score/atlas/fingerprint.ts",
      "src/features/score/atlas/hierarchy.ts",
      "src/features/score/atlas/index.ts",
      "src/features/score/atlas/model.ts",
      "src/features/score/atlas/result.ts",
      "src/features/score/atlas/savePayload.ts",
      "src/features/score/atlas/selection.ts",
    ],
    test: [
      "src/features/score/atlas/calibration.test.ts",
      "src/features/score/atlas/draft.test.ts",
      "src/features/score/atlas/fingerprint.test.ts",
      "src/features/score/atlas/hierarchy.test.ts",
      "src/features/score/atlas/savePayload.test.ts",
      "src/features/score/atlas/selection.test.ts",
    ],
    hint: "index.ts is a barrel re-export, skip it. model.ts is type-only, skip it. atlas/result.ts (success/failure DomainResult helpers) has NO test file at all, direct or indirect — confirm and produce a real gap with skeleton. Check whether calibration.ts/draft.ts/hierarchy.ts use success()/failure() and whether their own tests exercise both branches.",
  },
  {
    key: "score-atlas-mapping",
    src: [
      "src/features/score/atlas/mapping/MapScoreWizard.tsx",
      "src/features/score/atlas/mapping/anchors.ts",
      "src/features/score/atlas/mapping/calibrationApi.ts",
      "src/features/score/atlas/mapping/candidate.ts",
      "src/features/score/atlas/mapping/prefill.ts",
      "src/features/score/atlas/mapping/strip.ts",
    ],
    test: [
      "src/features/score/atlas/mapping/MapScoreWizard.test.tsx",
      "src/features/score/atlas/mapping/anchors.test.ts",
      "src/features/score/atlas/mapping/candidate.test.ts",
      "src/features/score/atlas/mapping/prefill.test.ts",
      "src/features/score/atlas/mapping/strip.test.ts",
    ],
    hint: "calibrationApi.ts (anchorsToPoints, pointsToAnchors, defaultCalibrationApi.save/get) has NO dedicated test file. Check carefully whether MapScoreWizard.test.tsx mocks/exercises it indirectly (e.g. via an injected CalibrationApi fake) — if so, identify exactly which branches/edge cases are NOT covered (e.g. get() returning null, save() rejecting, round-trip anchorsToPoints/pointsToAnchors) rather than claiming total absence. strip.ts is the newest file here (parallel XML measure-strip + two-way highlight, ledger #31/D5) and per this project's own requirements ledger is explicitly flagged PARTIAL with an open verifier discovery (the wizard's page pane never actually called renderPage) — give this file a high-attention verify-depth pass: clamped/density-aware interpolation math at its boundaries, and the 'honest warning rows' behavior when XML measure facts are missing or inconsistent with the page count.",
  },
  {
    key: "score-atlas-ui",
    src: [
      "src/features/score/atlas/ui/TargetDraftEditor.tsx",
      "src/features/score/atlas/ui/TargetDraftOverlay.tsx",
      "src/features/score/atlas/ui/index.ts",
    ],
    test: [
      "src/features/score/atlas/ui/TargetDraftEditor.test.tsx",
      "src/features/score/atlas/ui/TargetDraftOverlay.test.tsx",
    ],
    hint: "index.ts is a barrel, skip it.",
  },
  {
    key: "universe",
    src: [
      "src/features/universe/UniverseWorkspace.tsx",
      "src/features/universe/api.ts",
      "src/features/universe/graphLayout.ts",
      "src/features/universe/types.ts",
      "src/features/universe/graph/DetailPanel.tsx",
      "src/features/universe/graph/format.ts",
      "src/features/universe/graph/palettes.ts",
      "src/features/universe/graph/simulation.ts",
    ],
    test: [
      "src/features/universe/UniverseWorkspace.test.tsx",
      "src/features/universe/api.test.ts",
      "src/features/universe/graph/DetailPanel.test.tsx",
      "src/features/universe/graph/format.test.ts",
      "src/features/universe/graph/palettes.test.ts",
      "src/features/universe/graph/simulation.test.ts",
    ],
    hint: "types.ts is type-only, skip it. graphLayout.ts (starRadius, stableIdHash, layoutUniversePieces) has NO dedicated test file — check whether UniverseWorkspace.test.tsx or graph/simulation.test.ts exercises it indirectly; if simulation.ts is a separate physics layout that does not call graphLayout.ts, this is a genuine full gap covering pure, easily-unit-tested math (empty array, single piece, NaN/negative focused_seconds, hash collisions, deterministic ordering). api.test.ts and universe/graph/*.test.ts are newly added, uncommitted test files — check them carefully rather than assuming complete.",
  },
  {
    key: "calendar",
    src: [
      "src/features/calendar/CalendarWorkspace.tsx",
      "src/features/calendar/RecoveryReview.tsx",
      "src/features/calendar/api.ts",
      "src/features/calendar/dates.ts",
      "src/features/calendar/types.ts",
    ],
    test: [
      "src/features/calendar/CalendarWorkspace.test.tsx",
      "src/features/calendar/RecoveryReview.test.tsx",
      "src/features/calendar/api.test.ts",
      "src/features/calendar/dates.test.ts",
    ],
    hint: "types.ts is type-only, skip it. Note api.test.ts already contains several TODO comments flagging unvalidated inputs passed straight to invoke() (e.g. empty decisions array, boundary capacity minutes) — treat those TODOs as a strong signal of a genuine, already-identified gap (client-side validation vs trusting the backend) and turn the most concrete one into a real finding rather than re-discovering it from scratch.",
  },
  {
    key: "composer",
    src: [
      "src/features/composer/SessionComposer.tsx",
      "src/features/composer/domain/composeSessionDraft.ts",
      "src/features/composer/domain/index.ts",
      "src/features/composer/domain/models.ts",
      "src/features/composer/index.ts",
      "src/features/composer/useComposerCandidates.ts",
      "src/features/composer/useSessionPlan.ts",
    ],
    test: [
      "src/features/composer/SessionComposer.test.tsx",
      "src/features/composer/domain/composeSessionDraft.test.ts",
      "src/features/composer/useComposerCandidates.test.ts",
      "src/features/composer/useSessionPlan.test.ts",
    ],
    hint: "domain/index.ts and index.ts are barrels, skip them. domain/models.ts is types + constants only, skip it unless you find an untested constant-boundary behavior actually implemented elsewhere.",
  },
  {
    key: "retention",
    src: [
      "src/features/retention/RetentionQueue.tsx",
      "src/features/retention/api.ts",
      "src/features/retention/date.ts",
      "src/features/retention/index.ts",
      "src/features/retention/types.ts",
      "src/features/retention/useRetention.ts",
    ],
    test: [
      "src/features/retention/RetentionQueue.test.tsx",
      "src/features/retention/api.test.ts",
      "src/features/retention/date.test.ts",
    ],
    hint: `index.ts and types.ts skip. useRetention.ts has NO dedicated test file, but is heavily exercised indirectly through RetentionQueue.test.tsx, including a "useRetention replay reconciliation" describe block with a custom ReplayHarness component. Do NOT report it as a blanket gap. Instead, read useRetention.ts closely against every test in RetentionQueue.test.tsx and find the SPECIFIC branches that are never reached, for example (verify each, don't assume): (1) the mutate() guard when checkId is not found in the current checks array ("no longer in the due queue"), which fires when an item is mutated after being removed from the queue by another update; (2) the mutate() empty-trimmed-payload validation branch for confirm/lower/reopen — the UI disables the button on empty input so this hook-level guard may never be exercised directly; (3) the branch where a receipt's status is neither "committed" nor "rejected"; (4) replay/dedupe of a repeated receipt_id for confirm/lower/reopen mutations specifically (only snooze replay is tested); (5) clearError() — check if anything in the UI/tests ever calls or exercises it. For each one you confirm is genuinely unreached, write it up with a skeleton using a small harness component in the style of ReplayHarness in RetentionQueue.test.tsx, OR a plain renderHook-based test if that's cleaner.`,
  },
  {
    key: "brain",
    src: [
      "src/features/brain/BrainWorkspace.tsx",
      "src/features/brain/api.ts",
      "src/features/brain/types.ts",
    ],
    test: [
      "src/features/brain/BrainWorkspace.test.tsx",
      "src/features/brain/BrainNavigation.test.tsx",
      "src/features/brain/api.test.ts",
    ],
    hint: "types.ts is type-only, skip it. api.test.ts is a newly added, uncommitted test file that already contains several TODO comments flagging unvalidated inputs (blank question string reaching brain_ask unvalidated, empty changes array in applyIntakeReview, discarded return values in clearThread/schedule). Treat those TODOs as concrete, already-identified gaps — pick the most consequential one(s) and turn into real findings with skeletons, rather than just re-listing the TODOs verbatim. Also check BrainWorkspace.tsx/BrainWorkspace.test.tsx for gaps around proposed_action handling (the confirm-gated voice action draft) and grounding/citation rendering when fields are null/missing.",
  },
  {
    key: "voice",
    src: [
      "src/features/voice/ActionDraftCard.tsx",
      "src/features/voice/VoiceToast.tsx",
      "src/features/voice/domain/actionDraft.ts",
      "src/features/voice/domain/delivery.ts",
      "src/features/voice/domain/index.ts",
      "src/features/voice/domain/proposedAction.ts",
      "src/features/voice/domain/resultDescriptor.ts",
      "src/features/voice/domain/spokenNumber.ts",
      "src/features/voice/domain/tierAIntent.ts",
      "src/features/voice/domain/actionDraftSpeech.ts",
      "src/features/voice/domain/assistantDirected.ts",
      "src/features/voice/domain/spokenConfirmation.ts",
      "src/features/voice/fixtures/tierAReplay.ts",
      "src/features/voice/useVoice.ts",
    ],
    test: [
      "src/features/voice/ActionDraftCard.test.tsx",
      "src/features/voice/VoiceToast.test.tsx",
      "src/features/voice/domain/actionDraft.test.ts",
      "src/features/voice/domain/delivery.test.ts",
      "src/features/voice/domain/proposedAction.test.ts",
      "src/features/voice/domain/resultDescriptor.test.ts",
      "src/features/voice/domain/spokenNumber.test.ts",
      "src/features/voice/domain/tierAIntent.test.ts",
      "src/features/voice/domain/actionDraftSpeech.test.ts",
      "src/features/voice/domain/assistantDirected.test.ts",
      "src/features/voice/domain/spokenConfirmation.test.ts",
      "src/features/voice/useVoice.test.ts",
    ],
    hint: "domain/index.ts is a barrel, skip it. fixtures/tierAReplay.ts is static fixture data used by other tests, skip it unless it contains real transform logic. domain/proposedAction.test.ts is a newly added, uncommitted test file — check it carefully rather than assuming complete, this is the confirm-gated voice-to-mutation boundary and malformed-proposal handling is safety-critical per this project's golden rule that nothing mutates without explicit user confirmation. domain/actionDraftSpeech.ts, domain/assistantDirected.ts, and domain/spokenConfirmation.ts are newer additions to this same safety-critical boundary (assistant-directed no-wake-phrase questions + the editable spoken draft requiring an exact-once confirm/cancel) — each already has a test file, so treat as a verify-depth pass on exactly the same bar as proposedAction: look for a malformed/ambiguous transcript, a confirm/cancel spoken with extra words around it, and a double-confirm race.",
  },
  {
    key: "rep",
    src: [
      "src/features/rep/BlockForm.tsx",
      "src/features/rep/RepHud.tsx",
      "src/features/rep/useCrud.ts",
      "src/features/rep/useRep.ts",
    ],
    test: [
      "src/features/rep/BlockForm.test.tsx",
      "src/features/rep/RepHud.test.tsx",
      "src/features/rep/useCrud.test.ts",
      "src/features/rep/useRep.test.ts",
    ],
    hint: 'This is the core practice-attempt mutation path (rep_check / mastery / attempt ledger) — pay special attention to error-handling and idempotency/dedupe edge cases given the project\'s durable-receipt architecture (see the receipt-related patterns already tested in retention/calendar for what "good" coverage of this looks like). Also worth checking: commit f57cebe just fixed a real shipped bug where the mastery rung streak counter froze at 0/N instead of tracking live progress while climbing to target — check whether useRep.test.ts/RepHud.test.tsx actually assert a MID-CLIMB streak value (not just initial and final-mastery states), since that exact gap let a real regression ship.',
  },
  {
    key: "ledger-receipts-metronome",
    src: [
      "src/features/ledger/AnomaliesPanel.tsx",
      "src/features/ledger/LedgerCalendarWorkspace.tsx",
      "src/features/ledger/LedgerWorkspace.tsx",
      "src/features/receipts/ReceiptCenter.tsx",
      "src/features/references/ReferenceButtons.tsx",
      "src/features/metronome/MetronomePopover.tsx",
      "src/features/metronome/intentGuard.ts",
      "src/features/metronome/useMetronome.ts",
      "src/features/metronome/MetronomeQuickBar.tsx",
      "src/features/metronome/useTempoScrubber.ts",
    ],
    test: [
      "src/features/ledger/AnomaliesPanel.test.tsx",
      "src/features/ledger/LedgerCalendarWorkspace.test.tsx",
      "src/features/ledger/LedgerWorkspace.test.tsx",
      "src/features/receipts/ReceiptCenter.test.tsx",
      "src/features/references/ReferenceButtons.test.tsx",
      "src/features/metronome/MetronomePopover.test.tsx",
      "src/features/metronome/intentGuard.test.ts",
      "src/features/metronome/useMetronome.test.ts",
      "src/features/metronome/MetronomeQuickBar.test.tsx",
    ],
    hint: "ReceiptCenter.tsx is the shared committed/rejected/duplicate receipt-classification primitive used across many other features (retention, rep, calendar) — check its own test covers every receipt kind/status combination those other features rely on, since a gap here silently weakens every consumer. useMetronome.ts/intentGuard.ts back commit 853f440's 'state-aware serialized metronome transitions' — check for a test proving a later-issued-but-earlier-resolving transition can't stomp a newer one (out-of-order async resolution), not just that transitions individually work. useTempoScrubber.ts (the shared drag/wheel/arrow-key tempo-scrubbing gesture hook behind the Score-header quick bar) has NO dedicated test file — its own doc comment says it is 'shared by the popover wheel and the quick-bar readout', so check whether MetronomePopover.test.tsx or MetronomeQuickBar.test.tsx actually exercises its pointer-drag rounding math, the two-direction wheel accumulator (partial deltaY carrying across events, not just one big scroll), the try/catch pointer-capture fallback for jsdom, and arrow-key nudging — skip MetronomeIcons.tsx entirely, it is a pure decorative aria-hidden SVG icon set with no logic.",
  },
  {
    key: "tutorials-session-settings",
    src: [
      "src/features/tutorials/TutorialPanel.tsx",
      "src/features/tutorials/types.ts",
      "src/features/session/SessionBar.tsx",
      "src/features/session/useSession.ts",
      "src/features/settings/BrainConnection.tsx",
      "src/features/settings/SettingsPanel.tsx",
      "src/features/settings/BooksPanel.tsx",
    ],
    test: [
      "src/features/tutorials/TutorialPanel.test.tsx",
      "src/features/session/SessionBar.test.tsx",
      "src/features/session/useSession.test.ts",
      "src/features/settings/BrainConnection.test.tsx",
      "src/features/settings/SettingsPanel.test.tsx",
      "src/features/settings/BooksPanel.test.tsx",
    ],
    hint: "tutorials/types.ts is type-only, skip it. session/SessionBar.test.tsx is a newly added, uncommitted test file — check it carefully rather than assuming complete. useSession.ts is the active-session state machine (start/pause/resume/end, focus-time accounting per the pause-aware focus time feature in this project) — check boundary/backward-clock and pause-cap edge cases specifically. BooksPanel.tsx (Settings' books corpus registry list/add/remove, ledger #30) already has its own test file — verify-depth pass only. Skip src/features/settings/SettingsIcons.tsx, it is a pure decorative icon set with no logic.",
  },
  {
    key: "shell-components",
    src: [
      "src/shell/Shell.tsx",
      "src/shell/WorkspaceStub.tsx",
      "src/App.tsx",
      "src/components/ConfirmDelete.tsx",
      "src/components/EditableField.tsx",
      "src/components/EditableNumber.tsx",
      "src/components/FloatingPanel.tsx",
      "src/components/Popover.tsx",
      "src/components/usePanels.ts",
      "src/shell/terms.ts",
    ],
    test: [
      "src/shell/Shell.test.tsx",
      "src/shell/ShellSurfaces.test.tsx",
      "src/shell/WorkspaceStub.test.tsx",
      "src/App.smoke.test.tsx",
      "src/components/ConfirmDelete.test.tsx",
      "src/components/EditableField.test.tsx",
      "src/components/EditableNumber.test.tsx",
      "src/components/FloatingPanel.test.tsx",
      "src/components/Popover.test.tsx",
      "src/components/usePanels.test.ts",
    ],
    hint: 'shell/WorkspaceStub.test.tsx is a newly added, uncommitted test file — check it carefully rather than assuming complete. App.smoke.test.tsx is explicitly a smoke test, not exhaustive — check whether Shell.tsx\'s five-workspace routing/panel-registration logic has real behavioral coverage beyond "it mounts". shell/terms.ts is a tiny constants module (ASSISTANT/HISTORY terminology strings) with no dedicated test — only report a finding here if a real consumer depends on an exact string value in a way a typo would silently break (e.g. a test elsewhere asserting on literal "Assistant"/"History" text), otherwise treat as low priority. src/main.tsx and src/vite-env.d.ts are app bootstrap/ambient-types only — skip both entirely, do not report gaps for them.',
  },
  {
    key: "ui-infra",
    src: [
      "src/ui/Button.tsx",
      "src/ui/Dialog.tsx",
      "src/ui/Disclosure.tsx",
      "src/ui/Panel.tsx",
      "src/ui/Receipt.tsx",
      "src/ui/index.ts",
      "src/design/theme.ts",
      "src/services/command.ts",
      "src/services/commandId.ts",
      "src/state/settings.ts",
      "src/devMock/tauriDevMock.ts",
    ],
    test: [
      "src/ui/Button.test.tsx",
      "src/ui/Dialog.test.tsx",
      "src/ui/Disclosure.test.tsx",
      "src/ui/Panel.test.tsx",
      "src/ui/Receipt.test.tsx",
      "src/design/theme.test.ts",
      "src/services/command.test.ts",
      "src/services/commandId.test.ts",
      "src/state/settings.test.ts",
      "src/devMock/tauriDevMock.repCheck.test.ts",
      "src/devMock/tauriDevMock.smoke.test.tsx",
    ],
    hint: "ui/index.ts is a barrel, skip it. services/command.ts (defineCommand/executeCommand) is the shared IPC command-execution boundary nearly every feature api.ts builds on — check its own test covers error classification (commandErrorMessage), retry/idempotency-key generation (commandId.ts), and non-Error thrown values, since gaps here undermine every feature that depends on it.",
  },
  {
    key: "content-quotes",
    src: ["src/content/quoteMatch.ts", "src/content/quotes.ts"],
    test: ["src/content/quotes.honesty.test.ts"],
    hint: "quoteMatch.ts's exported normalizeQuote/normalizeSource/sourceContainsQuote have NO dedicated unit test file of their own. They are only exercised indirectly through quotes.honesty.test.ts's real-corpus honesty gate, which explicitly SKIPS (describe.skipIf(!corpusPresent)) on any machine without the Obsidian vault present at ~/Desktop/christian's universe/... — meaning on most machines (CI, a fresh clone) these three functions get ZERO test execution, with only the small \"quotes.json corpus shape\" describe block (182-count, id-uniqueness, ≤40-word check) actually always running. Treat this as a genuine, high-value gap: these are pure functions perfectly suited to direct unit tests (empty string, a quote that legitimately spans what looks like a paragraph break, NBSP/tab/CR whitespace, a needle that only matches after normalization, sourceContainsQuote with an empty/whitespace-only quote) that would run on every machine regardless of vault presence. Also check: quoteMatch.ts's own doc comment claims exact parity with the Rust src-tauri/src/brain/corpus.rs normalize_whitespace/normalize_with_map functions — search for any test (TS or Rust) that actually proves this parity byte-for-byte; if none exists, that unenforced-parity claim is itself a concrete integration-kind gap worth reporting (a future edit to either implementation could silently diverge with nothing to catch it).",
  },
  {
    key: "today-and-reader",
    src: [
      "src/features/today/format.ts",
      "src/features/today/quoteRotation.ts",
      "src/features/today/todayPlan.ts",
      "src/features/today/TodayPracticePanel.tsx",
      "src/features/today/TodayWorkspace.tsx",
      "src/features/reader/excerpt.ts",
      "src/features/reader/ReaderWindow.tsx",
    ],
    test: [
      "src/features/today/quoteRotation.test.ts",
      "src/features/today/TodayWorkspace.test.tsx",
      "src/features/reader/excerpt.test.ts",
      "src/features/reader/ReaderWindow.test.tsx",
    ],
    hint: "Skip src/features/today/menuIcons.tsx entirely — pure decorative aria-hidden SVG icon set, no logic. todayPlan.ts (readTodayPlan/writeTodayPlan — the localStorage-backed daily-intention text behind the 'Today's date-scoped plan' feature, 1200-char bound, blank input clears the key instead of storing empty, dispatches a TODAY_PLAN_CHANGED_EVENT CustomEvent, and swallows a blocked-storage exception so a locked-down WebView can't break the practice surface) has NO dedicated test file at all — check whether TodayWorkspace.test.tsx or TodayPracticePanel's own render tests exercise it indirectly (e.g. by seeding/reading window.localStorage) before concluding a full gap; given this backs a feature explicitly called out in this project's current status doc, a real gap here is high priority. format.ts's compactDuration/todayLabel are small pure formatters with no dedicated test file — check compactDuration's minute-boundary behavior specifically (0, 59, 60, 61, and an exact multiple of 60 where the 'Xh' vs 'Xh Ym' branch matters). TodayPracticePanel.tsx is 444 lines with no dedicated test file of its own — read TodayWorkspace.test.tsx closely and report exactly which of its interactions are and are not actually exercised through that shell, rather than assuming either total coverage or total absence.",
  },
];

// Rust backend clusters. Convention differs from the frontend: tests live
// inline in the same file under `#[cfg(test)] mod tests { ... }`, not in a
// separate file, so each cluster names the files to read whole (including
// their own embedded tests, if any) rather than separate src/test lists.
const RUST_CLUSTERS = [
  {
    key: "rs-practice-loop-session",
    files: ["src-tauri/src/store/practice_loop.rs"],
    hint: `This file is 1874 lines with ZERO #[cfg(test)] tests anywhere — the single largest raw coverage gap in the whole codebase (frontend + backend). Focus this pass on the practice-session state-machine half: v2_pause (~L850), v2_resume (~L931), v2_checkpoint (~L1013), v2_reflect (~L1088), v2_safety_stop (~L1167), v2_recover (~L1256), v2_restore_active_at (~L1808). Each is an idempotent command-replay transaction: lock -> tx -> begin_operation (replay check by command_id+fingerprint) -> validate current set_state/safety_state -> mutate set_contract -> insert_loop_event -> finish_operation -> commit. To ground skeletons in real fixtures, grep src-tauri/src/rep/mod.rs's "#[cfg(test)] mod tests" for its Store::open(":memory:") + upsert_piece pattern and however it creates a block/set_contract row to obtain a block_id (grep store/model.rs and store/crud.rs too) — copy that idiom exactly rather than inventing one. Real gaps to look for: pausing an already-paused set (invalid-transition error), resuming a set that isn't paused, safety_stop from various states, recover after safety_stop, replaying the exact same command_id twice (must return the cached receipt, not re-mutate), replaying the same command_id with different args (fingerprint mismatch), and v2_restore_active_at with zero vs one vs an inconsistent/orphaned active set.`,
  },
  {
    key: "rs-practice-loop-retention",
    files: ["src-tauri/src/store/practice_loop.rs"],
    hint: `Same file as rs-practice-loop-session (1874 lines, ZERO tests) — this pass covers the retention-check half only, to keep each pass tractable. Read validate_retention_condition (~L79), validate_retention_result (~L121), retention_view (~L649), retention_due (~L1507), retention_due_for_piece (~L1532), and the v2_retention_transition path invoked by retention_snooze/retention_confirm/retention_lower/retention_reopen (~L1720-1808). This is the Rust counterpart to the frontend's src/features/retention/useRetention.ts — a contract mismatch between the two (e.g. frontend's isValidSnoozeDate guard vs what the backend actually validates) is itself worth flagging as an integration-kind gap. Ground skeletons in the same Store::open(":memory:")/upsert_piece fixture idiom from rep/mod.rs's test module; check store/model.rs for the real RetentionCondition/RetentionResult/RetentionDecision shapes. Real gaps: retention_due returning nothing vs several sorted correctly, a snooze to a date before the current due_date, confirm/lower/reopen with an empty/whitespace note, a decision applied to a check not currently in "due"/"snoozed" state, retention_due_for_piece filtering correctly for a piece with zero due checks.`,
  },
  {
    key: "rs-v8-backfill",
    files: [
      "src-tauri/src/store/v8_backfill.rs",
      "src-tauri/src/store/backfill.rs",
      "src-tauri/src/store/history_backfill.rs",
    ],
    hint: `v8_backfill.rs (357 lines) has ZERO #[cfg(test)] tests — a one-time schema-v8 data backfill/migration routine. backfill.rs and history_backfill.rs are included ONLY as convention references: both DO have #[cfg(test)] sections using Connection::open_in_memory() — read their fixture setup and copy the idiom for v8_backfill.rs's skeletons. Because this is a migration script, treat "no coverage" as high severity: an untested backfill can silently corrupt or drop production data on the one real run that matters (this project's changelog backs up installs with SHA-256 hashes before every migration specifically because of this risk). Real gaps: running the backfill on an empty pre-v8 table, on rows already in the target v8 shape (idempotency — running twice must not double-apply or error), on a row with a NULL/missing field the backfill needs to derive, and row-count-preserved assertions (nothing silently dropped).`,
  },
  {
    key: "rs-rep-ladder",
    files: ["src-tauri/src/rep/ladder.rs", "src-tauri/src/rep/mod.rs"],
    hint: `ladder.rs (264 lines) already has substantial embedded tests (~227 of 264 lines) — this is a VERIFY-existing-gaps pass, not a from-scratch one, so don't pad. resolve_auto/resolve_auto_with_defaults compute BPM_STEP=4.0, rung count K=ceil((target-start)/step) at least 1, clean_needed=round(planned/K) clamped 1..=5 (fixed at 3 with no target). CRITICAL CONTEXT: commit f57cebe ("fix(rep): show the moving rung streak while climbing to target, not a frozen 0/N") just fixed a real shipped bug in exactly this area, meaning the tests that existed before that fix had a real gap. Read ladder.rs's full #[cfg(test)] module, then grep rep/mod.rs for "streak"/"rung"/"mastery_progress_streak"/"current_clean_streak" to see how ladder math is projected into RepSnapshot. Check specifically: does any test assert the MID-CLIMB streak value (not just start/final-mastery states) — if not, that is the exact class of gap that shipped the f57cebe bug and is the highest-priority finding for this cluster. Also check boundary math: start==target (K must not be 0 or divide-by-zero), planned much smaller/larger than K (clean_needed floor/cap), and a rung target that's an exact multiple of BPM_STEP vs not (ceil() rounding).`,
  },
  {
    key: "rs-voice-intent-hotloop",
    files: [
      "src-tauri/src/voice_loop.rs",
      "src-tauri/src/intent/mod.rs",
      "src-tauri/src/intent/numbers.rs",
    ],
    hint: `The backend half of Praelude's safety-critical deterministic voice hot loop (project golden rule: "Deterministic hot loop (regex intent router); the LLM brain is for open questions only" and "the user is the sensor; the app is the memory — speech only, human gives every verdict"). voice_loop.rs is 2203 lines with ~1211 test lines, intent/mod.rs is 1449 lines with ~624 test lines — both already deep, so this is a verify-existing-depth pass: sample their public match/parse entry points (grep "pub fn") and #[cfg(test)] boundaries rather than reading every line, and only report genuinely uncovered branches. intent/numbers.rs is only 252 lines with just 69 test lines (the thinnest ratio of the three) — read this one in FULL and name specific untested parsing branches (compound numbers, "a hundred and five" vs "one oh five", ordinals used where cardinals are expected). Also check for intent phrases that are substrings of a longer unrelated sentence (false-positive hot-loop match risk) and a false-negative fallthrough to the LLM brain on what should have deterministically matched.`,
  },
  {
    key: "rs-metronome",
    files: ["src-tauri/src/metronome.rs"],
    hint: `1681 lines with ~1517 test lines — the deepest embedded coverage in the Rust backend, backing commit 853f440's "harden long-session coordination". This is a verify-only pass: read the public API (grep "pub fn") and its #[cfg(test)] structure, and report ONLY genuinely missing high-value cases — do not pad a well-tested file. Look specifically for: concurrent/overlapping transition requests arriving in reversed completion order (does a stale in-flight transition ever win over a newer one — the exact bug class "serialized" is meant to prevent), a tempo change requested mid-transition, and any unwrap()/expect() in the file not exercised by an existing test with the failing input.`,
  },
  {
    key: "rs-recovery-brain",
    files: [
      "src-tauri/src/recovery/mod.rs",
      "src-tauri/src/brain/context.rs",
      "src-tauri/src/brain/score_context.rs",
    ],
    hint: `Moderate-coverage cluster: recovery/mod.rs (738 lines, ~208 test lines) backs the frontend's calendar RecoveryReview/recovery_preview/recovery_apply flow — check capacity-exceeded days, an item whose effective_deadline has already passed, and multi-day reflow when several items compete for the same limited capacity. brain/context.rs (833 lines, ~429 test lines) and brain/score_context.rs (879 lines, only ~191 test lines relative to its size — the thinnest here) assemble the exact grounding context sent to an LLM provider (matches the frontend's BrainGroundingSummary: knowledge_status/musicxml_status/warnings). A wrong grounding context means the LLM silently reasons about the wrong measures, so check: musicxml missing, piece has no active block, and region/page context stale relative to what's on screen. Read score_context.rs in full given its thinner ratio; sample context.rs's public entry points.`,
  },
  {
    key: "rs-imslp-pieces-import",
    files: ["src-tauri/src/imslp.rs", "src-tauri/src/pieces.rs"],
    hint: `Two brand-new modules (both landed after this audit script was first written) backing the IMSLP add-a-score flow, ledger #29: imslp.rs (762 lines, ~276 test lines) is the search/editions/browser-handoff client; pieces.rs (420 lines, ~183 test lines) is piece intake and typed-name archive. Both already carry real embedded tests, unlike the zero-coverage files elsewhere in this audit, so this is a verify-existing-depth pass: read each file's real #[cfg(test)] module first. Then look specifically for: a malformed or redirect IMSLP search/editions API response, a download URL that fails the https-scheme assertion added in commit 923333e ("assert https scheme before browser handoff, verifier defense-in-depth") — confirm a test actually exercises the rejection path, not just the happy path — and the typed-name-confirmation archive in pieces.rs genuinely moving a record to .trash rather than a hard delete, including a typed name that does NOT match (must refuse).`,
  },
  {
    key: "rs-day-sheet-storage",
    files: ["src-tauri/src/store/day_sheet.rs"],
    hint: `Brand-new storage layer (596 lines, ~245 test lines, commit 720abac "Practice Notebook day-sheet storage layer, spec C2") backing a "day sheet" UI feature that is still unbuilt on the frontend — this file is groundwork for the #1 item on this project's active requirements ledger (see .workflow/LEDGER.md in the repo root), so its correctness gates a major upcoming feature rather than something already shipped and observed working. Read its full #[cfg(test)] module first (do not assume zero coverage — it has some), then grep it for "pub fn" to get the real function names rather than guessing, and look for gaps around: an empty/no-entry day, writing to a day sheet that already has content (overwrite vs merge semantics), a date-boundary/timezone edge (a day sheet keyed by a local date string vs a UTC instant), and any idempotency guarantee if the same write is issued twice (matching this project's command_id/fingerprint replay pattern used elsewhere in store/practice_loop.rs — check whether day_sheet.rs follows the same convention or diverges).`,
  },
];

function absPaths(list) {
  return list.map((p) => `${ROOT}/${p}`).join("\n");
}

const GAPS_SCHEMA = {
  type: "object",
  properties: {
    gaps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: {
            type: "string",
            enum: [
              "untested-symbol",
              "edge-case",
              "error-handling",
              "integration",
            ],
          },
          file: {
            type: "string",
            description: "repo-relative path of the source file the gap is in",
          },
          symbol: {
            type: "string",
            description:
              "exact exported function/hook/component/struct/method name the gap concerns",
          },
          description: { type: "string" },
          failure_scenario: {
            type: "string",
            description:
              "concrete input/state that would silently break, with no test catching it",
          },
          priority: { type: "string", enum: ["high", "medium", "low"] },
          skeleton: {
            type: "string",
            description:
              "a ready-to-paste test skeleton (vitest for TS, #[cfg(test)] mod tests for Rust) matching this repo's existing conventions for this kind of file",
          },
        },
        required: [
          "kind",
          "file",
          "symbol",
          "description",
          "failure_scenario",
          "priority",
          "skeleton",
        ],
      },
    },
  },
  required: ["gaps"],
};

function findPrompt(cluster) {
  return `You are auditing test coverage in the Praelude frontend (Tauri v2 + React/TS, vitest + @testing-library/react) for the "${cluster.key}" feature cluster.

Read these source files:
${absPaths(cluster.src)}

Read these test files (they test the above source files, in some pairing):
${absPaths(cluster.test)}

${cluster.hint ? `Cluster-specific guidance: ${cluster.hint}\n` : ""}
Your job: find REAL, concrete test-coverage gaps — not a generic "add more tests" list. A gap must name an exact exported symbol (function/hook/component) and a concrete failure scenario a missing test would have caught. Categories:
- untested-symbol: an exported function/hook/component with no direct test AND no indirect exercise through a sibling component test in this cluster (check the test files' render/mock setup carefully before claiming this — indirect coverage through a consuming component counts as coverage, but only for the specific branches actually exercised).
- edge-case: a boundary/malformed/concurrent input that the existing tests never send (empty arrays, null/undefined, NaN, negative numbers, duplicate IDs, out-of-order async responses, unmount-mid-request races, StrictMode double-invoke).
- error-handling: a thrown error, rejected promise, or backend rejection/receipt-rejected/malformed-payload path with no test.
- integration: a seam between two files/components in this cluster (e.g. a callback prop, a shared context, a receipt hand-off) that no test exercises end-to-end.

Rules:
- Only reference symbols, prop names, and error strings that literally appear in the files you read. Do not invent or guess at an API you haven't seen.
- Skip type-only files, barrel re-export files, and static fixture data unless they contain real runtime logic.
- Do not report something as a gap if it is already covered (directly or indirectly) by one of the test files you read — read the tests fully before deciding.
- For "skeleton", write a real, runnable-looking vitest test (correct relative import paths from where the new test file would live, matching this repo's actual mocking pattern — e.g. vi.mock("@tauri-apps/api/core") for IPC boundaries, ReceiptCenterProvider wrapper for receipt-consuming hooks, testing-library render/fireEvent/waitFor for components). Look at the existing test files' style and mirror it exactly.
- Prioritize: high = would ship a real bug to Christian at the piano; medium = real gap but low-blast-radius; low = nice-to-have.
- Return at most the genuinely real gaps you found (could be zero, could be several) — do not pad the list to look thorough.`;
}

function verifyPrompt(cluster, gaps) {
  return `You are adversarially re-verifying a test-coverage gap report for the Praelude frontend's "${cluster.key}" cluster, with fresh eyes and no trust in the prior pass.

Re-read the same source files:
${absPaths(cluster.src)}

And the same test files:
${absPaths(cluster.test)}

A previous pass proposed these gaps (JSON):
${JSON.stringify(gaps, null, 2)}

For each proposed gap, verify independently:
1. Does the named symbol actually exist and get exported from the named file? If not, DROP the gap.
2. Is it really uncovered — re-check every test file above (including describe blocks you might skim past) for any direct or indirect exercise of that exact branch/scenario. If it is already covered, DROP the gap.
3. Is the failure_scenario concrete and plausible (not hypothetical/contrived)? If it's not a real risk, DROP the gap.
4. Is the skeleton syntactically sound and does it use imports/mocks/paths that match this repo's real conventions (check import paths resolve correctly from the test file's actual directory, check mocked function names match the real API)? If not, FIX the skeleton rather than dropping the gap, unless the gap itself is bogus.

Return ONLY the gaps that survive this verification, each with (kind, file, symbol, description, failure_scenario, priority, skeleton). Correct any inaccuracies you find in the surviving gaps' description/skeleton. It is fine to return an empty gaps array if nothing survives.`;
}

function findPromptRust(cluster) {
  return `You are auditing test coverage in the Praelude Rust backend (Tauri v2, rusqlite) for the "${cluster.key}" cluster.

Read these files in full:
${absPaths(cluster.files)}

Cluster-specific guidance: ${cluster.hint}

Your job: find REAL, concrete test-coverage gaps, same bar as a frontend audit — not a generic "add more tests" list. A gap must name an exact pub/pub(crate) function or struct method and a concrete failure scenario a missing test would have caught. Categories: untested-symbol, edge-case, error-handling, integration (a Rust<->Rust module seam, e.g. this file's data feeding another module's projection, with no test proving the hand-off).

Rules:
- Only reference function/struct/field names that literally appear in the files you read. Do not invent an API you haven't seen.
- This codebase's Rust test convention is #[cfg(test)] mod tests { use super::*; ... } at the bottom of the same file, using Store::open(":memory:") or Connection::open_in_memory() fixtures — grep sibling files (e.g. src-tauri/src/rep/mod.rs) if you need to confirm the exact fixture-construction idiom (how a piece/block/set_contract row gets created) before writing a skeleton; do not invent a fixture pattern that doesn't match this repo.
- Do not report something as a gap if it is already covered by an existing #[cfg(test)] block in the file — read any existing tests in full before deciding.
- For "skeleton", write a real, compiling-looking Rust #[test] fn inside a mod tests block, with a real fn name, real fixture setup, and real assertions (assert_eq!/assert!/matches!) — not pseudocode.
- Prioritize: high = would ship a real bug to Christian at the piano, corrupt data, or silently desync frontend/backend state; medium = real gap but low-blast-radius; low = nice-to-have.
- Return at most the genuinely real gaps you found (could be zero, could be several) — do not pad the list to look thorough.`;
}

function verifyPromptRust(cluster, gaps) {
  return `You are adversarially re-verifying a test-coverage gap report for the Praelude Rust backend's "${cluster.key}" cluster, with fresh eyes and no trust in the prior pass.

Re-read the same files:
${absPaths(cluster.files)}

A previous pass proposed these gaps (JSON):
${JSON.stringify(gaps, null, 2)}

For each proposed gap, verify independently:
1. Does the named function/struct/method actually exist at (or near) the claimed location? If not, DROP the gap.
2. Is it really uncovered — re-read any existing #[cfg(test)] block in the file for any direct or indirect exercise of that exact branch/scenario. If already covered, DROP the gap.
3. Is the failure_scenario concrete and plausible given the real function signature and body (not hypothetical)? If not, DROP the gap.
4. Is the skeleton's fixture setup (Store::open, Connection::open_in_memory, whatever this file actually needs) realistic and consistent with how this codebase actually builds test fixtures (check a sibling file like rep/mod.rs's test module if unsure)? If not, FIX the skeleton rather than dropping the gap, unless the gap itself is bogus.

Return ONLY the gaps that survive this verification. Correct any inaccuracies you find in the surviving gaps' description/skeleton. It is fine to return an empty gaps array if nothing survives.`;
}

const integrationCluster = { key: "cross-feature-integration" };

function integrationPrompt() {
  return `You are auditing CROSS-FEATURE integration test coverage in the Praelude frontend (Tauri v2 + React/TS, at ${ROOT}/src).

This app composes several features into real user flows. Using Grep/Read, find where one feature's module is imported/used by another (e.g. grep for cross-directory imports under src/features/*/ that reference a sibling feature directory), for flows such as:
- Voice wake-cue -> Brain proposed_action -> ActionDraftCard confirm -> an actual rep/retention/session mutation (src/features/voice, src/features/brain, src/features/rep, src/features/session)
- Composer (SessionComposer/useSessionPlan) -> session start -> SessionBar/useSession display
- Calendar RecoveryReview -> daily_work mutation -> Composer/Today workspace picking it up
- Retention queue actions -> Ledger/receipts -> AnomaliesPanel disclosure
- ReceiptCenter (shared mutation-receipt classification) as consumed by rep/retention/calendar mutations

For each such seam, check whether ANY existing test (search src/**/*.test.ts(x)) actually exercises the full hand-off across both modules together, versus each module only being tested in isolation with the other side mocked/stubbed away. A seam where both sides are only unit-tested independently, with no test that wires them together the way the real app does, is a genuine integration gap.

Return via the gaps schema (kind should be "integration" for all of these). For "file", use the primary seam file (e.g. the component that performs the hand-off). For "symbol", name the specific prop/callback/function that crosses the boundary. Be concrete about the failure_scenario: what could silently break because each side is only tested with a mock/stub of the other. Give a skeleton for a realistic integration test (rendering both real modules together, or as close to it as the existing test setup allows — check how src/App.smoke.test.tsx or src/shell/Shell.test.tsx assembles multiple real features together, and mirror that pattern rather than proposing something architecturally new).

Only report seams you actually verified by reading the relevant files — do not guess at imports you haven't confirmed. Return at most 6 of the most consequential integration gaps.`;
}

const ipcBoundaryCluster = { key: "ipc-boundary-and-e2e" };

function ipcBoundaryPrompt() {
  return `You are auditing the IPC BOUNDARY and end-to-end integration test coverage between the Praelude React frontend and its Rust/Tauri backend, at ${ROOT}.

Read ${ROOT}/src-tauri/src/lib.rs and grep it for the full #[tauri::command] list (the real IPC command surface). Separately read ${ROOT}/src/devMock/tauriDevMock.ts (the dev-only invoke-interception mock used for browser-mode smoke testing) to see which commands it stubs. List ${ROOT}/src-tauri/tests/ (narrated_session_replay.rs, narrated_session_scherzo1/2/3.rs, narrated_voice_firewall.rs, knowledge_library.rs, stt_supervisor.rs, tts_gate.rs, tts_live.rs, replay_common/mod.rs, fixtures/*.json) and skim what these narrated-replay integration tests actually drive — per this project's CLAUDE.md they are "old-session speech/state-machine regression boundary; never a piano-grading benchmark", so treat them as a real but bounded integration harness, not exhaustive coverage.

Find concrete gaps:
1. Tauri commands in lib.rs that NO narrated-replay test and NO frontend *.api.test.ts ever calls end-to-end (name specific command names).
2. Spot-check at least 4 commands by comparing the frontend's api.ts call shape (e.g. \`invoke("brain_ask", { request })\`, \`invoke("daily_work_create", { args })\`, a flat-params call) against the actual #[tauri::command] function signature in lib.rs for that command name — a mismatch here would pass every mocked frontend unit test while being broken at real runtime. Report any you find, or confirm the ones you checked line up.
3. A cross-feature flow that's only unit-tested in isolation on each side (e.g. Today's plan -> Composer draft -> session start -> rep check -> retention queue update) with no single test proving data survives the whole chain with real (not mocked) argument shapes on both ends.

Return via the gaps schema, kind "integration" for all of these. Skeletons here should be Rust integration-test-style (living in src-tauri/tests/, following replay_common/mod.rs's harness conventions) OR, if this repo genuinely has no harness capable of a true frontend+backend end-to-end test, say so explicitly and describe what minimal harness would be needed rather than inventing a fake skeleton. Only report what you actually verified by reading the files — do not guess at a command signature you haven't seen. Return at most 6 of the most consequential findings.`;
}

phase("Find gaps");
// All four fan-outs below are mutually independent (different clusters/files) — run
// them concurrently rather than chained, so wall-clock is the slowest single fan-out,
// not the sum of all four.
const [found, integrationFound, rustFound, ipcBoundaryFound] =
  await Promise.all([
    pipeline(CLUSTERS, (cluster) =>
      agent(findPrompt(cluster), {
        label: `find:${cluster.key}`,
        phase: "Find gaps",
        schema: GAPS_SCHEMA,
        model: "sonnet",
        effort: "high",
      }).then((r) => ({
        key: cluster.key,
        gaps: r?.gaps ?? [],
        verify: (gaps) => verifyPrompt(cluster, gaps),
      })),
    ),
    agent(integrationPrompt(), {
      label: "find:cross-feature-integration",
      phase: "Find gaps",
      schema: GAPS_SCHEMA,
      model: "sonnet",
      effort: "high",
    }).then((r) => ({
      key: integrationCluster.key,
      gaps: r?.gaps ?? [],
      verify: (gaps) =>
        `${integrationPrompt()}\n\nA previous pass proposed these gaps (JSON), re-verify each against the rule above with fresh eyes, dropping any that are unverified or already covered, fixing any skeleton that doesn't match this repo's real conventions:\n${JSON.stringify(gaps, null, 2)}`,
    })),
    pipeline(RUST_CLUSTERS, (cluster) =>
      agent(findPromptRust(cluster), {
        label: `find:${cluster.key}`,
        phase: "Find gaps",
        schema: GAPS_SCHEMA,
        model: "sonnet",
        effort: "high",
      }).then((r) => ({
        key: cluster.key,
        gaps: r?.gaps ?? [],
        verify: (gaps) => verifyPromptRust(cluster, gaps),
      })),
    ),
    agent(ipcBoundaryPrompt(), {
      label: "find:ipc-boundary-and-e2e",
      phase: "Find gaps",
      schema: GAPS_SCHEMA,
      model: "sonnet",
      effort: "high",
    }).then((r) => ({
      key: ipcBoundaryCluster.key,
      gaps: r?.gaps ?? [],
      verify: (gaps) =>
        `${ipcBoundaryPrompt()}\n\nA previous pass proposed these gaps (JSON), re-verify each against the rules above with fresh eyes, dropping any that are unverified or already covered, fixing any skeleton/claim that doesn't match this repo's real files:\n${JSON.stringify(gaps, null, 2)}`,
    })),
  ]);

const allFound = [
  ...found,
  integrationFound,
  ...rustFound,
  ipcBoundaryFound,
].filter((r) => r.gaps.length > 0);
log(
  `Find stage: ${allFound.reduce((n, r) => n + r.gaps.length, 0)} candidate gaps across ${allFound.length} clusters`,
);

phase("Verify gaps");
const verified = await pipeline(allFound, (result) =>
  agent(result.verify(result.gaps), {
    label: `verify:${result.key}`,
    phase: "Verify gaps",
    schema: GAPS_SCHEMA,
    model: "sonnet",
    effort: "high",
  }).then((r) => ({ cluster: result.key, gaps: r?.gaps ?? [] })),
);

const final = verified.filter(Boolean).filter((r) => r.gaps.length > 0);
const totalGaps = final.reduce((n, r) => n + r.gaps.length, 0);
log(
  `Verify stage: ${totalGaps} confirmed gaps across ${final.length} clusters`,
);

return { clusters: final, totalGaps };
