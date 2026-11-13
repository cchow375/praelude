import Foundation
import XCTest
@testable import PraeludeCore

final class PassageCardStoreTests: XCTestCase {
    private func values() -> (Piece, Passage) {
        let piece = Piece(title: "Paper study", pdfFileName: UUID().uuidString + ".pdf", pageCount: 1)
        return (piece, Passage(pieceID: piece.id, title: "Opening", regions: [PassageRegion(page: 1, x: 0, y: 0, width: 1, height: 1)]))
    }

    @MainActor func testCardPublishesPieceFolderAndPassageInOneRevisionAndSurvivesRelaunch() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = PracticeStore(directory: directory)
        let (piece, passage) = values()
        let before = store.state.revision
        try store.addPassageCard(piece: piece, passage: passage)
        XCTAssertEqual(store.state.revision, before + 1)
        XCTAssertEqual(store.state.passages, [passage])
        XCTAssertEqual(store.pieces.count, 1)
        XCTAssertTrue(PassageCardLibrary.isPhotoPiece(try XCTUnwrap(store.pieces.first)))
        XCTAssertEqual(store.pieces.first?.folderIDs, store.state.folders.map(\.id))
        XCTAssertEqual(store.state.folders.first?.name, "Photo passages")
        let reopened = PracticeStore(directory: directory)
        XCTAssertFalse(reopened.isReadOnly)
        XCTAssertEqual(reopened.state, store.state)
    }

    @MainActor func testFailedLedgerWritePublishesNoneOfTheCard() {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = PracticeStore(directory: directory, writeData: { _, _ in throw CocoaError(.fileWriteOutOfSpace) })
        let (piece, passage) = values()
        let before = store.state
        XCTAssertThrowsError(try store.addPassageCard(piece: piece, passage: passage))
        XCTAssertEqual(store.state, before)
        XCTAssertFalse(FileManager.default.fileExists(atPath: store.fileURL.path))
    }

    @MainActor func testPreparedCardSaveAndCancellationNeverPublishPartialRows() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = PracticeStore(directory: directory)
        let (piece, passage) = values()
        let cancelled = Task { @MainActor in try await store.addPassageCardPreparedAsync(piece: piece, passage: passage) }
        cancelled.cancel()
        do { try await cancelled.value; XCTFail("Cancelled save published") } catch { XCTAssertTrue(error is CancellationError) }
        XCTAssertTrue(store.state.pieces.isEmpty)
        XCTAssertTrue(store.state.folders.isEmpty)
        try await store.addPassageCardPreparedAsync(piece: piece, passage: passage)
        XCTAssertEqual(store.state.passages, [passage])
        XCTAssertEqual(store.pieces.count, 1)
        XCTAssertEqual(PracticeStore(directory: directory).state, store.state)
    }

    @MainActor func testDifferentGuestLibrariesGetDifferentPhotoFolderIDs() throws {
        let a = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let b = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: a); try? FileManager.default.removeItem(at: b) }
        let first = PracticeStore(directory: a), second = PracticeStore(directory: b)
        let (piece, passage) = values(), (other, card) = values()
        try first.addPassageCard(piece: piece, passage: passage)
        try second.addPassageCard(piece: other, passage: card)
        XCTAssertNotEqual(first.state.folders.first?.id, second.state.folders.first?.id)
    }

    func testLegacyPieceDecodesWithPhotoFlagOffAndNewFlagSurvivesRoundtrip() throws {
        var piece = values().0
        let encoder = JSONEncoder(), decoder = JSONDecoder()
        let data = try encoder.encode(piece)
        var dictionary = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        dictionary.removeValue(forKey: "isPhotoPassage")
        let legacy = try decoder.decode(Piece.self, from: JSONSerialization.data(withJSONObject: dictionary))
        XCTAssertFalse(legacy.isPhotoPassage)
        piece.isPhotoPassage = true
        XCTAssertTrue(try decoder.decode(Piece.self, from: encoder.encode(piece)).isPhotoPassage)
    }

    @MainActor func testSecondPhotoPreservesFirstPDFAndDoesNotCreateDuplicateOriginFolders() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = PracticeStore(directory: directory)
        let (first, a) = values(), (second, b) = values()
        try store.addPassageCard(piece: first, passage: a)
        let original = store.pieces[0]
        try store.addPassageCard(piece: second, passage: b)
        XCTAssertEqual(store.pieces[0], original)
        XCTAssertEqual(store.state.folders.count, 1)
        XCTAssertEqual(store.state.passages.map(\.id), [a.id, b.id])
        XCTAssertThrowsError(try store.addPassageCard(piece: first, passage: a))
        XCTAssertEqual(store.pieces.count, 2)
    }

    @MainActor func testInvalidPageOrUnrelatedPieceCannotLeavePartialCard() {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = PracticeStore(directory: directory)
        let (piece, original) = values()
        var invalid = original; invalid.regions[0].page = 2
        XCTAssertThrowsError(try store.addPassageCard(piece: piece, passage: invalid))
        invalid = original; invalid.pieceID = UUID()
        XCTAssertThrowsError(try store.addPassageCard(piece: piece, passage: invalid))
        XCTAssertTrue(store.pieces.isEmpty)
        XCTAssertTrue(store.state.passages.isEmpty)
        XCTAssertTrue(store.state.folders.isEmpty)
    }

    @MainActor func testUnpracticedFilterIgnoresUndoneRepetitions() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = PracticeStore(directory: directory)
        let (piece, passage) = values()
        try store.addPassageCard(piece: piece, passage: passage)
        try store.startSet(PracticeConfiguration(pieceID: piece.id, passageID: passage.id, startBPM: 60, targetBPM: 100))
        XCTAssertTrue(PassageCardLibrary.practicedPassageIDs(in: store.state).isEmpty)
        try store.record(.clean)
        XCTAssertEqual(PassageCardLibrary.practicedPassageIDs(in: store.state), [passage.id])
        try store.undo()
        XCTAssertTrue(PassageCardLibrary.practicedPassageIDs(in: store.state).isEmpty)
    }
}
