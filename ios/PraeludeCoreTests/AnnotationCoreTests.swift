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

    /// The realistic cross-device scenario: two replicas independently re-serialize "the same"
    /// stroke into *different* raw bytes (exactly what real `PKDrawing` re-serialization does — see
    /// `InkPerStroke`'s own doc), but agree on its `fingerprint`. Ids must still converge, proving
    /// `replaceInk`'s `fingerprint ?? data` fallback is what identity is actually keyed on.
    @MainActor func testReplaceInkConvergesOnFingerprintEvenWhenRawDataBytesDifferAcrossDevices() async throws {
        let (deviceA, directoryA, piece) = try store()
        let (deviceB, directoryB, _) = try store()
        defer { try? FileManager.default.removeItem(at: directoryA); try? FileManager.default.removeItem(at: directoryB) }
        try deviceB.addPiece(Piece(id: piece.id, title: "unused", pdfFileName: "x.pdf", pageCount: 1))
        let fingerprint = Data([0xAA, 0xBB, 0xCC])
        try deviceA.replaceInk(pieceID: piece.id, page: 1, layer: .mine,
                              strokes: [.init(data: Data([1, 1, 1]), fingerprint: fingerprint)])
        try deviceB.replaceInk(pieceID: piece.id, page: 1, layer: .mine,
                              strokes: [.init(data: Data([2, 2, 2, 2]), fingerprint: fingerprint)])
        let rowA = try XCTUnwrap(deviceA.inkStrokes(pieceID: piece.id, page: 1).first)
        let rowB = try XCTUnwrap(deviceB.inkStrokes(pieceID: piece.id, page: 1).first)
        XCTAssertEqual(rowA.id, rowB.id, "Different stored bytes, same fingerprint, must still converge on the same row id")
        XCTAssertNotEqual(rowA.data, rowB.data, "This is the realistic case — raw PencilKit bytes are not expected to match")
    }

    /// A stroke with the same `fingerprint` as an existing row is recognized as unchanged (keeps its
    /// id/createdAt) *even when its freshly re-serialized `data` differs* — the whole point of
    /// separating fingerprint from data.
    @MainActor func testReplaceInkTreatsAMatchingFingerprintAsUnchangedRegardlessOfDataBytes() async throws {
        let (store, directory, piece) = try store()
        defer { try? FileManager.default.removeItem(at: directory) }
        let fingerprint = Data([9, 9, 9])
        try store.replaceInk(pieceID: piece.id, page: 1, layer: .mine, strokes: [.init(data: Data([1]), fingerprint: fingerprint)])
        let before = try XCTUnwrap(store.inkStrokes(pieceID: piece.id, page: 1).first)
        // Same fingerprint, deliberately different `data` (as a real re-serialization would produce).
        try store.replaceInk(pieceID: piece.id, page: 1, layer: .mine, strokes: [.init(data: Data([1, 2, 3, 4, 5]), fingerprint: fingerprint)])
        let after = try XCTUnwrap(store.inkStrokes(pieceID: piece.id, page: 1).first)
        XCTAssertEqual(after.id, before.id)
        XCTAssertEqual(after.createdAt, before.createdAt, "Matched-by-fingerprint must never look updated")
        // A matched row is left completely untouched — not even `data` is overwritten — which is
        // stronger than strictly necessary but exactly "never looks updated" taken to its full
        // conclusion. `InkPerStroke.split`'s own `reusing:` already only ever offers back a matched
        // row's *own* original bytes anyway, so this never arises from real call sites.
        XCTAssertEqual(after.data, Data([1]), "A fingerprint match must not even overwrite the stored bytes")
    }

    @MainActor func testReplaceInkPlainDataOverloadStillUsesDataAsItsOwnIdentityUnchanged() async throws {
        let (store, directory, piece) = try store()
        defer { try? FileManager.default.removeItem(at: directory) }
        try store.replaceInk(pieceID: piece.id, page: 1, layer: .mine, strokes: [Data([5, 5, 5])])
        let row = try XCTUnwrap(store.inkStrokes(pieceID: piece.id, page: 1).first)
        XCTAssertNil(row.fingerprint, "The compatibility overload must not synthesize a fingerprint")
        XCTAssertEqual(row.id, InkStroke.stableID(pieceID: piece.id, page: 1, layer: .mine, data: Data([5, 5, 5]), ordinal: 0))
    }

    /// Blocker regression (verifier "reader lens", 2026-09-29): the exact same (page, layer, content,
    /// ordinal) combination recurring after being tombstoned — Redo after Undo, or Undo of an erase —
    /// used to fail outright, because `stableID` recomputes the *same id* the deleted row already has
    /// and `replaceInk` unconditionally appended a second row under it; `validate`'s uniqueness check
    /// (which covers deleted rows too) then rejected the whole page.
    @MainActor func testReplaceInkResurrectsATombstonedRowInsteadOfCreatingADuplicateId() async throws {
        let (store, directory, piece) = try store()
        defer { try? FileManager.default.removeItem(at: directory) }
        let a = Data([1, 2, 3])
        try store.replaceInk(pieceID: piece.id, page: 1, layer: .mine, strokes: [a])
        let original = try XCTUnwrap(store.inkStrokes(pieceID: piece.id, page: 1).first)
        try store.replaceInk(pieceID: piece.id, page: 1, layer: .mine, strokes: [] as [Data])
        XCTAssertTrue(store.inkStrokes(pieceID: piece.id, page: 1).isEmpty, "Erasing must tombstone, not hard-delete")
        // The exact scenario that used to throw "duplicate stroke identifiers": the same content,
        // at the same ordinal, comes back (Redo after Undo, or Undo of an erase).
        try store.replaceInk(pieceID: piece.id, page: 1, layer: .mine, strokes: [a])
        let restored = try XCTUnwrap(store.inkStrokes(pieceID: piece.id, page: 1).first)
        XCTAssertEqual(restored.id, original.id, "Restoring identical content resurrects its original row identity")
        XCTAssertEqual(restored.data, a)
        XCTAssertNil(restored.deletedAt)
        XCTAssertEqual(store.state.inkStrokes.filter { $0.pieceID == piece.id && $0.page == 1 }.count, 1,
                       "No duplicate row must be left behind under the same id")
        try PracticeStore.validate(store.state)
    }

    /// The same failure via a lasso move: moving a stroke is a real content/fingerprint change (its
    /// pre-move row is correctly tombstoned), but undoing the move reproduces the stroke's *original*
    /// fingerprint at its *original* ordinal — which collides with that very first tombstoned row.
    @MainActor func testReplaceInkResurrectsAfterALassoMoveIsUndoneBackToOriginalGeometry() async throws {
        let (store, directory, piece) = try store()
        defer { try? FileManager.default.removeItem(at: directory) }
        let originalFingerprint = Data([0xAA])
        let movedFingerprint = Data([0xBB])
        let b = Data([9, 9])
        try store.replaceInk(pieceID: piece.id, page: 1, layer: .mine,
                              strokes: [.init(data: Data([1]), fingerprint: originalFingerprint), .init(data: b)])
        let firstA = try XCTUnwrap(store.inkStrokes(pieceID: piece.id, page: 1).first { $0.fingerprint == originalFingerprint })
        // Lasso-move A: same stroke, new geometry/fingerprint, still ordinal 0.
        try store.replaceInk(pieceID: piece.id, page: 1, layer: .mine,
                              strokes: [.init(data: Data([2]), fingerprint: movedFingerprint), .init(data: b)])
        XCTAssertNotNil(store.state.inkStrokes.first { $0.id == firstA.id }?.deletedAt, "The pre-move row must be tombstoned")
        // Undo the move: A's geometry (and therefore fingerprint) reverts to its original value, at
        // its original ordinal — recomputing firstA's own id.
        try store.replaceInk(pieceID: piece.id, page: 1, layer: .mine,
                              strokes: [.init(data: Data([3]), fingerprint: originalFingerprint), .init(data: b)])
        let restoredA = try XCTUnwrap(store.inkStrokes(pieceID: piece.id, page: 1).first { $0.fingerprint == originalFingerprint })
        XCTAssertEqual(restoredA.id, firstA.id)
        XCTAssertNil(restoredA.deletedAt)
        XCTAssertEqual(store.inkStrokes(pieceID: piece.id, page: 1).count, 2, "A and B, no duplicates")
        try PracticeStore.validate(store.state)
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

    // MARK: - Coordinate transforms with page edits (crop)

    func testCropForDisplayMapsAMarkFullyInsideTheCropToTheCropsOwnZeroToOneFrame() throws {
        let crop = NormalizedRect(x: 0.2, y: 0.1, width: 0.5, height: 0.6)
        let mark = NormalizedRect(x: 0.3, y: 0.2, width: 0.2, height: 0.1)
        let displayed = try XCTUnwrap(mark.croppedForDisplay(within: crop))
        XCTAssertEqual(displayed.x, 0.2, accuracy: 1e-9)
        XCTAssertEqual(displayed.y, 1.0 / 6.0, accuracy: 1e-9)
        XCTAssertEqual(displayed.width, 0.4, accuracy: 1e-9)
        XCTAssertEqual(displayed.height, 1.0 / 6.0, accuracy: 1e-9)
    }

    func testCropForDisplayAndUncroppedFromDisplayRoundTripForAMarkInsideTheCrop() {
        let crop = NormalizedRect(x: 0.1, y: 0.15, width: 0.7, height: 0.6)
        let original = NormalizedRect(x: 0.25, y: 0.3, width: 0.15, height: 0.2)
        guard let displayed = original.croppedForDisplay(within: crop) else { return XCTFail("Expected an overlap") }
        let restored = displayed.uncroppedFromDisplay(within: crop)
        XCTAssertEqual(restored.x, original.x, accuracy: 1e-9)
        XCTAssertEqual(restored.y, original.y, accuracy: 1e-9)
        XCTAssertEqual(restored.width, original.width, accuracy: 1e-9)
        XCTAssertEqual(restored.height, original.height, accuracy: 1e-9)
    }

    func testCropForDisplayReturnsNilWhenTheMarkDoesNotOverlapTheCropAtAll() {
        let crop = NormalizedRect(x: 0, y: 0, width: 0.4, height: 0.4)
        let farAway = NormalizedRect(x: 0.6, y: 0.6, width: 0.2, height: 0.2)
        XCTAssertNil(farAway.croppedForDisplay(within: crop))
    }

    /// Major regression (verifier "reader lens", 2026-09-29): `PassageRegion` needed its own copy of
    /// the crop remapping (kept a separate type from `NormalizedRect` deliberately — see that type's
    /// own doc comment), which previously existed only on `NormalizedRect` and was never called by any
    /// app code for either type — the actual root cause of annotations sliding off the music after a
    /// page-tool crop.
    func testPassageRegionCropForDisplayAndUncroppedFromDisplayRoundTrip() throws {
        let crop = NormalizedRect(x: 0.2, y: 0.1, width: 0.5, height: 0.6)
        let original = PassageRegion(page: 3, x: 0.3, y: 0.2, width: 0.2, height: 0.1)
        let displayed = try XCTUnwrap(original.croppedForDisplay(within: crop))
        XCTAssertEqual(displayed.page, 3, "Cropping must never change which page a region belongs to")
        XCTAssertEqual(displayed.x, 0.2, accuracy: 1e-9)
        XCTAssertEqual(displayed.y, 1.0 / 6.0, accuracy: 1e-9)
        let restored = displayed.uncroppedFromDisplay(within: crop)
        XCTAssertEqual(restored.x, original.x, accuracy: 1e-9)
        XCTAssertEqual(restored.y, original.y, accuracy: 1e-9)
        XCTAssertEqual(restored.width, original.width, accuracy: 1e-9)
        XCTAssertEqual(restored.height, original.height, accuracy: 1e-9)
        let farAway = PassageRegion(page: 1, x: 0.9, y: 0.9, width: 0.05, height: 0.05)
        XCTAssertNil(farAway.croppedForDisplay(within: NormalizedRect(x: 0, y: 0, width: 0.4, height: 0.4)))
    }

    func testCropForDisplayClipsAMarkThatOnlyPartlyOverlapsTheCrop() {
        let crop = NormalizedRect(x: 0.5, y: 0.5, width: 0.5, height: 0.5)
        // Straddles the crop's top-left corner: only its bottom-right quarter is inside.
        let straddling = NormalizedRect(x: 0.25, y: 0.25, width: 0.5, height: 0.5)
        guard let displayed = straddling.croppedForDisplay(within: crop) else { return XCTFail("Expected a partial overlap") }
        XCTAssertEqual(displayed.x, 0, accuracy: 1e-9); XCTAssertEqual(displayed.y, 0, accuracy: 1e-9)
        XCTAssertEqual(displayed.width, 0.5, accuracy: 1e-9); XCTAssertEqual(displayed.height, 0.5, accuracy: 1e-9)
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
