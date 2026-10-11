import SwiftUI

/// The queue is a readout of saved review dates and self-reported first attempts. Opening, skipping
/// or browsing it does not grade a passage or alter its schedule.
struct PassageReviewQueueView: View {
    @Environment(PracticeStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var editing: Passage?
    var onStart: (UUID, UUID) -> Void

    private var context: RuleContext { RuleContext(state: store.state, now: Date()) }
    private var due: [TodayOverview.DueReview] { TodayOverview.dueReviews(context: context) }
    private var upcomingTough: [TodayOverview.DueReview] {
        TodayOverview.toughPassages(context: context).filter { !$0.isDue }
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    if due.isEmpty { Text("No reviews due.").foregroundStyle(.secondary) }
                    rows(due)
                } header: { Text("Due & overdue") } footer: {
                    Text("URGENT means an overdue date, or a due passage whose latest first attempt you marked Missed or Shaky. Being late is not a playing failure. Starting a review is your choice.")
                }
                if !upcomingTough.isEmpty {
                    Section {
                        rows(upcomingTough)
                    } header: { Text("Tough passages · Upcoming") } footer: {
                        Text("Based on your latest Missed or Shaky first attempt. Their saved due dates have not been brought forward. A later Clean first attempt clears this label.")
                    }
                }
            }
            .navigationTitle("Passage reviews").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .sheet(item: $editing) { passage in PassageRenameView(passage: passage) }
        }
    }

    private func rows(_ values: [TodayOverview.DueReview]) -> some View {
        ForEach(values) { review in
            if let passage = store.state.passages.first(where: { $0.id == review.passageID }) {
                PassageReviewRow(review: review, passage: passage,
                                 pieceTitle: store.pieces.first { $0.id == review.pieceID }?.title ?? "Piece",
                                 onStart: { dismiss(); onStart(review.pieceID, review.passageID) },
                                 onEdit: { editing = passage })
            }
        }
    }
}

struct PassageReviewRow: View {
    let review: TodayOverview.DueReview
    let passage: Passage
    let pieceTitle: String
    let onStart: () -> Void
    let onEdit: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(review.label).font(.caption.weight(.bold))
                .foregroundStyle(review.isUrgent ? Color.orange : PraeludeColor.inkSecondary)
                .accessibilityIdentifier("reviewPriority_\(passage.id)")
            HStack(alignment: .top, spacing: 8) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(passage.title).font(.headline)
                        .onTapGesture(count: 2, perform: onEdit)
                        .accessibilityAction(named: "Edit name and goal tempo", onEdit)
                    Text(pieceTitle).font(.caption).foregroundStyle(.secondary)
                    if let tempo = passage.performanceTempo {
                        Text("Goal \(PracticeReferenceFormatting.bpm(tempo)) BPM").font(.caption).foregroundStyle(.secondary)
                    }
                }.frame(maxWidth: .infinity, alignment: .leading)
                Button("Edit", systemImage: "pencil", action: onEdit)
                    .labelStyle(.iconOnly).frame(minWidth: 44, minHeight: 44)
                    .accessibilityLabel("Edit name and goal for \(passage.title)")
                Button("Review", action: onStart).font(.subheadline.weight(.semibold))
                    .frame(minHeight: 44)
                    .accessibilityIdentifier("reviewPassage_\(passage.id)")
            }
            Text(review.reason).font(.caption).foregroundStyle(.secondary)
            if let grade = review.latestColdGrade {
                Text(grade.date, format: .dateTime.month(.abbreviated).day())
                    .font(.caption2).foregroundStyle(.secondary)
            }
            if let date = review.dueDate {
                Text("Scheduled \(date.formatted(date: .abbreviated, time: .omitted))")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }.padding(.vertical, 4)
        .accessibilityElement(children: .contain)
    }
}
