import Foundation
import XCTest
@testable import PraeludeCore

final class ScoreOrganizationTests: XCTestCase {
    private func piece() -> Piece {
        Piece(title: "Sonata", pageCount: 20, createdAt: Date(timeIntervalSince1970: 1700000000),
              scoreSections: [ScoreSection(title: "I", startPage: 1, endPage: 8), ScoreSection(title: "II", startPage: 9, endPage: 20)],
              measureAnchors: [ScoreMeasureAnchor(page: 9, region: NormalizedRect(x: 0.1, y: 0.2, width: 0.8, height: 0.2), startMeasure: 1, endMeasure: 4)],
              defaultPracticeBPM: 72, updatedAt: Date(timeIntervalSince1970: 1700000000), lastPageUpdatedAt: Date(timeIntervalSince1970: 1700000000))
    }
    @MainActor private func store() throws -> PracticeStore {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
        let store = PracticeStore(directory: directory); try store.addPiece(piece()); return store
    }
    func testRelativePagesAndMeasuresKeepSourceIdentity() {
        let piece = piece()
        let region = PassageRegion(page: 9, x: 0.2, y: 0.25, width: 0.2, height: 0.1)
        let passage = Passage(pieceID: piece.id, title: "Opening", startMeasure: 1, endMeasure: 4, page: 9, regions: [region])
        XCTAssertEqual(ScoreOrganization.pageLabel(9, in: piece), "II · page 1")
        XCTAssertEqual(ScoreOrganization.locationLabel(for: passage, in: piece), "mm. 1–4 · II · page 1")
        XCTAssertEqual(ScoreOrganization.measureRange(for: [region], in: piece), 1...4)
        XCTAssertEqual(passage.regions[0].page, 9)
    }
    func testUnknownRegionAndCrossMovementRangeNeverInventNumbers() {
        let piece = piece()
        let known = PassageRegion(page: 9, x: 0.2, y: 0.25, width: 0.2, height: 0.1)
        let unknown = PassageRegion(page: 10, x: 0.2, y: 0.25, width: 0.2, height: 0.1)
        let outside = PassageRegion(page: 9, x: 0.2, y: 0.7, width: 0.2, height: 0.1)
        XCTAssertNil(ScoreOrganization.measureRange(for: [known, unknown], in: piece))
        XCTAssertNil(ScoreOrganization.measureRange(for: [outside], in: piece))
        let partial = PassageRegion(page: 9, x: 0.2, y: 0.1, width: 0.2, height: 0.4)
        XCTAssertNil(ScoreOrganization.measureRange(for: [partial], in: piece))
        var crossing = unknown; crossing.page = 1
        XCTAssertNil(ScoreOrganization.measureRange(for: [known, crossing], in: piece))
    }
    func testExistingUnlabeledPassageDisplaysConfirmedMeasuresWithoutChangingSnapshot() {
        let piece = piece()
        let region = PassageRegion(page: 9, x: 0.2, y: 0.25, width: 0.2, height: 0.1)
        let snapshot = Passage(pieceID: piece.id, title: "Passage 1", page: 9, regions: [region])
        XCTAssertEqual(ScoreOrganization.locationLabel(for: snapshot, in: piece), "mm. 1–4 · II · page 1")
        XCTAssertNil(snapshot.startMeasure); XCTAssertNil(snapshot.endMeasure)
        var manual = snapshot; manual.startMeasure = 7; manual.endMeasure = 8
        XCTAssertEqual(ScoreOrganization.locationLabel(for: manual, in: piece), "mm. 7–8 · II · page 1")
        var unknown = snapshot; unknown.id = UUID(); unknown.regions[0].y = 0.7
        XCTAssertEqual(ScoreOrganization.locationLabel(for: unknown, in: piece), "II · page 1")
        let later = Passage(pieceID: piece.id, title: "Earlier name", startMeasure: 10, endMeasure: 11, page: 9)
        let groups = ScoreOrganization.passageGroups([later, snapshot, unknown], currentPage: 9, in: piece)
        XCTAssertEqual(groups[0].passages.map(\.id), [snapshot.id, later.id, unknown.id])
    }
    func testCurrentPageGroupingAndMusicalMeasureOrder() {
        let piece = piece()
        let a = Passage(pieceID: piece.id, title: "Passage 10", startMeasure: 20, endMeasure: 21, page: 9)
        let b = Passage(pieceID: piece.id, title: "Passage 11", startMeasure: 3, endMeasure: 4, page: 9)
        let c = Passage(pieceID: piece.id, title: "Cross page", page: 8, regions: [PassageRegion(page: 9, x: 0, y: 0, width: 1, height: 1)])
        let d = Passage(pieceID: piece.id, title: "First", page: 1)
        let groups = ScoreOrganization.passageGroups([a, b, c, d], currentPage: 9)
        XCTAssertEqual(groups.map(\.page), [9, 1])
        XCTAssertEqual(groups[0].passages.map(\.id), [b.id, a.id, c.id])
        XCTAssertEqual(groups.flatMap(\.passages).count, 4)
    }
    func testWireRoundTripLegacyAbsenceAndExplicitClears() throws {
        let original = piece()
        let roundtrip = try SyncJSON(encoding: PieceSyncRow(original)).decoded(as: PieceSyncRow.self)
        XCTAssertEqual(roundtrip.coreValue, original)
        var legacy = try XCTUnwrap(SyncJSON(encoding: PieceSyncRow(original)).objectValue)
        legacy.removeValue(forKey: "score_sections"); legacy.removeValue(forKey: "measure_anchors"); legacy.removeValue(forKey: "default_practice_bpm")
        let decoded = try SyncJSON.object(legacy).decoded(as: PieceSyncRow.self)
        XCTAssertEqual(decoded.coreValue(preserving: original)?.scoreSections, original.scoreSections)
        XCTAssertEqual(decoded.coreValue(preserving: original)?.defaultPracticeBPM, 72)
        var cleared = original; cleared.scoreSections = []; cleared.measureAnchors = []; cleared.defaultPracticeBPM = nil
        let clearRow = try SyncJSON(encoding: PieceSyncRow(cleared)).decoded(as: PieceSyncRow.self)
        XCTAssertTrue(clearRow.hasDefaultPracticeTempo)
        XCTAssertEqual(clearRow.coreValue(preserving: original)?.scoreSections, [])
        XCTAssertNil(clearRow.coreValue(preserving: original)?.defaultPracticeBPM)
    }
    @MainActor func testInvalidMetadataRejectedAtomicallyAndDefaultPersists() throws {
        let store = try store(); let before = store.state; let id = store.pieces[0].id
        XCTAssertThrowsError(try store.setScoreSections([ScoreSection(title: "I", startPage: 1, endPage: 8), ScoreSection(title: "II", startPage: 8, endPage: 20)], for: id))
        XCTAssertEqual(store.state, before)
        XCTAssertThrowsError(try store.setDefaultPracticeTempo(.infinity, for: id))
        XCTAssertEqual(store.state, before)
        try store.setDefaultPracticeTempo(68, for: id)
        XCTAssertEqual(PracticeStore(directory: store.directory).pieces[0].defaultPracticeBPM, 68)
    }
    @MainActor func testSchema4MigrationPreservesExactBytesAndSchema5BackupMetadata() throws {
        let store = try store()
        var old = store.state; old.schemaVersion = 4; old.pieces[0].scoreSections = []; old.pieces[0].measureAnchors = []; old.pieces[0].defaultPracticeBPM = nil
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        let original = try encoder.encode(old); try original.write(to: store.fileURL)
        let migrated = PracticeStore(directory: store.directory)
        XCTAssertFalse(migrated.isReadOnly); XCTAssertEqual(migrated.state.schemaVersion, 5)
        XCTAssertEqual(try Data(contentsOf: XCTUnwrap(migrated.preservedOriginalURL)), original)
        var unsupported = store.state; unsupported.schemaVersion = 4
        XCTAssertThrowsError(try PracticeStore.validate(unsupported))
        let restored = try PracticeStore.decodeBackup(store.backupData())
        XCTAssertEqual(restored.pieces[0], store.pieces[0]); XCTAssertEqual(restored.schemaVersion, 5)
    }
    @MainActor func testIdempotentRemoteApplyDoesNotWriteAnotherRevision() throws {
        let store = try store(); let revision = store.state.revision
        try store.applySyncedPiece(store.pieces[0])
        var remotePreferences = store.state.preferences; remotePreferences.updatedAt = Date()
        try store.applySyncedPreferences(remotePreferences)
        let afterPreferences = store.state.revision
        try store.applySyncedPreferences(remotePreferences)
        XCTAssertEqual(afterPreferences, revision + 1)
        XCTAssertEqual(store.state.revision, afterPreferences)
    }
    @MainActor func testOfflinePieceDeleteRetainsSyncParentsAndTombstonesChildren() throws {
        let store = try store(); let original = store.pieces[0]
        let passage = Passage(pieceID: original.id, title: "Opening", page: 9)
        try store.savePassage(passage)
        try store.saveGoal(PracticeGoal(title: "Remember pulse", pieceID: original.id))
        try store.deletePiece(original.id)
        XCTAssertTrue(store.pieces.isEmpty); XCTAssertTrue(store.realPieces.isEmpty)
        XCTAssertNotNil(store.state.pieces.first?.deletedAt)
        XCTAssertEqual(store.state.pieces.first?.pdfFileName, original.pdfFileName)
        XCTAssertNotNil(store.state.passages.first?.deletedAt)
        XCTAssertNotNil(store.state.goals.first?.deletedAt)
        XCTAssertEqual(store.state.goals.first?.pieceID, original.id)
        XCTAssertNoThrow(try PracticeStore.validate(store.state))
        let reopened = PracticeStore(directory: store.directory)
        XCTAssertTrue(reopened.pieces.isEmpty)
        // An older remote row cannot resurrect the deleted piece.
        try reopened.applySyncedPiece(original)
        XCTAssertTrue(reopened.pieces.isEmpty)
        let engine = SyncEngine(transport: FakeSyncTransport(server: FakeSyncServer()), directory: store.directory.appendingPathComponent("sync"))
        try engine.enqueueLibrarySnapshot(store.state)
        let tables = try SyncQueue(directory: store.directory.appendingPathComponent("sync")).entries.map(\.table)
        XCTAssertLessThan(try XCTUnwrap(tables.firstIndex(of: "pieces")), try XCTUnwrap(tables.firstIndex(of: "practice_goals")))
    }
}
