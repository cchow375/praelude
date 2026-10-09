import SwiftUI

private enum WarmupSheet: String, Identifiable { case metronome, voice; var id: String { rawValue } }

/// The practice HUD for a warmup set (§12): no score to read, so this is a simpler, centered dock
/// reusing the exact same verdict/tempo/metronome/voice machinery `ScoreWorkspace`'s practice dock
/// uses, without the paged-score chrome around it. Presented full-screen from `AppRootView` whenever
/// the active set belongs to `WarmupsPiece`.
struct WarmupPracticeView: View {
    @Environment(PracticeStore.self) private var store
    @Environment(MetronomeService.self) private var metronome
    @Environment(SpeechCommandService.self) private var speech
    @Environment(PracticeRuntime.self) private var runtime
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @AppStorage("ios.feedback") private var feedbackEnabled = true
    let onClose: () -> Void

    @State private var voiceOwnerID = UUID()
    @State private var sheet: WarmupSheet?
    @State private var error: String?

    private var active: ActiveSet? { store.activeSet?.configuration.pieceID == WarmupsPiece.id ? store.activeSet : nil }

    var body: some View {
        VStack(spacing: 0) {
            header
            // Keep Close and the verdict dock anchored when landscape or accessibility text
            // makes the readout taller than the remaining screen. Only that readout scrolls.
            GeometryReader { geometry in
                ScrollView {
                    VStack(spacing: 12) {
                        if let active { content(active) }
                        else { ContentUnavailableView("No warmup is active", systemImage: "pianokeys") }
                        // A long storage/audio failure must remain readable without growing the
                        // fixed dock until Close or the recovery controls leave the screen.
                        if let error { Text(error).font(.caption).foregroundStyle(.red).padding(.horizontal, 20) }
                        if let failure = store.errorMessage { Text(failure).font(.caption).foregroundStyle(.red).padding(.horizontal, 20) }
                        if let failure = metronome.errorMessage { Text(failure).font(.caption).foregroundStyle(.red).padding(.horizontal, 20) }
                    }
                    .frame(maxWidth: .infinity, minHeight: max(0, geometry.size.height - 16))
                    .padding(.vertical, 8)
                }
                .scrollBounceBehavior(.basedOnSize)
            }
            dock
        }
        .background(PraeludeColor.paper)
        .sheet(item: $sheet) { presented in
            switch presented {
            case .metronome: MetronomeView()
            case .voice: voiceSheet
            }
        }
        .onAppear { runtime.scoreAppeared(ownerID: voiceOwnerID) }
        .onDisappear { speech.stop(ifOwnedBy: voiceOwnerID); runtime.scoreDisappeared(ownerID: voiceOwnerID) }
        .onChange(of: active?.currentBPM) { _, _ in refreshAudio() }
        .onChange(of: active?.status) { _, _ in refreshAudio(); runtime.updateScreenAwake() }
    }

    private var header: some View {
        HStack(spacing: 2) {
            Button(action: pauseAndClose) { Image(systemName: "xmark").frame(width: 44, height: 44).contentShape(Rectangle()) }
                .buttonStyle(.plain).accessibilityLabel("Close warmup").accessibilityHint("Pause and return. Your repetitions stay saved.").accessibilityIdentifier("closeWarmupPractice")
            Button("Finish", action: finishAndClose).font(.subheadline).frame(minHeight: 44)
                .accessibilityIdentifier("finishWarmupPractice")
            Spacer()
            Text("Warmup").font(.subheadline.weight(.semibold)).foregroundStyle(PraeludeColor.inkSecondary)
            Spacer()
            Button { sheet = .metronome } label: { PraeludeIcon(glyph: .metronome, size: 20).frame(width: 44, height: 44).contentShape(Rectangle()) }
                .buttonStyle(.plain).accessibilityLabel("Metronome")
            Button { sheet = .voice } label: { PraeludeIcon(glyph: .mic, size: 17).frame(width: 44, height: 44).contentShape(Rectangle()) }
                .buttonStyle(.plain)
                .foregroundStyle(speech.isListening && speech.ownerID == voiceOwnerID ? PraeludeColor.live : PraeludeColor.ink)
                .accessibilityLabel("Hands-free commands")
        }
        .padding(.horizontal, 8).padding(.top, 6)
    }

