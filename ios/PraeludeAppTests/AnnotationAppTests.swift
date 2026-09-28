import PDFKit
import PencilKit
import SwiftUI
import XCTest
@testable import Praelude

/// App-layer coverage for the annotate track's PencilKit/UIKit/SwiftUI-dependent pieces, which
/// `PraeludeCoreTests` cannot exercise (Core stays Foundation-only): per-stroke split/merge, the
/// raster rotation transform, the curated tool/color model, stamp glyph rendering, and the new
/// `ScoreMarkupState` fields.
final class AnnotationAppTests: XCTestCase {
    @MainActor private func stroke(at y: CGFloat) -> PKStroke {
        let points = [CGPoint(x: 20, y: y), CGPoint(x: 200, y: y + 20)].enumerated().map { index, location in
            PKStrokePoint(location: location, timeOffset: Double(index) / 10, size: CGSize(width: 3, height: 3),
                          opacity: 1, force: 1, azimuth: 0, altitude: .pi / 2)
        }
        return PKStroke(ink: PKInk(.pen, color: .black), path: PKStrokePath(controlPoints: points, creationDate: Date(timeIntervalSince1970: 1_700_000_000)))
    }

    // MARK: - InkPerStroke

    @MainActor func testSplitProducesOneRowPerStrokeInOrderAndMergeRebuildsTheSameDrawing() throws {
        let drawing = PKDrawing(strokes: [stroke(at: 10), stroke(at: 50), stroke(at: 90)])
        let rows = InkPerStroke.split(drawing)
        XCTAssertEqual(rows.count, 3)
        for row in rows { XCTAssertEqual(try PKDrawing(data: row.data).strokes.count, 1, "Each row must hold exactly one stroke") }
        let merged = try InkPerStroke.merge(rows.map(\.data))
        XCTAssertEqual(merged.strokes.count, 3)
        XCTAssertEqual(merged.strokes.map { $0.path.count }, drawing.strokes.map { $0.path.count })
    }

    /// The bug this design exists to avoid: `PKDrawing(strokes:).dataRepresentation()` embeds a
    /// fresh random value on every independent construction (confirmed empirically), so hashing a
    /// freshly re-serialized row's raw bytes would never converge across two splits of identical
    /// content. `fingerprint` is computed without ever going through PencilKit's own serializer, so
    /// it must be stable even though `data` (deliberately) is not.
    @MainActor func testFingerprintIsDeterministicAcrossIndependentSplitsEvenThoughRawDataIsNot() {
        let drawing = PKDrawing(strokes: [stroke(at: 5), stroke(at: 45)])
        let first = InkPerStroke.split(drawing)
        let second = InkPerStroke.split(drawing)
        XCTAssertEqual(first.map(\.fingerprint), second.map(\.fingerprint), "Fingerprints must converge across independent splits")
        XCTAssertNotEqual(first.map(\.data), second.map(\.data),
                          "This documents the real PencilKit constraint (not a requirement): without `reusing:`, raw bytes are not expected to match")
    }

    @MainActor func testFingerprintDistinguishesDifferentStrokesAndIsStableForTheSameStrokeValue() {
        let a = stroke(at: 10), b = stroke(at: 60)
        XCTAssertEqual(InkPerStroke.fingerprint(a), InkPerStroke.fingerprint(a))
        XCTAssertNotEqual(InkPerStroke.fingerprint(a), InkPerStroke.fingerprint(b))
    }

    /// The actual fix `ScoreWorkspace.persistInk` relies on: an unchanged stroke reuses its exact
    /// previously-stored `data` bytes (not a fresh, volatile re-serialization), which is what makes
    /// `PracticeStore.replaceInk`'s content diff correctly recognize it as unchanged on a real save.
    @MainActor func testSplitReusingExistingRowsKeepsUnchangedStrokesByteIdenticalAndOnlyReserializesNewOnes() throws {
        let kept = stroke(at: 10), added = stroke(at: 70)
        let firstSave = InkPerStroke.split(PKDrawing(strokes: [kept]))
        let existingRows = firstSave.enumerated().map { offset, input in
            InkStroke(pieceID: UUID(), page: 1, layer: .mine, data: input.data, fingerprint: input.fingerprint)
        }
        let secondSave = InkPerStroke.split(PKDrawing(strokes: [kept, added]), reusing: existingRows)
        XCTAssertEqual(secondSave.count, 2)
        XCTAssertEqual(secondSave[0].data, existingRows[0].data, "The unchanged stroke must reuse its exact stored bytes")
        XCTAssertEqual(secondSave[0].fingerprint, existingRows[0].fingerprint)
        XCTAssertNotEqual(secondSave[1].data, existingRows[0].data, "The new stroke gets its own, different row")
    }

