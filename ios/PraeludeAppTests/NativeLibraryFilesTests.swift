import PDFKit
import UIKit
import XCTest
@testable import Praelude

final class NativeLibraryFilesTests: XCTestCase {
    private struct DiskSnapshot {
        let state: LibraryState
        let ledger: Data?
        let scores: [String: Data]
    }

    @MainActor
    private func fixture(named name: String = "library", now: Date = Date(timeIntervalSince1970: 1_700_000_000)) throws -> PracticeStore {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("Praelude-NativeFiles-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: root) }
        return PracticeStore(directory: root.appendingPathComponent(name, isDirectory: true), now: { now })
    }

    @MainActor
    private func pdfSource(for store: PracticeStore, pages: Int = 2, label: String = "Synthetic practice score") throws -> (url: URL, data: Data) {
        let renderer = UIGraphicsPDFRenderer(bounds: CGRect(x: 0, y: 0, width: 612, height: 792))
        let data = renderer.pdfData { context in
            for page in 1...pages {
                context.beginPage()
                "\(label) · page \(page)".draw(at: CGPoint(x: 48, y: 48), withAttributes: [.font: UIFont.systemFont(ofSize: 20)])
            }
        }
        let url = store.directory.deletingLastPathComponent().appendingPathComponent("source score \(UUID().uuidString).pdf")
        try data.write(to: url)
        return (url, data)
    }

    @MainActor
    @discardableResult
    private func addPDF(to store: PracticeStore, title: String = "Test study", pages: Int = 2) throws -> Piece {
        let source = try pdfSource(for: store, pages: pages, label: title)
        let id = try NativeLibraryFiles(store: store).importPDF(source.url, title: title, composer: "Test composer")
        return try XCTUnwrap(store.pieces.first { $0.id == id })
    }

    @MainActor
    private func snapshot(_ store: PracticeStore) throws -> DiskSnapshot {
        let files = NativeLibraryFiles(store: store)
        let scoreURLs = FileManager.default.fileExists(atPath: files.scoresDirectory.path)
            ? try FileManager.default.contentsOfDirectory(at: files.scoresDirectory, includingPropertiesForKeys: nil)
            : []
        let scores = try Dictionary(uniqueKeysWithValues: scoreURLs.map { ($0.lastPathComponent, try Data(contentsOf: $0)) })
        let ledger = FileManager.default.fileExists(atPath: store.fileURL.path) ? try Data(contentsOf: store.fileURL) : nil
        return DiskSnapshot(state: store.state, ledger: ledger, scores: scores)
    }

    @MainActor
    private func assertUnchanged(_ before: DiskSnapshot, store: PracticeStore, file: StaticString = #filePath, line: UInt = #line) throws {
        let after = try snapshot(store)
        XCTAssertEqual(after.state, before.state, "Observable state changed after a rejected operation", file: file, line: line)
        XCTAssertEqual(after.ledger, before.ledger, "The durable ledger changed after a rejected operation", file: file, line: line)
        XCTAssertEqual(after.scores, before.scores, "Saved PDFs changed or staged files leaked", file: file, line: line)
    }

    private func editingBackup(_ data: Data, _ mutation: (inout [String: Any]) throws -> Void) throws -> Data {
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        try mutation(&object)
        return try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    }

    @MainActor
    func testPDFImportCopiesOriginalAndReopensWithSandboxRelativeFilename() async throws {
        let store = try fixture()
        let files = NativeLibraryFiles(store: store)
        let source = try pdfSource(for: store, pages: 3)
        let id = try files.importPDF(source.url, title: "A study", composer: "A composer")
        let piece = try XCTUnwrap(store.pieces.first { $0.id == id })
        let name = try XCTUnwrap(piece.pdfFileName)
        let localURL = try XCTUnwrap(files.scoreURL(for: piece))

        XCTAssertEqual(try Data(contentsOf: source.url), source.data, "Import must preserve the selected original")
        XCTAssertEqual(try Data(contentsOf: localURL), source.data)
        XCTAssertNotEqual(localURL, source.url)
        XCTAssertEqual(localURL.deletingLastPathComponent(), files.scoresDirectory)
        XCTAssertEqual(name, URL(fileURLWithPath: name).lastPathComponent)
        XCTAssertEqual(URL(fileURLWithPath: name).pathExtension, "pdf")
        XCTAssertNotNil(UUID(uuidString: String(name.dropLast(4))))
        XCTAssertFalse(name.contains("/") || name.contains("\\") || name.contains(".."))
        XCTAssertEqual(piece.pageCount, 3)
        XCTAssertEqual(piece.lastPage, 1)
        XCTAssertEqual(PDFDocument(url: localURL)?.pageCount, 3)

        let reopened = PracticeStore(directory: store.directory)
        XCTAssertFalse(reopened.isReadOnly)
        XCTAssertEqual(reopened.pieces, [piece])
        XCTAssertEqual(NativeLibraryFiles(store: reopened).scoreURL(for: piece), localURL)
        var unsafe = piece
        unsafe.pdfFileName = "../outside.pdf"
        XCTAssertNil(files.scoreURL(for: unsafe))
    }

    @MainActor
    func testReplacingPDFPreservesIdentityOriginalAndPreviousLocalCopy() async throws {
        let store = try fixture()
        let files = NativeLibraryFiles(store: store)
        let original = try addPDF(to: store, pages: 3)
        let oldURL = try XCTUnwrap(files.scoreURL(for: original))
        let oldBytes = try Data(contentsOf: oldURL)
        try store.updateLastPage(pieceID: original.id, page: 3)
        let replacement = try pdfSource(for: store, pages: 1, label: "Replacement score")
        let id = try files.importPDF(replacement.url, title: original.title, composer: original.composer, replacing: store.pieces[0])

        XCTAssertEqual(id, original.id)
        XCTAssertEqual(store.pieces.count, 1)
        XCTAssertEqual(store.pieces[0].pageCount, 1)
        XCTAssertEqual(store.pieces[0].lastPage, 1)
        XCTAssertNotEqual(store.pieces[0].pdfFileName, original.pdfFileName)
        XCTAssertEqual(try Data(contentsOf: oldURL), oldBytes, "Previous score remains recoverable")
        XCTAssertEqual(try Data(contentsOf: replacement.url), replacement.data)
        XCTAssertEqual(try Data(contentsOf: XCTUnwrap(files.scoreURL(for: store.pieces[0]))), replacement.data)
    }

    @MainActor
    func testMissingEmptyAndInvalidPDFsDoNotMutateLibrary() async throws {
        let store = try fixture()
        try addPDF(to: store)
        let before = try snapshot(store)
        let root = store.directory.deletingLastPathComponent()
        let invalid = root.appendingPathComponent("invalid.pdf")
        let empty = root.appendingPathComponent("empty.pdf")
        try Data("This is not a PDF.".utf8).write(to: invalid)
        try Data().write(to: empty)
        let missing = root.appendingPathComponent("missing.pdf")
        for url in [missing, empty, invalid] {
            XCTAssertThrowsError(try NativeLibraryFiles(store: store).importPDF(url, title: "Rejected", composer: ""))
            try assertUnchanged(before, store: store)
        }
    }

    @MainActor
    func testOversizedPDFIsRejectedBeforeReadingOrMutatingLibrary() async throws {
        let store = try fixture()
        try addPDF(to: store)
        let before = try snapshot(store)
        let oversized = store.directory.deletingLastPathComponent().appendingPathComponent("oversized.pdf")
        XCTAssertTrue(FileManager.default.createFile(atPath: oversized.path, contents: nil))
        let handle = try FileHandle(forWritingTo: oversized)
        try handle.truncate(atOffset: 100_000_001) // Sparse file; no 100 MB payload allocation.
        try handle.close()
        XCTAssertEqual(try oversized.resourceValues(forKeys: [.fileSizeKey]).fileSize, 100_000_001)

        XCTAssertThrowsError(try NativeLibraryFiles(store: store).importPDF(oversized, title: "Too large", composer: ""))
        try assertUnchanged(before, store: store)
    }

    @MainActor
    func testRejectedPieceMetadataRollsBackAlreadyCopiedPDF() async throws {
        let store = try fixture()
        try addPDF(to: store)
        let before = try snapshot(store)
        let source = try pdfSource(for: store)

        XCTAssertThrowsError(try NativeLibraryFiles(store: store).importPDF(source.url, title: "  ", composer: ""))
        try assertUnchanged(before, store: store)
        XCTAssertEqual(try Data(contentsOf: source.url), source.data)
    }

    @MainActor
    func testBackupDuringRunningPracticeRestoresPausedWithoutLosingPDFOrVerdicts() async throws {
        let source = try fixture()
        let sourcePiece = try addPDF(to: source, pages: 3)
        try source.startSet(PracticeConfiguration(pieceID: sourcePiece.id, targetCount: 5, startBPM: 72, targetBPM: 72))
        try source.record(.clean)
        try source.record(.sloppy)
        let sourceFiles = NativeLibraryFiles(store: source)
        let sourceBytes = try Data(contentsOf: XCTUnwrap(sourceFiles.scoreURL(for: sourcePiece)))
        let backup = try sourceFiles.makeBackup()
        let exportedSet = try XCTUnwrap(source.activeSet)
        XCTAssertEqual(exportedSet.status, .running, "Export must not pause the pianist's source device")
        XCTAssertNotNil(exportedSet.lastCheckpoint)

        let target = try fixture(named: "restored", now: Date(timeIntervalSince1970: 1_700_086_400))
        try NativeLibraryFiles(store: target).restoreBackup(backup.data)
        let restoredSet = try XCTUnwrap(target.activeSet)
        let restoredPiece = try XCTUnwrap(target.pieces.first)
        XCTAssertEqual(restoredSet.status, .paused)
        XCTAssertNil(restoredSet.lastCheckpoint)
        XCTAssertEqual(restoredSet.id, exportedSet.id)
        XCTAssertEqual(restoredSet.configuration, exportedSet.configuration)
        XCTAssertEqual(restoredSet.attempts, exportedSet.attempts)
        XCTAssertEqual(restoredSet.activeSeconds, exportedSet.activeSeconds, "Restore must not credit a day away")
        XCTAssertEqual(target.progress.totalAttempts, 2)
        XCTAssertEqual(target.progress.cleanAttempts, 1)
        XCTAssertEqual(restoredPiece.id, sourcePiece.id)
        XCTAssertNotEqual(restoredPiece.pdfFileName, sourcePiece.pdfFileName, "Restored resources must receive fresh local names")
        XCTAssertEqual(try Data(contentsOf: XCTUnwrap(NativeLibraryFiles(store: target).scoreURL(for: restoredPiece))), sourceBytes)

        let reopened = PracticeStore(directory: target.directory)
        XCTAssertFalse(reopened.isReadOnly)
        XCTAssertEqual(reopened.state, target.state)
        XCTAssertEqual(reopened.activeSet?.status, .paused)
    }

    @MainActor
    func testOmittedScoreRollsBackPreviouslyStagedResources() async throws {
        let source = try fixture()
        try addPDF(to: source, title: "First score")
        let lastPiece = try addPDF(to: source, title: "Missing second score")
        let missingName = try XCTUnwrap(lastPiece.pdfFileName)
        let backup = try NativeLibraryFiles(store: source).makeBackup()
        let damaged = try editingBackup(backup.data) { object in
            var scores = try XCTUnwrap(object["scores"] as? [String: Any])
            scores.removeValue(forKey: missingName)
            object["scores"] = scores
        }
        let target = try fixture()
        try addPDF(to: target, title: "Existing target score")
        let before = try snapshot(target)

        XCTAssertThrowsError(try NativeLibraryFiles(store: target).restoreBackup(damaged))
        try assertUnchanged(before, store: target)
    }

    @MainActor
    func testInvalidLibraryMetadataRollsBackAllStagedPDFs() async throws {
        let source = try fixture()
        try addPDF(to: source)
        let backup = try NativeLibraryFiles(store: source).makeBackup()
        let damaged = try editingBackup(backup.data) { object in
            var library = try XCTUnwrap(object["library"] as? [String: Any])
            library["schemaVersion"] = 999
            object["library"] = library
        }
        let target = try fixture()
        try addPDF(to: target, title: "Keep this score")
        let before = try snapshot(target)

        XCTAssertThrowsError(try NativeLibraryFiles(store: target).restoreBackup(damaged))
        try assertUnchanged(before, store: target)
    }

    @MainActor
    func testMalformedAndFutureBackupFormatsPreserveTargetBytes() async throws {
        let store = try fixture()
        try addPDF(to: store)
        let backup = try NativeLibraryFiles(store: store).makeBackup()
        let future = try editingBackup(backup.data) { $0["version"] = 999 }
        let before = try snapshot(store)
        for data in [Data("{broken json".utf8), Data(), future] {
            XCTAssertThrowsError(try NativeLibraryFiles(store: store).restoreBackup(data))
            try assertUnchanged(before, store: store)
        }
    }

    @MainActor
    func testSharedScoreFilenameCannotBypassEachPiecesPageCountValidation() async throws {
        let source = try fixture()
        let first = try addPDF(to: source, title: "First shared score", pages: 2)
        try addPDF(to: source, title: "Second shared score", pages: 3)
        let sharedName = try XCTUnwrap(first.pdfFileName)
        let backup = try NativeLibraryFiles(store: source).makeBackup()
        let damaged = try editingBackup(backup.data) { object in
            var library = try XCTUnwrap(object["library"] as? [String: Any])
            var pieces = try XCTUnwrap(library["pieces"] as? [[String: Any]])
            pieces[1]["pdfFileName"] = sharedName
            pieces[1]["pageCount"] = 900
            library["pieces"] = pieces
            object["library"] = library
        }
        let target = try fixture()
        try addPDF(to: target, title: "Existing score")
        let before = try snapshot(target)

        XCTAssertThrowsError(try NativeLibraryFiles(store: target).restoreBackup(damaged))
        try assertUnchanged(before, store: target)
    }

    @MainActor
    func testUnsafeBackupFilenameIsRejectedBeforeResourceRemapping() async throws {
        let source = try fixture()
        let piece = try addPDF(to: source)
        let oldName = try XCTUnwrap(piece.pdfFileName)
        let backup = try NativeLibraryFiles(store: source).makeBackup()
        let damaged = try editingBackup(backup.data) { object in
            var library = try XCTUnwrap(object["library"] as? [String: Any])
            var pieces = try XCTUnwrap(library["pieces"] as? [[String: Any]])
            var scores = try XCTUnwrap(object["scores"] as? [String: Any])
            pieces[0]["pdfFileName"] = "../outside.pdf"
            scores["../outside.pdf"] = try XCTUnwrap(scores.removeValue(forKey: oldName))
            library["pieces"] = pieces
            object["library"] = library
            object["scores"] = scores
        }
        let target = try fixture()
        try addPDF(to: target, title: "Preserved score")
        let before = try snapshot(target)

        XCTAssertThrowsError(try NativeLibraryFiles(store: target).restoreBackup(damaged))
        try assertUnchanged(before, store: target)
        XCTAssertFalse(FileManager.default.fileExists(atPath: target.directory.appendingPathComponent("outside.pdf").path))
    }

    @MainActor
    func testRestoreRequiresFinishingRunningPausedOrCompletedCurrentSet() async throws {
        let source = try fixture()
        try addPDF(to: source, title: "Backup score")
        let backup = try NativeLibraryFiles(store: source).makeBackup()
        let target = try fixture()
        let piece = try addPDF(to: target, title: "Current practice")
        try target.startSet(PracticeConfiguration(pieceID: piece.id, targetCount: 2))
        try target.record(.clean)
        let running = try snapshot(target)
        XCTAssertThrowsError(try NativeLibraryFiles(store: target).restoreBackup(backup.data))
        try assertUnchanged(running, store: target)

        try target.pause()
        let paused = try snapshot(target)
        XCTAssertThrowsError(try NativeLibraryFiles(store: target).restoreBackup(backup.data))
        try assertUnchanged(paused, store: target)

        try target.resume()
        try target.record(.clean)
        XCTAssertEqual(target.activeSet?.status, .completed)
        let completed = try snapshot(target)
        XCTAssertThrowsError(try NativeLibraryFiles(store: target).restoreBackup(backup.data))
        try assertUnchanged(completed, store: target)
    }

    @MainActor
    func testUnreadableLibraryCannotExportEmptyBackupAndRecoversWithPDFBackup() async throws {
        let source = try fixture()
        let sourcePiece = try addPDF(to: source, title: "Recovered PDF score")
        let sourcePDF = try Data(contentsOf: XCTUnwrap(NativeLibraryFiles(store: source).scoreURL(for: sourcePiece)))
        let backup = try NativeLibraryFiles(store: source).makeBackup()
        let target = try fixture()
        try addPDF(to: target, title: "Original library score")
        let originalScores = try snapshot(target).scores
        let corrupt = Data("{unreadable native original".utf8)
        try corrupt.write(to: target.fileURL, options: .atomic)
        let unreadable = PracticeStore(directory: target.directory)
        let files = NativeLibraryFiles(store: unreadable)
        XCTAssertTrue(unreadable.isReadOnly)
        XCTAssertThrowsError(try files.makeBackup())
        XCTAssertEqual(try Data(contentsOf: target.fileURL), corrupt)

        try files.restoreBackup(backup.data)
        XCTAssertFalse(unreadable.isReadOnly)
        XCTAssertEqual(try Data(contentsOf: XCTUnwrap(unreadable.preservedOriginalURL)), corrupt)
        let restoredPiece = try XCTUnwrap(unreadable.pieces.first)
        XCTAssertEqual(restoredPiece.id, sourcePiece.id)
        XCTAssertEqual(try Data(contentsOf: XCTUnwrap(files.scoreURL(for: restoredPiece))), sourcePDF)
        let restoredScores = try snapshot(unreadable).scores
        for (name, bytes) in originalScores { XCTAssertEqual(restoredScores[name], bytes, "Recovery must retain the old library's PDF resources") }
        XCTAssertFalse(PracticeStore(directory: target.directory).isReadOnly)
    }
}
