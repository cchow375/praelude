import SwiftUI

/// §7 page tools: non-destructive crop/rotate/reorder/delete/insert-blank-or-staff editing of a
/// piece's reading order. Everything here edits `PageEdit` rows only — the source PDF on disk is
/// never touched, so "Reset" can always return to the plain, original page order.
struct PageToolsView: View {
    let pieceID: UUID
    let pageCount: Int
    @Environment(PracticeStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var edits: [PageEdit] = []
    @State private var editMode: EditMode = .inactive
    @State private var cropping: PageEdit?
    @State private var errorMessage: String?
    @State private var confirmReset = false

    private var active: [PageEdit] { edits.filter { !$0.deleted && $0.deletedAt == nil }.sorted { $0.displayOrder < $1.displayOrder } }
    private var removed: [PageEdit] { edits.filter { $0.deleted && $0.deletedAt == nil }.sorted { ($0.sourcePage ?? 0) < ($1.sourcePage ?? 0) } }

    var body: some View {
        NavigationStack {
            List {
                if let errorMessage { Section { ErrorMessage(message: errorMessage) } }
                Section {
                    ForEach(active) { edit in
                        PageEditRow(edit: edit, pieceID: pieceID, showActions: editMode == .inactive,
                                   onRotate: { rotate(edit) }, onCrop: { cropping = edit })
                    }
                    .onDelete(perform: softDelete)
                    .onMove(perform: move)
                } header: {
                    Text("\(active.count) \(active.count == 1 ? "page" : "pages")")
                } footer: {
                    Text("Tap Reorder to drag pages into a new order or remove one. Rotate and crop apply to one page — crop can also apply to every page at once. Your original score PDF is never changed.")
                }
                if !removed.isEmpty {
                    Section("Removed from the reading order") {
                        ForEach(removed) { edit in
                            Button { restore(edit) } label: {
                                HStack {
                                    Text(edit.sourcePage.map { "Source page \($0)" } ?? "Inserted page")
                                    Spacer()
                                    Text("Restore").font(.subheadline.weight(.semibold))
                                }.frame(minHeight: 44).contentShape(Rectangle())
                            }.buttonStyle(.plain)
                        }
                    }
                }
                Section {
                    Button("Reset to original order", role: .destructive) { confirmReset = true }
                }
            }
            .environment(\.editMode, $editMode)
            .scrollContentBackground(.hidden).background(PraeludeColor.paper)
            .navigationTitle("Page tools").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .principal) {
                    Button(editMode == .active ? "Done reordering" : "Reorder") {
                        withAnimation { editMode = editMode == .active ? .inactive : .active }
                    }
                }
                ToolbarItem(placement: .confirmationAction) { Button("Save", action: save) }
            }
            .safeAreaInset(edge: .bottom) {
                if editMode == .inactive {
                    HStack(spacing: 12) {
                        Button("Insert blank page", action: insertBlank).buttonStyle(.praeludeQuiet)
                        Button("Insert staff page", action: insertStaff).buttonStyle(.praeludeQuiet)
                    }.padding(.horizontal, 16).padding(.vertical, 10).praeludeSurfacePanel().praeludeHairline(.top)
                }
            }
            .confirmationDialog("Reset all page tools?", isPresented: $confirmReset, titleVisibility: .visible) {
                Button("Reset to original order", role: .destructive, action: reset)
                Button("Cancel", role: .cancel) {}
            } message: { Text("Removes every crop, rotation, reorder and inserted page. Your score PDF itself was never touched.") }
            .sheet(item: $cropping) { edit in
                PageCropView(pieceID: pieceID, edit: edit, onSave: { updated, allOriginal in
                    if allOriginal, let crop = updated.cropRect {
                        for index in edits.indices where edits[index].kind == .original && !edits[index].deleted { edits[index].cropRect = crop }
                    } else if let index = edits.firstIndex(where: { $0.id == updated.id }) {
                        edits[index] = updated
                    }
                    cropping = nil
                })
            }
        }.presentationDetents([.large])
            .onAppear(perform: load)
    }

    private func load() {
        guard edits.isEmpty else { return }
        edits = PageLayout.seedEdits(existing: store.state.pageEdits, pieceID: pieceID, sourcePageCount: pageCount, now: Date())
    }
    private func rotate(_ edit: PageEdit) {
        guard let index = edits.firstIndex(where: { $0.id == edit.id }) else { return }
        edits[index].rotationDegrees = (edits[index].rotationDegrees + 90) % 360
        PraeludeHaptic.toggle()
    }
    private func softDelete(at offsets: IndexSet) {
        let targets = Set(offsets.map { active[$0].id })
        for index in edits.indices where targets.contains(edits[index].id) { edits[index].deleted = true }
    }
    private func restore(_ edit: PageEdit) {
        guard let index = edits.firstIndex(where: { $0.id == edit.id }) else { return }
        edits[index].deleted = false
        edits[index].displayOrder = (active.map(\.displayOrder).max() ?? 0) + 1
    }
    private func move(from source: IndexSet, to destination: Int) {
        var reordered = active
        reordered.move(fromOffsets: source, toOffset: destination)
        for updated in PageLayout.renumbered(reordered) {
            if let index = edits.firstIndex(where: { $0.id == updated.id }) { edits[index] = updated }
        }
    }
    private func insertBlank() { insert(kind: .blank) }
    private func insertStaff() { insert(kind: .staff) }
    private func insert(kind: PageKind) {
        let order = (active.map(\.displayOrder).max() ?? 0) + 1
        edits.append(PageEdit(pieceID: pieceID, sourcePage: nil, displayOrder: order, kind: kind))
        PraeludeHaptic.confirm()
    }
    /// Tombstones every row so `PageLayout.effectivePages` falls back to the plain identity order,
    /// then saves immediately — a destructive action the player already confirmed, not a draft.
    private func reset() {
        do {
            try store.savePageEdits(edits.map { edit in var edit = edit; edit.deletedAt = Date(); return edit })
            dismiss()
        } catch { errorMessage = error.localizedDescription }
    }
    private func save() {
        do {
            let untouched = edits.filter { $0.deleted || $0.deletedAt != nil }
            try store.savePageEdits(PageLayout.renumbered(active) + untouched)
            dismiss()
        } catch { errorMessage = error.localizedDescription }
    }
}

