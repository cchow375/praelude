import Foundation
import XCTest
@testable import PraeludeCore

final class DesktopTransferTests: XCTestCase {
    private func fixture() throws -> DesktopTransfer {
        let value: [String: Any] = [
            "format": "praelude-desktop-transfer", "version": 1, "exportedAt": "2026-10-02T12:00:00Z",
            "databaseSHA256": String(repeating: "a", count: 64), "database": Data("database".utf8).base64EncodedString(),
            "tables": [
                "piece": [["id": 4, "title": "Sonata", "composer": "Beethoven", "created_at": "2026-07-11 01:20:42", "archived_at": NSNull(), "completed_at": NSNull()]],
                "region": [["id": 1, "piece_id": 4, "name": "Opening", "m_start": 1, "m_end": 4]],
                "goal": [["id": 2, "piece_id": 4, "text": "Learn opening", "done": 0]],
                "rep": [["id": 7, "block_id": 3, "verdict": "failed"]],
                "rep_block": [["id": 3, "status": "done"]], "session": [["id": 1, "ended_at": "2026-07-11 01:22:48"]],
                "unknown_future_table": [["exact": "preserved"]]
            ], "scores": [:], "scoreFiles": [], "assets": [:], "warnings": []
        ]
        return try DesktopTransfer.decode(JSONSerialization.data(withJSONObject: value))
    }
    @MainActor func testMapsStableTargetsWithoutInventingMobileMasteryOrRewards() throws {
        let transfer = try fixture()
        let library = try transfer.nativeLibrary(at: Date())
        try PracticeStore.validate(library)
        XCTAssertEqual(library.pieces.first?.title, "Sonata")
        XCTAssertEqual(library.pieces.first?.id, try DesktopTransfer.identifier("piece", 4))
        XCTAssertEqual(library.passages.first?.startMeasure, 1)
        XCTAssertEqual(library.goals.first?.title, "Learn opening")
        XCTAssertTrue(library.history.isEmpty)
        XCTAssertTrue(library.rewardLedger.isEmpty)
        XCTAssertEqual(transfer.rows("unknown_future_table").first?["exact"], .string("preserved"))
    }
    @MainActor func testAdditiveImportSurvivesReopenAndRepeatedImportPreservesEdits() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = PracticeStore(directory: directory)
        let original = Piece(title: "Mobile piece")
        try store.addPiece(original)
        let transfer = try fixture(), library = try transfer.nativeLibrary(at: Date())
        let receipt = DesktopImportReceipt(id: transfer.databaseSHA256, archiveFileName: transfer.databaseSHA256 + ".json",
                                           importedAt: Date(), tableCounts: transfer.tables.mapValues(\.count), scoreCount: 0)
        try store.importDesktop(library, receipt: receipt)
        var edited = try XCTUnwrap(store.pieces.first { $0.id == library.pieces[0].id })
        edited.title = "Edited on iPad"
        try store.updatePiece(edited)
        try store.importDesktop(library, receipt: receipt)
        let reopened = PracticeStore(directory: directory)
        XCTAssertEqual(reopened.pieces.count, 2)
        XCTAssertEqual(reopened.pieces.first { $0.id == edited.id }?.title, "Edited on iPad")
        XCTAssertEqual(reopened.state.desktopImports.count, 1)
        XCTAssertEqual(reopened.pieces.first { $0.id == original.id }?.title, original.title)
        XCTAssertTrue(try FileManager.default.contentsOfDirectory(atPath: directory.path).contains { $0.hasPrefix("library-before-mac-import") })
    }
    @MainActor func testImportRejectsInvalidTargetsAndActivePracticeWithoutMutation() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = PracticeStore(directory: directory)
        let transfer = try fixture()
        var library = try transfer.nativeLibrary(at: Date())
        library.passages[0].endMeasure = 0
        let receipt = DesktopImportReceipt(id: transfer.databaseSHA256, archiveFileName: "safe.json", importedAt: Date(), tableCounts: [:], scoreCount: 0)
        XCTAssertThrowsError(try store.importDesktop(library, receipt: receipt))
        XCTAssertTrue(store.pieces.isEmpty)
        let piece = Piece(title: "Playing now")
        try store.addPiece(piece)
        try store.startSet(PracticeConfiguration(pieceID: piece.id))
        XCTAssertThrowsError(try store.importDesktop(try transfer.nativeLibrary(at: Date()), receipt: receipt))
        XCTAssertEqual(store.pieces.count, 1)
    }
    func testRejectsTraversalAndBadRecordIdentifiers() throws {
        XCTAssertFalse(DesktopTransfer.localName("../outside.json"))
        XCTAssertThrowsError(try DesktopTransfer.identifier("piece", -1))
        XCTAssertThrowsError(try DesktopTransfer.integer(["id": .number(1.5)], "id"))
        XCTAssertNotEqual(try DesktopTransfer.identifier("piece", 4), try DesktopTransfer.identifier("region", 4))
        var transfer = try fixture()
        transfer.tables["session"] = [["ended_at": .null]]
        XCTAssertThrowsError(try DesktopTransfer.decode(JSONEncoder().encode(transfer)))
    }
    func testEditionIdentityIsStableAndScopedToPiece() {
        let file = String(repeating: "f", count: 64) + ".pdf"
        XCTAssertEqual(DesktopTransfer.editionIdentifier(pieceID: 4, filename: file), DesktopTransfer.editionIdentifier(pieceID: 4, filename: file))
        XCTAssertNotEqual(DesktopTransfer.editionIdentifier(pieceID: 4, filename: file), DesktopTransfer.editionIdentifier(pieceID: 5, filename: file))
    }
}
