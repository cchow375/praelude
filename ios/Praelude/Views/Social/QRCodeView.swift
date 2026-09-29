import CoreImage.CIFilterBuiltins
import SwiftUI

/// Renders `text` (an invite URL) as a QR code via CoreImage's built-in generator — no third-party
/// dependency. Rendered in ink-on-paper (score-pinned tones, not the dynamic ink/paper pair — a QR
/// code must stay high-contrast in dark mode exactly the way score ink does) at a fixed pixel scale
/// before SwiftUI stretches it, since the generator's native output is only a few dozen pixels square.
struct QRCodeView: View {
    let text: String
    var body: some View {
        Group {
            if let image = Self.generate(text) {
                Image(uiImage: image).resizable().interpolation(.none)
            } else {
                Rectangle().fill(PraeludeColor.inkFillQuiet)
            }
        }
        .aspectRatio(1, contentMode: .fit)
        .background(Color(PraeludeColor.scorePaper))
        .accessibilityLabel("Invite QR code")
    }

    private static func generate(_ text: String) -> UIImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(text.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage else { return nil }
        let scaled = output.transformed(by: CGAffineTransform(scaleX: 10, y: 10))
        let context = CIContext()
        guard let cgImage = context.createCGImage(scaled, from: scaled.extent) else { return nil }
        return UIImage(cgImage: cgImage)
    }
}
