import SwiftUI

/// Organize saved shortcuts without opening a score or starting a practice session.
struct PassageLibraryNamesView: View {
    @Environment(PracticeStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var renaming: Passage?
    @State private var search = ""

    var body: some View {
        NavigationStack {
            List {
                ForEach(store.realPieces) { piece in
                    let passages = store.state.passages.filter {
                        $0.pieceID == piece.id && !$0.archived &&
                        (search.isEmpty || $0.title.localizedCaseInsensitiveContains(search) || piece.title.localizedCaseInsensitiveContains(search))
                    }
                    if !passages.isEmpty {
                        Section(piece.title) {
                            ForEach(passages) { passage in
                                HStack {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(passage.title).font(.headline)
                                        Text(passage.performanceTempo.map { "Goal \(PracticeReferenceFormatting.bpm($0)) BPM" } ?? "Set a goal tempo")
                                            .font(.caption).foregroundStyle(.secondary)
                                    }.frame(maxWidth: .infinity, alignment: .leading)
                                        .contentShape(Rectangle())
                                        .onTapGesture(count: 2) { renaming = passage }
                                        .accessibilityHint("Double tap the name, or use Edit, to change its name and goal tempo")
                                    Button { renaming = passage } label: {
                                        Image(systemName: "pencil").frame(width: 44, height: 44)
                                            .contentShape(Rectangle())
                                    }.buttonStyle(.plain)
                                        .accessibilityLabel("Edit name and goal for \(passage.title)")
                                }.accessibilityIdentifier("organizePassage_\(passage.id)")
                            }
                        }
                    }
                }
                if store.state.passages.allSatisfy({ $0.archived }) {
                    Text("Saved passages appear here after you draw them on a score.").foregroundStyle(.secondary)
                }
            }
            .searchable(text: $search, prompt: "Piece or passage")
            .navigationTitle("Passage names & goals").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .sheet(item: $renaming) { passage in PassageRenameView(passage: passage) }
        }
    }
}
