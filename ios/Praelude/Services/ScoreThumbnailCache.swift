import PDFKit
import UIKit

/// §7 library covers: an automatic cover (a piece's first source page, rendered) or a custom one
/// (`Piece.customCoverRef`), cached in memory so scrolling a grid of dozens of pieces never repeats
/// a PDF-page render or an image-file read it already did. Purely an in-memory, per-launch cache —
/// nothing here is persisted data, so there is nothing to migrate or lose.
@MainActor final class ScoreThumbnailCache {
    static let shared = ScoreThumbnailCache()
    private let cache = NSCache<NSString, UIImage>()
    private init() { cache.countLimit = 300 }

    /// Includes `updatedAt` and the cover/PDF filenames in the key so a changed custom cover, a
    /// replaced score PDF, or a piece that had no cover before all invalidate on their own — no
    /// separate explicit-invalidation path to keep in sync with every place a piece can change.
    private func key(_ piece: Piece, size: CGSize) -> NSString {
        "\(piece.id.uuidString)_\(Int(size.width))x\(Int(size.height))_\(piece.updatedAt.timeIntervalSince1970)_\(piece.customCoverRef ?? "")_\(piece.pdfFileName ?? "")" as NSString
    }

    /// Synchronous cache read only — for a view to show instantly while `load` (below) fills the
    /// cache in the background on a miss.
    func cached(for piece: Piece, size: CGSize) -> UIImage? { cache.object(forKey: key(piece, size: size)) }

    /// Renders (or reads) this piece's cover at `size` points and caches it. Custom cover wins over
    /// the automatic first-page render, matching what `PieceDetailsView`'s cover picker documents.
    /// Runs the actual file/PDF work off the main actor — `PDFPage.thumbnail(of:for:)` and
    /// `UIImage(contentsOfFile:)` are synchronous CPU/IO work with no UIKit main-thread affinity.
    func load(for piece: Piece, store: PracticeStore, size: CGSize) async -> UIImage? {
        let cacheKey = key(piece, size: size)
        if let hit = cache.object(forKey: cacheKey) { return hit }
        let files = NativeLibraryFiles(store: store)
        let coverPath = files.coverURL(for: piece)?.path
        let scorePath = files.scoreURL(for: piece)?.path
        let scale = UIScreen.main.scale
        let rendered = await Task.detached(priority: .userInitiated) { () -> UIImage? in
            if let coverPath, let image = UIImage(contentsOfFile: coverPath) { return image }
            guard let scorePath, let document = PDFDocument(url: URL(fileURLWithPath: scorePath)),
                  let page = document.page(at: 0) else { return nil }
            let box = page.bounds(for: .cropBox)
            guard box.width > 0, box.height > 0 else { return nil }
            let target = CGSize(width: size.width * scale, height: size.height * scale)
            return page.thumbnail(of: target, for: .cropBox)
        }.value
        if let rendered { cache.setObject(rendered, forKey: cacheKey) }
        return rendered
    }
}
