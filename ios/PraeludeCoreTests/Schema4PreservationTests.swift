import Foundation
import XCTest
@testable import PraeludeCore

final class Schema4PreservationTests: XCTestCase {
    private func encode(_ state: LibraryState) throws -> Data {
        let encoder = JSONEncoder(); encoder.dateEncodingStrategy = .deferredToDate
        return try encoder.encode(state)
    }
    private func decode(_ data: Data) throws -> LibraryState {
        let decoder = JSONDecoder(); decoder.dateDecodingStrategy = .deferredToDate
        return try decoder.decode(LibraryState.self, from: data)
    }
    @MainActor private func fixture() throws -> PracticeStore {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
        let store = PracticeStore(directory: directory)
        try store.addPiece(Piece(title: "Keep this practice"))
        try store.startSet(PracticeConfiguration(pieceID: store.pieces[0].id, targetCount: 2,
                                               startBPM: 60, targetBPM: 80))
        try store.record(.clean)
        try store.pause()
        return store
    }
    @MainActor func testSchema3UpgradePreservesExactOriginalAndEveryExistingValue() async throws {
        let store = try fixture()
        var old = store.state; old.schemaVersion = 3
        let original = try encode(old)
        try original.write(to: store.fileURL, options: .atomic)
        let upgraded = PracticeStore(directory: store.directory)
        XCTAssertFalse(upgraded.isReadOnly)
        XCTAssertEqual(try Data(contentsOf: XCTUnwrap(upgraded.preservedOriginalURL)), original)
        var expected = try decode(original); expected.schemaVersion = 4; expected.revision += 1
        XCTAssertEqual(upgraded.state, expected)
        XCTAssertEqual(PracticeStore(directory: store.directory).state, expected)
    }
    @MainActor func testSchema3PreservationAndWriteFailuresRetainOriginal() async throws {
        let store = try fixture()
        var old = store.state; old.schemaVersion = 3
        let original = try encode(old)
        try original.write(to: store.fileURL, options: .atomic)
        var writes = 0
        let failedCopy = PracticeStore(directory: store.directory, writeData: { _, _ in writes += 1 },
                                      preserveFile: { _, _ in throw CocoaError(.fileWriteNoPermission) })
        XCTAssertTrue(failedCopy.isReadOnly); XCTAssertEqual(writes, 0)
        XCTAssertEqual(try Data(contentsOf: store.fileURL), original)
        let failedWrite = PracticeStore(directory: store.directory,
                                       writeData: { _, _ in throw CocoaError(.fileWriteOutOfSpace) })
        XCTAssertTrue(failedWrite.isReadOnly)
        XCTAssertEqual(try Data(contentsOf: store.fileURL), original)
        XCTAssertEqual(try Data(contentsOf: XCTUnwrap(failedWrite.preservedOriginalURL)), original)
        XCTAssertFalse(PracticeStore(directory: store.directory).isReadOnly)
    }
    @MainActor func testBackupDecodeRestoreAndLegacyMigrationNeverDowngradeTempoChanges() async throws {
        let source = try fixture()
        try source.adjustActiveTempo(65)
        let data = try source.backupData()
        let decoded = try PracticeStore.decodeBackup(data)
        XCTAssertEqual(decoded.schemaVersion, 4)
        XCTAssertEqual(decoded.activeSet?.configuration.tempoChanges, source.activeSet?.configuration.tempoChanges)
        XCTAssertEqual(SchemaMigration.migrateToSchema3(decoded, at: Date()), decoded)
        let destination = try fixture(); try destination.endSet()
        try destination.restoreBackup(decoded)
        XCTAssertEqual(destination.activeSet?.currentBPM, 65)
        XCTAssertEqual(destination.activeSet?.streak, 1)
        XCTAssertEqual(destination.state.schemaVersion, 4)
        XCTAssertEqual(PracticeStore(directory: destination.directory).state, destination.state)
    }
    @MainActor func testOlderSchemaCannotCarryNewTempoSemantics() async throws {
        let store = try fixture(); try store.adjustActiveTempo(65)
        var downgraded = store.state; downgraded.schemaVersion = 3
        let original = try encode(downgraded)
        try original.write(to: store.fileURL, options: .atomic)
        XCTAssertThrowsError(try PracticeStore.validate(downgraded))
        let unsafe = PracticeStore(directory: store.directory)
        XCTAssertTrue(unsafe.isReadOnly)
        XCTAssertEqual(try Data(contentsOf: store.fileURL), original)
    }
}
