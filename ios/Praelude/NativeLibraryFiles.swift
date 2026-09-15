import Foundation
import PDFKit
import PencilKit
import SwiftUI
import UniformTypeIdentifiers

/// iOS owns sandbox-relative PDF copies. Desktop paths and databases never enter this store.
@MainActor
struct NativeLibraryFiles {
    let store: PracticeStore
    var scoresDirectory: URL { store.directory.appendingPathComponent("Scores", isDirectory: true) }
    func scoreURL(for piece: Piece) -> URL? {
        guard let name = piece.pdfFileName, URL(fileURLWithPath: name).lastPathComponent == name,
              !name.contains("..") else { return nil }
        return scoresDirectory.appendingPathComponent(name)
    }
    func importPDF(_ url: URL, title: String, composer: String, replacing piece: Piece? = nil) throws -> UUID {
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
        var saved = piece ?? Piece(title: title, composer: composer)
        saved.pdfFileName = name; saved.pageCount = document.pageCount; saved.lastPage = 1
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
        for drawing in store.state.scoreDrawings { try Self.validateDrawing(drawing.data) }
        try store.checkpoint()
        var files: [String: Data] = [:]
        var bytes = 0
        for piece in store.state.pieces {
            guard let name = piece.pdfFileName, let url = scoreURL(for: piece), files[name] == nil else { continue }
            let data = try Data(contentsOf: url)
            bytes += data.count
            guard bytes <= 200_000_000 else { throw PracticeError.invalid("This library is too large for a single 200 MB backup.") }
            files[name] = data
        }
        var snapshot = store.state
        if snapshot.activeSet?.status == .running {
            snapshot.activeSet?.status = .paused; snapshot.activeSet?.lastCheckpoint = nil
        }
        let payload = NativeBackup(version: 1, library: snapshot, scores: files)
        let data = try JSONEncoder().encode(payload)
        guard data.count <= 280_000_000 else { throw PracticeError.invalid("This library exceeds the supported 280 MB backup size.") }
        return NativeBackupDocument(data: data)
    }
    func restoreBackup(_ data: Data) throws {
        guard data.count <= 280_000_000 else { throw PracticeError.invalid("Choose a Praelude backup smaller than 280 MB.") }
        guard store.activeSet == nil else { throw PracticeError.conflict("Finish your current set before restoring a backup.") }
        var backup = try JSONDecoder().decode(NativeBackup.self, from: data)
        guard backup.version == 1 else { throw PracticeError.invalid("This backup needs a newer version of Praelude.") }
        try PracticeStore.validate(backup.library)
        for drawing in backup.library.scoreDrawings { try Self.validateDrawing(drawing.data) }
        try FileManager.default.createDirectory(at: scoresDirectory, withIntermediateDirectories: true)
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
