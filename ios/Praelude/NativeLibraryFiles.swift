import Foundation
import PDFKit
import PencilKit
import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// iOS owns sandbox-relative PDF copies. Desktop paths and databases never enter this store.
@MainActor
struct NativeLibraryFiles {
    let store: PracticeStore
    var scoresDirectory: URL { store.directory.appendingPathComponent("Scores", isDirectory: true) }
    var coversDirectory: URL { store.directory.appendingPathComponent("Covers", isDirectory: true) }
    func scoreURL(for piece: Piece) -> URL? {
        guard let name = piece.pdfFileName, URL(fileURLWithPath: name).lastPathComponent == name,
              !name.contains("..") else { return nil }
        return scoresDirectory.appendingPathComponent(name)
    }
    /// §7 custom covers: `nil` when the piece has none, or its filename fails the same local-name
    /// safety check `validate(_:)` enforces (belt and suspenders — a name that could ever fail that
    /// check should also never be trusted to build a path from).
    func coverURL(for piece: Piece) -> URL? {
        guard let name = piece.customCoverRef, URL(fileURLWithPath: name).lastPathComponent == name,
              !name.contains("..") else { return nil }
        return coversDirectory.appendingPathComponent(name)
    }
    /// Saves `data` as this piece's custom cover (§7) and points `customCoverRef` at it, replacing
    /// any previous custom cover file. Accepts JPEG or PNG; anything else — including data that
    /// merely has an image `UTType` but fails to decode — is rejected before anything is written.
    func saveCustomCover(_ data: Data, for piece: Piece) throws -> Piece {
        guard data.count <= 15_000_000 else { throw PracticeError.invalid("Choose a cover image smaller than 15 MB.") }
        guard let image = UIImage(data: data) else { throw PracticeError.invalid("This image could not be opened.") }
        let isPNG = data.starts(with: [0x89, 0x50, 0x4E, 0x47])
        let ext = isPNG ? "png" : "jpg"
        let encoded = isPNG ? data : (image.jpegData(compressionQuality: 0.85) ?? data)
        try FileManager.default.createDirectory(at: coversDirectory, withIntermediateDirectories: true)
        let name = UUID().uuidString + "." + ext
        let destination = coversDirectory.appendingPathComponent(name)
        try encoded.write(to: destination, options: [.atomic, .completeFileProtectionUnlessOpen])
        let previous = coverURL(for: piece)
        var updated = piece
        updated.customCoverRef = name; updated.updatedAt = Date()
        do { try store.updatePiece(updated) }
        catch { try? FileManager.default.removeItem(at: destination); throw error }
        if let previous, previous.lastPathComponent != name { try? FileManager.default.removeItem(at: previous) }
        return updated
    }
    /// Clears this piece's custom cover (§7), reverting it to its automatic first-page cover. The
    /// file is removed best-effort; a failure to delete never blocks clearing the reference itself.
    func removeCustomCover(for piece: Piece) throws -> Piece {
        let previous = coverURL(for: piece)
        var updated = piece
        updated.customCoverRef = nil; updated.updatedAt = Date()
        try store.updatePiece(updated)
        if let previous { try? FileManager.default.removeItem(at: previous) }
        return updated
    }
    func importPDF(_ url: URL, title: String, composer: String, instrumentID: UUID? = nil, replacing piece: Piece? = nil) throws -> UUID {
        if let piece { try store.requireReplaceableScore(pieceID: piece.id) }
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let values = try url.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey])
        guard values.isRegularFile == true, let size = values.fileSize, size > 0, size <= 100_000_000 else {
            throw PracticeError.invalid("Choose a PDF smaller than 100 MB.")
        }
        let data = try Data(contentsOf: url, options: .mappedIfSafe)
        guard let document = PDFDocument(data: data), !document.isLocked,
              document.pageCount > 0, document.pageCount <= 2000 else {
            throw PracticeError.invalid("This score cannot be opened. Choose an unlocked PDF with up to 2,000 pages.")
        }
        try FileManager.default.createDirectory(at: scoresDirectory, withIntermediateDirectories: true)
        let name = UUID().uuidString + ".pdf"
        let destination = scoresDirectory.appendingPathComponent(name)
        try data.write(to: destination, options: [.atomic, .completeFileProtectionUnlessOpen])
        var saved = piece ?? Piece(title: title, composer: composer, instrumentID: instrumentID)
        saved.pdfFileName = name; saved.pageCount = document.pageCount; saved.lastPage = 1; saved.updatedAt = Date()
        do {
            if piece != nil { try store.updatePiece(saved) } else { try store.addPiece(saved) }
        } catch {
            try? FileManager.default.removeItem(at: destination)
            throw error
        }
        // Previous PDFs remain recoverable until a deliberate storage-cleanup workflow exists.
        return saved.id
    }
    func saveDrawing(pieceID: UUID, page: Int, data: Data) throws {
        if !data.isEmpty { try Self.validateDrawing(data) }
        try store.saveDrawing(pieceID: pieceID, page: page, data: data)
    }
    private static func validateDrawing(_ data: Data) throws {
        guard data.count <= PracticeStore.maximumDrawingBytes else { throw PracticeError.invalid("This page has reached the supported 8 MB of ink.") }
        do {
            guard !(try PKDrawing(data: data)).strokes.isEmpty else {
                throw PracticeError.invalid("The drawing contains no readable strokes.")
            }
        }
        catch { throw PracticeError.invalid("This page contains damaged ink. Your saved drawing has not been replaced.") }
    }
    func makeBackup() throws -> NativeBackupDocument {
        guard !store.isReadOnly else {
            throw PracticeError.unavailable("The saved library could not be read. Restore a valid backup before exporting; the unreadable original will be preserved.")
        }
        for stroke in store.state.inkStrokes where stroke.deletedAt == nil { try Self.validateDrawing(stroke.data) }
        try store.checkpoint()
        var files: [String: Data] = [:]
        var covers: [String: Data] = [:]
        var desktopArchives: [String: Data] = [:]
        var recordings: [String: Data] = [:]
        var bytes = 0
        for piece in store.state.pieces {
            guard let name = piece.pdfFileName, let url = scoreURL(for: piece), files[name] == nil else { continue }
            let data = try Data(contentsOf: url)
            bytes += data.count
            guard bytes <= 210_000_000 else { throw PracticeError.invalid("This library is too large for a single 210 MB backup.") }
            files[name] = data
        }
        // §7 custom covers travel in the same backup, under the same combined byte budget, so a
        // cover is never quietly dropped across a backup/restore round trip.
        for piece in store.state.pieces {
            guard let name = piece.customCoverRef, let url = coverURL(for: piece), covers[name] == nil else { continue }
            let data = try Data(contentsOf: url)
            bytes += data.count
            guard bytes <= 210_000_000 else { throw PracticeError.invalid("This library is too large for a single 210 MB backup.") }
            covers[name] = data
        }
        for recording in store.state.recordings where recording.deletedAt == nil {
            guard DesktopTransfer.localName(recording.fileName) else { throw PracticeError.invalid("A recording filename is invalid.") }
            let path = store.directory.appendingPathComponent("Recordings").appendingPathComponent(recording.fileName)
            let data = try Data(contentsOf: path)
            guard data.count == recording.byteSize else { throw PracticeError.invalid("A recording is missing or incomplete. Your library has not been changed.") }
            bytes += data.count
            guard bytes <= 210_000_000 else { throw PracticeError.invalid("This library is too large for a single 210 MB backup.") }
            recordings[recording.fileName] = data
        }
        for receipt in store.state.desktopImports {
            guard DesktopTransfer.localName(receipt.archiveFileName) else { throw PracticeError.invalid("A Mac archive filename is invalid.") }
            let path = DesktopLibraryFiles(store: store).directory.appendingPathComponent(receipt.archiveFileName)
            let data = try Data(contentsOf: path)
            bytes += data.count
            guard bytes <= 210_000_000 else { throw PracticeError.invalid("This library is too large for a single 210 MB backup.") }
            desktopArchives[receipt.archiveFileName] = data
        }
        var snapshot = store.state
        if snapshot.activeSet?.status == .running {
            snapshot.activeSet?.status = .paused; snapshot.activeSet?.lastCheckpoint = nil
        }
        // Older readers must refuse before writing rather than discard durable new semantics.
        let hasTempoChanges = snapshot.activeSet?.configuration.tempoChanges.isEmpty == false
            || snapshot.history.contains { !$0.configuration.tempoChanges.isEmpty }
        let version = hasTempoChanges ? 3 : (recordings.isEmpty && desktopArchives.isEmpty ? 1 : 2)
        let payload = NativeBackup(version: version, library: snapshot, scores: files, covers: covers, desktopArchives: desktopArchives, recordings: recordings)
        let data = try JSONEncoder().encode(payload)
        guard data.count <= 280_000_000 else { throw PracticeError.invalid("This library exceeds the supported 280 MB backup size.") }
        return NativeBackupDocument(data: data)
    }
    func restoreBackup(_ data: Data) throws {
        guard data.count <= 280_000_000 else { throw PracticeError.invalid("Choose a Praelude backup smaller than 280 MB.") }
        guard store.activeSet == nil else { throw PracticeError.conflict("Finish your current set before restoring a backup.") }
        var backup = try JSONDecoder().decode(NativeBackup.self, from: data)
        guard (1...3).contains(backup.version) else { throw PracticeError.invalid("This backup needs a newer version of Praelude.") }
        try PracticeStore.validate(backup.library)
        for stroke in backup.library.inkStrokes where stroke.deletedAt == nil { try Self.validateDrawing(stroke.data) }
        try FileManager.default.createDirectory(at: scoresDirectory, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: coversDirectory, withIntermediateDirectories: true)
        var staged: [URL] = []
        var remapped: [String: String] = [:]
        var pageCounts: [String: Int] = [:]
        do {
            for i in backup.library.pieces.indices {
                guard let old = backup.library.pieces[i].pdfFileName else { continue }
                if let existing = remapped[old] {
                    guard pageCounts[old] == backup.library.pieces[i].pageCount else {
                        throw PracticeError.invalid("This backup contains inconsistent score page counts.")
                    }
                    backup.library.pieces[i].pdfFileName = existing; continue
                }
                guard let data = backup.scores[old], data.count <= 100_000_000,
                      let pdf = PDFDocument(data: data), !pdf.isLocked,
                      pdf.pageCount == backup.library.pieces[i].pageCount else {
                    throw PracticeError.invalid("This backup contains a missing or damaged score. Your library has not been replaced.")
                }
                let name = UUID().uuidString + ".pdf"
                let path = scoresDirectory.appendingPathComponent(name)
                try data.write(to: path, options: [.atomic, .completeFileProtectionUnlessOpen])
                staged.append(path); remapped[old] = name; pageCounts[old] = pdf.pageCount; backup.library.pieces[i].pdfFileName = name
            }
            // §7 custom covers: same remap-by-content-identity dance as scores above, but keyed by
            // `customCoverRef`/`covers` and validated as a decodable image rather than a page count.
            var remappedCovers: [String: String] = [:]
            for i in backup.library.pieces.indices {
                guard let old = backup.library.pieces[i].customCoverRef else { continue }
                if let existing = remappedCovers[old] { backup.library.pieces[i].customCoverRef = existing; continue }
                guard let data = backup.covers[old], data.count <= 15_000_000, UIImage(data: data) != nil else {
                    throw PracticeError.invalid("This backup contains a missing or damaged cover image. Your library has not been replaced.")
                }
                let ext = old.lowercased().hasSuffix(".png") ? "png" : "jpg"
                let name = UUID().uuidString + "." + ext
                let path = coversDirectory.appendingPathComponent(name)
                try data.write(to: path, options: [.atomic, .completeFileProtectionUnlessOpen])
                staged.append(path); remappedCovers[old] = name; backup.library.pieces[i].customCoverRef = name
            }
            let recordingsDirectory = store.directory.appendingPathComponent("Recordings", isDirectory: true)
            try FileManager.default.createDirectory(at: recordingsDirectory, withIntermediateDirectories: true)
            var remappedRecordings: [String: String] = [:]
            for index in backup.library.recordings.indices where backup.library.recordings[index].deletedAt == nil {
                let recording = backup.library.recordings[index]
                guard DesktopTransfer.localName(recording.fileName), let data = backup.recordings[recording.fileName],
                      !data.isEmpty, data.count == recording.byteSize else {
                    throw PracticeError.invalid("This backup is missing a recording. Your library has not been replaced.")
                }
                if let name = remappedRecordings[recording.fileName] { backup.library.recordings[index].fileName = name; continue }
                let name = "take-" + UUID().uuidString + ".m4a"
                let path = recordingsDirectory.appendingPathComponent(name)
                try data.write(to: path, options: [.atomic, .completeFileProtectionUnlessOpen])
                staged.append(path); remappedRecordings[recording.fileName] = name
                backup.library.recordings[index].fileName = name
            }
            let desktopDirectory = DesktopLibraryFiles(store: store).directory
            try FileManager.default.createDirectory(at: desktopDirectory, withIntermediateDirectories: true)
            for index in backup.library.desktopImports.indices {
                let receipt = backup.library.desktopImports[index]
                guard let archive = backup.desktopArchives[receipt.archiveFileName] else {
                    throw PracticeError.invalid("This backup is missing its original Mac record.")
                }
                let transfer = try DesktopTransfer.decode(archive)
                guard try DesktopLibraryFiles.transferIdentifier(transfer) == receipt.id,
                      DesktopLibraryFiles.hash(transfer.database) == transfer.databaseSHA256 else {
                    throw PracticeError.invalid("This backup contains a damaged Mac record.")
                }
                let name = UUID().uuidString + ".json"
                let path = desktopDirectory.appendingPathComponent(name)
                try archive.write(to: path, options: [.atomic, .completeFileProtectionUnlessOpen])
                staged.append(path); backup.library.desktopImports[index].archiveFileName = name
            }
            try store.restoreBackup(backup.library)
        } catch {
            for path in staged { try? FileManager.default.removeItem(at: path) }
            throw error
        }
    }
}

