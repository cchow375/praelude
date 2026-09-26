import SwiftUI

// MARK: - Praelude Design System — Typography
//
// One characterful engraving face for display text and numerals: Bodoni Moda, a Didone whose
// high-contrast, plate-cut strokes read the way engraved music and title pages do. Paired with
// the system SF Pro workhorse for every other piece of UI text, so Dynamic Type keeps working
// exactly as iOS expects. Bodoni Moda ships as one variable font (weight 400–900); SwiftUI's
// `fontWeight(_:)` drives its weight axis, so a single bundled file covers every weight used here.
//
// Bodoni Moda carries the OpenType `tnum` (tabular figures) feature — verified with fontTools
// before bundling — so tempo, streak and BPM numerals line up as they change instead of
// reflowing. `.monospacedDigit()` requests that feature from whichever font is active; it is
// applied everywhere numerals appear, including on system-font text that already supports it.

enum PraeludeFont {
    /// Bodoni Moda's verified PostScript name (its `fvar` named instances carry no name-table
    /// entries of their own, so the base instance's PostScript name is the reliable lookup key;
    /// `.fontWeight(_:)` still drives the variable axis from there).
    static let displayName = "BodoniModa-Regular"
    static let musicGlyphName = "Bravura"

    /// The engraving face for a section or moment that deserves presence — a screen's hero
    /// title, not routine UI text. Pair with `.fontWeight(_:)`.
    static func display(_ size: CGFloat) -> Font { .custom(displayName, size: size) }

    /// Large tabular numerals — tempo, streak, BPM, level. Always monospaced-digit so a value
    /// changing from "9" to "10" doesn't shift anything next to it.
    static func numeral(_ size: CGFloat) -> Font { .custom(displayName, size: size) }
}

extension View {
    /// A display heading in the engraving face.
    func praeludeDisplay(_ size: CGFloat, weight: Font.Weight = .semibold) -> some View {
        font(PraeludeFont.display(size)).fontWeight(weight)
    }

    /// A large, deliberate, tabular numeral (tempo/streak/BPM/level).
    func praeludeNumeral(_ size: CGFloat, weight: Font.Weight = .semibold) -> some View {
        font(PraeludeFont.numeral(size)).fontWeight(weight).monospacedDigit()
    }
}

/// A single SMuFL glyph from the bundled Bravura music font, for musical iconography and stamps.
struct PraeludeMusicGlyph: View {
    enum Symbol: String {
        case quarterNote = "\u{E1D5}"
        case eighthNote = "\u{E1D7}"
        case gClef = "\u{E040}"
    }
    var symbol: Symbol
    var size: CGFloat

    var body: some View {
        Text(symbol.rawValue)
            .font(.custom(PraeludeFont.musicGlyphName, size: size))
            .accessibilityHidden(true)
    }
}
