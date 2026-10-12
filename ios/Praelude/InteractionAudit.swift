#if DEBUG
import UIKit
import ObjectiveC

/// Opt-in disposable-test diagnostics. Callers must pass constant event names and numeric or
/// boolean state, never names, labels, library IDs, user text or private paths.
@MainActor enum InteractionAudit {
    private(set) static var isEnabled = false
    private(set) static var isPassiveReadingDelivery = false
    private(set) static var isReadingLifecycleEnabled = false
    private(set) static var isReadingWindowEnabled = false
    private(set) static var passiveReadingEvents: [String] = []
    fileprivate struct ReadingWindowSnapshot {
        let touch: UITouch
        let phase: UITouch.Phase
        let type: UITouch.TouchType
        let timestamp: TimeInterval
        let point: CGPoint
        let sameWindow: Bool
        let keyWindow: Bool
        let sceneState: Int
    }
    private struct RetainedReadingWindowTouch {
        let touch: UITouch
        let beganAt: TimeInterval?
        let beforePhase: UITouch.Phase
        let afterPhase: UITouch.Phase
        let beforeTime: TimeInterval
        let afterTime: TimeInterval
    }
    private static var readingWindowTouches: [RetainedReadingWindowTouch] = []
    private static var readingWindowForwardCount = 0
    private final class WeakReadingWindowGesture {
        weak var value: UIGestureRecognizer?
        init(_ value: UIGestureRecognizer) { self.value = value }
    }
    private static let readingWindowRoles = ["pageTap", "rename", "dictate", "longPress"]
    private static var readingWindowGestures: [String: WeakReadingWindowGesture] = [:]
    private static var installed = false
    private static var sequence = 0
    private static var heartbeatCount = 0
    private static var heartbeatTask: Task<Void, Never>?
    private static let writer = InteractionAuditWriter()

    static var fileURL: URL {
        URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
            .appendingPathComponent("interaction-audit.jsonl")
    }

