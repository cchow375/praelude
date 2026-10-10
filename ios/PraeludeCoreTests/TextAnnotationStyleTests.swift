import Foundation
import XCTest
@testable import PraeludeCore

final class TextAnnotationStyleTests: XCTestCase {
    private let region = NormalizedRect(x: 0.15, y: 0.2, width: 0.45, height: 0.25)
    private let styled = TextAnnotationStyle(fontSize: 32, fontFamily: .serif, isBold: true,
                                             isItalic: true, textColor: .purple, alignment: .center)

    private func annotation(pieceID: UUID = UUID(), style: TextAnnotationStyle = .init()) -> TextBoxAnnotation {
        TextBoxAnnotation(pieceID: pieceID, page: 2, region: region, text: "Keep the melody singing.",
                          layer: .teacher, style: style,
                          createdAt: Date(timeIntervalSince1970: 1_800_000_000),
                          updatedAt: Date(timeIntervalSince1970: 1_800_000_100))
    }

    @MainActor private func makeStore() throws -> (PracticeStore, Piece) {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("praelude-note-style-\(UUID())")
        addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
        let store = PracticeStore(directory: directory)
        let piece = Piece(title: "Sonata", pageCount: 4)
        try store.addPiece(piece)
        return (store, piece)
    }

    func testLegacyAnnotationDecodesReadableDefaultsAndPreservesEveryExistingField() throws {
        let original = annotation()
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(original)) as? [String: Any])
        object.removeValue(forKey: "style")
        let data = try JSONSerialization.data(withJSONObject: object)
        let read = try JSONDecoder().decode(TextBoxAnnotation.self, from: data)
        XCTAssertEqual(read, original)
        XCTAssertEqual(read.style.fontSize, 20)
        XCTAssertEqual(read.style.textColor, .black)
        XCTAssertEqual(read.style.alignment, .leading)
    }

    func testPartialAndUnknownStyleOptionsHaveSafeDisplayDefaults() throws {
        let data = Data(#"{"fontSize":28,"fontFamily":"futureFont","textColor":"futureColor","alignment":"futureAlignment","isBold":true}"#.utf8)
        let value = try JSONDecoder().decode(TextAnnotationStyle.self, from: data)
        XCTAssertEqual(value, TextAnnotationStyle(fontSize: 28, isBold: true))
        XCTAssertEqual(try JSONDecoder().decode(TextAnnotationStyle.self, from: Data("{}".utf8)), .init())
    }

    @MainActor func testStyleAndResizedGeometrySurviveSaveReloadBackupAndRestore() throws {
        let (store, piece) = try makeStore()
        var note = annotation(pieceID: piece.id, style: styled)
        note.region = NormalizedRect(x: 0.05, y: 0.12, width: 0.65, height: 0.5)
        try store.saveTextAnnotation(note)
        let saved = try XCTUnwrap(store.state.textAnnotations.first)
        XCTAssertEqual(saved.style, styled)
        XCTAssertEqual(saved.region, note.region)
        XCTAssertEqual(saved.id, note.id)
        XCTAssertEqual(saved.createdAt, note.createdAt)
        XCTAssertEqual(PracticeStore(directory: store.directory).state.textAnnotations, [saved])
        let backup = try PracticeStore.decodeBackup(store.backupData())
        XCTAssertEqual(backup.textAnnotations, [saved])
        let (restored, _) = try makeStore()
        try restored.restoreBackup(backup)
        XCTAssertEqual(restored.state.textAnnotations, [saved])
    }

    @MainActor func testOpeningLegacySchema5DoesNotRewriteItsBytesOrRevision() throws {
        let (store, piece) = try makeStore()
        try store.saveTextAnnotation(annotation(pieceID: piece.id))
        var library = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: store.fileURL)) as? [String: Any])
        var notes = try XCTUnwrap(library["textAnnotations"] as? [[String: Any]])
        notes[0].removeValue(forKey: "style"); library["textAnnotations"] = notes
        let legacyBytes = try JSONSerialization.data(withJSONObject: library, options: [.sortedKeys])
        try legacyBytes.write(to: store.fileURL, options: .atomic)
        let reopened = PracticeStore(directory: store.directory)
        XCTAssertFalse(reopened.isReadOnly)
        XCTAssertEqual(reopened.state.revision, store.state.revision)
        XCTAssertEqual(reopened.state.textAnnotations, store.state.textAnnotations)
        XCTAssertEqual(try Data(contentsOf: store.fileURL), legacyBytes,
                       "Display defaults must not trigger a schema migration or eagerly rewrite legacy notes")
    }

    @MainActor func testInvalidFontSizeFailsAtomicallyWithoutChangingSavedNote() throws {
        let (store, piece) = try makeStore()
        var note = annotation(pieceID: piece.id, style: styled)
        try store.saveTextAnnotation(note)
        let saved = store.state
        let bytes = try Data(contentsOf: store.fileURL)
        for size in [11.0, 49.0, Double.infinity, -Double.infinity, Double.nan] {
            note.style.fontSize = size
            XCTAssertThrowsError(try store.saveTextAnnotation(note))
            XCTAssertEqual(store.state, saved)
            XCTAssertEqual(try Data(contentsOf: store.fileURL), bytes)
        }
        for size in [12.0, 20.0, 48.0] {
            note.style.fontSize = size
            XCTAssertNoThrow(try store.saveTextAnnotation(note))
        }
    }

    func testTextStyleUsesOnlyExistingSQLColumnsAndNestedRegionJSON() throws {
        let note = annotation(style: styled)
        let row = AnnotationSyncRow(note)
        let data = try SyncCoding.encoder.encode(row)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(Set(object.keys), ["id", "piece_id", "page", "region", "layer", "kind", "text", "created_at", "updated_at"])
        let wireRegion = try XCTUnwrap(object["region"] as? [String: Any])
        XCTAssertEqual(Set(wireRegion.keys), ["x", "y", "width", "height", "textStyle"])
        let legacyRect = try JSONDecoder().decode(NormalizedRect.self, from: JSONSerialization.data(withJSONObject: wireRegion))
        XCTAssertEqual(legacyRect, note.region, "Older clients must still understand the original region geometry")
        let decoded = try SyncCoding.decoder.decode(AnnotationSyncRow.self, from: data)
        XCTAssertEqual(decoded.textValue, note)
        XCTAssertNil(decoded.stampValue)
    }

    func testLegacySyncRegionDefaultsStyleAndStampWireShapeIsUnchanged() throws {
        let note = annotation()
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: SyncCoding.encoder.encode(AnnotationSyncRow(note))) as? [String: Any])
        var wireRegion = try XCTUnwrap(object["region"] as? [String: Any])
        wireRegion.removeValue(forKey: "textStyle"); object["region"] = wireRegion
        let legacyData = try JSONSerialization.data(withJSONObject: object)
        XCTAssertEqual(try SyncCoding.decoder.decode(AnnotationSyncRow.self, from: legacyData).textValue, note)

        let stamp = StampAnnotation(pieceID: note.pieceID, page: note.page, position: region, kind: .dynamic, label: "pp",
                                    createdAt: note.createdAt, updatedAt: note.updatedAt)
        let stampData = try SyncCoding.encoder.encode(AnnotationSyncRow(stamp))
        let stampObject = try XCTUnwrap(JSONSerialization.jsonObject(with: stampData) as? [String: Any])
        let stampRegion = try XCTUnwrap(stampObject["region"] as? [String: Any])
        XCTAssertEqual(Set(stampRegion.keys), ["x", "y", "width", "height"])
        XCTAssertEqual(try SyncCoding.decoder.decode(AnnotationSyncRow.self, from: stampData).stampValue, stamp)
    }

    @MainActor func testSyncedStylePreservesRemoteClockAndDeletionMetadata() throws {
        let (store, piece) = try makeStore()
        var note = annotation(pieceID: piece.id, style: styled)
        note.deletedAt = Date(timeIntervalSince1970: 1_800_000_200)
        note.updatedAt = note.deletedAt!
        let row = try SyncCoding.decoder.decode(AnnotationSyncRow.self, from: SyncCoding.encoder.encode(AnnotationSyncRow(note)))
        try store.applySyncedTextAnnotation(XCTUnwrap(row.textValue))
        XCTAssertEqual(store.state.textAnnotations, [note])
        XCTAssertEqual(PracticeStore(directory: store.directory).state.textAnnotations, [note])
    }
}
