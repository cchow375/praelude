import Foundation
import Observation
import Network

/// Wires `SyncEngine` (Core, transport-agnostic) to `PracticeStore` and `AuthManager` for the
/// representative table set this track has DTOs for (`SyncDTO.swift`): instruments, pieces,
/// passages, ink strokes, rule settings, rewards state, profile. Push is explicit — a caller invokes
/// `push*` right after the matching `PracticeStore` mutation — rather than an automatic hook into
/// every one of `PracticeStore`'s ~30 `save`/`update`/`record` methods, which would mean touching
/// (not just extending) that file well beyond this track's own surface. `syncAll()` covers the full
/// pull direction and draining unconditionally. See the final report for exactly which call sites
/// this pass wired end to end (`Views/AccountView.swift`, `Views/ProfileEditView.swift`) versus the
/// pattern being established but not yet threaded through the rest of the app's existing mutations.
@MainActor @Observable
public final class SyncCoordinator {
    private let engine: SyncEngine
    private let auth: AuthManager
    private let store: PracticeStore
    private var pathMonitor: NWPathMonitor?
    private var wasSatisfied = true

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
    public func resetLocalAccountState() { try? engine.resetLocalAccountState() }

    /// The tables this coordinator can pull and LWW-merge. Order matters only in that `instruments`
    /// and `pieces` should land before `passages`/`ink_strokes` reference them — harmless either way
    /// today since Core's own reference checks in `PracticeStore.validate` are a local sanity check,
    /// not a hard foreign key, but pulling parents first avoids a moment where a passage briefly
    /// points at a piece not yet on this device.
    private static let pullTables = ["instruments", "pieces", "passages", "ink_strokes", "rule_settings", "rewards_state", "profiles"]

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

    /// Drains the outbound queue, then pulls every table this track wired, merging each row into
    /// `PracticeStore` by whole-record LWW (Schema3.md's own granularity — a pulled row already won
    /// the server's own LWW comparison against whatever this device last pushed for it; the only
    /// remaining question is whether this device has an even-newer local edit still ahead of it in
    /// the queue, which `LastWriteWins.shouldApplyPulled` answers per record). No-ops in guest mode.
    public func syncAll() async {
        guard case .signedIn = auth.state else { return }
        await engine.drain(applyPulledRow: applyAdoptedRow)
        for table in Self.pullTables {
            try? await engine.pull(table: table) { [weak self] row in self?.applyPulledRow(table: table, row: row) }
        }
    }

    // MARK: Push (explicit — see type doc comment)

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

    private func enqueueUpsert<T: Encodable>(table: String, encoding value: T) {
        guard case .signedIn = auth.state, let object = try? SyncJSON(encoding: value).objectValue else { return }
        try? engine.enqueueUpsert(table: table, row: object)
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
                try? store.saveInstrument(value)
            }
        case "pieces":
            guard let dto = try? wrapped.decoded(as: PieceSyncRow.self), let value = dto.coreValue else { return }
            if shouldApply(value.updatedAt, currentUpdatedAt: store.state.pieces.first { $0.id == value.id }?.updatedAt) {
                try? store.updatePiece(value)
            }
        case "passages":
            guard let dto = try? wrapped.decoded(as: PassageSyncRow.self), let value = dto.coreValue else { return }
            if shouldApply(value.updatedAt, currentUpdatedAt: store.state.passages.first { $0.id == value.id }?.updatedAt) {
                try? store.savePassage(value)
            }
        case "ink_strokes":
            guard let dto = try? wrapped.decoded(as: InkStrokeSyncRow.self), let value = dto.coreValue else { return }
            let current = store.state.inkStrokes.first { $0.id == value.id }
            if shouldApply(value.updatedAt, currentUpdatedAt: current?.updatedAt) {
                try? store.applySyncedInkStroke(value)
            }
        case "rule_settings":
            guard let dto = try? wrapped.decoded(as: RuleSettingsSyncRow.self) else { return }
            let value = dto.coreValue
            if shouldApply(value.updatedAt, currentUpdatedAt: store.state.ruleSettings.updatedAt) { try? store.updateRuleSettings(value) }
        case "rewards_state":
            guard let dto = try? wrapped.decoded(as: RewardsStateSyncRow.self) else { return }
            let value = dto.coreValue
            if shouldApply(value.updatedAt, currentUpdatedAt: store.state.rewardsState.updatedAt) { try? store.updateRewardsState(value) }
        case "profiles":
            guard let dto = try? wrapped.decoded(as: ProfileSyncRow.self) else { return }
            let value = dto.coreProfile(ownerID: store.state.profile.ownerID)
            if shouldApply(value.updatedAt, currentUpdatedAt: store.state.profile.updatedAt) {
                try? store.updateProfile(value)
                try? engine.updateProfileBackendFields(dto.backendFields)
            }
        default:
            break
        }
    }
    private func shouldApply(_ pulledUpdatedAt: Date, currentUpdatedAt: Date?) -> Bool {
        guard let currentUpdatedAt else { return true }
        return LastWriteWins.shouldApplyPulled(pulledUpdatedAt: pulledUpdatedAt, localUpdatedAt: currentUpdatedAt)
    }
}
