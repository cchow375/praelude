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
    private let inkUndoManager = UndoManager()
    override var undoManager: UndoManager? { inkUndoManager }
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

@MainActor final class ScorePageOverlay: UIView, UIGestureRecognizerDelegate, UIPencilInteractionDelegate {
    let pageNumber: Int
    let canvas = ScoreInkCanvas()
    let otherLayersCanvas = ScoreInkCanvas()
    let markup: ScoreMarkupState
    var displayedRegions: [PassageRegion] = [] { didSet { if displayedRegions != oldValue { setNeedsDisplay() } } }
    /// Passage id -> the recolor token it was saved with, if any (§8).
    var regionColors: [UUID: String] = [:] { didSet { if regionColors != oldValue { setNeedsDisplay() } } }
    var displayedStamps: [StampAnnotation] = [] { didSet { if displayedStamps != oldValue { setNeedsDisplay() } } }
    var displayedTextBoxes: [TextBoxAnnotation] = [] { didSet { if displayedTextBoxes != oldValue { setNeedsDisplay(); refreshNoteAccessibility() } } }
    /// Set by `PagedScoreView.Coordinator.refresh(_:)`, which runs on every SwiftUI update pass —
    /// far more often than the tool actually changes. Reassigning `canvas.tool` unconditionally on
    /// every one of those passes was observed to disrupt `canvas.undoManager`'s redo stack after a
    /// real Undo (a live-UI-test-only symptom: `canRedo` stayed false long after Undo, though Undo
    /// itself always worked correctly) — tracked per overlay (not globally) so a page's canvas still
    /// always gets the current tool at least once when it is first created, but a refresh that finds
    /// nothing changed skips the reassignment and the `PKInkingTool`/`PKEraserTool`/`PKLassoTool`
    /// allocation it costs.
    var lastAssignedTool: AnnotationTool?
    var onCanvasLayout: () -> Void = {}
    var pageImageForMagnifier: (CGSize) async -> UIImage? = { _ in nil }
    private var magnifierTask: Task<Void, Never>?
    private var magnifierPage: UIImage?
    private var magnifierSize = CGSize.zero
    private(set) var selectionDoubleTap: UITapGestureRecognizer!
    private(set) var noteEditTap: UITapGestureRecognizer!
    private(set) var noteDictateTap: UITapGestureRecognizer!
    private(set) var stampPan: UIPanGestureRecognizer!
    private(set) var notePan: UIPanGestureRecognizer!
    private var movingNote: TextBoxAnnotation?
    private var movedNotePosition: NormalizedRect?
    private var notePanTouchStart: CGPoint?
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
    var onMoveTextBox: (TextBoxAnnotation, NormalizedRect) -> Bool = { _, _ in false }
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
    var activeCrop: NormalizedRect? { didSet { guard activeCrop != oldValue else { return }; setNeedsLayout(); setNeedsDisplay(); refreshNoteAccessibility() } }
    private(set) var selectionPan: UIPanGestureRecognizer!
    private var origin = CGPoint.zero
    private var originalRegion: PassageRegion?
    private var drawingID = UUID()
    private var resizeCorner: Int?
    private(set) var selectionTap: UITapGestureRecognizer!
    private var quickBoxPreview: PassageRegion?
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
            layerCanvas.minimumZoomScale = 1; layerCanvas.maximumZoomScale = 32
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
        configureNotePanel()
        refreshNoteAccessibility()
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
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
            onCanvasLayout()
        }
        layoutNotePanel()
        if laidOutSize != bounds.size { laidOutSize = bounds.size; setNeedsDisplay(); refreshNoteAccessibility() }
    }
    /// PDFKit applies a transform to its overlay, but that does not change PencilKit's own zoom.
    /// Increase the canvas's real zoom and counter-scale its view. This asks PencilKit to rerender
    /// its vector strokes at the visible scale, while a point in saved page coordinates stays put.
    /// Neither PKDrawing nor its source-page coordinates are ever transformed/reassigned.
    func updateInkResolution(displayScale: CGFloat) {
        let scale = displayScale.isFinite ? min(32, max(1, displayScale)) : 1
        guard abs(renderedInkScale - scale) > 0.001 else { return }
        renderedInkScale = scale
        layoutInkCanvases()
        // The annotation chrome is a flat UIView; bound its backing bitmap separately from
        // PencilKit's tiled ink so a deep zoom never allocates an enormous full-page image.
        contentScaleFactor = min((window?.screen.scale ?? UIScreen.main.scale) * scale,
                                 sqrt(4_000_000 / max(1, bounds.width * bounds.height)))
        setNeedsDisplay()
    }
    private func layoutInkCanvases() {
        guard sourceCanvasFrame.width > 0, sourceCanvasFrame.height > 0 else { return }
        let scale = renderedInkScale
        for layerCanvas in [otherLayersCanvas, canvas] {
            layerCanvas.transform = CGAffineTransform(scaleX: 1 / scale, y: 1 / scale)
            layerCanvas.bounds = CGRect(origin: .zero, size: CGSize(width: sourceCanvasFrame.width * scale, height: sourceCanvasFrame.height * scale))
            layerCanvas.center = CGPoint(x: sourceCanvasFrame.midX, y: sourceCanvasFrame.midY)
            if abs(layerCanvas.zoomScale - scale) > 0.001 { layerCanvas.setZoomScale(scale, animated: false) }
            layerCanvas.contentSize = CGSize(width: sourceCanvasFrame.width * scale, height: sourceCanvasFrame.height * scale)
            if layerCanvas.contentOffset != .zero { layerCanvas.contentOffset = .zero }
        }
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
        let policy: PKCanvasViewDrawingPolicy = markup.mode == .writing && markup.fingerDrawing ? .anyInput : .pencilOnly
        if canvas.drawingPolicy != policy { canvas.drawingPolicy = policy }
        // Input routing owns read-only and placement state. Never disable the live canvas or
        // change PencilKit's recognizer delegate while changing tools.
        if markup.stampDraft?.page == pageNumber {
            markup.confirmStamp = { [weak self] in self?.commitStampDraft() }
        }
        if inkReadOnly || !visibleTextBoxes.contains(where: { $0.id == expandedNoteID }) { expandedNoteID = nil }
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
        if !notePanel.isHidden, notePanel.frame.contains(point) {
            return notePanel.hitTest(convert(point, to: notePanel), with: event)
        }
        if markup.mode == .selecting || markup.quickBoxArmed || markup.breakPointArmed { return self }
        if placementToolArmed { return self }
        if note(at: point) != nil, event?.allTouches?.contains(where: { $0.type == .pencil }) != true { return self }
        if let touches = event?.allTouches, touches.filter({ $0.type == .direct }).count >= 2 { return self }
        guard !inkReadOnly, !contentReadOnly else { return nil }
        let touches = event?.allTouches
        let pencil = touches?.contains { $0.type == .pencil } == true
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
            guard let box = displayRect(for: region) else { continue }
            let selected = markup.mode == .selecting && markup.selectedRegionID == region.id
            let emphasized = emphasizedIDs.contains(region.id) || markup.mode == .selecting
            let practiced = practicedIDs.contains(region.id) && !emphasized
            let recolor = regionColors[region.id].flatMap(AnnotationColor.init(rawValue:))
            context.setFillColor(ScorePassageBoxStyle.fillColor(practiced: practiced, emphasized: emphasized, recolor: recolor).cgColor)
            context.fill(box)
            context.setStrokeColor(ScorePassageBoxStyle.strokeColor(practiced: practiced, selected: selected, recolor: recolor).cgColor)
            context.setLineWidth(selected ? 1.25 : 0.6); context.stroke(box)
            if selected {
                for corner in corners(box) {
                    context.setFillColor(UIColor.white.cgColor)
                    context.fillEllipse(in: CGRect(x: corner.x-4, y: corner.y-4, width: 8, height: 8))
                    context.setStrokeColor(ScorePassageBoxStyle.handleRingColor().cgColor)
                    context.strokeEllipse(in: CGRect(x: corner.x-4, y: corner.y-4, width: 8, height: 8))
                }
            }
        }
        if let preview = quickBoxPreview {
            let box = preview.rect(in: bounds.size)
            context.setFillColor(ScorePassageBoxStyle.fillColor(practiced: false, emphasized: true).cgColor)
            context.fill(box)
            context.setStrokeColor(UIColor(PraeludeColor.scoreInk).cgColor)
            context.setLineDash(phase: 0, lengths: [4, 3]); context.setLineWidth(1.25); context.stroke(box)
            context.setLineDash(phase: 0, lengths: [])
        }
        for textBox in visibleTextBoxes {
            let position = movingNote?.id == textBox.id ? (movedNotePosition ?? textBox.region) : textBox.region
            guard let box = displayRect(for: position), box.width > 4, box.height > 4 else { continue }
            context.setFillColor(UIColor(red: 1, green: 0.91, blue: 0.43, alpha: 0.95).cgColor)
            context.fill(box)
            context.setStrokeColor(UIColor(red: 0.62, green: 0.47, blue: 0.10, alpha: 0.7).cgColor)
            context.setLineWidth(0.75); context.stroke(box)
            let paragraph = NSMutableParagraphStyle(); paragraph.lineBreakMode = .byTruncatingTail
            (textBox.text as NSString).draw(in: box.insetBy(dx: 4, dy: 3), withAttributes: [
                .font: UIFont.systemFont(ofSize: max(9, min(13, box.height * 0.55))),
                .foregroundColor: UIColor(PraeludeColor.scoreInk), .paragraphStyle: paragraph
            ])
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
            expandedNoteID = expandedNoteID == note.id ? nil : note.id
            layoutNotePanel(); return
        }
        if markup.mode == .writing, markup.tool.kind == .text {
            handleTextTap(at: point); return
        }
        markup.selectedRegionID = visibleRegions.reversed().first { displayRect(for: $0)?.contains(point) ?? false }?.id
        setNeedsDisplay()
    }
    private func handleStampTap(at point: CGPoint) {
        // A tap on an existing stamp selects it (for a "Remove stamp" affordance) instead of placing
        // a new one, whether or not the stamp tool still has a kind armed. Only an active-layer
        // stamp can be selected — matching the "only the active layer is ever editable" rule ink
        // already follows.
        if let existing = visibleStamps.reversed().first(where: { displayRect(for: $0.position)?.insetBy(dx: -6, dy: -6).contains(point) ?? false }) {
            markup.selectedStampID = (existing.layer == markup.activeLayer && markup.selectedStampID != existing.id) ? existing.id : nil
            setNeedsDisplay(); return
        }
        previewStamp(at: point)
    }
    private func handleTextTap(at point: CGPoint) {
        if let existing = visibleTextBoxes.reversed().first(where: { displayRect(for: $0.region)?.contains(point) ?? false }) {
            onEditTextBox(existing); return
        }
        guard let region = NormalizedRect.centered(at: point, width: 0.18, height: 0.035, in: bounds.size) else { return }
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
        notePanTouchStart = nil
        guard !inkReadOnly, markup.mode != .selecting, note(at: point)?.layer == markup.activeLayer else { return false }
        notePanTouchStart = point
        return true
    }
    func movableNoteAtPanStart() -> TextBoxAnnotation? {
        guard !inkReadOnly, markup.mode != .selecting, let start = notePanTouchStart,
              let note = note(at: start),
              note.layer == markup.activeLayer else { return nil }
        return note
    }
    func handleNotePan(state: UIGestureRecognizer.State, location: CGPoint) {
        switch state {
        case .began:
            guard let start = notePanTouchStart, let note = movableNoteAtPanStart() else { return }
            movingNote = note
            movedNotePosition = translatedNotePosition(note, by: CGSize(width: location.x - start.x, height: location.y - start.y))
            expandedNoteID = nil; layoutNotePanel()
            setNeedsDisplay()
        case .changed, .ended:
            guard let note = movingNote, let start = notePanTouchStart else { return }
            movedNotePosition = translatedNotePosition(note, by: CGSize(width: location.x - start.x, height: location.y - start.y))
            if state == .ended {
                if let position = movedNotePosition, position != note.region { _ = commitNoteMove(note, to: position) }
                movingNote = nil; movedNotePosition = nil; notePanTouchStart = nil
            }
            setNeedsDisplay()
        case .cancelled, .failed:
            movingNote = nil; movedNotePosition = nil; notePanTouchStart = nil; setNeedsDisplay()
        default: break
        }
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
        guard !inkReadOnly, note.layer == markup.activeLayer, position.isValid, onMoveTextBox(note, position) else { return false }
        if let index = displayedTextBoxes.firstIndex(where: { $0.id == note.id }) { displayedTextBoxes[index].region = position }
        return true
    }
    @objc private func moveStamp(_ recognizer: UIPanGestureRecognizer) {
        switch recognizer.state {
        case .began, .changed, .ended: previewStamp(at: recognizer.location(in: self))
        case .cancelled: markup.stampDraft = nil; setNeedsDisplay()
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
        visibleTextBoxes.reversed().first { displayRect(for: $0.region)?.insetBy(dx: -4, dy: -4).contains(point) ?? false }
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
        expandedNoteID = id; layoutNotePanel()
        return true
    }
    private func configureNotePanel() {
        notePanel.backgroundColor = UIColor(red: 1, green: 0.93, blue: 0.58, alpha: 1)
        notePanel.layer.cornerRadius = 8; notePanel.layer.borderWidth = 0.5
        notePanel.layer.borderColor = UIColor.brown.withAlphaComponent(0.5).cgColor
        notePanel.isHidden = true; notePanel.accessibilityIdentifier = "expandedScoreNote"
        noteLabel.font = .systemFont(ofSize: 15); noteLabel.numberOfLines = 0; noteLabel.textColor = UIColor(PraeludeColor.scoreInk)
        noteEdit.setTitle("Edit", for: .normal); noteEdit.accessibilityIdentifier = "editScoreNote"
        noteEdit.addTarget(self, action: #selector(editExpandedNote), for: .touchUpInside)
        noteClose.setTitle("Close", for: .normal)
        noteClose.addTarget(self, action: #selector(closeExpandedNote), for: .touchUpInside)
        noteScroll.addSubview(noteLabel)
        [noteScroll, noteEdit, noteClose].forEach { notePanel.addSubview($0) }
        addSubview(notePanel)
    }
    private func layoutNotePanel() {
        guard let note = visibleTextBoxes.first(where: { $0.id == expandedNoteID }),
              let anchor = displayRect(for: note.region), bounds.width > 20, bounds.height > 60 else { notePanel.isHidden = true; return }
        notePanel.isHidden = false; noteLabel.text = note.text
        let width = min(280, bounds.width - 16)
        let textSize = noteLabel.sizeThatFits(CGSize(width: width - 24, height: .greatestFiniteMagnitude))
        let height = min(max(100, textSize.height + 58), min(bounds.height - 16, 260))
        let y = anchor.maxY + height + 8 < bounds.height ? anchor.maxY + 8 : max(8, anchor.minY - height - 8)
        notePanel.frame = CGRect(x: min(max(8, anchor.minX), bounds.width - width - 8), y: y, width: width, height: height)
        noteScroll.frame = CGRect(x: 12, y: 8, width: width - 24, height: height - 52)
        noteLabel.frame = CGRect(x: 0, y: 0, width: width - 24, height: textSize.height)
        noteScroll.contentSize = noteLabel.bounds.size
        noteEdit.isHidden = note.layer != markup.activeLayer
        noteEdit.frame = CGRect(x: 8, y: height - 44, width: 64, height: 44)
        noteClose.frame = CGRect(x: width - 76, y: height - 44, width: 68, height: 44)
        bringSubviewToFront(notePanel)
    }
    @objc private func editExpandedNote() {
        guard let note = visibleTextBoxes.first(where: { $0.id == expandedNoteID && $0.layer == markup.activeLayer }) else { return }
        onEditTextBox(note)
    }
    @objc private func closeExpandedNote() { expandedNoteID = nil; layoutNotePanel() }
    @objc private func pan(_ recognizer: UIPanGestureRecognizer) {
        if markup.quickBoxArmed { quickBoxPan(recognizer); return }
        let point = recognizer.location(in: self)
        switch recognizer.state {
        case .began:
            origin = point; resizeCorner = nil; originalRegion = nil; drawingID = UUID()
            if let selected = visibleRegions.first(where: { $0.id == markup.selectedRegionID }), let box = displayRect(for: selected) {
                let threshold = max(12, bounds.width * 0.025)
                if let corner = corners(box).enumerated().first(where: { hypot($0.element.x-point.x, $0.element.y-point.y) < threshold }) {
                    originalRegion = selected; resizeCorner = corner.offset
                }
            }
            if originalRegion == nil { originalRegion = visibleRegions.reversed().first { displayRect(for: $0)?.contains(point) ?? false } }
            markup.rememberSelection()
        case .changed, .ended:
            var box: CGRect
            if let existing = originalRegion, let old = displayRect(for: existing) {
                if let resizeCorner {
                    let opposite = corners(old)[3 - resizeCorner]
                    box = CGRect(x: min(point.x, opposite.x), y: min(point.y, opposite.y), width: abs(point.x-opposite.x), height: abs(point.y-opposite.y))
                } else {
                    box = old.offsetBy(dx: point.x-origin.x, dy: point.y-origin.y)
                    box.origin.x = min(max(0, box.minX), max(0, bounds.width-box.width))
                    box.origin.y = min(max(0, box.minY), max(0, bounds.height-box.height))
                }
            } else { box = CGRect(x: min(origin.x, point.x), y: min(origin.y, point.y), width: abs(point.x-origin.x), height: abs(point.y-origin.y)) }
            if let region = PassageRegion.clamped(id: originalRegion?.id ?? drawingID, page: pageNumber, rect: box, size: bounds.size) {
                markup.update(storageRegion(fromDisplay: region))
            }
            refresh()
        case .cancelled: markup.undoSelection(); refresh()
        default: break
        }
    }
    /// §8 "quick-create a sub-passage by drawing a box while practicing": a single, self-contained
    /// box draw that never touches `markup.draft` (there may be none — practice does not open the
    /// full passage-selecting editor). One box only; lifting the finger commits it and disarms.
    private func quickBoxPan(_ recognizer: UIPanGestureRecognizer) {
        let point = recognizer.location(in: self)
        switch recognizer.state {
        case .began: origin = point; drawingID = UUID(); quickBoxPreview = nil
        case .changed:
            let box = CGRect(x: min(origin.x, point.x), y: min(origin.y, point.y), width: abs(point.x-origin.x), height: abs(point.y-origin.y))
            quickBoxPreview = PassageRegion.clamped(id: drawingID, page: pageNumber, rect: box, size: bounds.size)
            setNeedsDisplay()
        case .ended:
            let box = CGRect(x: min(origin.x, point.x), y: min(origin.y, point.y), width: abs(point.x-origin.x), height: abs(point.y-origin.y))
            markup.pendingQuickBox = PassageRegion.clamped(id: drawingID, page: pageNumber, rect: box, size: bounds.size).map(storageRegion(fromDisplay:))
            markup.quickBoxArmed = false; quickBoxPreview = nil; setNeedsDisplay()
        case .cancelled: markup.quickBoxArmed = false; quickBoxPreview = nil; setNeedsDisplay()
        default: break
        }
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
        if gestureRecognizer === stampPan { return markup.mode == .writing && markup.tool.kind == .stamp && markup.armedStamp != nil && note(at: stampPan.location(in: self)) == nil }
        if gestureRecognizer === selectionTap { return markup.mode == .selecting || placementToolArmed || markup.breakPointArmed || note(at: selectionTap.location(in: self)) != nil }
        return markup.mode == .selecting || markup.quickBoxArmed
    }
    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
        #if DEBUG
        if gestureRecognizer === notePan {
            traceNoteGesture("receive\(touch.type.rawValue)-\(touch.view.map { String(describing: type(of: $0)) } ?? "none")", point: touch.location(in: self))
        }
        #endif
        if touch.type == .pencil, markup.mode != .selecting, !placementToolArmed, !markup.breakPointArmed {
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
        if gestureRecognizer === notePan { return captureNotePanStart(at: touch.location(in: self)) }
        return true
    }
    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { other is UIPinchGestureRecognizer }
}
