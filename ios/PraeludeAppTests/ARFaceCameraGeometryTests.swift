import XCTest
import ARKit
import simd
import ImageIO
@testable import Praelude

final class ARFaceCameraGeometryTests: XCTestCase {
    func testCapturedFramesRejectDelayReorderingAndInvalidTimes() {
        XCTAssertTrue(ARFaceCameraGeometry.isFresh(capturedAt: 100, now: 100.1, after: 99.9))
        XCTAssertFalse(ARFaceCameraGeometry.isFresh(capturedAt: 100, now: 101, after: 99.9))
        XCTAssertFalse(ARFaceCameraGeometry.isFresh(capturedAt: 100, now: 100.1, after: 100))
        XCTAssertFalse(ARFaceCameraGeometry.isFresh(capturedAt: 99, now: 100, after: 99.9))
        XCTAssertFalse(ARFaceCameraGeometry.isFresh(capturedAt: 100.1, now: 100, after: 99.9))
        XCTAssertFalse(ARFaceCameraGeometry.isFresh(capturedAt: .nan, now: 100, after: 99.9))
        XCTAssertTrue(ARFaceCameraGeometry.shouldReportDelay(capturedAt: 99, now: 100, lastReported: 98))
        XCTAssertFalse(ARFaceCameraGeometry.shouldReportDelay(capturedAt: 99, now: 100, lastReported: 99.5))
        XCTAssertFalse(ARFaceCameraGeometry.shouldReportDelay(capturedAt: 99.9, now: 100, lastReported: 98))
        XCTAssertFalse(ARFaceCameraGeometry.shouldReportDelay(capturedAt: .nan, now: 100, lastReported: 98))
    }

    func testCaptureAnglesAndSensorDimensionsMatchEveryInterfaceOrientation() {
        let resolution = CGSize(width: 1440, height: 1080)
        let expected: [(CGFloat, UIInterfaceOrientation, CGSize)] = [
            (0, .landscapeRight, resolution),
            (90, .portrait, CGSize(width: 1080, height: 1440)),
            (180, .landscapeLeft, resolution),
            (270, .portraitUpsideDown, CGSize(width: 1080, height: 1440))
        ]
        for (angle, orientation, viewport) in expected {
            XCTAssertEqual(ARFaceCameraGeometry.orientation(for: angle), orientation)
            XCTAssertEqual(ARFaceCameraGeometry.viewport(imageResolution: resolution, orientation: orientation), viewport)
        }
        XCTAssertEqual(ARFaceCameraGeometry.orientation(for: -90), .portraitUpsideDown)
        XCTAssertEqual(ARFaceCameraGeometry.viewport(imageResolution: .zero, orientation: .portrait), CGSize(width: 3, height: 4))
    }

    func testCameraRelativePoseSeparatesNodAndShakeAndIgnoresTranslationAndRoll() throws {
        let pitch: Float = 0.25, yaw: Float = -0.4
        let nod = simd_float4x4(simd_quatf(angle: pitch, axis: SIMD3<Float>(1, 0, 0)))
        let shake = simd_float4x4(simd_quatf(angle: yaw, axis: SIMD3<Float>(0, 1, 0)))
        var face = shake * nod
        face.columns.3 = SIMD4<Float>(5, -3, -0.7, 1)
        let pose = try XCTUnwrap(ARFaceCameraGeometry.headPose(cameraRelative: face))
        XCTAssertEqual(pose.pitch, Double(pitch), accuracy: 0.000001)
        XCTAssertEqual(pose.yaw, -Double(yaw), accuracy: 0.000001)
        let roll = simd_float4x4(simd_quatf(angle: 0.6, axis: SIMD3<Float>(0, 0, 1)))
        let rolled = try XCTUnwrap(ARFaceCameraGeometry.headPose(cameraRelative: face * roll))
        XCTAssertEqual(rolled.pitch, pose.pitch, accuracy: 0.000001)
        XCTAssertEqual(rolled.yaw, pose.yaw, accuracy: 0.000001)

        // Camera/world motion must cancel before extracting the head's gesture.
        let camera = simd_float4x4(simd_quatf(angle: 0.7, axis: SIMD3<Float>(0, 1, 0)))
        let relative = try XCTUnwrap(ARFaceCameraGeometry.headPose(cameraRelative: simd_inverse(camera) * (camera * face)))
        XCTAssertEqual(relative.pitch, pose.pitch, accuracy: 0.000001)
        XCTAssertEqual(relative.yaw, pose.yaw, accuracy: 0.000001)
        var invalid = matrix_identity_float4x4
        invalid.columns.2 = SIMD4<Float>(.nan, 0, 1, 0)
        XCTAssertNil(ARFaceCameraGeometry.headPose(cameraRelative: invalid))
    }

