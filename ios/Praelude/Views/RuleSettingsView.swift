import SwiftUI

/// §11: "rule parameters are editable in Settings" — every rule's own enable toggle plus its
/// documented tunables, writing straight through `PracticeStore.updateRuleSettings` (whole-record
/// last-write-wins, per `RuleSettings`'s own doc comment) the same way `SettingsView.preference`
/// already writes `Preferences` field-by-field. See "(C) Audit.md": none of this existed before.
struct RuleSettingsView: View {
    @Environment(PracticeStore.self) private var store
    @State private var errorMessage: String?

    var body: some View {
        Form {
            Section {
                Text("These fifteen rules fire deterministically from what you've already recorded — never from listening to your playing. Turn any of them off, or adjust how quickly they fire, below.")
                    .foregroundStyle(.secondary)
            }
            Section("R1 · Small chunks") {
                Toggle("Offer a split for tall passages", isOn: setting(\.r1Enabled)).praeludeToggleHaptic(store.state.ruleSettings.r1Enabled)
                intRow("Max measures before offering a split", setting(\.r1MaxMeasures), in: 1...100)
                doubleRow("Max systems before offering a split", setting(\.r1MaxSystems), in: 0.5...8, step: 0.5)
            }
            Section("R2 · Join the seams") {
                Toggle("Offer to join adjacent Review passages", isOn: setting(\.r2Enabled)).praeludeToggleHaptic(store.state.ruleSettings.r2Enabled)
            }
            Section {
                Toggle("Grade the first attempt of the day", isOn: setting(\.r3Enabled)).praeludeToggleHaptic(store.state.ruleSettings.r3Enabled)
            } header: { Text("R3 · Cold attempt") } footer: { Text("Turning this off also stops R4 from updating a schedule, since R4 reads the grade R3 records.") }
            Section {
                Toggle("Reschedule on a cold grade", isOn: setting(\.r4Enabled)).praeludeToggleHaptic(store.state.ruleSettings.r4Enabled)
                intRow("Shaky review interval (days)", setting(\.r4ShakyIntervalDays), in: 1...60)
                cleanLadderRow
            } header: { Text("R4 · Spaced review") } footer: { Text("Clean climbs this ladder; Shaky reschedules soon without losing ladder position; Missed restarts it.") }
            Section("R5 · Streak goal") {
                Toggle("Set the clean-streak target by learning state", isOn: setting(\.r5Enabled)).praeludeToggleHaptic(store.state.ruleSettings.r5Enabled)
                intRow("Learning streak target", setting(\.r5LearningStreak), in: 1...50)
                intRow("Review streak target", setting(\.r5ReviewStreak), in: 1...50)
            }
            Section {
                Toggle("Offer (and apply) a slower tempo after resets", isOn: setting(\.r6Enabled)).praeludeToggleHaptic(store.state.ruleSettings.r6Enabled)
                intRow("Resets in a row before stepping down", setting(\.r6ResetsBeforeStepDown), in: 1...10)
                doubleRow("Percent-ladder step down (%)", setting(\.r6StepDownPercent), in: 1...50, step: 1)
            } header: { Text("R6 · Slow down") } footer: { Text("Only fires when each of those resets peaked under half its own goal.") }
            Section {
                Toggle("Offer a faster tempo after a finished set", isOn: setting(\.r7Enabled)).praeludeToggleHaptic(store.state.ruleSettings.r7Enabled)
                intRow("Max applied increases per passage per day", setting(\.r7MaxIncreasesPerDay), in: 0...10)
            } header: { Text("R7 · Speed up") } footer: { Text("Requires a performance tempo on the passage (Passage details).") }
            Section("R8 · Split weak spot") {
                Toggle("Offer a split after clustered break-point taps", isOn: setting(\.r8Enabled)).praeludeToggleHaptic(store.state.ruleSettings.r8Enabled)
                intRow("Taps before offering a split", setting(\.r8TapsToOfferSplit), in: 1...10)
                doubleRow("Cluster radius", setting(\.r8ClusterRadius), in: 0.01...0.3, step: 0.01)
            }
            Section("R9 · Stop grinding") {
                Toggle("Park a passage after time or sets without progress", isOn: setting(\.r9Enabled)).praeludeToggleHaptic(store.state.ruleSettings.r9Enabled)
                intRow("Minutes on one passage before parking", setting(\.r9Minutes), in: 1...180)
                intRow("Sets without progress before parking", setting(\.r9Sets), in: 1...10)
            }
            Section {
                Toggle("Track performance-readiness", isOn: setting(\.r10Enabled)).praeludeToggleHaptic(store.state.ruleSettings.r10Enabled)
                intRow("Distinct clean-at-tempo days required", setting(\.r10DistinctDays), in: 1...14)
                Toggle("Require one to be the day's first attempt", isOn: setting(\.r10RequiresFirstInSession)).praeludeToggleHaptic(store.state.ruleSettings.r10RequiresFirstInSession)
            } header: { Text("R10 · Performance-ready") } footer: { Text("Requires a performance tempo on the passage (Passage details).") }
            Section {
                Toggle("Cap review intervals as a performance nears", isOn: setting(\.r11Enabled)).praeludeToggleHaptic(store.state.ruleSettings.r11Enabled)
                intRow("Final week (days out)", setting(\.r11FinalWeekDays), in: 1...30)
                intRow("Final two weeks (days out)", setting(\.r11FinalTwoWeeksDays), in: 1...60)
            } header: { Text("R11 · Performance date") } footer: { Text("Add performance dates on the piece to use this.") }
            Section("R12 · Variants when stuck") {
                Toggle("Suggest a variant chain after repeated slow-downs", isOn: setting(\.r12Enabled)).praeludeToggleHaptic(store.state.ruleSettings.r12Enabled)
                intRow("Applied slow-downs today before suggesting", setting(\.r12SlowDownsPerDay), in: 1...10)
            }
            Section("R13 · Parts separately") {
                Toggle("Suggest a part alone after consecutive Missed", isOn: setting(\.r13Enabled)).praeludeToggleHaptic(store.state.ruleSettings.r13Enabled)
                intRow("Consecutive missed cold attempts", setting(\.r13ConsecutiveMissed), in: 1...10)
            }
            Section("R14 · Pulse check") {
                Toggle("Drop the metronome out near performance tempo", isOn: setting(\.r14Enabled)).praeludeToggleHaptic(store.state.ruleSettings.r14Enabled)
                intRow("Silent bars", setting(\.r14DropoutBars), in: 1...16)
            }
            Section("R15 · Session builder") {
                Toggle("Build Today's session automatically", isOn: setting(\.r15Enabled)).praeludeToggleHaptic(store.state.ruleSettings.r15Enabled)
                intRow("Max new passages per session", setting(\.r15MaxNewPerSession), in: 0...20)
                intRow("Minutes budgeted per item", setting(\.r15EstimatedMinutesPerItem), in: 1...60)
            }
            if let errorMessage { Section { ErrorMessage(message: errorMessage) } }
            Section {
                Button("Restore rule defaults", role: .destructive) { apply(RuleSettings()) }
            }
        }
        .scrollContentBackground(.hidden)
        .background(PraeludeColor.paper)
        .navigationTitle("Practice rules")
        .navigationBarTitleDisplayMode(.inline)
    }

