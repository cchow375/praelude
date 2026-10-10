import PDFKit
import PencilKit
import SwiftUI
import XCTest
@testable import Praelude

final class AsyncInkCheckpointTests: XCTestCase {
    @MainActor private final class Gate {
        var entered = false
        private var continuation: CheckedContinuation<Void, Never>?
        func wait() async {
            entered = true
            await withCheckedContinuation { continuation = $0 }
        }
        func release() { continuation?.resume(); continuation = nil }
    }
    @MainActor private func awaitEntry(_ gate: Gate) async throws {
        for _ in 0..<100 where !gate.entered { try await Task.sleep(for: .milliseconds(5)) }
        XCTAssertTrue(gate.entered, "The test must suspend inside background preparation before changing the canvas")
    }
    @MainActor private func drawing(_ count: Int) -> PKDrawing {
        PKDrawing(strokes: (0..<count).map { index in
            let y = CGFloat(index * 30 + 50)
            let points = [CGPoint(x: 20, y: y), CGPoint(x: 200, y: y + 10)].enumerated().map { step, point in
                PKStrokePoint(location: point, timeOffset: Double(step) / 10, size: CGSize(width: 2, height: 2),
                              opacity: 1, force: 1, azimuth: 0, altitude: .pi / 2)
            }
            return PKStroke(ink: PKInk(.pen, color: .black), path: PKStrokePath(controlPoints: points, creationDate: Date(timeIntervalSince1970: Double(1_700_000_000 + index))))
        })
    }
    @MainActor private func attach(_ coordinator: PagedScoreView.Coordinator) throws -> ScorePageOverlay {
        let data = UIGraphicsPDFRenderer(bounds: CGRect(x: 0, y: 0, width: 612, height: 792)).pdfData { $0.beginPage() }
        let document = try XCTUnwrap(PDFDocument(data: data))
        let view = PDFView(); view.document = document
        return try XCTUnwrap(coordinator.pdfView(view, overlayViewFor: XCTUnwrap(document.page(at: 0))) as? ScorePageOverlay)
    }
    @MainActor private func edit(_ count: Int, overlay: ScorePageOverlay, coordinator: PagedScoreView.Coordinator) {
        coordinator.canvasViewDidBeginUsingTool(overlay.canvas)
        coordinator.loading = true; overlay.canvas.drawing = drawing(count); coordinator.loading = false
        coordinator.canvasViewDrawingDidChange(overlay.canvas)
        coordinator.canvasViewDidEndUsingTool(overlay.canvas)
    }
    @MainActor private func startIdle(_ coordinator: PagedScoreView.Coordinator) -> Task<Void, Never> {
        coordinator.autosave?.cancel()
        let task = Task { @MainActor in _ = await coordinator.flushIdle() }
        coordinator.autosave = task
        return task
    }

    @MainActor func testOlderIdleSnapshotCommitsWithoutClearingNewerStrokeAndNextSaveUsesNewBaseline() async throws {
        let state = ScoreMarkupState(); let gate = Gate()
        var saved: Data?
        let parent = PagedScoreView(url: URL(fileURLWithPath: "/async-new-stroke.pdf"), page: .constant(1), twoPages: false,
                                   markup: state, drawingData: { _ in saved }, saveDrawing: { _, data, expected in
            guard expected == saved else { XCTFail("A newer stroke must compare against the completed idle save"); return false }
            saved = data; return true
        }, saveDrawingAsync: { _, data, expected in
            await gate.wait()
            guard !Task.isCancelled, expected == saved else { return nil }
            saved = data; return ScoreInkSaveReceipt(data: data)
        }, onPageChanged: { _ in })
        let coordinator = parent.makeCoordinator(); coordinator.connectControls()
        defer { coordinator.autosave?.cancel(); gate.release() }
        let overlay = try attach(coordinator)
        edit(1, overlay: overlay, coordinator: coordinator)
        let first = overlay.canvas.drawing.dataRepresentation()
        let task = startIdle(coordinator); try await awaitEntry(gate)
        edit(2, overlay: overlay, coordinator: coordinator)
        let newest = overlay.canvas.drawing.dataRepresentation()
        gate.release(); await task.value
        XCTAssertEqual(saved, first)
        XCTAssertEqual(coordinator.committed[1], first, "Committed baseline must advance even though the canvas changed while saving")
        XCTAssertEqual(overlay.canvas.drawing.dataRepresentation(), newest)
        XCTAssertTrue(coordinator.dirtyPages.contains(1))
        XCTAssertNotNil(state.pendingInk[1], "An older generation cannot clear newer pending work")
        XCTAssertTrue(coordinator.flush())
        XCTAssertEqual(saved, newest); XCTAssertTrue(state.pendingInk.isEmpty)
        XCTAssertTrue(coordinator.dirtyPages.isEmpty)
    }

