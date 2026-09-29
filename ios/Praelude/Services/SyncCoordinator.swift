import Foundation
import Observation
import Network

/// Wires `SyncEngine` (Core, transport-agnostic) to `PracticeStore` and `AuthManager` for every table
/// registered in `public.sync_tables`/`public.append_only_tables` this app has a schema3 Core model
/// for (`SyncDTO.swift`/`SyncDTO2.swift`) — see `supabase/(C) Sync Protocol.md` §1 for the full
/// allow-list, and `SyncDTO2.swift`'s own header for the two tables deliberately left unwired
/// (`practice_goals`/`practice_routines` — no `updatedAt`/`deletedAt` on the Core side yet, and a
/// hard-delete-vs-tombstone gap in `PracticeStore` itself).
///
/// Most tables push explicitly — a caller invokes `push*` right after the matching `PracticeStore`
/// mutation, e.g. `AccountView.swift`/`ProfileEditView.swift` for profile/instrument edits. The
/// practice-set/rep path (`sets`/`attempts`) is the one exception: `PracticeStore`'s own mutation
/// methods (`startSet`/`record`/`pause`/`resume`/`endSet`/`undo`) are called directly from several
/// Views and from `PracticeRuntime`, not funneled through one call site, so — mirroring
/// `PracticeRuntime.syncRecording()`'s own documented reasoning for the exact same problem — this is
/// wired reactively instead, from the app root's `.onChange(of: store.activeSet?...)`/
/// `.onChange(of: store.state.history.count)` (`PraeludeApp.swift`), which call `syncActiveSetProgress()`/
/// `syncMostRecentFinishedSet()` below. `syncAll()` covers the full pull direction and draining
/// unconditionally.
@MainActor @Observable
public final class SyncCoordinator {
    private let engine: SyncEngine
    private let auth: AuthManager
    private let store: PracticeStore
    private var pathMonitor: NWPathMonitor?
    private var wasSatisfied = true
    /// Set once from `PraeludeApp.init` (`setStorage`). `nil` in every test/preview construction of
    /// this type, which is fine — score/recording file transfer is additive on top of the metadata
    /// sync this whole file otherwise does, never required for it.
    private var storage: ScoreAndRecordingStorage?
    public func setStorage(_ storage: ScoreAndRecordingStorage) { self.storage = storage }

    public var status: SyncEngine.Status { engine.status }
    public var pendingCount: Int { engine.pendingCount }
    /// The spec §4c backend-only profile fields (`ProfileSyncRow`'s extras) this device last pulled,
    /// for `ProfileEditView` to read/edit without clobbering them on the next push.
    public var profileBackendFields: ProfileBackendFields { engine.state.profileBackendFields }
    public func setProfileBackendFields(_ fields: ProfileBackendFields) { try? engine.updateProfileBackendFields(fields) }

    /// Wired to `AuthManager.onSignedOut` in `PraeludeApp.init` (ordinary sign-out and a successful
    /// account deletion both end there). Clears this device's outbound queue and pull cursors so
    /// nothing queued for account A is ever sent under account B's session, and so a signed-back-in
    /// account pulls fresh rather than trusting a cursor left over from whoever was signed in last.
    public func resetLocalAccountState() {
        try? engine.resetLocalAccountState()
        pushedAttemptCounts.removeAll(); pushedUndoIDs.removeAll()
        lastKnownSetUpdatedAt.removeAll(); lastKnownSessionUpdatedAt.removeAll()
    }

    /// The tables this coordinator pulls and LWW-merges, in order. Parents before children matters
    /// only in that a later row should not transiently point at a not-yet-local parent (see
    /// `PracticeStore.validate`'s own reference checks, which are a local sanity check, not a hard
    /// FK, for everything except `attempts.set_id` — the one real FK reachable through these RPCs, so
    /// `sets` must land before `attempts` here for the same reason `SyncCoordinator`'s *push* side
    /// pushes a set before any of its attempts: see `syncSet(_:)` below). `cursorField` is
    /// `"updated_at"` for every `sync_tables` member; an `append_only_tables` member has none, so it
    /// passes its own event-date column instead (`SyncEngine.pull`'s own doc comment).
    private static let pullTables: [(table: String, cursorField: String)] = [
        ("instruments", "updated_at"), ("pieces", "updated_at"), ("passages", "updated_at"), ("ink_strokes", "updated_at"),
        ("tags", "updated_at"), ("folders", "updated_at"), ("setlists", "updated_at"), ("bookmarks", "updated_at"),
        ("page_edits", "updated_at"), ("score_links", "updated_at"), ("annotations", "updated_at"),
        ("warmup_exercises", "updated_at"), ("audio_recordings", "updated_at"), ("notebook_entries", "updated_at"),
        ("practice_sessions", "updated_at"), ("sets", "updated_at"),
        ("rule_settings", "updated_at"), ("rewards_state", "updated_at"), ("profiles", "updated_at"),
        ("attempts", "date"), ("rule_events", "fired_at"), ("reward_ledger", "date"), ("badges", "earned_at"),
        ("milestone_events", "date"), ("cold_grades", "date"), ("break_point_taps", "date")
    ]