    /// R4's own ladder (`r4CleanIntervalsDays`) is a variable-length list, not a single number —
    /// edited here as plain comma-separated days rather than a full add/remove/reorder list editor,
    /// which the rule's five-figure default doesn't need.
    private var cleanLadderRow: some View {
        let binding = Binding<String>(
            get: { store.state.ruleSettings.r4CleanIntervalsDays.map(String.init).joined(separator: ", ") },
            set: { text in
                let days = text.split(separator: ",").compactMap { Int($0.trimmingCharacters(in: .whitespaces)) }.filter { $0 > 0 }
                guard !days.isEmpty else { return }
                apply { $0.r4CleanIntervalsDays = days.sorted() }
            })
        return VStack(alignment: .leading, spacing: 4) {
            Text("Clean review ladder (days)").font(.subheadline)
            TextField("1, 3, 7, 14, 30", text: binding).keyboardType(.numbersAndPunctuation)
        }
    }

    private func intRow(_ title: String, _ value: Binding<Int>, in range: ClosedRange<Int>) -> some View {
        Stepper(value: value, in: range) {
            HStack {
                Text(title)
                Spacer()
                Text("\(value.wrappedValue)").font(.subheadline.monospacedDigit()).foregroundStyle(.secondary)
            }
        }
    }

    private func doubleRow(_ title: String, _ value: Binding<Double>, in range: ClosedRange<Double>, step: Double) -> some View {
        Stepper(value: value, in: range, step: step) {
            HStack {
                Text(title)
                Spacer()
                Text(String(format: value.wrappedValue == value.wrappedValue.rounded() ? "%.0f" : "%.2f", value.wrappedValue))
                    .font(.subheadline.monospacedDigit()).foregroundStyle(.secondary)
            }
        }
    }

    private func setting<Value>(_ keyPath: WritableKeyPath<RuleSettings, Value>) -> Binding<Value> {
        Binding(get: { store.state.ruleSettings[keyPath: keyPath] },
                set: { value in apply { $0[keyPath: keyPath] = value } })
    }

    private func apply(_ change: (inout RuleSettings) -> Void) {
        var updated = store.state.ruleSettings
        change(&updated)
        apply(updated)
    }

    private func apply(_ settings: RuleSettings) {
        do { try store.updateRuleSettings(settings); errorMessage = nil }
        catch { errorMessage = error.localizedDescription }
    }
}
