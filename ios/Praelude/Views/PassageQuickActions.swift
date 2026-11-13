import SwiftUI

/// §8: "long-press a passage outline on the score for edit/rename/recolor/split/merge/delete" — the
/// same action set `PassagePickerView`'s row context menu already offers (Rename/Recolor/Edit boxes/
/// Edit details/Split/Merge/Delete), reachable directly from the score itself, not only from the
/// Passages list sheet. `ScoreWorkspace` attaches this via `.passageQuickActions(...)`; the split/
/// merge sheets (`PassageSplitView`/`PassageMergeView`) are the exact same views `PassagePickerView`
/// uses, not a second copy.
private struct PassageQuickActionsModifier: ViewModifier {
    @Environment(PracticeStore.self) private var store
    @Binding var target: Passage?
    let allPassages: [Passage]
    let pageCount: Int
    var onEditBoxes: (Passage) -> Void
    @State private var recoloring = false
    @State private var renaming: Passage?
    @State private var recolorTarget: Passage?
    @State private var editingDetails: Passage?
    @State private var splitting: Passage?
    @State private var merging: Passage?
    @State private var pendingDelete: Passage?
    @State private var errorMessage: String?

    func body(content: Content) -> some View {
        content
            .confirmationDialog(target?.title ?? "Passage", isPresented: Binding(get: { target != nil && !recoloring }, set: { if !$0 { target = nil } }),
                                titleVisibility: .visible, presenting: target) { passage in
                Button("Name & goal tempo") { renaming = passage; target = nil }
                Button("Recolor") { recolorTarget = passage; recoloring = true; target = nil }
                Button("Edit boxes") { onEditBoxes(passage); target = nil }
                Button("Edit details") { editingDetails = passage; target = nil }
                if passage.regions.count > 1 { Button("Split off boxes…") { splitting = passage; target = nil } }
                if allPassages.contains(where: { $0.id != passage.id }) { Button("Merge with…") { merging = passage; target = nil } }
                Button("Delete passage", role: .destructive) { pendingDelete = passage; target = nil }
                Button("Cancel", role: .cancel) { target = nil }
            }
            .confirmationDialog("Recolor", isPresented: $recoloring, titleVisibility: .visible, presenting: recolorTarget) { passage in
                Button("No color") { recolor(passage, to: nil) }
                ForEach(AnnotationColor.allCases) { color in Button(color.label) { recolor(passage, to: color) } }
                Button("Cancel", role: .cancel) { recoloring = false; target = nil }
            }
            .sheet(item: $renaming) { passage in
                PassageRenameView(passage: passage, onSaved: { renaming = nil })
            }
            .confirmationDialog("Delete passage?", isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } }),
                                titleVisibility: .visible, presenting: pendingDelete) { passage in
                Button("Delete passage", role: .destructive) {
                    do { try store.deletePassage(passage.id) } catch { errorMessage = error.localizedDescription }
                    pendingDelete = nil
                }
            } message: { _ in Text("Recorded practice keeps its original visual target. This removes the saved shortcut.") }
            .sheet(item: $editingDetails) { passage in
                NavigationStack {
                    PassageEditorView(passage: passage, pageCount: max(1, pageCount), onSaved: { editingDetails = nil })
                        .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { editingDetails = nil } } }
                }
            }
            .sheet(item: $splitting) { passage in
                NavigationStack { PassageSplitView(passage: passage, onDone: { splitting = nil }) }
            }
            .sheet(item: $merging) { passage in
                NavigationStack { PassageMergeView(passage: passage, candidates: allPassages.filter { $0.id != passage.id }, onDone: { merging = nil }) }
            }
            .alert("Something went wrong", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
                Button("OK", role: .cancel) {}
            } message: { Text(errorMessage ?? "") }
    }
    private func recolor(_ passage: Passage, to color: AnnotationColor?) {
        var edited = passage; edited.color = color?.rawValue; edited.updatedAt = Date()
        do { try store.savePassage(edited, replacing: passage) } catch { errorMessage = error.localizedDescription }
        recoloring = false; target = nil
    }

}

extension View {
    /// `target` is the long-pressed passage (or `nil` to keep every dialog hidden). `onEditBoxes` is
    /// how the score itself enters box-selection mode for that passage — the one action this modifier
    /// cannot do on its own, since only `ScoreWorkspace` owns `ScoreMarkupState`.
    func passageQuickActions(target: Binding<Passage?>, allPassages: [Passage], pageCount: Int, onEditBoxes: @escaping (Passage) -> Void) -> some View {
        modifier(PassageQuickActionsModifier(target: target, allPassages: allPassages, pageCount: pageCount, onEditBoxes: onEditBoxes))
    }
}
