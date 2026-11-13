@preconcurrency import ARKit
@preconcurrency import AVFoundation
import UIKit
import simd
import ImageIO

/// A bounded AR loss may recover during a turn. A usable image fallback becomes sticky for
/// this camera session, avoiding repeated source changes and neutral calibration at the piano.
struct FaceTrackingBackendSelector {
    private(set) var source: FaceGesturePoseSource = .arkit
    private var lostSince: TimeInterval?
    private var lastTime: TimeInterval?
    mutating func select(arUsable: Bool, visionUsable: Bool, at time: TimeInterval) -> FaceGesturePoseSource {
        guard time.isFinite, lastTime.map({ time >= $0 }) ?? true else { return source }
        lastTime = time
        guard source != .vision else { return source }
        if arUsable { lostSince = nil; return source }
        lostSince = lostSince ?? time
        if visionUsable, time - lostSince! >= 0.3 { source = .vision }
        return source
    }
}

/// Geometry conversion is independent of capture, so orientation and pose can be checked
/// without pretending that a Simulator supplies face tracking.
enum ARFaceCameraGeometry {
    static func isFresh(capturedAt: TimeInterval, now: TimeInterval, after previous: TimeInterval) -> Bool {
        capturedAt.isFinite && now.isFinite && capturedAt > previous
            && now >= capturedAt && now - capturedAt <= 0.35
    }

    static func shouldReportDelay(capturedAt: TimeInterval, now: TimeInterval, lastReported: TimeInterval) -> Bool {
        capturedAt.isFinite && now.isFinite && now - capturedAt > 0.35 && now - lastReported >= 1
    }

    static func orientation(for angle: CGFloat) -> UIInterfaceOrientation {
        let degrees = (Int(angle.rounded()) % 360 + 360) % 360
        switch degrees {
        case 0: return .landscapeRight
        case 180: return .landscapeLeft
        case 270: return .portraitUpsideDown
        default: return .portrait
        }
    }

    static func viewport(imageResolution: CGSize, orientation: UIInterfaceOrientation) -> CGSize {
        guard imageResolution.width.isFinite, imageResolution.height.isFinite,
              imageResolution.width > 0, imageResolution.height > 0 else { return CGSize(width: 3, height: 4) }
        return orientation.isPortrait
            ? CGSize(width: imageResolution.height, height: imageResolution.width)
            : imageResolution
    }

    /// Use the face's outward normal, rather than world Euler angles. Translation, device
    /// position and head roll cannot masquerade as a nod or a shake.
    static func headPose(cameraRelative transform: simd_float4x4) -> (pitch: Double, yaw: Double)? {
        let normal = SIMD3<Float>(transform.columns.2.x, transform.columns.2.y, transform.columns.2.z)
        guard normal.x.isFinite, normal.y.isFinite, normal.z.isFinite,
              simd_length_squared(normal) > 0.0001 else { return nil }
        return (atan2(-Double(normal.y), hypot(Double(normal.x), Double(normal.z))),
                -atan2(Double(normal.x), Double(normal.z)))
    }

    /// ARKit supplies the actual image-to-view transform, including front-camera mirroring.
    /// Vision receives only the upright rotation; its unmirrored yaw has one stable sign.
    /// Overlay coordinates are then mapped back through ARKit's exact display transform.
    static func visionAlignment(displayTransform: CGAffineTransform) ->
        (orientation: CGImagePropertyOrientation, imageToVision: CGAffineTransform, visionToDisplay: CGAffineTransform) {
        let mirrored = displayTransform.a * displayTransform.d - displayTransform.b * displayTransform.c < 0
        let upright = mirrored ? displayTransform.concatenating(CGAffineTransform(a: -1, b: 0, c: 0, d: 1, tx: 1, ty: 0)) : displayTransform
        let orientation: CGImagePropertyOrientation
        let rotation: CGAffineTransform
        if abs(upright.a) >= abs(upright.b) {
            if upright.a >= 0 { orientation = .up; rotation = .identity }
            else { orientation = .down; rotation = CGAffineTransform(a: -1, b: 0, c: 0, d: -1, tx: 1, ty: 1) }
        } else if upright.b >= 0 {
            orientation = .right; rotation = CGAffineTransform(a: 0, b: 1, c: -1, d: 0, tx: 1, ty: 0)
        } else {
            orientation = .left; rotation = CGAffineTransform(a: 0, b: -1, c: 1, d: 0, tx: 0, ty: 1)
        }
        return (orientation, rotation, rotation.inverted().concatenating(displayTransform))
    }

