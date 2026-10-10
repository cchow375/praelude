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
            ("tempo twenty", .setTempo(20)), ("tempo one hundred", .setTempo(100)),
            // "one twenty"/"two fifteen": the implicit-hundreds shorthand ("(C) Audit.md" — this
            // previously failed to parse at all).
            ("tempo one twenty", .setTempo(120)), ("tempo two fifteen", .setTempo(215))
        ]
        for (text, command) in valid { expect(VoiceCommand.parse(text) == command, "Accept \(text)") }
        let invalid = ["", "please clean", "clean and sloppy", "unclean", "again again", "undo two",
                       "don't pause", "stop the music", "the next page is good", "sloppiness", "clean\nsloppy",
                       "please start", "start over", "stop please", "next steps", "faster please", "go faster",
                       "missing", "shakily", "we missed the bus", "shaky ground",
                       "tempo", "tempo nan", "tempo infinity", "tempo +inf", "tempo -20", "tempo 19",
                       "tempo 301", "tempo 96 please", "tempo 1e2", "tempo ninety six three", "tempo hundred",
                       "tempo one hundred and", "tempo three hundred one", "tempo twenty zero"]
        for text in invalid { expect(VoiceCommand.parse(text) == nil, "Reject \(text)") }
        // Command mode repairs are constrained suggestions, never automatic history writes.
        for (text, command) in valid {
            expect(VoiceCommandRecognition.recognize(text) == .command(command), "Exact recognition \(text)")
        }
        for text in ["cleen", "glean", "green", "queen", "claen"] {
            expect(VoiceCommandRecognition.recognize(text) == .needsConfirmation([.clean]), "Confirm likely clean mishearing \(text)")
        }
        for (text, command) in [("paws", VoiceCommand.pause), ("and do", .undo), ("a gain", .again), ("shakey", .shaky), ("necks", .next), ("mist", .missed), ("miss", .missed)] {
            expect(VoiceCommandRecognition.recognize(text) == .needsConfirmation([command]), "Confirm likely mishearing \(text)")
        }
        for text in ["no clean", "don't clean", "clean and sloppy", "please clean", "we missed the bus", "go faster", "tempo ninety six three", "temppo 96", "unknown words"] {
            expect(VoiceCommandRecognition.recognize(text) == .ignored, "Never reinterpret arbitrary or negative speech \(text)")
        }
        expect(VoiceCommandRecognition.recognize("green", supportedActions: [.nextPage]) == .ignored, "Context excludes unavailable verdicts")
        expect(VoiceCommandRecognition.recognize("clean", supportedActions: [.nextPage]) == .ignored, "Context also excludes exact unavailable verdicts")
        var aliases = try VoiceAliasConfiguration().updating(["well done", "all clear"], for: .clean)
        aliases = try aliases.updating(["speed"], for: .tempo)
        expect(VoiceCommandRecognition.recognize("Well  done!", aliases: aliases) == .command(.clean), "Explicit custom phrase")
        expect(VoiceCommandRecognition.recognize("all clear", aliases: aliases) == .command(.clean), "Second custom phrase")
        expect(VoiceCommandRecognition.recognize("speed ninety six", aliases: aliases) == .command(.setTempo(96)), "Custom tempo prefix")
        expect(VoiceCommandRecognition.recognize("speed 301", aliases: aliases) == .ignored, "Custom tempo validation")
        expect(VoiceCommandRecognition.recognize("all clearly", aliases: aliases) == .ignored, "Custom phrase does not match conversational fragment")
        let reopenedAliases = try JSONDecoder().decode(VoiceAliasConfiguration.self, from: JSONEncoder().encode(aliases))
        expect(reopenedAliases == aliases, "Alias preferences round trip")
        let historyCommands: [VoiceCommand] = [.clean, .sloppy, .again, .shaky, .missed, .undo, .start, .stop, .next]
        for command in historyCommands { expect(command.altersPracticeHistory, "Focus guards \(command)") }
        for command: VoiceCommand in [.pause, .resume, .nextPage, .previousPage, .slower, .faster, .setTempo(90), .metronomeStart, .metronomeStop] {
            expect(!command.altersPracticeHistory, "Focus retains \(command)")
        }
        func rejectsAliases(_ phrases: [String], _ action: VoiceCommandAction) {
            do { _ = try aliases.updating(phrases, for: action); preconditionFailure("Unsafe alias accepted: \(phrases)") }
            catch { count += 1 }
        }
        rejectsAliases(["clean"], .again)
        rejectsAliases(["well done"], .again)
        rejectsAliases(["clean"], .clean)
        rejectsAliases(["cleen"], .again)
        rejectsAliases(["no thanks"], .clean)
        rejectsAliases(["confirm"], .clean)
        rejectsAliases(["cancel now"], .clean)
        rejectsAliases(["x"], .clean)
        rejectsAliases(["count 2"], .clean)
        rejectsAliases(["my phrase", "another phrase", "a third phrase", "a fourth phrase"], .clean)
        // Default parameterized grammar has the same reservation as the fixed vocabulary.
        for phrase in ["tempo sixty", "set tempo ninety", "metronome eighty"] {
            rejectsAliases([phrase], .clean)
            rejectsAliases([phrase], .tempo)
            expect(VoiceCommandRecognition.recognize(phrase, aliases: aliases) == .command(VoiceCommand.parse(phrase)!), "Default tempo grammar remains authoritative: \(phrase)")
        }
        rejectsAliases(["speed sixty"], .clean)
        rejectsAliases(["speed", "speed sixty"], .tempo)
        rejectsAliases(["speed sixty", "speed"], .tempo)
        // Collision detection must also work when the fixed alias was saved before the tempo prefix.
        let firstFixedAlias = try VoiceAliasConfiguration().updating(["speed sixty"], for: .clean)
        do { _ = try firstFixedAlias.updating(["speed"], for: .tempo); preconditionFailure("A new tempo prefix must not steal an existing phrase") }
        catch { count += 1 }
        var persistedNumericConflict = VoiceAliasConfiguration()
        persistedNumericConflict.phrases = ["clean": ["speed sixty"], "tempo": ["speed"]]
        expect(VoiceCommandRecognition.recognize("speed sixty", aliases: persistedNumericConflict) == .ignored, "Invalid persisted numeric collisions cannot execute a custom action")
        expect(VoiceCommandRecognition.recognize("tempo sixty", aliases: persistedNumericConflict) == .command(.setTempo(60)), "Invalid persisted configuration retains default numeric grammar")
        let ambiguousAliases = try VoiceAliasConfiguration().updating(["bloom"], for: .clean).updating(["brood"], for: .again)
        expect(VoiceCommandRecognition.recognize("broom", aliases: ambiguousAliases) == .needsConfirmation([.clean, .again]), "Two equally close actions remain ambiguous")
        let restoredAliases = try aliases.updating([], for: .clean)
        expect(restoredAliases.aliases(for: .clean).isEmpty, "Remove customization without changing defaults")
        expect(VoiceCommandRecognition.recognize("clean", aliases: restoredAliases) == .command(.clean), "Default phrase always retained")
        var malformedAliases = VoiceAliasConfiguration()
        malformedAliases.phrases = ["again": ["clean"]]
        expect(VoiceCommandRecognition.recognize("clean", aliases: malformedAliases) == .command(.clean), "Malformed persisted aliases cannot redefine defaults")
        expect(VoiceCommandRecognition.recognize("cleanly", aliases: malformedAliases) == .ignored, "Malformed configuration never extends vocabulary")
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
        let phasePattern = try MetronomePattern(bpm: 120, beatsPerBar: 4, subdivision: 1, sampleRate: 48_000)
        let phaseSamples = phasePattern.renderSamples()
        let rotated = MetronomeSamples.rotated(phaseSamples, startingAt: 12_000)
        expect(rotated.prefix(12_000).allSatisfy { $0 == 0 }, "A mid-beat update waits for the next click instead of inventing a downbeat")
        expect(Array(rotated[12_000..<13_200]) == Array(phaseSamples[24_000..<25_200]), "The next regular beat keeps its timbre and exact remaining timing")
        expect(MetronomeSamples.rotated([], startingAt: 3).isEmpty, "Empty loops remain safe")
        expect(MetronomeSamples.rotated(phaseSamples, startingAt: phaseSamples.count) == phaseSamples, "Whole-cycle offsets preserve PCM")
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
        var compound = MetronomeSettings()
        compound.beatsPerBar = 6; compound.denominator = 8; compound.beatGrouping = 3
        compound.accents = [.accented, .regular, .regular, .regular, .regular, .regular]
        expect(compound.isValid && compound.pulsesPerBar == 2, "6/8 can count two dotted-quarter pulses")
        expect(compound.pulseAccents == [.accented, .regular], "Compound accents follow the counted pulse")
        expect(compound.barDurationSeconds == 1.5, "80 dotted quarters makes a 1.5-second 6/8 bar")
        let compoundPattern = try MetronomePattern(bpm: compound.bpm, beatsPerBar: compound.pulsesPerBar,
                                                 subdivision: 3, sampleRate: 48_000, accents: compound.pulseAccents)
        expect(compoundPattern.frameCount == 72_000 && compoundPattern.pulseFrames == [0, 12_000, 24_000, 36_000, 48_000, 60_000], "Triplet subdivision recovers six eighths without tripling the typed BPM")
        compound.denominator = 4
        expect(!compound.isValid, "Dotted grouping cannot silently survive a simple meter")
        let legacyBlob = try JSONSerialization.jsonObject(with: JSONEncoder().encode(settings)) as! [String: Any]
        var legacySettings = legacyBlob; legacySettings.removeValue(forKey: "beatGrouping")
        let legacyDecoded = try JSONDecoder().decode(MetronomeSettings.self, from: JSONSerialization.data(withJSONObject: legacySettings))
        expect(legacyDecoded.beatGrouping == 1, "Older settings keep their written-note pulse")

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
        taps.reset()
        expect(taps.tap(at: 13.5) == nil, "Manual tempo changes can reset a stale tap phrase")
        expect(taps.tap(at: 14.25) == 80, "A new tapping phrase does not average against prior practice")
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
