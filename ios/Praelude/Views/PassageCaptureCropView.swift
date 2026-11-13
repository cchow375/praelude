import SwiftUI
import UIKit

/// Free-aspect passage crop: the pianist can keep one measure or several systems. The source is
/// already upright and bounded by PassageCaptureProcessor, so display and saved pixels agree.
struct PassageCaptureCropView: View {
    let image: UIImage
    @Binding var crop: CGRect
    @State private var dragOrigin: CGRect?
    private let minimum: CGFloat = 0.06

    var body: some View {
        VStack(spacing: 10) {
            GeometryReader { proxy in
                let size = fitted(in: proxy.size)
                let rect = CGRect(x: crop.minX * size.width, y: crop.minY * size.height,
                                  width: crop.width * size.width, height: crop.height * size.height)
                ZStack(alignment: .topLeading) {
                    Image(uiImage: image).resizable().frame(width: size.width, height: size.height)
                    CropShade(hole: rect).fill(.black.opacity(0.55), style: FillStyle(eoFill: true))
                        .allowsHitTesting(false)
                    Rectangle().fill(.clear).contentShape(Rectangle())
                        .frame(width: rect.width, height: rect.height).position(x: rect.midX, y: rect.midY)
                        .gesture(moveGesture(size: size))
                        .accessibilityLabel("Selected passage. Use Fine tune crop to adjust with VoiceOver.")
                    Rectangle().stroke(.white, lineWidth: 2)
                        .frame(width: rect.width, height: rect.height).position(x: rect.midX, y: rect.midY)
                        .allowsHitTesting(false)
                    ForEach(Corner.allCases, id: \.self) { corner in
                        let point = corner.point(in: rect)
                        Circle().fill(.white).frame(width: 15, height: 15)
                            .overlay(Circle().stroke(.black.opacity(0.6), lineWidth: 1))
                            .frame(width: 44, height: 44).contentShape(Rectangle())
                            .position(point).gesture(resizeGesture(corner, size: size))
                            .accessibilityHidden(true)
                    }
                }
                .frame(width: size.width, height: size.height)
                .clipped()
                .position(x: proxy.size.width / 2, y: proxy.size.height / 2)
            }
            .frame(height: min(440, max(240, 320 * image.size.height / max(1, image.size.width))))
            .background(.black.opacity(0.06), in: RoundedRectangle(cornerRadius: 12))
            .accessibilityIdentifier("passageCropCanvas")

            Text("Drag the corners to keep just your passage. Drag inside to move the box.")
                .font(.caption).foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .leading)
            DisclosureGroup("Fine tune crop") {
                cropSlider("Top", value: Binding(get: { crop.minY }, set: { top in
                    crop = CGRect(x: crop.minX, y: top, width: crop.width, height: crop.maxY - top)
                }), range: 0...max(0, crop.maxY - minimum))
                cropSlider("Bottom", value: Binding(get: { crop.maxY }, set: { bottom in
                    crop.size.height = bottom - crop.minY
                }), range: min(1, crop.minY + minimum)...1)
                cropSlider("Left", value: Binding(get: { crop.minX }, set: { left in
                    crop = CGRect(x: left, y: crop.minY, width: crop.maxX - left, height: crop.height)
                }), range: 0...max(0, crop.maxX - minimum))
                cropSlider("Right", value: Binding(get: { crop.maxX }, set: { right in
                    crop.size.width = right - crop.minX
                }), range: min(1, crop.minX + minimum)...1)
            }.font(.subheadline)
        }
    }

    private func cropSlider(_ label: String, value: Binding<CGFloat>, range: ClosedRange<CGFloat>) -> some View {
        HStack {
            Text(label).frame(width: 58, alignment: .leading)
            Slider(value: value, in: range).accessibilityLabel("Crop \(label.lowercased())")
            Text(value.wrappedValue, format: .percent.precision(.fractionLength(0)))
                .monospacedDigit().frame(width: 42, alignment: .trailing)
        }.frame(minHeight: 44)
    }

    private func fitted(in available: CGSize) -> CGSize {
        let scale = min(available.width / max(1, image.size.width), available.height / max(1, image.size.height))
        return CGSize(width: image.size.width * scale, height: image.size.height * scale)
    }

    private func moveGesture(size: CGSize) -> some Gesture {
        DragGesture().onChanged { value in
            let original = dragOrigin ?? crop; dragOrigin = original
            crop.origin.x = min(1 - original.width, max(0, original.minX + value.translation.width / max(1, size.width)))
            crop.origin.y = min(1 - original.height, max(0, original.minY + value.translation.height / max(1, size.height)))
        }.onEnded { _ in dragOrigin = nil }
    }

    private func resizeGesture(_ corner: Corner, size: CGSize) -> some Gesture {
        DragGesture(minimumDistance: 0).onChanged { value in
            let original = dragOrigin ?? crop; dragOrigin = original
            let dx = value.translation.width / max(1, size.width), dy = value.translation.height / max(1, size.height)
            let left = corner.isLeft ? min(original.maxX - minimum, max(0, original.minX + dx)) : original.minX
            let right = corner.isLeft ? original.maxX : max(original.minX + minimum, min(1, original.maxX + dx))
            let top = corner.isTop ? min(original.maxY - minimum, max(0, original.minY + dy)) : original.minY
            let bottom = corner.isTop ? original.maxY : max(original.minY + minimum, min(1, original.maxY + dy))
            crop = CGRect(x: left, y: top, width: right - left, height: bottom - top)
        }.onEnded { _ in dragOrigin = nil }
    }

    private enum Corner: CaseIterable {
        case topLeft, topRight, bottomLeft, bottomRight
        var isLeft: Bool { self == .topLeft || self == .bottomLeft }
        var isTop: Bool { self == .topLeft || self == .topRight }
        func point(in rect: CGRect) -> CGPoint {
            CGPoint(x: isLeft ? rect.minX : rect.maxX, y: isTop ? rect.minY : rect.maxY)
        }
    }
}

private struct CropShade: Shape {
    let hole: CGRect
    func path(in rect: CGRect) -> Path {
        var path = Path(rect)
        path.addRect(hole)
        return path
    }
}
