import Foundation

/// Deliberate gestures are explicit input from the player, never an assessment of playing.
enum FaceGesture: String, CaseIterable, Codable, Sendable, Identifiable {
    case lookRight, lookLeft, lookDown, nod, shake, grin, mouthOpen, eyesClosed
    var id: String { rawValue }
    var title: String {
        switch self {
        case .lookRight: "Look right"
        case .lookLeft: "Look left"
        case .lookDown: "Look down"
        case .nod: "Nod"
        case .shake: "Shake head"
        case .grin: "Grin"
        case .mouthOpen: "Open mouth"
        case .eyesClosed: "Close both eyes"
        }
    }
    var instructions: String {
        switch self {
        case .lookRight: "Turn your head slightly right. The command fires as you turn; center your head before another command."
        case .lookLeft: "Turn your head slightly left. The command fires as you turn; center your head before another command."
        case .lookDown: "Tip your head slightly down from your usual reading position. The command fires as you move; return to your reading position before another command."
        case .nod: "Nod up or down, then return to your usual position."
        case .shake: "Turn to one side, then the other, and return to center."
        case .grin: "Smile naturally, hold it briefly, then relax."
        case .mouthOpen: "Open your mouth, hold it briefly, then close it."
        case .eyesClosed: "Close both eyes for at least 0.6 seconds, then open them. Ordinary blinks are ignored."
        }
    }
    var isDirectional: Bool { self == .lookRight || self == .lookLeft || self == .lookDown }
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
    // Add directional input without replacing the existing expression choices or storage key.
    var lookRight: FaceGestureAction = .nextPage
    var lookLeft: FaceGestureAction = .previousPage
    var lookDown: FaceGestureAction = .clean
    var nod: FaceGestureAction = .off
    var shake: FaceGestureAction = .sloppy
    var grin: FaceGestureAction = .off
    var mouthOpen: FaceGestureAction = .off
    var eyesClosed: FaceGestureAction = .off
    var allowVerdicts = false
    var sensitivity: FaceGestureSensitivity = .standard
    var holdDuration: TimeInterval = 0.4
    var cooldown: TimeInterval = 1.25
    var directionCooldown: TimeInterval = 0.4
    private(set) var directionalMappingVersion = 1
    init() {}

