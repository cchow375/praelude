import SwiftUI

struct LibraryView: View {
    @Environment(PracticeStore.self) private var store
    @State private var search = ""
    @State private var collection: PieceStatus = .active
    @State private var sort: LibrarySort = .recent
    @State private var editingPiece: Piece?
    @State private var errorMessage: String?
    let onOpenPiece: (UUID) -> Void
    let onAddPiece: () -> Void

    private var visiblePieces: [Piece] {
        let query = search.trimmingCharacters(in: .whitespacesAndNewlines)
        return store.realPieces.filter { piece in
            // Resting is the one opt-out state; every other status (including a future one no
            // producer creates yet, like `.completed`) belongs in Active so it is never hidden
            // from both tabs at once.
            (collection == .resting ? piece.status == .resting : piece.status != .resting) && (query.isEmpty ||
                piece.title.localizedStandardContains(query) ||
                piece.composer.localizedStandardContains(query))
        }.sorted { left, right in
            switch sort {
            case .recent:
                let a = lastPractice(left.id) ?? left.createdAt
                let b = lastPractice(right.id) ?? right.createdAt
                return a == b ? left.title.localizedStandardCompare(right.title) == .orderedAscending : a > b
            case .title:
                return left.title.localizedStandardCompare(right.title) == .orderedAscending
            case .composer:
                let compared = left.composer.localizedStandardCompare(right.composer)
                return compared == .orderedSame
                    ? left.title.localizedStandardCompare(right.title) == .orderedAscending
                    : compared == .orderedAscending
            }
        }
    }

    var body: some View {
        List {
            Section {
                Picker("Collection", selection: $collection) {
                    Text("Active").tag(PieceStatus.active)
                    Text("Resting").tag(PieceStatus.resting)
                }
                .pickerStyle(.segmented)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 2, leading: 0, bottom: 6, trailing: 0))
            }

            if let errorMessage {
                ErrorMessage(message: errorMessage)
            }

            if visiblePieces.isEmpty {
                emptyState
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            } else {
                Section {
                    ForEach(visiblePieces) { piece in
                        Button { onOpenPiece(piece.id) } label: {
                            LibraryPieceRow(piece: piece, lastPractice: lastPractice(piece.id))
                        }
                        .buttonStyle(.plain)
                        .contextMenu {
                            Button("Open score", systemImage: "music.note") { onOpenPiece(piece.id) }
                            Button("Edit details", systemImage: "pencil") { editingPiece = piece }
                            Button(piece.status == .active ? "Move to Resting" : "Make active",
                                   systemImage: piece.status == .active ? "archivebox" : "tray.and.arrow.up") {
                                changeStatus(piece)
                            }
                        }
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            Button(piece.status == .active ? "Rest" : "Activate",
                                   systemImage: piece.status == .active ? "archivebox" : "tray.and.arrow.up") {
                                changeStatus(piece)
                            }
                            .tint(PraeludeColor.ink)
                            Button("Details", systemImage: "pencil") { editingPiece = piece }
                                .tint(PraeludeColor.inkSecondary)
                        }
                    }
                } footer: {
                    if collection == .resting {
                        Text("Resting pieces keep their scores and practice history. You can make them active whenever you like.")
                    }
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(PraeludeColor.paper)
        .navigationTitle("Pieces")
        .searchable(text: $search, prompt: "Title or composer")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Picker("Sort pieces", selection: $sort) {
                        ForEach(LibrarySort.allCases) { item in
                            Text(item.rawValue).tag(item)
                        }
                    }
                } label: {
                    Label("Sort pieces", systemImage: "arrow.up.arrow.down")
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button("Add piece", systemImage: "plus", action: onAddPiece)
            }
        }
        .sheet(item: $editingPiece) { piece in
            NavigationStack { PieceDetailsView(piece: piece) }
        }
    }

    @ViewBuilder
    private var emptyState: some View {
        if !search.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            ContentUnavailableView.search(text: search)
        } else if collection == .resting {
            PraeludeEmptyState(title: "Nothing resting", symbol: "archivebox",
                              message: "Move a piece here when you want to set it aside. Its history stays with you.")
        } else {
            PraeludeEmptyState(title: "No pieces yet", symbol: "music.note.list",
                              message: "Add a piece and bring in its PDF score from Files.",
                              actionTitle: "Add a piece", action: onAddPiece)
        }
    }

    private func lastPractice(_ pieceID: UUID) -> Date? {
        store.sessions.filter { $0.pieceID == pieceID }.map(\.startedAt).max()
    }

    private func changeStatus(_ piece: Piece) {
        do {
            try store.setPieceStatus(piece.id, status: piece.status == .active ? .resting : .active)
            errorMessage = nil
            PraeludeHaptic.confirm()
        } catch { errorMessage = error.localizedDescription }
    }
}

