import XCTest
@testable import PraeludeCore

@MainActor final class NavigationTimingTests: XCTestCase {
    /// Opt-in private-data benchmark. Only aggregates leave the temporary copy; original bytes
    /// are never written. Measures persistence, not touch-to-frame or physical iPad latency.
    func testPrivateLibraryBookmarkWriteTiming() throws {
        guard let source = ProcessInfo.processInfo.environment["PRAELUDE_NAVIGATION_BENCHMARK_LIBRARY"] else {
            throw XCTSkip("Supply a private library copy to measure bookmark serialization/write cost")
        }
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let original = try Data(contentsOf: URL(fileURLWithPath: source))
        try original.write(to: directory.appendingPathComponent("library.json"))
        let store = PracticeStore(directory: directory)
        XCTAssertFalse(store.isReadOnly)
        let piece = try XCTUnwrap(store.realPieces.first { $0.pageCount >= 3 })
        var timings: [Double] = []
        for page in [2, 3, 2, 3, 2, 3, 2, 3, 2, 3] {
            let start = Date()
            try store.updateLastPage(pieceID: piece.id, page: page)
            timings.append(Date().timeIntervalSince(start) * 1000)
        }
        XCTAssertEqual(try Data(contentsOf: URL(fileURLWithPath: source)), original)
        print("NAVIGATION_BOOKMARK_MS samples=\(timings.count) libraryBytes=\(original.count) min=\(timings.min()!) mean=\(timings.reduce(0,+)/Double(timings.count)) max=\(timings.max()!)")
    }
}