    static func coefficient(_ value: Double?) -> Double? {
        guard let value, value.isFinite else { return nil }
        return min(1, max(0, value))
    }

    static func bilateralSmile(left: Double?, right: Double?) -> Double? {
        guard let left = coefficient(left), let right = coefficient(right) else { return nil }
        return min(left, right)
    }

    static func imageRegion(projectedFace: CGRect?, displayTransform: CGAffineTransform) -> CGRect? {
        guard let projectedFace else { return nil }
        let region = projectedFace.applying(displayTransform.inverted())
            .intersection(CGRect(x: 0, y: 0, width: 1, height: 1))
        return !region.isNull && region.width > 0 && region.height > 0 ? region : nil
    }

    /// ARCamera.projectPoint supplies top-left viewport coordinates. The preview has this
    /// same aspect ratio, so neither a second image rotation nor a second mirror is applied.
    static func normalizedProjection(_ points: [CGPoint], viewport: CGSize) -> (face: CGRect?, landmarks: [CGPoint]) {
        guard viewport.width.isFinite, viewport.height.isFinite,
              viewport.width > 0, viewport.height > 0 else { return (nil, []) }
        let normalized = points.compactMap { point -> CGPoint? in
            guard point.x.isFinite, point.y.isFinite else { return nil }
            return CGPoint(x: point.x / viewport.width, y: point.y / viewport.height)
        }
        guard let first = normalized.first else { return (nil, []) }
        var minX = first.x, maxX = first.x, minY = first.y, maxY = first.y
        for point in normalized.dropFirst() {
            minX = min(minX, point.x); maxX = max(maxX, point.x)
            minY = min(minY, point.y); maxY = max(maxY, point.y)
        }
        let visible = CGRect(x: minX, y: minY, width: maxX - minX, height: maxY - minY)
            .intersection(CGRect(x: 0, y: 0, width: 1, height: 1))
        let face = !visible.isNull && visible.width > 0 && visible.height > 0 ? visible : nil
        return (face, normalized.filter { (0...1).contains($0.x) && (0...1).contains($0.y) })
    }
}

/// ARKit owns the front camera on supported devices. It provides tracked pose, a dense
/// expression mesh and bilateral expression coefficients without a second camera session.
/// Only measurements and projected points leave this worker; camera images are never stored.
final class ARFaceCameraWorker: NSObject, FaceCameraCapturing, ARSessionDelegate, @unchecked Sendable {
    private static let lifecycle = FaceCameraOperationQueue(label: "praelude.ar-face-camera.lifecycle")
    private let analysis = DispatchQueue(label: "praelude.ar-face-camera.analysis", qos: .userInitiated)
    private let session = ARSession()
    private let deliver: @Sendable (FaceCameraFrame) -> Void
    private let failed: @Sendable (String) -> Void
    private let lock = NSLock()
    private var cancelled = false
    private var orientation: UIInterfaceOrientation = .portrait
    private var orientationRevision = 0
    // ARSession delegate callbacks are serialized on analysis.
    private var lastFrame = -Double.infinity
    private var lastSeenFrame = -Double.infinity
    private var lastTrackingDelay = -Double.infinity
    private var backend = FaceTrackingBackendSelector()
    private let vision = FaceVisionAnalyzer()

    var captureSession: AVCaptureSession? { nil }
    var faceTrackingSession: ARSession? { session }

    init(deliver: @escaping @Sendable (FaceCameraFrame) -> Void,
         failed: @escaping @Sendable (String) -> Void) {
        self.deliver = deliver; self.failed = failed
        super.init()
    }

    func start(angle: CGFloat, revision: Int, completion: @escaping @Sendable () -> Void) {
        lock.withLock {
            orientation = ARFaceCameraGeometry.orientation(for: angle)
            orientationRevision = revision
        }
        Self.lifecycle.perform { [self] in
            guard !lock.withLock({ cancelled }) else { return }
            guard ARFaceTrackingConfiguration.isSupported else {
                failed("Face tracking is unavailable on this device. Enable the camera again to retry.")
                return
            }
            session.delegateQueue = analysis
            session.delegate = self
            let configuration = ARFaceTrackingConfiguration()
            configuration.isWorldTrackingEnabled = false
            configuration.isLightEstimationEnabled = false
            configuration.providesAudioData = false
            // On devices that can track two faces, pause rather than choosing a bystander.
            configuration.maximumNumberOfTrackedFaces = min(2, ARFaceTrackingConfiguration.supportedNumberOfTrackedFaces)
            session.run(configuration, options: [.resetTracking, .removeExistingAnchors])
            guard !lock.withLock({ cancelled }) else { return }
            completion()
        }
    }

