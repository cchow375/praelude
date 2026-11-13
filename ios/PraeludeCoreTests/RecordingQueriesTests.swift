import Foundation
import XCTest
@testable import PraeludeCore

final class RecordingQueriesTests: XCTestCase {
    private let passageID = UUID()
    private let otherPassageID = UUID()

    private func recording(daysAgo: Int, from reference: Date, bytes: Int = 1_000, passage: UUID? = nil, deleted: Bool = false) -> AudioRecording {
        let date = reference.addingTimeInterval(-Double(daysAgo) * 86_400)
        return AudioRecording(passageID: passage ?? passageID, date: date, fileName: "\(UUID()).m4a",
                              duration: 30, byteSize: bytes, deletedAt: deleted ? date : nil)
    }

    func testLatestRecordingIsTheNewestNonDeletedOne() {
        let now = Date()
        let recordings = [
            recording(daysAgo: 10, from: now),
            recording(daysAgo: 0, from: now),
            recording(daysAgo: 1, from: now, deleted: false)
        ]
        let latest = recordings.latestRecording(forPassage: passageID)
        XCTAssertEqual(latest?.date, recordings[1].date)
    }

    func testDeletedRecordingsAreNeverReturned() {
        let now = Date()
        let onlyOne = recording(daysAgo: 0, from: now)
        var deletedNewer = recording(daysAgo: 0, from: now)
        deletedNewer.date = now.addingTimeInterval(60)
        deletedNewer.deletedAt = now
        let recordings = [onlyOne, deletedNewer]
        XCTAssertEqual(recordings.latestRecording(forPassage: passageID)?.id, onlyOne.id)
    }

    func testOtherPassagesAreExcluded() {
        let now = Date()
        let mine = recording(daysAgo: 0, from: now)
        let other = recording(daysAgo: 0, from: now, passage: otherPassageID)
        let recordings = [mine, other]
        XCTAssertEqual(recordings.recordings(forPassage: passageID).map(\.id), [mine.id])
    }

    func testNearestWeekAgoPicksTheClosestOlderRecordingNotTheLatest() {
        let now = Date()
        let latest = recording(daysAgo: 0, from: now)
        let aboutAWeekAgo = recording(daysAgo: 6, from: now)
        let twoWeeksAgo = recording(daysAgo: 14, from: now)
        let recordings = [latest, aboutAWeekAgo, twoWeeksAgo]
        let compare = recordings.recording(forPassage: passageID, nearestDaysAgo: 7, before: now)
        XCTAssertEqual(compare?.id, aboutAWeekAgo.id)
    }

    func testNoCompareCandidateWhenOnlyOneRecordingExists() {
        let now = Date()
        let recordings = [recording(daysAgo: 0, from: now)]
        XCTAssertNil(recordings.recording(forPassage: passageID, nearestDaysAgo: 7, before: now))
    }

    func testTotalStorageBytesSumsOnlyNonDeleted() {
        let now = Date()
        let recordings = [
            recording(daysAgo: 0, from: now, bytes: 1_000),
            recording(daysAgo: 1, from: now, bytes: 2_000),
            recording(daysAgo: 2, from: now, bytes: 5_000, deleted: true)
        ]
        XCTAssertEqual(recordings.totalStorageBytes, 3_000)
    }

    func testRecordingsOlderThanIsOldestFirstAndExcludesDeleted() {
        let now = Date()
        let recent = recording(daysAgo: 1, from: now)
        let old = recording(daysAgo: 40, from: now)
        let veryOld = recording(daysAgo: 90, from: now)
        let oldButDeleted = recording(daysAgo: 100, from: now, deleted: true)
        let recordings = [recent, old, veryOld, oldButDeleted]
        let candidates = recordings.recordingsOlderThan(days: 30, before: now)
        XCTAssertEqual(candidates.map(\.id), [veryOld.id, old.id])
    }
}
