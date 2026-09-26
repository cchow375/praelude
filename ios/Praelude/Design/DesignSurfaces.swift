import SwiftUI

// MARK: - Praelude Design System — Surfaces
//
// No shadow-plus-thin-gray-border card, everywhere, by default. Separation comes from the
// paper/surface tone step, with a hairline reserved for places content genuinely overlaps.
// Materials (glass) are kept only where they earn their keep: chrome that floats directly over
// the moving score/PDF, where translucency is functionally useful because content is visibly
// scrolling underneath. Panels over ordinary list/form content use an opaque surface instead —
// deliberately not the same glass treatment everywhere.

/// The default flat card: a tonal surface fill, no shadow, no border.
struct PraeludeCard: ViewModifier {
    var radius: CGFloat = PraeludeRadius.card
    func body(content: Content) -> some View {
        content.background(PraeludeColor.surface, in: RoundedRectangle(cornerRadius: radius, style: .continuous))
    }
}

/// An opaque panel for chrome sitting over ordinary content (lists, forms) — no translucency,
/// since nothing is moving underneath it.
struct PraeludeSurfacePanel: ViewModifier {
    func body(content: Content) -> some View {
        content.background(PraeludeColor.surface)
    }
}

/// Chrome that floats directly over the score/PDF, where a material genuinely helps legibility
/// as pages and ink move underneath it.
struct PraeludeScoreChrome: ViewModifier {
    func body(content: Content) -> some View {
        content.background(.bar)
    }
}

extension View {
    func praeludeCard(radius: CGFloat = PraeludeRadius.card) -> some View { modifier(PraeludeCard(radius: radius)) }
    func praeludeSurfacePanel() -> some View { modifier(PraeludeSurfacePanel()) }
    func praeludeScoreChrome() -> some View { modifier(PraeludeScoreChrome()) }

    /// A single hairline at the given edge, in place of a full border around the whole shape.
    func praeludeHairline(_ edge: VerticalEdge) -> some View {
        overlay(alignment: edge == .top ? .top : .bottom) {
            Rectangle().fill(PraeludeColor.hairline).frame(height: PraeludeMetric.hairline)
        }
    }
}