    /// In-memory only (never persisted — see `resetLocalAccountState`'s own clearing of these, and
    /// each field's own doc comment below): every value here is safely re-derivable by re-pushing/
    /// re-comparing, so losing it across a relaunch costs a little redundant, idempotent network
    /// traffic, never correctness.
    ///
    /// How many of a set's attempts have already been enqueued this launch, keyed by set id — lets
    /// `syncSet(_:)` push only the newly-recorded tail of `attempts` each time it is called, instead
    /// of re-enqueueing the whole set's history on every single rep (still correct either way,
    /// `sync_append`'s `on conflict (id) do nothing` makes a re-push a harmless no-op — this is purely
    /// so the on-device outbound queue and `pendingCount` do not balloon quadratically over a long set).
    private var pushedAttemptCounts: [UUID: Int] = [:]
    /// Attempt ids this device has already enqueued an undo for, so `syncSet(_:)` does not
    /// re-`enqueueUndoAttempt` every time it re-scans a set that has an old undo in it.
    private var pushedUndoIDs: Set<UUID> = []
    /// `sets` is the one pulled table with no stored `updatedAt` on the Core side at all (`ActiveSet`
    /// has none — see `SyncDTO2.swift`'s `SetSyncRow` doc comment), so there is no local field to
    /// compare a pulled row's `updated_at` against the way every other table's `shouldApply` check
    /// does. This tracks "the newest `updated_at` this device has pushed or accepted for this set id"
    /// instead, purely in memory: absent (a set never pushed or pulled before on this device) always
    /// applies, exactly like every other table's `shouldApply(_:currentUpdatedAt: nil)` case.
    private var lastKnownSetUpdatedAt: [UUID: Date] = [:]
    /// Same reasoning as `lastKnownSetUpdatedAt`, for `practice_sessions` — `PracticeSession`
    /// (`Models.swift`) has no stored `updatedAt` either.
    private var lastKnownSessionUpdatedAt: [UUID: Date] = [:]

    public init(engine: SyncEngine, auth: AuthManager, store: PracticeStore) {
        self.engine = engine; self.auth = auth; self.store = store
    }

    /// Call once from `PraeludeApp.init`/`onChange(of: scenePhase)`. Starts `NWPathMonitor` so a
    /// regained connection retries automatically (spec §4d: "background-safe: sync on launch/
    /// foreground/network regain") rather than only on the next manual foreground.
    public func startObservingNetwork() {
        guard pathMonitor == nil else { return }
        let monitor = NWPathMonitor()
        monitor.pathUpdateHandler = { [weak self] path in
            Task { @MainActor in
                guard let self else { return }
                let satisfied = path.status == .satisfied
                if satisfied, !self.wasSatisfied { await self.syncAll() }
                self.wasSatisfied = satisfied
            }
        }
        monitor.start(queue: .main)
        pathMonitor = monitor
    }

    /// Drains the outbound queue, then pulls every table this coordinator wires, merging each row
    /// into `PracticeStore` by whole-record LWW (Schema3.md's own granularity — a pulled row already
    /// won the server's own LWW comparison against whatever this device last pushed for it; the only
    /// remaining question is whether this device has an even-newer local edit still ahead of it in
    /// the queue, which `LastWriteWins.shouldApplyPulled` answers per record). No-ops in guest mode.
    public func syncAll() async {
        guard case .signedIn = auth.state else { return }
        await engine.drain(applyPulledRow: applyAdoptedRow)
        for entry in Self.pullTables {
            try? await engine.pull(table: entry.table, cursorField: entry.cursorField) { [weak self] row in
                self?.applyPulledRow(table: entry.table, row: row)
            }
        }
    }

