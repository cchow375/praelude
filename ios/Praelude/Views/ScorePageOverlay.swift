import UIKit
import SwiftUI
import PencilKit

/// Passage-box coloring for the score overlay (§3a: one monochrome ink/paper/gray family, with the
/// one rare amber accent reserved for genuinely live state — a passage box is neither). Practiced,
/// emphasized and selected are distinguished by alpha weight only, never by a second hue, EXCEPT a
/// passage the person explicitly recolored (§8): that is the same named exception "the musician's
/// marks" ink colors are (`AnnotationColor`) — a hue the person chose, not decorative app chrome.
enum ScorePassageBoxStyle {
    static func fillColor(practiced: Bool, emphasized: Bool, recolor: AnnotationColor? = nil) -> UIColor {
        (recolor?.uiColor ?? UIColor(PraeludeColor.scoreInk)).withAlphaComponent(emphasized ? 0.16 : (practiced ? 0.05 : 0.085))
    }
    static func strokeColor(practiced: Bool, selected: Bool, recolor: AnnotationColor? = nil) -> UIColor {
        (recolor?.uiColor ?? UIColor(PraeludeColor.scoreInk)).withAlphaComponent(selected ? 0.7 : (practiced ? 0.18 : 0.32))
    }
    /// The selected box's own corner resize handles — a touch more opaque than its edge stroke so
    /// the drag points read clearly against the page.
    static func handleRingColor() -> UIColor {
        UIColor(PraeludeColor.scoreInk).withAlphaComponent(0.65)
    }
}

