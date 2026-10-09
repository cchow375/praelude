import Foundation
import XCTest
@testable import PraeludeCore

final class ScoreSectionPracticeTests: XCTestCase {
    @MainActor private func fixture(writeData: @escaping (Data, URL) throws -> Void = { try $0.write(to: $1, options: .atomic) }) throws -> (PracticeStore, Piece, Passage) {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
        let piece = Piece(title: "Collected sonatas", pdfFileName: "book.pdf", pageCount: 30,
                          scoreSections: [ScoreSection(title: "Adagio", startPage: 9, endPage: 16)])
        let passage = Passage(pieceID: piece.id, title: "Existing fingering target", page: 11,
                              regions: [PassageRegion(page: 11, x: 0.1, y: 0.2, width: 0.3, height: 0.1)])
        let store = PracticeStore(directory: directory, now: { Date(timeIntervalSince1970: 1_800_000_000) }, writeData: writeData)
        try store.addPiece(piece); try store.savePassage(passage)
        return (store, piece, passage)
    }

    @MainActor func testSectionSetKeepsIdentityThroughHistoryReloadBackupAndWireWithoutCreatingPassages() throws {
        let (store, piece, passage) = try fixture()
        let originalPassages = store.state.passages
        let originalPiece = store.state.pieces[0]
        let section = piece.scoreSections[0]
        try store.startSet(PracticeConfiguration(pieceID: piece.id, startBPM: 72, targetBPM: 80), scoreSectionID: section.id)
        let active = try XCTUnwrap(store.activeSet)
        let snapshot = try XCTUnwrap(active.configuration.passageSnapshot)
        XCTAssertNil(active.configuration.passageID)
        XCTAssertEqual(snapshot.id, section.id)
        XCTAssertEqual(snapshot.title, "Adagio · source pages 9–16")
        XCTAssertEqual(snapshot.page, 9)
        XCTAssertTrue(snapshot.regions.isEmpty)
        XCTAssertTrue(active.attempts.isEmpty)
        XCTAssertEqual(store.state.passages, originalPassages)
        XCTAssertEqual(store.state.passages[0], passage)
        XCTAssertEqual(store.state.pieces[0], originalPiece)
        XCTAssertTrue(store.state.inkStrokes.isEmpty)
        XCTAssertTrue(store.state.coldGrades.isEmpty)
        XCTAssertTrue(store.state.ruleEvents.isEmpty)
        try store.record(.clean)
        try store.endSet()
        // Renaming/removing the reading section cannot rewrite what the saved set targeted.
        try store.setScoreSections([], for: piece.id)
        let reopened = PracticeStore(directory: store.directory)
        XCTAssertEqual(reopened.state.history[0].configuration.passageSnapshot, snapshot)
        XCTAssertEqual(reopened.state.history[0].attempts.map(\.bpm), [72])
        let backup = try PracticeStore.decodeBackup(reopened.backupData())
        XCTAssertEqual(backup.history[0].configuration.passageSnapshot, snapshot)
        let wire = try SyncJSON(encoding: SetSyncRow(reopened.state.history[0])).decoded(as: SetSyncRow.self)
        XCTAssertEqual(wire.coreValue?.configuration.passageSnapshot, snapshot)
        XCTAssertNil(wire.coreValue?.configuration.passageID)
        XCTAssertEqual(reopened.state.passages, originalPassages)
        XCTAssertNoThrow(try PracticeStore.validate(reopened.state))
    }

    @MainActor func testUnknownSectionAndPassagePlusSectionRejectWithoutChangingStateOrBytes() throws {
        let (store, piece, passage) = try fixture()
        let before = store.state, bytes = try Data(contentsOf: store.fileURL)
        XCTAssertThrowsError(try store.startSet(PracticeConfiguration(pieceID: piece.id), scoreSectionID: UUID()))
        XCTAssertThrowsError(try store.startSet(PracticeConfiguration(pieceID: piece.id, passageID: passage.id), scoreSectionID: piece.scoreSections[0].id))
        XCTAssertEqual(store.state, before)
        XCTAssertEqual(try Data(contentsOf: store.fileURL), bytes)
    }

    @MainActor func testOrdinaryStartIgnoresForgedSnapshotAndSavedPassageRetainsOwnSnapshot() throws {
        let (store, piece, passage) = try fixture()
        let forged = Passage(pieceID: piece.id, title: "Forged target", page: 20)
        try store.startSet(PracticeConfiguration(pieceID: piece.id, passageSnapshot: forged))
        XCTAssertNil(store.activeSet?.configuration.passageSnapshot)
        try store.endSet()
        try store.startSet(PracticeConfiguration(pieceID: piece.id, passageID: passage.id, passageSnapshot: forged))
        XCTAssertEqual(store.activeSet?.configuration.passageSnapshot, passage)
    }

    @MainActor func testFailedSectionStartRetainsExactLibraryAndCanRetry() throws {
        var fail = false
        let (store, piece, _) = try fixture { data, url in
            if fail { throw CocoaError(.fileWriteOutOfSpace) }
            try data.write(to: url, options: .atomic)
        }
        let before = store.state, bytes = try Data(contentsOf: store.fileURL)
        fail = true
        XCTAssertThrowsError(try store.startSet(PracticeConfiguration(pieceID: piece.id), scoreSectionID: piece.scoreSections[0].id))
        XCTAssertEqual(store.state, before)
        XCTAssertEqual(try Data(contentsOf: store.fileURL), bytes)
        fail = false
        XCTAssertNoThrow(try store.startSet(PracticeConfiguration(pieceID: piece.id), scoreSectionID: piece.scoreSections[0].id))
        XCTAssertEqual(store.activeSet?.configuration.passageSnapshot?.id, piece.scoreSections[0].id)
    }
}
