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
    var onStarted: () -> Void
    var onOpenAdvanced: () -> Void
    var onSplitPassage: (Passage) -> Void
    @State private var showVariants = false
    @State private var variantDraft: [VariantStage] = []
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if arm.awaitingColdGrade {
                coldGradeSection
            } else if arm.configuration != nil {
                header
                quickConditions
                tempoRow
                HStack(spacing: 12) {
                    Button("More options", action: onOpenAdvanced).buttonStyle(.praeludeQuiet).fixedSize(horizontal: true, vertical: false)
                    Button(action: start) {
                        Label("Start", systemImage: "play.fill").frame(maxWidth: .infinity, minHeight: 36)
                    }.buttonStyle(.praeludePrimary).accessibilityIdentifier("confirmStartSet")
                }
            }
            if let error { ErrorMessage(message: error) }
        }
        .sheet(isPresented: $showVariants) {
            NavigationStack {
                VariantEditorView(stages: $variantDraft)
                    .toolbar { ToolbarItem(placement: .confirmationAction) {
                        Button("Done") {
                            if let passage { arm.applyStagesOverride(variantDraft, passageID: passage.id) }
                            showVariants = false
                        }
                    } }
            }.presentationDetents([.medium, .large])
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(passage?.title ?? "Whole piece").font(.headline)
            Text(passage?.locationLabel ?? pieceSubtitle).font(.subheadline).foregroundStyle(PraeludeColor.inkSecondary).lineLimit(1)
        }
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
                            configuration.wrappedValue.useMetronome = goal == .tempo
                        }
                    }
                } label: { quickChip(Self.goalLabel(configuration.wrappedValue.goal)) }
                    .accessibilityIdentifier("armGoal")
                Stepper(value: configuration.targetCount, in: 1...100) {
                    quickChip("\(configuration.wrappedValue.targetCount) \(configuration.wrappedValue.basis == .cleanStreak ? "clean" : "plays")")
                }.labelsHidden().fixedSize().accessibilityIdentifier("armTargetCount")
                if configuration.wrappedValue.basis == .cleanStreak {
                    Toggle(isOn: ladderBinding) { quickChip("Ladder") }
                        .toggleStyle(.button).accessibilityIdentifier("armLadder")
                }
                if passage != nil {
                    Button {
                        variantDraft = configuration.wrappedValue.stages
                        showVariants = true
                    } label: {
                        quickChip(configuration.wrappedValue.stages.isEmpty ? "No variants" : "\(configuration.wrappedValue.stages.count) variants")
                    }.accessibilityIdentifier("armVariants")
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

    private var tempoRow: some View {
        HStack {
            Spacer(minLength: 0)
            TempoDial(bpm: configBinding.startBPM, numeralSize: 44, onTapTempo: {
                metronome.tap()
                configBinding.wrappedValue.startBPM = metronome.bpm
            })
            .onChange(of: configBinding.wrappedValue.startBPM) { _, newValue in
                if configBinding.wrappedValue.targetBPM < newValue { configBinding.wrappedValue.targetBPM = newValue }
            }
            Spacer(minLength: 0)
        }
    }

    /// §9/R3: "the first attempt of the day on a passage prompts Clean/Shaky/Missed." Replaces the
    /// normal Start affordance for a cold-eligible passage — grading *is* the second tap/word, never
    /// an extra third step (see `PracticeArmController.arm`'s doc comment).
    private var coldGradeSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            header
            Text("First time today on this passage. How did it go cold?")
                .font(.subheadline).foregroundStyle(PraeludeColor.inkSecondary)
            let layout = dynamicTypeSize.isAccessibilitySize ? AnyLayout(VStackLayout(spacing: 8)) : AnyLayout(HStackLayout(spacing: 10))
            layout {
                coldButton(.missed, title: "Missed", glyph: .verdictAgain)
                coldButton(.shaky, title: "Shaky", glyph: .verdictSloppy)
                coldButton(.clean, title: "Clean", glyph: .verdictClean, primary: true)
            }
            Button("More options", action: onOpenAdvanced).buttonStyle(.praeludeQuiet)
        }
    }

    private func coldButton(_ grade: ColdGrade, title: String, glyph: PraeludeGlyph, primary: Bool = false) -> some View {
        Button { start(grade: grade) } label: {
            VStack(spacing: 7) {
                PraeludeIcon(glyph: glyph, size: 22)
                Text(title).font(.headline)
            }
        }
        .buttonStyle(.praeludeVerdict(emphasis: primary))
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
                set: { arm.configuration = $0 })
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

    private static func goalLabel(_ goal: SetGoal) -> String {
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

    private func start(grade: ColdGrade? = nil) {
        do {
            guard try arm.start(grade: grade, store: store, runtime: runtime) else { return }
            if let configuration = arm.configuration {
                metronome.setTempo(configuration.startBPM)
                if configuration.useMetronome { metronome.start() } else { metronome.stop() }
            }
            onStarted()
        } catch { self.error = error.localizedDescription }
    }
}

private extension Binding where Value == PracticeConfiguration {
    var targetCount: Binding<Int> { Binding(get: { wrappedValue.targetCount }, set: { wrappedValue.targetCount = $0 }) }
    var startBPM: Binding<Double> { Binding(get: { wrappedValue.startBPM }, set: { wrappedValue.startBPM = $0 }) }
}
