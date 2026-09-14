import Foundation

/// Pure sample-domain click synthesis, independently testable without an audio device.
struct MetronomePattern {
    let bpm: Double
    let beatsPerBar: Int
    let subdivision: Int
    let sampleRate: Double
    let frameCount: Int
    let pulseFrames: [Int]

    init(bpm: Double, beatsPerBar: Int, subdivision: Int, sampleRate: Double) throws {
        guard bpm.isFinite, (20...300).contains(bpm), (1...12).contains(beatsPerBar),
              (1...4).contains(subdivision), sampleRate.isFinite,
              (8_000...192_000).contains(sampleRate) else { throw PatternError.invalidConfiguration }
        self.bpm = bpm
        self.beatsPerBar = beatsPerBar
        self.subdivision = subdivision
        self.sampleRate = sampleRate
        let framesPerBeat = sampleRate * 60 / bpm
        frameCount = Int((framesPerBeat * Double(beatsPerBar)).rounded())
        pulseFrames = (0..<(beatsPerBar * subdivision)).map {
            Int((Double($0) * framesPerBeat / Double(subdivision)).rounded())
        }
    }

    func renderSamples() -> [Float] {
        var samples = [Float](repeating: 0, count: frameCount)
        for (pulse, start) in pulseFrames.enumerated() {
            let downbeat = pulse == 0
            let mainBeat = pulse.isMultiple(of: subdivision)
            let frequency = downbeat ? 1_750.0 : (mainBeat ? 1_250.0 : 950.0)
            let amplitude = downbeat ? 0.55 : (mainBeat ? 0.38 : 0.18)
            let clickFrames = min(Int(sampleRate * 0.026), frameCount - start)
            for frame in 0..<max(0, clickFrames) {
                let time = Double(frame) / sampleRate
                let attack = min(1, time / 0.0007)
                let decay = exp(-time * 180)
                let fundamental = sin(2 * .pi * frequency * time)
                let overtone = 0.24 * sin(2 * .pi * frequency * 2.17 * time)
                samples[start + frame] += Float(amplitude * attack * decay * (fundamental + overtone))
            }
        }
        return samples
    }

    private enum PatternError: LocalizedError {
        case invalidConfiguration
        var errorDescription: String? { "The metronome audio configuration is invalid." }
    }
}
