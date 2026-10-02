import Foundation

/// R14 pulse check (§11/§13): the metronome plays for `barsOn` bars, drops out for `barsOff`
/// bars, then returns, repeating. This is the mechanism only — a future rules track decides *when*
/// to apply it (e.g. "near target tempo") and with what `barsOff` (`RuleSettings.r14DropoutBars`);
/// this type just describes the on/off cycle so `MetronomeService` can render it.
public struct MetronomeDropoutPlan: Codable, Equatable, Sendable {
    public var barsOn: Int
    public var barsOff: Int
    public init(barsOn: Int, barsOff: Int) { self.barsOn = barsOn; self.barsOff = barsOff }
    public var isValid: Bool { (1...64).contains(barsOn) && (1...64).contains(barsOff) }
    public var cycleBars: Int { barsOn + barsOff }
    /// True when `barIndex` (0-based, counted from when the plan started) falls in a silent bar.
    public func isSilent(barIndex: Int64) -> Bool {
        guard isValid else { return false }
        let position = ((barIndex % Int64(cycleBars)) + Int64(cycleBars)) % Int64(cycleBars)
        return position >= Int64(barsOn)
    }
}

/// Sample-accurate bar/beat/pulse position, derived fresh from an absolute sample count rather
/// than accumulated tick-by-tick. Because every call recomputes from `sampleTime` alone, calling
/// it late (a busy main thread, an irregular display-link tick) or calling it early can never
/// accumulate drift: the same `sampleTime` always yields the same position (see
/// "MetronomeTimingTests"/"MetronomeDriftTests" for the 10-minute proof).
public enum MetronomeClock {
    public struct Position: Equatable, Sendable {
        public var isCountIn: Bool
        public var isSilentBar: Bool
        public var barIndex: Int64
        public var beat: Int
        public var pulse: Int
        public var beatProgress: Double
        /// 0-based index of this beat since playback began (post count-in) — a stable identity
        /// for "did the displayed beat change" comparisons, independent of polling cadence.
        public var absoluteBeatIndex: Int64
    }

    public static func position(sampleTime: Int64, barFrames: Int64, beatsPerBar: Int, subdivision: Int,
                                 countInBars: Int = 0, dropoutPlan: MetronomeDropoutPlan? = nil) -> Position? {
        guard barFrames > 0, beatsPerBar > 0, subdivision > 0, sampleTime >= 0 else { return nil }
        let countInFrames = barFrames * Int64(max(0, countInBars))
        if sampleTime < countInFrames {
            let bar = sampleTime / barFrames
            let (beat, pulse, progress) = beatPulse(withinBar: sampleTime % barFrames, barFrames: barFrames,
                                                     beatsPerBar: beatsPerBar, subdivision: subdivision)
            return Position(isCountIn: true, isSilentBar: false, barIndex: bar, beat: beat, pulse: pulse,
                            beatProgress: progress, absoluteBeatIndex: bar * Int64(beatsPerBar) + Int64(beat - 1))
        }
        let musicTime = sampleTime - countInFrames
        let bar = musicTime / barFrames
        let (beat, pulse, progress) = beatPulse(withinBar: musicTime % barFrames, barFrames: barFrames,
                                                 beatsPerBar: beatsPerBar, subdivision: subdivision)
        let silent = dropoutPlan?.isSilent(barIndex: bar) ?? false
        return Position(isCountIn: false, isSilentBar: silent, barIndex: bar, beat: beat, pulse: pulse,
                        beatProgress: progress, absoluteBeatIndex: bar * Int64(beatsPerBar) + Int64(beat - 1))
    }

    private static func beatPulse(withinBar: Int64, barFrames: Int64, beatsPerBar: Int, subdivision: Int) -> (Int, Int, Double) {
        let continuous = Double(withinBar) / Double(barFrames) * Double(beatsPerBar)
        let beat = min(beatsPerBar, Int(continuous) + 1)
        let pulse = min(beatsPerBar * subdivision, Int(continuous * Double(subdivision)) + 1)
        return (beat, pulse, continuous - floor(continuous))
    }
}

/// Preserve the musical position of a running sample-clock loop when its tempo changes.
/// The audio node starts a new sample epoch, but its PCM is rotated by this offset and the
/// display clock adds the same offset. No synthetic downbeat is inserted by a tempo gesture.
public enum MetronomePlaybackPhase {
    public static func rescaledOffset(sampleTime: Int64, previousBarFrames: Int64, nextBarFrames: Int64) -> Int64 {
        guard sampleTime >= 0, previousBarFrames > 0, nextBarFrames > 0 else { return 0 }
        let value = Double(sampleTime) / Double(previousBarFrames) * Double(nextBarFrames)
        guard value.isFinite, value < Double(Int64.max) else { return 0 }
        return Int64(value.rounded())
    }
}
