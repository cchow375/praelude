import SwiftUI

#if DEBUG
private struct PraeludeAuditOpaqueSurfaceKey: EnvironmentKey { static let defaultValue = false }
extension EnvironmentValues {
    var praeludeAuditOpaqueSurface: Bool {
        get { self[PraeludeAuditOpaqueSurfaceKey.self] }
        set { self[PraeludeAuditOpaqueSurfaceKey.self] = newValue }
    }
}
#endif

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
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
#if DEBUG
    @Environment(\.praeludeAuditOpaqueSurface) private var auditOpaque
#endif
    private var usesOpaqueSurface: Bool {
#if DEBUG
        reduceTransparency || auditOpaque
#else
        reduceTransparency
#endif
    }
    func body(content: Content) -> some View {
        if usesOpaqueSurface {
            content.background(PraeludeColor.surface)
        } else {
            content.background(.bar)
        }
    }
}

/// A single floating control surface over the score. The platform supplies the optics;
/// music and ordinary forms keep their solid backgrounds. Older iPads use native material.
struct PraeludeFloatingControls: ViewModifier {
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
#if DEBUG
    @Environment(\.praeludeAuditOpaqueSurface) private var auditOpaque
#endif
    private var usesOpaqueSurface: Bool {
#if DEBUG
        reduceTransparency || auditOpaque
#else
        reduceTransparency
#endif
    }
    @Environment(\.colorSchemeContrast) private var contrast
    var radius: CGFloat = PraeludeRadius.panel

    @ViewBuilder func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        if usesOpaqueSurface || contrast == .increased {
            content.background(PraeludeColor.surface, in: shape)
                .overlay { shape.strokeBorder(PraeludeColor.hairline, lineWidth: 1) }
        } else if #available(iOS 26.0, *) {
            content.glassEffect(.regular, in: shape)
        } else {
            content.background(.regularMaterial, in: shape)
        }
    }
}

extension View {
    func praeludeCard(radius: CGFloat = PraeludeRadius.card) -> some View { modifier(PraeludeCard(radius: radius)) }
    func praeludeSurfacePanel() -> some View { modifier(PraeludeSurfacePanel()) }
    func praeludeScoreChrome() -> some View { modifier(PraeludeScoreChrome()) }
    func praeludeFloatingControls(radius: CGFloat = PraeludeRadius.panel) -> some View {
        modifier(PraeludeFloatingControls(radius: radius))
    }

    /// A single hairline at the given edge, in place of a full border around the whole shape.
    func praeludeHairline(_ edge: VerticalEdge) -> some View {
        overlay(alignment: edge == .top ? .top : .bottom) {
            Rectangle().fill(PraeludeColor.hairline).frame(height: PraeludeMetric.hairline)
        }
    }
}
