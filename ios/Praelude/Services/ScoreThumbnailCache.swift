import ImageIO
import PDFKit
import UIKit

/// Small decoded covers only; original photo dimensions must never determine grid memory use.
@MainActor final class ScoreThumbnailCache {
    static let shared = ScoreThumbnailCache()
    private let cache = NSCache<NSString, UIImage>()
    private var pending: [NSString: CoverThumbnailRequest] = [:]
    private let render: @Sendable (URL?, URL?, CGSize) async -> UIImage?
    private convenience init() {
        let worker = CoverThumbnailRenderer()
        self.init(render: { await worker.render(coverURL: $0, scoreURL: $1, size: $2) })
    }

    /// Injectable rendering keeps cancellation/coalescing regressions deterministic without files.
    init(render: @escaping @Sendable (URL?, URL?, CGSize) async -> UIImage?) {
        self.render = render
        cache.countLimit = 160
        cache.totalCostLimit = 24 * 1024 * 1024
    }

    private func key(_ piece: Piece, size: CGSize) -> NSString {
        "\(piece.id.uuidString)_\(Int(size.width))x\(Int(size.height))_\(piece.updatedAt.timeIntervalSince1970)_\(piece.customCoverRef ?? "")_\(piece.pdfFileName ?? "")" as NSString
    }

    func cached(for piece: Piece, size: CGSize) -> UIImage? { cache.object(forKey: key(piece, size: size)) }

    func load(for piece: Piece, store: PracticeStore, size: CGSize) async -> UIImage? {
        guard !Task.isCancelled, size.width.isFinite, size.height.isFinite, size.width > 0, size.height > 0 else { return nil }
        let cacheKey = key(piece, size: size)
        if let hit = cache.object(forKey: cacheKey) { return hit }
        let waiterID = UUID()
        let request: CoverThumbnailRequest
        if let existing = pending[cacheKey], existing.addWaiter(waiterID) {
            request = existing
        } else {
            let files = NativeLibraryFiles(store: store)
            let coverURL = files.coverURL(for: piece)
            let scoreURL = files.scoreURL(for: piece)
            let pixels = CGSize(width: min(1024, size.width * UIScreen.main.scale),
                                height: min(1024, size.height * UIScreen.main.scale))
            let render = render
            let work = Task { await render(coverURL, scoreURL, pixels) }
            request = CoverThumbnailRequest(task: work, waiterID: waiterID)
            pending[cacheKey] = request
        }
        let rendered = await withTaskCancellationHandler(operation: {
            await request.task.value
        }, onCancel: {
            // This callback can run on any executor. Release immediately, so queued offscreen
            // covers are canceled before the serial decoder gets to them.
            request.removeWaiter(waiterID)
        })
        request.removeWaiter(waiterID)
        // An old canceled request can complete after a new caller replaced its entry. It must
        // never remove that replacement or overwrite its result.
        if pending[cacheKey] === request {
            if !Task.isCancelled, let rendered, let bitmap = rendered.cgImage {
                cache.setObject(rendered, forKey: cacheKey, cost: bitmap.bytesPerRow * bitmap.height)
            }
            if request.waiterCount == 0 { pending[cacheKey] = nil }
        }
        return Task.isCancelled ? nil : rendered
    }
    /// Internal diagnostics used by concurrency regressions; no observation or persisted state.
    var pendingWaiterCount: Int { pending.values.reduce(0) { $0 + $1.waiterCount } }
}

/// Cancellation handlers are synchronous and executor-independent. A small lock protects only
/// waiter bookkeeping; no decoding or await happens while held.
private final class CoverThumbnailRequest: @unchecked Sendable {
    let task: Task<UIImage?, Never>
    private let lock = NSLock()
    private var waiters: Set<UUID>
    private var acceptsWaiters = true

    init(task: Task<UIImage?, Never>, waiterID: UUID) {
        self.task = task; waiters = [waiterID]
    }
    var waiterCount: Int {
        lock.lock(); defer { lock.unlock() }
        return waiters.count
    }
    func addWaiter(_ id: UUID) -> Bool {
        lock.lock(); defer { lock.unlock() }
        guard acceptsWaiters else { return false }
        waiters.insert(id)
        return true
    }
    func removeWaiter(_ id: UUID) {
        lock.lock()
        let removed = waiters.remove(id) != nil
        let cancel = removed && waiters.isEmpty
        if cancel { acceptsWaiters = false }
        lock.unlock()
        if cancel { task.cancel() }
    }
}

/// One serial executor prevents a fast grid scroll from spawning dozens of PDF/image decoders.
private actor CoverThumbnailRenderer {
    func render(coverURL: URL?, scoreURL: URL?, size: CGSize) -> UIImage? {
        guard !Task.isCancelled else { return nil }
        return autoreleasepool {
            if let coverURL,
               let source = CGImageSourceCreateWithURL(coverURL as CFURL, nil),
               let bitmap = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceThumbnailMaxPixelSize: max(size.width, size.height),
                kCGImageSourceShouldCacheImmediately: true
               ] as CFDictionary) {
                return UIImage(cgImage: bitmap)
            }
            guard let scoreURL, let document = PDFDocument(url: scoreURL), let page = document.page(at: 0) else { return nil }
            let bounds = page.bounds(for: .cropBox)
            guard bounds.width.isFinite, bounds.height.isFinite, bounds.width > 0, bounds.height > 0 else { return nil }
            return page.thumbnail(of: size, for: .cropBox)
        }
    }
}
