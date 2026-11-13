import Foundation

/// A lossless Mac snapshot stays local alongside native practice data. Integer desktop identities
/// have a stable, separate UUID namespace, so importing twice never duplicates a practice target.
public struct DesktopImportReceipt: Codable, Equatable, Identifiable, Sendable {
    public var id: String
    public var archiveFileName: String
    public var importedAt: Date
    public var tableCounts: [String: Int]
    public var scoreCount: Int
    public init(id: String, archiveFileName: String, importedAt: Date, tableCounts: [String: Int], scoreCount: Int) {
        self.id = id; self.archiveFileName = archiveFileName; self.importedAt = importedAt
        self.tableCounts = tableCounts; self.scoreCount = scoreCount
    }
}

public struct DesktopTransfer: Codable, Sendable {
    public struct ScoreFile: Codable, Sendable {
        public var pieceID: Int
        public var edition: String
        public var editionID: String?
        public var fingerprint: String?
        public var filename: String
        public var pageCount: Int
        public var preferred: Bool
    }
    public var format: String
    public var version: Int
    public var exportedAt: String
    public var databaseSHA256: String
    public var database: Data
    public var tables: [String: [[String: SyncJSON]]]
    public var scores: [String: Data]
    public var scoreFiles: [ScoreFile]
    public var assets: [String: Data]
    public var warnings: [String]

