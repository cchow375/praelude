import XCTest
@testable import Praelude

private actor CameraPermissionGate {
    private var continuation: CheckedContinuation<Bool, Never>?
    private var earlyAnswer: Bool?
    func request() async -> Bool {
        if let earlyAnswer { self.earlyAnswer = nil; return earlyAnswer }
        return await withCheckedContinuation { continuation = $0 }
    }
    func resolve(_ value: Bool) {
        if let continuation { self.continuation = nil; continuation.resume(returning: value) }
        else { earlyAnswer = value }
    }
}
final class FaceGestureServiceTests: XCTestCase {
    @MainActor func testOnlyOneWindowOwnsCameraPermissionAndStaleGrantCannotRestartIt() async {
        let gate = CameraPermissionGate(), secondGate = CameraPermissionGate()
        let first = FaceGestureService(permission: { await gate.request() })
        let second = FaceGestureService(permission: { await secondGate.request() })
        first.start()
        XCTAssertTrue(first.isPreparing)
        second.start()
        XCTAssertFalse(second.isPreparing)
        XCTAssertTrue(second.status.contains("another score"))
        first.stop()
        second.start()
        XCTAssertTrue(second.isPreparing)
        await gate.resolve(true)
        for _ in 0..<10 { await Task.yield() }
        XCTAssertFalse(first.isEnabled)
        XCTAssertNil(first.session)
        // A late grant from the retired owner must not release the current owner's claim.
        first.start()
        XCTAssertFalse(first.isPreparing)
        XCTAssertTrue(first.status.contains("another score"))
        first.stop(); second.stop()
        await secondGate.resolve(false)
        for _ in 0..<10 { await Task.yield() }
        XCTAssertFalse(second.isEnabled)
        XCTAssertNil(second.session)
    }
    @MainActor func testDeniedPermissionReleasesOwnershipAndNeverCreatesCaptureSession() async {
        let denied = FaceGestureService(permission: { false })
        denied.start()
        for _ in 0..<100 where denied.isPreparing { await Task.yield() }
        XCTAssertFalse(denied.isPreparing)
        XCTAssertFalse(denied.isEnabled)
        XCTAssertNil(denied.session)
        XCTAssertTrue(denied.status.contains("permission is off"))
        let gate = CameraPermissionGate()
        let next = FaceGestureService(permission: { await gate.request() })
        next.start()
        XCTAssertTrue(next.isPreparing)
        next.stop(); await gate.resolve(false)
        for _ in 0..<10 { await Task.yield() }
        XCTAssertFalse(next.isEnabled)
        XCTAssertFalse(next.calibrated)
        XCTAssertNil(next.session)
        XCTAssertEqual(next.status, "Camera is off")
        denied.stop()
    }
}
