import Foundation

enum MetronomeSound: String, Codable, CaseIterable, Sendable {
    case wood, click, bell, glass
    var title: String { rawValue.capitalized }
}

enum BeatAccent: String, Codable, CaseIterable, Sendable {
    case regular, accented, muted
    var next: Self { switch self { case .regular: .accented; case .accented: .muted; case .muted: .regular } }
    var title: String { switch self { case .regular: "Beat"; case .accented: "Accent"; case .muted: "Silent" } }
}

struct MetronomeSettings: Codable, Equatable, Sendable {
    var version = 1
    var bpm = 80.0
    var beatsPerBar = 4
    var denominator = 4
    var subdivision = 1
    var accents: [BeatAccent] = [.accented, .regular, .regular, .regular]
    var sound = MetronomeSound.wood
    var volume = 0.7
    var haptics = false
    /// Bars of plain click played once, unlooped, before the music starts (0 = off). Added after
    /// `v1` first shipped, so decoding defaults it rather than requiring the key (see `init(from:)`).
    var countInBars = 0
    /// When on, the click keeps playing after the app backgrounds or the screen locks. Added after
    /// `v1` first shipped, so decoding defaults it rather than requiring the key.
    var keepRunningWhenLocked = false

    var isValid: Bool {
        version == 1 && bpm.isFinite && (20...300).contains(bpm) && (1...12).contains(beatsPerBar)
            && [2, 4, 8].contains(denominator) && (1...4).contains(subdivision)
            && accents.count == beatsPerBar && volume.isFinite && (0...1).contains(volume)
            && (0...4).contains(countInBars)
    }

    private enum CodingKeys: String, CodingKey {
        case version, bpm, beatsPerBar, denominator, subdivision, accents, sound, volume, haptics,
             countInBars, keepRunningWhenLocked
    }
    init() {}
    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        version = try values.decode(Int.self, forKey: .version)
        bpm = try values.decode(Double.self, forKey: .bpm)
        beatsPerBar = try values.decode(Int.self, forKey: .beatsPerBar)
        denominator = try values.decode(Int.self, forKey: .denominator)
        subdivision = try values.decode(Int.self, forKey: .subdivision)
        accents = try values.decode([BeatAccent].self, forKey: .accents)
        sound = try values.decode(MetronomeSound.self, forKey: .sound)
        volume = try values.decode(Double.self, forKey: .volume)
        haptics = try values.decode(Bool.self, forKey: .haptics)
        // Absent from any settings blob persisted before count-in/background-audio shipped.
        countInBars = try values.decodeIfPresent(Int.self, forKey: .countInBars) ?? 0
        keepRunningWhenLocked = try values.decodeIfPresent(Bool.self, forKey: .keepRunningWhenLocked) ?? false
    }
    static func accents(for beats: Int, denominator: Int) -> [BeatAccent] {
        guard (1...12).contains(beats) else { return [] }
        var accents = [BeatAccent](repeating: .regular, count: beats)
        accents[0] = .accented
        let secondary: [Int]
        if denominator == 8, [6, 9, 12].contains(beats) { secondary = Array(stride(from: 3, to: beats, by: 3)) }
        else if denominator == 8, beats == 7 { secondary = [3, 5] }
        else if beats == 5 { secondary = [3] }
        else { secondary = [] }
        for index in secondary { accents[index] = .accented }
        return accents
    }
}

/// Rejects double taps and averages a bounded recent window. No audio or UI clock dependence.
struct TapTempoEstimator {
    private var taps: [TimeInterval] = []
    mutating func tap(at time: TimeInterval) -> Double? {
        guard time.isFinite, time >= 0 else { return nil }
        if let last = taps.last {
            guard time > last else { return nil }
            if time - last > 3.2 { taps.removeAll() }
            else if time - last < 0.15 { return nil }
        }
        taps.append(time)
        taps = Array(taps.suffix(6))
        guard taps.count >= 2 else { return nil }
        var intervals = zip(taps.dropFirst(), taps).map(-).sorted()
        if intervals.count >= 4 { intervals.removeFirst(); intervals.removeLast() }
        let interval = intervals.reduce(0, +) / Double(intervals.count)
        guard interval.isFinite, interval > 0 else { return nil }
        return min(300, max(20, (60 / interval).rounded()))
    }
}

