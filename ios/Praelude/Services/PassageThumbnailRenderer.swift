import PDFKit
import UIKit

/// Serial PDF work off the main actor. A page is rendered once for all its passage previews;
/// bounded caches keep large books from retaining every page. Never reopen a PDF on every row.
actor PassageThumbnailRenderer {
    static let shared = PassageThumbnailRenderer()
    private let pages = NSCache<NSString, UIImage>()
    private let passages = NSCache<NSString, UIImage>()
    private var documents: [String: PDFDocument] = [:]
    init() {
        pages.countLimit = 24; pages.totalCostLimit = 48 * 1024 * 1024
        passages.countLimit = 300; passages.totalCostLimit = 32 * 1024 * 1024
    }

    private func byteCost(_ image: UIImage) -> Int {
        if let pixels = image.cgImage { return pixels.bytesPerRow * pixels.height }
        return Int(image.size.width * image.scale * image.size.height * image.scale * 4)
    }

    nonisolated static func identity(url: URL, passage: Passage) -> String {
        "\(url.path)_\(passage.id)_\(passage.page)_\(passage.regions)_\(passage.color ?? "")"
    }
    /// Shared by page-tools/link previews. Sizes are pixels, with a strict long-edge bound.
    func renderPage(url: URL, number: Int, size: CGSize) -> UIImage? {
        guard !Task.isCancelled, number > 0, size.width.isFinite, size.height.isFinite, size.width > 0, size.height > 0 else { return nil }
        let target = CGSize(width: min(1200, size.width), height: min(1200, size.height))
        let key = "\(url.path)_\(number)_\(Int(target.width))x\(Int(target.height))" as NSString
        if let cached = pages.object(forKey: key) { return cached }
        guard let page = document(url: url)?.page(at: number - 1) else { return nil }
        let bounds = page.bounds(for: .cropBox)
        guard bounds.width.isFinite, bounds.height.isFinite, bounds.width > 0, bounds.height > 0 else { return nil }
        let image = page.thumbnail(of: target, for: .cropBox)
        pages.setObject(image, forKey: key, cost: byteCost(image))
        return image
    }

    private func document(url: URL) -> PDFDocument? {
        if documents[url.path] == nil {
            if documents.count >= 3 { documents.removeAll() }
            documents[url.path] = PDFDocument(url: url)
        }
        return documents[url.path]
    }

    func render(url: URL, passage: Passage) -> UIImage? {
        guard !Task.isCancelled else { return nil }
        let cacheKey = Self.identity(url: url, passage: passage) as NSString
        if let cached = passages.object(forKey: cacheKey) { return cached }
        // The first selected box is the card cover. A union of unrelated boxes makes every
        // system tiny and removes the very visual cue the pianist needs to recognize a passage.
        let first = passage.regions.first
        let number = first?.page ?? passage.page
        guard number > 0, let page = document(url: url)?.page(at: number - 1), let source = page.pageRef else { return nil }
        let bounds = page.bounds(for: .cropBox)
        guard bounds.width.isFinite, bounds.height.isFinite, bounds.width > 0, bounds.height > 0 else { return nil }
        let rotation = ((page.rotation % 360) + 360) % 360
        let swaps = rotation == 90 || rotation == 270
        let displaySize = swaps ? CGSize(width: bounds.height, height: bounds.width) : bounds.size
        let normalized = first.map {
            CGRect(x: $0.x, y: $0.y, width: $0.width, height: $0.height)
                .normalizedRotatedForDisplay(pageRotationDegrees: page.rotation)
        } ?? CGRect(x: 0, y: 0, width: 1, height: 1)
        let target = CGRect(x: normalized.minX * displaySize.width, y: normalized.minY * displaySize.height,
                            width: normalized.width * displaySize.width, height: normalized.height * displaySize.height)
        let crop = target.intersection(CGRect(origin: .zero, size: displaySize))
        guard crop.width.isFinite, crop.height.isFinite, crop.width > 0, crop.height > 0 else { return nil }
        let scale = 1200 / max(crop.width, crop.height)
        guard scale.isFinite, scale > 0 else { return nil }
        let outputSize = CGSize(width: max(1, crop.width * scale), height: max(1, crop.height * scale))
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        // Render only the selected PDF crop at useful reading resolution. Cropping a tiny box
        // from a full-page thumbnail leaves too few pixels and makes pinch zoom unreadable.
        let rendered = UIGraphicsImageRenderer(size: outputSize, format: format).image { context in
            UIColor.white.setFill(); context.fill(CGRect(origin: .zero, size: outputSize))
            let cg = context.cgContext
            cg.translateBy(x: 0, y: outputSize.height); cg.scaleBy(x: scale, y: -scale)
            cg.translateBy(x: -crop.minX, y: -(displaySize.height - crop.maxY))
            cg.concatenate(source.getDrawingTransform(.cropBox, rect: CGRect(origin: .zero, size: displaySize), rotate: 0, preserveAspectRatio: true))
            cg.drawPDFPage(source)
        }
        passages.setObject(rendered, forKey: cacheKey, cost: byteCost(rendered))
        return rendered
    }
}
