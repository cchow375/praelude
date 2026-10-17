import Foundation
import XCTest
@testable import Praelude

private actor DownloadFixture: SyncTransport {
    let rows: [String: [[String: SyncJSON]]]
    init(_ rows: [String: [[String: SyncJSON]]]) { self.rows = rows }
    func fetch(table: String, field: String, updatedSince: Date?) async throws -> [[String: SyncJSON]] { rows[table] ?? [] }
    func upsert(table: String, row: [String: SyncJSON]) async throws -> SyncRPCResult { throw SyncError.transport("Unexpected write") }
    func append(table: String, row: [String: SyncJSON]) async throws -> SyncRPCResult { throw SyncError.transport("Unexpected write") }
    func updateLastPage(pieceID: UUID, lastPage: Int, at: Date) async throws -> SyncRPCResult { throw SyncError.transport("Unexpected write") }
    func undoAttempt(attemptID: UUID, undoneAt: Date) async throws -> SyncRPCResult { throw SyncError.transport("Unexpected write") }
}

@MainActor
final class SyncDownloadDependencyTests: XCTestCase {
    private func row<T: Encodable>(_ value: T) throws -> [String: SyncJSON] {
        try XCTUnwrap(SyncJSON(encoding: value).objectValue)
    }
    private func make(_ rows: [String: [[String: SyncJSON]]]) -> (PracticeStore, SyncEngine, SyncCoordinator) {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("sync-download-\(UUID())")
        let store = PracticeStore(directory: directory)
        let engine = SyncEngine(transport: DownloadFixture(rows), directory: directory.appendingPathComponent("Sync"))
        let coordinator = SyncCoordinator(engine: engine, auth: AuthManager(services: SupabaseServices(), store: store), store: store)
        return (store, engine, coordinator)
    }

    func testFreshDeviceDownloadsOrganizedPieceWithChildFirstFoldersAndPassages() async throws {
        let date = Date(timeIntervalSince1970: 1_790_000_000)
        let tag = Tag(name: "Recital", createdAt: date, updatedAt: date)
        let parent = Folder(name: "Book", createdAt: date, updatedAt: date)
        let child = Folder(name: "Movement", parentFolderID: parent.id, createdAt: date, updatedAt: date)
        let piece = Piece(title: "Organized score", pageCount: 1, createdAt: date,
                          tagIDs: [tag.id], folderIDs: [child.id], updatedAt: date)
        let source = Passage(pieceID: piece.id, title: "Source", createdAt: date, updatedAt: date)
        let split = Passage(pieceID: piece.id, title: "Split", parentPassageID: source.id,
                            joinedFromPassageIDs: [source.id], createdAt: date, updatedAt: date)
        let fixtures = try ["tags": [row(TagSyncRow(tag))],
                            "folders": [row(FolderSyncRow(child)), row(FolderSyncRow(parent))],
                            "pieces": [row(PieceSyncRow(piece))],
                            "passages": [row(PassageSyncRow(split)), row(PassageSyncRow(source))]]
        let (store, engine, coordinator) = make(fixtures)
        // Execute the production pull plan and its actual decode/merge functions. Neither an
        // assumed UUID order nor stripping organization/provenance can make this fixture pass.
        for entry in SyncCoordinator.pullTables where fixtures[entry.table] != nil {
            if entry.table == "pieces" {
                try await engine.pullScoreSnapshot { try coordinator.applyPulledScoreSnapshot($0) }
            } else if entry.table == "folders" || entry.table == "passages" {
                try await engine.pullRows(table: entry.table) { try coordinator.applyPulledHierarchy(table: entry.table, rows: $0) }
            } else {
                try await engine.pull(table: entry.table) { try coordinator.applyPulledRow(table: entry.table, row: $0) }
            }
        }
        XCTAssertEqual(store.state.pieces.first?.tagIDs, [tag.id])
        XCTAssertEqual(store.state.pieces.first?.folderIDs, [child.id])
        XCTAssertEqual(store.state.folders.first(where: { $0.id == child.id })?.parentFolderID, parent.id)
        XCTAssertEqual(store.state.passages.first(where: { $0.id == split.id })?.joinedFromPassageIDs, [source.id])
        XCTAssertEqual(Set(store.state.passages.map(\.id)), [source.id, split.id])
        XCTAssertNotNil(engine.state.cursors["passages"])
        XCTAssertFalse(PracticeStore(directory: store.directory).isReadOnly)
    }

