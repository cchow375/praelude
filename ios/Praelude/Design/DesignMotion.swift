import SwiftUI
import UIKit

// MARK: - Praelude Design System — Motion
//
// Three spring presets, each interruptible (SwiftUI springs retarget from the in-flight velocity
// by default) and each with a Reduce Motion alternative that keeps the same visual end state
// without the movement. Every call site that animates should read Reduce Motion from the
// environment and pick the matching variant below rather than hard-coding `.spring(...)`.
//
// `PracticeFeedbackView`/`FeedbackService` already drive verdict, set-completion and chain sounds
// and haptics through the practice event pipeline — that is unchanged here. `PraeludeHaptic`
// below is the shared primitive for everything else in the interface that confirms an action
// with touch: toggles, and other one-off UI confirmations that don't already go through that
// pipeline.

enum PraeludeMotion {
    /// A passage expanding out of the score, a sheet arriving — confident and settled.
    static let entrance = Animation.spring(response: 0.42, dampingFraction: 0.82)
    /// A button press, a beat pulse, a value nudging — quick and snappy.
    static let tap = Animation.spring(response: 0.26, dampingFraction: 0.7)
    /// A completed set collapsing into history, a page turning — slow and weighted.
    static let settle = Animation.spring(response: 0.6, dampingFraction: 0.86)

    static func entrance(reduceMotion: Bool) -> Animation { reduceMotion ? .easeOut(duration: 0.12) : entrance }
    static func tap(reduceMotion: Bool) -> Animation { reduceMotion ? .easeOut(duration: 0.08) : tap }
    static func settle(reduceMotion: Bool) -> Animation { reduceMotion ? .easeOut(duration: 0.18) : settle }
}

enum PraeludeHaptic {
    @MainActor static func toggle() {
        UISelectionFeedbackGenerator().selectionChanged()
    }

    @MainActor static func confirm() {
        UIImpactFeedbackGenerator(style: .soft).impactOccurred()
    }

    @MainActor static func celebrate() {
        UINotificationFeedbackGenerator().notificationOccurred(.success)
    }
}

extension View {
    /// Fires the shared toggle haptic whenever `value` changes — the app-wide feedback for a
    /// `Toggle` switch, matching `PraeludeHaptic`'s own doc ("used for the toggles ... that didn't
    /// previously have any"). Attach right after the `Toggle` it describes.
    func praeludeToggleHaptic(_ value: some Equatable) -> some View {
        onChange(of: value) { _, _ in PraeludeHaptic.toggle() }
    }
}
