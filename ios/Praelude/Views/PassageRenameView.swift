import SwiftUI

/// A focused rename editor shared by direct score gestures and passage lists. The passage snapshot
/// belongs to this sheet, so dismissing a menu cannot erase the target before Save is tapped.
struct PassageRenameView: View {
    @Environment(PracticeStore.self) private var store
    @Environment(SpeechCommandService.self) private var speech
    @Environment(\.dismiss) private var dismiss
    let passage: Passage
    var startDictation = false
    var onSaved: () -> Void = {}
    @State private var name = ""
    @State private var error: String?
    @State private var hasTempoGoal = false
    @State private var tempoGoal = ""
    private var validTempoGoal: Bool {
        !hasTempoGoal || Double(tempoGoal).map { $0.isFinite && (20...300).contains($0) } == true
    }
    @State private var voiceOwnerID = UUID()
    @State private var prepared = false
    @State private var requestedDictation = false
    @FocusState private var nameFocused: Bool
    private var trimmedName: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var ownsVoice: Bool { speech.ownerID == voiceOwnerID }
    private var capturing: Bool { ownsVoice && (speech.isPreparing || speech.isListening) }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Passage name", text: $name, axis: .vertical)
                        .focused($nameFocused).submitLabel(.done).onSubmit(save)
                        .accessibilityIdentifier("passageRenameField")
                    Button(action: dictate) {
                        Label(capturing ? "Finish dictation" : "Dictate name",
                              systemImage: capturing ? "stop.circle" : "mic")
                    }.accessibilityIdentifier("dictatePassageName")
                    if capturing {
                        Text(speech.lastTranscript.isEmpty ? speech.status : speech.lastTranscript)
                            .font(.subheadline).foregroundStyle(.secondary)
                    }
                } footer: { Text("A short name you will recognize at the piano. Dictation fills this field for your review.") }
                Section {
                    Toggle("Passage goal tempo", isOn: $hasTempoGoal)
                        .accessibilityIdentifier("passageGoalEnabled")
                    if hasTempoGoal {
                        TextField("Goal BPM", text: $tempoGoal)
                            .keyboardType(.decimalPad)
                            .accessibilityIdentifier("passageGoalTempoField")
                    }
                } footer: {
                    Text("The tempo you aim to perform this passage at (20–300 BPM). Changes apply to future sets; your current set and recorded practice keep their original settings.")
                }
                if let error { Section { ErrorMessage(message: error) } }
                if requestedDictation, let failure = speech.errorMessage { Section { ErrorMessage(message: failure) } }
            }
            .navigationTitle("Rename passage").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save", action: save).disabled(trimmedName.isEmpty || trimmedName.count > 500 || capturing || !validTempoGoal)
                        .accessibilityIdentifier("savePassageName")
                }
            }
        }
        .presentationDetents([.large]).presentationDragIndicator(.visible)
        .onAppear {
            guard !prepared else { return }
            prepared = true; name = passage.title
            hasTempoGoal = passage.performanceTempo != nil
            tempoGoal = passage.performanceTempo.map(PracticeReferenceFormatting.bpm) ?? "100"
            if startDictation { dictate() } else { nameFocused = true }
        }
        .onDisappear { speech.stop(ifOwnedBy: voiceOwnerID) }
    }

    private func dictate() {
        requestedDictation = true
        nameFocused = false
        if ownsVoice && speech.isPreparing { speech.stop(ifOwnedBy: voiceOwnerID) }
        else if capturing { speech.finishDictation(ifOwnedBy: voiceOwnerID) }
        else {
            speech.startDictation(ownerID: voiceOwnerID) { transcript in
                if !transcript.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { name = transcript }
            }
        }
    }
    private func save() {
        guard !trimmedName.isEmpty, trimmedName.count <= 500, !capturing, validTempoGoal else { return }
        var edited = passage
        edited.title = trimmedName
        edited.performanceTempo = hasTempoGoal ? Double(tempoGoal) : nil
        edited.updatedAt = Date()
        do {
            try store.savePassage(edited, replacing: passage)
            speech.stop(ifOwnedBy: voiceOwnerID)
            onSaved(); dismiss()
        } catch { self.error = error.localizedDescription }
    }
}
