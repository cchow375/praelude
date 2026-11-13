import XCTest
@testable import PraeludeCore

@MainActor final class ScorePersistenceEfficiencyTests: XCTestCase {
    func testRepeatedPageNotificationsDoNotRewriteLedgerOrAdvanceClock() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        var writes = 0
        let store = PracticeStore(directory: directory, writeData: { data, url in
            writes += 1; try data.write(to: url, options: .atomic)
        })
        let piece = Piece(title: "Navigation", pageCount: 4)
        try store.addPiece(piece)
        try store.updateLastPage(pieceID: piece.id, page: 2)
        let saved = store.state
        let bytes = try Data(contentsOf: store.fileURL)
        let originalWrites = writes
        for _ in 0..<100 { try store.updateLastPage(pieceID: piece.id, page: 2) }
        XCTAssertEqual(writes, originalWrites)
        XCTAssertEqual(store.state, saved)
        XCTAssertEqual(try Data(contentsOf: store.fileURL), bytes)
        try store.updateLastPage(pieceID: piece.id, page: 3)
        XCTAssertEqual(writes, originalWrites + 1)
        XCTAssertEqual(PracticeStore(directory: directory).pieces.first?.lastPage, 3)
    }
}
