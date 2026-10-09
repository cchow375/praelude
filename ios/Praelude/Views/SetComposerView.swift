import SwiftUI

struct SetComposerView: View {
    @Environment(PracticeStore.self) private var store
    @Environment(MetronomeService.self) private var metronome
    @Environment(\.dismiss) private var dismiss
    @State private var focus: String
    @State private var goal = SetGoal.tempo
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
    let onConfigured: ((PracticeConfiguration) -> Void)?

    /// `initialFocus`/`initialBPM` seed sensible defaults for a caller that already knows them (a
    /// warmup's name and its kind-appropriate starting tempo, `WarmupCatalog.defaultBPM`) without
    /// changing anything about how `start()` builds the `PracticeConfiguration` below.
    init(pieceID: UUID, passage: Passage? = nil, displayTitle: String? = nil, initialFocus: String? = nil,
         initialBPM: Double? = nil, initialConfiguration: PracticeConfiguration? = nil,
         onConfigured: ((PracticeConfiguration) -> Void)? = nil, onStarted: @escaping () -> Void) {
        self.pieceID = pieceID
        self.passage = passage
        self.displayTitle = displayTitle
        self.onStarted = onStarted
        self.onConfigured = onConfigured
        _focus = State(initialValue: initialFocus ?? passage?.focus ?? "Pulse")
        if let initialBPM { _startBPM = State(initialValue: initialBPM); _targetBPM = State(initialValue: initialBPM) }
        if let value = initialConfiguration {
            _focus = State(initialValue: value.focus); _goal = State(initialValue: value.goal)
            _basis = State(initialValue: value.basis); _targetCount = State(initialValue: value.targetCount)
            _startBPM = State(initialValue: value.startBPM); _targetBPM = State(initialValue: value.targetBPM)
            _useMetronome = State(initialValue: value.useMetronome)
            _useLadder = State(initialValue: value.targetBPM > value.startBPM)
            switch value.tempoStep {
            case .fixed(let amount): _percentageStep = State(initialValue: false); _stepAmount = State(initialValue: amount)
            case .percent(let amount): _percentageStep = State(initialValue: true); _stepAmount = State(initialValue: amount)
            }
            _hands = State(initialValue: value.hands); _stages = State(initialValue: value.stages)
        }
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
                    if stages.isEmpty || basis == .totalPlays {
                        Stepper(value: $targetCount, in: 1...100) {
                            LabeledContent(basis == .cleanStreak ? "Clean target" : "Total plays", value: "\(targetCount)")
                        }
                    } else {
                        NavigationLink { VariantEditorView(stages: $stages) } label: {
                            LabeledContent("Edit stage targets", value: "\(stages.count) stages")
                        }.accessibilityIdentifier("composerStageTargets")
                    }
                    if let passageID = passage?.id { LastRecordingCard(passageID: passageID) }
                }

                Section {
                    HStack {
                        Text("Starting tempo")
                        Spacer()
                        TempoDial(bpm: $startBPM, numeralSize: 28, compact: true,
                                  accessibilityTitle: "Starting tempo", accessibilityID: "composerStartTempo")
                    }
                    HStack {
                        Text("Hands")
                        Spacer()
                        PracticeHandsControl(hands: $hands)
                    }
                    Toggle("Metronome", isOn: $useMetronome).praeludeToggleHaptic(useMetronome)
                } footer: {
                    Text("Start with a tempo where you can hear and feel the work.")
                }

