import SwiftUI

/// A readable explanation of the saved review contract, beside the actual passage image.
/// Browsing this screen never creates a grade or changes a review date.
struct PassageReviewDetailsView: View {
    @Environment(PracticeStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let passageID: UUID
    @State private var error: String?
    private var passage: Passage? { store.state.passages.first { $0.id == passageID && $0.deletedAt == nil } }

    var body: some View {
        NavigationStack {
            List {
                if let passage {
                    Section {
                        PassageCardArtwork(passage: passage, piece: store.pieces.first { $0.id == passage.pieceID })
                            .frame(height: 180).listRowInsets(EdgeInsets())
                        Text(passage.title).font(.headline)
                        if !passage.focus.isEmpty { Label(passage.focus, systemImage: "scope") }
                        if let tempo = passage.performanceTempo {
                            LabeledContent("Full tempo goal", value: "\(PracticeReferenceFormatting.bpm(tempo)) BPM")
                        }
                    }
                    Section("Your next review") {
                        if let due = passage.schedule.dueDate {
                            LabeledContent("Saved date", value: due.formatted(date: .abbreviated, time: .omitted))
                            LabeledContent("Last chosen interval", value: PracticeRulesEngine.pluralize(passage.schedule.intervalDays, "day"))
                        } else {
                            Text("No review date yet. Record your first attempt to begin the review ladder, or practice without grading.")
                        }
                        let eligible = PracticeRulesEngine.isColdAttemptEligible(passageID: passageID, context: RuleContext(state: store.state, now: .now))
                        Text(!store.state.ruleSettings.r3Enabled ? "First-attempt grading is off. You can still practice this passage." : eligible ? "Your next first attempt today can be graded." : "You already graded today's first attempt. More practice today does not advance the review ladder again.")
                            .font(.subheadline).foregroundStyle(.secondary)
                        if passage.parkedUntil.map({ $0 > .now }) == true {
                            Text("Hidden until \(passage.parkedUntil!.formatted(date: .abbreviated, time: .omitted)). Your saved review date is unchanged.")
                                .font(.caption).foregroundStyle(.secondary)
                            Button("Show in reviews today") { park(passage, until: nil) }
                        } else {
                            Button("Hide from reviews until tomorrow", systemImage: "moon") {
                                park(passage, until: Calendar.current.date(byAdding: .day, value: 1, to: Calendar.current.startOfDay(for: .now)))
                            }
                        }
                    }
                    Section("First-attempt history") {
                        let grades = store.state.coldGrades.filter { $0.passageID == passageID }.sorted { $0.date > $1.date }
                        if grades.isEmpty { Text("No first-attempt grades saved.").foregroundStyle(.secondary) }
                        ForEach(Array(grades.prefix(12))) { grade in
                            HStack {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(grade.grade.label).font(.headline)
                                    Text(grade.date, format: .dateTime.month(.abbreviated).day().year())
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer()
                                Text("\(PracticeReferenceFormatting.bpm(grade.tempo)) BPM").monospacedDigit()
                            }.accessibilityElement(children: .combine)
                        }
                    }
                    ReviewRulesExplanation()
                } else { ContentUnavailableView("Passage unavailable", systemImage: "rectangle.stack") }
                if let error { ErrorMessage(message: error) }
            }
            .accessibilityIdentifier("passageReviewDetailList")
            .navigationTitle("Review details").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }

    private func park(_ passage: Passage, until: Date?) {
        var edited = passage
        edited.parkedUntil = until; edited.updatedAt = .now
        do { try store.savePassage(edited, replacing: passage); error = nil }
        catch { self.error = error.localizedDescription }
    }
}

struct ReviewRulesExplanation: View {
    @Environment(PracticeStore.self) private var store
    var body: some View {
        let rules = store.state.ruleSettings
        Section("How reviews work") {
            Text("1. Look at the passage image, then play a first attempt before working on it.")
            Text("2. You choose Clean, Shaky or Missed. The app never listens to judge your playing.")
            if rules.r3Enabled && rules.r4Enabled {
                Text("3. Clean moves through your review ladder: \(rules.r4CleanIntervalsDays.sorted().map(String.init).joined(separator: " → ")) days. Shaky returns in \(PracticeRulesEngine.pluralize(max(1, rules.r4ShakyIntervalDays), "day")). Missed returns tomorrow and restarts the ladder.")
            } else {
                Text(rules.r3Enabled ? "Automatic review scheduling is off in Rules. Grades do not move your saved review date." : "First-attempt grading is off in Rules. Practice does not move your saved review date.")
            }
            Text("Only the first grade per passage each day changes the ladder. Ordinary reps build your set; opening, skipping and ungraded practice never grade a card.")
            if rules.r11Enabled { Text("An approaching performance can shorten intervals. During performance week every active passage is shown for review.") }
            Text("Overdue means a saved date has passed. It is a reminder, never an automatic Missed grade.")
        }.font(.subheadline)
    }
}
