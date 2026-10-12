import SwiftUI
import PDFKit
import PencilKit
import Observation

/// Establish a fit-page minimum and bounded zoom after native layout, preserving manual
/// zoom while allowing a legible width fit in short annotation windows.
final class ZoomableScorePDFView: PDFView {
    private var fittedSize: CGSize = .zero
    private var fittedScale: CGFloat = 0
    private var needsScaleRange = true
    var prefersWidthFit = false {
        didSet { if prefersWidthFit != oldValue { needsInitialWidthFit = prefersWidthFit; refreshScaleRange() } }
    }
    private var needsInitialWidthFit = false
    /// Annotation in a short landscape window needs legible stave width, rather than fitting
    /// an entire portrait page into the small height left above the drawing tools.
    var prefersShortLandscapeWidthFit = false {
        didSet { if prefersShortLandscapeWidthFit != oldValue { refreshScaleRange() } }
    }
    private var appliedWidthFit = false
    private var wasShortLandscape = false
    private var preShortLandscapeZoom: CGFloat?
    private var automaticShortLandscapeScale: CGFloat?

    override var accessibilityElements: [Any]? {
        get {
            guard let coordinator = pageOverlayViewProvider as? PagedScoreView.Coordinator else {
                return super.accessibilityElements
            }
            let visibleOverlays = coordinator.overlays.values.filter {
                isVisibleAccessibilityOverlay($0) && $0.convert($0.bounds, to: self).intersects(bounds)
            }.sorted { $0.pageNumber < $1.pageNumber }
            guard !visibleOverlays.isEmpty else { return super.accessibilityElements }
            // PDFKit's document is itself an accessibility text container and masks its page
            // overlays. Preserve that native traversal, then vend the real overlay containers
            // alongside it so notes, PencilKit and expanded-note controls remain reachable.
            let native = super.accessibilityElements ?? subviews
            return native + visibleOverlays.filter { overlay in
                !native.contains { ($0 as? UIView) === overlay }
            }
        }
        set { super.accessibilityElements = newValue }
    }
    private func isVisibleAccessibilityOverlay(_ overlay: ScorePageOverlay) -> Bool {
        var ancestor: UIView? = overlay
        while let current = ancestor {
            guard !current.isHidden, current.alpha > 0.01, !current.accessibilityElementsHidden else { return false }
            if current === self { return true }
            ancestor = current.superview
        }
        return false
    }

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
                    return ["selectionHandleScreenDiameter=\(overlay.selectionHandleDiameter * overlay.pageDisplayScale),stampPreviewWidth=\(stampWidth),stampCountPage\(overlay.pageNumber)=\(overlay.displayedStamps.filter { $0.page == overlay.pageNumber }.count),inkPage\(overlay.pageNumber)=\(canvas.drawing.strokes.count),canvasBounds=\(canvas.bounds),canvasFrame=\(canvas.frame),contentSize=\(canvas.contentSize),contentOffset=\(canvas.contentOffset),canvasZoom=\(canvas.zoomScale),drawingBounds=\(canvas.sourceDrawing.bounds);\(overlay.noteGestureDiagnostic)"]
                }
                return root.subviews.flatMap(inkCounts)
            }
            let renderedPageWidth = currentPage.map { convert($0.bounds(for: .cropBox), from: $0).width } ?? 0
            let leftIsMargin = page(for: CGPoint(x: bounds.width * 0.03, y: bounds.midY), nearest: false) == nil
            let rightIsMargin = page(for: CGPoint(x: bounds.width * 0.97, y: bounds.midY), nearest: false) == nil
            let quickEdit = (pageOverlayViewProvider as? PagedScoreView.Coordinator)?.quickEditDiagnostic ?? ""
            var displayedPage = 0
            if let document, let currentPage {
                let index = document.index(for: currentPage)
                if index >= 0 && index < document.pageCount { displayedPage = index + 1 }
            }
            let passiveReading = InteractionAudit.isPassiveReadingDelivery
                ? ";passiveReading=[\(InteractionAudit.passiveReadingEvents.joined(separator: "|"))]" : ""
            return "displayedPage=\(displayedPage);renderedPageWidth=\(renderedPageWidth);leftIsMargin=\(leftIsMargin),rightIsMargin=\(rightIsMargin);scale=\(scaleFactor),min=\(minScaleFactor),max=\(maxScaleFactor),auto=\(autoScales),markup=\(isInMarkupMode),hit=\(hitTest(CGPoint(x:bounds.midX,y:bounds.midY),with:nil).map { String(describing:type(of:$0)) } ?? "none");\(details);quickEdit=[\(quickEdit)];\(inkCounts(self).joined(separator: ";"))\(passiveReading)"
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
        guard document != nil, bounds.width > 0, bounds.height > 0 else { return }
        let shortLandscape = prefersShortLandscapeWidthFit && bounds.height < 300 && bounds.width > bounds.height * 1.5
        let widthFit = prefersWidthFit || shortLandscape
        let enteringShortLandscape = shortLandscape && !wasShortLandscape
        let leavingShortLandscape = !shortLandscape && wasShortLandscape
        let previousZoom = fittedScale > 0 ? max(1, scaleFactor / fittedScale) : 1
        func stillAtAutomaticWidth() -> Bool {
            guard let automaticShortLandscapeScale else { return false }
            return abs(scaleFactor - automaticShortLandscapeScale) <= max(0.001, automaticShortLandscapeScale * 0.002)
        }
        // Automatic readability zoom is temporary. Returning to portrait restores the previous
        // reading zoom; an actual pinch in the short window opts out of that restoration.
        let restoredZoom = leavingShortLandscape && stillAtAutomaticWidth() ? preShortLandscapeZoom : nil
        if shortLandscape && !enteringShortLandscape && !stillAtAutomaticWidth() {
            automaticShortLandscapeScale = nil
        }
        if widthFit != appliedWidthFit {
            appliedWidthFit = widthFit; needsInitialWidthFit = widthFit; needsScaleRange = true
        }
        if enteringShortLandscape {
            preShortLandscapeZoom = previousZoom; needsInitialWidthFit = true; needsScaleRange = true
        } else if shortLandscape && stillAtAutomaticWidth() && fittedSize != bounds.size {
            needsInitialWidthFit = true
        }
        if leavingShortLandscape {
            preShortLandscapeZoom = nil; automaticShortLandscapeScale = nil; needsScaleRange = true
        }
        wasShortLandscape = shortLandscape
        guard needsScaleRange || fittedSize != bounds.size else { return }
        let fit = scaleFactorForSizeToFit
        guard fit.isFinite, fit > 0 else { return }
        let zoom = restoredZoom ?? previousZoom
        let pageBounds = currentPage?.bounds(for: .cropBox) ?? .zero
        let rotation = ((currentPage?.rotation ?? 0) % 360 + 360) % 360
        let pageWidth = rotation == 90 || rotation == 270 ? pageBounds.height : pageBounds.width
        let widthScale = pageWidth > 0 ? max(fit, (bounds.width - 8) / pageWidth) : fit
        fittedSize = bounds.size
        fittedScale = fit
        needsScaleRange = false
        autoScales = false
        minScaleFactor = fit
        // Six times the fit-page scale can still be unreadably small in a short viewport.
        // Permit full stave width and up to twice that scale; PDFKit keeps native tiled rendering.
        maxScaleFactor = shortLandscape ? max(fit * 6, widthScale * 2) : fit * 6
        if needsInitialWidthFit {
            scaleFactor = min(maxScaleFactor, widthScale)
            if shortLandscape { automaticShortLandscapeScale = scaleFactor }
            needsInitialWidthFit = false
        } else { scaleFactor = min(maxScaleFactor, fit * zoom) }
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

