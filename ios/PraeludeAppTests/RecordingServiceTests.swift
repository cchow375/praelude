import Foundation
import XCTest
@testable import Praelude

/// Covers the file-management/cleanup side of `RecordingService` without touching real
/// `AVAudioRecorder`/`AVAudioPlayer` I/O (see `RuntimeFeedbackTests`'s §13 section for why the
/// suite avoids exercising real audio-hardware capture): recordings here are plain files this test
/// writes directly, exactly the shape a finished take would have left behind.
final class RecordingServiceTests: XCTestCase {
    @MainActor
    private func makeStore() throws -> (store: PracticeStore, directory: URL) {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("Praelude-Recording-\(UUID().uuidString)", isDirectory: true)
        return (PracticeStore(directory: directory), directory)
    }

    private func freshDefaults() throws -> UserDefaults {
        try XCTUnwrap(UserDefaults(suiteName: "Praelude-Recording-\(UUID().uuidString)"))
    }

    @MainActor
    func testRecordingsDirectoryMirrorsTheScoresConvention() throws {
        let (store, directory) = try makeStore()
        defer { try? FileManager.default.removeItem(at: directory) }
        XCTAssertEqual(RecordingService.recordingsDirectory(in: store), store.directory.appendingPathComponent("Recordings", isDirectory: true))
        let recording = AudioRecording(fileName: "take-abc.m4a", duration: 3, byteSize: 10)
        let service = RecordingService(defaults: try freshDefaults())
        XCTAssertEqual(service.fileURL(for: recording, in: store), store.directory.appendingPathComponent("Recordings/take-abc.m4a"))
    }

    @MainActor
    func testCleanUpDeletesFilesAndTombstonesMetadataOnlyForOldRecordings() throws {
        let (store, directory) = try makeStore()
        defer { try? FileManager.default.removeItem(at: directory) }
        let recordingsDir = RecordingService.recordingsDirectory(in: store)
        try FileManager.default.createDirectory(at: recordingsDir, withIntermediateDirectories: true)
        let oldFileName = "take-old.m4a", recentFileName = "take-recent.m4a"
        try Data("old".utf8).write(to: recordingsDir.appendingPathComponent(oldFileName))
        try Data("recent".utf8).write(to: recordingsDir.appendingPathComponent(recentFileName))
        let old = AudioRecording(date: Date().addingTimeInterval(-40 * 86_400), fileName: oldFileName, duration: 12, byteSize: 3)
        let recent = AudioRecording(date: Date().addingTimeInterval(-2 * 86_400), fileName: recentFileName, duration: 12, byteSize: 6)
        try store.saveRecording(old)
        try store.saveRecording(recent)

        let service = RecordingService(defaults: try freshDefaults())
        let removed = service.cleanUpRecordings(olderThanDays: 30, in: store)

        XCTAssertEqual(removed, 1)
        XCTAssertFalse(FileManager.default.fileExists(atPath: recordingsDir.appendingPathComponent(oldFileName).path), "The old take's file should be deleted")
        XCTAssertTrue(FileManager.default.fileExists(atPath: recordingsDir.appendingPathComponent(recentFileName).path), "The recent take's file must survive")
        let oldAfter = try XCTUnwrap(store.recordings.first { $0.id == old.id })
        XCTAssertNotNil(oldAfter.deletedAt, "Deletion tombstones the metadata rather than removing the row")
        let recentAfter = try XCTUnwrap(store.recordings.first { $0.id == recent.id })
        XCTAssertNil(recentAfter.deletedAt)
    }

    @MainActor
    func testCleanUpWithNothingOldDoesNothing() throws {
        let (store, directory) = try makeStore()
        defer { try? FileManager.default.removeItem(at: directory) }
        try store.saveRecording(AudioRecording(date: Date(), fileName: "take-new.m4a", duration: 5, byteSize: 1))
        let service = RecordingService(defaults: try freshDefaults())
        XCTAssertEqual(service.cleanUpRecordings(olderThanDays: 30, in: store), 0)
        XCTAssertNil(store.recordings.first?.deletedAt)
    }

    @MainActor
    func testCleanUpIgnoresAlreadyDeletedRecordings() throws {
        let (store, directory) = try makeStore()
        defer { try? FileManager.default.removeItem(at: directory) }
        var deleted = AudioRecording(date: Date().addingTimeInterval(-90 * 86_400), fileName: "take-gone.m4a", duration: 5, byteSize: 1)
        deleted.deletedAt = Date()
        try store.saveRecording(deleted)
        let service = RecordingService(defaults: try freshDefaults())
        XCTAssertEqual(service.cleanUpRecordings(olderThanDays: 30, in: store), 0, "Already-deleted recordings are not cleanup candidates again")
    }
}
