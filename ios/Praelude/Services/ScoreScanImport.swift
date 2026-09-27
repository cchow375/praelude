import CoreImage
import CoreImage.CIFilterBuiltins
import Foundation
import PDFKit
import UIKit

/// §7 import: photo/camera multi-page scan → one cleaned PDF, alongside a plain Files/share-sheet
/// import (`NativeLibraryFiles.importPDF`) as another way a piece's original PDF gets created.
/// Camera pages arrive from VisionKit's `VNDocumentCameraViewController` already perspective-
/// corrected and cropped to the page; this additionally runs every page (camera or photo-library)
/// through Core Image's document-cleanup filter, then lays each image out as its own full PDF page
/// via `UIGraphicsPDFRenderer`. Nothing here touches PDFKit or an existing piece — there is no PDF
/// yet at this point, only the images that are about to become one (see `ScorePageComposer` for
/// the non-destructive-edit side, once a piece and its PDF already exist).
enum ScoreScanImport {
    /// Longest edge a page is rendered at, in points at the standard 72/inch PDF scale — generous
    /// enough to stay sharp when zoomed in on a phone-camera-resolution photo, without ballooning
    /// file size across a several-hundred-page scanned method book.
    private static let maxDimension: CGFloat = 2200

    /// Best-effort document cleanup (contrast/shadow correction tuned for a photographed page) via
    /// Core Image's built-in document-enhancer filter. Falls back to the untouched image on any
    /// failure to construct or run the filter — a page that cannot be enhanced still belongs in the
    /// PDF, just unenhanced, rather than dropped. Thread-safe: Core Image contexts do not touch
    /// UIKit's main-thread-only state, so this is safe to call from a background `Task`.
    static func cleaned(_ image: UIImage) -> UIImage {
        // `.applyOrientationProperty` bakes the UIImage's own orientation into the CIImage's
        // pixels up front, so the filtered result is always upright without a separate re-rotate
        // step, whichever way a camera or photo-library image happened to be shot.
        guard let input = CIImage(image: image, options: [.applyOrientationProperty: true]) else { return image }
        let filter = CIFilter.documentEnhancer()
        filter.inputImage = input
        let context = CIContext()
        guard let output = filter.outputImage, let cg = context.createCGImage(output, from: input.extent) else { return image }
        return UIImage(cgImage: cg, scale: image.scale, orientation: .up)
    }

    /// Renders `images` into one PDF, one page per image at that image's own aspect ratio, each
    /// capped to `maxDimension` on its longest side. Every page is run through `cleaned(_:)` first.
    /// `UIGraphicsPDFRenderer` is documented thread-safe, so a caller can run this inside a
    /// background `Task` while showing a "Preparing scan…" spinner rather than blocking the UI for
    /// however long enhancing and drawing every page takes.
    static func makePDF(images: [UIImage]) throws -> Data {
        guard !images.isEmpty else { throw PracticeError.invalid("Scan or choose at least one page.") }
        guard images.count <= 400 else { throw PracticeError.invalid("Scan up to 400 pages at a time.") }
        let renderer = UIGraphicsPDFRenderer(bounds: .zero)
        let data = renderer.pdfData { context in
            for raw in images {
                let image = cleaned(raw)
                let size = image.size
                guard size.width > 1, size.height > 1 else { continue }
                let scale = min(1, maxDimension / max(size.width, size.height))
                let pageSize = CGSize(width: size.width * scale, height: size.height * scale)
                context.beginPage(withBounds: CGRect(origin: .zero, size: pageSize), pageInfo: [:])
                image.draw(in: CGRect(origin: .zero, size: pageSize))
            }
        }
        guard (PDFDocument(data: data)?.pageCount ?? 0) > 0 else { throw PracticeError.invalid("None of the scanned pages could be prepared.") }
        return data
    }
}
