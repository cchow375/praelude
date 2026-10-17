import Foundation
import XCTest
@testable import PraeludeCore

final class SyncErrorPresentationTests: XCTestCase {
    func testTransportDiagnosticSurvivesErrorExistentialAndNSErrorBridging() {
        let message = "column account_preferences.id does not exist (42703)"
        let error: any Error = SyncError.transport(message)
        XCTAssertEqual(error.localizedDescription, message)
        XCTAssertEqual((error as NSError).localizedDescription, message)
        XCTAssertFalse(error.localizedDescription.contains("error 0"))
    }

    func testQueuedAndRemoteFailuresRetainActionableContext() {
        let queued: any Error = SyncError.malformedQueueEntry("updateLastPage entry missing pieceID/lastPage")
        XCTAssertTrue(queued.localizedDescription.contains("pieceID/lastPage"))
        XCTAssertTrue(queued.localizedDescription.contains("local practice is preserved"))
        let remote: any Error = SyncError.invalidRemoteRow("passages")
        XCTAssertTrue(remote.localizedDescription.contains("passages"))
        XCTAssertTrue(remote.localizedDescription.contains("local practice is preserved"))
    }

    func testBlankTransportMessageHasUsefulFallback() {
        let error: any Error = SyncError.transport(" \n ")
        XCTAssertEqual(error.localizedDescription, "Sync could not finish. Your practice remains saved on this device.")
    }
}
