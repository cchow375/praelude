import PhotosUI
import SwiftUI
import UIKit

/// One enum-driven `.sheet` for the whole screen (matching `ScoreWorkspace`'s `ScoreSheet`
/// convention) rather than several independent `isPresented`/`item` sheets stacked on one view.
private enum LibrarySheet: Identifiable {
    case folders, tags, setlists, pieceDetails(Piece), movements(Piece)
    var id: String {
        switch self {
        case .folders: return "folders"
        case .tags: return "tags"
        case .setlists: return "setlists"
        case .pieceDetails(let piece): return "details-\(piece.id)"
        case .movements(let piece): return "movements-\(piece.id)"
        }
    }
}

struct LibraryView: View {
    @Environment(PracticeStore.self) private var store
    @State private var search = ""
    @State private var collection: PieceStatus = .active
    @State private var sort: LibrarySort = .recent
    @State private var errorMessage: String?
    /// §7 library organization: at most one active folder and one active tag filter, combined with
    /// the collection tab (AND, not OR) — "Resting pieces tagged Recital", not a wider search.
    @State private var folderFilter: UUID?
    @State private var tagFilter: UUID?
    @State private var sheet: LibrarySheet?
    /// §7: cover grid / list toggle. A per-device display preference, not library data, so
    /// `AppStorage` (unlike everything under `PracticeStore`) is the right home for it.
    @AppStorage("ios.library.showGrid") private var showGrid = false
    let onOpenPiece: (UUID) -> Void
    let onAddPiece: () -> Void
    /// §7 setlists: threaded through to `SetlistsView` so opening a movement lands on its own saved
    /// start page (previously stored but never acted on). Defaults to a no-op so every other call
    /// site (this screen has only one today) is unaffected.
    var onOpenPieceAtPage: (UUID, Int) -> Void = { _, _ in }

