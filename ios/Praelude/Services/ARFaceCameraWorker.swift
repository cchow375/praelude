@preconcurrency import ARKit
@preconcurrency import AVFoundation
import UIKit
import simd

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
                atan2(Double(normal.x), Double(normal.z)))
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
                    smileWidth: .nan, luminance: 0.5, confidence: 0, faceCount: 0, faceArea: 0),
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
        guard faces.count == 1, let face = faces.first else {
            deliver(FaceCameraFrame(sample: FaceGestureSample(time: timestamp, pitch: .nan, yaw: .nan,
                smileWidth: .nan, luminance: 0.5, confidence: 0, faceCount: faces.count, faceArea: 0),
                face: nil, landmarks: [], orientationRevision: state.2, imageAspect: viewport.width / viewport.height,
                trackingMode: "3D face tracking", processedAt: ProcessInfo.processInfo.systemUptime))
            return
        }
        let cameraRelative = frame.camera.viewMatrix(for: state.1) * face.transform
        let pose = ARFaceCameraGeometry.headPose(cameraRelative: cameraRelative)
        let projected = face.geometry.vertices.map { vertex -> CGPoint in
            let world = face.transform * SIMD4<Float>(vertex.x, vertex.y, vertex.z, 1)
            return frame.camera.projectPoint(SIMD3<Float>(world.x, world.y, world.z), orientation: state.1, viewportSize: viewport)
        }
        let geometry = ARFaceCameraGeometry.normalizedProjection(projected, viewport: viewport)
        func blend(_ location: ARFaceAnchor.BlendShapeLocation) -> Double? {
            ARFaceCameraGeometry.coefficient(face.blendShapes[location]?.doubleValue)
        }
        let smile = ARFaceCameraGeometry.bilateralSmile(left: blend(.mouthSmileLeft), right: blend(.mouthSmileRight))
        let leftEye = blend(.eyeBlinkLeft).map { 0.3 * (1 - $0) }
        let rightEye = blend(.eyeBlinkRight).map { 0.3 * (1 - $0) }
        let imageRegion = ARFaceCameraGeometry.imageRegion(projectedFace: geometry.face,
            displayTransform: frame.displayTransform(for: state.1, viewportSize: viewport))
        let brightness = Self.luminance(frame.capturedImage, region: imageRegion)
        let sample = FaceGestureSample(time: timestamp, pitch: pose?.pitch ?? .nan, yaw: pose?.yaw ?? .nan,
            smileWidth: .nan, luminance: brightness, confidence: 1, faceCount: 1,
            faceArea: geometry.face.map { Double($0.width * $0.height) } ?? 0,
            mouthOpen: blend(.jawOpen), leftEyeOpen: leftEye, rightEyeOpen: rightEye,
            smileStrength: smile)
        guard !lock.withLock({ cancelled }) else { return }
        deliver(FaceCameraFrame(sample: sample, face: geometry.face, landmarks: geometry.landmarks,
            orientationRevision: state.2, imageAspect: viewport.width / viewport.height,
            trackingMode: "3D face tracking", processedAt: ProcessInfo.processInfo.systemUptime))
    }

    /// A small grid from the camera's luma plane is sufficient for a darkness hint; ARKit's
    /// tracked anchor remains the authority for visibility and expression measurements.
    private static func luminance(_ image: CVPixelBuffer, region: CGRect?) -> Double {
        guard let region, CVPixelBufferIsPlanar(image), CVPixelBufferGetPlaneCount(image) > 0 else { return 0.5 }
        CVPixelBufferLockBaseAddress(image, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(image, .readOnly) }
        guard let base = CVPixelBufferGetBaseAddressOfPlane(image, 0) else { return 0.5 }
        let width = CVPixelBufferGetWidthOfPlane(image, 0), height = CVPixelBufferGetHeightOfPlane(image, 0)
        let stride = CVPixelBufferGetBytesPerRowOfPlane(image, 0)
        guard width > 0, height > 0 else { return 0.5 }
        let bytes = base.assumingMemoryBound(to: UInt8.self)
        var total = 0.0
        for y in 0..<8 {
            let sampleY = min(height - 1, max(0, Int((region.minY + CGFloat(2 * y + 1) * region.height / 16) * CGFloat(height))))
            for x in 0..<8 {
                let sampleX = min(width - 1, max(0, Int((region.minX + CGFloat(2 * x + 1) * region.width / 16) * CGFloat(width))))
                total += Double(bytes[sampleY * stride + sampleX])
            }
        }
        return total / (64 * 255)
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
