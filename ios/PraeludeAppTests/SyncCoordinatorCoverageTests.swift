import Foundation
import XCTest
@testable import Praelude

/// App-level proof for the new `SyncCoordinator` surface this pass adds (`PraeludeCoreTests/
/// SyncCoverageTests.swift` covers the actual merge/ordering logic at the `SyncEngine`/
/// `PracticeStore` layer, which is reachable from the `PraeludeCore` SPM package; `SyncCoordinator`
/// itself lives in the app target and is not). `AuthManager.state` has no test seam to force
/// `.signedIn` without a real network sign-in (its own network-calling methods are integration
/// surface — see `AuthSyncWiringTests.swift`'s header, and `(C) sync-smoke.sh` for the live,
/// gated proof of the signed-in path) — deliberately not weakened here just to make this file's
/// job easier. What guest mode's own contract lets this file prove without any network at all: every
/// new push/reactive-sync method this pass added also never touches the transport while signed out,
/// extending the exact guarantee `AuthSyncWiringTests.testGuestModeNeverEnqueuesOrTouchesTheTransport`
/// already established for the original seven tables.
private struct NeverCalledTransport: SyncTransport {
    func upsert(table: String, row: [String: SyncJSON]) async throws -> SyncRPCResult {
        XCTFail("upsert(\(table)) must not be called while signed out"); throw SyncError.transport("unexpected call")
    }
    func append(table: String, row: [String: SyncJSON]) async throws -> SyncRPCResult {
        XCTFail("append(\(table)) must not be called while signed out"); throw SyncError.transport("unexpected call")
    }
    func updateLastPage(pieceID: UUID, lastPage: Int, at: Date) async throws -> SyncRPCResult {
        XCTFail("updateLastPage must not be called while signed out"); throw SyncError.transport("unexpected call")
    }
    func undoAttempt(attemptID: UUID, undoneAt: Date) async throws -> SyncRPCResult {
        XCTFail("undoAttempt must not be called while signed out"); throw SyncError.transport("unexpected call")
    }
    func fetch(table: String, field: String, updatedSince: Date?) async throws -> [[String: SyncJSON]] {
        XCTFail("fetch(\(table)) must not be called while signed out"); throw SyncError.transport("unexpected call")
    }
}

@MainActor
final class SyncCoordinatorCoverageTests: XCTestCase {
    private func store() -> PracticeStore { PracticeStore(directory: FileManager.default.temporaryDirectory.appendingPathComponent("praelude-sync-coverage-app-\(UUID())")) }
    private func engine() -> SyncEngine {
        SyncEngine(transport: NeverCalledTransport(), directory: FileManager.default.temporaryDirectory.appendingPathComponent("praelude-sync-coverage-app-engine-\(UUID())"))
    }
    private func coordinator(_ localStore: PracticeStore) -> SyncCoordinator {
        SyncCoordinator(engine: engine(), auth: AuthManager(services: SupabaseServices(), store: localStore), store: localStore)
    }

    func testEveryNewLibraryOrganizationPushMethodNoOpsInGuestMode() {
        let localStore = store()
        let coordinator = coordinator(localStore)
        coordinator.pushTag(Tag(name: "Recital"))
        coordinator.pushFolder(Folder(name: "Repertoire"))
        coordinator.pushSetlist(Setlist(name: "Spring recital"))
        coordinator.pushBookmark(Bookmark(pieceID: UUID(), page: 1, label: "Development"))
        coordinator.pushPageEdit(PageEdit(pieceID: UUID(), sourcePage: 1, displayOrder: 1))
        coordinator.pushScoreLink(ScoreLink(pieceID: UUID(), sourcePage: 1, targetPage: 2))
        coordinator.pushTextAnnotation(TextBoxAnnotation(pieceID: UUID(), page: 1, region: NormalizedRect(x: 0, y: 0, width: 0.1, height: 0.1), text: "Note"))
        coordinator.pushStampAnnotation(StampAnnotation(pieceID: UUID(), page: 1, position: NormalizedRect(x: 0, y: 0, width: 0.1, height: 0.1), kind: .fingering))
        coordinator.pushWarmupExercise(WarmupExercise(kind: .scale, key: "C", name: "C major"))
        coordinator.pushRecording(AudioRecording(fileName: "take.m4a", duration: 10, byteSize: 1000))
        coordinator.pushNotebookEntry(NotebookEntry(kind: .daily, text: "Practiced slowly"))
        XCTAssertEqual(coordinator.pendingCount, 0, "Nothing is queued while signed out.")
    }

    func testEveryNewAppendOnlyLogPushMethodNoOpsInGuestMode() {
        let localStore = store()
        let coordinator = coordinator(localStore)
        coordinator.pushRuleEvent(RuleEvent(ruleID: .r1SmallChunks, reasonText: "Test"))
        coordinator.pushRewardLedgerEntry(RewardLedgerEntry(reason: "Test"))
        coordinator.pushBadge(Badge(key: "test"))
        coordinator.pushMilestoneEvent(MilestoneEvent(kind: "test"))
        coordinator.pushColdGrade(ColdGradeRecord(passageID: UUID(), grade: .clean, tempo: 80))
        coordinator.pushBreakPointTap(BreakPointTap(passageID: UUID()))
        XCTAssertEqual(coordinator.pendingCount, 0)
    }

    /// The reactive rep-sync hooks (`syncActiveSetProgress`/`syncMostRecentFinishedSet`) drive real
    /// `PracticeStore` state, unlike the plain push methods above — proves guest mode holds for a real
    /// running-set-with-reps scenario too, not just an empty call.
    func testReactiveRepSyncHooksNoOpInGuestModeEvenWithARealActiveSetAndReps() throws {
        let localStore = store()
        let coordinator = coordinator(localStore)
        let piece = Piece(title: "Sonata", pageCount: 2)
        try localStore.addPiece(piece)
        try localStore.startSet(PracticeConfiguration(pieceID: piece.id))
        try localStore.record(.clean)
        try localStore.record(.clean)
        coordinator.syncActiveSetProgress()
        try localStore.endSet()
        coordinator.syncMostRecentFinishedSet()
        XCTAssertEqual(coordinator.pendingCount, 0, "The reps just recorded above must not be queued while signed out.")
    }

    func testSyncNewestRecordingNoOpsInGuestMode() throws {
        let localStore = store()
        let coordinator = coordinator(localStore)
        try localStore.saveRecording(AudioRecording(fileName: "take.m4a", duration: 12, byteSize: 2000))
        coordinator.syncNewestRecording()
        XCTAssertEqual(coordinator.pendingCount, 0)
    }

    func testResetLocalAccountStateClearsPendingWritesFromTheNewTablesToo() throws {
        let localStore = store()
        let syncEngine = engine()
        let coordinator = SyncCoordinator(engine: syncEngine, auth: AuthManager(services: SupabaseServices(), store: localStore), store: localStore)
        try syncEngine.enqueueUpsert(table: "tags", row: ["id": .string(UUID().uuidString)])
        try syncEngine.enqueueAppend(table: "rule_events", row: ["id": .string(UUID().uuidString)])
        XCTAssertEqual(coordinator.pendingCount, 2)
        coordinator.resetLocalAccountState()
        XCTAssertEqual(coordinator.pendingCount, 0)
    }
}
