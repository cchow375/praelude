import SwiftUI
import UniformTypeIdentifiers

private enum ScoreSheet: String, Identifiable {
    case setup, passages, metronome, pages, voice
    var id: String { rawValue }
}

struct ScoreWorkspace: View {
    let pieceID: UUID
    let onClose: (() -> Void)?
    @Environment(PracticeStore.self) private var store
    @Environment(MetronomeService.self) private var metronome
    @Environment(SpeechCommandService.self) private var speech
    @Environment(PracticeRuntime.self) private var runtime
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.verticalSizeClass) private var verticalSizeClass
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.openWindow) private var openWindow
    @Environment(\.supportsMultipleWindows) private var supportsMultipleWindows
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage("ios.feedback") private var feedbackEnabled = true
    @State private var voiceOwnerID = UUID()
    @State private var page = 1
    @State private var selectedPassage: Passage?
    @State private var sheet: ScoreSheet?
    @State private var setupAfterDismiss = false
    @State private var focusMode = false
    @State private var twoPages = false
    @State private var importing = false
    @State private var ending = false
    @State private var error: String?
    private var piece: Piece? { store.state.pieces.first { $0.id == pieceID } }
    private var active: ActiveSet? { store.activeSet?.configuration.pieceID == pieceID ? store.activeSet : nil }
    private var scoreURL: URL? { piece.flatMap { NativeLibraryFiles(store: store).scoreURL(for: $0) } }
    var body: some View {
        Group {
            if let piece {
                GeometryReader { geometry in
                    ZStack {
                        Color(.secondarySystemBackground)
                        if let scoreURL, FileManager.default.fileExists(atPath: scoreURL.path) {
                            PagedScoreView(url: scoreURL, page: $page, twoPages: twoPages && sizeClass == .regular, focusPageTurns: focusMode, onTurnPage: turnPage, onPageChanged: savePage)
                                .accessibilityIdentifier("scorePDF")

                        } else {
                            ContentUnavailableView {
                                Label(piece.pdfFileName == nil ? "No score attached" : "Score unavailable", systemImage: "pianokeys")
                            } description: {
                                Text(piece.pdfFileName == nil ? "Practice from a paper score, or add a PDF to keep your music here." : "The saved PDF could not be opened. Choose the score again to keep practicing.")
                            } actions: {
                                Button("Add score PDF") { importing = true }.buttonStyle(.bordered)
                            }
                        }
                    }
                    .safeAreaInset(edge: .top, spacing: 0) {
                        if focusMode {
                            HStack {
                                Button { focusMode = false } label: { Label("Exit focus", systemImage: "arrow.down.right.and.arrow.up.left") }.buttonStyle(.bordered)
                                Spacer()
                                pageControls(compact: true)
                            }.padding(.horizontal, 16).padding(.vertical, 8).background(.regularMaterial)
                        } else if piece.pageCount > 0 {
                            HStack {
                                Button { sheet = .passages } label: {
                                    if dynamicTypeSize.isAccessibilitySize {
                                        Image(systemName: "bookmark").frame(minWidth: 44)
                                            .accessibilityLabel(selectedPassage?.measureLabel ?? "Passages")
                                    } else {
                                        Label(selectedPassage?.measureLabel ?? "Passages", systemImage: "bookmark")
                                            .lineLimit(1).font(.subheadline.weight(.medium))
                                    }
                                }.frame(minHeight: 44).accessibilityIdentifier("passages")
                                Spacer(minLength: 8)
                                pageControls(compact: false)
                            }.padding(.horizontal, 16).background(.bar)
                        }
                    }
                    .safeAreaInset(edge: .bottom, spacing: 0) {
                        if !focusMode {
                            if dynamicTypeSize.isAccessibilitySize {
                                ScrollView {
                                    practiceDock.fixedSize(horizontal: false, vertical: true)
                                }
                                .frame(height: min(520, geometry.size.height * 0.6))
                                .background(.regularMaterial)
                                .accessibilityIdentifier("accessiblePracticeControls")
                            } else { practiceDock }
                        }
                    }
                }
                .navigationTitle(piece.title).navigationBarTitleDisplayMode(.inline)
                .toolbar(focusMode ? .hidden : .visible, for: .navigationBar)
                .toolbar {
                    if let onClose { ToolbarItem(placement: .topBarLeading) { Button(action: onClose) { Image(systemName: "chevron.down") }.accessibilityLabel("Close score") } }
                    ToolbarItemGroup(placement: .topBarTrailing) {
                        Button { sheet = .metronome } label: { Image(systemName: metronome.isPlaying ? "metronome.fill" : "metronome") }
                            .accessibilityLabel("Metronome").accessibilityIdentifier("openMetronome")
                        Menu {
                            Button { focusMode = true } label: { Label("Focus on score", systemImage: "arrow.up.left.and.arrow.down.right") }
                            if sizeClass == .regular {
                                Toggle("Two pages", isOn: $twoPages)
                                if supportsMultipleWindows { Button("Open score in new window", systemImage: "rectangle.on.rectangle") { openWindow(value: pieceID) } }
                            }
                            Button("Passages", systemImage: "bookmark") { sheet = .passages }
                            Button(speech.isListening ? "Turn voice off" : "Hands-free commands", systemImage: speech.isListening ? "mic.slash" : "mic") {
                                if speech.isListening { speech.stop() } else { sheet = .voice }
                            }
                            Button("Replace score PDF", systemImage: "doc.badge.plus") { importing = true }
                            if active != nil { Button("End practice", systemImage: "stop.circle", role: .destructive) { ending = true } }
                        } label: { Image(systemName: "ellipsis") }.accessibilityLabel("Score options")
                    }
                }
            } else { ContentUnavailableView("Piece unavailable", systemImage: "music.note") }
        }
        .sheet(item: $sheet, onDismiss: {
            if setupAfterDismiss { setupAfterDismiss = false; sheet = .setup }
        }) { item in
            switch item {
            case .setup: SetComposerView(pieceID: pieceID, passage: selectedPassage, onStarted: { refreshAudio() })
            case .passages: PassagePickerView(pieceID: pieceID, currentPage: page, onSelect: { passage in
                selectedPassage = passage; page = passage.page; savePage(page)
                if store.activeSet == nil || store.activeSet?.isComplete == true { setupAfterDismiss = true }
            })
            case .metronome: MetronomeView()
            case .pages: if let scoreURL { ScorePagePicker(url: scoreURL, currentPage: page, onSelect: { page = $0; savePage($0) }) }
            case .voice: voiceSheet
            }
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.pdf]) { result in
            guard let piece else { return }
            perform {
                let url = try result.get()
                _ = try NativeLibraryFiles(store: store).importPDF(url, title: piece.title, composer: piece.composer, replacing: piece)
                page = 1
            }
        }
        .confirmationDialog("End this practice session?", isPresented: $ending, titleVisibility: .visible) {
            Button("End practice", role: .destructive) { perform { try store.endSession(); metronome.stop(); speech.stop() } }
            Button("Cancel", role: .cancel) {}
        } message: { Text("Your repetitions and time stay saved. Unfinished work remains in your history.") }
        .alert("Couldn’t complete that", isPresented: Binding(get: { error != nil }, set: { if !$0 { error = nil } })) { Button("OK") { error = nil } } message: { Text(error ?? "") }
        .onAppear { page = piece?.lastPage ?? 1; runtime.scoreAppeared(ownerID: voiceOwnerID) }
        .onDisappear { speech.stop(ifOwnedBy: voiceOwnerID); runtime.scoreDisappeared(ownerID: voiceOwnerID) }
        .onChange(of: pieceID) { _, _ in page = piece?.lastPage ?? 1; selectedPassage = nil; speech.stop(ifOwnedBy: voiceOwnerID) }
        .onChange(of: active?.currentBPM) { _, _ in refreshAudio() }
        .onChange(of: active?.status) { _, _ in refreshAudio(); runtime.updateScreenAwake() }
        .background {
            Button("Toggle metronome") {
                if let set = store.activeSet, !set.isComplete { metronome.setTempo(set.currentBPM) }
                metronome.toggle()
            }.keyboardShortcut(.space, modifiers: [])
                .frame(width: 0, height: 0).opacity(0).accessibilityHidden(true)
        }
    }
    @ViewBuilder private var practiceDock: some View {
        VStack(spacing: 12) {
            if let active {
                if active.isComplete {
                    HStack {
                        Image(systemName: "checkmark.circle.fill").font(.title).foregroundStyle(.green)
                        VStack(alignment: .leading, spacing: 3) {
                            Text("Set complete").font(.headline)
                            Text("\(active.totalPlays) repetitions saved").font(.subheadline).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Button { perform { try store.undo() } } label: { Image(systemName: "arrow.uturn.backward") }.accessibilityLabel("Undo last repetition").keyboardShortcut("z", modifiers: .command)
                    }
                    HStack(spacing: 12) {
                        Button("Finish") { perform { try store.endSession(); metronome.stop() } }.buttonStyle(.bordered).frame(maxWidth: .infinity)
                        Button("Another set") {
                            perform { try store.endSet(); sheet = .setup }
                        }.buttonStyle(.borderedProminent).frame(maxWidth: .infinity)
                    }.controlSize(.large)
                } else {
                    HStack(spacing: 12) {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(active.currentStage?.name ?? active.configuration.focus).font(.subheadline.weight(.semibold)).lineLimit(1)
                            Text(active.status == .paused ? "Paused" : "\(active.progressCount) of \(active.requiredCount) \(active.configuration.basis == .cleanStreak ? "clean" : "plays") · \(Int(active.currentBPM)) BPM")
                                .font(.subheadline.monospacedDigit()).foregroundStyle(.secondary).accessibilityIdentifier("repProgress")
                        }
                        Spacer(minLength: 4)
                        Button { perform { try store.undo() } } label: { Image(systemName: "arrow.uturn.backward").frame(width: 44, height: 44) }
                            .accessibilityLabel("Undo last repetition").accessibilityIdentifier("undoRep").keyboardShortcut("z", modifiers: .command)
                            .disabled(!active.attempts.contains { $0.undoneAt == nil })
                        Button { togglePause() } label: { Image(systemName: active.status == .paused ? "play.fill" : "pause.fill").frame(width: 44, height: 44) }
                            .accessibilityLabel(active.status == .paused ? "Resume practice" : "Pause practice").accessibilityIdentifier("pausePractice")
                    }
                    SwiftUI.ProgressView(value: active.progressFraction).tint(.accentColor).accessibilityLabel("Set progress")
                    let verdictLayout = dynamicTypeSize.isAccessibilitySize && sizeClass == .compact && verticalSizeClass != .compact
                        ? AnyLayout(VStackLayout(spacing: 8)) : AnyLayout(HStackLayout(spacing: 10))
                    verdictLayout {
                        if dynamicTypeSize.isAccessibilitySize {
                            verdictButton(.clean, title: "Clean", symbol: "checkmark", key: "1", primary: true)
                            verdictButton(.sloppy, title: "Sloppy", symbol: "exclamationmark", key: "2", primary: false)
                            verdictButton(.again, title: "Again", symbol: "arrow.counterclockwise", key: "3", primary: false)
                        } else {
                            verdictButton(.again, title: "Again", symbol: "arrow.counterclockwise", key: "3", primary: false)
                            verdictButton(.sloppy, title: "Sloppy", symbol: "exclamationmark", key: "2", primary: false)
                            verdictButton(.clean, title: "Clean", symbol: "checkmark", key: "1", primary: true)
                        }
                    }.disabled(active.status != .running).opacity(active.status == .running ? 1 : 0.45)
                }
            } else if let other = store.activeSet, !other.isComplete {
                Text("A set is open for \(store.state.pieces.first { $0.id == other.configuration.pieceID }?.title ?? "another piece").")
                    .font(.callout).foregroundStyle(.secondary)
                Button("Finish current practice") { ending = true }.buttonStyle(.bordered).controlSize(.large)
            } else {
                HStack(spacing: 12) {
                    Button { sheet = .passages } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(selectedPassage?.measureLabel ?? "Whole piece").font(.headline)
                            Text(selectedPassage?.title ?? "Choose a passage").font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                        }.frame(maxWidth: .infinity, alignment: .leading).frame(minHeight: 54).contentShape(Rectangle())
                    }.buttonStyle(.plain).accessibilityIdentifier("choosePassage")
                    Button { sheet = .setup } label: { Label("Start set", systemImage: "play.fill").frame(minHeight: 36) }
                        .buttonStyle(.borderedProminent).controlSize(.large).accessibilityIdentifier("startSet")
                }
            }
            if let failure = store.errorMessage { Text(failure).font(.caption).foregroundStyle(.red) }
            if let failure = metronome.errorMessage { Text(failure).font(.caption).foregroundStyle(.red) }
            if let failure = speech.errorMessage { Text(failure).font(.caption).foregroundStyle(.red) }
            if speech.isListening && speech.ownerID == voiceOwnerID {
                HStack(spacing: 8) {
                    Image(systemName: "mic.fill").foregroundStyle(.tint)
                    Text(speech.status).font(.caption)
                    Spacer()
                    Button("Off") { speech.stop() }.font(.caption.weight(.semibold))
                }.accessibilityElement(children: .combine)
            }
        }
        .padding(.horizontal, sizeClass == .regular ? 24 : 16).padding(.vertical, 14)
        .frame(maxWidth: sizeClass == .regular ? 760 : .infinity)
        .frame(maxWidth: .infinity).background(.regularMaterial)
    }
    private func verdictButton(_ verdict: Verdict, title: String, symbol: String, key: KeyEquivalent, primary: Bool) -> some View {
        Button { record(verdict) } label: {
            VStack(spacing: 7) {
                if !dynamicTypeSize.isAccessibilitySize { Image(systemName: symbol).font(.title3.weight(.semibold)) }
                Text(title).font(.headline).fixedSize(horizontal: false, vertical: true)
            }
                .padding(.vertical, dynamicTypeSize.isAccessibilitySize ? 12 : 0)
                .frame(maxWidth: .infinity).frame(minHeight: 72)
                .foregroundStyle(primary ? Color(uiColor: .systemBackground) : Color.primary)
                .background(primary ? Color.accentColor : Color(.tertiarySystemFill), in: RoundedRectangle(cornerRadius: 16))
        }.buttonStyle(.plain).keyboardShortcut(key, modifiers: []).accessibilityIdentifier("verdict_\(verdict.rawValue)")
    }
    private func pageControls(compact: Bool) -> some View {
        HStack(spacing: compact ? 8 : 4) {
            Button { turnPage(-1) } label: { Image(systemName: "chevron.left").frame(width: 44, height: 44) }
                .disabled(page <= 1).accessibilityLabel("Previous page").keyboardShortcut(.leftArrow, modifiers: [])
            Button { sheet = .pages } label: { Text("\(page) / \(max(1, piece?.pageCount ?? 1))").font(.subheadline.monospacedDigit()).fixedSize(horizontal: true, vertical: false).frame(minWidth: 54, minHeight: 44) }
                .accessibilityLabel("Page \(page) of \(piece?.pageCount ?? 1)").accessibilityIdentifier("pageIndicator")
            Button { turnPage(1) } label: { Image(systemName: "chevron.right").frame(width: 44, height: 44) }
                .disabled(page >= (piece?.pageCount ?? 1)).accessibilityLabel("Next page").keyboardShortcut(.rightArrow, modifiers: [])
        }
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
                    LabeledContent("Next page · Previous page", value: "Turn pages")
                    LabeledContent("Metronome start · Stop metronome", value: "Control the click")
                    LabeledContent("Tempo eighty", value: "Set 80 BPM")
                }
                if let failure = speech.errorMessage { Section { Text(failure).foregroundStyle(.red) } }
                Section {
                    Button(speech.isListening ? "Stop listening" : "Enable hands-free") {
                        if speech.isListening { speech.stop() }
                        else { speech.start(ownerID: voiceOwnerID, onCommand: handleVoice) }
                    }.frame(minHeight: 44).fontWeight(.semibold)
                    Text(speech.status).font(.caption).foregroundStyle(.secondary)
                } footer: { Text("Microphone and Speech Recognition permissions are requested only when you enable this. On-device speech availability depends on your device and downloaded language support.") }
            }.navigationTitle("Hands-free").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { sheet = nil } } }
        }.presentationDetents([.large])
    }
    private func turnPage(_ direction: Int) { page = min(max(1, piece?.pageCount ?? 1), max(1, page + direction * (twoPages && sizeClass == .regular ? 2 : 1))); savePage(page) }
    private func savePage(_ page: Int) { perform { try store.updateLastPage(pieceID: pieceID, page: page) } }
    private func perform(_ action: () throws -> Void) { do { try action() } catch { self.error = error.localizedDescription } }
    private func togglePause() {
        perform { if active?.status == .paused { try store.resume() } else { try store.pause() } }
    }
    private func record(_ verdict: Verdict) {
        guard active?.status == .running else { return }
        perform {
            if metronome.isPlaying, let active, abs(metronome.bpm - active.currentBPM) > 0.001 {
                metronome.setTempo(active.currentBPM)
                throw PracticeError.conflict("The click was restored to your set tempo. Repeat the passage before recording it.")
            }
            let saved = try store.record(verdict)
            if saved {
                FeedbackService.shared.isEnabled = feedbackEnabled
                FeedbackService.shared.verdictSaved(completedSet: store.activeSet?.isComplete == true)
            }
        }
    }
    private func refreshAudio() {
        guard let active else { return }
        if active.status == .running {
            metronome.setTempo(active.currentBPM)
            if active.configuration.useMetronome && !metronome.isPlaying { metronome.start() }
        } else { metronome.stop() }
    }
    private func handleVoice(_ command: VoiceCommand) {
        // A modal editor owns its own input; speech never writes through an open setup sheet.
        guard sheet == nil || sheet == .voice else { return }
        switch command {
        case .clean: record(.clean)
        case .sloppy: record(.sloppy)
        case .again: record(.again)
        case .undo: if active != nil { perform { try store.undo() } }
        case .pause: if active != nil { perform { try store.pause() } }
        case .resume: if active != nil { perform { try store.resume() } }
        case .metronomeStart:
            if let set = store.activeSet, !set.isComplete { metronome.setTempo(set.currentBPM) }
            metronome.start()
        case .metronomeStop: metronome.stop()
        case .setTempo(let bpm):
            if store.activeSet == nil || store.activeSet?.isComplete == true { metronome.setTempo(bpm) }
            else { error = "Tempo follows your current set. Finish the set to choose a new tempo." }
        case .nextPage: turnPage(1)
        case .previousPage: turnPage(-1)
        }
    }
}