    public static func decode(_ data: Data) throws -> Self {
        guard data.count <= 280_000_000 else { throw PracticeError.invalid("Choose a Mac transfer smaller than 280 MB.") }
        let transfer = try JSONDecoder().decode(Self.self, from: data)
        guard transfer.format == "praelude-desktop-transfer", transfer.version == 1,
              transfer.databaseSHA256.count == 64,
              transfer.databaseSHA256.allSatisfy({ $0.isHexDigit }), !transfer.database.isEmpty,
              transfer.tables["piece"] != nil, transfer.tables["rep"] != nil,
              transfer.tables["rep_block"] != nil, transfer.tables["session"] != nil else {
            throw PracticeError.invalid("This is not a supported Praelude Mac transfer.")
        }
        for file in transfer.scoreFiles {
            guard (0...Int(UInt32.max)).contains(file.pieceID), localName(file.filename), file.filename.count == 68,
                  file.filename.prefix(64).allSatisfy({ $0.isHexDigit }), file.filename.hasSuffix(".pdf"),
                  (1...2000).contains(file.pageCount), transfer.scores[file.filename] != nil else {
                throw PracticeError.invalid("This transfer contains a missing or invalid score.")
            }
        }
        guard transfer.rows("session").allSatisfy({ $0["ended_at"]?.isNull == false }),
              transfer.rows("rep_block").allSatisfy({ $0["status"]?.stringValue != "open" }) else {
            throw PracticeError.conflict("Finish practice on the Mac and export again before importing.")
        }
        return transfer
    }
    public static func localName(_ name: String) -> Bool {
        !name.isEmpty && name.count <= 255 && !name.contains("/") && !name.contains("\\") && !name.contains("..")
            && !name.unicodeScalars.contains { CharacterSet.controlCharacters.contains($0) }
    }
    public func rows(_ table: String) -> [[String: SyncJSON]] { tables[table] ?? [] }
    public static func identifier(_ table: String, _ id: Int) throws -> UUID {
        let kinds = ["piece": 1, "region": 2, "goal": 3, "piece_folder": 4, "region_box": 5, "score_page_mark": 6]
        guard let kind = kinds[table], (0...Int(UInt32.max)).contains(id) else {
            throw PracticeError.invalid("A Mac record has an unsupported identifier.")
        }
        return UUID(uuidString: String(format: "D35C7000-CAFE-4000-8000-%04X%08X", kind, id))!
    }
    public static func editionIdentifier(pieceID: Int, filename: String) -> UUID {
        // Export filenames are SHA256 content identifiers; piece identity remains part of the
        // namespace so two pieces sharing a PDF can still be practiced independently.
        let hex = String(filename.prefix(20))
        let tail = String(format: "%08X", pieceID) + hex
        let value = "E017" + tail
        let formatted = String(value.prefix(8)) + "-" + String(value.dropFirst(8).prefix(4)) + "-" + String(value.dropFirst(12).prefix(4)) + "-" + String(value.dropFirst(16).prefix(4)) + "-" + String(value.dropFirst(20).prefix(12))
        return UUID(uuidString: formatted)!
    }
    public static func displayNumber(_ value: SyncJSON?) -> String {
        guard let number = value?.doubleValue, number.isFinite else { return "—" }
        return number.formatted(.number.precision(.fractionLength(0...2)))
    }
    public static func integer(_ row: [String: SyncJSON], _ key: String) throws -> Int {
        guard let number = row[key]?.doubleValue, number.isFinite, number.rounded() == number,
              number >= 0, number <= Double(UInt32.max) else {
            throw PracticeError.invalid("A Mac record has an invalid \(key).")
        }
        return Int(number)
    }
    public static func text(_ row: [String: SyncJSON], _ key: String) -> String { row[key]?.stringValue ?? "" }
    public static func date(_ text: String) throws -> Date {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: text) { return date }
        formatter.formatOptions = [.withInternetDateTime]
        if let date = formatter.date(from: text) { return date }
        let sql = DateFormatter(); sql.locale = Locale(identifier: "en_US_POSIX")
        sql.timeZone = TimeZone(secondsFromGMT: 0); sql.dateFormat = "yyyy-MM-dd HH:mm:ss"
        if let date = sql.date(from: text) { return date }
        sql.dateFormat = "yyyy-MM-dd"
        if let date = sql.date(from: text) { return date }
        throw PracticeError.invalid("A Mac record has an invalid date.")
    }

    /// Convert targets that have equivalent native meanings. Historical sets retain their original
    /// contracts/verdicts in the archive; replaying them through different mobile rules would invent
    /// mastery and time. Every table remains available in the Mac record viewer.
    public func nativeLibrary(at importedAt: Date) throws -> LibraryState {
        var result = LibraryState()
        for row in rows("piece") {
            if Self.text(row, "kind") == "system" { continue }
            let integerID = try Self.integer(row, "id")
            let files = scoreFiles.filter { $0.pieceID == integerID }
            let preferred = files.first(where: \.preferred) ?? files.first
            let created = try Self.date(Self.text(row, "created_at"))
            let status: PieceStatus = row["completed_at"]?.isNull == false ? .completed
                : row["archived_at"]?.isNull == false ? .resting : .active
            let piece = Piece(id: try Self.identifier("piece", integerID), title: Self.text(row, "title"),
                              composer: Self.text(row, "composer"), pdfFileName: preferred?.filename,
                              pageCount: preferred?.pageCount ?? 0, status: status,
                              notes: Self.text(row, "notes"), createdAt: created,
                              updatedAt: importedAt, lastPageUpdatedAt: created)
            result.pieces.append(piece)
            var seen = Set([preferred?.filename].compactMap { $0 })
            for file in files where seen.insert(file.filename).inserted {
                let id = Self.editionIdentifier(pieceID: integerID, filename: file.filename)
                var alternate = piece
                alternate.id = id; alternate.title += " — " + URL(fileURLWithPath: file.edition).deletingPathExtension().lastPathComponent
                alternate.pdfFileName = file.filename; alternate.pageCount = file.pageCount
                result.pieces.append(alternate)
            }
        }
        for row in rows("region") {
            let id = try Self.integer(row, "id"), pieceID = try Self.integer(row, "piece_id")
            guard let piece = result.pieces.first(where: { $0.id == (try? Self.identifier("piece", pieceID)) }) else {
                if rows("piece").contains(where: { $0["id"] == row["piece_id"] && Self.text($0, "kind") == "system" }) { continue }
                throw PracticeError.invalid("A Mac passage references a missing piece.")
            }
            var regions: [PassageRegion] = []
            let preferred = scoreFiles.first { $0.pieceID == pieceID && $0.filename == piece.pdfFileName }
            if let data = Self.text(row, "pdf_anchor").data(using: .utf8),
               let anchor = try? JSONDecoder().decode(SyncJSON.self, from: data),
               let editions = anchor.objectValue?["editions"]?.objectValue,
               let preferred, let edition = editions[preferred.editionID ?? preferred.edition]?.objectValue,
               edition["fingerprint"]?.stringValue == preferred.fingerprint,
               let rects = edition["rects"]?.arrayValue {
                for rect in rects {
                    guard let box = rect.objectValue,
                          let page = box["page"]?.doubleValue, let x = box["x"]?.doubleValue,
                          let y = box["y"]?.doubleValue, let w = box["w"]?.doubleValue, let h = box["h"]?.doubleValue,
                          page.rounded() == page, page >= 1, page <= Double(piece.pageCount),
                          [x,y,w,h].allSatisfy(\.isFinite), x >= 0, y >= 0, w > 0, h > 0,
                          x + w <= 1.000001, y + h <= 1.000001 else {
                        throw PracticeError.invalid("A Mac passage box does not fit its score.")
                    }
                    // Clamp only sub-pixel floating-point overflow, never redraw a mismatched edition.
                    regions.append(PassageRegion(page: Int(page), x: x, y: y, width: min(w, 1-x), height: min(h, 1-y)))
                }
            }
            result.passages.append(Passage(id: try Self.identifier("region", id), pieceID: piece.id,
                                           title: Self.text(row, "name"), startMeasure: try Self.integer(row, "m_start"),
                                           endMeasure: try Self.integer(row, "m_end"), page: regions.first?.page ?? 1,
                                           regions: regions, color: row["color"]?.stringValue,
                                           createdAt: piece.createdAt, updatedAt: importedAt))
        }
        for row in rows("goal") {
            let id = try Self.integer(row, "id"), pieceID = try Self.integer(row, "piece_id")
            if !result.pieces.contains(where: { $0.id == (try? Self.identifier("piece", pieceID)) }) { continue }
            let due = row["target_date"]?.stringValue
            result.goals.append(PracticeGoal(id: try Self.identifier("goal", id), title: Self.text(row, "text"),
                                            pieceID: try Self.identifier("piece", pieceID),
                                            dueDate: try due.map(Self.date), isComplete: row["done"]?.doubleValue == 1))
        }
        return result
    }
}
