import Foundation

/// Deliberate gestures are explicit input from the player, never an assessment of playing.
enum FaceGesture: String, CaseIterable, Codable, Sendable, Identifiable {
    case nod, shake, grin, mouthOpen, eyesClosed
    var id: String { rawValue }
    var title: String {
        switch self {
        case .nod: "Nod"
        case .shake: "Shake head"
        case .grin: "Grin"
        case .mouthOpen: "Open mouth"
        case .eyesClosed: "Close both eyes"
        }
    }
    var instructions: String {
        switch self {
        case .nod: "Nod up or down, then return to your usual position."
        case .shake: "Turn to one side, then the other, and return to center."
        case .grin: "Widen your smile, hold it briefly, then relax."
        case .mouthOpen: "Open your mouth, hold it briefly, then close it."
        case .eyesClosed: "Close both eyes for at least 0.6 seconds, then open them. Ordinary blinks are ignored."
        }
    }
}
enum FaceGestureAction: String, CaseIterable, Codable, Sendable, Identifiable {
    case off, nextPage, previousPage, clean, sloppy, again
    var id: String { rawValue }
    var title: String {
        switch self {
        case .off: "Off"
        case .nextPage: "Next page"
        case .previousPage: "Previous page"
        case .clean: "Clean"
        case .sloppy: "Sloppy"
        case .again: "Again"
        }
    }
    var isVerdict: Bool { self == .clean || self == .sloppy || self == .again }
}
enum FaceGestureSensitivity: String, CaseIterable, Codable, Sendable, Identifiable {
    case easy, standard, deliberate
    var id: String { rawValue }
    var title: String {
        switch self { case .easy: "Easy"; case .standard: "Standard"; case .deliberate: "Deliberate" }
    }
    fileprivate var thresholdScale: Double {
        switch self { case .easy: 0.78; case .standard: 1; case .deliberate: 1.22 }
    }
}
struct FaceGestureSettings: Codable, Equatable, Sendable {
    // Keep the original keys and defaults when reading existing ios.faceGestures data.
    var nod: FaceGestureAction = .clean
    var shake: FaceGestureAction = .sloppy
    var grin: FaceGestureAction = .nextPage
    var mouthOpen: FaceGestureAction = .off
    var eyesClosed: FaceGestureAction = .off
    var allowVerdicts = false
    var sensitivity: FaceGestureSensitivity = .standard
    var holdDuration: TimeInterval = 0.4
    var cooldown: TimeInterval = 1.25
    init() {}

