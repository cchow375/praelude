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
    @MainActor func testPhotoReservationTimeoutIsRecoverableWithoutOpeningCompetingCamera() async throws {
        let hardware = ControlledFaceCamera()
        let first = FaceGestureService(permission: { true }, workerFactory: { _, _ in hardware }, preferences: isolatedPreferences())
        first.start(); await settle { hardware.starts == 1 }
        let result = await FaceGestureService.reserveForPassageCapture(timeout: .milliseconds(5))
        XCTAssertNil(result)
        XCTAssertTrue(first.isStopping)
        hardware.completeStop(); await settle { !first.isStopping }
        let retry = await FaceGestureService.reserveForPassageCapture()
        let token = try XCTUnwrap(retry)
        FaceGestureService.releasePassageCapture(token)
        first.stop()
    }

    @MainActor func testPhotoReservationWaitsForHardwareShutdownAndBlocksOtherWindows() async throws {
        let hardware = ControlledFaceCamera()
        let first = FaceGestureService(permission: { true }, workerFactory: { _, _ in hardware }, preferences: isolatedPreferences())
        first.start()
        await settle { hardware.starts == 1 }
        hardware.completeStart()
        await settle { first.isEnabled }
        let reservation = Task { await FaceGestureService.reserveForPassageCapture() }
        await settle { first.isStopping }
        let duplicate = await FaceGestureService.reserveForPassageCapture()
        XCTAssertNil(duplicate)
        let second = FaceGestureService(permission: { false }, preferences: isolatedPreferences())
        second.start()
        XCTAssertFalse(second.isPreparing)
        XCTAssertTrue(second.status.contains("photographing"))
        hardware.completeStop()
        let result = await reservation.value
        let token = try XCTUnwrap(result)
        XCTAssertFalse(first.isEnabled)
        FaceGestureService.releasePassageCapture(UUID())
        second.start(); XCTAssertFalse(second.isPreparing)
        FaceGestureService.releasePassageCapture(token)
        second.start(); XCTAssertTrue(second.isPreparing)
        await settle { !second.isPreparing }
        second.stop(); first.stop()
    }

    @MainActor func testPhotoReservationRetiresPendingGesturePermissionGrant() async throws {
        let gate = CameraPermissionGate()
        let first = FaceGestureService(permission: { await gate.request() }, preferences: isolatedPreferences())
        first.start(); XCTAssertTrue(first.isPreparing)
        let result = await FaceGestureService.reserveForPassageCapture()
        let token = try XCTUnwrap(result)
        await gate.resolve(true)
        for _ in 0..<20 { await Task.yield() }
        XCTAssertFalse(first.isEnabled)
        XCTAssertNil(first.session)
        FaceGestureService.releasePassageCapture(token)
        first.stop()
    }

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
        service.settings.assign(.grin, to: .nextPage)
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
    @MainActor func testSourceSwitchRecalibratesOnceAndSmallVisionFaceCanTurnRight() async {
        let hardware = ControlledFaceCamera(), clock = FaceTestClock()
        let service = FaceGestureService(permission: { true }, workerFactory: { _, _ in hardware }, preferences: isolatedPreferences(), now: { clock.now })
        service.start(); await settle { hardware.starts == 1 }
        hardware.completeStart(); await settle { service.isEnabled }
        var actions: [FaceGestureAction] = []
        service.onAction = { actions.append($0) }
        func send(_ time: Double, source: FaceGesturePoseSource, area: Double, yaw: Double = 0) {
            clock.set(time)
            let sample = FaceGestureSample(time: time, pitch: 0, yaw: yaw, smileWidth: 0.9,
                luminance: 0.4, confidence: 0.9, faceCount: 1, faceArea: area, poseSource: source)
            service.receive(FaceCameraFrame(sample: sample, face: nil, landmarks: []))
        }
        for tick in 0...12 { send(Double(tick)/10, source: .arkit, area: 0.02) }
        XCTAssertTrue(service.calibrated)
        let originalContext = service.commandContextID
        send(1.3, source: .vision, area: 0.002)
        XCTAssertFalse(service.calibrated, "AR and Vision neutral coordinates must never be mixed")
        XCTAssertTrue(service.availableGestures.isEmpty)
        XCTAssertNotEqual(service.commandContextID, originalContext)
        XCTAssertTrue(actions.isEmpty)
        for tick in 14...28 { send(Double(tick)/10, source: .vision, area: 0.002) }
        XCTAssertTrue(service.calibrated, service.status)
        XCTAssertTrue(service.availableGestures.contains(.lookRight))
        XCTAssertFalse(service.availableGestures.contains(.grin), "Distant lip pixels must not pretend to be reliable expression measurements")
        service.actionsAllowed = true
        for tick in 29...32 { send(Double(tick)/10, source: .vision, area: 0.002) }
        send(3.3, source: .vision, area: 0.002, yaw: 0.05)
        send(3.4, source: .vision, area: 0.002, yaw: 0.11)
        XCTAssertEqual(actions, [.nextPage])
        XCTAssertTrue(service.lastGesture.contains("Look right"))
        service.stop(); hardware.completeStop(); await settle { !service.isStopping }
    }

    @MainActor func testTrackingLossAndDelayedFramesRetirePendingCommandWithoutInventingAction() async {
        let hardware = ControlledFaceCamera(), clock = FaceTestClock()
        let service = FaceGestureService(permission: { true }, workerFactory: { _, _ in hardware }, preferences: isolatedPreferences(), now: { clock.now })
        service.start(); await settle { hardware.starts == 1 }
        hardware.completeStart(); await settle { service.isEnabled }
        var actions: [FaceGestureAction] = []
        service.onAction = { actions.append($0) }; service.actionsAllowed = true
        func frame(_ time: Double, count: Int = 1) -> FaceCameraFrame {
            FaceCameraFrame(sample: FaceGestureSample(time: time, pitch: 0, yaw: 0, smileWidth: .nan,
                luminance: 0.4, confidence: count == 1 ? 0.9 : 0, faceCount: count,
                faceArea: count == 1 ? 0.002 : 0, poseSource: .arkit), face: nil, landmarks: [])
        }
        for tick in 0...12 { clock.set(Double(tick)/10); service.receive(frame(Double(tick)/10)) }
        XCTAssertTrue(service.calibrated)
        let beforeLoss = service.commandContextID
        clock.set(1.3); service.receive(frame(1.3, count: 0))
        XCTAssertNotEqual(service.commandContextID, beforeLoss)
        XCTAssertTrue(service.calibrated, "A brief same-source loss may preserve the neutral baseline")
        let retired = service.commandContextID
        clock.set(1.4); service.receive(frame(1.4, count: 0))
        XCTAssertEqual(service.commandContextID, retired)
        clock.set(1.5); service.receive(frame(1.5))
        let beforeMultiple = service.commandContextID
        clock.set(1.6); service.receive(frame(1.6, count: 2))
        XCTAssertNotEqual(service.commandContextID, beforeMultiple)
        XCTAssertTrue(service.status.contains("More than one face"))
        clock.set(1.7); service.receive(frame(1.7))
        let beforeDelay = service.commandContextID
        clock.set(3); service.receive(frame(1.8))
        XCTAssertNotEqual(service.commandContextID, beforeDelay)
        XCTAssertTrue(service.status.contains("Tracking delayed"))
        XCTAssertTrue(actions.isEmpty)
        service.stop(); hardware.completeStop(); await settle { !service.isStopping }
    }

    @MainActor func testRecognizedDownRepSurvivesTrackingLossButExplicitContextChangesStillCancel() async {
        let hardware = ControlledFaceCamera(), clock = FaceTestClock()
        let service = FaceGestureService(permission: { true }, workerFactory: { _, _ in hardware }, preferences: isolatedPreferences(), now: { clock.now })
        service.settings.allowVerdicts = true
        service.actionsAllowed = true; service.verdictActionsAllowed = true
        service.start(); await settle { hardware.starts == 1 }
        hardware.completeStart(); await settle { service.isEnabled }
        var actions: [FaceGestureAction] = []
        var acceptedContext: UUID?
        service.onAction = { action in
            actions.append(action)
            acceptedContext = service.commandContextID
            // Matches ScoreWorkspace's synchronous dispatch before preparing the durable rep.
            service.commandInFlight = true
        }
        func send(_ time: Double, pitch: Double = 0, count: Int = 1, source: FaceGesturePoseSource = .arkit) {
            clock.set(time)
            let sample = FaceGestureSample(time: time, pitch: pitch, yaw: 0, smileWidth: .nan,
                luminance: 0.4, confidence: count == 1 ? 0.9 : 0, faceCount: count,
                faceArea: count == 1 ? 0.002 : 0, poseSource: source)
            service.receive(FaceCameraFrame(sample: sample, face: nil, landmarks: []))
        }
        for tick in 0...12 { send(Double(tick)/10) }
        send(1.3, pitch: 0.055); send(1.4, pitch: 0.13)
        XCTAssertEqual(actions, [.clean], "A measured quick downward look must dispatch the rep first")
        XCTAssertNotNil(acceptedContext)
        XCTAssertTrue(service.commandInFlight)
        send(1.5, count: 0)
        XCTAssertEqual(service.commandContextID, acceptedContext)
        clock.set(2.5)
        service.receive(FaceCameraFrame(sample: FaceGestureSample(time: 1.6, pitch: .nan, yaw: .nan,
            smileWidth: .nan, luminance: 0.5, confidence: 0, faceCount: 0, faceArea: 0, poseSource: .arkit), face: nil, landmarks: []))
        XCTAssertEqual(service.commandContextID, acceptedContext)
        send(2.6, source: .vision)
        XCTAssertFalse(service.calibrated, "Future input still requires the new source's neutral calibration")
        XCTAssertEqual(service.commandContextID, acceptedContext, "Same-camera fallback cannot retract an already recognized rep")
        XCTAssertEqual(actions, [.clean])

        service.settings.assign(.grin, to: .clean)
        XCTAssertNotEqual(service.commandContextID, acceptedContext, "Explicit remapping still retires accepted input")
        let remapped = service.commandContextID
        service.actionsAllowed = false; service.actionsAllowed = true
        XCTAssertNotEqual(service.commandContextID, remapped, "Closing and reopening the score gate cannot revive input")
        let gated = service.commandContextID
        service.stop()
        XCTAssertNotEqual(service.commandContextID, gated, "Explicit camera Off still cancels pending input")
        XCTAssertFalse(service.isEnabled)
        XCTAssertEqual(actions, [.clean])
        service.commandInFlight = false
        hardware.completeStop(); await settle { !service.isStopping }
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


extension FaceGestureServiceTests {
    @MainActor func testBusyUIReceivesNewestCameraFrameWithoutBacklog() async {
        var delivered: [Double] = []
        let first = expectation(description: "latest frame only")
        let delivery = FaceCameraFrameDelivery { frame in delivered.append(frame.sample.time); first.fulfill() }
        // Main is intentionally occupied by submitting a burst. Capture remains nonblocking and
        // obsolete frames cannot later replay old expressions or flood UI layout.
        for tick in 0..<1000 {
            let sample = FaceGestureSample(time: Double(tick), pitch: 0, yaw: 0, smileWidth: 0.9,
                luminance: 0.4, confidence: 1, faceCount: 1, faceArea: 0.1)
            delivery.submit(FaceCameraFrame(sample: sample, face: nil, landmarks: []))
        }
        XCTAssertTrue(delivered.isEmpty)
        await fulfillment(of: [first], timeout: 2)
        XCTAssertEqual(delivered, [999])
    }
    func testSmileLiftUsesBothCornersAndIsRollAndEyeOrderInvariant() {
        let lips = [CGPoint(x: -0.5,y: 0.12),CGPoint(x: -0.45,y: 0.11),
                    CGPoint(x: -0.2,y: 0.02),CGPoint(x: 0,y: 0.04),CGPoint(x: 0.2,y: 0.02),
                    CGPoint(x: 0.45,y: 0.11),CGPoint(x: 0.5,y: 0.12),
                    CGPoint(x: 0.2,y: -0.02),CGPoint(x: 0,y: -0.04),CGPoint(x: -0.2,y: -0.02)]
        let left=CGPoint(x: -0.5,y: 0.6), right=CGPoint(x: 0.5,y: 0.6)
        let value=FaceCameraGeometry.lipCornerLift(lips,leftEye:left,rightEye:right)!
        XCTAssertGreaterThan(value, 0.08)
        XCTAssertEqual(value,FaceCameraGeometry.lipCornerLift(lips,leftEye:right,rightEye:left)!,accuracy:0.0001)
        func rotate(_ p:CGPoint)->CGPoint { CGPoint(x:p.x*0.8-p.y*0.6,y:p.x*0.6+p.y*0.8) }
        XCTAssertEqual(value,FaceCameraGeometry.lipCornerLift(lips.map(rotate),leftEye:rotate(left),rightEye:rotate(right))!,accuracy:0.0001)
        XCTAssertNil(FaceCameraGeometry.lipCornerLift([CGPoint(x:CGFloat.nan,y:0)],leftEye:left,rightEye:right))
    }
    @MainActor func testPendingCommandContextIsRetiredByStopRemapAndGateRoundTrip() {
        let suite = "Praelude-CommandContext-\(UUID().uuidString)"
        let preferences = UserDefaults(suiteName: suite)!
        defer { preferences.removePersistentDomain(forName: suite) }
        let service = FaceGestureService(preferences: preferences)
        let original = service.commandContextID
        service.showPreview.toggle()
        XCTAssertEqual(service.commandContextID, original, "Rendering preferences must not retire an input")
        service.stop()
        XCTAssertNotEqual(service.commandContextID, original)
        let stopped = service.commandContextID
        service.settings.holdDuration = 0.6
        XCTAssertNotEqual(service.commandContextID, stopped)
        service.actionsAllowed = true
        let allowed = service.commandContextID
        service.actionsAllowed = false
        service.actionsAllowed = true
        XCTAssertNotEqual(service.commandContextID, allowed, "Reopening a gate cannot revive a pending command")
        let restored = service.commandContextID
        service.calibrate()
        XCTAssertNotEqual(service.commandContextID, restored)
    }

}
