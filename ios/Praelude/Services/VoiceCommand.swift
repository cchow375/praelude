import Foundation

/// Deterministic local voice commands. Only complete supported phrases execute directly.
/// Likely recognition mistakes are suggestions requiring an explicit confirmation.
enum VoiceCommand: Equatable, Hashable, Sendable {
    case clean, sloppy, again, undo, pause, resume
    case shaky, missed
    case start, stop, next
    case slower, faster
    case metronomeStart, metronomeStop
    case setTempo(Double)
    case nextPage, previousPage

    static func parse(_ transcript: String) -> VoiceCommand? {
        let phrase = normalizedPhrase(transcript)
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
        case "next set": return .next
        case "slower": return .slower
        case "faster": return .faster
        case "metronome start", "start metronome", "metronome on": return .metronomeStart
        case "metronome stop", "stop metronome", "metronome off": return .metronomeStop
        case "next", "next page": return .nextPage
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

    static func normalizedPhrase(_ text: String) -> String {
        text.lowercased().trimmingCharacters(in: .whitespacesAndNewlines.union(.punctuationCharacters))
            .split(whereSeparator: \.isWhitespace).joined(separator: " ")
    }

    var action: VoiceCommandAction {
        switch self {
        case .clean: .clean
        case .sloppy: .sloppy
        case .again: .again
        case .undo: .undo
        case .pause: .pause
        case .resume: .resume
        case .shaky: .shaky
        case .missed: .missed
        case .start: .start
        case .stop: .stop
        case .next: .next
        case .slower: .slower
        case .faster: .faster
        case .metronomeStart: .metronomeStart
        case .metronomeStop: .metronomeStop
        case .setTempo: .tempo
        case .nextPage: .nextPage
        case .previousPage: .previousPage
        }
    }

    /// Score focus keeps the set intact and the microphone live, while rejecting rep/history input.
    var altersPracticeHistory: Bool {
        switch self {
        case .clean, .sloppy, .again, .shaky, .missed, .undo, .start, .stop, .next: true
        default: false
        }
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
        // "one twenty"/"two fifteen": the implicit-hundreds shorthand people use to read a 3-digit
        // number in pairs, the same way a year like "nineteen forty-five" is spoken — a bare 1–9
        // digit word directly followed by a 0–99 phrase, with no "hundred" in between. `units[words[0]]`
        // only ever matches a single-digit word, and `tens[words[0]]` (what `underHundred` below keys
        // off for its own two-word case, "twenty one") is always nil for one, so this can never
        // intercept an ordinary two-word phrase already handled there. See "(C) Audit.md":
        // "tempo one twenty" previously failed to parse at all.
        if words.count >= 2, let hundreds = units[words[0]], let suffix = underHundred(Array(words.dropFirst())) {
            return hundreds * 100 + suffix
        }
        return underHundred(words)
    }
}


/// Stable identifiers for customizable phrases. Tempo phrases are prefixes followed by a number.
enum VoiceCommandAction: String, Codable, CaseIterable, Identifiable, Sendable {
    case clean, sloppy, again, undo, pause, resume, shaky, missed, start, stop, next, slower, faster
    case metronomeStart, metronomeStop, tempo, nextPage, previousPage
    var id: String { rawValue }

    var label: String {
        switch self {
        case .metronomeStart: "Metronome on"
        case .metronomeStop: "Metronome off"
        case .tempo: "Set tempo"
        case .next: "Next set"
        case .nextPage: "Next page"
        case .previousPage: "Previous page"
        default: rawValue.capitalized
        }
    }

    var phrases: [String] {
        switch self {
        case .metronomeStart: ["metronome start", "start metronome", "metronome on"]
        case .metronomeStop: ["metronome stop", "stop metronome", "metronome off"]
        case .tempo: ["tempo", "set tempo", "metronome"]
        case .next: ["next set"]
        case .nextPage: ["next", "next page"]
        case .previousPage: ["previous page"]
        default: [rawValue]
        }
    }

    var command: VoiceCommand? { self == .tempo ? nil : VoiceCommand.parse(phrases[0]) }
}

struct VoiceAliasConfiguration: Codable, Equatable, Sendable {
    var version = 1
    var phrases: [String: [String]] = [:]

    func aliases(for action: VoiceCommandAction) -> [String] { phrases[action.rawValue] ?? [] }

