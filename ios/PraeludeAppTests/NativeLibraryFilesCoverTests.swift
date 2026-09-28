import PDFKit
import UIKit
import XCTest
@testable import Praelude

/// §7 custom covers: `NativeLibraryFiles.saveCustomCover`/`removeCustomCover`, and their round trip
/// through `makeBackup`/`restoreBackup` alongside score PDFs. A separate file from
/// `NativeLibraryFilesTests` (which this mirrors the fixture style of) to keep this track's
/// additions out of a file another track is also actively editing.
final class NativeLibraryFilesCoverTests: XCTestCase {
    @MainActor
    private func fixture() throws -> (PracticeStore, URL) {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("Praelude-Covers-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let store = PracticeStore(directory: root.appendingPathComponent("library", isDirectory: true))
        return (store, root)
    }

    private func jpegData(color: UIColor = .red, size: CGSize = CGSize(width: 40, height: 40)) -> Data {
        let image = UIGraphicsImageRenderer(size: size).image { context in
            color.setFill(); context.fill(CGRect(origin: .zero, size: size))
        }
        return image.jpegData(compressionQuality: 0.9)!
    }

    @MainActor func testSaveCustomCoverWritesFileAndUpdatesPieceAtomically() throws {
        let (store, root) = try fixture()
        defer { try? FileManager.default.removeItem(at: root) }
        var piece = Piece(title: "Nocturne")
        try store.addPiece(piece)
        let files = NativeLibraryFiles(store: store)
        piece = try files.saveCustomCover(jpegData(), for: piece)
        XCTAssertNotNil(piece.customCoverRef)
        let coverURL = try XCTUnwrap(files.coverURL(for: piece))
        XCTAssertTrue(FileManager.default.fileExists(atPath: coverURL.path))
        XCTAssertNotNil(UIImage(contentsOfFile: coverURL.path))
        XCTAssertEqual(store.pieces.first?.customCoverRef, piece.customCoverRef)
    }

    @MainActor func testSavingANewCoverRemovesThePreviousFile() throws {
        let (store, root) = try fixture()
        defer { try? FileManager.default.removeItem(at: root) }
        var piece = Piece(title: "Nocturne")
        try store.addPiece(piece)
        let files = NativeLibraryFiles(store: store)
        piece = try files.saveCustomCover(jpegData(color: .red), for: piece)
        let firstCoverURL = try XCTUnwrap(files.coverURL(for: piece))
        piece = try files.saveCustomCover(jpegData(color: .blue), for: piece)
        let secondCoverURL = try XCTUnwrap(files.coverURL(for: piece))
        XCTAssertNotEqual(firstCoverURL, secondCoverURL)
        XCTAssertFalse(FileManager.default.fileExists(atPath: firstCoverURL.path), "The replaced cover file must not be left orphaned on disk")
        XCTAssertTrue(FileManager.default.fileExists(atPath: secondCoverURL.path))
    }

    @MainActor func testRemoveCustomCoverClearsReferenceAndDeletesFile() throws {
        let (store, root) = try fixture()
        defer { try? FileManager.default.removeItem(at: root) }
        var piece = Piece(title: "Nocturne")
        try store.addPiece(piece)
        let files = NativeLibraryFiles(store: store)
        piece = try files.saveCustomCover(jpegData(), for: piece)
        let coverURL = try XCTUnwrap(files.coverURL(for: piece))
        piece = try files.removeCustomCover(for: piece)
        XCTAssertNil(piece.customCoverRef)
        XCTAssertFalse(FileManager.default.fileExists(atPath: coverURL.path))
        XCTAssertNil(store.pieces.first?.customCoverRef)
    }

    @MainActor func testSaveCustomCoverRejectsOversizedOrUndecodableData() throws {
        let (store, root) = try fixture()
        defer { try? FileManager.default.removeItem(at: root) }
        let piece = Piece(title: "Nocturne")
        try store.addPiece(piece)
        let files = NativeLibraryFiles(store: store)
        XCTAssertThrowsError(try files.saveCustomCover(Data("not an image".utf8), for: piece))
        XCTAssertThrowsError(try files.saveCustomCover(Data(repeating: 0, count: 15_000_001), for: piece))
        XCTAssertNil(store.pieces.first?.customCoverRef)
    }

    /// The hard "never lose user data" constraint applied to covers specifically: a backup made
    /// with a custom cover restores that exact image, and a backup made *before* covers existed
    /// (no `covers` key at all) still restores cleanly with none.
    @MainActor func testCustomCoverSurvivesABackupAndRestoreRoundTrip() throws {
        let (store, root) = try fixture()
        defer { try? FileManager.default.removeItem(at: root) }
        let files = NativeLibraryFiles(store: store)
        var piece = Piece(title: "Nocturne")
        try store.addPiece(piece)
        let coverBytes = jpegData(color: .green)
        piece = try files.saveCustomCover(coverBytes, for: piece)

        let backup = try files.makeBackup()
        let restoreRoot = FileManager.default.temporaryDirectory.appendingPathComponent("Praelude-Covers-Restore-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: restoreRoot, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: restoreRoot) }
        let restoredStore = PracticeStore(directory: restoreRoot.appendingPathComponent("library", isDirectory: true))
        try NativeLibraryFiles(store: restoredStore).restoreBackup(backup.data)

        let restoredPiece = try XCTUnwrap(restoredStore.pieces.first)
        XCTAssertNotNil(restoredPiece.customCoverRef)
        let restoredCoverURL = try XCTUnwrap(NativeLibraryFiles(store: restoredStore).coverURL(for: restoredPiece))
        XCTAssertEqual(try Data(contentsOf: restoredCoverURL).count, coverBytes.count)
        XCTAssertNotNil(UIImage(contentsOfFile: restoredCoverURL.path))
    }

    @MainActor func testBackupMadeBeforeCoversExistedStillRestoresWithoutCovers() throws {
        let (store, root) = try fixture()
        defer { try? FileManager.default.removeItem(at: root) }
        let piece = Piece(title: "Étude")
        try store.addPiece(piece)
        let backup = try NativeLibraryFiles(store: store).makeBackup()
        // Simulate a pre-cover backup: decode, strip the `covers` key entirely (not merely empty),
        // re-encode — exactly how a genuinely older backup file would be shaped.
        var json = try XCTUnwrap(JSONSerialization.jsonObject(with: backup.data) as? [String: Any])
        json.removeValue(forKey: "covers")
        let legacyData = try JSONSerialization.data(withJSONObject: json)

        let restoreRoot = FileManager.default.temporaryDirectory.appendingPathComponent("Praelude-Covers-Legacy-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: restoreRoot, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: restoreRoot) }
        let restoredStore = PracticeStore(directory: restoreRoot.appendingPathComponent("library", isDirectory: true))
        try NativeLibraryFiles(store: restoredStore).restoreBackup(legacyData)
        XCTAssertEqual(restoredStore.pieces.first?.title, "Étude")
        XCTAssertNil(restoredStore.pieces.first?.customCoverRef)
    }
}
