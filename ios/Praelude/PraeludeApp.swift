import SwiftUI
import UniformTypeIdentifiers

@main
struct PraeludeApp: App {
    @State private var store: PracticeStore
    @State private var metronome: MetronomeService
    @State private var speech: SpeechCommandService
    @State private var tuner: TunerService
    @State private var drone: DroneService
    @State private var recording: RecordingService
    @State private var runtime: PracticeRuntime
    @Environment(\.scenePhase) private var scenePhase
    init() {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        var directory = base.appendingPathComponent("Praelude", isDirectory: true)
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--uitesting") {
            directory = base.appendingPathComponent("Praelude-UI-Tests", isDirectory: true)
            if ProcessInfo.processInfo.arguments.contains("--reset") { try? FileManager.default.removeItem(at: directory) }
        }
        #endif
        let value = PracticeStore(directory: directory)
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--uitesting") && ProcessInfo.processInfo.arguments.contains("--seed") { UITestFixture.install(into: value) }
        #endif
        let click = MetronomeService()
        let voice = SpeechCommandService()
        let take = RecordingService()
        _store = State(initialValue: value)
        _metronome = State(initialValue: click)
        _speech = State(initialValue: voice)
        _tuner = State(initialValue: TunerService())
        _drone = State(initialValue: DroneService())
        _recording = State(initialValue: take)
        _runtime = State(initialValue: PracticeRuntime(store: value, metronome: click, speech: voice, recording: take))
    }
    var body: some Scene {
        WindowGroup {
            AppRootView()
                .environment(store).environment(metronome).environment(speech).environment(runtime)
                .environment(tuner).environment(drone).environment(recording)
                .preferredColorScheme(colorScheme)
                .tint(PraeludeColor.ink)
                .onChange(of: store.state.preferences.keepScreenAwake) { _, _ in runtime.updateScreenAwake() }
                .onChange(of: store.activeSet?.id) { _, _ in runtime.syncRecording() }
                .onChange(of: store.activeSet?.status) { _, _ in runtime.syncRecording() }
        }
        WindowGroup("Score", for: UUID.self) { $pieceID in
            NavigationStack {
                if let pieceID { ScoreWorkspace(pieceID: pieceID, onClose: nil) }
                else { ContentUnavailableView("Choose a score", systemImage: "music.note.list") }
            }
            .environment(store).environment(metronome).environment(speech).environment(runtime)
            .environment(tuner).environment(drone).environment(recording)
            .preferredColorScheme(colorScheme)
            .tint(PraeludeColor.ink)
            .onChange(of: store.activeSet?.id) { _, _ in runtime.syncRecording() }
            .onChange(of: store.activeSet?.status) { _, _ in runtime.syncRecording() }
        }
    }
    private var colorScheme: ColorScheme? {
        switch store.state.preferences.theme { case "light": return .light; case "dark": return .dark; default: return nil }
    }
}

private enum Destination: String, CaseIterable, Identifiable {
    case today = "Today", pieces = "Pieces", progress = "Progress"
    var id: String { rawValue }
    var symbol: String {
        switch self { case .today: return "sun.max"; case .pieces: return "music.note.list"; case .progress: return "chart.bar.xaxis" }
    }
}
private struct ScoreRoute: Identifiable { let id: UUID }
private enum RootSheet: String, Identifiable { case add, settings; var id: String { rawValue } }

