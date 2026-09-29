import SwiftUI

/// §13 drone: a sustained reference tone at any pitch, adjustable timbre and volume, that can play
/// alongside the metronome (both are independent `AudioSessionCoordinator` clients).
struct DroneView: View {
    @Environment(DroneService.self) private var drone

    var body: some View {
        @Bindable var drone = drone
        VStack(spacing: 20) {
            VStack(spacing: 2) {
                Text(drone.namedPitch?.label ?? "—")
                    .praeludeNumeral(76, weight: .bold)
                    .foregroundStyle(PraeludeColor.ink)
                    .contentTransition(.numericText())
                    .accessibilityLabel(drone.namedPitch.map { "\($0.label), \(Int(drone.frequencyHz)) hertz" } ?? "")
                Text(String(format: "%.1f HZ", drone.frequencyHz))
                    .font(.caption.weight(.medium)).tracking(1.2).foregroundStyle(PraeludeColor.inkSecondary)
            }
            HStack(spacing: 14) {
                Button { drone.stepSemitone(-1) } label: { Image(systemName: "minus") }
                    .buttonStyle(.praeludeEdgeControl).accessibilityLabel("Lower one semitone")
                Slider(value: $drone.frequencyHz, in: 20...2_000)
                    .accessibilityLabel("Drone pitch").accessibilityIdentifier("sliderDronePitch")
                Button { drone.stepSemitone(1) } label: { Image(systemName: "plus") }
                    .buttonStyle(.praeludeEdgeControl).accessibilityLabel("Raise one semitone")
            }
            Picker("Timbre", selection: $drone.timbre) {
                ForEach(DroneTimbre.allCases, id: \.self) { Text($0.title).tag($0) }
            }.pickerStyle(.segmented)
            HStack {
                Image(systemName: "speaker.fill").foregroundStyle(.secondary).accessibilityHidden(true)
                Slider(value: $drone.volume, in: 0...1).accessibilityLabel("Drone volume")
                Image(systemName: "speaker.wave.3.fill").foregroundStyle(.secondary).accessibilityHidden(true)
            }
            Button {
                drone.toggle()
            } label: {
                Label(drone.isPlaying ? "Stop" : "Play", systemImage: drone.isPlaying ? "stop.fill" : "play.fill")
                    .frame(maxWidth: .infinity, minHeight: 28)
            }.buttonStyle(.praeludePrimary).accessibilityIdentifier("toggleDrone")
            if let error = drone.errorMessage {
                Text(error).font(.callout).foregroundStyle(.red)
            } else {
                Text("Plays alongside the metronome — start both to tune against a steady beat.")
                    .font(.footnote).foregroundStyle(PraeludeColor.inkSecondary).multilineTextAlignment(.center)
            }
        }
        .padding(.vertical, 8)
        .onDisappear { drone.stop() }
    }
}
