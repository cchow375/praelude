import SwiftUI

/// Reads the audio service's playhead; never schedules audio or records practice. Kept separate
/// so the 30 Hz playhead updates do not invalidate the counter's verdict controls.
struct PracticeBeatDisplay: View {
    @Environment(MetronomeService.self) private var metronome
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var editable = false

    private var style: MetronomeVisualStyle {
        reduceMotion && [.bounce, .flash].contains(metronome.visualStyle) ? .beats : metronome.visualStyle
    }
    private var current: Int { metronome.isPlaying ? max(1, metronome.beat) : 0 }

    var body: some View {
        if style != .off {
            VStack(spacing: 2) {
                if style == .beats { beats }
                else { animatedPulse }
                if metronome.isCountingIn {
                    Text("Count-in · enter on beat 1").font(.caption2).foregroundStyle(.secondary)
                } else if metronome.isDropoutSilent {
                    Text("Silent bar · keep the pulse").font(.caption2).foregroundStyle(.secondary)
                }
            }
            .accessibilityElement(children: editable ? .contain : .ignore)
            .accessibilityLabel("Visual metronome")
            .accessibilityValue(metronome.isPlaying ? "Beat \(current) of \(metronome.pulsesPerBar)" : "Stopped")
            .accessibilityIdentifier("practiceBeatDisplay")
        }
    }

    private var beats: some View {
        let accents = Array(metronome.pulseAccents.enumerated())
        return LazyVGrid(columns: [GridItem(.adaptive(minimum: 44), spacing: 4)], spacing: 4) {
            ForEach(accents, id: \.offset) { entry in
                if editable {
                    Button { metronome.cyclePulseAccent(at: entry.offset) } label: { beat(entry.offset + 1, accent: entry.element) }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Beat \(entry.offset + 1), \(entry.element.title)")
                        .accessibilityHint("Tap to cycle strong, silent, and regular")
                } else { beat(entry.offset + 1, accent: entry.element) }
            }
        }
    }

    private func beat(_ number: Int, accent: BeatAccent) -> some View {
        let selected = current == number
        return HStack(spacing: 3) {
            Text("\(number)").font(.subheadline.monospacedDigit().weight(selected ? .bold : .medium))
            if accent == .accented { Image(systemName: "chevron.up").font(.system(size: 8, weight: .bold)) }
            if accent == .muted { Image(systemName: "speaker.slash.fill").font(.system(size: 9)) }
        }
        .frame(maxWidth: .infinity, minHeight: 44)
        .foregroundStyle(selected ? PraeludeColor.paper : accent == .muted ? PraeludeColor.inkTertiary : PraeludeColor.inkSecondary)
        .background(selected ? PraeludeColor.ink : PraeludeColor.inkFillQuiet, in: RoundedRectangle(cornerRadius: 8))
    }

    private var animatedPulse: some View {
        HStack(spacing: 10) {
            GeometryReader { geometry in
                let progress = metronome.isPlaying ? min(1, max(0, metronome.beatProgress)) : 0
                ZStack(alignment: .leading) {
                    Capsule().fill(PraeludeColor.inkFillQuiet).frame(height: 2).padding(.horizontal, 12)
                    Circle().fill(PraeludeColor.ink)
                        .frame(width: 20, height: 20)
                        .opacity(metronome.isPlaying ? (style == .flash ? 0.35 + 0.65 * (1 - progress) : 1) : 0.3)
                        .offset(x: style == .bounce && metronome.isPlaying
                                ? max(0, geometry.size.width - 20) * (current.isMultiple(of: 2) ? 1 - progress : progress)
                                : max(0, geometry.size.width - 20) / 2)
                }.frame(maxHeight: .infinity)
            }.frame(height: 44)
            Text(current == 0 ? "– / \(metronome.pulsesPerBar)" : "\(current) / \(metronome.pulsesPerBar)")
                .font(.subheadline.monospacedDigit().weight(.medium)).frame(minWidth: 48)
        }.accessibilityHidden(true)
    }
}

struct MetronomeVisualStylePicker: View {
    @Environment(MetronomeService.self) private var metronome
    var body: some View {
        @Bindable var metronome = metronome
        Picker("Visual beat", selection: $metronome.visualStyle) {
            ForEach(MetronomeVisualStyle.allCases, id: \.self) { Text($0.title).tag($0) }
        }.accessibilityIdentifier("metronomeVisualStyle")
    }
}
