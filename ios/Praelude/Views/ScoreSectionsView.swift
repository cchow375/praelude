import SwiftUI

/// Organization changes labels/jumps rather than splitting the PDF or relocating existing ink.
struct ScoreSectionsView: View {
    @Environment(PracticeStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let pieceID: UUID
    var onOpenPage: ((Int) -> Void)? = nil
    @State private var editing: ScoreSection?
    @State private var suggestions: [ScoreSection] = []
    @State private var scanning = false
    @State private var scanTask: Task<Void, Never>?
    @State private var errorMessage: String?
    private var piece: Piece? { store.pieces.first { $0.id == pieceID } }
    private var sections: [ScoreSection] { piece?.scoreSections.sorted { $0.startPage < $1.startPage } ?? [] }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text("Divide a sonata into movements or a book into pieces. Each appears separately in Pieces and opens at its own page 1. Your pencil marks and practice history stay in place.")
                        .font(.subheadline).foregroundStyle(.secondary)
                    Button("Add movement or piece", systemImage: "plus") {
                        let start = min(piece?.pageCount ?? 1, (sections.last?.endPage ?? 0) + 1)
                        editing = ScoreSection(title: "", startPage: max(1, start), endPage: max(1, piece?.pageCount ?? 1))
                    }.disabled((piece?.pageCount ?? 0) == 0)
                    Button { scanTask = Task { await scan() } } label: {
                        Label(scanning ? "Reading PDF contents…" : "Find sections from PDF contents", systemImage: "list.bullet.rectangle")
                    }.disabled(scanning || (piece?.pageCount ?? 0) == 0)
                } footer: { Text("PDF contents/bookmarks are suggestions. Review page boundaries before adding them; scanned books may have no contents data.") }
                if let errorMessage { Section { ErrorMessage(message: errorMessage) } }
                if !suggestions.isEmpty {
                    Section("Review detected sections") {
                        ForEach(suggestions) { section in
                            Button { editing = section } label: { sectionRow(section) }
                        }
                        Button("Dismiss suggestions") { suggestions = [] }
                    }
                }
                Section("Movements and pieces") {
                    if sections.isEmpty { Text("No sections yet").foregroundStyle(.secondary) }
                    ForEach(sections) { section in
                        Button {
                            if let onOpenPage { onOpenPage(section.startPage); dismiss() }
                            else { editing = section }
                        } label: { sectionRow(section) }
                            .contextMenu { Button("Edit page range", systemImage: "pencil") { editing = section } }
                            .swipeActions(allowsFullSwipe: false) {
                                Button("Delete", role: .destructive) { remove(section) }
                                Button("Edit") { editing = section }.tint(PraeludeColor.inkSecondary)
                            }
                    }
                }
            }
            .navigationTitle("Movements & pieces").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } } }
            .sheet(item: $editing) { section in
                ScoreSectionEditor(section: section, pageCount: max(1, piece?.pageCount ?? 1)) { updated in
                    var values = sections.filter { $0.id != updated.id }; values.append(updated)
                    try store.setScoreSections(values.sorted { $0.startPage < $1.startPage }, for: pieceID)
                    suggestions.removeAll { $0.id == updated.id }
                }
            }
        }
        .onDisappear { scanTask?.cancel() }
    }
    private func sectionRow(_ section: ScoreSection) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(section.title).foregroundStyle(.primary)
            Text("PDF pages \(section.startPage)–\(section.endPage) · \(section.endPage - section.startPage + 1) pages")
                .font(.caption).foregroundStyle(.secondary)
        }.frame(minHeight: 44, alignment: .leading)
    }
    private func remove(_ section: ScoreSection) {
        do { try store.setScoreSections(sections.filter { $0.id != section.id }, for: pieceID) }
        catch { errorMessage = error.localizedDescription }
    }
    private func scan() async {
        guard let piece, let url = NativeLibraryFiles(store: store).scoreURL(for: piece) else { return }
        scanning = true; defer { scanning = false }
        let found = await ScoreOrganizationScanner.sections(url: url)
        guard !Task.isCancelled, self.piece?.pdfFileName == piece.pdfFileName else { return }
        suggestions = found
        if suggestions.isEmpty { errorMessage = "This PDF has no usable contents bookmarks. Add page ranges manually." }
        else { errorMessage = nil }
    }
}

private struct ScoreSectionEditor: View {
    @Environment(\.dismiss) private var dismiss
    @State var section: ScoreSection
    let pageCount: Int
    let onSave: (ScoreSection) throws -> Void
    @State private var errorMessage: String?
    @State private var firstPageText: String
    @State private var lastPageText: String
    @FocusState private var nameFocused: Bool

    init(section: ScoreSection, pageCount: Int, onSave: @escaping (ScoreSection) throws -> Void) {
        _section = State(initialValue: section)
        _firstPageText = State(initialValue: String(section.startPage))
        _lastPageText = State(initialValue: String(section.endPage))
        self.pageCount = pageCount
        self.onSave = onSave
    }

    private var firstPage: Int? { Int(firstPageText) }
    private var lastPage: Int? { Int(lastPageText) }
    private var validPages: Bool {
        guard let firstPage, let lastPage else { return false }
        return firstPage >= 1 && lastPage >= firstPage && lastPage <= pageCount
    }
    var body: some View {
        NavigationStack {
            Form {
                TextField("Movement or piece name", text: $section.title).focused($nameFocused)
                    .frame(minHeight: 44)
                    .accessibilityIdentifier("movementName")
                pageControl("First PDF page", text: $firstPageText, identifier: "movementFirstPage")
                pageControl("Last PDF page", text: $lastPageText, identifier: "movementLastPage")
                Text("Choose pages 1–\(pageCount) of the PDF.").font(.caption).foregroundStyle(.secondary)
                if let firstPage, let lastPage, lastPage < firstPage {
                    Text("The last page must be on or after the first.").font(.caption).foregroundStyle(.red)
                }
                Text("Page numbers restart at 1 within this section. Source PDF page numbers are preserved for pencil marks and practice records.")
                    .font(.subheadline).foregroundStyle(.secondary)
                if let errorMessage { ErrorMessage(message: errorMessage) }
            }
            .task { nameFocused = section.title.isEmpty }
            .navigationTitle("Movement").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        guard validPages, let firstPage, let lastPage else { return }
                        section.title = section.title.trimmingCharacters(in: .whitespacesAndNewlines)
                        section.startPage = firstPage; section.endPage = lastPage
                        do { try onSave(section); dismiss() } catch { errorMessage = error.localizedDescription }
                    }.disabled(section.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !validPages)
                }
            }
        }
    }

    private func pageControl(_ title: String, text: Binding<String>, identifier: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.subheadline)
            HStack(spacing: 12) {
                SelectAllNumberField(text: text, placeholder: "1–\(pageCount)",
                                     accessibilityLabel: title, accessibilityIdentifier: identifier)
                    .padding(.horizontal, 12).frame(maxWidth: .infinity, minHeight: 44)
                    .background(.quaternary, in: RoundedRectangle(cornerRadius: 8))
                Stepper(title, onIncrement: {
                    let limit = max(1, pageCount)
                    let current = min(limit, max(1, Int(text.wrappedValue) ?? 1))
                    text.wrappedValue = String(current < limit ? current + 1 : current)
                }, onDecrement: {
                    let current = min(max(1, pageCount), max(1, Int(text.wrappedValue) ?? 1))
                    text.wrappedValue = String(max(1, current - 1))
                }).labelsHidden().frame(minHeight: 44)
                    .accessibilityIdentifier(identifier + "Stepper")
            }
        }
    }
}
