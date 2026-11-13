import SwiftUI

/// §7 bookmarks: quick-jump markers for movements/sections, distinct from a practice `Passage`.
/// `page` is the *displayed* page number (see "(C) Schema3.md"), matching what `ScoreWorkspace`'s
/// reader shows.
struct BookmarksView: View {
    let pieceID: UUID
    let currentPage: Int
    let onJump: (Int) -> Void
    @Environment(PracticeStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var newLabel = ""
    @State private var errorMessage: String?

    private var bookmarks: [Bookmark] {
        store.state.bookmarks.filter { $0.pieceID == pieceID && $0.deletedAt == nil }.sorted { $0.page < $1.page }
    }
    var body: some View {
        NavigationStack {
            List {
                Section {
                    TextField("Name this page (e.g. “II. Adagio”)", text: $newLabel)
                        .accessibilityIdentifier("bookmarkLabel")
                    Button("Bookmark page \(currentPage)", action: addBookmark)
                        .disabled(newLabel.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        .accessibilityIdentifier("addBookmark")
                }
                if let errorMessage { Section { ErrorMessage(message: errorMessage) } }
                if bookmarks.isEmpty {
                    PraeludeEmptyState(title: "No bookmarks yet", symbol: "bookmark",
                                      message: "Name a movement or section so you can jump straight back to it.")
                        .listRowBackground(Color.clear).listRowSeparator(.hidden)
                } else {
                    Section("Jump to") {
                        ForEach(bookmarks) { bookmark in
                            Button { onJump(bookmark.page); dismiss() } label: {
                                HStack {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(bookmark.label).foregroundStyle(.primary)
                                        Text("Page \(bookmark.page)").font(.caption).foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    if bookmark.page == currentPage { Image(systemName: "checkmark").foregroundStyle(.secondary) }
                                }.frame(minHeight: 44).contentShape(Rectangle())
                            }
                            .swipeActions(edge: .trailing) { Button("Delete", role: .destructive) { delete(bookmark) } }
                        }
                    }
                }
            }
            .scrollContentBackground(.hidden).background(PraeludeColor.paper)
            .navigationTitle("Bookmarks").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }.presentationDetents([.medium, .large])
    }
    private func addBookmark() {
        do {
            try store.saveBookmark(Bookmark(pieceID: pieceID, page: currentPage, label: newLabel.trimmingCharacters(in: .whitespacesAndNewlines)))
            newLabel = ""
        } catch { errorMessage = error.localizedDescription }
    }
    private func delete(_ bookmark: Bookmark) {
        do { try store.deleteBookmark(bookmark.id) } catch { errorMessage = error.localizedDescription }
    }
}