    // MARK: Push — the original seven tables (unchanged surface)

    public func pushInstrument(_ instrument: Instrument) { enqueueUpsert(table: "instruments", encoding: InstrumentSyncRow(instrument)) }
    public func pushPiece(_ piece: Piece) { enqueueUpsert(table: "pieces", encoding: PieceSyncRow(piece)) }
    public func pushPassage(_ passage: Passage) { enqueueUpsert(table: "passages", encoding: PassageSyncRow(passage)) }
    public func pushInkStroke(_ stroke: InkStroke) { if let row = InkStrokeSyncRow(stroke) { enqueueUpsert(table: "ink_strokes", encoding: row) } }
    public func pushRuleSettings() { enqueueUpsert(table: "rule_settings", encoding: RuleSettingsSyncRow(store.state.ruleSettings)) }
    public func pushRewardsState() { enqueueUpsert(table: "rewards_state", encoding: RewardsStateSyncRow(store.state.rewardsState)) }
    public func pushProfile() {
        enqueueUpsert(table: "profiles", encoding: ProfileSyncRow(store.state.profile, extras: engine.state.profileBackendFields))
    }
    public func pushLastPage(pieceID: UUID, lastPage: Int) { try? engine.enqueueLastPage(pieceID: pieceID, lastPage: lastPage) }

    // MARK: Push — library organization, warmups, recordings, notebook (spec §7/§12/§13/§15)

    public func pushTag(_ tag: Tag) { enqueueUpsert(table: "tags", encoding: TagSyncRow(tag)) }
    public func pushFolder(_ folder: Folder) { enqueueUpsert(table: "folders", encoding: FolderSyncRow(folder)) }
    public func pushSetlist(_ setlist: Setlist) { enqueueUpsert(table: "setlists", encoding: SetlistSyncRow(setlist)) }
    public func pushBookmark(_ bookmark: Bookmark) { enqueueUpsert(table: "bookmarks", encoding: BookmarkSyncRow(bookmark)) }
    public func pushPageEdit(_ edit: PageEdit) { enqueueUpsert(table: "page_edits", encoding: PageEditSyncRow(edit)) }
    public func pushPageEdits(_ edits: [PageEdit]) { for edit in edits { pushPageEdit(edit) } }
    public func pushScoreLink(_ link: ScoreLink) { enqueueUpsert(table: "score_links", encoding: ScoreLinkSyncRow(link)) }
    public func pushTextAnnotation(_ annotation: TextBoxAnnotation) { enqueueUpsert(table: "annotations", encoding: AnnotationSyncRow(annotation)) }
    public func pushStampAnnotation(_ stamp: StampAnnotation) { enqueueUpsert(table: "annotations", encoding: AnnotationSyncRow(stamp)) }
    public func pushWarmupExercise(_ exercise: WarmupExercise) { enqueueUpsert(table: "warmup_exercises", encoding: WarmupExerciseSyncRow(exercise)) }
    public func pushWarmupExercises(_ exercises: [WarmupExercise]) { for exercise in exercises { pushWarmupExercise(exercise) } }
    public func pushRecording(_ recording: AudioRecording) { enqueueUpsert(table: "audio_recordings", encoding: AudioRecordingSyncRow(recording)) }
    public func pushNotebookEntry(_ entry: NotebookEntry) { enqueueUpsert(table: "notebook_entries", encoding: NotebookEntrySyncRow(entry)) }

    /// Call from `.onChange(of: store.state.recordings.count)` (`PraeludeApp.swift`) — no existing
    /// View call site creates an `AudioRecording` directly (only `RecordingService.finishTake`,
    /// driven reactively from `PracticeStore.activeSet`, not from a View with `SyncCoordinator` in
    /// its environment), so this mirrors `syncMostRecentFinishedSet`'s own reactive-hook reasoning:
    /// pushes the newest recording's metadata and uploads its file to the `recordings` bucket
    /// (spec §4a) — a no-op past the metadata push when `storage` was never configured (`nil`) or
    /// the account is signed out.
    public func syncNewestRecording() {
        guard case .signedIn = auth.state, let recording = store.state.recordings.last else { return }
        pushRecording(recording)
        guard let storage, recording.deletedAt == nil else { return }
        let localURL = store.directory.appendingPathComponent("Recordings", isDirectory: true).appendingPathComponent(recording.fileName)
        Task { await storage.uploadRecording(recordingID: recording.id, fileName: recording.fileName, localURL: localURL) }
    }

