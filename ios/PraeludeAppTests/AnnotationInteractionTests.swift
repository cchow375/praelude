import PDFKit
import PencilKit
import SwiftUI
import XCTest
@testable import Praelude

final class AnnotationInteractionTests: XCTestCase {
    @MainActor private func ink() -> PKDrawing {
        let points = [CGPoint(x: 140, y: 240), CGPoint(x: 310, y: 255)].enumerated().map { index, point in
            PKStrokePoint(location: point, timeOffset: Double(index) / 10, size: CGSize(width: 1, height: 1),
                          opacity: 1, force: 1, azimuth: 0, altitude: .pi / 2)
        }
        return PKDrawing(strokes: [PKStroke(ink: PKInk(.pen, color: .black), path: PKStrokePath(controlPoints: points, creationDate: .now))])
    }

    @MainActor func testNativeInkZoomChangesRendererWithoutMovingOrRewritingSavedStrokeCoordinates() throws {
        for crop: NormalizedRect? in [nil, NormalizedRect(x: 0.1, y: 0.2, width: 0.5, height: 0.6)] {
            let state = ScoreMarkupState()
            let overlay = ScorePageOverlay(page: 1, markup: state)
            overlay.activeCrop = crop
            overlay.frame = CGRect(x: 0, y: 0, width: 600, height: 800)
            overlay.layoutIfNeeded()
            overlay.canvas.drawing = ink(); overlay.otherLayersCanvas.drawing = ink()
            let before = overlay.canvas.drawing.dataRepresentation()
            let source = CGPoint(x: 140, y: 240)
            let expected = CGPoint(x: overlay.sourceCanvasFrame.minX + source.x, y: overlay.sourceCanvasFrame.minY + source.y)
            for scale: CGFloat in [1, 2, 4, 6, 1] {
                overlay.updateInkResolution(displayScale: scale)
                overlay.layoutIfNeeded()
                XCTAssertEqual(overlay.canvas.zoomScale, scale, accuracy: 0.001, "PencilKit itself must zoom; an outer view transform alone pixelates ink")
                for canvas in [overlay.canvas, overlay.otherLayersCanvas] {
                    let shown = canvas.convert(CGPoint(x: source.x * scale, y: source.y * scale), to: overlay)
                    XCTAssertEqual(shown.x, expected.x, accuracy: 0.02)
                    XCTAssertEqual(shown.y, expected.y, accuracy: 0.02)
                }
                XCTAssertEqual(overlay.canvas.drawing.dataRepresentation(), before, "Rendering changes must leave saved vector data byte-identical")
                XCTAssertEqual(overlay.canvas.frame.minX, overlay.sourceCanvasFrame.minX, accuracy: 0.02)
                XCTAssertEqual(overlay.canvas.frame.width, overlay.sourceCanvasFrame.width, accuracy: 0.02)
            }
            XCTAssertFalse(overlay.otherLayersCanvas.isUserInteractionEnabled)
        }
    }

