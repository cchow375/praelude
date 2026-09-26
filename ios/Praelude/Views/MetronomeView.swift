import SwiftUI

struct MetronomeView: View {
    @Environment(MetronomeService.self) private var metronome
    @Environment(PracticeStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private var lockedTempo: Bool { store.activeSet != nil && store.activeSet?.isComplete != true }
    private var beatName: String { switch metronome.denominator { case 2: "half note"; case 8: "eighth note"; default: "quarter note" } }

    var body: some View {
        @Bindable var metronome = metronome
        @Bindable var feedback = FeedbackService.shared
        NavigationStack {
            Form {
                Section {
                    VStack(spacing: 20) {
                        VStack(spacing: 2) {
                            Text("\(Int(metronome.bpm))")
                                .praeludeNumeral(76, weight: .bold)
                                .foregroundStyle(PraeludeColor.ink)
                                .contentTransition(.numericText()).accessibilityLabel("\(Int(metronome.bpm)) beats per minute")
                            Text("BEATS PER MINUTE").font(.caption.weight(.medium)).tracking(1.2).foregroundStyle(PraeludeColor.inkSecondary)
                        }
                        HStack(spacing: 14) {
                            Button { metronome.setTempo(metronome.bpm - 1) } label: {
                                Image(systemName: "minus")
                            }.buttonStyle(.praeludeEdgeControl).accessibilityLabel("Decrease tempo")
                            Slider(value: $metronome.bpm, in: 20...300, step: 1)
                                .accessibilityLabel("Tempo").accessibilityIdentifier("sliderTempo")
                            Button { metronome.setTempo(metronome.bpm + 1) } label: {
                                Image(systemName: "plus")
                            }.buttonStyle(.praeludeEdgeControl).accessibilityLabel("Increase tempo")
                        }.disabled(lockedTempo)
                        if lockedTempo {
                            Label("Tempo follows your practice set.", systemImage: "lock.fill")
                                .font(.footnote).foregroundStyle(PraeludeColor.inkSecondary)
                        }
                        HStack(spacing: 12) {
                            Button { metronome.tap() } label: {
                                Text("Tap tempo").frame(maxWidth: .infinity, minHeight: 28)
                            }.buttonStyle(.praeludeQuiet).disabled(lockedTempo)
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
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 44), spacing: 8)], spacing: 8) {
                        ForEach(0..<metronome.beatsPerBar, id: \.self) { index in beatButton(index) }
                    }.padding(.vertical, 4)
                    if metronome.isPlaying && !reduceMotion {
                        ProgressView(value: metronome.beatProgress).tint(.secondary).accessibilityHidden(true)
                    }
                    Picker("Beats per bar", selection: $metronome.beatsPerBar) {
                        ForEach(1...12, id: \.self) { Text("\($0)").tag($0) }
                    }
                    Picker("Beat value", selection: $metronome.denominator) {
                        Text("Half note · 2").tag(2)
                        Text("Quarter note · 4").tag(4)
                        Text("Eighth note · 8").tag(8)
                    }
                    LabeledContent("Time signature", value: "\(metronome.beatsPerBar)/\(metronome.denominator)")
                    Button("Reset accents") { metronome.resetAccents() }
                } header: {
                    Text("Meter & accents")
                } footer: {
                    Text("Tap a beat to cycle accent, silence, and regular beat. Tempo counts each \(beatName); subdivisions divide that beat.")
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

                Section("Click sound") {
                    Picker("Sound", selection: $metronome.sound) {
                        ForEach(MetronomeSound.allCases, id: \.self) { Text($0.title).tag($0) }
                    }
                    HStack {
                        Image(systemName: "speaker.fill").foregroundStyle(.secondary).accessibilityHidden(true)
                        Slider(value: $metronome.volume, in: 0...1).accessibilityLabel("Metronome volume")
                        Image(systemName: "speaker.wave.3.fill").foregroundStyle(.secondary).accessibilityHidden(true)
                    }
                    Toggle("Beat haptics", isOn: $metronome.hapticsEnabled)
                }

                Section {
                    Toggle("Reward sounds", isOn: $feedback.soundsEnabled)
                    Toggle("Reward haptics", isOn: $feedback.hapticsEnabled)
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
            .background(PraeludeColor.paper)
            .navigationTitle("Metronome").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }.presentationDetents([.large]).presentationDragIndicator(.visible)
    }

    private func beatButton(_ index: Int) -> some View {
        let accent = metronome.accents[index]
        let current = metronome.isPlaying && metronome.beat == index + 1
        let pulseOn = current && metronome.beatProgress < 0.22
        return Button { metronome.cycleAccent(at: index) } label: {
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
