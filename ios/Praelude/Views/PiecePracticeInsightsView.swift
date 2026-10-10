import SwiftUI

/// Validated references are small finite BPM values. Keep fractional targets intact in labels
/// and edit drafts, so opening and saving the editor never changes a pianist's chosen value.
enum PracticeReferenceFormatting {
    static func bpm(_ value: Double) -> String {
        value == value.rounded() ? String(Int(value)) : String(value)
    }
}

/// A piece-specific view keeps unlike full-tempo references out of one global percentage.
struct PiecePracticeInsightsView: View {
    @Environment(PracticeStore.self) private var store
    let pieceID: UUID
    var sessionID: UUID? = nil
    @State private var recentOnly = true
    @State private var editingReference = false
    private var piece: Piece? { store.pieces.first { $0.id == pieceID } }
    private var summary: PracticeBalanceSummary {
        let start = sessionID == nil && recentOnly ? Calendar.current.date(byAdding: .day, value: -13, to: Calendar.current.startOfDay(for: Date())) : nil
        return PracticeBalance.summarize(pieceID: pieceID, state: store.state, since: start, through: Date(), sessionID: sessionID)
    }
    var body: some View {
        let summary = summary
        List {
            Section {
                Button { editingReference = true } label: {
                    LabeledContent("Full-tempo target", value: piece?.fullTempoBPM.map { "\(PracticeReferenceFormatting.bpm($0)) BPM" } ?? "Set a reference")
                }.accessibilityIdentifier("editFullTempoTarget")
                if let tempo = piece?.fullTempoBPM {
                    Text("Quarter tempo is \(tempo / 4, specifier: "%.1f") BPM. Use the same beat unit for the target and each attempt.")
                        .font(.caption).foregroundStyle(.secondary)
                    if tempo / 4 < 20 {
                        Text("The counter currently records 20–300 BPM. Exact quarter tempo is below that range for this target.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
            } footer: {
                Text("Full tempo is independent of the set's Start and Tempo goal. New sets capture this reference; changing it does not rewrite old sets.")
            }
            if sessionID == nil {
                Section {
                    Picker("Period", selection: $recentOnly) {
                        Text("Last 14 days").tag(true)
                        Text("All history").tag(false)
                    }.pickerStyle(.segmented)
                }
            }
            PracticeBalanceSections(summary: summary)
        }
        .navigationTitle(sessionID == nil ? (piece?.title ?? "Practice balance") : "Session balance")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $editingReference) { PiecePracticeReferenceEditor(pieceID: pieceID) }
    }
}

struct PracticeBalanceSections: View {
    let summary: PracticeBalanceSummary
    var body: some View {
        Section {
            LabeledContent("Recorded repetitions", value: "\(summary.repetitions)")
            LabeledContent("Sessions with repetitions", value: "\(summary.sessions)")
            LabeledContent("At or below 30% of full tempo", value: "\(summary.verySlowRepetitions) reps")
        } header: { Text("Recorded work") } footer: {
            Text("Counts effective self-reported repetitions, excluding Undo and Reset. This measures logged work, not playing accuracy or practice time by method.")
        }
        Section {
            ForEach(summary.hands) { row in breakdown(row) }
        } header: { Text("Hands") } footer: {
            if summary.legacyHandsRepetitions > 0 {
                Text("\(summary.legacyHandsRepetitions) older reps use their set's hand selection. Actual hands were not captured per repetition then.")
            }
        }
        Section {
            ForEach(summary.tempos) { row in breakdown(row) }
        } header: { Text("Tempo relative to full tempo") } footer: {
            VStack(alignment: .leading, spacing: 6) {
                Text("Around quarter tempo means 20–30%; work below 20% is shown separately. 50–60% is not grouped with quarter-tempo work.")
                if summary.currentReferenceRepetitions > 0 {
                    Text("\(summary.currentReferenceRepetitions) older reps had no saved full-tempo target. Their percentages use today's piece target and change if you edit it; their recorded BPM stays unchanged.")
                }
                if summary.missingTempoRepetitions > 0 { Text("\(summary.missingTempoRepetitions) reps have no full-tempo reference. Set one above to compare them explicitly with today's target.") }
            }
        }
        Section {
            if summary.variants.isEmpty { Text("No repetitions in this period.").foregroundStyle(.secondary) }
            ForEach(summary.variants) { row in breakdown(row) }
        } header: { Text("Practice variants") } footer: {
            Text("Uses the recorded stage name. No variant recorded means the log does not specify one; it does not prove you used no variation.")
        }
        Section {
            Text(summary.signal.title).font(.headline)
            ForEach(summary.checks) { check in
                VStack(alignment: .leading, spacing: 3) {
                    Text(check.title).font(.subheadline)
                    Text("\(check.actualPercent)% recorded · your minimum \(check.minimumPercent)% · \(check.hasCompleteAttribution ? (check.isMet ? "met" : "below minimum") : "attribution incomplete")")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            ForEach(summary.missingSignalReasons, id: \.self) { reason in
                Text(reason).font(.caption).foregroundStyle(.secondary)
            }
        } header: { Text("Suggested practice signal") } footer: {
            VStack(alignment: .leading, spacing: 7) {
                Text("Choose optional coverage minimums in Full-tempo target. Good = all your checks met; Middle = some; Bad = none. No chosen checks means no signal. These are your planning choices, not a judgment of your playing.")
                Text("The signal waits for at least 20 recorded reps across 2 sessions, with the fields needed by your checks present. This is a display guard, not a required practice dose. A single session still shows its counts.")
                Text("Project practice resources support deliberate hands-separate work, proportional slow tempos and purposeful variants. They do not establish a universal quota, ideal mix or automatic measure of musical quality.")
            }
        }
    }
    private func breakdown(_ row: PracticeBreakdown) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(row.title).font(.subheadline)
            Text("\(row.repetitions) reps · \(row.sessions) sessions").font(.caption.monospacedDigit()).foregroundStyle(.secondary)
        }.padding(.vertical, 2)
    }
}

private struct PiecePracticeReferenceEditor: View {
    @Environment(PracticeStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let pieceID: UUID
    @State private var tempo = ""
    @State private var plan = PracticeBalancePlan()
    @State private var errorMessage: String?
    private var parsedTempo: Double? { Double(tempo.trimmingCharacters(in: .whitespacesAndNewlines)) }
    private var valid: Bool {
        let empty = tempo.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        return (empty || parsedTempo.map { $0.isFinite && (20...300).contains($0) } == true) && plan.isValid
    }
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Full tempo · BPM", text: $tempo).keyboardType(.decimalPad)
                        .accessibilityIdentifier("fullTempoBPM")
                } footer: {
                    Text("Optional, 20–300 BPM. Match the beat unit used by your attempt tempo. Leave blank for unknown; the app does not infer this from the score or your playing.")
                }
                Section {
                    Stepper("Left hand: \(plan.leftHandPercent)%", value: $plan.leftHandPercent, in: 0...100, step: 5)
                    Stepper("Right hand: \(plan.rightHandPercent)%", value: $plan.rightHandPercent, in: 0...100, step: 5)
                    Stepper("At or below 30% tempo: \(plan.verySlowPercent)%", value: $plan.verySlowPercent, in: 0...100, step: 5)
                    Stepper("Named variant: \(plan.variantPercent)%", value: $plan.variantPercent, in: 0...100, step: 5)
                    if !plan.isValid { Text("Left- and right-hand minimums cannot total more than 100%.").foregroundStyle(.red) }
                } header: { Text("Your optional coverage minimums") } footer: {
                    Text("Minimum percentage of recorded repetitions. Zero turns a check off. All checks start off; choose only what suits this piece and your current aim. The app does not prescribe equal hands, a universal slow-practice dose or a quota of variants.")
                }
                Section {
                    Text("Full-tempo target and your coverage plan stay on this device and in its native backups. New set references and per-rep hands use the existing native sync JSON. Mac continuous history sync is unsupported; older clients can drop optional context when rewriting a set.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                if let errorMessage { Section { ErrorMessage(message: errorMessage) } }
            }
            .navigationTitle("Full tempo and coverage").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("Save", action: save).disabled(!valid).accessibilityIdentifier("saveFullTempoTarget") }
            }
            .onAppear {
                guard let piece = store.pieces.first(where: { $0.id == pieceID }) else { return }
                tempo = piece.fullTempoBPM.map(PracticeReferenceFormatting.bpm) ?? ""; plan = piece.practiceBalancePlan
            }
        }
    }
    private func save() {
        guard valid else { return }
        do { try store.setPracticeReference(parsedTempo, plan: plan, for: pieceID); dismiss() }
        catch { errorMessage = error.localizedDescription }
    }
}
