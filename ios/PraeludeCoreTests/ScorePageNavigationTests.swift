import XCTest
@testable import PraeludeCore

final class ScorePageNavigationTests: XCTestCase {
    func testMovementTurnsSkipOtherMovementAndInsertedPages() {
        let allowed = [2, 4, 7]
        XCTAssertEqual(ScorePageNavigation.advance(2, by: 1, among: allowed), 4)
        XCTAssertEqual(ScorePageNavigation.advance(7, by: -1, among: allowed), 4)
        XCTAssertEqual(ScorePageNavigation.advance(2, by: 2, among: allowed), 7)
        XCTAssertEqual(ScorePageNavigation.advance(7, by: 2, among: allowed), 7)
        XCTAssertEqual(ScorePageNavigation.advance(2, by: -2, among: allowed), 2)
        XCTAssertEqual(ScorePageNavigation.nearest(6, among: allowed), 7)
        XCTAssertTrue(allowed.contains(ScorePageNavigation.nearest(3, among: allowed)))
    }
}
