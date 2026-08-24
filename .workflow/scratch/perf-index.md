# Perf Index (raw grep pass)

## 1. invoke( calls
```
src/services/command.ts:99:    ? invoke(command)
src/services/command.ts:100:    : invoke(command, args as Record<string, unknown>);
src/devMock/tauriDevMock.ts:11:// surfaces bottom out here — `invoke(cmd, args)` calls
src/devMock/tauriDevMock.ts:12:// `window.__TAURI_INTERNALS__.invoke(...)`, and `listen(event, handler)` calls
src/devMock/tauriDevMock.ts:13:// `invoke('plugin:event|listen', ...)` after `transformCallback(handler)` (also
src/devMock/tauriDevMock.ts:902:    invoke(cmd: string, args?: unknown): Promise<unknown> {
src/features/pieces/PiecesPanel.tsx:81:      await invoke("piece_select", { id });
src/components/usePanels.ts:41:      void invoke("layout_set", { layout: { panels: Object.values(next) } }).catch(
src/features/metronome/useMetronome.ts:182:        await invoke(cmd, args);
src/features/metronome/useMetronome.ts:233:        void invoke("metro_stop").catch(() => {}).finally(finishIntent);
src/features/calendar/api.test.ts:138:  it("propagates a rejected invoke() call without swallowing the error", async () => {
src/features/calendar/api.test.ts:145:  it("resolves with whatever malformed/unexpected payload invoke() returns, unvalidated", async () => {
src/features/metronome/intentGuard.test.ts:110:      "every invoke() in beginMetroIntent()/release() via try/finally — " +
src/features/metronome/intentGuard.test.ts:111:      "assert pending returns to its pre-call baseline after invoke() " +
src/features/metronome/intentGuard.test.ts:112:      "resolves AND after invoke() rejects (error path), using the " +
src/shell/Shell.tsx:331:    void invoke("piece_select", { pieceId: piece.piece_id }).catch(() => {});
src/features/references/ReferenceButtons.tsx:18:  open: (pieceId, provider) => invoke("reference_open", { pieceId, provider }),
src/features/settings/SettingsPanel.tsx:56:  snapshot: () => invoke("settings_snapshot"),
src/features/settings/SettingsPanel.tsx:57:  update: (patch) => invoke("settings_update", { patch }),
src/features/settings/SettingsPanel.tsx:58:  saveKey: (provider, key) => invoke("api_key_save", { provider, key }),
src/features/settings/SettingsPanel.tsx:59:  clearKey: (provider) => invoke("api_key_clear", { provider }),
src/features/tutorials/TutorialPanel.tsx:69:    void invoke("tutorial_video_update", {
src/features/tutorials/TutorialPanel.tsx:123:        await invoke("tutorial_clip_create", { args: { ...editing, title: editing.title.trim(), notes: editing.notes?.trim() || null } });
src/features/tutorials/TutorialPanel.tsx:125:        await invoke("tutorial_clip_update", { id: editingId, patch: {
src/features/tutorials/TutorialPanel.tsx:146:      await invoke("tutorial_clip_delete", { id });
src/features/tutorials/TutorialPanel.tsx:156:      await invoke("tutorial_video_delete", { id });
src/features/tutorials/TutorialPanel.tsx:189:          <button type="button" onClick={() => activeVideo && invoke("tutorial_video_reveal", { id: activeVideo.id }).catch((reason) => setError(errorMessage(reason)))}>Show file</button>
src/features/brain/api.ts:26:    invoke("daily_work_create", {
src/features/voice/useVoice.ts:293:      void invoke("voice_mute", { muted }).catch(() => {});
```

