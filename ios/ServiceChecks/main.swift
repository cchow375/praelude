import Foundation

@main struct ServiceChecks {
    static func main() throws {
        var count = 0
        func expect(_ condition: @autoclosure () -> Bool, _ label: String) {
            precondition(condition(), label)
            count += 1
        }
        let valid: [(String, VoiceCommand)] = [
            ("clean", .clean), ("Clean!", .clean), (" sloppy ", .sloppy), ("again", .again),
            ("undo", .undo), ("pause", .pause), ("resume", .resume),
            ("shaky", .shaky), ("Shaky.", .shaky), ("missed", .missed), (" MISSED ", .missed),
            ("start", .start), ("Start!", .start), ("stop", .stop), ("STOP", .stop),
            ("next", .next), ("Next.", .next), ("slower", .slower), ("faster", .faster),
            ("start metronome", .metronomeStart), ("metronome on", .metronomeStart),
            ("metronome start", .metronomeStart), ("stop metronome", .metronomeStop),
            ("metronome off", .metronomeStop), ("metronome stop", .metronomeStop),
            ("NEXT  PAGE.", .nextPage), ("previous page", .previousPage),
            ("tempo 20", .setTempo(20)), ("tempo 300", .setTempo(300)),
            ("tempo 96.5", .setTempo(96.5)), ("set tempo 72", .setTempo(72)),
            ("metronome ninety six", .setTempo(96)), ("tempo one hundred and twenty four", .setTempo(124)),
            ("tempo three hundred", .setTempo(300)), ("tempo two hundred ninety-nine", .setTempo(299)),
            ("tempo twenty", .setTempo(20)), ("tempo one hundred", .setTempo(100))
        ]
        for (text, command) in valid { expect(VoiceCommand.parse(text) == command, "Accept \(text)") }
        let invalid = ["", "please clean", "clean and sloppy", "unclean", "again again", "undo two",
                       "don't pause", "stop the music", "the next page is good", "sloppiness", "clean\nsloppy",
                       "please start", "start over", "stop please", "next steps", "faster please", "go faster",
                       "missing", "shakily", "we missed the bus", "shaky ground",
                       "tempo", "tempo nan", "tempo infinity", "tempo +inf", "tempo -20", "tempo 19",
                       "tempo 301", "tempo 96 please", "tempo 1e2", "tempo ninety six three", "tempo hundred",
                       "tempo one hundred and", "tempo three hundred one", "tempo one twenty", "tempo twenty zero"]
        for text in invalid { expect(VoiceCommand.parse(text) == nil, "Reject \(text)") }
        for bpm in [20.0, 60, 73.5, 120, 299, 300] {
            for beats in [1, 3, 4, 7, 12] {
                for sub in [1, 2, 3, 4] {
                    let pattern = try MetronomePattern(bpm: bpm, beatsPerBar: beats, subdivision: sub, sampleRate: 48_000)
                    expect(pattern.pulseFrames.count == beats * sub, "Pulse count")
                    expect(pattern.frameCount == Int((48_000 * 60 / bpm * Double(beats)).rounded()), "Bar length")
                    expect(pattern.pulseFrames.first == 0 && pattern.pulseFrames.last! < pattern.frameCount, "Pulse bounds")
                    for (index, frame) in pattern.pulseFrames.enumerated() {
                        let exact = Double(index) * 48_000 * 60 / bpm / Double(sub)
                        expect(abs(Double(frame) - exact) <= 0.500001, "Sample timing error")
                    }
                }
            }
        }
        let pattern = try MetronomePattern(bpm: 120, beatsPerBar: 4, subdivision: 2, sampleRate: 48_000)
        let samples = pattern.renderSamples()
        expect(samples.count == 96_000, "Rendered length")
        expect(samples.allSatisfy { $0.isFinite && abs($0) < 1 }, "No NaN or clipping")
        func peak(_ pulse: Int) -> Float { samples[pattern.pulseFrames[pulse]..<(pattern.pulseFrames[pulse] + 1_248)].map(abs).max()! }
        expect(peak(0) > peak(2) && peak(2) > peak(1), "Accent hierarchy")
        expect(samples[1_248..<12_000].allSatisfy { $0 == 0 }, "Silence between ticks")
        for value in [Double.nan, .infinity, -.infinity, 0, 19, 301] {
            do { _ = try MetronomePattern(bpm: value, beatsPerBar: 4, subdivision: 1, sampleRate: 48_000); preconditionFailure("Invalid BPM") }
            catch { count += 1 }
        }
        func rejects(_ label: String, _ operation: () throws -> Void) {
            do { try operation(); preconditionFailure(label) } catch { count += 1 }
        }
        for value in [Double.nan, .infinity, 0, 7_999, 192_001] {
            rejects("Invalid sample rate") { _ = try MetronomePattern(bpm: 80, beatsPerBar: 4, subdivision: 1, sampleRate: value) }
        }
        for beats in [0, 13, Int.max] {
            rejects("Invalid beat count") { _ = try MetronomePattern(bpm: 80, beatsPerBar: beats, subdivision: 1, sampleRate: 48_000) }
        }
        for sub in [0, 5, Int.max] {
            rejects("Invalid subdivision") { _ = try MetronomePattern(bpm: 80, beatsPerBar: 4, subdivision: sub, sampleRate: 48_000) }
        }
        rejects("Mismatched accents") { _ = try MetronomePattern(bpm: 80, beatsPerBar: 4, subdivision: 1, sampleRate: 48_000, accents: [.regular]) }
        var waveforms: [[Float]] = []
        for sound in MetronomeSound.allCases {
            let custom = try MetronomePattern(bpm: 300, beatsPerBar: 3, subdivision: 4, sampleRate: 48_000,
                                             accents: [.muted, .regular, .accented], sound: sound)
            let waveform = custom.renderSamples()
            expect(waveform.allSatisfy { $0.isFinite && abs($0) < 1 }, "\(sound) never clips at maximum subdivision")
            expect(waveform[0..<9_600].allSatisfy { $0 == 0 }, "Muted beat silences its subdivisions")
            expect(waveform[9_600..<12_000].contains { $0 != 0 }, "Regular beat is audible")
            expect(waveform == custom.renderSamples(), "Synthesis is reproducible")
            let regularPeak = waveform[9_600..<12_000].map(abs).max()!
            let accentPeak = waveform[19_200..<21_600].map(abs).max()!
            expect(accentPeak > regularPeak, "User-selected accent is stronger")
            waveforms.append(waveform)
        }
        for i in waveforms.indices {
            for j in waveforms.indices where j > i { expect(waveforms[i] != waveforms[j], "Sound \(i) and \(j) differ") }
        }
        let silent = try MetronomePattern(bpm: 120, beatsPerBar: 4, subdivision: 4, sampleRate: 8_000, accents: [.muted, .muted, .muted, .muted])
        expect(silent.renderSamples().allSatisfy { $0 == 0 }, "All-muted meter is silent")
        expect(BeatAccent.regular.next.next.next == .regular, "Accent cycle returns to original")
        expect(MetronomeSettings.accents(for: 6, denominator: 8) == [.accented, .regular, .regular, .accented, .regular, .regular], "Compound default groups three eighths")
        expect(MetronomeSettings.accents(for: 7, denominator: 8) == [.accented, .regular, .regular, .accented, .regular, .accented, .regular], "Asymmetric grouping is explicit")
        expect(MetronomeSettings.accents(for: Int.max, denominator: 8).isEmpty, "Invalid meter cannot allocate huge array")
        var settings = MetronomeSettings()
        settings.bpm = 73.5; settings.beatsPerBar = 3; settings.denominator = 8
        settings.accents = [.muted, .accented, .regular]; settings.sound = .bell; settings.volume = 0.25
        let decodedSettings = try JSONDecoder().decode(MetronomeSettings.self, from: JSONEncoder().encode(settings))
        expect(decodedSettings == settings && decodedSettings.isValid, "Saved custom settings round trip")
        for invalidSettings in [1, 2, 3, 4, 5, 6] {
            var invalid = settings
            switch invalidSettings {
            case 1: invalid.version = 2
            case 2: invalid.bpm = .nan
            case 3: invalid.volume = .infinity
            case 4: invalid.denominator = 0
            case 5: invalid.subdivision = 99
            default: invalid.accents = []
            }
            expect(!invalid.isValid, "Reject malformed persisted settings")
        }
        var taps = TapTempoEstimator()
        expect(taps.tap(at: 0) == nil, "First tap does not guess tempo")
        expect(taps.tap(at: 0.5) == 120, "Two half-second taps produce 120")
        expect(taps.tap(at: 0.51) == nil, "Bounce does not alter tempo")
        expect(taps.tap(at: .nan) == nil && taps.tap(at: -1) == nil, "Invalid tap times ignored")
        expect(taps.tap(at: 1) == 120, "Bounce did not contaminate averaging")
        expect(taps.tap(at: 1.5) == 120 && taps.tap(at: 2) == 120, "Steady taps stay steady")
        expect(taps.tap(at: 2.7) == 120, "One late tap is trimmed from recent window")
        expect(taps.tap(at: 10) == nil, "Long pause starts new tapping phrase")
        expect(taps.tap(at: 13) == 20, "Slowest supported tempo")
        var fastTaps = TapTempoEstimator()
        _ = fastTaps.tap(at: 0)
        expect(fastTaps.tap(at: 0.16) == 300, "Tap tempo clamps safely at maximum")

        let setID = UUID()
        func input(_ verdict: FeedbackVerdict = .clean, progress: Int = 1, ordinal: Int = 1) -> PracticeFeedbackInput {
            PracticeFeedbackInput(attemptID: UUID(), setID: setID, verdict: verdict, progressCount: progress, targetCount: 5, ordinal: ordinal)
        }
        let firstInput = input()
        let first = PracticeFeedbackEvent.make(firstInput)!
        let fourth = PracticeFeedbackEvent.make(input(progress: 4, ordinal: 4))!
        expect(first.kind == .clean && first.progress == 0.2 && first.setID == setID, "Clean acknowledgement keeps actual progress and set ownership")
        expect(fourth.intensity > first.intensity, "Earned clean feedback grows with progress")
        var completed = input(progress: 5)
        completed.setCompleted = true
        let setEvent = PracticeFeedbackEvent.make(completed)!
        expect(setEvent.kind == .set && setEvent.intensity > fourth.intensity, "Set completion is stronger")
        completed.hasVariants = true
        let chainEvent = PracticeFeedbackEvent.make(completed)!
        expect(chainEvent.kind == .chain && chainEvent.intensity > setEvent.intensity, "Chain completion has distinct finale")
        completed.hasVariants = false; completed.verdict = .sloppy
        expect(PracticeFeedbackEvent.make(completed)?.kind == .set, "Total-plays completion acknowledges volume without changing sloppy verdict")
        var advanced = input(progress: 0)
        advanced.stageAdvanced = true; advanced.nextVariant = "Reverse dotted"
        expect(PracticeFeedbackEvent.make(advanced)?.kind == .variant && PracticeFeedbackEvent.make(advanced)?.detail == "Next: Reverse dotted", "Variant transition shows next saved stage")
        advanced.tempoAdvanced = true; advanced.bpm = 96
        expect(PracticeFeedbackEvent.make(advanced)?.kind == .tempo && PracticeFeedbackEvent.make(advanced)?.detail == "96 BPM", "New tempo wins over stage reset")
        var setback = input(.again, progress: 2)
        setback.consecutiveSetbacks = 1
        let mildSetback = PracticeFeedbackEvent.make(setback)!
        setback.consecutiveSetbacks = 3
        let cappedSetback = PracticeFeedbackEvent.make(setback)!
        setback.consecutiveSetbacks = Int.max
        expect(cappedSetback.intensity > mildSetback.intensity && PracticeFeedbackEvent.make(setback)?.intensity == cappedSetback.intensity, "Setback variation is capped")
        expect(mildSetback.progress == 0.4, "Again can preserve earned variant progress")
        expect(PracticeFeedbackEvent.make(input(.reset)) == nil, "Reset has no reward")
        var invalidReward = input(); invalidReward.bpm = .nan
        expect(PracticeFeedbackEvent.make(invalidReward) == nil, "Invalid tempo cannot synthesize reward")
        var gate = PracticeFeedbackGate()
        gate.prime([firstInput.attemptID])
        expect(gate.accept(firstInput) == nil, "Reopening persisted attempts is silent")
        let freshInput = input()
        expect(gate.accept(freshInput) != nil && gate.accept(freshInput) == nil, "A saved event ID is rewarded once")
        let resetInput = input(.reset)
        expect(gate.accept(resetInput) == nil && gate.accept(resetInput) == nil, "Reset and retry remain silent")

        let events = [first, fourth, setEvent, chainEvent, mildSetback,
                      PracticeFeedbackEvent.make(input(.sloppy))!, PracticeFeedbackEvent.make(advanced)!]
        for event in events {
            let audio = try PracticeFeedbackPCM.render(event)
            expect(audio.allSatisfy { $0.isFinite && abs($0) < 1 }, "Reward PCM is bounded")
            expect(audio.first == 0 && abs(audio.last!) < 0.001, "Reward has quiet attack and release")
            expect(audio.contains { $0 != 0 }, "Enabled reward is audible")
            let repeatAudio = try PracticeFeedbackPCM.render(event)
            expect(audio == repeatAudio, "Reward synthesis is deterministic")
            let mutedAudio = try PracticeFeedbackPCM.render(event, volume: 0)
            expect(mutedAudio.allSatisfy { $0 == 0 }, "Zero-volume reward is silent")
            let wav = try PracticeFeedbackPCM.wavData(samples: audio, sampleRate: 48_000)
            expect(wav.count == 44 + audio.count * 2 && String(data: wav.prefix(4), encoding: .utf8) == "RIFF", "Local audio container has exact PCM length")
        }
        let firstAudio = try PracticeFeedbackPCM.render(first)
        let fourthAudio = try PracticeFeedbackPCM.render(fourth)
        func energy(_ values: [Float]) -> Double { values.reduce(0) { $0 + Double($1 * $1) } / Double(values.count) }
        expect(energy(fourthAudio) > energy(firstAudio), "Clean sound strengthens with earned progress")
        let varied = PracticeFeedbackEvent.make(input(ordinal: 3))!
        let variedAudio = try PracticeFeedbackPCM.render(varied)
        expect(variedAudio != firstAudio, "Successive repetitions vary their tone color")
        for invalid in [Double.nan, .infinity, -1, 1.01] {
            rejects("Invalid reward volume") { _ = try PracticeFeedbackPCM.render(first, volume: invalid) }
        }
        for invalid in [Double.nan, .infinity, 0, 7_999, 192_001] {
            rejects("Invalid reward rate") { _ = try PracticeFeedbackPCM.render(first, sampleRate: invalid) }
            rejects("Invalid WAV rate") { _ = try PracticeFeedbackPCM.wavData(samples: [0], sampleRate: invalid) }
        }
        rejects("Fractional WAV sample rate") { _ = try PracticeFeedbackPCM.wavData(samples: [0], sampleRate: 48_000.5) }
        rejects("Nonfinite WAV sample") { _ = try PracticeFeedbackPCM.wavData(samples: [.nan], sampleRate: 48_000) }
        let invalidEvent = PracticeFeedbackEvent(id: UUID(), setID: setID, kind: .clean, title: "", detail: "", progress: .infinity, intensity: 0.5, ordinal: 1)
        rejects("Nonfinite event progress") { _ = try PracticeFeedbackPCM.render(invalidEvent) }
        print("PASS: \(count) deterministic voice, metronome, tap-tempo, reward and PCM assertions")
    }
}
