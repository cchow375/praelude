import SwiftUI

private enum MetronomeTool: String, CaseIterable, Identifiable { case metronome, tuner, drone; var id: String { rawValue } }

struct MetronomeView: View {
    @Environment(MetronomeService.self) private var metronome
    @Environment(PracticeStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var tool = MetronomeTool.metronome
    @State private var tempoError: String?
    private var activeTempo: Bool { store.activeSet.map { $0.status == .running || $0.status == .paused } ?? false }
    private var tempoBinding: Binding<Double> {
        Binding(get: { activeTempo ? store.activeSet!.currentBPM : metronome.bpm }, set: { value in changeTempo(value) })
    }
    private var beatName: String {
        if metronome.groupedCompoundPulse { return "dotted quarter note" }
        switch metronome.denominator { case 2: return "half note"; case 8: return "eighth note"; default: return "quarter note" }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                Picker("Tool", selection: $tool) {
                    Text("Metronome").tag(MetronomeTool.metronome)
                    Text("Tuner").tag(MetronomeTool.tuner)
                    Text("Drone").tag(MetronomeTool.drone)
                }
                .pickerStyle(.segmented)
                .padding(.horizontal).padding(.top, 12).padding(.bottom, 4)
                .accessibilityIdentifier("metronomeToolPicker")
                switch tool {
                case .metronome: metronomeForm
                case .tuner: ScrollView { TunerView().padding(.horizontal).padding(.top, 12) }
                case .drone: ScrollView { DroneView().padding(.horizontal).padding(.top, 12) }
                }
            }
            .background(PraeludeColor.paper)
            .navigationTitle("Metronome").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }.presentationDetents([.large]).presentationDragIndicator(.visible)
    }

    private var metronomeForm: some View {
        @Bindable var metronome = metronome
        @Bindable var feedback = FeedbackService.shared
        return Form {
                Section {
                    VStack(spacing: 20) {
                        TempoDial(bpm: tempoBinding, numeralSize: 64, onTapTempo: { tapTempo() })
                        Text("\(beatName.capitalized) = \(Int(tempoBinding.wrappedValue.rounded()))")
                            .font(.callout).foregroundStyle(.secondary)
                        if activeTempo {
                            Text("Tempo changes are saved to this set. Your recorded reps and variant progress stay in place.")
                                .font(.footnote).foregroundStyle(.secondary)
                        }
                        HStack(spacing: 12) {
                            Button {
                                if let active = store.activeSet, !active.isComplete { metronome.setTempo(active.currentBPM) }
                                metronome.toggle()
                            } label: {
                                Label(metronome.isPlaying ? "Stop" : "Start", systemImage: metronome.isPlaying ? "stop.fill" : "play.fill")
                                    .frame(maxWidth: .infinity, minHeight: 28)
                            }.buttonStyle(.praeludePrimary).accessibilityIdentifier("toggleMetronome")
                        }
                    }.padding(.vertical, 8)
                }.listRowBackground(Color.clear).listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: 8, trailing: 0))

                Section {
                    MetronomePulseGrid()
                    MetronomePulseProgress()
                    Menu {
                        ForEach([2, 3, 4, 5], id: \.self) { beats in
                            Button("\(beats)/4") { metronome.setMeter(beats: beats, denominator: 4) }
                        }
                        ForEach([6, 9, 12], id: \.self) { beats in
                            Button("\(beats)/8 · dotted-quarter pulse") {
                                metronome.setMeter(beats: beats, denominator: 8)
                                metronome.groupedCompoundPulse = true
                            }
                        }
                        Button("7/8 · eighth-note pulse") { metronome.setMeter(beats: 7, denominator: 8) }
                    } label: {
                        Label("Common meters", systemImage: "music.note")
                            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                            .contentShape(Rectangle())
                    }
                        .accessibilityIdentifier("meterPresets")
                    Picker("Beats per bar", selection: $metronome.beatsPerBar) {
                        ForEach(1...12, id: \.self) { Text("\($0)").tag($0) }
                    }
                    Picker("Beat value", selection: $metronome.denominator) {
                        Text("Half note · 2").tag(2)
                        Text("Quarter note · 4").tag(4)
                        Text("Eighth note · 8").tag(8)
                    }
                    if metronome.supportsCompoundPulse {
                        Toggle("Count dotted-quarter pulses", isOn: $metronome.groupedCompoundPulse)
                            .accessibilityIdentifier("compoundPulse")
                    }
                    LabeledContent("Time signature", value: "\(metronome.beatsPerBar)/\(metronome.denominator)")
                    Button("Reset accents") { metronome.resetAccents() }
                } header: {
                    Text("Meter & accents")
                } footer: {
                    Text("Tap a beat to cycle accent, silence, and regular beat. Tempo counts each \(beatName); subdivisions divide that pulse. In compound meters, choose dotted-quarter pulses to follow the larger beat.")
                }

                Section {
                    Picker("Clicks per beat", selection: $metronome.subdivision) {
                        Text("1").tag(1); Text("2").tag(2); Text("3").tag(3); Text("4").tag(4)
                    }.pickerStyle(.segmented).accessibilityLabel("Clicks per beat")
                } header: {
                    Text("Subdivision")
                } footer: {
                    Text(metronome.subdivision == 1 ? "One click per beat." : "\(metronome.subdivision) even clicks per beat. The main beat stays prominent.")
                }

                Section {
                    Picker("Count-in", selection: $metronome.countInBars) {
                        Text("Off").tag(0)
                        ForEach(1...4, id: \.self) { Text("\($0) \($0 == 1 ? "bar" : "bars")").tag($0) }
                    }.accessibilityIdentifier("countInBars")
                    Toggle("Keep playing when locked", isOn: $metronome.keepRunningWhenLocked)
                        .accessibilityIdentifier("keepMetronomeRunning")
                } header: { Text("Starting & locking") }
                  footer: { Text("Count-in plays once on Start, using audible main beats. A count-in change applies the next time you start. Practice pauses when the app backgrounds; this option keeps only the click playing.") }
                MetronomePlaybackStatus()
                if let tempoError { Section { Text(tempoError).foregroundStyle(.red) } }

                Section("Click sound") {
                    Picker("Sound", selection: $metronome.sound) {
                        ForEach(MetronomeSound.allCases, id: \.self) { Text($0.title).tag($0) }
                    }
                    HStack {
                        Image(systemName: "speaker.fill").foregroundStyle(.secondary).accessibilityHidden(true)
                        Slider(value: $metronome.volume, in: 0...1).accessibilityLabel("Metronome volume")
                        Image(systemName: "speaker.wave.3.fill").foregroundStyle(.secondary).accessibilityHidden(true)
                    }
                    Toggle("Beat haptics", isOn: $metronome.hapticsEnabled).praeludeToggleHaptic(metronome.hapticsEnabled)
                }

                Section {
                    Toggle("Reward sounds", isOn: $feedback.soundsEnabled).praeludeToggleHaptic(feedback.soundsEnabled)
                    Toggle("Reward haptics", isOn: $feedback.hapticsEnabled).praeludeToggleHaptic(feedback.hapticsEnabled)
                    Slider(value: $feedback.volume, in: 0...1).accessibilityLabel("Reward volume").disabled(!feedback.soundsEnabled)
                } header: {
                    Text("Practice feedback")
                } footer: {
                    Text("Short feedback follows each saved repetition. Haptics depend on your device. Enable Practice feedback in Settings to use these options.")
                }
                if let error = metronome.errorMessage {
                    Section { Text(error).font(.callout).foregroundStyle(.red) }
                }
                if let error = feedback.soundError {
                    Section { Text(error).font(.footnote).foregroundStyle(.secondary) }
                }
            }
            .scrollContentBackground(.hidden)
            .accessibilityIdentifier("metronomeSettingsForm")
    }

    private func changeTempo(_ value: Double) {
        do {
            if activeTempo { try store.adjustActiveTempo(value) }
            metronome.setTempo(activeTempo ? store.activeSet!.currentBPM : value)
            tempoError = nil
        } catch { tempoError = error.localizedDescription }
    }

    private func tapTempo() {
        guard let value = metronome.tappedTempo() else { return }
        do {
            if activeTempo { try store.adjustActiveTempo(value) }
            metronome.applyTappedTempo(value)
            tempoError = nil
        } catch { tempoError = error.localizedDescription }
    }

}