    private var visiblePieces: [Piece] {
        let query = search.trimmingCharacters(in: .whitespacesAndNewlines)
        let practiced = latestPracticeDates
        return store.realPieces.filter { piece in
            piece.status == collection
                && (folderFilter == nil || piece.folderIDs.contains(folderFilter!))
                && (tagFilter == nil || piece.tagIDs.contains(tagFilter!))
                && (query.isEmpty || piece.title.localizedStandardContains(query) || piece.composer.localizedStandardContains(query)
                    || piece.scoreSections.contains { $0.title.localizedStandardContains(query) })
        }.sorted { left, right in
            switch sort {
            case .recent:
                let a = practiced[left.id] ?? left.createdAt
                let b = practiced[right.id] ?? right.createdAt
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
        Group {
            if showGrid { gridBody } else { listBody }
        }
        .navigationTitle("Pieces")
        .searchable(text: $search, prompt: "Title, movement or composer")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button(showGrid ? "List view" : "Grid view", systemImage: showGrid ? "list.bullet" : "square.grid.2x2") {
                    showGrid.toggle()
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Picker("Sort pieces", selection: $sort) {
                        ForEach(LibrarySort.allCases) { item in
                            Text(item.rawValue).tag(item)
                        }
                    }
                    Section {
                        Button("Folders", systemImage: "folder") { sheet = .folders }
                        Button("Tags", systemImage: "tag") { sheet = .tags }
                        Button("Setlists", systemImage: "list.number") { sheet = .setlists }
                    }
                } label: {
                    Label("Sort and organize", systemImage: "arrow.up.arrow.down")
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button("Add piece", systemImage: "plus", action: onAddPiece)
            }
        }
        .sheet(item: $sheet) { which in
            switch which {
            case .pieceDetails(let piece):
                NavigationStack { PieceDetailsView(piece: piece) }
            case .movements(let piece):
                ScoreSectionsView(pieceID: piece.id, onOpenPage: { onOpenPieceAtPage(piece.id, $0) })
            case .folders:
                LibraryLabelPickerView(title: "Folders", allTitle: "All folders", all: store.state.folders,
                                       count: { folder in store.pieces.filter { $0.folderIDs.contains(folder.id) }.count },
                                       onSelect: { folderFilter = $0 },
                                       onAdd: { try store.saveFolder(Folder(name: $0)) },
                                       onRename: { folder, name in var f = folder; f.name = name; f.updatedAt = Date(); try store.saveFolder(f) },
                                       onDelete: { try store.deleteFolder($0.id) })
            case .tags:
                LibraryLabelPickerView(title: "Tags", allTitle: "All tags", all: store.state.tags,
                                       count: { tag in store.pieces.filter { $0.tagIDs.contains(tag.id) }.count },
                                       onSelect: { tagFilter = $0 },
                                       onAdd: { try store.saveTag(Tag(name: $0)) },
                                       onRename: { tag, name in var t = tag; t.name = name; t.updatedAt = Date(); try store.saveTag(t) },
                                       onDelete: { try store.deleteTag($0.id) })
            case .setlists:
                NavigationStack { SetlistsView(onOpenPiece: onOpenPiece, onOpenPieceAtPage: onOpenPieceAtPage) }
            }
        }
    }

    @ViewBuilder private var listBody: some View {
        let practiced = latestPracticeDates
        List {
            Section {
                collectionPicker
                if folderFilter != nil || tagFilter != nil { activeFilterChips }
            }
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets(top: 2, leading: 0, bottom: 6, trailing: 0))

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
                        HStack(spacing: 4) {
                            Button { onOpenPiece(piece.id) } label: {
                                LibraryPieceRow(piece: piece, lastPractice: practiced[piece.id])
                            }
                            .buttonStyle(.plain)
                            .accessibilityIdentifier("pieceRow")
                            Button { sheet = .movements(piece) } label: {
                                Image(systemName: "rectangle.split.1x2").frame(width: 44, height: 44)
                            }
                            .buttonStyle(.borderless)
                            .accessibilityLabel("Movements in \(piece.title)")
                            .accessibilityHint("Separate a score into directly selectable movements or pieces")
                            .accessibilityIdentifier("manageMovements_\(piece.id)")
                            .disabled(piece.pageCount < 1)
                        }
                        .contextMenu {
                            Button("Open score", systemImage: "music.note") { onOpenPiece(piece.id) }
                            Button("Edit details", systemImage: "pencil") { sheet = .pieceDetails(piece) }
                            statusMenuItems(for: piece)
                        }
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            Button(piece.status == .active ? "Rest" : "Activate",
                                   systemImage: piece.status == .active ? "archivebox" : "tray.and.arrow.up") {
                                changeStatus(piece, to: piece.status == .active ? .resting : .active)
                            }
                            .tint(PraeludeColor.ink)
                            Button("Details", systemImage: "pencil") { sheet = .pieceDetails(piece) }
                                .tint(PraeludeColor.inkSecondary)
                        }
                        ForEach(visibleSections(in: piece)) { section in
                            Button { onOpenPieceAtPage(piece.id, section.startPage) } label: {
                                LibraryPieceRow(piece: piece, section: section)
                            }
                            .buttonStyle(.plain)
                            .accessibilityIdentifier("movementRow_\(section.id)")
                            .contextMenu {
                                Button("Open movement", systemImage: "music.note") { onOpenPieceAtPage(piece.id, section.startPage) }
                                Button("Edit movements", systemImage: "pencil") { sheet = .movements(piece) }
                            }
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
    }

    @ViewBuilder private var gridBody: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                collectionPicker
                if folderFilter != nil || tagFilter != nil { activeFilterChips }
                if let errorMessage { ErrorMessage(message: errorMessage) }
                if visiblePieces.isEmpty {
                    emptyState.frame(maxWidth: .infinity)
                } else {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 148), spacing: 16)], spacing: 20) {
                        ForEach(visiblePieces) { piece in
                            Button { onOpenPiece(piece.id) } label: { LibraryPieceGridCell(piece: piece) }
                                .buttonStyle(.plain)
                                .accessibilityIdentifier("pieceRow")
                                .contextMenu {
                                    Button("Open score", systemImage: "music.note") { onOpenPiece(piece.id) }
                                    Button("Edit details", systemImage: "pencil") { sheet = .pieceDetails(piece) }
                                    Button("Movements and pieces", systemImage: "rectangle.split.1x2") { sheet = .movements(piece) }
                                    statusMenuItems(for: piece)
                                }
                            ForEach(visibleSections(in: piece)) { section in
                                Button { onOpenPieceAtPage(piece.id, section.startPage) } label: {
                                    LibraryPieceGridCell(piece: piece, section: section)
                                }
                                .buttonStyle(.plain)
                                .accessibilityIdentifier("movementRow_\(section.id)")
                                .contextMenu {
                                    Button("Open movement", systemImage: "music.note") { onOpenPieceAtPage(piece.id, section.startPage) }
                                    Button("Edit movements", systemImage: "pencil") { sheet = .movements(piece) }
                                }
                            }
                        }
                    }
                }
            }
            .padding(16)
        }
        .background(PraeludeColor.paper)
    }

    private var collectionPicker: some View {
        Picker("Collection", selection: $collection) {
            Text("Active").tag(PieceStatus.active)
            Text("Completed").tag(PieceStatus.completed)
            Text("Resting").tag(PieceStatus.resting)
        }
        .pickerStyle(.segmented)
    }

    private var activeFilterChips: some View {
        HStack(spacing: 8) {
            if let folderFilter, let folder = store.state.folders.first(where: { $0.id == folderFilter }) {
                filterChip(folder.name) { self.folderFilter = nil }
            }
            if let tagFilter, let tag = store.state.tags.first(where: { $0.id == tagFilter }) {
                filterChip(tag.name) { self.tagFilter = nil }
            }
            Spacer(minLength: 0)
        }
    }
    private func filterChip(_ text: String, onClear: @escaping () -> Void) -> some View {
        HStack(spacing: 4) {
            Text(text).font(.caption.weight(.medium)).lineLimit(1)
            Button(action: onClear) { Image(systemName: "xmark.circle.fill").font(.caption) }.accessibilityLabel("Clear \(text) filter")
        }
        .foregroundStyle(PraeludeColor.inkSecondary)
        .padding(.horizontal, 10).padding(.vertical, 5)
        .background(PraeludeColor.inkFillQuiet, in: Capsule())
    }

    @ViewBuilder private func statusMenuItems(for piece: Piece) -> some View {
        if piece.status != .active { Button("Make active", systemImage: "tray.and.arrow.up") { changeStatus(piece, to: .active) } }
        if piece.status != .completed { Button("Mark completed", systemImage: "checkmark.seal") { changeStatus(piece, to: .completed) } }
        if piece.status != .resting { Button("Move to Resting", systemImage: "archivebox") { changeStatus(piece, to: .resting) } }
    }

    @ViewBuilder
    private var emptyState: some View {
        if !search.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            ContentUnavailableView.search(text: search)
        } else if collection == .resting {
            PraeludeEmptyState(title: "Nothing resting", symbol: "archivebox",
                              message: "Move a piece here when you want to set it aside. Its history stays with you.")
        } else if collection == .completed {
            PraeludeEmptyState(title: "Nothing completed yet", symbol: "checkmark.seal",
                              message: "Mark a piece completed once it's performance-ready and you're moving on.")
        } else {
            PraeludeEmptyState(title: "No pieces yet", symbol: "music.note.list",
                              message: "Add a piece and bring in its score from Files, a scan, or your photos.",
                              actionTitle: "Add a piece", action: onAddPiece)
        }
    }

    private func visibleSections(in piece: Piece) -> [ScoreSection] {
        let query = search.trimmingCharacters(in: .whitespacesAndNewlines)
        let parentMatches = query.isEmpty || piece.title.localizedStandardContains(query) || piece.composer.localizedStandardContains(query)
        return piece.scoreSections.filter { parentMatches || $0.title.localizedStandardContains(query) }
            .sorted { $0.startPage < $1.startPage }
    }

    private var latestPracticeDates: [UUID: Date] {
        store.sessions.reduce(into: [:]) { dates, session in
            dates[session.pieceID] = max(dates[session.pieceID] ?? .distantPast, session.startedAt)
        }
    }

    private func changeStatus(_ piece: Piece, to status: PieceStatus) {
        do {
            try store.setPieceStatus(piece.id, status: status)
            errorMessage = nil
            PraeludeHaptic.confirm()
        } catch { errorMessage = error.localizedDescription }
    }
}

