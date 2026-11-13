import Foundation

/// A few synthesized drone timbres (§13). Purely additive-synthesis character names, not sample
/// playback: `sine` is a bare fundamental, `warm` adds soft low harmonics, `reed` adds odd
/// harmonics for a thinner, more nasal color.
public enum DroneTimbre: String, Codable, CaseIterable, Sendable {
    case sine, warm, reed
    public var title: String {
        switch self {
        case .sine: return "Sine"
        case .warm: return "Warm"
        case .reed: return "Reed"
        }
    }
}

/// A seamlessly loopable synthesized tone at any pitch (§13 drone). The buffer holds an exact
/// integer number of cycles, so its start and end are bit-continuous for every harmonic in the
/// timbre — looping it produces no click or wobble, the same zero-drift trick `MetronomePattern`
/// uses for a bar. `actualFrequencyHz` is the tiny (sub-cent, for any reasonable target duration)
/// rounding of `requestedFrequencyHz` needed to land on a whole number of cycles.
public struct DronePattern: Sendable {
    public let requestedFrequencyHz: Double
    public let actualFrequencyHz: Double
    public let sampleRate: Double
    public let timbre: DroneTimbre
    public let frameCount: Int
    public let cycles: Int

    public init(frequencyHz: Double, sampleRate: Double, timbre: DroneTimbre = .sine, targetDurationSeconds: Double = 1.0) throws {
        guard frequencyHz.isFinite, (20...4_000).contains(frequencyHz),
              sampleRate.isFinite, (8_000...192_000).contains(sampleRate),
              targetDurationSeconds.isFinite, (0.1...10).contains(targetDurationSeconds) else {
            throw PatternError.invalidConfiguration
        }
        self.requestedFrequencyHz = frequencyHz
        self.sampleRate = sampleRate
        self.timbre = timbre
        let cycles = max(1, Int((frequencyHz * targetDurationSeconds).rounded()))
        let frames = max(4, Int((Double(cycles) * sampleRate / frequencyHz).rounded()))
        self.cycles = cycles
        self.frameCount = frames
        self.actualFrequencyHz = Double(cycles) * sampleRate / Double(frames)
    }

    public func renderSamples() -> [Float] {
        var samples = [Float](repeating: 0, count: frameCount)
        let harmonics = harmonicStack()
        let radiansPerFrame = 2 * Double.pi * actualFrequencyHz / sampleRate
        for frame in 0..<frameCount {
            let phase = radiansPerFrame * Double(frame)
            var value = 0.0
            for (multiple, amplitude) in harmonics { value += amplitude * sin(phase * Double(multiple)) }
            samples[frame] = Float(value)
        }
        return samples
    }

    /// (harmonic multiple, relative amplitude) pairs, band-limited below Nyquist so a high drone
    /// pitch never folds a high harmonic back down as aliasing. Amplitudes are chosen so their
    /// sum stays comfortably under 1 even if every harmonic peaks together.
    private func harmonicStack() -> [(Int, Double)] {
        let nyquistMultiple = max(1, Int(sampleRate / 2 / actualFrequencyHz) - 1)
        func limited(_ stack: [(Int, Double)]) -> [(Int, Double)] { stack.filter { $0.0 <= nyquistMultiple } }
        switch timbre {
        case .sine: return [(1, 0.62)]
        case .warm: return limited([(1, 0.56), (2, 0.22), (3, 0.09), (4, 0.05)])
        case .reed: return limited([(1, 0.42), (2, 0.06), (3, 0.22), (5, 0.12), (7, 0.06)])
        }
    }

    private enum PatternError: LocalizedError {
        case invalidConfiguration
        var errorDescription: String? { "The drone pitch or audio configuration is invalid." }
    }
}
