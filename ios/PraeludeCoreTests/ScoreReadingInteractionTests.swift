import XCTest
@testable import PraeludeCore

final class ScoreReadingInteractionTests: XCTestCase {
    func testMiddleEdgeZonesToggleFocusWithoutTakingSidePageTurns() {
        XCTAssertTrue(ScoreReadingInteraction.togglesFocus(x: 0.5, y: 0.05))
        XCTAssertTrue(ScoreReadingInteraction.togglesFocus(x: 0.5, y: 0.95))
        XCTAssertFalse(ScoreReadingInteraction.togglesFocus(x: 0.5, y: 0.5))
        XCTAssertFalse(ScoreReadingInteraction.togglesFocus(x: 0.1, y: 0.05))
        XCTAssertFalse(ScoreReadingInteraction.togglesFocus(x: 0.9, y: 0.95))
        XCTAssertFalse(ScoreReadingInteraction.togglesFocus(x: .nan, y: 0))
        XCTAssertFalse(ScoreReadingInteraction.togglesFocus(x: 0.5, y: -0.1))
        XCTAssertEqual(ScoreReadingInteraction.pageDirection(x: 0.1), -1)
        XCTAssertEqual(ScoreReadingInteraction.pageDirection(x: 0.9), 1)
    }
}
