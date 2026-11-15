import SwiftUI

/// The same piece-wide target is reachable from setup and either running practice display.
/// Editing it changes the piece reference only; attempted sets retain their recorded contract.
struct PieceTargetTempoControl: View {
    let pieceID: UUID
    var onSaved: () -> Void = {}
    @Environment(PracticeStore.self) private var store
    @State private var showingEditor = false
    private var target: Double? { store.pieces.first { $0.id == pieceID }?.fullTempoBPM }

    var body: some View {
        Button { showingEditor = true } label: {
            HStack(spacing: 4) {
                Image(systemName: "scope").font(.caption)
                Text(target.map { "Piece target \(PracticeReferenceFormatting.bpm($0))" } ?? "Set target")
                    .font(.caption.monospacedDigit().weight(.semibold))
                    .lineLimit(1).fixedSize(horizontal: true, vertical: false)
            }.frame(minHeight: 44).contentShape(Rectangle())
        }.buttonStyle(.plain)
            .accessibilityLabel("Piece target tempo")
            .accessibilityValue(target.map { "\(PracticeReferenceFormatting.bpm($0)) BPM" } ?? "Not set")
            .accessibilityHint("Edit the shared performance target for this piece")
            .accessibilityIdentifier("pieceTargetTempo")
            .sheet(isPresented: $showingEditor) { PieceTargetTempoEditor(pieceID: pieceID, onSaved: onSaved) }
    }
}

private struct PieceTargetTempoEditor: View {
    let pieceID: UUID
    let onSaved: () -> Void
    @Environment(PracticeStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var error: String?
    private var parsed: Double? { Double(text.trimmingCharacters(in: .whitespacesAndNewlines)) }
    private var valid: Bool { parsed.map { $0.isFinite && (20...300).contains($0) } == true }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Target BPM", text: $text).keyboardType(.decimalPad)
                        .accessibilityIdentifier("pieceTargetTempoEntry")
                } header: { Text("Performance target") }
                  footer: { Text("Shared by this piece’s passages unless a passage has its own goal. New practice starts at 75% of the target; you can change the playing tempo at any time. Use the same beat unit as your metronome.") }
                if let error { Section { ErrorMessage(message: error) } }
            }
            .navigationTitle("Piece target").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { save() }.disabled(!valid).accessibilityIdentifier("savePieceTargetTempo")
                }
            }
            .onAppear { text = store.pieces.first { $0.id == pieceID }?.fullTempoBPM.map(PracticeReferenceFormatting.bpm) ?? "" }
        }.presentationDetents([.medium, .large]).presentationDragIndicator(.visible)
    }
    private func save() {
        guard let piece = store.pieces.first(where: { $0.id == pieceID }), let parsed, valid else { return }
        do {
            try store.setPracticeReference(parsed, plan: piece.practiceBalancePlan, for: pieceID)
            onSaved(); dismiss()
        } catch { self.error = error.localizedDescription }
    }
}