private struct PageEditRow: View {
    let edit: PageEdit
    let pieceID: UUID
    let showActions: Bool
    let onRotate: () -> Void
    let onCrop: () -> Void
    var body: some View {
        HStack(spacing: 12) {
            Group {
                if let source = edit.sourcePage {
                    PageThumbnail(pieceID: pieceID, page: source)
                } else {
                    ZStack {
                        PraeludeColor.inkFillQuiet
                        Text(edit.kind == .staff ? "Staff" : "Blank").font(.caption2).foregroundStyle(.secondary)
                    }
                }
            }
            .frame(width: 46, height: 60)
            .clipShape(RoundedRectangle(cornerRadius: PraeludeRadius.tight))
            .rotationEffect(.degrees(Double(edit.rotationDegrees)))
            VStack(alignment: .leading, spacing: 2) {
                Text(edit.sourcePage.map { "Source page \($0)" } ?? (edit.kind == .staff ? "Inserted staff page" : "Inserted blank page"))
                    .font(.subheadline)
                if edit.rotationDegrees != 0 || edit.cropRect != nil {
                    Text([edit.rotationDegrees != 0 ? "Rotated \(edit.rotationDegrees)°" : nil, edit.cropRect != nil ? "Cropped" : nil]
                        .compactMap { $0 }.joined(separator: " · "))
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            Spacer()
            if showActions, edit.kind == .original {
                Button(action: onRotate) { Image(systemName: "rotate.right") }
                    .buttonStyle(.plain).frame(width: 44, height: 44).accessibilityLabel("Rotate page")
                Button(action: onCrop) { Image(systemName: "crop") }
                    .buttonStyle(.plain).frame(width: 44, height: 44).accessibilityLabel("Crop page")
            }
        }.frame(minHeight: 60)
    }
}

private struct PageCropView: View {
    let pieceID: UUID
    let edit: PageEdit
    let onSave: (PageEdit, Bool) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var top: Double
    @State private var bottom: Double
    @State private var leading: Double
    @State private var trailing: Double
    @State private var applyAll = false

    init(pieceID: UUID, edit: PageEdit, onSave: @escaping (PageEdit, Bool) -> Void) {
        self.pieceID = pieceID; self.edit = edit; self.onSave = onSave
        let existing = edit.cropRect
        _leading = State(initialValue: (existing?.x ?? 0) * 100)
        _top = State(initialValue: (existing?.y ?? 0) * 100)
        _trailing = State(initialValue: (1 - (existing.map { $0.x + $0.width } ?? 1)) * 100)
        _bottom = State(initialValue: (1 - (existing.map { $0.y + $0.height } ?? 1)) * 100)
    }
    private var cropRect: NormalizedRect {
        let x = leading / 100, y = top / 100
        let width = max(0.05, 1 - x - trailing / 100)
        let height = max(0.05, 1 - y - bottom / 100)
        return NormalizedRect(x: x, y: y, width: width, height: height)
    }
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    GeometryReader { geometry in
                        ZStack(alignment: .topLeading) {
                            if let source = edit.sourcePage { PageThumbnail(pieceID: pieceID, page: source) }
                            Rectangle().stroke(PraeludeColor.ink.opacity(0.6), lineWidth: 1.5)
                                .frame(width: max(2, cropRect.width * geometry.size.width), height: max(2, cropRect.height * geometry.size.height))
                                .position(x: (cropRect.x + cropRect.width / 2) * geometry.size.width,
                                          y: (cropRect.y + cropRect.height / 2) * geometry.size.height)
                        }
                    }
                    .frame(height: 220).background(PraeludeColor.inkFillQuiet).clipShape(RoundedRectangle(cornerRadius: PraeludeRadius.tight))
                }
                Section("Margins") {
                    marginSlider("Top", value: $top)
                    marginSlider("Bottom", value: $bottom)
                    marginSlider("Left", value: $leading)
                    marginSlider("Right", value: $trailing)
                }
                if edit.kind == .original {
                    Section { Toggle("Apply to every page", isOn: $applyAll) }
                }
                Section {
                    Button("Remove crop") { top = 0; bottom = 0; leading = 0; trailing = 0 }
                }
            }
            .scrollContentBackground(.hidden).background(PraeludeColor.paper)
            .navigationTitle("Crop margins").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        var updated = edit
                        updated.cropRect = (top == 0 && bottom == 0 && leading == 0 && trailing == 0) ? nil : cropRect
                        onSave(updated, applyAll)
                    }
                }
            }
        }.presentationDetents([.large])
    }
    private func marginSlider(_ title: String, value: Binding<Double>) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack { Text(title); Spacer(); Text("\(Int(value.wrappedValue))%").foregroundStyle(.secondary).monospacedDigit() }
            Slider(value: value, in: 0...40)
        }
    }
}
