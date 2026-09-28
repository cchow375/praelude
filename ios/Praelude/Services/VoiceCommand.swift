import Foundation

/// The entire voice hot loop. Only complete, explicitly recognized phrases are actions.
/// The recognizer never evaluates piano audio or sends these commands to a model.
///
/// §9's fixed vocabulary in three groups: warm verdicts (`clean`/`sloppy`/`again`/`undo`), set
/// control (`start`/`stop`/`pause`/`slower`/`faster`/`setTempo`/`metronomeStart`/`metronomeStop`/
/// `next`), and cold-attempt grading (`clean`/`shaky`/`missed` — `clean` is shared with the warm
/// scale since a cold Clean and a warm Clean are the same spoken word; which one a heard "clean"
/// means is a caller-side question of whether a cold grade is currently being asked for, not a
/// parsing question). Every case here is a complete, exact phrase match — no substring or fuzzy
/// matching — so an ambient conversational fragment ("no thanks", "again, like I said...") can
/// never masquerade as a command. See "(C) Flaws.md" A1/B24 for why that firewall matters: real use
/// at an acoustic instrument produced both missed words and false positives from ordinary speech.
enum VoiceCommand: Equatable, Hashable, Sendable {
    case clean, sloppy, again, undo, pause, resume
    case shaky, missed
    case start, stop, next
    case slower, faster
    case metronomeStart, metronomeStop
    case setTempo(Double)
    case nextPage, previousPage

    static func parse(_ transcript: String) -> VoiceCommand? {
        let phrase = transcript.lowercased()
            .trimmingCharacters(in: .whitespacesAndNewlines.union(.punctuationCharacters))
            .split(whereSeparator: \.isWhitespace).joined(separator: " ")
        switch phrase {
        case "clean": return .clean
        case "sloppy": return .sloppy
        case "again": return .again
        case "undo": return .undo
        case "pause": return .pause
        case "resume": return .resume
        case "shaky": return .shaky
        case "missed": return .missed
        case "start": return .start
        case "stop": return .stop
        case "next": return .next
        case "slower": return .slower
        case "faster": return .faster
        case "metronome start", "start metronome", "metronome on": return .metronomeStart
        case "metronome stop", "stop metronome", "metronome off": return .metronomeStop
        case "next page": return .nextPage
        case "previous page": return .previousPage
        default: break
        }
        for prefix in ["set tempo ", "tempo ", "metronome "] where phrase.hasPrefix(prefix) {
            let argument = String(phrase.dropFirst(prefix.count))
            let bpm: Double?
            if argument.range(of: #"^[0-9]+(?:\.[0-9]+)?$"#, options: .regularExpression) != nil {
                bpm = Double(argument)
            } else {
                bpm = spokenNumber(argument).map(Double.init)
            }
            guard let bpm, bpm.isFinite, (20...300).contains(bpm) else { return nil }
            return .setTempo(bpm)
        }
        return nil
    }

    private static func spokenNumber(_ phrase: String) -> Int? {
        let words = phrase.replacingOccurrences(of: "-", with: " ")
            .split(separator: " ").map(String.init)
        let units = ["one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
                     "six": 6, "seven": 7, "eight": 8, "nine": 9]
        let small = units.merging(["ten": 10, "eleven": 11, "twelve": 12,
                                  "thirteen": 13, "fourteen": 14, "fifteen": 15,
                                  "sixteen": 16, "seventeen": 17, "eighteen": 18,
                                  "nineteen": 19]) { first, _ in first }
        let tens = ["twenty": 20, "thirty": 30, "forty": 40, "fifty": 50,
                    "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90]
        func underHundred(_ words: [String]) -> Int? {
            if words.count == 1 { return small[words[0]] ?? tens[words[0]] }
            if words.count == 2, let ten = tens[words[0]], let unit = units[words[1]] {
                return ten + unit
            }
            return nil
        }
        if words.count >= 2, let hundreds = units[words[0]], words[1] == "hundred" {
            var remainder = Array(words.dropFirst(2))
            if remainder.isEmpty { return hundreds * 100 }
            if remainder.first == "and" { remainder.removeFirst() }
            guard let suffix = underHundred(remainder) else { return nil }
            return hundreds * 100 + suffix
        }
        return underHundred(words)
    }
}