    func testPassageRegionMoveIsAtomicAndNewerLocalEditWins() throws {
        let (store, _, coordinator) = make([:])
        let date = Date(timeIntervalSince1970: 1_790_000_000)
        let piece = Piece(title: "Split practice", pdfFileName: "fixture.pdf", pageCount: 1)
        try store.addPiece(piece)
        let region = PassageRegion(page: 1, x: 0.1, y: 0.2, width: 0.5, height: 0.2)
        var donor = Passage(pieceID: piece.id, title: "Donor", regions: [region], createdAt: date, updatedAt: date)
        var receiver = Passage(pieceID: piece.id, title: "Receiver", createdAt: date, updatedAt: date)
        try store.savePassage(donor); try store.savePassage(receiver)
        donor.regions = []; donor.updatedAt = date.addingTimeInterval(1)
        receiver.regions = [region]; receiver.updatedAt = date.addingTimeInterval(1)
        try coordinator.applyPulledHierarchy(table: "passages", rows: [row(PassageSyncRow(receiver)), row(PassageSyncRow(donor))])
        XCTAssertEqual(store.state.passages.first(where: { $0.id == donor.id })?.regions, [])
        XCTAssertEqual(store.state.passages.first(where: { $0.id == receiver.id })?.regions, [region])
        var local = receiver; local.title = "Newer local title"; local.updatedAt = date.addingTimeInterval(2)
        try store.savePassage(local)
        try coordinator.applyPulledHierarchy(table: "passages", rows: [row(PassageSyncRow(receiver))])
        XCTAssertEqual(store.state.passages.first(where: { $0.id == local.id }), local)
    }

    func testInvalidHierarchyDoesNotPublishOrAcknowledgeCursor() async throws {
        let orphan = Folder(name: "Orphan", parentFolderID: UUID())
        let fixtures = try ["folders": [row(FolderSyncRow(orphan))]]
        let (store, engine, coordinator) = make(fixtures)
        let original = store.state
        do {
            try await engine.pullRows(table: "folders") { try coordinator.applyPulledHierarchy(table: "folders", rows: $0) }
            XCTFail("Missing parents must still fail validation")
        } catch { }
        XCTAssertEqual(store.state, original)
        XCTAssertNil(engine.state.cursors["folders"])
        XCTAssertFalse(engine.hasSnapshot(table: "folders"))
    }

    func testImmediatePracticeQueuesNewScoreAndPassageAncestryBeforeAnyHistory() throws {
        let (store, _, coordinator) = make([:])
        let instrument = Instrument(family: .keyboard, name: "Piano")
        let tag = Tag(name: "Paper")
        let parentFolder = Folder(name: "Book")
        let childFolder = Folder(name: "Movement", parentFolderID: parentFolder.id)
        try store.applySyncedInstrument(instrument); try store.applySyncedTag(tag)
        try store.applySyncedFolders([childFolder, parentFolder])
        let piece = Piece(title: "New photo", pdfFileName: "new-photo.pdf", pageCount: 1,
                          instrumentID: instrument.id, tagIDs: [tag.id], folderIDs: [childFolder.id])
        try store.addPiece(piece)
        let source = Passage(pieceID: piece.id, title: "Opening")
        let child = Passage(pieceID: piece.id, title: "Practice", parentPassageID: source.id, joinedFromPassageIDs: [source.id])
        try store.applySyncedPassages([child, source])
        try store.startSet(PracticeConfiguration(pieceID: piece.id, passageID: child.id))
        try store.record(.clean)
        let set = try XCTUnwrap(store.activeSet)
        try coordinator.enqueuePracticeProgress(set, session: store.state.sessions.first { $0.id == set.sessionID })
        let path = store.directory.appendingPathComponent("Sync")
        let saved = try SyncQueue(directory: path).entries
        XCTAssertEqual(saved.map(\.table), ["instruments", "tags", "folders", "folders", "pieces", "passages", "passages", "practice_sessions", "sets", "attempts"])
        XCTAssertEqual(saved.filter { $0.table == "folders" }.compactMap { $0.row["id"]?.stringValue?.lowercased() },
                       [parentFolder.id, childFolder.id].map { $0.uuidString.lowercased() })
        XCTAssertEqual(saved.filter { $0.table == "passages" }.compactMap { $0.row["id"]?.stringValue?.lowercased() },
                       [source.id, child.id].map { $0.uuidString.lowercased() })
        try coordinator.enqueuePracticeProgress(set, session: store.state.sessions.first { $0.id == set.sessionID })
        XCTAssertEqual(try SyncQueue(directory: path).entries, saved, "Unchanged prerequisite rows stay deduplicated.")
    }