/// A successful durable save's exact readable baseline. A nil `data` means an empty saved page;
/// a nil receipt means the save failed. The submitted canvas can have a different stroke order.
struct ScoreInkSaveReceipt {
    let data: Data?
}

struct PagedScoreView: UIViewRepresentable {
    let url: URL
    @Binding var page: Int
    var twoPages: Bool
    var focusPageTurns: Bool = false
    var markup: ScoreMarkupState
    var allowsInk = true
    var allowsFocusToggle = false
    var onToggleFocus: () -> Void = {}
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
    /// Optional background preparation for idle saves. A callback must check cancellation/CAS
    /// immediately before its synchronous durable commit, and return its exact committed baseline.
    var saveDrawingAsync: ((Int, Data, Data?) async -> ScoreInkSaveReceipt?)? = nil
    var onRegionSelected: (UUID) -> Void = { _ in }
    var onPlaceStamp: (Int, NormalizedRect) -> Bool = { _, _ in true }
    var onPlaceTextBox: (Int, NormalizedRect) -> Void = { _, _ in }
    var onPlaceBreakPoint: (Int, NormalizedRect) -> Void = { _, _ in }
    var onEditTextBox: (TextBoxAnnotation) -> Void = { _ in }
    var onRenameRegion: (UUID) -> Void = { _ in }
    var onDictateRegion: (UUID) -> Void = { _ in }
    var onMoveTextBox: (TextBoxAnnotation, NormalizedRect) -> TextBoxAnnotation? = { _, _ in nil }
    var onDictateTextBox: (TextBoxAnnotation) -> Void = { _ in }
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
        #if DEBUG
        context.coordinator.readingPageTap = pageTap
        #endif
        let undoTap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.twoFingerTapped(_:)))
        undoTap.numberOfTouchesRequired = 2
        undoTap.cancelsTouchesInView = false
        undoTap.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.direct.rawValue)]
        undoTap.delegate = context.coordinator
        view.addGestureRecognizer(undoTap); context.coordinator.undoTap = undoTap
        let renameTap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.renameTapped(_:)))
        renameTap.numberOfTapsRequired = 2; renameTap.delegate = context.coordinator
        renameTap.allowedTouchTypes = undoTap.allowedTouchTypes
        let dictateTap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.dictateTapped(_:)))
        dictateTap.numberOfTapsRequired = 3; dictateTap.delegate = context.coordinator
        dictateTap.allowedTouchTypes = undoTap.allowedTouchTypes
        renameTap.require(toFail: dictateTap)
        pageTap.require(toFail: renameTap); pageTap.require(toFail: dictateTap)
        view.addGestureRecognizer(renameTap); view.addGestureRecognizer(dictateTap)
        context.coordinator.renameTap = renameTap; context.coordinator.dictateTap = dictateTap
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
            swipe.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.direct.rawValue)]
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
        view.prefersShortLandscapeWidthFit = !twoPages && markup.mode != .reading
        view.isInMarkupMode = true
        view.pageOverlayViewProvider = context.coordinator
        context.coordinator.pdfView = view
        context.coordinator.loadedURL = url
        view.document = context.coordinator.loadDocument(url: url, pageEdits: pageEdits)
        if let target = view.document?.page(at: max(0, page - 1)) { view.go(to: target) }
        context.coordinator.observer = NotificationCenter.default.addObserver(forName: .PDFViewPageChanged, object: view, queue: .main) { [weak coordinator = context.coordinator, weak view] _ in
            MainActor.assumeIsolated {
                guard let coordinator, !coordinator.isApplyingViewUpdate,
                      let view, let current = view.currentPage, let doc = view.document else { return }
                let index = doc.index(for: current) + 1
                guard index != coordinator.parent.page else { return }
                coordinator.parent.page = index
                coordinator.parent.onPageChanged(index)
            }
        }
        context.coordinator.scaleObserver = NotificationCenter.default.addObserver(forName: .PDFViewScaleChanged, object: view, queue: .main) { [weak coordinator = context.coordinator] _ in
            MainActor.assumeIsolated { coordinator?.refreshInkResolution() }
        }
        context.coordinator.connectControls()
        return view
    }
    func updateUIView(_ view: ZoomableScorePDFView, context: Context) {
        // PDFKit removes the previous overlay synchronously when go(to:), displayMode or the
        // document changes. Removing a focused canvas tells SwiftUI about a new first responder.
        // Doing that while SwiftUI is evaluating this representable reenters its AttributeGraph
        // and caused the six symbolicated build7 iPad hangs. Coalesce on the next main turn.
        context.coordinator.enqueueViewUpdate(self, view: view)
    }
    static func dismantleUIView(_ uiView: ZoomableScorePDFView, coordinator: Coordinator) {
        coordinator.cancelPendingViewUpdate()
        if let observer = coordinator.observer { NotificationCenter.default.removeObserver(observer) }
        if let observer = coordinator.scaleObserver { NotificationCenter.default.removeObserver(observer) }
        _ = coordinator.flush()
        coordinator.autosave?.cancel()
        // Provider removal can uninstall a focused overlay too. Retain the view until the
        // representable's teardown transaction has unwound, then finish PDFKit cleanup.
        DispatchQueue.main.async { [uiView] in uiView.pageOverlayViewProvider = nil }
    }
    @MainActor final class Coordinator: NSObject, UIGestureRecognizerDelegate, @preconcurrency PDFPageOverlayViewProvider, PKCanvasViewDelegate {
        var parent: PagedScoreView
        var loadedURL: URL?
        var loadedPageEdits: [PageEdit] = []
        /// §7 page tools: this piece's effective reading order, `displayOrder`-indexed (index 0 is
        /// display page 1). Rebuilt by `loadDocument` whenever the source URL or page edits change.
        var effectivePages: [EffectivePage] = []
        var observer: NSObjectProtocol?
        var scaleObserver: NSObjectProtocol?
        var undoTap: UITapGestureRecognizer?
        var renameTap: UITapGestureRecognizer?
        var dictateTap: UITapGestureRecognizer?
        #if DEBUG
        weak var readingPageTap: UITapGestureRecognizer?
        private var quickEditTrace: [String] = []
        private var tracedRecognizers: Set<ObjectIdentifier> = []
        var quickEditDiagnostic: String { quickEditTrace.joined(separator: "|") }
        private func traceQuickEdit(_ event: String) {
            guard ProcessInfo.processInfo.arguments.contains("--uitesting"),
                  (ProcessInfo.processInfo.arguments.contains("--audit-taps") ||
                   ProcessInfo.processInfo.arguments.contains("--audit-reading-delivery")) else { return }
            InteractionAudit.record("pdf " + event)
            if InteractionAudit.isPassiveReadingDelivery { return }
            quickEditTrace.append(event)
            if quickEditTrace.count > 24 { quickEditTrace.removeFirst(quickEditTrace.count - 24) }
        }
        private func observeGestureActions(in view: UIView) {
            guard ProcessInfo.processInfo.arguments.contains("--uitesting"),
                  ProcessInfo.processInfo.arguments.contains("--audit-taps") else { return }
            for recognizer in view.gestureRecognizers ?? [] {
                if tracedRecognizers.insert(ObjectIdentifier(recognizer)).inserted {
                    recognizer.addTarget(self, action: #selector(observedGestureAction(_:)))
                }
            }
            view.subviews.forEach(observeGestureActions)
        }
        @objc private func observedGestureAction(_ recognizer: UIGestureRecognizer) {
            guard recognizer.state != .changed, let view = pdfView else { return }
            let point = recognizer.location(in: view)
            let note = quickEditTarget(at: point, in: view).note != nil
            let owner = recognizer.view.map { String(describing: type(of: $0)) } ?? "none"
            var role = "system"
            if recognizer === readingPageTap { role = "readingPageTap" }
            else if let overlay = recognizer.view as? ScorePageOverlay {
                if recognizer === overlay.selectionTap { role = "selectionTap" }
                else if recognizer === overlay.noteEditTap { role = "noteEditTap" }
                else if recognizer === overlay.noteDictateTap { role = "noteDictateTap" }
                else if recognizer === overlay.notePan { role = "notePan" }
                else if recognizer === overlay.selectionDoubleTap { role = "selectionDoubleTap" }
            }
            traceQuickEdit("nativeAction \(owner).\(type(of: recognizer)) role=\(role) taps=\((recognizer as? UITapGestureRecognizer)?.numberOfTapsRequired ?? 0) state=\(recognizer.state.rawValue) note=\(note) point=\(point)")
        }
        #endif
        weak var pdfView: PDFView?
        var overlays: [Int: ScorePageOverlay] = [:]
        // Retain at most two clean detached pages. PDFKit also detaches during zoom/reflow;
        // that must not destroy the current page's value-based Undo/Redo history.
        private var detachedPages: [Int] = []
        var committed: [Int: Data] = [:]
        var canvasBaseline: [Int: Data] = [:]
        var dirtyPages: Set<Int> = []
        var loading = false
        var autosave: Task<Void, Never>?
        /// Drawing callbacks can run at Pencil sample cadence. Only dirty-page identity changes
        /// during a stroke; serialization and durable writes wait until the tool is idle.
        var activeToolPages: Set<Int> = []
        private var flushing = false
        private var pendingViewUpdate: PagedScoreView?
        private var viewUpdateScheduled = false
        private var viewIsDismantled = false
        var isApplyingViewUpdate = false
        private var editGenerations: [Int: UInt64] = [:]
        private var saveEpoch: UInt64 = 0
        private var runningIdleEpoch: UInt64?
        private struct IdleSnapshot {
            let id = UUID()
            let page: Int
            let data: Data
            let expected: Data?
            let generation: UInt64
            let document: URL
            let layer: InkLayer
            let markup: ScoreMarkupState
        }
        private var idleSnapshots: [Int: IdleSnapshot] = [:]
        init(parent: PagedScoreView) { self.parent = parent }
        var otherLayersDrawingCache: [Int: [Data]] = [:]
        private var observedZoomGestures: Set<ObjectIdentifier> = []
        @objc private func pdfZoomEnded(_ recognizer: UIPinchGestureRecognizer) {
            guard recognizer.state == .ended || recognizer.state == .cancelled || recognizer.state == .failed else { return }
            DispatchQueue.main.async { [weak self] in
                self?.overlays.values.forEach { $0.canvas.inkHistory.resumePendingRequest() }
            }
        }
        func enqueueViewUpdate(_ updated: PagedScoreView, view: ZoomableScorePDFView) {
            guard !viewIsDismantled else { return }
            pendingViewUpdate = updated
            guard !viewUpdateScheduled else { return }
            viewUpdateScheduled = true
            DispatchQueue.main.async { [weak self, weak view] in
                guard let self, let view else { return }
                self.viewUpdateScheduled = false
                guard !self.viewIsDismantled, let updated = self.pendingViewUpdate else { return }
                self.pendingViewUpdate = nil
                // These reads used to occur within SwiftUI's representable observation scope.
                // Deferred PDF updates need their own tracking, including callback-backed ink
                // storage and binding values, so color/width/finger mode and remote ink stay live.
                withObservationTracking {
                    self.applyViewUpdate(updated, view: view)
                } onChange: { [weak self, weak view] in
                    // Observation calls onChange before the mutation. Read the newest values
                    // next turn, and never overwrite a newer queued SwiftUI configuration.
                    DispatchQueue.main.async { [weak self, weak view] in
                        guard let self, let view else { return }
                        self.enqueueViewUpdate(self.pendingViewUpdate ?? self.parent, view: view)
                    }
                }
            }
        }
        func cancelPendingViewUpdate() {
            viewIsDismantled = true
            pendingViewUpdate = nil
        }
        private func applyViewUpdate(_ updated: PagedScoreView, view: ZoomableScorePDFView) {
            // PDFKit publishes transient current pages while replacing/reflowing a document.
            // They must not replace the user's requested page before navigation reaches it.
            let requestedPage = updated.page
            let sourceChanged = loadedURL != updated.url || parent.markup !== updated.markup
                || parent.activeLayer != updated.activeLayer || loadedPageEdits != updated.pageEdits
            let mode: PDFDisplayMode = updated.twoPages ? .twoUp : .singlePage
            let book = scoreDisplaysAsBook(twoPages: updated.twoPages, page: requestedPage)
            let target = view.document?.page(at: max(0, requestedPage - 1))
            let changesVisiblePages = sourceChanged || view.displayMode != mode
                || view.displaysAsBook != book || (target != nil && view.currentPage != target)
            // Changing page layout can uninstall the focused overlay just like go(to:).
            // No PDF mutation may proceed when its current drawing has not been saved.
            if changesVisiblePages, !flush() { return }
            guard adoptParent(updated) else { return }
            isApplyingViewUpdate = true
            defer { isApplyingViewUpdate = false }
            view.prefersWidthFit = parent.focusPageTurns && !parent.twoPages
            view.prefersShortLandscapeWidthFit = !parent.twoPages && parent.markup.mode != .reading
            if sourceChanged {
                clearOverlays()
                view.document = loadDocument(url: parent.url, pageEdits: parent.pageEdits)
                loadedURL = parent.url
                view.refreshScaleRange()
            }
            if view.displayMode != mode { view.displayMode = mode; view.refreshScaleRange() }
            if view.displaysAsBook != book { view.displaysAsBook = book; view.refreshScaleRange() }
            if let target = view.document?.page(at: max(0, requestedPage - 1)), view.currentPage != target {
                view.go(to: target)
                view.refreshScaleRange()
            }
            refreshOverlays()
        }
        /// Flush with the original piece's callbacks before a reused representable changes owners.
        func adoptParent(_ updated: PagedScoreView) -> Bool {
            // A layer switch reuses the exact document-switch path below: flush whatever is pending
            // on the old layer, tear down every overlay, and reload from `drawingData`/`otherLayersInkData`
            // — which `ScoreWorkspace` now reads against the *new* `markup.activeLayer` — instead of
            // adding a second, parallel per-layer keying scheme to every dictionary in this class.
            let changed = parent.url != updated.url || parent.markup !== updated.markup || parent.activeLayer != updated.activeLayer || parent.pageEdits != updated.pageEdits
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
        // PDFKit lazily decodes visible pages. Speculatively rendering neighboring full scans
        // discarded their thumbnails, consumed memory, and raced the live PDFDocument on another
        // executor. Picker thumbnails use their own bounded renderer instead.
        func clearOverlays() {
            cancelIdleSave(); activeToolPages.removeAll()
            detachedPages.removeAll(); overlays.removeAll(); committed.removeAll(); canvasBaseline.removeAll(); dirtyPages.removeAll(); editGenerations.removeAll()
            otherLayersDrawingCache.removeAll()
        }
        func connectControls() {
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
                cancelIdleSave()
                let overlay = overlays[number]
                let pending = parent.markup.pendingInk[number]
                guard overlay != nil || pending != nil else { return }
                let saved = parent.drawingData(number)
                if keepLocal {
                    // A failed flush may have checkpointed an older local drawing. Additional
                    // strokes remain in the dirty canvas until idle, so the live canvas wins.
                    let data = dirtyPages.contains(number) && overlay != nil
                        ? (overlay.flatMap { encodedInk($0.canvas) } ?? Data())
                        : (pending?.data ?? overlay.flatMap { encodedInk($0.canvas) } ?? Data())
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
                        overlay?.canvas.replaceDrawing(drawing); committed[number] = saved
                    }
                    catch { parent.markup.errorMessage = "The saved drawing could not be opened."; loading = false; return }
                    loading = false
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
            overlay.onCanvasLayout = { [weak self, weak overlay] in
                Task { @MainActor in
                    guard let self, let overlay, self.overlays[number] === overlay else { return }
                    self.refreshOtherLayersDrawing(overlay)
                }
            }
            overlay.onCanvasReplaced = { [weak self, weak overlay] in
                guard let self, let overlay, let view = self.pdfView,
                      self.overlays[number] === overlay else { return }
                self.configureInkGestureDependencies(in: view, overlay: overlay)
            }
            let previewPage = effectivePages.indices.contains(displayIndex - 1) ? effectivePages[displayIndex - 1]
                : EffectivePage(id: UUID(), displayOrder: displayIndex, sourcePage: number, kind: .original, cropRect: nil, rotationDegrees: 0)
            let previewURL = parent.url
            overlay.pageImageForMagnifier = { size in
                await ScorePagePreviewRenderer.shared.render(url: previewURL, page: previewPage, size: size)
            }
            // §7 page tools: this display position's own crop, if any (see "(C) Schema3.md" and
            // `ScorePageOverlay.activeCrop`) — the exact same crop `ScorePageComposer.renderedPage`
            // just used to build this very `page`'s `.cropBox`, so the overlay and the PDF content it
            // sits on always agree about what "cropped" means. `effectivePages` is rebuilt (and every
            // overlay torn down with it) whenever page edits change, so this never goes stale.
            let effectiveCrop = effectivePages.indices.contains(displayIndex - 1) ? effectivePages[displayIndex - 1].cropRect : nil
            overlay.activeCrop = (effectiveCrop?.isValid == true) ? effectiveCrop : nil
            loading = true
            if let pending = parent.markup.pendingInk[number], parent.markup.pendingInkDocument == parent.url, parent.markup.pendingInkLayer == parent.activeLayer {
                do {
                    let baseline = try decodeDrawing(pending.expected)
                    canvasBaseline[number] = baseline.strokes.isEmpty ? nil : baseline.dataRepresentation()
                    overlay.canvas.replaceDrawing(pending.data.isEmpty ? PKDrawing() : try decodeDrawing(pending.data))
                    committed[number] = pending.expected
                    dirtyPages.insert(number)
                } catch {
                    parent.markup.errorMessage = "Unsaved ink on page \(number) could not be reopened. It remains in memory."
                    overlay.contentReadOnly = true
                }
            } else if let data = parent.drawingData(number) {
                do { overlay.canvas.replaceDrawing(try decodeDrawing(data)); committed[number] = data }
                catch { parent.markup.errorMessage = "The saved ink on page \(number) could not be read. It has been preserved."; overlay.contentReadOnly = true }
            }
            loading = false
            if !dirtyPages.contains(number) { canvasBaseline[number] = encodedInk(overlay.canvas) }
            overlay.canvas.delegate = self
            overlay.canvas.inkHistory.acceptsRequest = { [weak self, weak overlay] in
                guard let self, let overlay else { return false }
                return !self.viewIsDismantled && self.overlays[number] === overlay && overlay.canvas.window != nil
                    && self.sourcePage(forDisplayIndex: self.parent.page) == number
                    && self.parent.allowsInk && !overlay.inkReadOnly && !overlay.contentReadOnly
            }
            overlay.canvas.inkHistory.mayRestore = { [weak self] in
                guard let self, let view = self.pdfView else { return false }
                return !self.isApplyingViewUpdate && !self.hasActiveZoomGesture(in: view)
            }
            overlay.canvas.onDetached = { [weak self, weak overlay] in
                guard let self, let overlay, self.overlays[number] === overlay else { return }
                self.activeToolPages.remove(number)
                self.scheduleAutosave()
            }
            overlay.canvas.inkHistory.onStateChanged = { [weak self] in self?.updateUndoState() }
            overlay.canvas.inkHistory.onRestored = { [weak self, weak overlay] in
                guard let self, let overlay else { return }
                // Mark the restored value dirty immediately, before a page/save action can run.
                self.canvasViewDrawingDidChange(overlay.canvas)
            }
            overlays[number] = overlay
            refresh(overlay)
            return overlay
        }
        func pdfView(_ pdfView: PDFView, willDisplayOverlayView overlayView: UIView, for page: PDFPage) {
            guard let overlay = overlayView as? ScorePageOverlay else { return }
            detachedPages.removeAll { $0 == overlay.pageNumber }
            configureInkGestureDependencies(in: pdfView, overlay: overlay)
            refresh(overlay)
            // PDFKit can first attach an overlay after the initial tracked configuration. Arm
            // tracking for its ink/appearance dependencies once the real page exists too.
            if let view = pdfView as? ZoomableScorePDFView {
                enqueueViewUpdate(pendingViewUpdate ?? parent, view: view)
            }
        }
        private func configureInkGestureDependencies(in pdfView: PDFView, overlay: ScorePageOverlay) {
            func configure(_ view: UIView) {
                guard !(view is ScorePageOverlay), !(view is PKCanvasView) else { return }
                if let scrollView = view as? UIScrollView {
                    if let pinch = scrollView.pinchGestureRecognizer,
                       observedZoomGestures.insert(ObjectIdentifier(pinch)).inserted {
                        // A pinch also contains two fingers. It must win the complete sequence;
                        // simultaneous recognition previously fired Undo during actual PDF zoom.
                        undoTap?.require(toFail: pinch)
                        pinch.addTarget(self, action: #selector(pdfZoomEnded(_:)))
                    }
                    scrollView.panGestureRecognizer.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.direct.rawValue)]
                    scrollView.panGestureRecognizer.require(toFail: overlay.selectionPan)
                    scrollView.panGestureRecognizer.require(toFail: overlay.stampPan)
                    scrollView.panGestureRecognizer.require(toFail: overlay.notePan)
                    // Let PencilKit claim ink before a parent PDF scroll cancels the stroke.
                    // Pencil-only policy still rejects ordinary reading fingers; pinch is unchanged.
                    scrollView.panGestureRecognizer.require(toFail: overlay.canvas.drawingGestureRecognizer)
                }
                view.subviews.forEach(configure)
            }
            configure(pdfView)
            #if DEBUG
            observeGestureActions(in: pdfView)
            #endif
        }
        func pdfView(_ pdfView: PDFView, willEndDisplayingOverlayView overlayView: UIView, for page: PDFPage) {
            guard let overlay = overlayView as? ScorePageOverlay, overlays[overlay.pageNumber] === overlay else { return }
            // Removal cancels this tool even if PencilKit omits its end callback. Checkpoint its
            // current value; a failed write still pins this exact canvas for retry.
            overlay.canvas.inkHistory.detach()
            activeToolPages.remove(overlay.pageNumber)
            _ = flush()
            guard !dirtyPages.contains(overlay.pageNumber) else { return }
            detachedPages.removeAll { $0 == overlay.pageNumber }
            detachedPages.append(overlay.pageNumber)
            let current = sourcePage(forDisplayIndex: parent.page)
            while detachedPages.count > 2 {
                guard let victim = detachedPages.first(where: { $0 != current && !dirtyPages.contains($0) }) else { break }
                detachedPages.removeAll { $0 == victim }
                overlays.removeValue(forKey: victim); committed.removeValue(forKey: victim)
                canvasBaseline.removeValue(forKey: victim); activeToolPages.remove(victim)
                otherLayersDrawingCache.removeValue(forKey: victim)
            }
        }
        func refreshOverlays() { for overlay in Array(overlays.values) { refresh(overlay) }; updateUndoState() }
        private func refresh(_ overlay: ScorePageOverlay) {
            // §7 performance mode: `allowsInk` can flip on a page that already has a live overlay —
            // entering performance mode does not tear overlays down and rebuild them, so an overlay
            // created while ink was allowed previously kept accepting Pencil input until the reader
            // turned away and back. `inkReadOnly` must be kept in sync on every refresh pass, not only
            // set once at overlay creation (`pdfView(_:overlayViewFor:)`).
            overlay.inkReadOnly = !parent.allowsInk
            overlay.displayedRegions = parent.regions.filter { $0.page == overlay.pageNumber }
            overlay.regionColors = parent.regionColors
            overlay.emphasizedIDs = parent.emphasizedIDs; overlay.practicedIDs = parent.practicedIDs
            overlay.displayedStamps = parent.stamps.filter { $0.page == overlay.pageNumber }
            overlay.displayedTextBoxes = parent.textBoxes.filter { $0.page == overlay.pageNumber }
            overlay.onPlaceStamp = parent.onPlaceStamp; overlay.onPlaceTextBox = parent.onPlaceTextBox
            overlay.onPlaceBreakPoint = parent.onPlaceBreakPoint
            overlay.onEditTextBox = parent.onEditTextBox
            overlay.onDictateTextBox = parent.onDictateTextBox
            overlay.onMoveTextBox = parent.onMoveTextBox
            let number = overlay.pageNumber
            let stored = parent.drawingData(number)
            if !overlay.contentReadOnly, !dirtyPages.contains(number), !activeToolPages.contains(number), stored != committed[number] {
                loading = true
                do {
                    let data = stored
                    overlay.canvas.replaceDrawing(try decodeDrawing(data))
                    committed[number] = data
                    canvasBaseline[number] = encodedInk(overlay.canvas)
                } catch { parent.markup.errorMessage = "Saved ink could not be reopened. The original is preserved."; overlay.contentReadOnly = true }
                loading = false
            }
            overlay.assignToolIfNeeded()
            refreshOtherLayersDrawing(overlay)
            overlay.updateInkResolution(displayScale: pdfView?.scaleFactor ?? 1)
            overlay.refresh()
        }
        func refreshInkResolution() {
            guard let pdfView else { return }
            for overlay in overlays.values {
                overlay.updateInkResolution(displayScale: pdfView.scaleFactor)
                overlay.canvas.inkHistory.resumePendingRequest()
            }
        }
        /// Keep inactive ink as native PencilKit drawing, so zoom rerenders its vectors too.
        /// The canvas rejects every touch and has no delegate/undo observer; other layers cannot edit.
        private func refreshOtherLayersDrawing(_ overlay: ScorePageOverlay) {
            let number = overlay.pageNumber
            let blobs = parent.otherLayersInkData(number)
            guard otherLayersDrawingCache[number] != blobs else { return }
            do {
                let drawing = try InkPerStroke.merge(blobs)
                overlay.otherLayersCanvas.replaceDrawing(drawing)
                otherLayersDrawingCache[number] = blobs
            } catch {
                parent.markup.errorMessage = "A hidden ink layer could not be read. Its original marks are preserved."
            }
        }
        func canvasViewDidBeginUsingTool(_ canvasView: PKCanvasView) {
            if let number = overlays.first(where: { $0.value.canvas === canvasView })?.key {
                activeToolPages.insert(number)
                dirtyPages.insert(number)
                editGenerations[number, default: 0] &+= 1
                (canvasView as? ScoreInkCanvas)?.inkHistory.beginTool()
                // Cancel the idle delay, but let an already prepared older snapshot finish safely.
                // Its generation cannot clear a newer stroke or replace the live canvas.
                if runningIdleEpoch == nil { autosave?.cancel() }
            }
            #if DEBUG
            logCanvas("didBeginUsingTool", canvas: canvasView)
            #endif
        }
        func canvasViewDrawingDidChange(_ canvasView: PKCanvasView) {
            #if DEBUG
            logCanvas("drawingDidChange", canvas: canvasView)
            #endif
            guard !loading, let number = overlays.first(where: { $0.value.canvas === canvasView })?.key else { return }
            (canvasView as? ScoreInkCanvas)?.inkHistory.drawingChanged()
            dirtyPages.insert(number)
            editGenerations[number, default: 0] &+= 1
            // Undo/Redo also emits drawing changes, without begin/end tool callbacks.
            if !activeToolPages.contains(number) { scheduleAutosave() }
        }
        func canvasViewDidEndUsingTool(_ canvasView: PKCanvasView) {
            #if DEBUG
            logCanvas("didEndUsingTool", canvas: canvasView)
            #endif
            guard let number = overlays.first(where: { $0.value.canvas === canvasView })?.key else { return }
            activeToolPages.remove(number)
            let state = canvasView.drawingGestureRecognizer.state
            (canvasView as? ScoreInkCanvas)?.inkHistory.endTool(cancelled: state == .cancelled || state == .failed)
            updateUndoState()
            scheduleAutosave()
            // Do not refit the PDF underneath the first Pencil stroke.
            // Pencil marks are allowed while practicing; completing a stroke never changes modes.
        }
        private func scheduleAutosave() {
            guard runningIdleEpoch == nil else { return }
            autosave?.cancel()
            autosave = Task { @MainActor [weak self] in
                do { try await Task.sleep(for: .milliseconds(600)) } catch { return }
                guard let self, !Task.isCancelled, activeToolPages.isEmpty else { return }
                _ = await flushIdle()
                updateUndoState()
            }
        }
        /// The idle path may suspend for preparation. Explicit transitions still call flush(),
        /// cancel that preparation and synchronously checkpoint the latest canvas before proceeding.
        @discardableResult func flushIdle() async -> Bool {
            guard let save = parent.saveDrawingAsync else { return flush() }
            guard !flushing, runningIdleEpoch == nil, activeToolPages.isEmpty,
                  parent.markup.pendingInkDocument == nil || parent.markup.pendingInkDocument == parent.url,
                  parent.markup.pendingInkLayer == nil || parent.markup.pendingInkLayer == parent.activeLayer else { return false }
            let epoch = saveEpoch
            runningIdleEpoch = epoch
            var allSaved = true
            defer {
                if runningIdleEpoch == epoch {
                    runningIdleEpoch = nil
                    // Retry newer strokes, not an unchanged failing checkpoint every 600 ms.
                    if allSaved, !dirtyPages.isEmpty, activeToolPages.isEmpty { scheduleAutosave() }
                }
            }
            for number in dirtyPages.union(parent.markup.pendingInk.keys).sorted() {
                guard !Task.isCancelled, epoch == saveEpoch, activeToolPages.isEmpty else { return false }
                let pending = parent.markup.pendingInk[number]
                let data: Data, expected: Data?
                if let canvas = overlays[number]?.canvas, dirtyPages.contains(number) {
                    data = canvas.sourceDrawing.strokes.isEmpty ? Data() : canvas.sourceDrawing.dataRepresentation()
                    expected = committed[number]
                    if (data.isEmpty ? nil : data) == canvasBaseline[number] {
                        dirtyPages.remove(number); parent.markup.clearPendingInk(page: number); continue
                    }
                } else if let pending { data = pending.data; expected = pending.expected }
                else { allSaved = false; continue }
                let snapshot = IdleSnapshot(page: number, data: data, expected: expected,
                                            generation: editGenerations[number, default: 0], document: parent.url,
                                            layer: parent.activeLayer, markup: parent.markup)
                idleSnapshots[number] = snapshot
                parent.markup.rememberInk(page: number, data: data, expected: expected, document: parent.url, layer: parent.activeLayer)
                let receipt = await save(number, data, expected)
                // Once committed, cancellation cannot pretend that write did not happen. A newer
                // stroke keeps its dirty flag but must inherit the now-durable storage baseline.
                if let receipt, owns(snapshot) {
                    if epoch == saveEpoch {
                        let stored = parent.drawingData(number)
                        if stored == receipt.data { adoptSaved(snapshot, stored: stored) }
                        else {
                            // A different writer may have changed this page before the success
                            // continuation resumed. Keep local work dirty and require a conflict
                            // decision instead of blessing unrelated bytes as its saved baseline.
                            allSaved = false; parent.markup.conflictPage = number
                        }
                    } else {
                        let stored = parent.drawingData(number)
                        if stored != committed[number], stored == receipt.data { adoptSaved(snapshot, stored: stored) }
                    }
                }
                if idleSnapshots[number]?.id == snapshot.id { idleSnapshots.removeValue(forKey: number) }
                guard epoch == saveEpoch, !Task.isCancelled else { return false }
                if receipt == nil { allSaved = false }
            }
            return allSaved
        }
        private func owns(_ snapshot: IdleSnapshot) -> Bool {
            parent.url == snapshot.document && parent.activeLayer == snapshot.layer && parent.markup === snapshot.markup
        }
        private func adoptSaved(_ snapshot: IdleSnapshot, stored: Data?) {
            committed[snapshot.page] = stored
            canvasBaseline[snapshot.page] = snapshot.data.isEmpty ? nil : snapshot.data
            if editGenerations[snapshot.page, default: 0] == snapshot.generation, !activeToolPages.contains(snapshot.page) {
                dirtyPages.remove(snapshot.page); parent.markup.clearPendingInk(page: snapshot.page)
            }
            if parent.markup.conflictPage == snapshot.page { parent.markup.conflictPage = nil }
            parent.markup.inkRevision += 1
        }
        private func snapshotMatchesStorage(_ snapshot: IdleSnapshot, stored: Data?) -> Bool {
            let local: Data? = snapshot.data.isEmpty ? nil : snapshot.data
            if stored == local { return true }
            // PencilKit's merged encoding can differ bytewise. Compare exact stroke content in
            // order, including masks and duplicates; a reordered highlighter is a different edit.
            guard let stored, let local,
                  let savedDrawing = try? PKDrawing(data: stored), let localDrawing = try? PKDrawing(data: local) else { return false }
            return savedDrawing.strokes.map(InkPerStroke.fingerprint) == localDrawing.strokes.map(InkPerStroke.fingerprint)
        }
        private func reconcileCanceledSnapshot(_ snapshot: IdleSnapshot) {
            guard owns(snapshot) else { return }
            let stored = parent.drawingData(snapshot.page)
            guard stored != committed[snapshot.page] else { return }
            // A commit can finish just before cancellation. Account for that exact saved drawing,
            // but never rewind a later synchronous save or accept unrelated remote content.
            if snapshotMatchesStorage(snapshot, stored: stored) { adoptSaved(snapshot, stored: stored) }
        }
        private func cancelIdleSave() {
            autosave?.cancel(); autosave = nil
            for snapshot in idleSnapshots.values { reconcileCanceledSnapshot(snapshot) }
            idleSnapshots.removeAll()
            saveEpoch &+= 1; runningIdleEpoch = nil
        }
        func canvasViewDidFinishRendering(_ canvasView: PKCanvasView) {
            guard overlays.values.contains(where: { $0.canvas === canvasView }) else { return }
            (canvasView as? ScoreInkCanvas)?.inkHistory.finishedRendering()
            #if DEBUG
            logCanvas("didFinishRendering", canvas: canvasView)
            #endif
        }
        #if DEBUG
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
            cancelIdleSave()
            guard !flushing, activeToolPages.isEmpty,
                  parent.markup.pendingInkDocument == nil || parent.markup.pendingInkDocument == parent.url,
                  parent.markup.pendingInkLayer == nil || parent.markup.pendingInkLayer == parent.activeLayer else { return false }
            flushing = true
            defer { flushing = false }
            var success = true
            let pages = dirtyPages.union(parent.markup.pendingInk.keys)
            for number in pages.sorted() {
                let pending = parent.markup.pendingInk[number]
                let data: Data
                let expected: Data?
                if let canvas = overlays[number]?.canvas, dirtyPages.contains(number) {
                    data = canvas.sourceDrawing.strokes.isEmpty ? Data() : canvas.sourceDrawing.dataRepresentation()
                    expected = committed[number]
                    if (data.isEmpty ? nil : data) == canvasBaseline[number] {
                        dirtyPages.remove(number); parent.markup.clearPendingInk(page: number); continue
                    }
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
                    canvasBaseline[number] = data.isEmpty ? nil : data
                    dirtyPages.remove(number); parent.markup.clearPendingInk(page: number)
                    parent.markup.inkRevision += 1
                } else { success = false }
            }
            return success
        }
        private func encodedInk(_ canvas: PKCanvasView) -> Data? {
            let drawing = (canvas as? ScoreInkCanvas)?.sourceDrawing ?? canvas.drawing
            return drawing.strokes.isEmpty ? nil : drawing.dataRepresentation()
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
            #if DEBUG
            if InteractionAudit.isEnabled {
                traceQuickEdit("reading.action state=\(recognizer.state.rawValue) pdfView=\(recognizer.view is PDFView) reading=\(parent.markup.mode == .reading) focus=\(parent.focusPageTurns)")
            }
            #endif
            guard recognizer.state == .ended, let view = recognizer.view as? PDFView else { return }
            let point = recognizer.location(in: view)
            let x = Double(point.x / max(1, view.bounds.width))
            let y = Double(point.y / max(1, view.bounds.height))
            #if DEBUG
            if InteractionAudit.isEnabled { traceQuickEdit("reading.point point=\(point) fraction=(\(x),\(y)) overlays=\(overlays.count) regions=\(parent.regions.count)") }
            #endif
            if parent.allowsFocusToggle, ScoreReadingInteraction.togglesFocus(x: x, y: y) {
                #if DEBUG
                if InteractionAudit.isEnabled { traceQuickEdit("reading.focusToggle") }
                #endif
                parent.onToggleFocus(); return
            }
            if parent.focusPageTurns {
                #if DEBUG
                if InteractionAudit.isEnabled { traceQuickEdit("reading.focusPageTurn") }
                #endif
                parent.onTurnPage(ScoreReadingInteraction.pageDirection(x: x)); return
            }
            guard let tappedPage = view.page(for: point, nearest: false), let document = view.document else {
                #if DEBUG
                if InteractionAudit.isEnabled { traceQuickEdit("reading.noPage document=\(view.document != nil)") }
                #endif
                // The paper-white gutter belongs to page navigation too. Drawing/selection
                // gestures never enter this reading-only recognizer.
                parent.onTurnPage(ScoreReadingInteraction.pageDirection(x: x)); return
            }
            let displayIndex = document.index(for: tappedPage) + 1
            // §7 links: a repeat/D.S./coda tap region is defined on the *displayed* page, in PDF
            // page-space (bottom-left origin), independent of whether that page has an ink overlay.
            let crop = tappedPage.bounds(for: .cropBox)
            let pageLocal = view.convert(recognizer.location(in: view), to: tappedPage)
            let fraction = crop.width > 0 && crop.height > 0
                ? CGPoint(x: (pageLocal.x - crop.minX) / crop.width, y: 1 - (pageLocal.y - crop.minY) / crop.height) : nil
            if let fraction, !parent.scoreLinks.isEmpty,
               let link = parent.scoreLinks.reversed().first(where: { $0.sourcePage == displayIndex && ($0.sourceRegion?.contains(fraction) ?? false) }) {
                #if DEBUG
                if InteractionAudit.isEnabled { traceQuickEdit("reading.link") }
                #endif
                parent.onLinkActivated(link)
                return
            }
            let sourcePage = sourcePage(forDisplayIndex: displayIndex)
            let overlay = sourcePage.flatMap { overlays[$0] }
            #if DEBUG
            if InteractionAudit.isEnabled {
                traceQuickEdit("reading.page display=\(displayIndex) source=\(sourcePage ?? 0) overlay=\(overlay != nil) pdfPoint=\(pageLocal)")
            }
            #endif
            if let overlay {
                let point = overlay.convert(recognizer.location(in: view), from: view)
                let regionID = overlay.passageRegion(at: point)
                #if DEBUG
                if InteractionAudit.isEnabled {
                    traceQuickEdit("reading.region local=\(point) bounds=\(overlay.bounds) attached=\(overlay.superview != nil) region=\(regionID != nil) displayed=\(overlay.displayedRegions.count) boxes=\(parent.markup.showPassageBoxes)")
                }
                #endif
                if let regionID {
                    parent.onRegionSelected(regionID)
                    return
                }
            }
            #if DEBUG
            if InteractionAudit.isEnabled { traceQuickEdit("reading.fallbackPageTurn") }
            #endif
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
                  view.scaleFactor <= view.minScaleFactor * 1.05,
                  !hasActiveZoomGesture(in: view) else { return }
            parent.onTurnPage(recognizer.direction == .left ? 1 : -1)
        }
        func hasActiveZoomGesture(in view: UIView) -> Bool {
            if let scroll = view as? UIScrollView, scroll.isZooming || scroll.isZoomBouncing { return true }
            if view.gestureRecognizers?.contains(where: { $0 is UIPinchGestureRecognizer && ($0.state == .began || $0.state == .changed) }) == true { return true }
            return view.subviews.contains { hasActiveZoomGesture(in: $0) }
        }
        private func overlay(at point: CGPoint, in view: PDFView) -> (ScorePageOverlay, CGPoint)? {
            guard let page = view.page(for: point, nearest: false), let document = view.document,
                  let number = sourcePage(forDisplayIndex: document.index(for: page) + 1), let overlay = overlays[number] else { return nil }
            return (overlay, overlay.convert(point, from: view))
        }
        func quickEditTarget(at point: CGPoint, in view: PDFView) -> (note: TextBoxAnnotation?, region: UUID?) {
            guard let (overlay, local) = overlay(at: point, in: view) else { return (nil, nil) }
            // Every visible note owns this target, including a read-only layer's chip. It must
            // never fall through to the selected passage underneath and rename that passage.
            if let note = overlay.note(at: local) { return (note, nil) }
            guard let region = overlay.passageRegion(at: local), parent.emphasizedIDs.contains(region) else { return (nil, nil) }
            return (nil, region)
        }
        @objc func twoFingerTapped(_ recognizer: UITapGestureRecognizer) {
            guard recognizer.state == .ended else { return }
            undoFromTouch()
        }
        func undoFromTouch() {
            guard parent.allowsInk, !parent.focusPageTurns else { return }
            if parent.markup.mode == .selecting { parent.markup.undoSelection() }
            else { parent.markup.undoInk() }
        }
        @objc func renameTapped(_ recognizer: UITapGestureRecognizer) { quickEdit(recognizer, dictation: false) }
        @objc func dictateTapped(_ recognizer: UITapGestureRecognizer) { quickEdit(recognizer, dictation: true) }
        private func quickEdit(_ recognizer: UITapGestureRecognizer, dictation: Bool) {
            #if DEBUG
            traceQuickEdit("action dictation=\(dictation) state=\(recognizer.state.rawValue)")
            #endif
            guard recognizer.state == .ended, let view = pdfView else { return }
            let target = quickEditTarget(at: recognizer.location(in: view), in: view)
            #if DEBUG
            traceQuickEdit("action target note=\(target.note != nil) region=\(target.region != nil)")
            #endif
            if target.note == nil, let region = target.region {
                if dictation { parent.onDictateRegion(region) } else { parent.onRenameRegion(region) }
            }
        }
        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
            guard let view = pdfView else {
                #if DEBUG
                if gestureRecognizer === readingPageTap, InteractionAudit.isEnabled { traceQuickEdit("reading.receive pdfView=false allowed=true") }
                #endif
                return true
            }
            if gestureRecognizer === undoTap { return true }
            let point = touch.location(in: view)
            if gestureRecognizer === renameTap || gestureRecognizer === dictateTap {
                guard !parent.focusPageTurns, parent.markup.mode != .selecting else { return false }
                let target = quickEditTarget(at: point, in: view)
                #if DEBUG
                traceQuickEdit("receive taps=\((gestureRecognizer as? UITapGestureRecognizer)?.numberOfTapsRequired ?? 0) point=\(point) note=\(target.note != nil) region=\(target.region != nil) mode=\(parent.markup.mode)")
                #endif
                // Unselected score taps never wait for a double/triple-tap recognizer to time out.
                // Notes own their local 1/2/3-tap sequence. Only selected passage labels use
                // these ancestor recognizers, avoiding duplicate or competing note actions.
                return target.note == nil && target.region != nil
            }
            guard let (overlay, local) = overlay(at: point, in: view) else {
                #if DEBUG
                if gestureRecognizer === readingPageTap, InteractionAudit.isEnabled { traceQuickEdit("reading.receive overlay=false allowed=true point=\(point) touch=\(touch.type.rawValue)") }
                #endif
                return true
            }
            let allowed = !overlay.containsNote(at: local)
            #if DEBUG
            if gestureRecognizer === readingPageTap, InteractionAudit.isEnabled {
                traceQuickEdit("reading.receive overlay=true allowed=\(allowed) point=\(point) local=\(local) touch=\(touch.type.rawValue) reading=\(parent.markup.mode == .reading)")
            }
            #endif
            return allowed
        }
        func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
            if gestureRecognizer === undoTap { return parent.allowsInk && !parent.focusPageTurns }
            if gestureRecognizer === renameTap || gestureRecognizer === dictateTap {
                let begins = !parent.focusPageTurns && parent.markup.mode != .selecting
                #if DEBUG
                traceQuickEdit("shouldBegin taps=\((gestureRecognizer as? UITapGestureRecognizer)?.numberOfTapsRequired ?? 0) allowed=\(begins)")
                #endif
                return begins
            }
            if gestureRecognizer is UISwipeGestureRecognizer {
                return parent.markup.mode == .reading || (parent.markup.mode == .writing && !parent.markup.fingerDrawing && parent.markup.tool.kind.isInkingTool)
            }
            let allowed = parent.markup.mode == .reading
            #if DEBUG
            if gestureRecognizer === readingPageTap, InteractionAudit.isEnabled { traceQuickEdit("reading.shouldBegin allowed=\(allowed)") }
            #endif
            return allowed
        }
        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool {
            if gestureRecognizer === undoTap || otherGestureRecognizer === undoTap {
                return false
            }
            return true
        }

    }
}

