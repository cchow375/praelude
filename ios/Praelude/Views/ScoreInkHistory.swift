import PencilKit
import UIKit

/// The iOS 18 crash invoked a PencilKit tiled-renderer undo target. This manager never records
/// native targets. Responder-chain Undo/Redo forwards to a separate, app-owned value history.
@MainActor private final class ScoreInkUndoBridge: UndoManager {
    weak var history: ScoreInkHistory?
    override init() { super.init(); super.disableUndoRegistration() }
    // PencilKit is allowed to manage its own grouping, but cannot turn registration back on.
    override func enableUndoRegistration() {}
    override func disableUndoRegistration() {}
    override var canUndo: Bool { history?.canUndo ?? false }
    override var canRedo: Bool { history?.canRedo ?? false }
    override var undoActionName: String { "Drawing" }
    override var redoActionName: String { "Drawing" }
    override func undo() { history?.request(.undo) }
    override func undoNestedGroup() { history?.request(.undo) }
    override func redo() { history?.request(.redo) }
    override func removeAllActions() {
        super.removeAllActions()
        if isUndoRegistrationEnabled { super.disableUndoRegistration() }
    }
}

/// One page/layer's bounded immutable drawings, independent of PencilKit's tile lifecycle.
/// No drawing serialization or stroke fingerprinting occurs on the drawing callback path.
@MainActor final class ScoreInkHistory {
    enum Direction { case undo, redo }
    private var undoValues: [PKDrawing] = []
    private var redoValues: [PKDrawing] = []
    private let bridge = ScoreInkUndoBridge()
    var undoManager: UndoManager { bridge }
    var drawing: () -> PKDrawing = { PKDrawing() }
    var applyDrawing: (PKDrawing) -> Void = { _ in }
    var acceptsRequest: () -> Bool = { false }
    var mayRestore: () -> Bool = { false }
    var onStateChanged: () -> Void = {}
    var onRestored: () -> Void = {}
    private(set) var toolActive = false
    private(set) var isRestoring = false
    private var baseline = PKDrawing()
    private var beforeOperation: PKDrawing?
    private var operationRegistered = false
    private var toolOperation = false
    private var sawDrawingCallback = false
    private var awaitingFirstChange = false
    private var pending: [Direction] = []
    private var scheduled = false
    private var generation: UInt64 = 0
    private var costHighWatermark = 1
    private(set) var historyLimit = 40
    var canUndo: Bool { !undoValues.isEmpty || sawDrawingCallback }
    var canRedo: Bool { !redoValues.isEmpty && !sawDrawingCallback }

