import Foundation

enum FeedbackVerdict: String, Sendable { case clean, sloppy, again, reset }
enum PracticeFeedbackKind: String, Sendable {
    case clean, sloppy, again, variant, tempo, set, chain
    var isCompletion: Bool { self == .variant || self == .tempo || self == .set || self == .chain }
}

struct PracticeFeedbackInput: Sendable {
    var attemptID: UUID
    var setID: UUID
    var verdict: FeedbackVerdict
    var progressCount: Int
    var targetCount: Int
    var ordinal: Int
    var consecutiveSetbacks: Int = 0
    var stageAdvanced = false
    var tempoAdvanced = false
    var setCompleted = false
    var hasVariants = false
    var nextVariant: String? = nil
    var bpm: Double = 80
}

struct PracticeFeedbackEvent: Identifiable, Equatable, Sendable {
    let id: UUID
    let setID: UUID
    let kind: PracticeFeedbackKind
    let title: String
    let detail: String
    let progress: Double
    let intensity: Double
    let ordinal: Int

    static func make(_ input: PracticeFeedbackInput) -> Self? {
        guard input.verdict != .reset, input.progressCount >= 0, (1...100).contains(input.targetCount),
              input.ordinal > 0, input.bpm.isFinite, (20...300).contains(input.bpm) else { return nil }
        let progress = min(1, Double(input.progressCount) / Double(input.targetCount))
        let kind: PracticeFeedbackKind
        let title: String
        let detail: String
        if input.setCompleted {
            kind = input.hasVariants ? .chain : .set
            title = input.hasVariants ? "Chain complete" : "Set complete"
            detail = "Every repetition saved"
        } else {
            switch input.verdict {
            case .clean:
                if input.tempoAdvanced {
                    kind = .tempo; title = "Next tempo"; detail = "\(Int(input.bpm)) BPM"
                } else if input.stageAdvanced {
                    kind = .variant; title = "Variant complete"
                    detail = input.nextVariant.map { "Next: \($0)" } ?? "Progress saved"
                } else {
                    kind = .clean; title = "Clean"; detail = "\(input.progressCount) of \(input.targetCount)"
                }
            case .sloppy: kind = .sloppy; title = "Sloppy"; detail = "Repetition saved"
            case .again: kind = .again; title = "Again"; detail = "Repetition saved"
            case .reset: return nil
            }
        }
        let intensity: Double
        if kind == .chain { intensity = 1 }
        else if kind == .set { intensity = 0.92 }
        else if kind == .variant || kind == .tempo { intensity = 0.78 }
        else if kind == .clean { intensity = 0.24 + progress * 0.48 }
        else { intensity = 0.24 + Double(min(3, max(1, input.consecutiveSetbacks))) * 0.08 }
        return Self(id: input.attemptID, setID: input.setID, kind: kind, title: title, detail: detail,
                    progress: kind.isCompletion ? 1 : progress, intensity: intensity, ordinal: input.ordinal)
    }
}

/// A session-local second guard. Existing durable attempts are primed silently on launch.
struct PracticeFeedbackGate {
    private var seen: Set<UUID> = []
    mutating func prime(_ ids: [UUID]) { seen.formUnion(ids) }
    mutating func accept(_ input: PracticeFeedbackInput) -> PracticeFeedbackEvent? {
        guard !seen.contains(input.attemptID) else { return nil }
        seen.insert(input.attemptID)
        return PracticeFeedbackEvent.make(input)
    }
}

/// Short original plucked tones, synthesized locally. Never needs a file, microphone, or network.
enum PracticeFeedbackPCM {
    static func wavData(samples: [Float], sampleRate: Double) throws -> Data {
        guard sampleRate.isFinite, (8_000...192_000).contains(sampleRate),
              sampleRate.rounded() == sampleRate, samples.count <= 192_000 * 10,
              samples.allSatisfy({ $0.isFinite }) else { throw AudioError.invalidConfiguration }
        var data = Data()
        func append<T: FixedWidthInteger>(_ value: T) {
            var value = value.littleEndian
            Swift.withUnsafeBytes(of: &value) { data.append(contentsOf: $0) }
        }
        data.append(contentsOf: "RIFF".utf8); append(UInt32(36 + samples.count * 2))
        data.append(contentsOf: "WAVEfmt ".utf8); append(UInt32(16)); append(UInt16(1)); append(UInt16(1))
        append(UInt32(sampleRate)); append(UInt32(sampleRate) * 2); append(UInt16(2)); append(UInt16(16))
        data.append(contentsOf: "data".utf8); append(UInt32(samples.count * 2))
        for sample in samples { append(Int16((min(1, max(-1, sample)) * 32767).rounded())) }
        return data
    }

    static func render(_ event: PracticeFeedbackEvent, sampleRate: Double = 48_000, volume: Double = 1) throws -> [Float] {
        guard sampleRate.isFinite, (8_000...192_000).contains(sampleRate), volume.isFinite, (0...1).contains(volume),
              event.progress.isFinite, (0...1).contains(event.progress), event.intensity.isFinite,
              (0...1).contains(event.intensity), event.ordinal > 0 else {
            throw AudioError.invalidConfiguration
        }
        let pitches: [Double]
        let duration: Double
        switch event.kind {
        case .clean:
            let scale = [261.6256, 293.6648, 329.6276, 391.9954, 440.0]
            pitches = [scale[min(4, Int(event.progress * 4))]]; duration = 0.15
        case .sloppy: pitches = [220, 174.6141]; duration = 0.22
        case .again: pitches = [246.9417, 220]; duration = 0.2
        case .variant: pitches = [391.9954, 493.8833, 587.3295]; duration = 0.34
        case .tempo: pitches = [440, 523.2511, 659.2551]; duration = 0.38
        case .set: pitches = [523.2511, 659.2551, 783.9909]; duration = 0.56
        case .chain: pitches = [523.2511, 659.2551, 783.9909, 1046.5023]; duration = 0.72
        }
        let count = Int(sampleRate * duration)
        var samples = [Float](repeating: 0, count: count)
        let amplitude = (0.2 + 0.18 * event.intensity) * volume / sqrt(Double(pitches.count))
        for (note, pitch) in pitches.enumerated() {
            let onset = Double(note) * (event.kind.isCompletion ? 0.045 : 0.065)
            for frame in Int(onset * sampleRate)..<count {
                let time = Double(frame) / sampleRate - onset
                let attack = min(1, time / 0.0025)
                let release = min(1, (duration - Double(frame) / sampleRate) / 0.035)
                let decay = exp(-time * (event.kind.isCompletion ? 9 : 28))
                let color = 0.08 + event.intensity * 0.12
                let ornament = event.ordinal % 3 == 0 ? 3.0 : 2.0
                let wave = sin(2 * .pi * pitch * time) + color * sin(2 * .pi * pitch * ornament * time)
                samples[frame] += Float(amplitude * attack * release * decay * wave)
            }
        }
        return samples
    }
    private enum AudioError: Error { case invalidConfiguration }
}
