import SwiftUI

struct SetComposerView: View {
    @Environment(PracticeStore.self) private var store
    @Environment(MetronomeService.self) private var metronome
    @Environment(\.dismiss) private var dismiss
    @State private var focus: String
    @State private var basis: CompletionBasis = .cleanStreak
    @State private var targetCount = 5
    @State private var startBPM = 60.0
    @State private var targetBPM = 80.0
    @State private var useMetronome = false
    @State private var useLadder = false
    @State private var percentageStep = false
    @State private var stepAmount = 4.0
    @State private var hands = "Both hands"
    @State private var stages: [VariantStage] = []
    @State private var errorMessage: String?
    @State private var saving = false
    let pieceID: UUID
    let passage: Passage?
    /// A caller-supplied heading in place of the piece/passage title — e.g. a warmup exercise's
    /// name, since `WarmupsPiece` has no title worth surfacing here (see `WarmupsView`).
    let displayTitle: String?
    let onStarted: () -> Void

    /// `initialFocus`/`initialBPM` seed sensible defaults for a caller that already knows them (a
    /// warmup's name and its kind-appropriate starting tempo, `WarmupCatalog.defaultBPM`) without
    /// changing anything about how `start()` builds the `PracticeConfiguration` below.
    init(pieceID: UUID, passage: Passage? = nil, displayTitle: String? = nil, initialFocus: String? = nil,
         initialBPM: Double? = nil, onStarted: @escaping () -> Void) {
        self.pieceID = pieceID
        self.passage = passage
        self.displayTitle = displayTitle
        self.onStarted = onStarted
        _focus = State(initialValue: initialFocus ?? passage?.focus ?? "Pulse")
        if let initialBPM { _startBPM = State(initialValue: initialBPM); _targetBPM = State(initialValue: initialBPM) }
    }

