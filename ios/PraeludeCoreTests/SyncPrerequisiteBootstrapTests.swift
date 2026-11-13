import Foundation
import XCTest
@testable import PraeludeCore

/// Exercises the actual dependency graph, rather than the older fake's session/set-only checks.
/// A fresh account has none of the queued row's parents until the bootstrap publishes them.
private actor PrerequisiteFKTransport: SyncTransport {
    private var rows: [String: [String: [String: SyncJSON]]] = [:]
    private var calls: [(table: String, id: String)] = []
    private static let references: [String: [(column: String, table: String)]] = [
        "folders": [("parent_folder_id", "folders")],
        "pieces": [("instrument_id", "instruments")],
        "passages": [("piece_id", "pieces"), ("parent_passage_id", "passages")],
        "practice_sessions": [("piece_id", "pieces")],
        "sets": [("session_id", "practice_sessions"), ("piece_id", "pieces"), ("passage_id", "passages")],
        "attempts": [("set_id", "sets")]
    ]

    private func checkReferences(table: String, row: [String: SyncJSON]) throws {
        for reference in Self.references[table] ?? [] {
            guard let parent = row[reference.column]?.stringValue else { continue }
            guard rows[reference.table]?[parent] != nil else {
                throw SyncError.transport("Missing \(reference.table) parent for \(table).\(reference.column)")
            }
        }
    }

    func upsert(table: String, row: [String: SyncJSON]) async throws -> SyncRPCResult {
        let id = try requiredID(row)
        try checkReferences(table: table, row: row)
        calls.append((table, id))
        if let stored = rows[table]?[id],
           let current = stored["updated_at"]?.stringValue.flatMap(SyncCoding.parseDate),
           let incoming = row["updated_at"]?.stringValue.flatMap(SyncCoding.parseDate), current > incoming {
            return .init(applied: false, row: stored)
        }
        rows[table, default: [:]][id] = row
        return .init(applied: true, row: row)
    }

    func append(table: String, row: [String: SyncJSON]) async throws -> SyncRPCResult {
        let id = try requiredID(row)
        try checkReferences(table: table, row: row)
        calls.append((table, id))
        guard rows[table]?[id] == nil else { return .init(applied: false, row: nil) }
        rows[table, default: [:]][id] = row
        return .init(applied: true, row: row)
    }

    func updateLastPage(pieceID: UUID, lastPage: Int, at: Date) async throws -> SyncRPCResult {
        let id = pieceID.uuidString
        guard var piece = rows["pieces"]?[id] else { throw SyncError.transport("Missing piece for page update") }
        piece["last_page"] = .number(Double(lastPage))
        piece["last_page_updated_at"] = .string(SyncCoding.string(from: at))
        rows["pieces", default: [:]][id] = piece
        return .init(applied: true, row: piece)
    }

    func undoAttempt(attemptID: UUID, undoneAt: Date) async throws -> SyncRPCResult {
        let id = attemptID.uuidString
        guard var attempt = rows["attempts"]?[id], attempt["undone_at"]?.isNull != false else {
            return .init(applied: false, row: nil)
        }
        attempt["undone_at"] = .string(SyncCoding.string(from: undoneAt))
        rows["attempts", default: [:]][id] = attempt
        return .init(applied: true, row: attempt)
    }

    func fetch(table: String, field: String, updatedSince: Date?) async throws -> [[String: SyncJSON]] {
        Array((rows[table] ?? [:]).values)
    }

    func seed(table: String, row: [String: SyncJSON]) throws {
        rows[table, default: [:]][try requiredID(row)] = row
    }
    func row(table: String, id: UUID) -> [String: SyncJSON]? { rows[table]?[id.uuidString] }
    func count(table: String) -> Int { rows[table]?.count ?? 0 }
    func requestedIDs(table: String) -> [String] { calls.filter { $0.table == table }.map(\.id) }

    private func requiredID(_ row: [String: SyncJSON]) throws -> String {
        guard let id = row["id"]?.stringValue else { throw SyncError.transport("Missing test row ID") }
        return id
    }
}

@MainActor
final class SyncPrerequisiteBootstrapTests: XCTestCase {
    private let oldDate = Date(timeIntervalSince1970: 1_700_000_000)
    private let snapshotDate = Date(timeIntervalSince1970: 1_700_001_000)
    private let undoDate = Date(timeIntervalSince1970: 1_700_000_050)

