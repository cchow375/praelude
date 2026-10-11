@preconcurrency import AVFoundation
import Vision
import Observation
import UIKit

struct FaceCameraFrame: Sendable {
    let sample: FaceGestureSample
    let face: CGRect?
    let landmarks: [CGPoint]
}

/// One serial owner for capture and Vision. Frames are discarded after analysis; no microphone
/// input, file writer, identity recognition or network path is created.
private final class FaceCameraWorker: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate, @unchecked Sendable {
    let session = AVCaptureSession()
    private let queue = DispatchQueue(label: "praelude.face-camera", qos: .userInitiated)
    private let deliver: @Sendable (FaceCameraFrame) -> Void
    private let failed: @Sendable (String) -> Void
    private var lastFrame = -Double.infinity
    private var stopped = false
    private var connection: AVCaptureConnection?
    init(deliver: @escaping @Sendable (FaceCameraFrame) -> Void, failed: @escaping @Sendable (String) -> Void) {
        self.deliver = deliver; self.failed = failed
    }
    func start(angle: CGFloat) {
        queue.async { [self] in
            guard !stopped else { return }
            do {
                guard let camera = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front) else {
                    failed("No front camera is available. Camera gestures require a physical device."); return
                }
                let input = try AVCaptureDeviceInput(device: camera)
                session.beginConfiguration()
                session.sessionPreset = .vga640x480
                let output = AVCaptureVideoDataOutput()
                output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange]
                output.alwaysDiscardsLateVideoFrames = true
                guard session.canAddInput(input), session.canAddOutput(output) else {
                    session.commitConfiguration(); failed("The camera is in use or unavailable. Close other camera tools and try again."); return
                }
                session.addInput(input); session.addOutput(output)
                output.setSampleBufferDelegate(self, queue: queue)
                connection = output.connection(with: .video)
                if let connection {
                    connection.automaticallyAdjustsVideoMirroring = false
                    if connection.isVideoMirroringSupported { connection.isVideoMirrored = true }
                    if connection.isVideoRotationAngleSupported(angle) { connection.videoRotationAngle = angle }
                }
                session.commitConfiguration()
                session.startRunning()
                if !session.isRunning { failed("The camera could not start. Try again when it is available.") }
            } catch { failed("The camera could not start. Check Camera permission and try again.") }
        }
    }
    func rotate(_ angle: CGFloat) {
        queue.async { [self] in
            if let connection, connection.isVideoRotationAngleSupported(angle) { connection.videoRotationAngle = angle }
        }
    }
    func stop() {
        queue.async { [self] in
            stopped = true
            for output in session.outputs { (output as? AVCaptureVideoDataOutput)?.setSampleBufferDelegate(nil, queue: nil) }
            if session.isRunning { session.stopRunning() }
        }
    }
    func captureOutput(_ output: AVCaptureOutput, didOutput buffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        let now = ProcessInfo.processInfo.systemUptime
        guard !stopped, now - lastFrame >= 0.1, let pixels = CMSampleBufferGetImageBuffer(buffer) else { return }
        lastFrame = now
        let request = VNDetectFaceLandmarksRequest()
        do { try VNImageRequestHandler(cvPixelBuffer: pixels, orientation: .up).perform([request]) }
        catch { failed("Face mapping was interrupted. Restart the camera to try again."); return }
        let faces = request.results ?? []
        let face = faces.count == 1 ? faces.first : nil
        var width = 0.0
        if let marks = face?.landmarks, let lips = marks.outerLips?.normalizedPoints,
           let left = marks.leftEye?.normalizedPoints, let right = marks.rightEye?.normalizedPoints,
           !lips.isEmpty, !left.isEmpty, !right.isEmpty {
            let eyeDistance = abs(left.map(\.x).reduce(0,+)/CGFloat(left.count) - right.map(\.x).reduce(0,+)/CGFloat(right.count))
            if eyeDistance > 0.05 { width = Double((lips.map(\.x).max()! - lips.map(\.x).min()!) / eyeDistance) }
        }
        let points = face?.landmarks?.allPoints?.normalizedPoints.map { point in
            CGPoint(x: face!.boundingBox.minX + point.x * face!.boundingBox.width,
                    y: 1 - face!.boundingBox.minY - point.y * face!.boundingBox.height)
        } ?? []
        let box = face.map { CGRect(x: $0.boundingBox.minX, y: 1 - $0.boundingBox.maxY,
                                   width: $0.boundingBox.width, height: $0.boundingBox.height) }
        let light = Self.luminance(pixels, box: box)
        let sample = FaceGestureSample(time: now, pitch: face?.pitch?.doubleValue ?? .nan,
            yaw: face?.yaw?.doubleValue ?? .nan, smileWidth: width, luminance: light,
            confidence: Double(face?.confidence ?? 0), faceCount: faces.count,
            faceArea: Double(face.map { $0.boundingBox.width * $0.boundingBox.height } ?? 0))
        deliver(FaceCameraFrame(sample: sample, face: box, landmarks: points))
    }
    private static func luminance(_ pixels: CVPixelBuffer, box: CGRect?) -> Double {
        CVPixelBufferLockBaseAddress(pixels, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(pixels, .readOnly) }
        guard CVPixelBufferGetPlaneCount(pixels) > 0,
              let base = CVPixelBufferGetBaseAddressOfPlane(pixels, 0) else { return 0 }
        let w = CVPixelBufferGetWidthOfPlane(pixels,0), h = CVPixelBufferGetHeightOfPlane(pixels,0)
        let stride = CVPixelBufferGetBytesPerRowOfPlane(pixels,0)
        let bytes = base.assumingMemoryBound(to: UInt8.self)
        let region = box ?? CGRect(x: 0,y: 0,width: 1,height: 1)
        var sum = 0.0
        for y in 0..<12 { for x in 0..<12 {
            let px = min(w-1,max(0,Int((region.minX + region.width * (CGFloat(x)+0.5)/12) * CGFloat(w))))
            let py = min(h-1,max(0,Int((region.minY + region.height * (CGFloat(y)+0.5)/12) * CGFloat(h))))
            sum += Double(bytes[py*stride+px])/255
        } }
        return sum/144
    }
}

