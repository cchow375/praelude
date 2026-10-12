import XCTest
@preconcurrency import AVFoundation
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

private final class ControlledFaceCamera: FaceCameraCapturing, @unchecked Sendable {
    let captureSession: AVCaptureSession? = AVCaptureSession()
    private let lock = NSLock()
    private var started: (@Sendable () -> Void)?
    private var stopped: (@Sendable () -> Void)?
    private var startCount = 0
    private var initialRevision = -1
    var revision: Int { lock.withLock { initialRevision } }
    var starts: Int { lock.withLock { startCount } }
    func start(angle: CGFloat, revision: Int, completion: @escaping @Sendable () -> Void) {
        lock.withLock { startCount += 1; initialRevision = revision; started = completion }
    }
    func completeStart() { lock.withLock { started }?() }
    func rotate(_ angle: CGFloat, revision: Int) {}
    func stop(completion: @escaping @Sendable () -> Void) { lock.withLock { stopped = completion } }
    func completeStop() { lock.withLock { stopped }?() }
    func attachPreview(_ layer: AVCaptureVideoPreviewLayer) {}
    func detachPreview(_ layer: AVCaptureVideoPreviewLayer) {}
}
private final class FaceTestClock: @unchecked Sendable {
    private let lock = NSLock()
    private var value = 0.0
    var now: Double { lock.withLock { value } }
    func set(_ value: Double) { lock.withLock { self.value = value } }
}

extension FaceGestureServiceTests {
    @MainActor private func settle(_ predicate: () -> Bool) async {
        for _ in 0..<200 where !predicate() { await Task.yield() }
        XCTAssertTrue(predicate())
    }
    @MainActor private func isolatedPreferences() -> UserDefaults {
        let name = "PraeludeFaceTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: name)!
        defaults.removePersistentDomain(forName: name)
        return defaults
    }
    @MainActor func testCaptureIsPublishedOnlyAfterStartAndOwnershipRetainedUntilStopCompletes() async {
        let hardware = ControlledFaceCamera()
        let first = FaceGestureService(permission: { true }, workerFactory: { _, _ in hardware }, preferences: isolatedPreferences())
        let secondGate = CameraPermissionGate()
        let second = FaceGestureService(permission: { await secondGate.request() }, preferences: isolatedPreferences())
        first.start(); await settle { hardware.starts == 1 }
        XCTAssertTrue(first.isPreparing); XCTAssertFalse(first.isEnabled); XCTAssertNil(first.session)
        hardware.completeStart(); await settle { first.isEnabled }
        XCTAssertFalse(first.isPreparing); XCTAssertNotNil(first.session)
        first.stop()
        XCTAssertTrue(first.isStopping); XCTAssertNil(first.session)
        first.start(); second.start()
        XCTAssertEqual(hardware.starts, 1, "Off/On must not create a second capture while shutdown is pending")
        XCTAssertFalse(second.isPreparing)
        XCTAssertTrue(second.status.contains("another score"))
        hardware.completeStop(); await settle { !first.isStopping }
        second.start(); XCTAssertTrue(second.isPreparing)
        second.stop(); await secondGate.resolve(false)
        await settle { !second.isPreparing }
    }
    @MainActor func testCameraNotificationPostingNeverWaitsForMainActor() async {
        let hardware = ControlledFaceCamera()
        let service = FaceGestureService(permission: { true }, workerFactory: { _, _ in hardware }, preferences: isolatedPreferences())
        service.start(); await settle { hardware.starts == 1 }
        hardware.completeStart(); await settle { service.isEnabled }
        let completed = DispatchSemaphore(value: 0)
        DispatchQueue.global().async {
            NotificationCenter.default.post(name: AVCaptureSession.runtimeErrorNotification, object: hardware.captureSession)
            completed.signal()
        }
        // Deliberately occupy main while capture posts, reproducing the old .main observer wait.
        XCTAssertEqual(completed.wait(timeout: .now() + 0.3), .success)
        await settle { service.isStopping }
        hardware.completeStop(); await settle { !service.isStopping }
        XCTAssertTrue(service.status.contains("interrupted"))
    }
    @MainActor func testAutomaticCalibrationAllowsVisibleSmallFaceAndRejectsOldOrientationFrames() async {
        let hardware = ControlledFaceCamera(), clock = FaceTestClock()
        let service = FaceGestureService(permission: { true }, workerFactory: { _, _ in hardware }, preferences: isolatedPreferences(), now: { clock.now })
        service.start(); await settle { hardware.starts == 1 }
        hardware.completeStart(); await settle { service.isEnabled }
        func send(_ t: Double, revision: Int = 0) {
            clock.set(t)
            let sample = FaceGestureSample(time: t, pitch: .nan, yaw: 0, smileWidth: 0.9,
                luminance: 0.14, confidence: 0.75, faceCount: 1, faceArea: 0.02,
                mouthOpen: 0.02, leftEyeOpen: 0.3, rightEyeOpen: 0.3)
            service.receive(FaceCameraFrame(sample: sample, face: CGRect(x: 0.4, y: 0.3, width: 0.1, height: 0.2), landmarks: [], orientationRevision: revision))
        }
        for i in 0...12 { send(Double(i) * 0.1) }
        XCTAssertTrue(service.calibrated, service.status)
        XCTAssertTrue(service.availableGestures.contains(.grin))
        XCTAssertFalse(service.availableGestures.contains(.nod), "Unavailable pitch must affect only nod")
        service.rotate(.landscapeLeft)
        XCTAssertFalse(service.calibrated)
        for i in 13...25 { send(Double(i) * 0.1) }
        XCTAssertFalse(service.calibrated, "Old orientation frames cannot rebuild calibration")
        for i in 26...38 { send(Double(i) * 0.1, revision: 1) }
        XCTAssertTrue(service.calibrated, service.status)
        service.stop(); hardware.completeStop(); await settle { !service.isStopping }
    }
    func testCameraGeometryRejectsInvalidBoundsAndHandlesRolledEyes() {
        XCTAssertNil(FaceCameraGeometry.validatedBox(CGRect(x: CGFloat.nan, y: 0, width: 0.2, height: 0.2)))
        XCTAssertNil(FaceCameraGeometry.validatedBox(CGRect(x: 0, y: 0, width: CGFloat.infinity, height: 0.2)))
        XCTAssertNil(FaceCameraGeometry.validatedBox(CGRect(x: 2, y: 2, width: 0.2, height: 0.2)))
        XCTAssertEqual(FaceCameraGeometry.validatedBox(CGRect(x: -0.1, y: 0.8, width: 0.3, height: 0.3))?.width ?? 0, 0.2, accuracy: 0.0001)
        let points = [CGPoint(x: -0.1, y: 0), CGPoint(x: 0, y: 0.02), CGPoint(x: 0.1, y: 0), CGPoint(x: 0, y: -0.02)]
        let rolled = points.map { CGPoint(x: $0.x * 0.8 - $0.y * 0.6, y: $0.x * 0.6 + $0.y * 0.8) }
        XCTAssertEqual(FaceCameraGeometry.aspect(points)!, FaceCameraGeometry.aspect(rolled)!, accuracy: 0.0001)
        XCTAssertNil(FaceCameraGeometry.aspect([CGPoint(x: CGFloat.nan, y: 0)]))
    }
}

