import SwiftUI

// MARK: - Folders / tags (§7 library organization)

/// `Folder` and `Tag` are two independent Core types with no shared protocol (deliberately — see
/// "(C) Schema3.md"), but their library management screens are otherwise identical: a plain named
/// list, add/rename/delete, and "pick one to filter by". One generic view covers both rather than
/// two near-duplicate ones.
protocol LibraryLabel: Identifiable, Equatable where ID == UUID {
    var name: String { get }
    var deletedAt: Date? { get }
}
extension Folder: LibraryLabel {}
extension Tag: LibraryLabel {}

struct LibraryLabelPickerView<Entry: LibraryLabel>: View {
    let title: String
    let allTitle: String
    let all: [Entry]
    let count: (Entry) -> Int
    let onSelect: (UUID?) -> Void
    let onAdd: (String) throws -> Void
    let onRename: (Entry, String) throws -> Void
    let onDelete: (Entry) throws -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var newName = ""
    @State private var renaming: Entry?
    @State private var errorMessage: String?
    private var visible: [Entry] { all.filter { $0.deletedAt == nil }.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending } }
    var body: some View {
        NavigationStack {
            List {
                Section { Button(allTitle) { onSelect(nil); dismiss() } }
                Section {
                    TextField("Add new…", text: $newName).accessibilityIdentifier("new\(title)Name")
                    Button("Add", action: add).disabled(newName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
                if let errorMessage { Section { ErrorMessage(message: errorMessage) } }
                if !visible.isEmpty {
                    Section(title) {
                        ForEach(visible) { entry in
                            Button { onSelect(entry.id); dismiss() } label: {
                                HStack {
                                    Text(entry.name).foregroundStyle(.primary)
                                    Spacer()
                                    Text("\(count(entry))").foregroundStyle(.secondary).monospacedDigit()
                                }.frame(minHeight: 44).contentShape(Rectangle())
                            }
                            .swipeActions(edge: .trailing) {
                                Button("Delete", role: .destructive) { perform { try onDelete(entry) } }
                                Button("Rename") { renaming = entry }.tint(PraeludeColor.inkSecondary)
                            }
                        }
                    }
                }
            }
            .scrollContentBackground(.hidden).background(PraeludeColor.paper)
            .navigationTitle(title).navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } } }
            .sheet(item: $renaming) { entry in
                RenameSheet(title: "Rename \(title.lowercased())", name: entry.name) { name in perform { try onRename(entry, name) } }
            }
        }.presentationDetents([.medium, .large])
    }
    private func add() {
        let name = newName.trimmingCharacters(in: .whitespacesAndNewlines)
        perform { try onAdd(name) }
        newName = ""
    }
    private func perform(_ action: () throws -> Void) {
        do { try action() } catch { errorMessage = error.localizedDescription }
    }
}

/// A piece's folder or tag membership (`Piece.folderIDs`/`tagIDs`) — a plain checklist against
/// every live folder/tag, toggled by tapping. Shares `LibraryLabel` with the picker above, since
/// "list every live entry, act on a tap" is the same shape whether the action is "filter by this"
/// or "toggle this piece's membership in it".
struct LibraryLabelMultiSelectView<Entry: LibraryLabel>: View {
    let title: String
    let all: [Entry]
    @Binding var selectedIDs: [UUID]
    @Environment(\.dismiss) private var dismiss
    private var visible: [Entry] { all.filter { $0.deletedAt == nil }.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending } }
    var body: some View {
        NavigationStack {
            List {
                if visible.isEmpty {
                    PraeludeEmptyState(title: "None yet", symbol: "tag", message: "Add one from the library's \(title.lowercased()) list first.")
                        .listRowBackground(Color.clear).listRowSeparator(.hidden)
                }
                ForEach(visible) { entry in
                    Button { toggle(entry.id) } label: {
                        HStack {
                            Text(entry.name).foregroundStyle(.primary)
                            Spacer()
                            if selectedIDs.contains(entry.id) { Image(systemName: "checkmark").foregroundStyle(PraeludeColor.ink) }
                        }.frame(minHeight: 44).contentShape(Rectangle())
                    }
                }
            }
            .scrollContentBackground(.hidden).background(PraeludeColor.paper)
            .navigationTitle(title).navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }.presentationDetents([.medium, .large])
    }
    private func toggle(_ id: UUID) {
        if let index = selectedIDs.firstIndex(of: id) { selectedIDs.remove(at: index) } else { selectedIDs.append(id) }
    }
}

private struct RenameSheet: View {
    let title: String
    @State var name: String
    let onSave: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            Form { TextField("Name", text: $name).textInputAutocapitalization(.words) }
                .navigationTitle(title).navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Save") { onSave(name.trimmingCharacters(in: .whitespacesAndNewlines)); dismiss() }
                            .disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                }
        }.presentationDetents([.height(180)])
    }
}

