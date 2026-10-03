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
    @State private var errorMessage: String?
    private var piece: Piece? { store.pieces.first { $0.id == pieceID } }
    private var sections: [ScoreSection] { piece?.scoreSections.sorted { $0.startPage < $1.startPage } ?? [] }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text("Divide a sonata into movements or a book into pieces. Each section has its own page 1; your PDF, pencil marks and practice history stay together.")
                        .font(.subheadline).foregroundStyle(.secondary)
                    Button("Add movement or piece", systemImage: "plus") {
                        let start = min(piece?.pageCount ?? 1, (sections.last?.endPage ?? 0) + 1)
                        editing = ScoreSection(title: "", startPage: max(1, start), endPage: max(1, piece?.pageCount ?? 1))
                    }.disabled((piece?.pageCount ?? 0) == 0)
                    Button { Task { await scan() } } label: {
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
        suggestions = await ScoreOrganizationScanner.sections(url: url)
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
    var body: some View {
        NavigationStack {
            Form {
                TextField("Movement or piece name", text: $section.title)
                Stepper("First PDF page \(section.startPage)", value: $section.startPage, in: 1...pageCount)
                Stepper("Last PDF page \(section.endPage)", value: $section.endPage, in: 1...pageCount)
                Text("Page numbers restart at 1 within this section. Source PDF page numbers are preserved for pencil marks and practice records.")
                    .font(.subheadline).foregroundStyle(.secondary)
                if let errorMessage { ErrorMessage(message: errorMessage) }
            }
            .navigationTitle("Section page range").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        section.title = section.title.trimmingCharacters(in: .whitespacesAndNewlines)
                        do { try onSave(section); dismiss() } catch { errorMessage = error.localizedDescription }
                    }.disabled(section.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || section.endPage < section.startPage)
                }
            }
        }
    }
}