    private enum CodingKeys: String, CodingKey {
        case lookRight, lookLeft, lookDown, nod, shake, grin, mouthOpen, eyesClosed, allowVerdicts, sensitivity, holdDuration, cooldown, directionCooldown, directionalMappingVersion
    }
    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        lookRight = try values.decodeIfPresent(FaceGestureAction.self, forKey: .lookRight) ?? .off
        lookLeft = try values.decodeIfPresent(FaceGestureAction.self, forKey: .lookLeft) ?? .off
        lookDown = try values.decodeIfPresent(FaceGestureAction.self, forKey: .lookDown) ?? .off
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
        directionCooldown = Self.bounded(try values.decodeIfPresent(Double.self, forKey: .directionCooldown) ?? 0.4,
                                         in: 0.25...1, fallback: 0.4)
        let version = try values.decodeIfPresent(Int.self, forKey: .directionalMappingVersion) ?? 0
        directionalMappingVersion = max(1, version)
        // The player requested directional page turns. Migrate once, preserving the nod's
        // chosen verdict and every other verdict/expression and recognition preference.
        if version < 1 && !values.contains(.lookRight) && !values.contains(.lookLeft) && !values.contains(.lookDown) {
            let downVerdict = nod.isVerdict ? nod : .off
            assign(.lookRight, to: .nextPage)
            assign(.lookLeft, to: .previousPage)
            if downVerdict != .off { assign(.lookDown, to: downVerdict) }
        }
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
        case .lookRight: lookRight
        case .lookLeft: lookLeft
        case .lookDown: lookDown
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
    /// Retain legacy assignments for later use, but make competing head inputs explicit.
    var suspendedGestures: Set<FaceGesture> {
        var result: Set<FaceGesture> = []
        if lookRight != .off || lookLeft != .off { result.insert(.shake) }
        if lookDown != .off { result.insert(.nod) }
        return result
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
    fileprivate var effectiveDirectionCooldown: TimeInterval {
        Self.bounded(directionCooldown, in: 0.25...1, fallback: 0.4)
    }
    private static func bounded(_ value: Double, in range: ClosedRange<Double>, fallback: Double) -> Double {
        value.isFinite ? min(range.upperBound, max(range.lowerBound, value)) : fallback
    }
    private mutating func setAction(_ action: FaceGestureAction, for gesture: FaceGesture) {
        switch gesture {
        case .lookRight: lookRight = action
        case .lookLeft: lookLeft = action
        case .lookDown: lookDown = action
        case .nod: nod = action
        case .shake: shake = action
        case .grin: grin = action
        case .mouthOpen: mouthOpen = action
        case .eyesClosed: eyesClosed = action
        }
    }
}
enum FaceGesturePoseSource: String, Sendable { case unspecified, arkit, vision }
struct FaceGestureSample: Sendable {
    var time: TimeInterval
    /// Camera-relative radians in displayed orientation: positive pitch is down and positive
    /// yaw is the player's right. NaN means unavailable, not that the face is absent.
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
    /// Vision mouth-corner elevation / inter-eye distance; bilateral ARKit smile strength.
    var smileLift: Double? = nil
    var smileStrength: Double? = nil
    var poseSource: FaceGesturePoseSource = .unspecified
    /// Visibility is independent of optional landmarks and pose. A small face can still have
    /// sound measurements; gesture-specific calibration decides which inputs are usable.
    var usable: Bool {
        [time, luminance, confidence, faceArea].allSatisfy(\.isFinite)
            && faceCount == 1 && luminance >= 0.025 && luminance <= 1
            && confidence >= 0.45 && confidence <= 1 && faceArea >= 0.002 && faceArea <= 1
    }
    // Small, tracked faces can provide stable head pose before lip/eye pixels are reliable.
    // ARKit supplies measured blend coefficients rather than small 2D landmark ratios.
    private var expressionMeasurementsReliable: Bool { poseSource == .arkit || faceArea >= 0.006 }
    fileprivate var measuredPitch: Double? { Self.valid(pitch, in: -.pi ... .pi) }
    fileprivate var measuredYaw: Double? { Self.valid(yaw, in: -.pi ... .pi) }
    fileprivate var measuredSmile: Double? { expressionMeasurementsReliable ? Self.valid(smileWidth, in: 0.05...2.5) : nil }
    fileprivate var measuredMouth: Double? { expressionMeasurementsReliable ? mouthOpen.flatMap { Self.valid($0, in: 0...2) } : nil }
    fileprivate var measuredLeftEye: Double? { expressionMeasurementsReliable ? leftEyeOpen.flatMap { Self.valid($0, in: 0...1) } : nil }
    fileprivate var measuredRightEye: Double? { expressionMeasurementsReliable ? rightEyeOpen.flatMap { Self.valid($0, in: 0...1) } : nil }
    fileprivate var measuredLift: Double? { expressionMeasurementsReliable ? smileLift.flatMap { Self.valid($0, in: -1...1) } : nil }
    fileprivate var measuredStrength: Double? { expressionMeasurementsReliable ? smileStrength.flatMap { Self.valid($0, in: 0...1) } : nil }
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
    let smileLift: Double?
    let smileStrength: Double?
}
struct FaceGestureDetector: Sendable {
    private(set) var baseline: FaceGestureBaseline?
    private var settings = FaceGestureSettings()
    private var neutralSince: [FaceGesture: TimeInterval] = [:]
    private var lastTime: TimeInterval?
    private var cooldownUntil: TimeInterval = 0
    private var directionCooldownUntil: TimeInterval = 0
    private var directionNeutralSince: [FaceGesture: TimeInterval] = [:]
    private var directionArmed: Set<FaceGesture> = []
    private var calibratedPoseSource: FaceGesturePoseSource?
    private struct DirectionalExcursion: Sendable {
        let gesture: FaceGesture
        let start: TimeInterval
        let originValue: Double
        let firstValue: Double
        var lastValid: TimeInterval
        var lastValue: Double
        var peak: Double
        var evidenceCount = 1
        var interrupted = false
    }
    private struct PoseObservation: Sendable {
        let time: TimeInterval
        let pitch: Double?
        let yaw: Double?
    }
    private var directionalExcursion: DirectionalExcursion?
    private var previousPose: PoseObservation?
    private var armed: Set<FaceGesture> = []
    private var pitchNoise = 0.0, yawNoise = 0.0, smileNoise = 0.0, liftNoise = 0.0, strengthNoise = 0.0
    private struct Excursion: Sendable {
        let gesture: FaceGesture
        let start: TimeInterval
        let direction: Double
        let initialPitch: Double?
        let initialYaw: Double?
        var lastValid: TimeInterval
        var evidenceCount = 1
        var peak = 0.0
        var oppositePeak = 0.0
        var peakTime: TimeInterval
        var oppositePeakTime: TimeInterval?
        var heldDuration: TimeInterval = 0
        var interrupted = false
        var qualified = false
    }
    private var excursions: [FaceGesture: Excursion] = [:]

