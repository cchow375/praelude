import Foundation
import XCTest
import PostgREST
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

/// Exercises the real SDK-built requests without an account, credentials or a network connection.
/// The fixture models the deployed primary keys and rejects the exact missing-column query that
/// prevented account_preferences reads (and every subsequent private-file reconciliation).
private actor SyncRequestProbe {
    private(set) var requests: [URLRequest] = []
    private let expectedOrder: String
    private let row: [String: SyncJSON]?
    init(expectedOrder: String, row: [String: SyncJSON]?) { self.expectedOrder = expectedOrder; self.row = row }
    func respond(to request: URLRequest) throws -> (Data, URLResponse) {
        requests.append(request)
        let url = try XCTUnwrap(request.url)
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let order = items.first(where: { $0.name == "order" })?.value
        guard order == expectedOrder else {
            let body = Data(#"{"code":"42703","message":"requested order column does not exist"}"#.utf8)
            return (body, try XCTUnwrap(HTTPURLResponse(url: url, statusCode: 400, httpVersion: nil, headerFields: ["Content-Type": "application/json"])))
        }
        let rows = requests.count == 1 ? row.map { [$0] } ?? [] : []
        return (try JSONEncoder().encode(rows), try XCTUnwrap(HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"])))
    }
}

final class PostgRESTSyncRequestTests: XCTestCase {
    func testErrorMappingPreservesTypedNetworkFailuresAndExistingDiagnostics() {
        for code in [URLError.notConnectedToInternet, .timedOut, .networkConnectionLost, .cannotFindHost, .cannotConnectToHost] {
            let mapped = PostgRESTSyncTransport.mappedTransportError(URLError(code))
            XCTAssertEqual((mapped as? URLError)?.code, code)
        }
        let bridged = NSError(domain: NSURLErrorDomain, code: URLError.notConnectedToInternet.rawValue)
        XCTAssertEqual((PostgRESTSyncTransport.mappedTransportError(bridged) as? URLError)?.code, .notConnectedToInternet)
        let existing = SyncError.transport("Existing diagnostic")
        XCTAssertEqual(PostgRESTSyncTransport.mappedTransportError(existing) as? SyncError, existing)
        let backend = PostgrestError(details: "SYNTHETIC_PRIVATE_ROW", code: "42703", message: "column account_preferences.id does not exist")
        let mappedBackend = PostgRESTSyncTransport.mappedTransportError(backend)
        XCTAssertNil(mappedBackend as? URLError, "An online schema rejection is not an offline connection")
        XCTAssertEqual(mappedBackend as? SyncError, .transport("column account_preferences.id does not exist (42703)"))
    }

    func testBackendDiagnosticKeepsCodeAndMessageWithoutPrivateRowDetails() {
        let error = PostgrestError(details: "SYNTHETIC_PRIVATE_ROW", hint: "SYNTHETIC_PRIVATE_HINT", code: "42703",
                                  message: "column account_preferences.id does not exist")
        let presented = SyncError.transport(PostgRESTSyncTransport.backendErrorMessage(error)).localizedDescription
        XCTAssertTrue(presented.contains("column account_preferences.id does not exist"))
        XCTAssertTrue(presented.contains("42703"))
        XCTAssertFalse(presented.contains("SYNTHETIC_PRIVATE_ROW"))
        XCTAssertFalse(presented.contains("SYNTHETIC_PRIVATE_HINT"))
    }

    func testOwnerOnlyTablesUseActualOwnerKeyOnEverySDKRequestPage() async throws {
        for table in ["account_preferences", "rule_settings", "rewards_state"] {
            let row: [String: SyncJSON] = ["owner_id": .string("10000000-0000-4000-8000-000000000001")]
            let probe = SyncRequestProbe(expectedOrder: "owner_id.asc.nullslast", row: row)
            let client = PostgrestClient(url: try XCTUnwrap(URL(string: "https://example.invalid/rest/v1")), logger: nil,
                                        fetch: { try await probe.respond(to: $0) }, retryEnabled: false)
            let rows = try await PostgRESTSyncTransport.fetchRows(client: client, table: table, field: "updated_at", updatedSince: nil)
            XCTAssertEqual(rows, [row], table)
            let requests = await probe.requests
            XCTAssertEqual(requests.count, 2, "A short first page must still prove exhaustion, including for \(table)")
            for (index, request) in requests.enumerated() {
                let url = try XCTUnwrap(request.url)
                let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
                XCTAssertEqual(request.httpMethod, "GET")
                XCTAssertEqual(url.lastPathComponent, table)
                XCTAssertEqual(items.first(where: { $0.name == "order" })?.value, "owner_id.asc.nullslast")
                XCTAssertEqual(items.first(where: { $0.name == "offset" })?.value, String(index))
                XCTAssertEqual(items.first(where: { $0.name == "limit" })?.value, "500")
            }
        }
    }

    func testEmptyPreferencesAndIDKeyedTablesBuildValidReadRequests() async throws {
        for (table, expectedOrder) in [("account_preferences", "owner_id.asc.nullslast"), ("profiles", "id.asc.nullslast"),
                                       ("pieces", "id.asc.nullslast"), ("passages", "id.asc.nullslast"), ("attempts", "id.asc.nullslast")] {
            let probe = SyncRequestProbe(expectedOrder: expectedOrder, row: nil)
            let client = PostgrestClient(url: try XCTUnwrap(URL(string: "https://example.invalid/rest/v1")), logger: nil,
                                        fetch: { try await probe.respond(to: $0) }, retryEnabled: false)
            let rows = try await PostgRESTSyncTransport.fetchRows(client: client, table: table, field: "updated_at", updatedSince: nil)
            XCTAssertTrue(rows.isEmpty, table)
            let requests = await probe.requests
            XCTAssertEqual(requests.count, 1)
            XCTAssertEqual(requests.first?.url?.lastPathComponent, table)
        }
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
        coordinator.pushGoal(PracticeGoal(title: "Memorize the opening"))
        coordinator.pushRoutine(PracticeRoutine(name: "Rhythms", stages: PracticeTechnique.rhythmPair.stages()))
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

    func testPracticeProgressQueuesParentsAttemptsAndUndoInOneDurableWrite() throws {
        let localStore = store()
        let path = FileManager.default.temporaryDirectory.appendingPathComponent("praelude-sync-batch-\(UUID())")
        defer { try? FileManager.default.removeItem(at: path) }
        var queueWrites = 0, stateWrites = 0
        let syncEngine = SyncEngine(transport: NeverCalledTransport(), directory: path, writeData: { data, url in
            if url.lastPathComponent == "sync-queue.json" { queueWrites += 1 }
            if url.lastPathComponent == "sync-state.json" { stateWrites += 1 }
            try data.write(to: url, options: .atomic)
        })
        let coordinator = SyncCoordinator(engine: syncEngine, auth: AuthManager(services: SupabaseServices(), store: localStore), store: localStore)
        let piece = Piece(title: "Batch score")
        try localStore.addPiece(piece)
        try localStore.startSet(PracticeConfiguration(pieceID: piece.id))
        try localStore.record(.clean)
        try localStore.record(.again)
        try localStore.undo()
        let set = try XCTUnwrap(localStore.activeSet)
        let session = try XCTUnwrap(localStore.state.sessions.first { $0.id == set.sessionID })
        let previousQueueWrites = queueWrites, previousStateWrites = stateWrites
        try coordinator.enqueuePracticeProgress(set, session: session)
        XCTAssertEqual(queueWrites - previousQueueWrites, 1)
        XCTAssertEqual(stateWrites - previousStateWrites, 1)
        let saved = try SyncQueue(directory: path).entries
        XCTAssertEqual(saved.map(\.table), ["pieces", "practice_sessions", "sets", "attempts", "attempts", ""])
        XCTAssertEqual(saved.map(\.kind), [.upsert, .upsert, .upsert, .append, .append, .undoAttempt])
        XCTAssertEqual(saved.last?.attemptID, set.attempts.last?.id)
        let savedWrites = queueWrites
        try coordinator.enqueuePracticeProgress(set, session: session)
        XCTAssertEqual(queueWrites, savedWrites, "Repeating an unchanged reactive callback performs no queue write.")
        XCTAssertEqual(try SyncQueue(directory: path).entries, saved)
    }

    func testFailedPracticeProgressBatchRetainsAttemptAndUndoForRetry() throws {
        let localStore = store()
        let path = FileManager.default.temporaryDirectory.appendingPathComponent("praelude-sync-batch-failure-\(UUID())")
        defer { try? FileManager.default.removeItem(at: path) }
        var failQueue = false
        let syncEngine = SyncEngine(transport: NeverCalledTransport(), directory: path, writeData: { data, url in
            if failQueue && url.lastPathComponent == "sync-queue.json" { throw SyncError.transport("Injected full disk") }
            try data.write(to: url, options: .atomic)
        })
        let coordinator = SyncCoordinator(engine: syncEngine, auth: AuthManager(services: SupabaseServices(), store: localStore), store: localStore)
        let piece = Piece(title: "Retry score")
        try localStore.addPiece(piece)
        try localStore.startSet(PracticeConfiguration(pieceID: piece.id))
        try localStore.record(.clean)
        try coordinator.enqueuePracticeProgress(try XCTUnwrap(localStore.activeSet), session: localStore.state.sessions.last)
        let saved = try SyncQueue(directory: path).entries
        try localStore.record(.again)
        try localStore.undo()
        let changed = try XCTUnwrap(localStore.activeSet)
        let newAttempt = try XCTUnwrap(changed.attempts.last)
        failQueue = true
        XCTAssertThrowsError(try coordinator.enqueuePracticeProgress(changed, session: localStore.state.sessions.last))
        XCTAssertEqual(try SyncQueue(directory: path).entries, saved)
        failQueue = false
        try coordinator.enqueuePracticeProgress(changed, session: localStore.state.sessions.last)
        let retried = try SyncQueue(directory: path).entries
        let tail = Array(retried.dropFirst(saved.count))
        let attemptIDs = tail.filter { $0.kind == .append }.compactMap { $0.row["id"]?.stringValue?.lowercased() }
        XCTAssertEqual(attemptIDs, [newAttempt.id.uuidString.lowercased()])
        XCTAssertEqual(tail.last?.kind, .undoAttempt)
        XCTAssertEqual(tail.last?.attemptID, newAttempt.id)
        XCTAssertEqual(Array(retried.prefix(saved.count)), saved)
    }

}
