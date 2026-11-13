import UIKit
import XCTest
@testable import Praelude

final class NoteOverlayInteractionTests: XCTestCase {
    @MainActor private func fixture(size: CGSize = CGSize(width: 600, height: 800)) -> (ScoreMarkupState, ScorePageOverlay, TextBoxAnnotation) {
        let state = ScoreMarkupState()
        let overlay = ScorePageOverlay(page: 1, markup: state)
        overlay.frame = CGRect(origin: .zero, size: size); overlay.layoutIfNeeded()
        overlay.updateInkResolution(displayScale: 700 / size.width)
        let style = TextAnnotationStyle(fontSize: 24, fontFamily: .serif, isBold: true, isItalic: true, textColor: .blue, alignment: .center)
        let note = TextBoxAnnotation(pieceID: UUID(), page: 1,
                                     region: NormalizedRect(x: 0.2, y: 0.2, width: 0.3, height: 0.15),
                                     text: "Keep the melody singing above a quiet left hand.", style: style)
        overlay.displayedTextBoxes = [note]
        return (state, overlay, note)
    }

    @MainActor private func panel(in overlay: ScorePageOverlay) throws -> UIView {
        try XCTUnwrap(overlay.subviews.first { $0.accessibilityIdentifier == "expandedScoreNote" })
    }

    @MainActor func testOrdinaryAndOversizedPagesCreateReadableScreenSizedNotesAndPanels() throws {
        for size in [CGSize(width: 626.76, height: 874.92), CGSize(width: 5609.6, height: 7764.01)] {
            let (state, overlay, note) = fixture(size: size)
            overlay.handleTap(at: CGPoint(x: size.width * 0.35, y: size.height * 0.275))
            let panel = try panel(in: overlay)
            XCTAssertFalse(panel.isHidden)
            XCTAssertEqual(panel.frame.width * overlay.pageDisplayScale, 320, accuracy: 0.01)
            let label = try XCTUnwrap(panel.subviews.compactMap { $0 as? UIScrollView }.first?.subviews.compactMap { $0 as? UILabel }.first)
            let attributed = try XCTUnwrap(label.attributedText)
            let font = try XCTUnwrap(attributed.attribute(.font, at: 0, effectiveRange: nil) as? UIFont)
            XCTAssertEqual(font.pointSize, note.style.fontSize, accuracy: 0.01)
            let edit = try XCTUnwrap(panel.subviews.compactMap { $0 as? UIButton }.first { $0.accessibilityIdentifier == "editScoreNote" })
            XCTAssertEqual(edit.frame.height, 44)
            XCTAssertEqual(overlay.noteHandleRects.count, 4)
            for handle in overlay.noteHandleRects { XCTAssertEqual(handle.width * overlay.pageDisplayScale, 8, accuracy: 0.01) }
            let close = try XCTUnwrap(panel.subviews.compactMap { $0 as? UIButton }.first { $0.accessibilityIdentifier == "closeScoreNote" })
            close.sendActions(for: .touchUpInside)
            XCTAssertTrue(panel.isHidden)
            XCTAssertEqual(overlay.selectedNoteID, note.id)
            XCTAssertEqual(overlay.noteHandleRects.count, 4, "Closing readable text retains the resize handles")

            state.mode = .writing; state.tool.kind = .text
            overlay.displayedTextBoxes = []
            var placed: NormalizedRect?
            overlay.onPlaceTextBox = { _, region in placed = region }
            overlay.handleTap(at: CGPoint(x: size.width * 0.5, y: size.height * 0.5))
            let region = try XCTUnwrap(placed)
            XCTAssertEqual(region.width * size.width * overlay.pageDisplayScale, 240, accuracy: 0.01)
            XCTAssertEqual(region.height * size.height * overlay.pageDisplayScale, 100, accuracy: 0.01)
            XCTAssertTrue(region.isValid)
        }
    }