/// Picker and stamp previews own their PDFDocuments, never sharing PDFKit's live display document
/// with a background renderer. Work is serial and decoded images have a strict memory budget.
actor ScorePagePreviewRenderer {
    static let shared = ScorePagePreviewRenderer()
    private var documents: [URL: PDFDocument] = [:]
    private let images = NSCache<NSString, UIImage>()
    init() { images.countLimit = 120; images.totalCostLimit = 20 * 1024 * 1024 }
    private func document(_ url: URL) -> PDFDocument? {
        if let document = documents[url] { return document }
        if documents.count >= 2 { documents.removeAll() }
        let loaded = PDFDocument(url: url); documents[url] = loaded
        return loaded
    }
    func pages(url: URL, edits: [PageEdit]) -> [EffectivePage] {
        guard let document = document(url) else { return [] }
        return PageLayout.effectivePages(pageEdits: edits, sourcePageCount: document.pageCount)
    }
    func render(url: URL, page effective: EffectivePage, size: CGSize) async -> UIImage? {
        guard !Task.isCancelled, size.width.isFinite, size.height.isFinite, size.width > 0, size.height > 0,
              let source = document(url) else { return nil }
        let target = CGSize(width: min(1200, size.width), height: min(1200, size.height))
        let key = "\(url.path):\(effective.sourcePage ?? 0):\(effective.kind.rawValue):\(effective.cropRect.map { String(describing: $0) } ?? ""):\(effective.rotationDegrees):\(target.width):\(target.height)" as NSString
        if let cached = images.object(forKey: key) { return cached }
        let image: UIImage?
        if effective.kind == .original {
            guard let number = effective.sourcePage, number >= 1,
                  let original = source.page(at: number - 1), let copy = original.copy() as? PDFPage else { return nil }
            copy.rotation = ((copy.rotation + effective.rotationDegrees) % 360 + 360) % 360
            if let crop = effective.cropRect, crop.isValid {
                let media = original.bounds(for: .mediaBox)
                copy.setBounds(CGRect(x: media.minX + crop.x * media.width, y: media.minY + (1 - crop.y - crop.height) * media.height,
                                      width: crop.width * media.width, height: crop.height * media.height), for: .cropBox)
            }
            let bounds = copy.bounds(for: .cropBox)
            guard bounds.width.isFinite, bounds.height.isFinite, bounds.width > 0, bounds.height > 0 else { return nil }
            image = autoreleasepool { copy.thumbnail(of: target, for: .cropBox) }
        } else {
            let size = source.page(at: 0)?.bounds(for: .mediaBox).size ?? CGSize(width: 612, height: 792)
            // The generated PDFPage stays entirely on its creator's actor. Only the immutable
            // thumbnail crosses back; a live, non-Sendable PDFPage never crosses executors.
            image = await MainActor.run {
                ScorePageComposer.generatedPage(kind: effective.kind, size: size)?.thumbnail(of: target, for: .cropBox)
            }
        }
        guard !Task.isCancelled, let image else { return nil }
        if let bitmap = image.cgImage { images.setObject(image, forKey: key, cost: bitmap.bytesPerRow * bitmap.height) }
        return image
    }
}

