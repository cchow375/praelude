import Foundation
import XCTest
@testable import PraeludeCore

/// Core coverage for the annotate track (§7 annotation bullets, §8 passages): deterministic
/// per-stroke ink identity/ordering (`InkStroke.stableID`, `PracticeStore.replaceInk`) and passage
/// recolor/split/merge/archive (`PracticeStore.splitPassage`/`mergePassages`/`deletePassage`).
final class AnnotationCoreTests: XCTestCase {
    @MainActor private func store(pageCount: Int = 4, now: @escaping () -> Date = Date.init) throws -> (PracticeStore, URL, Piece) {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("praelude-ios-annotate-tests-\(UUID())")
        let store = PracticeStore(directory: directory, now: now)
        var piece = Piece(title: "Test score", pageCount: pageCount)
        piece.pdfFileName = "fixture.pdf"
        try store.addPiece(piece)
        return (store, directory, piece)
    }

    // MARK: - Per-stroke identity and ordering

    func testInkStrokeStableIDIsDeterministicAndContentSensitive() {
        let pieceID = UUID()
        let data = Data([1, 2, 3])
        let id = InkStroke.stableID(pieceID: pieceID, page: 1, layer: .mine, data: data, ordinal: 0)
        XCTAssertEqual(id, InkStroke.stableID(pieceID: pieceID, page: 1, layer: .mine, data: data, ordinal: 0),
                       "Identical inputs must always compute the identical id")
        XCTAssertNotEqual(id, InkStroke.stableID(pieceID: pieceID, page: 2, layer: .mine, data: data, ordinal: 0), "A different page must change the id")
        XCTAssertNotEqual(id, InkStroke.stableID(pieceID: pieceID, page: 1, layer: .teacher, data: data, ordinal: 0), "A different layer must change the id")
        XCTAssertNotEqual(id, InkStroke.stableID(pieceID: pieceID, page: 1, layer: .mine, data: Data([9]), ordinal: 0), "Different stroke bytes must change the id")
        XCTAssertNotEqual(id, InkStroke.stableID(pieceID: pieceID, page: 1, layer: .mine, data: data, ordinal: 1), "A different ordinal must change the id")
        XCTAssertNotEqual(id, InkStroke.stableID(pieceID: UUID(), page: 1, layer: .mine, data: data, ordinal: 0), "A different piece must change the id")
    }

    /// The whole point of a content/ordinal-derived id (rather than `UUID()`): two independent
    /// replicas ("devices") that split the *same* drawing into the *same* ordered stroke blobs must
    /// converge on identical row ids without ever talking to each other, so a future sync engine sees
    /// one stroke appearing twice, not two unrelated strokes.
    @MainActor func testReplaceInkAssignsConvergentIdsAcrossTwoIndependentStores() async throws {
        let (deviceA, directoryA, piece) = try store()
        let (deviceB, directoryB, _) = try store()
        defer { try? FileManager.default.removeItem(at: directoryA); try? FileManager.default.removeItem(at: directoryB) }
        // Same piece id on both "devices" (as a real synced library would have).
        try deviceB.addPiece(Piece(id: piece.id, title: "unused", pdfFileName: "x.pdf", pageCount: 1))
        let strokes = [Data([1, 1]), Data([2, 2, 2]), Data([3])]
        try deviceA.replaceInk(pieceID: piece.id, page: 1, layer: .mine, strokes: strokes)
        try deviceB.replaceInk(pieceID: piece.id, page: 1, layer: .mine, strokes: strokes)
        let idsA = deviceA.inkStrokes(pieceID: piece.id, page: 1).map(\.id)
        let idsB = deviceB.inkStrokes(pieceID: piece.id, page: 1).map(\.id)
        XCTAssertEqual(idsA.count, 3)
        XCTAssertEqual(idsA, idsB, "Independent replicas splitting identical content the same way must converge on identical row ids")
    }

    /// Several brand-new rows can land in one `replaceInk` call (e.g. the first time a legacy
    /// multi-stroke page blob is split into per-stroke rows). Their `createdAt` must reflect their
    /// position in the caller's array, not iteration order, so redraw (`inkStrokes`, sorted oldest
    /// first) reproduces the original stroke order exactly — overlapping strokes must not silently
    /// swap z-order.
    @MainActor func testReplaceInkNewRowsPreserveInputOrderWithinASingleFlush() async throws {
        let (store, directory, piece) = try store()
        defer { try? FileManager.default.removeItem(at: directory) }
        let strokes = (0..<12).map { Data([UInt8($0)]) }
        try store.replaceInk(pieceID: piece.id, page: 1, layer: .mine, strokes: strokes)
        XCTAssertEqual(store.inkStrokes(pieceID: piece.id, page: 1).map(\.data), strokes)
    }