    @MainActor func testDrawingCanvasKeepsLocalUndoAcrossModeChangesAndCanYieldNativeFocusToTextEditor() throws {
        let state = ScoreMarkupState()
        let overlay = ScorePageOverlay(page: 1, markup: state)
        let second = ScorePageOverlay(page: 2, markup: state)
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 600, height: 800))
        let controller = UIViewController(); window.rootViewController = controller
        controller.view.addSubview(overlay); overlay.frame = controller.view.bounds; window.isHidden = false
        defer { window.isHidden = true }
        let manager = try XCTUnwrap(overlay.canvas.undoManager)
        var undone = false
        manager.registerUndo(withTarget: overlay) { _ in undone = true }
        XCTAssertTrue(overlay.canvas.becomeFirstResponder(), "Native lasso/edit commands retain responder support")
        for _ in 0..<30 {
            for kind in AnnotationToolKind.allCases {
                state.mode = .writing; state.tool.kind = kind; overlay.refresh()
                state.mode = .reading; overlay.refresh()
                XCTAssertTrue(overlay.canvas.isFirstResponder, "Mode changes must not force a responder handoff")
            }
        }
        let textEditor = UITextView(frame: CGRect(x: 0, y: 0, width: 200, height: 100))
        controller.view.addSubview(textEditor)
        XCTAssertTrue(textEditor.becomeFirstResponder())
        XCTAssertFalse(overlay.canvas.isFirstResponder, "A note editor must be allowed to take focus without fighting an app-forced canvas responder")
        XCTAssertTrue(manager.canUndo)
        XCTAssertFalse(try XCTUnwrap(second.canvas.undoManager).canUndo, "Another PDF page must not inherit this page's undo history")
        manager.undo(); XCTAssertTrue(undone)
    }

    @MainActor func testTwoFingerUndoTargetsSelectionOrInkWithoutChangingModesAndRespectsPerformanceLock() {
        let state = ScoreMarkupState()
        let parent = PagedScoreView(url: URL(fileURLWithPath: "/two-finger.pdf"), page: .constant(1), twoPages: false,
                                   markup: state, onPageChanged: { _ in })
        let coordinator = parent.makeCoordinator()
        var inkUndos = 0; state.undoInk = { inkUndos += 1 }
        coordinator.undoFromTouch()
        XCTAssertEqual(inkUndos, 1); XCTAssertEqual(state.mode, .reading)
        state.mode = .writing; coordinator.undoFromTouch()
        XCTAssertEqual(inkUndos, 2); XCTAssertEqual(state.mode, .writing)
        state.begin(Passage(pieceID: UUID(), title: "Draft"))
        state.rememberSelection()
        state.update(PassageRegion(page: 1, x: 0.1, y: 0.2, width: 0.3, height: 0.1))
        coordinator.undoFromTouch()
        XCTAssertTrue(state.regions.isEmpty); XCTAssertEqual(inkUndos, 2)
        coordinator.parent.focusPageTurns = true
        state.mode = .reading; coordinator.undoFromTouch()
        XCTAssertEqual(inkUndos, 2)
    }

    @MainActor func testNoteMoveOnlyChangesPositionAfterSuccessfulSaveAndRejectsOtherLayers() {
        let state = ScoreMarkupState()
        let overlay = ScorePageOverlay(page: 1, markup: state)
        let original = TextBoxAnnotation(pieceID: UUID(), page: 1, region: NormalizedRect(x: 0.1, y: 0.2, width: 0.18, height: 0.035), text: "Keep the pulse")
        let next = NormalizedRect(x: 0.5, y: 0.6, width: 0.18, height: 0.035)
        overlay.displayedTextBoxes = [original]
        var allow = false; var saves = 0
        overlay.onMoveTextBox = { note, region in
            XCTAssertEqual(note, original); XCTAssertEqual(region, next)
            saves += 1; return allow
        }
        XCTAssertFalse(overlay.commitNoteMove(original, to: next))
        XCTAssertEqual(overlay.displayedTextBoxes, [original], "Failed saving must never visually pretend the note moved")
        allow = true; XCTAssertTrue(overlay.commitNoteMove(original, to: next))
        XCTAssertEqual(overlay.displayedTextBoxes[0].region, next)
        XCTAssertEqual(overlay.displayedTextBoxes[0].text, original.text)
        XCTAssertEqual(overlay.displayedTextBoxes[0].id, original.id)
        var teacher = original; teacher.layer = .teacher
        XCTAssertFalse(overlay.commitNoteMove(teacher, to: next)); XCTAssertEqual(saves, 2)
    }

    @MainActor func testMovedNoteQuickEditAndDictationUseVisibleActiveNoteAndRespectLocks() throws {
        let state = ScoreMarkupState()
        let overlay = ScorePageOverlay(page: 1, markup: state)
        overlay.frame = CGRect(x: 0, y: 0, width: 600, height: 400)
        let original = TextBoxAnnotation(pieceID: UUID(), page: 1,
                                         region: NormalizedRect(x: 0.1, y: 0.2, width: 0.18, height: 0.035), text: "Listen to the bass")
        let moved = NormalizedRect(x: 0.48, y: 0.70, width: 0.18, height: 0.035)
        overlay.displayedTextBoxes = [original]
        overlay.onMoveTextBox = { _, _ in true }
        XCTAssertTrue(overlay.commitNoteMove(original, to: moved))
        let target = CGPoint(x: 600 * 0.57, y: 400 * 0.7175)
        let saved = try XCTUnwrap(overlay.editableNote(at: target))
        XCTAssertEqual(saved.region, moved)
        XCTAssertNil(overlay.editableNote(at: CGPoint(x: 114, y: 87)))
        var edits: [TextBoxAnnotation] = []; var dictations: [TextBoxAnnotation] = []
        overlay.onEditTextBox = { edits.append($0) }
        overlay.onDictateTextBox = { dictations.append($0) }
        overlay.handleTap(at: target)
        XCTAssertEqual(overlay.expandedNoteID, original.id, "A single tap still expands the moved note")
        overlay.handleNoteQuickTap(at: target, dictation: false)
        XCTAssertEqual(edits, [saved]); XCTAssertTrue(dictations.isEmpty)
        XCTAssertNil(overlay.expandedNoteID, "The expanded chip must not remain over the editor")
        overlay.handleNoteQuickTap(at: target, dictation: true)
        XCTAssertEqual(dictations, [saved]); XCTAssertEqual(edits.count, 1)
        XCTAssertTrue(overlay.noteEditTap.view === overlay)
        XCTAssertTrue(overlay.noteDictateTap.view === overlay)
        XCTAssertEqual(overlay.noteEditTap.numberOfTapsRequired, 2)
        XCTAssertEqual(overlay.noteDictateTap.numberOfTapsRequired, 3)
        XCTAssertEqual(overlay.noteEditTap.allowedTouchTypes, [NSNumber(value: UITouch.TouchType.direct.rawValue)],
                       "Pencil crossing a note stays ink instead of opening an editor")
        overlay.inkReadOnly = true
        overlay.handleNoteQuickTap(at: target, dictation: false)
        overlay.handleNoteQuickTap(at: target, dictation: true)
        overlay.inkReadOnly = false; state.activeLayer = .teacher
        overlay.handleNoteQuickTap(at: target, dictation: false)
        state.activeLayer = .mine; state.mode = .selecting
        overlay.handleNoteQuickTap(at: target, dictation: true)
        state.mode = .reading; state.visibleLayers = [.teacher]
        overlay.handleNoteQuickTap(at: target, dictation: false)
        XCTAssertEqual(edits, [saved]); XCTAssertEqual(dictations, [saved],
                                                        "Performance, inactive/hidden layers and selection never edit notes")
    }

    @MainActor func testNoteAccessibilityRetainsIdentityAndAlignsWithCropZoomMoveAndPermissions() async throws {
        let state = ScoreMarkupState()
        let overlay = ScorePageOverlay(page: 1, markup: state)
        overlay.frame = CGRect(x: 0, y: 0, width: 600, height: 800)
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let scene = try XCTUnwrap(scenes.first { $0.activationState == .foregroundActive } ?? scenes.first,
                                 "Screen-coordinate assertions require the hosted app's real window scene")
        let window = UIWindow(windowScene: scene); window.frame = overlay.frame
        let controller = UIViewController(); window.rootViewController = controller
        controller.view.frame = window.bounds
        controller.view.addSubview(overlay); window.isHidden = false
        defer { window.isHidden = true; window.rootViewController = nil }
        // A UIWindow(frame:) without a scene can leave its root view detached. PDFKit's real
        // accessibility path is mounted; wait for and assert that same precondition here.
        for _ in 0..<100 {
            window.layoutIfNeeded(); controller.view.layoutIfNeeded()
            if overlay.window === window { break }
            try await Task.sleep(for: .milliseconds(20))
        }
        let mountedWindow = try XCTUnwrap(overlay.window, "Do not compare detached view-local coordinates with screen coordinates")
        XCTAssertTrue(mountedWindow === window)
        XCTAssertTrue(overlay.isDescendant(of: window))
        XCTAssertFalse(window.isHidden)
        overlay.activeCrop = NormalizedRect(x: 0.2, y: 0.2, width: 0.5, height: 0.6)
        overlay.layoutIfNeeded()
        var note = TextBoxAnnotation(pieceID: UUID(), page: 1,
                                     region: NormalizedRect(x: 0.3, y: 0.3, width: 0.18, height: 0.035), text: "Listen to the bass")
        overlay.displayedTextBoxes = [note]
        func elements() -> [UIAccessibilityElement] { (overlay.accessibilityElements ?? []).compactMap { $0 as? UIAccessibilityElement } }
        let element = try XCTUnwrap(elements().first)
        XCTAssertEqual(elements().count, 1)
        XCTAssertEqual(element.accessibilityIdentifier, "scoreNote_\(note.id.uuidString)")
        XCTAssertEqual(element.accessibilityLabel, note.text)
        XCTAssertEqual(element.accessibilityFrameInContainerSpace.minX, 120, accuracy: 0.001)
        XCTAssertEqual(element.accessibilityFrameInContainerSpace.minY, 800 / 6, accuracy: 0.001)
        XCTAssertEqual(element.accessibilityFrameInContainerSpace.width, 216, accuracy: 0.001)
        XCTAssertTrue((overlay.accessibilityElements ?? []).contains { ($0 as? UIView) === overlay.canvas },
                      "Adding a chip must retain the native PencilKit accessibility container")
        XCTAssertTrue(element.accessibilityActivate())
        XCTAssertEqual(overlay.expandedNoteID, note.id)
        let panel = try XCTUnwrap((overlay.accessibilityElements ?? []).compactMap { $0 as? UIView }.first { $0.accessibilityIdentifier == "expandedScoreNote" })
        XCTAssertFalse(panel.isHidden, "VoiceOver activation must expose the real note panel and its edit controls")
        overlay.transform = CGAffineTransform(scaleX: 2, y: 2)
        let zoomed = overlay.convert(element.accessibilityFrameInContainerSpace, to: nil)
        XCTAssertEqual(element.accessibilityFrame.minX, zoomed.minX, accuracy: 0.001)
        XCTAssertEqual(element.accessibilityFrame.width, zoomed.width, accuracy: 0.001)
        note.region.x += 0.05; note.text = "Keep the bass clear"
        overlay.displayedTextBoxes = [note]
        XCTAssertTrue(elements().first === element, "Moving or editing a note retains its accessibility identity")
        XCTAssertEqual(element.accessibilityLabel, note.text)
        XCTAssertEqual(element.accessibilityFrameInContainerSpace.minX, 180, accuracy: 0.001)
        state.visibleLayers = [.teacher]; overlay.refresh()
        XCTAssertTrue(elements().isEmpty); XCTAssertFalse(element.accessibilityActivate())
        state.visibleLayers = [.mine]; overlay.refresh()
        XCTAssertTrue(elements().first === element)
        overlay.inkReadOnly = true; overlay.refresh()
        XCTAssertTrue(elements().isEmpty); XCTAssertFalse(element.accessibilityActivate())
        XCTAssertNil(overlay.expandedNoteID)
        overlay.inkReadOnly = false; state.mode = .selecting; overlay.refresh()
        XCTAssertFalse(element.accessibilityActivate(), "A retained accessibility reference must recheck current mode")
        state.mode = .reading; overlay.refresh()
        XCTAssertTrue(element.accessibilityActivate())
        overlay.activeCrop = NormalizedRect(x: 0.8, y: 0.8, width: 0.1, height: 0.1)
        XCTAssertTrue(elements().isEmpty)
        XCTAssertFalse(element.accessibilityActivate(), "A retained chip excluded by the current crop cannot activate an invisible panel")
        overlay.activeCrop = NormalizedRect(x: 0.2, y: 0.2, width: 0.5, height: 0.6)
        XCTAssertTrue(elements().first === element)
        overlay.displayedTextBoxes = []
        XCTAssertTrue(elements().isEmpty); XCTAssertFalse(element.accessibilityActivate())
    }

    @MainActor func testPDFAccessibilityPublishesOnlyAttachedVisibleOverlaysAndKeepsNativeTraversal() throws {
        let state = ScoreMarkupState()
        let parent = PagedScoreView(url: URL(fileURLWithPath: "/accessible-notes.pdf"), page: .constant(1),
                                   twoPages: false, markup: state, onPageChanged: { _ in })
        let coordinator = parent.makeCoordinator()
        let pdf = ZoomableScorePDFView(frame: CGRect(x: 0, y: 0, width: 600, height: 800))
        pdf.pageOverlayViewProvider = coordinator
        let nativeTextContainer = UITextView(frame: pdf.bounds)
        pdf.addSubview(nativeTextContainer)
        pdf.accessibilityElements = [nativeTextContainer]
        let wrapper = UIView(frame: pdf.bounds); pdf.addSubview(wrapper)
        let overlay = ScorePageOverlay(page: 1, markup: state)
        overlay.frame = pdf.bounds; wrapper.addSubview(overlay)
        coordinator.overlays[1] = overlay
        overlay.displayedTextBoxes = [TextBoxAnnotation(pieceID: UUID(), page: 1,
            region: NormalizedRect(x: 0.3, y: 0.4, width: 0.18, height: 0.035), text: "Listen to the bass")]
        let published = try XCTUnwrap(pdf.accessibilityElements)
        XCTAssertTrue(published.first as? UIView === nativeTextContainer, "PDFKit's native text traversal remains first")
        XCTAssertTrue(published.contains { ($0 as? UIView) === overlay })
        XCTAssertEqual(published.filter { ($0 as? UIView) === overlay }.count, 1)
        XCTAssertEqual((overlay.accessibilityElements ?? []).compactMap { $0 as? UIAccessibilityElement }.count, 1)
        wrapper.isHidden = true
        XCTAssertFalse((pdf.accessibilityElements ?? []).contains { ($0 as? UIView) === overlay }, "Explicit publication must respect a hidden PDFKit ancestor")
        wrapper.isHidden = false; wrapper.alpha = 0
        XCTAssertFalse((pdf.accessibilityElements ?? []).contains { ($0 as? UIView) === overlay })
        wrapper.alpha = 1; wrapper.accessibilityElementsHidden = true
        XCTAssertFalse((pdf.accessibilityElements ?? []).contains { ($0 as? UIView) === overlay })
        wrapper.accessibilityElementsHidden = false
        overlay.frame.origin.y = 900
        XCTAssertFalse((pdf.accessibilityElements ?? []).contains { ($0 as? UIView) === overlay }, "Offscreen cached pages must not expose invisible notes")
        overlay.frame.origin.y = 0
        pdf.accessibilityElements = nil
        XCTAssertTrue((pdf.accessibilityElements ?? []).contains { ($0 as? UIView) === nativeTextContainer },
                      "When PDFKit uses implicit subview traversal, preserve that path too")
        XCTAssertEqual((pdf.accessibilityElements ?? []).filter { ($0 as? UIView) === overlay }.count, 1)
        overlay.removeFromSuperview()
        XCTAssertFalse((pdf.accessibilityElements ?? []).contains { ($0 as? UIView) === overlay }, "A retained failed-save overlay is not an on-screen accessibility target")
    }

    @MainActor func testMovingPartiallyCroppedNotePreservesItsFullSourceSize() throws {
        let overlay = ScorePageOverlay(page: 1, markup: ScoreMarkupState())
        overlay.frame = CGRect(x: 0, y: 0, width: 600, height: 800)
        overlay.activeCrop = NormalizedRect(x: 0.2, y: 0.2, width: 0.5, height: 0.6)
        let note = TextBoxAnnotation(pieceID: UUID(), page: 1,
                                     region: NormalizedRect(x: 0.1, y: 0.18, width: 0.18, height: 0.08), text: "Keep the pulse")
        let moved = try XCTUnwrap(overlay.translatedNotePosition(note, by: CGSize(width: 120, height: 80)))
        XCTAssertEqual(moved.x, 0.2, accuracy: 0.000001)
        XCTAssertEqual(moved.y, 0.24, accuracy: 0.000001)
        XCTAssertEqual(moved.width, note.region.width, "The clipped-off left portion is still part of the saved note")
        XCTAssertEqual(moved.height, note.region.height, "The clipped-off top portion is still part of the saved note")
        let edge = try XCTUnwrap(overlay.translatedNotePosition(note, by: CGSize(width: 12_000, height: -8_000)))
        XCTAssertEqual(edge.x, 1 - note.region.width, accuracy: 0.000001)
        XCTAssertEqual(edge.y, 0, accuracy: 0.000001)
        XCTAssertEqual(edge.width, note.region.width)
        XCTAssertEqual(edge.height, note.region.height)
        overlay.activeCrop = nil
        let fullPage = try XCTUnwrap(overlay.translatedNotePosition(note, by: CGSize(width: 120, height: 80)))
        XCTAssertEqual(fullPage.x, 0.3, accuracy: 0.000001)
        XCTAssertEqual(fullPage.y, 0.28, accuracy: 0.000001)
        XCTAssertNil(overlay.translatedNotePosition(note, by: CGSize(width: CGFloat.infinity, height: 0)))
    }

    @MainActor func testThinNoteDragUsesOriginalTouchAndPreservesMovementBeforeRecognition() throws {
        let overlay = ScorePageOverlay(page: 1, markup: ScoreMarkupState())
        overlay.frame = CGRect(x: 0, y: 0, width: 600, height: 400)
        let note = TextBoxAnnotation(pieceID: UUID(), page: 1,
                                     region: NormalizedRect(x: 0.1, y: 0.2, width: 0.18, height: 0.035), text: "Listen to the bass")
        overlay.displayedTextBoxes = [note]
        let start = CGPoint(x: 114, y: 87)
        let recognized = CGPoint(x: start.x + 8, y: start.y + 30)
        XCTAssertEqual(overlay.note(at: start)?.id, note.id)
        XCTAssertNil(overlay.note(at: recognized), "The recognition sample has already left the thin chip")
        XCTAssertTrue(overlay.captureNotePanStart(at: start))
        XCTAssertEqual(overlay.movableNoteAtPanStart()?.id, note.id)
        var saves: [NormalizedRect] = []
        overlay.onMoveTextBox = { saved, position in
            XCTAssertEqual(saved.id, note.id); saves.append(position); return true
        }
        // Actual UIKit evidence reports translation zero at .began. The real touch-down sample
        // must supply the origin independently of that recognizer-derived translation.
        overlay.handleNotePan(state: .began, location: recognized)
        overlay.handleNotePan(state: .changed, location: CGPoint(x: start.x + 70, y: start.y + 55))
        XCTAssertTrue(saves.isEmpty, "Only release writes the final note position")
        XCTAssertEqual(overlay.displayedTextBoxes[0], note)
        overlay.handleNotePan(state: .ended, location: CGPoint(x: start.x + 120, y: start.y + 80))
        let saved = try XCTUnwrap(saves.first)
        XCTAssertEqual(saves.count, 1)
        XCTAssertEqual(saved.x, 0.3, accuracy: 0.000001)
        XCTAssertEqual(saved.y, 0.4, accuracy: 0.000001, "Keep the full 80-point drag, including the 30 points before recognition")
        XCTAssertEqual(saved.width, note.region.width); XCTAssertEqual(saved.height, note.region.height)
        XCTAssertEqual(overlay.displayedTextBoxes[0].region, saved)

        overlay.displayedTextBoxes = [note]
        XCTAssertFalse(overlay.captureNotePanStart(at: CGPoint(x: start.x, y: start.y + 30)),
                     "A score pan that started outside the note must not be hijacked when it crosses the chip")
        XCTAssertNil(overlay.movableNoteAtPanStart())
        XCTAssertTrue(overlay.captureNotePanStart(at: start))
        overlay.handleNotePan(state: .began, location: recognized)
        overlay.handleNotePan(state: .cancelled, location: recognized)
        overlay.handleNotePan(state: .ended, location: CGPoint(x: start.x + 120, y: start.y + 80))
        XCTAssertEqual(saves.count, 1, "A canceled drag must never commit a late release")
        XCTAssertEqual(overlay.displayedTextBoxes[0], note)

        overlay.handleTap(at: start)
        XCTAssertEqual(overlay.expandedNoteID, note.id)
        overlay.inkReadOnly = true; overlay.refresh()
        XCTAssertNil(overlay.expandedNoteID)
        XCTAssertNil(overlay.hitTest(start, with: nil), "Performance mode must leave every score touch available for page turning")
        XCTAssertFalse(overlay.containsNote(at: start), "A locked note must not block the parent's hold-to-exit recognizer")
        XCTAssertFalse(overlay.captureNotePanStart(at: start))
        XCTAssertNil(overlay.movableNoteAtPanStart())
        XCTAssertFalse(overlay.commitNoteMove(note, to: saved), "Entering performance mode during a drag must prevent its later save")
        XCTAssertEqual(saves.count, 1)
    }

    @MainActor func testFinishingPencilStrokeWhilePracticingKeepsPracticeMode() {
        let state = ScoreMarkupState()
        let parent = PagedScoreView(url: URL(fileURLWithPath: "/practice-ink.pdf"), page: .constant(1), twoPages: false,
                                   markup: state, onPageChanged: { _ in })
        let coordinator = parent.makeCoordinator()
        defer { coordinator.autosave?.cancel() }
        let overlay = ScorePageOverlay(page: 1, markup: state); coordinator.overlays[1] = overlay
        coordinator.canvasViewDidBeginUsingTool(overlay.canvas)
        coordinator.canvasViewDidEndUsingTool(overlay.canvas)
        XCTAssertEqual(state.mode, .reading, "A quick Pencil correction must not replace the practice interface with editing mode")
    }

    /// Diagnostic timing is emitted separately from correctness assertions: simulator/Debug time
    /// is evidence of work on the main actor, not a claim about physical iPad frame pacing.
    @MainActor func testDenseAnnotationCheckpointPreservesHistoryAndExistingInkAndReportsLatency() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("annotation-checkpoint-\(UUID())")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let piece = Piece(title: "Synthetic checkpoint score", pdfFileName: "synthetic.pdf", pageCount: 1)
        let date = Date(timeIntervalSince1970: 1_700_000_000)
        var fixture = LibraryState(); fixture.pieces = [piece]
        for index in 0..<200 {
            let started = date.addingTimeInterval(Double(index) * 1_800)
            var session = PracticeSession(pieceID: piece.id, focus: "Pulse", startedAt: started)
            let configuration = PracticeConfiguration(pieceID: piece.id, basis: .totalPlays, targetCount: 20)
            var set = ActiveSet(sessionID: session.id, configuration: configuration, startedAt: started)
            set.attempts = (0..<20).map { Attempt(verdict: $0.isMultiple(of: 4) ? .sloppy : .clean,
                                                  date: started.addingTimeInterval(Double($0) * 20), bpm: 60) }
            set = PracticeEngine.project(set)
            set.endedAt = started.addingTimeInterval(600); set.lastCheckpoint = nil; set.activeSeconds = 600
            session.endedAt = set.endedAt; session.activeSeconds = 600; session.completedSets = 1; session.attempts = set.attempts
            fixture.sessions.append(session); fixture.history.append(set)
        }
        func stroke(_ index: Int) -> PKStroke {
            var points: [PKStrokePoint] = []
            for point in 0..<24 {
                let x: CGFloat = 20 + CGFloat(point) * 3 + CGFloat(index % 10)
                let y: CGFloat = 30 + CGFloat(index % 700) + CGFloat(point % 4)
                points.append(PKStrokePoint(location: CGPoint(x: x, y: y), timeOffset: Double(point) / 120,
                                            size: CGSize(width: 1.1, height: 1.1), opacity: 1, force: 1,
                                            azimuth: 0, altitude: CGFloat.pi / 2))
            }
            return PKStroke(ink: PKInk(.pen, color: .black), path: PKStrokePath(controlPoints: points, creationDate: date.addingTimeInterval(Double(index))))
        }
        let original = PKDrawing(strokes: (0..<750).map(stroke))
        let inputs = InkPerStroke.split(original)
        fixture.inkStrokes = inputs.enumerated().map { index, input in
            InkStroke(pieceID: piece.id, page: 1, data: input.data, fingerprint: input.fingerprint,
                      createdAt: date.addingTimeInterval(Double(index) * 0.001))
        }
        try PracticeStore.validate(fixture)
        let encoder = JSONEncoder(); encoder.dateEncodingStrategy = .deferredToDate
        try encoder.encode(fixture).write(to: directory.appendingPathComponent("library.json"), options: .atomic)
        let store = PracticeStore(directory: directory)
        XCTAssertFalse(store.isReadOnly, store.errorMessage ?? "The synthetic library should open")
        let rowsBefore = store.inkStrokes(pieceID: piece.id, page: 1, layer: .mine)
        var merged = try InkPerStroke.merge(rowsBefore.map(\.data)).dataRepresentation()
        var splitMS: Double = 0, commitMS: Double = 0, mergeMS: Double = 0
        let clock = ContinuousClock()
        func milliseconds(since instant: ContinuousClock.Instant) -> Double {
            let parts = instant.duration(to: clock.now).components
            return Double(parts.seconds) * 1_000 + Double(parts.attoseconds) / 1e15
        }
        let state = ScoreMarkupState()
        let parent = PagedScoreView(url: directory.appendingPathComponent("synthetic.pdf"), page: .constant(1), twoPages: false,
                                   markup: state, drawingData: { _ in merged }, saveDrawing: { page, data, expected in
            guard expected == merged else { return false }
            do {
                let splitStart = clock.now
                let strokes = InkPerStroke.split(try PKDrawing(data: data), reusing: store.inkStrokes(pieceID: piece.id, page: page, layer: .mine))
                splitMS = milliseconds(since: splitStart)
                let commitStart = clock.now
                try store.replaceInk(pieceID: piece.id, page: page, layer: .mine, strokes: strokes)
                commitMS = milliseconds(since: commitStart)
                let mergeStart = clock.now
                merged = try InkPerStroke.merge(store.inkStrokes(pieceID: piece.id, page: page, layer: .mine).map(\.data)).dataRepresentation()
                mergeMS = milliseconds(since: mergeStart)
                return true
            } catch { XCTFail("Synthetic checkpoint failed: \(error)"); return false }
        }, onPageChanged: { _ in })
        let coordinator = parent.makeCoordinator(); coordinator.connectControls()
        defer { coordinator.autosave?.cancel() }
        let pdfData = UIGraphicsPDFRenderer(bounds: CGRect(x: 0, y: 0, width: 612, height: 792)).pdfData { $0.beginPage() }
        let pdf = try XCTUnwrap(PDFDocument(data: pdfData)); let view = PDFView(); view.document = pdf
        let overlay = try XCTUnwrap(coordinator.pdfView(view, overlayViewFor: XCTUnwrap(pdf.page(at: 0))) as? ScorePageOverlay)
        coordinator.loading = true; overlay.canvas.drawing = PKDrawing(strokes: original.strokes + [stroke(751)]); coordinator.loading = false
        coordinator.canvasViewDrawingDidChange(overlay.canvas)
        let checkpointStart = clock.now
        XCTAssertTrue(coordinator.flush())
        let checkpointMS = milliseconds(since: checkpointStart)
        let bytes = try Data(contentsOf: store.fileURL)
        NSLog("PraeludeAnnotationCheckpoint: strokes=751 historySets=200 attempts=4000 libraryBytes=%d splitMS=%.2f commitMS=%.2f mergeMS=%.2f totalMS=%.2f", bytes.count, splitMS, commitMS, mergeMS, checkpointMS)
        XCTAssertTrue(state.pendingInk.isEmpty); XCTAssertTrue(coordinator.dirtyPages.isEmpty)
        let reopened = PracticeStore(directory: directory)
        XCTAssertFalse(reopened.isReadOnly)
        XCTAssertEqual(reopened.state.history, fixture.history)
        XCTAssertEqual(reopened.state.sessions, fixture.sessions)
        let after = reopened.inkStrokes(pieceID: piece.id, page: 1, layer: .mine)
        XCTAssertEqual(after.count, 751)
        let byID = Dictionary(uniqueKeysWithValues: after.map { ($0.id, $0) })
        for row in rowsBefore { XCTAssertEqual(byID[row.id], row, "Untouched strokes retain every byte and identity") }
        XCTAssertEqual(try InkPerStroke.merge(after.map(\.data)).strokes.count, 751)
        let noOpStart = clock.now
        XCTAssertTrue(coordinator.flush())
        XCTAssertEqual(try Data(contentsOf: store.fileURL), bytes, "Returning from annotation twice must not rewrite an already saved checkpoint")
        NSLog("PraeludeAnnotationCheckpoint: alreadySavedMS=%.2f", milliseconds(since: noOpStart))
    }

    @MainActor private final class PinchingScrollView: UIScrollView {
        override var isZooming: Bool { true }
    }
    @MainActor func testSwipeAtFitDoesNotTurnPageWhileAnAncestorScrollViewIsPinching() throws {
        let state = ScoreMarkupState()
        var turns = 0
        let parent = PagedScoreView(url: URL(fileURLWithPath: "/pinch-swipe.pdf"), page: .constant(1), twoPages: false,
                                   markup: state, onTurnPage: { _ in turns += 1 }, onPageChanged: { _ in })
        let coordinator = parent.makeCoordinator()
        let view = ZoomableScorePDFView()
        // PDFView ignores scaleFactor assignments without a document. This must exercise actual
        // native zoom, not silently remain at the fit scale while claiming to be zoomed in.
        let data = UIGraphicsPDFRenderer(bounds: CGRect(x: 0, y: 0, width: 612, height: 792)).pdfData { $0.beginPage() }
        view.document = try XCTUnwrap(PDFDocument(data: data))
        view.minScaleFactor = 1; view.maxScaleFactor = 6; view.scaleFactor = 1
        let pinchSurface = PinchingScrollView(); view.addSubview(pinchSurface)
        let swipe = UISwipeGestureRecognizer(); swipe.direction = .left; view.addGestureRecognizer(swipe)
        XCTAssertTrue(coordinator.hasActiveZoomGesture(in: view))
        coordinator.swiped(swipe); XCTAssertEqual(turns, 0)
        pinchSurface.removeFromSuperview()
        XCTAssertFalse(coordinator.hasActiveZoomGesture(in: view))
        coordinator.swiped(swipe); XCTAssertEqual(turns, 1)
        view.scaleFactor = 2
        XCTAssertGreaterThan(view.scaleFactor, view.minScaleFactor * 1.05)
        coordinator.swiped(swipe); XCTAssertEqual(turns, 1)
    }

    func testPenWidthsAreDistinctAndHighlighterLeavesNotationReadable() throws {
        let pens = try AnnotationWidth.allCases.map { try XCTUnwrap(AnnotationTool(kind: .pen, width: $0).pkTool as? PKInkingTool) }
        XCTAssertEqual(pens[0].width, PKInkingTool.InkType.pen.validWidthRange.lowerBound, accuracy: 0.001)
        XCTAssertLessThan(pens[0].width, 1)
        XCTAssertEqual(AnnotationTool().width, .fine)
        XCTAssertGreaterThan(pens[1].width / pens[0].width, 2)
        XCTAssertGreaterThan(pens[2].width / pens[1].width, 2)
        for color in AnnotationColor.allCases {
            let marker = try XCTUnwrap(AnnotationTool(kind: .highlighter, color: color).pkTool as? PKInkingTool)
            XCTAssertLessThanOrEqual(marker.color.cgColor.alpha, 0.17)
        }
    }
}