    @MainActor func testOlderSaveCannotClearToolThatEndedBeforeItsFirstDrawingCallback() async throws {
        let state = ScoreMarkupState(); let gate = Gate(); var saved: Data?
        let parent = PagedScoreView(url: URL(fileURLWithPath: "/async-late-tool.pdf"), page: .constant(1), twoPages: false,
                                   markup: state, drawingData: { _ in saved }, saveDrawing: { _, data, expected in
            guard expected == saved else { return false }; saved = data; return true
        }, saveDrawingAsync: { _, data, expected in
            await gate.wait()
            guard expected == saved else { return nil }
            saved = data; return ScoreInkSaveReceipt(data: data)
        }, onPageChanged: { _ in })
        let coordinator = parent.makeCoordinator(); coordinator.connectControls()
        defer { coordinator.autosave?.cancel(); gate.release() }
        let overlay = try attach(coordinator)
        edit(1, overlay: overlay, coordinator: coordinator)
        let task = startIdle(coordinator); try await awaitEntry(gate)
        coordinator.canvasViewDidBeginUsingTool(overlay.canvas)
        coordinator.canvasViewDidEndUsingTool(overlay.canvas)
        gate.release(); await task.value
        XCTAssertTrue(coordinator.dirtyPages.contains(1), "A completed older save cannot clear an unpublished newer tool generation")
        coordinator.loading = true; overlay.canvas.drawing = drawing(2); coordinator.loading = false
        coordinator.canvasViewDrawingDidChange(overlay.canvas)
        XCTAssertTrue(coordinator.flush())
        XCTAssertEqual(try PKDrawing(data: XCTUnwrap(saved)).strokes.count, 2)
    }

    @MainActor func testSynchronousFailedTransitionCancelsIdlePreparationAndKeepsLatestInkForRetry() async throws {
        let state = ScoreMarkupState(); state.mode = .writing
        let gate = Gate(); var saved: Data?; var allowSync = false; var asyncCommits = 0
        let parent = PagedScoreView(url: URL(fileURLWithPath: "/async-failed-transition.pdf"), page: .constant(1), twoPages: false,
                                   markup: state, drawingData: { _ in saved }, saveDrawing: { _, data, expected in
            guard allowSync, expected == saved else { return false }; saved = data; return true
        }, saveDrawingAsync: { _, data, expected in
            await gate.wait()
            guard !Task.isCancelled, expected == saved else { return nil }
            asyncCommits += 1; saved = data; return ScoreInkSaveReceipt(data: data)
        }, onPageChanged: { _ in })
        let coordinator = parent.makeCoordinator(); coordinator.connectControls()
        defer { coordinator.autosave?.cancel(); gate.release() }
        let overlay = try attach(coordinator)
        edit(1, overlay: overlay, coordinator: coordinator)
        let task = startIdle(coordinator); try await awaitEntry(gate)
        edit(2, overlay: overlay, coordinator: coordinator)
        let newest = overlay.canvas.drawing.dataRepresentation()
        state.begin(Passage(pieceID: UUID(), title: "Must wait for durable ink"))
        XCTAssertEqual(state.mode, .writing, "The failed explicit checkpoint must not consume the requested mode change")
        XCTAssertEqual(state.pendingInk[1]?.data, newest)
        gate.release(); await task.value
        XCTAssertEqual(asyncCommits, 0); XCTAssertNil(saved)
        XCTAssertEqual(state.pendingInk[1]?.data, newest)
        allowSync = true
        XCTAssertTrue(coordinator.flush()); XCTAssertEqual(saved, newest)
        XCTAssertTrue(state.pendingInk.isEmpty)
    }

