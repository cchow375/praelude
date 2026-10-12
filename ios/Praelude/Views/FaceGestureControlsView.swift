@preconcurrency import AVFoundation
import SwiftUI

struct FaceGestureControlsView: View {
    @Bindable var camera: FaceGestureService
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var mappingFeedback: String?

    private var commands: [FaceGestureAction] { FaceGestureAction.allCases.filter { $0 != .off } }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Button(camera.isStopping ? "Stopping camera…" : (camera.isEnabled || camera.isPreparing ? "Turn camera off" : "Enable camera")) {
                        if camera.isEnabled || camera.isPreparing { camera.stop() }
                        else { camera.showPreview = true; camera.start() }
                    }
                    .frame(minHeight: 44)
                    .disabled(camera.isStopping)
                    .accessibilityIdentifier("toggleFaceCamera")
                    Text(camera.status)
                        .font(.subheadline)
                        .accessibilityIdentifier("faceCameraStatus")
                    if camera.isPreparing {
                        ProgressView().accessibilityLabel("Starting camera")
                    }
                    if camera.isEnabled && !camera.calibrated && camera.calibrationProgress > 0 {
                        ProgressView(value: camera.calibrationProgress) {
                            Text("Learning your relaxed face…")
                        }.accessibilityIdentifier("faceCalibrationProgress")
                    }
                    if !camera.isEnabled && !camera.isPreparing && camera.status.localizedCaseInsensitiveContains("permission") {
                        Button("Open Camera permission settings") {
                            if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
                        }.frame(minHeight: 44)
                    }
                    if camera.isEnabled {
                        Text(camera.lastGesture).font(.subheadline.weight(.semibold))
                            .accessibilityIdentifier("lastFaceGesture")
                        Toggle("Show live preview", isOn: $camera.showPreview)
                            .accessibilityIdentifier("showFacePreview")
                        if camera.showPreview {
                            FaceCameraPreview(camera: camera)
                                .frame(height: 220)
                                .clipShape(RoundedRectangle(cornerRadius: 12))
                                .accessibilityIdentifier("faceCameraPreview")
                            Toggle("Show face landmarks", isOn: $camera.showMapping)
                                .accessibilityIdentifier("showFaceMapping")
                        }
                    }
                } footer: {
                    Text("Camera frames stay on this device and are discarded. Praelude does not record video, identify you or judge your playing.")
                }

                Section {
                    ForEach(commands) { command in
                        Picker(command.title, selection: expressionBinding(for: command)) {
                            Text("Unassigned").tag(Optional<FaceGesture>.none)
                            ForEach(FaceGesture.allCases) { gesture in
                                Text(gesture.title).tag(Optional(gesture))
                            }
                        }
                        .pickerStyle(.menu)
                        .frame(minHeight: 44)
                        .accessibilityIdentifier("faceCommand_" + command.rawValue)
                    }
                    if let mappingFeedback {
                        Text(mappingFeedback).font(.caption).foregroundStyle(.secondary)
                            .accessibilityIdentifier("faceMappingFeedback")
                    }
                    Toggle("Allow gestures to record reps", isOn: $camera.settings.allowVerdicts)
                        .accessibilityIdentifier("allowFaceVerdicts")
                } header: {
                    Text("Choose an expression for each command")
                } footer: {
                    Text("Each expression controls one command. Choosing an expression already in use moves it here. Rep commands also require a running set with score focus off.")
                }

                Section("Test your expressions") {
                    Text("Commands are paused in this panel. Make an expression, then relax to test it. Return to the score when ready.")
                        .font(.caption).foregroundStyle(.secondary)
                    Button(camera.calibrated ? "Recalibrate neutral face" : "Calibrate neutral face") { camera.calibrate() }
                        .frame(minHeight: 44).disabled(!camera.isEnabled)
                        .accessibilityIdentifier("calibrateFaceCamera")
                    Text("Sit as you will at the piano with your face relaxed. Calibration starts automatically when tracking is steady. Recalibrate after moving the iPad.")
                        .font(.caption).foregroundStyle(.secondary)
                    if camera.calibrated {
                        Text("Available: " + FaceGesture.allCases.filter { camera.availableGestures.contains($0) }.map(\.title).joined(separator: ", "))
                            .font(.caption).foregroundStyle(.secondary)
                            .accessibilityIdentifier("availableFaceGestures")
                    }
                    DisclosureGroup("How to make each expression") {
                        ForEach(FaceGesture.allCases) { gesture in
                            VStack(alignment: .leading, spacing: 4) {
                                Text(gesture.title).font(.subheadline.weight(.medium))
                                Text(gesture.instructions).font(.caption).foregroundStyle(.secondary)
                            }.padding(.vertical, 4)
                        }
                    }
                }

                Section("Recognition") {
                    Picker("Sensitivity", selection: $camera.settings.sensitivity) {
                        ForEach(FaceGestureSensitivity.allCases) { sensitivity in
                            Text(sensitivity.title).tag(sensitivity)
                        }
                    }.pickerStyle(.menu).frame(minHeight: 44).accessibilityIdentifier("faceGestureSensitivity")
                    Stepper(value: $camera.settings.holdDuration, in: 0.2...1.2, step: 0.1) {
                        LabeledContent("Expression hold", value: seconds(camera.settings.holdDuration))
                    }.frame(minHeight: 44).accessibilityIdentifier("faceGestureHold")
                    Stepper(value: $camera.settings.cooldown, in: 0.5...3, step: 0.25) {
                        LabeledContent("Time between commands", value: seconds(camera.settings.cooldown))
                    }.frame(minHeight: 44).accessibilityIdentifier("faceGestureCooldown")
                    Text("Easy responds to smaller movements. Deliberate requires larger movements. Expression hold applies to smiling or opening your mouth; closing both eyes requires at least 0.6 seconds. A longer pause reduces accidental commands. Return to your relaxed face after each expression.")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Camera gestures").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }

    private func seconds(_ value: Double) -> String {
        value.formatted(.number.precision(.fractionLength(1...2))) + " s"
    }

    private func expressionBinding(for command: FaceGestureAction) -> Binding<FaceGesture?> {
        Binding(get: { camera.settings.gesture(for: command) }, set: { gesture in
            let previousCommand = gesture.map { camera.settings.action(for: $0) }
            camera.settings.assign(gesture, to: command)
            if let gesture {
                var feedback = "\(gesture.title) now controls \(command.title)."
                if let previousCommand, previousCommand != .off, previousCommand != command {
                    feedback += " \(previousCommand.title) is now unassigned."
                }
                mappingFeedback = feedback
            } else { mappingFeedback = "\(command.title) is unassigned." }
        })
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
                if camera.session != nil {
                    FaceCameraPreviewLayer(camera: camera)
                }
                if camera.showMapping, let frame = camera.frame {
                    let aspect: CGFloat = frame.imageAspect.isFinite && frame.imageAspect > 0 ? frame.imageAspect : 0.75
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
    @Bindable var camera: FaceGestureService
    final class PreviewView: UIView {
        override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
        var preview: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
    }
    final class Coordinator {
        weak var camera: FaceGestureService?
        weak var session: AVCaptureSession?
    }
    func makeCoordinator() -> Coordinator { Coordinator() }
    func makeUIView(context: Context) -> PreviewView {
        let view = PreviewView()
        view.preview.videoGravity = .resizeAspect
        return view
    }
    func updateUIView(_ view: PreviewView, context: Context) {
        let coordinator = context.coordinator
        if coordinator.session !== camera.session {
            coordinator.camera?.detachPreview(view.preview)
            coordinator.camera = camera; coordinator.session = camera.session
            camera.attachPreview(view.preview)
        }
    }
    static func dismantleUIView(_ view: PreviewView, coordinator: Coordinator) {
        coordinator.camera?.detachPreview(view.preview)
    }
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
