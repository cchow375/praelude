import UIKit
import SwiftUI
import PencilKit

/// Passage-box coloring for the score overlay (§3a: one monochrome ink/paper/gray family, with the
/// one rare amber accent reserved for genuinely live state — a passage box is neither). Practiced,
/// emphasized and selected are distinguished by alpha weight only, never by a second hue, so this is
/// the one place `draw(_:)` is allowed to name a color — everything it draws comes from `ink`.
enum ScorePassageBoxStyle {
    static func fillColor(practiced: Bool, emphasized: Bool) -> UIColor {
        UIColor(PraeludeColor.ink).withAlphaComponent(emphasized ? 0.105 : (practiced ? 0.032 : 0.055))
    }
    static func strokeColor(practiced: Bool, selected: Bool) -> UIColor {
        UIColor(PraeludeColor.ink).withAlphaComponent(selected ? 0.55 : (practiced ? 0.12 : 0.20))
    }
    /// The selected box's own corner resize handles — a touch more opaque than its edge stroke so
    /// the drag points read clearly against the page.
    static func handleRingColor() -> UIColor {
        UIColor(PraeludeColor.ink).withAlphaComponent(0.65)
    }
}

/// PDFKit owns page sizing, rotation and zoom; all geometry stays in page-local coordinates.
@MainActor final class ScorePageOverlay: UIView, UIGestureRecognizerDelegate {
    let pageNumber: Int
    let canvas = PKCanvasView()
    let markup: ScoreMarkupState
    var displayedRegions: [PassageRegion] = [] { didSet { setNeedsDisplay() } }
    var emphasizedIDs: Set<UUID> = []
    var practicedIDs: Set<UUID> = []
    var onPencilBegan: () -> Void = {}
    var inkReadOnly = false
    private(set) var selectionPan: UIPanGestureRecognizer!
    private var origin = CGPoint.zero
    private var originalRegion: PassageRegion?
    private var drawingID = UUID()
    private var resizeCorner: Int?
    private var selectionTap: UITapGestureRecognizer!

    init(page: Int, markup: ScoreMarkupState) {
        pageNumber = page; self.markup = markup
        super.init(frame: .zero)
        isOpaque = false; backgroundColor = .clear
        accessibilityIdentifier = "passageCanvas_page_\(page)"
        canvas.backgroundColor = .clear; canvas.isOpaque = false; canvas.isScrollEnabled = false
        canvas.drawingPolicy = .pencilOnly
        canvas.accessibilityIdentifier = "inkCanvas_page_\(page)"
        addSubview(canvas)
        selectionPan = UIPanGestureRecognizer(target: self, action: #selector(pan(_:)))
        selectionPan.maximumNumberOfTouches = 1; selectionPan.delegate = self
        selectionPan.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.direct.rawValue), NSNumber(value: UITouch.TouchType.pencil.rawValue)]
        addGestureRecognizer(selectionPan)
        selectionTap = UITapGestureRecognizer(target: self, action: #selector(tap(_:)))
        selectionTap.delegate = self; selectionTap.require(toFail: selectionPan)
        addGestureRecognizer(selectionTap)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func layoutSubviews() { super.layoutSubviews(); canvas.frame = bounds; setNeedsDisplay() }

    func refresh() {
        canvas.drawingPolicy = markup.mode == .writing && markup.fingerDrawing ? .anyInput : .pencilOnly
        canvas.isUserInteractionEnabled = markup.mode != .selecting && !inkReadOnly
        setNeedsDisplay()
        accessibilityValue = "\(visibleRegions.count) boxes on page \(pageNumber)"
        canvas.accessibilityValue = "\(canvas.drawing.strokes.count) ink strokes"
    }
    private var visibleRegions: [PassageRegion] {
        (markup.mode == .selecting ? markup.regions : displayedRegions).filter { $0.page == pageNumber }
    }
    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        guard bounds.contains(point) else { return nil }
        if markup.mode == .selecting { return self }
        let pencil = event?.allTouches?.contains { $0.type == .pencil } == true
        if pencil || (markup.mode == .writing && markup.fingerDrawing) {
            return canvas.hitTest(convert(point, to: canvas), with: event)
        }
        return nil // A finger still turns/zooms the PDF while Pencil writes.
    }
    override func draw(_ rect: CGRect) {
        guard let context = UIGraphicsGetCurrentContext() else { return }
        for region in visibleRegions {
            let box = region.rect(in: bounds.size)
            let selected = markup.mode == .selecting && markup.selectedRegionID == region.id
            let emphasized = emphasizedIDs.contains(region.id) || markup.mode == .selecting
            let practiced = practicedIDs.contains(region.id) && !emphasized
            context.setFillColor(ScorePassageBoxStyle.fillColor(practiced: practiced, emphasized: emphasized).cgColor)
            context.fill(box)
            context.setStrokeColor(ScorePassageBoxStyle.strokeColor(practiced: practiced, selected: selected).cgColor)
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
    }
    private func corners(_ rect: CGRect) -> [CGPoint] {
        [CGPoint(x: rect.minX, y: rect.minY), CGPoint(x: rect.maxX, y: rect.minY),
         CGPoint(x: rect.minX, y: rect.maxY), CGPoint(x: rect.maxX, y: rect.maxY)]
    }
    @objc private func tap(_ recognizer: UITapGestureRecognizer) {
        let point = recognizer.location(in: self)
        markup.selectedRegionID = visibleRegions.reversed().first { $0.rect(in: bounds.size).contains(point) }?.id
        setNeedsDisplay()
    }
    @objc private func pan(_ recognizer: UIPanGestureRecognizer) {
        let point = recognizer.location(in: self)
        switch recognizer.state {
        case .began:
            origin = point; resizeCorner = nil; originalRegion = nil; drawingID = UUID()
            if let selected = visibleRegions.first(where: { $0.id == markup.selectedRegionID }) {
                let threshold = max(12, bounds.width * 0.025)
                if let corner = corners(selected.rect(in: bounds.size)).enumerated().first(where: { hypot($0.element.x-point.x, $0.element.y-point.y) < threshold }) {
                    originalRegion = selected; resizeCorner = corner.offset
                }
            }
            if originalRegion == nil { originalRegion = visibleRegions.reversed().first { $0.rect(in: bounds.size).contains(point) } }
            markup.rememberSelection()
        case .changed, .ended:
            var box: CGRect
            if let existing = originalRegion {
                let old = existing.rect(in: bounds.size)
                if let resizeCorner {
                    let opposite = corners(old)[3 - resizeCorner]
                    box = CGRect(x: min(point.x, opposite.x), y: min(point.y, opposite.y), width: abs(point.x-opposite.x), height: abs(point.y-opposite.y))
                } else {
                    box = old.offsetBy(dx: point.x-origin.x, dy: point.y-origin.y)
                    box.origin.x = min(max(0, box.minX), max(0, bounds.width-box.width))
                    box.origin.y = min(max(0, box.minY), max(0, bounds.height-box.height))
                }
            } else { box = CGRect(x: min(origin.x, point.x), y: min(origin.y, point.y), width: abs(point.x-origin.x), height: abs(point.y-origin.y)) }
            if let region = PassageRegion.clamped(id: originalRegion?.id ?? drawingID, page: pageNumber, rect: box, size: bounds.size) { markup.update(region) }
            refresh()
        case .cancelled: markup.undoSelection(); refresh()
        default: break
        }
    }
    override func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool { markup.mode == .selecting }
    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { other is UIPinchGestureRecognizer }
}