/// PDFKit owns page sizing, rotation and zoom; all geometry stays in page-local coordinates (see
/// `GeometryTransforms.swift`: this basis is already rotation/crop/zoom-correct — nothing here needs
/// its own rotation math, proved by `ScoreMarkupTests.testNativePDFOverlayCoordinatesMatchCroppedPageAtEveryRotation`).
/// Each page owns its undo history. UIKit's default responder-chain lookup can walk back through
/// PDFKit while the page is being removed, and a hidden tool picker adds a second responder owner.
/// Native focus remains available for PencilKit's lasso/edit menu. The app never forces focus
/// or installs a hidden tool picker; UIKit can hand focus to a note editor normally.
@MainActor final class ScoreInkCanvas: PKCanvasView {
    let inkHistory: ScoreInkHistory
    var onDetached: () -> Void = {}
    private var retired = false
    /// Large imported PDFs use a bounded canvas basis so PencilKit's width limits do not
    /// collapse the brush stops. Persistent drawings remain in original PDF coordinates.
    static let maximumCanvasPageWidth: CGFloat = 1000
    private(set) var sourceCoordinateScale: CGFloat = 1
    private var cachedSourceDrawing = PKDrawing()
    private var cachedCanvasDrawing = PKDrawing()
    private var originalStrokePairs: [(canvasKey: Data, source: PKStroke)] = []
    var sourceDrawing: PKDrawing {
        let current = drawing
        if sourceCoordinateScale == 1 { return current }
        if current == cachedCanvasDrawing { return cachedSourceDrawing }
        var available: [Data: [PKStroke]] = [:]
        for pair in originalStrokePairs { available[pair.canvasKey, default: []].append(pair.source) }
        let scale = CGAffineTransform(scaleX: sourceCoordinateScale, y: sourceCoordinateScale)
        let strokes = current.strokes.map { stroke -> PKStroke in
            let key = InkPerStroke.fingerprint(stroke)
            if var matches = available[key], !matches.isEmpty {
                let original = matches.removeFirst(); available[key] = matches
                return original
            }
            var source = stroke; source.transform = source.transform.concatenating(scale)
            return source
        }
        cachedSourceDrawing = PKDrawing(strokes: strokes); cachedCanvasDrawing = current
        return cachedSourceDrawing
    }
    override var undoManager: UndoManager? { inkHistory.undoManager }
    override init(frame: CGRect) {
        inkHistory = ScoreInkHistory()
        super.init(frame: frame)
        inkHistory.drawing = { [weak self] in self?.drawing ?? PKDrawing() }
        inkHistory.applyDrawing = { [weak self] in self?.drawing = $0 }
    }
    /// Preserve app-owned history and exact source-stroke mappings, but create a new native
    /// PencilKit tool model. Setting `drawing` on the previous canvas changed its visible value
    /// while its next native stroke could still append to the pre-Undo model (live 1 → 0 → 2).
    init(replacing previous: ScoreInkCanvas, with value: PKDrawing) {
        inkHistory = previous.inkHistory
        sourceCoordinateScale = previous.sourceCoordinateScale
        cachedSourceDrawing = previous.cachedSourceDrawing
        cachedCanvasDrawing = previous.cachedCanvasDrawing
        originalStrokePairs = previous.originalStrokePairs
        super.init(frame: .zero)
        drawing = value
    }
    func retire() {
        retired = true
        delegate = nil; onDetached = {}
        drawingGestureRecognizer.isEnabled = false
        isUserInteractionEnabled = false
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    func replaceDrawing(_ value: PKDrawing) {
        let inverse = 1 / sourceCoordinateScale
        let canvasValue = sourceCoordinateScale == 1 ? value : value.transformed(using: CGAffineTransform(scaleX: inverse, y: inverse))
        cachedSourceDrawing = value; cachedCanvasDrawing = canvasValue
        originalStrokePairs = sourceCoordinateScale == 1 ? [] : zip(canvasValue.strokes, value.strokes).map {
            (canvasKey: InkPerStroke.fingerprint($0.0), source: $0.1)
        }
        inkHistory.reset(to: canvasValue)
        drawing = canvasValue
    }
    func configureSourcePageWidth(_ width: CGFloat) {
        guard width.isFinite, width > 0 else { return }
        let scale = max(1, width / Self.maximumCanvasPageWidth)
        guard scale != sourceCoordinateScale else { return }
        // Before the first layout, incoming saved ink still uses its exact original basis.
        // Subsequent PDF zooms leave page-local width unchanged and never enter this branch.
        let source = sourceDrawing
        sourceCoordinateScale = scale
        replaceDrawing(source)
    }
    override func didMoveToWindow() {
        super.didMoveToWindow()
        guard !retired else { return }
        if window == nil { inkHistory.detach(); onDetached() }
        else { inkHistory.resumePendingRequest() }
    }
}

/// A drawn note has no backing UILabel. Give VoiceOver and other accessibility clients the
/// same visible chip, while activation continues through the overlay's current permission state.
@MainActor private final class ScoreNoteAccessibilityElement: UIAccessibilityElement {
    weak var overlay: ScorePageOverlay?
    let noteID: UUID
    init(noteID: UUID, overlay: ScorePageOverlay) {
        self.noteID = noteID; self.overlay = overlay
        super.init(accessibilityContainer: overlay)
        accessibilityIdentifier = "scoreNote_\(noteID.uuidString)"
        accessibilityTraits = .button
    }
    override var accessibilityFrame: CGRect {
        get {
            guard let overlay, let window = overlay.window else { return .zero }
            // PDFKit moves/scales the overlay without rebuilding this element. Read the live
            // page transform each time. The accessibility convenience converter omits this
            // view's own transform, while UIView conversion preserves it and its ancestors.
            let windowFrame = overlay.convert(accessibilityFrameInContainerSpace, to: window)
            return window.convert(windowFrame, to: window.screen.coordinateSpace)
        }
        set { super.accessibilityFrame = newValue }
    }
    override func accessibilityActivate() -> Bool { overlay?.activateAccessibleNote(noteID) ?? false }
}

/// Moving a note only translates this small surface. Resizing redraws the note, never the
/// full PDF overlay; even a source PDF with enormous coordinates has a bounded backing.
@MainActor private final class ScoreNotePreview: UIView {
    var note: TextBoxAnnotation?
    var pageWidth: CGFloat = 595
    override func draw(_ rect: CGRect) {
        guard let note, let context = UIGraphicsGetCurrentContext() else { return }
        TextAnnotationRenderer.draw(note: note, in: bounds, pageWidth: pageWidth, context: context)
    }
}

@MainActor final class ScorePageOverlay: UIView, UIGestureRecognizerDelegate, UIPencilInteractionDelegate {
    let pageNumber: Int
    private(set) var canvas = ScoreInkCanvas()
    let otherLayersCanvas = ScoreInkCanvas()
    let markup: ScoreMarkupState
    var displayedRegions: [PassageRegion] = [] { didSet { if displayedRegions != oldValue { setNeedsDisplay() } } }
    /// Passage id -> the recolor token it was saved with, if any (§8).
    var regionColors: [UUID: String] = [:] { didSet { if regionColors != oldValue { setNeedsDisplay() } } }
    var displayedStamps: [StampAnnotation] = [] { didSet { if displayedStamps != oldValue { setNeedsDisplay() } } }
    var displayedTextBoxes: [TextBoxAnnotation] = [] {
        didSet {
            if displayedTextBoxes != oldValue {
                if movingNote != nil && !noteGestureIsCurrent { clearNotePreview() }
                setNeedsDisplay(); updateNoteHandles(); layoutNotePanel(); refreshNoteAccessibility()
            }
        }
    }
    /// Set by `PagedScoreView.Coordinator.refresh(_:)`, which runs on every SwiftUI update pass —
    /// far more often than the tool actually changes. Reassigning `canvas.tool` unconditionally on
    /// every one of those passes was observed to disrupt `canvas.undoManager`'s redo stack after a
    /// real Undo (a live-UI-test-only symptom: `canRedo` stayed false long after Undo, though Undo
    /// itself always worked correctly) — tracked per overlay (not globally) so a page's canvas still
    /// always gets the current tool at least once when it is first created, but a refresh that finds
    /// nothing changed skips the reassignment and the `PKInkingTool`/`PKEraserTool`/`PKLassoTool`
    /// allocation it costs.
    var lastAssignedTool: AnnotationTool?
    private var lastAssignedToolPageWidth: CGFloat?
    var onCanvasLayout: () -> Void = {}
    var onCanvasReplaced: () -> Void = {}
    var pageImageForMagnifier: (CGSize) async -> UIImage? = { _ in nil }
    private var magnifierTask: Task<Void, Never>?
    private var magnifierPage: UIImage?
    private var magnifierSize = CGSize.zero
    private(set) var selectionDoubleTap: UITapGestureRecognizer!
    private(set) var noteEditTap: UITapGestureRecognizer!
    private(set) var noteDictateTap: UITapGestureRecognizer!
    private(set) var stampPan: UIPanGestureRecognizer!
    private(set) var stampPencilTap: UITapGestureRecognizer!
    private(set) var notePan: UIPanGestureRecognizer!
    private var movingNote: TextBoxAnnotation?
    private var movedNotePosition: NormalizedRect?
    private var notePanTouchStart: CGPoint?
    private var notePanTarget: TextBoxAnnotation?
    private var noteResizeCorner: Int?
    private var noteGestureMode: ScoreMarkupState.Mode?
    private var noteGestureCrop: NormalizedRect?
    private let notePreview = ScoreNotePreview()
    private let noteHandles = CAShapeLayer()
    private(set) var selectedNoteID: UUID?
    var notePreviewRect: CGRect? { movedNotePosition.map { fullDisplayRect(for: $0) } }
    var noteHandleRects: [CGRect] {
        guard notesEditable, let note = visibleTextBoxes.first(where: { $0.id == selectedNoteID && $0.layer == markup.activeLayer }) else { return [] }
        let rect = movingNote?.id == note.id ? (notePreviewRect ?? fullDisplayRect(for: note.region)) : fullDisplayRect(for: note.region)
        let diameter = selectionHandleDiameter
        return corners(rect).filter { bounds.contains($0) }.map {
            CGRect(x: $0.x - diameter / 2, y: $0.y - diameter / 2, width: diameter, height: diameter)
        }
    }
    private(set) var renderedInkScale: CGFloat = 1
    private(set) var sourceCanvasFrame: CGRect = .zero
    private var previousPencilTool = AnnotationToolKind.pen
    private(set) var expandedNoteID: UUID?
    private let notePanel = UIView()
    private let noteLabel = UILabel()
    private let noteScroll = UIScrollView()
    private let noteEdit = UIButton(type: .system)
    private let noteClose = UIButton(type: .system)
    private var accessibleNotes: [UUID: ScoreNoteAccessibilityElement] = [:]
    private var accessibleNoteLayers: Set<InkLayer> = []
    private var accessibleNoteActiveLayer: InkLayer?
    private let glyphCache: NSCache<NSString, UIImage> = {
        let cache = NSCache<NSString, UIImage>()
        cache.countLimit = 96; cache.totalCostLimit = 8 * 1024 * 1024
        return cache
    }()
    var emphasizedIDs: Set<UUID> = [] { didSet { if emphasizedIDs != oldValue { setNeedsDisplay() } } }
    var practicedIDs: Set<UUID> = [] { didSet { if practicedIDs != oldValue { setNeedsDisplay() } } }
    var onPencilBegan: () -> Void = {}
    /// (page, normalized position) — `ScoreWorkspace` builds the full `StampAnnotation`/
    /// `TextBoxAnnotation` from `markup.armedStamp`/a blank note, since this view never touches
    /// `PracticeStore`.
    var onPlaceStamp: (Int, NormalizedRect) -> Bool = { _, _ in true }
    var onPlaceTextBox: (Int, NormalizedRect) -> Void = { _, _ in }
    /// §11 R8: (page, normalized position) of a tap while `markup.breakPointArmed` — `ScoreWorkspace`
    /// builds the `BreakPointTap` itself, the same division of labor as `onPlaceStamp` above.
    var onPlaceBreakPoint: (Int, NormalizedRect) -> Void = { _, _ in }
    var onEditTextBox: (TextBoxAnnotation) -> Void = { _ in }
    var onDictateTextBox: (TextBoxAnnotation) -> Void = { _ in }
    var onMoveTextBox: (TextBoxAnnotation, NormalizedRect) -> TextBoxAnnotation? = { _, _ in nil }
    var inkReadOnly = false { didSet { if inkReadOnly != oldValue { refreshNoteAccessibility() } } }
    /// Invalid saved/pending bytes stay protected across ordinary permission/appearance refreshes.
    /// Recreate this page after explicit recovery before allowing replacement strokes.
    var contentReadOnly = false
    /// §7 page tools: this page's active non-destructive crop (`PageEdit.cropRect`), or `nil` for the
    /// overwhelmingly common page no page tool has ever cropped. Every stored mark (ink, passage
    /// boxes, stamps, text boxes) is defined against the page's *original, uncropped* bounds — see
    /// `GeometryTransforms.swift` — but `bounds`/`canvas.frame` below reflect whatever PDFKit is
    /// actually showing right now (the cropped region's own, smaller size), so a mark must be remapped
    /// through `croppedForDisplay`/`uncroppedFromDisplay` at the boundary between the two. Set once by
    /// `PagedScoreView.Coordinator` when an overlay is created (a crop change always tears down and
    /// rebuilds every overlay — see `updateUIView`'s `sourceChanged` check).
    var activeCrop: NormalizedRect? { didSet { guard activeCrop != oldValue else { return }; clearNotePreview(); setNeedsLayout(); setNeedsDisplay(); refreshNoteAccessibility() } }
    private(set) var selectionPan: UIPanGestureRecognizer!
    private var origin = CGPoint.zero
    private var originalRegion: PassageRegion?
    private var drawingID = UUID()
    private var resizeCorner: Int?
    private(set) var selectionTap: UITapGestureRecognizer!
    private var selectionPreview: PassageRegion?
    private let selectionPreviewBox = CAShapeLayer()
    private let selectionPreviewHandles = CAShapeLayer()
    private var selectionGestureIsQuick: Bool?
    private var selectionGestureDraftID: UUID?
    private var selectionGestureRegions: [PassageRegion] = []
    private var requestedDisplayScale: CGFloat = 1
    private(set) var pageDisplayScale: CGFloat = 1
    var selectionHandleDiameter: CGFloat { 8 / pageDisplayScale }
    var selectionLineWidth: CGFloat { 1.25 / pageDisplayScale }
    var selectionHitRadius: CGFloat { 22 / pageDisplayScale }
    var selectionPreviewRect: CGRect? { selectionPreview?.rect(in: bounds.size) }
    private struct Appearance: Equatable {
        let mode: ScoreMarkupState.Mode
        let regions: [PassageRegion]
        let selectedRegion: UUID?
        let selectedStamp: UUID?
        let layers: Set<InkLayer>
        let boxes: Bool
        let stamp: ScoreMarkupState.StampDraft?
        let tool: AnnotationTool
        let stampKind: StampKind?
        let stampLabel: String?
    }
    private var appearance: Appearance?
    private var laidOutSize = CGSize.zero
    #if DEBUG
    private var noteGestureTrace: [String] = []
    var noteGestureDiagnostic: String {
        guard ProcessInfo.processInfo.arguments.contains("--uitesting") else { return "" }
        let notes = visibleTextBoxes.map { note in
            let shown = displayRect(for: note.region) ?? .zero
            return "source=\(note.region),window=\(convert(shown, to: nil))"
        }.joined(separator: "|")
        var chain: [String] = []
        var ancestor: UIView? = self
        while let view = ancestor {
            for recognizer in view.gestureRecognizers ?? [] {
                chain.append("\(type(of: view)).\(type(of: recognizer)):\(recognizer.state.rawValue)")
            }
            ancestor = view.superview
        }
        return "noteOverlayWindow=\(convert(bounds, to: nil));notes=[\(notes)];noteTrace=[\(noteGestureTrace.joined(separator: "|"))];recognizers=[\(chain.joined(separator: "|"))]"
    }
    private func traceNoteGesture(_ event: String, point: CGPoint, translation: CGPoint = .zero) {
        guard ProcessInfo.processInfo.arguments.contains("--uitesting") else { return }
        let normalized = CGPoint(x: point.x / max(1, bounds.width), y: point.y / max(1, bounds.height))
        noteGestureTrace.append("\(event):point=\(point),normalized=\(normalized),delta=\(translation),note=\(note(at: point) != nil),readonly=\(inkReadOnly)")
        if noteGestureTrace.count > 32 { noteGestureTrace.removeFirst(noteGestureTrace.count - 32) }
    }
    #endif