                Section {
                    DisclosureGroup("Set rules") {
                        Picker("Goal", selection: $goal) {
                            ForEach(SetGoal.allCases, id: \.self) { value in Text(PracticeArmView.goalLabel(value)).tag(value) }
                        }
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
                            HStack {
                                Text("Target tempo")
                                Spacer()
                                TempoDial(bpm: Binding(get: { targetBPM }, set: { targetBPM = max(startBPM, $0) }), numeralSize: 28, compact: true,
                                          accessibilityTitle: "Target tempo", accessibilityID: "composerTargetTempo")
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
                            LabeledContent("Techniques", value: stages.isEmpty ? "Choose" : "\(stages.count) stages")
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
                    Label(onConfigured == nil ? "Start set" : "Use settings", systemImage: onConfigured == nil ? "play.fill" : "checkmark")
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
            focus: focus.trimmingCharacters(in: .whitespacesAndNewlines), goal: goal,
            basis: basis, targetCount: targetCount, startBPM: startBPM,
            targetBPM: basis == .cleanStreak && useLadder ? max(startBPM, targetBPM) : startBPM,
            tempoStep: percentageStep ? .percent(stepAmount) : .fixed(stepAmount),
            stages: basis == .cleanStreak ? stages : [], hands: hands, useMetronome: useMetronome
        )
        if let onConfigured { onConfigured(configuration); dismiss(); return }
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

struct VariantEditorView: View {
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
            Section {
                if stages.isEmpty {
                    Text("Choose a technique below, then play its stages in order.")
                        .foregroundStyle(.secondary)
                }
                ForEach($stages) { $stage in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text("\((stages.firstIndex(where: { $0.id == stage.id }) ?? 0) + 1)")
                                .font(.subheadline.monospacedDigit()).foregroundStyle(.secondary)
                                .frame(width: 24)
                            TextField("Stage name", text: $stage.name).font(.headline)
                            Menu {
                                Button("Move earlier", systemImage: "arrow.up") { moveStage(stage.id, by: -1) }
                                    .disabled(stages.first?.id == stage.id)
                                Button("Move later", systemImage: "arrow.down") { moveStage(stage.id, by: 1) }
                                    .disabled(stages.last?.id == stage.id)
                                Button("Remove stage", systemImage: "trash", role: .destructive) { stages.removeAll { $0.id == stage.id } }
                            } label: {
                                Image(systemName: "ellipsis").frame(width: 44, height: 44).contentShape(Rectangle())
                            }.accessibilityLabel("Options for \(stage.name)")
                        }
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
                Text("Finish each clean target to continue to the next stage. Stage options reorder or remove it; Edit also supports dragging.")
            }

            Section {
                Stepper("\(target) Clean per new stage", value: $target, in: 1...100)
                ForEach(PracticeTechnique.allCases) { technique in
                    Button {
                        stages.append(contentsOf: technique.stages(targetCount: target))
                        savedMessage = "Added \(technique.title)"
                        PraeludeHaptic.toggle()
                    } label: {
                        VStack(alignment: .leading, spacing: 5) {
                            Label(technique.title, systemImage: "plus.circle")
                                .font(.headline).foregroundStyle(.primary)
                            Text(technique.instruction).font(.subheadline).foregroundStyle(.secondary)
                        }.frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 4)
                    }.disabled(stages.count + technique.stageNames.count > 24)
                        .accessibilityIdentifier("technique_\(technique.id)")
                }
            } header: { Text("Try a technique") } footer: {
                Text("Choose what fits this passage. A choice adds an editable chain using the clean target you choose. It does not change tempo, hands or the score automatically.")
            }
            if store.state.routines.contains(where: { $0.deletedAt == nil }) {
                Section("Saved routines") {
                    Menu("Apply a routine", systemImage: "list.bullet.rectangle") {
                        ForEach(store.state.routines.filter { $0.deletedAt == nil }) { routine in
                            Button(routine.name) {
                                stages = routine.stages.map { VariantStage(name: $0.name, targetCount: $0.targetCount) }
                                savedMessage = nil
                            }
                        }
                    }
                }
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
        .navigationTitle("Practice techniques")
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if !stages.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text("\(stages.count) stages · \(stages.reduce(0) { $0 + $1.targetCount }) clean repetitions per tempo")
                        .font(.subheadline.weight(.semibold))
                    Text(stages.map(\.name).joined(separator: " → "))
                        .font(.caption).foregroundStyle(.secondary).lineLimit(2)
                }.frame(maxWidth: .infinity, alignment: .leading).padding(12).praeludeScoreChrome()
                    .accessibilityIdentifier("techniqueChainSummary")
            }
        }
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

    private func moveStage(_ id: UUID, by offset: Int) {
        guard let index = stages.firstIndex(where: { $0.id == id }), stages.indices.contains(index + offset) else { return }
        stages.swapAt(index, index + offset)
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
