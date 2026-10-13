import XCTest
@testable import PraeludeCore

final class FaceGestureDetectionTests: XCTestCase {
    private func directionReady(settings: FaceGestureSettings = .init(), pitch: Double = 0,
                                yaw: Double = 0, area: Double = 0.1,
                                source: FaceGesturePoseSource = .unspecified) -> FaceGestureDetector {
        var d = FaceGestureDetector()
        d.configure(settings: settings)
        XCTAssertTrue(d.calibrate((0...10).map {
            sample(Double($0)/10, pitch: pitch, yaw: yaw, confidence: 0.45, area: area, source: source)
        }))
        for n in 11...17 {
            XCTAssertNil(d.consume(sample(Double(n)/10, pitch: pitch, yaw: yaw, confidence: 0.45, area: area, source: source)))
        }
        return d
    }

    func testDirectionalOnsetFiresRightLeftAndDownBeforeAnyReturnOrExpressionHold() {
        for gesture in [FaceGesture.lookRight, .lookLeft, .lookDown] {
            var settings = FaceGestureSettings(); settings.holdDuration = 1.2; settings.cooldown = 3
            var d = directionReady(settings: settings)
            let sign = gesture == .lookLeft ? -1.0 : 1.0
            XCTAssertNil(d.consume(sample(1.8, pitch: gesture == .lookDown ? 0.055 : 0, yaw: gesture == .lookDown ? 0 : sign * 0.05)))
            XCTAssertEqual(d.consume(sample(1.9, pitch: gesture == .lookDown ? 0.11 : 0, yaw: gesture == .lookDown ? 0 : sign * 0.10)), gesture)
        }
    }
    func testPianoDistanceSmallFaceKeepsHeadPoseWithoutTrustingTinyLipPixels() {
        var d = directionReady(area: 0.002, source: .vision)
        XCTAssertTrue(d.availableGestures.contains(.lookRight))
        XCTAssertFalse(d.availableGestures.contains(.grin))
        XCTAssertFalse(d.availableGestures.contains(.eyesClosed))
        XCTAssertNil(d.consume(sample(1.8, yaw: 0.05, confidence: 0.45, area: 0.002, source: .vision)))
        XCTAssertEqual(d.consume(sample(1.9, yaw: 0.10, confidence: 0.45, area: 0.002, source: .vision)), .lookRight)
        XCTAssertFalse(sample(2, area: 0.0019).usable)
    }
    func testDownUsesCalibratedPianoReadingPostureRatherThanAnAbsolutePitch() {
        var d = directionReady(pitch: 0.45, yaw: 0.12)
        XCTAssertNil(d.consume(sample(1.8, pitch: 0.505, yaw: 0.12)))
        XCTAssertEqual(d.consume(sample(1.9, pitch: 0.565, yaw: 0.12)), .lookDown)
    }
    func testDirectionalOneFrameSpikesSmallPianoSwayAndBlinksNeverDispatch() {
        var d = directionReady()
        XCTAssertNil(d.consume(sample(1.8, yaw: 0.35)))
        XCTAssertNil(d.consume(sample(1.9)))
        for n in 20...100 {
            XCTAssertNil(d.consume(sample(Double(n)/10, pitch: 0.03 * sin(Double(n)),
                yaw: 0.025 * cos(Double(n)), leftEye: n % 7 == 0 ? 0.01 : 0.3, rightEye: n % 7 == 0 ? 0.01 : 0.3)))
        }
        d = directionReady()
        for n in 18...35 { XCTAssertNil(d.consume(sample(Double(n)/10, pitch: Double(n-17) * 0.008))) }
    }
    func testHeldTurnAndOppositeReturnSweepDoNotRepeatButCenteredCorrectionIsQuick() {
        var d = directionReady()
        XCTAssertNil(d.consume(sample(1.8, yaw: 0.05)))
        XCTAssertEqual(d.consume(sample(1.9, yaw: 0.11)), .lookRight)
        for n in 20...35 { XCTAssertNil(d.consume(sample(Double(n)/10, yaw: 0.13))) }
        XCTAssertNil(d.consume(sample(3.6)))
        XCTAssertNil(d.consume(sample(3.7, yaw: -0.08)))
        XCTAssertNil(d.consume(sample(3.8, yaw: -0.12)), "A sweep through center is not a second command")
        for n in 39...41 { XCTAssertNil(d.consume(sample(Double(n)/10))) }
        XCTAssertNil(d.consume(sample(4.2, yaw: -0.05)))
        XCTAssertEqual(d.consume(sample(4.3, yaw: -0.11)), .lookLeft)

        d = directionReady()
        XCTAssertNil(d.consume(sample(1.8, yaw: 0.05)))
        XCTAssertEqual(d.consume(sample(1.9, yaw: 0.11)), .lookRight)
        for n in 20...22 { XCTAssertNil(d.consume(sample(Double(n)/10))) }
        XCTAssertNil(d.consume(sample(2.3, yaw: -0.05)))
        XCTAssertEqual(d.consume(sample(2.4, yaw: -0.11)), .lookLeft, "Directional interval is independent of the legacy1.25s interval")
    }
    func testAmbiguousDiagonalAndCompetingLegacyHeadGesturesCannotDoubleDispatch() {
        var settings = FaceGestureSettings(); settings.assign(.nod, to: .again)
        XCTAssertEqual(settings.suspendedGestures, [.nod, .shake])
        var d = directionReady(settings: settings)
        XCTAssertNil(d.consume(sample(1.8, pitch: 0.08, yaw: 0.075)))
        XCTAssertNil(d.consume(sample(1.9, pitch: 0.13, yaw: 0.12)))
        for n in 20...23 { XCTAssertNil(d.consume(sample(Double(n)/10))) }
        XCTAssertNil(d.consume(sample(2.4, pitch: 0.055)))
        XCTAssertEqual(d.consume(sample(2.5, pitch: 0.11)), .lookDown)
        for n in 26...30 { XCTAssertNil(d.consume(sample(Double(n)/10, pitch: 0.15))) }
        XCTAssertNil(d.consume(sample(3.1)), "Returning must not finish the legacy Nod→Again")
    }
    func testSignedPrelossMotionNeedsMeasuredReacquisitionAndCanFinishOnlyOnePageTurn() {
        for sign in [-1.0, 1.0] {
            for reacquiredYaw in [0.0, sign * 0.11] {
                var d = directionReady()
                XCTAssertNil(d.consume(sample(1.8, yaw: sign * 0.045)))
                XCTAssertNil(d.consume(sample(1.9, yaw: sign * 0.075)))
                XCTAssertNil(d.consume(sample(2.0, pitch: .nan, yaw: .nan, faces: 0, confidence: 0, area: 0)))
                XCTAssertNil(d.consume(sample(2.05, pitch: .nan, yaw: .nan, faces: 0, confidence: 0, area: 0)))
                XCTAssertEqual(d.consume(sample(2.1, yaw: reacquiredYaw)), sign > 0 ? .lookRight : .lookLeft)
                XCTAssertNil(d.consume(sample(2.2, yaw: reacquiredYaw)))
            }
        }
    }
    func testLossWithoutRisingEvidenceLongLossOppositeReturnAndUnsafeQualityNeverInferDirection() {
        for reason in 0...5 {
            var d = directionReady()
            XCTAssertNil(d.consume(sample(1.8, yaw: reason == 0 ? 0 : reason == 5 ? 0.075 : 0.045)))
            if reason != 0 { XCTAssertNil(d.consume(sample(1.9, yaw: 0.075))) }
            switch reason {
            case 1: XCTAssertNil(d.consume(sample(2.0, light: 0.01)))
            case 2: XCTAssertNil(d.consume(sample(2.0, faces: 2)))
            default: XCTAssertNil(d.consume(sample(2.0, pitch: .nan, yaw: .nan, faces: 0, confidence: 0, area: 0)))
            }
            XCTAssertNil(d.consume(sample(reason == 3 ? 2.25 : 2.1, yaw: reason == 4 ? -0.11 : 0)))
        }
        var d = directionReady()
        XCTAssertNil(d.consume(sample(1.8, yaw: 0.075)))
        XCTAssertNil(d.consume(sample(1.9, faces: 0, confidence: 0, area: 0)))
        XCTAssertNil(d.consume(sample(2.0)))
    }
    func testNeutralReacquisitionAfterDownLossNeverInventsARep() {
        var d = directionReady()
        XCTAssertNil(d.consume(sample(1.8, pitch: 0.055)))
        XCTAssertNil(d.consume(sample(1.9, pitch: 0.085)))
        XCTAssertNil(d.consume(sample(2.0, faces: 0, confidence: 0, area: 0)))
        XCTAssertNil(d.consume(sample(2.1)))
    }
    func testSourceSwitchAndMixedSourceCalibrationCannotCombineMeasurements() {
        var d = directionReady(source: .arkit)
        XCTAssertNil(d.consume(sample(1.8, yaw: 0.05, source: .arkit)))
        XCTAssertNil(d.consume(sample(1.9, yaw: 0.12, source: .vision)))
        XCTAssertNil(d.baseline)
        let mixed = (0...10).map { sample(Double($0)/10, source: $0 % 2 == 0 ? .arkit : .vision) }
        XCTAssertFalse(d.calibrate(mixed))
        XCTAssertNil(d.consume(sample(.nan, yaw: 0.3)))
    }
    func testMissingOptionalAxisDoesNotBlockMeasuredDirectionOrArmItself() {
        var d = directionReady(); d.resetMotion()
        for n in 18...20 { XCTAssertNil(d.consume(sample(Double(n)/10, pitch: .nan))) }
        XCTAssertNil(d.consume(sample(2.1, pitch: .nan, yaw: 0.05)))
        XCTAssertEqual(d.consume(sample(2.2, pitch: .nan, yaw: 0.11)), .lookRight)

        d = directionReady(); d.resetMotion()
        for n in 18...20 { XCTAssertNil(d.consume(sample(Double(n)/10, yaw: .nan))) }
        XCTAssertNil(d.consume(sample(2.1, pitch: 0.055, yaw: .nan)))
        XCTAssertEqual(d.consume(sample(2.2, pitch: 0.11, yaw: .nan)), .lookDown)

        d = directionReady(); d.resetMotion()
        for n in 18...20 { XCTAssertNil(d.consume(sample(Double(n)/10, pitch: .nan))) }
        XCTAssertNil(d.consume(sample(2.1, pitch: 0.11)))
        XCTAssertNil(d.consume(sample(2.2, pitch: 0.12)), "Missing pitch must not count as measured down-neutral")

        d = directionReady(); d.resetMotion()
        for n in 18...20 { XCTAssertNil(d.consume(sample(Double(n)/10, yaw: 0.2))) }
        XCTAssertNil(d.consume(sample(2.1, pitch: 0.055, yaw: 0.22)))
        XCTAssertNil(d.consume(sample(2.2, pitch: 0.11, yaw: 0.25)), "A known held other-axis offset still blocks fresh arming")
    }
    func testYawWrapCalibrationAndDirectionTreatPiSeamAsSmallMovement() {
        var d = FaceGestureDetector()
        let center = Double.pi - 0.01
        XCTAssertTrue(d.calibrate((0...10).map { sample(Double($0)/10, yaw: $0 % 2 == 0 ? center : -Double.pi + 0.01) }))
        XCTAssertTrue(d.availableGestures.contains(.lookRight))
        for n in 11...17 { XCTAssertNil(d.consume(sample(Double(n)/10, yaw: center))) }
        XCTAssertNil(d.consume(sample(1.8, yaw: -Double.pi + 0.04)))
        XCTAssertEqual(d.consume(sample(1.9, yaw: -Double.pi + 0.10)), .lookRight)
    }
    func testMigrationMovesExistingNodVerdictOnceAndPreservesLaterCustomization() throws {
        let legacy = Data(#"{"nod":"again","shake":"sloppy","grin":"nextPage","mouthOpen":"clean","eyesClosed":"previousPage","allowVerdicts":true,"sensitivity":"easy","holdDuration":0.8,"cooldown":2}"#.utf8)
        var settings = try JSONDecoder().decode(FaceGestureSettings.self, from: legacy)
        XCTAssertEqual(settings.lookDown, .again); XCTAssertEqual(settings.nod, .off)
        XCTAssertEqual(settings.lookRight, .nextPage); XCTAssertEqual(settings.lookLeft, .previousPage)
        XCTAssertEqual(settings.mouthOpen, .clean); XCTAssertEqual(settings.shake, .sloppy)
        XCTAssertEqual(settings.grin, .off); XCTAssertEqual(settings.eyesClosed, .off)
        XCTAssertTrue(settings.allowVerdicts); XCTAssertEqual(settings.holdDuration, 0.8)
        XCTAssertEqual(settings.cooldown, 2); XCTAssertEqual(settings.sensitivity, .easy)
        settings.assign(nil, to: .nextPage); settings.assign(.grin, to: .previousPage)
        settings.directionCooldown = 0.7
        let reloaded = try JSONDecoder().decode(FaceGestureSettings.self, from: JSONEncoder().encode(settings))
        XCTAssertEqual(reloaded, settings)
        XCTAssertNil(reloaded.gesture(for: .nextPage)); XCTAssertEqual(reloaded.gesture(for: .previousPage), .grin)
    }
    private func sample(_ t: Double, pitch: Double = 0, yaw: Double = 0, smile: Double = 0.8,
                        light: Double = 0.5, faces: Int = 1, confidence: Double = 0.99, area: Double = 0.1,
                        mouth: Double? = 0.02, leftEye: Double? = 0.3, rightEye: Double? = 0.3,
                        lift: Double? = nil, strength: Double? = nil, source: FaceGesturePoseSource = .unspecified) -> FaceGestureSample {
        .init(time: t, pitch: pitch, yaw: yaw, smileWidth: smile, luminance: light,
              confidence: confidence, faceCount: faces, faceArea: area,
              mouthOpen: mouth, leftEyeOpen: leftEye, rightEyeOpen: rightEye, smileLift: lift, smileStrength: strength, poseSource: source)
    }
    private static func legacySettings() -> FaceGestureSettings {
        var settings = FaceGestureSettings()
        for action in FaceGestureAction.allCases { settings.assign(nil, to: action) }
        settings.assign(.nod, to: .clean); settings.assign(.shake, to: .sloppy); settings.assign(.grin, to: .nextPage)
        return settings
    }
    private func ready(settings: FaceGestureSettings = FaceGestureDetectionTests.legacySettings(), calibration: [FaceGestureSample]? = nil) -> FaceGestureDetector {
        var detector = FaceGestureDetector()
        detector.configure(settings: settings)
        XCTAssertTrue(detector.calibrate(calibration ?? (0...10).map { sample(Double($0)/10) }))
        for n in 11...17 { XCTAssertNil(detector.consume(sample(Double(n)/10))) }
        return detector
    }
    private func only(_ gesture: FaceGesture) -> FaceGestureSettings {
        var settings = FaceGestureSettings()
        for action in FaceGestureAction.allCases { settings.assign(nil, to: action) }
        settings.assign(gesture, to: .nextPage)
        return settings
    }

    func testFullNodAndReturnDispatchOnceAndRequireNeutralRearm() {
        var d = ready()
        XCTAssertNil(d.consume(sample(1.8, pitch: 0.25)))
        XCTAssertNil(d.consume(sample(1.95, pitch: 0.25)))
        XCTAssertEqual(d.consume(sample(2.1)), .nod)
        for n in 22...36 { XCTAssertNil(d.consume(sample(Double(n)/10, pitch: 0.25))) }
        for n in 37...43 { XCTAssertNil(d.consume(sample(Double(n)/10))) }
        XCTAssertNil(d.consume(sample(4.4, pitch: 0.25)))
        XCTAssertNil(d.consume(sample(4.55, pitch: 0.25)))
        XCTAssertEqual(d.consume(sample(4.7)), .nod)
    }
    func testNodWorksInEitherPitchDirectionAndAtNaturalTenHzCadence() {
        for direction in [-1.0, 1.0] {
            var d = ready()
            XCTAssertNil(d.consume(sample(1.8, pitch: direction * 0.22)))
            XCTAssertNil(d.consume(sample(1.9, pitch: direction * 0.12)))
            XCTAssertEqual(d.consume(sample(2.0)), .nod)
        }
    }
    func testOneFramePoseSpikeDoesNotCountAsNod() {
        var d = ready()
        XCTAssertNil(d.consume(sample(1.8, pitch: 0.3)))
        XCTAssertNil(d.consume(sample(2.05)))
        XCTAssertNil(d.consume(sample(2.2)))
    }
    func testShakeRequiresBothDirectionsAndReturn() {
        for direction in [-1.0, 1.0] {
            var d = ready()
            XCTAssertNil(d.consume(sample(1.8, yaw: direction * 0.3)))
            XCTAssertNil(d.consume(sample(2.0, yaw: -direction * 0.3)))
            XCTAssertEqual(d.consume(sample(2.2)), .shake)
        }
        var d = ready()
        XCTAssertNil(d.consume(sample(1.8, yaw: 0.3)))
        XCTAssertNil(d.consume(sample(2.0)))
    }
    func testGrinMustHoldAndReleaseAndCannotRemainOnFace() {
        var d = ready()
        for n in 18...24 { XCTAssertNil(d.consume(sample(Double(n)/10, smile: 1.0))) }
        XCTAssertEqual(d.consume(sample(2.5)), .grin)
        d = ready()
        XCTAssertNil(d.consume(sample(1.8, smile: 1.0)))
        XCTAssertNil(d.consume(sample(1.9)))
    }
    func testMouthOpeningHoldsAndReleasesWithoutDispatchWhileHeld() {
        var d = ready(settings: only(.mouthOpen))
        for n in 18...24 { XCTAssertNil(d.consume(sample(Double(n)/10, mouth: 0.24))) }
        XCTAssertEqual(d.consume(sample(2.5)), .mouthOpen)
        for n in 26...40 { XCTAssertNil(d.consume(sample(Double(n)/10, mouth: 0.24))) }
    }
    func testOrdinaryBlinkAndOneEyeClosureNeverDispatch() {
        var d = ready(settings: only(.eyesClosed))
        XCTAssertNil(d.consume(sample(1.8, leftEye: 0.03, rightEye: 0.03)))
        XCTAssertNil(d.consume(sample(1.9, leftEye: 0.03, rightEye: 0.03)))
        XCTAssertNil(d.consume(sample(2.0)))
        d = ready(settings: only(.eyesClosed))
        for n in 18...28 { XCTAssertNil(d.consume(sample(Double(n)/10, leftEye: 0.03))) }
        XCTAssertNil(d.consume(sample(2.9)))
    }
    func testDeliberateBothEyesClosedRequiresHoldAndReopeningEvenAtShortestHoldSetting() {
        var settings = only(.eyesClosed)
        settings.holdDuration = 0.2
        var d = ready(settings: settings)
        for n in 18...25 { XCTAssertNil(d.consume(sample(Double(n)/10, leftEye: 0.03, rightEye: 0.03))) }
        XCTAssertEqual(d.consume(sample(2.6)), .eyesClosed)
    }
    func testVisibleSmallFaceInDimRoomCanCalibrateAndGesture() {
        let calibration = (0...10).map { sample(Double($0)/10, light: 0.07, confidence: 0.62, area: 0.009) }
        var d = ready(calibration: calibration)
        XCTAssertNil(d.consume(sample(1.8, pitch: 0.25, light: 0.07, confidence: 0.62, area: 0.009)))
        XCTAssertNil(d.consume(sample(1.95, pitch: 0.25, light: 0.07, confidence: 0.62, area: 0.009)))
        XCTAssertEqual(d.consume(sample(2.1, light: 0.07, confidence: 0.62, area: 0.009)), .nod)
    }
    func testMissingLipAndEyeLandmarksDoNotDisableHeadGestures() {
        let calibration = (0...10).map { sample(Double($0)/10, smile: .nan, mouth: nil, leftEye: nil, rightEye: nil) }
        var d = ready(calibration: calibration)
        XCTAssertEqual(d.availableGestures, [.nod, .shake, .lookDown, .lookLeft, .lookRight])
        XCTAssertNil(d.consume(sample(1.8, pitch: 0.25, smile: .nan, mouth: nil, leftEye: nil, rightEye: nil)))
        XCTAssertNil(d.consume(sample(1.95, pitch: 0.25, smile: .nan, mouth: nil, leftEye: nil, rightEye: nil)))
        XCTAssertEqual(d.consume(sample(2.1, smile: .nan, mouth: nil, leftEye: nil, rightEye: nil)), .nod)
    }
    func testMissingHeadPoseDoesNotMarkVisibleFaceUnclearOrDisableGrin() {
        func noPose(_ t: Double, smile: Double = 0.8) -> FaceGestureSample {
            sample(t, pitch: .nan, yaw: .nan, smile: smile, mouth: nil, leftEye: nil, rightEye: nil)
        }
        var d = FaceGestureDetector()
        d.configure(settings: Self.legacySettings())
        XCTAssertTrue(noPose(0).usable)
        XCTAssertTrue(d.calibrate((0...10).map { noPose(Double($0)/10) }))
        XCTAssertEqual(d.availableGestures, [.grin])
        for n in 11...17 { XCTAssertNil(d.consume(noPose(Double(n)/10))) }
        for n in 18...24 { XCTAssertNil(d.consume(noPose(Double(n)/10, smile: 1.0))) }
        XCTAssertEqual(d.consume(noPose(2.5)), .grin)
    }
    func testExpressionsCalibrateWithoutOtherLandmarksOrHeadPose() {
        for gesture in [FaceGesture.mouthOpen, .eyesClosed] {
            var d = FaceGestureDetector()
        d.configure(settings: Self.legacySettings())
            d.configure(settings: only(gesture))
            func expression(_ t: Double, active: Bool = false) -> FaceGestureSample {
                sample(t, pitch: .nan, yaw: .nan, smile: .nan,
                       mouth: gesture == .mouthOpen ? (active ? 0.25 : 0.02) : nil,
                       leftEye: gesture == .eyesClosed ? (active ? 0.03 : 0.3) : nil,
                       rightEye: gesture == .eyesClosed ? (active ? 0.03 : 0.3) : nil)
            }
            XCTAssertTrue(d.calibrate((0...10).map { expression(Double($0)/10) }))
            XCTAssertTrue(d.availableGestures.contains(gesture))
            for n in 11...17 { XCTAssertNil(d.consume(expression(Double(n)/10))) }
            for n in 18...25 { XCTAssertNil(d.consume(expression(Double(n)/10, active: true))) }
            XCTAssertEqual(d.consume(expression(2.6)), gesture)
        }
    }
    func testOnlyTheUnstableMetricLosesEligibilityDuringCalibration() {
        var d = FaceGestureDetector()
        d.configure(settings: Self.legacySettings())
        XCTAssertTrue(d.calibrate((0...10).map { sample(Double($0)/10, pitch: Double($0)/10) }))
        XCTAssertFalse(d.availableGestures.contains(.nod))
        XCTAssertTrue(d.availableGestures.contains(.grin))
        XCTAssertTrue(d.availableGestures.contains(.shake))
    }
    func testSupplementRecoversInitiallyMissingPitchAtEstablishedNeutral() {
        var d = FaceGestureDetector()
        d.configure(settings: Self.legacySettings())
        XCTAssertTrue(d.calibrate((0...10).map {
            sample(Double($0)/10, pitch: .nan, yaw: .nan, mouth: nil, leftEye: nil, rightEye: nil)
        }))
        XCTAssertEqual(d.availableGestures, [.grin])
        XCTAssertTrue(d.supplementCalibration((20...30).map { sample(Double($0)/10) }))
        XCTAssertTrue(d.availableGestures.contains(.nod))
        XCTAssertTrue(d.availableGestures.contains(.grin))
        for n in 31...37 { XCTAssertNil(d.consume(sample(Double(n)/10))) }
        XCTAssertNil(d.consume(sample(3.8, pitch: 0.22)))
        XCTAssertNil(d.consume(sample(3.9, pitch: 0.12)))
        XCTAssertEqual(d.consume(sample(4.0)), .nod)
    }
    func testSupplementRejectsHeldExistingExpressionAndShiftedExistingHeadPose() {
        var grinOnly = FaceGestureDetector()
        XCTAssertTrue(grinOnly.calibrate((0...10).map {
            sample(Double($0)/10, pitch: .nan, yaw: .nan, mouth: nil, leftEye: nil, rightEye: nil)
        }))
        let oldGrin = grinOnly.baseline
        XCTAssertFalse(grinOnly.supplementCalibration((20...30).map { sample(Double($0)/10, smile: 1.0) }))
        XCTAssertEqual(grinOnly.baseline, oldGrin)
        XCTAssertEqual(grinOnly.availableGestures, [.grin])
        var withPitch = FaceGestureDetector()
        XCTAssertTrue(withPitch.calibrate((0...10).map { sample(Double($0)/10, yaw: .nan) }))
        let oldPitch = withPitch.baseline
        XCTAssertFalse(withPitch.supplementCalibration((20...30).map { sample(Double($0)/10, pitch: 0.2) }))
        XCTAssertEqual(withPitch.baseline, oldPitch)
        XCTAssertFalse(withPitch.availableGestures.contains(.shake))
    }
    func testSupplementPreservesEveryExistingMetricExactlyAndNoExpansionKeepsMotion() {
        var d = FaceGestureDetector()
        d.configure(settings: Self.legacySettings())
        XCTAssertTrue(d.calibrate((0...10).map {
            sample(Double($0)/10, pitch: 0.031, yaw: .nan, smile: 0.812345, mouth: 0.023,
                   leftEye: nil, rightEye: nil)
        }))
        let original = d.baseline!
        XCTAssertTrue(d.supplementCalibration((20...30).map {
            sample(Double($0)/10, pitch: 0.045, yaw: 0.04, smile: 0.82, mouth: 0.03)
        }))
        XCTAssertEqual(d.baseline?.pitch, original.pitch)
        XCTAssertEqual(d.baseline?.smileWidth, original.smileWidth)
        XCTAssertEqual(d.baseline?.mouthOpen, original.mouthOpen)
        XCTAssertEqual(d.baseline?.yaw, 0.04)
        XCTAssertEqual(d.availableGestures, Set(FaceGesture.allCases))

        d = ready()
        for n in 18...23 { XCTAssertNil(d.consume(sample(Double(n)/10, smile: 1.0))) }
        XCTAssertFalse(d.supplementCalibration((13...23).map {
            sample(Double($0)/10, smile: $0 >= 18 ? 1.0 : 0.8)
        }))
        XCTAssertNil(d.consume(sample(2.4, smile: 1.0)))
        XCTAssertEqual(d.consume(sample(2.5)), .grin)
    }
    func testMedianCalibrationToleratesOneLandmarkOutlierAndBriefMissingMetric() {
        var samples = (0...10).map { sample(Double($0)/10) }
        samples[5].pitch = 2
        samples[3].smileWidth = .nan
        samples[7].smileWidth = .nan
        var d = FaceGestureDetector()
        d.configure(settings: Self.legacySettings())
        XCTAssertTrue(d.calibrate(samples))
        XCTAssertEqual(d.baseline?.pitch, 0)
        XCTAssertEqual(d.baseline?.smileWidth, 0.8)
        XCTAssertTrue(d.availableGestures.contains(.nod))
        XCTAssertTrue(d.availableGestures.contains(.grin))
    }
    func testCalibrationRejectsInvisibleMultipleSparseNonfiniteAndEntirelyUnmeasuredFaces() {
        var d = FaceGestureDetector()
        d.configure(settings: Self.legacySettings())
        for invalid in [sample(0, light: 0.01), sample(0, faces: 2), sample(0, confidence: 0.3),
                        sample(0, area: 0.0019), sample(.nan)] {
            XCTAssertFalse(d.calibrate((0...10).map { n in var s = invalid; s.time += Double(n)/10; return s }))
            XCTAssertNil(d.baseline)
        }
        XCTAssertFalse(d.calibrate([sample(0), sample(1)]))
        XCTAssertFalse(d.calibrate((0...10).map {
            sample(Double($0)/10, pitch: .nan, yaw: .nan, smile: .nan, mouth: nil, leftEye: nil, rightEye: nil)
        }))
        XCTAssertNil(d.baseline)
        XCTAssertFalse(d.calibrate((0...10).map {
            sample(Double($0)/10, pitch: Double($0)/10, yaw: Double($0)/10, smile: 0.5 + Double($0)/10,
                   mouth: nil, leftEye: nil, rightEye: nil)
        }))
    }
    func testQualityLossStaleFramesMixedMotionAndFocusResetCannotDispatch() {
        for bad in [sample(1.9, light: 0.01), sample(1.9, faces: 2), sample(1.7), sample(3.0),
                    sample(1.9, confidence: 0.2), sample(1.9, area: 0.001)] {
            var d = ready(); XCTAssertNil(d.consume(sample(1.8, pitch: 0.25)))
            XCTAssertNil(d.consume(bad)); XCTAssertNil(d.consume(sample(3.1)))
        }
        var d = ready(); XCTAssertNil(d.consume(sample(1.8, pitch: 0.25)))
        d.resetMotion(); XCTAssertNil(d.consume(sample(1.9)))
        d = ready(); XCTAssertNil(d.consume(sample(1.8, pitch: 0.25)))
        XCTAssertNil(d.consume(sample(1.9, yaw: 0.3))); XCTAssertNil(d.consume(sample(2)))
    }
    func testProlongedRequiredMetricLossAfterHoldingCannotDispatchOnReappearance() {
        var d = ready(settings: only(.mouthOpen))
        for n in 18...24 { XCTAssertNil(d.consume(sample(Double(n)/10, mouth: 0.25))) }
        for t in [2.5, 2.7, 2.9] { XCTAssertNil(d.consume(sample(t, mouth: nil))) }
        XCTAssertNil(d.consume(sample(3.0)))
    }
    func testFailedRecalibrationRevokesOldBaselineAndCannotDispatch() {
        var d = ready()
        XCTAssertFalse(d.calibrate((0...10).map { sample(Double($0)/10, light: 0.01) }))
        XCTAssertNil(d.baseline)
        for n in 11...17 { XCTAssertNil(d.consume(sample(Double(n)/10))) }
        XCTAssertNil(d.consume(sample(1.8, pitch: 0.25)))
        XCTAssertNil(d.consume(sample(1.95, pitch: 0.25)))
        XCTAssertNil(d.consume(sample(2.1)))
        XCTAssertTrue(d.calibrate((30...40).map { sample(Double($0)/10) }))
        XCTAssertNotNil(d.baseline)
    }
    func testSensitivityChangesRequiredMotionWithoutRemovingReturnRequirement() {
        for sensitivity in FaceGestureSensitivity.allCases {
            var settings = Self.legacySettings()
            settings.sensitivity = sensitivity
            var d = ready(settings: settings)
            XCTAssertNil(d.consume(sample(1.8, pitch: 0.11)))
            XCTAssertNil(d.consume(sample(1.95, pitch: 0.11)))
            XCTAssertEqual(d.consume(sample(2.1)), sensitivity == .easy ? .nod : nil)
        }
    }
    func testLongerExpressionHoldRejectsShortExpressionAndAcceptsIntentionalHold() {
        var settings = only(.grin)
        settings.holdDuration = 0.8
        var d = ready(settings: settings)
        for n in 18...24 { XCTAssertNil(d.consume(sample(Double(n)/10, smile: 1.0))) }
        XCTAssertNil(d.consume(sample(2.5)))
        d = ready(settings: settings)
        for n in 18...27 { XCTAssertNil(d.consume(sample(Double(n)/10, smile: 1.0))) }
        XCTAssertEqual(d.consume(sample(2.8)), .grin)
    }
    func testCooldownIsCustomizableAndStillRequiresFreshNeutralRearming() {
        for cooldown in [0.5, 1.25] {
            var settings = Self.legacySettings()
            settings.cooldown = cooldown
            var d = ready(settings: settings)
            XCTAssertNil(d.consume(sample(1.8, pitch: 0.25)))
            XCTAssertNil(d.consume(sample(1.95, pitch: 0.25)))
            XCTAssertEqual(d.consume(sample(2.1)), .nod)
            for n in 22...31 { XCTAssertNil(d.consume(sample(Double(n)/10))) }
            XCTAssertNil(d.consume(sample(3.2, pitch: 0.25)))
            XCTAssertNil(d.consume(sample(3.35, pitch: 0.25)))
            XCTAssertEqual(d.consume(sample(3.5)), cooldown == 0.5 ? .nod : nil)
        }
    }
    func testSettingsChangeRevokesInFlightGestureWithoutLosingCalibration() {
        var d = ready()
        XCTAssertNil(d.consume(sample(1.8, pitch: 0.25)))
        var settings = FaceGestureSettings()
        settings.assign(.nod, to: .previousPage)
        d.configure(settings: settings)
        XCTAssertNotNil(d.baseline)
        XCTAssertNil(d.consume(sample(1.95, pitch: 0.25)))
        XCTAssertNil(d.consume(sample(2.1)))
    }
    func testUnassignedExpressionDoesNotStealMappedGestureOrStartCooldown() {
        var d = ready()
        for n in 18...24 { XCTAssertNil(d.consume(sample(Double(n)/10, mouth: 0.3))) }
        for n in 25...31 { XCTAssertNil(d.consume(sample(Double(n)/10, smile: 1.0))) }
        XCTAssertEqual(d.consume(sample(3.2)), .grin)
    }
    func testMouthAndGrinCanBothBeAssignedWithoutJawOpeningBecomingAmbiguous() {
        var settings = only(.mouthOpen)
        settings.assign(.grin, to: .previousPage)
        var d = ready(settings: settings)
        for n in 18...24 { XCTAssertNil(d.consume(sample(Double(n)/10, smile: 1.0, mouth: 0.25))) }
        XCTAssertEqual(d.consume(sample(2.5)), .mouthOpen)
    }
    func testLegacySettingsMigrateOnlyPageOwnersAndPreserveCustomVerdicts() throws {
        let data = Data(#"{"nod":"previousPage","shake":"again","grin":"nextPage","allowVerdicts":true}"#.utf8)
        let settings = try JSONDecoder().decode(FaceGestureSettings.self, from: data)
        XCTAssertEqual(settings.nod, .off)
        XCTAssertEqual(settings.shake, .again)
        XCTAssertEqual(settings.grin, .off)
        XCTAssertEqual(settings.lookRight, .nextPage)
        XCTAssertEqual(settings.lookLeft, .previousPage)
        XCTAssertEqual(settings.lookDown, .off)
        XCTAssertTrue(settings.allowVerdicts)
        XCTAssertEqual(settings.mouthOpen, .off)
        XCTAssertEqual(settings.eyesClosed, .off)
        XCTAssertEqual(settings.sensitivity, .standard)
        XCTAssertEqual(settings.holdDuration, 0.4)
        XCTAssertEqual(settings.cooldown, 1.25)
    }
    func testCommandFirstAssignmentMovesExpressionAndClearsPreviousAssignments() {
        var settings = FaceGestureSettings()
        settings.assign(.grin, to: .clean)
        XCTAssertEqual(settings.gesture(for: .nextPage), .lookRight)
        XCTAssertEqual(settings.gesture(for: .clean), .grin)
        XCTAssertEqual(settings.action(for: .nod), .off)
        settings.assign(.mouthOpen, to: .clean)
        XCTAssertEqual(settings.action(for: .grin), .off)
        XCTAssertEqual(settings.gesture(for: .clean), .mouthOpen)
        settings.assign(nil, to: .clean)
        XCTAssertNil(settings.gesture(for: .clean))
        XCTAssertEqual(settings.action(for: .mouthOpen), .off)
        XCTAssertNil(settings.gesture(for: .off))
    }
    func testDuplicateLegacyCommandsNormalizeDeterministically() throws {
        let data = Data(#"{"nod":"clean","shake":"clean","grin":"clean","allowVerdicts":false}"#.utf8)
        let settings = try JSONDecoder().decode(FaceGestureSettings.self, from: data)
        XCTAssertEqual(settings.gesture(for: .clean), .lookDown)
        XCTAssertEqual(settings.shake, .off)
        XCTAssertEqual(settings.grin, .off)
    }
    func testSettingsRoundtripAndBoundedCustomTiming() throws {
        var settings = FaceGestureSettings()
        settings.assign(.eyesClosed, to: .previousPage)
        settings.assign(.mouthOpen, to: .again)
        settings.sensitivity = .easy
        settings.holdDuration = 1.1
        settings.cooldown = 0.8
        settings.allowVerdicts = true
        XCTAssertEqual(try JSONDecoder().decode(FaceGestureSettings.self, from: JSONEncoder().encode(settings)), settings)
        let invalidTiming = Data(#"{"holdDuration":-100,"cooldown":100}"#.utf8)
        let decoded = try JSONDecoder().decode(FaceGestureSettings.self, from: invalidTiming)
        XCTAssertEqual(decoded.holdDuration, 0.2)
        XCTAssertEqual(decoded.cooldown, 3)
    }
    func testDefaultVerdictsRemainUnarmedAndMappingIsExplicit() {
        let settings = FaceGestureSettings()
        XCTAssertFalse(settings.allowVerdicts)
        XCTAssertEqual(settings.action(for: .lookRight), .nextPage)
        XCTAssertEqual(settings.action(for: .lookLeft), .previousPage)
        XCTAssertEqual(settings.action(for: .lookDown), .clean)
        XCTAssertEqual(settings.action(for: .grin), .off)
        XCTAssertEqual(settings.action(for: .nod), .off)
        XCTAssertEqual(settings.action(for: .mouthOpen), .off)
        XCTAssertEqual(settings.action(for: .eyesClosed), .off)
    }
    func testNaturalNodUsesApproachPeakAndSoftReturnDespiteAnOrdinarySmile() {
        var d = ready()
        let trace: [(Double, Double, Double, Double)] = [
            (1.8, 0.07, 0.02, 0.84), (1.95, 0.13, 0.04, 0.89),
            (2.1, 0.15, 0.06, 0.91), (2.25, 0.09, 0.05, 0.93), (2.4, 0.05, 0.03, 0.92)
        ]
        let gestures = trace.compactMap { d.consume(sample($0.0, pitch: $0.1, yaw: $0.2, smile: $0.3)) }
        XCTAssertEqual(gestures, [.nod])
    }
    func testSparseFiveHzNodDoesNotNeedTwoHighPeakFrames() {
        var d = ready()
        XCTAssertNil(d.consume(sample(1.9, pitch: 0.075)))
        XCTAssertNil(d.consume(sample(2.1, pitch: 0.135)))
        XCTAssertNil(d.consume(sample(2.3, pitch: 0.09)))
        XCTAssertEqual(d.consume(sample(2.5, pitch: 0.045)), .nod)
    }
    func testAsymmetricShakeSurvivesCenterCrossingAndRequiresObservedReturn() {
        var d = ready()
        XCTAssertNil(d.consume(sample(1.8, yaw: 0.09)))
        XCTAssertNil(d.consume(sample(1.95, yaw: 0.18)))
        XCTAssertNil(d.consume(sample(2.1, yaw: 0.025)))
        XCTAssertNil(d.consume(sample(2.25, yaw: -0.10)))
        XCTAssertEqual(d.consume(sample(2.4, yaw: -0.03)), .shake)
    }
    func testBriefPitchDropoutRetainsTrajectoryButLongLossRevokesIt() {
        var d = ready(settings: only(.nod))
        XCTAssertNil(d.consume(sample(1.8, pitch: 0.08)))
        XCTAssertNil(d.consume(sample(1.95, pitch: 0.16)))
        XCTAssertNil(d.consume(sample(2.05, pitch: .nan)))
        XCTAssertEqual(d.consume(sample(2.15, pitch: 0.06)), .nod)
        d = ready(settings: only(.nod))
        XCTAssertNil(d.consume(sample(1.8, pitch: 0.08)))
        XCTAssertNil(d.consume(sample(1.95, pitch: 0.16)))
        for t in [2.05, 2.2, 2.4] { XCTAssertNil(d.consume(sample(t, pitch: .nan))) }
        XCTAssertNil(d.consume(sample(2.5)))
    }
    func testBilateralSmileStrengthRecognizesNaturalNoisySmileWithoutVisionLipWidth() {
        var d = FaceGestureDetector()
        d.configure(settings: Self.legacySettings())
        d.configure(settings: only(.grin))
        XCTAssertTrue(d.calibrate((0...10).map {
            sample(Double($0)/10, smile: .nan, strength: 0.02 + ($0.isMultiple(of: 2) ? 0.004 : -0.004))
        }))
        XCTAssertTrue(d.availableGestures.contains(.grin))
        for n in 11...17 { XCTAssertNil(d.consume(sample(Double(n)/10, smile: .nan, strength: 0.02))) }
        for n in 18...25 {
            XCTAssertNil(d.consume(sample(Double(n)/10, smile: .nan,
                                          strength: n.isMultiple(of: 2) ? 0.155 : 0.18)))
        }
        XCTAssertEqual(d.consume(sample(2.6, smile: .nan, strength: 0.025)), .grin)
    }
    func testVisionCornerLiftRecognizesNaturalSmileWithoutLargeLipWidening() {
        var d = FaceGestureDetector()
        d.configure(settings: Self.legacySettings())
        d.configure(settings: only(.grin))
        XCTAssertTrue(d.calibrate((0...10).map { sample(Double($0)/10, lift: 0) }))
        for n in 11...17 { XCTAssertNil(d.consume(sample(Double(n)/10, lift: 0))) }
        for n in 18...25 {
            XCTAssertNil(d.consume(sample(Double(n)/10, smile: 0.825,
                                          lift: n.isMultiple(of: 2) ? 0.027 : 0.034)))
        }
        XCTAssertEqual(d.consume(sample(2.6, smile: 0.805, lift: 0.003)), .grin)
    }
    func testBilateralSmileNoiseAndSeparatedShortSmilesNeverAccumulateIntoCommand() {
        var d = FaceGestureDetector()
        d.configure(settings: Self.legacySettings())
        d.configure(settings: only(.grin))
        XCTAssertTrue(d.calibrate((0...10).map { sample(Double($0)/10, smile: .nan, strength: 0.02) }))
        for n in 11...70 {
            let strength = n % 12 < 2 ? 0.2 : 0.02 + 0.015 * sin(Double(n))
            XCTAssertNil(d.consume(sample(Double(n)/10, smile: .nan, strength: strength)))
        }
    }
    func testBilateralSmileCooldownRequiresRelaxationAndNeverRepeatsWhileHeld() {
        var d = FaceGestureDetector()
        d.configure(settings: Self.legacySettings())
        d.configure(settings: only(.grin))
        XCTAssertTrue(d.calibrate((0...10).map { sample(Double($0)/10, smile: .nan, strength: 0.02) }))
        for n in 11...17 { XCTAssertNil(d.consume(sample(Double(n)/10, smile: .nan, strength: 0.02))) }
        for n in 18...24 { XCTAssertNil(d.consume(sample(Double(n)/10, smile: .nan, strength: 0.2))) }
        XCTAssertEqual(d.consume(sample(2.5, smile: .nan, strength: 0.02)), .grin)
        for n in 26...50 { XCTAssertNil(d.consume(sample(Double(n)/10, smile: .nan, strength: 0.2))) }
        for n in 51...56 { XCTAssertNil(d.consume(sample(Double(n)/10, smile: .nan, strength: 0.02))) }
        for n in 57...63 { XCTAssertNil(d.consume(sample(Double(n)/10, smile: .nan, strength: 0.19))) }
        XCTAssertEqual(d.consume(sample(6.4, smile: .nan, strength: 0.02)), .grin)
    }
    func testCompleteNodWithSimultaneousNaturalSmileReleaseDispatchesOnlyNod() {
        var d = ready()
        let trace: [(Double, Double, Double)] = [
            (1.8, 0.07, 0.88), (1.95, 0.14, 0.9), (2.1, 0.16, 0.9),
            (2.25, 0.10, 0.9), (2.4, 0.0, 0.8)
        ]
        XCTAssertEqual(trace.compactMap { d.consume(sample($0.0, pitch: $0.1, smile: $0.2)) }, [.nod])
    }
    func testOrdinaryPianoSwayLandmarkNoiseAndBlinksDoNotDispatch() {
        var settings = FaceGestureSettings()
        settings.assign(.eyesClosed, to: .again)
        settings.assign(.mouthOpen, to: .previousPage)
        var d = ready(settings: settings)
        for n in 18...120 {
            let angle = Double(n) * 0.8
            let blinking = n % 13 < 2
            XCTAssertNil(d.consume(sample(Double(n)/10, pitch: 0.035 * sin(angle), yaw: 0.04 * cos(angle),
                                          smile: 0.8 + 0.012 * sin(angle), mouth: 0.02 + 0.01 * cos(angle),
                                          leftEye: blinking ? 0.03 : 0.3, rightEye: blinking ? 0.03 : 0.3)))
        }
    }
    func testSlowLookDownAndOneSidedLookCannotBecomeCompleteCommands() {
        var d = ready(settings: only(.nod))
        for n in 18...50 {
            XCTAssertNil(d.consume(sample(Double(n)/10, pitch: min(0.22, Double(n - 18) * 0.008))))
        }
        for n in 51...80 {
            XCTAssertNil(d.consume(sample(Double(n)/10, pitch: max(0, 0.22 - Double(n - 50) * 0.008))))
        }
        d = ready(settings: only(.shake))
        for (t, yaw) in [(1.8, 0.09), (1.95, 0.2), (2.1, 0.1), (2.25, 0.02), (2.4, 0.0)] {
            XCTAssertNil(d.consume(sample(t, yaw: yaw)))
        }
    }
    func testNoisyNeutralCalibrationRaisesPoseNoiseFloor() {
        let noise = [-0.03, 0.025, 0.03, -0.025, 0.0]
        var d = ready(calibration: (0...10).map { sample(Double($0)/10, pitch: noise[$0 % noise.count]) })
        for (t, pitch) in [(1.8, 0.08), (1.95, 0.14), (2.1, 0.1), (2.25, 0.02)] {
            XCTAssertNil(d.consume(sample(t, pitch: pitch)))
        }
    }
    func testCalibrationWorksAtFiveHzAndCooldownDoesNotAddHiddenRearmDelay() {
        var d = FaceGestureDetector()
        d.configure(settings: Self.legacySettings())
        XCTAssertTrue(d.calibrate((0...4).map { sample(Double($0)/5) }))
        d = ready()
        XCTAssertNil(d.consume(sample(1.8, pitch: 0.25)))
        XCTAssertNil(d.consume(sample(1.95, pitch: 0.25)))
        XCTAssertEqual(d.consume(sample(2.1)), .nod)
        for n in 22...33 { XCTAssertNil(d.consume(sample(Double(n)/10))) }
        XCTAssertNil(d.consume(sample(3.4, pitch: 0.15)))
        XCTAssertNil(d.consume(sample(3.55, pitch: 0.08)))
        XCTAssertEqual(d.consume(sample(3.7, pitch: 0.01)), .nod)
    }
    func testLongHeldHeadPoseNeverDispatchesOnLateReturn() {
        var d = ready(settings: only(.nod))
        for n in 18...40 { XCTAssertNil(d.consume(sample(Double(n)/10, pitch: 0.2))) }
        for n in 41...48 { XCTAssertNil(d.consume(sample(Double(n)/10))) }
    }
}