    @MainActor func testMergeThrowsOnDamagedBytesAndOnEmptyInput() {
        XCTAssertThrowsError(try InkPerStroke.merge([Data([0xFF, 0x00])]))
        XCTAssertNoThrow(try InkPerStroke.merge([]))
    }

    // MARK: - Rotation transform (extracted from PassagePreview.makeThumbnail)

    func testNormalizedRotatedForDisplayIsIdentityAtZeroAndFullCircleAtFourNinetyDegreeSteps() {
        let rect = CGRect(x: 0.1, y: 0.2, width: 0.3, height: 0.1)
        XCTAssertEqual(rect.normalizedRotatedForDisplay(pageRotationDegrees: 0), rect)
        var accumulated = rect
        for _ in 0..<4 { accumulated = accumulated.normalizedRotatedForDisplay(pageRotationDegrees: 90) }
        XCTAssertEqual(accumulated.minX, rect.minX, accuracy: 1e-9)
        XCTAssertEqual(accumulated.minY, rect.minY, accuracy: 1e-9)
        XCTAssertEqual(accumulated.width, rect.width, accuracy: 1e-9)
        XCTAssertEqual(accumulated.height, rect.height, accuracy: 1e-9)
    }

    func testNormalizedRotatedForDisplayMatchesRotating90ThreeTimesAgainst270AndHandlesNegativeDegrees() {
        let rect = CGRect(x: 0.05, y: 0.4, width: 0.2, height: 0.15)
        var threeTimes = rect
        for _ in 0..<3 { threeTimes = threeTimes.normalizedRotatedForDisplay(pageRotationDegrees: 90) }
        let once = rect.normalizedRotatedForDisplay(pageRotationDegrees: 270)
        XCTAssertEqual(threeTimes.minX, once.minX, accuracy: 1e-9)
        XCTAssertEqual(threeTimes.minY, once.minY, accuracy: 1e-9)
        // A negative or >360 rotation value must normalize the same way `ScorePageOverlay`-adjacent
        // code already assumed (`((degrees % 360) + 360) % 360`).
        XCTAssertEqual(rect.normalizedRotatedForDisplay(pageRotationDegrees: -270), rect.normalizedRotatedForDisplay(pageRotationDegrees: 90))
        XCTAssertEqual(rect.normalizedRotatedForDisplay(pageRotationDegrees: 450), rect.normalizedRotatedForDisplay(pageRotationDegrees: 90))
    }

    // MARK: - AnnotationTool

    func testEveryInkingToolProducesAPKToolAndPlacementToolsProduceNone() {
        for kind: AnnotationToolKind in [.pen, .highlighter, .eraser, .lasso] {
            XCTAssertNotNil(AnnotationTool(kind: kind).pkTool, "\(kind) must drive a live canvas tool")
            XCTAssertTrue(kind.isInkingTool)
        }
        for kind: AnnotationToolKind in [.stamp, .text] {
            XCTAssertNil(AnnotationTool(kind: kind).pkTool, "\(kind) places marks by tap, never by handing PencilKit a drawing tool")
            XCTAssertFalse(kind.isInkingTool)
        }
    }
    func testPenAndHighlighterUseDifferentInkTypesAndHighlighterIsWider() throws {
        let pen = try XCTUnwrap(AnnotationTool(kind: .pen, width: .medium).pkTool as? PKInkingTool)
        let highlighter = try XCTUnwrap(AnnotationTool(kind: .highlighter, width: .medium).pkTool as? PKInkingTool)
        XCTAssertEqual(pen.inkType, .pen); XCTAssertEqual(highlighter.inkType, .marker)
        XCTAssertGreaterThan(highlighter.width, pen.width)
    }
    func testGraphiteIsThePinnedScoreInkColorSoItNeverVanishesInDarkMode() {
        XCTAssertEqual(AnnotationColor.graphite.uiColor, UIColor(PraeludeColor.scoreInk))
    }

    // MARK: - Stamp rendering (glyph presence smoke test)

