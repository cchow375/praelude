import PDFKit
import SwiftUI
import XCTest
@testable import Praelude

@MainActor @Observable private final class PageTurnTimingModel {
    var page = 1
}
private struct PageTurnTimingHost: View {
    let url: URL
    let model: PageTurnTimingModel
    let markup: ScoreMarkupState
    var body: some View {
        PagedScoreView(url: url, page: Binding(get: { model.page }, set: { model.page = $0 }),
                       twoPages: false, markup: markup, onPageChanged: { model.page = $0 })
    }
}

/// Requested-page-to-rendered-sentinel timing, including deferred SwiftUI/PDFKit work.
/// A fresh PDFDocument and previously unseen raster page are used for each cold measurement.
/// This is simulator evidence, never physical touch-to-frame or a literal zero-delay claim.
final class PageTurnTimingTests: XCTestCase {
    @MainActor private func pdf(in view: UIView) -> ZoomableScorePDFView? {
        if let pdf = view as? ZoomableScorePDFView { return pdf }
        return view.subviews.lazy.compactMap { self.pdf(in: $0) }.first
    }

    @MainActor private func matches(_ expected: Int, view: UIView) -> Bool {
        let format = UIGraphicsImageRendererFormat(); format.scale = 1
        let image = UIGraphicsImageRenderer(size: view.bounds.size, format: format).image { _ in
            view.drawHierarchy(in: view.bounds, afterScreenUpdates: true)
        }
        guard let source = image.cgImage,
              let pixel = source.cropping(to: CGRect(x: source.width / 2, y: source.height / 2, width: 1, height: 1)) else { return false }
        var rgba = [UInt8](repeating: 0, count: 4)
        guard let context = CGContext(data: &rgba, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4,
                                      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
        context.draw(pixel, in: CGRect(x: 0, y: 0, width: 1, height: 1))
        // Unique centers distinguish every page, including rapid page 2 -> page 4 turns.
        switch expected {
        case 1: return rgba[0] > 140 && rgba[1] < 80 && rgba[2] < 80
        case 2: return rgba[1] > 140 && rgba[0] < 80 && rgba[2] < 80
        case 3: return rgba[2] > 140 && rgba[0] < 80 && rgba[1] < 80
        case 4: return rgba[0] > 140 && rgba[1] > 140 && rgba[2] < 80
        default: return false
        }
    }

    @MainActor private func waitForPage(_ target: Int, model: PageTurnTimingModel,
                                       pdf: ZoomableScorePDFView, host: UIView) async throws -> Double {
        let start = Date(); model.page = target
        for _ in 0..<200 {
            host.setNeedsLayout(); host.layoutIfNeeded(); pdf.layoutIfNeeded()
            if pdf.currentPage === pdf.document?.page(at: target - 1), matches(target, view: pdf) {
                return Date().timeIntervalSince(start) * 1000
            }
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTFail("Requested page \(target) must display its own raster, never blank or stale content")
        return Date().timeIntervalSince(start) * 1000
    }

    @MainActor func testColdAndWarmRasterPageTurnsStayCorrectOnOrdinaryAndHugePages() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        for size in [CGSize(width: 595, height: 842), CGSize(width: 5609.6, height: 7764.01)] {
            let rect = CGRect(origin: .zero, size: size)
            let data = UIGraphicsPDFRenderer(bounds: rect).pdfData { context in
                for page in 1...4 {
                    autoreleasepool {
                        context.beginPage()
                        let format = UIGraphicsImageRendererFormat(); format.scale = 1
                        let scan = UIGraphicsImageRenderer(size: CGSize(width: 1800, height: 2500), format: format).image { imageContext in
                            let color = [UIColor.red, .green, .blue, .yellow][page - 1]
                            color.setFill(); imageContext.fill(CGRect(x: 0, y: 0, width: 1800, height: 2500))
                            // Raster text and fine horizontal detail, with a distinct center sentinel.
                            for line in 0..<100 {
                                ("Scan \(page) · line \(line)" as NSString).draw(at: CGPoint(x: 30, y: 20 + line * 20),
                                    withAttributes: [.font: UIFont.systemFont(ofSize: 12), .foregroundColor: UIColor.black])
                            }
                        }
                        scan.draw(in: rect)
                    }
                }
            }
            let url = directory.appendingPathComponent("\(Int(size.width)).pdf"); try data.write(to: url)
            let model = PageTurnTimingModel()
            let host = UIHostingController(rootView: PageTurnTimingHost(url: url, model: model, markup: ScoreMarkupState()))
            let window = UIWindow(windowScene: scene); window.rootViewController = host; window.makeKeyAndVisible()
            defer { window.isHidden = true; window.rootViewController = nil }
            host.view.layoutIfNeeded()
            var rendered: ZoomableScorePDFView?
            for _ in 0..<100 {
                host.view.layoutIfNeeded(); rendered = pdf(in: host.view)
                if rendered?.document != nil { break }
                try await Task.sleep(for: .milliseconds(10))
            }
            let pdf = try XCTUnwrap(rendered)
            _ = try await waitForPage(1, model: model, pdf: pdf, host: host.view)
            let cold = try await waitForPage(2, model: model, pdf: pdf, host: host.view)
            _ = try await waitForPage(1, model: model, pdf: pdf, host: host.view)
            let warm = try await waitForPage(2, model: model, pdf: pdf, host: host.view)
            // Several requests in one transaction must land on the newest requested page.
            model.page = 3; model.page = 2; model.page = 4
            let rapid = try await waitForPage(4, model: model, pdf: pdf, host: host.view)
            XCTAssertEqual(model.page, 4)
            print("NAVIGATION_NATIVE_MS sourceWidth=\(size.width) raster=1800x2500 cold=\(cold) warm=\(warm) rapidFinal=\(rapid) PDFBytes=\(data.count)")
        }
    }
}