/// A piece's cover (§7: automatic first-page thumbnail, or a custom image) for the library grid and
/// list, and for the cover picker in `PieceDetailsView`. Falls back to the plain `ScoreThumbnail`
/// placeholder glyph until a render completes, or forever for a piece with no score PDF and no
/// custom cover. Rendering itself is `ScoreThumbnailCache`'s job; this view is just its display and
/// per-viewer cache lookup.
struct PieceCoverView: View {
    let piece: Piece
    var size: CGFloat = 46
    @Environment(PracticeStore.self) private var store
    @State private var image: UIImage?
    var body: some View {
        Group {
            if let image {
                Image(uiImage: image).resizable().aspectRatio(contentMode: .fill)
                    .frame(width: size, height: size * 1.22).clipShape(RoundedRectangle(cornerRadius: PraeludeRadius.tight))
            } else {
                ScoreThumbnail(size: size)
            }
        }
        .task(id: cacheIdentity) {
            let pixelSize = CGSize(width: size, height: size * 1.22)
            if let cached = ScoreThumbnailCache.shared.cached(for: piece, size: pixelSize) { image = cached; return }
            image = nil
            let loaded = await ScoreThumbnailCache.shared.load(for: piece, store: store, size: pixelSize)
            guard !Task.isCancelled else { return }
            image = loaded
        }
    }
    /// Re-runs `.task` when the piece's own cover-affecting fields change (see `ScoreThumbnailCache`'s key).
    private var cacheIdentity: String { "\(piece.id)_\(size)_\(piece.updatedAt.timeIntervalSince1970)_\(piece.customCoverRef ?? "")_\(piece.pdfFileName ?? "")" }
}