    private enum CodingKeys: String, CodingKey {
        case nod, shake, grin, mouthOpen, eyesClosed, allowVerdicts, sensitivity, holdDuration, cooldown
    }
    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        nod = try values.decodeIfPresent(FaceGestureAction.self, forKey: .nod) ?? .clean
        shake = try values.decodeIfPresent(FaceGestureAction.self, forKey: .shake) ?? .sloppy
        grin = try values.decodeIfPresent(FaceGestureAction.self, forKey: .grin) ?? .nextPage
        mouthOpen = try values.decodeIfPresent(FaceGestureAction.self, forKey: .mouthOpen) ?? .off
        eyesClosed = try values.decodeIfPresent(FaceGestureAction.self, forKey: .eyesClosed) ?? .off
        allowVerdicts = try values.decodeIfPresent(Bool.self, forKey: .allowVerdicts) ?? false
        sensitivity = try values.decodeIfPresent(FaceGestureSensitivity.self, forKey: .sensitivity) ?? .standard
        holdDuration = Self.bounded(try values.decodeIfPresent(Double.self, forKey: .holdDuration) ?? 0.4,
                                    in: 0.2...1.2, fallback: 0.4)
        cooldown = Self.bounded(try values.decodeIfPresent(Double.self, forKey: .cooldown) ?? 1.25,
                                in: 0.5...3, fallback: 1.25)
        // Old expression-first settings could assign one command several times. Keep the
        // first assignment in the original gesture order, making the command-first editor exact.
        var seen: Set<FaceGestureAction> = []
        for gesture in FaceGesture.allCases {
            let action = action(for: gesture)
            if action != .off && !seen.insert(action).inserted { setAction(.off, for: gesture) }
        }
    }
    func action(for gesture: FaceGesture) -> FaceGestureAction {
        switch gesture {
        case .nod: nod
        case .shake: shake
        case .grin: grin
        case .mouthOpen: mouthOpen
        case .eyesClosed: eyesClosed
        }
    }
    func gesture(for action: FaceGestureAction) -> FaceGesture? {
        guard action != .off else { return nil }
        return FaceGesture.allCases.first { self.action(for: $0) == action }
    }
    /// Moving an expression to another command clears its previous assignment explicitly.
    /// Each command has at most one expression and each expression at most one command.
    mutating func assign(_ gesture: FaceGesture?, to action: FaceGestureAction) {
        for existing in FaceGesture.allCases where self.action(for: existing) == action && action != .off {
            setAction(.off, for: existing)
        }
        if let gesture { setAction(action, for: gesture) }
    }
    fileprivate var effectiveHoldDuration: TimeInterval {
        Self.bounded(holdDuration, in: 0.2...1.2, fallback: 0.4)
    }
    fileprivate var effectiveCooldown: TimeInterval {
        Self.bounded(cooldown, in: 0.5...3, fallback: 1.25)
    }
    private static func bounded(_ value: Double, in range: ClosedRange<Double>, fallback: Double) -> Double {
        value.isFinite ? min(range.upperBound, max(range.lowerBound, value)) : fallback
    }
    private mutating func setAction(_ action: FaceGestureAction, for gesture: FaceGesture) {
        switch gesture {
        case .nod: nod = action
        case .shake: shake = action
        case .grin: grin = action
        case .mouthOpen: mouthOpen = action
        case .eyesClosed: eyesClosed = action
        }
    }
}
struct FaceGestureSample: Sendable {
    var time: TimeInterval
    /// Vision head pose in radians. NaN means unavailable, not that the face is absent.
    var pitch: Double
    var yaw: Double
    /// Lip width / inter-eye distance. A missing measurement may be NaN.
    var smileWidth: Double
    var luminance: Double
    var confidence: Double
    var faceCount: Int
    var faceArea: Double
    /// Inner-lip height / inter-eye distance; eye height / its own width.
    var mouthOpen: Double? = nil
    var leftEyeOpen: Double? = nil
    var rightEyeOpen: Double? = nil
    /// Visibility is independent of optional landmarks and pose. A small face can still have
    /// sound measurements; gesture-specific calibration decides which inputs are usable.
    var usable: Bool {
        [time, luminance, confidence, faceArea].allSatisfy(\.isFinite)
            && faceCount == 1 && luminance >= 0.025 && luminance <= 1
            && confidence >= 0.45 && confidence <= 1 && faceArea >= 0.006 && faceArea <= 1
    }
    fileprivate var measuredPitch: Double? { Self.valid(pitch, in: -.pi ... .pi) }
    fileprivate var measuredYaw: Double? { Self.valid(yaw, in: -.pi ... .pi) }
    fileprivate var measuredSmile: Double? { Self.valid(smileWidth, in: 0.05...2.5) }
    fileprivate var measuredMouth: Double? { mouthOpen.flatMap { Self.valid($0, in: 0...2) } }
    fileprivate var measuredLeftEye: Double? { leftEyeOpen.flatMap { Self.valid($0, in: 0...1) } }
    fileprivate var measuredRightEye: Double? { rightEyeOpen.flatMap { Self.valid($0, in: 0...1) } }
    private static func valid(_ value: Double, in range: ClosedRange<Double>) -> Double? {
        value.isFinite && range.contains(value) ? value : nil
    }
}
struct FaceGestureBaseline: Sendable, Equatable {
    let pitch: Double?
    let yaw: Double?
    let smileWidth: Double?
    let mouthOpen: Double?
    let leftEyeOpen: Double?
    let rightEyeOpen: Double?
}
struct FaceGestureDetector: Sendable {
    private(set) var baseline: FaceGestureBaseline?
    private var settings = FaceGestureSettings()
    private var neutralSince: TimeInterval?
    private var lastTime: TimeInterval?
    private var cooldownUntil: TimeInterval = 0
    private var armed = false
    private struct Excursion: Sendable {
        let gesture: FaceGesture
        let start: TimeInterval
        let direction: Double
        var evidenceCount = 1
        var holdSince: TimeInterval?
        var qualified = false
    }
    private var excursion: Excursion?

