import Foundation
import PDFKit
import UIKit
import XCTest
@testable import Praelude

final class DesktopTransferFileTests: XCTestCase {
    @MainActor private func store() -> PracticeStore {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
        return PracticeStore(directory: directory)
    }
    @MainActor private func transfer() throws -> (DesktopTransfer, Data) {
        let pdf = UIGraphicsPDFRenderer(bounds: CGRect(x: 0, y: 0, width: 612, height: 792)).pdfData { context in context.beginPage() }
        let filename = DesktopLibraryFiles.hash(pdf) + ".pdf"
        let database = Data("SQLite format 3\0test fixture".utf8)
        let value: [String: Any] = [
            "format": "praelude-desktop-transfer", "version": 1, "exportedAt": "2026-10-02T12:00:00Z",
            "databaseSHA256": DesktopLibraryFiles.hash(database), "database": database.base64EncodedString(),
            "tables": ["piece": [["id": 4, "title": "Mac sonata", "composer": "Beethoven", "created_at": "2026-07-11 01:20:42", "archived_at": NSNull(), "completed_at": NSNull()]],
                       "region": [], "goal": [], "rep": [], "rep_block": [], "session": []],
            "scores": [filename: pdf.base64EncodedString()],
            "scoreFiles": [["pieceID": 4, "edition": "/Mac/score.pdf", "editionID": "score.pdf", "filename": filename, "pageCount": 1, "preferred": true]],
            "assets": [:], "warnings": []]
        let data = try JSONSerialization.data(withJSONObject: value)
        return (try DesktopTransfer.decode(data), data)
    }
    @MainActor func testRealPDFImportIsAdditiveAndRepairsMissingFileOnRetry() throws {
        let store = store(), (transfer, data) = try transfer()
        try store.addPiece(Piece(title: "Mobile music"))
        try DesktopLibraryFiles(store: store).importTransfer(transfer, data: data)
        XCTAssertEqual(store.pieces.count, 2)
        let name = transfer.scoreFiles[0].filename
        let path = NativeLibraryFiles(store: store).scoresDirectory.appendingPathComponent(name)
        XCTAssertNotNil(PDFDocument(url: path))
        try FileManager.default.removeItem(at: path)
        try DesktopLibraryFiles(store: store).importTransfer(transfer, data: data)
        XCTAssertNotNil(PDFDocument(url: path))
        XCTAssertEqual(store.pieces.count, 2)
        XCTAssertEqual(store.state.desktopImports.count, 1)
        let archive = DesktopLibraryFiles(store: store).directory.appendingPathComponent(store.state.desktopImports[0].archiveFileName)
        try FileManager.default.removeItem(at: archive)
        try DesktopLibraryFiles(store: store).importTransfer(transfer, data: data)
        XCTAssertTrue(FileManager.default.fileExists(atPath: archive.path))
    }
    @MainActor func testRepeatExportTimestampDoesNotDuplicateOrConflict() throws {
        let store = store(), (transfer, data) = try transfer()
        try DesktopLibraryFiles(store: store).importTransfer(transfer, data: data)
        var later = transfer; later.exportedAt = "2026-10-03T12:00:00Z"
        try DesktopLibraryFiles(store: store).importTransfer(later, data: JSONEncoder().encode(later))
        XCTAssertEqual(store.pieces.count, 1)
        XCTAssertEqual(store.state.desktopImports.count, 1)
    }
    @MainActor func testBadScoreHashAndDatabaseHashPreserveExistingLibrary() throws {
        let store = store(), (original, data) = try transfer()
        try store.addPiece(Piece(title: "Keep me"))
        let before = try store.backupData()
        var damaged = original
        damaged.scores[damaged.scoreFiles[0].filename] = Data("damaged".utf8)
        XCTAssertThrowsError(try DesktopLibraryFiles(store: store).importTransfer(damaged, data: data))
        XCTAssertEqual(try store.backupData(), before)
        damaged = original; damaged.database = Data("wrong".utf8)
        XCTAssertThrowsError(try DesktopLibraryFiles(store: store).importTransfer(damaged, data: data))
        XCTAssertEqual(try store.backupData(), before)
    }
    @MainActor func testBackupRestoresArchiveAndMissingArchiveFailsWithoutReplacingLibrary() throws {
        let source = store(), destination = store(), (transfer, data) = try transfer()
        try DesktopLibraryFiles(store: source).importTransfer(transfer, data: data)
        let backup = try NativeLibraryFiles(store: source).makeBackup().data
        XCTAssertEqual((try JSONSerialization.jsonObject(with: backup) as? [String: Any])?["version"] as? Int, 4)
        try NativeLibraryFiles(store: destination).restoreBackup(backup)
        let receipt = try XCTUnwrap(destination.state.desktopImports.first)
        XCTAssertEqual(try DesktopLibraryFiles(store: destination).transfer(receipt).database, transfer.database)
        let before = try destination.backupData()
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: backup) as? [String: Any])
        object["desktopArchives"] = [:]
        XCTAssertThrowsError(try NativeLibraryFiles(store: destination).restoreBackup(JSONSerialization.data(withJSONObject: object)))
        XCTAssertEqual(try destination.backupData(), before)
        object["desktopArchives"] = [source.state.desktopImports[0].archiveFileName: Data("corrupt".utf8).base64EncodedString()]
        XCTAssertThrowsError(try NativeLibraryFiles(store: destination).restoreBackup(JSONSerialization.data(withJSONObject: object)))
        XCTAssertEqual(try destination.backupData(), before)
    }
    @MainActor func testNativeBackupPreservesRecordingBytesAndRejectsOldIncompleteBackup() throws {
        let source = store(), destination = store()
        let audio = Data("exact private recording bytes".utf8)
        let name = "take-fixture.m4a"
        let path = source.directory.appendingPathComponent("Recordings")
        try FileManager.default.createDirectory(at: path, withIntermediateDirectories: true)
        try audio.write(to: path.appendingPathComponent(name))
        try source.saveRecording(AudioRecording(fileName: name, duration: 2, byteSize: audio.count))
        let backup = try NativeLibraryFiles(store: source).makeBackup().data
        XCTAssertEqual((try JSONSerialization.jsonObject(with: backup) as? [String: Any])?["version"] as? Int, 4)
        try NativeLibraryFiles(store: destination).restoreBackup(backup)
        let restored = try XCTUnwrap(destination.state.recordings.first)
        XCTAssertEqual(try Data(contentsOf: destination.directory.appendingPathComponent("Recordings").appendingPathComponent(restored.fileName)), audio)
        let before = try destination.backupData()
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: backup) as? [String: Any]); object["recordings"] = [:]
        XCTAssertThrowsError(try NativeLibraryFiles(store: destination).restoreBackup(JSONSerialization.data(withJSONObject: object)))
        XCTAssertEqual(try destination.backupData(), before)
    }
    @MainActor func testBackupVersionProtectsDurableTempoChangesInActiveAndHistoricalSets() throws {
        let source = store(), destination = store()
        try source.addPiece(Piece(title: "Tempo study"))
        try source.startSet(PracticeConfiguration(pieceID: source.pieces[0].id, targetCount: 2,
                                                 startBPM: 60, targetBPM: 80))
        try source.record(.clean); try source.record(.clean)
        try source.adjustActiveTempo(65)
        let activeBackup = try NativeLibraryFiles(store: source).makeBackup().data
        XCTAssertEqual((try JSONSerialization.jsonObject(with: activeBackup) as? [String: Any])?["version"] as? Int, 4)
        try NativeLibraryFiles(store: destination).restoreBackup(activeBackup)
        XCTAssertEqual(destination.activeSet?.currentBPM, 65)
        XCTAssertEqual(destination.activeSet?.configuration.startBPM, 60)
        XCTAssertEqual(destination.activeSet?.configuration.tempoChanges, source.activeSet?.configuration.tempoChanges)
        try source.endSet()
        let historyBackup = try NativeLibraryFiles(store: source).makeBackup().data
        XCTAssertEqual((try JSONSerialization.jsonObject(with: historyBackup) as? [String: Any])?["version"] as? Int, 4)
        let restoredHistory = store()
        try NativeLibraryFiles(store: restoredHistory).restoreBackup(historyBackup)
        XCTAssertEqual(restoredHistory.state.history[0].configuration.tempoChanges,
                       source.state.history[0].configuration.tempoChanges)
        XCTAssertEqual(restoredHistory.state.schemaVersion, LibraryState.currentSchemaVersion)
        let plainBackup = try NativeLibraryFiles(store: store()).makeBackup().data
        XCTAssertEqual((try JSONSerialization.jsonObject(with: plainBackup) as? [String: Any])?["version"] as? Int, 4)
    }
}
