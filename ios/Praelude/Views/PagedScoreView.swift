import SwiftUI
import PDFKit
import PencilKit

/// Establish a fit-page minimum and six-times maximum after native layout,
/// preserving the reader's zoom as the available reading area changes.
final class ZoomableScorePDFView: PDFView {
    private var fittedSize: CGSize = .zero
    private var fittedScale: CGFloat = 0
    private var needsScaleRange = true
    var prefersWidthFit = false {
        didSet { if prefersWidthFit != oldValue { needsInitialWidthFit = prefersWidthFit; refreshScaleRange() } }
    }
    private var needsInitialWidthFit = false

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
                    let stampWidth = overlay.markup.stampDraft?.page == overlay.pageNumber ? overlay.markup.stampDraft?.position.width ?? 0 : 0
                    return ["stampPreviewWidth=\(stampWidth),stampCountPage\(overlay.pageNumber)=\(overlay.displayedStamps.filter { $0.page == overlay.pageNumber }.count),inkPage\(overlay.pageNumber)=\(canvas.drawing.strokes.count),canvasBounds=\(canvas.bounds),canvasFrame=\(canvas.frame),contentSize=\(canvas.contentSize),contentOffset=\(canvas.contentOffset),canvasZoom=\(canvas.zoomScale),drawingBounds=\(canvas.drawing.bounds)"]
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
        if needsInitialWidthFit, let currentPage {
            let pageBounds = currentPage.bounds(for: .cropBox)
            if pageBounds.width > 0 {
                scaleFactor = min(maxScaleFactor, max(fit, (bounds.width - 8) / pageBounds.width))
            } else { scaleFactor = fit * zoom }
            needsInitialWidthFit = false
        } else { scaleFactor = fit * zoom }
    }
}

/// §7 half-page turns: which PDFKit book-pagination parity produces the spread that should be on
/// screen for a given displayed page. `.twoUp` pairs pages by index parity — `displaysAsBook = false`
/// groups (1,2),(3,4),…; `true` leaves page 1 alone and groups (2,3),(4,5),… — and that grouping was
/// previously left fixed at `false` forever. A single-step "half" page turn (landing on page 2, say)
/// therefore never changed which spread PDFKit showed: page 2 was already inside the (1,2) group.
/// Recomputing this from the current page on every update, instead of leaving it fixed, is what makes
/// that single-step turn actually shift the visible spread. A free function (not inlined in
/// `makeUIView`/`updateUIView`) so the parity logic is unit-testable — SwiftUI gives those methods no
/// public way to construct the `UIViewRepresentableContext` a test would need.
func scoreDisplaysAsBook(twoPages: Bool, page: Int) -> Bool { twoPages && page.isMultiple(of: 2) }

