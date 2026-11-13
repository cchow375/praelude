import Foundation

/// Pure lookups over saved recordings (§13). These only ever read `AudioRecording` metadata —
/// filename, date, byte size — never the audio itself: recordings are never analyzed.
public extension Array where Element == AudioRecording {
    /// Non-deleted recordings for a passage (optionally narrowed to one set), newest first.
    func recordings(forPassage passageID: UUID, setID: UUID? = nil) -> [AudioRecording] {
        filter { $0.deletedAt == nil && $0.passageID == passageID && (setID == nil || $0.setID == setID) }
            .sorted { $0.date > $1.date }
    }

    /// The most recent recording for a passage ("tap passage to hear last recording", §13).
    func latestRecording(forPassage passageID: UUID) -> AudioRecording? {
        recordings(forPassage: passageID).first
    }

    /// The recording closest to `daysAgo` days before `referenceDate`, for a "then vs. now"
    /// compare — `nil` when there is nothing besides the latest recording itself to compare against.
    func recording(forPassage passageID: UUID, nearestDaysAgo daysAgo: Int, before referenceDate: Date = Date()) -> AudioRecording? {
        let all = recordings(forPassage: passageID)
        guard let latest = all.first, all.count > 1 else { return nil }
        let target = referenceDate.addingTimeInterval(-Double(daysAgo) * 86_400)
        guard let candidate = all.dropFirst().min(by: {
            abs($0.date.timeIntervalSince(target)) < abs($1.date.timeIntervalSince(target))
        }), candidate.id != latest.id else { return nil }
        return candidate
    }

    /// Total on-disk bytes across non-deleted recordings, for the storage-used display.
    var totalStorageBytes: Int { filter { $0.deletedAt == nil }.reduce(0) { $0 + $1.byteSize } }

    /// Non-deleted recordings older than `days`, oldest first — cleanup candidates.
    func recordingsOlderThan(days: Int, before referenceDate: Date = Date()) -> [AudioRecording] {
        let cutoff = referenceDate.addingTimeInterval(-Double(days) * 86_400)
        return filter { $0.deletedAt == nil && $0.date < cutoff }.sorted { $0.date < $1.date }
    }
}
