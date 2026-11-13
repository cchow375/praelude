import Foundation

/// Turns a raw per-buffer `PitchDetector.detectPitch` stream into a display-stable reading (§13):
/// a running median over the last few detections damps single-buffer jitter, and the display only
/// clears after several consecutive silent/unvoiced buffers rather than on the first one, so a
/// natural gap between note attacks does not flicker the tuner to blank. Pure Foundation state
/// machine — no AVFoundation — so it is fully unit-testable independent of a live microphone.
public struct TunerSmoother: Sendable {
    private let historyLimit: Int
    private let silenceGrace: Int
    private var recent: [Double] = []
    private var silentStreak = 0
    public private(set) var currentFrequencyHz: Double?

    public init(historyLimit: Int = 5, silenceGrace: Int = 4) {
        self.historyLimit = max(1, historyLimit)
        self.silenceGrace = max(1, silenceGrace)
    }

    /// Feed one buffer's detection result (`nil` when that buffer had no confident pitch).
    /// Returns the same value as `currentFrequencyHz` after ingesting, for convenience.
    @discardableResult
    public mutating func ingest(_ detectedHz: Double?) -> Double? {
        if let detectedHz, detectedHz.isFinite {
            silentStreak = 0
            recent.append(detectedHz)
            if recent.count > historyLimit { recent.removeFirst() }
            currentFrequencyHz = Self.median(recent)
        } else {
            silentStreak += 1
            if silentStreak >= silenceGrace {
                recent.removeAll()
                currentFrequencyHz = nil
            }
        }
        return currentFrequencyHz
    }

    public mutating func reset() {
        recent.removeAll(); silentStreak = 0; currentFrequencyHz = nil
    }

    private static func median(_ values: [Double]) -> Double? {
        guard !values.isEmpty else { return nil }
        let sorted = values.sorted()
        return sorted[sorted.count / 2]
    }
}
