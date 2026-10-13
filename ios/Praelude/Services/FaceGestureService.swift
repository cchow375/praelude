@preconcurrency import AVFoundation
@preconcurrency import ARKit
import Vision
import Observation
import UIKit
import ImageIO

struct FaceCameraFrame: Sendable {
    let sample: FaceGestureSample
    let face: CGRect?
    let landmarks: [CGPoint]
    var orientationRevision: Int = 0
    var trackingIssue: String? = nil
    var imageAspect: CGFloat = 0.75
    var trackingMode: String = "Camera"
    var processedAt: TimeInterval? = nil
}

/// Latest-only handoff: a busy UI cannot accumulate old camera frames or replay stale gestures.
final class FaceCameraFrameDelivery: @unchecked Sendable {
    private let lock = NSLock()
    private var latest: FaceCameraFrame?
    private var scheduled = false
    private let receive: @MainActor @Sendable (FaceCameraFrame) -> Void
    init(receive: @escaping @MainActor @Sendable (FaceCameraFrame) -> Void) { self.receive = receive }
    func submit(_ frame: FaceCameraFrame) {
        let enqueue = lock.withLock { latest = frame; if scheduled { return false }; scheduled = true; return true }
        guard enqueue else { return }
        Task { @MainActor [self] in
            let frame = lock.withLock { let value = latest; latest = nil; scheduled = false; return value }
            if let frame { receive(frame) }
        }
    }
}

/// Capture operations and main-actor preview connections share one logical FIFO across workers.
/// The UI never waits for it, and old capture must finish stopping before ownership is released.
protocol FaceCameraCapturing: AnyObject, Sendable {
    var captureSession: AVCaptureSession? { get }
    var faceTrackingSession: ARSession? { get }
    func start(angle: CGFloat, revision: Int, completion: @escaping @Sendable () -> Void)
    func rotate(_ angle: CGFloat, revision: Int)
    func stop(completion: @escaping @Sendable () -> Void)
    func attachPreview(_ layer: AVCaptureVideoPreviewLayer)
    func detachPreview(_ layer: AVCaptureVideoPreviewLayer)
}
extension FaceCameraCapturing { var faceTrackingSession: ARSession? { nil } }

typealias FaceCameraWorkerFactory = @Sendable (@escaping @Sendable (FaceCameraFrame) -> Void,
    @escaping @Sendable (String) -> Void) -> any FaceCameraCapturing

/// Logical FIFO across background capture and main-actor preview work. Waiting for a main
/// acknowledgement never blocks either executor, and the next capture job cannot overlap it.
final class FaceCameraOperationQueue: @unchecked Sendable {
    private typealias Job = @Sendable (@escaping @Sendable () -> Void) -> Void
    private let queue: DispatchQueue
    private var pending: [Job] = []
    private var executing = false
    init(label: String) { queue=DispatchQueue(label:label,qos:.userInitiated) }
    private func enqueue(_ job: @escaping Job) {
        queue.async { [self] in pending.append(job); advance() }
    }
    private func advance() {
        guard !executing, !pending.isEmpty else { return }
        executing=true
        let job=pending.removeFirst()
        job { [self] in queue.async { self.executing=false; self.advance() } }
    }
    func perform(_ work: @escaping @Sendable () -> Void) {
        enqueue { done in work(); done() }
    }
    func onMain(_ work: @escaping @MainActor @Sendable () -> Void) {
        enqueue { done in Task { @MainActor in work(); done() } }
    }
}

private final class FacePreviewReference: @unchecked Sendable {
    let layer: AVCaptureVideoPreviewLayer
    init(_ layer: AVCaptureVideoPreviewLayer) { self.layer = layer }
}

