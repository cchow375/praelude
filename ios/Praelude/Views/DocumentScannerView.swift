import SwiftUI
import VisionKit

/// §7 import: the camera side of "photos/camera multi-page scan to cleaned PDF" — VisionKit's own
/// multi-page scanning UI (perspective correction and per-page cropping happen inside it, before a
/// page ever reaches this app). Presents full-screen, like every other VisionKit document scanner
/// integration; the caller composes the returned pages into a PDF (`ScoreScanImport.makePDF`).
struct DocumentScannerView: UIViewControllerRepresentable {
    var onFinish: ([UIImage]) -> Void
    var onCancel: () -> Void
    var onFailure: (Error) -> Void

    func makeUIViewController(context: Context) -> VNDocumentCameraViewController {
        let controller = VNDocumentCameraViewController()
        controller.delegate = context.coordinator
        return controller
    }
    func updateUIViewController(_ uiViewController: VNDocumentCameraViewController, context: Context) {}
    func makeCoordinator() -> Coordinator { Coordinator(onFinish: onFinish, onCancel: onCancel, onFailure: onFailure) }

    final class Coordinator: NSObject, VNDocumentCameraViewControllerDelegate {
        let onFinish: ([UIImage]) -> Void
        let onCancel: () -> Void
        let onFailure: (Error) -> Void
        init(onFinish: @escaping ([UIImage]) -> Void, onCancel: @escaping () -> Void, onFailure: @escaping (Error) -> Void) {
            self.onFinish = onFinish; self.onCancel = onCancel; self.onFailure = onFailure
        }
        func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFinishWith scan: VNDocumentCameraScan) {
            let pages = (0..<scan.pageCount).map { scan.imageOfPage(at: $0) }
            onFinish(pages)
        }
        func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) { onCancel() }
        func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFailWithError error: Error) { onFailure(error) }
    }
}
