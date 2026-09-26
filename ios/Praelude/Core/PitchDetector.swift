import Foundation

/// On-device fundamental-frequency detection for the tuner (§13): a YIN-style autocorrelation
/// pass over one mono PCM window. This only ever reads a pitch back to the player — it is not
/// audio grading, and nothing here stores or judges what was played.
public enum PitchDetector {
    /// Detects the fundamental frequency of `samples` (mono, captured at `sampleRate` Hz), or
    /// `nil` when no pitch is found with reasonable confidence (silence, noise, or a fundamental
    /// outside `minFrequencyHz...maxFrequencyHz`).
    public static func detectPitch(samples: [Float], sampleRate: Double,
                                    minFrequencyHz: Double = 55, maxFrequencyHz: Double = 2_000,
                                    threshold: Double = 0.15) -> Double? {
        guard sampleRate.isFinite, sampleRate > 0, minFrequencyHz.isFinite, maxFrequencyHz.isFinite,
              minFrequencyHz > 0, maxFrequencyHz > minFrequencyHz, samples.count > 8,
              samples.allSatisfy({ $0.isFinite }) else { return nil }

        let maxTau = min(samples.count - 2, Int((sampleRate / minFrequencyHz).rounded(.up)))
        let minTau = max(1, Int((sampleRate / maxFrequencyHz).rounded(.down)))
        guard maxTau > minTau + 1 else { return nil }
        let windowCount = min(samples.count - maxTau, maxTau)
        guard windowCount > 0 else { return nil }

        // 1: difference function. 2: its cumulative-mean normalization (both standard YIN steps).
        var difference = [Double](repeating: 0, count: maxTau + 1)
        for tau in 1...maxTau {
            var sum = 0.0
            for j in 0..<windowCount {
                let delta = Double(samples[j]) - Double(samples[j + tau])
                sum += delta * delta
            }
            difference[tau] = sum
        }
        var cmnd = [Double](repeating: 1, count: maxTau + 1)
        var runningSum = 0.0
        for tau in 1...maxTau {
            runningSum += difference[tau]
            cmnd[tau] = runningSum == 0 ? 1 : difference[tau] * Double(tau) / runningSum
        }

        // 3: first dip below threshold at or after minTau, refined to its local minimum.
        var tauEstimate: Int?
        var tau = max(2, minTau)
        while tau <= maxTau {
            if cmnd[tau] < threshold {
                var better = tau
                while better + 1 <= maxTau, cmnd[better + 1] < cmnd[better] { better += 1 }
                tauEstimate = better
                break
            }
            tau += 1
        }
        guard let estimate = tauEstimate, estimate > 0, estimate < maxTau else { return nil }

        // 4: parabolic interpolation across the dip for sub-sample precision.
        let x0 = estimate > 1 ? estimate - 1 : estimate
        let x2 = estimate + 1 <= maxTau ? estimate + 1 : estimate
        let s0 = cmnd[x0], s1 = cmnd[estimate], s2 = cmnd[x2]
        var refinedTau = Double(estimate)
        // Vertex of the parabola through (x0,s0),(estimate,s1),(x2,s2): estimate + (s0-s2)/(2*(s0-2s1+s2)).
        let denominator = s0 - 2 * s1 + s2
        if denominator != 0, x0 != x2 { refinedTau = Double(estimate) + 0.5 * (s0 - s2) / denominator }
        guard refinedTau > 0 else { return nil }

        let frequency = sampleRate / refinedTau
        guard frequency.isFinite, frequency >= minFrequencyHz * 0.9, frequency <= maxFrequencyHz * 1.1 else { return nil }
        return frequency
    }
}
