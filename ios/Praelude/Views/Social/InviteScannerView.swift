// AVFoundation predates Swift's Sendable audits: AVCaptureSession's start/stopRunning are
// documented as safe to call off the main thread (the whole reason to dispatch them to a
// background queue below), but the SDK itself doesn't mark the type Sendable. @preconcurrency
// trusts Apple's own documented contract instead of fighting the type checker over it.
@preconcurrency import AVFoundation
import SwiftUI

/// Scans a friend's invite QR code (spec §5b). Plain `AVCaptureSession`/`AVCaptureMetadataOutput` —
/// no third-party scanner dependency. The Simulator has no camera, so this can only be exercised on a
/// physical device; `onCode` fires at most once per session (`didStop`), so a crowded frame with
/// stray QR codes nearby can't fire twice for one scan.
struct InviteScannerView: View {
    let onCode: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var permissionDenied = false

    var body: some View {
        NavigationStack {
            Group {
                if permissionDenied {
                    PraeludeEmptyState(
                        title: "Camera access needed",
                        symbol: "camera",
                        message: "Enable Camera access for Praelude in Settings to scan an invite code.")
                } else {
                    ScannerRepresentable(onCode: { code in onCode(code); dismiss() }, onDenied: { permissionDenied = true })
                        .ignoresSafeArea()
                        .overlay(alignment: .bottom) {
                            Text("Point the camera at a friend's invite code")
                                .font(.subheadline).foregroundStyle(PraeludeColor.paper)
                                .padding(.horizontal, 16).padding(.vertical, 10)
                                .background(PraeludeColor.ink.opacity(0.85), in: Capsule())
                                .padding(.bottom, 32)
                        }
                }
            }
            .navigationTitle("Scan invite")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
    }
}

private struct ScannerRepresentable: UIViewControllerRepresentable {
    let onCode: (String) -> Void
    let onDenied: () -> Void

    func makeUIViewController(context: Context) -> ScannerViewController {
        let controller = ScannerViewController()
        controller.onCode = onCode
        controller.onDenied = onDenied
        return controller
    }
    func updateUIViewController(_ uiViewController: ScannerViewController, context: Context) {}
}

private final class ScannerViewController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    var onCode: ((String) -> Void)?
    var onDenied: (() -> Void)?
    private let session = AVCaptureSession()
    private var didFire = false

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
            DispatchQueue.main.async {
                guard let self else { return }
                if granted { self.configure() } else { self.onDenied?() }
            }
        }
    }

    private func configure() {
        guard let device = AVCaptureDevice.default(for: .video),
              let input = try? AVCaptureDeviceInput(device: device),
              session.canAddInput(input) else { onDenied?(); return }
        session.addInput(input)

        let output = AVCaptureMetadataOutput()
        guard session.canAddOutput(output) else { onDenied?(); return }
        session.addOutput(output)
        output.setMetadataObjectsDelegate(self, queue: .main)
        output.metadataObjectTypes = [.qr]

        let preview = AVCaptureVideoPreviewLayer(session: session)
        preview.videoGravity = .resizeAspectFill
        preview.frame = view.bounds
        view.layer.addSublayer(preview)

        DispatchQueue.global(qos: .userInitiated).async { [session] in session.startRunning() }
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        view.layer.sublayers?.first(where: { $0 is AVCaptureVideoPreviewLayer })?.frame = view.bounds
    }
    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        session.stopRunning()
    }

    // `AVCaptureMetadataOutputObjectsDelegate` isn't itself main-actor-isolated, so a `UIViewController`
    // subclass (implicitly @MainActor) conforming to it is flagged as a possible data race by Swift 6
    // strict concurrency — even though `setMetadataObjectsDelegate(self, queue: .main)` above already
    // guarantees this fires on the main queue. `nonisolated` + `MainActor.assumeIsolated` documents
    // and cashes in that runtime guarantee instead of fighting the type checker over it.
    nonisolated func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput metadataObjects: [AVMetadataObject], from connection: AVCaptureConnection) {
        // `AVMetadataObject` isn't `Sendable`, so the array itself must never cross into the
        // MainActor closure below — only the plain `String` this extracts from it does.
        guard let object = metadataObjects.first as? AVMetadataMachineReadableCodeObject,
              object.type == .qr, let value = object.stringValue else { return }
        MainActor.assumeIsolated {
            guard !didFire else { return }
            didFire = true
            session.stopRunning()
            onCode?(value)
        }
    }
}
