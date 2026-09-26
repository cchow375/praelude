import SwiftUI

// MARK: - Praelude Design System — Layout
//
// A small set of deliberately different corner radii, one per component role, instead of one
// radius applied everywhere. Chips and thumbnails are tight; controls are rounder; cards round
// further still; the large verdict buttons and floating HUD read as distinct, generous shapes.

enum PraeludeRadius {
    static let tight: CGFloat = 8 // chips, thumbnails, small badges
    static let control: CGFloat = 12 // buttons, fields, menus
    static let card: CGFloat = 18 // cards and grouped content blocks
    static let verdict: CGFloat = 22 // large practice verdict buttons
    static let panel: CGFloat = 27 // HUD dock, floating chrome over the score
}

enum PraeludeMetric {
    /// Floor height for a practice verdict button (Clean / Sloppy / Again).
    static let verdictHeight: CGFloat = 72
    /// Large, edge-anchored transport/tempo controls, reachable from the bench.
    static let edgeControl: CGFloat = 52
    /// The app's one hairline stroke width.
    static let hairline: CGFloat = 0.5
}
