import SwiftUI

/// Edits a future set's contract as one deliberate draft. No practice result is recorded here.
struct PracticeTempoGoalView: View {
    @Binding var configuration: PracticeConfiguration
    var passage: Passage?
    @Environment(PracticeStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var start = 60.0
    @State private var target = 60.0
    @State private var step = 4.0
    @State private var percent = false
    @State private var count = 5
    @State private var savePerformanceGoal = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack {
                        Text("Start")
                        Spacer()
                        TempoDial(bpm: $start, numeralSize: 28, compact: true,
                                  accessibilityTitle: "Start tempo", accessibilityID: "tempoGoalStart")
                    }
                    HStack {
                        Text("Goal")
                        Spacer()
                        TempoDial(bpm: $target, numeralSize: 28, compact: true,
                                  accessibilityTitle: "Goal tempo", accessibilityID: "tempoGoalTarget")
                    }.accessibilityElement(children: .contain).accessibilityIdentifier("tempoGoalRow")
                    if let tempo = passage?.performanceTempo, tempo >= start {
                        Button("Use performance goal · \(Int(tempo)) BPM") { target = tempo }
                    }
                    Button("Stay at \(Int(start)) BPM") { target = start }
                        .accessibilityIdentifier("tempoGoalFixed")
                } footer: { Text("Tap either number to type. Slide it up or down for a quick adjustment.") }
                if target > start {
                    Section("At each tempo") {
                        if configuration.stages.isEmpty {
                            Stepper("\(count) consecutive Clean", value: $count, in: 1...100)
                        } else {
                            Text("Complete all \(configuration.stages.count) technique stages.")
                        }
                        Picker("Increase in", selection: $percent) {
                            Text("BPM").tag(false)
                            Text("Percent").tag(true)
                        }.pickerStyle(.segmented)
                        Stepper("Increase by \(Int(step))\(percent ? "%" : " BPM")", value: $step, in: 1...100)
                    }
                    Section {
                        Text("\(Int(start)) → \(Int(target)) BPM. Tempo rises only after you record the clean target.")
                            .foregroundStyle(.secondary)
                    }
                }
                if passage != nil {
                    Section {
                        Toggle("Also save as passage performance goal", isOn: $savePerformanceGoal)
                    } footer: { Text("The performance goal stays with this passage for future practice and progress.") }
                }
                if let error { Section { ErrorMessage(message: error) } }
            }
            .navigationTitle("Tempo goal").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Use goal", action: apply).accessibilityIdentifier("applyTempoGoal")
                }
            }
        }
        .presentationDetents([.large]).presentationDragIndicator(.visible)
        .onAppear {
            start = configuration.startBPM; target = configuration.targetBPM; count = configuration.targetCount
            switch configuration.tempoStep {
            case .fixed(let amount): step = amount; percent = false
            case .percent(let amount): step = amount; percent = true
            }
        }
        .onChange(of: start) { _, value in target = max(value, target) }
        .onChange(of: target) { _, value in if value < start { start = value } }
    }

    private func apply() {
        do {
            if savePerformanceGoal, let passage {
                var edited = passage
                edited.performanceTempo = target; edited.updatedAt = Date()
                try store.savePassage(edited, replacing: passage)
            }
            var draft = configuration
            draft.startBPM = start; draft.targetBPM = target
            draft.targetCount = count
            draft.tempoStep = percent ? .percent(step) : .fixed(step)
            if target > start { draft.basis = .cleanStreak }
            configuration = draft
            dismiss()
        } catch { self.error = error.localizedDescription }
    }
}

/// The three most common choices stay visible. The full composer retains "Hands separately".
struct PracticeHandsControl: View {
    @Binding var hands: String
    var body: some View {
        HStack(spacing: 0) {
            choice("L", value: "Left hand")
            choice("Both", value: "Both hands")
            choice("R", value: "Right hand")
        }
        .background(PraeludeColor.inkFillQuiet, in: RoundedRectangle(cornerRadius: 8))
        .accessibilityElement(children: .contain).accessibilityLabel("Hands")
    }
    private func choice(_ label: String, value: String) -> some View {
        Button {
            hands = value; PraeludeHaptic.toggle()
        } label: {
            Text(label).font(.caption.weight(.semibold))
                .frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
                .foregroundStyle(hands == value ? PraeludeColor.paper : PraeludeColor.inkSecondary)
                .background(hands == value ? PraeludeColor.ink : .clear, in: RoundedRectangle(cornerRadius: 8))
        }.buttonStyle(.plain)
            .accessibilityLabel(value).accessibilityAddTraits(hands == value ? .isSelected : [])
            .accessibilityIdentifier("practiceHands_\(label)")
    }
}