    @MainActor func testExpandedInspectorRendersReadableTextWithoutChangingWhiteOnDarkNoteStyle() throws {
        let (_, overlay, original) = fixture()
        overlay.overrideUserInterfaceStyle = .light
        var note = original
        note.style.textColor = .white
        note.style.backgroundColor = .init(red: 0.05, green: 0.08, blue: 0.12, alpha: 1)
        overlay.displayedTextBoxes = [note]
        overlay.handleTap(at: CGPoint(x: 210, y: 220))
        let panel = try panel(in: overlay)
        XCTAssertFalse(panel.isHidden)
        let label = try XCTUnwrap(panel.subviews.compactMap { $0 as? UIScrollView }.first?.subviews.compactMap { $0 as? UILabel }.first)
        let attributed = try XCTUnwrap(label.attributedText)
        let foreground = try XCTUnwrap(attributed.attribute(.foregroundColor, at: 0, effectiveRange: nil) as? UIColor)
        let background = try XCTUnwrap(panel.backgroundColor)
        for appearance in [UIUserInterfaceStyle.light, .dark] {
            let traits = UITraitCollection(userInterfaceStyle: appearance)
            XCTAssertEqual(foreground.resolvedColor(with: traits), UIColor.label.resolvedColor(with: traits))
            XCTAssertEqual(background.resolvedColor(with: traits), UIColor.systemBackground.resolvedColor(with: traits))
            XCTAssertEqual(background.resolvedColor(with: traits).cgColor.alpha, 1)
        }
        let font = try XCTUnwrap(attributed.attribute(.font, at: 0, effectiveRange: nil) as? UIFont)
        XCTAssertEqual(font, TextAnnotationRenderer.font(for: note.style), "Expanding changes contrast while retaining the chosen font and emphasis")
        let paragraph = try XCTUnwrap(attributed.attribute(.paragraphStyle, at: 0, effectiveRange: nil) as? NSParagraphStyle)
        XCTAssertEqual(paragraph.alignment, .center)

        // Render only the note label, excluding buttons/borders that could hide invisible text.
        let format = UIGraphicsImageRendererFormat(); format.scale = 1; format.opaque = true
        var rendered: UIImage?
        UITraitCollection(userInterfaceStyle: .light).performAsCurrent {
            rendered = UIGraphicsImageRenderer(size: label.bounds.size, format: format).image { renderer in
                background.setFill(); renderer.fill(label.bounds)
                label.layer.render(in: renderer.cgContext)
            }
        }
        let cg = try XCTUnwrap(rendered?.cgImage)
        var pixels = [UInt8](repeating: 0, count: cg.width * cg.height * 4)
        try pixels.withUnsafeMutableBytes { buffer in
            let context = try XCTUnwrap(CGContext(data: buffer.baseAddress, width: cg.width, height: cg.height,
                bitsPerComponent: 8, bytesPerRow: cg.width * 4, space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue))
            context.draw(cg, in: CGRect(x: 0, y: 0, width: cg.width, height: cg.height))
        }
        var darkTextPixels = 0
        for offset in stride(from: 0, to: pixels.count, by: 4) {
            let isDark = pixels[offset] < 100 && pixels[offset + 1] < 100 && pixels[offset + 2] < 100
            if isDark && pixels[offset + 3] == 255 { darkTextPixels += 1 }
        }
        XCTAssertGreaterThan(darkTextPixels, 100, "White saved ink must become visible dark glyphs on the light inspector surface")
        XCTAssertEqual(overlay.displayedTextBoxes, [note], "Opening the inspector must not rewrite the saved note style")
        XCTAssertEqual(TextAnnotationRenderer.color(for: note.style), .white, "Collapsed notes and export retain the selected ink")
        XCTAssertEqual(TextAnnotationRenderer.backgroundColor(for: note.style), UIColor(red: 0.05, green: 0.08, blue: 0.12, alpha: 1))
    }

