import Foundation
import XCTest
@testable import PraeludeCore

/// Covers the one schema3 field that had a home (`Piece.customCoverRef`) but no `validate(_:)`
/// bound yet — added alongside the custom-cover feature itself (see "(C) Schema3.md" for why
/// every schema3 field gets a matching validate bound).
final class LibraryValidationTests: XCTestCase {
    @MainActor func testDuplicatePieceAndPassageIDsThrowBeforeBuildingValidationIndexes() throws {
        var library = LibraryState()
        let piece = Piece(title: "Study")
        library.pieces = [piece, piece]
        XCTAssertThrowsError(try PracticeStore.validate(library))
        library.pieces = [piece]
        let passage = Passage(pieceID: piece.id, title: "Opening")
        library.passages = [passage, passage]
        XCTAssertThrowsError(try PracticeStore.validate(library))
    }

    @MainActor func testHugeImportedRecordingByteCountsAreRejectedWithoutIntegerOverflow() throws {
        var library = LibraryState()
        library.recordings = [
            AudioRecording(fileName: "first.m4a", duration: 1, byteSize: 1),
            AudioRecording(fileName: "oversized.m4a", duration: 1, byteSize: Int.max)
        ]
        XCTAssertThrowsError(try PracticeStore.validate(library))
    }

    @MainActor func testOverflowingRewardTotalsAndExhaustedMutableCountersAreRejected() throws {
        var library = LibraryState()
        library.rewardLedger = [RewardLedgerEntry(coinsDelta: Int.max, xpDelta: Int.max, reason: "Imported"),
                                RewardLedgerEntry(coinsDelta: 1, xpDelta: 1, reason: "Imported")]
        XCTAssertThrowsError(try PracticeStore.validate(library))
        library.rewardLedger = []
        library.rewardsState.streakDays = Int.max
        XCTAssertThrowsError(try PracticeStore.validate(library))
        library.rewardsState.streakDays = 0
        library.rewardsState.streakFreezesAvailable = Int.max
        XCTAssertThrowsError(try PracticeStore.validate(library))
    }

    @MainActor private func store() -> (PracticeStore, URL) {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("praelude-ios-libraryvalidation-\(UUID())")
        return (PracticeStore(directory: directory), directory)
    }

    @MainActor func testValidCustomCoverFilenameIsAccepted() throws {
        let (store, directory) = store()
        defer { try? FileManager.default.removeItem(at: directory) }
        var piece = Piece(title: "Nocturne")
        try store.addPiece(piece)
        piece.customCoverRef = UUID().uuidString + ".jpg"
        piece.updatedAt = Date()
        XCTAssertNoThrow(try store.updatePiece(piece))
        XCTAssertEqual(store.pieces.first?.customCoverRef, piece.customCoverRef)
    }

    @MainActor func testCustomCoverFilenameRejectsPathTraversalAndWrongExtension() throws {
        let (store, directory) = store()
        defer { try? FileManager.default.removeItem(at: directory) }
        var piece = Piece(title: "Nocturne")
        try store.addPiece(piece)
        for bad in ["../evil.jpg", "cover.pdf", "no-extension", "a/b.png", ""] {
            var invalid = piece
            invalid.customCoverRef = bad.isEmpty ? "" : bad
            invalid.updatedAt = Date()
            XCTAssertThrowsError(try store.updatePiece(invalid), "Expected \(bad) to be rejected")
        }
        piece.customCoverRef = "legit-cover.png"
        piece.updatedAt = Date()
        XCTAssertNoThrow(try store.updatePiece(piece))
    }
}
