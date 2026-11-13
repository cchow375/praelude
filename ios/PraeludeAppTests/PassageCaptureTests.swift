import PDFKit
import UIKit
import XCTest
@testable import Praelude

final class PassageCaptureTests: XCTestCase {
    private func redAtCenter(_ image: UIImage) throws -> UInt8 {
        let source = try XCTUnwrap(image.cgImage)
        var bytes = [UInt8](repeating: 0, count: 4)
        let context = try XCTUnwrap(CGContext(data: &bytes, width: 1, height: 1, bitsPerComponent: 8,
                                             bytesPerRow: 4, space: CGColorSpaceCreateDeviceRGB(),
                                             bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
        // Sample a single center pixel. Whole-image downscaling would blend the excluded area.
        let pixel = try XCTUnwrap(source.cropping(to: CGRect(x: source.width / 2, y: source.height / 2, width: 1, height: 1)))
        context.draw(pixel, in: CGRect(x: 0, y: 0, width: 1, height: 1))
        return bytes[0]
    }
    private func photo(size: CGSize = CGSize(width: 800, height: 600)) -> UIImage {
        let format = UIGraphicsImageRendererFormat(); format.scale = 1; format.opaque = true
        return UIGraphicsImageRenderer(size: size, format: format).image { context in
            UIColor.white.setFill(); context.fill(CGRect(origin: .zero, size: size))
            UIColor.black.setFill(); context.fill(CGRect(x: size.width / 2, y: 0, width: size.width / 2, height: size.height))
        }
    }

    func testPixelCropRejectsNonFiniteDegenerateAndTinyRectanglesAndClampsEdges() {
        XCTAssertNil(PassageCaptureProcessor.pixelCrop(CGRect(x: CGFloat.nan, y: 0, width: 1, height: 1), width: 800, height: 600))
        XCTAssertNil(PassageCaptureProcessor.pixelCrop(CGRect(x: 0, y: 0, width: 0, height: 1), width: 800, height: 600))
        XCTAssertNil(PassageCaptureProcessor.pixelCrop(CGRect(x: 0, y: 0, width: 0.001, height: 0.001), width: 800, height: 600))
        XCTAssertNil(PassageCaptureProcessor.pixelCrop(CGRect(x: 3, y: 0, width: 1, height: 1), width: 800, height: 600))
        XCTAssertEqual(PassageCaptureProcessor.pixelCrop(CGRect(x: -1, y: -1, width: 3, height: 3), width: 800, height: 600), CGRect(x: 0, y: 0, width: 800, height: 600))
    }

    func testDecodedAndCameraPhotosAreUprightAndBoundedBeforeCrop() async throws {
        let raw = photo(size: CGSize(width: 4000, height: 3000))
        let normalized = try await PassageCaptureProcessor.shared.normalize(raw)
        XCTAssertEqual(normalized.imageOrientation, .up)
        XCTAssertLessThanOrEqual(max(normalized.size.width, normalized.size.height), 2800)
        let data = try XCTUnwrap(raw.jpegData(compressionQuality: 0.7))
        let decoded = try await PassageCaptureProcessor.shared.decode(data)
        XCTAssertEqual(decoded.imageOrientation, .up)
        XCTAssertLessThanOrEqual(max(decoded.size.width, decoded.size.height), 2800)
        let rotated = try await PassageCaptureProcessor.shared.normalize(normalized, clockwise: true)
        XCTAssertEqual(rotated.size.width / rotated.size.height, 0.75, accuracy: 0.001)
        // Original black right half becomes the bottom half after a clockwise quarter turn.
        let bottom = try await PassageCaptureProcessor.shared.cropped(rotated, rect: CGRect(x: 0, y: 0.6, width: 1, height: 0.3), enhance: false)
        let top = try await PassageCaptureProcessor.shared.cropped(rotated, rect: CGRect(x: 0, y: 0.1, width: 1, height: 0.3), enhance: false)
        XCTAssertLessThan(try redAtCenter(bottom), 20)
        XCTAssertGreaterThan(try redAtCenter(top), 230)
    }

    func testSavedPDFContainsOnlyTheSelectedPassageAspectRatio() async throws {
        let raw = photo()
        let rect = CGRect(x: 0.5, y: 0.25, width: 0.5, height: 0.5)
        let crop = try await PassageCaptureProcessor.shared.cropped(raw, rect: rect, enhance: false)
        XCTAssertEqual(crop.size, CGSize(width: 400, height: 300))
        let data = try await PassageCaptureProcessor.shared.preparePDF(image: raw, rect: rect, enhance: false)
        let document = try XCTUnwrap(PDFDocument(data: data))
        XCTAssertEqual(document.pageCount, 1)
        let page = try XCTUnwrap(document.page(at: 0))
        XCTAssertEqual(page.bounds(for: .mediaBox).size, CGSize(width: 400, height: 300))
        let thumbnail = page.thumbnail(of: CGSize(width: 40, height: 30), for: .mediaBox)
        XCTAssertLessThan(try redAtCenter(thumbnail), 20, "The excluded white half must not remain in the saved passage.")
    }

    func testMalformedPhotosAndCancellationFailBeforeStaging() async throws {
        do { _ = try await PassageCaptureProcessor.shared.decode(Data("broken".utf8)); XCTFail("Malformed photo accepted") }
        catch { XCTAssertTrue(error.localizedDescription.contains("readable photo")) }
        let input = photo()
        let task = Task {
            try Task.checkCancellation()
            return try await PassageCaptureProcessor.shared.preparePDF(image: input, rect: CGRect(x: 0, y: 0, width: 1, height: 1), enhance: false)
        }
        task.cancel()
        do { _ = try await task.value; XCTFail("Cancelled photo processing succeeded") }
        catch { XCTAssertTrue(error is CancellationError) }
    }

    func testFirstSelectedBoxIsCoverEvenWhenLaterBoxIsOnAnEarlierPage() async throws {
        let source = PDFDocument()
        source.insert(try XCTUnwrap(PDFPage(image: photo())), at: 0)
        source.insert(try XCTUnwrap(PDFPage(image: photo())), at: 1)
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".pdf")
        defer { try? FileManager.default.removeItem(at: url) }
        try XCTUnwrap(source.dataRepresentation()).write(to: url)
        let passage = Passage(pieceID: UUID(), title: "First selected region", regions: [
            PassageRegion(page: 2, x: 0.5, y: 0, width: 0.5, height: 0.5),
            PassageRegion(page: 1, x: 0, y: 0, width: 1, height: 1)
        ])
        let result = await PassageThumbnailRenderer.shared.render(url: url, passage: passage)
        let image = try XCTUnwrap(result)
        XCTAssertEqual(image.size.width / image.size.height, 4.0 / 3.0, accuracy: 0.02)
        XCTAssertEqual(image.size.width, 1200, accuracy: 1, "Render the selected crop at reading resolution rather than enlarging a tiny full-page thumbnail.")
        XCTAssertLessThan(try redAtCenter(image), 20, "First selection is entirely in the black right half; the unrelated first-page box is ignored.")
        source.page(at: 1)?.rotation = 90
        let rotatedURL = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".pdf")
        defer { try? FileManager.default.removeItem(at: rotatedURL) }
        try XCTUnwrap(source.dataRepresentation()).write(to: rotatedURL)
        let rotated = await PassageThumbnailRenderer.shared.render(url: rotatedURL, passage: passage)
        let rotatedImage = try XCTUnwrap(rotated)
        XCTAssertEqual(rotatedImage.size.width / rotatedImage.size.height, 3.0 / 4.0, accuracy: 0.02)
        XCTAssertLessThan(try redAtCenter(rotatedImage), 20, "Rotation must preserve the exact same selected notes.")
    }
}
