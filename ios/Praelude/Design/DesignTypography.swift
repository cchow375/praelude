import SwiftUI

// MARK: - Praelude Design System — Typography
//
// System typography keeps controls familiar and readable from the bench. Rounded SF numerals
// stay tabular as tempo/progress changes; both headings and numerals follow Dynamic Type.
// Bravura remains reserved for actual musical notation symbols.

enum PraeludeFont {
    static let musicGlyphName = "Bravura"

    static func display(_ size: CGFloat) -> Font { .system(size: size) }

    /// Large tabular numerals — tempo, streak, BPM, level. Always monospaced-digit so a value
    /// changing from "9" to "10" doesn't shift anything next to it.
    static func numeral(_ size: CGFloat) -> Font { .system(size: size, design: .rounded) }
}

private struct PraeludeScaledType: ViewModifier {
    @ScaledMetric private var size: CGFloat
    let weight: Font.Weight
    let numerals: Bool

    init(size: CGFloat, weight: Font.Weight, numerals: Bool) {
        _size = ScaledMetric(wrappedValue: size, relativeTo: size >= 32 ? .largeTitle : .title3)
        self.weight = weight; self.numerals = numerals
    }
    func body(content: Content) -> some View {
        content.font(.system(size: size, weight: weight, design: numerals ? .rounded : .default))
            .monospacedDigit()
    }
}

extension View {
    /// A native system heading that follows the user's text size.
    func praeludeDisplay(_ size: CGFloat, weight: Font.Weight = .semibold) -> some View {
        modifier(PraeludeScaledType(size: size, weight: weight, numerals: false))
    }

    /// A large, deliberate, tabular numeral (tempo/streak/BPM/level).
    func praeludeNumeral(_ size: CGFloat, weight: Font.Weight = .semibold) -> some View {
        modifier(PraeludeScaledType(size: size, weight: weight, numerals: true))
    }
}

/// A single SMuFL glyph from the bundled Bravura music font, for musical iconography and stamps.
struct PraeludeMusicGlyph: View {
    enum Symbol: String {
        case quarterNote = "\u{E1D5}"
        case eighthNote = "\u{E1D7}"
        case gClef = "\u{E040}"
        // MARK: Music stamps (§7 annotate track). Every codepoint below is the standard, stable
        // SMuFL assignment (unchanged since the spec's v1.0) and was independently confirmed present
        // (non-`.notdef`) in the bundled `Bravura.otf`'s cmap before use here, the same verification
        // method "(C) Design System.md" already documents for `gClef`/`noteQuarterUp`.
        case fingering0 = "\u{ED10}"
        case fingering1 = "\u{ED11}"
        case fingering2 = "\u{ED12}"
        case fingering3 = "\u{ED13}"
        case fingering4 = "\u{ED14}"
        case fingering5 = "\u{ED15}"
        /// Dynamics are built by placing these letterform glyphs side by side (e.g. `mf` =
        /// `dynamicMezzo` + `dynamicForte`) — SMuFL has no single combined glyph per dynamic marking.
        case dynamicPiano = "\u{E520}"
        case dynamicMezzo = "\u{E521}"
        case dynamicForte = "\u{E522}"
        case breathMarkComma = "\u{E4CE}"
        case stringsDownBow = "\u{E610}"
        case stringsUpBow = "\u{E612}"
        case accidentalFlat = "\u{E260}"
        case accidentalNatural = "\u{E261}"
        case accidentalSharp = "\u{E262}"
    }
    var symbol: Symbol
    var size: CGFloat

    var body: some View {
        Text(symbol.rawValue)
            .font(.custom(PraeludeFont.musicGlyphName, size: size))
            .accessibilityHidden(true)
    }
}