struct PagedScoreView: UIViewRepresentable {
    let url: URL
    @Binding var page: Int
    var twoPages: Bool
    var focusPageTurns: Bool = false
    var markup: ScoreMarkupState
    var allowsInk = true
    /// §7 layers: which layer `drawingData`/`saveDrawing` read/write. Changing it tears down and
    /// reloads every overlay (see `Coordinator.adoptParent`) so the canvas never mixes two layers.
    var activeLayer: InkLayer = .mine
    var regions: [PassageRegion] = []
    /// Passage id -> its saved recolor token (§8), read by `ScorePageOverlay` for box fill/stroke.
    var regionColors: [UUID: String] = [:]
    var emphasizedIDs: Set<UUID> = []
    var practicedIDs: Set<UUID> = []
    /// §7 page tools: this piece's own (already-filtered) page edits. Empty means the plain
    /// `1...pageCount` identity order — every piece starts this way, so a call site that never
    /// passes this behaves exactly as before.
    var pageEdits: [PageEdit] = []
    /// §7 links: repeat/D.S./coda tap regions, keyed to the *displayed* page (see "(C) Schema3.md").
    var scoreLinks: [ScoreLink] = []
    var onLinkActivated: (ScoreLink) -> Void = { _ in }
    var stamps: [StampAnnotation] = []
    var textBoxes: [TextBoxAnnotation] = []
    /// Ink attributed to any visible layer other than `markup.activeLayer`, flattened into one blob
    /// list per page — the read-only underlay `Coordinator` merges and renders behind the editable
    /// canvas. `ScoreWorkspace` supplies this (it has `PracticeStore` access; this view never does).
    var otherLayersInkData: (Int) -> [Data] = { _ in [] }
    var drawingData: (Int) -> Data? = { _ in nil }
    var saveDrawing: (Int, Data, Data?) -> Bool = { _, _, _ in false }
    var onRegionSelected: (UUID) -> Void = { _ in }
    var onPlaceStamp: (Int, NormalizedRect) -> Bool = { _, _ in true }
    var onPlaceTextBox: (Int, NormalizedRect) -> Void = { _, _ in }
    var onPlaceBreakPoint: (Int, NormalizedRect) -> Void = { _, _ in }
    var onEditTextBox: (TextBoxAnnotation) -> Void = { _ in }
    var onTurnPage: (Int) -> Void = { _ in }
    /// §7 performance mode: a long press anywhere on the score exits it (the only way out while
    /// every other control is deliberately hidden, so it fires regardless of `focusPageTurns`) — a
    /// `nil` region id. §8: outside performance mode, a long press landing on a saved passage
    /// outline instead passes that passage's id, for `ScoreWorkspace`'s on-score quick-action menu.
    var onLongPress: (UUID?) -> Void = { _ in }
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
        let longPress = UILongPressGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.longPressed(_:)))
        longPress.cancelsTouchesInView = false
        longPress.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.direct.rawValue)]
        longPress.delegate = context.coordinator
        view.addGestureRecognizer(longPress)
        // Minor regression (verifier "reader lens", 2026-09-29): with no relationship between the
        // two, a touch held long enough to recognize as a long press *also* recognized as a tap on
        // release (UITapGestureRecognizer has no built-in maximum hold duration) — leaving
        // performance mode with the documented long press also fired a page turn from the very same
        // touch. The tap now waits to see whether the long press claims the touch first.
        pageTap.require(toFail: longPress)
        // Minor regression (verifier "reader lens", 2026-09-29): only the tap zones and buttons
        // turned pages — a reading swipe did nothing. Discrete (recognizes once per gesture, unlike
        // PDFKit's own continuous pan), so it coexists with pinch/pan for a zoomed-in page; `swiped(_:)`
        // itself declines while zoomed past fit, where the identical drag should pan instead.
        for direction: UISwipeGestureRecognizer.Direction in [.left, .right] {
            let swipe = UISwipeGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.swiped(_:)))
            swipe.direction = direction
            swipe.delegate = context.coordinator
            view.addGestureRecognizer(swipe)
        }
        // Opaque, so this is the color actually shown in the margins/gutter around page content —
        // the `PraeludeColor.scorePaper` layer `ScoreWorkspace` places behind this view never shows
        // through. Pinned paper-white like that token, not a system gray, so the score reads as one
        // paper surface up to its edges in both appearances (§3a: score paper never goes dark).
        view.backgroundColor = UIColor(PraeludeColor.scorePaper)
        view.displayDirection = .horizontal
        view.displayMode = twoPages ? .twoUp : .singlePage
        view.displaysAsBook = scoreDisplaysAsBook(twoPages: twoPages, page: page)
        view.autoScales = true
        view.prefersWidthFit = focusPageTurns && !twoPages
        view.isInMarkupMode = true
        view.pageOverlayViewProvider = context.coordinator
        context.coordinator.pdfView = view
        context.coordinator.loadedURL = url
        view.document = context.coordinator.loadDocument(url: url, pageEdits: pageEdits)
        if let target = view.document?.page(at: max(0, page - 1)) { view.go(to: target) }
        context.coordinator.prefetchNeighbors(around: page)
        context.coordinator.observer = NotificationCenter.default.addObserver(forName: .PDFViewPageChanged, object: view, queue: .main) { [weak coordinator = context.coordinator, weak view] _ in
            MainActor.assumeIsolated {
                guard let coordinator, let view, let current = view.currentPage, let doc = view.document else { return }
                let index = doc.index(for: current) + 1
                guard index != coordinator.parent.page else { return }
                coordinator.parent.page = index
                coordinator.parent.onPageChanged(index)
                coordinator.prefetchNeighbors(around: index)
            }
        }
        context.coordinator.connectControls()
        return view
    }
    func updateUIView(_ view: ZoomableScorePDFView, context: Context) {
        view.prefersWidthFit = focusPageTurns && !twoPages
        let sourceChanged = context.coordinator.loadedURL != url || context.coordinator.parent.markup !== markup
            || context.coordinator.loadedPageEdits != pageEdits
        guard context.coordinator.adoptParent(self) else { return }
        if sourceChanged {
            context.coordinator.clearOverlays()
            view.document = context.coordinator.loadDocument(url: url, pageEdits: pageEdits); context.coordinator.loadedURL = url
            view.refreshScaleRange()
        }
        let mode: PDFDisplayMode = twoPages ? .twoUp : .singlePage
        if view.displayMode != mode { view.displayMode = mode; view.refreshScaleRange() }
        let book = scoreDisplaysAsBook(twoPages: twoPages, page: page)
        if view.displaysAsBook != book { view.displaysAsBook = book; view.refreshScaleRange() }
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
        coordinator.prefetchTask?.cancel()
        uiView.pageOverlayViewProvider = nil
    }
    @MainActor final class Coordinator: NSObject, UIGestureRecognizerDelegate, @preconcurrency PDFPageOverlayViewProvider, PKCanvasViewDelegate {
        var parent: PagedScoreView
        var loadedURL: URL?
        var loadedPageEdits: [PageEdit] = []
        /// §7 page tools: this piece's effective reading order, `displayOrder`-indexed (index 0 is
        /// display page 1). Rebuilt by `loadDocument` whenever the source URL or page edits change.
        var effectivePages: [EffectivePage] = []
        var observer: NSObjectProtocol?
        weak var pdfView: PDFView?
        var overlays: [Int: ScorePageOverlay] = [:]
        var committed: [Int: Data] = [:]
        var canvasBaseline: [Int: Data] = [:]
        var dirtyPages: Set<Int> = []
        var loading = false
        var autosave: Task<Void, Never>?
        /// §7 reading: warms decode caches for pages the reader is about to turn to (see
        /// `prefetchNeighbors`); cancelled and replaced on every page turn rather than left to pile up.
        var prefetchTask: Task<Void, Never>?
        let toolPicker = PKToolPicker()
        init(parent: PagedScoreView) { self.parent = parent }
        var otherLayersImageCache: [Int: (signature: Int, image: UIImage?)] = [:]
        /// Flush with the original piece's callbacks before a reused representable changes owners.
        func adoptParent(_ updated: PagedScoreView) -> Bool {
            // A layer switch reuses the exact document-switch path below: flush whatever is pending
            // on the old layer, tear down every overlay, and reload from `drawingData`/`otherLayersInkData`
            // — which `ScoreWorkspace` now reads against the *new* `markup.activeLayer` — instead of
            // adding a second, parallel per-layer keying scheme to every dictionary in this class.
            let changed = parent.url != updated.url || parent.markup !== updated.markup || parent.activeLayer != updated.activeLayer
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
        /// Loads `url`'s source PDF and resolves it against `pageEdits` into the document PDFKit
        /// actually displays: the source directly when the effective order is trivial (no page
        /// tool has touched this piece — the common case, and the same load PDFKit always did),
        /// or a composed in-memory document once crop/rotation/reorder/insert/delete are in play.
        func loadDocument(url: URL, pageEdits: [PageEdit]) -> PDFDocument? {
            loadedPageEdits = pageEdits
            let raw = PDFDocument(url: url)
            let sourceCount = raw?.pageCount ?? 0
            let pages = PageLayout.effectivePages(pageEdits: pageEdits, sourcePageCount: sourceCount)
            effectivePages = pages
            guard let raw else { return nil }
            return ScorePageComposer.isIdentity(pages, sourcePageCount: sourceCount) ? raw : ScorePageComposer.composedDocument(source: raw, effectivePages: pages)
        }
        /// §7 reading: "instant sharp render of heavy scans" for the pages just ahead of/behind
        /// the one just displayed. This does not replace PDFKit's own page rendering with custom
        /// tiling — it forces the (often dominant, for a large scanned image) cost of decoding a
        /// page's embedded raster content to happen once, off the main thread, before the reader
        /// actually turns there, rather than exactly when they do. `PDFPage.thumbnail(of:for:)` is
        /// a synchronous CPU render with no UIKit main-thread affinity, so it is safe to call from
        /// a detached background task; the returned image is discarded; only the decode work it
        /// forces is the point.
        func prefetchNeighbors(around displayIndex: Int) {
            guard let document = pdfView?.document else { return }
            let indices = [displayIndex - 1, displayIndex + 1, displayIndex + 2].filter { $0 >= 1 && $0 <= document.pageCount }
            guard !indices.isEmpty else { return }
            prefetchTask?.cancel()
            prefetchTask = Task.detached(priority: .utility) {
                for index in indices {
                    guard !Task.isCancelled else { return }
                    guard let page = document.page(at: index - 1) else { continue }
                    let box = page.bounds(for: .cropBox)
                    guard box.width > 0, box.height > 0 else { continue }
                    let target = CGSize(width: min(1600, box.width * 2), height: min(1600, box.height * 2))
                    _ = page.thumbnail(of: target, for: .cropBox)
                }
            }
        }
        func clearOverlays() {
            for overlay in overlays.values { toolPicker.removeObserver(overlay.canvas) }
            overlays.removeAll(); committed.removeAll(); canvasBaseline.removeAll(); dirtyPages.removeAll()
            otherLayersImageCache.removeAll()
        }
        func connectControls() {
            toolPicker.stateAutosaveName = "Praelude.ScoreTools"
            let markup = parent.markup
            parent.markup.flushInk = { [weak self, weak markup] in self?.flush() ?? (markup?.pendingInk.isEmpty ?? true) }
            // `parent.page` is a *displayed* page number; `overlays` is keyed by *source* page (see
            // `sourcePage(forDisplayIndex:)`'s own doc comment) — after any page-tool reorder/insert/
            // delete the two diverge, and indexing `overlays` by `parent.page` directly used to silently
            // miss the live overlay (Undo/Redo ink staying disabled, or acting on the wrong page).
            parent.markup.undoInk = { [weak self] in
                guard let self, let number = sourcePage(forDisplayIndex: parent.page), let canvas = overlays[number]?.canvas else { return }
                canvas.undoManager?.undo(); updateUndoState()
            }
            parent.markup.redoInk = { [weak self] in
                guard let self, let number = sourcePage(forDisplayIndex: parent.page), let canvas = overlays[number]?.canvas else { return }
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
                    // Re-read through `parent.drawingData`, not the just-saved canvas bytes, so
                    // `committed` stays in the same representation `refresh()`'s comparison below and
                    // `persistInk`'s own guard both use — see `flush()`'s identical fix for why a
                    // canvas's own live encoding and a freshly merged-from-storage encoding are never
                    // reliably byte-equal even for identical content.
                    committed[number] = parent.drawingData(number)
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
        /// The source page a displayed page maps to. `effectivePages` (populated by `loadDocument`,
        /// called from `makeUIView`/`updateUIView`) normally holds this piece's real effective
        /// order; a Coordinator driven directly against a `view.document` set without going
        /// through that path — as some white-box ink/hit-routing tests do — never populates it,
        /// which (like a piece with no page edits at all) means the identity order: display page
        /// N is source page N, exactly what `PageLayout.effectivePages` itself returns for an
        /// empty `pageEdits` list.
        private func sourcePage(forDisplayIndex displayIndex: Int) -> Int? {
            guard displayIndex >= 1 else { return nil }
            guard !effectivePages.isEmpty else { return displayIndex }
            guard displayIndex <= effectivePages.count else { return nil }
            return effectivePages[displayIndex - 1].sourcePage
        }
        func pdfView(_ view: PDFView, overlayViewFor page: PDFPage) -> UIView? {
            guard let document = view.document else { return nil }
            let displayIndex = document.index(for: page) + 1
            // Ink/passage regions stay anchored to the *source* page regardless of page-tool
            // reordering (see "(C) Schema3.md"); a generated blank/staff page has none, so it gets
            // no overlay at all — there is nothing on it for ink or passages to attach to.
            guard let number = sourcePage(forDisplayIndex: displayIndex) else { return nil }
            if let overlay = overlays[number] { return overlay }
            let overlay = ScorePageOverlay(page: number, markup: parent.markup)
            overlay.inkReadOnly = !parent.allowsInk
            overlay.pageImageForMagnifier = { size in page.thumbnail(of: size, for: .cropBox) }
            // §7 page tools: this display position's own crop, if any (see "(C) Schema3.md" and
            // `ScorePageOverlay.activeCrop`) — the exact same crop `ScorePageComposer.renderedPage`
            // just used to build this very `page`'s `.cropBox`, so the overlay and the PDF content it
            // sits on always agree about what "cropped" means. `effectivePages` is rebuilt (and every
            // overlay torn down with it) whenever page edits change, so this never goes stale.
            let effectiveCrop = effectivePages.indices.contains(displayIndex - 1) ? effectivePages[displayIndex - 1].cropRect : nil
            overlay.activeCrop = (effectiveCrop?.isValid == true) ? effectiveCrop : nil
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
                    overlay.contentReadOnly = true
                }
            } else if let data = parent.drawingData(number) {
                do { overlay.canvas.drawing = try decodeDrawing(data); committed[number] = data }
                catch { parent.markup.errorMessage = "The saved ink on page \(number) could not be read. It has been preserved."; overlay.contentReadOnly = true }
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
                    scrollView.panGestureRecognizer.require(toFail: overlay.stampPan)
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
            // §7 performance mode: `allowsInk` can flip on a page that already has a live overlay —
            // entering performance mode does not tear overlays down and rebuild them, so an overlay
            // created while ink was allowed previously kept accepting Pencil input until the reader
            // turned away and back. `inkReadOnly` must be kept in sync on every refresh pass, not only
            // set once at overlay creation (`pdfView(_:overlayViewFor:)`).
            overlay.inkReadOnly = !parent.allowsInk
            overlay.displayedRegions = parent.regions
            overlay.regionColors = parent.regionColors
            overlay.emphasizedIDs = parent.emphasizedIDs; overlay.practicedIDs = parent.practicedIDs
            overlay.displayedStamps = parent.stamps; overlay.displayedTextBoxes = parent.textBoxes
            overlay.onPlaceStamp = parent.onPlaceStamp; overlay.onPlaceTextBox = parent.onPlaceTextBox
            overlay.onPlaceBreakPoint = parent.onPlaceBreakPoint
            overlay.onEditTextBox = parent.onEditTextBox
            let number = overlay.pageNumber
            if !dirtyPages.contains(number), parent.drawingData(number) != committed[number] {
                loading = true
                do {
                    let data = parent.drawingData(number)
                    overlay.canvas.drawing = try decodeDrawing(data)
                    committed[number] = data
                    canvasBaseline[number] = encodedInk(overlay.canvas)
                } catch { parent.markup.errorMessage = "Saved ink could not be reopened. The original is preserved."; overlay.contentReadOnly = true }
                loading = false
            }
            if parent.markup.tool != overlay.lastAssignedTool, let tool = parent.markup.tool.pkTool {
                overlay.canvas.tool = tool; overlay.lastAssignedTool = parent.markup.tool
            }
            refreshOtherLayersImage(overlay)
            overlay.refresh()
            // The custom AnnotationToolbar is now the primary tool/color/width picker (§3b: no stock
            // component look) and drives `canvas.tool` directly above, so the system floating palette
            // stays hidden — showing both would let a person change tools somewhere `markup.tool`
            // never hears about. `becomeFirstResponder` is kept for an inking tool regardless, since
            // that alone (not picker visibility) is what keeps Apple Pencil's own double-tap/squeeze
            // shortcuts live on this canvas.
            // Responder transitions can trigger PencilKit layout/observation synchronously. Never
            // do them inside SwiftUI's updateUIView, particularly when the active practice dock
            // changes size to the annotation toolbar. Schedule only one transition per overlay.
            let wantsResponder = parent.markup.mode == .writing && number == sourcePage(forDisplayIndex: parent.page)
                && parent.markup.tool.kind.isInkingTool && !overlay.inkReadOnly && !overlay.contentReadOnly
            if wantsResponder && !overlay.canvas.isFirstResponder && !overlay.responderScheduled {
                overlay.responderScheduled = true
                Task { @MainActor [weak self, weak overlay] in
                    await Task.yield()
                    guard let self, let overlay else { return }
                    overlay.responderScheduled = false
                    guard self.overlays[number] === overlay, overlay.window != nil,
                          self.parent.markup.mode == .writing, self.sourcePage(forDisplayIndex: self.parent.page) == number,
                          self.parent.markup.tool.kind.isInkingTool, !overlay.inkReadOnly, !overlay.contentReadOnly else { return }
                    self.toolPicker.setVisible(false, forFirstResponder: overlay.canvas)
                    if !overlay.canvas.isFirstResponder { overlay.canvas.becomeFirstResponder() }
                }
            }

        }
        /// Regenerates the read-only merged snapshot of every visible-but-inactive ink layer, only
        /// when that page's relevant content actually changed (a cheap content signature, not a full
        /// re-render on every SwiftUI update pass).
        private func refreshOtherLayersImage(_ overlay: ScorePageOverlay) {
            guard overlay.bounds.width > 0, overlay.bounds.height > 0 else { return }
            let number = overlay.pageNumber
            let blobs = parent.otherLayersInkData(number)
            var signature = blobs.count &* 31
            for blob in blobs { signature = signature ^ blob.hashValue }
            // `otherLayersImage` is a `didSet`-observed property (redraws the overlay); reassigning it
            // to the same instance on every refresh pass, even when nothing changed, was part of the
            // same over-eager-reassignment issue `lastAssignedTool` documents above.
            func apply(_ image: UIImage?) { if overlay.otherLayersImage !== image { overlay.otherLayersImage = image } }
            if let cached = otherLayersImageCache[number], cached.signature == signature {
                apply(cached.image); return
            }
            guard !blobs.isEmpty else {
                otherLayersImageCache[number] = (signature, nil); apply(nil); return
            }
            let drawing = (try? InkPerStroke.merge(blobs)) ?? PKDrawing()
            let scale = min(3, overlay.window?.screen.scale ?? UIScreen.main.scale)
            let image = drawing.strokes.isEmpty ? nil : drawing.image(from: CGRect(origin: .zero, size: overlay.bounds.size), scale: scale)
            otherLayersImageCache[number] = (signature, image)
            apply(image)
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
            parent.markup.rememberInk(page: number, data: current ?? Data(), expected: committed[number], document: parent.url, layer: parent.activeLayer)
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
                parent.markup.rememberInk(page: number, data: data, expected: expected, document: parent.url, layer: parent.activeLayer)
                if parent.saveDrawing(number, data, expected) {
                    // See `ScoreWorkspace.mergedInkData`'s doc: re-read through `parent.drawingData`
                    // (now stable, since that cache invalidates only when the stored rows actually
                    // change) instead of stamping the canvas's own raw encoding, so `committed` never
                    // spuriously diverges from what `refresh()`/`persistInk` compare it against and
                    // triggers a needless reload right after this device's own successful save — a
                    // reload that used to swap `canvas.drawing` out from under an in-flight PencilKit
                    // undo action (the root cause of "Undo greys out but leaves the stroke on screen").
                    committed[number] = parent.drawingData(number)
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
            let manager = sourcePage(forDisplayIndex: parent.page).flatMap { overlays[$0] }?.canvas.undoManager
            let undo = manager?.canUndo ?? false, redo = manager?.canRedo ?? false
            guard parent.markup.canUndoInk != undo || parent.markup.canRedoInk != redo else { return }
            Task { @MainActor [weak self] in
                self?.parent.markup.canUndoInk = undo; self?.parent.markup.canRedoInk = redo
            }
        }
        @objc func pageTapped(_ recognizer: UITapGestureRecognizer) {
            guard recognizer.state == .ended, let view = recognizer.view as? PDFView else { return }
            // Focus/performance mode (§7 reading): every tap is a page turn, full stop — no link
            // or region can fire underneath it. That is the whole point of that mode: one
            // unambiguous gesture, safe to use without looking, chrome or not.
            if parent.focusPageTurns {
                parent.onTurnPage(recognizer.location(in: view).x < view.bounds.width / 3 ? -1 : 1)
                return
            }
            guard let tappedPage = view.page(for: recognizer.location(in: view), nearest: false), let document = view.document else { return }
            let displayIndex = document.index(for: tappedPage) + 1
            // §7 links: a repeat/D.S./coda tap region is defined on the *displayed* page, in PDF
            // page-space (bottom-left origin), independent of whether that page has an ink overlay.
            let crop = tappedPage.bounds(for: .cropBox)
            let pageLocal = view.convert(recognizer.location(in: view), to: tappedPage)
            let fraction = crop.width > 0 && crop.height > 0
                ? CGPoint(x: (pageLocal.x - crop.minX) / crop.width, y: 1 - (pageLocal.y - crop.minY) / crop.height) : nil
            if let fraction, !parent.scoreLinks.isEmpty,
               let link = parent.scoreLinks.reversed().first(where: { $0.sourcePage == displayIndex && ($0.sourceRegion?.contains(fraction) ?? false) }) {
                parent.onLinkActivated(link)
                return
            }
            if let sourcePage = sourcePage(forDisplayIndex: displayIndex), let overlay = overlays[sourcePage] {
                let point = overlay.convert(recognizer.location(in: view), from: view)
                if let region = overlay.displayedRegions.reversed().first(where: { $0.page == overlay.pageNumber && $0.rect(in: overlay.bounds.size).contains(point) }) {
                    parent.onRegionSelected(region.id)
                    return
                }
            }
            // §7 reading: tap-zone turning is also available outside focus/performance mode, as a
            // fallback once a tap has already missed every link and passage region above it — the
            // left-edge/right-majority split matches the same zones `focusPageTurns` uses, so it
            // feels like the same gesture whether or not the reading chrome happens to be visible.
            parent.onTurnPage(recognizer.location(in: view).x < view.bounds.width / 3 ? -1 : 1)
        }
        @objc func longPressed(_ recognizer: UILongPressGestureRecognizer) {
            guard recognizer.state == .began, let view = recognizer.view as? PDFView else { return }
            guard let tappedPage = view.page(for: recognizer.location(in: view), nearest: false), let document = view.document,
                  let number = sourcePage(forDisplayIndex: document.index(for: tappedPage) + 1), let overlay = overlays[number] else {
                parent.onLongPress(nil); return
            }
            let point = overlay.convert(recognizer.location(in: view), from: view)
            parent.onLongPress(overlay.passageRegion(at: point))
        }
        @objc func swiped(_ recognizer: UISwipeGestureRecognizer) {
            guard let view = recognizer.view as? ZoomableScorePDFView,
                  view.scaleFactor <= view.minScaleFactor * 1.05 else { return }
            parent.onTurnPage(recognizer.direction == .left ? 1 : -1)
        }
        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
            guard let view = pdfView else { return true }
            let point = touch.location(in: view)
            guard let page = view.page(for: point, nearest: false), let document = view.document,
                  let number = sourcePage(forDisplayIndex: document.index(for: page) + 1), let overlay = overlays[number] else { return true }
            return !overlay.containsNote(at: overlay.convert(point, from: view))
        }
        func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool { parent.markup.mode == .reading }
        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool { true }

    }
}

struct ScorePagePicker: View {
    let url: URL
    var pageEdits: [PageEdit] = []
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
                                            .clipShape(RoundedRectangle(cornerRadius: PraeludeRadius.tight))
                                    }
                                    Text("\(index + 1)").font(.subheadline.monospacedDigit())
                                }.padding(8).frame(maxWidth: .infinity).contentShape(Rectangle())
                                    .background(index + 1 == currentPage ? PraeludeColor.inkFillQuiet : Color.clear, in: RoundedRectangle(cornerRadius: PraeludeRadius.control))
                            }.buttonStyle(.plain).accessibilityLabel("Page \(index + 1)")
                        }
                    }
                }.padding(20)
            }
            .navigationTitle("Pages").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .onAppear { document = ScorePageComposer.displayDocument(url: url, pageEdits: pageEdits) }
        }.presentationDetents([.large])
    }
}