    var availableGestures: Set<FaceGesture> {
        guard let baseline else { return [] }
        var result: Set<FaceGesture> = []
        if baseline.pitch != nil { result.formUnion([.nod, .lookDown]) }
        if baseline.yaw != nil { result.formUnion([.shake, .lookRight, .lookLeft]) }
        if baseline.smileWidth != nil || baseline.smileLift != nil || baseline.smileStrength != nil { result.insert(.grin) }
        if baseline.mouthOpen != nil { result.insert(.mouthOpen) }
        if let left = baseline.leftEyeOpen, let right = baseline.rightEyeOpen, left >= 0.12, right >= 0.12 {
            result.insert(.eyesClosed)
        }
        return result
    }
    private var assignedGestures: Set<FaceGesture> {
        var result = availableGestures.filter { settings.action(for: $0) != .off }
        // An onset turn cannot also finish a legacy shake/nod when the player centers again.
        result.subtract(settings.suspendedGestures)
        return result
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
        guard samples.count >= 5, let first = samples.first, let last = samples.last,
              last.time - first.time >= 0.65, last.time - first.time <= 2.5,
              zip(samples, samples.dropFirst()).allSatisfy({ $1.time > $0.time && $1.time - $0.time <= 0.5 }),
              samples.allSatisfy({ $0.poseSource == first.poseSource }),
              samples.allSatisfy(\.usable) else { return false }
        calibratedPoseSource = first.poseSource
        let yawValues = unwrappedYaw(samples.map(\.measuredYaw))
        baseline = FaceGestureBaseline(
            pitch: stableMedian(samples.map(\.measuredPitch), spread: 0.12),
            yaw: stableMedian(yawValues, spread: 0.12),
            smileWidth: stableMedian(samples.map(\.measuredSmile), spread: 0.10),
            mouthOpen: stableMedian(samples.map(\.measuredMouth), spread: 0.08),
            leftEyeOpen: stableMedian(samples.map(\.measuredLeftEye), spread: 0.10),
            rightEyeOpen: stableMedian(samples.map(\.measuredRightEye), spread: 0.10),
            smileLift: stableMedian(samples.map(\.measuredLift), spread: 0.06),
            smileStrength: stableMedian(samples.map(\.measuredStrength), spread: 0.10))
        guard !availableGestures.isEmpty else { baseline = nil; return false }
        pitchNoise = noise(samples.map(\.measuredPitch)); yawNoise = noise(yawValues)
        smileNoise = noise(samples.map(\.measuredSmile)); liftNoise = noise(samples.map(\.measuredLift))
        strengthNoise = noise(samples.map(\.measuredStrength))
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
              samples.allSatisfy({ $0.poseSource == calibratedPoseSource }),
              lastTime.map({ last.time >= $0 }) ?? true,
              samples.allSatisfy({ sample in
                  func close(_ measured: Double?, to neutral: Double?, tolerance: Double) -> Bool {
                      guard let neutral else { return true }
                      guard let measured else { return false }
                      return abs(measured - neutral) < tolerance
                  }
                  return close(sample.measuredPitch, to: original.pitch, tolerance: pitchThreshold * 0.5)
                      && close(sample.measuredYaw.map { value in
                          original.yaw.map { $0 + atan2(sin(value - $0), cos(value - $0)) } ?? value
                      }, to: original.yaw, tolerance: yawThreshold * 0.45)
                      && close(sample.measuredSmile, to: original.smileWidth, tolerance: smileThreshold * 0.6)
                      && close(sample.measuredLift, to: original.smileLift, tolerance: liftThreshold * 0.6)
                      && close(sample.measuredStrength, to: original.smileStrength, tolerance: strengthThreshold * 0.6)
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
            rightEyeOpen: original.rightEyeOpen ?? additions.rightEyeOpen,
            smileLift: original.smileLift ?? additions.smileLift,
            smileStrength: original.smileStrength ?? additions.smileStrength)
        if original.pitch == nil { pitchNoise = incoming.pitchNoise }
        if original.yaw == nil { yawNoise = incoming.yawNoise }
        if original.smileWidth == nil { smileNoise = incoming.smileNoise }
        if original.smileLift == nil { liftNoise = incoming.liftNoise }
        if original.smileStrength == nil { strengthNoise = incoming.strengthNoise }
        let expanded = availableGestures != previousAvailability
        if expanded { resetMotion() }
        return expanded
    }
    mutating func clearCalibration() { baseline = nil; calibratedPoseSource = nil; resetMotion(); lastTime = nil }
    mutating func resetMotion() {
        excursions.removeAll(keepingCapacity: true)
        armed.removeAll(keepingCapacity: true)
        neutralSince.removeAll(keepingCapacity: true)
        directionalExcursion = nil
        directionArmed.removeAll(keepingCapacity: true)
        directionNeutralSince.removeAll(keepingCapacity: true)
        previousPose = nil
    }

    mutating func consume(_ sample: FaceGestureSample) -> FaceGesture? {
        guard sample.time.isFinite else { resetMotion(); lastTime = nil; return nil }
        defer { lastTime = sample.time }
        guard let baseline,
              lastTime.map({ sample.time > $0 && sample.time - $0 <= 0.55 }) ?? true else {
            resetMotion(); return nil
        }
        guard sample.poseSource == calibratedPoseSource else { clearCalibration(); return nil }
        guard sample.usable else {
            // Disappearance never supplies a direction or dispatches a command. Keep only a
            // measured, signed onset through a short loss; reacquisition must confirm it.
            if sample.faceCount == 0, sample.luminance.isFinite, (0.025...1).contains(sample.luminance),
               sample.confidence.isFinite, sample.faceArea.isFinite,
               retainDirectionalLoss(at: sample.time) {
                excursions.removeAll(keepingCapacity: true)
                armed.removeAll(keepingCapacity: true)
                neutralSince.removeAll(keepingCapacity: true)
                directionArmed.removeAll(keepingCapacity: true)
                directionNeutralSince.removeAll(keepingCapacity: true)
            } else { resetMotion() }
            return nil
        }
        let m = Measurements(sample: sample, baseline: baseline)
        let assigned = assignedGestures
        if let direction = consumeDirection(sample, measurements: m, assigned: assigned) {
            directionCooldownUntil = sample.time + settings.effectiveDirectionCooldown
            cooldownUntil = max(cooldownUntil, directionCooldownUntil)
            resetMotion()
            return direction
        }
        var completed: [FaceGesture] = []
        for gesture in FaceGesture.allCases where assigned.contains(gesture) && !gesture.isDirectional {
            guard m.has(gesture) else {
                // A single missing landmark must not discard a complete head trajectory.
                // It contributes no hold evidence and a prolonged loss revokes this gesture.
                if var track = excursions[gesture] {
                    if sample.time - track.lastValid > 0.32 { revoke(gesture) }
                    else { track.interrupted = true; excursions[gesture] = track }
                } else { neutralSince[gesture] = nil }
                continue
            }
            let neutral = isNeutral(gesture, m)
            if !armed.contains(gesture) {
                if neutral {
                    neutralSince[gesture] = neutralSince[gesture] ?? sample.time
                    if sample.time - neutralSince[gesture]! >= 0.25 { armed.insert(gesture) }
                } else { neutralSince[gesture] = nil }
                continue
            }
            // Neutral rearming proceeds during cooldown, so cooldown does not secretly add
            // another calibration pause. No new excursion may start before it expires.
            guard sample.time >= cooldownUntil else { continue }
            if var track = excursions[gesture] {
                let duration = sample.time - track.start
                let limit = gesture == .nod || gesture == .shake ? 1.8 : max(2.4, settings.effectiveHoldDuration + 1.6)
                guard duration <= limit, !crossAxisMotion(track, m) else { revoke(gesture); continue }
                let dt = track.interrupted ? 0 : min(0.25, sample.time - track.lastValid)
                track.interrupted = false
                track.lastValid = sample.time
                var returned = neutral
                switch gesture {
                case .lookRight, .lookLeft, .lookDown: break // handled by the onset detector
                case .nod:
                    let value = m.pitch! * track.direction
                    if value > track.peak { track.peak = value; track.peakTime = sample.time }
                    if value >= pitchThreshold * 0.45 { track.evidenceCount += 1 }
                    // Two trajectory samples may straddle the peak. Requiring two frames
                    // above a hard threshold rejects natural quick nods at camera frame rates.
                    if track.peak >= pitchThreshold, track.evidenceCount >= 2,
                       duration >= 0.08, track.peakTime - track.start <= 0.7 { track.qualified = true }
                    returned = abs(m.pitch!) <= max(pitchThreshold * 0.5, track.peak * 0.4)
                        && sample.time > track.peakTime
                case .shake:
                    let value = m.yaw! * track.direction
                    if value > track.peak { track.peak = value; track.peakTime = sample.time }
                    if -value > track.oppositePeak {
                        track.oppositePeak = -value; track.oppositePeakTime = sample.time
                    }
                    // Natural shakes are asymmetric. Require both sides and a meaningful
                    // total sweep, rather than identical absolute angles on both sides.
                    track.qualified = track.peak >= yawThreshold * 0.8
                        && track.oppositePeak >= yawThreshold * 0.45
                        && track.peak + track.oppositePeak >= yawThreshold * 1.55
                        && duration >= 0.24
                    returned = track.oppositePeakTime.map { sample.time > $0 } ?? false
                    returned = returned && abs(m.yaw!) <= max(yawThreshold * 0.35, track.oppositePeak * 0.5)
                case .grin, .mouthOpen, .eyesClosed:
                    let strength = activation(gesture, m)
                    track.peak = max(track.peak, strength)
                    if strength >= 0.65 { track.heldDuration += dt }
                    else if !neutral && !track.qualified { track.heldDuration = 0 }
                    track.qualified = track.qualified || (track.peak >= 1 && track.heldDuration >= requiredHold(for: gesture))
                }
                excursions[gesture] = track
                if returned {
                    let minimumDuration = gesture == .shake ? 0.24 : 0.18
                    if track.qualified && duration >= minimumDuration { completed.append(gesture) }
                    if gesture != .shake || track.qualified { revoke(gesture) }
                }
                continue
            }
            guard activation(gesture, m) >= 0.55 else { continue }
            let direction = gesture == .nod ? (m.pitch! >= 0 ? 1.0 : -1.0)
                : gesture == .shake ? (m.yaw! >= 0 ? 1.0 : -1.0) : 1.0
            let peak = gesture == .nod ? abs(m.pitch!) : gesture == .shake ? abs(m.yaw!) : activation(gesture, m)
            excursions[gesture] = Excursion(gesture: gesture, start: sample.time, direction: direction,
                initialPitch: m.pitch, initialYaw: m.yaw, lastValid: sample.time, peak: peak, peakTime: sample.time)
        }
        // A smile commonly accompanies an intentional nod. A completed head trajectory
        // has the stronger intent evidence and must produce one command rather than vanish.
        let headGestures = completed.filter { $0 == .nod || $0 == .shake }
        if headGestures.count == 1 { completed = headGestures }
        if completed.contains(.mouthOpen) { completed.removeAll { $0 == .grin } }
        guard !completed.isEmpty else { return nil }
        cooldownUntil = sample.time + settings.effectiveCooldown
        directionCooldownUntil = sample.time + settings.effectiveDirectionCooldown
        resetMotion()
        // Simultaneously completed explicit gestures are ambiguous, never two verdicts.
        return completed.count == 1 ? completed[0] : nil
    }
    private func directionalValue(_ gesture: FaceGesture, _ m: Measurements) -> Double? {
        switch gesture {
        case .lookRight: m.yaw
        case .lookLeft: m.yaw.map { -$0 }
        case .lookDown: m.pitch
        default: nil
        }
    }
    private func directionalThreshold(_ gesture: FaceGesture) -> Double {
        gesture == .lookDown ? directionalPitchThreshold : directionalYawThreshold
    }
    private mutating func retainDirectionalLoss(at time: TimeInterval) -> Bool {
        guard var track = directionalExcursion, track.evidenceCount >= 2,
              time - track.lastValid <= 0.3 + 0.000_001,
              track.lastValue >= directionalThreshold(track.gesture) * 0.45,
              track.lastValue - track.originValue >= directionalThreshold(track.gesture) * 0.25 else { return false }
        track.interrupted = true
        directionalExcursion = track
        directionNeutralSince.removeAll(keepingCapacity: true)
        return true
    }
    private mutating func consumeDirection(_ sample: FaceGestureSample, measurements m: Measurements,
                                          assigned: Set<FaceGesture>) -> FaceGesture? {
        let directions = assigned.filter(\.isDirectional)
        guard !directions.isEmpty else { return nil }
        defer { previousPose = PoseObservation(time: sample.time, pitch: m.pitch, yaw: m.yaw) }
        let needsYaw = directions.contains(.lookRight) || directions.contains(.lookLeft)
        let needsPitch = directions.contains(.lookDown)
        let neutral = (!needsYaw || m.yaw.map { abs($0) <= directionalYawThreshold * 0.35 } != false)
            && (!needsPitch || m.pitch.map { abs($0) <= directionalPitchThreshold * 0.35 } != false)
            && (m.yaw != nil || m.pitch != nil)
        for gesture in directions {
            // A missing optional axis cannot disable a sound measured axis. It also cannot
            // arm itself: each direction must observe its own neutral measurements.
            guard m.has(gesture) else {
                directionArmed.remove(gesture); directionNeutralSince[gesture] = nil; continue
            }
            if !directionArmed.contains(gesture) {
                if neutral && isNeutral(gesture, m) {
                    directionNeutralSince[gesture] = directionNeutralSince[gesture] ?? sample.time
                    if sample.time - directionNeutralSince[gesture]! >= 0.16 { directionArmed.insert(gesture) }
                } else { directionNeutralSince[gesture] = nil }
            }
        }
        guard sample.time >= directionCooldownUntil else { return nil }
        func dominant(_ gesture: FaceGesture, _ value: Double) -> Bool {
            let primary = value / directionalThreshold(gesture)
            let other: Double
            if gesture == .lookDown { other = needsYaw ? abs(m.yaw ?? 0) / directionalYawThreshold : 0 }
            else { other = needsPitch ? abs(m.pitch ?? 0) / directionalPitchThreshold : 0 }
            return other < 0.65 || primary >= other * 1.25
        }
        if var track = directionalExcursion {
            guard let value = directionalValue(track.gesture, m) else {
                if !retainDirectionalLoss(at: sample.time) { resetDirectionalMotion() }
                return nil
            }
            let threshold = directionalThreshold(track.gesture)
            let duration = sample.time - track.start
            let gap = sample.time - track.lastValid
            let action = settings.action(for: track.gesture)
            if track.interrupted, neutral, gap <= 0.3 + 0.000_001, duration <= 0.65,
               track.gesture != .lookDown, action == .nextPage || action == .previousPage,
               track.evidenceCount >= 2, track.lastValue >= threshold * 0.8,
               track.lastValue >= track.peak * 0.9,
               track.lastValue - track.firstValue >= threshold * 0.2,
               track.lastValid > track.start,
               (track.lastValue - track.firstValue) / (track.lastValid - track.start) >= 0.12 {
                // A large quick page glance may leave view before its peak. Two signed,
                // rising near-threshold samples plus a prompt measured neutral return can
                // finish that page turn. This bounded continuation never records a rep.
                return track.gesture
            }
            guard duration <= 0.42, dominant(track.gesture, value), value >= threshold * 0.35,
                  !track.interrupted || (sample.time - track.lastValid <= 0.3 + 0.000_001
                    && value >= track.lastValue * 0.8) else {
                resetDirectionalMotion(); return nil
            }
            track.interrupted = false
            track.lastValid = sample.time
            track.lastValue = value
            track.peak = max(track.peak, value)
            if value >= threshold * 0.45 { track.evidenceCount += 1 }
            directionalExcursion = track
            // Two fresh measurements confirm a quick onset. One high frame, a slow change
            // of reading posture, or a disappearing face cannot qualify a command.
            if track.evidenceCount >= 2, duration >= 0.06,
               track.peak >= threshold, value >= max(threshold * 0.85, track.peak * 0.65),
               track.peak - track.originValue >= threshold * 0.5 { return track.gesture }
            return nil
        }
        guard !neutral else { return nil }
        let choices = directions.compactMap { gesture -> (FaceGesture, Double)? in
            guard directionArmed.contains(gesture), let value = directionalValue(gesture, m),
                  value >= directionalThreshold(gesture) * 0.45, dominant(gesture, value) else { return nil }
            return (gesture, value)
        }.sorted { $0.1 / directionalThreshold($0.0) > $1.1 / directionalThreshold($1.0) }
        guard let (gesture, value) = choices.first else { return nil }
        var origin = 0.0
        if let previousPose, sample.time - previousPose.time <= 0.25 {
            switch gesture {
            case .lookRight: origin = previousPose.yaw ?? value
            case .lookLeft: origin = previousPose.yaw.map { -$0 } ?? value
            case .lookDown: origin = previousPose.pitch ?? value
            default: break
            }
        } else {
            // A gap cannot invent an unseen onset, even if the first recovered frame is turned.
            resetDirectionalMotion(); return nil
        }
        directionalExcursion = DirectionalExcursion(gesture: gesture, start: sample.time,
            originValue: origin, firstValue: value, lastValid: sample.time, lastValue: value, peak: value)
        return nil
    }
    private mutating func resetDirectionalMotion() {
        directionalExcursion = nil
        directionArmed.removeAll(keepingCapacity: true)
        directionNeutralSince.removeAll(keepingCapacity: true)
        previousPose = nil
    }
    private mutating func revoke(_ gesture: FaceGesture) {
        excursions[gesture] = nil
        armed.remove(gesture)
        neutralSince[gesture] = nil
    }
    private var pitchThreshold: Double { max(0.12 * settings.sensitivity.thresholdScale, pitchNoise * 5) }
    private var yawThreshold: Double { max(0.15 * settings.sensitivity.thresholdScale, yawNoise * 5) }
    private var directionalPitchThreshold: Double { max(0.095 * settings.sensitivity.thresholdScale, pitchNoise * 4.5) }
    private var directionalYawThreshold: Double { max(0.085 * settings.sensitivity.thresholdScale, yawNoise * 4.5) }
    private var smileThreshold: Double { max(0.055 * settings.sensitivity.thresholdScale, smileNoise * 5) }
    private var liftThreshold: Double { max(0.025 * settings.sensitivity.thresholdScale, liftNoise * 5) }
    private var strengthThreshold: Double { max(0.14 * settings.sensitivity.thresholdScale, strengthNoise * 5) }
    private var mouthThreshold: Double { 0.13 * settings.sensitivity.thresholdScale }
    private var closedEyeRatio: Double {
        switch settings.sensitivity { case .easy: 0.50; case .standard: 0.42; case .deliberate: 0.34 }
    }
    private func requiredHold(for gesture: FaceGesture) -> TimeInterval {
        gesture == .eyesClosed ? max(0.6, settings.effectiveHoldDuration) : settings.effectiveHoldDuration
    }
    private func isNeutral(_ gesture: FaceGesture, _ m: Measurements) -> Bool {
        switch gesture {
        case .lookRight, .lookLeft: m.yaw.map { abs($0) < directionalYawThreshold * 0.35 } ?? false
        case .lookDown: m.pitch.map { abs($0) < directionalPitchThreshold * 0.35 } ?? false
        case .nod: m.pitch.map { abs($0) < pitchThreshold * 0.6 } ?? false
        case .shake: m.yaw.map { abs($0) < yawThreshold * 0.55 } ?? false
        case .grin: m.has(.grin) && activation(.grin, m) < 0.4
        case .mouthOpen: m.mouth.map { $0 < mouthThreshold * 0.45 } ?? false
        case .eyesClosed:
            if let left = m.leftEye, let right = m.rightEye { left > 0.72 && right > 0.72 } else { false }
        }
    }
    private func activation(_ gesture: FaceGesture, _ m: Measurements) -> Double {
        switch gesture {
        case .lookRight: return m.yaw.map { $0 / directionalYawThreshold } ?? 0
        case .lookLeft: return m.yaw.map { -$0 / directionalYawThreshold } ?? 0
        case .lookDown: return m.pitch.map { $0 / directionalPitchThreshold } ?? 0
        case .nod: return m.pitch.map { abs($0) / pitchThreshold } ?? 0
        case .shake: return m.yaw.map { abs($0) / yawThreshold } ?? 0
        case .grin:
            return max(m.smile.map { $0 / smileThreshold } ?? 0,
                       m.lift.map { $0 / liftThreshold } ?? 0,
                       m.strength.map { $0 / strengthThreshold } ?? 0)
        case .mouthOpen: return m.mouth.map { $0 / mouthThreshold } ?? 0
        case .eyesClosed:
            guard let left = m.leftEye, let right = m.rightEye else { return 0 }
            return max(left, right) <= closedEyeRatio ? 1 : 0
        }
    }
    private func crossAxisMotion(_ track: Excursion, _ m: Measurements) -> Bool {
        func change(_ current: Double?, _ initial: Double?) -> Double {
            guard let current, let initial else { return 0 }
            return abs(current - initial)
        }
        switch track.gesture {
        case .lookRight, .lookLeft, .lookDown: return false
        case .nod: return change(m.yaw, track.initialYaw) > max(0.16, track.peak * 0.7)
        case .shake: return change(m.pitch, track.initialPitch) > max(0.16, track.peak * 0.7)
        case .grin, .mouthOpen, .eyesClosed:
            return change(m.pitch, track.initialPitch) > 0.22 || change(m.yaw, track.initialYaw) > 0.25
        }
    }
    private func noise(_ values: [Double?]) -> Double {
        let valid = values.compactMap { $0 }.sorted()
        guard !valid.isEmpty else { return 0 }
        let median = valid[valid.count / 2]
        let deviations = valid.map { abs($0 - median) }.sorted()
        return deviations[deviations.count / 2] * 1.4826
    }
    private func unwrappedYaw(_ values: [Double?]) -> [Double?] {
        guard let reference = values.compactMap({ $0 }).first else { return values }
        return values.map { $0.map { reference + atan2(sin($0 - reference), cos($0 - reference)) } }
    }
    private func stableMedian(_ values: [Double?], spread: Double) -> Double? {
        let sorted = values.compactMap { $0 }.sorted()
        guard sorted.count >= max(4, Int(ceil(Double(values.count) * 0.7))) else { return nil }
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
        let lift: Double?
        let strength: Double?
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
            // Camera-relative pose may cross the ±pi seam. It is a small movement there,
            // not a nearly full-circle turn away from the calibrated reading posture.
            yaw = difference(sample.measuredYaw, baseline.yaw).map { atan2(sin($0), cos($0)) }
            smile = difference(sample.measuredSmile, baseline.smileWidth)
            lift = difference(sample.measuredLift, baseline.smileLift)
            strength = difference(sample.measuredStrength, baseline.smileStrength)
            mouth = difference(sample.measuredMouth, baseline.mouthOpen)
            leftEye = ratio(sample.measuredLeftEye, baseline.leftEyeOpen)
            rightEye = ratio(sample.measuredRightEye, baseline.rightEyeOpen)
        }
        func has(_ gesture: FaceGesture) -> Bool {
            switch gesture {
            case .lookRight, .lookLeft: yaw != nil
            case .lookDown: pitch != nil
            case .nod: pitch != nil
            case .shake: yaw != nil
            case .grin: smile != nil || lift != nil || strength != nil
            case .mouthOpen: mouth != nil
            case .eyesClosed: leftEye != nil && rightEye != nil
            }
        }
    }
}