@MainActor @Observable final class FaceGestureService {
    private static weak var captureOwner: FaceGestureService?
    private(set) var isEnabled = false
    private(set) var isPreparing = false
    private(set) var status = "Camera is off"
    private(set) var calibrated = false
    private(set) var frame: FaceCameraFrame?
    private(set) var lastGesture = "No gesture yet"
    var showPreview = false
    var showMapping = true
    var settings: FaceGestureSettings {
        didSet {
            if let data = try? JSONEncoder().encode(settings) { UserDefaults.standard.set(data,forKey: "ios.faceGestures") }
            detector.resetMotion()
        }
    }
    var actionsAllowed = false { didSet { if actionsAllowed != oldValue { detector.resetMotion() } } }
    @ObservationIgnored var onAction: ((FaceGestureAction) -> Void)?
    @ObservationIgnored private let permission: @Sendable () async -> Bool
    @ObservationIgnored private var worker: FaceCameraWorker?
    @ObservationIgnored private var detector = FaceGestureDetector()
    @ObservationIgnored private var recent: [FaceGestureSample] = []
    @ObservationIgnored private var generation = UUID()
    private(set) var rotationAngle: CGFloat = 90
    @ObservationIgnored private var observers: [NSObjectProtocol] = []
    var session: AVCaptureSession? { worker?.session }
    init(permission: @escaping @Sendable () async -> Bool = { await AVCaptureDevice.requestAccess(for: .video) }) {
        self.permission = permission
        settings = UserDefaults.standard.data(forKey: "ios.faceGestures").flatMap { try? JSONDecoder().decode(FaceGestureSettings.self,from: $0) } ?? FaceGestureSettings()
    }
    func start() {
        guard !isEnabled && !isPreparing else { return }
        if let owner = Self.captureOwner, owner !== self, owner.isEnabled || owner.isPreparing {
            status = "Camera gestures are in use in another score. Turn them off there before enabling them here."
            return
        }
        Self.captureOwner = self
        generation = UUID(); let token = generation
        isPreparing = true; status = "Checking Camera permission…"
        Task { [weak self] in
            guard let permission = self?.permission else { return }
            let authorized = await permission()
            guard let self, self.generation == token else { return }
            self.isPreparing = false
            guard authorized else {
                if Self.captureOwner === self { Self.captureOwner = nil }
                self.status = "Camera permission is off. Enable it in Settings to use gestures."; return
            }
            self.isEnabled = true; self.status = "Looking for one face…"
            let worker = FaceCameraWorker(deliver: { [weak self] frame in
                Task { @MainActor [weak self] in
                    guard let self, self.generation == token, self.isEnabled else { return }
                    self.receive(frame)
                }
            }, failed: { [weak self] message in
                Task { @MainActor [weak self] in
                    guard let self, self.generation == token else { return }
                    self.stop(); self.status = message
                }
            })
            self.worker = worker
            for name in [AVCaptureSession.wasInterruptedNotification, AVCaptureSession.runtimeErrorNotification] {
                self.observers.append(NotificationCenter.default.addObserver(forName: name, object: worker.session, queue: .main) { [weak self] _ in
                    Task { @MainActor [weak self] in
                        guard let self, self.generation == token else { return }
                        self.stop(); self.status = "Camera interrupted. Tap Enable camera to restart and recalibrate."
                    }
                })
            }
            worker.start(angle: self.rotationAngle)
        }
    }
    func stop() {
        if Self.captureOwner === self { Self.captureOwner = nil }
        generation = UUID(); worker?.stop(); worker = nil
        observers.forEach(NotificationCenter.default.removeObserver); observers = []
        isEnabled = false; isPreparing = false; calibrated = false; frame = nil
        detector.clearCalibration(); recent = []; status = "Camera is off"
    }
    func rotate(_ orientation: UIInterfaceOrientation) {
        let next: CGFloat = switch orientation {
        case .landscapeRight: 0; case .landscapeLeft: 180; case .portraitUpsideDown: 270; default: 90
        }
        guard next != rotationAngle else { return }
        rotationAngle = next; worker?.rotate(next); detector.clearCalibration(); recent = []; calibrated = false
        if isEnabled { status = "Orientation changed. Calibrate again in Camera gestures." }
    }
    func calibrate() {
        detector.clearCalibration()
        calibrated = recent.last.map { ProcessInfo.processInfo.systemUptime - $0.time <= 0.35 } == true && detector.calibrate(recent)
        status = calibrated ? "Calibrated. Test a nod, shake and grin, returning to neutral each time." : "Hold one well-lit face still and relaxed for a second, then try again."
    }
    func resetMotion() { detector.resetMotion() }
    private func receive(_ frame: FaceCameraFrame) {
        self.frame = frame
        guard ProcessInfo.processInfo.systemUptime - frame.sample.time <= 0.35 else { detector.resetMotion(); recent = []; status = "Mapping delayed · gestures paused"; return }
        if frame.sample.usable {
            recent.append(frame.sample); recent = recent.filter { frame.sample.time - $0.time <= 1.2 }
            status = calibrated ? (actionsAllowed ? "Ready · return to neutral between gestures" : "Test only · score actions paused") : "Hold your face relaxed, then calibrate"
        } else {
            recent = []
            if frame.sample.luminance < 0.16 { status = "Low light · gestures paused. Add light toward your face." }
            else if frame.sample.faceCount > 1 { status = "More than one face · gestures paused" }
            else { status = "Face mapping unclear · face the camera or move closer" }
        }
        if let gesture = detector.consume(frame.sample) {
            let action = settings.action(for: gesture)
            let canAct = calibrated && actionsAllowed && action != .off && (!action.isVerdict || settings.allowVerdicts)
            lastGesture = "\(gesture.title) → \(canAct ? action.title : "test only")"
            if canAct { onAction?(action) }
        }
    }
}
