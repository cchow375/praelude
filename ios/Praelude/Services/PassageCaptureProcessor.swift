import Foundation
import ImageIO
import PDFKit
import UIKit

/// All decoding, orientation normalization, cropping and PDF work stays off the UI actor.
/// Only the cropped passage is kept; the original camera/library image is never written.
actor PassageCaptureProcessor {
    static let shared = PassageCaptureProcessor()
    static let maximumDimension: CGFloat = 2800
    static let maximumInputBytes = 40 * 1024 * 1024

    func decode(_ data: Data) throws -> UIImage {
        guard !data.isEmpty, data.count <= Self.maximumInputBytes,
              let source = CGImageSourceCreateWithData(data as CFData, nil),
              let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceThumbnailMaxPixelSize: Int(Self.maximumDimension),
                kCGImageSourceShouldCacheImmediately: true
              ] as CFDictionary) else {
            throw PracticeError.invalid("Choose a readable photo smaller than 40 MB.")
        }
        try Task.checkCancellation()
        return UIImage(cgImage: image, scale: 1, orientation: .up)
    }

    func normalize(_ image: UIImage, clockwise: Bool = false) throws -> UIImage {
        try Task.checkCancellation()
        guard image.size.width.isFinite, image.size.height.isFinite,
              image.size.width > 1, image.size.height > 1 else {
            throw PracticeError.invalid("This photo could not be opened. Take or choose another photo.")
        }
        let scale = min(1, Self.maximumDimension / max(image.size.width, image.size.height))
        let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1; format.opaque = true
        let upright = UIGraphicsImageRenderer(size: size, format: format).image { _ in
            UIColor.white.setFill(); UIRectFill(CGRect(origin: .zero, size: size))
            image.draw(in: CGRect(origin: .zero, size: size))
        }
        guard clockwise else { return upright }
        let rotatedSize = CGSize(width: size.height, height: size.width)
        return UIGraphicsImageRenderer(size: rotatedSize, format: format).image { context in
            context.cgContext.translateBy(x: rotatedSize.width, y: 0)
            context.cgContext.rotate(by: .pi / 2)
            upright.draw(in: CGRect(origin: .zero, size: size))
        }
    }

    func cropped(_ image: UIImage, rect: CGRect, enhance: Bool) throws -> UIImage {
        try Task.checkCancellation()
        guard let bitmap = image.cgImage, image.imageOrientation == .up,
              let crop = Self.pixelCrop(rect, width: bitmap.width, height: bitmap.height),
              let pixels = bitmap.cropping(to: crop) else {
            throw PracticeError.invalid("The crop is too small. Include the notes you want to practice.")
        }
        let result = UIImage(cgImage: pixels, scale: 1, orientation: .up)
        return enhance ? ScoreScanImport.cleaned(result) : result
    }

    func preparePDF(image: UIImage, rect: CGRect, enhance: Bool) throws -> Data {
        let cropped = try cropped(image, rect: rect, enhance: enhance)
        try Task.checkCancellation()
        let renderer = UIGraphicsPDFRenderer(bounds: CGRect(origin: .zero, size: cropped.size))
        let data = renderer.pdfData { context in
            context.beginPage()
            cropped.draw(in: CGRect(origin: .zero, size: cropped.size))
        }
        guard !data.isEmpty, data.count <= 20 * 1024 * 1024,
              PDFDocument(data: data)?.pageCount == 1 else {
            throw PracticeError.invalid("This photo could not be prepared. Try a closer, smaller crop.")
        }
        return data
    }

    /// Rejects malformed coordinates before floating-point to integer conversion or allocation.
    nonisolated static func pixelCrop(_ rect: CGRect, width: Int, height: Int) -> CGRect? {
        guard width > 1, height > 1,
              [rect.origin.x, rect.origin.y, rect.width, rect.height].allSatisfy(\.isFinite),
              rect.width > 0, rect.height > 0 else { return nil }
        let clipped = rect.intersection(CGRect(x: 0, y: 0, width: 1, height: 1))
        guard !clipped.isNull, clipped.width > 0, clipped.height > 0 else { return nil }
        let pixels = CGRect(x: clipped.minX * CGFloat(width), y: clipped.minY * CGFloat(height),
                            width: clipped.width * CGFloat(width), height: clipped.height * CGFloat(height))
            .integral.intersection(CGRect(x: 0, y: 0, width: width, height: height))
        return pixels.width >= 24 && pixels.height >= 24 ? pixels : nil
    }

    /// Staging is serialized with processing. A unique filename is never replaced or reused.
    func stage(_ data: Data, directory: URL, fileName: String) throws -> URL {
        try Task.checkCancellation()
        let destination = directory.appendingPathComponent("Scores", isDirectory: true)
        try FileManager.default.createDirectory(at: destination, withIntermediateDirectories: true)
        let url = destination.appendingPathComponent(fileName)
        guard !FileManager.default.fileExists(atPath: url.path) else {
            throw PracticeError.conflict("This photo is already saved.")
        }
        try data.write(to: url, options: [.atomic, .completeFileProtectionUnlessOpen])
        return url
    }

    func removeStaged(_ url: URL) { try? FileManager.default.removeItem(at: url) }
}
