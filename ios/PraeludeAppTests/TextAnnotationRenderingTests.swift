import PDFKit
import UIKit
import XCTest
@testable import Praelude

final class TextAnnotationRenderingTests: XCTestCase {
    @MainActor func testOversizedPagesKeepTheSameVisibleTypography() throws {
        let note = TextBoxAnnotation(pieceID: UUID(), page: 1,
            region: NormalizedRect(x: 0.1, y: 0.2, width: 0.6, height: 0.25), text: "Listen to the bass\nKeep the pulse steady",
            style: TextAnnotationStyle(fontSize: 24, fontFamily: .serif, isBold: true, textColor: .blue))
        func render(pageWidth: CGFloat) -> UIImage {
            let format = UIGraphicsImageRendererFormat(); format.scale = 1
            return UIGraphicsImageRenderer(size: CGSize(width: 595, height: 842), format: format).image { renderer in
                UIColor.white.setFill(); renderer.fill(CGRect(x: 0, y: 0, width: 595, height: 842))
                let scale = pageWidth / 595
                renderer.cgContext.scaleBy(x: 1 / scale, y: 1 / scale)
                TextAnnotationRenderer.draw(note: note, in: note.region.rect(in: CGSize(width: pageWidth, height: 842 * scale)),
                                            pageWidth: pageWidth, context: renderer.cgContext)
            }
        }
        func inkMask(_ image: UIImage) throws -> [Bool] {
            let cg = try XCTUnwrap(image.cgImage)
            var bytes = [UInt8](repeating: 0, count: 595 * 842 * 4)
            try bytes.withUnsafeMutableBytes { buffer in
                let context = try XCTUnwrap(CGContext(data: buffer.baseAddress, width: 595, height: 842,
                    bitsPerComponent: 8, bytesPerRow: 595 * 4, space: CGColorSpaceCreateDeviceRGB(),
                    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue))
                context.draw(cg, in: CGRect(x: 0, y: 0, width: 595, height: 842))
            }
            return (0..<(595 * 842)).map { bytes[$0 * 4] < 100 && bytes[$0 * 4 + 1] < 130 && bytes[$0 * 4 + 2] > 100 }
        }
        let ordinary = try inkMask(render(pageWidth: 595)), oversized = try inkMask(render(pageWidth: 5609.6))
        let common = zip(ordinary, oversized).filter { $0 && $1 }.count
        let combined = zip(ordinary, oversized).filter { $0 || $1 }.count
        XCTAssertGreaterThan(combined, 1000, "The comparison must include actual readable text pixels")
        XCTAssertGreaterThan(Double(common) / Double(combined), 0.95, "PDF source units must not alter the visible note font")
    }

    @MainActor func testFontTraitsAndAlignmentAreIndependentOfBoxDimensions() throws {
        let style = TextAnnotationStyle(fontSize: 32, fontFamily: .serif, isBold: true, isItalic: true,
                                        textColor: .purple, alignment: .trailing)
        let font = TextAnnotationRenderer.font(for: style)
        XCTAssertEqual(font.pointSize, 32)
        XCTAssertTrue(font.fontDescriptor.symbolicTraits.contains(.traitBold))
        XCTAssertTrue(font.fontDescriptor.symbolicTraits.contains(.traitItalic))
        let paragraph = try XCTUnwrap(TextAnnotationRenderer.attributes(for: style)[.paragraphStyle] as? NSParagraphStyle)
        XCTAssertEqual(paragraph.alignment, .right)
        XCTAssertEqual(paragraph.lineBreakMode, .byWordWrapping)
        XCTAssertEqual(TextAnnotationRenderer.font(for: style, scale: 5609.6 / 595).pointSize / (5609.6 / 595), 32, accuracy: 0.001)
    }
}
