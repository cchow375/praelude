import PDFKit
import UIKit
import XCTest
@testable import Praelude

/// App-level tests for `ScoreHeatmapRenderer` (§16 score heatmap): the one piece of this track's
/// logic that lives in the app target rather than `PraeludeCore`, since it draws with PDFKit/UIKit.
/// `PracticeHeatmap`'s own coloring rule is covered in `PraeludeCoreTests/InsightsTests.swift`; these
/// tests check that a level/tap actually changes the rendered pixels, not just that nothing crashes.
final class ScoreHeatmapRendererTests: XCTestCase {
    private func makePDF(pages: Int = 1) -> URL {
        let renderer = UIGraphicsPDFRenderer(bounds: CGRect(x: 0, y: 0, width: 400, height: 500))
        let data = renderer.pdfData { context in
            for _ in 0..<pages {
                context.beginPage()
                UIColor.white.setFill()
                context.fill(CGRect(x: 0, y: 0, width: 400, height: 500))
            }
        }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("heatmap-\(UUID().uuidString).pdf")
        try! data.write(to: url)
        return url
    }

    @MainActor
    func testRenderReturnsNilForMissingPage() throws {
        let url = makePDF(pages: 1)
        addTeardownBlock { try? FileManager.default.removeItem(at: url) }
        let image = ScoreHeatmapRenderer.render(url: url, page: 5, passages: [], taps: [], now: Date(), levelForPassage: { _ in nil })
        XCTAssertNil(image)
    }

    @MainActor
    func testRenderColorsPassageRegionWhenALevelIsProvided() throws {
        let url = makePDF(pages: 1)
        addTeardownBlock { try? FileManager.default.removeItem(at: url) }
        var passage = Passage(pieceID: UUID(), title: "Passage")
        passage.regions = [PassageRegion(page: 1, x: 0, y: 0, width: 1, height: 1)]

        let colored = ScoreHeatmapRenderer.render(url: url, page: 1, passages: [passage], taps: [], now: Date(),
                                                    levelForPassage: { $0 == passage.id ? .failing : nil })
        let uncolored = ScoreHeatmapRenderer.render(url: url, page: 1, passages: [passage], taps: [], now: Date(),
                                                     levelForPassage: { _ in nil })
        let colorForOtherPassage = ScoreHeatmapRenderer.render(url: url, page: 1, passages: [passage], taps: [], now: Date(),
                                                                levelForPassage: { $0 == UUID() ? .failing : nil })

        let coloredData = try XCTUnwrap(colored?.pngData())
        let uncoloredData = try XCTUnwrap(uncolored?.pngData())
        XCTAssertNotEqual(coloredData, uncoloredData, "a colored region must change the rendered pixels")
        XCTAssertEqual(uncoloredData, try XCTUnwrap(colorForOtherPassage?.pngData()), "no evidence must render identically regardless of the closure passed")
    }

    @MainActor
    func testRenderDistinguishesHeatLevelsByWeight() throws {
        let url = makePDF(pages: 1)
        addTeardownBlock { try? FileManager.default.removeItem(at: url) }
        var passage = Passage(pieceID: UUID(), title: "Passage")
        passage.regions = [PassageRegion(page: 1, x: 0, y: 0, width: 1, height: 1)]

        let solid = try XCTUnwrap(ScoreHeatmapRenderer.render(url: url, page: 1, passages: [passage], taps: [], now: Date(), levelForPassage: { _ in .solid })?.pngData())
        let failing = try XCTUnwrap(ScoreHeatmapRenderer.render(url: url, page: 1, passages: [passage], taps: [], now: Date(), levelForPassage: { _ in .failing })?.pngData())
        XCTAssertNotEqual(solid, failing, "solid and failing must not render identically")
    }

    @MainActor
    func testRenderDrawsATapOnlyInsideItsPassagesOwnRegionOnThisPage() throws {
        let url = makePDF(pages: 1)
        addTeardownBlock { try? FileManager.default.removeItem(at: url) }
        var passage = Passage(pieceID: UUID(), title: "Passage")
        passage.regions = [PassageRegion(page: 1, x: 0.1, y: 0.1, width: 0.3, height: 0.3)]

        let insideTap = BreakPointTap(passageID: passage.id, date: Date(), location: NormalizedRect(x: 0.2, y: 0.2, width: 0.02, height: 0.02))
        let outsideTap = BreakPointTap(passageID: passage.id, date: Date(), location: NormalizedRect(x: 0.8, y: 0.8, width: 0.02, height: 0.02))

        let withInsideTap = try XCTUnwrap(ScoreHeatmapRenderer.render(url: url, page: 1, passages: [passage], taps: [insideTap], now: Date(), levelForPassage: { _ in nil })?.pngData())
        let withOutsideTap = try XCTUnwrap(ScoreHeatmapRenderer.render(url: url, page: 1, passages: [passage], taps: [outsideTap], now: Date(), levelForPassage: { _ in nil })?.pngData())
        let withNoTap = try XCTUnwrap(ScoreHeatmapRenderer.render(url: url, page: 1, passages: [passage], taps: [], now: Date(), levelForPassage: { _ in nil })?.pngData())

        XCTAssertNotEqual(withInsideTap, withNoTap, "a tap inside the passage's own region must be drawn")
        XCTAssertEqual(withOutsideTap, withNoTap, "a tap outside every region on this page must not be drawn")
    }
}