    func testSplitThenMergeBackProvenanceCanStillQueuePractice() throws {
        let (store, _, coordinator) = make([:])
        let piece = Piece(title: "Rejoined score", pdfFileName: "rejoined.pdf", pageCount: 1)
        try store.addPiece(piece)
        let first = PassageRegion(page: 1, x: 0.1, y: 0.1, width: 0.6, height: 0.2)
        let second = PassageRegion(page: 1, x: 0.1, y: 0.4, width: 0.6, height: 0.2)
        let original = Passage(pieceID: piece.id, title: "Original", regions: [first, second])
        try store.savePassage(original)
        let split = try store.splitPassage(original.id, movingRegionIDs: [second.id], newTitle: "Split")
        _ = try store.mergePassages(primary: original.id, into: [split.id])
        try store.startSet(PracticeConfiguration(pieceID: piece.id, passageID: original.id))
        try coordinator.enqueuePracticeProgress(try XCTUnwrap(store.activeSet), session: store.state.sessions.last)
        let passages = try SyncQueue(directory: store.directory.appendingPathComponent("Sync")).entries.filter { $0.table == "passages" }
        XCTAssertEqual(passages.compactMap { $0.row["id"]?.stringValue?.lowercased() }, [original.id, split.id].map { $0.uuidString.lowercased() })
        XCTAssertEqual(store.state.passages.first { $0.id == original.id }?.joinedFromPassageIDs, [split.id])
        XCTAssertEqual(store.state.passages.first { $0.id == split.id }?.parentPassageID, original.id)
    }

    func testFirstAccountProfileRetainsWorkingScoresAfterDependencyDownload() async throws {
        let owner = UUID()
        let tag = Tag(name: "Working")
        let folder = Folder(name: "Current book")
        let piece = Piece(title: "Cloud score", pdfFileName: "cloud.pdf", pageCount: 2, lastPage: 3,
                          tagIDs: [tag.id], folderIDs: [folder.id])
        let pages = [PageEdit(pieceID: piece.id, sourcePage: 1, displayOrder: 1),
                     PageEdit(pieceID: piece.id, sourcePage: 2, displayOrder: 2),
                     PageEdit(pieceID: piece.id, sourcePage: nil, displayOrder: 3, kind: .staff)]
        var profile = Profile(); profile.ownerID = owner; profile.currentlyWorkingOnPieceIDs = [piece.id]
        let fixtures = try ["profiles": [row(ProfileSyncRow(profile, extras: ProfileBackendFields()))], "tags": [row(TagSyncRow(tag))],
                            "folders": [row(FolderSyncRow(folder))], "pieces": [row(PieceSyncRow(piece))],
                            "page_edits": pages.map { try row(PageEditSyncRow($0)) }]
        let (store, engine, coordinator) = make(fixtures)
        var local = store.state.profile; local.ownerID = owner; try store.applySyncedProfile(local)
        try engine.bindAccount(owner)
        try await engine.initializeProfileIfNeeded(currentProfile: { store.state.profile }, prepareProfile: {
            try await coordinator.prepareProfileDependencies($0, validateAccount: {})
        }) { try store.applySyncedProfile($0) }
        XCTAssertEqual(store.state.profile.currentlyWorkingOnPieceIDs, [piece.id])
        XCTAssertEqual(store.state.pieces.first?.tagIDs, [tag.id])
        XCTAssertEqual(store.state.pieces.first?.folderIDs, [folder.id])
        XCTAssertEqual(store.state.pieces.first?.lastPage, 3)
        XCTAssertEqual(store.state.pageEdits.count, 3)
        XCTAssertTrue(engine.hasHydratedProfile)
    }

    func testAtomicScoreDownloadStillRejectsReplacingAnAnnotatedPDF() throws {
        let (store, _, coordinator) = make([:])
        let piece = Piece(title: "Annotated", pdfFileName: "original.pdf", pageCount: 2)
        try store.addPiece(piece)
        let region = PassageRegion(page: 1, x: 0.1, y: 0.1, width: 0.4, height: 0.2)
        try store.savePassage(Passage(pieceID: piece.id, title: "Saved mark", regions: [region]))
        var replacement = piece; replacement.pdfFileName = "replacement.pdf"; replacement.updatedAt.addTimeInterval(1)
        let original = store.state
        XCTAssertThrowsError(try coordinator.applyPulledScoreSnapshot(["pieces": [row(PieceSyncRow(replacement))]]))
        XCTAssertEqual(store.state, original)
    }
}
