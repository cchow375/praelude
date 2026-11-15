import SwiftUI

/// The queue is a readout of saved review dates and self-reported first attempts. Opening, skipping
/// or browsing it does not grade a passage or alter its schedule.
struct PassageReviewQueueView: View {
    @Environment(PracticeStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var editing: Passage?
    @State private var showingGuide = false
    var onStart: (UUID, UUID) -> Void

    private var context: RuleContext { RuleContext(state: store.state, now: Date()) }
    private var plan: TodayOverview.DailyPassagePlan { TodayOverview.dailyPlan(context: context) }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    if plan.items.isEmpty { Label("Today's passage work is clear", systemImage: "checkmark.circle").foregroundStyle(.secondary) }
                    rows(plan.items)
                } header: { Text("Next, in order") } footer: {
                    Text("Up to five passages. Work completed today leaves this list. A hard-won result comes back for a fresh check tomorrow.")
                }
                if !plan.completedToday.isEmpty {
                    DisclosureGroup("Worked today · \(plan.completedToday.count)") { rows(plan.completedToday) }
                }
                if !plan.tomorrow.isEmpty {
                    DisclosureGroup("Tomorrow · \(plan.tomorrow.count)") { rows(plan.tomorrow) }
                }
                if plan.laterCount > 0 {
                    Section {
                        Text("\(plan.laterCount) more in your passage library. They can wait; they are not added as you finish today's list.")
                            .font(.subheadline).foregroundStyle(.secondary)
                    }
                }
            }
            .accessibilityIdentifier("passageReviewQueue")
            .navigationTitle("Practice order").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("How reviews work", systemImage: "questionmark.circle") { showingGuide = true } }
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
            .sheet(item: $editing) { passage in PassageRenameView(passage: passage) }
            .sheet(isPresented: $showingGuide) {
                NavigationStack { List { ReviewRulesExplanation() }.navigationTitle("How reviews work")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { showingGuide = false } } } }
            }
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
    @Environment(PracticeStore.self) private var store
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var showingDetails = false
    let review: TodayOverview.DueReview
    let passage: Passage
    let pieceTitle: String
    let onStart: () -> Void
    let onEdit: () -> Void

    var body: some View {
        (dynamicTypeSize.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8)) : AnyLayout(HStackLayout(alignment: .center, spacing: 10))) {
            Button { showingDetails = true } label: {
                PassageCardArtwork(passage: passage, piece: store.pieces.first { $0.id == passage.pieceID })
                    .frame(width: 68, height: 56).clipped()
            }.buttonStyle(.plain).accessibilityLabel("See review details for \(passage.title)")
                VStack(alignment: .leading, spacing: 3) {
                    Text(review.label).font(.caption.weight(.semibold)).foregroundStyle(PraeludeColor.inkSecondary)
                        .accessibilityIdentifier("reviewPriority_\(passage.id)")
                    Text(passage.title).font(.subheadline.weight(.medium)).lineLimit(2)
                        .onTapGesture(count: 2, perform: onEdit)
                        .accessibilityAction(named: "Edit name and goal tempo", onEdit)
                    Text("\(pieceTitle) · \(ScoreOrganization.locationLabel(for: passage, in: store.pieces.first { $0.id == passage.pieceID }))")
                        .font(.caption).foregroundStyle(.secondary).lineLimit(2)
                    Text(review.reason).font(.caption).foregroundStyle(.secondary).lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 2)
                }.frame(maxWidth: .infinity, alignment: .leading)
                Button(action: onStart) { Image(systemName: "play.fill").frame(width: 44, height: 44).contentShape(Rectangle()) }
                    .buttonStyle(.plain).accessibilityLabel("Practice \(passage.title)")
                    .accessibilityIdentifier("reviewPassage_\(passage.id)")
        }.padding(.vertical, 4)
        .accessibilityElement(children: .contain)
        .contextMenu {
            Button("Review date & first-attempt history", systemImage: "clock.arrow.circlepath") { showingDetails = true }
            Button("Name & goal tempo", systemImage: "pencil", action: onEdit)
        }
        .sheet(isPresented: $showingDetails) { PassageReviewDetailsView(passageID: passage.id) }
    }
}
