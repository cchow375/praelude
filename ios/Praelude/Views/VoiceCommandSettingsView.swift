import SwiftUI

struct VoiceCommandSettingsView: View {
    @Environment(SpeechCommandService.self) private var speech
    @State private var confirmRestore = false

    var body: some View {
        List {
            Section {
                ForEach(VoiceCommandAction.allCases) { action in
                    NavigationLink {
                        VoiceAliasEditor(action: action)
                    } label: {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(action.label)
                            let custom = speech.commandAliases.aliases(for: action)
                            Text(custom.isEmpty ? action.phrases.joined(separator: ", ") : custom.joined(separator: ", "))
                                .font(.caption).foregroundStyle(.secondary)
                        }.frame(minHeight: 44)
                    }.accessibilityIdentifier("voiceAlias_\(action.rawValue)")
                }
            } header: {
                Text("Extra phrases")
            } footer: {
                Text("Add up to three distinct phrases for each supported action. Default phrases always work. Likely misheard commands require confirmation; ordinary conversation is never interpreted as a new action.")
            }
            Section {
                NavigationLink("Microphone and response checks", destination: VoiceDiagnosticsView())
                Button("Restore default phrases", role: .destructive) { confirmRestore = true }
                    .disabled(speech.commandAliases.phrases.isEmpty)
            } footer: {
                Text("Custom phrases and voice diagnostics are local to this device. They do not sync to your other devices.")
            }
        }
        .navigationTitle("Hands-free phrases").navigationBarTitleDisplayMode(.inline)
        .alert("Restore default phrases?", isPresented: $confirmRestore) {
            Button("Restore", role: .destructive) { speech.restoreDefaultAliases() }
            Button("Cancel", role: .cancel) { }
        } message: { Text("This removes your extra phrases. Your practice library is preserved.") }
    }
}

private struct VoiceAliasEditor: View {
    let action: VoiceCommandAction
    @Environment(SpeechCommandService.self) private var speech
    @Environment(\.dismiss) private var dismiss
    @State private var phrases = ["", "", ""]
    @State private var failure: String?

    var body: some View {
        Form {
            Section {
                ForEach(phrases.indices, id: \.self) { index in
                    TextField("Extra phrase \(index + 1)", text: $phrases[index])
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                        .accessibilityIdentifier("voiceExtraPhrase\(index)")
                }
            } header: { Text("Your phrases for \(action.label)") }
              footer: {
                Text(action == .tempo
                     ? "Use a prefix, such as speed. Then say “speed ninety six”. The number must be between 20 and 300."
                     : "Use short, distinct words. A phrase cannot overlap another action. Leave a field blank to remove it.")
            }
            Section("Default phrases") {
                ForEach(action.phrases, id: \.self) { phrase in
                    Text(action == .tempo ? "\(phrase) + number" : phrase)
                }
            }
            if let failure { Text(failure).foregroundStyle(.red).accessibilityIdentifier("voiceAliasError") }
        }
        .navigationTitle(action.label).navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Save") {
                    do { try speech.updateAliases(phrases, for: action); dismiss() }
                    catch { failure = error.localizedDescription }
                }.accessibilityIdentifier("saveVoiceAliases")
            }
        }
        .onAppear {
            let saved = speech.commandAliases.aliases(for: action)
            phrases = (0..<3).map { $0 < saved.count ? saved[$0] : "" }
        }
    }
}

struct VoiceDiagnosticsView: View {
    @Environment(SpeechCommandService.self) private var speech

    var body: some View {
        List {
            Section {
                LabeledContent("Command mode", value: speech.isListening ? (speech.isMuted ? "Muted" : "Listening") : speech.status)
                Text(speech.diagnosticPermission).font(.callout)
                LabeledContent("Microphone", value: speech.diagnosticInput)
                LabeledContent("Output", value: speech.diagnosticOutput)
                LabeledContent("Audio in use by", value: speech.diagnosticAudioOwners)
                if speech.diagnosticSampleRate > 0 {
                    LabeledContent("Audio format", value: "\(Int(speech.diagnosticSampleRate)) Hz")
                    LabeledContent("I/O buffer", value: milliseconds(speech.diagnosticBufferMilliseconds))
                }
                Button("Refresh checks") { speech.refreshDiagnostics() }
                Button("Open permission settings", systemImage: "gear") {
                    if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
                }
                if let message = speech.errorMessage { Text(message).foregroundStyle(.red) }
            } header: { Text("This device") }
              footer: { Text("After an interruption or disconnected microphone, turn voice on again. These checks never transfer microphone ownership or start recording.") }
            Section {
                if let startup = speech.lastStartupMilliseconds {
                    LabeledContent("Last setup", value: milliseconds(startup))
                }
                if let timing = speech.lastTiming {
                    LabeledContent("First text to final text", value: milliseconds(timing.firstTextToFinalMilliseconds))
                    if let endpoint = timing.endpointToFinalMilliseconds {
                        LabeledContent("Finishing to final text", value: milliseconds(endpoint))
                    }
                    LabeledContent("Exact supported phrase", value: timing.commandWasRecognized ? "Yes" : "No")
                } else { Text("No command timing captured yet.").foregroundStyle(.secondary) }
                NavigationLink("Check voice recognition", destination: VoiceOnboardingView())
            } header: { Text("Response timing") }
              footer: {
                Text("Stable one-word commands wait 300 ms before requesting final recognition; longer or uncertain phrases wait 600 ms. iOS adds its own recognition time. Timings start at a text callback, so they do not measure spoken-word-to-action delay. Try the check in your room; recognition while playing piano still needs a physical iPad check.")
            }
        }
        .navigationTitle("Voice checks").navigationBarTitleDisplayMode(.inline)
        .onAppear { speech.refreshDiagnostics() }
    }

    private func milliseconds(_ value: Double) -> String { "\(Int(value.rounded())) ms" }
}

/// Compact recovery appears only for a likely mishearing. No suggestion changes the ledger by itself.
struct VoiceCommandConfirmationView: View {
    var speech: SpeechCommandService

    var body: some View {
        if let pending = speech.pendingConfirmation {
            VStack(alignment: .leading, spacing: 6) {
                Text("Heard “\(pending.transcript)”").font(.caption).lineLimit(2)
                ViewThatFits(in: .horizontal) {
                    HStack { choices(pending) }
                    VStack(alignment: .leading) { choices(pending) }
                }
                if pending.candidates.count == 1 { Text("Or say confirm or cancel.").font(.caption2).foregroundStyle(.secondary) }
            }
            .padding(10).background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
            .accessibilityIdentifier("voiceCommandConfirmation")
        }
    }

    @ViewBuilder private func choices(_ pending: VoicePendingConfirmation) -> some View {
        ForEach(pending.candidates, id: \.self) { command in
            Button("Confirm \(VoiceConfirmationSound.label(for: command))") { speech.confirmPendingCommand(command) }
                .frame(minHeight: 44).buttonStyle(.borderedProminent)
        }
        Button("Cancel", role: .cancel) { speech.cancelPendingCommand() }.frame(minHeight: 44)
    }
}
