import SwiftUI

/// §10a: the default, non-modal path from a chosen passage to practicing. Replaces the trip through
/// `SetComposerView` (still reachable as "More options" for anyone who wants the full form) for the
/// common case: rule defaults are already filled in (`PracticeArmController.arm`), and every
/// condition the spec calls out — goal, streak target, ladder, variants — is a single tap away, not
/// behind a sheet. Tapping (or saying) Start is the second and last tap.
struct PracticeArmView: View {
    @Environment(PracticeStore.self) private var store
    @Environment(MetronomeService.self) private var metronome
    @Environment(PracticeRuntime.self) private var runtime
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    var arm: PracticeArmController
    var passage: Passage?
    var pieceSubtitle: String
    var onRenamePassage: () -> Void = {}
    var onStarted: () -> Void
    var onOpenAdvanced: () -> Void
    var onSplitPassage: (Passage) -> Void
    @State private var showVariants = false
    @State private var variantDraft: [VariantStage] = []
    @State private var error: String?
    @State private var setupExpanded = false
    @State private var showTempoGoal = false
    @State private var ownsMetronomePreview = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if arm.configuration != nil {
                if dynamicTypeSize.isAccessibilitySize {
                    VStack(alignment: .leading, spacing: 8) {
                        header
                        tempoControls
                        primaryActions
                        secondaryActions(stacked: true)
                    }
                } else {
                    // Fit the score's available width rather than assuming an iPad orientation.
                    // The explicit minimums keep the two columns legible in narrow windows.
                    ViewThatFits(in: .horizontal) {
                        HStack(alignment: .center, spacing: 16) {
                            VStack(alignment: .leading, spacing: 0) {
                                headerAndTempo
                                secondaryActions(stacked: false)
                            }.frame(minWidth: 400, maxWidth: .infinity)
                            primaryActions
                                .frame(minWidth: arm.awaitingColdGrade ? 292 : 120,
                                       maxWidth: arm.awaitingColdGrade ? 340 : 180)
                        }
                        VStack(alignment: .leading, spacing: 4) {
                            headerAndTempo
                            if arm.awaitingColdGrade {
                                coldGradeSection
                                secondaryActions(stacked: false)
                            } else {
                                HStack(spacing: 8) {
                                    secondaryActions(stacked: false)
                                    startButton.frame(minWidth: 80, maxWidth: 120)
                                }
                            }
                        }
                    }
                }
                if setupExpanded {
                    quickConditions
                    Button("Use \(Int(configBinding.wrappedValue.startBPM)) BPM as piece default") {
                        savePieceTempo()
                    }.font(.footnote).buttonStyle(.plain)
                        .frame(minHeight: 44).contentShape(Rectangle())
                        .accessibilityIdentifier("savePiecePracticeTempo")
                }
            }
            if let error { ErrorMessage(message: error) }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("practiceArmPanel")
        .onChange(of: configBinding.wrappedValue.startBPM) { _, newValue in
            if configBinding.wrappedValue.targetBPM < newValue { configBinding.wrappedValue.targetBPM = newValue }
            if ownsMetronomePreview && metronome.isPlaying { metronome.setTempo(newValue) }
        }
        .onChange(of: passage) { old, new in
            guard old?.id == new?.id, old != new, let new else { return }
            // The saved shortcut can change while this arm panel is visible. Refresh only the
            // unstarted draft; a running set's stored configuration is never edited here.
            arm.arm(pieceID: new.pieceID, passage: new, store: store)
        }
        .onChange(of: arm.configuration?.passageID) { _, _ in stopPreviewIfIdle() }
        .onChange(of: arm.pieceID) { _, _ in stopPreviewIfIdle() }
        .onChange(of: arm.scoreSection?.id) { _, _ in stopPreviewIfIdle() }
        .onDisappear { stopPreviewIfIdle() }
        .sheet(isPresented: $showTempoGoal) {
            PracticeTempoGoalView(configuration: configBinding, passage: passage)
        }
        .sheet(isPresented: $showVariants) {
            NavigationStack {
                VariantEditorView(stages: $variantDraft)
                    .toolbar { ToolbarItem(placement: .confirmationAction) {
                        Button("Done") {
                            var value = configBinding.wrappedValue
                            value.stages = variantDraft
                            if !variantDraft.isEmpty { value.basis = .cleanStreak }
                            arm.applyConfigurationOverride(value)
                            showVariants = false
                        }.disabled(variantDraft.contains { $0.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || $0.name.count > 100 })
                    } }
            }.presentationDetents([.large]).presentationDragIndicator(.visible)
        }
    }

    private var headerAndTempo: some View {
        HStack(spacing: 8) {
            header.frame(maxWidth: .infinity, alignment: .leading)
            tempoControls.fixedSize(horizontal: true, vertical: false)
        }
    }

    private var tempoControls: some View {
        HStack(spacing: 6) {
            TempoDial(bpm: startBPMBinding(configBinding), numeralSize: 22, compact: true)
            Button { showTempoGoal = true } label: {
                VStack(spacing: 2) {
                    Text("Goal").font(.caption2).foregroundStyle(.secondary)
                    Text(configBinding.wrappedValue.targetBPM > configBinding.wrappedValue.startBPM
                         ? "\(Int(configBinding.wrappedValue.targetBPM))" : "Set")
                        .font(.subheadline.monospacedDigit().weight(.semibold))
                }.frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
            }.buttonStyle(.plain).accessibilityLabel("Tempo goal")
                .accessibilityValue(configBinding.wrappedValue.targetBPM > configBinding.wrappedValue.startBPM
                                    ? "\(Int(configBinding.wrappedValue.targetBPM)) BPM" : "Fixed tempo")
                .accessibilityIdentifier("armTempoGoal")
            Button {
                toggleMetronomePreview()
            } label: {
                VStack(spacing: 2) {
                    Image(systemName: "metronome")
                    Text(metronome.isPlaying ? "On" : "Off").font(.caption2)
                }.frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
                    .background(metronome.isPlaying ? PraeludeColor.inkFillQuiet : Color.clear,
                                in: RoundedRectangle(cornerRadius: 8))
            }.buttonStyle(.plain)
                .accessibilityLabel("Metronome")
                .accessibilityValue(metronome.isPlaying ? "On" : "Off")
                .accessibilityHint("Starts or stops the audible click before your first attempt, and sets the click for this practice set")
                .accessibilityIdentifier("armMetronome")
            Button { setupExpanded.toggle() } label: {
                Image(systemName: setupExpanded ? "chevron.down" : "slider.horizontal.3")
                    .frame(width: 44, height: 44).contentShape(Rectangle())
            }.buttonStyle(.plain).accessibilityLabel(setupExpanded ? "Hide practice options" : "Show practice options")
                .accessibilityIdentifier("armToggleOptions")
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 4) {
                Text(passage?.title ?? arm.configuration?.passageSnapshot?.title ?? "Whole piece")
                    .onTapGesture(count: 2, perform: onRenamePassage)
                    .accessibilityAction(named: "Edit name and goal tempo", onRenamePassage)
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 1)
                if passage != nil {
                    Button(action: onRenamePassage) {
                        Image(systemName: "pencil").font(.caption).frame(width: 44, height: 44)
                    }.buttonStyle(.plain).accessibilityLabel("Edit passage name and goal tempo")
                        .accessibilityIdentifier("armEditPassage")
                }
            }
            Text(passage.map { target in ScoreOrganization.locationLabel(for: target, in: store.pieces.first { $0.id == target.pieceID }) } ?? pieceSubtitle)
                .font(.caption).foregroundStyle(PraeludeColor.inkSecondary)
                .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 1)
            if let value = arm.configuration {
                Text("\(Self.goalLabel(value.goal)) · \(value.hands) · \(value.targetSummary)" + (value.useMetronome && metronome.groupedCompoundPulse ? " · dotted-quarter pulse" : ""))
                    .font(.caption).foregroundStyle(.secondary)
                    .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 1)
                    .accessibilityIdentifier("armedConditions")
            }
        }
    }

    @ViewBuilder private var primaryActions: some View {
        if arm.awaitingColdGrade { coldGradeSection } else { startButton }
    }

    private var startButton: some View {
        Button(action: { start() }) {
            Label("Start", systemImage: "play.fill").padding(.horizontal, 10)
        }.buttonStyle(ArmPracticeButtonStyle(emphasis: true))
            .accessibilityIdentifier("armStartSet")
    }

    @ViewBuilder private func secondaryActions(stacked: Bool) -> some View {
        if stacked {
            VStack(alignment: .leading, spacing: 0) { secondaryButtons }
        } else {
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 6) { secondaryButtons }.fixedSize(horizontal: true, vertical: false)
                VStack(alignment: .leading, spacing: 0) { secondaryButtons }
            }.frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    @ViewBuilder private var secondaryButtons: some View {
        PracticeHandsControl(hands: Binding(get: { configBinding.wrappedValue.hands },
                                            set: { configBinding.wrappedValue.hands = $0 }))
        if arm.awaitingColdGrade {
            Button("Explore") { start(skippingColdGrade: true) }
                .accessibilityLabel("Start without grading")
                .accessibilityHint("Explore this passage without grading a first attempt")
                .accessibilityIdentifier("skipColdGrade")
                .buttonStyle(ArmSecondaryButtonStyle())
        }
        Button {
            variantDraft = configBinding.wrappedValue.stages
            showVariants = true
        } label: {
            Text(configBinding.wrappedValue.stages.isEmpty ? "Techniques" : "\(configBinding.wrappedValue.stages.count) stages")
        }
            .accessibilityIdentifier("armVariants")
            .buttonStyle(ArmSecondaryButtonStyle())
        Button(action: onOpenAdvanced) {
            Image(systemName: "ellipsis").frame(width: 44, height: 44).contentShape(Rectangle())
        }.buttonStyle(.plain).accessibilityLabel("More options")
    }

    /// §10a: "conditions — goal, streak target, ladder, variants — reachable in ≤2 taps... with
    /// defaults filled." Every control here changes `arm.configuration` directly and in place; none
    /// of them present a sheet of their own except Variants, whose own chain needs more than one
    /// value (reusing the existing `VariantEditorView`, the same editor `SetComposerView` uses).
    @ViewBuilder private var quickConditions: some View {
        let configuration = configBinding
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                Menu {
                    ForEach(SetGoal.allCases, id: \.self) { goal in
                        Button(Self.goalLabel(goal)) {
                            configuration.wrappedValue.goal = goal
                        }
                    }
                } label: { quickChip(Self.goalLabel(configuration.wrappedValue.goal)) }
                    .accessibilityIdentifier("armGoal")
                // §11 R5: the streak/plays target itself, not just the ± control — `.labelsHidden()`
                // here previously hid this chip's whole label (its *only* visible text), leaving just
                // "− +" with no indication of what was being adjusted. See "(C) Audit.md".
                if configuration.wrappedValue.stages.isEmpty {
                    Stepper(value: targetCountBinding(configuration), in: 1...100) {
                        quickChip(configuration.wrappedValue.targetSummary)
                    }.fixedSize().accessibilityIdentifier("armTargetCount")
                } else {
                    Button {
                        variantDraft = configuration.wrappedValue.stages
                        showVariants = true
                    } label: { quickChip("Edit stage targets") }
                        .accessibilityIdentifier("armStageTargets")
                }
                if configuration.wrappedValue.basis == .cleanStreak {
                    Toggle(isOn: ladderBinding) { quickChip("Ladder") }
                        .toggleStyle(.button).accessibilityIdentifier("armLadder")
                }
                Menu {
                    ForEach(handsChoices, id: \.self) { choice in
                        Button(choice) { configuration.wrappedValue.hands = choice }
                    }
                } label: { quickChip(configuration.wrappedValue.hands) }
                    .accessibilityIdentifier("armHands")
            }
        }
    }

    /// §9/R3: "the first attempt of the day on a passage prompts Clean/Shaky/Missed." Replaces the
    /// normal Start affordance for a cold-eligible passage — grading *is* the second tap/word, never
    /// an extra third step (see `PracticeArmController.arm`'s doc comment).
    private var coldGradeSection: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("First attempt today").font(.caption).foregroundStyle(PraeludeColor.inkSecondary)
                .accessibilityHint("Play this passage once, then report Clean, Shaky or Missed. Your grade saves the first repetition.")
            let layout = dynamicTypeSize.isAccessibilitySize
                ? AnyLayout(VStackLayout(spacing: 6)) : AnyLayout(HStackLayout(spacing: 6))
            layout {
                coldButton(.missed, title: "Missed", glyph: .verdictAgain)
                coldButton(.shaky, title: "Shaky", glyph: .verdictSloppy)
                coldButton(.clean, title: "Clean", glyph: .verdictClean, primary: true)
            }
        }
    }

    private func coldButton(_ grade: ColdGrade, title: String, glyph: PraeludeGlyph, primary: Bool = false) -> some View {
        Button { start(grade: grade) } label: {
            HStack(spacing: 6) {
                PraeludeIcon(glyph: glyph, size: 17)
                Text(title).font(.subheadline.weight(.semibold))
            }.padding(.horizontal, 10).padding(.vertical, 6)
        }
        .buttonStyle(ArmPracticeButtonStyle(emphasis: primary))
        .accessibilityLabel(title)
        .accessibilityIdentifier("coldGrade_\(grade.rawValue)")
    }

    private func quickChip(_ text: String) -> some View {
        Text(text).font(.caption.weight(.medium))
            .padding(.horizontal, 10).padding(.vertical, 7)
            .frame(minHeight: 32)
            .background(PraeludeColor.inkFillQuiet, in: Capsule())
            .foregroundStyle(PraeludeColor.ink)
    }

    private var configBinding: Binding<PracticeConfiguration> {
        Binding(get: { arm.configuration ?? PracticeConfiguration(pieceID: arm.pieceID ?? UUID(), focus: "Pulse") },
                set: { arm.applyConfigurationOverride($0) })
    }

    private var ladderBinding: Binding<Bool> {
        Binding(
            get: { configBinding.wrappedValue.targetBPM > configBinding.wrappedValue.startBPM },
            set: { isOn in
                if isOn {
                    let target = passage?.performanceTempo ?? (configBinding.wrappedValue.startBPM + 20)
                    configBinding.wrappedValue.targetBPM = max(target, configBinding.wrappedValue.startBPM + 1)
                } else {
                    configBinding.wrappedValue.targetBPM = configBinding.wrappedValue.startBPM
                }
            })
    }

    private var handsChoices: [String] { ["Both hands", "Right hand", "Left hand", "Hands separately"] }

    static func goalLabel(_ goal: SetGoal) -> String {
        switch goal {
        case .tempo: "Tempo"
        case .notesAndAccuracy: "Notes & accuracy"
        case .phrasing: "Phrasing"
        case .dynamics: "Dynamics"
        case .memory: "Memory"
        case .partsCoordination: "Parts/Coordination"
        case .other: "Other"
        }
    }

    private func toggleMetronomePreview() {
        guard store.activeSet?.status != .running else {
            error = "Pause or finish the current set before changing the first-attempt click."
            return
        }
        if metronome.isPlaying {
            metronome.stop()
            configBinding.wrappedValue.useMetronome = false
            ownsMetronomePreview = false
            error = nil
        } else {
            metronome.applyDropoutPlan(nil)
            metronome.setTempo(configBinding.wrappedValue.startBPM)
            metronome.start()
            ownsMetronomePreview = metronome.isPlaying
            if metronome.isPlaying { configBinding.wrappedValue.useMetronome = true; error = nil }
            else { error = metronome.errorMessage }
        }
    }

    private func stopPreviewIfIdle() {
        guard ownsMetronomePreview, store.activeSet?.status != .running else { return }
        metronome.stop(); ownsMetronomePreview = false
    }

    private func savePieceTempo() {
        guard let pieceID = arm.pieceID else { return }
        do {
            try store.setDefaultPracticeTempo(configBinding.wrappedValue.startBPM, for: pieceID)
            error = nil
        } catch { self.error = error.localizedDescription }
    }

    private func start(grade: ColdGrade? = nil, skippingColdGrade: Bool = false) {
        do {
            guard try arm.start(grade: grade, skippingColdGrade: skippingColdGrade, store: store, runtime: runtime) else { return }
            if let set = store.activeSet {
                metronome.setTempo(set.currentBPM)
                if set.status == .running && set.configuration.useMetronome { metronome.start() } else { metronome.stop() }
            }
            onStarted()
        } catch { self.error = error.localizedDescription }
    }
}

