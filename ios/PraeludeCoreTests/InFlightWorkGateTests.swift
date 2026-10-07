import Foundation
import XCTest
@testable import PraeludeCore

final class InFlightWorkGateTests: XCTestCase {
    func testConcurrentWindowsNeverBuildABacklogAndNextFreshWindowCanEnter() {
        let gate = InFlightWorkGate()
        let admissionsLock = NSLock()
        var admissions = 0
        DispatchQueue.concurrentPerform(iterations: 128) { _ in
            if gate.tryBegin() {
                admissionsLock.lock()
                admissions += 1
                admissionsLock.unlock()
            }
        }
        XCTAssertEqual(admissions, 1)
        XCTAssertFalse(gate.tryBegin())
        gate.finish()
        XCTAssertTrue(gate.tryBegin())
        XCTAssertFalse(gate.tryBegin())
        gate.finish()
    }
}