    @MainActor func testEveryStampKindAndLabelRendersANonBlankGlyph() throws {
        var combinations: [(StampKind, String?)] = [(.breath, nil), (.circle, nil), (.watch, nil)]
        for kind: StampKind in [.fingering, .dynamic, .bowing, .accidental] {
            for label in kind.labels ?? [] { combinations.append((kind, label)) }
        }
        for (kind, label) in combinations {
            let renderer = ImageRenderer(content: PraeludeStamp(kind: kind, label: label, size: 28))
            renderer.scale = 2
            let image = try XCTUnwrap(renderer.uiImage, "\(kind) \(label ?? "") must render")
            XCTAssertTrue(hasVisiblePixel(image), "\(kind) \(label ?? "") rendered fully blank — likely an unresolved glyph")
        }
    }
    /// Samples the rendered image for any pixel with meaningful alpha — cheap enough for a unit test
    /// and enough to catch a codepoint that resolves to nothing, which "the glyph exists in the
    /// font's cmap" alone (how the codepoints were chosen — see "(C) Design System.md") cannot.
    private func hasVisiblePixel(_ image: UIImage) -> Bool {
        guard let cgImage = image.cgImage else { return false }
        let width = cgImage.width, height = cgImage.height
        guard width > 0, height > 0 else { return false }
        var pixels = [UInt8](repeating: 0, count: width * height * 4)
        guard let context = CGContext(data: &pixels, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
                                      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
        context.draw(cgImage, in: CGRect(x: 0, y: 0, width: width, height: height))
        return stride(from: 3, to: pixels.count, by: 4).contains { pixels[$0] > 10 }
    }

    // MARK: - ScoreMarkupState additions

    @MainActor func testRememberInkGuardsAgainstCrossLayerLeakTheSameWayItGuardsAgainstCrossDocumentLeak() {
        let markup = ScoreMarkupState()
        let document = URL(fileURLWithPath: "/fixture.pdf")
        markup.rememberInk(page: 1, data: Data([1]), expected: nil, document: document, layer: .mine)
        XCTAssertEqual(markup.pendingInk[1]?.data, Data([1]))
        markup.rememberInk(page: 2, data: Data([2]), expected: nil, document: document, layer: .teacher)
        XCTAssertNil(markup.pendingInk[2], "A different layer must be refused while .mine is still pending, exactly like a different document")
        XCTAssertNotNil(markup.errorMessage)
        markup.clearPendingInk(page: 1)
        markup.errorMessage = nil
        markup.rememberInk(page: 2, data: Data([2]), expected: nil, document: document, layer: .teacher)
        XCTAssertEqual(markup.pendingInk[2]?.data, Data([2]), "Once .mine's pending ink is cleared, a different layer may proceed")
    }

    @MainActor func testFinishClearsQuickBoxArmingAndPendingBox() {
        let markup = ScoreMarkupState()
        markup.quickBoxArmed = true
        markup.pendingQuickBox = PassageRegion(page: 1, x: 0, y: 0, width: 0.1, height: 0.1)
        markup.finish()
        XCTAssertFalse(markup.quickBoxArmed)
        XCTAssertNil(markup.pendingQuickBox)
    }

    @MainActor func testCenteredNormalizedRectClampsToThePageAndRejectsAnOversizedOrDegenerateBox() throws {
        let size = CGSize(width: 1000, height: 800)
        let corner = try XCTUnwrap(NormalizedRect.centered(at: CGPoint(x: 5, y: 5), width: 0.1, height: 0.1, in: size))
        XCTAssertEqual(corner.x, 0); XCTAssertEqual(corner.y, 0)
        let farCorner = try XCTUnwrap(NormalizedRect.centered(at: CGPoint(x: 999, y: 799), width: 0.1, height: 0.1, in: size))
        XCTAssertEqual(farCorner.x, 0.9, accuracy: 1e-9)
        XCTAssertEqual(farCorner.y, 0.9, accuracy: 1e-9)
        XCTAssertNil(NormalizedRect.centered(at: .zero, width: 1.5, height: 0.1, in: size), "A box wider than the page must be rejected")
        XCTAssertNil(NormalizedRect.centered(at: .zero, width: 0, height: 0.1, in: size))
        XCTAssertNil(NormalizedRect.centered(at: .zero, width: 0.1, height: 0.1, in: .zero))
    }
}
