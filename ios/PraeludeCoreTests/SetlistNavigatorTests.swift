import Foundation
import XCTest
@testable import PraeludeCore

final class SetlistNavigatorTests: XCTestCase {
    private func piece(_ title: String, deleted: Bool = false) -> Piece {
        Piece(title: title, deletedAt: deleted ? Date() : nil)
    }

    func testValidItemsDropsMissingAndDeletedPiecesButKeepsOrderAndDuplicates() {
        let a = piece("A"), b = piece("B"), deleted = piece("Deleted", deleted: true)
        let missing = UUID()
        let items = [
            SetlistItem(pieceID: a.id, movementLabel: "I"),
            SetlistItem(pieceID: missing),
            SetlistItem(pieceID: deleted.id),
            SetlistItem(pieceID: b.id),
            SetlistItem(pieceID: a.id, movementLabel: "II") // same piece again, a different movement
        ]
        let setlist = Setlist(name: "Recital", items: items)
        let valid = SetlistNavigator.validItems(setlist, pieces: [a, b, deleted])
        XCTAssertEqual(valid.map(\.pieceID), [a.id, b.id, a.id])
        XCTAssertEqual(valid.map(\.movementLabel), ["I", nil, "II"])
    }

    func testItemAfterWalksForwardAndBackwardAndStopsAtEnds() {
        let a = piece("A"), b = piece("B"), c = piece("C")
        let items = [SetlistItem(pieceID: a.id), SetlistItem(pieceID: b.id), SetlistItem(pieceID: c.id)]
        let setlist = Setlist(name: "Program", items: items)
        let pieces = [a, b, c]

        // No current item: offset 1 starts at the first item; offset -1 is past the start.
        XCTAssertEqual(SetlistNavigator.item(after: nil, offset: 1, in: setlist, pieces: pieces)?.pieceID, a.id)
        XCTAssertNil(SetlistNavigator.item(after: nil, offset: -1, in: setlist, pieces: pieces))

        let first = items[0]
        XCTAssertEqual(SetlistNavigator.item(after: first.id, offset: 1, in: setlist, pieces: pieces)?.pieceID, b.id)
        XCTAssertNil(SetlistNavigator.item(after: first.id, offset: -1, in: setlist, pieces: pieces))

        let last = items[2]
        XCTAssertEqual(SetlistNavigator.item(after: last.id, offset: -1, in: setlist, pieces: pieces)?.pieceID, b.id)
        XCTAssertNil(SetlistNavigator.item(after: last.id, offset: 1, in: setlist, pieces: pieces))
    }

    func testItemAfterSkipsAPieceDeletedAfterTheSetlistWasBuilt() {
        let a = piece("A")
        let removed = piece("Removed", deleted: true)
        let items = [SetlistItem(pieceID: a.id), SetlistItem(pieceID: removed.id)]
        let setlist = Setlist(name: "Program", items: items)
        // The removed piece never appears in the valid ordering, so "next" from A finds nothing.
        XCTAssertNil(SetlistNavigator.item(after: items[0].id, offset: 1, in: setlist, pieces: [a, removed]))
    }

    func testEmptySetlistNeverCrashesAndAlwaysReturnsNil() {
        let setlist = Setlist(name: "Empty")
        XCTAssertNil(SetlistNavigator.item(after: nil, offset: 1, in: setlist, pieces: []))
        XCTAssertTrue(SetlistNavigator.validItems(setlist, pieces: []).isEmpty)
    }
}
