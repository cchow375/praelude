import SwiftUI

/// A score-local tool palette. Moving or collapsing it never changes the PDF viewport,
/// which keeps the staff and the Pencil coordinate space still while practicing.
struct AnnotationPalette: View {
    @Bindable var markup: ScoreMarkupState
    var onDone: () -> Void
    var onRemoveStamp: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var collapsed = false
    @State private var position: CGPoint?
    @State private var measuredToolsHeight: CGFloat = 160
    @GestureState private var translation: CGSize = .zero

    var body: some View {
        GeometryReader { geometry in
            let width = collapsed ? min(188, geometry.size.width - 16) : min(520, geometry.size.width - 16)
            let maxHeight = max(44, geometry.size.height - 16)
            let toolsHeight = min(ceil(measuredToolsHeight) + 4, max(0, maxHeight - 44))
            let height = collapsed ? 44 : 44 + toolsHeight
            let origin = clamped(position ?? CGPoint(x: geometry.size.width - width - 8, y: 8),
                                 translation: translation, panel: CGSize(width: width, height: height), in: geometry.size)
            VStack(spacing: 0) {
                HStack(spacing: 0) {
                    Image(systemName: "line.3.horizontal")
                        .font(.system(size: 16, weight: .semibold)).foregroundStyle(.secondary)
                        .frame(width: 44, height: 44).contentShape(Rectangle())
                        .accessibilityLabel("Move drawing tools")
                        .accessibilityHint("Drag to move the palette on the score")
                        .accessibilityIdentifier("moveAnnotationPalette")
                        .gesture(DragGesture(minimumDistance: 2)
                            .updating($translation) { value, state, _ in state = value.translation }
                            .onEnded { value in
                                position = clamped(position ?? CGPoint(x: geometry.size.width - width - 8, y: 8),
                                                   translation: value.translation, panel: CGSize(width: width, height: height), in: geometry.size)
                            })
                    if !collapsed {
                        Text("Drawing tools").font(.system(size: 13, weight: .semibold))
                        Spacer(minLength: 0)
                    }
                    Button {
                        withAnimation(reduceMotion ? nil : .snappy(duration: 0.2)) { collapsed.toggle() }
                    } label: {
                        Image(systemName: collapsed ? "pencil.tip.crop.circle" : "minus")
                            .font(.system(size: 18, weight: .semibold))
                            .frame(width: 44, height: 44).contentShape(Rectangle())
                    }.accessibilityLabel(collapsed ? "Expand drawing tools" : "Minimize drawing tools")
                        .accessibilityIdentifier("toggleAnnotationPalette")
                    Button(action: onDone) {
                        Image(systemName: "checkmark").font(.system(size: 18, weight: .semibold))
                            .frame(width: 44, height: 44).contentShape(Rectangle())
                    }.accessibilityLabel("Done").accessibilityIdentifier("finishScoreMarkup")
                }
                if !collapsed {
                    ScrollView {
                        tools.fixedSize(horizontal: false, vertical: true)
                            .onGeometryChange(for: CGFloat.self) { proxy in
                                proxy.size.height
                            } action: { value in
                                if value > 0, abs(measuredToolsHeight - value) > 0.5 { measuredToolsHeight = value }
                            }
                    }.frame(height: toolsHeight)
                }
            }
            .frame(width: width, height: height)
            .praeludeScoreChrome()
            .clipShape(RoundedRectangle(cornerRadius: 16))
            .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(.primary.opacity(0.12)))
            .shadow(color: .black.opacity(0.12), radius: 10, y: 3)
            .offset(x: origin.x, y: origin.y)
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("annotationControls")
        }
    }

    private var tools: some View {
        VStack(alignment: .leading, spacing: 0) {
            AnnotationToolbar(markup: markup, onRemoveSelectedStamp: onRemoveStamp)
            Text(markup.fingerDrawing
                 ? "Finger drawing on · two-finger tap undoes"
                 : "Pencil writes · fingers navigate · two-finger tap undoes")
                .font(.caption2).foregroundStyle(.secondary).padding(.vertical, 6)
        }.padding(.horizontal, 8).padding(.bottom, 4)
    }

    private func clamped(_ point: CGPoint, translation: CGSize, panel: CGSize, in available: CGSize) -> CGPoint {
        CGPoint(x: min(max(8, point.x + translation.width), max(8, available.width - panel.width - 8)),
                y: min(max(8, point.y + translation.height), max(8, available.height - panel.height - 8)))
    }
}

