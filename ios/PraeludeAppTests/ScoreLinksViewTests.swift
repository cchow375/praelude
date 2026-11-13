import PDFKit
import UIKit
import XCTest
@testable import Praelude

/// Major regression (verifier "reader lens", 2026-09-29): the link editor measured a drawn tap
/// region against its whole preview frame instead of the page thumbnail actually shown inside it —
/// `PageThumbnail` renders with `.scaledToFit()`, which letterboxes (centers, does not stretch)
/// whenever the page's own aspect ratio does not match the container's. `PageThumbnail.fitFrame`
/// is the fix: the single source of truth for where the page actually sits, that both the drag
/// gesture and the region overlay in `ScoreLinksView.swift` now measure against.
final class ScoreLinksViewTests: XCTestCase {
    @MainActor private func fixture(width: CGFloat, height: CGFloat) throws -> (PracticeStore, UUID) {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("Praelude-LinksTests-\(UUID())")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: root) }
        let store = PracticeStore(directory: root.appendingPathComponent("Library"))
        let data = UIGraphicsPDFRenderer(bounds: CGRect(x: 0, y: 0, width: width, height: height)).pdfData { renderer in
            renderer.beginPage()
        }
        let source = root.appendingPathComponent("source.pdf")
        XCTAssertTrue(try XCTUnwrap(PDFDocument(data: data)).write(to: source))
        let id = try NativeLibraryFiles(store: store).importPDF(source, title: "Links test", composer: "Test")
        return (store, id)
    }

    @MainActor func testFitFrameLetterboxesAWiderThanTallPageWithinATallerContainer() throws {
        // A landscape page (1000x400) inside a portrait container (400x600): the image must be
        // letterboxed top/bottom, centered, at the container's own width — matching what
        // `.scaledToFit()` actually renders.
        let (store, id) = try fixture(width: 1000, height: 400)
        let fit = try XCTUnwrap(PageThumbnail.fitFrame(pieceID: id, page: 1, store: store, in: CGSize(width: 400, height: 600)))
        XCTAssertEqual(fit.width, 400, accuracy: 0.01)
        XCTAssertEqual(fit.height, 160, accuracy: 0.01) // 400 * (400/1000)
        XCTAssertEqual(fit.minX, 0, accuracy: 0.01)
        XCTAssertEqual(fit.minY, 220, accuracy: 0.01) // (600 - 160) / 2
    }

    @MainActor func testFitFrameLetterboxesATallerThanWidePageWithinAWiderContainer() throws {
        let (store, id) = try fixture(width: 400, height: 1000)
        let fit = try XCTUnwrap(PageThumbnail.fitFrame(pieceID: id, page: 1, store: store, in: CGSize(width: 600, height: 400)))
        XCTAssertEqual(fit.height, 400, accuracy: 0.01)
        XCTAssertEqual(fit.width, 160, accuracy: 0.01)
        XCTAssertEqual(fit.minY, 0, accuracy: 0.01)
        XCTAssertEqual(fit.minX, 220, accuracy: 0.01)
    }

    @MainActor func testFitFrameFillsAnExactlyMatchingAspectRatioWithNoLetterboxing() throws {
        let (store, id) = try fixture(width: 600, height: 800)
        let fit = try XCTUnwrap(PageThumbnail.fitFrame(pieceID: id, page: 1, store: store, in: CGSize(width: 300, height: 400)))
        XCTAssertEqual(fit, CGRect(x: 0, y: 0, width: 300, height: 400))
    }

    @MainActor func testFitFrameReturnsNilForAnOutOfRangePageOrMissingPiece() throws {
        let (store, id) = try fixture(width: 600, height: 800)
        XCTAssertNil(PageThumbnail.fitFrame(pieceID: id, page: 99, store: store, in: CGSize(width: 300, height: 400)))
        XCTAssertNil(PageThumbnail.fitFrame(pieceID: UUID(), page: 1, store: store, in: CGSize(width: 300, height: 400)))
    }
    @MainActor func testBackgroundPreviewsBoundPixelsAndReusePageRaster() async throws {
        let (store, id) = try fixture(width: 600, height: 800)
        let piece = try XCTUnwrap(store.pieces.first { $0.id == id })
        let url = try XCTUnwrap(NativeLibraryFiles(store: store).scoreURL(for: piece))
        let renderer = PassageThumbnailRenderer()
        let first = await renderer.renderPage(url: url, number: 1, size: CGSize(width: 6000, height: 8000))
        let loaded = try XCTUnwrap(first)
        let bitmap = try XCTUnwrap(loaded.cgImage)
        XCTAssertLessThanOrEqual(max(bitmap.width, bitmap.height), 1200)
        let second = await renderer.renderPage(url: url, number: 1, size: CGSize(width: 6000, height: 8000))
        XCTAssertTrue(loaded === second)
        let missing = await renderer.renderPage(url: url, number: 2, size: CGSize(width: 100, height: 100))
        XCTAssertNil(missing)
        let invalid = await renderer.renderPage(url: url, number: 0, size: CGSize(width: 100, height: 100))
        XCTAssertNil(invalid)
    }

    @MainActor func testCustomCoverIsDownsampledBeforeEnteringGridCache() async throws {
        let (store, id) = try fixture(width: 600, height: 800)
        let piece = try XCTUnwrap(store.pieces.first { $0.id == id })
        let format = UIGraphicsImageRendererFormat(); format.scale = 1
        let large = UIGraphicsImageRenderer(size: CGSize(width: 3000, height: 2000), format: format).image { context in
            UIColor.red.setFill(); context.fill(CGRect(x: 0, y: 0, width: 3000, height: 2000))
        }
        let updated = try NativeLibraryFiles(store: store).saveCustomCover(XCTUnwrap(large.jpegData(compressionQuality: 0.8)), for: piece)
        let size = CGSize(width: 46, height: 56)
        let rendered = await ScoreThumbnailCache.shared.load(for: updated, store: store, size: size)
        let bitmap = try XCTUnwrap(rendered?.cgImage)
        XCTAssertLessThanOrEqual(max(bitmap.width, bitmap.height), Int(ceil(56 * UIScreen.main.scale)))
        XCTAssertGreaterThan(bitmap.width, 0)
        XCTAssertNotNil(ScoreThumbnailCache.shared.cached(for: updated, size: size))
    }

    @MainActor func testLiveFitGeometryRejectsInvalidImageAndContainerSizes() {
        XCTAssertNil(PageThumbnail.fitFrame(imageSize: .zero, in: CGSize(width: 100, height: 100)))
        XCTAssertNil(PageThumbnail.fitFrame(imageSize: CGSize(width: 100, height: 100), in: .zero))
        XCTAssertEqual(PageThumbnail.fitFrame(imageSize: CGSize(width: 1000, height: 400), in: CGSize(width: 400, height: 600)),
                       CGRect(x: 0, y: 220, width: 400, height: 160))
    }

    @MainActor private func waitForCoverWaiters(_ count: Int, cache: ScoreThumbnailCache) async {
        for _ in 0..<200 {
            if cache.pendingWaiterCount == count { return }
            await Task.yield()
        }
        XCTFail("The controlled cover request did not register its expected waiters")
    }

    @MainActor func testCancelingOneCoverViewerKeepsTheSharedVisibleRequestAlive() async throws {
        let (store, id) = try fixture(width: 600, height: 800)
        let piece = try XCTUnwrap(store.pieces.first { $0.id == id })
        let probe = CoverLoadTestProbe()
        let cache = ScoreThumbnailCache(render: { _, _, _ in await probe.load() })
        let size = CGSize(width: 46, height: 56)
        let first = Task { await cache.load(for: piece, store: store, size: size) }
        let second = Task { await cache.load(for: piece, store: store, size: size) }
        await waitForCoverWaiters(2, cache: cache)
        first.cancel()
        XCTAssertEqual(cache.pendingWaiterCount, 1)
        for _ in 0..<200 {
            if await probe.started == 1 { break }
            await Task.yield()
        }
        let image = UIGraphicsImageRenderer(size: CGSize(width: 20, height: 20)).image { context in
            UIColor.red.setFill(); context.fill(CGRect(x: 0, y: 0, width: 20, height: 20))
        }
        await probe.releaseNext(image)
        let canceled = await first.value
        let visible = await second.value
        XCTAssertNil(canceled)
        XCTAssertTrue(visible === image)
        let count = await probe.started
        XCTAssertEqual(count, 1, "Two visible viewers must share one decoder")
        XCTAssertEqual(cache.pendingWaiterCount, 0)
    }

    @MainActor func testCanceledCoverCompletionCannotRemoveItsSameKeyReplacement() async throws {
        let (store, id) = try fixture(width: 600, height: 800)
        let piece = try XCTUnwrap(store.pieces.first { $0.id == id })
        let probe = CoverLoadTestProbe()
        let cache = ScoreThumbnailCache(render: { _, _, _ in await probe.load() })
        let size = CGSize(width: 46, height: 56)
        let old = Task { await cache.load(for: piece, store: store, size: size) }
        await waitForCoverWaiters(1, cache: cache)
        for _ in 0..<200 {
            if await probe.started == 1 { break }
            await Task.yield()
        }
        old.cancel()
        XCTAssertEqual(cache.pendingWaiterCount, 0)
        let replacement = Task { await cache.load(for: piece, store: store, size: size) }
        await waitForCoverWaiters(1, cache: cache)
        for _ in 0..<200 {
            if await probe.started == 2 { break }
            await Task.yield()
        }
        let image = UIGraphicsImageRenderer(size: CGSize(width: 20, height: 20)).image { context in
            UIColor.blue.setFill(); context.fill(CGRect(x: 0, y: 0, width: 20, height: 20))
        }
        // A decoder may finish its current synchronous operation after cancellation. Its obsolete
        // completion must not detach the newly visible viewer with exactly the same cache key.
        await probe.releaseNext(image)
        let canceled = await old.value
        XCTAssertNil(canceled)
        XCTAssertEqual(cache.pendingWaiterCount, 1)
        XCTAssertNil(cache.cached(for: piece, size: size))
        await probe.releaseNext(image)
        let visible = await replacement.value
        XCTAssertTrue(visible === image)
        XCTAssertTrue(cache.cached(for: piece, size: size) === image)
        XCTAssertEqual(cache.pendingWaiterCount, 0)
    }

}


/// Holds decodes until the test releases them, including a decoder already finishing at cancel.
private actor CoverLoadTestProbe {
    private(set) var started = 0
    private var continuations: [CheckedContinuation<UIImage?, Never>] = []
    func load() async -> UIImage? {
        started += 1
        return await withCheckedContinuation { continuations.append($0) }
    }
    func releaseNext(_ image: UIImage) {
        guard !continuations.isEmpty else { return }
        continuations.removeFirst().resume(returning: image)
    }
}