/// No microphone, file writer, identity recognition or network path is created.
private final class FaceCameraWorker: NSObject, FaceCameraCapturing,
    AVCaptureVideoDataOutputSampleBufferDelegate, @unchecked Sendable {
    private static let lifecycle = FaceCameraOperationQueue(label: "praelude.face-camera.lifecycle")
    private let analysis = DispatchQueue(label: "praelude.face-camera.analysis", qos: .userInitiated)
    private let session = AVCaptureSession()
    var captureSession: AVCaptureSession? { session }
    private let deliver: @Sendable (FaceCameraFrame) -> Void
    private let failed: @Sendable (String) -> Void
    private let lock = NSLock()
    private var cancelled = false
    private var orientationRevision = 0
    private let vision = FaceVisionAnalyzer()
    private var lastFrame = -Double.infinity
    private var lastTrackingFailure = -Double.infinity
    private var connection: AVCaptureConnection?
    private var angle: CGFloat = 90
    private var previews: [FacePreviewReference] = []
    init(deliver: @escaping @Sendable (FaceCameraFrame) -> Void, failed: @escaping @Sendable (String) -> Void) {
        self.deliver = deliver; self.failed = failed
    }
    private var isCancelled: Bool { lock.withLock { cancelled } }
    func start(angle: CGFloat, revision: Int, completion: @escaping @Sendable () -> Void) {
        Self.lifecycle.perform { [self] in
            guard !isCancelled else { return }
            do {
                guard let camera = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front) else {
                    failed("No front camera is available. Camera gestures require a physical device."); return
                }
                let input = try AVCaptureDeviceInput(device: camera)
                session.beginConfiguration()
                session.sessionPreset = session.canSetSessionPreset(.hd1280x720) ? .hd1280x720 : .vga640x480
                let output = AVCaptureVideoDataOutput()
                output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange]
                output.alwaysDiscardsLateVideoFrames = true
                guard session.canAddInput(input), session.canAddOutput(output) else {
                    session.commitConfiguration(); failed("The camera is in use or unavailable. Close other camera tools and try again."); return
                }
                session.addInput(input); session.addOutput(output)
                output.setSampleBufferDelegate(self, queue: analysis)
                connection = output.connection(with: .video)
                self.angle = angle
                lock.withLock { orientationRevision = revision }
                configure(connection, angle: angle, mirrored: false)
                session.commitConfiguration()
                guard !isCancelled else { return }
                session.startRunning()
                guard !isCancelled else { return }
                if session.isRunning { completion() }
                else { failed("The camera could not start. Try again when it is available.") }
            } catch { failed("The camera could not start. Check Camera permission and try again.") }
        }
    }
    private func configure(_ connection: AVCaptureConnection?, angle: CGFloat, mirrored: Bool = true) {
        guard let connection else { return }
        connection.automaticallyAdjustsVideoMirroring = false
        if connection.isVideoMirroringSupported { connection.isVideoMirrored = mirrored }
        if connection.isVideoRotationAngleSupported(angle) { connection.videoRotationAngle = angle }
    }
    func rotate(_ angle: CGFloat, revision: Int) {
        Self.lifecycle.perform { [self] in
            guard !isCancelled else { return }
            self.angle = angle
            configure(connection, angle: angle, mirrored: false)
            // This revision is stamped on analysis work only after capture rotation is applied.
            lock.withLock { orientationRevision = revision }
        }
        Self.lifecycle.onMain { [self] in
            guard !isCancelled else { return }
            for preview in previews { configure(preview.layer.connection, angle: angle) }
        }
    }
    func stop(completion: @escaping @Sendable () -> Void) {
        lock.withLock { cancelled = true }
        Self.lifecycle.perform { [self] in
            for output in session.outputs { (output as? AVCaptureVideoDataOutput)?.setSampleBufferDelegate(nil, queue: nil) }
            if session.isRunning { session.stopRunning() }
        }
        Self.lifecycle.onMain { [self] in
            for preview in previews { preview.layer.session = nil }
            previews = []
        }
        Self.lifecycle.perform { completion() }
    }
    func attachPreview(_ layer: AVCaptureVideoPreviewLayer) {
        let reference = FacePreviewReference(layer)
        Self.lifecycle.onMain { [self] in
            guard !isCancelled, !previews.contains(where: { $0.layer === reference.layer }) else { return }
            previews.append(reference)
            reference.layer.session = session
            configure(reference.layer.connection, angle: angle)
        }
    }
    func detachPreview(_ layer: AVCaptureVideoPreviewLayer) {
        let reference = FacePreviewReference(layer)
        Self.lifecycle.onMain { [self] in
            reference.layer.session = nil
            previews.removeAll { $0.layer === reference.layer }
        }
    }
    func captureOutput(_ output: AVCaptureOutput, didOutput buffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        let now = ProcessInfo.processInfo.systemUptime
        guard !isCancelled, now - lastFrame >= 1.0 / 15.0, let pixels = CMSampleBufferGetImageBuffer(buffer) else { return }
        lastFrame = now
        let revision = lock.withLock { orientationRevision }
        let aspect = CGFloat(CVPixelBufferGetWidth(pixels))/CGFloat(max(1,CVPixelBufferGetHeight(pixels)))
        do {
            let frame = try vision.analyze(pixels, orientation: .up, time: now, revision: revision,
                imageAspect: aspect, visionToDisplay: CGAffineTransform(a: -1, b: 0, c: 0, d: 1, tx: 1, ty: 0),
                trackingMode: "Camera landmarks")
            guard !isCancelled else { return }
            deliver(frame)
        } catch {
            if now-lastTrackingFailure >= 1 {
                lastTrackingFailure=now
                let sample=FaceGestureSample(time:now,pitch:.nan,yaw:.nan,smileWidth:.nan,
                    luminance:0,confidence:0,faceCount:0,faceArea:0,poseSource:.vision)
                deliver(FaceCameraFrame(sample:sample,face:nil,landmarks:[],orientationRevision:revision,
                    trackingIssue:"Face tracking interrupted · trying the next frame"))
            }
        }
    }

}

