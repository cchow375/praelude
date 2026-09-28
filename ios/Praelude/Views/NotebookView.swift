import SwiftUI

private extension NotebookEntryKind {
    var title: String {
        switch self { case .daily: return "Daily note"; case .lessonNote: return "Lesson note"; case .lessonPrep: return "Lesson prep" }
    }
    var symbol: String {
        switch self { case .daily: return "text.book.closed"; case .lessonNote: return "person.fill"; case .lessonPrep: return "checklist" }
    }
}

/// §15: daily notes per piece, lesson notes, a lesson-prep passage list, and a "Post as Note" hook
/// the social track (§5a) fills in later — see `NotebookPostHook`.
struct NotebookView: View {
    @Environment(PracticeStore.self) private var store
    @Environment(\.notebookPostHook) private var postHook
    @State private var filter: NotebookEntryKind?
    @State private var sheetEntry: NotebookEntry?
    @State private var postingID: UUID?
    @State private var errorMessage: String?

    private var entries: [NotebookEntry] {
        store.state.notebookEntries
            .filter { $0.deletedAt == nil && (filter == nil || $0.kind == filter) }
            .sorted { $0.date > $1.date }
    }

    var body: some View {
        List {
            if entries.isEmpty {
                PraeludeEmptyState(title: filter?.title ?? "No notes yet", symbol: "note.text",
                                  message: "Keep a daily note per piece, write down what a lesson covered, or build a passage list to prepare for one.",
                                  actionTitle: "New note", action: { sheetEntry = NotebookEntry(kind: filter ?? .daily) })
                    .listRowBackground(Color.clear).listRowSeparator(.hidden)
            } else {
                ForEach(entries) { entry in
                    Button { sheetEntry = entry } label: {
                        NotebookEntryRow(entry: entry, pieceTitle: pieceTitle(entry.pieceID),
                                          passageCount: entry.passageIDs.count,
                                          canPost: postHook != nil, isPosting: postingID == entry.id,
                                          onPost: { post(entry) })
                    }.buttonStyle(.plain)
                }
                .onDelete(perform: delete)
            }
            if let errorMessage { Section { ErrorMessage(message: errorMessage) } }
        }
        .scrollContentBackground(.hidden)
        .background(PraeludeColor.paper)
        .navigationTitle("Notebook")
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Menu {
                    Button("All notes") { filter = nil }
                    ForEach([NotebookEntryKind.daily, .lessonNote, .lessonPrep], id: \.self) { kind in
                        Button(kind.title, systemImage: kind.symbol) { filter = kind }
                    }
                } label: { Image(systemName: "line.3.horizontal.decrease.circle").frame(width: 44, height: 44) }
                .accessibilityLabel("Filter notes")
            }
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    ForEach([NotebookEntryKind.daily, .lessonNote, .lessonPrep], id: \.self) { kind in
                        Button(kind.title, systemImage: kind.symbol) { sheetEntry = NotebookEntry(kind: kind) }
                    }
                } label: { Image(systemName: "plus").frame(width: 44, height: 44) }
                .accessibilityLabel("New note").accessibilityIdentifier("newNotebookEntry")
            }
        }
        .sheet(item: $sheetEntry) { entry in
            NotebookEntryEditor(entry: entry, isNew: !store.state.notebookEntries.contains { $0.id == entry.id })
        }
    }

    private func pieceTitle(_ id: UUID?) -> String? {
        id.flatMap { pieceID in store.state.pieces.first { $0.id == pieceID }?.title }
    }

    private func delete(at offsets: IndexSet) {
        for index in offsets {
            do { try store.deleteNotebookEntry(entries[index].id) } catch { errorMessage = error.localizedDescription }
        }
    }

    private func post(_ entry: NotebookEntry) {
        guard let postHook, postingID == nil else { return }
        postingID = entry.id
        let summary = NotebookShareComposer.summary(for: entry, pieceTitle: pieceTitle(entry.pieceID))
        Task { @MainActor in
            defer { postingID = nil }
            do { try await postHook.post(entry, summary: summary) }
            catch { errorMessage = error.localizedDescription }
        }
    }
}

