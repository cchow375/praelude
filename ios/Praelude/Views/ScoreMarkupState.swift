import SwiftUI
import PencilKit

/// The in-progress selection is a draft until Done commits the complete passage.
@MainActor @Observable final class ScoreMarkupState {
    enum Mode { case reading, selecting, writing }
    struct PendingInk {
        let data: Data
        /// Exact stored bytes, not PencilKit's re-encoded representation.
        let expected: Data?
    }
    private(set) var pendingInk: [Int: PendingInk] = [:]
    private(set) var pendingInkDocument: URL?
    /// Guards a layer switch the same way `pendingInkDocument` already guards a document switch:
    /// `rememberInk` refuses ink for a different layer while unflushed ink from another layer is
    /// still pending, so a mid-edit layer swap can never silently attribute a stroke to the wrong
    /// mine/teacher/performance row.
    private(set) var pendingInkLayer: InkLayer?
    var mode: Mode = .reading
    var draft: Passage?
    private(set) var baseline: Passage?
    var selectedRegionID: UUID?
    var fingerDrawing = false
    /// §7: pen/highlighter/eraser/lasso/stamp/text, with the curated color/width that go with it.
    /// Drives the canvas's live `PKTool` directly (`AnnotationTool.pkTool`) — the custom
    /// `AnnotationToolbar` is the primary way to change this; the system `PKToolPicker` stays
    /// available underneath for Apple Pencil's own double-tap/squeeze shortcuts.
    var tool = AnnotationTool()
    /// §7 layers: which layer new ink/stamps/text are captured into, and which layers currently show.
    /// Only `activeLayer`'s ink is ever loaded into the editable canvas — the other visible layers
    /// render as a read-only underlay (`ScorePageOverlay`), so they can never be accidentally erased
    /// or moved from this device.
    var activeLayer: InkLayer = .mine
    var visibleLayers: Set<InkLayer> = Set(InkLayer.allCases)
    /// The stamp kind (and, for kinds that need one, label) the next tap places. `nil` means the
    /// stamp tool isn't armed with a specific choice yet — `AnnotationToolbar`'s stamp picker sets it.
    var armedStamp: (kind: StampKind, label: String?)?
    /// An existing stamp the last tap selected, for a "Remove stamp" affordance. Never set for a
    /// stamp outside `activeLayer` — those render but do not respond to taps.
    var selectedStampID: UUID?
    var errorMessage: String?
    var conflictPage: Int?
    var inkRevision = 0
    var canUndoInk = false
    var canRedoInk = false
    /// §8: draws one box without leaving practice, which becomes a new sub-passage. Arming this does
    /// not change `mode` — the practice dock, HUD and music stay exactly as they are; only one extra
    /// box-drawing pan is allowed on the current page. `ScoreWorkspace` observes `pendingQuickBox` to
    /// actually create the passage (`ScoreMarkupState` never touches `PracticeStore`), then disarms.
    var quickBoxArmed = false
    var pendingQuickBox: PassageRegion?
    /// §11 R8: "after Sloppy, optional tap where it broke." A single tap (not a drag), so it needs
    /// none of `quickBoxArmed`'s own pan/preview machinery — `ScorePageOverlay` reads this the same
    /// way it reads `armedStamp`, and `ScoreWorkspace` disarms it once the tap lands.
    var breakPointArmed = false
    @ObservationIgnored var flushInk: () -> Bool = { true }
    @ObservationIgnored var undoInk: () -> Void = {}
    @ObservationIgnored var redoInk: () -> Void = {}
    @ObservationIgnored var resolveInkConflict: (Int, Bool) -> Void = { _, _ in }
    @ObservationIgnored private var undoRegions: [[PassageRegion]] = []
    @ObservationIgnored private var redoRegions: [[PassageRegion]] = []

    var regions: [PassageRegion] { draft?.regions ?? [] }
    var canUndoSelection: Bool { !undoRegions.isEmpty }
    var canRedoSelection: Bool { !redoRegions.isEmpty }

    init() {
        flushInk = { [weak self] in self?.pendingInk.isEmpty ?? true }
    }