/// Reused by native capture and by ARKit's existing image stream when its 3D tracking is lost.
/// Each owner calls this synchronously on its serial analysis queue, never on the UI actor.
final class FaceVisionAnalyzer: @unchecked Sendable {
    private let rectangles = VNDetectFaceRectanglesRequest()
    private let landmarks = VNDetectFaceLandmarksRequest()
    init() {
        rectangles.revision = VNDetectFaceRectanglesRequestRevision3
        landmarks.revision = VNDetectFaceLandmarksRequestRevision3
        landmarks.constellation = .constellation76Points
    }
    func analyze(_ pixels: CVPixelBuffer, orientation: CGImagePropertyOrientation, time: TimeInterval,
                 revision: Int, imageAspect: CGFloat, imageToVision: CGAffineTransform = .identity,
                 visionToDisplay: CGAffineTransform = .identity, trackingMode: String) throws -> FaceCameraFrame {
        let handler = VNImageRequestHandler(cvPixelBuffer: pixels, orientation: orientation)
        try handler.perform([rectangles])
        let faces = rectangles.results ?? []
        let pose = faces.count == 1 ? faces.first : nil
        var face = pose
        if let pose {
            landmarks.inputFaceObservations = [pose]
            if (try? handler.perform([landmarks])) != nil { face = landmarks.results?.first ?? pose }
        }
        let uprightBox = face.flatMap { FaceCameraGeometry.validatedBox($0.boundingBox) }
        let box = FaceCameraGeometry.mappedBox(uprightBox, transform: visionToDisplay)
        let metrics = FaceCameraGeometry.metrics(face?.landmarks)
        let points = face?.landmarks?.allPoints?.normalizedPoints.compactMap { point -> CGPoint? in
            guard let face, point.x.isFinite, point.y.isFinite else { return nil }
            let upright = CGPoint(x: face.boundingBox.minX + point.x * face.boundingBox.width,
                y: 1 - face.boundingBox.minY - point.y * face.boundingBox.height)
            return upright.applying(visionToDisplay)
        } ?? []
        let sensorBox = FaceCameraGeometry.mappedBox(uprightBox, transform: imageToVision.inverted())
        let sample = FaceGestureSample(time: time, pitch: pose?.pitch?.doubleValue ?? .nan,
            yaw: FaceCameraGeometry.playerYaw(visionYaw: pose?.yaw?.doubleValue ?? .nan, mirrored: false),
            smileWidth: metrics.smile ?? .nan, luminance: FaceCameraGeometry.luminance(pixels, box: sensorBox),
            confidence: Double(pose?.confidence ?? 0), faceCount: faces.count,
            faceArea: Double(box.map { $0.width * $0.height } ?? 0),
            mouthOpen: metrics.mouth, leftEyeOpen: metrics.leftEye, rightEyeOpen: metrics.rightEye,
            smileLift: metrics.smileLift, poseSource: .vision)
        return FaceCameraFrame(sample: sample, face: box, landmarks: points, orientationRevision: revision,
            imageAspect: imageAspect, trackingMode: trackingMode, processedAt: ProcessInfo.processInfo.systemUptime)
    }
}