    func updating(_ aliases: [String], for action: VoiceCommandAction) throws -> Self {
        var updated = self
        let normalized = aliases.map(VoiceCommand.normalizedPhrase).filter { !$0.isEmpty }
        if normalized.isEmpty { updated.phrases.removeValue(forKey: action.rawValue) }
        else { updated.phrases[action.rawValue] = normalized }
        try updated.validate()
        return updated
    }

    func validate() throws {
        guard version == 1, phrases.keys.allSatisfy({ VoiceCommandAction(rawValue: $0) != nil }) else {
            throw AliasError.invalid("Saved command phrases are unsupported. Restore default phrases to recover.")
        }
        // Check against every numeric prefix up front, independent of action iteration order.
        // Otherwise a phrase like "speed sixty" could become Clean before "speed" is later
        // registered as a tempo prefix, while recognition always parses it as a tempo command.
        let tempoPrefixes = VoiceCommandAction.tempo.phrases + aliases(for: .tempo)
        func parameterizedTempo(_ phrase: String) -> VoiceCommand? {
            for prefix in tempoPrefixes where phrase.hasPrefix(prefix + " ") {
                if let command = VoiceCommand.parse("tempo " + phrase.dropFirst(prefix.count + 1)) { return command }
            }
            return nil
        }
        var owners: [String: VoiceCommandAction] = [:]
        for action in VoiceCommandAction.allCases {
            for phrase in action.phrases { owners[phrase] = action }
        }
        for action in VoiceCommandAction.allCases {
            let aliases = aliases(for: action)
            guard aliases.count <= 3 else { throw AliasError.invalid("Use up to three extra phrases per action.") }
            for phrase in aliases {
                let words = phrase.split(separator: " ")
                guard phrase == VoiceCommand.normalizedPhrase(phrase), (3...50).contains(phrase.count),
                      (1...5).contains(words.count), phrase.unicodeScalars.allSatisfy({ CharacterSet.letters.union(.whitespaces).union(CharacterSet(charactersIn: "'-")).contains($0) }),
                      !VoiceCommandRecognition.containsNegation(phrase), !words.contains("confirm"), !words.contains("cancel") else {
                    throw AliasError.invalid("Use a short phrase of letters and spaces, without confirm, cancel, or a negative instruction.")
                }
                if let parsed = VoiceCommand.parse(phrase), parsed.action != action {
                    throw AliasError.invalid("\u{201c}\(phrase)\u{201d} already belongs to \(parsed.action.label). Choose a different phrase.")
                }
                if parameterizedTempo(phrase) != nil {
                    if action == .tempo {
                        throw AliasError.invalid("\u{201c}\(phrase)\u{201d} already includes a tempo number. Choose a prefix without the number.")
                    }
                    throw AliasError.invalid("\u{201c}\(phrase)\u{201d} already belongs to Set tempo. Choose a different phrase.")
                }
                if let other = owners[phrase] {
                    throw AliasError.invalid("\u{201c}\(phrase)\u{201d} already belongs to \(other.label). Choose a different phrase.")
                }
                // Reject similar custom phrases instead of making the user discover a collision in practice.
                if let similar = owners.first(where: { VoiceCommandRecognition.isNear(phrase, $0.key) && $0.value != action }) {
                    throw AliasError.invalid("\u{201c}\(phrase)\u{201d} is too close to \(similar.value.label). Choose a more distinct phrase.")
                }
                owners[phrase] = action
            }
        }
    }

    enum AliasError: LocalizedError {
        case invalid(String)
        var errorDescription: String? { if case .invalid(let message) = self { message } else { nil } }
    }
}

enum VoiceCommandRecognition: Equatable {
    case command(VoiceCommand)
    case needsConfirmation([VoiceCommand])
    case ignored

