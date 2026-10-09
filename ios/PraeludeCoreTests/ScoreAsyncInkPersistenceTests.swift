import Foundation
import XCTest
@testable import PraeludeCore

@MainActor final class ScoreAsyncInkPersistenceTests: XCTestCase {
    @MainActor private final class Fixture {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("praelude-async-ink-\(UUID())")
        let piece = Piece(title: "Async ink", pdfFileName: "fixture.pdf", pageCount: 3)
        var store: PracticeStore!
        var writes = 0
        var failWrites = false
        var afterSnapshot: (() -> Void)?

        init() throws {
            store = PracticeStore(directory: directory, now: { [weak self] in
                // replaceInkPreparedAsync reads its clock immediately after capturing the state.
                // This one-shot hook deterministically interleaves a second operation after that
                // snapshot, without racing a Task.yield or adding a production-only test hook.
                let action = self?.afterSnapshot
                self?.afterSnapshot = nil
                action?()
                return Date(timeIntervalSince1970: 1_700_000_000)
            }, writeData: { [weak self] data, url in
                guard let self else { return }
                writes += 1
                if failWrites { throw PracticeError.unavailable("Synthetic disk full") }
                try data.write(to: url, options: .atomic)
            })
            try store.addPiece(piece)
        }

        func removeFiles() { try? FileManager.default.removeItem(at: directory) }
        func input(_ value: UInt8) -> PracticeStore.InkStrokeInput {
            PracticeStore.InkStrokeInput(data: Data([value]), fingerprint: Data([value, 255]))
        }
        func assertFileMatchesState(file: StaticString = #filePath, line: UInt = #line) throws {
            let saved = try PracticeStore.decodeBackup(Data(contentsOf: store.fileURL))
            XCTAssertEqual(saved, store.state, file: file, line: line)
            XCTAssertNoThrow(try PracticeStore.validate(saved), file: file, line: line)
        }
    }

    func testPreparedInkPublishesDurableStateAndRepeatedContentDoesNotWrite() async throws {
        let fixture = try Fixture(); defer { fixture.removeFiles() }
        let store = fixture.store!
        let initialRevision = store.state.revision
        let receipt = try await store.replaceInkPreparedAsync(pieceID: fixture.piece.id, page: 1, layer: .mine,
                                                              strokes: [fixture.input(1), fixture.input(2)], expectedRows: [])
        XCTAssertEqual(store.state.revision, initialRevision + 1)
        let rows = store.inkStrokes(pieceID: fixture.piece.id, page: 1, layer: .mine)
        XCTAssertEqual(receipt, rows)
        XCTAssertEqual(rows.map(\.data), [Data([1]), Data([2])])
        try fixture.assertFileMatchesState()
        let bytes = try Data(contentsOf: store.fileURL)
        let writeCount = fixture.writes
        try await store.replaceInkPreparedAsync(pieceID: fixture.piece.id, page: 1, layer: .mine,
                                                strokes: [fixture.input(1), fixture.input(2)], expectedRows: rows)
        XCTAssertEqual(fixture.writes, writeCount)
        XCTAssertEqual(store.inkStrokes(pieceID: fixture.piece.id, page: 1, layer: .mine), rows)
        XCTAssertEqual(try Data(contentsOf: store.fileURL), bytes)
    }

    func testPreparedInkRebasesOverVerdictNavigationPreferenceAndOtherPageInk() async throws {
        let fixture = try Fixture(); defer { fixture.removeFiles() }
        let store = fixture.store!
        try store.startSet(PracticeConfiguration(pieceID: fixture.piece.id))
        var mutationError: Error?
        fixture.afterSnapshot = {
            do {
                try store.record(.clean)
                try store.updateLastPage(pieceID: fixture.piece.id, page: 2)
                try store.setDefaultPracticeTempo(88, for: fixture.piece.id)
                try store.replaceInk(pieceID: fixture.piece.id, page: 2, layer: .mine, strokes: [fixture.input(9)])
            } catch { mutationError = error }
        }
        try await store.replaceInkPreparedAsync(pieceID: fixture.piece.id, page: 1, layer: .mine,
                                                strokes: [fixture.input(1)], expectedRows: [])
        XCTAssertNil(mutationError)
        XCTAssertEqual(store.activeSet?.attempts.count, 1, "The prepared snapshot must not erase a newer verdict")
        XCTAssertEqual(store.pieces.first?.lastPage, 2)
        XCTAssertEqual(store.pieces.first?.defaultPracticeBPM, 88)
        XCTAssertEqual(store.inkStrokes(pieceID: fixture.piece.id, page: 1).map(\.data), [Data([1])])
        XCTAssertEqual(store.inkStrokes(pieceID: fixture.piece.id, page: 2).map(\.data), [Data([9])])
        try fixture.assertFileMatchesState()
    }