/// Geometry helpers keep unavailable individual landmarks separate from face visibility.
enum FaceCameraGeometry {
    struct Metrics { var smile: Double?; var mouth: Double?; var leftEye: Double?; var rightEye: Double?; var smileLift: Double? }
    /// Vision reports counterclockwise yaw. Unmirrored camera +x is the player's left;
    /// normalize it to the same player-right positive contract as ARKit.
    static func playerYaw(visionYaw: Double, mirrored: Bool) -> Double { mirrored ? visionYaw : -visionYaw }
    static func mappedBox(_ box: CGRect?, transform: CGAffineTransform) -> CGRect? {
        guard let box else { return nil }
        let mapped = box.applying(transform)
        guard [mapped.minX, mapped.minY, mapped.width, mapped.height].allSatisfy(\.isFinite) else { return nil }
        let clipped = mapped.intersection(CGRect(x: 0, y: 0, width: 1, height: 1))
        return !clipped.isNull && clipped.width > 0 && clipped.height > 0 ? clipped : nil
    }
    static func luminance(_ pixels: CVPixelBuffer, box: CGRect?) -> Double {
        guard let region = mappedBox(box, transform: .identity) else { return 0 }
        CVPixelBufferLockBaseAddress(pixels, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(pixels, .readOnly) }
        guard CVPixelBufferGetPlaneCount(pixels) > 0,
              let base = CVPixelBufferGetBaseAddressOfPlane(pixels, 0) else { return 0 }
        let width = CVPixelBufferGetWidthOfPlane(pixels, 0), height = CVPixelBufferGetHeightOfPlane(pixels, 0)
        let stride = CVPixelBufferGetBytesPerRowOfPlane(pixels, 0)
        guard width > 0, height > 0, stride >= width else { return 0 }
        let bytes = base.assumingMemoryBound(to: UInt8.self)
        var sum = 0.0
        for y in 0..<8 { for x in 0..<8 {
            let px = min(width-1, max(0, Int((region.minX+region.width*(CGFloat(x)+0.5)/8)*CGFloat(width))))
            let py = min(height-1, max(0, Int((region.minY+region.height*(CGFloat(y)+0.5)/8)*CGFloat(height))))
            sum += Double(bytes[py*stride+px])/255
        } }
        return sum/64
    }
    static func validatedBox(_ box: CGRect) -> CGRect? {
        guard [box.minX, box.minY, box.width, box.height].allSatisfy(\.isFinite), box.width > 0, box.height > 0 else { return nil }
        let clipped = box.intersection(CGRect(x: 0,y: 0,width: 1,height: 1))
        guard !clipped.isNull, clipped.width > 0, clipped.height > 0 else { return nil }
        return CGRect(x: clipped.minX,y: 1-clipped.maxY,width: clipped.width,height: clipped.height)
    }
    static func center(_ points: [CGPoint]) -> CGPoint? {
        guard !points.isEmpty, points.allSatisfy({ $0.x.isFinite && $0.y.isFinite }) else { return nil }
        return CGPoint(x: points.map(\.x).reduce(0,+)/CGFloat(points.count),y: points.map(\.y).reduce(0,+)/CGFloat(points.count))
    }
    static func aspect(_ points: [CGPoint]) -> Double? {
        guard points.count >= 4, let center = center(points) else { return nil }
        // Eye/lip point extent in its own principal horizontal axis tolerates ordinary head roll.
        let farthest = points.max { hypot($0.x-center.x,$0.y-center.y) < hypot($1.x-center.x,$1.y-center.y) }!
        let length = hypot(farthest.x-center.x,farthest.y-center.y)
        guard length > 0.001 else { return nil }
        let dx=(farthest.x-center.x)/length, dy=(farthest.y-center.y)/length
        let horizontal=points.map { ($0.x-center.x)*dx+($0.y-center.y)*dy }
        let vertical=points.map { -($0.x-center.x)*dy+($0.y-center.y)*dx }
        let width=horizontal.max()!-horizontal.min()!, height=vertical.max()!-vertical.min()!
        return width > 0.001 ? Double(height/width) : nil
    }
    /// Aggregate both corner regions and the central contour; one jumping point cannot define a smile.
    static func lipCornerLift(_ lips: [CGPoint], leftEye: CGPoint, rightEye: CGPoint) -> Double? {
        guard lips.count >= 8, lips.allSatisfy({ $0.x.isFinite && $0.y.isFinite }),
              [leftEye.x,leftEye.y,rightEye.x,rightEye.y].allSatisfy(\.isFinite) else { return nil }
        let distance = hypot(rightEye.x-leftEye.x,rightEye.y-leftEye.y)
        guard distance > 0.02 else { return nil }
        let sign: CGFloat = rightEye.x >= leftEye.x ? 1 : -1
        let dx=sign*(rightEye.x-leftEye.x)/distance, dy=sign*(rightEye.y-leftEye.y)/distance
        let points=lips.map { CGPoint(x: ($0.x*dx+$0.y*dy)/distance, y: (-$0.x*dy+$0.y*dx)/distance) }
        guard let minX=points.map(\.x).min(), let maxX=points.map(\.x).max(), maxX-minX > 0.05 else { return nil }
        let width=maxX-minX, middle=(minX+maxX)/2
        let left=points.filter { $0.x <= minX+width*0.2 }, right=points.filter { $0.x >= maxX-width*0.2 }
        let center=points.filter { abs($0.x-middle) <= width*0.22 }
        guard !left.isEmpty, !right.isEmpty, !center.isEmpty else { return nil }
        func mean(_ p:[CGPoint]) -> Double { Double(p.map(\.y).reduce(0,+)/CGFloat(p.count)) }
        return min(mean(left),mean(right))-mean(center)
    }
    static func metrics(_ landmarks: VNFaceLandmarks2D?) -> Metrics {
        guard let landmarks else { return Metrics() }
        let left=landmarks.leftEye?.normalizedPoints ?? [], right=landmarks.rightEye?.normalizedPoints ?? []
        var result=Metrics(leftEye: aspect(left),rightEye: aspect(right))
        guard let l=center(left), let r=center(right) else { return result }
        let distance=hypot(l.x-r.x,l.y-r.y)
        guard distance > 0.02 else { return result }
        let dx=(r.x-l.x)/distance, dy=(r.y-l.y)/distance
        let outer=landmarks.outerLips?.normalizedPoints ?? []
        let inner=landmarks.innerLips?.normalizedPoints ?? []
        func extent(_ points:[CGPoint],vertical:Bool) -> Double? {
            guard points.count >= 2, points.allSatisfy({ $0.x.isFinite && $0.y.isFinite }) else { return nil }
            let values=points.map { vertical ? -$0.x*dy+$0.y*dx : $0.x*dx+$0.y*dy }
            return Double((values.max()!-values.min()!)/distance)
        }
        result.smile=extent(outer,vertical:false); result.mouth=extent(inner,vertical:true)
        result.smileLift = lipCornerLift(outer, leftEye: l, rightEye: r)
        return result
    }
}

