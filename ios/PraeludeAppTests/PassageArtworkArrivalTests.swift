import SwiftUI
import UIKit
import XCTest
@testable import Praelude

/// Metadata and private files are intentionally separate sync operations. An already-visible
/// card and zoom preview must recover when their own score arrives, without reopening the view.
final class PassageArtworkArrivalTests: XCTestCase {
    @MainActor private func redPixels(in view: UIView, lowerHalf: Bool) -> Int {
        view.setNeedsLayout(); view.layoutIfNeeded()
        let format = UIGraphicsImageRendererFormat(); format.scale = 1; format.opaque = true
        let image = UIGraphicsImageRenderer(size: view.bounds.size, format: format).image { _ in
            view.drawHierarchy(in: view.bounds, afterScreenUpdates: true)
        }
        guard let source = image.cgImage else { return 0 }
        let half = source.height / 2
        guard let crop = source.cropping(to: CGRect(x: 0, y: lowerHalf ? half : 0, width: source.width, height: half)) else { return 0 }
        var rgba = [UInt8](repeating: 0, count: crop.width * crop.height * 4)
        guard let context = CGContext(data: &rgba, width: crop.width, height: crop.height, bitsPerComponent: 8,
                                      bytesPerRow: crop.width * 4, space: CGColorSpaceCreateDeviceRGB(),
                                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return 0 }
        context.draw(crop, in: CGRect(x: 0, y: 0, width: crop.width, height: crop.height))
        return stride(from: 0, to: rgba.count, by: 4).filter { rgba[$0] > 180 && rgba[$0 + 1] < 80 && rgba[$0 + 2] < 80 }.count
    }

    @MainActor func testVisibleCardAndZoomRecoverOnlyWhenTheirOwnPDFPublishes() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = PracticeStore(directory: directory)
        let piece = Piece(title: "Arriving score", pdfFileName: UUID().uuidString + ".pdf", pageCount: 1)
        let passage = Passage(pieceID: piece.id, title: "Arriving passage", regions: [PassageRegion(page: 1, x: 0, y: 0, width: 1, height: 1)])
        try store.addPiece(piece); try store.savePassage(passage)
        let content = VStack(spacing: 0) {
            PassageCardArtwork(passage: passage, piece: piece).frame(width: 300, height: 180)
            PassageCardZoomView(passage: passage, piece: piece).frame(width: 300, height: 180)
        }.frame(width: 300, height: 360).ignoresSafeArea().environment(store)
        let host = UIHostingController(rootView: content)
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 300, height: 360))
        window.rootViewController = host; window.isHidden = false
        defer { window.isHidden = true; window.rootViewController = nil }
        host.view.frame = window.bounds; host.view.layoutIfNeeded()
        try await Task.sleep(for: .milliseconds(180))
        XCTAssertEqual(redPixels(in: host.view, lowerHalf: false), 0)
        XCTAssertEqual(redPixels(in: host.view, lowerHalf: true), 0)

        let url = try XCTUnwrap(NativeLibraryFiles(store: store).scoreURL(for: piece))
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        let data = UIGraphicsPDFRenderer(bounds: CGRect(x: 0, y: 0, width: 300, height: 180)).pdfData { context in
            context.beginPage(); UIColor.red.setFill(); context.fill(CGRect(x: 0, y: 0, width: 300, height: 180))
        }
        try data.write(to: url, options: .atomic)
        NotificationCenter.default.post(name: .praeludeLibraryAssetAvailable, object: url.deletingLastPathComponent().appendingPathComponent("unrelated.pdf"))
        try await Task.sleep(for: .milliseconds(120))
        XCTAssertEqual(redPixels(in: host.view, lowerHalf: false), 0, "An unrelated asset must not restart this card's task.")
        XCTAssertEqual(redPixels(in: host.view, lowerHalf: true), 0)

        NotificationCenter.default.post(name: .praeludeLibraryAssetAvailable, object: url)
        var card = 0, zoom = 0
        for _ in 0..<100 {
            card = redPixels(in: host.view, lowerHalf: false)
            zoom = redPixels(in: host.view, lowerHalf: true)
            if card > 8000 && zoom > 8000 { break }
            try await Task.sleep(for: .milliseconds(20))
        }
        XCTAssertGreaterThan(card, 8000, "The existing card must visibly show its downloaded PDF.")
        XCTAssertGreaterThan(zoom, 8000, "The existing zoom view must visibly show its downloaded PDF.")
    }
}