    /// An untouched stroke must keep its own `createdAt`/id across a later flush even when the
    /// strokes ahead of it in the array change count (its own *ordinal* moves), so it never looks
    /// "updated" to a future sync engine.
    @MainActor func testReplaceInkKeepsUnchangedRowStableWhenItsOrdinalShifts() async throws {
        let (store, directory, piece) = try store()
        defer { try? FileManager.default.removeItem(at: directory) }
        let kept = Data([7, 7, 7])
        try store.replaceInk(pieceID: piece.id, page: 1, layer: .mine, strokes: [Data([1]), kept])
        let before = try XCTUnwrap(store.inkStrokes(pieceID: piece.id, page: 1).first { $0.data == kept })
        // Remove the stroke ahead of `kept` and add two more after it: `kept`'s ordinal in the new
        // array is now 2 (was 1), but its bytes are unchanged.
        try store.replaceInk(pieceID: piece.id, page: 1, layer: .mine, strokes: [Data([9]), Data([9, 9]), kept])
        let after = try XCTUnwrap(store.inkStrokes(pieceID: piece.id, page: 1).first { $0.data == kept })
        XCTAssertEqual(after.id, before.id)
        XCTAssertEqual(after.createdAt, before.createdAt)
    }

    /// Splitting the same legacy whole-page blob into per-stroke rows must be lossless: every stroke
    /// byte sequence survives, and running the split twice (idempotent re-flush of identical content)
    /// creates no duplicate or orphaned rows.
    @MainActor func testReplaceInkSplittingLegacyBlobIsLosslessAndIdempotent() async throws {
        let (store, directory, piece) = try store()
        defer { try? FileManager.default.removeItem(at: directory) }
        let legacyWholePageBlob = Data([0xAB, 0xCD, 0xEF])
        try store.saveDrawing(pieceID: piece.id, page: 1, data: legacyWholePageBlob)
        XCTAssertEqual(store.inkStrokes(pieceID: piece.id, page: 1).map(\.data), [legacyWholePageBlob])
        let split = [Data([1]), Data([2]), Data([3])]
        try store.replaceInk(pieceID: piece.id, page: 1, layer: .mine, strokes: split)
        XCTAssertEqual(store.inkStrokes(pieceID: piece.id, page: 1).map(\.data), split, "Every stroke must survive the split")
        XCTAssertEqual(store.state.inkStrokes.filter { $0.pieceID == piece.id && $0.page == 1 && $0.deletedAt != nil }.count, 1,
                       "The old coarse row must be tombstoned, not left live alongside the new rows")
        try store.replaceInk(pieceID: piece.id, page: 1, layer: .mine, strokes: split)
        XCTAssertEqual(store.inkStrokes(pieceID: piece.id, page: 1).map(\.data), split, "Re-flushing identical content must not duplicate rows")
    }

    // MARK: - Passage split / merge / recolor / archive (§8)

    @MainActor func testSplitPassageMovesOnlyChosenRegionsAndStartsTheNewOneFresh() async throws {
        let (store, directory, piece) = try store()
        defer { try? FileManager.default.removeItem(at: directory) }
        let a = PassageRegion(page: 1, x: 0, y: 0, width: 0.2, height: 0.1)
        let b = PassageRegion(page: 2, x: 0, y: 0, width: 0.2, height: 0.1)
        var original = Passage(pieceID: piece.id, title: "Whole thing", page: 1, regions: [a, b], color: "red")
        original.learningState = .review
        try store.savePassage(original)
        let split = try store.splitPassage(original.id, movingRegionIDs: [b.id], newTitle: "Second half")
        XCTAssertEqual(split.regions.map(\.id), [b.id])
        XCTAssertEqual(split.page, 2)
        XCTAssertEqual(split.color, "red", "A split-off passage inherits the parent's color")
        XCTAssertEqual(split.parentPassageID, original.id)
        XCTAssertEqual(split.learningState, .new, "A split-off passage starts its own schedule, not the parent's review history")
        let remaining = try XCTUnwrap(store.state.passages.first { $0.id == original.id })
        XCTAssertEqual(remaining.regions.map(\.id), [a.id])
        XCTAssertEqual(remaining.page, 1)
        XCTAssertEqual(remaining.learningState, .review, "The original passage keeps its own learning history")
        try PracticeStore.validate(store.state)
    }