// MARK: - Setlists (§7: ordered pieces/movements; open in order)

struct SetlistsView: View {
    let onOpenPiece: (UUID) -> Void
    @Environment(PracticeStore.self) private var store
    @State private var newName = ""
    @State private var errorMessage: String?
    private var setlists: [Setlist] {
        store.state.setlists.filter { $0.deletedAt == nil }.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    }
    var body: some View {
        List {
            Section {
                TextField("New setlist", text: $newName).accessibilityIdentifier("newSetlistName")
                Button("Add setlist", action: add).disabled(newName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            if let errorMessage { Section { ErrorMessage(message: errorMessage) } }
            if setlists.isEmpty {
                PraeludeEmptyState(title: "No setlists yet", symbol: "list.number",
                                  message: "Group pieces or movements into an order you open them in — a recital program, a lesson plan.")
                    .listRowBackground(Color.clear).listRowSeparator(.hidden)
            } else {
                Section {
                    ForEach(setlists) { setlist in
                        NavigationLink {
                            SetlistDetailView(setlistID: setlist.id, onOpenPiece: onOpenPiece)
                        } label: {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(setlist.name).foregroundStyle(.primary)
                                let count = SetlistNavigator.validItems(setlist, pieces: store.pieces).count
                                Text("\(count) \(count == 1 ? "piece" : "pieces")").font(.caption).foregroundStyle(.secondary)
                            }.frame(minHeight: 44)
                        }
                        .swipeActions(edge: .trailing) { Button("Delete", role: .destructive) { delete(setlist) } }
                    }
                }
            }
        }
        .scrollContentBackground(.hidden).background(PraeludeColor.paper)
        .navigationTitle("Setlists").navigationBarTitleDisplayMode(.inline)
    }
    private func add() {
        do {
            try store.saveSetlist(Setlist(name: newName.trimmingCharacters(in: .whitespacesAndNewlines)))
            newName = ""
        } catch { errorMessage = error.localizedDescription }
    }
    private func delete(_ setlist: Setlist) {
        do { try store.deleteSetlist(setlist.id) } catch { errorMessage = error.localizedDescription }
    }
}

private struct SetlistDetailView: View {
    let setlistID: UUID
    let onOpenPiece: (UUID) -> Void
    @Environment(PracticeStore.self) private var store
    @State private var addingPiece = false
    @State private var editingItem: SetlistItem?
    @State private var currentItemID: UUID?
    @State private var errorMessage: String?
    private var setlist: Setlist? { store.state.setlists.first { $0.id == setlistID } }
    private var items: [SetlistItem] { setlist.map { SetlistNavigator.validItems($0, pieces: store.pieces) } ?? [] }
    private func pieceTitle(_ id: UUID) -> String { store.pieces.first { $0.id == id }?.title ?? "Removed piece" }
    var body: some View {
        List {
            if let errorMessage { Section { ErrorMessage(message: errorMessage) } }
            if items.isEmpty {
                PraeludeEmptyState(title: "No pieces yet", symbol: "music.note.list", message: "Add pieces in the order you want to open them.",
                                  actionTitle: "Add a piece", action: { addingPiece = true })
                    .listRowBackground(Color.clear).listRowSeparator(.hidden)
            } else {
                Section {
                    ForEach(items) { item in
                        Button { open(item) } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(pieceTitle(item.pieceID)).foregroundStyle(.primary)
                                    let detail = [item.movementLabel, item.startPage.map { start in "page \(start)" + (item.endPage.map { end in start == end ? "" : "–\(end)" } ?? "") }]
                                        .compactMap { $0 }.joined(separator: " · ")
                                    if !detail.isEmpty { Text(detail).font(.caption).foregroundStyle(.secondary) }
                                }
                                Spacer()
                                if item.id == currentItemID { Image(systemName: "play.fill").foregroundStyle(.secondary).accessibilityLabel("Current") }
                            }.frame(minHeight: 44).contentShape(Rectangle())
                        }
                        .swipeActions(edge: .trailing) {
                            Button("Remove", role: .destructive) { remove(item) }
                            Button("Edit") { editingItem = item }.tint(PraeludeColor.inkSecondary)
                        }
                    }
                    .onMove(perform: move)
                } footer: { Text("Drag to reorder. Tap a piece to open it — the next/previous controls below step through in this order.") }
                Section {
                    HStack {
                        Button { step(-1) } label: { Label("Previous", systemImage: "chevron.left") }
                            .disabled(SetlistNavigator.item(after: currentItemID, offset: -1, in: setlist ?? Setlist(name: ""), pieces: store.pieces) == nil)
                        Spacer()
                        Button { step(1) } label: { Label(currentItemID == nil ? "Start" : "Next", systemImage: "chevron.right") }
                            .disabled(SetlistNavigator.item(after: currentItemID, offset: 1, in: setlist ?? Setlist(name: ""), pieces: store.pieces) == nil)
                    }.buttonStyle(.praeludeQuiet)
                }
            }
        }
        .scrollContentBackground(.hidden).background(PraeludeColor.paper)
        .navigationTitle(setlist?.name ?? "Setlist").navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Add piece", systemImage: "plus") { addingPiece = true }
                    .accessibilityIdentifier("addSetlistPiece") // Distinct from LibraryView's own "Add piece" (same label, adds a new piece to the whole library, not to this setlist).
            }
            ToolbarItem(placement: .topBarTrailing) { EditButton() }
        }
        .sheet(isPresented: $addingPiece) { AddSetlistItemView(onAdd: appendItem) }
        .sheet(item: $editingItem) { item in EditSetlistItemView(item: item, onSave: saveItem) }
    }
    private func open(_ item: SetlistItem) { currentItemID = item.id; onOpenPiece(item.pieceID) }
    private func step(_ offset: Int) {
        guard let setlist, let next = SetlistNavigator.item(after: currentItemID, offset: offset, in: setlist, pieces: store.pieces) else { return }
        open(next)
    }
    private func move(from source: IndexSet, to destination: Int) {
        guard var setlist else { return }
        var ordered = items
        ordered.move(fromOffsets: source, toOffset: destination)
        setlist.items = ordered; setlist.updatedAt = Date()
        save(setlist)
    }
    private func appendItem(_ item: SetlistItem) {
        guard var setlist else { return }
        setlist.items.append(item); setlist.updatedAt = Date()
        save(setlist)
    }
    private func saveItem(_ updated: SetlistItem) {
        guard var setlist, let index = setlist.items.firstIndex(where: { $0.id == updated.id }) else { return }
        setlist.items[index] = updated; setlist.updatedAt = Date()
        save(setlist)
    }
    private func remove(_ item: SetlistItem) {
        guard var setlist else { return }
        setlist.items.removeAll { $0.id == item.id }; setlist.updatedAt = Date()
        save(setlist)
    }
    private func save(_ setlist: Setlist) {
        do { try store.saveSetlist(setlist) } catch { errorMessage = error.localizedDescription }
    }
}

