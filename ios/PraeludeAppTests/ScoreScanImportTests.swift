import PDFKit
import UIKit
import XCTest
@testable import Praelude

final class ScoreScanImportTests: XCTestCase {
    /// A plain solid-color image at a given pixel size — enough to exercise layout/aspect-ratio and
    /// the document-enhancer filter without needing a real scanned photo. Pinned to `scale = 1` so
    /// `size` points and the underlying `cgImage`'s pixel dimensions always match 1:1 regardless of
    /// the host simulator's own screen scale — `testCleanedNormalizesOrientationSoDrawnSizeMatchesTheVisualSize`
    /// below reinterprets that `cgImage` at an explicit `scale: 1`, which only holds with this pinned.
    private func image(size: CGSize, color: UIColor) -> UIImage {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        return UIGraphicsImageRenderer(size: size, format: format).image { context in
            color.setFill(); context.fill(CGRect(origin: .zero, size: size))
        }
    }

    func testMakePDFProducesOnePageAtEachImagesOwnAspectRatio() throws {
        let portrait = image(size: CGSize(width: 600, height: 800), color: .white)
        let landscape = image(size: CGSize(width: 900, height: 500), color: .lightGray)
        let data = try ScoreScanImport.makePDF(images: [portrait, landscape])
        let document = try XCTUnwrap(PDFDocument(data: data))
        XCTAssertEqual(document.pageCount, 2)
        let firstBounds = try XCTUnwrap(document.page(at: 0)).bounds(for: .mediaBox)
        let secondBounds = try XCTUnwrap(document.page(at: 1)).bounds(for: .mediaBox)
        XCTAssertEqual(firstBounds.width / firstBounds.height, 600.0 / 800.0, accuracy: 0.01)
        XCTAssertEqual(secondBounds.width / secondBounds.height, 900.0 / 500.0, accuracy: 0.01)
    }

    func testMakePDFCapsPagesToTheLongestEdgeWithoutDistortingAspectRatio() throws {
        let huge = image(size: CGSize(width: 4000, height: 3000), color: .white)
        let data = try ScoreScanImport.makePDF(images: [huge])
        let document = try XCTUnwrap(PDFDocument(data: data))
        let bounds = try XCTUnwrap(document.page(at: 0)).bounds(for: .mediaBox)
        XCTAssertLessThanOrEqual(max(bounds.width, bounds.height), 2200.5)
        XCTAssertEqual(bounds.width / bounds.height, 4000.0 / 3000.0, accuracy: 0.01)
    }

    func testMakePDFRejectsEmptyInput() {
        XCTAssertThrowsError(try ScoreScanImport.makePDF(images: []))
    }

    func testCleanedFallsBackToTheOriginalImageRatherThanFailing() {
        // A 1x1 image is a degenerate case for CIDocumentEnhancer's own internal processing; either
        // outcome (enhanced or the original returned untouched) must be a valid, drawable image —
        // `cleaned` must never return something the caller cannot use.
        let tiny = image(size: CGSize(width: 1, height: 1), color: .black)
        let result = ScoreScanImport.cleaned(tiny)
        XCTAssertGreaterThan(result.size.width, 0)
        XCTAssertGreaterThan(result.size.height, 0)
    }

    func testCleanedNormalizesOrientationSoDrawnSizeMatchesTheVisualSize() throws {
        // A wide (landscape) source image reinterpreted as shot in portrait orientation (.right) —
        // UIImage.size already swaps width/height for that orientation, and `cleaned`'s output must
        // agree, whether or not the enhancer filter itself ran.
        let wide = image(size: CGSize(width: 800, height: 400), color: .white)
        let rotated = try XCTUnwrap(UIImage(cgImage: XCTUnwrap(wide.cgImage), scale: 1, orientation: .right))
        XCTAssertEqual(rotated.size, CGSize(width: 400, height: 800))
        let result = ScoreScanImport.cleaned(rotated)
        XCTAssertEqual(result.size.width / result.size.height, 400.0 / 800.0, accuracy: 0.02)
    }

    func testMakePDFSkipsAnImageWithNoMeasurableSizeWithoutThrowing() throws {
        // A well-formed, normal-sized page alongside a degenerate zero-size one (`UIImage()`, with
        // no backing `cgImage`) — the degenerate page must be skipped, not crash the whole render
        // or silently produce a zero-page document.
        let degenerate = UIImage()
        XCTAssertEqual(degenerate.size, .zero)
        let normal = image(size: CGSize(width: 600, height: 800), color: .white)
        let data = try ScoreScanImport.makePDF(images: [degenerate, normal])
        XCTAssertEqual(try XCTUnwrap(PDFDocument(data: data)).pageCount, 1)
    }
}