    // MARK: Push — rules, rewards event logs (append-only; spec §11/§14)

    public func pushRuleEvent(_ event: RuleEvent) { enqueueAppend(table: "rule_events", encoding: RuleEventSyncRow(event)) }
    public func pushRewardLedgerEntry(_ entry: RewardLedgerEntry) { enqueueAppend(table: "reward_ledger", encoding: RewardLedgerEntrySyncRow(entry)) }
    public func pushBadge(_ badge: Badge) { enqueueAppend(table: "badges", encoding: BadgeSyncRow(badge)) }
    public func pushMilestoneEvent(_ event: MilestoneEvent) { enqueueAppend(table: "milestone_events", encoding: MilestoneEventSyncRow(event)) }
    public func pushColdGrade(_ record: ColdGradeRecord) { enqueueAppend(table: "cold_grades", encoding: ColdGradeRecordSyncRow(record)) }
    public func pushBreakPointTap(_ tap: BreakPointTap) { enqueueAppend(table: "break_point_taps", encoding: BreakPointTapSyncRow(tap)) }

    // MARK: Push — practice sets and the append-only rep log (spec §9/§10)
    //
    // Call `syncActiveSetProgress()`/`syncMostRecentFinishedSet()` reactively (see this type's own
    // doc comment) rather than `pushSet`/`pushAttempt` directly from a View — they are `private`
    // below precisely so every attempt push is reachable only through the path that also pushes its
    // set first in the same call, which is the actual ordering contract (`attempts.set_id references
    // public.sets(id)`, spec §4d/`(C) Sync Protocol.md`).

    /// Call from `.onChange(of: store.activeSet?.id)`/`.onChange(of: store.activeSet?.status)`/
    /// `.onChange(of: store.activeSet?.attempts.count)` (and the undone-count variant — see
    /// `PraeludeApp.swift`). Covers `startSet`/`pause`/`resume`/tempo-or-stage progress/`record`/`undo`
    /// in one reactive hook, the same "least invasive integration" `PracticeRuntime.syncRecording()`
    /// already uses for this exact class of problem.
    public func syncActiveSetProgress() { syncSet(store.activeSet) }
    /// Call from `.onChange(of: store.state.history.count)`: the set that was just active a moment
    /// ago (`endSet`/`endSession`) is now the newest entry in `history` and needs one final push (its
    /// closing `status`/`endedAt`/`activeSeconds`) plus any of its attempts this device had not
    /// caught up on yet (there is no gap in practice — `syncActiveSetProgress` already ran on every
    /// attempt while the set was still active — but this stays correct even if a future call site
    /// records an attempt and ends the set in the same synchronous `PracticeStore` transaction).
    public func syncMostRecentFinishedSet() { syncSet(store.state.history.last) }