private struct AddSetlistItemView: View {
    let onAdd: (SetlistItem) -> Void
    @Environment(PracticeStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var search = ""
    private var candidates: [Piece] {
        let query = search.trimmingCharacters(in: .whitespacesAndNewlines)
        return store.pieces.filter { query.isEmpty || $0.title.localizedStandardContains(query) || $0.composer.localizedStandardContains(query) }
            .sorted { $0.title.localizedStandardCompare($1.title) == .orderedAscending }
    }
    var body: some View {
        NavigationStack {
            List(candidates) { piece in
                Button { onAdd(SetlistItem(pieceID: piece.id)); dismiss() } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(piece.title).foregroundStyle(.primary)
                        if !piece.composer.isEmpty { Text(piece.composer).font(.caption).foregroundStyle(.secondary) }
                    }.frame(minHeight: 44)
                }
                // A plain "contains the piece title" text match is ambiguous with this same
                // piece's row on Today/the sidebar, which can still be present (elsewhere in the
                // view hierarchy) while this sheet is up.
                .accessibilityIdentifier("addSetlistItem")
            }
            .searchable(text: $search, prompt: "Title or composer")
            .navigationTitle("Add piece").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }.presentationDetents([.large])
    }
}

private struct EditSetlistItemView: View {
    @State var item: SetlistItem
    let onSave: (SetlistItem) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var hasPageRange: Bool
    init(item: SetlistItem, onSave: @escaping (SetlistItem) -> Void) {
        _item = State(initialValue: item); self.onSave = onSave
        _hasPageRange = State(initialValue: item.startPage != nil)
    }
    var body: some View {
        NavigationStack {
            Form {
                Section("Movement") { TextField("e.g. “II. Adagio”", text: Binding(get: { item.movementLabel ?? "" }, set: { item.movementLabel = $0.isEmpty ? nil : $0 })) }
                Section("Page range") {
                    Toggle("Limit to a page range", isOn: $hasPageRange)
                    if hasPageRange {
                        Stepper("Start page \(item.startPage ?? 1)", value: Binding(get: { item.startPage ?? 1 }, set: { item.startPage = $0 }), in: 1...9999)
                        Stepper("End page \(item.endPage ?? item.startPage ?? 1)", value: Binding(get: { item.endPage ?? item.startPage ?? 1 }, set: { item.endPage = $0 }), in: 1...9999)
                    }
                }
            }
            .navigationTitle("Setlist item").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        if !hasPageRange { item.startPage = nil; item.endPage = nil }
                        onSave(item); dismiss()
                    }
                }
            }
        }.presentationDetents([.medium])
    }
}
