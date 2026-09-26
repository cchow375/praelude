import SwiftUI

// MARK: - Praelude Design System — Buttons
//
// Four button styles replace the stock `.bordered`/`.borderedProminent` look used throughout
// the app. Each responds to press with a quick, interruptible scale rather than the system's
// default highlight, and respects `isEnabled` without a separate disabled palette.

/// The confident primary action — solid ink fill, paper-colored label. For the one primary
/// action on a screen (Start set, Add your first piece), not every prominent button.
struct PraeludePrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .foregroundStyle(PraeludeColor.paper)
            .frame(maxWidth: .infinity, minHeight: 52)
            .background(
                PraeludeColor.ink.opacity(isEnabled ? 1 : 0.35),
                in: RoundedRectangle(cornerRadius: PraeludeRadius.control, style: .continuous)
            )
            .scaleEffect(configuration.isPressed ? 0.975 : 1)
            .animation(PraeludeMotion.tap(reduceMotion: reduceMotion), value: configuration.isPressed)
    }
}

/// A quiet action — ink text on a faint fill. For secondary actions that shouldn't compete
/// with the primary one on the same screen.
struct PraeludeQuietButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .foregroundStyle(PraeludeColor.ink.opacity(isEnabled ? 1 : 0.4))
            .frame(maxWidth: .infinity, minHeight: 52)
            .background(
                configuration.isPressed ? PraeludeColor.inkFillPressed : PraeludeColor.inkFillQuiet,
                in: RoundedRectangle(cornerRadius: PraeludeRadius.control, style: .continuous)
            )
            .animation(PraeludeMotion.tap(reduceMotion: reduceMotion), value: configuration.isPressed)
    }
}

/// One large practice verdict button — Clean, Sloppy or Again — always at least 72pt tall.
/// `emphasis` marks the recommended verdict (Clean) with an ink fill; the others stay quiet so
/// the eye finds Clean first without hiding Sloppy/Again as equally real, equally tappable choices.
struct PraeludeVerdictButtonStyle: ButtonStyle {
    var emphasis: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .frame(maxWidth: .infinity, minHeight: PraeludeMetric.verdictHeight)
            .foregroundStyle(emphasis ? PraeludeColor.paper : PraeludeColor.ink)
            .background(
                emphasis ? PraeludeColor.ink : PraeludeColor.inkFillQuiet,
                in: RoundedRectangle(cornerRadius: PraeludeRadius.verdict, style: .continuous)
            )
            .scaleEffect(configuration.isPressed ? 0.965 : 1)
            .animation(PraeludeMotion.tap(reduceMotion: reduceMotion), value: configuration.isPressed)
    }
}

/// A large, edge-anchored round icon control — transport, tempo nudge, page turn — reachable
/// from the bench.
struct PraeludeEdgeControlButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .frame(width: PraeludeMetric.edgeControl, height: PraeludeMetric.edgeControl)
            .foregroundStyle(PraeludeColor.ink.opacity(isEnabled ? 1 : 0.35))
            .background(PraeludeColor.inkFillQuiet, in: Circle())
            .scaleEffect(configuration.isPressed ? 0.92 : 1)
            .animation(PraeludeMotion.tap(reduceMotion: reduceMotion), value: configuration.isPressed)
    }
}

extension ButtonStyle where Self == PraeludePrimaryButtonStyle {
    static var praeludePrimary: PraeludePrimaryButtonStyle { PraeludePrimaryButtonStyle() }
}
extension ButtonStyle where Self == PraeludeQuietButtonStyle {
    static var praeludeQuiet: PraeludeQuietButtonStyle { PraeludeQuietButtonStyle() }
}
extension ButtonStyle where Self == PraeludeVerdictButtonStyle {
    static func praeludeVerdict(emphasis: Bool) -> PraeludeVerdictButtonStyle { PraeludeVerdictButtonStyle(emphasis: emphasis) }
}
extension ButtonStyle where Self == PraeludeEdgeControlButtonStyle {
    static var praeludeEdgeControl: PraeludeEdgeControlButtonStyle { PraeludeEdgeControlButtonStyle() }
}