    init() { bridge.history = self }
    func reset(to value: PKDrawing) {
        generation &+= 1; pending.removeAll(); scheduled = false; toolActive = false
        closeOperation(); baseline = value; costHighWatermark = 1
        undoValues.removeAll(); redoValues.removeAll()
        historyLimit = 40
        onStateChanged()
    }
    func beginTool() {
        checkpoint(); closeOperation()
        beforeOperation = drawing(); toolOperation = true; toolActive = true
    }
    func drawingChanged() {
        guard !isRestoring else { return }
        if !toolActive && drawing() == baseline { return }
        if beforeOperation == nil { beforeOperation = baseline; toolOperation = false }
        awaitingFirstChange = false
        let firstCallback = !sawDrawingCallback
        sawDrawingCallback = true
        if !toolActive { schedule() }
        if firstCallback { onStateChanged() }
    }
    func endTool(cancelled: Bool = false) {
        toolActive = false
        // PencilKit explicitly permits the first drawing callback AFTER tool-end. Do not undo
        // the preceding mark if a command arrives before that new mark is published. An explicit
        // cancelled/no-change gesture needs no such protection and must preserve Redo.
        awaitingFirstChange = !cancelled && !sawDrawingCallback && drawing() == beforeOperation
        if cancelled && !sawDrawingCallback { closeOperation() }
        schedule()
    }
    func finishedRendering() { resumePendingRequest() }
    func detach() {
        generation &+= 1; pending.removeAll(); scheduled = false
        // An interrupted canvas may never receive didEndUsingTool. Keep its current drawing and
        // history, but do not leave it permanently tool-active when the retained page reattaches.
        toolActive = false; checkpoint()
    }
    func request(_ direction: Direction) {
        guard acceptsRequest() else { pending.removeAll(); return }
        pending.append(direction); schedule()
    }
    func resumePendingRequest() { if !pending.isEmpty { schedule() } }
    private func schedule() {
        guard !scheduled else { return }
        scheduled = true
        let epoch = generation
        DispatchQueue.main.async { [weak self] in
            guard let self, self.generation == epoch else { return }
            self.scheduled = false; self.checkpoint(); self.performPending()
        }
    }
    private func checkpoint() {
        guard !toolActive, !isRestoring, let before = beforeOperation else { return }
        let value = drawing()
        if value != before && !operationRegistered {
            limitMemory(for: before, and: value); register(before); operationRegistered = true
        }
        baseline = value
        // Keep a tool's original value through late pressure/eraser/lasso callbacks. Rendering
        // completion is not a public final-pressure boundary. The next tool or Undo closes it.
        if !toolOperation { closeOperation() }
        onStateChanged()
    }
    private func closeOperation() {
        beforeOperation = nil; operationRegistered = false; toolOperation = false
        sawDrawingCallback = false; awaitingFirstChange = false
    }
    private func register(_ value: PKDrawing) {
        // These values never participate in Foundation or PencilKit undo grouping. In
        // particular, a restore must not register a reciprocal action inside a disabled group.
        redoValues.removeAll()
        undoValues.append(value)
        trimHistory()
    }
    private func restore(_ value: PKDrawing) {
        closeOperation(); baseline = value
        isRestoring = true
        applyDrawing(value)
        isRestoring = false
        onRestored()
    }
    private func performPending() {
        guard !pending.isEmpty, !toolActive, !isRestoring else { return }
        guard acceptsRequest() else { pending.removeAll(); return }
        guard mayRestore() else { return }
        let direction = pending.removeFirst()
        if awaitingFirstChange {
            // A canceled/no-op and a not-yet-published mark are indistinguishable in this API.
            // Conservatively leave ink intact for this command. A later callback still records
            // against baseline; the next normal Undo works even if no callback ever arrives.
            closeOperation(); onStateChanged()
            if !pending.isEmpty { schedule() }
            return
        }
        closeOperation()
        switch direction {
        case .undo:
            if let value = undoValues.popLast() {
                redoValues.append(drawing())
                restore(value)
            }
        case .redo:
            if let value = redoValues.popLast() {
                undoValues.append(drawing())
                restore(value)
            }
        }
        onStateChanged()
        // Keep every deliberate request in its original order. A single pending direction used
        // to lose rapid Undo presses, and Undo followed by Redo could become only a Redo.
        if !pending.isEmpty { schedule() }
    }
    private func trimHistory() {
        // Undo/Redo transfers one value between stacks, so their combined count stays bounded.
        // New edits discard the abandoned redo branch before retaining their previous value.
        let excess = undoValues.count + redoValues.count - historyLimit
        if excess > 0 {
            let oldestUndoCount = min(excess, undoValues.count)
            undoValues.removeFirst(oldestUndoCount)
            let oldestRedoCount = excess - oldestUndoCount
            if oldestRedoCount > 0 { redoValues.removeFirst(oldestRedoCount) }
        }
    }
    private func limitMemory(for before: PKDrawing, and after: PKDrawing) {
        func cost(_ value: PKDrawing) -> Int {
            value.strokes.reduce(0) { total, stroke in
                min(64 * 1024 * 1024, total + min(500_000, stroke.path.count) * 128 + 4096)
            }
        }
        costHighWatermark = max(costHighWatermark, max(cost(before), cost(after)))
        historyLimit = max(1, min(40, (32 * 1024 * 1024) / costHighWatermark))
        trimHistory()
    }
}