    private func content(_ active: ActiveSet) -> some View {
        VStack(spacing: 26) {
            VStack(spacing: 6) {
                Text(active.configuration.focus).praeludeDisplay(dynamicTypeSize.isAccessibilitySize ? 22 : 30)
                    .multilineTextAlignment(.center).padding(.horizontal, 24)
                Text(active.isComplete ? "Set complete" : active.status == .paused ? "Paused" :
                     "\(active.progressCount) of \(active.requiredCount) \(active.configuration.basis == .cleanStreak ? "clean" : "plays")")
                    .font(.subheadline.monospacedDigit()).foregroundStyle(PraeludeColor.inkSecondary)
                    .accessibilityIdentifier("warmupProgress")
            }
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                TempoDial(bpm: Binding(get: { active.currentBPM }, set: { adjustTempo($0) }),
                          locked: active.isComplete, numeralSize: dynamicTypeSize.isAccessibilitySize ? 40 : 56, compact: true)
                Text("bpm").font(.subheadline).foregroundStyle(PraeludeColor.inkSecondary)
            }
            SwiftUI.ProgressView(value: active.progressFraction).tint(PraeludeColor.live)
                .frame(maxWidth: 340).accessibilityLabel("Set progress")
            PracticeFeedbackView(feedback: runtime.feedback, setID: active.id).allowsHitTesting(false)
        }
    }

    private var dock: some View {
        VStack(spacing: 14) {
            if let active {
                if active.isComplete {
                    HStack(spacing: 12) {
                        Button("Finish", action: finishAndClose).buttonStyle(.praeludeQuiet)
                        Button("Next in rotation") { startNextInRotation() }.buttonStyle(.praeludePrimary).accessibilityIdentifier("warmupNextAfterComplete")
                    }
                } else {
                    HStack(spacing: 12) {
                        Button { perform { try runtime.undo() } } label: { Image(systemName: "arrow.uturn.backward") }
                            .buttonStyle(.praeludeEdgeControl).accessibilityLabel("Undo last repetition")
                            .disabled(!active.attempts.contains { $0.undoneAt == nil })
                        Button {
                            if metronome.isPlaying { metronome.stop() }
                            else { metronome.setTempo(active.currentBPM); metronome.start() }
                        } label: { Image(systemName: "metronome") }
                            .buttonStyle(.praeludeEdgeControl)
                            .accessibilityLabel(metronome.isPlaying ? "Stop metronome" : "Start metronome")
                        Spacer()
                        Button { togglePause() } label: { Image(systemName: active.status == .paused ? "play.fill" : "pause.fill") }
                            .buttonStyle(.praeludeEdgeControl).accessibilityLabel(active.status == .paused ? "Resume practice" : "Pause practice")
                    }
                    verdictRow(active)
                }
            }
            if speech.isListening && speech.ownerID == voiceOwnerID {
                HStack(spacing: 8) {
                    Circle().fill(PraeludeColor.live).frame(width: 6, height: 6)
                    Text(speech.status).font(.caption)
                    Spacer()
                    Button("Off") { speech.stop() }.font(.caption.weight(.semibold)).frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
                }.accessibilityElement(children: .combine)
            }
        }
        .padding(.horizontal, 20).padding(.vertical, 16)
        .praeludeScoreChrome().praeludeHairline(.top)
    }

    private func verdictRow(_ active: ActiveSet) -> some View {
        HStack(spacing: 10) {
            verdictButton(.again, title: "Again", glyph: .verdictAgain, key: "3", primary: false)
            verdictButton(.sloppy, title: "Sloppy", glyph: .verdictSloppy, key: "2", primary: false)
            verdictButton(.clean, title: "Clean", glyph: .verdictClean, key: "1", primary: true)
        }
        .disabled(active.status != .running).opacity(active.status == .running ? 1 : 0.45)
    }

    private func verdictButton(_ verdict: Verdict, title: String, glyph: PraeludeGlyph, key: KeyEquivalent, primary: Bool) -> some View {
        Button { record(verdict) } label: {
            VStack(spacing: 7) {
                if !dynamicTypeSize.isAccessibilitySize { PraeludeIcon(glyph: glyph, size: 22) }
                Text(title).font(.headline).fixedSize(horizontal: false, vertical: true)
            }
        }
        .buttonStyle(.praeludeVerdict(emphasis: primary))
        .keyboardShortcut(key, modifiers: [])
        .accessibilityIdentifier("warmupVerdict_\(verdict.rawValue)")
    }

    private var voiceSheet: some View {
        NavigationStack {
            List {
                Section {
                    Label("Your voice is the verdict", systemImage: "mic")
                    Text("Praelude recognizes short commands on this device. It never listens for right or wrong notes.").foregroundStyle(.secondary)
                }
                Section("Say a command") {
                    LabeledContent("Clean · Sloppy · Again", value: "Record a rep")
                    LabeledContent("Undo", value: "Correct the last rep")
                    LabeledContent("Pause · Resume", value: "Control the set")
                    LabeledContent("Stop · Next", value: "End this set · Start the next rotation")
                    LabeledContent("Metronome start · Stop metronome", value: "Control the click")
                }
                if let failure = speech.errorMessage { Section { Text(failure).foregroundStyle(.red) } }
                Section {
                    Button(speech.isListening ? "Stop listening" : "Enable hands-free") {
                        if speech.isListening { speech.stop() } else { speech.start(ownerID: voiceOwnerID, onCommand: handleVoice) }
                    }.frame(minHeight: 44).fontWeight(.semibold)
                    Text(speech.status).font(.caption).foregroundStyle(.secondary)
                }
            }.navigationTitle("Hands-free").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { sheet = nil } } }
        }.presentationDetents([.large])
    }

    private func pauseAndClose() {
        perform {
            if active?.status == .running { try store.pause() }
            metronome.stop()
            onClose()
        }
    }

    private func finishAndClose() {
        perform {
            try store.endSession()
            metronome.stop()
            onClose()
        }
    }

    private func adjustTempo(_ bpm: Double) {
        perform {
            try store.adjustActiveTempo(bpm)
            if let active { metronome.setTempo(active.currentBPM) }
        }
    }

    private func togglePause() { perform { if active?.status == .paused { try store.resume() } else { try store.pause() } } }

    private func perform(_ action: () throws -> Void) { do { try action(); error = nil } catch { self.error = error.localizedDescription } }

    private func record(_ verdict: Verdict) {
        guard active?.status == .running else { return }
        perform {
            if metronome.isPlaying, let active, abs(metronome.bpm - active.currentBPM) > 0.001 {
                metronome.setTempo(active.currentBPM)
                throw PracticeError.conflict("The click was restored to your set tempo. Repeat the passage before recording it.")
            }
            FeedbackService.shared.isEnabled = feedbackEnabled
            _ = try runtime.record(verdict)
        }
    }

    private func refreshAudio() {
        runtime.refreshMetronome(for: active)
    }

    /// Ends the finished set and immediately starts the next rotation exercise (§12: keeps the
    /// one-tap "Next in rotation" momentum going without a trip back through the library).
    private func startNextInRotation() {
        perform {
            let family = store.primaryInstrument?.family
            let pool = store.state.warmupExercises.filter { $0.deletedAt == nil && (family == nil || $0.instrumentFamily == family) }
            guard let next = WarmupRotation.nextInRotation(among: pool, family: family) else {
                try store.endSet(); onClose(); return
            }
            let bpm = WarmupCatalog.defaultBPM(for: next.kind)
            try store.startSet(PracticeConfiguration(pieceID: WarmupsPiece.id, focus: next.name, goal: .tempo,
                                                       basis: .cleanStreak, targetCount: 5, startBPM: bpm, targetBPM: bpm, useMetronome: true))
            metronome.setTempo(bpm); metronome.start()
            try store.recordWarmupUse(next.id)
        }
    }

    private func handleVoice(_ command: VoiceCommand) {
        switch command {
        case .clean: record(.clean)
        case .sloppy: record(.sloppy)
        case .again: record(.again)
        // No cold-grade prompt exists in this score-free HUD — inert here, same as everywhere
        // outside that moment (see ScoreWorkspace.handleVoice).
        case .shaky, .missed: break
        case .undo: if active != nil { perform { try runtime.undo() } }
        case .pause: if active != nil { perform { try store.pause() } }
        case .resume: if active != nil { perform { try store.resume() } }
        // No arm/idle-start concept here — a new warmup is always chosen from WarmupsView, never
        // spoken from this HUD.
        case .start: break
        case .stop: if let active, !active.isComplete { perform { try store.endSet(); metronome.stop() } }
        // Mirrors ScoreWorkspace's "Next": once this set is complete, keep the rotation moving.
        case .next: if active?.isComplete == true { startNextInRotation() }
        case .slower:
            if let active, !active.isComplete { adjustTempo(active.currentBPM - 4) }
        case .faster:
            if let active, !active.isComplete { adjustTempo(active.currentBPM + 4) }
        case .metronomeStart:
            if let set = active, !set.isComplete { metronome.setTempo(set.currentBPM) }
            metronome.start()
        case .metronomeStop: metronome.stop()
        case .setTempo(let bpm):
            if active == nil || active?.isComplete == true { metronome.setTempo(bpm) }
            else { adjustTempo(bpm) }
        case .nextPage, .previousPage: break
        }
    }
}
