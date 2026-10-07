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
        let number = passage.regions.map(\.page).min() ?? passage.page
        guard number > 0, let page = document(url: url)?.page(at: number - 1),
              let image = renderPage(url: url, number: number, size: CGSize(width: 480, height: 640)) else { return nil }
        let boxes = passage.regions.filter { $0.page == number }.map { region -> CGRect in
            let rect = CGRect(x: region.x, y: region.y, width: region.width, height: region.height)
                .normalizedRotatedForDisplay(pageRotationDegrees: page.rotation)
            return CGRect(x: rect.minX * image.size.width, y: rect.minY * image.size.height,
                          width: rect.width * image.size.width, height: rect.height * image.size.height)
        }
        let bounds = CGRect(origin: .zero, size: image.size)
        let target = boxes.reduce(CGRect.null) { $0.union($1) }
        let crop = target.isNull ? bounds : target.insetBy(dx: -16, dy: -16).intersection(bounds)
        guard crop.width.isFinite, crop.height.isFinite, crop.width > 0, crop.height > 0 else { return nil }
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1 // The PDF thumbnail is already pixel-sized; avoid a second 2x/3x expansion.
        format.opaque = true
        let rendered = UIGraphicsImageRenderer(size: crop.size, format: format).image { context in
            context.cgContext.translateBy(x: -crop.minX, y: -crop.minY)
            image.draw(at: .zero)
            context.cgContext.setFillColor((passage.color.flatMap(AnnotationColor.init(rawValue:))?.uiColor ?? .black).withAlphaComponent(0.10).cgColor)
            for box in boxes { context.cgContext.fill(box) }
        }
        passages.setObject(rendered, forKey: cacheKey, cost: byteCost(rendered))
        return rendered
    }
}