/// Pure sample-domain synthesis. BPM always counts the displayed beat, including in eighth-note meters.
struct MetronomePattern {
    let bpm: Double
    let beatsPerBar: Int
    let subdivision: Int
    let sampleRate: Double
    let frameCount: Int
    let pulseFrames: [Int]
    let accents: [BeatAccent]
    let sound: MetronomeSound

    init(bpm: Double, beatsPerBar: Int, subdivision: Int, sampleRate: Double,
         accents: [BeatAccent]? = nil, sound: MetronomeSound = .wood) throws {
        guard bpm.isFinite, (20...300).contains(bpm), (1...12).contains(beatsPerBar),
              (1...4).contains(subdivision), sampleRate.isFinite,
              (8_000...192_000).contains(sampleRate), accents == nil || accents?.count == beatsPerBar else {
            throw PatternError.invalidConfiguration
        }
        self.bpm = bpm; self.beatsPerBar = beatsPerBar; self.subdivision = subdivision
        self.sampleRate = sampleRate; self.sound = sound
        self.accents = accents ?? [.accented] + [BeatAccent](repeating: .regular, count: beatsPerBar - 1)
        let framesPerBeat = sampleRate * 60 / bpm
        frameCount = Int((framesPerBeat * Double(beatsPerBar)).rounded())
        pulseFrames = (0..<(beatsPerBar * subdivision)).map {
            Int((Double($0) * framesPerBeat / Double(subdivision)).rounded())
        }
    }

    func renderSamples() -> [Float] {
        var samples = [Float](repeating: 0, count: frameCount)
        for (pulse, start) in pulseFrames.enumerated() {
            let accent = accents[pulse / subdivision]
            guard accent != .muted else { continue }
            let mainBeat = pulse.isMultiple(of: subdivision)
            let strong = mainBeat && accent == .accented
            let amplitude = (strong ? 0.56 : (mainBeat ? 0.36 : 0.16)) * (sound == .glass ? 1.3 : 1)
            let frequency = strong ? 1_650.0 : (mainBeat ? 1_150.0 : 870.0)
            let duration = sound == .bell ? 0.045 : (sound == .glass ? 0.018 : 0.026)
            let count = min(Int(sampleRate * duration), frameCount - start)
            var noiseState = UInt64(pulse + 1) &* 2_654_435_761
            for frame in 0..<max(0, count) {
                let time = Double(frame) / sampleRate
                let attack = min(1, time / 0.0006)
                let endFade = min(1, Double(count - frame) / (sampleRate * 0.003))
                noiseState = noiseState &* 6_364_136_223_846_793_005 &+ 1
                let noise = Double((noiseState >> 33) & 0xffff) / 32767.5 - 1
                let wave: Double
                switch sound {
                case .wood:
                    wave = (sin(2 * .pi * frequency * 0.65 * time) + 0.28 * sin(2 * .pi * frequency * 1.63 * time) + noise * 0.13) * exp(-time * 195)
                case .click:
                    wave = (sin(2 * .pi * frequency * time) + noise * 0.4) * exp(-time * 280)
                case .bell:
                    wave = (sin(2 * .pi * frequency * time) + 0.18 * sin(2 * .pi * frequency * 2.76 * time)) * exp(-time * 95)
                case .glass:
                    // Brighter and shorter than the other three: a higher-harmonic tone plus a
                    // strong noise "chiff" at onset, decaying fast — cuts through a loud acoustic
                    // instrument's low-mid energy instead of blending under it (§13).
                    wave = (sin(2 * .pi * frequency * 2.4 * time) * 0.55 + noise * 0.6) * exp(-time * 520)
                }
                samples[start + frame] += Float(amplitude * attack * endFade * wave)
            }
        }
        return samples
    }

    private enum PatternError: LocalizedError {
        case invalidConfiguration
        var errorDescription: String? { "The metronome audio configuration is invalid." }
    }
}