    private struct Fixture {
        var library: LibraryState
        var legacy: [SyncQueueEntry]
        var owner: UUID
        var piece: Piece
        var parentFolder: Folder
        var childFolder: Folder
        var parentPassage: Passage
        var childPassage: Passage
        var attempt: Attempt
        var prerequisiteCount: Int { 9 }
    }

    private func directory() -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("sync-prerequisite-bootstrap-\(UUID())")
    }
    private func row<T: Encodable>(_ value: T) throws -> [String: SyncJSON] {
        try XCTUnwrap(SyncJSON(encoding: value).objectValue)
    }
    private func queue(_ path: URL) throws -> [SyncQueueEntry] { try SyncQueue(directory: path).entries }
    private func diskState(_ path: URL) throws -> SyncEngineState {
        try JSONDecoder().decode(SyncEngineState.self, from: Data(contentsOf: path.appendingPathComponent("sync-state.json")))
    }
    private func assertSuffix(_ entries: [SyncQueueEntry], _ original: [SyncQueueEntry],
                              file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertGreaterThanOrEqual(entries.count, original.count, file: file, line: line)
        XCTAssertEqual(Array(entries.suffix(original.count)), original,
                       "Every old operation, UUID, payload, clock and relative position remains unchanged.", file: file, line: line)
    }

    private func fixture() throws -> Fixture {
        let owner = UUID()
        let instrument = Instrument(family: .keyboard, name: "Piano", createdAt: oldDate, updatedAt: oldDate)
        let tag = Tag(name: "Repertoire", createdAt: oldDate, updatedAt: oldDate)
        let parentFolder = Folder(name: "Parent", createdAt: oldDate, updatedAt: oldDate)
        let childFolder = Folder(name: "Child", parentFolderID: parentFolder.id, createdAt: oldDate, updatedAt: oldDate)
        var piece = Piece(title: "Current score", pageCount: 2, createdAt: oldDate, instrumentID: instrument.id,
                          tagIDs: [tag.id], folderIDs: [childFolder.id], updatedAt: snapshotDate)
        piece.lastPageUpdatedAt = oldDate
        let parentPassage = Passage(pieceID: piece.id, title: "Parent passage", createdAt: oldDate, updatedAt: oldDate)
        let childPassage = Passage(pieceID: piece.id, title: "Child passage", parentPassageID: parentPassage.id,
                                   createdAt: oldDate, updatedAt: oldDate)
        var session = PracticeSession(pieceID: piece.id, focus: "Pulse", startedAt: oldDate)
        let attempt = Attempt(verdict: .clean, date: oldDate.addingTimeInterval(10), bpm: 60)
        var set = ActiveSet(sessionID: session.id,
                            configuration: PracticeConfiguration(pieceID: piece.id, passageID: childPassage.id), startedAt: oldDate)
        set.attempts = [attempt]; set = PracticeEngine.project(set)
        session.attempts = [attempt]
        var library = LibraryState()
        library.profile.ownerID = owner
        library.instruments = [instrument]; library.tags = [tag]
        library.folders = [childFolder, parentFolder] // Deliberately not dependency ordered.
        library.pieces = [piece]; library.passages = [childPassage, parentPassage]
        library.sessions = [session]; library.activeSet = set
        var oldPiece = piece; oldPiece.title = "Older queued score"; oldPiece.updatedAt = oldDate
        var oldSessionRow = try row(PracticeSessionSyncRow(session, pushedAt: oldDate))
        oldSessionRow["updated_at"] = .string("2023-11-14T22:13:20.123456+00:00")
        oldSessionRow["legacy_payload_marker"] = .string("Retain this opaque queued value")
        let legacy: [SyncQueueEntry] = [
            .upsert(table: "practice_sessions", row: oldSessionRow, enqueuedAt: oldDate),
            .upsert(table: "sets", row: try row(SetSyncRow(set, pushedAt: oldDate)), enqueuedAt: oldDate.addingTimeInterval(1)),
            .append(table: "attempts", row: try row(AttemptSyncRow(attempt, setID: set.id)), enqueuedAt: oldDate.addingTimeInterval(2)),
            .undoAttempt(attemptID: attempt.id, undoneAt: undoDate, enqueuedAt: undoDate),
            .updateLastPage(pieceID: piece.id, lastPage: 2, at: undoDate, enqueuedAt: undoDate),
            .upsert(table: "pieces", row: try row(PieceSyncRow(oldPiece)), enqueuedAt: oldDate.addingTimeInterval(3)),
            .upsert(table: "passages", row: try row(PassageSyncRow(childPassage)), enqueuedAt: oldDate.addingTimeInterval(4)),
            .upsert(table: "folders", row: try row(FolderSyncRow(childFolder)), enqueuedAt: oldDate.addingTimeInterval(5))
        ]
        return Fixture(library: library, legacy: legacy, owner: owner, piece: piece, parentFolder: parentFolder,
                       childFolder: childFolder, parentPassage: parentPassage, childPassage: childPassage, attempt: attempt)
    }

    private func seedLegacy(_ fixture: Fixture, into engine: SyncEngine, at path: URL) throws -> [SyncQueueEntry] {
        try engine.bindAccount(fixture.owner)
        try engine.enqueueSnapshot(fixture.legacy)
        return try queue(path) // Existing nullable normalization belongs to the original queue.
    }

    func testChildFirstLegacyQueueBootstrapsAllParentsAndDrainsIntoEmptyServer() async throws {
        let path = directory(); defer { try? FileManager.default.removeItem(at: path) }
        let fixture = try fixture(), transport = PrerequisiteFKTransport()
        let engine = SyncEngine(transport: transport, directory: path, now: { self.snapshotDate })
        let original = try seedLegacy(fixture, into: engine, at: path)
        let failedBeforeRepair = await engine.drain()
        XCTAssertFalse(failedBeforeRepair, "The fake must reproduce the real missing piece FK at the first queued session.")
        XCTAssertEqual(try queue(path), original)
        let prepared = try await engine.prepareLibrarySnapshot(fixture.library)
        try engine.bootstrapPrerequisites(using: prepared)
        let repaired = try queue(path)
        assertSuffix(repaired, original)
        let prefix = Array(repaired.dropLast(original.count))
        XCTAssertEqual(prefix.count, fixture.prerequisiteCount)
        XCTAssertTrue(prefix.allSatisfy { $0.kind == .upsert })
        XCTAssertFalse(prefix.contains { $0.table == "attempts" }, "Original event writes retain their existing order.")
        let folderIDs = prefix.filter { $0.table == "folders" }.compactMap { $0.row["id"]?.stringValue }
        XCTAssertEqual(folderIDs, [fixture.parentFolder.id.uuidString, fixture.childFolder.id.uuidString])
        let passageIDs = prefix.filter { $0.table == "passages" }.compactMap { $0.row["id"]?.stringValue }
        XCTAssertEqual(passageIDs, [fixture.parentPassage.id.uuidString, fixture.childPassage.id.uuidString])
        let drained = await engine.drain()
        XCTAssertTrue(drained); XCTAssertEqual(engine.pendingCount, 0)
        let attemptCount = await transport.count(table: "attempts")
        let savedAttempt = await transport.row(table: "attempts", id: fixture.attempt.id)
        let savedPiece = await transport.row(table: "pieces", id: fixture.piece.id)
        XCTAssertEqual(attemptCount, 1)
        XCTAssertEqual(savedAttempt?["undone_at"], .string(SyncCoding.string(from: undoDate)))
        XCTAssertEqual(savedPiece?["title"], .string("Current score"), "Replayed older metadata cannot undo the bootstrap's current snapshot.")
    }

    func testBootstrapKeepsExactOriginalEntryIDsPayloadsAndClocksAsSuffix() async throws {
        let path = directory(); defer { try? FileManager.default.removeItem(at: path) }
        let fixture = try fixture()
        let engine = SyncEngine(transport: PrerequisiteFKTransport(), directory: path, now: { self.snapshotDate })
        let original = try seedLegacy(fixture, into: engine, at: path)
        let signatures = engine.state.outboundSnapshots
        let prepared = try await engine.prepareLibrarySnapshot(fixture.library)
        try engine.bootstrapPrerequisites(using: prepared)
        let repaired = try queue(path)
        assertSuffix(repaired, original)
        XCTAssertEqual(Array(repaired.suffix(original.count)).map(\.id), original.map(\.id))
        XCTAssertEqual(repaired.suffix(original.count).first?.row["updated_at"],
                       .string("2023-11-14T22:13:20.123456+00:00"))
        XCTAssertEqual(engine.state.outboundSnapshots, signatures, "The repair must not turn queued signatures into delivery receipts.")
        XCTAssertEqual(try diskState(path).prerequisiteBootstrapVersion, 1)
        XCTAssertEqual(try diskState(path).prerequisiteBootstrapOwnerID, fixture.owner)
    }

    func testPreviouslyCachedPrerequisiteSignaturesCannotSuppressBootstrapPrefix() async throws {
        let path = directory(); defer { try? FileManager.default.removeItem(at: path) }
        let fixture = try fixture()
        let engine = SyncEngine(transport: PrerequisiteFKTransport(), directory: path, now: { self.snapshotDate })
        try engine.bindAccount(fixture.owner)
        try engine.enqueueLibrarySnapshot(fixture.library)
        let cached = try queue(path), signatures = engine.state.outboundSnapshots
        XCTAssertNil(engine.state.prerequisiteBootstrapVersion, "An empty queue needs no historical repair marker.")
        let prepared = try await engine.prepareLibrarySnapshot(fixture.library)
        try engine.bootstrapPrerequisites(using: prepared)
        let repaired = try queue(path)
        assertSuffix(repaired, cached)
        XCTAssertEqual(repaired.count, cached.count + fixture.prerequisiteCount)
        XCTAssertEqual(engine.state.outboundSnapshots, signatures)
    }

    func testRepeatedBootstrapAndRelaunchDoNotGrowMarkedQueue() async throws {
        let path = directory(); defer { try? FileManager.default.removeItem(at: path) }
        let fixture = try fixture(), transport = PrerequisiteFKTransport()
        let engine = SyncEngine(transport: transport, directory: path, now: { self.snapshotDate })
        _ = try seedLegacy(fixture, into: engine, at: path)
        let prepared = try await engine.prepareLibrarySnapshot(fixture.library)
        try engine.bootstrapPrerequisites(using: prepared)
        let repaired = try queue(path)
        try engine.bootstrapPrerequisites(using: prepared)
        XCTAssertEqual(try queue(path), repaired)
        let reopened = SyncEngine(transport: transport, directory: path, now: { self.snapshotDate })
        let newPrepared = try await reopened.prepareLibrarySnapshot(fixture.library)
        try reopened.bootstrapPrerequisites(using: newPrepared)
        XCTAssertEqual(reopened.pendingCount, repaired.count)
        XCTAssertEqual(try queue(path), repaired)
    }

    func testFailedQueuePrependLeavesOriginalQueueAndMarkerUnchanged() async throws {
        let path = directory(); defer { try? FileManager.default.removeItem(at: path) }
        let fixture = try fixture()
        var failQueueWrite = false
        let engine = SyncEngine(transport: PrerequisiteFKTransport(), directory: path, now: { self.snapshotDate }, writeData: { data, url in
            if failQueueWrite, url.lastPathComponent == "sync-queue.json" { throw SyncError.transport("Injected queue write failure") }
            try data.write(to: url, options: .atomic)
        })
        let original = try seedLegacy(fixture, into: engine, at: path)
        let originalQueueBytes = try Data(contentsOf: path.appendingPathComponent("sync-queue.json"))
        let originalStateBytes = try Data(contentsOf: path.appendingPathComponent("sync-state.json"))
        let prepared = try await engine.prepareLibrarySnapshot(fixture.library)
        failQueueWrite = true
        XCTAssertThrowsError(try engine.bootstrapPrerequisites(using: prepared))
        XCTAssertEqual(engine.pendingCount, original.count); XCTAssertEqual(try queue(path), original)
        XCTAssertEqual(try Data(contentsOf: path.appendingPathComponent("sync-queue.json")), originalQueueBytes)
        XCTAssertEqual(try Data(contentsOf: path.appendingPathComponent("sync-state.json")), originalStateBytes)
        XCTAssertNil(engine.state.prerequisiteBootstrapVersion)
        failQueueWrite = false
        try engine.bootstrapPrerequisites(using: prepared)
        assertSuffix(try queue(path), original)
    }

    func testFailedMarkerSaveRetainsOldSuffixAndRelaunchRetrySafelyReplaysPrefix() async throws {
        let path = directory(); defer { try? FileManager.default.removeItem(at: path) }
        let fixture = try fixture(), transport = PrerequisiteFKTransport()
        var failStateWrite = false
        let engine = SyncEngine(transport: transport, directory: path, now: { self.snapshotDate }, writeData: { data, url in
            if failStateWrite, url.lastPathComponent == "sync-state.json" { throw SyncError.transport("Injected marker save failure") }
            try data.write(to: url, options: .atomic)
        })
        let original = try seedLegacy(fixture, into: engine, at: path)
        let prepared = try await engine.prepareLibrarySnapshot(fixture.library)
        failStateWrite = true
        XCTAssertThrowsError(try engine.bootstrapPrerequisites(using: prepared))
        let firstPrefix = try queue(path)
        XCTAssertEqual(firstPrefix.count, original.count + fixture.prerequisiteCount)
        assertSuffix(firstPrefix, original)
        XCTAssertNil(try diskState(path).prerequisiteBootstrapVersion)
        let reopened = SyncEngine(transport: transport, directory: path, now: { self.snapshotDate })
        let retry = try await reopened.prepareLibrarySnapshot(fixture.library)
        try reopened.bootstrapPrerequisites(using: retry)
        let repaired = try queue(path)
        assertSuffix(repaired, firstPrefix)
        XCTAssertEqual(repaired.count, firstPrefix.count + fixture.prerequisiteCount)
        try reopened.bootstrapPrerequisites(using: retry)
        XCTAssertEqual(try queue(path), repaired)
        let drained = await reopened.drain()
        XCTAssertTrue(drained); XCTAssertEqual(reopened.pendingCount, 0)
        let count = await transport.count(table: "attempts")
        XCTAssertEqual(count, 1, "A repeated idempotent parent prefix never duplicates the original repetition.")
    }

    func testRejectedStaleParentAndFailedLocalAdoptionCannotDiscardOldQueue() async throws {
        let path = directory(); defer { try? FileManager.default.removeItem(at: path) }
        let fixture = try fixture(), transport = PrerequisiteFKTransport()
        var newerPiece = try row(PieceSyncRow(fixture.piece))
        newerPiece["updated_at"] = .string(SyncCoding.string(from: snapshotDate.addingTimeInterval(500)))
        newerPiece["title"] = .string("Newer cloud score")
        try await transport.seed(table: "pieces", row: newerPiece)
        let engine = SyncEngine(transport: transport, directory: path, now: { self.snapshotDate })
        let original = try seedLegacy(fixture, into: engine, at: path)
        let prepared = try await engine.prepareLibrarySnapshot(fixture.library)
        try engine.bootstrapPrerequisites(using: prepared)
        var attemptedAdoptions: [[String: SyncJSON]] = []
        let failed = await engine.drain { table, row in
            if table == "pieces" { attemptedAdoptions.append(row); throw SyncError.transport("Injected local adoption failure") }
        }
        XCTAssertFalse(failed)
        XCTAssertEqual(attemptedAdoptions, [newerPiece])
        assertSuffix(try queue(path), original)
        let callsBeforeRetry = await transport.requestedIDs(table: "attempts")
        XCTAssertTrue(callsBeforeRetry.isEmpty, "A failed prerequisite adoption must stop before old child operations.")
        var adoptedPiece: [String: SyncJSON]?
        let drained = await engine.drain { table, row in if table == "pieces" { adoptedPiece = row } }
        XCTAssertTrue(drained); XCTAssertEqual(engine.pendingCount, 0)
        var newerPieceWithReplayedPage = newerPiece
        newerPieceWithReplayedPage["last_page"] = .number(2)
        newerPieceWithReplayedPage["last_page_updated_at"] = .string(SyncCoding.string(from: undoDate))
        XCTAssertEqual(adoptedPiece, newerPieceWithReplayedPage,
                       "The original page RPC has its own clock; cloud metadata and its update clock remain exact.")
        let savedPiece = await transport.row(table: "pieces", id: fixture.piece.id)
        let attempts = await transport.count(table: "attempts")
        XCTAssertEqual(savedPiece?["title"], .string("Newer cloud score")); XCTAssertEqual(attempts, 1)
    }

    func testEmptyAndUnboundQueuesDoNotAcquireBootstrapMarker() async throws {
        let emptyPath = directory(), unboundPath = directory()
        defer { try? FileManager.default.removeItem(at: emptyPath); try? FileManager.default.removeItem(at: unboundPath) }
        let fixture = try fixture()
        let empty = SyncEngine(transport: PrerequisiteFKTransport(), directory: emptyPath)
        try empty.bindAccount(fixture.owner)
        let emptyPrepared = try await empty.prepareLibrarySnapshot(fixture.library)
        try empty.bootstrapPrerequisites(using: emptyPrepared)
        XCTAssertEqual(empty.pendingCount, 0); XCTAssertNil(empty.state.prerequisiteBootstrapVersion)
        let unbound = SyncEngine(transport: PrerequisiteFKTransport(), directory: unboundPath)
        try unbound.enqueueSnapshot(fixture.legacy)
        let original = try queue(unboundPath)
        let unboundPrepared = try await unbound.prepareLibrarySnapshot(fixture.library)
        try unbound.bootstrapPrerequisites(using: unboundPrepared)
        XCTAssertEqual(try queue(unboundPath), original)
        XCTAssertNil(unbound.state.prerequisiteBootstrapVersion)
    }
}