Note: scanned call sites above; none appear directly inside a for/.map(/.forEach(/while block or inside a per-iteration-called function (all are inside effects/callbacks/handlers, not loop bodies). Flagged loop-adjacent: none found — command.ts:99-100 (invoke helper), useComposerCandidates.ts uses Promise.all(pieces.map(async (piece) => ...)) which does NOT call invoke directly (calls api.listGoals etc., verify separately).

## 2. useEffect / useState / useMemo / useCallback (grouped by file)
```
src/App.tsx:21:  useEffect(() => {
src/App.tsx:25:  useEffect(() => {
src/components/ConfirmDelete.tsx:25:  const [open, setOpen] = useState(false);
src/components/EditableField.tsx:17:  const [editing, setEditing] = useState(false);
src/components/EditableField.tsx:18:  const [display, setDisplay] = useState(value);
src/components/EditableField.tsx:19:  const [draft, setDraft] = useState(value);
src/components/EditableField.tsx:28:  useEffect(() => {
src/components/EditableField.tsx:33:  useEffect(() => {
src/components/EditableNumber.tsx:39:  const [editing, setEditing] = useState(false);
src/components/EditableNumber.tsx:40:  const [display, setDisplay] = useState(value);
src/components/EditableNumber.tsx:41:  const [draft, setDraft] = useState(format(value));
src/components/EditableNumber.tsx:43:  useEffect(() => {
src/components/FloatingPanel.tsx:86:  const [current, setCurrent] = useState(() =>
src/components/FloatingPanel.tsx:91:  useEffect(() => {
src/components/FloatingPanel.tsx:96:  useEffect(() => {
src/components/Popover.test.tsx:155:    const [open, setOpen] = useState(true);
src/components/Popover.test.tsx:196:    const [open, setOpen] = useState(true);
src/components/Popover.tsx:110:  useEffect(() => {
src/components/Popover.tsx:52:  const [render, setRender] = useState(open);
src/components/Popover.tsx:53:  const [visible, setVisible] = useState(false);
src/components/Popover.tsx:56:  const position = useCallback(() => {
src/components/Popover.tsx:81:  useEffect(() => {
src/components/Popover.tsx:98:  useEffect(() => {
src/components/usePanels.ts:109:  const resetLayout = useCallback(() => {
src/components/usePanels.ts:33:  const [viewport, setViewport] = useState(viewportSize);
src/components/usePanels.ts:38:  const persist = useCallback((next: Record<string, PanelGeometry>) => {
src/components/usePanels.ts:47:  useEffect(() => {
src/components/usePanels.ts:61:  useEffect(() => {
src/components/usePanels.ts:67:  const register = useCallback((id: string, panelDefaults: PanelDefaults) => {
src/components/usePanels.ts:76:  const update = useCallback(
src/components/usePanels.ts:94:  const raise = useCallback(
src/features/brain/BrainWorkspace.tsx:139:  const [draft, setDraft] = useState("");
src/features/brain/BrainWorkspace.tsx:142:  const [asking, setAsking] = useState(false);
src/features/brain/BrainWorkspace.tsx:145:  const [planLoading, setPlanLoading] = useState(true);
src/features/brain/BrainWorkspace.tsx:154:  useEffect(() => {
src/features/brain/BrainWorkspace.tsx:173:  useEffect(() => {
src/features/brain/BrainWorkspace.tsx:187:  const refreshPlan = useCallback(async () => {
src/features/brain/BrainWorkspace.tsx:204:  useEffect(() => {
src/features/brain/BrainWorkspace.tsx:214:  useEffect(() => {
src/features/brain/BrainWorkspace.tsx:236:  const ask = useCallback(
src/features/brain/BrainWorkspace.tsx:268:  const clearConversation = useCallback(async () => {
src/features/brain/BrainWorkspace.tsx:285:  useEffect(() => {
src/features/brain/BrainWorkspace.tsx:627:  const [open, setOpen] = useState(false);
src/features/brain/BrainWorkspace.tsx:628:  const [date, setDate] = useState(todayLocal);
src/features/brain/BrainWorkspace.tsx:629:  const [minutes, setMinutes] = useState(20);
src/features/brain/BrainWorkspace.tsx:630:  const [saving, setSaving] = useState(false);
src/features/brain/BrainWorkspace.tsx:631:  const [saved, setSaved] = useState(false);
src/features/brain/BrainWorkspace.tsx:748:  const [saving, setSaving] = useState(false);
src/features/brain/BrainWorkspace.tsx:749:  const [saved, setSaved] = useState(false);
src/features/calendar/CalendarWorkspace.tsx:249:  const [creating, setCreating] = useState(false);
src/features/calendar/CalendarWorkspace.tsx:29:  const [weekStart, setWeekStart] = useState(() => startOfWeek(today));
src/features/calendar/CalendarWorkspace.tsx:32:  const [capacity, setCapacity] = useState(60);
src/features/calendar/CalendarWorkspace.tsx:33:  const [capacityDraft, setCapacityDraft] = useState("60");
src/features/calendar/CalendarWorkspace.tsx:35:  const [reviewing, setReviewing] = useState(false);
src/features/calendar/CalendarWorkspace.tsx:36:  const [retentionOpen, setRetentionOpen] = useState(false);
src/features/calendar/CalendarWorkspace.tsx:37:  const [loading, setLoading] = useState(true);
src/features/calendar/CalendarWorkspace.tsx:382:  const [goalId, setGoalId] = useState(firstGoal);
src/features/calendar/CalendarWorkspace.tsx:383:  const [title, setTitle] = useState(work?.title ?? "");
src/features/calendar/CalendarWorkspace.tsx:384:  const [minutes, setMinutes] = useState(work?.planned_minutes ?? 20);
src/features/calendar/CalendarWorkspace.tsx:385:  const [scheduledDate, setScheduledDate] = useState(work?.scheduled_date ?? date);
src/features/calendar/CalendarWorkspace.tsx:386:  const [saving, setSaving] = useState(false);
src/features/calendar/CalendarWorkspace.tsx:40:  const dates = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)), [weekStart]);
src/features/calendar/CalendarWorkspace.tsx:49:  const loadWeek = useCallback(async () => {
src/features/calendar/CalendarWorkspace.tsx:77:  const loadPreview = useCallback(async () => {
src/features/calendar/CalendarWorkspace.tsx:88:  useEffect(() => {
src/features/calendar/CalendarWorkspace.tsx:95:  useEffect(() => { void loadWeek(); }, [loadWeek, weekEnd, weekStart]);
src/features/calendar/CalendarWorkspace.tsx:96:  useEffect(() => { void loadPreview(); }, [loadPreview]);
src/features/calendar/CalendarWorkspace.tsx:97:  useEffect(() => {
src/features/calendar/RecoveryReview.tsx:32:  const [applying, setApplying] = useState(false);
src/features/calendar/RecoveryReview.tsx:35:  const groups = useMemo(() => {
src/features/composer/SessionComposer.tsx:188:  const [budgetInput, setBudgetInput] = useState(String(initialMinutes));
src/features/composer/SessionComposer.tsx:189:  const budget = useMemo(() => validateBudget(budgetInput), [budgetInput]);
src/features/composer/SessionComposer.tsx:191:  const draft = useMemo(() => composeSessionDraft({
src/features/composer/SessionComposer.tsx:197:  const [startMessage, setStartMessage] = useState("");
src/features/composer/SessionComposer.tsx:199:  useEffect(() => {
src/features/composer/SessionComposer.tsx:205:  const allocation = useMemo(
src/features/composer/SessionComposer.tsx:213:  const placedCandidateIds = useMemo(() => new Set(
src/features/composer/useComposerCandidates.ts:162:  const [loading, setLoading] = useState(false);
src/features/composer/useComposerCandidates.ts:167:  useEffect(() => {
src/features/composer/useComposerCandidates.ts:175:  const reload = useCallback(async () => {
src/features/composer/useComposerCandidates.ts:210:  useEffect(() => {
src/features/composer/useSessionPlan.ts:110:  const startItem = useCallback(
src/features/composer/useSessionPlan.ts:132:  const clearPlan = useCallback(() => setActivePlan(null), []);
src/features/composer/useSessionPlan.ts:64:  const runStart = useCallback(
src/features/composer/useSessionPlan.ts:95:  const startPlan = useCallback(
src/features/ledger/AnomaliesPanel.tsx:134:  const [loading, setLoading] = useState(true);
src/features/ledger/AnomaliesPanel.tsx:136:  const load = useCallback(async () => {
src/features/ledger/AnomaliesPanel.tsx:150:  useEffect(() => {
src/features/ledger/LedgerWorkspace.tsx:17:  const [loading, setLoading] = useState(true);
src/features/ledger/LedgerWorkspace.tsx:20:  const load = useCallback(async () => {
src/features/ledger/LedgerWorkspace.tsx:39:  useEffect(() => {
src/features/metronome/MetronomePopover.tsx:108:  const onWheelPointerMove = useCallback(
src/features/metronome/MetronomePopover.tsx:121:  const endWheelDrag = useCallback(
src/features/metronome/MetronomePopover.tsx:144:  const beatDots = useMemo(() => Array.from({ length: beats }, (_, i) => i), [beats]);
src/features/metronome/MetronomePopover.tsx:63:  const commitDraft = useCallback(() => {
src/features/metronome/MetronomePopover.tsx:78:  useEffect(() => {
src/features/metronome/MetronomePopover.tsx:94:  const onWheelPointerDown = useCallback(
src/features/metronome/useMetronome.ts:156:  const applyState = useCallback((s: MetroState) => {
src/features/metronome/useMetronome.ts:161:  const patch = useCallback((p: Partial<MetroState>) => {
src/features/metronome/useMetronome.ts:167:  const showError = useCallback((msg: string) => {
src/features/metronome/useMetronome.ts:173:  const clearError = useCallback(() => {
src/features/metronome/useMetronome.ts:178:  const call = useCallback(
src/features/metronome/useMetronome.ts:198:  useEffect(() => {
src/features/metronome/useMetronome.ts:238:  const cancelPreview = useCallback(() => {
src/features/metronome/useMetronome.ts:245:  const start = useCallback(
src/features/metronome/useMetronome.ts:261:  const stop = useCallback(() => {
src/features/metronome/useMetronome.ts:268:  const toggle = useCallback(() => {
src/features/metronome/useMetronome.ts:273:  const set = useCallback(
src/features/metronome/useMetronome.ts:281:  const setBpm = useCallback(
src/features/metronome/useMetronome.ts:299:  const setBpmDrag = useCallback(
src/features/metronome/useMetronome.ts:329:  const commitBpmDrag = useCallback(
src/features/metronome/useMetronome.ts:345:  const nudgeBpm = useCallback(
src/features/metronome/useMetronome.ts:350:  const setBeatsPerBar = useCallback(
src/features/metronome/useMetronome.ts:358:  const setSubdivision = useCallback(
src/features/metronome/useMetronome.ts:366:  const setAccent = useCallback(
src/features/metronome/useMetronome.ts:371:  const setGain = useCallback(
src/features/metronome/useMetronome.ts:379:  const setBoost = useCallback(
src/features/metronome/useMetronome.ts:384:  const selectSound = useCallback(
src/features/pieces/BlockRow.tsx:102:  useEffect(() => {
src/features/pieces/BlockRow.tsx:62:  const [expanded, setExpanded] = useState(false);
src/features/pieces/GoalsPanel.tsx:165:  const [addingSubgoal, setAddingSubgoal] = useState(false);
src/features/pieces/GoalsPanel.tsx:166:  const [subgoalDraft, setSubgoalDraft] = useState("");
src/features/pieces/GoalsPanel.tsx:36:  const [draft, setDraft] = useState("");
src/features/pieces/GoalsPanel.tsx:37:  const [loading, setLoading] = useState(true);
src/features/pieces/GoalsPanel.tsx:57:  useEffect(() => { void load(); }, [pieceId]);
src/features/pieces/GoalsPanel.tsx:88:  const bigGoals = useMemo(() => goals
src/features/pieces/HistoryPanel.tsx:142:  const [loading, setLoading] = useState(true);
src/features/pieces/HistoryPanel.tsx:144:  const [query, setQuery] = useState("");
src/features/pieces/HistoryPanel.tsx:148:  const [visibleGroupCount, setVisibleGroupCount] = useState(INITIAL_VISIBLE_GROUPS);
src/features/pieces/HistoryPanel.tsx:152:  useEffect(() => {
src/features/pieces/HistoryPanel.tsx:160:  const load = useCallback(async () => {
src/features/pieces/HistoryPanel.tsx:195:  useEffect(() => {
src/features/pieces/HistoryPanel.tsx:202:  const groups = useMemo(
src/features/pieces/HistoryPanel.tsx:206:  const visibleGroups = useMemo(
src/features/pieces/HistoryPanel.tsx:212:  useEffect(() => {
src/features/pieces/PieceDetail.tsx:105:  const updatePieceField = useCallback(
src/features/pieces/PieceDetail.tsx:117:  useEffect(() => {
src/features/pieces/PieceDetail.tsx:131:  const onScoreContextChange = useCallback((score: ScoreFocusContext) => {
src/features/pieces/PieceDetail.tsx:55:  const [historyRevision, setHistoryRevision] = useState(0);
src/features/pieces/PieceDetail.tsx:56:  const [regionRevision, setRegionRevision] = useState(0);
src/features/pieces/PieceDetail.tsx:57:  const [saving, setSaving] = useState(false);
src/features/pieces/PieceDetail.tsx:58:  const [opening, setOpening] = useState(false);
src/features/pieces/PieceDetail.tsx:64:  const saveIntake = useCallback(
src/features/pieces/PieceDetail.tsx:86:  const openBlock = useCallback(
src/features/pieces/PiecesPanel.tsx:42:  const [scanning, setScanning] = useState(false);
src/features/pieces/PiecesPanel.tsx:43:  const [loading, setLoading] = useState(true);
src/features/pieces/PiecesPanel.tsx:47:  const loadList = useCallback(async () => {
src/features/pieces/PiecesPanel.tsx:58:  useEffect(() => {
src/features/pieces/PiecesPanel.tsx:62:  const scan = useCallback(async () => {
src/features/pieces/PiecesPanel.tsx:75:  const select = useCallback(async (id: number) => {
src/features/pieces/PiecesPanel.tsx:88:  useEffect(() => {
src/features/pieces/PiecesPanel.tsx:93:  const onPieceUpdated = useCallback((updated: PieceDetailData) => {
src/features/pieces/RegionEditor.tsx:234:  const [adding, setAdding] = useState(false);
src/features/pieces/RegionEditor.tsx:235:  const [title, setTitle] = useState("");
src/features/pieces/RegionEditor.tsx:236:  const [notes, setNotes] = useState("");
src/features/pieces/RegionEditor.tsx:237:  const [start, setStart] = useState("1");
src/features/pieces/RegionEditor.tsx:238:  const [end, setEnd] = useState("1");
src/features/pieces/RegionEditor.tsx:239:  const [loading, setLoading] = useState(true);
src/features/pieces/RegionEditor.tsx:242:  const load = useCallback(async () => {
src/features/pieces/RegionEditor.tsx:258:  useEffect(() => { void load(); }, [load, refreshToken]);
src/features/pieces/RegionEditor.tsx:260:  const blocksByRegion = useMemo(() => {
src/features/pieces/RegionEditor.tsx:267:  const sortedRegions = useMemo(() => [...regions].sort((a, b) =>
src/features/pieces/RegionEditor.tsx:39:  const [open, setOpen] = useState(alwaysOpen);
src/features/pieces/RegionEditor.tsx:40:  const [title, setTitle] = useState(region.name);
src/features/pieces/RegionEditor.tsx:41:  const [notes, setNotes] = useState(region.notes ?? "");
src/features/pieces/RegionEditor.tsx:42:  const [start, setStart] = useState(String(region.m_start));
src/features/pieces/RegionEditor.tsx:43:  const [end, setEnd] = useState(String(region.m_end));
src/features/pieces/RegionEditor.tsx:44:  const [mergeTarget, setMergeTarget] = useState("");
src/features/pieces/RegionEditor.tsx:45:  const [splitAt, setSplitAt] = useState("");
src/features/pieces/RegionEditor.tsx:46:  const [saving, setSaving] = useState(false);
src/features/pieces/RegionEditor.tsx:49:  useEffect(() => {
src/features/receipts/ReceiptCenter.tsx:65:  const [politeAnnouncement, setPoliteAnnouncement] = useState("");
src/features/receipts/ReceiptCenter.tsx:66:  const [assertiveAnnouncement, setAssertiveAnnouncement] = useState("");
src/features/receipts/ReceiptCenter.tsx:69:  const publish = useCallback((kind: ReceiptKind, rawMessage: string, durableReceiptId?: string) => {
src/features/rep/BlockForm.tsx:70:  const [streakChoice, setStreakChoice] = useState(initialTarget);
src/features/rep/BlockForm.tsx:71:  const [customStreak, setCustomStreak] = useState(String(defaultCleanStreak));
src/features/rep/BlockForm.tsx:77:  const [focus, setFocus] = useState("tempo");
src/features/rep/BlockForm.tsx:78:  const [useMetronome, setUseMetronome] = useState(true);
src/features/rep/BlockForm.tsx:83:  useEffect(() => {
src/features/rep/RepHud.tsx:109:  useEffect(() => {
src/features/rep/RepHud.tsx:118:  useEffect(() => {
src/features/rep/RepHud.tsx:132:  useEffect(() => {
src/features/rep/RepHud.tsx:137:  useEffect(() => {
src/features/rep/RepHud.tsx:141:  useEffect(() => {
src/features/rep/RepHud.tsx:72:  const [note, setNote] = useState("");
src/features/rep/RepHud.tsx:86:  const [safetyBusy, setSafetyBusy] = useState(false);
src/features/rep/RepHud.tsx:87:  const [correcting, setCorrecting] = useState(false);
src/features/rep/RepHud.tsx:89:  const [correctNote, setCorrectNote] = useState("");
src/features/rep/RepHud.tsx:90:  const [restartConfirm, setRestartConfirm] = useState(false);
src/features/rep/RepHud.tsx:91:  const [resetPulse, setResetPulse] = useState(false);
src/features/rep/RepHud.tsx:92:  const [recoveryOpen, setRecoveryOpen] = useState(false);
src/features/rep/RepHud.tsx:93:  const [reflectionOpen, setReflectionOpen] = useState(false);
src/features/rep/RepHud.tsx:94:  const [reflection, setReflection] = useState("");
src/features/rep/RepHud.tsx:95:  const [recoveryStart, setRecoveryStart] = useState("");
src/features/rep/RepHud.tsx:96:  const [recoveryEnd, setRecoveryEnd] = useState("");
src/features/rep/RepHud.tsx:97:  const [recoveryHands, setRecoveryHands] = useState("left hand");
src/features/rep/RepHud.tsx:98:  const [recoveryMethod, setRecoveryMethod] = useState("rhythmic variants");
src/features/rep/useRep.ts:1007:  const recover = useCallback(async (action: RecoveryActionRequest) => {
src/features/rep/useRep.ts:1018:  useEffect(() => {
src/features/rep/useRep.ts:1034:  const close = useCallback(async () => {
src/features/rep/useRep.ts:450:  const publishAttemptReceipt = useCallback(
src/features/rep/useRep.ts:479:  const applySnapshot = useCallback((
src/features/rep/useRep.ts:505:  const showError = useCallback((msg: string) => {
src/features/rep/useRep.ts:511:  const clearError = useCallback(() => {
src/features/rep/useRep.ts:516:  const commandId = useCallback((operation: string) => {
src/features/rep/useRep.ts:528:  const settleCommandId = useCallback((operation: string) => {
src/features/rep/useRep.ts:538:  const applyReturnedSnapshot = useCallback((
src/features/rep/useRep.ts:552:  const retuneIfCurrent = useCallback(async (
src/features/rep/useRep.ts:591:  const runSnapshotReceiptMutation = useCallback(async (
src/features/rep/useRep.ts:639:  useEffect(() => {
src/features/rep/useRep.ts:685:  useEffect(() => {
src/features/rep/useRep.ts:723:  const open = useCallback(
src/features/rep/useRep.ts:779:  const check = useCallback(
src/features/rep/useRep.ts:827:  const undo = useCallback(async () => {
src/features/rep/useRep.ts:860:  const correct = useCallback(async (
src/features/rep/useRep.ts:900:  const reverseAdjustment = useCallback(async (adjustmentId: number) => {
src/features/rep/useRep.ts:930:  const restart = useCallback(async (requiredCleanStreak?: number | null) => {
src/features/rep/useRep.ts:963:  const pause = useCallback(async () => {
src/features/rep/useRep.ts:971:  const resume = useCallback(async () => {
src/features/rep/useRep.ts:979:  const checkpoint = useCallback(async () => {
src/features/rep/useRep.ts:988:  const reflect = useCallback(async (rawReflection: string) => {
src/features/rep/useRep.ts:998:  const safetyStop = useCallback(async (rawReason?: string | null) => {
src/features/retention/RetentionQueue.tsx:46:  const [note, setNote] = useState("");
src/features/retention/RetentionQueue.tsx:47:  const [snoozeDate, setSnoozeDate] = useState(() => (
src/features/retention/RetentionQueue.tsx:51:  useEffect(() => {
src/features/retention/useRetention.ts:120:  useEffect(() => {
src/features/retention/useRetention.ts:124:  const reconcileCommitted = useCallback((
src/features/retention/useRetention.ts:136:  const mutate = useCallback(async (
src/features/retention/useRetention.ts:59:  const [loading, setLoading] = useState(true);
src/features/retention/useRetention.ts:70:  useEffect(() => {
src/features/retention/useRetention.ts:80:  const reload = useCallback(async () => {
src/features/score/PdfPage.tsx:33:  useEffect(() => {
src/features/score/ScoreView.tsx:1031:  const overlayItems: RegionOverlayItem[] = useMemo(() => {
src/features/score/ScoreView.tsx:428:  const [regionQuery, setRegionQuery] = useState("");
src/features/score/ScoreView.tsx:430:  const [savingMap, setSavingMap] = useState(false);
src/features/score/ScoreView.tsx:435:  const [currentPage, setCurrentPage] = useState(1);
src/features/score/ScoreView.tsx:436:  const [pageDraft, setPageDraft] = useState("1");
src/features/score/ScoreView.tsx:437:  const [manualZoom, setManualZoom] = useState(1);
src/features/score/ScoreView.tsx:439:  const [sectionsVisible, setSectionsVisible] = useState(true);
src/features/score/ScoreView.tsx:440:  const [containerWidth, setContainerWidth] = useState(900);
src/features/score/ScoreView.tsx:441:  const [containerHeight, setContainerHeight] = useState(700);
src/features/score/ScoreView.tsx:442:  const [maxPageWidth, setMaxPageWidth] = useState(DEFAULT_PAGE_SIZE.width);
src/features/score/ScoreView.tsx:443:  const [maxPageHeight, setMaxPageHeight] = useState(DEFAULT_PAGE_SIZE.height);
src/features/score/ScoreView.tsx:444:  const [reloadToken, setReloadToken] = useState(0);
src/features/score/ScoreView.tsx:445:  const [selecting, setSelecting] = useState(false);
src/features/score/ScoreView.tsx:446:  const [addingRegion, setAddingRegion] = useState(false);
src/features/score/ScoreView.tsx:447:  const [newRegionTitle, setNewRegionTitle] = useState("");
src/features/score/ScoreView.tsx:448:  const [newRegionNotes, setNewRegionNotes] = useState("");
src/features/score/ScoreView.tsx:449:  const [newRegionStart, setNewRegionStart] = useState("1");
src/features/score/ScoreView.tsx:450:  const [newRegionEnd, setNewRegionEnd] = useState("1");
src/features/score/ScoreView.tsx:451:  const [creatingRegion, setCreatingRegion] = useState(false);
src/features/score/ScoreView.tsx:452:  const [targetMode, setTargetMode] = useState(false);
src/features/score/ScoreView.tsx:457:  const [targetSavePending, setTargetSavePending] = useState(false);
src/features/score/ScoreView.tsx:463:  const [wizardOpen, setWizardOpen] = useState(false);
src/features/score/ScoreView.tsx:468:  useEffect(() => {
src/features/score/ScoreView.tsx:477:  useEffect(() => {
src/features/score/ScoreView.tsx:496:  const loadGraph = useCallback(async () => {
src/features/score/ScoreView.tsx:524:  useEffect(() => {
src/features/score/ScoreView.tsx:533:  useEffect(() => {
src/features/score/ScoreView.tsx:566:  useEffect(() => {
src/features/score/ScoreView.tsx:607:  useEffect(() => {
src/features/score/ScoreView.tsx:621:  useEffect(() => {
src/features/score/ScoreView.tsx:664:  const activePages = useMemo(
src/features/score/ScoreView.tsx:694:  useEffect(() => {
src/features/score/ScoreView.tsx:719:  useEffect(() => {
src/features/score/ScoreView.tsx:741:  const displayedRegions = useMemo(() => {
src/features/score/ScoreView.tsx:759:  const resolveTargetMapping = useCallback(
src/features/score/ScoreView.tsx:807:  const cancelTargetDraft = useCallback(() => {
src/features/score/ScoreView.tsx:818:  const toggleTargetMode = useCallback(() => {
src/features/score/ScoreView.tsx:841:  const acceptTargetSelection = useCallback(
src/features/score/ScoreView.tsx:863:  const openWizard = useCallback(() => {
src/features/score/ScoreView.tsx:868:  const saveTarget = useCallback(
src/features/score/ScoreView.tsx:945:  const handlePageSize = useCallback((page: number, size: PdfPageSize) => {
src/features/score/ScoreView.tsx:951:  const jumpTo = useCallback(
src/features/score/ScoreView.tsx:972:  const selectRegion = useCallback(
src/features/score/ScoreView.tsx:995:  useEffect(() => {
src/features/score/ScoreWorkspace.tsx:22:  const [loading, setLoading] = useState(true);
src/features/score/ScoreWorkspace.tsx:25:  const load = useCallback(async () => {
src/features/score/ScoreWorkspace.tsx:47:  useEffect(() => {
src/features/score/atlas/mapping/MapScoreWizard.tsx:120:  const removeAnchor = useCallback((target: LineAnchor) => {
src/features/score/atlas/mapping/MapScoreWizard.tsx:133:  const save = useCallback(async () => {
src/features/score/atlas/mapping/MapScoreWizard.tsx:65:  const [page, setPage] = useState(1);
src/features/score/atlas/mapping/MapScoreWizard.tsx:68:  const [measureDraft, setMeasureDraft] = useState("");
src/features/score/atlas/mapping/MapScoreWizard.tsx:69:  const [saving, setSaving] = useState(false);
src/features/score/atlas/mapping/MapScoreWizard.tsx:74:  const pageAnchors = useMemo(
src/features/score/atlas/mapping/MapScoreWizard.tsx:82:  const placeFromPointer = useCallback(
src/features/score/atlas/mapping/MapScoreWizard.tsx:92:  const addAnchor = useCallback(() => {
src/features/score/atlas/ui/TargetDraftEditor.tsx:182:  const [reviewConfirmed, setReviewConfirmed] = useState(false);
src/features/score/atlas/ui/TargetDraftEditor.tsx:183:  const [title, setTitle] = useState("");
src/features/score/atlas/ui/TargetDraftEditor.tsx:184:  const [note, setNote] = useState("");
src/features/score/atlas/ui/TargetDraftEditor.tsx:185:  const [hands, setHands] = useState("");
src/features/score/atlas/ui/TargetDraftEditor.tsx:186:  const [method, setMethod] = useState("");
src/features/score/atlas/ui/TargetDraftEditor.tsx:187:  const [rangeStart, setRangeStart] = useState("");
src/features/score/atlas/ui/TargetDraftEditor.tsx:188:  const [rangeEnd, setRangeEnd] = useState("");
src/features/score/atlas/ui/TargetDraftEditor.tsx:189:  const [numericX, setNumericX] = useState("10");
src/features/score/atlas/ui/TargetDraftEditor.tsx:190:  const [numericY, setNumericY] = useState("15");
src/features/score/atlas/ui/TargetDraftEditor.tsx:191:  const [numericWidth, setNumericWidth] = useState("30");
src/features/score/atlas/ui/TargetDraftEditor.tsx:192:  const [numericHeight, setNumericHeight] = useState("12");
src/features/score/atlas/ui/TargetDraftEditor.tsx:194:  const [saving, setSaving] = useState(false);
src/features/score/atlas/ui/TargetDraftEditor.tsx:199:  useEffect(() => {
src/features/score/atlas/ui/TargetDraftEditor.tsx:273:  useEffect(() => {
src/features/score/atlas/ui/TargetDraftEditor.tsx:355:  const candidatePayload = useMemo(() => {
src/features/session/SessionBar.tsx:50:  const [expanded, setExpanded] = useState(false);
src/features/session/SessionBar.tsx:51:  const [now, setNow] = useState(() => Date.now());
src/features/session/SessionBar.tsx:57:  useEffect(() => {
src/features/session/useSession.ts:100:  useEffect(() => {
src/features/session/useSession.ts:150:  const endSession = useCallback(async (): Promise<ExportResult | null> => {
src/features/session/useSession.ts:79:  const showError = useCallback((msg: string) => {
src/features/session/useSession.ts:85:  const clearError = useCallback(() => {
src/features/session/useSession.ts:90:  const refetch = useCallback(async () => {
src/features/settings/BrainConnection.tsx:22:  const [testing, setTesting] = useState(false);
src/features/settings/BrainConnection.tsx:40:  useEffect(() => {
src/features/settings/SettingsPanel.tsx:568:  const [key, setKey] = useState("");
src/features/settings/SettingsPanel.tsx:569:  const [busy, setBusy] = useState(false);
src/features/settings/SettingsPanel.tsx:79:  const [saving, setSaving] = useState(false);
src/features/settings/SettingsPanel.tsx:82:  const [aliasDrafts, setAliasDrafts] = useState({
src/features/settings/SettingsPanel.tsx:88:  useEffect(() => {
src/features/today/TodayWorkspace.tsx:59:  const [loading, setLoading] = useState(true);
src/features/today/TodayWorkspace.tsx:61:  const [retentionOpen, setRetentionOpen] = useState(false);
src/features/today/TodayWorkspace.tsx:69:  const load = useCallback(async () => {
src/features/today/TodayWorkspace.tsx:82:  useEffect(() => {
src/features/today/TodayWorkspace.tsx:86:  const recent = useMemo(() => {
src/features/tutorials/TutorialPanel.tsx:25:  const [loading, setLoading] = useState(true);
src/features/tutorials/TutorialPanel.tsx:26:  const [saving, setSaving] = useState(false);
src/features/tutorials/TutorialPanel.tsx:45:  useEffect(() => { void load(); }, [pieceId]);
src/features/tutorials/TutorialPanel.tsx:47:  const regionClips = useMemo(() => videos
src/features/universe/UniverseWorkspace.tsx:190:  const [loading, setLoading] = useState(true);
src/features/universe/UniverseWorkspace.tsx:194:  const [dragging, setDragging] = useState(false);
src/features/universe/UniverseWorkspace.tsx:198:  const load = useCallback(async () => {
src/features/universe/UniverseWorkspace.tsx:211:  useEffect(() => {
src/features/universe/UniverseWorkspace.tsx:215:  const pieces = useMemo(() => snapshot?.pieces ?? [], [snapshot]);
src/features/universe/UniverseWorkspace.tsx:216:  const layout = useMemo(() => layoutUniversePieces(pieces), [pieces]);
src/features/universe/UniverseWorkspace.tsx:217:  const fittedView = useMemo(() => fitLayout(layout), [layout]);
src/features/universe/UniverseWorkspace.tsx:231:  const openPiece = useCallback((piece: UniversePiece) => {
src/features/universe/UniverseWorkspace.tsx:235:  const resetView = useCallback(() => setView(fittedView), [fittedView]);
src/features/universe/UniverseWorkspace.tsx:237:  const zoomAt = useCallback((factor: number, anchorX = VIEW_WIDTH / 2, anchorY = VIEW_HEIGHT / 2) => {
src/features/voice/ActionDraftCard.tsx:146:  const [value, setValue] = useState(() => revalidate(draft));
src/features/voice/ActionDraftCard.tsx:148:  useEffect(() => setValue(revalidate(draft)), [draft]);
src/features/voice/VoiceToast.tsx:107:  useEffect(() => {
src/features/voice/VoiceToast.tsx:118:  useEffect(() => {
src/features/voice/VoiceToast.tsx:98:  useEffect(() => {
src/features/voice/useVoice.ts:188:  const syncStatus = useCallback(() => {
src/features/voice/useVoice.ts:192:  const applyStatusEvent = useCallback(
src/features/voice/useVoice.ts:215:  const processDelivery = useCallback((delivery: VoiceTranscriptDelivery) => {
src/features/voice/useVoice.ts:230:  useEffect(() => {
src/features/voice/useVoice.ts:287:  const mute = useCallback(
src/shell/Shell.tsx:207:  const [ending, setEnding] = useState(false);
src/shell/Shell.tsx:211:  const [voiceDraftConfirming, setVoiceDraftConfirming] = useState(false);
src/shell/Shell.tsx:216:  const suppressVoiceDraft = useCallback((deliveryKey: string) => {
src/shell/Shell.tsx:227:  useEffect(() => {
src/shell/Shell.tsx:253:  const cancelVoiceDraft = useCallback(() => {
src/shell/Shell.tsx:261:  const confirmVoiceDraft = useCallback(
src/shell/Shell.tsx:292:  const endSession = useCallback(async () => {
src/shell/Shell.tsx:328:  const openPiece = useCallback((piece: PracticePieceContext) => {
src/state/settings.ts:110:  const [loading, setLoading] = useState(true);
src/state/settings.ts:119:  useEffect(() => {
src/state/settings.ts:147:  const setSetting = useCallback(
src/state/settings.ts:198:  const acceptSetting = useCallback(
src/state/settings.ts:210:  const clearError = useCallback(() => setError(null), []);
src/ui/Dialog.tsx:17:  useEffect(() => {
```


## 3. setInterval / setTimeout / addEventListener / .subscribe( / listen( (Tauri)
```
src/components/FloatingPanel.tsx:123:    window.addEventListener("pointermove", move);
src/components/FloatingPanel.tsx:124:    window.addEventListener("pointerup", finish);
src/components/FloatingPanel.tsx:125:    window.addEventListener("pointercancel", finish);
src/components/Popover.tsx:101:    window.addEventListener("resize", handler);
src/components/Popover.tsx:102:    window.addEventListener("scroll", handler, true);
src/components/Popover.tsx:127:    document.addEventListener("keydown", onKeyDown, true);
src/components/Popover.tsx:128:    document.addEventListener("pointerdown", onPointerDown, true);
src/components/usePanels.ts:40:    persistTimer.current = setTimeout(() => {
src/components/usePanels.ts:63:    window.addEventListener("resize", resize);
src/devMock/tauriDevMock.ts:12:// `window.__TAURI_INTERNALS__.invoke(...)`, and `listen(event, handler)` calls
src/devMock/tauriDevMock.ts:899:    // resolves to a valid subscription id (so `listen()` returns a real unlisten
src/devMock/tauriDevMock.ts:923:  // it, any component that calls `listen()` (e.g. ScoreView's score://navigate)
src/features/metronome/MetronomePopover.tsx:87:    window.addEventListener("keydown", onKey);
src/features/metronome/useMetronome.ts:170:    errorTimer.current = setTimeout(() => setError(null), 4500);
src/features/metronome/useMetronome.ts:204:        const un = await listen<MetroState>("metro://state", (e) => {
src/features/metronome/useMetronome.ts:316:          dt.timer = setTimeout(() => {
src/features/metronome/useMetronome.ts:403:      preview.current.timer = setTimeout(() => {
src/features/rep/RepHud.tsx:125:    const timer = window.setTimeout(() => setResetPulse(false), 520);
src/features/rep/useRep.ts:1023:    const timer = window.setInterval(persist, 15_000);
src/features/rep/useRep.ts:1027:    document.addEventListener("visibilitychange", onVisibility);
src/features/rep/useRep.ts:508:    errorTimer.current = setTimeout(() => setError(null), 4500);
src/features/rep/useRep.ts:645:        const un = await listen<RepSnapshot | null>("rep://state", (e) => {
src/features/rep/useRep.ts:691:        const un = await listen<MetroState>("metro://state", (event) => {
src/features/score/ScoreView.tsx:133:    const timer = window.setTimeout(
src/features/score/ScoreView.tsx:997:    void listen<ScoreNavigate>("score://navigate", (event) => {
src/features/session/SessionBar.tsx:59:    const id = setInterval(() => setNow(Date.now()), 1000);
src/features/session/useSession.ts:123:        const un = await listen<SessionEventView>("session://event", (e) => {
src/features/session/useSession.ts:82:    errorTimer.current = setTimeout(() => setError(null), 4500);
src/features/voice/VoiceToast.tsx:101:    const t = setTimeout(() => setToast(null), TOAST_MS);
src/features/voice/VoiceToast.tsx:112:    const t = setTimeout(() => setDeliveryToast(null), TOAST_MS);
src/features/voice/useVoice.ts:244:          await listen<VoiceStatusEvent>("voice://status", (e) => {
src/features/voice/useVoice.ts:250:          await listen<VoiceTranscriptEvent>("voice://transcript", (e) => {
src/features/voice/useVoice.ts:260:          await listen<VoiceIntent>("voice://intent", (e) => {
src/ui/Dialog.tsx:25:    document.addEventListener("keydown", onKey);
```

## 4. .map(/.filter(/.sort(/.reduce( directly in component body (raw list; NOT pre-filtered for useMemo wrapping — cross-reference against section 2's useMemo lines manually)
```
src/App.smoke.test.tsx:33:        .map((t) => t.textContent),
src/components/usePanels.ts:111:      Object.entries(defaults.current).map(([id, panelDefaults]) => [
src/components/usePanels.ts:28:  return Object.fromEntries((layout?.panels ?? []).map((panel) => [panel.id, panel]));
src/components/usePanels.ts:99:        const top = Math.max(0, ...Object.values(current).map((item) => item.z));
src/features/brain/BrainWorkspace.tsx:327:            {pieces.map((piece) => (
src/features/brain/BrainWorkspace.tsx:347:        {thread.map((entry) => (
src/features/brain/BrainWorkspace.tsx:357:                  {entry.answer.citations.map((citation) => (
src/features/brain/BrainWorkspace.tsx:391:                    {entry.answer.methods.map((method) => (
src/features/brain/BrainWorkspace.tsx:528:    .filter(Boolean)
src/features/brain/BrainWorkspace.tsx:548:          {grounding.warnings.map((warning) => (
src/features/brain/BrainWorkspace.tsx:593:          {suggestions.map((suggestion) => (
src/features/brain/BrainWorkspace.tsx:602:                {suggestion.reasons.map((reason) => (
src/features/brain/BrainWorkspace.tsx:742:      review.fields.map((field) => [field.field, field.proposed]),
src/features/brain/BrainWorkspace.tsx:746:    Object.fromEntries(review.fields.map((field) => [field.field, true])),
src/features/brain/BrainWorkspace.tsx:753:    .filter((field) => selected[field.field])
src/features/brain/BrainWorkspace.tsx:754:    .map((field) => ({
src/features/brain/BrainWorkspace.tsx:784:        {review.fields.map((field) => (
src/features/calendar/CalendarWorkspace.tsx:102:        const goalLists = await Promise.all(pieces.map((piece) => api.listGoals(piece.id)));
src/features/calendar/CalendarWorkspace.tsx:203:          {dates.map((date) => {
src/features/calendar/CalendarWorkspace.tsx:205:              .filter((item) => item.scheduled_date === date)
src/features/calendar/CalendarWorkspace.tsx:206:              .sort((left, right) => left.sort_order - right.sort_order || left.id - right.id);
src/features/calendar/CalendarWorkspace.tsx:208:              .filter((goal) => goal.kind === "big" && goal.parent_goal_id === null && goal.target_date === date)
src/features/calendar/CalendarWorkspace.tsx:209:              .sort((left, right) => left.order - right.order || left.id - right.id);
src/features/calendar/CalendarWorkspace.tsx:251:  const used = items.filter((item) => item.status === "planned").reduce((sum, item) => sum + item.planned_minutes, 0);
src/features/calendar/CalendarWorkspace.tsx:261:          {milestones.map((goal) => {
src/features/calendar/CalendarWorkspace.tsx:275:        {items.map((item) => editing === item.id ? (
src/features/calendar/CalendarWorkspace.tsx:406:            {references.goals.map((goal) => {
src/features/calendar/RecoveryReview.tsx:27:    Object.fromEntries(preview.items.map(({ work, proposed_date }) => [
src/features/calendar/RecoveryReview.tsx:49:    const decisions: RecoveryDecision[] = preview.items.map(({ work }) => {
src/features/calendar/RecoveryReview.tsx:79:      {groups.map(([date, items]) => {
src/features/calendar/RecoveryReview.tsx:84:            {items.map((item) => {
src/features/composer/SessionComposer.test.tsx:120:    expect(reviewed.sequence.map((item) => ({
src/features/composer/SessionComposer.test.tsx:187:    expect(onStartSession.mock.calls[0][0].sequence.map((item) => item.candidate_id)).toEqual([
src/features/composer/SessionComposer.test.tsx:215:    expect(onStartSession.mock.calls[0][0].sequence.map((item) => item.allocated_minutes)).toEqual([
src/features/composer/SessionComposer.tsx:163:  const included = draft.sequence.filter((item) => currentEdit(edits, item).included);
src/features/composer/SessionComposer.tsx:164:  const sequence = included.map((item, index): ReviewedSessionItem => ({
src/features/composer/SessionComposer.tsx:176:      .filter((item) => !currentEdit(edits, item).included)
src/features/composer/SessionComposer.tsx:177:      .map((item) => item.candidate_id),
src/features/composer/SessionComposer.tsx:216:  const unplacedCount = candidates.filter((candidate) => (
src/features/composer/SessionComposer.tsx:305:            {draft.issues.map((issue, index) => (
src/features/composer/SessionComposer.tsx:321:          {draft.sequence.map((item) => {
src/features/composer/SessionComposer.tsx:373:                        <dd>{item.provenance.source_refs.map((source) => (
src/features/composer/SessionComposer.tsx:91:  return Object.fromEntries(draft.sequence.map((item) => [
src/features/composer/domain/composeSessionDraft.test.ts:133:    expect(draft.sequence.filter((item) => item.kind === "due_retention")).toHaveLength(3);
src/features/composer/domain/composeSessionDraft.test.ts:148:    expect(draft.sequence.map((item) => item.allocated_minutes)).toEqual([1, 1, 1, 1, 1]);
src/features/composer/domain/composeSessionDraft.test.ts:224:    expect(draft.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
src/features/composer/domain/composeSessionDraft.test.ts:261:    expect(draft.issues.filter((issue) => issue.code === "invalid_candidate")).toHaveLength(4);
src/features/composer/domain/composeSessionDraft.test.ts:273:    expect(draft.sequence.map((item) => item.allocated_minutes)).toEqual([2, 3]);
src/features/composer/domain/composeSessionDraft.test.ts:291:    expect(draft.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
src/features/composer/domain/composeSessionDraft.test.ts:323:    expect(draft.sequence.map((item) => item.candidate_id)).toEqual([
src/features/composer/domain/composeSessionDraft.test.ts:49:    expect(draft.sequence.map((item) => item.candidate_id)).toEqual([
src/features/composer/domain/composeSessionDraft.test.ts:56:    expect(draft.sequence.map((item) => item.sequence)).toEqual([1, 2, 3, 4, 5]);
src/features/composer/domain/composeSessionDraft.test.ts:73:    expect(forward.sequence.map((item) => item.candidate_id)).toEqual(["alpha", "beta"]);
src/features/composer/domain/composeSessionDraft.ts:152:  const evidence = candidate.evidence.map(normalizeEvidence);
src/features/composer/domain/composeSessionDraft.ts:154:  const normalizedEvidence = (evidence as ComposerEvidence[]).sort(compareEvidence);
src/features/composer/domain/composeSessionDraft.ts:200:  for (const id of [...byId.keys()].sort(compareText)) {
src/features/composer/domain/composeSessionDraft.ts:202:    const unique = new Map(claims.map((claim) => [fingerprintCandidate(claim), claim]));
src/features/composer/domain/composeSessionDraft.ts:233:  return [...refs.values()].sort(compareSourceRef);
src/features/composer/domain/composeSessionDraft.ts:250:    matches.sort(compareCandidate);
src/features/composer/domain/composeSessionDraft.ts:263:        candidate_ids: [primary.id, ...matches.slice(1).map((item) => item.id).sort(compareText)],
src/features/composer/domain/composeSessionDraft.ts:264:        evidence_ids: [...new Set(matches.flatMap((item) => item.evidence.map(
src/features/composer/domain/composeSessionDraft.ts:266:        )))].sort(compareText),
src/features/composer/domain/composeSessionDraft.ts:272:  return consolidated.sort((left, right) => compareCandidate(left.primary, right.primary));
src/features/composer/domain/composeSessionDraft.ts:314:  return result.sort((left, right) => compareCandidate(left.primary, right.primary));
src/features/composer/domain/composeSessionDraft.ts:321:  const allocation = selected.map(() => 1);
src/features/composer/domain/composeSessionDraft.ts:418:  const sequence: SessionDraftItem[] = selected.map((candidate, index) => ({
src/features/composer/domain/composeSessionDraft.ts:440:  const allocatedMinutes = allocations.reduce((total, value) => total + value, 0);
src/features/composer/domain/composeSessionDraft.ts:85:  return candidate.evidence.reduce(
src/features/composer/useComposerCandidates.test.ts:103:    expect(candidates.map((candidate) => candidate.kind)).toEqual([
src/features/composer/useComposerCandidates.ts:186:      const graphs = await Promise.all((pieces ?? []).map(async (piece) => {
src/features/composer/useComposerCandidates.ts:196:        regions_by_piece: new Map(graphs.map((entry) => [entry.pieceId, entry.regions])),
src/features/composer/useComposerCandidates.ts:197:        blocks_by_piece: new Map(graphs.map((entry) => [entry.pieceId, entry.blocks])),
src/features/composer/useComposerCandidates.ts:57:  const pieceById = new Map(snapshot.pieces.map((piece) => [piece.id, piece]));
src/features/composer/useSessionPlan.test.ts:379:    expect(result.current.activePlan?.startedSequences.sort()).toEqual([1, 2]);
src/features/ledger/AnomaliesPanel.tsx:187:            {report.groups.map((group) => {
src/features/ledger/AnomaliesPanel.tsx:222:                      {group.rows.map((row) => (
src/features/ledger/AnomaliesPanel.tsx:226:                            {Object.entries(row.detail).map(([field, value]) => (
src/features/ledger/LedgerWorkspace.tsx:72:              {pieces.map((piece, index) => (
src/features/metronome/MetronomePopover.test.tsx:128:    const setCallsDuringDrag = invokeMock.mock.calls.filter(
src/features/metronome/MetronomePopover.test.tsx:141:    const finalCalls = invokeMock.mock.calls.filter(
src/features/metronome/MetronomePopover.tsx:237:        {beatDots.map((i) => (
src/features/metronome/MetronomePopover.tsx:273:        {SOUNDS.map((s) => (
src/features/pieces/BlockRow.test.tsx:72:    const names = screen.getAllByRole("button").map((button) => button.getAttribute("aria-label") ?? button.textContent ?? "");
src/features/pieces/BlockRow.tsx:217:          {reps.length === 0 ? <li className="history-empty">No attempts logged.</li> : reps.map((rep, index) => {
src/features/pieces/GoalsPanel.tsx:105:          {bigGoals.map((goal, index) => {
src/features/pieces/GoalsPanel.tsx:106:            const children = goals.filter((candidate) => candidate.parent_goal_id === goal.id).sort(byOrder);
src/features/pieces/GoalsPanel.tsx:167:  const doneChildren = children.filter((child) => child.done).length;
src/features/pieces/GoalsPanel.tsx:168:  const branchGoalIds = new Set([goal.id, ...children.map((child) => child.id)]);
src/features/pieces/GoalsPanel.tsx:169:  const branchWork = dailyWork.filter((item) => branchGoalIds.has(item.goal_id));
src/features/pieces/GoalsPanel.tsx:170:  const plannedWork = branchWork.filter((item) => item.status === "planned").length;
src/features/pieces/GoalsPanel.tsx:171:  const doneWork = branchWork.filter((item) => item.status === "done").length;
src/features/pieces/GoalsPanel.tsx:189:          {children.map((child, childIndex) => (
src/features/pieces/GoalsPanel.tsx:198:                deleteLabel={`Delete the subgoal “${child.text}” and its ${dailyWork.filter((item) => item.goal_id === child.id).length} linked Calendar item${dailyWork.filter((item) => item.goal_id === child.id).length === 1 ? "" : "s"}?`}
src/features/pieces/GoalsPanel.tsx:76:    setGoals((current) => current.map((goal) => {
src/features/pieces/GoalsPanel.tsx:81:      await api.goalReorder(pieceId, next.map((goal) => goal.id));
src/features/pieces/GoalsPanel.tsx:89:    .filter((goal) => goal.kind === "big" && goal.parent_goal_id === null)
src/features/pieces/GoalsPanel.tsx:90:    .sort(byOrder), [goals]);
src/features/pieces/HistoryPanel.test.tsx:100:    expect(resets[0].blocks.map((item) => item.block_id)).toEqual([21]);
src/features/pieces/HistoryPanel.test.tsx:24:    expect(groups.map((group) => group.region?.name ?? "Ungrouped")).toEqual(["legato section", "Ungrouped"]);
src/features/pieces/HistoryPanel.test.tsx:37:    expect(groups.map((group) => group.region?.id ?? group.unavailableRegionId ?? null)).toEqual([
src/features/pieces/HistoryPanel.test.tsx:62:    expect(output.map((group) => group.region?.name)).toEqual(["B (mm.544-552)"]);
src/features/pieces/HistoryPanel.test.tsx:92:    expect(memory[0].blocks.map((item) => item.block_id)).toEqual([20]);
src/features/pieces/HistoryPanel.tsx:102:  const summaries = new Map(mastery.map((item) => [item.region_id, item]));
src/features/pieces/HistoryPanel.tsx:103:  const availableRegionIds = new Set(regions.map((region) => region.id));
src/features/pieces/HistoryPanel.tsx:105:    .map((region) => ({
src/features/pieces/HistoryPanel.tsx:110:    .filter((group) => group.blocks.length > 0);
src/features/pieces/HistoryPanel.tsx:115:    .filter((regionId) => !availableRegionIds.has(regionId))
src/features/pieces/HistoryPanel.tsx:116:    .sort((left, right) => left - right);
src/features/pieces/HistoryPanel.tsx:258:          {renderedGroups.map((group) => {
src/features/pieces/HistoryPanel.tsx:262:            const fallbackStart = Math.min(...group.blocks.map((block) => block.m_start));
src/features/pieces/HistoryPanel.tsx:263:            const fallbackEnd = Math.max(...group.blocks.map((block) => block.m_end));
src/features/pieces/HistoryPanel.tsx:281:                  {group.blocks.map((block) => <BlockRow key={block.block_id} block={block} regions={regions} onChanged={load} />)}
src/features/pieces/HistoryPanel.tsx:57:    const matchingBlocks = group.blocks.filter((block) => (
src/features/pieces/HistoryPanel.tsx:69:          .map((block) => `${block.label ?? ""} ${block.m_start} ${block.m_end} mm.${block.m_start}-${block.m_end}`)
src/features/pieces/HistoryPanel.tsx:75:  return filtered.sort((a, b) => {
src/features/pieces/HistoryPanel.tsx:77:      const aStart = a.region?.m_start ?? Math.min(...a.blocks.map((block) => block.m_start));
src/features/pieces/HistoryPanel.tsx:78:      const bStart = b.region?.m_start ?? Math.min(...b.blocks.map((block) => block.m_start));
src/features/pieces/HistoryPanel.tsx:83:        ?? group.blocks.reduce((sum, block) => sum + (block.attempts_recorded ?? block.tries ?? block.reps_done), 0);
src/features/pieces/IntakeForm.tsx:127:        {hardSpots.map((s, i) => (
src/features/pieces/IntakeForm.tsx:41:    setGoals((g) => g.map((x, idx) => (idx === i ? v : x)));
src/features/pieces/IntakeForm.tsx:44:    setGoals((g) => (g.length > 1 ? g.filter((_, idx) => idx !== i) : g));
src/features/pieces/IntakeForm.tsx:47:    setHardSpots((s) => s.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
src/features/pieces/IntakeForm.tsx:51:    setHardSpots((s) => (s.length > 1 ? s.filter((_, idx) => idx !== i) : s));
src/features/pieces/IntakeForm.tsx:56:      goals: goals.map((g) => g.trim()).filter((g) => g !== ""),
src/features/pieces/IntakeForm.tsx:60:        .map((s) => ({ measures: s.measures.trim(), note: s.note.trim() }))
src/features/pieces/IntakeForm.tsx:61:        .filter((s) => s.measures !== "" || s.note !== ""),
src/features/pieces/IntakeForm.tsx:76:        {goals.map((g, i) => (
src/features/pieces/PiecesPanel.tsx:177:          {pieces.map((p, index) => (
src/features/pieces/PiecesPanel.tsx:95:      list.map((p) =>
src/features/pieces/RegionEditor.test.tsx:84:    expect([...container.querySelectorAll(".tricky-section-card strong")].map((item) => item.textContent)).toEqual(["Earlier", "Later"]);
src/features/pieces/RegionEditor.tsx:153:          {REGION_COLORS.map((color) => (
src/features/pieces/RegionEditor.tsx:176:              {regions.filter((item) => item.id !== region.id).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
src/features/pieces/RegionEditor.tsx:267:  const sortedRegions = useMemo(() => [...regions].sort((a, b) =>
src/features/pieces/RegionEditor.tsx:319:          {sortedRegions.map((region) => (
src/features/receipts/ReceiptCenter.tsx:111:      current.filter((receipt) => receipt.id !== id)
src/features/receipts/ReceiptCenter.tsx:160:          {receipts.map((receipt) => (
src/features/rep/BlockForm.tsx:125:        .map((v) => ({ name: v.name.trim(), reps: v.reps }))
src/features/rep/BlockForm.tsx:126:        .filter((v) => v.name !== ""),
src/features/rep/BlockForm.tsx:363:        {variants.map((v, i) => (
src/features/rep/BlockForm.tsx:94:    setVariants((v) => v.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
src/features/rep/BlockForm.tsx:98:    setVariants((v) => v.filter((_, idx) => idx !== i));
src/features/rep/RepHud.tsx:333:            {[snap.hands, snap.method].filter(Boolean).join(" · ") ||
src/features/rep/RepHud.tsx:414:          {VERDICT_BUTTONS.map((button) => (
src/features/rep/RepHud.tsx:800:          {feed.map((rep, index) => (
src/features/rep/useRep.test.ts:1205:    expect(result.current.feed.map((f) => f.verdict)).toEqual(["flawed", "clean"]);
src/features/rep/useRep.test.ts:1236:    expect(result.current.feed.map((item) => item.note)).toEqual([
src/features/rep/useRep.test.ts:259:    const calls = invokeMock.mock.calls.filter(([command]) => command === "rep_check");
src/features/retention/RetentionQueue.tsx:179:          {retention.checks.map((check) => (
src/features/retention/date.ts:19:  const [year, month, day] = value.split("-").map(Number);
src/features/retention/useRetention.ts:101:      setChecks([...due].sort(compareChecks));
src/features/retention/useRetention.ts:129:      const without = current.filter((check) => check.id !== checkId);
src/features/retention/useRetention.ts:131:        ? [...without, value].sort(compareChecks)
src/features/score/RegionOverlay.tsx:229:          .filter((rect) => rect.page === pageNumber)
src/features/score/RegionOverlay.tsx:230:          .map((rect, index) => (
src/features/score/RegionOverlay.tsx:245:        .map((rect, index) => ({ rect, index }))
src/features/score/RegionOverlay.tsx:246:        .filter(({ rect }) => rect.page === pageNumber)
src/features/score/RegionOverlay.tsx:247:        .map(({ rect, index }) => (
src/features/score/ScoreView.test.tsx:211:  const offsets = objects.map((object, index) => {
src/features/score/ScoreView.test.tsx:220:    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
src/features/score/ScoreView.test.tsx:293:      .filter((button) => button.classList.contains("score-region-row"));
src/features/score/ScoreView.test.tsx:294:    expect(rows.map((row) => row.getAttribute("aria-label"))).toEqual([
src/features/score/ScoreView.test.tsx:854:      expect(pdf.getPage.mock.calls.map((call) => call[0])).toEqual([1, 2]),
src/features/score/ScoreView.test.tsx:863:      expect(new Set(pdf.getPage.mock.calls.map((call) => call[0]))).toEqual(
src/features/score/ScoreView.tsx:1005:        .filter(
src/features/score/ScoreView.tsx:1009:        .sort((a, b) => a.m_end - a.m_start - (b.m_end - b.m_start));
src/features/score/ScoreView.tsx:1033:    return regions.map((region) => ({
src/features/score/ScoreView.tsx:1139:        current.map((region) => (region.id === updated.id ? updated : region)),
src/features/score/ScoreView.tsx:1159:        current.map((item) => ({ ...item, selected: item.id === nextId })),
src/features/score/ScoreView.tsx:1172:    const regionBlocks = blocks.filter(
src/features/score/ScoreView.tsx:1198:          ).map(([tab, label]) => (
src/features/score/ScoreView.tsx:1235:                {(["box", "highlight", "note"] as PdfAnchorKind[]).map(
src/features/score/ScoreView.tsx:1260:                  {mappingThisRegion.rects.map((rect, index) => (
src/features/score/ScoreView.tsx:1284:                                rects: current.rects.map((item, itemIndex) => {
src/features/score/ScoreView.tsx:1306:                                    rects: current.rects.filter(
src/features/score/ScoreView.tsx:1351:                  {savedAnchor.rects.map((rect, index) => (
src/features/score/ScoreView.tsx:1402:                {regionBlocks.slice(0, 4).map((block) => {
src/features/score/ScoreView.tsx:1489:              {editions.map((item) => (
src/features/score/ScoreView.tsx:1671:                                        rects: current.rects.map(
src/features/score/ScoreView.tsx:1818:              {displayedRegions.map((region) => {
src/features/score/ScoreView.tsx:354:    ...new Map(matches.map((match) => [match.region.id, match])).values(),
src/features/score/ScoreView.tsx:643:          .filter(([, ratio]) => ratio > 0)
src/features/score/ScoreView.tsx:644:          .sort((a, b) => b[1] - a[1] || a[0] - b[0]);
src/features/score/ScoreView.tsx:645:        const next = new Set(ranked.map(([page]) => page));
src/features/score/ScoreView.tsx:744:      .filter(
src/features/score/ScoreView.tsx:751:      .sort(
src/features/score/ScoreView.tsx:918:          return current.map((region, index) =>
src/features/score/ScoreWorkspace.tsx:30:      const withPdf = next.filter((piece) => piece.has_pdf);
src/features/score/ScoreWorkspace.tsx:70:              {pieces.map((piece) => (
src/features/score/anchors.ts:75:    editions[editionId] = { fingerprint, rects: rects.filter(validRect) };
src/features/score/atlas/calibration.test.ts:168:    expect(validation.issues.map((issue) => issue.code)).toEqual(
src/features/score/atlas/calibration.ts:225:    const ordered = [...group].sort(
src/features/score/atlas/calibration.ts:293:    .filter(
src/features/score/atlas/calibration.ts:299:    .sort((left, right) => left.position.x - right.position.x);
src/features/score/atlas/calibration.ts:307:  const xmlFingerprints = new Set(local.map((point) => point.measure.xml_fingerprint));
src/features/score/atlas/calibration.ts:425:    points.flatMap((point) => point.corrections.map((correction) => correction.correction_id)),
src/features/score/atlas/calibration.ts:474:  const next = points.map((point, index) => (index === pointIndex ? nextPoint : point));
src/features/score/atlas/draft.ts:104:    anchor: { ...input.anchor, rects: input.anchor.rects.map((rect) => ({ ...rect })) },
src/features/score/atlas/hierarchy.test.ts:43:    expect(analysis.issues.map((issue) => issue.code)).toEqual(
src/features/score/atlas/hierarchy.test.ts:75:    expect(analysis.issues.filter((issue) => issue.code === "parent_cycle")).toHaveLength(2);
src/features/score/atlas/hierarchy.ts:219:      targets.map((target, index) =>
src/features/score/atlas/hierarchy.ts:242:  const next = targets.map((item, index) =>
src/features/score/atlas/hierarchy.ts:245:  const nextById = new Map(next.map((item) => [idKey(item.id), item]));
src/features/score/atlas/mapping/MapScoreWizard.tsx:122:      current.filter(
src/features/score/atlas/mapping/MapScoreWizard.tsx:218:            {pageAnchors.map((anchor) => (
src/features/score/atlas/mapping/MapScoreWizard.tsx:270:                {pageAnchors.map((anchor) => (
src/features/score/atlas/mapping/MapScoreWizard.tsx:77:        .filter((anchor) => anchor.page === page)
src/features/score/atlas/mapping/MapScoreWizard.tsx:78:        .sort((a, b) => a.yPct - b.yPct),
src/features/score/atlas/mapping/anchors.ts:114:  const pageAnchors = anchors.filter((anchor) => anchor.page === box.page);
src/features/score/atlas/mapping/anchors.ts:120:  const sorted = [...pageAnchors].sort((left, right) => left.yPct - right.yPct);
src/features/score/atlas/mapping/calibrationApi.ts:54:  return anchors.map((anchor) => ({
src/features/score/atlas/mapping/calibrationApi.ts:63:  return points.map((point) => ({
src/features/score/atlas/mapping/candidate.ts:44:  const pageAnchors = anchors.filter((anchor) => anchor.page === box.page);
src/features/score/atlas/mapping/candidate.ts:45:  const pointIds = pageAnchors.map((anchor) => anchorPointId(edition, anchor));
src/features/score/atlas/selection.ts:176:    rects: rects.map((rect) => ({ ...rect })),
src/features/score/atlas/ui/TargetDraftEditor.tsx:283:    const values = [numericX, numericY, numericWidth, numericHeight].map(
src/features/score/atlas/ui/TargetDraftEditor.tsx:290:    const [x, y, width, height] = values.map((value) => value / 100);
src/features/session/SessionBar.tsx:103:            session.events.map((ev, i) => (
src/features/settings/SettingsPanel.tsx:250:            {(["claude", "gemini"] as Provider[]).map((provider) => (
src/features/settings/SettingsPanel.tsx:261:                    api_keys: value.api_keys.map((item) =>
src/features/settings/SettingsPanel.tsx:312:              ].map((voice) => (
src/features/settings/SettingsPanel.tsx:347:              {["woodblock", "tick", "clave", "rim", "cowbell", "beep"].map(
src/features/settings/SettingsPanel.tsx:659:    .map((item) => item.trim())
src/features/settings/SettingsPanel.tsx:660:    .filter(Boolean);
src/features/today/TodayWorkspace.tsx:205:            {plan.activePlan.plan.sequence.map((item) => {
src/features/today/TodayWorkspace.tsx:88:    return [...pieces].sort((left, right) => {
src/features/tutorials/TutorialPanel.tsx:157:      setVideos((current) => current.filter((video) => video.id !== id));
src/features/tutorials/TutorialPanel.tsx:184:            {videos.map((video) => <option value={video.id} key={video.id}>{video.title}</option>)}
src/features/tutorials/TutorialPanel.tsx:231:          {regionClips.map(({ clip, video }) => (
src/features/tutorials/TutorialPanel.tsx:240:                  {videos.flatMap((item) => item.clips).filter((item) => item.chapter_id === clip.chapter_id).length > 1
src/features/tutorials/TutorialPanel.tsx:260:          <label><span className="ck-label">Video</span><select value={editing.video_id} onChange={(event) => setEditing({ ...editing, video_id: Number(event.target.value) })}>{videos.map((video) => <option value={video.id} key={video.id}>{video.title}</option>)}</select></label>
src/features/tutorials/TutorialPanel.tsx:48:    .flatMap((video) => video.clips.map((clip) => ({ clip, video })))
src/features/tutorials/TutorialPanel.tsx:49:    .filter(({ clip }) => clip.region_id === regionId)
src/features/tutorials/TutorialPanel.tsx:50:    .sort((a, b) => a.clip.order - b.clip.order || a.clip.start_seconds - b.clip.start_seconds), [regionId, videos]);
src/features/tutorials/TutorialPanel.tsx:57:    : videos.flatMap((video) => video.clips).filter((clip) => clip.chapter_id === editingClip.chapter_id).length;
src/features/tutorials/TutorialPanel.tsx:66:    setVideos((current) => current.map((video) => video.id === activeVideo.id
src/features/universe/UniverseWorkspace.test.tsx:157:    expect(invokeMock.mock.calls.filter(([command]) => command === "piece_select")).toHaveLength(0);
src/features/universe/UniverseWorkspace.test.tsx:239:      layout.nodes.map((node) => [node.piece.piece_id, `${node.x.toFixed(3)}:${node.y.toFixed(3)}`]),
src/features/universe/UniverseWorkspace.test.tsx:243:    expect(new Set(forward.nodes.map((node) => `${node.x}:${node.y}`)).size).toBe(64);
src/features/universe/UniverseWorkspace.tsx:168:    .sort((left, right) => left.region_id - right.region_id)
src/features/universe/UniverseWorkspace.tsx:218:  const layoutKey = layout.nodes.map((node) => node.piece.piece_id).join(":");
src/features/universe/UniverseWorkspace.tsx:417:                      {layout.nodes.map((node) => {
src/features/universe/UniverseWorkspace.tsx:431:                      {layout.nodes.map((node, index) => {
src/features/universe/UniverseWorkspace.tsx:542:                            {targets.map((target, targetIndex) => {
src/features/universe/UniverseWorkspace.tsx:599:              {pieces.map((piece) => (
src/features/universe/UniverseWorkspace.tsx:627:              {snapshot.definitions.map((definition) => (
src/features/universe/UniverseWorkspace.tsx:694:        {regions.map((region) => (
src/features/universe/UniverseWorkspace.tsx:708:                ].filter(Boolean).join(" · ")
src/features/universe/UniverseWorkspace.tsx:764:            {piece.region_signals.map((region) => (
src/features/universe/graphLayout.ts:50:  const ordered = [...pieces].sort((left, right) => {
src/features/universe/graphLayout.ts:63:  const nodes = ordered.map((piece, index) => {
src/features/voice/ActionDraftCard.tsx:295:          {value.issues.map((entry) => <li key={entry.code}>{entry.message}</li>)}
src/features/voice/domain/actionDraft.test.ts:58:    expect(draft?.issues.map((entry) => entry.code)).toEqual([
src/features/voice/domain/actionDraft.test.ts:72:    expect(draft?.issues.map((entry) => entry.code)).toEqual([
src/features/voice/domain/spokenNumber.ts:125:    .filter((word) => word !== "");
src/features/voice/domain/spokenNumber.ts:81:    .filter((word) => word !== "");
src/features/voice/domain/spokenNumber.ts:93:    const joined = words.map((word) => String(own(DIGITS, word))).join("");
src/shell/Shell.test.tsx:19:    expect(tabs.map((t) => t.textContent)).toEqual([
src/shell/Shell.tsx:349:          {WORKSPACES.map((workspace, index) => {
src/state/settings.test.ts:123:    expect(writes.map((write) => write.status)).toEqual(["rejected", "fulfilled"]);
```

## 5. createContext(/useContext( and inline object/array/arrow-function literals passed as JSX props

### createContext / useContext
```
src/features/receipts/ReceiptCenter.tsx:60:  return useContext(ReceiptContext);
```

### Inline prop literals (heuristic regex: prop={ followed by (), (arg, ..., [, or { — catches arrow fns, spreads, inline arrays/objects; NOT exhaustive, e.g. does not catch bare object literals like prop={{a:1}} without leading brace variance, does catch that too via '{' second char)
```
src/App.tsx:33:          onResetLayout={() => {}}
src/App.tsx:34:          onInterfaceScaleSaved={(scale) => {
src/components/ConfirmDelete.tsx:43:      <Popover anchorRef={anchorRef} open={open} onClose={() => setOpen(false)} label="Confirm delete">
src/components/ConfirmDelete.tsx:47:            <button type="button" onClick={() => setOpen(false)}>
src/components/EditableField.tsx:108:      onChange={(e) => setDraft(e.target.value)}
src/components/EditableField.tsx:109:      onBlur={() => {
src/components/EditableField.tsx:116:      onKeyDown={(e) => {
src/components/EditableNumber.tsx:76:        onDoubleClick={() => {
src/components/EditableNumber.tsx:96:      onChange={(e) => setDraft(e.target.value)}
src/components/EditableNumber.tsx:98:      onKeyDown={(e) => {
src/components/FloatingPanel.test.tsx:31:        geometry={{ id: "a", x: 100, y: 100, w: 300, h: 200, collapsed: false, z: 1 }}
src/components/FloatingPanel.test.tsx:53:        geometry={{ id: "b", x: 0, y: 0, w: 300, h: 200, collapsed: false, z: 1 }}
src/components/FloatingPanel.test.tsx:71:        geometry={{ id: "r", x: 650, y: 550, w: 300, h: 200, collapsed: false, z: 1 }}
src/components/FloatingPanel.test.tsx:95:        geometry={{ id: "c", x: 0, y: 0, w: 300, h: 200, collapsed: false, z: 1 }}
src/components/FloatingPanel.tsx:158:      style={{
src/components/FloatingPanel.tsx:165:      onPointerDown={() => onFocus(current.id)}
src/components/FloatingPanel.tsx:169:        onPointerDown={(event) => {
src/components/FloatingPanel.tsx:193:          onPointerDown={(event) => begin(event, "resize")}
src/components/Popover.test.tsx:158:        <button ref={anchorRef} onClick={() => setOpen(false)}>
src/components/Popover.test.tsx:161:        <Popover anchorRef={anchorRef} open={open} onClose={() => setOpen(false)} label="Test">{null}</Popover>
src/components/Popover.test.tsx:200:        <button data-testid="close" onClick={() => setOpen(false)}>
src/components/Popover.test.tsx:203:        <Popover anchorRef={anchorRef} open={open} onClose={() => setOpen(false)} label="Test">{null}</Popover>
src/components/Popover.tsx:163:      style={{
src/devMock/tauriDevMock.smoke.test.tsx:35:        onOpenAtlas={() => {}}
src/devMock/tauriDevMock.smoke.test.tsx:36:        onOpenCalendar={() => {}}
src/devMock/tauriDevMock.smoke.test.tsx:37:        onOpenPiece={() => {}}
src/devMock/tauriDevMock.smoke.test.tsx:73:    renderWorkspace(<UniverseWorkspace onOpenPractice={() => {}} />);
src/features/brain/BrainWorkspace.tsx:322:            onChange={(event) =>
src/features/brain/BrainWorkspace.tsx:448:            onChange={(event) => setDraft(event.target.value)}
src/features/brain/BrainWorkspace.tsx:453:            onKeyDown={(event) => {
src/features/brain/BrainWorkspace.tsx:465:                onClick={() => void clearConversation()}
src/features/brain/BrainWorkspace.tsx:579:          onClick={() => void onRefresh()}
src/features/brain/BrainWorkspace.tsx:643:      <Button variant="text" onClick={() => setOpen(true)}>
src/features/brain/BrainWorkspace.tsx:653:      onSubmit={(event) => {
src/features/brain/BrainWorkspace.tsx:682:          onChange={(event) => setDate(event.target.value)}
src/features/brain/BrainWorkspace.tsx:694:          onChange={(event) => setMinutes(Number(event.target.value))}
src/features/brain/BrainWorkspace.tsx:703:        onClick={() => setOpen(false)}
src/features/brain/BrainWorkspace.tsx:790:                onChange={(event) =>
src/features/brain/BrainWorkspace.tsx:811:                  onChange={(event) =>
src/features/brain/BrainWorkspace.tsx:834:          onClick={() => void save()}
src/features/calendar/CalendarWorkspace.tsx:138:          onCancel={() => setReviewing(false)}
src/features/calendar/CalendarWorkspace.tsx:165:              onChange={(event) => setCapacityDraft(event.target.value)}
src/features/calendar/CalendarWorkspace.tsx:166:              onKeyDown={(event) => {
src/features/calendar/CalendarWorkspace.tsx:171:            <button type="button" aria-label="Save daily capacity" onClick={() => void saveCapacity()}>Save</button>
src/features/calendar/CalendarWorkspace.tsx:182:          <button type="button" onClick={() => setReviewing(true)}>Review missed work</button>
src/features/calendar/CalendarWorkspace.tsx:186:      <details className="calendar-retention" onToggle={(event) => setRetentionOpen(event.currentTarget.open)}>
src/features/calendar/CalendarWorkspace.tsx:192:        <button type="button" aria-label="Previous week" onClick={() => setWeekStart(addDays(weekStart, -7))}>←</button>
src/features/calendar/CalendarWorkspace.tsx:193:        <button type="button" onClick={() => setWeekStart(startOfWeek(today))}>This week</button>
src/features/calendar/CalendarWorkspace.tsx:195:        <button type="button" aria-label="Next week" onClick={() => setWeekStart(addDays(weekStart, 7))}>→</button>
src/features/calendar/CalendarWorkspace.tsx:281:            onCancel={() => setEditing(null)}
src/features/calendar/CalendarWorkspace.tsx:295:            onEdit={() => setEditing(item.id)}
src/features/calendar/CalendarWorkspace.tsx:296:            onMove={() => setEditing(item.id)}
src/features/calendar/CalendarWorkspace.tsx:306:          onCancel={() => setCreating(false)}
src/features/calendar/CalendarWorkspace.tsx:321:        <button type="button" className="calendar-add-work" onClick={() => setCreating(true)}>+ Add work</button>
src/features/calendar/CalendarWorkspace.tsx:354:            <button type="button" onClick={() => void onPatch({ status: "done" })}>Done</button>
src/features/calendar/CalendarWorkspace.tsx:355:            <button type="button" onClick={() => void onPatch({ status: "dismissed" })}>Dismiss</button>
src/features/calendar/CalendarWorkspace.tsx:400:    <form className="calendar-work-form" aria-label={work ? `Edit ${work.title}` : `Add work on ${date}`} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
src/features/calendar/CalendarWorkspace.tsx:404:          <select aria-label="Goal" value={goalId} onChange={(event) => setGoalId(Number(event.target.value))}>
src/features/calendar/CalendarWorkspace.tsx:414:      <label><span>Exact work step (separate from the Goal)</span><input autoFocus value={title} aria-label="Work title" onChange={(event) => setTitle(event.target.value)} /></label>
src/features/calendar/CalendarWorkspace.tsx:416:        <label><span>Minutes</span><input type="number" min="1" max="240" value={minutes} aria-label="Planned minutes" onChange={(event) => setMinutes(Number(event.target.value))} /></label>
src/features/calendar/CalendarWorkspace.tsx:417:        <label><span>Date</span><input type="date" value={scheduledDate} aria-label="Scheduled date" onChange={(event) => setScheduledDate(event.target.value)} /></label>
src/features/calendar/RecoveryReview.tsx:100:                        onChange={(event) => setDrafts((current) => ({
src/features/calendar/RecoveryReview.tsx:119:                          onChange={(event) => setDrafts((current) => ({
src/features/calendar/RecoveryReview.tsx:137:        <button type="button" className="calendar-primary-button" disabled={applying} onClick={() => void apply()}>
src/features/composer/SessionComposer.tsx:279:              onChange={(event) => {
src/features/composer/SessionComposer.tsx:350:                        onChange={(event) => updateItem(item.candidate_id, {
src/features/composer/SessionComposer.tsx:394:                    onChange={(event) => updateItem(item.candidate_id, {
src/features/composer/SessionComposer.tsx:424:          onClick={() => void startSession()}
src/features/ledger/LedgerWorkspace.tsx:78:                    onClick={() => setSelectedId(piece.id)}
src/features/metronome/MetronomePopover.test.tsx:34:      <MetronomePopover anchorRef={anchorRef} open onClose={() => {}} />
src/features/metronome/MetronomePopover.tsx:157:            onClick={() => m.nudgeBpm(-1)}
src/features/metronome/MetronomePopover.tsx:169:              onFocus={(e) => {
src/features/metronome/MetronomePopover.tsx:173:              onChange={(e) => setDraft(e.currentTarget.value.replace(/[^0-9]/g, ""))}
src/features/metronome/MetronomePopover.tsx:175:              onKeyDown={(e) => {
src/features/metronome/MetronomePopover.tsx:191:            onClick={() => m.nudgeBpm(1)}
src/features/metronome/MetronomePopover.tsx:209:          onKeyDown={(e) => {
src/features/metronome/MetronomePopover.tsx:221:            style={{ backgroundPositionX: `${-state.bpm * 6}px` }}
src/features/metronome/MetronomePopover.tsx:242:            style={{ animationDelay: `${i * beatPeriod}s` }}
src/features/metronome/MetronomePopover.tsx:280:            onClick={() => void m.selectSound(s.id)}
src/features/metronome/MetronomePopover.tsx:301:          onChange={(e) => m.setGain(Number(e.currentTarget.value))}
src/features/metronome/MetronomePopover.tsx:364:          onClick={() => onChange(value - 1)}
src/features/metronome/MetronomePopover.tsx:374:          onClick={() => onChange(value + 1)}
src/features/metronome/MetronomePopover.tsx:400:      onClick={() => onChange(!checked)}
src/features/pieces/BlockRow.test.tsx:106:    render(<BlockRow block={{ ...block, start_bpm: null, bpm: null }} onChanged={vi.fn()} />);
src/features/pieces/BlockRow.test.tsx:164:    render(<BlockRow block={{
src/features/pieces/BlockRow.test.tsx:51:    render(<BlockRow block={block} regions={[{ id: 1, name: "Exposition" }]} onChanged={vi.fn()} />);
src/features/pieces/BlockRow.tsx:184:          onClick={() => void loadReps()}
src/features/pieces/BlockRow.tsx:231:                    onChange={(event) => {
src/features/pieces/BlockRow.tsx:256:                    onSave={(note) => mutateRep(
src/features/pieces/BlockRow.tsx:267:                    onConfirm={() => mutateRep(
src/features/pieces/GoalsPanel.tsx:137:        <input className="ck-input" value={draft} aria-label="New big goal" placeholder="Add a big goal…" onChange={(event) => setDraft(event.target.value)} />
src/features/pieces/GoalsPanel.tsx:221:          <input autoFocus className="ck-input" aria-label={`New subgoal for ${goal.text}`} value={subgoalDraft} onChange={(event) => setSubgoalDraft(event.target.value)} />
src/features/pieces/GoalsPanel.tsx:223:          <button className="ck-add is-quiet" type="button" onClick={() => setAddingSubgoal(false)}>Cancel</button>
src/features/pieces/GoalsPanel.tsx:230:          onClick={() => setAddingSubgoal(true)}
src/features/pieces/GoalsPanel.tsx:256:      <input type="checkbox" checked={goal.done} aria-label={`Complete ${goal.text}`} onChange={(event) => void onMutate(() => api.goalUpdate(goal.id, { done: event.target.checked }))} />
src/features/pieces/GoalsPanel.tsx:264:          onChange={(event) => void onMutate(() => api.goalUpdate(goal.id, { target_date: event.target.value || null }))}
src/features/pieces/GoalsPanel.tsx:268:        <button type="button" disabled={index === 0} aria-label={`Move ${goal.text} up`} onClick={() => void onReorder(siblings, index, -1)}>↑</button>
src/features/pieces/GoalsPanel.tsx:269:        <button type="button" disabled={index === siblings.length - 1} aria-label={`Move ${goal.text} down`} onClick={() => void onReorder(siblings, index, 1)}>↓</button>
src/features/pieces/HistoryPanel.tsx:224:          <label className="history-search"><span className="history-search-icon" aria-hidden="true">⌕</span><input type="search" aria-label="Search practice history" placeholder="Section, label, or measure…" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
src/features/pieces/HistoryPanel.tsx:227:            <select aria-label="Filter practice history by focus" value={focus} onChange={(event) => setFocus(event.target.value as HistoryFocus)}>
src/features/pieces/HistoryPanel.tsx:240:            <select aria-label="Filter practice history by evidence" value={evidence} onChange={(event) => setEvidence(event.target.value as HistoryEvidence)}>
src/features/pieces/HistoryPanel.tsx:249:          <select aria-label="Sort practice history" value={sort} onChange={(event) => setSort(event.target.value as HistorySort)}>
src/features/pieces/HistoryPanel.tsx:290:              onClick={() => setVisibleGroupCount((count) => count + INITIAL_VISIBLE_GROUPS)}
src/features/pieces/IntakeForm.tsx:108:            onChange={(e) => setDeadline(e.target.value)}
src/features/pieces/IntakeForm.tsx:120:            onChange={(e) => setTargetTempo(e.target.value)}
src/features/pieces/IntakeForm.tsx:135:              onChange={(e) => setSpot(i, { measures: e.target.value })}
src/features/pieces/IntakeForm.tsx:143:              onChange={(e) => setSpot(i, { note: e.target.value })}
src/features/pieces/IntakeForm.tsx:149:              onClick={() => removeSpot(i)}
src/features/pieces/IntakeForm.tsx:167:          onChange={(e) => setCurrentState(e.target.value)}
src/features/pieces/IntakeForm.tsx:84:              onChange={(e) => setGoal(i, e.target.value)}
src/features/pieces/IntakeForm.tsx:90:              onClick={() => removeGoal(i)}
src/features/pieces/PieceDetail.test.tsx:25:      onClick={() => onOpen({
src/features/pieces/PieceDetail.tsx:163:              onClick={() => setSurface("score")}
src/features/pieces/PieceDetail.tsx:172:              onClick={() => setSurface("practice")}
src/features/pieces/PieceDetail.tsx:196:          onRegionsChanged={() => setRegionRevision((revision) => revision + 1)}
src/features/pieces/PieceDetail.tsx:207:            onChanged={() => setRegionRevision((revision) => revision + 1)}
src/features/pieces/PieceDetail.tsx:240:          onSave={(current_state) => onUpdate({ current_state: current_state || null })}
src/features/pieces/PieceDetail.tsx:246:          <EditableField value={piece.deadline ?? ""} placeholder="None" ariaLabel="deadline" onSave={(deadline) => onUpdate({ deadline: deadline || null })} />
src/features/pieces/PieceDetail.tsx:250:          <span>♩ = <EditableNumber value={piece.target_tempo} min={1} allowNull ariaLabel="target tempo" onSave={(target_tempo) => onUpdate({ target_tempo })} /></span>
src/features/pieces/PieceDetail.tsx:257:            <ConfirmDelete label="Delete the piece-wide note? Tricky Section notes and practice-attempt notes are separate and will stay." onConfirm={() => onUpdate({ notes: null })}>
src/features/pieces/PieceDetail.tsx:262:        <EditableField value={piece.notes ?? ""} placeholder="Double-click to add notes" ariaLabel="piece notes" onSave={(notes) => onUpdate({ notes: notes || null })} />
src/features/pieces/PiecesPanel.tsx:116:          onBack={() => {
src/features/pieces/PiecesPanel.tsx:182:                onClick={() => select(p.id)}
src/features/pieces/RegionEditor.test.tsx:16:    render(<RegionEditor region={region} regions={[region, other]} onChanged={vi.fn()} />);
src/features/pieces/RegionEditor.test.tsx:30:    render(<RegionEditor region={region} regions={[region, other]} onChanged={vi.fn()} />);
src/features/pieces/RegionEditor.test.tsx:41:    render(<RegionEditor region={anchored} regions={[anchored, other]} onChanged={vi.fn()} />);
src/features/pieces/RegionEditor.test.tsx:55:    render(<RegionEditor region={longRegion} regions={[longRegion]} alwaysOpen onChanged={vi.fn()} />);
src/features/pieces/RegionEditor.test.tsx:65:    render(<RegionEditor region={region} regions={[region]} alwaysOpen onChanged={vi.fn()} />);
src/features/pieces/RegionEditor.tsx:111:        onSubmit={(event) => { event.preventDefault(); void saveFields(); }}
src/features/pieces/RegionEditor.tsx:120:            onChange={(event) => setTitle(event.target.value)}
src/features/pieces/RegionEditor.tsx:132:            onChange={(event) => setNotes(event.target.value)}
src/features/pieces/RegionEditor.tsx:138:            <input aria-label="Tricky section start measure" type="number" min="1" value={start} onChange={(event) => setStart(event.target.value)} />
src/features/pieces/RegionEditor.tsx:142:            <input aria-label="Tricky section end measure" type="number" min={Math.max(1, nextStart || 1)} value={end} onChange={(event) => setEnd(event.target.value)} />
src/features/pieces/RegionEditor.tsx:159:              style={{ backgroundColor: color }}
src/features/pieces/RegionEditor.tsx:160:              onClick={() => void run(() => crud.regionUpdate(region.id, { color })).catch(() => undefined)}
src/features/pieces/RegionEditor.tsx:163:          <button type="button" className="region-color-clear" onClick={() => void run(() => crud.regionUpdate(region.id, { color: null })).catch(() => undefined)}>Clear</button>
src/features/pieces/RegionEditor.tsx:174:            <select aria-label="Merge target" value={mergeTarget} onChange={(event) => setMergeTarget(event.target.value)}>
src/features/pieces/RegionEditor.tsx:179:          <ConfirmDelete label={`Merge “${region.name}” into the selected section? Its practice blocks, linked Calendar work, tutorial mappings, and compatible score annotations will move there.`} onConfirm={() => run(() => crud.regionMerge(Number(mergeTarget), region.id))}>
src/features/pieces/RegionEditor.tsx:189:            <input aria-label="Split measure" type="number" min={region.m_start + 1} max={region.m_end} value={splitAt} onChange={(event) => setSplitAt(event.target.value)} />
src/features/pieces/RegionEditor.tsx:199:        onConfirm={() => run(() => crud.regionDelete(region.id))}
src/features/pieces/RegionEditor.tsx:209:    <div className={`region-editor ${alwaysOpen ? "is-always-open" : ""}`} style={{ "--region-color": region.color ?? "var(--accent)" } as React.CSSProperties}>
src/features/pieces/RegionEditor.tsx:211:        <button type="button" className="region-manage-toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
src/features/pieces/RegionEditor.tsx:304:        <button type="button" className="ck-add" onClick={() => setAdding((value) => !value)}>{adding ? "Cancel" : "+ Add"}</button>
src/features/pieces/RegionEditor.tsx:307:        <form className="tricky-section-add" onSubmit={(event) => { event.preventDefault(); void create(); }}>
src/features/pieces/RegionEditor.tsx:308:          <label><span className="ck-label">Section title</span><input autoFocus className="ck-input" aria-label="New tricky section title" maxLength={REGION_TITLE_MAX} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
src/features/pieces/RegionEditor.tsx:309:          <label className="tricky-section-add-notes"><span className="ck-label">Practice notes</span><textarea className="ck-input" aria-label="New tricky section practice notes" maxLength={REGION_NOTES_MAX} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
src/features/pieces/RegionEditor.tsx:310:          <label><span className="ck-label">From</span><input aria-label="New tricky section start measure" type="number" min="1" value={start} onChange={(event) => setStart(event.target.value)} /></label>
src/features/pieces/RegionEditor.tsx:311:          <label><span className="ck-label">To</span><input aria-label="New tricky section end measure" type="number" min="1" value={end} onChange={(event) => setEnd(event.target.value)} /></label>
src/features/pieces/RegionEditor.tsx:320:            <article className="tricky-section-card" key={region.id} style={{ "--region-color": region.color ?? "var(--accent)" } as React.CSSProperties}>
src/features/receipts/ReceiptCenter.test.tsx:12:      <button onClick={() => receipts.undone("Last attempt undone.")}>
src/features/receipts/ReceiptCenter.test.tsx:15:      <button onClick={() => receipts.error(
src/features/receipts/ReceiptCenter.test.tsx:21:      <button onClick={() => receipts.mutation({
src/features/receipts/ReceiptCenter.test.tsx:33:      <button onClick={() => receipts.mutation({
src/features/receipts/ReceiptCenter.test.tsx:44:      <button onClick={() => receipts.mutation({
src/features/receipts/ReceiptCenter.test.tsx:9:      <button onClick={() => receipts.committed("Practice block opened.")}>
src/features/receipts/ReceiptCenter.tsx:183:                onClick={() => onDismiss(receipt.id)}
src/features/references/ReferenceButtons.tsx:49:        <button type="button" disabled={opening != null} onClick={() => void open("spotify")}>
src/features/references/ReferenceButtons.tsx:52:        <button type="button" disabled={opening != null} onClick={() => void open("youtube")}>
src/features/rep/BlockForm.tsx:144:            onChange={(event) => {
src/features/rep/BlockForm.tsx:160:          <input type="checkbox" aria-label="Use metronome" checked={useMetronome} onChange={(event) => setUseMetronome(event.target.checked)} />
src/features/rep/BlockForm.tsx:176:            onChange={(e) => setMStart(e.target.value)}
src/features/rep/BlockForm.tsx:189:            onChange={(e) => setMEnd(e.target.value)}
src/features/rep/BlockForm.tsx:202:            onChange={(e) => setLabel(e.target.value)}
src/features/rep/BlockForm.tsx:219:            onChange={(e) => setStartBpm(e.target.value)}
src/features/rep/BlockForm.tsx:232:            onChange={(e) => setTargetBpm(e.target.value)}
src/features/rep/BlockForm.tsx:244:            onChange={(event) => {
src/features/rep/BlockForm.tsx:268:              onChange={(event) => {
src/features/rep/BlockForm.tsx:285:              onChange={(event) => setPlannedReps(event.target.value)}
src/features/rep/BlockForm.tsx:302:            onChange={(event) => setPlannedReps(event.target.value)}
src/features/rep/BlockForm.tsx:318:            onClick={() => setMode("auto")}
src/features/rep/BlockForm.tsx:327:            onClick={() => setMode("manual")}
src/features/rep/BlockForm.tsx:343:                onChange={(e) => setCleanNeeded(e.target.value)}
src/features/rep/BlockForm.tsx:354:                onChange={(e) => setBpmStep(e.target.value)}
src/features/rep/BlockForm.tsx:371:              onChange={(e) => setVariant(i, { name: e.target.value })}
src/features/rep/BlockForm.tsx:380:              onChange={(e) =>
src/features/rep/BlockForm.tsx:388:              onClick={() => removeVariant(i)}
src/features/rep/RepHud.test.tsx:115:        feed={[]}
src/features/rep/RepHud.test.tsx:127:    render(<RepHud snap={makeSnap()} feed={[]} error={null} {...handlers} />);
src/features/rep/RepHud.test.tsx:147:    render(<RepHud snap={makeSnap()} feed={[]} error={null} {...handlers} />);
src/features/rep/RepHud.test.tsx:167:    render(<RepHud snap={makeSnap()} feed={[]} error={null} {...handlers} />);
src/features/rep/RepHud.test.tsx:184:    render(<RepHud snap={makeSnap()} feed={[]} error={null} {...handlers} />);
src/features/rep/RepHud.test.tsx:206:        feed={[]}
src/features/rep/RepHud.test.tsx:218:    render(<RepHud snap={makeSnap()} feed={[]} error={null} {...handlers} />);
src/features/rep/RepHud.test.tsx:234:        feed={[]}
src/features/rep/RepHud.test.tsx:247:    render(<RepHud snap={makeSnap()} feed={[]} error={null} {...handlers} />);
src/features/rep/RepHud.test.tsx:261:        feed={[]}
src/features/rep/RepHud.test.tsx:275:        feed={[]}
src/features/rep/RepHud.test.tsx:286:        feed={[]}
src/features/rep/RepHud.test.tsx:314:        feed={[]}
src/features/rep/RepHud.test.tsx:329:        feed={[
src/features/rep/RepHud.test.tsx:347:        feed={[{ verdict: "clean", note: "from memory", bpm: null }]}
src/features/rep/RepHud.test.tsx:361:        feed={[]}
src/features/rep/RepHud.test.tsx:75:      <RepHud snap={null} feed={[]} error={null} {...callbacks()} />,
src/features/rep/RepHud.test.tsx:84:        feed={[]}
src/features/rep/RepHud.tsx:420:              onClick={() => void submit(button.verdict)}
src/features/rep/RepHud.tsx:433:          onChange={(event) => setNote(event.target.value)}
src/features/rep/RepHud.tsx:442:          onClick={() => void runTimer()}
src/features/rep/RepHud.tsx:455:          onClick={() => void runUndo()}
src/features/rep/RepHud.tsx:463:          onClick={() => setCorrecting((value) => !value)}
src/features/rep/RepHud.tsx:471:            onClick={() => void runReversal()}
src/features/rep/RepHud.tsx:481:          onClick={() => setRestartConfirm(true)}
src/features/rep/RepHud.tsx:489:          onClick={() => setReflectionOpen((value) => !value)}
src/features/rep/RepHud.tsx:508:        onClick={() => void runSafetyStop()}
src/features/rep/RepHud.tsx:528:          onSubmit={(event) => {
src/features/rep/RepHud.tsx:541:            onChange={(event) => setReflection(event.target.value)}
src/features/rep/RepHud.tsx:550:              onClick={() => setReflectionOpen(false)}
src/features/rep/RepHud.tsx:561:        onToggle={(event) => setRecoveryOpen(event.currentTarget.open)}
src/features/rep/RepHud.tsx:571:            onClick={() =>
src/features/rep/RepHud.tsx:584:            onClick={() =>
src/features/rep/RepHud.tsx:598:              onClick={() =>
src/features/rep/RepHud.tsx:616:            onClick={() =>
src/features/rep/RepHud.tsx:629:            onSubmit={(event) => {
src/features/rep/RepHud.tsx:650:              onChange={(event) => setRecoveryStart(event.target.value)}
src/features/rep/RepHud.tsx:658:              onChange={(event) => setRecoveryEnd(event.target.value)}
src/features/rep/RepHud.tsx:665:            onSubmit={(event) => {
src/features/rep/RepHud.tsx:678:              onChange={(event) => setRecoveryHands(event.target.value)}
src/features/rep/RepHud.tsx:690:            onSubmit={(event) => {
src/features/rep/RepHud.tsx:703:              onChange={(event) => setRecoveryMethod(event.target.value)}
src/features/rep/RepHud.tsx:728:          onSubmit={(event) => {
src/features/rep/RepHud.tsx:737:            onChange={(event) =>
src/features/rep/RepHud.tsx:749:            onChange={(event) => setCorrectNote(event.target.value)}
src/features/rep/RepHud.tsx:757:            onClick={() => setCorrecting(false)}
src/features/rep/RepHud.tsx:781:            onClick={() => void runRestart()}
src/features/rep/RepHud.tsx:788:            onClick={() => {
src/features/retention/RetentionQueue.test.tsx:276:        onClick={() => {
src/features/retention/RetentionQueue.tsx:104:          onClick={() => onLower(note)}
src/features/retention/RetentionQueue.tsx:112:          onClick={() => onReopen(note)}
src/features/retention/RetentionQueue.tsx:126:          onChange={(event) => setSnoozeDate(event.target.value)}
src/features/retention/RetentionQueue.tsx:132:          onClick={() => onSnooze(snoozeDate)}
src/features/retention/RetentionQueue.tsx:156:        <button type="button" onClick={() => void retention.reload()} disabled={retention.loading}>
src/features/retention/RetentionQueue.tsx:185:              onConfirm={(note) => void retention.confirm(check.id, note)}
src/features/retention/RetentionQueue.tsx:186:              onLower={(note) => void retention.lower(check.id, note)}
src/features/retention/RetentionQueue.tsx:187:              onReopen={(note) => void retention.reopen(check.id, note)}
src/features/retention/RetentionQueue.tsx:188:              onSnooze={(date) => void retention.snooze(check.id, date)}
src/features/retention/RetentionQueue.tsx:86:        onChange={(event) => setNote(event.target.value)}
src/features/retention/RetentionQueue.tsx:96:          onClick={() => onConfirm(note)}
src/features/score/PdfPage.tsx:104:      style={{ width: displayed.width, height: displayed.height }}
src/features/score/RegionOverlay.test.tsx:13:        items={[{
src/features/score/RegionOverlay.test.tsx:35:        items={[]}
src/features/score/RegionOverlay.test.tsx:36:        mapping={{ regionId: 9, label: "Coda", color: null, draftRects: [], tool: "box", onAddRect, onUpdateRect: vi.fn() }}
src/features/score/RegionOverlay.test.tsx:56:        items={[{
src/features/score/RegionOverlay.test.tsx:64:        mapping={{
src/features/score/RegionOverlay.test.tsx:92:        items={[]}
src/features/score/RegionOverlay.test.tsx:93:        mapping={{
src/features/score/RegionOverlay.tsx:143:      style={{ ...rectStyle(rect), "--region-color": color ?? "var(--accent)" } as React.CSSProperties}
src/features/score/RegionOverlay.tsx:147:      onPointerDown={(event) => begin(event, "move")}
src/features/score/RegionOverlay.tsx:157:        onPointerDown={(event) => begin(event, "resize")}
src/features/score/RegionOverlay.tsx:198:      onPointerDown={(event) => {
src/features/score/RegionOverlay.tsx:205:      onPointerMove={(event) => {
src/features/score/RegionOverlay.tsx:222:      onPointerCancel={() => {
src/features/score/RegionOverlay.tsx:235:              style={{ ...rectStyle(rect), "--region-color": item.color ?? "var(--accent)" } as React.CSSProperties}
src/features/score/RegionOverlay.tsx:237:              onPointerDown={(event) => event.stopPropagation()}
src/features/score/RegionOverlay.tsx:238:              onClick={() => onSelect(item.regionId)}
src/features/score/ScoreView.tsx:1205:              onClick={() => setSectionTab(tab)}
src/features/score/ScoreView.tsx:1243:                      onClick={() =>
src/features/score/ScoreView.tsx:1265:                        onClick={() => jumpTo(rect.page)}
src/features/score/ScoreView.tsx:1278:                          onChange={(event) =>
src/features/score/ScoreView.tsx:1325:                onClick={() =>
src/features/score/ScoreView.tsx:1339:                onClick={() => void persistMapping(mappingThisRegion.rects)}
src/features/score/ScoreView.tsx:1343:              <button type="button" onClick={() => setMapping(null)}>
src/features/score/ScoreView.tsx:1356:                        onClick={() => jumpTo(rect.page)}
src/features/score/ScoreView.tsx:1371:                onClick={() => beginMapping(region)}
src/features/score/ScoreView.tsx:1378:                  onConfirm={() => persistMapping([])}
src/features/score/ScoreView.tsx:1467:          onClick={() => setReloadToken((value) => value + 1)}
src/features/score/ScoreView.tsx:1487:              onChange={(event) => void chooseEdition(event.target.value)}
src/features/score/ScoreView.tsx:1529:            onClick={() => jumpTo(currentPage - 1)}
src/features/score/ScoreView.tsx:1534:            onSubmit={(event) => {
src/features/score/ScoreView.tsx:1543:              onChange={(event) => setPageDraft(event.target.value)}
src/features/score/ScoreView.tsx:1551:            onClick={() => jumpTo(currentPage + 1)}
src/features/score/ScoreView.tsx:1561:            onClick={() => {
src/features/score/ScoreView.tsx:1572:            onClick={() => {
src/features/score/ScoreView.tsx:1586:            onChange={(event) => {
src/features/score/ScoreView.tsx:1594:            onClick={() => setScaleMode("width")}
src/features/score/ScoreView.tsx:1601:            onClick={() => setScaleMode("page")}
src/features/score/ScoreView.tsx:1608:            onClick={() => setScaleMode("overview")}
src/features/score/ScoreView.tsx:1686:                        edition={{
src/features/score/ScoreView.tsx:1715:            onClick={() => setSectionsVisible((visible) => !visible)}
src/features/score/ScoreView.tsx:1748:                onChange={(event) => setRegionQuery(event.target.value)}
src/features/score/ScoreView.tsx:1753:                onClick={() => setAddingRegion((value) => !value)}
src/features/score/ScoreView.tsx:1761:                onSubmit={(event) => {
src/features/score/ScoreView.tsx:1773:                    onChange={(event) => setNewRegionTitle(event.target.value)}
src/features/score/ScoreView.tsx:1782:                    onChange={(event) => setNewRegionNotes(event.target.value)}
src/features/score/ScoreView.tsx:1793:                      onChange={(event) =>
src/features/score/ScoreView.tsx:1805:                      onChange={(event) => setNewRegionEnd(event.target.value)}
src/features/score/ScoreView.tsx:1845:                      onClick={() => {
src/features/score/ScoreView.tsx:1861:                        style={{ background: region.color ?? "var(--accent)" }}
src/features/score/ScoreView.tsx:1904:                edition={{
src/features/score/ScoreView.tsx:1927:          edition={{
src/features/score/ScoreView.tsx:1940:          onClose={() => setWizardOpen(false)}
src/features/score/ScoreWorkspace.tsx:68:              onChange={(event) => setSelectedId(Number(event.target.value))}
src/features/score/atlas/mapping/MapScoreWizard.test.tsx:120:        onClose={() => {}}
src/features/score/atlas/mapping/MapScoreWizard.test.tsx:68:        onClose={() => {}}
src/features/score/atlas/mapping/MapScoreWizard.test.tsx:95:        onClose={() => {}}
src/features/score/atlas/mapping/MapScoreWizard.tsx:214:                style={{ top: `${pendingY * 100}%` }}
src/features/score/atlas/mapping/MapScoreWizard.tsx:222:                style={{ top: `${anchor.yPct * 100}%` }}
src/features/score/atlas/mapping/MapScoreWizard.tsx:242:                  onChange={(event) => {
src/features/score/atlas/mapping/MapScoreWizard.tsx:257:                  onChange={(event) => setMeasureDraft(event.target.value)}
src/features/score/atlas/mapping/MapScoreWizard.tsx:277:                      onClick={() => removeAnchor(anchor)}
src/features/score/atlas/mapping/MapScoreWizard.tsx:312:              onClick={() => setPage((value) => Math.max(1, value - 1))}
src/features/score/atlas/mapping/MapScoreWizard.tsx:319:              onClick={() =>
src/features/score/atlas/mapping/MapScoreWizard.tsx:333:              onClick={() => void save()}
src/features/score/atlas/ui/TargetDraftEditor.test.tsx:60:      resolveMapping={() => exact()}
src/features/score/atlas/ui/TargetDraftEditor.test.tsx:61:      geometryForEvent={() => ({
src/features/score/atlas/ui/TargetDraftEditor.test.tsx:68:      createConfirmationIdentity={() => ({
src/features/score/atlas/ui/TargetDraftEditor.tsx:468:                onChange={(event) => setTitle(event.target.value)}
src/features/score/atlas/ui/TargetDraftEditor.tsx:479:                onChange={(event) => setHands(event.target.value)}
src/features/score/atlas/ui/TargetDraftEditor.tsx:491:                onChange={(event) => setMethod(event.target.value)}
src/features/score/atlas/ui/TargetDraftEditor.tsx:503:                onChange={(event) => setNote(event.target.value)}
src/features/score/atlas/ui/TargetDraftEditor.tsx:521:                  onChange={(event) =>
src/features/score/atlas/ui/TargetDraftEditor.tsx:535:                  onChange={(event) =>
src/features/score/atlas/ui/TargetDraftEditor.tsx:609:                  onChange={(event) => setNumericX(event.target.value)}
src/features/score/atlas/ui/TargetDraftEditor.tsx:621:                  onChange={(event) => setNumericY(event.target.value)}
src/features/score/atlas/ui/TargetDraftEditor.tsx:633:                  onChange={(event) => setNumericWidth(event.target.value)}
src/features/score/atlas/ui/TargetDraftEditor.tsx:645:                  onChange={(event) => setNumericHeight(event.target.value)}
src/features/score/atlas/ui/TargetDraftEditor.tsx:669:              onClick={() => {
src/features/score/atlas/ui/TargetDraftEditor.tsx:688:              onClick={() => void save()}
src/features/score/atlas/ui/TargetDraftOverlay.tsx:127:      onPointerDown={(event) => {
src/features/score/atlas/ui/TargetDraftOverlay.tsx:136:      onPointerMove={(event) => {
src/features/score/atlas/ui/TargetDraftOverlay.tsx:146:      onPointerUp={(event) => {
src/features/score/atlas/ui/TargetDraftOverlay.tsx:149:      onPointerCancel={() => {
src/features/session/SessionBar.tsx:77:          onClick={() => setExpanded((v) => !v)}
src/features/settings/BrainConnection.tsx:100:        <Button variant="text" onClick={() => void test()} disabled={testing}>
src/features/settings/SettingsPanel.tsx:207:              onChange={(event) =>
src/features/settings/SettingsPanel.tsx:225:              onChange={(event) =>
src/features/settings/SettingsPanel.tsx:234:              onChange={(event) =>
src/features/settings/SettingsPanel.tsx:258:                onStatus={(status) =>
src/features/settings/SettingsPanel.tsx:278:              onChange={(event) =>
src/features/settings/SettingsPanel.tsx:290:              onChange={(event) =>
src/features/settings/SettingsPanel.tsx:299:              onChange={(event) =>
src/features/settings/SettingsPanel.tsx:321:              onChange={(event) =>
src/features/settings/SettingsPanel.tsx:343:              onChange={(event) =>
src/features/settings/SettingsPanel.tsx:358:              onChange={(event) =>
src/features/settings/SettingsPanel.tsx:369:            onChange={(metronome_boost_level) =>
src/features/settings/SettingsPanel.tsx:383:            onChange={(practice_default_clean_streak) =>
src/features/settings/SettingsPanel.tsx:392:            onChange={(ladder_bpm_step) =>
src/features/settings/SettingsPanel.tsx:406:            onChange={(calendar_capacity_minutes) =>
src/features/settings/SettingsPanel.tsx:419:              onChange={(event) =>
src/features/settings/SettingsPanel.tsx:432:            onChange={(clean) => setAliasDrafts({ ...aliasDrafts, clean })}
src/features/settings/SettingsPanel.tsx:437:            onChange={(flawed) => setAliasDrafts({ ...aliasDrafts, flawed })}
src/features/settings/SettingsPanel.tsx:442:            onChange={(failed) => setAliasDrafts({ ...aliasDrafts, failed })}
src/features/settings/SettingsPanel.tsx:453:              onChange={(event) =>
src/features/settings/SettingsPanel.tsx:476:              onChange={(event) =>
src/features/settings/SettingsPanel.tsx:529:        onChange={(event) => onChange(Number(event.target.value))}
src/features/settings/SettingsPanel.tsx:551:        onChange={(event) => onChange(event.target.value)}
src/features/settings/SettingsPanel.tsx:615:          onChange={(event) => setKey(event.target.value)}
src/features/settings/SettingsPanel.tsx:623:          onClick={() => void save()}
src/features/settings/SettingsPanel.tsx:631:          onClick={() => void clear()}
src/features/today/TodayWorkspace.tsx:111:          <button type="button" onClick={() => void load()}>Try again</button>
src/features/today/TodayWorkspace.tsx:132:                  onClick={() => onOpenPiece({ piece_id: recent.piece_id, title: recent.title })}
src/features/today/TodayWorkspace.tsx:187:            onStartSession={(reviewed) => plan.startPlan(reviewed)}
src/features/today/TodayWorkspace.tsx:234:                      onClick={() => void plan.startItem(item.sequence)}
src/features/today/TodayWorkspace.tsx:255:      <details className="today-retention ck-reveal-item" onToggle={(event) => setRetentionOpen(event.currentTarget.open)}>
src/features/tutorials/TutorialPanel.tsx:172:        <button type="button" onClick={() => { setLoading(true); void load(); }}>Scan videos</button>
src/features/tutorials/TutorialPanel.tsx:183:          <select value={activeVideo?.id ?? ""} onChange={(event) => { setActiveVideoId(Number(event.target.value)); setActiveClip(null); }}>
src/features/tutorials/TutorialPanel.tsx:188:          <button type="button" onClick={() => { setLoading(true); void load(); }}>Rescan</button>
src/features/tutorials/TutorialPanel.tsx:189:          <button type="button" onClick={() => activeVideo && invoke("tutorial_video_reveal", { id: activeVideo.id }).catch((reason) => setError(errorMessage(reason)))}>Show file</button>
src/features/tutorials/TutorialPanel.tsx:190:          <button type="button" onClick={() => activeVideo && play(activeVideo, null)}>Full video</button>
src/features/tutorials/TutorialPanel.tsx:200:          onLoadStart={() => setVideoError(null)}
src/features/tutorials/TutorialPanel.tsx:202:          onError={() => setVideoError("This video file could not be opened. Restore it inside the piece’s tutorials folder, then Rescan.")}
src/features/tutorials/TutorialPanel.tsx:203:          onTimeUpdate={() => {
src/features/tutorials/TutorialPanel.tsx:217:              onConfirm={() => forgetBrokenVideo(activeVideo.id)}
src/features/tutorials/TutorialPanel.tsx:233:              <button type="button" className="tutorial-play" onClick={() => play(video, clip)}>
src/features/tutorials/TutorialPanel.tsx:239:                <button type="button" onClick={() => beginEdit(clip)}>
src/features/tutorials/TutorialPanel.tsx:244:                <ConfirmDelete label={`Remove “${clip.title}” from this section? The video file stays available.`} onConfirm={() => remove(clip.id)}>
src/features/tutorials/TutorialPanel.tsx:254:        <form className="tutorial-map-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
src/features/tutorials/TutorialPanel.tsx:260:          <label><span className="ck-label">Video</span><select value={editing.video_id} onChange={(event) => setEditing({ ...editing, video_id: Number(event.target.value) })}>{videos.map((video) => <option value={video.id} key={video.id}>{video.title}</option>)}</select></label>
src/features/tutorials/TutorialPanel.tsx:261:          <label><span className="ck-label">Chapter title</span><input value={editing.title} maxLength={120} onChange={(event) => setEditing({ ...editing, title: event.target.value })} /></label>
src/features/tutorials/TutorialPanel.tsx:263:            <label><span className="ck-label">Start (seconds)</span><input type="number" min="0" step="any" value={editing.start_seconds} onChange={(event) => setEditing({ ...editing, start_seconds: Number(event.target.value) })} /></label>
src/features/tutorials/TutorialPanel.tsx:264:            <button type="button" onClick={() => setEditing({ ...editing, start_seconds: videoRef.current?.currentTime ?? 0 })}>Use current</button>
src/features/tutorials/TutorialPanel.tsx:265:            <label><span className="ck-label">End (seconds)</span><input type="number" min="0.1" step="any" value={editing.end_seconds} onChange={(event) => setEditing({ ...editing, end_seconds: Number(event.target.value) })} /></label>
src/features/tutorials/TutorialPanel.tsx:266:            <button type="button" onClick={() => setEditing({ ...editing, end_seconds: videoRef.current?.currentTime ?? editing.end_seconds })}>Use current</button>
src/features/tutorials/TutorialPanel.tsx:268:          <label><span className="ck-label">Why this clip helps</span><textarea rows={2} value={editing.notes ?? ""} onChange={(event) => setEditing({ ...editing, notes: event.target.value || null })} /></label>
src/features/tutorials/TutorialPanel.tsx:269:          <div className="tutorial-map-actions"><button type="submit" disabled={saving}>{saving ? "Saving…" : "Save mapping"}</button><button type="button" onClick={() => setEditing(null)}>Cancel</button></div>
src/features/universe/UniverseWorkspace.tsx:335:        <button type="button" className="universe-practice-button" onClick={() => onOpenPractice(null)}>
src/features/universe/UniverseWorkspace.tsx:343:          {!snapshot && <button type="button" onClick={() => void load()}>Try again</button>}
src/features/universe/UniverseWorkspace.tsx:357:          <button type="button" className="universe-practice-button" onClick={() => onOpenPractice(null)}>
src/features/universe/UniverseWorkspace.tsx:387:                  <button type="button" aria-label="Zoom out" onClick={() => zoomAt(0.82)}>−</button>
src/features/universe/UniverseWorkspace.tsx:389:                  <button type="button" aria-label="Zoom in" onClick={() => zoomAt(1.22)}>+</button>
src/features/universe/UniverseWorkspace.tsx:446:                            ref={(element) => {
src/features/universe/UniverseWorkspace.tsx:458:                            onFocus={() => setSelectedId(piece.piece_id)}
src/features/universe/UniverseWorkspace.tsx:459:                            onClick={() => setSelectedId(piece.piece_id)}
src/features/universe/UniverseWorkspace.tsx:460:                            onDoubleClick={() => openPiece(piece)}
src/features/universe/UniverseWorkspace.tsx:461:                            onKeyDown={(event) => {
src/features/universe/UniverseWorkspace.tsx:486:                              style={{ stroke: palette.signal }}
src/features/universe/UniverseWorkspace.tsx:496:                              style={{ stroke: palette.core }}
src/features/universe/UniverseWorkspace.tsx:506:                              style={{ stroke: palette.body }}
src/features/universe/UniverseWorkspace.tsx:516:                              style={{ stroke: palette.core }}
src/features/universe/UniverseWorkspace.tsx:549:                                  {target.revisited && <circle className="universe-target-revisit" cx={targetX} cy={targetY} r="5.7" style={{ stroke: palette.core }} />}
src/features/universe/UniverseWorkspace.tsx:550:                                  {(target.mastery_contracts_completed ?? 0) > 0 && <circle className="universe-target-mastery" cx={targetX} cy={targetY} r="7.6" style={{ stroke: palette.signal }} />}
src/features/universe/UniverseWorkspace.tsx:551:                                  {target.recovered && <circle className="universe-target-recovery" cx={targetX} cy={targetY} r="9.1" style={{ stroke: palette.core }} />}
src/features/universe/UniverseWorkspace.tsx:583:                    onOpen={() => openPiece(selectedPiece)}
src/features/universe/UniverseWorkspace.tsx:604:                  onInspect={() => setSelectedId(piece.piece_id)}
src/features/universe/UniverseWorkspace.tsx:605:                  onOpen={() => openPiece(piece)}
src/features/universe/UniverseWorkspace.tsx:659:        <span className="universe-inspector-swatch" style={{ background: palette.body }} aria-hidden="true" />
src/features/voice/ActionDraftCard.test.tsx:21:    render(<ActionDraftCard draft={readyDraft()} onConfirm={confirm} onCancel={() => undefined} />);
src/features/voice/ActionDraftCard.test.tsx:41:    render(<ActionDraftCard draft={draft} onConfirm={confirm} onCancel={() => undefined} />);
src/features/voice/ActionDraftCard.test.tsx:69:    render(<ActionDraftCard draft={action} onConfirm={confirm} onCancel={() => undefined} />);
src/features/voice/ActionDraftCard.test.tsx:87:        onCancel={() => undefined}
src/features/voice/ActionDraftCard.tsx:103:            onClick={() => void onConfirm(draft)}
src/features/voice/ActionDraftCard.tsx:188:              onChange={(event) => update((current) => ({
src/features/voice/ActionDraftCard.tsx:201:              onChange={(event) => update((current) => ({
src/features/voice/ActionDraftCard.tsx:219:              onChange={(event) => updateContract({ start_bpm: optionalInteger(event.target.value) })}
src/features/voice/ActionDraftCard.tsx:230:              onChange={(event) => updateContract({ target_bpm: optionalInteger(event.target.value) })}
src/features/voice/ActionDraftCard.tsx:243:            onChange={(event) => updateContract({ planned_attempts: optionalInteger(event.target.value) })}
src/features/voice/ActionDraftCard.tsx:255:            onChange={(event) => updateContract({ required_clean_streak: optionalInteger(event.target.value) ?? 0 })}
src/features/voice/ActionDraftCard.tsx:264:            onChange={(event) => updateContract({
src/features/voice/ActionDraftCard.tsx:281:            onChange={(event) => updateContract({ method: event.target.value || null })}
src/features/voice/ActionDraftCard.tsx:305:          onClick={() => void onConfirm(value)}
src/features/voice/VoiceToast.test.tsx:109:        deliveryDisposition={{
src/features/voice/VoiceToast.tsx:135:            onClick={() => setDismissedGuidance(downGuidance)}
src/shell/Shell.tsx:354:                ref={(node) => {
src/shell/Shell.tsx:364:                style={{ ["--enter-index" as string]: index }}
src/shell/Shell.tsx:365:                onClick={() => setView(workspace.id)}
src/shell/Shell.tsx:366:                onKeyDown={(event) => onTabKeyDown(event, workspace.id)}
src/shell/Shell.tsx:388:          onClick={() =>
src/shell/Shell.tsx:412:                onOpenAtlas={() => setView("score")}
src/shell/Shell.tsx:413:                onOpenCalendar={() => setView("ledger")}
src/shell/Shell.tsx:452:            onConfirm={(draft: ActionDraft) => {
src/shell/Shell.tsx:476:          style={{
src/ui/Dialog.tsx:38:        onClick={(event) => event.stopPropagation()}
```
