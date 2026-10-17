import Foundation
import Observation
import Network

/// Wires `SyncEngine` (Core, transport-agnostic) to `PracticeStore` and `AuthManager` for every table
/// registered in `public.sync_tables`/`public.append_only_tables` this app has a schema3 Core model
/// for (`SyncDTO.swift`/`SyncDTO2.swift`) — see `supabase/(C) Sync Protocol.md` §1 for the full
/// allow-list. Goals and routines preserve their edit clocks and deleted records across devices.
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
    private var isSyncing = false
    @ObservationIgnored private var scheduledSync: Task<Void, Never>?
    @ObservationIgnored private var requestedDuringSync = false
    @ObservationIgnored private var scheduledNeedsLibrarySnapshot = false
    @ObservationIgnored private var scheduledForceSnapshot = false
    @ObservationIgnored private var lastLibrarySnapshot: (owner: UUID, revision: Int)?
    /// Debounce ordinary local edits, including score organization and annotations whose views
    /// have no explicit push hook. Never cancel an in-flight pull just because it adopted a row.
    public func scheduleLibrarySync(reconcileLibrary: Bool = true) {
        guard canSync else { return }
        scheduledNeedsLibrarySnapshot = scheduledNeedsLibrarySnapshot || reconcileLibrary
        if isSyncing { requestedDuringSync = true; return }
        scheduledSync?.cancel()
        scheduledSync = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .milliseconds(800))
            guard !Task.isCancelled, let self else { return }
            self.scheduledSync = nil
            await self.syncAll(reconcileLibrary: false, forceReconciliation: false)
        }
    }
    private var canSync: Bool {
        guard case .signedIn(let userID, _) = auth.state else { return false }
        guard store.state.profile.ownerID == userID else { engine.blockAccountMismatch(); return false }
        return !store.isReadOnly
    }
    /// Set once from `PraeludeApp.init` (`setStorage`). `nil` in every test/preview construction of
    /// this type, which is fine — score/recording file transfer is additive on top of the metadata
    /// sync this whole file otherwise does, never required for it.
    private var storage: ScoreAndRecordingStorage?
    public func setStorage(_ storage: ScoreAndRecordingStorage) { self.storage = storage }

    public var status: SyncEngine.Status {
        if isSyncing { return .syncing }
        if let storage, storage.pendingCount > 0 { return .stuck(storage.lastError ?? "Some scores or recordings are waiting to transfer. They will retry when connected.") }
        return engine.status
    }
    public var pendingCount: Int { engine.pendingCount + (storage?.pendingCount ?? 0) }
    /// The spec §4c backend-only profile fields (`ProfileSyncRow`'s extras) this device last pulled,
    /// for `ProfileEditView` to read/edit without clobbering them on the next push.
    public var profileBackendFields: ProfileBackendFields { engine.state.profileBackendFields }
    public func saveProfile(_ profile: Profile, extras: ProfileBackendFields,
                            baselineProfile: Profile? = nil, baselineExtras: ProfileBackendFields? = nil,
                            sourceID: UUID? = nil) throws {
        guard canSync, case .signedIn(let ownerID, _) = auth.state else { throw SyncError.transport("Sign into this library's account before saving its profile.") }
        do {
            try engine.bindAccount(ownerID)
            try engine.saveProfileEdit(profile, extras: extras, baselineProfile: baselineProfile ?? store.state.profile,
                                       baselineExtras: baselineExtras ?? engine.state.profileBackendFields,
                                       currentProfile: store.state.profile, sourceID: sourceID, persistProfile: store.applySyncedProfile)
            scheduleLibrarySync()
        } catch { engine.reportFailure(error); throw error }
    }

    /// Wired to `AuthManager.onSignedOut` in `PraeludeApp.init` (ordinary sign-out and a successful
    /// account deletion both end there). Clears this device's outbound queue and pull cursors so
    /// nothing queued for account A is ever sent under account B's session, and so a signed-back-in
    /// account pulls fresh rather than trusting a cursor left over from whoever was signed in last.
    public func resetLocalAccountState() {
        scheduledSync?.cancel(); scheduledSync = nil
        requestedDuringSync = false; scheduledNeedsLibrarySnapshot = false; scheduledForceSnapshot = false
        lastLibrarySnapshot = nil
        do { try engine.resetLocalAccountState(preservingProfileFor: store.state.profile.ownerID) }
        catch { engine.reportFailure(error) }
        pushedAttemptCounts.removeAll(); pushedUndoIDs.removeAll()
        lastKnownSetUpdatedAt.removeAll(); lastKnownSessionUpdatedAt.removeAll()
    }

    /// The tables this coordinator pulls and LWW-merges, in order. Parents before children matters
    /// only in that a later row should not transiently point at a not-yet-local parent (see
    /// `PracticeStore.validate`'s own reference checks, as well as server-side foreign keys.
    /// Organization must precede pieces, and the practice graph is merged atomically below.
    /// Folder/passage tables also merge atomically because UUID ordering cannot order their
    /// parent and provenance references. `cursorField` is
    /// `"updated_at"` for every `sync_tables` member; an `append_only_tables` member has none, so it
    /// passes its own event-date column instead (`SyncEngine.pull`'s own doc comment).
    static let pullTables: [(table: String, cursorField: String)] = [
        ("instruments", "updated_at"), ("tags", "updated_at"), ("folders", "updated_at"),
        ("pieces", "updated_at"), ("passages", "updated_at"), ("ink_strokes", "updated_at"),
        ("setlists", "updated_at"), ("bookmarks", "updated_at"),
        ("page_edits", "updated_at"), ("score_links", "updated_at"), ("annotations", "updated_at"),
        ("warmup_exercises", "updated_at"), ("audio_recordings", "updated_at"), ("notebook_entries", "updated_at"),
        ("practice_goals", "updated_at"), ("practice_routines", "updated_at"),
        ("practice_sessions", "updated_at"), ("sets", "updated_at"),
        ("rule_settings", "updated_at"), ("rewards_state", "updated_at"), ("profiles", "updated_at"),
        ("account_preferences", "updated_at"),
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
    public func syncAll(reconcileLibrary: Bool = true, forceReconciliation: Bool = true) async {
        guard canSync, case .signedIn(let userID, _) = auth.state else { return }
        if isSyncing {
            requestedDuringSync = true
            scheduledNeedsLibrarySnapshot = scheduledNeedsLibrarySnapshot || reconcileLibrary
            scheduledForceSnapshot = scheduledForceSnapshot || (reconcileLibrary && forceReconciliation)
            return
        }
        scheduledSync?.cancel(); scheduledSync = nil
        let needsSnapshot = reconcileLibrary || scheduledNeedsLibrarySnapshot
        let forceSnapshot = (reconcileLibrary && forceReconciliation) || scheduledForceSnapshot
        scheduledNeedsLibrarySnapshot = false; scheduledForceSnapshot = false
        var snapshotRequestSatisfied = !needsSnapshot
        isSyncing = true
        defer {
            isSyncing = false
            if requestedDuringSync {
                requestedDuringSync = false
                scheduleLibrarySync(reconcileLibrary: false)
            }
        }
        do {
            try engine.bindAccount(userID)
            try await engine.initializeProfileIfNeeded(currentProfile: { self.store.state.profile }, prepareProfile: { profile in
                try await self.prepareProfileDependencies(profile) {
                    guard self.canSync, self.store.state.profile.ownerID == userID else {
                        throw SyncError.transport("Account changed during profile sync.")
                    }
                }
            }) { profile in
                guard self.canSync else { throw SyncError.transport("Account changed during profile sync.") }
                try self.store.applySyncedProfile(profile)
            }
            guard canSync, case .signedIn(let currentUserID, _) = auth.state, currentUserID == userID else { return }
            // Incremental pushes already own a durable ordered queue entry. Full reconciliation
            // remains mandatory for unhooked library edits and explicit launch/manual sync.
            if needsSnapshot && (forceSnapshot || lastLibrarySnapshot?.owner != userID || lastLibrarySnapshot?.revision != store.state.revision) {
                let revision = store.state.revision
                let prepared = try await engine.prepareLibrarySnapshot(store.state)
                guard canSync, case .signedIn(let currentUserID, _) = auth.state,
                      currentUserID == userID else { return }
                guard store.state.revision == revision else {
                    // Never queue an older full snapshot after a newer incremental edit made
                    // during encoding. The next idle pass captures the current library.
                    scheduledNeedsLibrarySnapshot = true
                    scheduledForceSnapshot = scheduledForceSnapshot || forceSnapshot
                    requestedDuringSync = true
                    return
                }
                try engine.enqueuePreparedLibrarySnapshot(prepared)
                lastLibrarySnapshot = (userID, revision)
            }
            snapshotRequestSatisfied = true
            guard await engine.drain(applyPulledRow: applyAdoptedRow, adoptPracticeSnapshot: pullPracticeSnapshot) else { return }
            for entry in Self.pullTables {
                // Full paginated reads preserve late offline uploads and remote Undo until the
                // hosted schema exposes a server-owned ingestion/change sequence.
                if entry.table == "pieces" {
                    try await engine.pullScoreSnapshot { rows in
                        guard self.canSync else { throw SyncError.transport("Account changed during sync.") }
                        try self.applyPulledScoreSnapshot(rows)
                    }
                } else if entry.table == "page_edits" {
                    continue
                } else if entry.table == "practice_sessions" {
                    try await pullPracticeSnapshot()
                } else if entry.table == "sets" || entry.table == "attempts" {
                    continue
                } else if entry.table == "folders" || entry.table == "passages" {
                    try await engine.pullRows(table: entry.table, cursorField: entry.cursorField) { rows in
                        guard self.canSync else { throw SyncError.transport("Account changed during sync.") }
                        try self.applyPulledHierarchy(table: entry.table, rows: rows)
                    }
                } else {
                    try await engine.pull(table: entry.table, cursorField: entry.cursorField) { [weak self] row in
                        guard let self, self.canSync else { throw SyncError.transport("Account changed during sync.") }
                        try self.applyPulledRow(table: entry.table, row: row)
                    }
                }
            }
            if let storage, canSync { await storage.reconcileFiles(library: store.state, directory: store.directory) }
        } catch {
            // Keep an unmet full snapshot request for the next real trigger. A failed write or
            // hydration must not turn the next incremental sync into an incomplete drain; it
            // also must not create an endless retry loop while offline or out of disk space.
            if !snapshotRequestSatisfied, canSync,
               case .signedIn(let currentUserID, _) = auth.state, currentUserID == userID {
                scheduledNeedsLibrarySnapshot = true
                scheduledForceSnapshot = scheduledForceSnapshot || forceSnapshot
            }
            engine.reportFailure(error)
        }
    }

    /// A first-login profile can refer to scores this device has not downloaded yet. Hydrate only
    /// those prerequisites before committing the complete profile, retaining every selection and
    /// privacy field. Authorization is rechecked after every suspension and before publication.
    func prepareProfileDependencies(_ profile: Profile, validateAccount: () throws -> Void) async throws {
        try validateAccount()
        let pieceIDs = Set(store.state.pieces.map(\.id))
        if !profile.currentlyWorkingOnPieceIDs.allSatisfy(pieceIDs.contains) {
            let prerequisites: Set<String> = ["instruments", "tags", "folders", "pieces"]
            for entry in Self.pullTables where prerequisites.contains(entry.table) {
                try validateAccount()
                if entry.table == "pieces" {
                    try await engine.pullScoreSnapshot { rows in
                        try validateAccount()
                        try self.applyPulledScoreSnapshot(rows)
                    }
                } else if entry.table == "folders" {
                    try await engine.pullRows(table: entry.table) { rows in
                        try validateAccount()
                        try self.applyPulledHierarchy(table: entry.table, rows: rows)
                    }
                } else {
                    try await engine.pull(table: entry.table) { row in
                        try validateAccount()
                        try self.applyPulledRow(table: entry.table, row: row)
                    }
                }
            }
        }
        try validateAccount()
    }

    private func pullPracticeSnapshot() async throws {
        try await engine.pullPracticeSnapshot { [weak self] rows in
            guard let self, self.canSync else { throw SyncError.transport("Account changed during sync.") }
            let sessions = try (rows["practice_sessions"] ?? []).map { try SyncJSON.object($0).decoded(as: PracticeSessionSyncRow.self) }
            let sets = try (rows["sets"] ?? []).map { try SyncJSON.object($0).decoded(as: SetSyncRow.self) }
            let attempts = try (rows["attempts"] ?? []).map { try SyncJSON.object($0).decoded(as: AttemptSyncRow.self) }
            let acceptedSessions = sessions.filter { self.shouldApply($0.updated_at, currentUpdatedAt: self.lastKnownSessionUpdatedAt[$0.id]) }
            let acceptedSets = sets.filter { self.shouldApply($0.updated_at, currentUpdatedAt: self.lastKnownSetUpdatedAt[$0.id]) }
            let coreSets = try acceptedSets.map { dto -> ActiveSet in
                guard let set = dto.coreValue else { throw SyncError.invalidRemoteRow("sets") }; return set
            }
            let coreAttempts = try attempts.map { dto -> (attempt: Attempt, setID: UUID) in
                guard let attempt = dto.coreValue else { throw SyncError.invalidRemoteRow("attempts") }; return (attempt, dto.set_id)
            }
            try self.store.applySyncedPracticeSnapshot(sessions: acceptedSessions.map(\.coreValue), sets: coreSets, attempts: coreAttempts)
            // Save the receipt/clock only after the whole practice graph is durable.
            for dto in acceptedSessions { self.lastKnownSessionUpdatedAt[dto.id] = dto.updated_at }
            for dto in acceptedSets { self.lastKnownSetUpdatedAt[dto.id] = dto.updated_at }
            for dto in sessions {
                guard let row = try SyncJSON(encoding: dto).objectValue else { throw SyncError.invalidRemoteRow("practice_sessions") }
                try self.engine.acknowledgePulledRow(table: "practice_sessions", row: row)
            }
            for dto in sets {
                guard let row = try SyncJSON(encoding: dto).objectValue else { throw SyncError.invalidRemoteRow("sets") }
                try self.engine.acknowledgePulledRow(table: "sets", row: row)
            }
            for dto in attempts {
                guard let row = try SyncJSON(encoding: dto).objectValue else { throw SyncError.invalidRemoteRow("attempts") }
                try self.engine.acknowledgePulledRow(table: "attempts", row: row)
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
    public func pushPreferences() { enqueueUpsert(table: "account_preferences", encoding: AccountPreferencesSyncRow(store.preferences)) }
    public func pushProfile() {
        guard canSync else { return }
        guard engine.hasHydratedProfile else {
            do { try engine.stageProfileEdit(store.state.profile) } catch { engine.reportFailure(error) }
            scheduleLibrarySync(); return
        }
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
    public func pushGoal(_ goal: PracticeGoal) { enqueueUpsert(table: "practice_goals", encoding: PracticeGoalSyncRow(goal)) }
    public func pushRoutine(_ routine: PracticeRoutine) { enqueueUpsert(table: "practice_routines", encoding: PracticeRoutineSyncRow(routine)) }
    public func pushNotebookEntry(_ entry: NotebookEntry) { enqueueUpsert(table: "notebook_entries", encoding: NotebookEntrySyncRow(entry)) }

    /// Call from `.onChange(of: store.state.recordings.count)` (`PraeludeApp.swift`) — no existing
    /// View call site creates an `AudioRecording` directly (only `RecordingService.finishTake`,
    /// driven reactively from `PracticeStore.activeSet`, not from a View with `SyncCoordinator` in
    /// its environment), so this mirrors `syncMostRecentFinishedSet`'s own reactive-hook reasoning:
    /// pushes the newest recording's metadata and uploads its file to the `recordings` bucket
    /// (spec §4a) — a no-op past the metadata push when `storage` was never configured (`nil`) or
    /// the account is signed out.
    public func syncNewestRecording() {
        guard canSync, let recording = store.state.recordings.last else { return }
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
    // doc comment) rather than enqueueing attempts directly from a View, so every attempt push
    // is reachable only through the path that also pushes its
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
        guard canSync, let set else { return }
        do {
            try enqueuePracticeProgress(set, session: store.state.sessions.first { $0.id == set.sessionID })
            scheduleLibrarySync(reconcileLibrary: false)
        } catch { engine.reportFailure(error) }
    }

    /// One durable write for a repetition's session, set, new attempts and Undo records. Parent
    /// rows precede children; local cursors advance only after the whole batch is persisted.
    /// Kept internal so failure-injected tests exercise this transaction without authenticating.
    func enqueuePracticeProgress(_ set: ActiveSet, session: PracticeSession?) throws {
        var entries: [SyncQueueEntry] = []
        let sessionDTO = session.map { PracticeSessionSyncRow($0) }
        let setDTO = SetSyncRow(set)
        func row<T: Encodable>(_ value: T) throws -> [String: SyncJSON] {
            guard let row = try SyncJSON(encoding: value).objectValue else { throw SyncError.invalidRemoteRow("practice progress") }
            return row
        }
        // Starting practice can beat the full-library debounce after capturing a photo or
        // selecting a new passage. Persist its prerequisites in this same batch, even after
        // the one-time legacy queue repair. Snapshot signatures avoid rewriting unchanged rows.
        guard let piece = store.state.pieces.first(where: { $0.id == set.configuration.pieceID }) else {
            throw SyncError.invalidRemoteRow("practice piece")
        }
        if let instrument = store.state.instruments.first(where: { $0.id == piece.instrumentID }) {
            entries.append(.upsert(table: "instruments", row: try row(InstrumentSyncRow(instrument))))
        }
        for tag in store.state.tags where piece.tagIDs.contains(tag.id) {
            entries.append(.upsert(table: "tags", row: try row(TagSyncRow(tag))))
        }
        var folders: Set<UUID> = [], folderPath: Set<UUID> = []
        func includeFolder(_ id: UUID) throws {
            guard !folders.contains(id) else { return }
            guard folderPath.insert(id).inserted, let folder = store.state.folders.first(where: { $0.id == id }) else {
                throw SyncError.invalidRemoteRow("practice folder ancestry")
            }
            if let parent = folder.parentFolderID { try includeFolder(parent) }
            entries.append(.upsert(table: "folders", row: try row(FolderSyncRow(folder))))
            folders.insert(id); folderPath.remove(id)
        }
        for id in piece.folderIDs { try includeFolder(id) }
        entries.append(.upsert(table: "pieces", row: try row(PieceSyncRow(piece))))
        var passageClosure: [UUID: Passage] = [:]
        func collectPassage(_ id: UUID) throws {
            guard passageClosure[id] == nil else { return }
            guard let passage = store.state.passages.first(where: { $0.id == id && $0.pieceID == piece.id }) else {
                throw SyncError.invalidRemoteRow("practice passage ancestry")
            }
            // Provenance may point back after splitting and merging into the original passage.
            // Collect it once, but only the real parent FK determines upload order.
            passageClosure[id] = passage
            if let parent = passage.parentPassageID { try collectPassage(parent) }
            for source in passage.joinedFromPassageIDs { try collectPassage(source) }
        }
        if let passageID = set.configuration.passageID { try collectPassage(passageID) }
        var remainingPassages = Array(passageClosure.values), queuedPassages: Set<UUID> = []
        while !remainingPassages.isEmpty {
            let ready = remainingPassages.filter { $0.parentPassageID == nil || queuedPassages.contains($0.parentPassageID!) }
            guard !ready.isEmpty else { throw SyncError.invalidRemoteRow("practice passage parent cycle") }
            for passage in ready {
                entries.append(.upsert(table: "passages", row: try row(PassageSyncRow(passage))))
                queuedPassages.insert(passage.id)
            }
            remainingPassages.removeAll { queuedPassages.contains($0.id) }
        }
        if let sessionDTO { entries.append(.upsert(table: "practice_sessions", row: try row(sessionDTO))) }
        entries.append(.upsert(table: "sets", row: try row(setDTO)))
        let alreadyPushed = min(pushedAttemptCounts[set.id] ?? 0, set.attempts.count)
        for attempt in set.attempts.dropFirst(alreadyPushed) {
            entries.append(.append(table: "attempts", row: try row(AttemptSyncRow(attempt, setID: set.id))))
        }
        var undoIDs: Set<UUID> = []
        for attempt in set.attempts where !pushedUndoIDs.contains(attempt.id) {
            if let undoneAt = attempt.undoneAt {
                entries.append(.undoAttempt(attemptID: attempt.id, undoneAt: undoneAt))
                undoIDs.insert(attempt.id)
            }
        }
        try engine.enqueueSnapshot(entries)
        pushedAttemptCounts[set.id] = set.attempts.count
        pushedUndoIDs.formUnion(undoIDs)
        if let sessionDTO { lastKnownSessionUpdatedAt[sessionDTO.id] = sessionDTO.updated_at }
        lastKnownSetUpdatedAt[set.id] = setDTO.updated_at
    }

    private func enqueueUpsert<T: Encodable>(table: String, encoding value: T) {
        guard canSync, let object = try? SyncJSON(encoding: value).objectValue else { return }
        do {
            try engine.enqueueUpsert(table: table, row: object)
            scheduleLibrarySync(reconcileLibrary: false)
        } catch { engine.reportFailure(error) }
    }
    private func enqueueAppend<T: Encodable>(table: String, encoding value: T) {
        guard canSync, let object = try? SyncJSON(encoding: value).objectValue else { return }
        do {
            try engine.enqueueAppend(table: table, row: object)
            scheduleLibrarySync(reconcileLibrary: false)
        } catch { engine.reportFailure(error) }
    }

    // MARK: Applying a pulled (or "you lost, adopt this" rejected-push) row back into PracticeStore

    private func applyAdoptedRow(table: String, row: [String: SyncJSON]) throws { try applyPulledRow(table: table, row: row) }

    func applyPulledScoreSnapshot(_ rows: [String: [[String: SyncJSON]]]) throws {
        let pieces = try (rows["pieces"] ?? []).map { try SyncJSON.object($0).decoded(as: PieceSyncRow.self) }
        let edits = try (rows["page_edits"] ?? []).map { try SyncJSON.object($0).decoded(as: PageEditSyncRow.self) }
        let values = try pieces.map { dto in
            guard let piece = dto.coreValue(preserving: store.state.pieces.first { $0.id == dto.id }) else {
                throw SyncError.invalidRemoteRow("pieces")
            }
            return piece
        }
        let pageEdits = try edits.map { dto in
            guard let edit = dto.coreValue else { throw SyncError.invalidRemoteRow("page_edits") }
            return edit
        }
        try store.applySyncedScoreSnapshot(pieces: values, pageEdits: pageEdits)
        for piece in pieces {
            if let row = try SyncJSON(encoding: piece).objectValue { try engine.acknowledgePulledRow(table: "pieces", row: row) }
        }
        for edit in edits {
            if let row = try SyncJSON(encoding: edit).objectValue { try engine.acknowledgePulledRow(table: "page_edits", row: row) }
        }
    }

    /// A complete hierarchy is committed before its cursor or outbound signatures are acknowledged.
    /// UUID pagination order is unrelated to parent/provenance dependencies.
    func applyPulledHierarchy(table: String, rows: [[String: SyncJSON]]) throws {
        var canonical: [[String: SyncJSON]] = []
        switch table {
        case "folders":
            let values = try rows.map { try SyncJSON.object($0).decoded(as: FolderSyncRow.self) }
            canonical = try values.map { try SyncJSON(encoding: $0).objectValue ?? [:] }
            try store.applySyncedFolders(values.map(\.coreValue))
        case "passages":
            let values = try rows.map { try SyncJSON.object($0).decoded(as: PassageSyncRow.self) }
            let passages = try values.map { value in
                guard let passage = value.coreValue else { throw SyncError.invalidRemoteRow(table) }
                return passage
            }
            canonical = try values.map { try SyncJSON(encoding: $0).objectValue ?? [:] }
            try store.applySyncedPassages(passages)
        default: throw SyncError.invalidRemoteRow(table)
        }
        for row in canonical { try engine.acknowledgePulledRow(table: table, row: row) }
    }

    func applyPulledRow(table: String, row: [String: SyncJSON]) throws {
        let wrapped = SyncJSON.object(row)
        var canonicalRow: [String: SyncJSON]?
        switch table {
        case "instruments":
            let dto = try wrapped.decoded(as: InstrumentSyncRow.self)
            canonicalRow = try SyncJSON(encoding: dto).objectValue
            guard let value = dto.coreValue else { throw SyncError.invalidRemoteRow(table) }
            if shouldApply(value.updatedAt, currentUpdatedAt: store.state.instruments.first { $0.id == value.id }?.updatedAt) {
                try store.applySyncedInstrument(value)
            }
        case "pieces":
            // Fixed 20260926 pass: was `store.updatePiece(value)`, which silently fails (swallowed by
            // `try?`) for a piece id this device has never seen before — see `applySyncedPiece`'s own
            // doc comment. That bug predates this pass; every table this pass newly wires already
            // upserts correctly (`applySynced*` throughout `PracticeStore.swift`).
            let dto = try wrapped.decoded(as: PieceSyncRow.self)
            canonicalRow = try SyncJSON(encoding: dto).objectValue
            guard let value = dto.coreValue(preserving: store.state.pieces.first { $0.id == dto.id }) else { throw SyncError.invalidRemoteRow(table) }
            try store.applySyncedPiece(value)
        case "passages":
            let dto = try wrapped.decoded(as: PassageSyncRow.self)
            canonicalRow = try SyncJSON(encoding: dto).objectValue
            guard let value = dto.coreValue else { throw SyncError.invalidRemoteRow(table) }
            if shouldApply(value.updatedAt, currentUpdatedAt: store.state.passages.first { $0.id == value.id }?.updatedAt) {
                try store.savePassage(value)
            }
        case "ink_strokes":
            let dto = try wrapped.decoded(as: InkStrokeSyncRow.self)
            canonicalRow = try SyncJSON(encoding: dto).objectValue
            guard let value = dto.coreValue else { throw SyncError.invalidRemoteRow(table) }
            let current = store.state.inkStrokes.first { $0.id == value.id }
            if shouldApply(value.updatedAt, currentUpdatedAt: current?.updatedAt) { try store.applySyncedInkStroke(value) }
        case "tags":
            let dto = try wrapped.decoded(as: TagSyncRow.self)
            canonicalRow = try SyncJSON(encoding: dto).objectValue
            let value = dto.coreValue
            if shouldApply(value.updatedAt, currentUpdatedAt: store.state.tags.first { $0.id == value.id }?.updatedAt) { try store.applySyncedTag(value) }
        case "folders":
            let dto = try wrapped.decoded(as: FolderSyncRow.self)
            canonicalRow = try SyncJSON(encoding: dto).objectValue
            let value = dto.coreValue
            if shouldApply(value.updatedAt, currentUpdatedAt: store.state.folders.first { $0.id == value.id }?.updatedAt) { try store.applySyncedFolder(value) }
        case "setlists":
            let dto = try wrapped.decoded(as: SetlistSyncRow.self)
            canonicalRow = try SyncJSON(encoding: dto).objectValue
            let value = dto.coreValue
            if shouldApply(value.updatedAt, currentUpdatedAt: store.state.setlists.first { $0.id == value.id }?.updatedAt) { try store.applySyncedSetlist(value) }
        case "bookmarks":
            let dto = try wrapped.decoded(as: BookmarkSyncRow.self)
            canonicalRow = try SyncJSON(encoding: dto).objectValue
            let value = dto.coreValue
            if shouldApply(value.updatedAt, currentUpdatedAt: store.state.bookmarks.first { $0.id == value.id }?.updatedAt) { try store.applySyncedBookmark(value) }
        case "page_edits":
            let dto = try wrapped.decoded(as: PageEditSyncRow.self)
            canonicalRow = try SyncJSON(encoding: dto).objectValue
            guard let value = dto.coreValue else { throw SyncError.invalidRemoteRow(table) }
            if shouldApply(value.updatedAt, currentUpdatedAt: store.state.pageEdits.first { $0.id == value.id }?.updatedAt) { try store.applySyncedPageEdit(value) }
        case "score_links":
            let dto = try wrapped.decoded(as: ScoreLinkSyncRow.self)
            canonicalRow = try SyncJSON(encoding: dto).objectValue
            let value = dto.coreValue
            if shouldApply(value.updatedAt, currentUpdatedAt: store.state.scoreLinks.first { $0.id == value.id }?.updatedAt) { try store.applySyncedScoreLink(value) }
        case "annotations":
            let dto = try wrapped.decoded(as: AnnotationSyncRow.self)
            canonicalRow = try SyncJSON(encoding: dto).objectValue
            if let value = dto.textValue {
                if shouldApply(value.updatedAt, currentUpdatedAt: store.state.textAnnotations.first { $0.id == value.id }?.updatedAt) {
                    try store.applySyncedTextAnnotation(value)
                }
            } else if let value = dto.stampValue {
                if shouldApply(value.updatedAt, currentUpdatedAt: store.state.stampAnnotations.first { $0.id == value.id }?.updatedAt) {
                    try store.applySyncedStampAnnotation(value)
                }
            } else { throw SyncError.invalidRemoteRow(table) }
        case "warmup_exercises":
            let dto = try wrapped.decoded(as: WarmupExerciseSyncRow.self)
            canonicalRow = try SyncJSON(encoding: dto).objectValue
            guard let value = dto.coreValue else { throw SyncError.invalidRemoteRow(table) }
            if shouldApply(value.updatedAt, currentUpdatedAt: store.state.warmupExercises.first { $0.id == value.id }?.updatedAt) {
                try store.applySyncedWarmupExercise(value)
            }
        case "audio_recordings":
            let dto = try wrapped.decoded(as: AudioRecordingSyncRow.self)
            canonicalRow = try SyncJSON(encoding: dto).objectValue
            let value = dto.coreValue
            if shouldApply(value.updatedAt, currentUpdatedAt: store.state.recordings.first { $0.id == value.id }?.updatedAt) {
                try store.applySyncedRecording(value)
            }
        case "notebook_entries":
            let dto = try wrapped.decoded(as: NotebookEntrySyncRow.self)
            canonicalRow = try SyncJSON(encoding: dto).objectValue
            guard let value = dto.coreValue else { throw SyncError.invalidRemoteRow(table) }
            if shouldApply(value.updatedAt, currentUpdatedAt: store.state.notebookEntries.first { $0.id == value.id }?.updatedAt) {
                try store.applySyncedNotebookEntry(value)
            }
        case "practice_goals":
            let dto = try wrapped.decoded(as: PracticeGoalSyncRow.self)
            canonicalRow = try SyncJSON(encoding: dto).objectValue
            let value = dto.coreValue
            if shouldApply(value.updatedAt, currentUpdatedAt: store.state.goals.first { $0.id == value.id }?.updatedAt) {
                try store.applySyncedGoal(value)
            }
        case "practice_routines":
            let dto = try wrapped.decoded(as: PracticeRoutineSyncRow.self)
            canonicalRow = try SyncJSON(encoding: dto).objectValue
            let value = dto.coreValue
            if shouldApply(value.updatedAt, currentUpdatedAt: store.state.routines.first { $0.id == value.id }?.updatedAt) {
                try store.applySyncedRoutine(value)
            }
        case "practice_sessions":
            let dto = try wrapped.decoded(as: PracticeSessionSyncRow.self)
            canonicalRow = try SyncJSON(encoding: dto).objectValue
            let value = dto.coreValue
            if shouldApply(dto.updated_at, currentUpdatedAt: lastKnownSessionUpdatedAt[value.id]) {
                try store.applySyncedSession(value)
                lastKnownSessionUpdatedAt[value.id] = dto.updated_at
            }
        case "sets":
            let dto = try wrapped.decoded(as: SetSyncRow.self)
            canonicalRow = try SyncJSON(encoding: dto).objectValue
            guard let value = dto.coreValue else { throw SyncError.invalidRemoteRow(table) }
            if shouldApply(dto.updated_at, currentUpdatedAt: lastKnownSetUpdatedAt[value.id]) {
                try store.applySyncedSet(value)
                lastKnownSetUpdatedAt[value.id] = dto.updated_at
            }
        case "attempts":
            guard let setIDString = row["set_id"]?.stringValue, let setID = UUID(uuidString: setIDString),
                  let dto = try? wrapped.decoded(as: AttemptSyncRow.self), let value = dto.coreValue else { throw SyncError.invalidRemoteRow(table) }
            canonicalRow = try SyncJSON(encoding: dto).objectValue
            try store.applySyncedAttempt(value, setID: setID)
        case "rule_settings":
            let dto = try wrapped.decoded(as: RuleSettingsSyncRow.self)
            canonicalRow = try SyncJSON(encoding: dto).objectValue
            let value = dto.coreValue
            if !engine.hasSnapshot(table: table) || shouldApply(value.updatedAt, currentUpdatedAt: store.state.ruleSettings.updatedAt) { try store.applySyncedRuleSettings(value) }
        case "rewards_state":
            let dto = try wrapped.decoded(as: RewardsStateSyncRow.self)
            canonicalRow = try SyncJSON(encoding: dto).objectValue
            let value = dto.coreValue
            if !engine.hasSnapshot(table: table) || shouldApply(value.updatedAt, currentUpdatedAt: store.state.rewardsState.updatedAt) { try store.applySyncedRewardsState(value) }
        case "account_preferences":
            let dto = try wrapped.decoded(as: AccountPreferencesSyncRow.self)
            canonicalRow = try SyncJSON(encoding: dto).objectValue
            let value = dto.coreValue
            if !engine.hasSnapshot(table: table) || shouldApply(value.updatedAt, currentUpdatedAt: store.state.preferences.updatedAt) {
                try store.applySyncedPreferences(value)
            }
        case "profiles":
            let dto = try wrapped.decoded(as: ProfileSyncRow.self)
            canonicalRow = try SyncJSON(encoding: dto).objectValue
            let value = dto.coreProfile(ownerID: store.state.profile.ownerID)
            if !engine.hasSnapshot(table: table) || shouldApply(value.updatedAt, currentUpdatedAt: store.state.profile.updatedAt) {
                try store.applySyncedProfile(value)
                try engine.updateProfileBackendFields(dto.backendFields)
            }
        case "rule_events":
            let dto = try wrapped.decoded(as: RuleEventSyncRow.self)
            canonicalRow = try SyncJSON(encoding: dto).objectValue
            guard let value = dto.coreValue else { throw SyncError.invalidRemoteRow(table) }
            try store.applySyncedRuleEvent(value)
        case "reward_ledger":
            let dto = try wrapped.decoded(as: RewardLedgerEntrySyncRow.self)
            canonicalRow = try SyncJSON(encoding: dto).objectValue
            try store.applySyncedRewardLedgerEntry(dto.coreValue)
        case "badges":
            let dto = try wrapped.decoded(as: BadgeSyncRow.self)
            canonicalRow = try SyncJSON(encoding: dto).objectValue
            try store.applySyncedBadge(dto.coreValue)
        case "milestone_events":
            let dto = try wrapped.decoded(as: MilestoneEventSyncRow.self)
            canonicalRow = try SyncJSON(encoding: dto).objectValue
            try store.applySyncedMilestoneEvent(dto.coreValue)
        case "cold_grades":
            let dto = try wrapped.decoded(as: ColdGradeRecordSyncRow.self)
            canonicalRow = try SyncJSON(encoding: dto).objectValue
            guard let value = dto.coreValue else { throw SyncError.invalidRemoteRow(table) }
            try store.applySyncedColdGrade(value)
        case "break_point_taps":
            let dto = try wrapped.decoded(as: BreakPointTapSyncRow.self)
            canonicalRow = try SyncJSON(encoding: dto).objectValue
            try store.applySyncedBreakPointTap(dto.coreValue)
        default:
            throw SyncError.invalidRemoteRow(table)
        }
        // Normalize optional values through the DTO before comparing an outbound snapshot.
        // `owner_id` is not part of the client DTO. Keep explicit nulls for fields such as a
        // cleared default tempo; SyncEngine also normalizes known nullable Codable omissions.
        guard let canonicalRow else { throw SyncError.invalidRemoteRow(table) }
        var normalized = canonicalRow
        normalized.removeValue(forKey: "owner_id")
        try engine.acknowledgePulledRow(table: table, row: normalized)
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