    func testProjectedMeshRetainsTopLeftCoordinatesAndClipsOnlyVisibleOverlay() throws {
        let geometry = ARFaceCameraGeometry.normalizedProjection([
            CGPoint(x: -20, y: 10), CGPoint(x: 50, y: 20), CGPoint(x: 80, y: 80),
            CGPoint(x: CGFloat.nan, y: 20)
        ], viewport: CGSize(width: 100, height: 100))
        let box = try XCTUnwrap(geometry.face)
        XCTAssertEqual(box.minX, 0, accuracy: 0.000001)
        XCTAssertEqual(box.minY, 0.1, accuracy: 0.000001)
        XCTAssertEqual(box.width, 0.8, accuracy: 0.000001)
        XCTAssertEqual(box.height, 0.7, accuracy: 0.000001)
        XCTAssertEqual(geometry.landmarks, [CGPoint(x: 0.5, y: 0.2), CGPoint(x: 0.8, y: 0.8)])
        XCTAssertNil(ARFaceCameraGeometry.normalizedProjection([CGPoint(x: 150, y: 150), CGPoint(x: 200, y: 200)], viewport: CGSize(width: 100, height: 100)).face)
        XCTAssertTrue(ARFaceCameraGeometry.normalizedProjection([.zero], viewport: .zero).landmarks.isEmpty)
    }

    func testBilateralSmileRejectsSmirkAndDoesNotTreatMissingCoefficientAsNeutral() {
        XCTAssertEqual(ARFaceCameraGeometry.bilateralSmile(left: 0.9, right: 0.1), 0.1)
        XCTAssertEqual(ARFaceCameraGeometry.bilateralSmile(left: 0.8, right: 0.7), 0.7)
        XCTAssertNil(ARFaceCameraGeometry.bilateralSmile(left: 0.8, right: nil))
        XCTAssertNil(ARFaceCameraGeometry.bilateralSmile(left: .nan, right: 0.8))
        XCTAssertEqual(ARFaceCameraGeometry.coefficient(1.2), 1)
        XCTAssertEqual(ARFaceCameraGeometry.coefficient(-0.2), 0)
    }

    func testFaceBrightnessRegionFollowsTheInverseImageOrientation() throws {
        // A quarter-turn maps sensor (x, y) to display (1-y, x).
        let transform = CGAffineTransform(a: 0, b: 1, c: -1, d: 0, tx: 1, ty: 0)
        let displayed = CGRect(x: 0.2, y: 0.3, width: 0.4, height: 0.2)
        let sensor = try XCTUnwrap(ARFaceCameraGeometry.imageRegion(projectedFace: displayed, displayTransform: transform))
        XCTAssertEqual(sensor.minX, 0.3, accuracy: 0.000001)
        XCTAssertEqual(sensor.minY, 0.4, accuracy: 0.000001)
        XCTAssertEqual(sensor.width, 0.2, accuracy: 0.000001)
        XCTAssertEqual(sensor.height, 0.4, accuracy: 0.000001)
        XCTAssertNil(ARFaceCameraGeometry.imageRegion(projectedFace: nil, displayTransform: .identity))
    }