    @MainActor func testResizeUsesGenerousOutsideCornerTargetAndSavesOnlyOnceAfter120Samples() throws {
        let (_, overlay, note) = fixture(size: CGSize(width: 5609.6, height: 7764.01))
        let size = overlay.bounds.size
        overlay.handleTap(at: CGPoint(x: size.width * 0.35, y: size.height * 0.275))
        let bottomRight = CGPoint(x: size.width * 0.5, y: size.height * 0.35)
        let start = CGPoint(x: bottomRight.x + 12 / overlay.pageDisplayScale, y: bottomRight.y + 8 / overlay.pageDisplayScale)
        XCTAssertEqual(overlay.editableNote(at: start)?.id, note.id)
        XCTAssertTrue(overlay.hitTest(start, with: nil) === overlay)
        XCTAssertTrue(overlay.captureNotePanStart(at: start))
        var saved: [(TextBoxAnnotation, NormalizedRect)] = []
        overlay.onMoveTextBox = { note, region in
            saved.append((note, region))
            var receipt = note; receipt.region = region; return receipt
        }
        overlay.handleNotePan(state: .began, location: start)
        for index in 1...120 {
            let fraction = CGFloat(index) / 120
            overlay.handleNotePan(state: .changed, location: CGPoint(x: start.x + size.width * 0.15 * fraction, y: start.y + size.height * 0.1 * fraction))
            XCTAssertEqual(overlay.displayedTextBoxes, [note], "Resize samples must not publish model/store changes")
            XCTAssertTrue(saved.isEmpty)
        }
        XCTAssertNotNil(overlay.notePreviewRect)
        overlay.handleNotePan(state: .ended, location: CGPoint(x: start.x + size.width * 0.15, y: start.y + size.height * 0.1))
        XCTAssertEqual(saved.count, 1)
        let result = try XCTUnwrap(overlay.displayedTextBoxes.first)
        XCTAssertEqual(result.region.x, 0.2, accuracy: 0.00001)
        XCTAssertEqual(result.region.y, 0.2, accuracy: 0.00001)
        XCTAssertEqual(result.region.width, 0.45, accuracy: 0.00001)
        XCTAssertEqual(result.region.height, 0.25, accuracy: 0.00001)
        XCTAssertEqual(result.style, note.style)
        XCTAssertEqual(result.text, note.text)
        XCTAssertEqual(result.createdAt, note.createdAt)
        XCTAssertEqual(result.id, note.id)
        XCTAssertNil(overlay.notePreviewRect)
    }

    @MainActor func testCanceledFailedAndStaleResizeNeverPublishesPreview() throws {
        for boundary in 0..<7 {
            let (state, overlay, note) = fixture()
            overlay.handleTap(at: CGPoint(x: 210, y: 220))
            let corner = CGPoint(x: 300, y: 280)
            XCTAssertTrue(overlay.captureNotePanStart(at: corner))
            var saves = 0
            overlay.onMoveTextBox = { _, _ in saves += 1; return nil }
            overlay.handleNotePan(state: .began, location: corner)
            let end = CGPoint(x: 400, y: 380)
            overlay.handleNotePan(state: .changed, location: end)
            switch boundary {
            case 0: overlay.handleNotePan(state: .cancelled, location: end)
            case 1: overlay.handleNotePan(state: .failed, location: end)
            case 2: state.mode = .selecting; overlay.refresh()
            case 3: state.activeLayer = .teacher; overlay.refresh()
            case 4: overlay.inkReadOnly = true; overlay.refresh()
            case 5:
                var changed = note; changed.text = "A newer edit"
                overlay.displayedTextBoxes = [changed]
            default: break // The actual save is rejected on release.
            }
            overlay.handleNotePan(state: .ended, location: end)
            XCTAssertNil(overlay.notePreviewRect)
            XCTAssertEqual(overlay.displayedTextBoxes.first?.region, note.region)
            XCTAssertEqual(saves, boundary == 6 ? 1 : 0)
            if boundary == 5 { XCTAssertEqual(overlay.displayedTextBoxes.first?.text, "A newer edit") }
        }
    }

