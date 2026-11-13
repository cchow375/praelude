import CryptoKit
import Foundation
import PDFKit
import PencilKit
import UIKit

@MainActor
struct DesktopLibraryFiles {
    let store: PracticeStore
    var directory: URL { store.directory.appendingPathComponent("DesktopImports", isDirectory: true) }
    static func hash(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }

    static func transferIdentifier(_ transfer: DesktopTransfer) throws -> String {
        let files = transfer.scoreFiles.sorted {
            if $0.pieceID != $1.pieceID { return $0.pieceID < $1.pieceID }
            return $0.edition < $1.edition
        }
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        var identity = Data(transfer.databaseSHA256.utf8)
        identity.append(try encoder.encode(files))
        identity.append(try encoder.encode(transfer.scores.keys.sorted()))
        identity.append(try encoder.encode(transfer.assets.keys.sorted()))
        return hash(identity)
    }
    func importTransfer(_ transfer: DesktopTransfer, data: Data) throws {
        guard store.activeSet == nil else { throw PracticeError.conflict("Finish your current set before importing Mac data.") }
        guard Self.hash(transfer.database) == transfer.databaseSHA256,
              transfer.database.starts(with: Array("SQLite format 3\0".utf8)) else {
            throw PracticeError.invalid("The Mac database snapshot failed its integrity check.")
        }
        let identity = try Self.transferIdentifier(transfer)
        var library = try transfer.nativeLibrary(at: Date())
        try importPencilMarks(transfer, into: &library)
        try PracticeStore.validate(library)
        let files = NativeLibraryFiles(store: store)
        try FileManager.default.createDirectory(at: files.scoresDirectory, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try requireBackupBudget(library: library, transfer: transfer, data: data, identity: identity)
        var staged: [URL] = []
        do {
            for file in transfer.scoreFiles {
                guard let score = transfer.scores[file.filename], score.count <= 100_000_000,
                      Self.hash(score) + ".pdf" == file.filename,
                      let pdf = PDFDocument(data: score), !pdf.isLocked, pdf.pageCount == file.pageCount else {
                    throw PracticeError.invalid("A Mac score is missing, damaged or changed. Your library has not been changed.")
                }
                let path = files.scoresDirectory.appendingPathComponent(file.filename)
                if FileManager.default.fileExists(atPath: path.path) {
                    guard try Data(contentsOf: path) == score else { throw PracticeError.conflict("An existing score does not match this transfer.") }
                } else {
                    try score.write(to: path, options: [.atomic, .completeFileProtectionUnlessOpen]); staged.append(path)
                }
            }
            let name = store.state.desktopImports.first(where: { $0.id == identity })?.archiveFileName ?? (identity + ".json")
            let path = directory.appendingPathComponent(name)
            if FileManager.default.fileExists(atPath: path.path) {
                let preserved = try DesktopTransfer.decode(Data(contentsOf: path))
                guard try Self.transferIdentifier(preserved) == identity,
                      Self.hash(preserved.database) == preserved.databaseSHA256 else {
                    throw PracticeError.conflict("The preserved Mac transfer does not match this import.")
                }
            } else {
                try data.write(to: path, options: [.atomic, .completeFileProtectionUnlessOpen]); staged.append(path)
            }
            let receipt = DesktopImportReceipt(id: identity, archiveFileName: name, importedAt: Date(),
                                               tableCounts: transfer.tables.mapValues(\.count), scoreCount: transfer.scores.count)
            try store.importDesktop(library, receipt: receipt)
        } catch {
            for path in staged { try? FileManager.default.removeItem(at: path) }
            throw error
        }
    }
    private func requireBackupBudget(library: LibraryState, transfer: DesktopTransfer, data: Data, identity: String) throws {
        var bytes = 0
        let currentIDs = Set(store.state.pieces.map(\.id))
        let pieces = store.state.pieces + library.pieces.filter { !currentIDs.contains($0.id) }
        for name in Set(pieces.compactMap(\.pdfFileName)) {
            let local = NativeLibraryFiles(store: store).scoresDirectory.appendingPathComponent(name)
            if let incoming = transfer.scores[name] { bytes += incoming.count }
            else { bytes += try local.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0 }
        }
        for name in Set(pieces.compactMap(\.customCoverRef)) {
            bytes += try NativeLibraryFiles(store: store).coversDirectory.appendingPathComponent(name).resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
        }
        for recording in store.state.recordings where recording.deletedAt == nil { bytes += recording.byteSize }
        for receipt in store.state.desktopImports {
            if receipt.id == identity { bytes += data.count }
            else { bytes += try directory.appendingPathComponent(receipt.archiveFileName).resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0 }
        }
        if !store.state.desktopImports.contains(where: { $0.id == identity }) { bytes += data.count }
        guard bytes <= 210_000_000 else {
            throw PracticeError.invalid("Importing this transfer would exceed the 210 MB backup limit. Your existing library has been preserved.")
        }
    }
    private func importPencilMarks(_ transfer: DesktopTransfer, into library: inout LibraryState) throws {
        for row in transfer.rows("score_page_mark") {
            let sourceID = try DesktopTransfer.integer(row, "piece_id")
            let edition = DesktopTransfer.text(row, "edition_id")
            guard let file = transfer.scoreFiles.first(where: {
                $0.pieceID == sourceID && ($0.editionID == edition || $0.edition == edition)
                    && $0.fingerprint == DesktopTransfer.text(row, "edition_fingerprint")
            }), let source = transfer.scores[file.filename], let pdf = PDFDocument(data: source) else { continue }
            let pageNumber = try DesktopTransfer.integer(row, "page")
            guard (1...file.pageCount).contains(pageNumber), let page = pdf.page(at: pageNumber - 1), let width = row["width"]?.doubleValue,
                  width.isFinite, width > 0, width <= 0.05,
                  let data = DesktopTransfer.text(row, "points_json").data(using: .utf8),
                  let points = try JSONDecoder().decode(SyncJSON.self, from: data).arrayValue,
                  !points.isEmpty, points.count <= 100000 else {
                throw PracticeError.invalid("A Mac pencil mark contains invalid geometry.")
            }
            let bounds = page.bounds(for: .cropBox)
            let thickness = max(0.5, width * bounds.width)
            let controls = try points.enumerated().map { index, value -> PKStrokePoint in
                guard let point = value.objectValue, let x = point["x"]?.doubleValue, let y = point["y"]?.doubleValue,
                      x.isFinite, y.isFinite, (0...1).contains(x), (0...1).contains(y) else {
                    throw PracticeError.invalid("A Mac pencil mark extends outside its score.")
                }
                return PKStrokePoint(location: CGPoint(x: x * bounds.width, y: y * bounds.height),
                                     timeOffset: Double(index) / 120, size: CGSize(width: thickness, height: thickness),
                                     opacity: 1, force: 1, azimuth: 0, altitude: .pi / 2)
            }
            let stroke = PKStroke(ink: PKInk(.pencil, color: .black), path: PKStrokePath(controlPoints: controls, creationDate: Date()))
            let canonical = try DesktopTransfer.identifier("piece", sourceID)
            let isCanonicalFile = library.pieces.first(where: { $0.id == canonical })?.pdfFileName == file.filename
            let pieceID: UUID = try isCanonicalFile ? DesktopTransfer.identifier("piece", sourceID)
                : DesktopTransfer.editionIdentifier(pieceID: sourceID, filename: file.filename)
            guard library.pieces.contains(where: { $0.id == pieceID }) else { continue }
            let created = try DesktopTransfer.date(DesktopTransfer.text(row, "created_ts"))
            library.inkStrokes.append(InkStroke(id: try DesktopTransfer.identifier("score_page_mark", DesktopTransfer.integer(row, "id")),
                                               pieceID: pieceID, page: pageNumber, data: PKDrawing(strokes: [stroke]).dataRepresentation(),
                                               createdAt: created, updatedAt: created))
        }
    }
    func transfer(_ receipt: DesktopImportReceipt) throws -> DesktopTransfer {
        guard DesktopTransfer.localName(receipt.archiveFileName) else { throw PracticeError.invalid("The Mac archive filename is invalid.") }
        return try DesktopTransfer.decode(Data(contentsOf: directory.appendingPathComponent(receipt.archiveFileName)))
    }
}