    func testPlayerRightLeftAndDownNormalsKeepTheirSignsAcrossFourViewOrientations() throws {
        let angle: Float = 0.2
        // Apple defines +x as the face's LEFT and +y as UP. These explicit outward normals
        // therefore represent the player's right, left and down independently of Euler signs.
        let examples: [(SIMD3<Float>, Double, Double)] = [
            (SIMD3<Float>(-sin(angle), 0, cos(angle)), 0, Double(angle)),
            (SIMD3<Float>(sin(angle), 0, cos(angle)), 0, -Double(angle)),
            (SIMD3<Float>(0, -sin(angle), cos(angle)), Double(angle), 0)
        ]
        for rotation in [Float(0), .pi / 2, .pi, -.pi / 2] {
            let cameraView = simd_float4x4(simd_quatf(angle: rotation, axis: SIMD3<Float>(0, 0, 1)))
            for (normal, pitch, yaw) in examples {
                var uprightFace = matrix_identity_float4x4
                uprightFace.columns.2 = SIMD4<Float>(normal, 0)
                let sensorFace = simd_inverse(cameraView) * uprightFace
                let actual = try XCTUnwrap(ARFaceCameraGeometry.headPose(cameraRelative: cameraView * sensorFace))
                XCTAssertEqual(actual.pitch, pitch, accuracy: 0.000001)
                XCTAssertEqual(actual.yaw, yaw, accuracy: 0.000001)
            }
        }
    }

    func testVisionUprightRotationAndPreviewMappingAgreeIncludingFrontMirrorAndCrop() {
        let rotations: [(CGImagePropertyOrientation, CGAffineTransform)] = [
            (.up, .identity),
            (.right, CGAffineTransform(a: 0, b: 1, c: -1, d: 0, tx: 1, ty: 0)),
            (.down, CGAffineTransform(a: -1, b: 0, c: 0, d: -1, tx: 1, ty: 1)),
            (.left, CGAffineTransform(a: 0, b: -1, c: 1, d: 0, tx: 0, ty: 1))
        ]
        let crop = CGAffineTransform(a: 0.8, b: 0, c: 0, d: 0.8, tx: 0.1, ty: 0.1)
        let mirror = CGAffineTransform(a: -1, b: 0, c: 0, d: 1, tx: 1, ty: 0)
        let imagePoint = CGPoint(x: 0.2, y: 0.3)
        for (orientation, rotation) in rotations {
            for mirrored in [false, true] {
                var display = rotation.concatenating(crop)
                if mirrored { display = display.concatenating(mirror) }
                let alignment = ARFaceCameraGeometry.visionAlignment(displayTransform: display)
                XCTAssertEqual(alignment.orientation, orientation)
                let overlay = imagePoint.applying(alignment.imageToVision).applying(alignment.visionToDisplay)
                let expected = imagePoint.applying(display)
                XCTAssertEqual(overlay.x, expected.x, accuracy: 0.000001)
                XCTAssertEqual(overlay.y, expected.y, accuracy: 0.000001)
            }
        }
        XCTAssertEqual(FaceCameraGeometry.playerYaw(visionYaw: -0.2, mirrored: false), 0.2)
        XCTAssertEqual(FaceCameraGeometry.playerYaw(visionYaw: 0.2, mirrored: true), 0.2)
    }

    func testFallbackAllowsBriefARLossThenStaysOnVisionForTheCameraSession() {
        var selector = FaceTrackingBackendSelector()
        XCTAssertEqual(selector.select(arUsable: true, visionUsable: false, at: 1), .arkit)
        XCTAssertEqual(selector.select(arUsable: false, visionUsable: true, at: 1.1), .arkit)
        XCTAssertEqual(selector.select(arUsable: false, visionUsable: true, at: 1.25), .arkit)
        XCTAssertEqual(selector.select(arUsable: true, visionUsable: true, at: 1.3), .arkit)
        XCTAssertEqual(selector.select(arUsable: false, visionUsable: true, at: 2), .arkit)
        XCTAssertEqual(selector.select(arUsable: false, visionUsable: true, at: .nan), .arkit)
        XCTAssertEqual(selector.select(arUsable: false, visionUsable: true, at: 1), .arkit)
        XCTAssertEqual(selector.select(arUsable: false, visionUsable: true, at: 2.31), .vision)
        XCTAssertEqual(selector.select(arUsable: true, visionUsable: true, at: 3), .vision)
    }
}
