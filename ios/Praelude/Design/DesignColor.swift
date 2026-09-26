import SwiftUI

// MARK: - Praelude Design System — Color
//
// Two appearances, each designed on its own rather than inverted from the other. Light is
// "paper and ink": warm paper, near-black ink. Dark is "stage": black lacquer with a warm
// stage-light glow, the color of an instrument case rather than an inverted document. The
// score page is pinned to paper-white in both — the music itself never goes dark.
//
// The palette is otherwise strictly monochrome. `PraeludeColor.live` is the one rare accent,
// reserved for genuinely live states — a listening microphone, a set actively being practiced —
// and is never used decoratively elsewhere. It is deliberately not purple, indigo, violet, or blue.

extension Color {
    /// A color defined separately for light and dark, evaluated per-trait rather than inverted.
    init(light: Color, dark: Color) {
        self.init(UIColor { traits in
            traits.userInterfaceStyle == .dark ? UIColor(dark) : UIColor(light)
        })
    }
}

enum PraeludeColor {
    // Ink: primary content and controls. Warm near-black on paper; warm parchment on stage.
    static let ink = Color(light: rgb(0.094, 0.082, 0.071), dark: rgb(0.941, 0.925, 0.898))
    static let inkSecondary = Color(light: rgb(0.094, 0.082, 0.071, 0.62), dark: rgb(0.941, 0.925, 0.898, 0.64))
    static let inkTertiary = Color(light: rgb(0.094, 0.082, 0.071, 0.36), dark: rgb(0.941, 0.925, 0.898, 0.38))
    static let inkFillQuiet = Color(light: rgb(0.094, 0.082, 0.071, 0.06), dark: rgb(0.941, 0.925, 0.898, 0.09))
    static let inkFillPressed = Color(light: rgb(0.094, 0.082, 0.071, 0.12), dark: rgb(0.941, 0.925, 0.898, 0.16))

    // Paper / stage: the page background beneath every screen.
    static let paper = Color(light: rgb(0.965, 0.957, 0.937), dark: rgb(0.059, 0.055, 0.051))
    // Surface: raised panels, cards and sheets sitting above the page.
    static let surface = Color(light: rgb(0.996, 0.992, 0.980), dark: rgb(0.106, 0.098, 0.090))
    // Hairline: the app's one stroke weight for dividers — used instead of shadow+border cards.
    static let hairline = Color(light: rgb(0.827, 0.812, 0.769), dark: rgb(0.212, 0.196, 0.176))

    // Score paper: pinned paper-white regardless of appearance.
    static let scorePaper = rgb(0.984, 0.976, 0.957)

    // The one rare accent — a warm stage-light amber, never blue, indigo, violet, or purple.
    // Reserved for live state: a listening microphone, the progress of a set being practiced now.
    static let live = Color(light: rgb(0.686, 0.412, 0.106), dark: rgb(0.933, 0.639, 0.290))
    static let liveFill = Color(light: rgb(0.686, 0.412, 0.106, 0.14), dark: rgb(0.933, 0.639, 0.290, 0.18))

    // Setbacks (Sloppy/Again) stay inside the monochrome family — the symbol carries the
    // distinction, not a warning color. Destructive system actions keep the native semantic red.
    static let setback = inkSecondary
}

private func rgb(_ r: Double, _ g: Double, _ b: Double, _ a: Double = 1) -> Color {
    Color(.sRGB, red: r, green: g, blue: b, opacity: a)
}