    @MainActor func testCommitImmediatelyBeforeCancellationCannotRewindTheLaterSynchronousBaseline() async throws {
        let state = ScoreMarkupState(); let afterCommit = Gate(); var saved: Data?
        let parent = PagedScoreView(url: URL(fileURLWithPath: "/async-commit-race.pdf"), page: .constant(1), twoPages: false,
                                   markup: state, drawingData: { _ in saved }, saveDrawing: { _, data, expected in
            guard expected == saved else { XCTFail("The preceding committed snapshot must be reconciled before the synchronous save"); return false }
            saved = data; return true
        }, saveDrawingAsync: { _, data, expected in
            guard !Task.isCancelled, expected == saved else { return nil }
            saved = data
            // Deliberately harsher than production: hold the success callback after its commit,
            // to exercise the narrow cancellation-before-continuation race deterministically.
            await afterCommit.wait()
            return ScoreInkSaveReceipt(data: data)
        }, onPageChanged: { _ in })
        let coordinator = parent.makeCoordinator(); coordinator.connectControls()
        defer { coordinator.autosave?.cancel(); afterCommit.release() }
        let overlay = try attach(coordinator)
        edit(1, overlay: overlay, coordinator: coordinator)
        let task = startIdle(coordinator); try await awaitEntry(afterCommit)
        edit(2, overlay: overlay, coordinator: coordinator)
        let newest = overlay.canvas.drawing.dataRepresentation()
        XCTAssertTrue(coordinator.flush())
        XCTAssertEqual(saved, newest); XCTAssertEqual(coordinator.committed[1], newest)
        afterCommit.release(); await task.value
        XCTAssertEqual(coordinator.committed[1], newest, "A canceled older success cannot rewind a newer synchronous commit")
        XCTAssertEqual(coordinator.canvasBaseline[1], newest)
        XCTAssertEqual(overlay.canvas.drawing.dataRepresentation(), newest)
        XCTAssertTrue(state.pendingInk.isEmpty)
    }

    @MainActor func testRemoteChangeAfterCommitBeforeSuccessContinuationRemainsAConflict() async throws {
        let state = ScoreMarkupState(); let afterCommit = Gate(); var saved: Data?
        let parent = PagedScoreView(url: URL(fileURLWithPath: "/async-remote-after-commit.pdf"), page: .constant(1), twoPages: false,
                                   markup: state, drawingData: { _ in saved }, saveDrawing: { _, data, expected in
            guard expected == saved else { return false }; saved = data; return true
        }, saveDrawingAsync: { _, data, expected in
            guard !Task.isCancelled, expected == saved else { return nil }
            saved = data; await afterCommit.wait(); return ScoreInkSaveReceipt(data: data)
        }, onPageChanged: { _ in })
        let coordinator = parent.makeCoordinator(); coordinator.connectControls()
        defer { coordinator.autosave?.cancel(); afterCommit.release() }
        let overlay = try attach(coordinator)
        edit(2, overlay: overlay, coordinator: coordinator)
        let local = overlay.canvas.drawing.dataRepresentation()
        let task = startIdle(coordinator); try await awaitEntry(afterCommit)
        let remote = PKDrawing(strokes: Array(overlay.canvas.drawing.strokes.reversed())).dataRepresentation()
        saved = remote
        afterCommit.release(); await task.value
        XCTAssertEqual(saved, remote)
        XCTAssertEqual(overlay.canvas.drawing.dataRepresentation(), local)
        XCTAssertEqual(state.pendingInk[1]?.data, local)
        XCTAssertTrue(coordinator.dirtyPages.contains(1))
        XCTAssertNil(coordinator.committed[1], "A successful old commit does not authorize accepting later remote bytes")
        XCTAssertEqual(state.conflictPage, 1)
        XCTAssertFalse(coordinator.flush(), "The local canvas must still compare against its original baseline")
    }