    static func installIfRequested() {
        let arguments = ProcessInfo.processInfo.arguments
        guard arguments.contains("--uitesting"), !installed else { return }
        if arguments.contains("--audit-reading-delivery") {
            installed = true
            isEnabled = true
            isPassiveReadingDelivery = true
            let windowRequested = arguments.contains("--audit-reading-window")
            isReadingLifecycleEnabled = arguments.contains("--audit-reading-lifecycle") && !windowRequested
            if windowRequested,
               let original = class_getInstanceMethod(UIWindow.self, #selector(UIWindow.sendEvent(_:))),
               let observed = class_getInstanceMethod(UIWindow.self, #selector(UIWindow.praeludeReadingWindowSendEvent(_:))) {
                method_exchangeImplementations(original, observed)
                isReadingWindowEnabled = true
            }
            return
        }
        guard arguments.contains("--audit-taps") else { return }
        guard let original = class_getInstanceMethod(UIWindow.self, #selector(UIWindow.sendEvent(_:))),
              let observed = class_getInstanceMethod(UIWindow.self, #selector(UIWindow.praeludeAuditSendEvent(_:))),
              let applicationAction = class_getInstanceMethod(UIApplication.self, #selector(UIApplication.sendAction(_:to:from:for:))),
              let observedApplicationAction = class_getInstanceMethod(UIApplication.self, #selector(UIApplication.praeludeAuditSendAction(_:to:from:for:))),
              let controlAction = class_getInstanceMethod(UIControl.self, #selector(UIControl.sendAction(_:to:for:))),
              let observedControlAction = class_getInstanceMethod(UIControl.self, #selector(UIControl.praeludeAuditSendAction(_:to:for:))),
              let primaryAction = class_getInstanceMethod(UIControl.self, #selector(UIControl.sendAction(_:))),
              let observedPrimaryAction = class_getInstanceMethod(UIControl.self, #selector(UIControl.praeludeAuditSendPrimaryAction(_:))) else { return }
        writer.prepare(at: fileURL)
        method_exchangeImplementations(original, observed)
        method_exchangeImplementations(applicationAction, observedApplicationAction)
        method_exchangeImplementations(controlAction, observedControlAction)
        method_exchangeImplementations(primaryAction, observedPrimaryAction)
        installed = true
        isEnabled = true
        record("audit.enabled")
        heartbeatTask = Task { @MainActor in
            while isEnabled {
                do { try await Task.sleep(for: .milliseconds(500)) } catch { return }
                guard isEnabled else { return }
                heartbeatCount += 1
                record("heartbeat count=\(heartbeatCount) appState=\(UIApplication.shared.applicationState.rawValue)")
            }
        }
    }

    static func record(_ message: String) {
        guard isEnabled else { return }
        if isPassiveReadingDelivery {
            let stage: String
            if message.hasPrefix("pdf reading.") {
                stage = String(message.dropFirst(4).prefix(1_200))
            } else if message.hasPrefix("score.reading.") {
                stage = String(message.prefix(1_200))
            } else { return }
            passiveReadingEvents.append(stage)
            let limit = isReadingLifecycleEnabled || isReadingWindowEnabled ? 128 : 64
            if passiveReadingEvents.count > limit { passiveReadingEvents.removeFirst(passiveReadingEvents.count - limit) }
            return
        }
        sequence += 1
        // AX identifiers sometimes contain a record UUID. Never inspect accessibility labels,
        // and redact a UUID shape even if an identifier or caller accidentally includes one.
        let safe = String(message.prefix(1_200)).replacingOccurrences(
            of: "[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}",
            with: "<id>", options: .regularExpression)
        let entry: [String: Any] = ["pid": ProcessInfo.processInfo.processIdentifier,
                                    "sequence": sequence, "time": Date().timeIntervalSince1970,
                                    "uptime": ProcessInfo.processInfo.systemUptime, "event": safe]
        guard var data = try? JSONSerialization.data(withJSONObject: entry, options: [.sortedKeys]) else { return }
        data.append(0x0A)
        writer.append(data)
        NSLog("PraeludeInteractionAudit #%ld %@", sequence, safe)
    }

    /// Public touch state only. Reading this AX diagnostic never updates retained state or
    /// asks UIKit to deliver, cancel, recognize, hit-test or otherwise process an event.
    static var readingWindowDiagnostic: String {
        guard isReadingWindowEnabled else { return "" }
        let touches = readingWindowTouches.enumerated().map { index, retained in
            let touch = retained.touch
            let point = touch.location(in: touch.window)
            return "touch=\(index) type=\(touch.type.rawValue) beganAt=\(retained.beganAt ?? -1) beforePhase=\(retained.beforePhase.rawValue) afterPhase=\(retained.afterPhase.rawValue) beforeTime=\(retained.beforeTime) afterTime=\(retained.afterTime) currentPhase=\(touch.phase.rawValue) currentTime=\(touch.timestamp) x=\(point.x) y=\(point.y)"
        }.joined(separator: "|")
        return "forwarded=\(readingWindowForwardCount);retained=\(readingWindowTouches.count);touches=[\(touches)];appStates=[\(readingWindowGestureDiagnostic)]"
    }

    static func registerReadingWindowGesture(_ gesture: UIGestureRecognizer, role: String) {
        guard isReadingWindowEnabled, readingWindowRoles.contains(role) else { return }
        readingWindowGestures[role] = WeakReadingWindowGesture(gesture)
    }

    private static var readingWindowGestureDiagnostic: String {
        readingWindowRoles.map { role in
            guard let gesture = readingWindowGestures[role]?.value else { return "\(role):missing" }
            return "\(role):state=\(gesture.state.rawValue),enabled=\(gesture.isEnabled)"
        }.joined(separator: "|")
    }

    fileprivate static func readingWindowBeforeForward(_ event: UIEvent, in window: UIWindow) -> [ReadingWindowSnapshot] {
        guard isReadingWindowEnabled, event.type == .touches else { return [] }
        // Only primitive touch fields are sampled before forwarding. No recognizer/view
        // reflection, strings, memory log append or event mutation happens on this path.
        return (event.allTouches ?? []).prefix(4).map {
            ReadingWindowSnapshot(touch: $0, phase: $0.phase, type: $0.type,
                                  timestamp: $0.timestamp, point: $0.location(in: window),
                                  sameWindow: $0.window === window, keyWindow: window.isKeyWindow,
                                  sceneState: window.windowScene?.activationState.rawValue ?? -1)
        }
    }

    fileprivate static func readingWindowAfterForward(_ snapshots: [ReadingWindowSnapshot]) {
        guard isReadingWindowEnabled, !snapshots.isEmpty else { return }
        readingWindowForwardCount += 1
        for before in snapshots {
            let index = readingWindowTouches.firstIndex { $0.touch === before.touch }
            let beganAt = before.phase == .began ? before.timestamp : index.flatMap { readingWindowTouches[$0].beganAt }
            let afterPhase = before.touch.phase
            let afterTime = before.touch.timestamp
            let terminal = before.phase == .ended || before.phase == .cancelled || afterPhase == .ended || afterPhase == .cancelled
            let endDelta = terminal ? beganAt.map { before.timestamp - $0 } ?? -1 : -1
            let retained = RetainedReadingWindowTouch(touch: before.touch, beganAt: beganAt,
                beforePhase: before.phase, afterPhase: afterPhase, beforeTime: before.timestamp, afterTime: afterTime)
            if let index { readingWindowTouches[index] = retained }
            else {
                if readingWindowTouches.count == 4 { readingWindowTouches.removeFirst() }
                readingWindowTouches.append(retained)
            }
            // Class/state inspection is deliberately limited to terminal touches and only
            // runs after the original UIWindow implementation has received the same event.
            let recognizers = terminal ? (before.touch.gestureRecognizers ?? []).prefix(24).map {
                "\(NSStringFromClass(type(of: $0))):\($0.state.rawValue)"
            }.joined(separator: ",") : ""
            let appStates = before.phase == .began || terminal ? readingWindowGestureDiagnostic : ""
            record("pdf reading.window beforePhase=\(before.phase.rawValue) afterPhase=\(afterPhase.rawValue) type=\(before.type.rawValue) beforeTime=\(before.timestamp) afterTime=\(afterTime) x=\(before.point.x) y=\(before.point.y) endDelta=\(endDelta) sameWindow=\(before.sameWindow) keyWindow=\(before.keyWindow) scene=\(before.sceneState) appState=\(UIApplication.shared.applicationState.rawValue) appStates=[\(appStates)] recognizers=[\(recognizers)]")
        }
    }

    fileprivate static func observe(_ event: UIEvent, in window: UIWindow) {
        guard isEnabled, event.type == .touches else { return }
        for touch in event.allTouches ?? [] {
            let phase: String
            switch touch.phase {
            case .began: phase = "began"
            case .ended: phase = "ended"
            case .cancelled: phase = "cancelled"
            default: continue
            }
            let point = touch.location(in: window)
            var ancestry: [String] = []
            var current = touch.view
            while let view = current, ancestry.count < 14 {
                let identifier = view.accessibilityIdentifier.map { "[\(String($0.prefix(100)))]" } ?? ""
                ancestry.append("\(String(describing: type(of: view)))\(identifier)")
                current = view.superview
            }
            let sceneState = window.windowScene?.activationState.rawValue ?? -1
            record("touch.\(phase) type=\(touch.type.rawValue) taps=\(touch.tapCount) x=\(point.x) y=\(point.y) keyWindow=\(window.isKeyWindow) scene=\(sceneState) sameWindow=\(touch.window === window) ancestry=\(ancestry.joined(separator: ">"))")
        }
    }

    fileprivate static func observeRecognizers(_ event: UIEvent) {
        guard isEnabled, event.type == .touches else { return }
        // Detailed reflection/logging happens only after the final touch has forwarded, so
        // diagnostics do not delay its subsequent UP event while recognition is undecided.
        for touch in event.allTouches ?? [] where touch.phase == .ended || touch.phase == .cancelled {
            for recognizer in (touch.gestureRecognizers ?? []).prefix(32) {
                record("gesture.touch phase=\(touch.phase.rawValue) recognizer=\(NSStringFromClass(type(of: recognizer))) state=\(recognizer.state.rawValue) enabled=\(recognizer.isEnabled) cancels=\(recognizer.cancelsTouchesInView) delaysBegan=\(recognizer.delaysTouchesBegan) delaysEnded=\(recognizer.delaysTouchesEnded)")
            }
            var view = touch.view
            var depth = 0
            while let current = view, depth < 28 {
                for recognizer in (current.gestureRecognizers ?? []).prefix(8) {
                    record("gesture.snapshot phase=\(touch.phase.rawValue) depth=\(depth) view=\(NSStringFromClass(type(of: current))) recognizer=\(NSStringFromClass(type(of: recognizer))) state=\(recognizer.state.rawValue) enabled=\(recognizer.isEnabled) cancels=\(recognizer.cancelsTouchesInView) delaysBegan=\(recognizer.delaysTouchesBegan) delaysEnded=\(recognizer.delaysTouchesEnded)")
                }
                view = current.superview; depth += 1
            }
        }
    }

    static func recordNativeNavigation(_ phase: String) {
        guard isEnabled else { return }
        for window in UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene })
            .flatMap(\.windows).filter(\.isKeyWindow) {
            var queue = window.rootViewController.map { [$0] } ?? []
            var seen = Set<ObjectIdentifier>()
            while !queue.isEmpty, seen.count < 48 {
                let controller = queue.removeFirst()
                guard seen.insert(ObjectIdentifier(controller)).inserted else { continue }
                if let split = controller as? UISplitViewController {
                    record("native.split phase=\(phase) mode=\(split.displayMode.rawValue) preferred=\(split.preferredDisplayMode.rawValue) collapsed=\(split.isCollapsed) presented=\(split.presentedViewController != nil) transitioning=\(split.transitionCoordinator != nil)")
                }
                if let navigation = controller as? UINavigationController,
                   let top = navigation.topViewController {
                    let items = top.navigationItem.leftBarButtonItems ?? []
                    record("native.navigation phase=\(phase) top=\(String(describing: type(of: top))) presented=\(navigation.presentedViewController != nil) transitioning=\(navigation.transitionCoordinator != nil) leftItems=\(items.count)")
                    for item in items {
                        let targetType = item.target.map { String(describing: type(of: $0)) } ?? "nil"
                        record("native.barItem phase=\(phase) action=\(item.action.map(NSStringFromSelector) ?? "nil") target=\(targetType) primary=\(item.primaryAction != nil) enabled=\(item.isEnabled)")
                    }
                }
                queue.append(contentsOf: controller.children)
                if let presented = controller.presentedViewController { queue.append(presented) }
            }
        }
    }
}

fileprivate extension UIWindow {
    @objc func praeludeReadingWindowSendEvent(_ event: UIEvent) {
        let before = InteractionAudit.readingWindowBeforeForward(event, in: self)
        // After exchange this selector is the original implementation. Every event,
        // including non-touch events, is forwarded synchronously and exactly once.
        praeludeReadingWindowSendEvent(event)
        InteractionAudit.readingWindowAfterForward(before)
    }

    @objc func praeludeAuditSendEvent(_ event: UIEvent) {
        InteractionAudit.observe(event, in: self)
        let snapshotAfter = InteractionAudit.isEnabled && event.allTouches?.contains(where: {
            $0.phase == .ended || $0.phase == .cancelled
        }) == true
        // After exchange this selector is the original implementation, exactly once. No
        // recognizer, hit-test override, event replacement or deferred forwarding is added.
        praeludeAuditSendEvent(event)
        InteractionAudit.observeRecognizers(event)
        if snapshotAfter {
            Task { @MainActor in
                await Task.yield()
                InteractionAudit.recordNativeNavigation("touch.after")
                try? await Task.sleep(for: .milliseconds(400))
                InteractionAudit.recordNativeNavigation("touch.delayed")
            }
        }
    }
}

fileprivate extension UIApplication {
    @objc func praeludeAuditSendAction(_ action: Selector, to target: Any?, from sender: Any?, for event: UIEvent?) -> Bool {
        let targetType = target.map { String(describing: type(of: $0)) } ?? "nil"
        let senderType = sender.map { String(describing: type(of: $0)) } ?? "nil"
        InteractionAudit.record("action.application begin selector=\(NSStringFromSelector(action)) target=\(targetType) sender=\(senderType)")
        let handled = praeludeAuditSendAction(action, to: target, from: sender, for: event)
        InteractionAudit.record("action.application end selector=\(NSStringFromSelector(action)) handled=\(handled)")
        return handled
    }
}

fileprivate extension UIControl {
    @objc func praeludeAuditSendAction(_ action: Selector, to target: Any?, for event: UIEvent?) {
        let targetType = target.map { String(describing: type(of: $0)) } ?? "nil"
        InteractionAudit.record("action.control selector=\(NSStringFromSelector(action)) target=\(targetType) control=\(String(describing: type(of: self)))")
        praeludeAuditSendAction(action, to: target, for: event)
    }
    @objc func praeludeAuditSendPrimaryAction(_ action: UIAction) {
        InteractionAudit.record("action.control primary control=\(String(describing: type(of: self)))")
        praeludeAuditSendPrimaryAction(action)
    }
}

/// All file state is accessed only on `queue`. UIKit never waits for this bounded writer.
private final class InteractionAuditWriter: @unchecked Sendable {
    private let queue = DispatchQueue(label: "Praelude.InteractionAudit.writer", qos: .utility)
    private var url: URL?
    private var handle: FileHandle?
    private var byteCount = 0
    private var recent: [Data] = []
    private var recentBytes = 0
    private let fileLimit = 2 * 1_024 * 1_024
    private let retainedLimit = 512 * 1_024

    func prepare(at target: URL) {
        queue.async { [self] in
            do {
                var existing = Data()
                if FileManager.default.fileExists(atPath: target.path) {
                    let input = try FileHandle(forReadingFrom: target)
                    defer { try? input.close() }
                    let size = try input.seekToEnd()
                    let offset = size > UInt64(fileLimit) ? size - UInt64(retainedLimit) : 0
                    try input.seek(toOffset: offset)
                    existing = try input.readToEnd() ?? Data()
                    if offset > 0, let newline = existing.firstIndex(of: 0x0A) {
                        existing.removeSubrange(...newline)
                    }
                    if offset > 0 { try existing.write(to: target, options: .atomic) }
                } else { try Data().write(to: target, options: .atomic) }
                recent = existing.split(separator: 0x0A).suffix(1_024).map { Data($0) + Data([0x0A]) }
                recentBytes = recent.reduce(0) { $0 + $1.count }
                trimRecent()
                byteCount = existing.count
                url = target
                handle = try FileHandle(forWritingTo: target)
                try handle?.seekToEnd()
            } catch { reportWriteFailure(error) }
        }
    }

    func append(_ data: Data) {
        queue.async { [self] in
            guard let url, let handle else { return }
            recent.append(data); recentBytes += data.count
            trimRecent()
            do {
                if byteCount + data.count > fileLimit {
                    let retained = recent.reduce(into: Data()) { $0.append($1) }
                    try handle.close()
                    self.handle = nil
                    try retained.write(to: url, options: .atomic)
                    let replacement = try FileHandle(forWritingTo: url)
                    try replacement.seekToEnd()
                    self.handle = replacement; byteCount = retained.count
                } else {
                    try handle.write(contentsOf: data)
                    byteCount += data.count
                }
            } catch { reportWriteFailure(error) }
        }
    }

    private func trimRecent() {
        while recent.count > 1_024 || recentBytes > retainedLimit {
            recentBytes -= recent.removeFirst().count
        }
    }

    private func reportWriteFailure(_ error: Error) {
        let failure = error as NSError
        NSLog("PraeludeInteractionAudit writer failed domain=%@ code=%ld", failure.domain, failure.code)
    }
}

/// Opt-in recognizer diagnostics. All superclass callbacks execute exactly once and every
/// recognition/prevention result is returned unchanged. Normal and Release gestures use UIKit.
@MainActor private func recordReadingLifecycle(_ gesture: UIGestureRecognizer, role: String,
                                              stage: String, touches: Set<UITouch>? = nil,
                                              other: UIGestureRecognizer? = nil) {
    guard InteractionAudit.isReadingLifecycleEnabled else { return }
    let touch = touches?.first
    let dependencies = (gesture.view?.gestureRecognizers ?? []).compactMap { item -> String? in
        if let tap = item as? ReadingLifecycleTapGestureRecognizer { return "\(tap.auditRole):\(tap.state.rawValue)" }
        if let press = item as? ReadingLifecycleLongPressGestureRecognizer { return "\(press.auditRole):\(press.state.rawValue)" }
        return nil
    }.joined(separator: ",")
    InteractionAudit.record("pdf reading.lifecycle role=\(role) stage=\(stage) state=\(gesture.state.rawValue) time=\(ProcessInfo.processInfo.systemUptime) phase=\(touch?.phase.rawValue ?? -1) touchTime=\(touch?.timestamp ?? -1) count=\(touches?.count ?? 0) other=\(other.map { String(describing: type(of: $0)) } ?? "nil") otherState=\(other?.state.rawValue ?? -1) deps=\(dependencies)")
}

final class ReadingLifecycleTapGestureRecognizer: UITapGestureRecognizer {
    var auditRole = "tap"
    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
        recordReadingLifecycle(self, role: auditRole, stage: "began.before", touches: touches)
        super.touchesBegan(touches, with: event)
        recordReadingLifecycle(self, role: auditRole, stage: "began.after", touches: touches)
    }
    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) {
        recordReadingLifecycle(self, role: auditRole, stage: "ended.before", touches: touches)
        super.touchesEnded(touches, with: event)
        recordReadingLifecycle(self, role: auditRole, stage: "ended.after", touches: touches)
    }
    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) {
        recordReadingLifecycle(self, role: auditRole, stage: "cancelled.before", touches: touches)
        super.touchesCancelled(touches, with: event)
        recordReadingLifecycle(self, role: auditRole, stage: "cancelled.after", touches: touches)
    }
    override func reset() {
        recordReadingLifecycle(self, role: auditRole, stage: "reset.before")
        super.reset()
        recordReadingLifecycle(self, role: auditRole, stage: "reset.after")
    }
    override func canBePrevented(by other: UIGestureRecognizer) -> Bool {
        let result = super.canBePrevented(by: other)
        if result { recordReadingLifecycle(self, role: auditRole, stage: "canBePrevented.true", other: other) }
        return result
    }
    override func shouldRequireFailure(of other: UIGestureRecognizer) -> Bool {
        let result = super.shouldRequireFailure(of: other)
        if result { recordReadingLifecycle(self, role: auditRole, stage: "requiresFailure.true", other: other) }
        return result
    }
    override func shouldBeRequiredToFail(by other: UIGestureRecognizer) -> Bool {
        let result = super.shouldBeRequiredToFail(by: other)
        if result { recordReadingLifecycle(self, role: auditRole, stage: "requiredToFail.true", other: other) }
        return result
    }
}

final class ReadingLifecycleLongPressGestureRecognizer: UILongPressGestureRecognizer {
    var auditRole = "longPress"
    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
        recordReadingLifecycle(self, role: auditRole, stage: "began.before", touches: touches)
        super.touchesBegan(touches, with: event)
        recordReadingLifecycle(self, role: auditRole, stage: "began.after", touches: touches)
    }
    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) {
        recordReadingLifecycle(self, role: auditRole, stage: "ended.before", touches: touches)
        super.touchesEnded(touches, with: event)
        recordReadingLifecycle(self, role: auditRole, stage: "ended.after", touches: touches)
    }
    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) {
        recordReadingLifecycle(self, role: auditRole, stage: "cancelled.before", touches: touches)
        super.touchesCancelled(touches, with: event)
        recordReadingLifecycle(self, role: auditRole, stage: "cancelled.after", touches: touches)
    }
    override func reset() {
        recordReadingLifecycle(self, role: auditRole, stage: "reset.before")
        super.reset()
        recordReadingLifecycle(self, role: auditRole, stage: "reset.after")
    }
    override func canBePrevented(by other: UIGestureRecognizer) -> Bool {
        let result = super.canBePrevented(by: other)
        if result { recordReadingLifecycle(self, role: auditRole, stage: "canBePrevented.true", other: other) }
        return result
    }
    override func shouldRequireFailure(of other: UIGestureRecognizer) -> Bool {
        let result = super.shouldRequireFailure(of: other)
        if result { recordReadingLifecycle(self, role: auditRole, stage: "requiresFailure.true", other: other) }
        return result
    }
    override func shouldBeRequiredToFail(by other: UIGestureRecognizer) -> Bool {
        let result = super.shouldBeRequiredToFail(by: other)
        if result { recordReadingLifecycle(self, role: auditRole, stage: "requiredToFail.true", other: other) }
        return result
    }
}
#endif