private struct NotebookEntryRow: View {
    let entry: NotebookEntry
    let pieceTitle: String?
    let passageCount: Int
    let canPost: Bool
    let isPosting: Bool
    let onPost: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Image(systemName: entry.kind.symbol).font(.subheadline).foregroundStyle(PraeludeColor.inkSecondary)
                Text(pieceTitle ?? entry.kind.title).font(.headline).lineLimit(1)
                Spacer(minLength: 8)
                Text(entry.date, format: .dateTime.month(.abbreviated).day()).font(.caption).foregroundStyle(.secondary)
            }
            if entry.kind == .lessonPrep {
                Text(passageCount == 0 ? "No passages added yet." : "\(passageCount) \(passageCount == 1 ? "passage" : "passages") to prepare.")
                    .font(.subheadline).foregroundStyle(.secondary)
            } else if !entry.text.isEmpty {
                Text(entry.text).font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
            } else {
                Text("Empty note.").font(.subheadline).foregroundStyle(PraeludeColor.inkTertiary)
            }
            if canPost {
                Button {
                    onPost()
                } label: {
                    if isPosting { SwiftUI.ProgressView().controlSize(.small) }
                    else { Label("Post as Note", systemImage: "square.and.arrow.up").font(.caption) }
                }
                .buttonStyle(.plain).foregroundStyle(PraeludeColor.ink).disabled(isPosting)
                .padding(.top, 2)
            }
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
    }
}

private struct NotebookEntryEditor: View {
    @Environment(PracticeStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var draft: NotebookEntry
    let isNew: Bool
    @State private var errorMessage: String?

    init(entry: NotebookEntry, isNew: Bool) {
        _draft = State(initialValue: entry)
        self.isNew = isNew
    }

    private var pieces: [Piece] { store.state.pieces.filter { $0.status != .resting }.sorted { $0.title < $1.title } }
    private var passagesForPiece: [Passage] {
        guard let pieceID = draft.pieceID else { return [] }
        return store.state.passages.filter { $0.pieceID == pieceID && !$0.archived }.sorted { $0.title < $1.title }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Note") {
                    Picker("Kind", selection: $draft.kind) {
                        Text("Daily note").tag(NotebookEntryKind.daily)
                        Text("Lesson note").tag(NotebookEntryKind.lessonNote)
                        Text("Lesson prep").tag(NotebookEntryKind.lessonPrep)
                    }
                    DatePicker("Date", selection: $draft.date, displayedComponents: .date)
                    Picker("Piece", selection: Binding(get: { draft.pieceID }, set: { draft.pieceID = $0; draft.passageIDs = [] })) {
                        Text("None").tag(UUID?.none)
                        ForEach(pieces) { Text($0.title).tag(Optional($0.id)) }
                    }
                }
                if draft.kind == .lessonPrep {
                    Section("Passages to cover") {
                        if draft.pieceID == nil {
                            Text("Choose a piece to list its passages.").foregroundStyle(.secondary)
                        } else if passagesForPiece.isEmpty {
                            Text("This piece has no passages marked yet.").foregroundStyle(.secondary)
                        } else {
                            ForEach(passagesForPiece) { passage in
                                Toggle(passage.title, isOn: Binding(
                                    get: { draft.passageIDs.contains(passage.id) },
                                    set: { include in
                                        if include { draft.passageIDs.append(passage.id) }
                                        else { draft.passageIDs.removeAll { $0 == passage.id } }
                                    }))
                            }
                        }
                    }
                }
                Section(draft.kind == .lessonPrep ? "Notes" : "What happened") {
                    TextField("Write here", text: $draft.text, axis: .vertical).lineLimit(5...14)
                }
                if let errorMessage { Section { ErrorMessage(message: errorMessage) } }
                if !isNew {
                    Section {
                        Button("Delete note", role: .destructive) { delete() }
                    }
                }
            }
            .navigationTitle(isNew ? "New note" : "Edit note")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("Save") { save() } }
            }
        }
        .presentationDetents([.large])
    }

    private func save() {
        do {
            draft.text = draft.text.trimmingCharacters(in: .whitespacesAndNewlines)
            draft.updatedAt = Date()
            try store.saveNotebookEntry(draft)
            dismiss()
        } catch { errorMessage = error.localizedDescription }
    }

    private func delete() {
        do { try store.deleteNotebookEntry(draft.id); dismiss() } catch { errorMessage = error.localizedDescription }
    }
}
