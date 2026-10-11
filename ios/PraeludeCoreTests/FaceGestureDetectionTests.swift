import XCTest
@testable import PraeludeCore

final class FaceGestureDetectionTests: XCTestCase {
    private func sample(_ t: Double, pitch: Double = 0, yaw: Double = 0, smile: Double = 0.8,
                        light: Double = 0.5, faces: Int = 1) -> FaceGestureSample {
        .init(time: t, pitch: pitch, yaw: yaw, smileWidth: smile, luminance: light,
              confidence: 0.99, faceCount: faces, faceArea: 0.1)
    }
    private func ready() -> FaceGestureDetector {
        var detector = FaceGestureDetector()
        XCTAssertTrue(detector.calibrate((0...10).map { sample(Double($0)/10) }))
        for n in 11...17 { XCTAssertNil(detector.consume(sample(Double(n)/10))) }
        return detector
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
    func testShakeRequiresBothDirectionsAndReturn() {
        var d = ready()
        XCTAssertNil(d.consume(sample(1.8,yaw: 0.3)))
        XCTAssertNil(d.consume(sample(2.0,yaw: -0.3)))
        XCTAssertEqual(d.consume(sample(2.2)), .shake)
        d = ready()
        XCTAssertNil(d.consume(sample(1.8,yaw: 0.3)))
        XCTAssertNil(d.consume(sample(1.9)))
    }
    func testGrinMustHoldAndReleaseAndCannotRemainOnFace() {
        var d = ready()
        for n in 18...24 { XCTAssertNil(d.consume(sample(Double(n)/10,smile: 1.0))) }
        XCTAssertEqual(d.consume(sample(2.5)), .grin)
        d = ready()
        XCTAssertNil(d.consume(sample(1.8,smile: 1.0)))
        XCTAssertNil(d.consume(sample(1.9)))
    }
    func testQualityLossStaleFramesMixedMotionAndFocusResetCannotDispatch() {
        for bad in [sample(1.9,light: 0.01),sample(1.9,faces: 2),sample(1.7),sample(3.0)] {
            var d = ready(); XCTAssertNil(d.consume(sample(1.8,pitch: 0.25)))
            XCTAssertNil(d.consume(bad)); XCTAssertNil(d.consume(sample(3.1)))
        }
        var d = ready(); XCTAssertNil(d.consume(sample(1.8,pitch: 0.25)))
        d.resetMotion(); XCTAssertNil(d.consume(sample(1.9)))
        d = ready(); XCTAssertNil(d.consume(sample(1.8,pitch: 0.25)))
        XCTAssertNil(d.consume(sample(1.9,yaw: 0.3))); XCTAssertNil(d.consume(sample(2)))
    }
    func testCalibrationRejectsDarkMultipleUnsteadyNonfiniteAndSparseSamples() {
        var d = FaceGestureDetector()
        XCTAssertFalse(d.calibrate((0...10).map { sample(Double($0)/10,light: 0.1) }))
        XCTAssertFalse(d.calibrate((0...10).map { sample(Double($0)/10,faces: 2) }))
        XCTAssertFalse(d.calibrate((0...10).map { sample(Double($0)/10,pitch: Double($0)/10) }))
        XCTAssertFalse(d.calibrate([sample(0),sample(1)]))
        XCTAssertFalse(d.calibrate((0...10).map { sample(Double($0)/10,yaw: .nan) }))
        XCTAssertNil(d.baseline)
    }
    func testFailedRecalibrationRevokesOldBaselineAndCannotDispatch() {
        var d = ready()
        XCTAssertFalse(d.calibrate((0...10).map { sample(Double($0)/10, light: 0.01) }))
        XCTAssertNil(d.baseline)
        for n in 11...17 { XCTAssertNil(d.consume(sample(Double(n)/10))) }
        XCTAssertNil(d.consume(sample(1.8,pitch: 0.25)))
        XCTAssertNil(d.consume(sample(1.95,pitch: 0.25)))
        XCTAssertNil(d.consume(sample(2.1)))
        XCTAssertTrue(d.calibrate((30...40).map { sample(Double($0)/10) }))
        XCTAssertNotNil(d.baseline)
    }
    func testDefaultVerdictsRemainUnarmedAndMappingIsExplicit() throws {
        let settings = FaceGestureSettings()
        XCTAssertFalse(settings.allowVerdicts)
        XCTAssertEqual(settings.action(for: .grin), .nextPage)
        XCTAssertEqual(settings.action(for: .nod), .clean)
        XCTAssertEqual(try JSONDecoder().decode(FaceGestureSettings.self,from: JSONEncoder().encode(settings)),settings)
    }
}