private enum LibrarySort: String, CaseIterable, Identifiable {
    case recent = "Recent practice"
    case title = "Title"
    case composer = "Composer"
    var id: String { rawValue }
}

struct LibraryPieceRow: View {
    let piece: Piece
    var section: ScoreSection? = nil
    var lastPractice: Date? = nil

    var body: some View {
        HStack(spacing: 14) {
            PieceCoverView(piece: piece)
            VStack(alignment: .leading, spacing: 4) {
                Text(section?.title ?? piece.title).font(.headline).foregroundStyle(.primary)
                    .lineLimit(2)
                if let section {
                    Text(piece.title).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                    Text("\(section.endPage - section.startPage + 1) pages · Opens at movement page 1")
                        .font(.caption).foregroundStyle(.secondary)
                } else if !piece.composer.isEmpty {
                    Text(piece.composer).font(.subheadline).foregroundStyle(.secondary)
                        .lineLimit(2)
                }
                if section == nil { HStack(spacing: 5) {
                    if !piece.scoreSections.isEmpty {
                        Text("\(piece.scoreSections.count) \(piece.scoreSections.count == 1 ? "movement" : "movements") · Complete score")
                    } else if piece.pageCount > 0 {
                        Text("\(piece.pageCount) \(piece.pageCount == 1 ? "page" : "pages")")
                    } else {
                        Text("No score attached")
                    }
                    if let lastPractice {
                        Text("·")
                        Text(lastPractice, format: .dateTime.month(.abbreviated).day())
                    }
                }
                .font(.caption).foregroundStyle(.secondary) }
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

/// §7 cover grid: the same piece a `LibraryPieceRow` shows, as a cover-forward card instead of a row.
struct LibraryPieceGridCell: View {
    let piece: Piece
    var section: ScoreSection? = nil
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            PieceCoverView(piece: piece, size: 132).frame(maxWidth: .infinity, alignment: .center)
            VStack(alignment: .leading, spacing: 2) {
                Text(section?.title ?? piece.title).font(.subheadline.weight(.semibold)).foregroundStyle(.primary).lineLimit(2)
                if section != nil { Text(piece.title).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                else if !piece.composer.isEmpty { Text(piece.composer).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
            }
        }
        .accessibilityElement(children: .combine)
    }
}

private enum PieceDetailSheet: String, Identifiable {
    case addInstrument, tags, folders, sections
    var id: String { rawValue }
}

private struct PieceDetailsView: View {
    @Environment(PracticeStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var draft: Piece
    @State private var errorMessage: String?
    @State private var detailSheet: PieceDetailSheet?
    @State private var coverSelection: PhotosPickerItem?
    @State private var coverError: String?

    init(piece: Piece) { _draft = State(initialValue: piece) }

    var body: some View {
        Form {
            Section("Cover") { coverRow }
            Section("Piece") {
                TextField("Title", text: $draft.title, axis: .vertical)
                    .textInputAutocapitalization(.words)
                TextField("Composer", text: $draft.composer)
                    .textInputAutocapitalization(.words)
                instrumentPicker
                difficultyRow
                Picker("Collection", selection: $draft.status) {
                    Text("Active").tag(PieceStatus.active)
                    Text("Completed").tag(PieceStatus.completed)
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
            Section("Practice default") {
                Toggle("Remember a tempo for this piece", isOn: Binding(get: { draft.defaultPracticeBPM != nil }, set: { draft.defaultPracticeBPM = $0 ? 60 : nil }))
                if draft.defaultPracticeBPM != nil {
                    Stepper("\(Int(draft.defaultPracticeBPM ?? 60)) bpm", value: Binding(get: { draft.defaultPracticeBPM ?? 60 }, set: { draft.defaultPracticeBPM = $0 }), in: 20...300)
                }
            }
            Section("Organization") {
                Button("Movements & pieces", systemImage: "list.bullet.rectangle") { detailSheet = .sections }
                Button { detailSheet = .folders } label: { organizationRow(title: "Folders", names: folderNames) }
                Button { detailSheet = .tags } label: { organizationRow(title: "Tags", names: tagNames) }
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
        .sheet(item: $detailSheet, onDismiss: {
            if let current = store.pieces.first(where: { $0.id == draft.id }) { draft.scoreSections = current.scoreSections; draft.measureAnchors = current.measureAnchors }
        }) { which in
            switch which {
            case .sections: ScoreSectionsView(pieceID: draft.id)
            case .addInstrument: AddInstrumentView(onAdded: { draft.instrumentID = $0 })
            case .tags: LibraryLabelMultiSelectView(title: "Tags", all: store.state.tags, selectedIDs: $draft.tagIDs)
            case .folders: LibraryLabelMultiSelectView(title: "Folders", all: store.state.folders, selectedIDs: $draft.folderIDs)
            }
        }
    }

    private var coverRow: some View {
        let label = draft.customCoverRef == nil ? "Choose cover photo" : "Replace cover photo"
        return HStack(spacing: 14) {
            PieceCoverView(piece: draft, size: 64)
            VStack(alignment: .leading, spacing: 6) {
                PhotosPicker(selection: $coverSelection, matching: .images) {
                    Text(label)
                }
                if draft.customCoverRef != nil {
                    Button("Use automatic cover", role: .destructive) { removeCover() }
                }
                if let coverError { Text(coverError).font(.caption).foregroundStyle(.red) }
            }
            Spacer()
        }
        .onChange(of: coverSelection) { _, item in
            guard let item else { return }
            Task {
                do {
                    guard let data = try await item.loadTransferable(type: Data.self) else { return }
                    draft = try NativeLibraryFiles(store: store).saveCustomCover(data, for: draft)
                    coverError = nil
                } catch { coverError = error.localizedDescription }
                coverSelection = nil
            }
        }
    }
    private var instrumentPicker: some View {
        VStack(alignment: .leading, spacing: 2) {
            Picker("Instrument", selection: $draft.instrumentID) {
                Text("None").tag(UUID?.none)
                ForEach(store.state.instruments.filter { $0.deletedAt == nil }) { instrument in
                    Text(instrument.name).tag(UUID?.some(instrument.id))
                }
            }
            Button("Add an instrument…") { detailSheet = .addInstrument }.font(.caption)
        }
    }
    private var difficultyRow: some View {
        HStack {
            Text("Difficulty")
            Spacer()
            ForEach(1...5, id: \.self) { star in
                Button {
                    draft.difficulty = draft.difficulty == star ? nil : star
                    PraeludeHaptic.toggle()
                } label: {
                    Image(systemName: (draft.difficulty ?? 0) >= star ? "star.fill" : "star")
                }.buttonStyle(.plain).foregroundStyle(PraeludeColor.ink)
            }
        }
    }
    private var folderNames: [String] { store.state.folders.filter { draft.folderIDs.contains($0.id) }.map(\.name) }
    private var tagNames: [String] { store.state.tags.filter { draft.tagIDs.contains($0.id) }.map(\.name) }
    private func organizationRow(title: String, names: [String]) -> some View {
        HStack {
            Text(title).foregroundStyle(.primary)
            Spacer()
            Text(names.isEmpty ? "None" : names.joined(separator: ", ")).foregroundStyle(.secondary).lineLimit(1)
            Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
        }.frame(minHeight: 32).contentShape(Rectangle())
    }
    private func removeCover() {
        do { draft = try NativeLibraryFiles(store: store).removeCustomCover(for: draft) } catch { coverError = error.localizedDescription }
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

private struct AddInstrumentView: View {
    let onAdded: (UUID) -> Void
    @Environment(PracticeStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var family: InstrumentFamily = .keyboard
    @State private var errorMessage: String?
    var body: some View {
        NavigationStack {
            Form {
                TextField("Name (e.g. “Piano”, “B♭ clarinet”)", text: $name)
                Picker("Family", selection: $family) {
                    ForEach(InstrumentFamily.allCases, id: \.self) { family in
                        Text(Self.displayName(family)).tag(family)
                    }
                }
                if let errorMessage { ErrorMessage(message: errorMessage) }
            }
            .navigationTitle("Add instrument").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add", action: add).disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }.presentationDetents([.medium])
    }
    private func add() {
        let instrument = Instrument(family: family, name: name.trimmingCharacters(in: .whitespacesAndNewlines))
        do { try store.saveInstrument(instrument); onAdded(instrument.id); dismiss() } catch { errorMessage = error.localizedDescription }
    }
    static func displayName(_ family: InstrumentFamily) -> String {
        switch family {
        case .keyboard: return "Keyboard"
        case .strings: return "Strings"
        case .woodwinds: return "Woodwinds"
        case .brass: return "Brass"
        case .percussion: return "Percussion"
        case .voice: return "Voice"
        case .pluckedStrings: return "Plucked strings"
        case .other: return "Other"
        }
    }
}
