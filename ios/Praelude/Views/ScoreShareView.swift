import SwiftUI
import UIKit

/// The system sheet provides AirDrop, Files and Print for the separate annotated PDF.
struct ScoreShareView: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: [url], applicationActivities: nil)
    }
    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
