import Foundation
import XCTest
@testable import PraeludeCore

/// Unit coverage for the practice-ux track's pure Core helpers: the cold-grade-to-verdict mapping
/// (§9), cross-page passage page cycling (§8 auto page-turn), and the tempo drag gesture math (§10a).
final class PracticeUXHelpersTests: XCTestCase {
    // MARK: - verdict(for:)

    func testColdGradeMapsToVerdict() {
        XCTAssertEqual(PracticeUXHelpers.verdict(for: .clean), .clean)
        XCTAssertEqual(PracticeUXHelpers.verdict(for: .shaky), .sloppy)
        XCTAssertEqual(PracticeUXHelpers.verdict(for: .missed), .again)
    }

    // MARK: - distinctPages / nextPassagePage

    func testDistinctPagesSortsAndDeduplicates() {
        let regions = [
            PassageRegion(page: 3, x: 0, y: 0, width: 0.2, height: 0.2),
            PassageRegion(page: 1, x: 0, y: 0, width: 0.2, height: 0.2),
            PassageRegion(page: 3, x: 0.3, y: 0, width: 0.2, height: 0.2),
            PassageRegion(page: 2, x: 0, y: 0, width: 0.2, height: 0.2)
        ]
        XCTAssertEqual(PracticeUXHelpers.distinctPages(regions), [1, 2, 3])
    }

    func testDistinctPagesEmptyForNoRegions() {
        XCTAssertEqual(PracticeUXHelpers.distinctPages([]), [])
    }

    func testNextPassagePageWrapsAroundTheCycle() {
        let pages = [1, 2, 4]
        XCTAssertEqual(PracticeUXHelpers.nextPassagePage(after: 1, pages: pages), 2)
        XCTAssertEqual(PracticeUXHelpers.nextPassagePage(after: 2, pages: pages), 4)
        XCTAssertEqual(PracticeUXHelpers.nextPassagePage(after: 4, pages: pages), 1)
    }

    func testNextPassagePageNilForSinglePagePassage() {
        XCTAssertNil(PracticeUXHelpers.nextPassagePage(after: 1, pages: [1]))
        XCTAssertNil(PracticeUXHelpers.nextPassagePage(after: 1, pages: []))
    }

    func testNextPassagePageNilWhenCurrentPageIsOutsideThePassage() {
        // Auto-turn only follows a passage the reader is already inside; a page the player
        // navigated to that isn't part of this passage must never be yanked back into the cycle.
        XCTAssertNil(PracticeUXHelpers.nextPassagePage(after: 7, pages: [1, 2, 3]))
    }

    // MARK: - tempo(fromDragTranslation:startBPM:)

    func testTempoDragUpIncreasesTempo() {
        // Negative translationY (SwiftUI's down-positive space) is an upward drag.
        let result = PracticeUXHelpers.tempo(fromDragTranslation: -60, startBPM: 100, pointsPerStep: 6)
        XCTAssertEqual(result, 110)
    }

    func testTempoDragDownDecreasesTempo() {
        let result = PracticeUXHelpers.tempo(fromDragTranslation: 30, startBPM: 100, pointsPerStep: 6)
        XCTAssertEqual(result, 95)
    }

    func testTempoDragClampsToBounds() {
        XCTAssertEqual(PracticeUXHelpers.tempo(fromDragTranslation: -10_000, startBPM: 100), 300)
        XCTAssertEqual(PracticeUXHelpers.tempo(fromDragTranslation: 10_000, startBPM: 100), 20)
    }

    func testTempoDragZeroTranslationReturnsStartBPM() {
        XCTAssertEqual(PracticeUXHelpers.tempo(fromDragTranslation: 0, startBPM: 137), 137)
    }

    func testTempoDragRoundsToWholeSteps() {
        // 5 points at 6 points/step rounds to the nearest whole step (1), not a fraction.
        let result = PracticeUXHelpers.tempo(fromDragTranslation: -5, startBPM: 100, pointsPerStep: 6)
        XCTAssertEqual(result, 101)
    }

    func testTempoDragGuardsNonFiniteInput() {
        XCTAssertEqual(PracticeUXHelpers.tempo(fromDragTranslation: .nan, startBPM: 120), 120)
        XCTAssertEqual(PracticeUXHelpers.tempo(fromDragTranslation: 10, startBPM: .infinity), 300)
    }
}
