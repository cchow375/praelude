import SwiftUI

struct MetronomeView: View {
    @Environment(MetronomeService.self) private var metronome
    @Environment(PracticeStore.self) private var store
    private var lockedTempo: Bool { store.activeSet != nil && store.activeSet?.isComplete != true }
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        @Bindable var metronome = metronome
        NavigationStack {
            ScrollView {
                VStack(spacing: 28) {
                    VStack(spacing: 4) {
                        Text("\(Int(metronome.bpm))").font(.system(size: 76, weight: .light, design: .rounded).monospacedDigit()).contentTransition(.numericText())
                        Text("BEATS PER MINUTE").font(.caption.weight(.medium)).tracking(1.5).foregroundStyle(.secondary)
                    }
                    HStack(spacing: 6) {
                        ForEach(1...metronome.beatsPerBar, id: \.self) { beat in
                            Circle().fill(metronome.isPlaying && metronome.beat == beat ? Color.accentColor : Color.primary.opacity(0.13))
                                .frame(width: beat == 1 ? 13 : 9, height: beat == 1 ? 13 : 9)
                        }
                    }.frame(height: 20).accessibilityLabel("Beat \(metronome.beat) of \(metronome.beatsPerBar)")
                    HStack(spacing: 18) {
                        Button { metronome.setTempo(metronome.bpm - 1) } label: { Image(systemName: "minus").frame(width: 44, height: 44) }.buttonStyle(.bordered).accessibilityLabel("Decrease tempo")
                        Slider(value: $metronome.bpm, in: 20...300, step: 1).accessibilityLabel("Tempo")
                        Button { metronome.setTempo(metronome.bpm + 1) } label: { Image(systemName: "plus").frame(width: 44, height: 44) }.buttonStyle(.bordered).accessibilityLabel("Increase tempo")
                    }
                    .disabled(lockedTempo)
                    if lockedTempo { Text("Tempo follows your current practice set.").font(.footnote).foregroundStyle(.secondary) }
                    HStack(spacing: 12) {
                        Button("Tap tempo") { metronome.tap() }.buttonStyle(.bordered).frame(maxWidth: .infinity).disabled(lockedTempo)
                        Button {
                            if let active = store.activeSet, !active.isComplete { metronome.setTempo(active.currentBPM) }
                            metronome.toggle()
                        } label: {
                            Label(metronome.isPlaying ? "Stop" : "Start", systemImage: metronome.isPlaying ? "stop.fill" : "play.fill").frame(maxWidth: .infinity)
                        }.buttonStyle(.borderedProminent).accessibilityIdentifier("toggleMetronome")
                    }.controlSize(.large)
                    VStack(spacing: 16) {
                        Picker("Beats per bar", selection: $metronome.beatsPerBar) {
                            ForEach(1...12, id: \.self) { Text("\($0) beats").tag($0) }
                        }.pickerStyle(.menu)
                        Picker("Subdivision", selection: $metronome.subdivision) {
                            Text("Quarter").tag(1); Text("Eighth").tag(2); Text("Triplet").tag(3); Text("Sixteenth").tag(4)
                        }.pickerStyle(.segmented)
                    }
                    if let error = metronome.errorMessage { Text(error).font(.callout).foregroundStyle(.red) }
                }.padding(24).frame(maxWidth: 480).frame(maxWidth: .infinity)
            }
            .navigationTitle("Metronome").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }.presentationDetents([.medium, .large]).presentationDragIndicator(.visible)
    }
}