private enum LibrarySort: String, CaseIterable, Identifiable {
    case recent = "Recent practice"
    case title = "Title"
    case composer = "Composer"
    var id: String { rawValue }
}

struct LibraryPieceRow: View {
    let piece: Piece
    var lastPractice: Date? = nil

    var body: some View {
        HStack(spacing: 14) {
            ScoreThumbnail()
            VStack(alignment: .leading, spacing: 4) {
                Text(piece.title).font(.headline).foregroundStyle(.primary)
                    .lineLimit(2)
                if !piece.composer.isEmpty {
                    Text(piece.composer).font(.subheadline).foregroundStyle(.secondary)
                        .lineLimit(2)
                }
                HStack(spacing: 5) {
                    if piece.pageCount > 0 {
                        Text("\(piece.pageCount) \(piece.pageCount == 1 ? "page" : "pages")")
                    } else {
                        Text("No score attached")
                    }
                    if let lastPractice {
                        Text("·")
                        Text(lastPractice, format: .dateTime.month(.abbreviated).day())
                    }
                }
                .font(.caption).foregroundStyle(.secondary)
            }
            Spacer(minLength: 4)
            Image(systemName: "chevron.right")
                .font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
                .accessibilityHidden(true)
        }
        .padding(.vertical, 6)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

private struct PieceDetailsView: View {
    @Environment(PracticeStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var draft: Piece
    @State private var errorMessage: String?

    init(piece: Piece) { _draft = State(initialValue: piece) }

    var body: some View {
        Form {
            Section("Piece") {
                TextField("Title", text: $draft.title, axis: .vertical)
                    .textInputAutocapitalization(.words)
                TextField("Composer", text: $draft.composer)
                    .textInputAutocapitalization(.words)
                Picker("Collection", selection: $draft.status) {
                    Text("Active").tag(PieceStatus.active)
                    Text("Resting").tag(PieceStatus.resting)
                }
                let liveInstruments = store.state.instruments.filter { $0.deletedAt == nil }
                if !liveInstruments.isEmpty {
                    Picker("Instrument", selection: $draft.instrumentID) {
                        Text("None").tag(UUID?.none)
                        ForEach(liveInstruments) { instrument in Text(instrument.name).tag(Optional(instrument.id)) }
                    }
                }
            }
            Section("Notes") {
                TextField("What would you like to remember?", text: $draft.notes, axis: .vertical)
                    .lineLimit(5...12)
            }
            if let errorMessage {
                Section { ErrorMessage(message: errorMessage) }
            }
        }
        .navigationTitle("Piece details")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            ToolbarItem(placement: .confirmationAction) {
                Button("Save") { save() }
                    .disabled(draft.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .interactiveDismissDisabled()
    }

    private func save() {
        do {
            draft.title = draft.title.trimmingCharacters(in: .whitespacesAndNewlines)
            draft.composer = draft.composer.trimmingCharacters(in: .whitespacesAndNewlines)
            draft.updatedAt = Date()
            try store.updatePiece(draft)
            dismiss()
        } catch { errorMessage = error.localizedDescription }
    }
}