    private var currentSetPreventsStart: Bool {
        guard let active = store.activeSet else { return false }
        return active.status == .running || active.status == .paused
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(displayTitle ?? passage?.title ?? store.pieces.first { $0.id == pieceID }?.title ?? "Practice")
                            .font(.headline)
                        if let passage {
                            Text(passage.locationLabel)
                                .font(.subheadline).foregroundStyle(.secondary)
                        } else if displayTitle == nil {
                            Text("Whole piece").font(.subheadline).foregroundStyle(.secondary)
                        }
                    }
                    .padding(.vertical, 4)
                    PracticeFocusField(focus: $focus)
                    Stepper(value: $targetCount, in: 1...100) {
                        LabeledContent(basis == .cleanStreak ? "Clean target" : "Total plays", value: "\(targetCount)")
                    }
                }

                Section {
                    Stepper(value: $startBPM, in: 20...300, step: 1) {
                        LabeledContent("Starting tempo", value: "\(Int(startBPM)) bpm")
                    }
                    Toggle("Metronome", isOn: $useMetronome).praeludeToggleHaptic(useMetronome)
                } footer: {
                    Text("Start with a tempo where you can hear and feel the work.")
                }

                Section {
                    DisclosureGroup("Set rules") {
                        Picker("Count", selection: $basis) {
                            Text("Clean streak").tag(CompletionBasis.cleanStreak)
                            Text("Total plays").tag(CompletionBasis.totalPlays)
                        }
                        Picker("Hands", selection: $hands) {
                            Text("Both hands").tag("Both hands")
                            Text("Right hand").tag("Right hand")
                            Text("Left hand").tag("Left hand")
                            Text("Hands separately").tag("Hands separately")
                        }
                        Text(basis == .cleanStreak
                             ? "Reach the clean target consecutively. Sloppy restarts the current clean run. Again preserves variant progress when you use a chain."
                             : "Every recorded Clean, Sloppy, or Again counts toward your target. Total plays uses a fixed tempo and no variants.")
                            .font(.subheadline).foregroundStyle(.secondary)
                    }
                }

                if basis == .cleanStreak {
                    Section {
                        Toggle("Tempo ladder", isOn: $useLadder).praeludeToggleHaptic(useLadder)
                        if useLadder {
                            Stepper(value: $targetBPM, in: startBPM...300, step: 1) {
                                LabeledContent("Target tempo", value: "\(Int(targetBPM)) bpm")
                            }
                            Picker("Increase by", selection: $percentageStep) {
                                Text("BPM").tag(false)
                                Text("Percent").tag(true)
                            }
                            Stepper(value: $stepAmount, in: 1...100, step: 1) {
                                LabeledContent("Step", value: "\(Int(stepAmount))\(percentageStep ? "%" : " bpm")")
                            }
                        }
                        NavigationLink {
                            VariantEditorView(stages: $stages)
                        } label: {
                            LabeledContent("Variants", value: stages.isEmpty ? "None" : "\(stages.count) stages")
                        }
                    } footer: {
                        if useLadder {
                            Text("Complete the clean target or whole variant chain at each tempo before the next step.")
                        }
                    }
                }

                if currentSetPreventsStart {
                    Section {
                        Label("Finish the current set first", systemImage: "pause.circle")
                            .font(.headline)
                        Text("Your current set is still saved. Close this setup and finish it before starting another.")
                            .font(.subheadline).foregroundStyle(.secondary)
                    }
                }

                if let errorMessage { Section { ErrorMessage(message: errorMessage) } }

            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                Button(action: start) {
                    Label("Start set", systemImage: "play.fill")
                        .font(.headline).frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.praeludePrimary)
                .accessibilityIdentifier("confirmStartSet")
                .disabled(currentSetPreventsStart || saving || store.isReadOnly ||
                          focus.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .padding(.horizontal, 20).padding(.vertical, 12).praeludeSurfacePanel().praeludeHairline(.top)
            }
            .scrollContentBackground(.hidden)
            .background(PraeludeColor.paper)
            .navigationTitle("Practice set")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
            .onChange(of: startBPM) { _, newValue in targetBPM = max(newValue, targetBPM) }
            .interactiveDismissDisabled(saving)
        }
    }

    private func start() {
        guard !saving, !currentSetPreventsStart else { return }
        saving = true
        defer { saving = false }
        let configuration = PracticeConfiguration(
            pieceID: pieceID, passageID: passage?.id,
            focus: focus.trimmingCharacters(in: .whitespacesAndNewlines),
            basis: basis, targetCount: targetCount, startBPM: startBPM,
            targetBPM: basis == .cleanStreak && useLadder ? max(startBPM, targetBPM) : startBPM,
            tempoStep: percentageStep ? .percent(stepAmount) : .fixed(stepAmount),
            stages: basis == .cleanStreak ? stages : [], hands: hands, useMetronome: useMetronome
        )
        do {
            try store.startSet(configuration)
            metronome.setTempo(startBPM)
            if useMetronome { metronome.start() } else { metronome.stop() }
            onStarted()
            dismiss()
        } catch { errorMessage = error.localizedDescription }
    }
}

struct PracticeFocusField: View {
    @Binding var focus: String
    private let choices = ["Pulse", "Tempo", "Notes", "Phrasing", "Dynamics", "Memory", "Hands"]

    var body: some View {
        HStack {
            TextField("Practice focus", text: $focus)
                .accessibilityLabel("Practice focus")
            Menu {
                ForEach(choices, id: \.self) { choice in
                    Button(choice) { focus = choice }
                }
            } label: {
                Image(systemName: "chevron.up.chevron.down")
                    .frame(minWidth: 44, minHeight: 44)
                    .accessibilityLabel("Choose practice focus")
            }
        }
    }
}

