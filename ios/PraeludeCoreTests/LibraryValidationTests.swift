import Foundation
import XCTest
@testable import PraeludeCore

/// Covers the one schema3 field that had a home (`Piece.customCoverRef`) but no `validate(_:)`
/// bound yet — added alongside the custom-cover feature itself (see "(C) Schema3.md" for why
/// every schema3 field gets a matching validate bound).
final class LibraryValidationTests: XCTestCase {
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