    var availableGestures: Set<FaceGesture> {
        guard let baseline else { return [] }
        var result: Set<FaceGesture> = []
        if baseline.pitch != nil { result.insert(.nod) }
        if baseline.yaw != nil { result.insert(.shake) }
        if baseline.smileWidth != nil { result.insert(.grin) }
        if baseline.mouthOpen != nil { result.insert(.mouthOpen) }
        if let left = baseline.leftEyeOpen, let right = baseline.rightEyeOpen, left >= 0.12, right >= 0.12 {
            result.insert(.eyesClosed)
        }
        return result
    }
    private var assignedGestures: Set<FaceGesture> {
        availableGestures.filter { settings.action(for: $0) != .off }
    }
    mutating func configure(settings: FaceGestureSettings) {
        guard settings != self.settings else { return }
        self.settings = settings
        resetMotion()
    }
    /// Calibrate each metric independently over a recent stable second. Losing a lip landmark
    /// cannot disable head gestures, and missing pitch cannot disable facial expressions.
    mutating func calibrate(_ samples: [FaceGestureSample]) -> Bool {
        clearCalibration()
        guard samples.count >= 8, let first = samples.first, let last = samples.last,
              last.time - first.time >= 0.8, last.time - first.time <= 2.5,
              zip(samples, samples.dropFirst()).allSatisfy({ $1.time > $0.time && $1.time - $0.time <= 0.35 }),
              samples.allSatisfy(\.usable) else { return false }
        baseline = FaceGestureBaseline(
            pitch: stableMedian(samples.map(\.measuredPitch), spread: 0.12),
            yaw: stableMedian(samples.map(\.measuredYaw), spread: 0.12),
            smileWidth: stableMedian(samples.map(\.measuredSmile), spread: 0.10),
            mouthOpen: stableMedian(samples.map(\.measuredMouth), spread: 0.08),
            leftEyeOpen: stableMedian(samples.map(\.measuredLeftEye), spread: 0.10),
            rightEyeOpen: stableMedian(samples.map(\.measuredRightEye), spread: 0.10))
        guard !availableGestures.isEmpty else { baseline = nil; return false }
        resetMotion()
        lastTime = nil
        return true
    }
    /// Recover a metric that Vision initially omitted without moving an established neutral.
    /// The caller rate-limits retries; only a fresh window relaxed against the OLD baseline
    /// may add measurements. A held expression cannot silently become the new neutral.
    @discardableResult
    mutating func supplementCalibration(_ samples: [FaceGestureSample]) -> Bool {
        guard let original = baseline, let last = samples.last,
              lastTime.map({ last.time >= $0 }) ?? true,
              samples.allSatisfy({ sample in
                  func close(_ measured: Double?, to neutral: Double?, tolerance: Double) -> Bool {
                      guard let neutral else { return true }
                      guard let measured else { return false }
                      return abs(measured - neutral) < tolerance
                  }
                  return close(sample.measuredPitch, to: original.pitch, tolerance: pitchThreshold * 0.5)
                      && close(sample.measuredYaw, to: original.yaw, tolerance: yawThreshold * 0.45)
                      && close(sample.measuredSmile, to: original.smileWidth, tolerance: smileThreshold * 0.6)
                      && close(sample.measuredMouth, to: original.mouthOpen, tolerance: mouthThreshold * 0.45)
                      && close(sample.measuredLeftEye, to: original.leftEyeOpen,
                               tolerance: max(0.001, (original.leftEyeOpen ?? 0) * 0.28))
                      && close(sample.measuredRightEye, to: original.rightEyeOpen,
                               tolerance: max(0.001, (original.rightEyeOpen ?? 0) * 0.28))
              }) else { return false }
        var incoming = FaceGestureDetector()
        guard incoming.calibrate(samples), let additions = incoming.baseline else { return false }
        let previousAvailability = availableGestures
        baseline = FaceGestureBaseline(
            pitch: original.pitch ?? additions.pitch,
            yaw: original.yaw ?? additions.yaw,
            smileWidth: original.smileWidth ?? additions.smileWidth,
            mouthOpen: original.mouthOpen ?? additions.mouthOpen,
            leftEyeOpen: original.leftEyeOpen ?? additions.leftEyeOpen,
            rightEyeOpen: original.rightEyeOpen ?? additions.rightEyeOpen)
        let expanded = availableGestures != previousAvailability
        if expanded { resetMotion() }
        return expanded
    }
    mutating func clearCalibration() { baseline = nil; resetMotion(); lastTime = nil }
    mutating func resetMotion() { excursion = nil; armed = false; neutralSince = nil }