    private func syncSet(_ set: ActiveSet?) {
        guard case .signedIn = auth.state, let set else { return }
        // sets.session_id is a hard FK (references public.practice_sessions(id)) exactly like
        // attempts.set_id -> sets(id) — push the session first, every time, the same "cheap and
        // idempotent, so just always do it" reasoning pushSet/pushAttempt already use.
        if let session = store.state.sessions.first(where: { $0.id == set.sessionID }) { pushSession(session) }
        pushSet(set)
        // Unconditional on `undoneAt`, deliberately: this loop is keyed by *position*
        // (`pushedAttemptCounts`, how many of `set.attempts` have been enqueued), not by undo state,
        // so even an attempt that gets recorded and undone between two observed states of this hook
        // (SwiftUI coalesced both transitions into one `onChange`) still has its base `sync_append`
        // enqueued here, strictly before the matching `sync_undo_attempt` the loop below enqueues for
        // it — `sync_undo_attempt` no-ops server-side if the row it targets was never inserted, which
        // would silently drop the undo forever if the ordering ran the other way.
        let alreadyPushed = pushedAttemptCounts[set.id] ?? 0
        if set.attempts.count > alreadyPushed {
            for attempt in set.attempts[alreadyPushed...] { pushAttempt(attempt, setID: set.id) }
            pushedAttemptCounts[set.id] = set.attempts.count
        }
        for attempt in set.attempts where attempt.undoneAt != nil && !pushedUndoIDs.contains(attempt.id) {
            pushedUndoIDs.insert(attempt.id)
            try? engine.enqueueUndoAttempt(attemptID: attempt.id)
            Task { await syncAll() }
        }
    }
    private func pushSession(_ session: PracticeSession) {
        guard case .signedIn = auth.state else { return }
        let dto = PracticeSessionSyncRow(session)
        guard let object = try? SyncJSON(encoding: dto).objectValue else { return }
        lastKnownSessionUpdatedAt[session.id] = dto.updated_at
        try? engine.enqueueUpsert(table: "practice_sessions", row: object)
        Task { await syncAll() }
    }
    private func pushSet(_ set: ActiveSet) {
        guard case .signedIn = auth.state else { return }
        let dto = SetSyncRow(set)
        guard let object = try? SyncJSON(encoding: dto).objectValue else { return }
        lastKnownSetUpdatedAt[set.id] = dto.updated_at
        try? engine.enqueueUpsert(table: "sets", row: object)
        Task { await syncAll() }
    }
    private func pushAttempt(_ attempt: Attempt, setID: UUID) {
        guard case .signedIn = auth.state, let object = try? SyncJSON(encoding: AttemptSyncRow(attempt, setID: setID)).objectValue else { return }
        try? engine.enqueueAppend(table: "attempts", row: object)
        Task { await syncAll() }
    }

    private func enqueueUpsert<T: Encodable>(table: String, encoding value: T) {
        guard case .signedIn = auth.state, let object = try? SyncJSON(encoding: value).objectValue else { return }
        try? engine.enqueueUpsert(table: table, row: object)
        Task { await syncAll() }
    }
    private func enqueueAppend<T: Encodable>(table: String, encoding value: T) {
        guard case .signedIn = auth.state, let object = try? SyncJSON(encoding: value).objectValue else { return }
        try? engine.enqueueAppend(table: table, row: object)
        Task { await syncAll() }
    }

    // MARK: Applying a pulled (or "you lost, adopt this" rejected-push) row back into PracticeStore

    private func applyAdoptedRow(table: String, row: [String: SyncJSON]) { applyPulledRow(table: table, row: row) }

