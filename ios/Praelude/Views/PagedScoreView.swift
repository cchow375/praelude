import SwiftUI
import PDFKit
import PencilKit

/// Establish a fit-page minimum and six-times maximum after native layout,
/// preserving the reader's zoom as the available reading area changes.
final class ZoomableScorePDFView: PDFView {
    private var fittedSize: CGSize = .zero
    private var fittedScale: CGFloat = 0
    private var needsScaleRange = true

    #if DEBUG
    override var accessibilityValue: String? {
        get {
            guard ProcessInfo.processInfo.arguments.contains("--uitesting") else { return super.accessibilityValue }
            func scrolls(_ root: UIView) -> [UIScrollView] {
                root.subviews.flatMap { child in (child as? UIScrollView).map { [$0] } ?? scrolls(child) }
            }
            let details = scrolls(self).map {
                "scroll=\($0.zoomScale),min=\($0.minimumZoomScale),max=\($0.maximumZoomScale),pinch=\($0.pinchGestureRecognizer?.isEnabled == true),frame=\($0.frame)"
            }.joined(separator: ";")
            func inkCounts(_ root: UIView) -> [String] {
                if let overlay = root as? ScorePageOverlay {
                    let canvas = overlay.canvas
                    return ["inkPage\(overlay.pageNumber)=\(canvas.drawing.strokes.count),canvasBounds=\(canvas.bounds),canvasFrame=\(canvas.frame),contentSize=\(canvas.contentSize),contentOffset=\(canvas.contentOffset),canvasZoom=\(canvas.zoomScale),drawingBounds=\(canvas.drawing.bounds)"]
                }
                return root.subviews.flatMap(inkCounts)
            }
            return "scale=\(scaleFactor),min=\(minScaleFactor),max=\(maxScaleFactor),auto=\(autoScales),markup=\(isInMarkupMode),hit=\(hitTest(CGPoint(x:bounds.midX,y:bounds.midY),with:nil).map { String(describing:type(of:$0)) } ?? "none");\(details);\(inkCounts(self).joined(separator: ";"))"
        }
        set { super.accessibilityValue = newValue }
    }
    #endif

    func refreshScaleRange() {
        needsScaleRange = true
        setNeedsLayout()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        guard document != nil, bounds.width > 0, bounds.height > 0,
              needsScaleRange || fittedSize != bounds.size else { return }
        let fit = scaleFactorForSizeToFit
        guard fit.isFinite, fit > 0 else { return }
        let zoom = fittedScale > 0 ? min(6, max(1, scaleFactor / fittedScale)) : 1
        fittedSize = bounds.size
        fittedScale = fit
        needsScaleRange = false
        autoScales = false
        minScaleFactor = fit
        maxScaleFactor = fit * 6
        scaleFactor = fit * zoom
    }
}