private struct ScorePagePreview: View {
    let url: URL
    let page: EffectivePage
    @State private var image: UIImage?
    var body: some View {
        Group {
            if let image { Image(uiImage: image).resizable().scaledToFit() }
            else { Rectangle().fill(PraeludeColor.inkFillQuiet).overlay { ProgressView() } }
        }
        .frame(height: 160).clipShape(RoundedRectangle(cornerRadius: PraeludeRadius.tight))
        .task(id: page) {
            let rendered = await ScorePagePreviewRenderer.shared.render(url: url, page: page, size: CGSize(width: 360, height: 500))
            if !Task.isCancelled { image = rendered }
        }
    }
}

struct ScorePagePicker: View {
    let url: URL
    var pageEdits: [PageEdit] = []
    let currentPage: Int
    var sourcePageRange: ClosedRange<Int>? = nil
    let onSelect: (Int) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var pages: [EffectivePage] = []
    private struct Source: Equatable { let url: URL; let edits: [PageEdit] }
    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 110), spacing: 20)], spacing: 24) {
                    ForEach(pages.filter { page in sourcePageRange == nil || page.sourcePage.map { sourcePageRange!.contains($0) } == true }) { page in
                        Button {
                            onSelect(page.displayOrder); dismiss()
                        } label: {
                            VStack(spacing: 8) {
                                ScorePagePreview(url: url, page: page)
                                Text("\(page.displayOrder)").font(.subheadline.monospacedDigit())
                            }.padding(8).frame(maxWidth: .infinity).contentShape(Rectangle())
                                .background(page.displayOrder == currentPage ? PraeludeColor.inkFillQuiet : Color.clear, in: RoundedRectangle(cornerRadius: PraeludeRadius.control))
                        }.buttonStyle(.plain).accessibilityLabel("Page \(page.displayOrder)")
                    }
                }.padding(20)
            }
            .navigationTitle("Pages").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .task(id: Source(url: url, edits: pageEdits)) {
                let loaded = await ScorePagePreviewRenderer.shared.pages(url: url, edits: pageEdits)
                if !Task.isCancelled { pages = loaded }
            }
        }.presentationDetents([.large])
    }
}
