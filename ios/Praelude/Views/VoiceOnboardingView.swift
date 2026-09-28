import SwiftUI

/// §9: "Onboarding voice setup (say each word a few times to check recognition in room)." Runs the
/// real on-device recognizer (the same `SpeechCommandService` the score uses) against the full fixed
/// vocabulary and counts, per word, how many times it was actually recognized — an honest report of
/// what this room and this voice sound like to this device, not a simulated pass/fail.
struct VoiceOnboardingView: View {
    @Environment(SpeechCommandService.self) private var speech
    @Environment(\.dismiss) private var dismiss
    @State private var ownerID = UUID()
    @State private var counts: [VoiceCommand: Int] = [:]
    @State private var lastHeard: VoiceCommand?

    /// The words a player can usefully "say a few times to check" — cold-grade words are included
    /// since they are just as real a recognition target, but relative/absolute tempo words that take
    /// an argument are represented by one concrete phrase each rather than every possible number.
    private static let words: [(VoiceCommand, String)] = [
        (.clean, "Clean"), (.sloppy, "Sloppy"), (.again, "Again"), (.undo, "Undo"),
        (.shaky, "Shaky"), (.missed, "Missed"),
        (.start, "Start"), (.stop, "Stop"), (.pause, "Pause"), (.resume, "Resume"), (.next, "Next"),
        (.slower, "Slower"), (.faster, "Faster"), (.setTempo(96), "\u{201c}Tempo ninety six\u{201d}"),
        (.metronomeStart, "\u{201c}Metronome on\u{201d}"), (.metronomeStop, "\u{201c}Metronome off\u{201d}")
    ]

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text("Say each word a few times. Praelude counts what it actually hears on this device, in this room.")
                        .foregroundStyle(.secondary)
                    Button(speech.isListening ? "Stop checking" : "Start checking") {
                        if speech.isListening { speech.stop() } else { speech.start(ownerID: ownerID, onCommand: heard) }
                    }.frame(minHeight: 44).fontWeight(.semibold).accessibilityIdentifier("startVoiceCheck")
                    if let lastHeard { Text("Just heard: \(VoiceConfirmationSound.label(for: lastHeard))").font(.caption).foregroundStyle(.secondary) }
                    if let failure = speech.errorMessage { Text(failure).foregroundStyle(.red) }
                } footer: {
                    Text("Words outside this list are ignored here, the same as during practice.")
                }
                Section("Recognition per word") {
                    ForEach(Self.words, id: \.1) { command, label in
                        LabeledContent(label, value: "\(counts[command] ?? 0)")
                            .accessibilityIdentifier("voiceCheckCount_\(label)")
                    }
                }
                Button("Reset counts") { counts = [:] }.disabled(counts.isEmpty)
            }
            .navigationTitle("Voice check").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { speech.stop(ifOwnedBy: ownerID); dismiss() } } }
        }
        .onDisappear { speech.stop(ifOwnedBy: ownerID) }
    }

    private func heard(_ command: VoiceCommand) {
        lastHeard = command
        counts[command, default: 0] += 1
    }
}

/// §9: "misrecognitions logged locally... viewable/clearable in Settings."
struct VoiceMisrecognitionLogView: View {
    private var log = VoiceMisrecognitionLog.shared

    var body: some View {
        List {
            if log.entries.isEmpty {
                Text("No misheard phrases yet.").foregroundStyle(.secondary)
            } else {
                ForEach(log.entries.reversed()) { entry in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(entry.text).font(.body)
                        Text(entry.date, style: .relative).font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            if !log.entries.isEmpty {
                Button("Clear log", role: .destructive) { log.clear() }.accessibilityIdentifier("clearVoiceLog")
            }
        }
        .navigationTitle("Misheard phrases").navigationBarTitleDisplayMode(.inline)
    }
}
