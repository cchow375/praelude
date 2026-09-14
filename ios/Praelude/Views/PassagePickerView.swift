import SwiftUI

struct PassagePickerView: View {
    @Environment(PracticeStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var editingPassage: Passage?
    @State private var showEditor = false
    @State private var pendingDelete: Passage?
    @State private var confirmDelete = false
    @State private var errorMessage: String?
    let pieceID: UUID
    let currentPage: Int
    let onSelect: (Passage) -> Void

    private var passages: [Passage] {
        store.state.passages.filter { $0.pieceID == pieceID }.sorted {
            $0.page == $1.page ? $0.startMeasure < $1.startMeasure : $0.page < $1.page
        }
    }

    private var pageCount: Int { max(1, store.pieces.first { $0.id == pieceID }?.pageCount ?? 1) }

    var body: some View {
        NavigationStack {
            List {
                if let errorMessage { ErrorMessage(message: errorMessage) }
                if passages.isEmpty {
                    PraeludeEmptyState(title: "No saved passages", symbol: "text.book.closed",
                                      message: "Save a measure range so you can return to it quickly.",
                                      actionTitle: "Add a passage", action: addPassage)
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                } else {
                    ForEach(passages) { passage in
                        Button {
                            onSelect(passage)
                            dismiss()
                        } label: {
                            VStack(alignment: .leading, spacing: 5) {
                                Text(passage.title).font(.headline).foregroundStyle(.primary)
                                Text("\(passage.measureLabel) · page \(passage.page)")
                                    .font(.subheadline).foregroundStyle(.secondary)
                                Text(passage.focus).font(.caption).foregroundStyle(.secondary)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.vertical, 6)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .contextMenu {
                            Button("Edit passage", systemImage: "pencil") { edit(passage) }
                            Button("Delete passage", systemImage: "trash", role: .destructive) {
                                pendingDelete = passage
                                confirmDelete = true
                            }
                        }
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            Button("Delete", systemImage: "trash", role: .destructive) {
                                pendingDelete = passage
                                confirmDelete = true
                            }
                            Button("Edit", systemImage: "pencil") { edit(passage) }.tint(.gray)
                        }
                    }
                }
            }
            .navigationTitle("Passages")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Add passage", systemImage: "plus", action: addPassage)
                }
            }
            .navigationDestination(isPresented: $showEditor) {
                if let editingPassage {
                    PassageEditorView(passage: editingPassage, pageCount: pageCount) {
                        showEditor = false
                    }
                }
            }
            .confirmationDialog("Delete passage?", isPresented: $confirmDelete,
                                titleVisibility: .visible, presenting: pendingDelete) { passage in
                Button("Delete passage", role: .destructive) { delete(passage) }
                Button("Cancel", role: .cancel) {}
            } message: { passage in
                Text("Remove “\(passage.title)” from your saved passages? Recorded practice stays in your history.")
            }
        }
    }

    private func addPassage() {
        editingPassage = Passage(pieceID: pieceID, title: "", page: min(pageCount, max(1, currentPage)))
        showEditor = true
    }

    private func edit(_ passage: Passage) {
        editingPassage = passage
        showEditor = true
    }

    private func delete(_ passage: Passage) {
        do {
            try store.deletePassage(passage.id)
            errorMessage = nil
        } catch { errorMessage = error.localizedDescription }
    }
}

private struct PassageEditorView: View {
    @Environment(PracticeStore.self) private var store
    @State private var draft: Passage
    @State private var firstMeasure: String
    @State private var lastMeasure: String
    @State private var page: String
    @State private var errorMessage: String?
    let pageCount: Int
    let onSaved: () -> Void

    init(passage: Passage, pageCount: Int, onSaved: @escaping () -> Void) {
        _draft = State(initialValue: passage)
        _firstMeasure = State(initialValue: String(passage.startMeasure))
        _lastMeasure = State(initialValue: String(passage.endMeasure))
        _page = State(initialValue: String(passage.page))
        self.pageCount = pageCount
        self.onSaved = onSaved
    }

    private var validRange: Bool {
        guard let first = Int(firstMeasure), let last = Int(lastMeasure), let pageNumber = Int(page) else { return false }
        return (1...100_000).contains(first) && (first...100_000).contains(last) &&
            (1...pageCount).contains(pageNumber) &&
            !draft.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && draft.title.count <= 500 &&
            !draft.focus.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && draft.focus.count <= 500
    }

    var body: some View {
        Form {
            Section("Passage") {
                TextField("Name, such as Opening phrase", text: $draft.title, axis: .vertical)
                PracticeFocusField(focus: $draft.focus)
            }
            Section("Measures") {
                LabeledContent("First measure") {
                    TextField("1", text: $firstMeasure).keyboardType(.numberPad)
                        .multilineTextAlignment(.trailing).frame(minWidth: 60)
                        .accessibilityLabel("First measure")
                }
                LabeledContent("Last measure") {
                    TextField("4", text: $lastMeasure).keyboardType(.numberPad)
                        .multilineTextAlignment(.trailing).frame(minWidth: 60)
                        .accessibilityLabel("Last measure")
                }
            }
            Section {
                LabeledContent("Score page") {
                    TextField("1", text: $page).keyboardType(.numberPad)
                        .multilineTextAlignment(.trailing).frame(minWidth: 60)
                        .accessibilityLabel("Score page")
                }
            } footer: {
                Text("Choose a page from 1 to \(pageCount). Measure numbers describe your target; you supply them.")
            }
            if let errorMessage { Section { ErrorMessage(message: errorMessage) } }
        }
        .navigationTitle("Passage details")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Save") { save() }.disabled(!validRange)
            }
        }
    }

    private func save() {
        guard validRange, let first = Int(firstMeasure), let last = Int(lastMeasure), let pageNumber = Int(page) else { return }
        do {
            draft.title = draft.title.trimmingCharacters(in: .whitespacesAndNewlines)
            draft.focus = draft.focus.trimmingCharacters(in: .whitespacesAndNewlines)
            draft.startMeasure = first
            draft.endMeasure = last
            draft.page = pageNumber
            try store.savePassage(draft)
            onSaved()
        } catch { errorMessage = error.localizedDescription }
    }
}