    @MainActor func testOwnLassoSaveAcceptsActualCommittedRowOrderWithoutFalseConflict() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("ink-receipt-\(UUID())")
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = PracticeStore(directory: directory)
        let piece = Piece(title: "Lasso receipt", pdfFileName: "receipt.pdf", pageCount: 1)
        try store.addPiece(piece)
        let original = drawing(2)
        try store.replaceInk(pieceID: piece.id, page: 1, layer: .mine, strokes: InkPerStroke.split(original))
        let state = ScoreMarkupState()
        var saved: Data? = original.dataRepresentation()
        var receiptOrder: [Data] = []
        let parent = PagedScoreView(url: URL(fileURLWithPath: "/async-lasso-receipt.pdf"), page: .constant(1), twoPages: false,
                                   markup: state, drawingData: { _ in saved }, saveDrawingAsync: { page, data, expected in
            guard !Task.isCancelled, expected == saved else { return nil }
            do {
                let rows = store.inkStrokes(pieceID: piece.id, page: page, layer: .mine)
                let inputs = InkPerStroke.split(try PKDrawing(data: data), reusing: rows)
                let receipt = try await store.replaceInkPreparedAsync(pieceID: piece.id, page: page, layer: .mine,
                                                                      strokes: inputs, expectedRows: rows)
                receiptOrder = receipt.compactMap(\.fingerprint)
                let committed = try InkPerStroke.merge(receipt.map(\.data)).dataRepresentation()
                saved = committed
                return ScoreInkSaveReceipt(data: committed)
            } catch { XCTFail("Saving the lasso edit failed: \(error)"); return nil }
        }, onPageChanged: { _ in })
        let coordinator = parent.makeCoordinator(); coordinator.connectControls()
        defer { coordinator.autosave?.cancel() }
        let overlay = try attach(coordinator)
        var changed = original.strokes
        changed[0].transform = CGAffineTransform(translationX: 40, y: 0)
        let edited = PKDrawing(strokes: changed)
        coordinator.canvasViewDidBeginUsingTool(overlay.canvas)
        coordinator.loading = true; overlay.canvas.drawing = edited; coordinator.loading = false
        coordinator.canvasViewDrawingDidChange(overlay.canvas)
        coordinator.canvasViewDidEndUsingTool(overlay.canvas)
        let canvasData = overlay.canvas.drawing.dataRepresentation()
        let task = startIdle(coordinator); await task.value
        XCTAssertEqual(receiptOrder, [InkPerStroke.fingerprint(changed[1]), InkPerStroke.fingerprint(changed[0])],
                       "The retained stroke predates the transformed replacement in actual persistent storage")
        XCTAssertNotEqual(receiptOrder, edited.strokes.map(InkPerStroke.fingerprint))
        XCTAssertEqual(coordinator.committed[1], saved)
        XCTAssertEqual(coordinator.canvasBaseline[1], canvasData)
        XCTAssertEqual(overlay.canvas.drawing.dataRepresentation(), canvasData)
        XCTAssertFalse(coordinator.dirtyPages.contains(1))
        XCTAssertTrue(state.pendingInk.isEmpty)
        XCTAssertNil(state.conflictPage, "A receipt of this exact successful save must not be reported as a remote conflict")
    }

    @MainActor func testConcurrentRemoteStrokeReorderIsNotAcceptedAsTheCanceledLocalSnapshot() async throws {
        let state = ScoreMarkupState(); let gate = Gate(); var saved: Data?
        let parent = PagedScoreView(url: URL(fileURLWithPath: "/async-remote-conflict.pdf"), page: .constant(1), twoPages: false,
                                   markup: state, drawingData: { _ in saved }, saveDrawing: { _, data, expected in
            guard expected == saved else { return false }; saved = data; return true
        }, saveDrawingAsync: { _, data, expected in
            await gate.wait()
            guard !Task.isCancelled, expected == saved else { return nil }; saved = data; return ScoreInkSaveReceipt(data: data)
        }, onPageChanged: { _ in })
        let coordinator = parent.makeCoordinator(); coordinator.connectControls()
        defer { coordinator.autosave?.cancel(); gate.release() }
        let overlay = try attach(coordinator)
        edit(2, overlay: overlay, coordinator: coordinator)
        let local = overlay.canvas.drawing.dataRepresentation()
        let task = startIdle(coordinator); try await awaitEntry(gate)
        let remote = PKDrawing(strokes: Array(overlay.canvas.drawing.strokes.reversed())).dataRepresentation(); saved = remote
        XCTAssertFalse(coordinator.flush())
        gate.release(); await task.value
        XCTAssertEqual(saved, remote)
        XCTAssertEqual(state.pendingInk[1]?.data, local)
        XCTAssertNil(coordinator.committed[1], "Unrelated remote data must still require an explicit conflict decision")
        XCTAssertTrue(coordinator.dirtyPages.contains(1))
    }
    @MainActor func testUndoDuringOlderIdleSaveCannotResurrectInkAndLatestUndoSurvivesReopen() async throws {
        let state = ScoreMarkupState(); let gate = Gate(); var saved: Data?
        let parent = PagedScoreView(url: URL(fileURLWithPath: "/async-undo-race.pdf"), page: .constant(1), twoPages: false,
                                   markup: state, drawingData: { _ in saved }, saveDrawing: { _, data, expected in
            guard expected == saved else { XCTFail("Undo must use the authoritative completed save baseline"); return false }
            saved = data.isEmpty ? nil : data; return true
        }, saveDrawingAsync: { _, data, expected in
            await gate.wait()
            guard !Task.isCancelled, expected == saved else { return nil }
            saved = data.isEmpty ? nil : data; return ScoreInkSaveReceipt(data: saved)
        }, onPageChanged: { _ in })
        let coordinator = parent.makeCoordinator(); coordinator.connectControls()
        defer { coordinator.autosave?.cancel(); gate.release() }
        let overlay = try attach(coordinator)
        overlay.canvas.inkHistory.acceptsRequest = { true }; overlay.canvas.inkHistory.mayRestore = { true }
        edit(1, overlay: overlay, coordinator: coordinator)
        edit(2, overlay: overlay, coordinator: coordinator)
        let task = startIdle(coordinator); try await awaitEntry(gate)
        overlay.canvas.inkHistory.request(.undo)
        for _ in 0..<5 { await withCheckedContinuation { next in DispatchQueue.main.async { next.resume() } } }
        XCTAssertEqual(overlay.canvas.drawing.strokes.count, 1)
        gate.release(); await task.value
        XCTAssertEqual(try PKDrawing(data: XCTUnwrap(saved)).strokes.count, 2, "This older snapshot is allowed to finish its durable write")
        XCTAssertEqual(overlay.canvas.drawing.strokes.count, 1, "It cannot replace the current undone canvas")
        XCTAssertTrue(coordinator.dirtyPages.contains(1))
        XCTAssertTrue(coordinator.flush())
        XCTAssertEqual(try PKDrawing(data: XCTUnwrap(saved)).strokes.count, 1)
        overlay.canvas.inkHistory.request(.undo)
        for _ in 0..<5 { await withCheckedContinuation { next in DispatchQueue.main.async { next.resume() } } }
        XCTAssertTrue(overlay.canvas.drawing.strokes.isEmpty)
        XCTAssertTrue(coordinator.flush()); XCTAssertNil(saved)
        let reopened = parent.makeCoordinator(); defer { reopened.autosave?.cancel() }
        let reopenedOverlay = try attach(reopened)
        XCTAssertTrue(reopenedOverlay.canvas.drawing.strokes.isEmpty, "Relaunch reads the latest empty drawing rather than the superseded snapshot")
    }

    @MainActor func testCleanOverlayDetachAndReattachKeepsSequentialUndoAndDrawingValues() async throws {
        let state = ScoreMarkupState(); var saved: Data?
        let parent = PagedScoreView(url: URL(fileURLWithPath: "/zoom-overlay-history.pdf"), page: .constant(1), twoPages: false,
                                   markup: state, drawingData: { _ in saved }, saveDrawing: { _, data, expected in
            guard expected == saved else { return false }; saved = data.isEmpty ? nil : data; return true
        }, onPageChanged: { _ in })
        let coordinator = parent.makeCoordinator(); coordinator.connectControls()
        defer { coordinator.autosave?.cancel() }
        let data = UIGraphicsPDFRenderer(bounds: CGRect(x: 0, y: 0, width: 612, height: 792)).pdfData { $0.beginPage() }
        let document = try XCTUnwrap(PDFDocument(data: data)); let page = try XCTUnwrap(document.page(at: 0))
        let view = PDFView(); view.document = document; coordinator.pdfView = view
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 612, height: 792))
        let controller = UIViewController(); window.rootViewController = controller
        view.frame = controller.view.bounds; controller.view.addSubview(view); window.isHidden = false
        defer { window.isHidden = true }
        let overlay = try XCTUnwrap(coordinator.pdfView(view, overlayViewFor: page) as? ScorePageOverlay)
        overlay.frame = view.bounds; view.addSubview(overlay); overlay.layoutIfNeeded()
        coordinator.pdfView(view, willDisplayOverlayView: overlay, for: page)
        XCTAssertNotNil(overlay.canvas.window, "Undo eligibility must be tested on a mounted live canvas")
        edit(1, overlay: overlay, coordinator: coordinator); edit(2, overlay: overlay, coordinator: coordinator)
        XCTAssertTrue(coordinator.flush())
        coordinator.pdfView(view, willEndDisplayingOverlayView: overlay, for: page)
        overlay.removeFromSuperview()
        XCTAssertNil(overlay.canvas.window)
        let reattached = try XCTUnwrap(coordinator.pdfView(view, overlayViewFor: page) as? ScorePageOverlay)
        XCTAssertTrue(overlay === reattached, "A transient PDFKit zoom/reflow detach must retain that page's value history")
        reattached.frame = view.bounds; view.addSubview(reattached); reattached.layoutIfNeeded()
        coordinator.pdfView(view, willDisplayOverlayView: reattached, for: page)
        XCTAssertNotNil(reattached.canvas.window, "The reattached page must regain normal Undo eligibility")
        XCTAssertEqual(reattached.canvas.drawing.strokes.count, 2)
        XCTAssertTrue(reattached.canvas.inkHistory.canUndo, "Reattachment must retain the history before any Undo request")
        reattached.canvas.inkHistory.request(.undo)
        for _ in 0..<5 { await withCheckedContinuation { next in DispatchQueue.main.async { next.resume() } } }
        XCTAssertEqual(reattached.canvas.drawing.strokes.count, 1)
        reattached.canvas.inkHistory.request(.undo)
        for _ in 0..<5 { await withCheckedContinuation { next in DispatchQueue.main.async { next.resume() } } }
        XCTAssertTrue(reattached.canvas.drawing.strokes.isEmpty)
        XCTAssertTrue(coordinator.flush()); XCTAssertNil(saved)
    }

}