@MainActor @Observable final class FaceGestureService {
    private static weak var captureOwner: FaceGestureService?
    #if DEBUG
    private static var didResetTestPreferences = false
    #endif
    private(set) var isEnabled = false
    private(set) var isPreparing = false
    private(set) var isStopping = false
    private(set) var status = "Camera is off"
    private(set) var calibrated = false
    private(set) var calibrationProgress = 0.0
    private(set) var availableGestures: Set<FaceGesture> = []
    private(set) var frame: FaceCameraFrame?
    private(set) var lastGesture = "No gesture yet"
    var showPreview = false
    var showMapping = true
    var settings: FaceGestureSettings {
        didSet {
            if let data = try? JSONEncoder().encode(settings) { preferences.set(data,forKey: preferencesKey) }
            if settings != oldValue { commandContextID = UUID() }
            detector.configure(settings: settings)
        }
    }
    @ObservationIgnored private(set) var commandContextID = UUID()
    var commandInFlight = false
    var actionsAllowed = false { didSet { if actionsAllowed != oldValue { resetMotion() } } }
    var verdictActionsAllowed = false { didSet { if verdictActionsAllowed != oldValue { resetMotion() } } }
    var verdictUnavailableReason = "Start a practice set to record reps"
    @ObservationIgnored var onAction: ((FaceGestureAction) -> Void)?
    @ObservationIgnored private let permission: @Sendable () async -> Bool
    @ObservationIgnored private let factory: FaceCameraWorkerFactory
    @ObservationIgnored private let now: @Sendable () -> TimeInterval
    @ObservationIgnored private let preferences: UserDefaults
    @ObservationIgnored private let preferencesKey: String
    @ObservationIgnored private var worker: (any FaceCameraCapturing)?
    @ObservationIgnored private var detector = FaceGestureDetector()
    @ObservationIgnored private var recent: [FaceGestureSample] = []
    @ObservationIgnored private var generation = UUID()
    @ObservationIgnored private var orientationRevision = 0
    @ObservationIgnored private var lastCalibrationSupplement = -Double.infinity
    @ObservationIgnored private var poseSource: FaceGesturePoseSource = .unspecified
    @ObservationIgnored private var trackingInvalid = true
    @ObservationIgnored private var observers: [NSObjectProtocol] = []
    private(set) var rotationAngle: CGFloat = 90
    var session: AVCaptureSession? { isEnabled ? worker?.captureSession : nil }
    var faceTrackingSession: ARSession? { isEnabled ? worker?.faceTrackingSession : nil }
    init(permission: @escaping @Sendable () async -> Bool = { await AVCaptureDevice.requestAccess(for: .video) },
         workerFactory: @escaping FaceCameraWorkerFactory = { deliver, failed in
             if ARFaceTrackingConfiguration.isSupported { return ARFaceCameraWorker(deliver: deliver, failed: failed) }
             return FaceCameraWorker(deliver: deliver, failed: failed)
         },
         preferences: UserDefaults = .standard,
         now: @escaping @Sendable () -> TimeInterval = { ProcessInfo.processInfo.systemUptime }) {
        self.preferences=preferences; self.now=now
        var key="ios.faceGestures"
        var permission=permission
        var workerFactory=workerFactory
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--uitesting") {
            key="ios.faceGestures.uiTesting"
            if ProcessInfo.processInfo.arguments.contains("--reset"), !Self.didResetTestPreferences {
                preferences.removeObject(forKey:key); Self.didResetTestPreferences=true
            }
            if ProcessInfo.processInfo.arguments.contains("--audit-simulated-face") {
                permission={ true }
                workerFactory={ deliver, _ in SimulatedFaceCameraWorker(deliver:deliver) }
            }
        }
        #endif
        self.preferencesKey=key; self.permission=permission; self.factory=workerFactory
        settings=preferences.data(forKey:key).flatMap { try? JSONDecoder().decode(FaceGestureSettings.self,from:$0) } ?? FaceGestureSettings()
        detector.configure(settings:settings)
    }
    func start() {
        guard !isEnabled && !isPreparing && !isStopping else { return }
        if let owner=Self.captureOwner, owner !== self {
            status="Camera gestures are in use in another score. Turn them off there before enabling them here."; return
        }
        Self.captureOwner=self; generation=UUID(); let token=generation
        orientationRevision=0; isPreparing=true; status="Checking Camera permission…"
        Task { [weak self] in
            guard let permission=self?.permission else { return }
            let authorized=await permission()
            guard let self, self.generation==token else { return }
            guard authorized else {
                self.isPreparing=false
                if Self.captureOwner===self { Self.captureOwner=nil }
                self.status="Camera permission is off. Enable it in Settings to use gestures."; return
            }
            self.status="Starting camera…"
            let delivery=FaceCameraFrameDelivery { [weak self] frame in
                guard let self, self.generation==token, self.isEnabled else { return }
                self.receive(frame)
            }
            let worker=self.factory({ frame in delivery.submit(frame) },{ [weak self] message in
                Task { @MainActor [weak self] in
                    guard let self, self.generation==token else { return }
                    self.stop(message:message)
                }
            })
            self.worker=worker
            if let session=worker.captureSession {
                for name in [AVCaptureSession.wasInterruptedNotification,AVCaptureSession.runtimeErrorNotification] {
                    self.observers.append(NotificationCenter.default.addObserver(forName:name,object:session,queue:nil) { [weak self] _ in
                        // Capture may post while holding its locks. Never wait for the UI actor.
                        Task { @MainActor [weak self] in
                            guard let self,self.generation==token else { return }
                            self.stop(message:"Camera interrupted. Enable it again when available.")
                        }
                    })
                }
            }
            worker.start(angle:self.rotationAngle,revision:self.orientationRevision) { [weak self] in
                Task { @MainActor [weak self] in
                    guard let self,self.generation==token else { return }
                    self.isPreparing=false; self.isEnabled=true; self.status="Looking for one face…"
                }
            }
        }
    }
    func stop() { stop(message:"Camera is off") }
    private func stop(message:String) {
        guard !isStopping else { return }
        commandContextID=UUID(); generation=UUID(); observers.forEach(NotificationCenter.default.removeObserver); observers=[]
        poseSource = .unspecified; trackingInvalid = true
        isEnabled=false; isPreparing=false; calibrated=false; calibrationProgress=0; availableGestures=[]; frame=nil
        detector.clearCalibration(); recent=[]; lastCalibrationSupplement = -Double.infinity; status=message
        guard let retiring=worker else {
            if Self.captureOwner===self { Self.captureOwner=nil }; return
        }
        isStopping=true
        retiring.stop { [weak self] in
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.worker=nil; self.isStopping=false
                if Self.captureOwner===self { Self.captureOwner=nil }
            }
        }
    }
    func attachPreview(_ layer:AVCaptureVideoPreviewLayer) { if isEnabled { worker?.attachPreview(layer) } }
    func detachPreview(_ layer:AVCaptureVideoPreviewLayer) { worker?.detachPreview(layer) }
    func rotate(_ orientation:UIInterfaceOrientation) {
        let next:CGFloat=switch orientation {
        case .landscapeRight:0; case .landscapeLeft:180; case .portraitUpsideDown:270; default:90
        }
        guard next != rotationAngle else { return }
        commandContextID=UUID(); rotationAngle=next; orientationRevision += 1
        worker?.rotate(next,revision:orientationRevision)
        detector.clearCalibration(); recent=[]; calibrated=false; calibrationProgress=0; availableGestures=[]
        if isEnabled { status="Orientation changed · hold relaxed while the camera recalibrates" }
    }
    func calibrate() {
        commandContextID=UUID()
        detector.clearCalibration(); calibrated=false; availableGestures=[]
        finishCalibration()
        if !calibrated { status="Hold your face relaxed for a second · calibrating automatically" }
    }
    private func finishCalibration() {
        guard recent.last.map({ now()-$0.time <= 0.35 })==true else { return }
        calibrated=detector.calibrate(recent)
        if calibrated { availableGestures=detector.availableGestures; calibrationProgress=1 }
    }
    func resetMotion() { commandContextID=UUID(); detector.resetMotion() }
    private func invalidateTrackingContext() {
        if !trackingInvalid {
            // A recognized gesture is explicit input, not continuous face authentication.
            // Later tracking loss pauses new recognition but cannot retract an accepted rep.
            if !commandInFlight { commandContextID = UUID() }
            trackingInvalid = true
        }
    }
    // Internal for native tests: inject measurements through the real calibration/action gates.
    func receive(_ frame:FaceCameraFrame) {
        guard isEnabled, frame.orientationRevision==orientationRevision else { return }
        self.frame=frame
        if let issue=frame.trackingIssue {
            invalidateTrackingContext()
            detector.resetMotion(); recent=[]; calibrationProgress=0; status=issue; return
        }
        guard frame.sample.time.isFinite, now() >= frame.sample.time, now()-frame.sample.time <= 0.35 else {
            invalidateTrackingContext()
            detector.resetMotion(); recent=[]; calibrationProgress=0; status="Tracking delayed · gestures paused"; return
        }
        if frame.sample.poseSource != poseSource {
            if !commandInFlight { commandContextID = UUID() }
            poseSource = frame.sample.poseSource
            detector.clearCalibration(); recent=[]; calibrated=false; calibrationProgress=0; availableGestures=[]
            lastCalibrationSupplement = -Double.infinity
        }
        if frame.sample.usable {
            trackingInvalid = false
            recent.append(frame.sample); recent=recent.filter { frame.sample.time-$0.time <= 1.3 }
            if !calibrated {
                calibrationProgress=min(0.95, max(0,(recent.last!.time-recent.first!.time)/0.9))
                finishCalibration()
            }
            if calibrated {
                if availableGestures.count < FaceGesture.allCases.count,
                   frame.sample.time-lastCalibrationSupplement >= 1 {
                    lastCalibrationSupplement=frame.sample.time
                    if detector.supplementCalibration(recent) { availableGestures=detector.availableGestures }
                }
                let assigned=Set(FaceGestureAction.allCases.filter { $0 != .off }.compactMap { settings.gesture(for:$0) })
                let missing=assigned.subtracting(availableGestures)
                let detail=missing.isEmpty ? "" : " · unavailable: "+missing.map(\.title).sorted().joined(separator:", ")
                status=(actionsAllowed ? "Ready · quick look, then return to center" : "Test mode · actions paused in settings")+detail
            } else if !frame.sample.pitch.isFinite && !frame.sample.yaw.isFinite {
                status="Face seen · head angle unavailable; face the iPad to calibrate"
            } else { status="Face seen · hold your usual piano position for calibration" }
        } else {
            invalidateTrackingContext()
            recent=[]; calibrationProgress=0
            switch frame.sample.faceCount {
            case 0:status="No face found · check the camera angle"
            case 2...:status="More than one face · gestures paused"
            default:
                if frame.sample.faceArea < 0.002 { status="Face seen · head angle is not reliable at this distance" }
                else if frame.sample.luminance < 0.025 { status="Face is too dark · add light toward your face" }
                else { status="Face seen · waiting for reliable head or expression measurements" }
            }
        }
        if let gesture=detector.consume(frame.sample) {
            let action=settings.action(for:gesture)
            let canAct=calibrated && actionsAllowed && !commandInFlight && action != .off && (!action.isVerdict || (settings.allowVerdicts && verdictActionsAllowed))
            let detail:String
            if canAct { detail=action.title }
            else if action == .off { detail="recognized · unassigned" }
            else if !actionsAllowed { detail="recognized · test only" }
            else if commandInFlight { detail="recognized · previous command finishing" }
            else if action.isVerdict && !settings.allowVerdicts { detail="recognized · rep gestures are off" }
            else { detail="recognized · \(verdictUnavailableReason)" }
            lastGesture="\(gesture.title) → \(detail)"
            if canAct { onAction?(action) }
        }
    }
}

