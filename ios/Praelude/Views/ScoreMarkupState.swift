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
    var mode: Mode = .reading
    var draft: Passage?
    private(set) var baseline: Passage?
    var selectedRegionID: UUID?
    var fingerDrawing = false
    var inkTool = PKInkingTool(.pen, color: .black, width: 2)
    var errorMessage: String?
    var conflictPage: Int?
    var inkRevision = 0
    var canUndoInk = false
    var canRedoInk = false
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
    func rememberInk(page: Int, data: Data, expected: Data?, document: URL) {
        guard pendingInkDocument == nil || pendingInkDocument == document else {
            errorMessage = "Unsaved ink belongs to another score. Save that score before switching."
            return
        }
        pendingInkDocument = document
        pendingInk[page] = PendingInk(data: data, expected: expected)
    }

    func clearPendingInk(page: Int) {
        pendingInk.removeValue(forKey: page)
        if pendingInk.isEmpty { pendingInkDocument = nil }
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
    func finish() { mode = .reading; draft = nil; baseline = nil; selectedRegionID = nil; undoRegions = []; redoRegions = [] }
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