    private func applyPulledRow(table: String, row: [String: SyncJSON]) {
        let wrapped = SyncJSON.object(row)
        switch table {
        case "instruments":
            guard let dto = try? wrapped.decoded(as: InstrumentSyncRow.self), let value = dto.coreValue else { return }
            if shouldApply(value.updatedAt, currentUpdatedAt: store.state.instruments.first { $0.id == value.id }?.updatedAt) {
                try? store.applySyncedInstrument(value)
            }
        case "pieces":
            // Fixed 20260926 pass: was `store.updatePiece(value)`, which silently fails (swallowed by
            // `try?`) for a piece id this device has never seen before — see `applySyncedPiece`'s own
            // doc comment. That bug predates this pass; every table this pass newly wires already
            // upserts correctly (`applySynced*` throughout `PracticeStore.swift`).
            guard let dto = try? wrapped.decoded(as: PieceSyncRow.self), let value = dto.coreValue else { return }
            if shouldApply(value.updatedAt, currentUpdatedAt: store.state.pieces.first { $0.id == value.id }?.updatedAt) {
                try? store.applySyncedPiece(value)
                downloadScoreIfNeeded(pieceID: value.id, fileName: value.pdfFileName)
            }
        case "passages":
            guard let dto = try? wrapped.decoded(as: PassageSyncRow.self), let value = dto.coreValue else { return }
            if shouldApply(value.updatedAt, currentUpdatedAt: store.state.passages.first { $0.id == value.id }?.updatedAt) {
                try? store.savePassage(value)
            }
        case "ink_strokes":
            guard let dto = try? wrapped.decoded(as: InkStrokeSyncRow.self), let value = dto.coreValue else { return }
            let current = store.state.inkStrokes.first { $0.id == value.id }
            if shouldApply(value.updatedAt, currentUpdatedAt: current?.updatedAt) { try? store.applySyncedInkStroke(value) }
        case "tags":
            guard let dto = try? wrapped.decoded(as: TagSyncRow.self) else { return }
            let value = dto.coreValue
            if shouldApply(value.updatedAt, currentUpdatedAt: store.state.tags.first { $0.id == value.id }?.updatedAt) { try? store.applySyncedTag(value) }
        case "folders":
            guard let dto = try? wrapped.decoded(as: FolderSyncRow.self) else { return }
            let value = dto.coreValue
            if shouldApply(value.updatedAt, currentUpdatedAt: store.state.folders.first { $0.id == value.id }?.updatedAt) { try? store.applySyncedFolder(value) }
        case "setlists":
            guard let dto = try? wrapped.decoded(as: SetlistSyncRow.self) else { return }
            let value = dto.coreValue
            if shouldApply(value.updatedAt, currentUpdatedAt: store.state.setlists.first { $0.id == value.id }?.updatedAt) { try? store.applySyncedSetlist(value) }
        case "bookmarks":
            guard let dto = try? wrapped.decoded(as: BookmarkSyncRow.self) else { return }
            let value = dto.coreValue
            if shouldApply(value.updatedAt, currentUpdatedAt: store.state.bookmarks.first { $0.id == value.id }?.updatedAt) { try? store.applySyncedBookmark(value) }
        case "page_edits":
            guard let dto = try? wrapped.decoded(as: PageEditSyncRow.self), let value = dto.coreValue else { return }
            if shouldApply(value.updatedAt, currentUpdatedAt: store.state.pageEdits.first { $0.id == value.id }?.updatedAt) { try? store.applySyncedPageEdit(value) }
        case "score_links":
            guard let dto = try? wrapped.decoded(as: ScoreLinkSyncRow.self) else { return }
            let value = dto.coreValue
            if shouldApply(value.updatedAt, currentUpdatedAt: store.state.scoreLinks.first { $0.id == value.id }?.updatedAt) { try? store.applySyncedScoreLink(value) }
        case "annotations":
            guard let dto = try? wrapped.decoded(as: AnnotationSyncRow.self) else { return }
            if let value = dto.textValue {
                if shouldApply(value.updatedAt, currentUpdatedAt: store.state.textAnnotations.first { $0.id == value.id }?.updatedAt) {
                    try? store.applySyncedTextAnnotation(value)
                }
            } else if let value = dto.stampValue {
                if shouldApply(value.updatedAt, currentUpdatedAt: store.state.stampAnnotations.first { $0.id == value.id }?.updatedAt) {
                    try? store.applySyncedStampAnnotation(value)
                }
            }
        case "warmup_exercises":
            guard let dto = try? wrapped.decoded(as: WarmupExerciseSyncRow.self), let value = dto.coreValue else { return }
            if shouldApply(value.updatedAt, currentUpdatedAt: store.state.warmupExercises.first { $0.id == value.id }?.updatedAt) {
                try? store.applySyncedWarmupExercise(value)
            }
        case "audio_recordings":
            guard let dto = try? wrapped.decoded(as: AudioRecordingSyncRow.self) else { return }
            let value = dto.coreValue
            if shouldApply(value.updatedAt, currentUpdatedAt: store.state.recordings.first { $0.id == value.id }?.updatedAt) {
                try? store.applySyncedRecording(value)
                downloadRecordingIfNeeded(recordingID: value.id, fileName: value.fileName)
            }
        case "notebook_entries":
            guard let dto = try? wrapped.decoded(as: NotebookEntrySyncRow.self), let value = dto.coreValue else { return }
            if shouldApply(value.updatedAt, currentUpdatedAt: store.state.notebookEntries.first { $0.id == value.id }?.updatedAt) {
                try? store.applySyncedNotebookEntry(value)
            }
        case "practice_sessions":
            guard let dto = try? wrapped.decoded(as: PracticeSessionSyncRow.self) else { return }
            let value = dto.coreValue
            if shouldApply(dto.updated_at, currentUpdatedAt: lastKnownSessionUpdatedAt[value.id]) {
                lastKnownSessionUpdatedAt[value.id] = dto.updated_at
                try? store.applySyncedSession(value)
            }
        case "sets":
            guard let dto = try? wrapped.decoded(as: SetSyncRow.self), let value = dto.coreValue else { return }
            if shouldApply(dto.updated_at, currentUpdatedAt: lastKnownSetUpdatedAt[value.id]) {
                lastKnownSetUpdatedAt[value.id] = dto.updated_at
                try? store.applySyncedSet(value)
            }
        case "attempts":
            guard let setIDString = row["set_id"]?.stringValue, let setID = UUID(uuidString: setIDString),
                  let dto = try? wrapped.decoded(as: AttemptSyncRow.self), let value = dto.coreValue else { return }
            try? store.applySyncedAttempt(value, setID: setID)
        case "rule_settings":
            guard let dto = try? wrapped.decoded(as: RuleSettingsSyncRow.self) else { return }
            let value = dto.coreValue
            if shouldApply(value.updatedAt, currentUpdatedAt: store.state.ruleSettings.updatedAt) { try? store.applySyncedRuleSettings(value) }
        case "rewards_state":
            guard let dto = try? wrapped.decoded(as: RewardsStateSyncRow.self) else { return }
            let value = dto.coreValue
            if shouldApply(value.updatedAt, currentUpdatedAt: store.state.rewardsState.updatedAt) { try? store.applySyncedRewardsState(value) }
        case "profiles":
            guard let dto = try? wrapped.decoded(as: ProfileSyncRow.self) else { return }
            let value = dto.coreProfile(ownerID: store.state.profile.ownerID)
            if shouldApply(value.updatedAt, currentUpdatedAt: store.state.profile.updatedAt) {
                try? store.applySyncedProfile(value)
                try? engine.updateProfileBackendFields(dto.backendFields)
            }
        case "rule_events":
            guard let dto = try? wrapped.decoded(as: RuleEventSyncRow.self), let value = dto.coreValue else { return }
            try? store.applySyncedRuleEvent(value)
        case "reward_ledger":
            guard let dto = try? wrapped.decoded(as: RewardLedgerEntrySyncRow.self) else { return }
            try? store.applySyncedRewardLedgerEntry(dto.coreValue)
        case "badges":
            guard let dto = try? wrapped.decoded(as: BadgeSyncRow.self) else { return }
            try? store.applySyncedBadge(dto.coreValue)
        case "milestone_events":
            guard let dto = try? wrapped.decoded(as: MilestoneEventSyncRow.self) else { return }
            try? store.applySyncedMilestoneEvent(dto.coreValue)
        case "cold_grades":
            guard let dto = try? wrapped.decoded(as: ColdGradeRecordSyncRow.self), let value = dto.coreValue else { return }
            try? store.applySyncedColdGrade(value)
        case "break_point_taps":
            guard let dto = try? wrapped.decoded(as: BreakPointTapSyncRow.self) else { return }
            try? store.applySyncedBreakPointTap(dto.coreValue)
        default:
            break
        }
    }
    private func shouldApply(_ pulledUpdatedAt: Date, currentUpdatedAt: Date?) -> Bool {
        guard let currentUpdatedAt else { return true }
        return LastWriteWins.shouldApplyPulled(pulledUpdatedAt: pulledUpdatedAt, localUpdatedAt: currentUpdatedAt)
    }

    // MARK: Storage — download on demand (spec §4a: "download on other devices on demand")
    //
    // Mirrors `NativeLibraryFiles.scoresDirectory`/`RecordingService.recordingsDirectory` exactly
    // ("Scores"/"Recordings" under `PracticeStore.directory`) rather than importing either app-layer
    // type here (`Core`-adjacent — this file already sits in `Services`, but neither of those two
    // types is reachable from here without a larger dependency reshuffle than this pass's scope);
    // a future refactor could hoist a single shared path-builder both sides call instead.

    private func downloadScoreIfNeeded(pieceID: UUID, fileName: String?) {
        guard let storage, let fileName else { return }
        let localURL = store.directory.appendingPathComponent("Scores", isDirectory: true).appendingPathComponent(fileName)
        Task { await storage.downloadScorePDFIfNeeded(pieceID: pieceID, fileName: fileName, to: localURL) }
    }
    private func downloadRecordingIfNeeded(recordingID: UUID, fileName: String) {
        guard let storage else { return }
        let localURL = store.directory.appendingPathComponent("Recordings", isDirectory: true).appendingPathComponent(fileName)
        Task { await storage.downloadRecordingIfNeeded(recordingID: recordingID, fileName: fileName, to: localURL) }
    }
}