    @MainActor func testCroppedResizeKeepsHiddenOppositeEdgesAndMovePreservesSize() throws {
        let (_, overlay, original) = fixture()
        overlay.activeCrop = NormalizedRect(x: 0.3, y: 0.25, width: 0.5, height: 0.5)
        overlay.layoutIfNeeded(); overlay.updateInkResolution(displayScale: 1)
        // The left/top of the note are outside this crop; only its true bottom-right is a handle.
        overlay.handleTap(at: CGPoint(x: 60, y: 60))
        XCTAssertEqual(overlay.noteHandleRects.count, 1)
        let corner = CGPoint(x: 240, y: 160)
        XCTAssertTrue(overlay.captureNotePanStart(at: corner))
        overlay.onMoveTextBox = { note, region in var saved = note; saved.region = region; return saved }
        overlay.handleNotePan(state: .began, location: corner)
        overlay.handleNotePan(state: .ended, location: CGPoint(x: 360, y: 320))
        let resized = try XCTUnwrap(overlay.displayedTextBoxes.first)
        XCTAssertEqual(resized.region.x, original.region.x, accuracy: 0.00001)
        XCTAssertEqual(resized.region.y, original.region.y, accuracy: 0.00001)
        XCTAssertEqual(resized.region.width, 0.4, accuracy: 0.00001)
        XCTAssertEqual(resized.region.height, 0.25, accuracy: 0.00001)
        let interior = CGPoint(x: 100, y: 100)
        XCTAssertTrue(overlay.captureNotePanStart(at: interior))
        overlay.handleNotePan(state: .began, location: interior)
        overlay.handleNotePan(state: .ended, location: CGPoint(x: 160, y: 180))
        let moved = try XCTUnwrap(overlay.displayedTextBoxes.first)
        XCTAssertEqual(moved.region.width, resized.region.width, accuracy: 0.00001)
        XCTAssertEqual(moved.region.height, resized.region.height, accuracy: 0.00001)
        XCTAssertEqual(moved.region.x, resized.region.x + 0.05, accuracy: 0.00001)
        XCTAssertEqual(moved.region.y, resized.region.y + 0.05, accuracy: 0.00001)
        XCTAssertEqual(moved.style, original.style)
    }

    @MainActor func testPanelRemainsScreenSizedInMountedZoomedPage() async throws {
        let (_, overlay, note) = fixture(size: CGSize(width: 5609.6, height: 7764.01))
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let scene = try XCTUnwrap(scenes.first { $0.activationState == .foregroundActive } ?? scenes.first)
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(x: 0, y: 0, width: 700, height: 1000)
        let controller = UIViewController(); window.rootViewController = controller
        controller.view.frame = window.bounds; controller.view.clipsToBounds = true
        controller.view.addSubview(overlay); window.isHidden = false
        defer { window.isHidden = true; window.rootViewController = nil }
        for _ in 0..<100 {
            window.layoutIfNeeded(); controller.view.layoutIfNeeded()
            if overlay.window === window { break }
            try await Task.sleep(for: .milliseconds(20))
        }
        XCTAssertTrue(try XCTUnwrap(overlay.window) === window)
        for scale in [CGFloat(700 / 5609.6), CGFloat(1000 / 5609.6)] {
            overlay.transform = CGAffineTransform(scaleX: scale, y: scale)
            overlay.center = CGPoint(x: overlay.bounds.width * scale / 2, y: overlay.bounds.height * scale / 2)
            overlay.updateInkResolution(displayScale: scale)
            overlay.handleTap(at: CGPoint(x: overlay.bounds.width * 0.35, y: overlay.bounds.height * 0.275))
            if overlay.expandedNoteID != note.id { overlay.handleTap(at: CGPoint(x: overlay.bounds.width * 0.35, y: overlay.bounds.height * 0.275)) }
            let panel = try panel(in: overlay)
            let screenFrame = panel.convert(panel.bounds, to: window)
            XCTAssertFalse(panel.isHidden)
            XCTAssertEqual(screenFrame.width, 320, accuracy: 0.01)
            XCTAssertTrue(window.bounds.contains(screenFrame))
            let edit = try XCTUnwrap(panel.subviews.compactMap { $0 as? UIButton }.first { $0.accessibilityIdentifier == "editScoreNote" })
            XCTAssertEqual(edit.convert(edit.bounds, to: window).height, 44, accuracy: 0.01)
        }
    }

    @MainActor func testOverlappingPanelKeepsTouchPriorityUntilCloseRevealsCorner() throws {
        let (_, overlay, original) = fixture(size: CGSize(width: 600, height: 120))
        overlay.updateInkResolution(displayScale: 1)
        var note = original
        note.region = NormalizedRect(x: 0.1, y: 0.2, width: 0.5, height: 0.5)
        overlay.displayedTextBoxes = [note]
        overlay.handleTap(at: CGPoint(x: 210, y: 54))
        let panel = try panel(in: overlay)
        XCTAssertFalse(panel.isHidden)
        let point = CGPoint(x: 65, y: 29)
        XCTAssertTrue(panel.frame.contains(point), "The short viewport must exercise the overlapping fallback")
        XCTAssertEqual(overlay.editableNote(at: point)?.id, note.id)
        let panelHit = try XCTUnwrap(overlay.hitTest(point, with: nil))
        XCTAssertTrue(panelHit === panel || panelHit.isDescendant(of: panel), "A generous resize target must not steal panel controls or scrolling")
        let close = try XCTUnwrap(panel.subviews.compactMap { $0 as? UIButton }.first { $0.accessibilityIdentifier == "closeScoreNote" })
        close.sendActions(for: .touchUpInside)
        XCTAssertTrue(panel.isHidden)
        XCTAssertTrue(overlay.hitTest(point, with: nil) === overlay)
        XCTAssertTrue(overlay.captureNotePanStart(at: point))
    }