/// Only the pulse display subscribes to the audio playhead. Settings, pickers and menus remain
/// stable while the service publishes beat progress roughly 30 times each second.
private struct MetronomePulseGrid: View {
    @Environment(MetronomeService.self) private var metronome
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        // Lazy grid children can finish rendering after a meter edit has shortened the live
        // accent list. Each child must retain its own captured accent rather than subscript it.
        let accents = Array(metronome.pulseAccents.enumerated())
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 44), spacing: 8)], spacing: 8) {
            ForEach(accents, id: \.offset) { item in beatButton(item.offset, accent: item.element) }
        }.padding(.vertical, 4)
    }

    private func beatButton(_ index: Int, accent: BeatAccent) -> some View {
        let current = metronome.isPlaying && metronome.beat == index + 1
        let pulseOn = current && metronome.beatProgress < 0.22
        return Button { metronome.cyclePulseAccent(at: index) } label: {
            VStack(spacing: 5) {
                Text("\(index + 1)").font(.body.weight(current ? .bold : .medium).monospacedDigit())
                Image(systemName: accent == .accented ? "chevron.up" : accent == .muted ? "speaker.slash.fill" : "circle.fill")
                    .font(.system(size: accent == .regular ? 5 : 10, weight: .bold)).frame(height: 10)
            }
            .frame(maxWidth: .infinity, minHeight: 48)
            .contentShape(Rectangle())
            .foregroundStyle(current ? PraeludeColor.paper : accent == .muted ? PraeludeColor.inkTertiary : PraeludeColor.ink)
            .background(current ? PraeludeColor.ink : PraeludeColor.inkFillQuiet, in: RoundedRectangle(cornerRadius: PraeludeRadius.control))
            .scaleEffect(pulseOn && !reduceMotion ? 1.04 : 1)
            .animation(reduceMotion ? nil : .easeOut(duration: 0.1), value: pulseOn)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Beat \(index + 1), \(accent.title)")
        .accessibilityHint("Tap to change the accent")
    }
}

private struct MetronomePulseProgress: View {
    @Environment(MetronomeService.self) private var metronome
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        if metronome.isPlaying && !reduceMotion {
            ProgressView(value: metronome.beatProgress).tint(.secondary).accessibilityHidden(true)
        }
    }
}

/// Count-in and dropout status are fed by the same sample-clock poll as the pulse display.
private struct MetronomePlaybackStatus: View {
    @Environment(MetronomeService.self) private var metronome

    var body: some View {
        if metronome.isCountingIn {
            Section { Label("Count-in · enter on the next first beat", systemImage: "hourglass") }
        } else if metronome.isDropoutSilent {
            Section { Label("Silent bars · keep your pulse", systemImage: "speaker.slash") }
        } else if metronome.pulseAccents.allSatisfy({ $0 == .muted }) {
            Section { Text("Every beat is silent. Tap a beat above to restore its click.").foregroundStyle(.secondary) }
        }
    }
}