private struct NativeBackup: Codable {
    var version: Int
    var library: LibraryState
    var scores: [String: Data]
    /// §7 custom covers. Absent (rather than an empty dictionary) on any backup made before this
    /// field existed — `decodeIfPresent` keeps those restorable exactly as before, with no covers.
    var covers: [String: Data]
    var desktopArchives: [String: Data]
    var recordings: [String: Data]
    init(version: Int, library: LibraryState, scores: [String: Data], covers: [String: Data] = [:], desktopArchives: [String: Data] = [:], recordings: [String: Data] = [:]) {
        self.version = version; self.library = library; self.scores = scores; self.covers = covers; self.desktopArchives = desktopArchives; self.recordings = recordings
    }
    private enum CodingKeys: String, CodingKey { case version, library, scores, covers, desktopArchives, recordings }
    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        version = try values.decode(Int.self, forKey: .version)
        library = try values.decode(LibraryState.self, forKey: .library)
        scores = try values.decode([String: Data].self, forKey: .scores)
        recordings = try values.decodeIfPresent([String: Data].self, forKey: .recordings) ?? [:]
        desktopArchives = try values.decodeIfPresent([String: Data].self, forKey: .desktopArchives) ?? [:]
        covers = try values.decodeIfPresent([String: Data].self, forKey: .covers) ?? [:]
    }
}

struct NativeBackupDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.json] }
    var data: Data
    init(data: Data) { self.data = data }
    init(configuration: ReadConfiguration) throws {
        guard let contents = configuration.file.regularFileContents else { throw CocoaError(.fileReadCorruptFile) }
        data = contents
    }
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper { FileWrapper(regularFileWithContents: data) }
}