struct PagedScoreView: UIViewRepresentable {
    let url: URL
    @Binding var page: Int
    var twoPages: Bool
    var focusPageTurns: Bool = false
    var markup: ScoreMarkupState
    var allowsInk = true
    var regions: [PassageRegion] = []
    var emphasizedIDs: Set<UUID> = []
    var practicedIDs: Set<UUID> = []
    var drawingData: (Int) -> Data? = { _ in nil }
    var saveDrawing: (Int, Data, Data?) -> Bool = { _, _, _ in false }
    var onRegionSelected: (UUID) -> Void = { _ in }
    var onTurnPage: (Int) -> Void = { _ in }
    var onPageChanged: (Int) -> Void
    func makeCoordinator() -> Coordinator { Coordinator(parent: self) }
    func makeUIView(context: Context) -> ZoomableScorePDFView {
        let view = ZoomableScorePDFView()
        view.accessibilityIdentifier = "scorePDF"
        let pageTap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.pageTapped(_:)))
        pageTap.cancelsTouchesInView = false
        pageTap.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.direct.rawValue)]
        pageTap.delegate = context.coordinator
        view.addGestureRecognizer(pageTap)
        view.backgroundColor = .secondarySystemBackground
        view.displayDirection = .horizontal
        view.displayMode = twoPages ? .twoUp : .singlePage
        view.displaysAsBook = false
        view.autoScales = true
        view.isInMarkupMode = true
        view.pageOverlayViewProvider = context.coordinator
        context.coordinator.pdfView = view
        view.document = PDFDocument(url: url)
        if let target = view.document?.page(at: max(0, page - 1)) { view.go(to: target) }
        context.coordinator.observer = NotificationCenter.default.addObserver(forName: .PDFViewPageChanged, object: view, queue: .main) { [weak coordinator = context.coordinator, weak view] _ in
            MainActor.assumeIsolated {
                guard let coordinator, let view, let current = view.currentPage, let doc = view.document else { return }
                let index = doc.index(for: current) + 1
                guard index != coordinator.parent.page else { return }
                coordinator.parent.page = index
                coordinator.parent.onPageChanged(index)
            }
        }
        context.coordinator.loadedURL = url
        context.coordinator.connectControls()
        return view
    }
    func updateUIView(_ view: ZoomableScorePDFView, context: Context) {
        let sourceChanged = context.coordinator.loadedURL != url || context.coordinator.parent.markup !== markup
        guard context.coordinator.adoptParent(self) else { return }
        if sourceChanged {
            context.coordinator.clearOverlays()
            view.document = PDFDocument(url: url); context.coordinator.loadedURL = url
            view.refreshScaleRange()
        }
        let mode: PDFDisplayMode = twoPages ? .twoUp : .singlePage
        if view.displayMode != mode { view.displayMode = mode; view.refreshScaleRange() }
        if let doc = view.document, let target = doc.page(at: max(0, page - 1)), view.currentPage != target {
            guard context.coordinator.flush() else { return }
            view.go(to: target)
            view.refreshScaleRange()
        }
        context.coordinator.refreshOverlays()
    }
    static func dismantleUIView(_ uiView: ZoomableScorePDFView, coordinator: Coordinator) {
        if let observer = coordinator.observer { NotificationCenter.default.removeObserver(observer) }
        _ = coordinator.flush()
        coordinator.autosave?.cancel()
        uiView.pageOverlayViewProvider = nil
    }
    @MainActor final class Coordinator: NSObject, UIGestureRecognizerDelegate, @preconcurrency PDFPageOverlayViewProvider, PKCanvasViewDelegate {
        var parent: PagedScoreView
        var loadedURL: URL?
        var observer: NSObjectProtocol?
        weak var pdfView: PDFView?
        var overlays: [Int: ScorePageOverlay] = [:]
        var committed: [Int: Data] = [:]
        var canvasBaseline: [Int: Data] = [:]
        var dirtyPages: Set<Int> = []
        var loading = false
        var autosave: Task<Void, Never>?
        let toolPicker = PKToolPicker()
        init(parent: PagedScoreView) { self.parent = parent }
        /// Flush with the original piece's callbacks before a reused representable changes owners.
        func adoptParent(_ updated: PagedScoreView) -> Bool {
            let changed = parent.url != updated.url || parent.markup !== updated.markup
            if changed {
                guard flush() else { return false }
                let oldMarkup = parent.markup
                oldMarkup.flushInk = { [weak oldMarkup] in oldMarkup?.pendingInk.isEmpty ?? true }
                oldMarkup.undoInk = {}; oldMarkup.redoInk = {}; oldMarkup.resolveInkConflict = { _, _ in }
            }
            parent = updated
            if changed { connectControls() }
            return true
        }
        func clearOverlays() {
            for overlay in overlays.values { toolPicker.removeObserver(overlay.canvas) }
            overlays.removeAll(); committed.removeAll(); canvasBaseline.removeAll(); dirtyPages.removeAll()
        }
        func connectControls() {
            toolPicker.stateAutosaveName = "Praelude.ScoreTools"
            let markup = parent.markup
            parent.markup.flushInk = { [weak self, weak markup] in self?.flush() ?? (markup?.pendingInk.isEmpty ?? true) }
            parent.markup.undoInk = { [weak self] in
                guard let self, let canvas = overlays[parent.page]?.canvas else { return }
                canvas.undoManager?.undo(); updateUndoState()
            }
            parent.markup.redoInk = { [weak self] in
                guard let self, let canvas = overlays[parent.page]?.canvas else { return }
                canvas.undoManager?.redo(); updateUndoState()
            }
            parent.markup.resolveInkConflict = { [weak self] number, keepLocal in
                guard let self else { return }
                let overlay = overlays[number]
                let pending = parent.markup.pendingInk[number]
                guard overlay != nil || pending != nil else { return }
                let saved = parent.drawingData(number)
                if keepLocal {
                    let data = pending?.data ?? overlay.flatMap { encodedInk($0.canvas) } ?? Data()
                    guard parent.saveDrawing(number, data, saved) else { return }
                    committed[number] = data.isEmpty ? nil : data
                } else {
                    loading = true
                    do {
                        let drawing = try decodeDrawing(saved)
                        overlay?.canvas.drawing = drawing; committed[number] = saved
                    }
                    catch { parent.markup.errorMessage = "The saved drawing could not be opened."; loading = false; return }
                    loading = false; overlay?.canvas.undoManager?.removeAllActions()
                }
                canvasBaseline[number] = overlay.flatMap { encodedInk($0.canvas) }
                dirtyPages.remove(number); parent.markup.clearPendingInk(page: number)
                parent.markup.conflictPage = nil; updateUndoState()
            }
        }
        func pdfView(_ view: PDFView, overlayViewFor page: PDFPage) -> UIView? {
            guard let document = view.document else { return nil }
            let number = document.index(for: page) + 1
            if let overlay = overlays[number] { return overlay }
            let overlay = ScorePageOverlay(page: number, markup: parent.markup)
            overlay.inkReadOnly = !parent.allowsInk
            loading = true
            if let pending = parent.markup.pendingInk[number], parent.markup.pendingInkDocument == parent.url {
                do {
                    let baseline = try decodeDrawing(pending.expected)
                    canvasBaseline[number] = baseline.strokes.isEmpty ? nil : baseline.dataRepresentation()
                    overlay.canvas.drawing = pending.data.isEmpty ? PKDrawing() : try decodeDrawing(pending.data)
                    committed[number] = pending.expected
                    dirtyPages.insert(number)
                } catch {
                    parent.markup.errorMessage = "Unsaved ink on page \(number) could not be reopened. It remains in memory."
                    overlay.inkReadOnly = true
                }
            } else if let data = parent.drawingData(number) {
                do { overlay.canvas.drawing = try decodeDrawing(data); committed[number] = data }
                catch { parent.markup.errorMessage = "The saved ink on page \(number) could not be read. It has been preserved."; overlay.inkReadOnly = true }
            }
            loading = false
            if !dirtyPages.contains(number) { canvasBaseline[number] = encodedInk(overlay.canvas) }
            overlay.canvas.delegate = self
            toolPicker.addObserver(overlay.canvas)
            overlays[number] = overlay
            refresh(overlay)
            return overlay
        }
        func pdfView(_ pdfView: PDFView, willDisplayOverlayView overlayView: UIView, for page: PDFPage) {
            guard let overlay = overlayView as? ScorePageOverlay else { return }
            func configure(_ view: UIView) {
                guard !(view is ScorePageOverlay), !(view is PKCanvasView) else { return }
                if let scrollView = view as? UIScrollView {
                    scrollView.panGestureRecognizer.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.direct.rawValue)]
                    scrollView.panGestureRecognizer.require(toFail: overlay.selectionPan)
                    // Let PencilKit claim ink before a parent PDF scroll cancels the stroke.
                    // Pencil-only policy still rejects ordinary reading fingers; pinch is unchanged.
                    scrollView.panGestureRecognizer.require(toFail: overlay.canvas.drawingGestureRecognizer)
                }
                view.subviews.forEach(configure)
            }
            configure(pdfView)
            refresh(overlay)
        }
        func pdfView(_ pdfView: PDFView, willEndDisplayingOverlayView overlayView: UIView, for page: PDFPage) {
            _ = flush()
            guard let overlay = overlayView as? ScorePageOverlay, overlays[overlay.pageNumber] === overlay,
                  !dirtyPages.contains(overlay.pageNumber) else { return }
            toolPicker.removeObserver(overlay.canvas)
            overlays.removeValue(forKey: overlay.pageNumber); committed.removeValue(forKey: overlay.pageNumber)
            canvasBaseline.removeValue(forKey: overlay.pageNumber)
        }
        func refreshOverlays() { for overlay in Array(overlays.values) { refresh(overlay) }; updateUndoState() }
        private func refresh(_ overlay: ScorePageOverlay) {
            overlay.displayedRegions = parent.regions
            overlay.emphasizedIDs = parent.emphasizedIDs; overlay.practicedIDs = parent.practicedIDs
            let number = overlay.pageNumber
            if !dirtyPages.contains(number), parent.drawingData(number) != committed[number] {
                loading = true
                do {
                    let data = parent.drawingData(number)
                    overlay.canvas.drawing = try decodeDrawing(data)
                    committed[number] = data
                    canvasBaseline[number] = encodedInk(overlay.canvas)
                } catch { parent.markup.errorMessage = "Saved ink could not be reopened. The original is preserved."; overlay.inkReadOnly = true }
                loading = false
            }
            overlay.refresh()
            if parent.markup.mode == .writing && number == parent.page {
                toolPicker.setVisible(true, forFirstResponder: overlay.canvas)
                if !overlay.canvas.isFirstResponder { overlay.canvas.becomeFirstResponder() }
            } else { toolPicker.setVisible(false, forFirstResponder: overlay.canvas) }
        }
        func canvasViewDidBeginUsingTool(_ canvasView: PKCanvasView) {
            #if DEBUG
            logCanvas("didBeginUsingTool", canvas: canvasView)
            #endif
        }
        func canvasViewDrawingDidChange(_ canvasView: PKCanvasView) {
            #if DEBUG
            logCanvas("drawingDidChange", canvas: canvasView)
            #endif
            guard !loading, let number = overlays.first(where: { $0.value.canvas === canvasView })?.key else { return }
            let current = encodedInk(canvasView)
            guard current != canvasBaseline[number] else {
                dirtyPages.remove(number); parent.markup.clearPendingInk(page: number); updateUndoState(); return
            }
            parent.markup.rememberInk(page: number, data: current ?? Data(), expected: committed[number], document: parent.url)
            dirtyPages.insert(number); updateUndoState()
            autosave?.cancel()
            autosave = Task { @MainActor [weak self] in
                try? await Task.sleep(for: .milliseconds(300))
                guard !Task.isCancelled else { return }
                _ = self?.flush()
            }
        }
        func canvasViewDidEndUsingTool(_ canvasView: PKCanvasView) {
            #if DEBUG
            logCanvas("didEndUsingTool", canvas: canvasView)
            #endif
            _ = flush(); updateUndoState()
            // Do not refit the PDF underneath the first Pencil stroke.
            if parent.markup.mode == .reading && parent.allowsInk { parent.markup.mode = .writing }
        }
        #if DEBUG
        func canvasViewDidFinishRendering(_ canvasView: PKCanvasView) {
            logCanvas("didFinishRendering", canvas: canvasView)
        }
        private func logCanvas(_ event: String, canvas: PKCanvasView) {
            guard ProcessInfo.processInfo.arguments.contains("--uitesting") else { return }
            let number = overlays.first(where: { $0.value.canvas === canvas })?.key ?? 0
            NSLog("PraeludeUITest: ink %@ page=%d loading=%@ bounds=%@ frame=%@ contentSize=%@ contentOffset=%@ zoom=%g drawingBounds=%@ strokes=%d gestureState=%ld drawingPolicy=%ld",
                  event, number, String(loading), String(describing: canvas.bounds), String(describing: canvas.frame),
                  String(describing: canvas.contentSize), String(describing: canvas.contentOffset), Double(canvas.zoomScale),
                  String(describing: canvas.drawing.bounds), canvas.drawing.strokes.count,
                  canvas.drawingGestureRecognizer.state.rawValue, canvas.drawingPolicy.rawValue)
        }
        #endif
        @discardableResult func flush() -> Bool {
            guard parent.markup.pendingInkDocument == nil || parent.markup.pendingInkDocument == parent.url else { return false }
            var success = true
            let pages = dirtyPages.union(parent.markup.pendingInk.keys)
            for number in pages.sorted() {
                let pending = parent.markup.pendingInk[number]
                let data: Data
                let expected: Data?
                if let canvas = overlays[number]?.canvas, dirtyPages.contains(number) {
                    data = canvas.drawing.strokes.isEmpty ? Data() : canvas.drawing.dataRepresentation()
                    expected = committed[number]
                } else if let pending {
                    data = pending.data; expected = pending.expected
                } else { success = false; continue }
                parent.markup.rememberInk(page: number, data: data, expected: expected, document: parent.url)
                if parent.saveDrawing(number, data, expected) {
                    committed[number] = data.isEmpty ? nil : data
                    canvasBaseline[number] = overlays[number].flatMap { encodedInk($0.canvas) }
                    dirtyPages.remove(number); parent.markup.clearPendingInk(page: number)
                    parent.markup.inkRevision += 1
                } else { success = false }
            }
            return success
        }
        private func encodedInk(_ canvas: PKCanvasView) -> Data? {
            canvas.drawing.strokes.isEmpty ? nil : canvas.drawing.dataRepresentation()
        }
        private func decodeDrawing(_ data: Data?) throws -> PKDrawing {
            guard let data else { return PKDrawing() }
            let drawing = try PKDrawing(data: data)
            guard !drawing.strokes.isEmpty else { throw PracticeError.invalid("The saved ink contains no readable strokes.") }
            return drawing
        }
        private func updateUndoState() {
            let manager = overlays[parent.page]?.canvas.undoManager
            let undo = manager?.canUndo ?? false, redo = manager?.canRedo ?? false
            guard parent.markup.canUndoInk != undo || parent.markup.canRedoInk != redo else { return }
            Task { @MainActor [weak self] in
                self?.parent.markup.canUndoInk = undo; self?.parent.markup.canRedoInk = redo
            }
        }
        @objc func pageTapped(_ recognizer: UITapGestureRecognizer) {
            guard recognizer.state == .ended, let view = recognizer.view as? PDFView else { return }
            if parent.focusPageTurns {
                parent.onTurnPage(recognizer.location(in: view).x < view.bounds.width / 3 ? -1 : 1)
            } else if let page = view.page(for: recognizer.location(in: view), nearest: false), let document = view.document,
                      let overlay = overlays[document.index(for: page) + 1] {
                let point = overlay.convert(recognizer.location(in: view), from: view)
                if let region = overlay.displayedRegions.reversed().first(where: { $0.page == overlay.pageNumber && $0.rect(in: overlay.bounds.size).contains(point) }) {
                    parent.onRegionSelected(region.id)
                }
            }
        }
        func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool { parent.markup.mode == .reading }
        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool { true }

    }
}

