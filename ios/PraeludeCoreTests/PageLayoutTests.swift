import Foundation
import XCTest
@testable import PraeludeCore

final class PageLayoutTests: XCTestCase {
    @MainActor private func fixture(pageCount: Int = 5) throws -> (PracticeStore, URL, Piece) {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("praelude-ios-pagelayout-\(UUID())")
        let store = PracticeStore(directory: directory)
        let piece = Piece(title: "Étude", pdfFileName: "score.pdf", pageCount: pageCount)
        try store.addPiece(piece)
        return (store, directory, piece)
    }

    // MARK: - Pure effectivePages/effectiveCount

    func testEffectivePagesWithNoEditsIsIdentityOrder() {
        let pieceID = UUID()
        let pages = PageLayout.effectivePages(pageEdits: [], pieceID: pieceID, sourcePageCount: 4)
        XCTAssertEqual(pages.map(\.displayOrder), [1, 2, 3, 4])
        XCTAssertEqual(pages.map(\.sourcePage), [1, 2, 3, 4])
        XCTAssertEqual(pages.map(\.kind), [.original, .original, .original, .original])
        XCTAssertEqual(PageLayout.effectiveCount(pageEdits: [], pieceID: pieceID, sourcePageCount: 4), 4)
    }

    func testEffectivePagesIgnoresOtherPiecesAndDeletedRows() {
        let pieceID = UUID(); let otherID = UUID()
        let now = Date()
        let edits = [
            PageEdit(pieceID: pieceID, sourcePage: 2, displayOrder: 1, createdAt: now, updatedAt: now),
            PageEdit(pieceID: pieceID, sourcePage: 1, displayOrder: 2, createdAt: now, updatedAt: now),
            PageEdit(pieceID: pieceID, sourcePage: 3, displayOrder: 3, deleted: true, createdAt: now, updatedAt: now),
            PageEdit(pieceID: pieceID, sourcePage: 4, displayOrder: 4, createdAt: now, updatedAt: now, deletedAt: now),
            PageEdit(pieceID: otherID, sourcePage: 1, displayOrder: 1, createdAt: now, updatedAt: now)
        ]
        let pages = PageLayout.effectivePages(pageEdits: edits, pieceID: pieceID, sourcePageCount: 4)
        // Two active rows survive (the .deleted flag and the tombstone each remove one); the
        // returned displayOrder is always a contiguous 1...count regardless of storage gaps.
        XCTAssertEqual(pages.map(\.sourcePage), [2, 1])
        XCTAssertEqual(pages.map(\.displayOrder), [1, 2])
        XCTAssertEqual(PageLayout.effectiveCount(pageEdits: edits, pieceID: pieceID, sourcePageCount: 4), 2)
    }

    func testEffectivePagesCarriesBlankAndStaffInsertionsWithNilSourcePage() {
        let pieceID = UUID(); let now = Date()
        let edits = [
            PageEdit(pieceID: pieceID, sourcePage: 1, displayOrder: 1, kind: .original, createdAt: now, updatedAt: now),
            PageEdit(pieceID: pieceID, sourcePage: nil, displayOrder: 2, kind: .blank, createdAt: now, updatedAt: now),
            PageEdit(pieceID: pieceID, sourcePage: nil, displayOrder: 3, kind: .staff, createdAt: now, updatedAt: now),
            PageEdit(pieceID: pieceID, sourcePage: 2, displayOrder: 4, kind: .original, createdAt: now, updatedAt: now)
        ]
        let pages = PageLayout.effectivePages(pageEdits: edits, pieceID: pieceID, sourcePageCount: 2)
        XCTAssertEqual(pages.map(\.kind), [.original, .blank, .staff, .original])
        XCTAssertEqual(pages.map(\.sourcePage), [1, nil, nil, 2])
        XCTAssertEqual(PageLayout.effectiveCount(pageEdits: edits, pieceID: pieceID, sourcePageCount: 2), 4)
    }

    func testSeedEditsProducesIdentityRowsOnlyOnce() {
        let pieceID = UUID(); let now = Date()
        let seeded = PageLayout.seedEdits(existing: [], pieceID: pieceID, sourcePageCount: 3, now: now)
        XCTAssertEqual(seeded.count, 3)
        XCTAssertEqual(seeded.map(\.sourcePage), [1, 2, 3])
        XCTAssertEqual(seeded.map(\.displayOrder), [1, 2, 3])
        XCTAssertTrue(seeded.allSatisfy { $0.kind == .original && $0.cropRect == nil && $0.rotationDegrees == 0 })

        // Already seeded (or player-edited): returns the existing rows for this piece unchanged,
        // never re-seeding on top of real edits.
        let already = [PageEdit(pieceID: pieceID, sourcePage: 1, displayOrder: 1, rotationDegrees: 90, createdAt: now, updatedAt: now)]
        let unchanged = PageLayout.seedEdits(existing: already, pieceID: pieceID, sourcePageCount: 3, now: now)
        XCTAssertEqual(unchanged, already)
    }