    func testPreparedInkRejectsSamePageChangeAfterSnapshotWithoutOverwritingIt() async throws {
        let fixture = try Fixture(); defer { fixture.removeFiles() }
        let store = fixture.store!
        try store.replaceInk(pieceID: fixture.piece.id, page: 1, layer: .mine, strokes: [fixture.input(1)])
        let expected = store.inkStrokes(pieceID: fixture.piece.id, page: 1, layer: .mine)
        var latest: LibraryState?
        var latestBytes: Data?
        var mutationError: Error?
        fixture.afterSnapshot = {
            do {
                try store.replaceInk(pieceID: fixture.piece.id, page: 1, layer: .mine, strokes: [fixture.input(9)])
                latest = store.state
                latestBytes = try Data(contentsOf: store.fileURL)
            } catch { mutationError = error }
        }
        do {
            try await store.replaceInkPreparedAsync(pieceID: fixture.piece.id, page: 1, layer: .mine,
                                                    strokes: [fixture.input(1), fixture.input(2)], expectedRows: expected)
            XCTFail("A newer drawing on this page requires explicit conflict resolution")
        } catch let error as PracticeError {
            guard case .conflict = error else { return XCTFail("Expected conflict, got \(error)") }
        }
        XCTAssertNil(mutationError)
        XCTAssertEqual(store.state, latest)
        XCTAssertEqual(try Data(contentsOf: store.fileURL), latestBytes)
        XCTAssertEqual(store.inkStrokes(pieceID: fixture.piece.id, page: 1).map(\.data), [Data([9])])
    }

    func testCancelledPreparationNeverWritesOrPublishesItsSnapshot() async throws {
        let fixture = try Fixture(); defer { fixture.removeFiles() }
        let store = fixture.store!
        let before = store.state
        let bytes = try Data(contentsOf: store.fileURL)
        let writes = fixture.writes
        var operation: Task<Void, Error>?
        fixture.afterSnapshot = { operation?.cancel() }
        operation = Task { @MainActor in
            _ = try await store.replaceInkPreparedAsync(pieceID: fixture.piece.id, page: 1, layer: .mine,
                                                        strokes: [fixture.input(1)], expectedRows: [])
        }
        do {
            try await operation!.value
            XCTFail("Cancellation must not report a committed drawing")
        } catch is CancellationError { }
        XCTAssertEqual(fixture.writes, writes)
        XCTAssertEqual(store.state, before)
        XCTAssertEqual(try Data(contentsOf: store.fileURL), bytes)
    }

    func testPreparedInkWriteFailurePreservesPublishedStateAndOriginalFile() async throws {
        let fixture = try Fixture(); defer { fixture.removeFiles() }
        let store = fixture.store!
        let before = store.state
        let bytes = try Data(contentsOf: store.fileURL)
        fixture.failWrites = true
        do {
            try await store.replaceInkPreparedAsync(pieceID: fixture.piece.id, page: 1, layer: .mine,
                                                    strokes: [fixture.input(1)], expectedRows: [])
            XCTFail("An unsuccessful write cannot publish the prepared snapshot")
        } catch let error as PracticeError {
            guard case .unavailable = error else { return XCTFail("Expected storage failure, got \(error)") }
        }
        XCTAssertEqual(store.state, before)
        XCTAssertEqual(try Data(contentsOf: store.fileURL), bytes)
        XCTAssertEqual(store.errorMessage, "Synthetic disk full")
        fixture.failWrites = false
        try await store.replaceInkPreparedAsync(pieceID: fixture.piece.id, page: 1, layer: .mine,
                                                strokes: [fixture.input(1)], expectedRows: [])
        XCTAssertNil(store.errorMessage)
        try fixture.assertFileMatchesState()
    }

    func testPreparedInkValidatesNewRowsBeforeWriting() async throws {
        let fixture = try Fixture(); defer { fixture.removeFiles() }
        let store = fixture.store!
        let before = store.state
        let writes = fixture.writes
        do {
            try await store.replaceInkPreparedAsync(pieceID: fixture.piece.id, page: 1, layer: .mine,
                                                    strokes: [.init(data: Data([1]), fingerprint: Data(repeating: 1, count: 8193))], expectedRows: [])
            XCTFail("The trusted previous ledger must not skip validation of the new annotation")
        } catch let error as PracticeError {
            guard case .invalid = error else { return XCTFail("Expected invalid ink, got \(error)") }
        }
        XCTAssertEqual(fixture.writes, writes)
        XCTAssertEqual(store.state, before)
        try fixture.assertFileMatchesState()
    }
}
