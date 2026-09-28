import SwiftUI

/// §10a: "Tempo in one gesture: drag/scroll on the number, ±1/±5, tap tempo, voice. Never a
/// modal/keyboard." One reusable control, used both to arm a set's starting tempo
/// (`PracticeArmView`) and, while a set is running, to display the tempo the engine is driving
/// (`PracticeHUDView`) — `locked` disables direct interaction there the same way
/// `MetronomeView`'s existing `lockedTempo` already does, since a running set's BPM is owned by
/// `PracticeEngine`'s replay, not by direct manipulation.
///
/// The BPM number itself is never a text field or a picker sheet — every path here is a drag, a
/// tap, or (via `onTapTempo`/the caller's own voice dispatch) a spoken command.
struct TempoDial: View {
    @Binding var bpm: Double
    var locked: Bool = false
    var numeralSize: CGFloat = 60
    /// The caller decides what "tap tempo" means (`MetronomeService.tap()` when a metronome is in
    /// play, or a purely local interval average before one exists); `nil` hides the control.
    var onTapTempo: (() -> Void)? = nil
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var dragOrigin: Double?

    var body: some View {
        VStack(spacing: 10) {
            Text("\(Int(bpm.rounded()))")
                .praeludeNumeral(numeralSize, weight: .bold)
                .foregroundStyle(PraeludeColor.ink)
                .contentTransition(.numericText())
                .animation(reduceMotion ? nil : .easeOut(duration: 0.08), value: bpm)
                .frame(minWidth: numeralSize * 1.6)
                .contentShape(Rectangle())
                .allowsHitTesting(!locked)
                .gesture(dragGesture)
                .opacity(locked ? 0.55 : 1)
                .accessibilityIdentifier("tempoDialValue")
                .accessibilityLabel("Tempo")
                .accessibilityValue("\(Int(bpm.rounded())) beats per minute")
                .accessibilityAdjustableAction { direction in
                    guard !locked else { return }
                    switch direction {
                    case .increment: nudge(1)
                    case .decrement: nudge(-1)
                    default: break
                    }
                }
            Text(locked ? "TEMPO · FOLLOWS YOUR SET" : "BEATS PER MINUTE")
                .font(.caption2.weight(.semibold)).tracking(1.1)
                .foregroundStyle(PraeludeColor.inkTertiary)
            if !locked {
                HStack(spacing: 8) {
                    nudgeButton(-5, label: "−5")
                    nudgeButton(-1, label: "−1")
                    nudgeButton(1, label: "+1")
                    nudgeButton(5, label: "+5")
                    if let onTapTempo {
                        Button(action: onTapTempo) {
                            Text("TAP").font(.caption.weight(.semibold))
                                .frame(minWidth: 44, minHeight: 36)
                        }
                        .buttonStyle(.praeludeQuiet)
                        .accessibilityLabel("Tap tempo")
                        .accessibilityHint("Tap repeatedly at the tempo you want")
                    }
                }
            }
        }
    }

    private func nudgeButton(_ delta: Double, label: String) -> some View {
        Button { nudge(delta) } label: {
            Text(label).font(.callout.monospacedDigit().weight(.semibold))
                .frame(minWidth: 40, minHeight: 36)
        }
        .buttonStyle(.praeludeQuiet)
        .accessibilityLabel(delta > 0 ? "Increase tempo by \(Int(delta))" : "Decrease tempo by \(Int(-delta))")
    }

    private func nudge(_ delta: Double) {
        bpm = min(max(bpm + delta, 20), 300)
        PraeludeHaptic.toggle()
    }

    private var dragGesture: some Gesture {
        DragGesture(minimumDistance: 4)
            .onChanged { value in
                let origin = dragOrigin ?? bpm
                if dragOrigin == nil { dragOrigin = origin }
                bpm = PracticeUXHelpers.tempo(fromDragTranslation: value.translation.height, startBPM: origin)
            }
            .onEnded { _ in dragOrigin = nil; PraeludeHaptic.toggle() }
    }
}