    init(page: Int, markup: ScoreMarkupState) {
        pageNumber = page; self.markup = markup
        super.init(frame: .zero)
        isOpaque = false; backgroundColor = .clear; clipsToBounds = true
        accessibilityIdentifier = "passageCanvas_page_\(page)"
        canvas.inkHistory.drawing = { [weak self] in self?.canvas.drawing ?? PKDrawing() }
        canvas.inkHistory.applyDrawing = { [weak self] in self?.restoreInkCanvas($0) }
        canvas.backgroundColor = .clear; canvas.isOpaque = false; canvas.isScrollEnabled = false
        canvas.drawingPolicy = .pencilOnly
        // PencilKit automatically adapts dark inks under dark traits. Music stays light, so
        // the drawing surface must have light traits as well as an explicitly dark tool color.
        overrideUserInterfaceStyle = .light
        canvas.overrideUserInterfaceStyle = .light
        canvas.accessibilityIdentifier = "inkCanvas_page_\(page)"
        for layerCanvas in [otherLayersCanvas, canvas] {
            layerCanvas.backgroundColor = .clear; layerCanvas.isOpaque = false
            layerCanvas.overrideUserInterfaceStyle = .light
            layerCanvas.isScrollEnabled = false
            layerCanvas.minimumZoomScale = 1; layerCanvas.maximumZoomScale = 1
            layerCanvas.panGestureRecognizer.isEnabled = false
            layerCanvas.pinchGestureRecognizer?.isEnabled = false
            layerCanvas.contentInsetAdjustmentBehavior = .never
            addSubview(layerCanvas)
        }
        otherLayersCanvas.isUserInteractionEnabled = false
        let pencilInteraction = UIPencilInteraction()
        pencilInteraction.delegate = self; addInteraction(pencilInteraction)
        selectionPan = UIPanGestureRecognizer(target: self, action: #selector(pan(_:)))
        selectionPan.maximumNumberOfTouches = 1; selectionPan.delegate = self
        selectionPan.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.direct.rawValue), NSNumber(value: UITouch.TouchType.pencil.rawValue)]
        addGestureRecognizer(selectionPan)
        selectionTap = UITapGestureRecognizer(target: self, action: #selector(tap(_:)))
        selectionTap.delegate = self; selectionTap.require(toFail: selectionPan)
        addGestureRecognizer(selectionTap)
        selectionDoubleTap = UITapGestureRecognizer(target: self, action: #selector(confirmSelection(_:)))
        selectionDoubleTap.numberOfTapsRequired = 2; selectionDoubleTap.delegate = self
        selectionDoubleTap.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.direct.rawValue), NSNumber(value: UITouch.TouchType.pencil.rawValue)]
        selectionTap.require(toFail: selectionDoubleTap)
        addGestureRecognizer(selectionDoubleTap)
        stampPan = UIPanGestureRecognizer(target: self, action: #selector(moveStamp(_:)))
        stampPan.maximumNumberOfTouches = 1; stampPan.delegate = self
        stampPan.allowedTouchTypes = selectionPan.allowedTouchTypes
        selectionTap.require(toFail: stampPan)
        addGestureRecognizer(stampPan)
        stampPencilTap = UITapGestureRecognizer(target: self, action: #selector(placeStampWithPencil(_:)))
        stampPencilTap.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.pencil.rawValue)]
        stampPencilTap.delegate = self; stampPencilTap.require(toFail: stampPan)
        addGestureRecognizer(stampPencilTap)
        notePan = UIPanGestureRecognizer(target: self, action: #selector(moveNote(_:)))
        notePan.maximumNumberOfTouches = 1; notePan.delegate = self
        notePan.allowedTouchTypes = selectionPan.allowedTouchTypes
        selectionTap.require(toFail: notePan)
        addGestureRecognizer(notePan)
        // Keep the note's entire tap sequence on its hit-tested overlay. An ancestor PDFView
        // recognizer competes with PDFKit's intervening text recognizers and can lose both taps.
        noteEditTap = UITapGestureRecognizer(target: self, action: #selector(editNoteTapped(_:)))
        noteEditTap.numberOfTapsRequired = 2; noteEditTap.delegate = self
        noteDictateTap = UITapGestureRecognizer(target: self, action: #selector(dictateNoteTapped(_:)))
        noteDictateTap.numberOfTapsRequired = 3; noteDictateTap.delegate = self
        for recognizer in [noteEditTap!, noteDictateTap!] {
            recognizer.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.direct.rawValue)]
            recognizer.require(toFail: notePan)
            selectionTap.require(toFail: recognizer)
            addGestureRecognizer(recognizer)
        }
        noteEditTap.require(toFail: noteDictateTap)
        for preview in [selectionPreviewBox, selectionPreviewHandles] {
            preview.isHidden = true; layer.addSublayer(preview)
        }
        notePreview.isHidden = true; notePreview.isOpaque = false
        notePreview.isUserInteractionEnabled = false; notePreview.accessibilityElementsHidden = true
        notePreview.contentMode = .redraw; addSubview(notePreview)
        noteHandles.isHidden = true; layer.addSublayer(noteHandles)
        configureNotePanel()
        refreshNoteAccessibility()
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    private func restoreInkCanvas(_ value: PKDrawing) {
        let previous = canvas
        let replacement = ScoreInkCanvas(replacing: previous, with: value)
        replacement.backgroundColor = .clear; replacement.isOpaque = false
        replacement.overrideUserInterfaceStyle = .light
        replacement.isScrollEnabled = false
        replacement.minimumZoomScale = 1; replacement.maximumZoomScale = 1
        replacement.panGestureRecognizer.isEnabled = false
        replacement.pinchGestureRecognizer?.isEnabled = false
        replacement.contentInsetAdjustmentBehavior = .never
        replacement.accessibilityIdentifier = previous.accessibilityIdentifier
        replacement.drawingPolicy = previous.drawingPolicy
        replacement.tool = previous.tool
        replacement.contentScaleFactor = previous.contentScaleFactor
        replacement.delegate = previous.delegate
        replacement.onDetached = previous.onDetached
        // Retire before removal: this is a native surface replacement, not a page detach.
        // Its old callbacks and window removal must not checkpoint/cancel the shared history.
        previous.retire()
        canvas = replacement
        insertSubview(replacement, aboveSubview: otherLayersCanvas)
        previous.removeFromSuperview()
        layoutInkCanvases()
        refresh()
        refreshNoteAccessibility()
        onCanvasReplaced()
    }
    override func didMoveToWindow() {
        super.didMoveToWindow()
        if window == nil { clearNotePreview() }
    }
    override func layoutSubviews() {
        super.layoutSubviews()
        // Ink stroke points are canvas-local and have no normalized-rect representation to remap the
        // way a stored mark's rect can — the canvas itself must stay sized to the *original,
        // uncropped* page always (so a stroke's raw points keep meaning the same thing regardless of
        // crop state) and instead be positioned as an oversized, offset view whose crop-window portion
        // exactly fills this (possibly smaller, cropped) overlay — `clipsToBounds` above hides the
        // rest. With no active crop this is exactly `bounds`, unchanged from before.
        let canvasFrame: CGRect
        if let activeCrop, activeCrop.width > 0, activeCrop.height > 0 {
            let full = CGSize(width: bounds.width / activeCrop.width, height: bounds.height / activeCrop.height)
            canvasFrame = CGRect(x: -activeCrop.x * full.width, y: -activeCrop.y * full.height, width: full.width, height: full.height)
        } else { canvasFrame = bounds }
        if sourceCanvasFrame != canvasFrame {
            sourceCanvasFrame = canvasFrame
            layoutInkCanvases()
            assignToolIfNeeded()
            onCanvasLayout()
        }
        updateInkResolution(displayScale: requestedDisplayScale)
        updateSelectionPreviewLayers()
        updateNotePreview(); updateNoteHandles()
        layoutNotePanel()
        if laidOutSize != bounds.size { laidOutSize = bounds.size; setNeedsDisplay(); refreshNoteAccessibility() }
    }
    /// PDFKit is the sole navigation owner. A second zooming scroll view inside its overlay
    /// allowed ink and score to move independently on iOS 18. Keep source geometry fixed and
    /// bound flat backing resolution, without changing PencilKit's zoom/content offset.
    func updateInkResolution(displayScale: CGFloat) {
        requestedDisplayScale = displayScale.isFinite && displayScale > 0 ? displayScale : 1
        var actualScale = requestedDisplayScale
        if let window {
            let origin = convert(CGPoint.zero, to: window)
            let x = convert(CGPoint(x: 1, y: 0), to: window)
            let y = convert(CGPoint(x: 0, y: 1), to: window)
            let measured = min(hypot(x.x - origin.x, x.y - origin.y), hypot(y.x - origin.x, y.y - origin.y))
            if measured.isFinite && measured > 0 { actualScale = measured }
        }
        let previousPageScale = pageDisplayScale
        pageDisplayScale = actualScale
        let desired = (window?.screen.scale ?? UIScreen.main.scale) * actualScale
        func boundedScale(for size: CGSize) -> CGFloat {
            min(desired, sqrt(4_000_000 / max(1, size.width * size.height)))
        }
        // Imported PDF coordinates may be thousands of points wide. A floor of 1 allocates
        // tens of millions of pixels and makes 8-source-point handles almost invisible.
        let canvasScale = boundedScale(for: sourceCanvasFrame.size)
        let overlayScale = boundedScale(for: bounds.size)
        let needsRedraw = pageDisplayScale != previousPageScale || contentScaleFactor != overlayScale
        renderedInkScale = canvasScale
        if contentScaleFactor != overlayScale { contentScaleFactor = overlayScale }
        for layerCanvas in [otherLayersCanvas, canvas] {
            let localScale = canvasScale * layerCanvas.sourceCoordinateScale
            if layerCanvas.contentScaleFactor != localScale { layerCanvas.contentScaleFactor = localScale }
        }
        if needsRedraw { updateSelectionPreviewLayers(); updateNotePreview(); updateNoteHandles(); layoutNotePanel(); setNeedsDisplay() }
    }
    private func layoutInkCanvases() {
        guard sourceCanvasFrame.width > 0, sourceCanvasFrame.height > 0 else { return }
        for layerCanvas in [otherLayersCanvas, canvas] {
            layerCanvas.configureSourcePageWidth(sourceCanvasFrame.width)
            let scale = layerCanvas.sourceCoordinateScale
            let size = CGSize(width: sourceCanvasFrame.width / scale, height: sourceCanvasFrame.height / scale)
            let transform = CGAffineTransform(scaleX: scale, y: scale)
            if layerCanvas.transform != transform { layerCanvas.transform = transform }
            if layerCanvas.bounds.size != size { layerCanvas.bounds = CGRect(origin: .zero, size: size) }
            let center = CGPoint(x: sourceCanvasFrame.midX, y: sourceCanvasFrame.midY)
            if layerCanvas.center != center { layerCanvas.center = center }
            if layerCanvas.contentSize != size { layerCanvas.contentSize = size }
        }
    }
    func assignToolIfNeeded() {
        let width = sourceCanvasFrame.width
        guard width > 0, markup.tool != lastAssignedTool || width != lastAssignedToolPageWidth,
              let tool = markup.tool.pkTool(pageWidth: width / canvas.sourceCoordinateScale) else { return }
        canvas.tool = tool
        lastAssignedTool = markup.tool; lastAssignedToolPageWidth = width
    }

    func pencilInteractionDidTap(_ interaction: UIPencilInteraction) {
        guard !inkReadOnly, !contentReadOnly, markup.mode != .selecting else { return }
        switch UIPencilInteraction.preferredTapAction {
        case .switchEraser:
            if markup.tool.kind == .eraser { markup.tool.kind = previousPencilTool }
            else { previousPencilTool = markup.tool.kind.isInkingTool ? markup.tool.kind : .pen; markup.tool.kind = .eraser }
        case .switchPrevious:
            let previous = previousPencilTool; previousPencilTool = markup.tool.kind; markup.tool.kind = previous
        default: break
        }
    }
    /// A stored mark's on-screen rect, remapped into the current (possibly cropped) display —
    /// `nil` when an active crop leaves nothing of it visible. Every draw/hit-test call site below
    /// goes through this rather than a mark's own `rect(in: bounds.size)` directly.
    private func displayRect(for region: PassageRegion) -> CGRect? {
        guard let activeCrop else { return region.rect(in: bounds.size) }
        return region.croppedForDisplay(within: activeCrop)?.rect(in: bounds.size)
    }
    private func displayRect(for normalized: NormalizedRect) -> CGRect? {
        guard let activeCrop else { return normalized.rect(in: bounds.size) }
        return normalized.croppedForDisplay(within: activeCrop)?.rect(in: bounds.size)
    }
    /// Keep the hidden part of a cropped note: clipping may hide text/handles, but must not
    /// reflow its text or move the opposite resize anchor into the crop boundary.
    private func fullDisplayRect(for normalized: NormalizedRect) -> CGRect {
        let crop = activeCrop ?? NormalizedRect(x: 0, y: 0, width: 1, height: 1)
        return CGRect(x: (normalized.x - crop.x) / crop.width * bounds.width,
                      y: (normalized.y - crop.y) / crop.height * bounds.height,
                      width: normalized.width / crop.width * bounds.width,
                      height: normalized.height / crop.height * bounds.height)
    }
    /// The inverse: a freshly drawn/placed mark, normalized against this overlay's *current* (display)
    /// bounds, remapped back to the original-page basis every stored mark uses — the write-side
    /// counterpart to `displayRect(for:)` above.
    private func storageRegion(fromDisplay region: PassageRegion) -> PassageRegion {
        activeCrop.map { region.uncroppedFromDisplay(within: $0) } ?? region
    }
    private func storageRect(fromDisplay normalized: NormalizedRect) -> NormalizedRect {
        activeCrop.map { normalized.uncroppedFromDisplay(within: $0) } ?? normalized
    }

    func refresh() {
        if selectionGestureIsQuick != nil && !selectionGestureIsCurrent { clearSelectionPreview() }
        if movingNote != nil && !noteGestureIsCurrent { clearNotePreview() }
        let policy: PKCanvasViewDrawingPolicy = markup.mode == .writing && markup.fingerDrawing ? .anyInput : .pencilOnly
        if canvas.drawingPolicy != policy { canvas.drawingPolicy = policy }
        // Input routing owns read-only and placement state. Never disable the live canvas or
        // change PencilKit's recognizer delegate while changing tools.
        if markup.stampDraft?.page == pageNumber {
            markup.confirmStamp = { [weak self] in self?.commitStampDraft() }
        }
        if inkReadOnly || !visibleTextBoxes.contains(where: { $0.id == expandedNoteID }) { expandedNoteID = nil }
        if !notesEditable || !visibleTextBoxes.contains(where: { $0.id == selectedNoteID && $0.layer == markup.activeLayer }) { selectedNoteID = nil }
        updateNoteHandles()
        layoutNotePanel()
        if accessibleNoteLayers != markup.visibleLayers || accessibleNoteActiveLayer != markup.activeLayer {
            refreshNoteAccessibility()
        }
        let current = Appearance(mode: markup.mode, regions: markup.mode == .selecting ? markup.regions : [],
                                 selectedRegion: markup.selectedRegionID, selectedStamp: markup.selectedStampID,
                                 layers: markup.visibleLayers, boxes: markup.showPassageBoxes, stamp: markup.stampDraft,
                                 tool: markup.tool, stampKind: markup.armedStamp?.kind, stampLabel: markup.armedStamp?.label)
        if current != appearance { appearance = current; setNeedsDisplay() }
        accessibilityValue = "\(visibleRegions.count) boxes on page \(pageNumber)"
        canvas.accessibilityValue = "\(canvas.drawing.strokes.count) ink strokes"
    }
    private var placementToolArmed: Bool { markup.mode == .writing && (markup.tool.kind == .stamp || markup.tool.kind == .text) }
    private var visibleRegions: [PassageRegion] {
        guard markup.mode == .selecting || markup.showPassageBoxes else { return [] }
        return (markup.mode == .selecting ? markup.regions : displayedRegions).filter { $0.page == pageNumber }
    }
    private var visibleStamps: [StampAnnotation] { displayedStamps.filter { $0.page == pageNumber && markup.visibleLayers.contains($0.layer) } }
    private var visibleTextBoxes: [TextBoxAnnotation] { displayedTextBoxes.filter { $0.page == pageNumber && markup.visibleLayers.contains($0.layer) } }
    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        guard bounds.contains(point) else { return nil }
        #if DEBUG
        if event?.type == .touches, note(at: point) != nil { traceNoteGesture("hit", point: point) }
        #endif
        // Performance mode routes every score touch to page turning / hold-to-exit. A note
        // cannot intercept that escape gesture or remain editable behind the performance lock.
        guard !inkReadOnly else { return nil }
        let pencil = event?.allTouches?.contains { $0.type == .pencil } == true
        if !pencil, !notePanel.isHidden, notePanel.frame.contains(point) {
            return notePanel.hitTest(convert(point, to: notePanel), with: event)
        }
        if !pencil, selectedNoteCorner(at: point) != nil { return self }
        if markup.mode == .selecting || markup.quickBoxArmed || markup.breakPointArmed { return self }
        if placementToolArmed { return self }
        if note(at: point) != nil, event?.allTouches?.contains(where: { $0.type == .pencil }) != true { return self }
        // Selected passage taps belong to our ancestor rename/dictate recognizers, rather
        // than PDFKit's text selection recognizers. Keep Pencil and unresolved hits on ink.
        if !pencil, shouldClaimSelectedPassage(at: point, touchType: event?.allTouches?.first?.type) { return self }
        if let touches = event?.allTouches, touches.filter({ $0.type == .direct }).count >= 2 { return self }
        guard !inkReadOnly, !contentReadOnly else { return nil }
        let touches = event?.allTouches
        // UIKit can hit-test before it populates allTouches. Retain the canvas route on that
        // first pass; PencilKit's pencilOnly recognizer still rejects finger ink.
        // The PDF's ancestor finger pan and pinch recognizers continue to navigate the page.
        let unresolvedWritingTouch = (markup.mode == .writing || markup.mode == .reading) && (touches?.isEmpty ?? true)
        if pencil || unresolvedWritingTouch || (markup.mode == .writing && markup.fingerDrawing) {
            return canvas.hitTest(convert(point, to: canvas), with: event)
        }
        return nil
    }
    override func draw(_ rect: CGRect) {
        guard let context = UIGraphicsGetCurrentContext() else { return }
        for region in visibleRegions {
            if selectionPreview != nil && originalRegion?.id == region.id { continue }
            guard let box = displayRect(for: region) else { continue }
            let selected = markup.mode == .selecting && markup.selectedRegionID == region.id
            let emphasized = emphasizedIDs.contains(region.id) || markup.mode == .selecting
            let practiced = practicedIDs.contains(region.id) && !emphasized
            let recolor = regionColors[region.id].flatMap(AnnotationColor.init(rawValue:))
            context.setFillColor(ScorePassageBoxStyle.fillColor(practiced: practiced, emphasized: emphasized, recolor: recolor).cgColor)
            context.fill(box)
            context.setStrokeColor(ScorePassageBoxStyle.strokeColor(practiced: practiced, selected: selected, recolor: recolor).cgColor)
            context.setLineWidth((selected ? 1.25 : 0.6) / pageDisplayScale); context.stroke(box)
            if selected {
                for corner in corners(box) {
                    context.setFillColor(UIColor.white.cgColor)
                    let diameter = selectionHandleDiameter
                    let handle = CGRect(x: corner.x - diameter / 2, y: corner.y - diameter / 2, width: diameter, height: diameter)
                    context.fillEllipse(in: handle)
                    context.setStrokeColor(ScorePassageBoxStyle.handleRingColor().cgColor)
                    context.strokeEllipse(in: handle)
                }
            }
        }
        for textBox in visibleTextBoxes {
            if movingNote?.id == textBox.id { continue }
            guard displayRect(for: textBox.region) != nil else { continue }
            TextAnnotationRenderer.draw(note: textBox, in: fullDisplayRect(for: textBox.region),
                                        pageWidth: fullPageWidth, context: context)
        }
        drawStampGlyphs(context: context)
        drawStampPreview(context: context)
    }
    /// SwiftUI (`PraeludeStamp`, Bravura glyphs; a text box's own note) cannot draw into a raw
    /// `CGContext`, so each is rendered off-screen once per `draw(_:)` pass and composited — the same
    /// approach `ScoreExport` already uses to put PencilKit ink into a `CGContext`. The translate +
    /// y-flip undoes the flip UIKit already applied to this context, which otherwise draws a
    /// `CGImage` upside down (a well-known `CGContext.draw(_:in:)`-inside-`UIView.draw(_:)` gotcha).
    private func drawSwiftUIContent<V: View>(_ view: V, in rect: CGRect, context: CGContext, cacheKey: String? = nil) {
        guard rect.width.isFinite, rect.height.isFinite, rect.width > 0, rect.height > 0 else { return }
        let scale = min(min((window?.screen.scale ?? UIScreen.main.scale) * renderedInkScale, sqrt(1_000_000 / (rect.width * rect.height))),
                        2048 / max(rect.width, rect.height))
        let key = cacheKey.map { "\($0):\(rect.width):\(rect.height):\(scale)" as NSString }
        let cgImage: CGImage
        if let key, let cached = glyphCache.object(forKey: key)?.cgImage { cgImage = cached }
        else {
            let renderer = ImageRenderer(content: view.frame(width: rect.width, height: rect.height).environment(\.colorScheme, .light))
            renderer.scale = scale
            guard let rendered = renderer.cgImage else { return }
            cgImage = rendered
            if let key {
                glyphCache.setObject(UIImage(cgImage: rendered), forKey: key, cost: rendered.bytesPerRow * rendered.height)
            }
        }
        context.saveGState()
        context.translateBy(x: rect.minX, y: rect.maxY); context.scaleBy(x: 1, y: -1)
        context.draw(cgImage, in: CGRect(origin: .zero, size: rect.size))
        context.restoreGState()
    }
    private func drawStampGlyphs(context: CGContext) {
        for stamp in visibleStamps {
            guard let box = displayRect(for: stamp.position), box.width > 0, box.height > 0 else { continue }
            if markup.selectedStampID == stamp.id {
                context.setFillColor(UIColor(PraeludeColor.scoreInk).withAlphaComponent(0.1).cgColor)
                context.fillEllipse(in: box.insetBy(dx: -4, dy: -4))
            }
            drawSwiftUIContent(PraeludeStamp(kind: stamp.kind, label: stamp.label, size: box.width), in: box, context: context, cacheKey: "\(stamp.kind.rawValue):\(stamp.label ?? "")")
        }
    }
    private func corners(_ rect: CGRect) -> [CGPoint] {
        [CGPoint(x: rect.minX, y: rect.minY), CGPoint(x: rect.maxX, y: rect.minY),
         CGPoint(x: rect.minX, y: rect.maxY), CGPoint(x: rect.maxX, y: rect.maxY)]
    }
    /// The topmost saved passage region whose *displayed* (crop-remapped) rect contains `point` (in
    /// this overlay's own coordinate space), if any. Mirrors `handleTap`'s own region-selection hit
    /// test; exposed for `PagedScoreView.Coordinator`'s long-press gesture (§8: long-press a passage
    /// outline on the score for its quick-action menu), which lives outside this view's own gesture
    /// recognizers and outside `.selecting` mode (`visibleRegions` reads `displayedRegions` — the
    /// saved passages — for any other mode, exactly the set a long-press while reading should hit).
    func passageRegion(at point: CGPoint) -> UUID? {
        visibleRegions.reversed().first { displayRect(for: $0)?.contains(point) ?? false }?.id
    }
    func shouldClaimSelectedPassage(at point: CGPoint, touchType: UITouch.TouchType?) -> Bool {
        guard touchType == .direct, bounds.contains(point), markup.mode == .reading,
              !inkReadOnly, !contentReadOnly, !markup.quickBoxArmed, !markup.breakPointArmed,
              note(at: point) == nil, let region = passageRegion(at: point) else { return false }
        return emphasizedIDs.contains(region)
    }
    @objc private func tap(_ recognizer: UITapGestureRecognizer) { handleTap(at: recognizer.location(in: self)) }
    /// Point-based so tests can drive it directly without a live touch sequence (`UIGestureRecognizer.
    /// location(in:)` has no public way to fake a location outside real touch tracking).
    func handleTap(at point: CGPoint) {
        if markup.breakPointArmed {
            guard let position = NormalizedRect.centered(at: point, width: 0.05, height: 0.05, in: bounds.size) else { return }
            onPlaceBreakPoint(pageNumber, storageRect(fromDisplay: position))
            return
        }
        if markup.mode == .writing, markup.tool.kind == .stamp {
            handleStampTap(at: point); return
        }
        if markup.mode != .selecting, let note = note(at: point), !(markup.mode == .writing && markup.tool.kind == .text) {
            selectedNoteID = note.layer == markup.activeLayer ? note.id : nil
            expandedNoteID = expandedNoteID == note.id ? nil : note.id
            updateNoteHandles(); layoutNotePanel(); return
        }
        if markup.mode == .writing, markup.tool.kind == .text {
            handleTextTap(at: point); return
        }
        markup.selectedRegionID = visibleRegions.reversed().first { displayRect(for: $0)?.contains(point) ?? false }?.id
        selectedNoteID = nil; expandedNoteID = nil; updateNoteHandles(); layoutNotePanel()
        setNeedsDisplay()
    }
    private func handleStampTap(at point: CGPoint) {
        // A tap on an existing stamp selects it (for a "Remove stamp" affordance) instead of placing
        // a new one, whether or not the stamp tool still has a kind armed. Only an active-layer
        // stamp can be selected — matching the "only the active layer is ever editable" rule ink
        // already follows.
        if let existing = visibleStamps.reversed().first(where: { displayRect(for: $0.position)?.insetBy(dx: -6, dy: -6).contains(point) ?? false }) {
            markup.selectedStampID = (existing.layer == markup.activeLayer && markup.selectedStampID != existing.id) ? existing.id : nil
            markup.stampDraft = nil
            setNeedsDisplay(); return
        }
        previewStamp(at: point)
    }
    private func handleTextTap(at point: CGPoint) {
        if let existing = visibleTextBoxes.reversed().first(where: { displayRect(for: $0.region)?.contains(point) ?? false }) {
            if existing.layer == markup.activeLayer { onEditTextBox(existing) }
            return
        }
        guard !inkReadOnly, bounds.width > 0, bounds.height > 0 else { return }
        let width = min(1, 240 / pageDisplayScale / bounds.width)
        let height = min(1, 100 / pageDisplayScale / bounds.height)
        guard let region = NormalizedRect.centered(at: point, width: width, height: height, in: bounds.size) else { return }
        onPlaceTextBox(pageNumber, storageRect(fromDisplay: region))
    }
    @objc private func confirmSelection(_ recognizer: UITapGestureRecognizer) {
        guard recognizer.state == .ended, markup.mode == .selecting, !markup.regions.isEmpty else { return }
        markup.onConfirmSelection()
    }
    func editableNote(at point: CGPoint) -> TextBoxAnnotation? {
        guard !inkReadOnly, markup.mode != .selecting, !markup.quickBoxArmed,
              !markup.breakPointArmed, let note = note(at: point), note.layer == markup.activeLayer else { return nil }
        return note
    }
    @objc private func editNoteTapped(_ recognizer: UITapGestureRecognizer) {
        guard recognizer.state == .ended else { return }
        handleNoteQuickTap(at: recognizer.location(in: self), dictation: false)
    }
    @objc private func dictateNoteTapped(_ recognizer: UITapGestureRecognizer) {
        guard recognizer.state == .ended else { return }
        handleNoteQuickTap(at: recognizer.location(in: self), dictation: true)
    }
    func handleNoteQuickTap(at point: CGPoint, dictation: Bool) {
        #if DEBUG
        traceNoteGesture("quickTap dictation=\(dictation)", point: point)
        #endif
        guard let note = editableNote(at: point) else { return }
        expandedNoteID = nil; layoutNotePanel()
        if dictation { onDictateTextBox(note) } else { onEditTextBox(note) }
    }
    @objc private func moveNote(_ recognizer: UIPanGestureRecognizer) {
        #if DEBUG
        if recognizer.state != .changed {
            traceNoteGesture("panState\(recognizer.state.rawValue)", point: recognizer.location(in: self), translation: recognizer.translation(in: self))
        }
        #endif
        handleNotePan(state: recognizer.state, location: recognizer.location(in: self))
    }
    /// Capture the real touch-down point. UIKit can report zero pan translation at recognition,
    /// even after the finger has moved beyond the chip, so location-minus-translation is too late.
    @discardableResult func captureNotePanStart(at point: CGPoint) -> Bool {
        notePanTouchStart = nil; notePanTarget = nil; noteResizeCorner = nil
        guard let note = editableNote(at: point) else { return false }
        notePanTouchStart = point; notePanTarget = note
        noteResizeCorner = selectedNoteCorner(at: point)?.corner
        noteGestureMode = markup.mode; noteGestureCrop = activeCrop
        return true
    }
    func movableNoteAtPanStart() -> TextBoxAnnotation? {
        guard notePanTouchStart != nil, let note = notePanTarget, noteGestureIsCurrent else { return nil }
        return note
    }
    private var notesEditable: Bool { !inkReadOnly && markup.mode != .selecting && !markup.quickBoxArmed && !markup.breakPointArmed }
    private var noteGestureIsCurrent: Bool {
        guard notesEditable, noteGestureMode == markup.mode, noteGestureCrop == activeCrop,
              let note = notePanTarget, note.layer == markup.activeLayer else { return false }
        return visibleTextBoxes.contains(note)
    }
    func handleNotePan(state: UIGestureRecognizer.State, location: CGPoint) {
        switch state {
        case .began:
            guard let note = movableNoteAtPanStart() else { clearNotePreview(); return }
            movingNote = note; selectedNoteID = note.id
            movedNotePosition = notePosition(at: location)
            expandedNoteID = nil; layoutNotePanel()
            updateNotePreview(); updateNoteHandles(); setNeedsDisplay()
        case .changed, .ended:
            guard let note = movingNote, noteGestureIsCurrent else { clearNotePreview(); return }
            movedNotePosition = notePosition(at: location)
            updateNotePreview(); updateNoteHandles()
            if state == .ended {
                if let position = movedNotePosition, position != note.region { _ = commitNoteMove(note, to: position) }
                clearNotePreview()
            }
        case .cancelled, .failed:
            clearNotePreview()
        default: break
        }
    }
    private var fullPageWidth: CGFloat { bounds.width / (activeCrop?.width ?? 1) }
    private func notePosition(at location: CGPoint) -> NormalizedRect? {
        guard let note = movingNote, let start = notePanTouchStart else { return nil }
        let delta = CGSize(width: location.x - start.x, height: location.y - start.y)
        guard let corner = noteResizeCorner else { return translatedNotePosition(note, by: delta) }
        let crop = activeCrop ?? NormalizedRect(x: 0, y: 0, width: 1, height: 1)
        guard bounds.width > 0, bounds.height > 0, delta.width.isFinite, delta.height.isFinite else { return nil }
        let dx = delta.width / bounds.width * crop.width, dy = delta.height / bounds.height * crop.height
        let region = note.region
        // Resize the original corner by the full touch delta, so a finger inside the generous
        // target does not jump the box. Minimums cannot enlarge an old smaller box by themselves.
        let minimumWidth = min(region.width, 80 / pageDisplayScale / bounds.width * crop.width)
        let minimumHeight = min(region.height, 44 / pageDisplayScale / bounds.height * crop.height)
        var left = region.x, right = region.x + region.width
        var top = region.y, bottom = region.y + region.height
        if corner == 0 || corner == 2 { left = min(max(0, left + dx), right - minimumWidth) }
        else { right = max(min(1, right + dx), left + minimumWidth) }
        if corner == 0 || corner == 1 { top = min(max(0, top + dy), bottom - minimumHeight) }
        else { bottom = max(min(1, bottom + dy), top + minimumHeight) }
        return NormalizedRect(x: left, y: top, width: right - left, height: bottom - top)
    }
    private func clearNotePreview() {
        let wasMoving = movingNote != nil
        movingNote = nil; movedNotePosition = nil; notePanTouchStart = nil; notePanTarget = nil
        noteResizeCorner = nil; noteGestureMode = nil; noteGestureCrop = nil
        notePreview.isHidden = true; notePreview.note = nil; updateNoteHandles()
        if wasMoving { setNeedsDisplay() }
    }
    private func updateNotePreview() {
        guard let note = movingNote, let rect = notePreviewRect else { notePreview.isHidden = true; return }
        let changed = notePreview.note != note || notePreview.bounds.size != rect.size || notePreview.pageWidth != fullPageWidth
        notePreview.note = note; notePreview.pageWidth = fullPageWidth
        notePreview.frame = rect
        notePreview.contentScaleFactor = min((window?.screen.scale ?? UIScreen.main.scale) * pageDisplayScale,
                                            sqrt(1_000_000 / max(1, rect.width * rect.height)))
        notePreview.isHidden = false
        if changed { notePreview.setNeedsDisplay() }
    }
    private func selectedNoteCorner(at point: CGPoint) -> (note: TextBoxAnnotation, corner: Int)? {
        guard notesEditable, let note = visibleTextBoxes.first(where: { $0.id == selectedNoteID && $0.layer == markup.activeLayer }) else { return nil }
        let candidates = corners(fullDisplayRect(for: note.region)).enumerated().filter { bounds.contains($0.element) }
        guard let closest = candidates.min(by: { hypot(point.x - $0.element.x, point.y - $0.element.y) < hypot(point.x - $1.element.x, point.y - $1.element.y) }),
              hypot(point.x - closest.element.x, point.y - closest.element.y) <= selectionHitRadius else { return nil }
        return (note, closest.offset)
    }
    private func updateNoteHandles() {
        CATransaction.begin(); CATransaction.setDisableActions(true); defer { CATransaction.commit() }
        let handles = noteHandleRects
        guard !handles.isEmpty else { noteHandles.isHidden = true; return }
        let path = UIBezierPath()
        for handle in handles { path.append(UIBezierPath(ovalIn: handle)) }
        noteHandles.path = path.cgPath; noteHandles.fillColor = UIColor.white.cgColor
        noteHandles.strokeColor = ScorePassageBoxStyle.handleRingColor().cgColor
        noteHandles.lineWidth = 1 / pageDisplayScale; noteHandles.isHidden = false
    }
    /// A crop clips the note's visible rectangle, but moving that visible portion must preserve
    /// the full source-page note. Translate only its origin; never round-trip the clipped size.
    func translatedNotePosition(_ note: TextBoxAnnotation, by translation: CGSize) -> NormalizedRect? {
        guard note.region.isValid, bounds.width.isFinite, bounds.height.isFinite,
              bounds.width > 0, bounds.height > 0,
              translation.width.isFinite, translation.height.isFinite else { return nil }
        let crop = activeCrop ?? NormalizedRect(x: 0, y: 0, width: 1, height: 1)
        let region = note.region
        return NormalizedRect(
            x: min(max(0, region.x + translation.width / bounds.width * crop.width), 1 - region.width),
            y: min(max(0, region.y + translation.height / bounds.height * crop.height), 1 - region.height),
            width: region.width, height: region.height)
    }
    /// The durable callback fires once on release. A failed save immediately displays the original.
    @discardableResult func commitNoteMove(_ note: TextBoxAnnotation, to position: NormalizedRect) -> Bool {
        guard notesEditable, note.layer == markup.activeLayer, visibleTextBoxes.contains(note),
              position.isValid, let saved = onMoveTextBox(note, position) else { return false }
        // The store stamps its own updatedAt. Keep its complete receipt immediately so a
        // second gesture can compare against the durable row before SwiftUI refreshes us.
        if let index = displayedTextBoxes.firstIndex(where: { $0.id == note.id }) { displayedTextBoxes[index] = saved }
        return true
    }
    private var stampGestureUsesPencil = false
    @objc private func placeStampWithPencil(_ recognizer: UITapGestureRecognizer) {
        guard recognizer.state == .ended else { return }
        handleStampPencilLift(at: recognizer.location(in: self))
    }
    func handleStampPencilLift(at point: CGPoint) {
        guard !inkReadOnly, !contentReadOnly, markup.mode == .writing, markup.tool.kind == .stamp else { return }
        handleStampTap(at: point)
        commitStampDraft()
    }
    @objc private func moveStamp(_ recognizer: UIPanGestureRecognizer) {
        switch recognizer.state {
        case .began, .changed: previewStamp(at: recognizer.location(in: self))
        case .ended:
            previewStamp(at: recognizer.location(in: self))
            if stampGestureUsesPencil { commitStampDraft() }
            stampGestureUsesPencil = false
        case .cancelled: stampGestureUsesPencil = false; markup.stampDraft = nil; setNeedsDisplay()
        default: break
        }
    }
    func previewStamp(at point: CGPoint) {
        guard markup.armedStamp != nil, bounds.height > 0 else { return }
        let height = min(0.25, markup.stampSize * bounds.width / bounds.height)
        guard let position = NormalizedRect.centered(at: point, width: markup.stampSize, height: height, in: bounds.size) else { return }
        markup.selectedStampID = nil
        markup.stampDraft = ScoreMarkupState.StampDraft(page: pageNumber, position: storageRect(fromDisplay: position))
        markup.confirmStamp = { [weak self] in self?.commitStampDraft() }
        markup.resizeStampPreview = { [weak self] in self?.resizeStampDraft(); self?.setNeedsDisplay() }
        if magnifierPage == nil || magnifierSize != bounds.size {
            magnifierSize = bounds.size
            if magnifierTask == nil {
                let size = bounds.size
                let target = CGSize(width: min(1200, size.width * 2), height: min(1200, size.height * 2))
                magnifierTask = Task { @MainActor [weak self] in
                    guard let self else { return }
                    let image = await pageImageForMagnifier(target)
                    magnifierTask = nil
                    guard !Task.isCancelled, bounds.size == size, markup.stampDraft?.page == pageNumber else { return }
                    magnifierPage = image; setNeedsDisplay()
                }
            }
        }
        setNeedsDisplay()
    }
    private func resizeStampDraft() {
        guard let draft = markup.stampDraft, draft.page == pageNumber,
              let rect = displayRect(for: draft.position), bounds.height > 0 else { return }
        let height = min(0.25, markup.stampSize * bounds.width / bounds.height)
        guard let updated = NormalizedRect.centered(at: CGPoint(x: rect.midX, y: rect.midY), width: markup.stampSize, height: height, in: bounds.size) else { return }
        let stored = storageRect(fromDisplay: updated)
        if stored != draft.position { markup.stampDraft?.position = stored }
    }
    func commitStampDraft() {
        guard let draft = markup.stampDraft, draft.page == pageNumber,
              markup.mode == .writing, markup.tool.kind == .stamp, markup.armedStamp != nil else { return }
        guard onPlaceStamp(pageNumber, draft.position) else { return }
        markup.stampDraft = nil; magnifierPage = nil; magnifierTask?.cancel(); magnifierTask = nil; setNeedsDisplay()
    }
    private func drawStampPreview(context: CGContext) {
        guard let draft = markup.stampDraft, draft.page == pageNumber, markup.mode == .writing,
              markup.tool.kind == .stamp, let armed = markup.armedStamp,
              let box = displayRect(for: draft.position) else { return }
        context.setStrokeColor(UIColor.systemBlue.cgColor); context.setLineWidth(1)
        context.setLineDash(phase: 0, lengths: [3, 3]); context.stroke(box.insetBy(dx: -3, dy: -3))
        context.setLineDash(phase: 0, lengths: [])
        drawSwiftUIContent(PraeludeStamp(kind: armed.kind, label: armed.label, size: box.width), in: box, context: context, cacheKey: "\(armed.kind.rawValue):\(armed.label ?? "")")
        // A floating enlarged view of the original notation keeps the point under a finger or
        // Pencil visible while dragging. The thumbnail is captured once, never by snapshotting
        // this overlay recursively during drawing.
        let side = min(120, bounds.width * 0.3)
        let lens = CGRect(x: min(max(4, box.midX - side / 2), bounds.width - side - 4),
                          y: max(4, box.minY - side - 20), width: side, height: side)
        context.saveGState()
        let path = UIBezierPath(roundedRect: lens, cornerRadius: 12)
        path.addClip(); UIColor.white.setFill(); path.fill()
        if let magnifierPage {
            magnifierPage.draw(in: CGRect(x: lens.midX - box.midX * 2, y: lens.midY - box.midY * 2,
                                         width: bounds.width * 2, height: bounds.height * 2))
        }
        let enlarged = CGRect(x: lens.midX - box.width, y: lens.midY - box.height, width: box.width * 2, height: box.height * 2)
        drawSwiftUIContent(PraeludeStamp(kind: armed.kind, label: armed.label, size: enlarged.width), in: enlarged, context: context, cacheKey: "\(armed.kind.rawValue):\(armed.label ?? "")")
        context.restoreGState()
        UIColor.systemBlue.setStroke(); path.lineWidth = 1.5; path.stroke()
    }
    func containsNote(at point: CGPoint) -> Bool {
        !inkReadOnly && (note(at: point) != nil || (!notePanel.isHidden && notePanel.frame.contains(point)))
    }
    func note(at point: CGPoint) -> TextBoxAnnotation? {
        if let corner = selectedNoteCorner(at: point) { return corner.note }
        return visibleTextBoxes.reversed().first { displayRect(for: $0.region)?.insetBy(dx: -4 / pageDisplayScale, dy: -4 / pageDisplayScale).contains(point) ?? false }
    }
    private func refreshNoteAccessibility() {
        accessibleNoteLayers = markup.visibleLayers; accessibleNoteActiveLayer = markup.activeLayer
        let notes = inkReadOnly ? [] : visibleTextBoxes
        let savedIDs = Set(displayedTextBoxes.filter { $0.page == pageNumber }.map(\.id))
        accessibleNotes = accessibleNotes.filter { savedIDs.contains($0.key) }
        var elements: [Any] = [otherLayersCanvas, canvas]
        for note in notes {
            guard let frame = displayRect(for: note.region), !frame.isEmpty else { continue }
            let element = accessibleNotes[note.id] ?? ScoreNoteAccessibilityElement(noteID: note.id, overlay: self)
            accessibleNotes[note.id] = element
            element.accessibilityLabel = note.text
            element.accessibilityHint = note.layer == markup.activeLayer ? "Opens note text and editing controls." : "Opens note text."
            // UIKit converts this page-local frame through PDFKit's live zoom transform.
            element.accessibilityFrameInContainerSpace = frame
            elements.append(element)
        }
        // Preserve PencilKit and expanded-note controls as accessibility containers. Rebuild
        // only for note/geometry/layer/permission changes, never for individual ink samples.
        elements.append(notePanel)
        accessibilityElements = elements
    }
    fileprivate func activateAccessibleNote(_ id: UUID) -> Bool {
        guard !inkReadOnly, markup.mode != .selecting, !markup.quickBoxArmed, !markup.breakPointArmed,
              let note = visibleTextBoxes.first(where: { $0.id == id }),
              let frame = displayRect(for: note.region), !frame.isEmpty else { return false }
        expandedNoteID = id; selectedNoteID = note.layer == markup.activeLayer ? id : nil
        updateNoteHandles(); layoutNotePanel()
        return true
    }
    private func configureNotePanel() {
        notePanel.backgroundColor = .systemBackground
        notePanel.layer.cornerRadius = 8; notePanel.layer.borderWidth = 0.5
        notePanel.layer.borderColor = UIColor.separator.cgColor
        notePanel.isHidden = true; notePanel.accessibilityIdentifier = "expandedScoreNote"
        noteLabel.font = .systemFont(ofSize: 15); noteLabel.numberOfLines = 0; noteLabel.textColor = .label
        noteEdit.setTitle("Edit", for: .normal); noteEdit.accessibilityIdentifier = "editScoreNote"
        noteEdit.addTarget(self, action: #selector(editExpandedNote), for: .touchUpInside)
        noteClose.setTitle("Close", for: .normal)
        noteClose.accessibilityIdentifier = "closeScoreNote"
        noteClose.addTarget(self, action: #selector(closeExpandedNote), for: .touchUpInside)
        noteScroll.addSubview(noteLabel)
        [noteScroll, noteEdit, noteClose].forEach { notePanel.addSubview($0) }
        addSubview(notePanel)
    }
    private func layoutNotePanel() {
        guard !inkReadOnly, markup.mode != .selecting, !markup.quickBoxArmed, !markup.breakPointArmed,
              let note = visibleTextBoxes.first(where: { $0.id == expandedNoteID }),
              let anchor = displayRect(for: note.region) else { notePanel.isHidden = true; return }
        // UI controls use screen points, not the imported PDF's arbitrary source units.
        // Intersect clipping ancestors so zooming does not place the panel off the viewport.
        var visible = bounds
        var ancestor = superview
        while let view = ancestor {
            if view.clipsToBounds || view is UIWindow { visible = visible.intersection(convert(view.bounds, from: view)) }
            ancestor = view.superview
        }
        let availableWidth = visible.width * pageDisplayScale - 16
        let availableHeight = visible.height * pageDisplayScale - 16
        guard !visible.isNull, availableWidth > 120, availableHeight > 60 else { notePanel.isHidden = true; return }
        notePanel.isHidden = false
        // The expanded inspector reads the full note on a neutral, opaque surface.
        // Keep the user's typography; their ink and paper colors remain on the score/export.
        var attributes = TextAnnotationRenderer.attributes(for: note.style)
        attributes[.foregroundColor] = UIColor.label
        noteLabel.attributedText = NSAttributedString(string: note.text, attributes: attributes)
        let width = min(320, availableWidth)
        let textSize = noteLabel.sizeThatFits(CGSize(width: width - 24, height: .greatestFiniteMagnitude))
        let height = min(max(100, textSize.height + 58), min(availableHeight, 260))
        let inverse = 1 / pageDisplayScale, gap = 28 * inverse, margin = 8 * inverse
        let sourceWidth = width * inverse, sourceHeight = height * inverse
        let left = min(max(visible.minX + margin, anchor.minX), visible.maxX - sourceWidth - margin)
        let below = CGRect(x: left, y: anchor.maxY + gap, width: sourceWidth, height: sourceHeight)
        let above = CGRect(x: left, y: anchor.minY - gap - sourceHeight, width: sourceWidth, height: sourceHeight)
        let top = min(max(visible.minY + margin, anchor.minY), visible.maxY - sourceHeight - margin)
        let right = CGRect(x: anchor.maxX + gap, y: top, width: sourceWidth, height: sourceHeight)
        let leftSide = CGRect(x: anchor.minX - gap - sourceWidth, y: top, width: sourceWidth, height: sourceHeight)
        let inset = visible.insetBy(dx: margin, dy: margin)
        let preferred = [below, above, right, leftSide].first { inset.contains($0) }
        let frame = preferred ?? CGRect(x: left, y: top, width: sourceWidth, height: sourceHeight)
        notePanel.transform = CGAffineTransform(scaleX: inverse, y: inverse)
        notePanel.bounds = CGRect(x: 0, y: 0, width: width, height: height)
        notePanel.center = CGPoint(x: frame.midX, y: frame.midY)
        noteScroll.frame = CGRect(x: 12, y: 8, width: width - 24, height: height - 52)
        noteLabel.frame = CGRect(x: 0, y: 0, width: width - 24, height: textSize.height)
        noteScroll.contentSize = noteLabel.bounds.size
        noteEdit.isHidden = note.layer != markup.activeLayer
        noteEdit.frame = CGRect(x: 8, y: height - 44, width: 64, height: 44)
        noteClose.frame = CGRect(x: width - 76, y: height - 44, width: 68, height: 44)
        bringSubviewToFront(notePanel)
    }
    @objc private func editExpandedNote() {
        guard notesEditable, let note = visibleTextBoxes.first(where: { $0.id == expandedNoteID && $0.layer == markup.activeLayer }) else { return }
        onEditTextBox(note)
    }
    @objc private func closeExpandedNote() { expandedNoteID = nil; layoutNotePanel() }
    @objc private func pan(_ recognizer: UIPanGestureRecognizer) {
        handleSelectionPan(state: recognizer.state, location: recognizer.location(in: self))
    }
    private var selectionGestureIsCurrent: Bool {
        if selectionGestureIsQuick == true { return markup.quickBoxArmed && markup.mode != .selecting }
        return selectionGestureIsQuick == false && markup.mode == .selecting
            && markup.draft?.id == selectionGestureDraftID && markup.regions == selectionGestureRegions
    }
    /// Drag geometry stays local until lift. Publishing the entire observed passage each sample
    /// needlessly rebuilt the score workspace, while a shape layer can move only the visible box.
    func handleSelectionPan(state: UIGestureRecognizer.State, location point: CGPoint) {
        if state == .began {
            clearSelectionPreview()
            guard markup.quickBoxArmed || (markup.mode == .selecting && markup.draft != nil) else { return }
            selectionGestureIsQuick = markup.quickBoxArmed && markup.mode != .selecting
            selectionGestureDraftID = markup.draft?.id
            selectionGestureRegions = markup.regions
            origin = point; drawingID = UUID()
            if selectionGestureIsQuick == false {
                if let selected = visibleRegions.first(where: { $0.id == markup.selectedRegionID }), let box = displayRect(for: selected),
                   let corner = corners(box).enumerated().first(where: { hypot($0.element.x-point.x, $0.element.y-point.y) < selectionHitRadius }) {
                    originalRegion = selected; resizeCorner = corner.offset
                }
                if originalRegion == nil { originalRegion = visibleRegions.reversed().first { displayRect(for: $0)?.contains(point) ?? false } }
            }
            return
        }
        if state == .cancelled || state == .failed {
            let cancelQuick = selectionGestureIsQuick == true && selectionGestureIsCurrent
            clearSelectionPreview()
            if cancelQuick { markup.quickBoxArmed = false }
            return
        }
        guard state == .changed || state == .ended, selectionGestureIsCurrent else { clearSelectionPreview(); return }
        let displayRegion: PassageRegion?
        let storedRegion: PassageRegion?
        if let existing = originalRegion, resizeCorner == nil, sourceCanvasFrame.width > 0, sourceCanvasFrame.height > 0 {
            // Move the original source rectangle, including any part hidden by the crop.
            var moved = existing
            moved.x = min(max(0, existing.x + (point.x - origin.x) / sourceCanvasFrame.width), 1 - existing.width)
            moved.y = min(max(0, existing.y + (point.y - origin.y) / sourceCanvasFrame.height), 1 - existing.height)
            storedRegion = moved
            if let activeCrop { displayRegion = moved.croppedForDisplay(within: activeCrop) }
            else { displayRegion = moved }
        } else {
            let anchor: CGPoint
            if let existing = originalRegion, let corner = resizeCorner, let old = displayRect(for: existing) { anchor = corners(old)[3 - corner] }
            else { anchor = origin }
            let box = CGRect(x: min(anchor.x, point.x), y: min(anchor.y, point.y), width: abs(point.x - anchor.x), height: abs(point.y - anchor.y))
            displayRegion = PassageRegion.clamped(id: originalRegion?.id ?? drawingID, page: pageNumber, rect: box, size: bounds.size)
            storedRegion = displayRegion.map(storageRegion(fromDisplay:))
        }
        if state == .changed {
            let wasHidden = selectionPreview == nil
            selectionPreview = displayRegion
            updateSelectionPreviewLayers()
            if wasHidden != (selectionPreview == nil) { setNeedsDisplay() }
            return
        }
        let quick = selectionGestureIsQuick == true
        clearSelectionPreview()
        if quick {
            markup.pendingQuickBox = storedRegion; markup.quickBoxArmed = false
        } else if let storedRegion, markup.regions.first(where: { $0.id == storedRegion.id }) != storedRegion {
            markup.rememberSelection(); markup.update(storedRegion)
        }
        refresh()
    }
    private func clearSelectionPreview() {
        let hadPreview = selectionPreview != nil
        selectionPreview = nil; selectionGestureIsQuick = nil; selectionGestureDraftID = nil
        selectionGestureRegions = []; originalRegion = nil; resizeCorner = nil
        updateSelectionPreviewLayers()
        if hadPreview { setNeedsDisplay() }
    }
    private func updateSelectionPreviewLayers() {
        CATransaction.begin(); CATransaction.setDisableActions(true)
        defer { CATransaction.commit() }
        selectionPreviewBox.frame = bounds; selectionPreviewHandles.frame = bounds
        guard let box = selectionPreviewRect else {
            selectionPreviewBox.isHidden = true; selectionPreviewHandles.isHidden = true
            return
        }
        let recolor = selectionPreview.flatMap { regionColors[$0.id] }.flatMap(AnnotationColor.init(rawValue:))
        selectionPreviewBox.isHidden = false
        selectionPreviewBox.path = UIBezierPath(rect: box).cgPath
        selectionPreviewBox.fillColor = ScorePassageBoxStyle.fillColor(practiced: false, emphasized: true, recolor: recolor).cgColor
        selectionPreviewBox.strokeColor = ScorePassageBoxStyle.strokeColor(practiced: false, selected: true, recolor: recolor).cgColor
        selectionPreviewBox.lineWidth = selectionLineWidth
        let path = UIBezierPath(); let diameter = selectionHandleDiameter
        for corner in corners(box) {
            path.append(UIBezierPath(ovalIn: CGRect(x: corner.x - diameter / 2, y: corner.y - diameter / 2, width: diameter, height: diameter)))
        }
        selectionPreviewHandles.isHidden = false; selectionPreviewHandles.path = path.cgPath
        selectionPreviewHandles.fillColor = UIColor.white.cgColor
        selectionPreviewHandles.strokeColor = ScorePassageBoxStyle.handleRingColor().cgColor
        selectionPreviewHandles.lineWidth = 1 / pageDisplayScale
    }
    override func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        // Placement (stamp/text) only ever needs a tap, never a drag — a finger drag while a
        // placement tool is armed must not fall through to the box-drawing pan below it.
        if gestureRecognizer === selectionDoubleTap { return markup.mode == .selecting && !markup.regions.isEmpty }
        if gestureRecognizer === noteEditTap || gestureRecognizer === noteDictateTap {
            return editableNote(at: gestureRecognizer.location(in: self)) != nil
        }
        if gestureRecognizer === notePan {
            let begins = movableNoteAtPanStart() != nil
            #if DEBUG
            traceNoteGesture("shouldBegin\(begins)", point: notePan.location(in: self), translation: notePan.translation(in: self))
            #endif
            return begins
        }
        if gestureRecognizer === stampPencilTap { return markup.mode == .writing && markup.tool.kind == .stamp && markup.armedStamp != nil }
        if gestureRecognizer === stampPan { return markup.mode == .writing && markup.tool.kind == .stamp && markup.armedStamp != nil && note(at: stampPan.location(in: self)) == nil }
        if gestureRecognizer === selectionTap { return markup.mode == .selecting || placementToolArmed || markup.breakPointArmed || note(at: selectionTap.location(in: self)) != nil }
        return markup.mode == .selecting || markup.quickBoxArmed
    }
    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
        // The expanded panel owns its buttons and scrolling. Ancestor note gestures must not
        // capture the underlying note when the panel needs to overlap it in a small viewport.
        if touch.view?.isDescendant(of: notePanel) == true { return false }
        #if DEBUG
        if gestureRecognizer === notePan {
            traceNoteGesture("receive\(touch.type.rawValue)-\(touch.view.map { String(describing: type(of: $0)) } ?? "none")", point: touch.location(in: self))
        }
        #endif
        if touch.type == .pencil, markup.mode != .selecting, !markup.quickBoxArmed, !placementToolArmed, !markup.breakPointArmed {
            // A real Pencil stroke crossing a yellow note must stay a stroke. Merely having a
            // note somewhere on this page must not let a tap recognizer cancel PencilKit input.
            return false
        }
        if gestureRecognizer === noteEditTap || gestureRecognizer === noteDictateTap {
            let accepts = touch.type == .direct && editableNote(at: touch.location(in: self)) != nil
            #if DEBUG
            traceNoteGesture("receiveQuick taps=\((gestureRecognizer as? UITapGestureRecognizer)?.numberOfTapsRequired ?? 0) accepts=\(accepts)", point: touch.location(in: self))
            #endif
            return accepts
        }
        if gestureRecognizer === stampPan { stampGestureUsesPencil = touch.type == .pencil }
        if gestureRecognizer === selectionTap, touch.type == .pencil, markup.tool.kind == .stamp { return false }
        if gestureRecognizer === notePan { return captureNotePanStart(at: touch.location(in: self)) }
        return true
    }
    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { other is UIPinchGestureRecognizer }
}