    func testRenumberedIsContiguousRegardlessOfStoredOrder() {
        let pieceID = UUID(); let now = Date()
        let edits = [
            PageEdit(pieceID: pieceID, sourcePage: 5, displayOrder: 40, createdAt: now, updatedAt: now),
            PageEdit(pieceID: pieceID, sourcePage: 1, displayOrder: 10, createdAt: now, updatedAt: now)
        ]
        let renumbered = PageLayout.renumbered(edits)
        XCTAssertEqual(renumbered.map(\.displayOrder), [1, 2])
        XCTAssertEqual(renumbered.map(\.sourcePage), [5, 1], "renumbered preserves order, only rewrites displayOrder")
    }

    // MARK: - PracticeStore integration: validate() honors the effective count, not just pageCount

    @MainActor func testInsertedBlankPageRaisesTheValidLastPageBoundBeyondSourcePageCount() throws {
        let (store, directory, piece) = try fixture(pageCount: 2)
        defer { try? FileManager.default.removeItem(at: directory) }
        let now = Date()
        let edits = [
            PageEdit(pieceID: piece.id, sourcePage: 1, displayOrder: 1, createdAt: now, updatedAt: now),
            PageEdit(pieceID: piece.id, sourcePage: 2, displayOrder: 2, createdAt: now, updatedAt: now),
            PageEdit(pieceID: piece.id, sourcePage: nil, displayOrder: 3, kind: .blank, createdAt: now, updatedAt: now)
        ]
        try store.savePageEdits(edits)
        var updated = piece
        updated.lastPage = 3 // beyond pageCount(2), valid only because of the inserted blank page
        updated.updatedAt = Date()
        try store.updatePiece(updated)
        XCTAssertEqual(store.pieces.first?.lastPage, 3)

        // Still rejects a page number beyond the *effective* count.
        var invalid = updated
        invalid.lastPage = 4
        XCTAssertThrowsError(try store.updatePiece(invalid))
    }

    @MainActor func testBookmarkAndScoreLinkAcceptEffectivePagesBeyondSourceCount() throws {
        let (store, directory, piece) = try fixture(pageCount: 1)
        defer { try? FileManager.default.removeItem(at: directory) }
        let now = Date()
        try store.savePageEdits([
            PageEdit(pieceID: piece.id, sourcePage: 1, displayOrder: 1, createdAt: now, updatedAt: now),
            PageEdit(pieceID: piece.id, sourcePage: nil, displayOrder: 2, kind: .staff, createdAt: now, updatedAt: now)
        ])
        try store.saveBookmark(Bookmark(pieceID: piece.id, page: 2, label: "Inserted staff page"))
        XCTAssertEqual(store.state.bookmarks.first?.page, 2)
        try store.saveScoreLink(ScoreLink(pieceID: piece.id, sourcePage: 1, targetPage: 2))
        XCTAssertEqual(store.state.scoreLinks.first?.targetPage, 2)

        XCTAssertThrowsError(try store.saveBookmark(Bookmark(pieceID: piece.id, page: 3, label: "Out of range")))
    }

    /// Deleting pages from the reading order shortens the *effective* count below `pageCount`, but
    /// the validated bound is `max(pageCount, effectiveCount)` — deliberately never narrower than
    /// `pageCount` alone, so a `lastPage` that was valid before the deletion never becomes invalid
    /// underneath the player just because they removed some other page from the order.
    @MainActor func testDeletedReadingOrderPagesNeverNarrowTheValidLastPageBound() throws {
        let (store, directory, piece) = try fixture(pageCount: 5)
        defer { try? FileManager.default.removeItem(at: directory) }
        let now = Date()
        try store.savePageEdits([
            PageEdit(pieceID: piece.id, sourcePage: 1, displayOrder: 1, createdAt: now, updatedAt: now),
            PageEdit(pieceID: piece.id, sourcePage: 2, displayOrder: 2, deleted: true, createdAt: now, updatedAt: now),
            PageEdit(pieceID: piece.id, sourcePage: 3, displayOrder: 3, deleted: true, createdAt: now, updatedAt: now),
            PageEdit(pieceID: piece.id, sourcePage: 4, displayOrder: 4, createdAt: now, updatedAt: now),
            PageEdit(pieceID: piece.id, sourcePage: 5, displayOrder: 5, createdAt: now, updatedAt: now)
        ])
        XCTAssertEqual(PageLayout.effectiveCount(pageEdits: store.state.pageEdits, pieceID: piece.id, sourcePageCount: 5), 3)
        var updated = piece
        updated.lastPage = 5; updated.updatedAt = Date()
        XCTAssertNoThrow(try store.updatePiece(updated))
    }
}