    @MainActor func testSplitPassageRejectsEmptySelectionAndMovingEveryRegion() async throws {
        let (store, directory, piece) = try store()
        defer { try? FileManager.default.removeItem(at: directory) }
        let a = PassageRegion(page: 1, x: 0, y: 0, width: 0.2, height: 0.1)
        let b = PassageRegion(page: 1, x: 0.3, y: 0, width: 0.2, height: 0.1)
        let passage = Passage(pieceID: piece.id, title: "P", page: 1, regions: [a, b])
        try store.savePassage(passage)
        XCTAssertThrowsError(try store.splitPassage(passage.id, movingRegionIDs: [], newTitle: "Empty"))
        XCTAssertThrowsError(try store.splitPassage(passage.id, movingRegionIDs: [a.id, b.id], newTitle: "Everything"),
                             "Splitting off every region would leave the original with none")
        XCTAssertEqual(store.state.passages.count, 1, "A rejected split must not create a partial passage")
    }

    @MainActor func testMergePassagesFoldsRegionsIntoThePrimaryAndArchivesSecondaries() async throws {
        let (store, directory, piece) = try store()
        defer { try? FileManager.default.removeItem(at: directory) }
        let regionA = PassageRegion(page: 1, x: 0, y: 0, width: 0.2, height: 0.1)
        let regionB = PassageRegion(page: 2, x: 0, y: 0, width: 0.2, height: 0.1)
        let primary = Passage(pieceID: piece.id, title: "First", page: 1, regions: [regionA])
        let secondary = Passage(pieceID: piece.id, title: "Second", page: 2, regions: [regionB])
        try store.savePassage(primary); try store.savePassage(secondary)
        let merged = try store.mergePassages(primary: primary.id, into: [secondary.id])
        XCTAssertEqual(merged.id, primary.id, "The primary keeps its own id")
        XCTAssertEqual(Set(merged.regions.map(\.id)), [regionA.id, regionB.id])
        XCTAssertEqual(merged.joinedFromPassageIDs, [secondary.id])
        let archivedSecondary = try XCTUnwrap(store.state.passages.first { $0.id == secondary.id })
        XCTAssertTrue(archivedSecondary.archived)
        XCTAssertNotNil(archivedSecondary.deletedAt)
        XCTAssertTrue(archivedSecondary.regions.isEmpty, "Regions move to the primary, they do not stay duplicated on the archived passage")
        try PracticeStore.validate(store.state)
    }

    @MainActor func testMergePassagesRejectsDifferentPieceArchivedOrEmptySelection() async throws {
        let (store, directory, piece) = try store(pageCount: 2)
        defer { try? FileManager.default.removeItem(at: directory) }
        var otherPiece = Piece(title: "Other", pageCount: 1); otherPiece.pdfFileName = "other.pdf"
        try store.addPiece(otherPiece)
        let primary = Passage(pieceID: piece.id, title: "Mine")
        let fromAnotherPiece = Passage(pieceID: otherPiece.id, title: "Not mine")
        try store.savePassage(primary); try store.savePassage(fromAnotherPiece)
        XCTAssertThrowsError(try store.mergePassages(primary: primary.id, into: []))
        XCTAssertThrowsError(try store.mergePassages(primary: primary.id, into: [primary.id]), "Cannot merge a passage into itself")
        XCTAssertThrowsError(try store.mergePassages(primary: primary.id, into: [fromAnotherPiece.id]))
        let archived = Passage(pieceID: piece.id, title: "Gone")
        try store.savePassage(archived); try store.deletePassage(archived.id)
        XCTAssertThrowsError(try store.mergePassages(primary: primary.id, into: [archived.id]), "An archived passage cannot be merged into")
    }

    @MainActor func testDeletePassageArchivesUnlinksHistoryNavigationButKeepsPracticedSnapshot() async throws {
        let (store, directory, piece) = try store()
        defer { try? FileManager.default.removeItem(at: directory) }
        let passage = Passage(pieceID: piece.id, title: "Trouble spot", page: 1)
        try store.savePassage(passage)
        try store.startSet(PracticeConfiguration(pieceID: piece.id, passageID: passage.id, targetCount: 1))
        try store.record(.clean)
        XCTAssertEqual(store.state.activeSet?.status, .completed)
        try store.endSet()
        try store.deletePassage(passage.id)
        let stored = try XCTUnwrap(store.state.passages.first { $0.id == passage.id })
        XCTAssertTrue(stored.archived)
        let historyEntry = try XCTUnwrap(store.state.history.first)
        XCTAssertNil(historyEntry.configuration.passageID, "History must unlink its live navigation reference to an archived passage")
        XCTAssertEqual(historyEntry.configuration.passageSnapshot?.id, passage.id, "The practiced snapshot itself is preserved untouched")
        try PracticeStore.validate(store.state)
    }
}
