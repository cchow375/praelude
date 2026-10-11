@preconcurrency import AVFoundation
import SwiftUI

struct FaceGestureControlsView: View {
    @Bindable var camera: FaceGestureService
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text("Turn pages with a grin, or use a deliberate nod or head shake as your own rep verdict. Practice verdicts have a separate switch below.")
                    Text("Frames stay on this device and are discarded after face mapping. Praelude does not identify people, record camera video or judge playing.").font(.caption).foregroundStyle(.secondary)
                    Button(camera.isEnabled || camera.isPreparing ? "Turn camera off" : "Enable camera") {
                        if camera.isEnabled || camera.isPreparing { camera.stop() } else { camera.start() }
                    }.frame(minHeight: 44).accessibilityIdentifier("toggleFaceCamera")
                    Text(camera.status).font(.subheadline).accessibilityIdentifier("faceCameraStatus")
                    if !camera.isEnabled {
                        Button("Open Camera permission settings") {
                            if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
                        }.frame(minHeight: 44)
                    }
                }
                Section("See and calibrate") {
                    Toggle("Show camera preview", isOn: $camera.showPreview).accessibilityIdentifier("showFacePreview")
                    if camera.showPreview {
                        if camera.isEnabled {
                            FaceCameraPreview(camera: camera).frame(height: 260).clipShape(RoundedRectangle(cornerRadius: 12))
                        } else { Text("Enable the camera to see its preview. It starts minimized.").font(.caption).foregroundStyle(.secondary) }
                    }
                    Toggle("Show face mapping", isOn: $camera.showMapping).accessibilityIdentifier("showFaceMapping")
                    Button(camera.calibrated ? "Recalibrate neutral face" : "Calibrate neutral face") { camera.calibrate() }
                        .frame(minHeight: 44).disabled(!camera.isEnabled).accessibilityIdentifier("calibrateFaceCamera")
                    Text("Sit as you will at the piano. Face the camera with your mouth relaxed for a second, then calibrate. Recalibrate after rotating or moving the iPad. Low light, multiple faces and unclear mapping pause gestures.").font(.caption).foregroundStyle(.secondary)
                    Text(camera.lastGesture).font(.subheadline.weight(.semibold)).accessibilityIdentifier("lastFaceGesture")
                    Text("Test here: nod down and back, shake left then right and back, or hold a wide grin briefly and relax. Actions are paused while this panel is open. Return to the score to use your mappings.").font(.caption).foregroundStyle(.secondary)
                }
                Section("Gesture actions") {
                    Picker("Nod", selection: $camera.settings.nod) { actions }
                        .accessibilityIdentifier("faceNodAction")
                    Picker("Shake head", selection: $camera.settings.shake) { actions }
                        .accessibilityIdentifier("faceShakeAction")
                    Picker("Grin", selection: $camera.settings.grin) { actions }
                        .accessibilityIdentifier("faceGrinAction")
                    Toggle("Allow gestures to record reps", isOn: $camera.settings.allowVerdicts)
                        .accessibilityIdentifier("allowFaceVerdicts")
                    Text("Rep gestures work only in a running set with score focus off. They are your manual verdicts. Undo the last rep with the visible Undo button if a gesture was accidental. Test your mapping first; accuracy depends on camera position and light.").font(.caption).foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Camera gestures").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
    private var actions: some View {
        ForEach(FaceGestureAction.allCases) { action in Text(action.title).tag(action) }
    }
}

/// The same aspect-fit transform maps normalized Vision points and the preview; it does not
/// stretch landmarks into the letterbox or mirror them a second time.
struct FaceCameraPreview: View {
    @Bindable var camera: FaceGestureService
    var body: some View {
        GeometryReader { geometry in
            ZStack {
                Color.black
                if let session = camera.session {
                    FaceCameraPreviewLayer(session: session, angle: camera.rotationAngle)
                }
                if camera.showMapping, let frame = camera.frame {
                    let aspect: CGFloat = camera.rotationAngle == 90 || camera.rotationAngle == 270 ? 0.75 : 4/3
                    let size = geometry.size
                    let width = min(size.width,size.height * aspect), height = min(size.height,size.width/aspect)
                    let origin = CGPoint(x: (size.width-width)/2,y: (size.height-height)/2)
                    Canvas { context, _ in
                        if let box = frame.face {
                            let r = CGRect(x: origin.x+box.minX*width,y: origin.y+box.minY*height,width: box.width*width,height: box.height*height)
                            context.stroke(Path(roundedRect: r,cornerRadius: 8),with: .color(frame.sample.usable ? .green : .orange),lineWidth: 2)
                        }
                        for point in frame.landmarks {
                            context.fill(Path(ellipseIn: CGRect(x: origin.x+point.x*width-1.5,y: origin.y+point.y*height-1.5,width: 3,height: 3)),with: .color(.green))
                        }
                    }.allowsHitTesting(false)
                }
            }
        }.accessibilityLabel("Live camera preview with optional face landmarks")
    }
}
private struct FaceCameraPreviewLayer: UIViewRepresentable {
    let session: AVCaptureSession
    let angle: CGFloat
    final class PreviewView: UIView {
        override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
        var preview: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
    }
    func makeUIView(context: Context) -> PreviewView {
        let view = PreviewView(); view.preview.videoGravity = .resizeAspect
        return view
    }
    func updateUIView(_ view: PreviewView, context: Context) {
        if view.preview.session !== session { view.preview.session = session }
        if let connection = view.preview.connection {
            connection.automaticallyAdjustsVideoMirroring = false
            if connection.isVideoMirroringSupported { connection.isVideoMirrored = true }
            if connection.isVideoRotationAngleSupported(angle) { connection.videoRotationAngle = angle }
        }
    }
    static func dismantleUIView(_ view: PreviewView, coordinator: ()) { view.preview.session = nil }
}

/// Remains mounted even when the preview is minimized, so capture orientation follows the scene.
struct FaceCameraOrientationProbe: UIViewRepresentable {
    let changed: (UIInterfaceOrientation) -> Void
    final class Probe: UIView {
        var changed: ((UIInterfaceOrientation) -> Void)?
        private var previous: UIInterfaceOrientation?
        override func layoutSubviews() {
            super.layoutSubviews()
            if let orientation = window?.windowScene?.interfaceOrientation, orientation != previous {
                previous = orientation
                // Never publish observable state from inside a representable layout callback.
                DispatchQueue.main.async { [weak self] in self?.changed?(orientation) }
            }
        }
        override func didMoveToWindow() { super.didMoveToWindow(); setNeedsLayout() }
    }
    func makeUIView(context: Context) -> Probe { let view = Probe(); view.changed = changed; return view }
    func updateUIView(_ view: Probe, context: Context) { view.changed = changed; view.setNeedsLayout() }
}