    func rotate(_ angle: CGFloat, revision: Int) {
        lock.withLock {
            orientation = ARFaceCameraGeometry.orientation(for: angle)
            orientationRevision = revision
        }
    }

    func stop(completion: @escaping @Sendable () -> Void) {
        lock.withLock { cancelled = true }
        Self.lifecycle.perform { [self] in
            session.pause()
            session.delegate = nil
            // Drain the delegate queue before the service releases camera ownership.
            analysis.async { completion() }
        }
    }

    func attachPreview(_ layer: AVCaptureVideoPreviewLayer) {}
    func detachPreview(_ layer: AVCaptureVideoPreviewLayer) {}

    func session(_ session: ARSession, didUpdate frame: ARFrame) {
        let state = lock.withLock { (cancelled, orientation, orientationRevision) }
        let timestamp = frame.timestamp
        let now = ProcessInfo.processInfo.systemUptime
        guard !state.0, timestamp.isFinite, timestamp > lastSeenFrame else { return }
        lastSeenFrame = timestamp
        guard ARFaceCameraGeometry.isFresh(capturedAt: timestamp, now: now, after: lastFrame) else {
            if ARFaceCameraGeometry.shouldReportDelay(capturedAt: timestamp, now: now, lastReported: lastTrackingDelay) {
                lastTrackingDelay = now
                let viewport = ARFaceCameraGeometry.viewport(imageResolution: frame.camera.imageResolution, orientation: state.1)
                deliver(FaceCameraFrame(sample: FaceGestureSample(time: timestamp, pitch: .nan, yaw: .nan,
                    smileWidth: .nan, luminance: 0.5, confidence: 0, faceCount: 0, faceArea: 0, poseSource: backend.source),
                    face: nil, landmarks: [], orientationRevision: state.2,
                    trackingIssue: "Tracking delayed · gestures paused", imageAspect: viewport.width / viewport.height,
                    trackingMode: "3D face tracking", processedAt: now))
            }
            return
        }
        guard timestamp - lastFrame >= 1.0 / 20.0 else { return }
        lastFrame = frame.timestamp
        let viewport = ARFaceCameraGeometry.viewport(imageResolution: frame.camera.imageResolution, orientation: state.1)
        let faces = frame.anchors.compactMap { $0 as? ARFaceAnchor }.filter(\.isTracked)
        // Never hide a second tracked face by selecting a single Vision observation.
        guard faces.count <= 1 else {
            deliver(emptyFrame(time: timestamp, count: faces.count, revision: state.2, viewport: viewport))
            return
        }
        let ar = backend.source == .vision ? nil : faces.first.map {
            arMeasurement(frame, face: $0, orientation: state.1, revision: state.2, viewport: viewport)
        }
        if backend.source != .vision, let ar, ar.sample.usable {
            _ = backend.select(arUsable: true, visionUsable: false, at: timestamp)
            guard !lock.withLock({ cancelled }) else { return }
            deliver(ar)
            return
        }
        let alignment = ARFaceCameraGeometry.visionAlignment(
            displayTransform: frame.displayTransform(for: state.1, viewportSize: viewport))
        do {
            let fallback = try vision.analyze(frame.capturedImage, orientation: alignment.orientation,
                time: timestamp, revision: state.2, imageAspect: viewport.width / viewport.height,
                imageToVision: alignment.imageToVision, visionToDisplay: alignment.visionToDisplay,
                trackingMode: "Distance camera landmarks")
            if fallback.sample.faceCount > 1 {
                deliver(emptyFrame(time: timestamp, count: fallback.sample.faceCount, revision: state.2, viewport: viewport))
                return
            }
            let source = backend.select(arUsable: false, visionUsable: fallback.sample.usable, at: timestamp)
            guard !lock.withLock({ cancelled }) else { return }
            if source == .vision { deliver(fallback) }
            else if fallback.sample.faceCount == 1, !fallback.sample.usable {
                // A known dark/unreliable face is not an absence that can complete a turn.
                deliver(FaceCameraFrame(sample: FaceGestureSample(time: timestamp, pitch: .nan, yaw: .nan,
                    smileWidth: .nan, luminance: fallback.sample.luminance, confidence: fallback.sample.confidence,
                    faceCount: 1, faceArea: fallback.sample.faceArea, poseSource: backend.source),
                    face: fallback.face, landmarks: fallback.landmarks, orientationRevision: state.2,
                    imageAspect: viewport.width / viewport.height, trackingMode: "3D face tracking"))
            } else { deliver(ar ?? emptyFrame(time: timestamp, count: 0, revision: state.2, viewport: viewport)) }
        } catch {
            guard !lock.withLock({ cancelled }) else { return }
            deliver(emptyFrame(time: timestamp, count: 0, revision: state.2, viewport: viewport,
                issue: "Image tracking interrupted · hold facing the iPad"))
        }
    }

