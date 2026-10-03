import Foundation
import XCTest
@testable import PraeludeCore

/// Models the server's selective-key update semantics: omitted columns keep their old values,
/// while JSON null clears them. The ordinary fake server replaces the entire row and would miss
/// this regression when a Codable nil silently disappears from the wire.
private actor NullablePatchTransport: SyncTransport {
    private var rows: [String: [String: [String: SyncJSON]]] = [:]
    func upsert(table: String, row: [String: SyncJSON]) async throws -> SyncRPCResult {
        let id = row["id"]?.stringValue ?? "singleton"
        var saved = rows[table]?[id] ?? [:]
        saved.merge(row) { _, incoming in incoming }
        rows[table, default: [:]][id] = saved
        return SyncRPCResult(applied: true, row: saved)
    }
    func append(table: String, row: [String: SyncJSON]) async throws -> SyncRPCResult {
        try await upsert(table: table, row: row)
    }
    func updateLastPage(pieceID: UUID, lastPage: Int, at: Date) async throws -> SyncRPCResult {
        SyncRPCResult(applied: true, row: nil)
    }
    func undoAttempt(attemptID: UUID, undoneAt: Date) async throws -> SyncRPCResult {
        SyncRPCResult(applied: true, row: nil)
    }
    func fetch(table: String, field: String, updatedSince: Date?) async throws -> [[String: SyncJSON]] {
        Array((rows[table] ?? [:]).values)
    }
    func row(table: String, id: UUID) -> [String: SyncJSON]? { rows[table]?[id.uuidString] }
}

@MainActor final class SyncNullableColumnsTests: XCTestCase {
    private func directory() -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("sync-nullable-\(UUID())")
    }

    func testLibrarySnapshotClearsSavedNullableMetadataWithSelectiveServer() async throws {
        let path = directory(); defer { try? FileManager.default.removeItem(at: path) }
        let transport = NullablePatchTransport()
        let engine = SyncEngine(transport: transport, directory: path)
        var library = LibraryState()
        var piece = Piece(title: "Sonata", instrumentID: UUID(), difficulty: 8, customCoverRef: "cover.png")
        var goal = PracticeGoal(title: "Memory", pieceID: piece.id, dueDate: Date())
        library.pieces = [piece]; library.goals = [goal]
        try engine.enqueueLibrarySnapshot(library)
        let initial = await engine.drain(); XCTAssertTrue(initial)
        piece.instrumentID = nil; piece.difficulty = nil; piece.customCoverRef = nil
        goal.pieceID = nil; goal.dueDate = nil
        library.pieces = [piece]; library.goals = [goal]
        try engine.enqueueLibrarySnapshot(library)
        let cleared = await engine.drain(); XCTAssertTrue(cleared)
        let fetchedPiece = await transport.row(table: "pieces", id: piece.id)
        let savedPiece = try XCTUnwrap(fetchedPiece)
        let fetchedGoal = await transport.row(table: "practice_goals", id: goal.id)
        let savedGoal = try XCTUnwrap(fetchedGoal)
        for key in ["instrument_id", "difficulty", "custom_cover_ref"] { XCTAssertEqual(savedPiece[key], .null, key) }
        for key in ["piece_id", "due_date"] { XCTAssertEqual(savedGoal[key], .null, key) }
        XCTAssertNil(try SyncJSON.object(savedPiece).decoded(as: PieceSyncRow.self).coreValue?.customCoverRef)
        XCTAssertNil(try SyncJSON.object(savedGoal).decoded(as: PracticeGoalSyncRow.self).coreValue.dueDate)
    }

    func testExplicitPushAndPullReceiptAgreeForNilAndDefaultTempoNull() async throws {
        let path = directory(); defer { try? FileManager.default.removeItem(at: path) }
        let transport = NullablePatchTransport()
        let engine = SyncEngine(transport: transport, directory: path)
        let piece = Piece(title: "Sonata")
        let row = try XCTUnwrap(SyncJSON(encoding: PieceSyncRow(piece)).objectValue)
        XCTAssertEqual(row["default_practice_bpm"], .null)
        try engine.enqueueUpsert(table: "pieces", row: row)
        let drained = await engine.drain(); XCTAssertTrue(drained)
        let fetchedRow = await transport.row(table: "pieces", id: piece.id)
        let serverRow = try XCTUnwrap(fetchedRow)
        try engine.acknowledgePulledRow(table: "pieces", row: try XCTUnwrap(SyncJSON(encoding:
            SyncJSON.object(serverRow).decoded(as: PieceSyncRow.self)).objectValue))
        try engine.enqueueUpsert(table: "pieces", row: row)
        XCTAssertEqual(engine.pendingCount, 0, "Acknowledged nulls must not become endless outbound echoes.")
        var legacy = row
        legacy.removeValue(forKey: "default_practice_bpm")
        legacy.removeValue(forKey: "score_sections")
        legacy.removeValue(forKey: "measure_anchors")
        try engine.enqueueUpsert(table: "pieces", row: legacy)
        let legacyDrain = await engine.drain(); XCTAssertTrue(legacyDrain)
        let queue = try SyncQueue(directory: path)
        XCTAssertTrue(queue.entries.isEmpty)
        let snapshot = try XCTUnwrap(engine.state.outboundSnapshots?["upsert#pieces#\(piece.id.uuidString)"])
        XCTAssertNil(snapshot["default_practice_bpm"], "Unknown old-client columns must remain absent.")
        XCTAssertNil(snapshot["score_sections"])
        XCTAssertNil(snapshot["measure_anchors"])
    }

    func testAlreadyPersistedOmittedNilQueueEntryIsClearedAfterUpgrade() async throws {
        let path = directory(); defer { try? FileManager.default.removeItem(at: path) }
        let transport = NullablePatchTransport()
        let goal = PracticeGoal(title: "Memory", pieceID: UUID(), dueDate: Date())
        _ = try await transport.upsert(table: "practice_goals", row: try XCTUnwrap(SyncJSON(encoding: PracticeGoalSyncRow(goal)).objectValue))
        var cleared = goal; cleared.pieceID = nil; cleared.dueDate = nil
        let oldEncoded = try XCTUnwrap(SyncJSON(encoding: PracticeGoalSyncRow(cleared)).objectValue)
        XCTAssertNil(oldEncoded["due_date"])
        let oldQueue = try SyncQueue(directory: path)
        try oldQueue.enqueue(.upsert(table: "practice_goals", row: oldEncoded))
        let relaunched = SyncEngine(transport: transport, directory: path)
        let drained = await relaunched.drain(); XCTAssertTrue(drained)
        let fetched = await transport.row(table: "practice_goals", id: goal.id)
        let saved = try XCTUnwrap(fetched)
        XCTAssertEqual(saved["piece_id"], .null)
        XCTAssertEqual(saved["due_date"], .null)
    }
}