    /// No transcript fragments or arbitrary semantic guesses. A unique near match still needs confirmation.
    static func recognize(_ transcript: String, aliases: VoiceAliasConfiguration = .init(),
                          supportedActions: Set<VoiceCommandAction> = Set(VoiceCommandAction.allCases)) -> Self {
        let phrase = VoiceCommand.normalizedPhrase(transcript)
        guard !phrase.isEmpty, phrase.count <= 80, !containsNegation(phrase) else { return .ignored }
        if let command = VoiceCommand.parse(phrase) {
            return supportedActions.contains(command.action) ? .command(command) : .ignored
        }
        // Invalid persisted settings never redefine the supported vocabulary.
        let validAliases = (try? aliases.validate()) != nil ? aliases : VoiceAliasConfiguration()
        var vocabulary: [(String, VoiceCommandAction)] = []
        for action in VoiceCommandAction.allCases where supportedActions.contains(action) {
            let actionPhrases = action.phrases + validAliases.aliases(for: action)
            if action == .tempo {
                for prefix in actionPhrases where phrase.hasPrefix(prefix + " ") {
                    if let command = VoiceCommand.parse("tempo " + phrase.dropFirst(prefix.count + 1)) { return .command(command) }
                }
            } else {
                if actionPhrases.contains(phrase), let command = action.command { return .command(command) }
                vocabulary += actionPhrases.map { ($0, action) }
            }
        }
        let knownMishearings: [String: VoiceCommandAction] = [
            "cleen": .clean, "glean": .clean, "green": .clean, "queen": .clean,
            "a gain": .again, "and do": .undo, "paws": .pause, "shakey": .shaky,
            "necks": .nextPage, "mist": .missed, "miss": .missed
        ]
        var candidates = Set(vocabulary.filter { isNear(phrase, $0.0) }.map { $0.1 })
        if let known = knownMishearings[phrase], supportedActions.contains(known) { candidates.insert(known) }
        let commands = VoiceCommandAction.allCases.filter { candidates.contains($0) }.compactMap(\.command)
        return commands.isEmpty ? .ignored : .needsConfirmation(commands)
    }

    static func containsNegation(_ phrase: String) -> Bool {
        let words = Set(phrase.split(separator: " ").map(String.init))
        return !words.isDisjoint(with: ["no", "not", "don't", "dont", "never", "cannot", "can't", "cant", "without"])
    }

    /// One insertion, deletion, replacement or adjacent transposition, with the same word count.
    /// Short tokens and tempo numbers are intentionally excluded from fuzzy repair.
    static func isNear(_ first: String, _ second: String) -> Bool {
        guard first != second, min(first.count, second.count) >= 4,
              first.split(separator: " ").count == second.split(separator: " ").count,
              !first.unicodeScalars.contains(where: CharacterSet.decimalDigits.contains),
              abs(first.count - second.count) <= 1 else { return false }
        let a = Array(first), b = Array(second)
        if a.count == b.count {
            let differences = a.indices.filter { a[$0] != b[$0] }
            if differences.count == 1 { return true }
            if differences.count == 2 {
                let i = differences[0], j = differences[1]
                return j == i + 1 && a[i] == b[j] && a[j] == b[i]
            }
            return false
        }
        let short = a.count < b.count ? a : b, long = a.count < b.count ? b : a
        var index = 0
        while index < short.count, short[index] == long[index] { index += 1 }
        return Array(short[index...]) == Array(long[(index + 1)...])
    }
}


/// Values copied from Apple speech segments; no audio or recognizer objects cross actor boundaries.
struct VoiceRecognizedSegment: Equatable, Sendable {
    let text: String
    let timestamp: TimeInterval
    let duration: TimeInterval
}

enum VoiceFinalUtterances {
    /// A recognizer may combine repeated verdicts into one final result. Split only identical,
    /// exact one-word verdicts with distinct, ordered acoustic segments and >=300 ms gaps.
    /// No word-count guessing: repeated/corrected partial text without timing remains one phrase.
    static func phrases(_ transcript: String, segments: [VoiceRecognizedSegment],
                        aliases: VoiceAliasConfiguration, supportedActions: Set<VoiceCommandAction>) -> [String] {
        let phrase = VoiceCommand.normalizedPhrase(transcript)
        guard (2...8).contains(segments.count) else { return [phrase] }
        let words = segments.map { VoiceCommand.normalizedPhrase($0.text) }
        guard words.allSatisfy({ $0 == words[0] && $0.split(separator: " ").count == 1 }),
              words.joined(separator: " ") == phrase,
              case .command(let command) = VoiceCommandRecognition.recognize(words[0], aliases: aliases, supportedActions: supportedActions),
              [.clean, .sloppy, .again].contains(command),
              segments.allSatisfy({ $0.timestamp.isFinite && $0.timestamp >= 0 && $0.duration.isFinite && $0.duration > 0 }) else { return [phrase] }
        for index in 1..<segments.count {
            let previousEnd = segments[index - 1].timestamp + segments[index - 1].duration
            guard segments[index].timestamp - previousEnd >= 0.3 else { return [phrase] }
        }
        return words
    }
}