/// Narrows a `Binding<PracticeConfiguration>` to one of its fields, for controls (`Stepper`,
/// `TempoDial`) that need a `Binding` to a single `Int`/`Double`, not the whole configuration.
private func targetCountBinding(_ configuration: Binding<PracticeConfiguration>) -> Binding<Int> {
    Binding(get: { configuration.wrappedValue.targetCount }, set: { configuration.wrappedValue.targetCount = $0 })
}
private func startBPMBinding(_ configuration: Binding<PracticeConfiguration>) -> Binding<Double> {
    Binding(get: { configuration.wrappedValue.startBPM }, set: { configuration.wrappedValue.startBPM = $0 })
}

/// Local practice-setup treatments keep essential hit areas without inheriting full-page buttons.
private struct ArmPracticeButtonStyle: ButtonStyle {
    var emphasis: Bool
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.subheadline.weight(.semibold))
            .frame(maxWidth: .infinity, minHeight: 52)
            .contentShape(Rectangle())
            .foregroundStyle(emphasis ? PraeludeColor.paper : PraeludeColor.ink)
            .background(emphasis ? PraeludeColor.ink : PraeludeColor.inkFillQuiet,
                        in: RoundedRectangle(cornerRadius: 9))
            .opacity(configuration.isPressed ? 0.7 : 1)
    }
}

private struct ArmSecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.footnote).foregroundStyle(PraeludeColor.inkSecondary)
            .padding(.horizontal, 4)
            .frame(minWidth: 44, minHeight: 44, alignment: .leading)
            .contentShape(Rectangle())
            .opacity(configuration.isPressed ? 0.55 : 1)
    }
}