    mutating func consume(_ sample: FaceGestureSample) -> FaceGesture? {
        defer { lastTime = sample.time }
        guard let baseline, sample.usable,
              lastTime.map({ sample.time > $0 && sample.time - $0 <= 0.35 }) ?? true else {
            resetMotion(); return nil
        }
        guard sample.time >= cooldownUntil else { resetMotion(); return nil }
        let measurements = Measurements(sample: sample, baseline: baseline)
        let assigned = assignedGestures
        let present = assigned.filter { measurements.has($0) }
        guard !present.isEmpty else { resetMotion(); return nil }
        let neutral = present.allSatisfy { isNeutral($0, measurements) }
        if !armed {
            if neutral {
                neutralSince = neutralSince ?? sample.time
                if sample.time - neutralSince! >= 0.45 { armed = true }
            } else { neutralSince = nil }
            return nil
        }
        if var current = excursion {
            guard measurements.has(current.gesture),
                  sample.time - current.start <= max(2.4, settings.effectiveHoldDuration + 1.6),
                  !ambiguous(current.gesture, measurements, assigned: assigned) else {
                resetMotion(); return nil
            }
            switch current.gesture {
            case .nod:
                if let pitch = measurements.pitch, pitch * current.direction >= pitchThreshold * 0.65 {
                    current.evidenceCount += 1
                    current.qualified = current.evidenceCount >= 2 && sample.time - current.start >= 0.06
                }
            case .shake:
                if let yaw = measurements.yaw, yaw * current.direction <= -yawThreshold {
                    current.qualified = true
                }
            case .grin, .mouthOpen, .eyesClosed:
                if isActive(current.gesture, measurements, releasing: true) {
                    current.holdSince = current.holdSince ?? sample.time
                    if sample.time - current.holdSince! >= requiredHold(for: current.gesture) {
                        current.qualified = true
                    }
                } else if !current.qualified { current.holdSince = nil }
            }
            excursion = current
            if neutral {
                let minimumMotionTime: TimeInterval = current.gesture == .shake ? 0.24 : 0.18
                if current.qualified && sample.time - current.start >= minimumMotionTime {
                    cooldownUntil = sample.time + settings.effectiveCooldown
                    resetMotion()
                    return current.gesture
                }
                resetMotion()
            }
            return nil
        }
        var active = present.filter { isActive($0, measurements) }
        // Opening the jaw may also widen the lips. Prefer the specific opening measurement.
        if active.contains(.mouthOpen) { active.remove(.grin) }
        guard active.count == 1, let gesture = active.first else {
            if active.count > 1 { resetMotion() }
            return nil
        }
        guard !ambiguous(gesture, measurements, assigned: assigned) else { resetMotion(); return nil }
        let direction = gesture == .nod ? (measurements.pitch! >= 0 ? 1.0 : -1.0)
            : gesture == .shake ? (measurements.yaw! >= 0 ? 1.0 : -1.0) : 1.0
        excursion = Excursion(gesture: gesture, start: sample.time, direction: direction,
                              holdSince: gesture == .nod || gesture == .shake ? nil : sample.time)
        return nil
    }
    private var pitchThreshold: Double { 0.16 * settings.sensitivity.thresholdScale }
    private var yawThreshold: Double { 0.22 * settings.sensitivity.thresholdScale }
    private var smileThreshold: Double { 0.08 * settings.sensitivity.thresholdScale }
    private var mouthThreshold: Double { 0.13 * settings.sensitivity.thresholdScale }
    private var closedEyeRatio: Double {
        switch settings.sensitivity { case .easy: 0.50; case .standard: 0.42; case .deliberate: 0.34 }
    }
    private func requiredHold(for gesture: FaceGesture) -> TimeInterval {
        gesture == .eyesClosed ? max(0.6, settings.effectiveHoldDuration) : settings.effectiveHoldDuration
    }
    private func isNeutral(_ gesture: FaceGesture, _ m: Measurements) -> Bool {
        switch gesture {
        case .nod: m.pitch.map { abs($0) < pitchThreshold * 0.5 } ?? false
        case .shake: m.yaw.map { abs($0) < yawThreshold * 0.45 } ?? false
        case .grin: m.smile.map { $0 < smileThreshold * 0.6 } ?? false
        case .mouthOpen: m.mouth.map { $0 < mouthThreshold * 0.45 } ?? false
        case .eyesClosed:
            if let left = m.leftEye, let right = m.rightEye { left > 0.72 && right > 0.72 } else { false }
        }
    }
    private func isActive(_ gesture: FaceGesture, _ m: Measurements, releasing: Bool = false) -> Bool {
        let releaseScale = releasing ? 0.85 : 1.0
        switch gesture {
        case .nod: return m.pitch.map { abs($0) >= pitchThreshold } ?? false
        case .shake: return m.yaw.map { abs($0) >= yawThreshold } ?? false
        case .grin: return m.smile.map { $0 >= smileThreshold * releaseScale } ?? false
        case .mouthOpen: return m.mouth.map { $0 >= mouthThreshold * releaseScale } ?? false
        case .eyesClosed:
            guard let left = m.leftEye, let right = m.rightEye else { return false }
            return left <= closedEyeRatio && right <= closedEyeRatio
        }
    }
    private func ambiguous(_ gesture: FaceGesture, _ m: Measurements, assigned: Set<FaceGesture>) -> Bool {
        // Pose checks are optional. Vision can provide sound lip/eye landmarks without pitch.
        switch gesture {
        case .nod:
            if let yaw = m.yaw, abs(yaw) > yawThreshold { return true }
        case .shake:
            if let pitch = m.pitch, abs(pitch) > pitchThreshold * 1.2 { return true }
        case .grin, .mouthOpen, .eyesClosed:
            if let pitch = m.pitch, abs(pitch) > pitchThreshold * 1.3 { return true }
            if let yaw = m.yaw, abs(yaw) > yawThreshold * 1.2 { return true }
        }
        for other in assigned where other != gesture {
            if gesture == .mouthOpen && other == .grin { continue }
            if isActive(other, m) { return true }
        }
        return false
    }
    private func stableMedian(_ values: [Double?], spread: Double) -> Double? {
        let sorted = values.compactMap { $0 }.sorted()
        guard sorted.count >= max(6, Int(ceil(Double(values.count) * 0.75))) else { return nil }
        // Ignore an isolated landmark jump at either end, but reject sustained movement.
        let trim = sorted.count >= 10 ? 1 : 0
        guard sorted[sorted.count - 1 - trim] - sorted[trim] < spread else { return nil }
        let middle = sorted.count / 2
        return sorted.count.isMultiple(of: 2) ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
    }
    private struct Measurements {
        let pitch: Double?
        let yaw: Double?
        let smile: Double?
        let mouth: Double?
        let leftEye: Double?
        let rightEye: Double?
        init(sample: FaceGestureSample, baseline: FaceGestureBaseline) {
            func difference(_ measured: Double?, _ neutral: Double?) -> Double? {
                guard let measured, let neutral else { return nil }
                return measured - neutral
            }
            func ratio(_ measured: Double?, _ neutral: Double?) -> Double? {
                guard let measured, let neutral, neutral > 0 else { return nil }
                return measured / neutral
            }
            pitch = difference(sample.measuredPitch, baseline.pitch)
            yaw = difference(sample.measuredYaw, baseline.yaw)
            smile = difference(sample.measuredSmile, baseline.smileWidth)
            mouth = difference(sample.measuredMouth, baseline.mouthOpen)
            leftEye = ratio(sample.measuredLeftEye, baseline.leftEyeOpen)
            rightEye = ratio(sample.measuredRightEye, baseline.rightEyeOpen)
        }
        func has(_ gesture: FaceGesture) -> Bool {
            switch gesture {
            case .nod: pitch != nil
            case .shake: yaw != nil
            case .grin: smile != nil
            case .mouthOpen: mouth != nil
            case .eyesClosed: leftEye != nil && rightEye != nil
            }
        }
    }
}