    private func emptyFrame(time: TimeInterval, count: Int, revision: Int, viewport: CGSize,
                            issue: String? = nil) -> FaceCameraFrame {
        FaceCameraFrame(sample: FaceGestureSample(time: time, pitch: .nan, yaw: .nan, smileWidth: .nan,
            luminance: 0.5, confidence: 0, faceCount: count, faceArea: 0, poseSource: backend.source),
            face: nil, landmarks: [], orientationRevision: revision, trackingIssue: issue,
            imageAspect: viewport.width / viewport.height,
            trackingMode: backend.source == .vision ? "Distance camera landmarks" : "3D face tracking",
            processedAt: ProcessInfo.processInfo.systemUptime)
    }

    private func arMeasurement(_ frame: ARFrame, face: ARFaceAnchor, orientation: UIInterfaceOrientation,
                               revision: Int, viewport: CGSize) -> FaceCameraFrame {
        let cameraRelative = frame.camera.viewMatrix(for: orientation) * face.transform
        let pose = ARFaceCameraGeometry.headPose(cameraRelative: cameraRelative)
        let projected = face.geometry.vertices.map { vertex -> CGPoint in
            let world = face.transform * SIMD4<Float>(vertex.x, vertex.y, vertex.z, 1)
            return frame.camera.projectPoint(SIMD3<Float>(world.x, world.y, world.z), orientation: orientation, viewportSize: viewport)
        }
        let geometry = ARFaceCameraGeometry.normalizedProjection(projected, viewport: viewport)
        func blend(_ location: ARFaceAnchor.BlendShapeLocation) -> Double? {
            ARFaceCameraGeometry.coefficient(face.blendShapes[location]?.doubleValue)
        }
        let smile = ARFaceCameraGeometry.bilateralSmile(left: blend(.mouthSmileLeft), right: blend(.mouthSmileRight))
        let leftEye = blend(.eyeBlinkLeft).map { 0.3 * (1 - $0) }
        let rightEye = blend(.eyeBlinkRight).map { 0.3 * (1 - $0) }
        let imageRegion = ARFaceCameraGeometry.imageRegion(projectedFace: geometry.face,
            displayTransform: frame.displayTransform(for: orientation, viewportSize: viewport))
        let sample = FaceGestureSample(time: frame.timestamp, pitch: pose?.pitch ?? .nan, yaw: pose?.yaw ?? .nan,
            smileWidth: .nan, luminance: FaceCameraGeometry.luminance(frame.capturedImage, box: imageRegion),
            confidence: 1, faceCount: 1, faceArea: geometry.face.map { Double($0.width * $0.height) } ?? 0,
            mouthOpen: blend(.jawOpen), leftEyeOpen: leftEye, rightEyeOpen: rightEye,
            smileStrength: smile, poseSource: .arkit)
        return FaceCameraFrame(sample: sample, face: geometry.face, landmarks: geometry.landmarks,
            orientationRevision: revision, imageAspect: viewport.width / viewport.height,
            trackingMode: "3D face tracking", processedAt: ProcessInfo.processInfo.systemUptime)
    }

    func session(_ session: ARSession, didFailWithError error: Error) {
        guard !lock.withLock({ cancelled }) else { return }
        failed("Face tracking could not continue. Turn the camera on again when it is available.")
    }

    func sessionWasInterrupted(_ session: ARSession) {
        guard !lock.withLock({ cancelled }) else { return }
        failed("Camera interrupted. Enable it again when available.")
    }
}