struct ScorePagePicker: View {
    let url: URL
    let currentPage: Int
    let onSelect: (Int) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var document: PDFDocument?
    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 110), spacing: 20)], spacing: 24) {
                    if let document {
                        ForEach(0..<document.pageCount, id: \.self) { index in
                            Button {
                                onSelect(index + 1); dismiss()
                            } label: {
                                VStack(spacing: 8) {
                                    if let pdfPage = document.page(at: index) {
                                        Image(uiImage: pdfPage.thumbnail(of: CGSize(width: 180, height: 250), for: .cropBox))
                                            .resizable().scaledToFit().frame(height: 160)
                                            .clipShape(RoundedRectangle(cornerRadius: 3))
                                    }
                                    Text("\(index + 1)").font(.subheadline.monospacedDigit())
                                }.padding(8).frame(maxWidth: .infinity).contentShape(Rectangle())
                                    .background(index + 1 == currentPage ? Color.accentColor.opacity(0.12) : Color.clear, in: RoundedRectangle(cornerRadius: 10))
                            }.buttonStyle(.plain).accessibilityLabel("Page \(index + 1)")
                        }
                    }
                }.padding(20)
            }
            .navigationTitle("Pages").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .onAppear { document = PDFDocument(url: url) }
        }.presentationDetents([.large])
    }
}
