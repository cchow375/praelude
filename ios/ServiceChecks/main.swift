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
        print("PASS: \(count) deterministic router and sample-pattern assertions")
    }
}
