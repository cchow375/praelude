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
                        if let piece = store.pieces.first(where: { $0.id == passage.pieceID }) {
                            Text("\(piece.title) · \(ScoreOrganization.locationLabel(for: passage, in: piece))")
                                .font(.subheadline).foregroundStyle(.secondary)
                        }
                        if !passage.focus.isEmpty { Label(passage.focus, systemImage: "scope") }
                        if let tempo = passage.performanceTempo ?? store.pieces.first(where: { $0.id == passage.pieceID })?.fullTempoBPM {
                            LabeledContent("Target tempo", value: "\(PracticeReferenceFormatting.bpm(tempo)) BPM")
                        }
                    }
                    Section("Your next review") {
                        let context = RuleContext(state: store.state, now: .now)
                        let plan = TodayOverview.dailyPlan(context: context)
                        if let item = (plan.items + plan.completedToday + plan.tomorrow).first(where: { $0.passageID == passage.id }) {
                            Text(item.label).font(.subheadline.weight(.semibold))
                            Text(item.reason).font(.subheadline).foregroundStyle(.secondary)
                            if let next = item.nextActionDate { LabeledContent("Next action", value: next.formatted(date: .abbreviated, time: .omitted)) }
                        }
                        if let due = passage.schedule.dueDate {
                            LabeledContent("Saved check date", value: due.formatted(date: .abbreviated, time: .omitted))
                                .accessibilityIdentifier("savedReviewDate")
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
            Text("1. Today puts up to five passages in order. A hard-won passage comes first for a fresh check; older work stays in your library.")
            Text("2. You choose Clean, Shaky or Missed. The app never listens to judge your playing.")
            if rules.r3Enabled && rules.r4Enabled {
                Text("3. A clean first attempt at target earns a longer gap: \(rules.r4CleanIntervalsDays.sorted().map(String.init).joined(separator: " → ")) days. A clean attempt below target returns tomorrow without advancing that ladder. Shaky or a recovery check starts again at the shortest interval, so one good day cannot restore an old long gap.")
            } else {
                Text(rules.r3Enabled ? "Automatic review scheduling is off in Rules. Grades do not move your saved review date." : "First-attempt grading is off in Rules. Practice does not move your saved review date.")
            }
            Text("4. Finish a set to clear that passage from today's work. Getting it right after practice earns a check tomorrow, rather than a claim that it is secure. Only a fresh first attempt can earn a longer gap.")
            Text("Opening a passage or undoing a rep never invents a successful check. Finished slow work counts as work, not mastery. You can always choose another passage or pause.")
            if rules.r11Enabled { Text("An approaching performance can shorten intervals. Today's completed work still clears during performance week.") }
            Text("An old date does not mean failure or create extra repetitions. Your whole library stays available, grouped by piece.")
        }.font(.subheadline)
    }
}
