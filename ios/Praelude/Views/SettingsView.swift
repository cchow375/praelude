import SwiftUI

struct SettingsView: View {
    @Environment(PracticeStore.self) private var store
    @Environment(RecordingService.self) private var recording
    @AppStorage("ios.feedback") private var feedbackEnabled = true
    @State private var errorMessage: String?
    @State private var soundEnabled = RewardSoundService.shared.isEnabled
    @State private var soundVolume = RewardSoundService.shared.volume
    @State private var confirmCleanup = false
    @State private var showDeveloperContact = false
    let onExportBackup: () -> Void
    let onImportBackup: () -> Void

    private var cleanupCandidates: Int { store.recordings.recordingsOlderThan(days: 30).count }
    private var storageLabel: String {
        ByteCountFormatter.string(fromByteCount: Int64(store.recordings.totalStorageBytes), countStyle: .file)
    }

    var body: some View {
        @Bindable var recording = recording
        Form {
            Section("Instruments") {
                NavigationLink {
                    InstrumentsView()
                } label: {
                    HStack {
                        Label("Your instruments", systemImage: "pianokeys")
                        Spacer()
                        if let primary = store.primaryInstrument {
                            Text(primary.name).foregroundStyle(.secondary)
                        }
                    }
                }
            }

            Section {
                Toggle("Reward sounds", isOn: $soundEnabled).praeludeToggleHaptic(soundEnabled)
                    .onChange(of: soundEnabled) { _, value in RewardSoundService.shared.isEnabled = value }
                if soundEnabled {
                    HStack {
                        Image(systemName: "speaker.fill").foregroundStyle(.secondary)
                        Slider(value: $soundVolume, in: 0...1)
                            .onChange(of: soundVolume) { _, value in RewardSoundService.shared.volume = value }
                        Image(systemName: "speaker.wave.3.fill").foregroundStyle(.secondary)
                    }
                    .accessibilityLabel("Reward sound volume")
                }
            } header: {
                Text("Rewards")
            } footer: {
                Text("Musical, in-tune tones for milestones and badges — never anything that could be mistaken for the metronome click.")
            }

            Section("Appearance") {
                Picker("Appearance", selection: preference(\.theme)) {
                    Text("System").tag("system")
                    Text("Light").tag("light")
                    Text("Dark").tag("dark")
                }
            }

            Section {
                Toggle("Keep score awake", isOn: preference(\.keepScreenAwake)).praeludeToggleHaptic(store.preferences.keepScreenAwake)
                Toggle("Practice feedback", isOn: $feedbackEnabled).praeludeToggleHaptic(feedbackEnabled)
            } header: {
                Text("At the piano")
            } footer: {
                Text("Keep the display on while reading a score. Practice feedback adds a brief response after a saved repetition; it never changes the result you recorded.")
            }

            Section {
                NavigationLink {
                    RuleSettingsView()
                } label: {
                    Label("Practice rules", systemImage: "slider.horizontal.3")
                }
            } footer: {
                Text("The fifteen practice rules — turn any off, or adjust how quickly they fire.")
            }

            Section {
                NavigationLink("Import from Mac", destination: DesktopTransferView())
                Button("Export backup", systemImage: "square.and.arrow.up", action: onExportBackup)
                Button("Restore backup", systemImage: "arrow.counterclockwise", action: onImportBackup)
            } header: {
                Text("Your data")
            } footer: {
                Text("Practice is stored on this device. Save a backup somewhere you trust. Restoring a backup replaces this device’s practice library after you review it.")
            }

            Section {
                NavigationLink {
                    AccountView()
                } label: {
                    Label("Account and sync", systemImage: "person.crop.circle")
                }
            }

            Section {
                NavigationLink {
                    BlockedUsersView()
                } label: {
                    Label("Blocked accounts", systemImage: "hand.raised")
                }
                Button {
                    showDeveloperContact = true
                } label: {
                    Label("Contact developer", systemImage: "envelope")
                }
            } header: {
                Text("Friends and safety")
            } footer: {
                Text("Who sees your presence, streaks, pieces, and notes is set per field in Edit profile, above.")
            }

            Section {
                NavigationLink {
                    VoiceOnboardingView()
                } label: {
                    Label("Check voice recognition", systemImage: "mic")
                }
                NavigationLink {
                    VoiceMisrecognitionLogView()
                } label: {
                    Label("Misheard phrases", systemImage: "text.bubble")
                }
            } header: {
                Text("Voice")
            } footer: {
                Text("Hands-free commands are on-device only and never leave this device. A phrase that isn't in the fixed vocabulary is ignored, not sent anywhere, and logged here only so you can see what this room sounds like to it.")
            }

            Section {
                Toggle("Record my takes", isOn: $recording.takesEnabled).praeludeToggleHaptic(recording.takesEnabled)
                LabeledContent("Storage used", value: storageLabel)
                Button("Delete recordings older than 30 days", role: .destructive) { confirmCleanup = true }
                    .disabled(cleanupCandidates == 0)
            } header: {
                Text("Recordings")
            } footer: {
                Text("Optionally records each practice set as it runs. Recordings stay private and are never graded or analyzed. An account can sync them to your other devices; only you can listen back.")
            }
            .confirmationDialog("Delete \(cleanupCandidates) recording\(cleanupCandidates == 1 ? "" : "s")?", isPresented: $confirmCleanup, titleVisibility: .visible) {
                Button("Delete \(cleanupCandidates) recording\(cleanupCandidates == 1 ? "" : "s")", role: .destructive) {
                    recording.cleanUpRecordings(olderThanDays: 30, in: store)
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This removes recordings older than 30 days. This cannot be undone.")
            }

            Section("Using Praelude") {
                NavigationLink {
                    PracticeGuideView()
                } label: {
                    Label("How to practice", systemImage: "book")
                }
                NavigationLink {
                    PracticeShortcutsView()
                } label: {
                    Label("Keyboard and page turners", systemImage: "keyboard")
                }
            }

            if let errorMessage { Section { ErrorMessage(message: errorMessage) } }

            Section {
                LabeledContent("Version", value: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0")
                HStack(spacing: 8) {
                    PraeludeMusicGlyph(symbol: .quarterNote, size: 15).foregroundStyle(PraeludeColor.inkTertiary)
                    Text("You are the sensor. Praelude is the memory.")
                        .font(.subheadline).foregroundStyle(PraeludeColor.inkSecondary)
                }
            } header: {
                Text("Praelude")
            } footer: {
                Text("Your verdict supplies every musical judgment. Praelude counts, times, and remembers; it does not listen to or grade your playing.")
            }
        }
        .scrollContentBackground(.hidden)
        .background(PraeludeColor.paper)
        .navigationTitle("Settings")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $showDeveloperContact) { ReportSheet(targetType: .developerContact, targetID: nil) }
    }

    private func preference<Value>(_ keyPath: WritableKeyPath<Preferences, Value>) -> Binding<Value> {
        Binding {
            store.state.preferences[keyPath: keyPath]
        } set: { value in
            do {
                var updated = store.state.preferences
                updated[keyPath: keyPath] = value
                try store.updatePreferences(updated)
                errorMessage = nil
            } catch { errorMessage = error.localizedDescription }
        }
    }
}

private struct PracticeGuideView: View {
    var body: some View {
        List {
            Section("1. Choose your music") {
                Text("Add a piece in Pieces, then import its PDF from Files. Praelude keeps a copy with your local library.")
            }
            Section("2. Make the target small") {
                Text("Open the score and choose a passage. Set a focus, a starting tempo, and a repetition target. Add variants or a tempo ladder when they serve your practice.")
            }
            Section("3. Say what happened") {
                LabeledContent("Clean", value: "A repetition you are satisfied with.")
                LabeledContent("Sloppy", value: "A repetition with something to fix.")
                LabeledContent("Again", value: "A neutral retry. It counts toward Total plays and keeps a clean streak’s progress.")
                Text("Clean streak asks for consecutive Clean repetitions. Total plays counts your recorded repetitions toward a fixed amount of work. Undo corrects the most recent verdict.")
                    .foregroundStyle(.secondary)
            }
            Section("4. Return to the music") {
                Text("Pause when you step away. Today keeps your current set ready to resume, and Progress keeps your recorded sessions.")
            }
            Section("Hands-free input") {
                Text("In Score options, choose Hands-free commands, then Enable hands-free. Permission is requested when you enable it. While listening, use Off to stop. Voice is for commands and verdicts; your playing is never graded.")
                Text("Device speech availability and keyboard accessories can vary. The large touch controls remain available.")
                    .foregroundStyle(.secondary)
            }
        }
        .scrollContentBackground(.hidden)
        .background(PraeludeColor.paper)
        .navigationTitle("Practicing with Praelude")
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct PracticeShortcutsView: View {
    var body: some View {
        List {
            Section("While a score is open") {
                LabeledContent("Previous page", value: "←")
                LabeledContent("Next page", value: "→")
                LabeledContent("Start or stop metronome", value: "Space")
                LabeledContent("Clean", value: "1")
                LabeledContent("Sloppy", value: "2")
                LabeledContent("Again", value: "3")
                LabeledContent("Undo verdict", value: "⌘ Z")
            }
            Section("Page turners") {
                Text("A Bluetooth page turner that sends keyboard arrow keys can use the same previous and next page controls. Configure the accessory to send left and right arrows.")
                Text("This is keyboard input support. MIDI and accessory-specific control protocols are not supported.")
                    .foregroundStyle(.secondary)
            }
        }
        .scrollContentBackground(.hidden)
        .background(PraeludeColor.paper)
        .navigationTitle("Keyboard and page turners")
        .navigationBarTitleDisplayMode(.inline)
    }
}
