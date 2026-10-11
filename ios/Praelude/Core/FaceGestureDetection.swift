import Foundation

/// Deliberate gestures are explicit input from the player, never an assessment of playing.
/// Pose is in radians; smileWidth is lip width / distance between eye centers, relative to a
/// per-session neutral baseline. Only a complete excursion AND return can dispatch an action.
enum FaceGesture: String, CaseIterable, Codable, Sendable, Identifiable {
    case nod, shake, grin
    var id: String { rawValue }
    var title: String { switch self { case .nod: "Nod"; case .shake: "Shake head"; case .grin: "Grin" } }
}
enum FaceGestureAction: String, CaseIterable, Codable, Sendable, Identifiable {
    case off, nextPage, previousPage, clean, sloppy, again
    var id: String { rawValue }
    var title: String { switch self {
    case .off: "Off"; case .nextPage: "Next page"; case .previousPage: "Previous page"
    case .clean: "Clean"; case .sloppy: "Sloppy"; case .again: "Again"
    } }
    var isVerdict: Bool { self == .clean || self == .sloppy || self == .again }
}
struct FaceGestureSettings: Codable, Equatable, Sendable {
    var nod: FaceGestureAction = .clean
    var shake: FaceGestureAction = .sloppy
    var grin: FaceGestureAction = .nextPage
    var allowVerdicts = false
    func action(for gesture: FaceGesture) -> FaceGestureAction {
        switch gesture { case .nod: nod; case .shake: shake; case .grin: grin }
    }
}
struct FaceGestureSample: Sendable {
    var time: TimeInterval
    var pitch: Double
    var yaw: Double
    var smileWidth: Double
    var luminance: Double
    var confidence: Double
    var faceCount: Int
    var faceArea: Double
    var usable: Bool {
        [time, pitch, yaw, smileWidth, luminance, confidence, faceArea].allSatisfy(\.isFinite)
        && faceCount == 1 && luminance >= 0.16 && confidence >= 0.8 && faceArea >= 0.035
        && smileWidth > 0
    }
}
struct FaceGestureBaseline: Sendable, Equatable {
    let pitch: Double
    let yaw: Double
    let smileWidth: Double
}
struct FaceGestureDetector: Sendable {
    private(set) var baseline: FaceGestureBaseline?
    private var neutralSince: TimeInterval?
    private var lastTime: TimeInterval?
    private var cooldownUntil: TimeInterval = 0
    private var armed = false
    private enum Excursion: Sendable {
        case nod(TimeInterval, Bool), shake(TimeInterval, Int, Bool), grin(TimeInterval, Bool)
        var start: TimeInterval { switch self { case .nod(let t, _), .shake(let t, _, _), .grin(let t, _): t } }
    }
    private var excursion: Excursion?

    /// Calibration is rejected unless a full recent second contains one well-lit, steady face.
    mutating func calibrate(_ samples: [FaceGestureSample]) -> Bool {
        clearCalibration()
        guard samples.count >= 8, let first = samples.first, let last = samples.last,
              last.time - first.time >= 0.8, last.time - first.time <= 2.5,
              zip(samples, samples.dropFirst()).allSatisfy({ $1.time > $0.time && $1.time - $0.time < 0.35 }),
              samples.allSatisfy(\.usable) else { return false }
        let pitch = samples.map(\.pitch), yaw = samples.map(\.yaw), smile = samples.map(\.smileWidth)
        guard pitch.max()! - pitch.min()! < 0.12, yaw.max()! - yaw.min()! < 0.12,
              smile.max()! - smile.min()! < 0.1 else { return false }
        baseline = FaceGestureBaseline(pitch: pitch.reduce(0,+)/Double(samples.count),
            yaw: yaw.reduce(0,+)/Double(samples.count), smileWidth: smile.reduce(0,+)/Double(samples.count))
        resetMotion(); lastTime = nil
        return true
    }
    mutating func clearCalibration() { baseline = nil; resetMotion(); lastTime = nil }
    mutating func resetMotion() { excursion = nil; armed = false; neutralSince = nil }
    mutating func consume(_ sample: FaceGestureSample) -> FaceGesture? {
        defer { lastTime = sample.time }
        guard let baseline, sample.usable, lastTime.map({ sample.time > $0 && sample.time - $0 <= 0.35 }) ?? true else {
            resetMotion(); return nil
        }
        let p = sample.pitch - baseline.pitch, y = sample.yaw - baseline.yaw
        let smile = sample.smileWidth - baseline.smileWidth
        let neutral = abs(p) < 0.09 && abs(y) < 0.10 && smile < 0.065
        guard sample.time >= cooldownUntil else { resetMotion(); return nil }
        if !armed {
            if neutral {
                neutralSince = neutralSince ?? sample.time
                if sample.time - neutralSince! >= 0.45 { armed = true }
            } else { neutralSince = nil }
            return nil
        }
        if let excursion, sample.time - excursion.start > 2.4 { resetMotion(); return nil }
        var detected: FaceGesture?
        switch excursion {
        case .nod(let start, let held):
            // A turn or smile mixed into a nod is ambiguous; do not grade it.
            if abs(y) > 0.20 || smile > 0.13 { resetMotion(); return nil }
            let didHold = held || (p >= 0.18 && sample.time - start >= 0.12)
            excursion = .nod(start, didHold)
            if neutral { if didHold && sample.time - start >= 0.22 { detected = .nod } else { resetMotion() } }
        case .shake(let start, let direction, let crossed):
            if abs(p) > 0.17 || smile > 0.13 { resetMotion(); return nil }
            let didCross = crossed || (Double(direction) * y < -0.23)
            excursion = .shake(start, direction, didCross)
            if neutral { if didCross && sample.time - start >= 0.28 { detected = .shake } else { resetMotion() } }
        case .grin(let start, let held):
            if abs(p) > 0.17 || abs(y) > 0.20 { resetMotion(); return nil }
            let didHold = held || (smile >= 0.10 && sample.time - start >= 0.45)
            excursion = .grin(start, didHold)
            if neutral { if didHold { detected = .grin } else { resetMotion() } }
        case nil:
            if p >= 0.18 && abs(y) < 0.10 && smile < 0.065 { excursion = .nod(sample.time, false) }
            else if abs(y) >= 0.23 && abs(p) < 0.09 && smile < 0.065 { excursion = .shake(sample.time, y > 0 ? 1 : -1, false) }
            else if smile >= 0.10 && abs(p) < 0.09 && abs(y) < 0.10 { excursion = .grin(sample.time, false) }
        }
        if detected != nil { cooldownUntil = sample.time + 1.25; resetMotion() }
        return detected
    }
}