    /// Keep only the latest snapshot of each dirty page, never an accumulating stroke history.
    func rememberInk(page: Int, data: Data, expected: Data?, document: URL, layer: InkLayer = .mine) {
        guard pendingInkDocument == nil || pendingInkDocument == document,
              pendingInkLayer == nil || pendingInkLayer == layer else {
            errorMessage = "Unsaved ink belongs to another score or layer. Save it before switching."
            return
        }
        pendingInkDocument = document; pendingInkLayer = layer
        pendingInk[page] = PendingInk(data: data, expected: expected)
    }

    func clearPendingInk(page: Int) {
        pendingInk.removeValue(forKey: page)
        if pendingInk.isEmpty { pendingInkDocument = nil; pendingInkLayer = nil }
    }

    func begin(_ passage: Passage, baseline: Passage? = nil) {
        guard flushInk() else { return }
        draft = passage; self.baseline = baseline; selectedRegionID = nil
        undoRegions = []; redoRegions = []; mode = .selecting
    }
    func rememberSelection() { undoRegions.append(regions); redoRegions = [] }
    func update(_ region: PassageRegion) {
        guard var draft else { return }
        if let index = draft.regions.firstIndex(where: { $0.id == region.id }) { draft.regions[index] = region }
        else { draft.regions.append(region) }
        self.draft = draft; selectedRegionID = region.id
    }
    func removeSelected() {
        guard let selectedRegionID else { return }
        rememberSelection(); draft?.regions.removeAll { $0.id == selectedRegionID }; self.selectedRegionID = nil
    }
    func undoSelection() {
        guard let previous = undoRegions.popLast() else { return }
        redoRegions.append(regions); draft?.regions = previous; selectedRegionID = nil
    }
    func redoSelection() {
        guard let next = redoRegions.popLast() else { return }
        undoRegions.append(regions); draft?.regions = next; selectedRegionID = nil
    }
    func finish() {
        mode = .reading; draft = nil; baseline = nil; selectedRegionID = nil; undoRegions = []; redoRegions = []
        quickBoxArmed = false; pendingQuickBox = nil
    }
}

extension PassageRegion {
    func rect(in size: CGSize) -> CGRect {
        CGRect(x: x * size.width, y: y * size.height, width: width * size.width, height: height * size.height)
    }
    static func clamped(id: UUID = UUID(), page: Int, rect: CGRect, size: CGSize) -> PassageRegion? {
        guard size.width > 0, size.height > 0 else { return nil }
        let clipped = rect.standardized.intersection(CGRect(origin: .zero, size: size))
        guard !clipped.isNull, clipped.width >= size.width * 0.006, clipped.height >= size.height * 0.006 else { return nil }
        let x = clipped.minX / size.width, y = clipped.minY / size.height
        return PassageRegion(id: id, page: page, x: x, y: y,
                             width: min(clipped.width / size.width, 1 - x), height: min(clipped.height / size.height, 1 - y))
    }
}

/// Shared with `PassageRegion.rect(in:)` above — every normalized mark type (§7 stamps/text boxes,
/// §8 passage boxes) places the same way on the overlay's own (already rotation/crop/zoom-correct;
/// see `GeometryTransforms.swift`) unrotated page-local bounds.
extension NormalizedRect {
    func rect(in size: CGSize) -> CGRect {
        CGRect(x: x * size.width, y: y * size.height, width: width * size.width, height: height * size.height)
    }
    /// A small, fixed-size box centered on a tapped point and clamped to the page — how a new stamp
    /// or text box is placed (unlike a passage box, neither is dragged to size).
    static func centered(at point: CGPoint, width: Double, height: Double, in size: CGSize) -> NormalizedRect? {
        guard size.width > 0, size.height > 0, width > 0, height > 0, width <= 1, height <= 1 else { return nil }
        let x = min(max(0, point.x / size.width - width / 2), 1 - width)
        let y = min(max(0, point.y / size.height - height / 2), 1 - height)
        guard x.isFinite, y.isFinite else { return nil }
        return NormalizedRect(x: x, y: y, width: width, height: height)
    }
}
