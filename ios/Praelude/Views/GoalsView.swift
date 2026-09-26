import SwiftUI

struct PracticeGoalsView: View {
    @Environment(PracticeStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var editingGoal: PracticeGoal?
    @State private var showEditor = false
    @State private var showCompleted = false
    @State private var pendingDelete: PracticeGoal?
    @State private var confirmDelete = false
    @State private var errorMessage: String?

    private var openGoals: [PracticeGoal] {
        store.state.goals.filter { !$0.isComplete }.sorted {
            ($0.dueDate ?? .distantFuture) < ($1.dueDate ?? .distantFuture)
        }
    }

    private var completedGoals: [PracticeGoal] { store.state.goals.filter(\.isComplete) }

    var body: some View {
        NavigationStack {
            List {
                if let errorMessage { ErrorMessage(message: errorMessage) }
                if store.state.goals.isEmpty {
                    PraeludeEmptyState(title: "No goals yet", symbol: "checklist",
                                      message: "Add an optional goal for a piece or for your practice.",
                                      actionTitle: "Add a goal", action: add)
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                } else {
                    Section("To return to") {
                        if openGoals.isEmpty {
                            Label("All your goals are checked off", systemImage: "checkmark.circle")
                                .foregroundStyle(.secondary)
                        }
                        ForEach(openGoals) { goal in goalRow(goal) }
                    }
                    if !completedGoals.isEmpty {
                        Section {
                            DisclosureGroup("Completed (\(completedGoals.count))", isExpanded: $showCompleted) {
                                ForEach(completedGoals) { goal in goalRow(goal) }
                            }
                        }
                    }
                }
            }
            .navigationTitle("Goals")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Add goal", systemImage: "plus", action: add)
                }
            }
            .navigationDestination(isPresented: $showEditor) {
                if let editingGoal {
                    GoalEditorView(goal: editingGoal) { showEditor = false }
                }
            }
            .confirmationDialog("Delete goal?", isPresented: $confirmDelete,
                                titleVisibility: .visible, presenting: pendingDelete) { goal in
                Button("Delete goal", role: .destructive) {
                    do { try store.deleteGoal(goal.id); errorMessage = nil }
                    catch { errorMessage = error.localizedDescription }
                }
                Button("Cancel", role: .cancel) {}
            } message: { goal in
                Text("Remove “\(goal.title)” from your goals?")
            }
        }
    }

    private func goalRow(_ goal: PracticeGoal) -> some View {
        HStack(alignment: .center, spacing: 10) {
            Button {
                var updated = goal
                updated.isComplete.toggle()
                do { try store.saveGoal(updated); errorMessage = nil }
                catch { errorMessage = error.localizedDescription }
            } label: {
                Image(systemName: goal.isComplete ? "checkmark.circle.fill" : "circle")
                    .font(.title2).frame(minWidth: 44, minHeight: 44)
            }
            .buttonStyle(.borderless)
            .accessibilityLabel(goal.isComplete ? "Reopen \(goal.title)" : "Complete \(goal.title)")

            Button { edit(goal) } label: {
                VStack(alignment: .leading, spacing: 5) {
                    Text(goal.title).foregroundStyle(goal.isComplete ? .secondary : .primary)
                        .strikethrough(goal.isComplete)
                    if let pieceID = goal.pieceID, let piece = store.pieces.first(where: { $0.id == pieceID }) {
                        Text(piece.title).font(.caption).foregroundStyle(.secondary)
                    }
                    if let due = goal.dueDate {
                        Text(due, format: .dateTime.month(.abbreviated).day())
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 6)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            Button("Delete", systemImage: "trash", role: .destructive) {
                pendingDelete = goal
                confirmDelete = true
            }
        }
    }

    private func add() { edit(PracticeGoal(title: "")) }
    private func edit(_ goal: PracticeGoal) { editingGoal = goal; showEditor = true }
}

private struct GoalEditorView: View {
    @Environment(PracticeStore.self) private var store
    @State private var draft: PracticeGoal
    @State private var hasDate: Bool
    @State private var date: Date
    @State private var errorMessage: String?
    let onSaved: () -> Void

    init(goal: PracticeGoal, onSaved: @escaping () -> Void) {
        _draft = State(initialValue: goal)
        _hasDate = State(initialValue: goal.dueDate != nil)
        _date = State(initialValue: goal.dueDate ?? .now)
        self.onSaved = onSaved
    }

    var body: some View {
        Form {
            Section("Your goal") {
                TextField("What would you like to work toward?", text: $draft.title, axis: .vertical)
                    .lineLimit(3...6)
            }
            Section {
                Picker("Piece", selection: $draft.pieceID) {
                    Text("Any piece").tag(UUID?.none)
                    ForEach(store.pieces) { piece in
                        Text(piece.title).tag(Optional(piece.id))
                    }
                }
                Toggle("Set a date", isOn: $hasDate).praeludeToggleHaptic(hasDate)
                if hasDate {
                    DatePicker("Return to it", selection: $date, displayedComponents: .date)
                }
            }
            if let errorMessage { Section { ErrorMessage(message: errorMessage) } }
        }
        .navigationTitle("Goal details")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Save") { save() }
                    .disabled(draft.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || draft.title.count > 500)
            }
        }
    }

    private func save() {
        do {
            draft.title = draft.title.trimmingCharacters(in: .whitespacesAndNewlines)
            draft.dueDate = hasDate ? date : nil
            try store.saveGoal(draft)
            onSaved()
        } catch { errorMessage = error.localizedDescription }
    }
}