private struct VariantEditorView: View {
    @Environment(PracticeStore.self) private var store
    @Binding var stages: [VariantStage]
    @State private var name = ""
    @State private var target = 3
    @State private var routineName = ""
    @State private var savingRoutine = false
    @State private var errorMessage: String?
    @State private var savedMessage: String?
    private let suggestions = ["Dotted", "Reverse dotted", "Staccato", "Legato", "Hands separately", "Slow motion"]

    var body: some View {
        Form {
            if !store.state.routines.isEmpty {
                Section("Saved routines") {
                    Menu("Apply a routine", systemImage: "list.bullet.rectangle") {
                        ForEach(store.state.routines) { routine in
                            Button(routine.name) {
                                stages = routine.stages.map { VariantStage(name: $0.name, targetCount: $0.targetCount) }
                                savedMessage = nil
                            }
                        }
                    }
                }
            }
            Section {
                if stages.isEmpty {
                    Text("No variants yet. Add the order you want to practice.")
                        .foregroundStyle(.secondary)
                }
                ForEach($stages) { $stage in
                    VStack(alignment: .leading, spacing: 4) {
                        TextField("Variant name", text: $stage.name)
                            .font(.headline)
                        Stepper(value: $stage.targetCount, in: 1...100) {
                            Text("\(stage.targetCount) consecutive Clean")
                                .font(.subheadline).foregroundStyle(.secondary)
                        }
                    }
                    .padding(.vertical, 3)
                }
                .onDelete { stages.remove(atOffsets: $0) }
                .onMove { stages.move(fromOffsets: $0, toOffset: $1) }
            } header: {
                Text("In order")
            } footer: {
                Text("Each stage has its own clean target. Use Edit to reorder or remove stages. Applying a routine replaces this draft chain.")
            }

            Section("Add a variant") {
                HStack {
                    TextField("Name", text: $name)
                    Menu {
                        ForEach(suggestions, id: \.self) { suggestion in
                            Button(suggestion) { name = suggestion }
                        }
                    } label: {
                        Image(systemName: "list.bullet").frame(minWidth: 44, minHeight: 44)
                    }
                    .accessibilityLabel("Variant suggestions")
                }
                Stepper("\(target) consecutive Clean", value: $target, in: 1...100)
                Button("Add stage", systemImage: "plus") {
                    stages.append(VariantStage(name: name.trimmingCharacters(in: .whitespacesAndNewlines), targetCount: target))
                    name = ""
                    savedMessage = nil
                }
                .disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || name.count > 100 || stages.count >= 24)
            }

            if !stages.isEmpty {
                Section {
                    Button("Save as routine", systemImage: "square.and.arrow.down") { savingRoutine = true }
                        .disabled(stages.contains { $0.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || $0.name.count > 100 })
                    if let savedMessage {
                        Label(savedMessage, systemImage: "checkmark.circle")
                            .font(.subheadline).foregroundStyle(.secondary)
                    }
                } footer: {
                    Text("Saved routines are available to all your pieces. Applying one creates an editable copy.")
                }
            }
            if let errorMessage { Section { ErrorMessage(message: errorMessage) } }
        }
        .navigationTitle("Variants")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .topBarTrailing) { EditButton() } }
        .alert("Save routine", isPresented: $savingRoutine) {
            TextField("Routine name", text: $routineName)
            Button("Cancel", role: .cancel) {}
            Button("Save") { saveRoutine() }
                .disabled(routineName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        } message: {
            Text("Give this ordered set of variants a name.")
        }
    }

    private func saveRoutine() {
        do {
            let trimmed = routineName.trimmingCharacters(in: .whitespacesAndNewlines)
            let routine = PracticeRoutine(name: trimmed,
                                          stages: stages.map { VariantStage(name: $0.name.trimmingCharacters(in: .whitespacesAndNewlines), targetCount: $0.targetCount) })
            try store.saveRoutine(routine)
            savedMessage = "Saved \(trimmed)"
            routineName = ""
            errorMessage = nil
        } catch { errorMessage = error.localizedDescription }
    }
}