extension FaceGestureServiceTests {
    @MainActor func testRotationWhilePermissionIsPendingStartsAtCurrentFrameRevision() async {
        let permission = CameraPermissionGate(), hardware = ControlledFaceCamera()
        let service = FaceGestureService(permission: { await permission.request() }, workerFactory: { _, _ in hardware }, preferences: isolatedPreferences())
        service.start()
        service.rotate(.landscapeRight)
        await permission.resolve(true)
        await settle { hardware.starts == 1 }
        XCTAssertEqual(hardware.revision, 1)
        hardware.completeStart(); await settle { service.isEnabled }
        service.stop(); hardware.completeStop(); await settle { !service.isStopping }
    }
}

extension FaceGestureServiceTests {
    @MainActor func testGrinRecognitionTestsWithoutDispatchAndReportsUnavailableRepContext() async {
        let hardware = ControlledFaceCamera(), clock = FaceTestClock()
        let service = FaceGestureService(permission: { true }, workerFactory: { _, _ in hardware }, preferences: isolatedPreferences(), now: { clock.now })
        service.start(); await settle { hardware.starts == 1 }
        hardware.completeStart(); await settle { service.isEnabled }
        var actions: [FaceGestureAction] = []
        service.onAction = { actions.append($0) }
        func send(_ tick: Int, smile: Double = 0.9) {
            let t = Double(tick) / 10; clock.set(t)
            let sample = FaceGestureSample(time: t, pitch: .nan, yaw: 0, smileWidth: smile,
                luminance: 0.3, confidence: 0.9, faceCount: 1, faceArea: 0.02)
            service.receive(FaceCameraFrame(sample: sample, face: nil, landmarks: []))
        }
        for i in 0...18 { send(i) }
        for i in 19...25 { send(i, smile: 1.05) }
        send(26)
        XCTAssertTrue(service.calibrated)
        XCTAssertTrue(service.lastGesture.contains("Grin"), service.lastGesture)
        XCTAssertTrue(service.lastGesture.contains("test only"), service.lastGesture)
        XCTAssertTrue(actions.isEmpty, "Settings must test expressions without turning pages or recording reps")
        service.actionsAllowed = true
        for i in 30...47 { send(i) }
        for i in 48...54 { send(i, smile: 1.05) }
        send(55); send(56)
        XCTAssertEqual(actions, [.nextPage], "One complete expression dispatches exactly one command")
        service.settings.allowVerdicts = true
        service.settings.assign(.grin, to: .clean)
        for i in 70...78 { send(i) }
        for i in 79...85 { send(i, smile: 1.05) }
        send(86)
        XCTAssertEqual(actions, [.nextPage], "Rep input additionally requires an eligible running set")
        XCTAssertTrue(service.lastGesture.localizedCaseInsensitiveContains("start a practice set"), service.lastGesture)
        service.stop(); hardware.completeStop(); await settle { !service.isStopping }
    }
}

extension FaceGestureServiceTests {
    @MainActor func testPreviewAcknowledgementOrdersCaptureWithoutSynchronouslyWaitingForMain() async {
        let queue = FaceCameraOperationQueue(label: "praelude.face-operation-test")
        let nextCapture = DispatchSemaphore(value: 0)
        let finished = expectation(description: "capture follows main preview")
        queue.onMain { XCTAssertTrue(Thread.isMainThread) }
        queue.perform { nextCapture.signal(); finished.fulfill() }
        // Main is intentionally busy. The background executor must not run capture past an
        // unacknowledged preview mutation, nor require a synchronous callback into this actor.
        XCTAssertEqual(nextCapture.wait(timeout: .now() + 0.1), .timedOut)
        await fulfillment(of: [finished], timeout: 2)
        XCTAssertEqual(nextCapture.wait(timeout: .now()), .success)
    }
}