    @MainActor func testConsecutiveResizeThenMoveUsesCompleteDurableReceiptWithoutParentRefresh() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("note-receipt-\(UUID())")
        defer { try? FileManager.default.removeItem(at: directory) }
        var clock = Date(timeIntervalSince1970: 100)
        let store = PracticeStore(directory: directory, now: { clock })
        let piece = Piece(title: "Note receipt", pdfFileName: "receipt.pdf", pageCount: 1)
        try store.addPiece(piece)
        let (_, overlay, template) = fixture()
        var input = template; input.pieceID = piece.id; input.createdAt = Date(timeIntervalSince1970: 50)
        try store.saveTextAnnotation(input)
        let original = try XCTUnwrap(store.state.textAnnotations.first)
        overlay.displayedTextBoxes = [original]
        var expectedTimes: [Date] = []
        overlay.onMoveTextBox = { expected, region in
            expectedTimes.append(expected.updatedAt)
            guard store.state.textAnnotations.first == expected else {
                XCTFail("Each immediately consecutive edit must present the actual last committed timestamp")
                return nil
            }
            var changed = expected; changed.region = region
            do { try store.saveTextAnnotation(changed) }
            catch { XCTFail("Unexpected note write failure: \(error)"); return nil }
            return store.state.textAnnotations.first
        }
        overlay.handleTap(at: CGPoint(x: 210, y: 220))
        let corner = CGPoint(x: 300, y: 280)
        clock = Date(timeIntervalSince1970: 200)
        XCTAssertTrue(overlay.captureNotePanStart(at: corner))
        overlay.handleNotePan(state: .began, location: corner)
        overlay.handleNotePan(state: .ended, location: CGPoint(x: 360, y: 320))
        let resized = try XCTUnwrap(overlay.displayedTextBoxes.first)
        XCTAssertEqual(resized, store.state.textAnnotations.first)
        XCTAssertEqual(resized.updatedAt, clock)
        XCTAssertEqual(resized.region.width, 0.4, accuracy: 0.00001)
        XCTAssertEqual(resized.region.height, 0.2, accuracy: 0.00001)

        // Deliberately do not assign displayedTextBoxes or refresh the parent between edits.
        clock = Date(timeIntervalSince1970: 300)
        let interior = CGPoint(x: 220, y: 230)
        XCTAssertTrue(overlay.captureNotePanStart(at: interior))
        overlay.handleNotePan(state: .began, location: interior)
        overlay.handleNotePan(state: .ended, location: CGPoint(x: 250, y: 270))
        let moved = try XCTUnwrap(overlay.displayedTextBoxes.first)
        XCTAssertEqual(expectedTimes, [original.updatedAt, resized.updatedAt])
        XCTAssertEqual(moved, store.state.textAnnotations.first)
        XCTAssertEqual(moved.updatedAt, clock)
        XCTAssertEqual(moved.region.x, 0.25, accuracy: 0.00001)
        XCTAssertEqual(moved.region.y, 0.25, accuracy: 0.00001)
        XCTAssertEqual(moved.region.width, resized.region.width)
        XCTAssertEqual(moved.region.height, resized.region.height)
        XCTAssertEqual(moved.style, original.style)
        XCTAssertEqual(moved.createdAt, original.createdAt)
        XCTAssertEqual(moved.text, original.text)
        XCTAssertFalse(overlay.commitNoteMove(original, to: original.region), "A genuinely stale edit remains rejected")
        XCTAssertEqual(expectedTimes.count, 2)
        XCTAssertEqual(PracticeStore(directory: directory).state.textAnnotations.first, moved)
    }
}
