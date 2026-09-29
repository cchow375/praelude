import Foundation
import Observation

/// §9: "misrecognitions logged locally... viewable/clearable in Settings." A rejected phrase is
/// diagnostic text about how well the microphone hears this room and this voice — not practice data
/// (reps, passages, scores, profile) — so it lives in `UserDefaults`, on this device only, capped and
/// FIFO-trimmed rather than growing without bound. Clearing it is a deliberate, reversible-only-by-
/// hearing-more Settings action, never a practice-data delete, so it does not go through
/// `PracticeStore`/schema3's tombstone contract.
struct VoiceMisrecognitionEntry: Identifiable, Codable, Equatable {
    var id: UUID
    var text: String
    var date: Date
    init(id: UUID = UUID(), text: String, date: Date = Date()) { self.id = id; self.text = text; self.date = date }
}

@MainActor @Observable
final class VoiceMisrecognitionLog {
    static let shared = VoiceMisrecognitionLog()
    /// Bounded so an unattended session with the mic left on cannot grow this indefinitely.
    static let capacity = 200

    private(set) var entries: [VoiceMisrecognitionEntry] = []
    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private let key = "praelude.ios.voice.misrecognitions"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        if let data = defaults.data(forKey: key), let decoded = try? JSONDecoder().decode([VoiceMisrecognitionEntry].self, from: data) {
            entries = decoded
        }
    }

    /// A heard phrase that did not match any command in the fixed vocabulary. Blank transcripts
    /// (silence, a stray breath) are not recorded — there is nothing to review about those.
    func record(_ text: String, date: Date = Date()) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        entries.append(VoiceMisrecognitionEntry(text: trimmed, date: date))
        if entries.count > Self.capacity { entries.removeFirst(entries.count - Self.capacity) }
        persist()
    }

    func clear() {
        guard !entries.isEmpty else { return }
        entries.removeAll()
        persist()
    }

    private func persist() {
        guard let data = try? JSONEncoder().encode(entries) else { return }
        defaults.set(data, forKey: key)
    }
}