struct AppRootView: View {
    @Environment(PracticeStore.self) private var store
    @Environment(MetronomeService.self) private var metronome
    @Environment(SpeechCommandService.self) private var speech
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    private var usesSidebar: Bool { UIDevice.current.userInterfaceIdiom == .pad && !dynamicTypeSize.isAccessibilitySize }
    @State private var destination = Destination.today
    @State private var selectedPiece: UUID?
    @State private var scoreMarkup = ScoreMarkupState()
    @State private var pendingScoreNavigation: (() -> Void)?
    @State private var confirmLeaveScore = false
    @State private var phoneScore: ScoreRoute?
    @State private var sheet: RootSheet?
    @State private var incomingURL: URL?
    @State private var pendingPiece: UUID?
    @State private var pendingBackupAction: String?
    @State private var sidebarVisibility = NavigationSplitViewVisibility.automatic
    @State private var backup: NativeBackupDocument?
    @State private var exporting = false
    @State private var importing = false
    @State private var pendingBackup: Data?
    @State private var confirmRestore = false
    @State private var error: String?
    var body: some View {
        Group {
            if usesSidebar {
                NavigationSplitView(columnVisibility: $sidebarVisibility) {
                    List {
                        ForEach(Destination.allCases) { item in
                            Button {
                                navigateFromScore { destination = item; selectedPiece = nil }
                            } label: { Label(item.rawValue, systemImage: item.symbol).frame(minHeight: 32) }
                            .listRowBackground(destination == item && selectedPiece == nil ? PraeludeColor.inkFillQuiet : Color.clear)
                        }
                        if !store.state.pieces.isEmpty {
                            Section("On your music stand") {
                                ForEach(store.state.pieces.filter { $0.status != .resting }.prefix(8)) { piece in
                                    Button { openPiece(piece.id) } label: {
                                        VStack(alignment: .leading, spacing: 4) {
                                            Text(piece.title).foregroundStyle(.primary).lineLimit(2)
                                            if !piece.composer.isEmpty { Text(piece.composer).font(.caption).foregroundStyle(.secondary) }
                                        }.frame(minHeight: 44)
                                    }
                                }
                            }
                        }
                    }
                    .scrollContentBackground(.hidden)
                    .background(PraeludeColor.paper)
                    .navigationTitle("Praelude")
                    .navigationSplitViewColumnWidth(min: 230, ideal: 270, max: 340)
                } detail: {
                    NavigationStack {
                        if let selectedPiece { ScoreWorkspace(pieceID: selectedPiece, onClose: {
                            #if DEBUG
                            if ProcessInfo.processInfo.arguments.contains("--uitesting") { NSLog("PraeludeUITest: Close score action") }
                            #endif
                            navigateFromScore { self.selectedPiece = nil; sidebarVisibility = .automatic }
                        }, sharedMarkup: scoreMarkup) }
                        else { content(destination).toolbar { ToolbarItem(placement: .topBarTrailing) { settingsButton } } }
                    }
                }.navigationSplitViewStyle(.balanced)
            } else {
                TabView(selection: $destination) {
                    ForEach(Destination.allCases) { item in
                        NavigationStack {
                            content(item).toolbar { ToolbarItem(placement: .topBarTrailing) { settingsButton } }
                        }.tabItem { Label(item.rawValue, systemImage: item.symbol) }.tag(item)
                    }
                }
                .fullScreenCover(item: $phoneScore) { route in
                    NavigationStack { ScoreWorkspace(pieceID: route.id, onClose: { navigateFromScore { phoneScore = nil } }, sharedMarkup: scoreMarkup) }
                }
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if selectedPiece == nil, phoneScore == nil, let active = store.activeSet, active.status != .ended {
                HStack(spacing: 12) {
                    Button { openPiece(active.configuration.pieceID) } label: {
                        HStack {
                            if active.status == .running {
                                Circle().fill(PraeludeColor.live).frame(width: 7, height: 7)
                            } else {
                                PraeludeIcon(glyph: active.isComplete ? .verdictClean : .metronome, size: 18).foregroundStyle(PraeludeColor.ink)
                            }
                            VStack(alignment: .leading, spacing: 2) {
                                Text(store.state.pieces.first { $0.id == active.configuration.pieceID }?.title ?? "Practice").font(.subheadline.weight(.semibold)).lineLimit(1)
                                Text(active.isComplete ? "Set complete" : active.status == .paused ? "Paused · tap to resume" : "\(active.progressCount) of \(active.requiredCount) · \(Int(active.currentBPM)) BPM").font(.caption).foregroundStyle(PraeludeColor.inkSecondary)
                            }
                            Spacer()
                            Image(systemName: "chevron.up").foregroundStyle(PraeludeColor.inkTertiary)
                        }.frame(minHeight: 52).contentShape(Rectangle())
                    }.buttonStyle(.plain).accessibilityIdentifier("resumePractice")
                }.padding(.horizontal, 20).praeludeSurfacePanel().praeludeHairline(.top)
            }
        }
        .sheet(item: $sheet, onDismiss: {
            incomingURL = nil
            if let pendingPiece { self.pendingPiece = nil; openPiece(pendingPiece) }
            if let action = pendingBackupAction {
                pendingBackupAction = nil
                if action == "export" { prepareExport() } else { importing = true }
            }
        }) { presented in
            switch presented {
            case .add: AddPieceView(importedURL: incomingURL, onAdded: { pendingPiece = $0 })
            case .settings:
                NavigationStack {
                    SettingsView(onExportBackup: { pendingBackupAction = "export"; sheet = nil }, onImportBackup: { pendingBackupAction = "import"; sheet = nil })
                        .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { sheet = nil } } }
                }.presentationDetents([.large])
            }
        }
        .fileExporter(isPresented: $exporting, document: backup, contentType: .json, defaultFilename: "Praelude Backup") { result in
            if case .failure(let failure) = result { error = failure.localizedDescription }
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.json]) { result in
            do {
                let url = try result.get()
                let access = url.startAccessingSecurityScopedResource()
                defer { if access { url.stopAccessingSecurityScopedResource() } }
                let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? Int.max
                guard size <= 280_000_000 else { throw PracticeError.invalid("Choose a backup smaller than 280 MB.") }
                pendingBackup = try Data(contentsOf: url); confirmRestore = true
            } catch { self.error = error.localizedDescription }
        }
        .confirmationDialog("Replace this device’s library?", isPresented: $confirmRestore, titleVisibility: .visible) {
            Button("Restore backup", role: .destructive) {
                guard let pendingBackup else { return }
                do {
                    metronome.stop(); speech.stop()
                    try NativeLibraryFiles(store: store).restoreBackup(pendingBackup)
                    selectedPiece = nil; phoneScore = nil
                } catch { self.error = error.localizedDescription }
                self.pendingBackup = nil
            }
            Button("Cancel", role: .cancel) { pendingBackup = nil }
        } message: { Text("The backup replaces pieces, practice history, passages and goals on this device. Export your current library first if you want to keep both.") }
        .confirmationDialog("Leave this passage unfinished?", isPresented: $confirmLeaveScore, titleVisibility: .visible) {
            Button("Discard passage edits", role: .destructive) {
                let action = pendingScoreNavigation; pendingScoreNavigation = nil
                scoreMarkup.finish(); scoreMarkup = ScoreMarkupState(); action?()
            }
            Button("Keep selecting", role: .cancel) { pendingScoreNavigation = nil }
        } message: { Text("Tap Done on the score to save your boxes before leaving.") }
        .alert("Couldn’t complete that", isPresented: Binding(get: { error != nil }, set: { if !$0 { error = nil } })) { Button("OK") { error = nil } } message: { Text(error ?? "") }
        .onChange(of: usesSidebar) { _, showSidebar in
            if showSidebar, let route = phoneScore {
                selectedPiece = route.id; phoneScore = nil; sidebarVisibility = .detailOnly
            } else if !showSidebar, let selectedPiece {
                self.selectedPiece = nil; phoneScore = ScoreRoute(id: selectedPiece)
            }
        }
        .onOpenURL { url in incomingURL = url; sheet = .add }
        .safeAreaInset(edge: .top, spacing: 0) {
            if let message = store.errorMessage {
                Text(message)
                    .font(.callout).padding().frame(maxWidth: .infinity).praeludeSurfacePanel().praeludeHairline(.bottom).foregroundStyle(.red)
            }
        }
    }
    private var settingsButton: some View {
        Button {
            #if DEBUG
            if ProcessInfo.processInfo.arguments.contains("--uitesting") { NSLog("PraeludeUITest: Settings action") }
            #endif
            sheet = .settings
        } label: {
            Image(systemName: "gearshape")
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Settings")
        .accessibilityIdentifier("appSettings")
    }
    @ViewBuilder private func content(_ destination: Destination) -> some View {
        switch destination {
        case .today: TodayView(onOpenPiece: openPiece, onAddPiece: { sheet = .add })
        case .pieces: LibraryView(onOpenPiece: openPiece, onAddPiece: { sheet = .add })
        case .progress: PracticeProgressView()
        }
    }
    private func openPiece(_ id: UUID) {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--uitesting") { NSLog("PraeludeUITest: Open piece action") }
        #endif
        if selectedPiece == id || phoneScore?.id == id { sidebarVisibility = .detailOnly; return }
        navigateFromScore {
            if usesSidebar { selectedPiece = id; sidebarVisibility = .detailOnly }
            else { phoneScore = ScoreRoute(id: id) }
            #if DEBUG
            if ProcessInfo.processInfo.arguments.contains("--uitesting") { NSLog("PraeludeUITest: Open piece assigned, sidebar=%d", usesSidebar) }
            #endif
        }
    }
    private func navigateFromScore(_ action: @escaping () -> Void) {
        guard scoreMarkup.flushInk() else {
            error = "Your ink has not been saved. Return to the score and resolve the saving message before leaving."
            return
        }
        if scoreMarkup.mode == .selecting {
            pendingScoreNavigation = action; confirmLeaveScore = true
        } else {
            scoreMarkup = ScoreMarkupState(); action()
        }
    }
    private func prepareExport() {
        do { backup = try NativeLibraryFiles(store: store).makeBackup(); exporting = true }
        catch { self.error = error.localizedDescription }
    }
}