#if DEBUG
/// Synthetic lifecycle/face measurements only; physical video preview requires device acceptance.
private final class SimulatedFaceCameraWorker: FaceCameraCapturing, @unchecked Sendable {
    var captureSession:AVCaptureSession? { nil }
    private let stateLock=NSLock()
    private var cancelled=false
    private let deliver:@Sendable(FaceCameraFrame)->Void
    private let queue=DispatchQueue(label:"praelude.face-camera.ui-test")
    private var timer:DispatchSourceTimer?
    private var revision=0
    init(deliver:@escaping @Sendable(FaceCameraFrame)->Void) { self.deliver=deliver }
    func start(angle:CGFloat,revision:Int,completion:@escaping @Sendable()->Void) {
        queue.async { [self] in
            guard !stateLock.withLock({ cancelled }) else { return }
            self.revision=revision
            let timer=DispatchSource.makeTimerSource(queue:queue); self.timer=timer
            timer.schedule(deadline:.now()+0.1,repeating:0.08)
            timer.setEventHandler { [weak self] in
                guard let self else { return }
                let sample=FaceGestureSample(time:ProcessInfo.processInfo.systemUptime,pitch:0,yaw:0,smileWidth:0.9,
                    luminance:0.4,confidence:0.95,faceCount:1,faceArea:0.04,mouthOpen:0.02,leftEyeOpen:0.3,rightEyeOpen:0.3)
                deliver(FaceCameraFrame(sample:sample,face:CGRect(x:0.3,y:0.25,width:0.2,height:0.2),landmarks:[],orientationRevision:revision))
            }
            timer.resume(); completion()
        }
    }
    func rotate(_ angle:CGFloat,revision:Int) { queue.async { self.revision=revision } }
    func stop(completion:@escaping @Sendable()->Void) {
        stateLock.withLock { cancelled=true }
        queue.async { self.timer?.cancel(); self.timer=nil; completion() }
    }
    func attachPreview(_ layer:AVCaptureVideoPreviewLayer) {}
    func detachPreview(_ layer:AVCaptureVideoPreviewLayer) {}
}
#endif
