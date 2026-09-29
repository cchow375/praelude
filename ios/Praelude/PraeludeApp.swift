import SwiftUI
import UniformTypeIdentifiers

@main
struct PraeludeApp: App {
    @State private var store: PracticeStore
    @State private var metronome: MetronomeService
    @State private var speech: SpeechCommandService
    @State private var runtime: PracticeRuntime
    @State private var rewards: RewardsRuntime
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
        if ProcessInfo.processInfo.arguments.contains("--uitesting") {
            if ProcessInfo.processInfo.arguments.contains("--seed") { UITestFixture.install(into: value) }
            UITestFixture.ensureOnboarded(into: value)
        }
        #endif
        let click = MetronomeService()
        let voice = SpeechCommandService()
        _store = State(initialValue: value)
        _metronome = State(initialValue: click)
        _speech = State(initialValue: voice)
        _runtime = State(initialValue: PracticeRuntime(store: value, metronome: click, speech: voice))
        _rewards = State(initialValue: RewardsRuntime(store: value))
    }
    var body: some Scene {
        WindowGroup {
            AppRootView()
                .environment(store).environment(metronome).environment(speech).environment(runtime).environment(rewards)
                .preferredColorScheme(colorScheme)
                .tint(PraeludeColor.ink)
                .onChange(of: store.state.preferences.keepScreenAwake) { _, _ in runtime.updateScreenAwake() }
        }
        WindowGroup("Score", for: UUID.self) { $pieceID in
            NavigationStack {
                if let pieceID { ScoreWorkspace(pieceID: pieceID, onClose: nil) }
                else { ContentUnavailableView("Choose a score", systemImage: "music.note.list") }
            }
            .environment(store).environment(metronome).environment(speech).environment(runtime).environment(rewards)
            .preferredColorScheme(colorScheme)
            .tint(PraeludeColor.ink)
        }
    }
    private var colorScheme: ColorScheme? {
        switch store.state.preferences.theme { case "light": return .light; case "dark": return .dark; default: return nil }
    }
}

private enum Destination: String, CaseIterable, Identifiable {
    case today = "Today", pieces = "Pieces", warmups = "Warmups", progress = "Progress"
    case history = "History", calendar = "Calendar", notebook = "Notebook", insights = "Data"
    case rewards = "Rewards"
    var id: String { rawValue }
    var symbol: String {
        switch self {
        case .today: return "sun.max"
        case .pieces: return "music.note.list"
        case .warmups: return "flame"
        case .progress: return "chart.bar.xaxis"
        case .history: return "clock.arrow.circlepath"
        case .calendar: return "calendar"
        case .notebook: return "note.text"
        case .insights: return "chart.xyaxis.line"
        case .rewards: return "rosette"
        }
    }
}
private struct ScoreRoute: Identifiable { let id: UUID }
private enum RootSheet: String, Identifiable { case add, settings; var id: String { rawValue } }

struct AppRootView: View {
    @Environment(PracticeStore.self) private var store
    @Environment(MetronomeService.self) private var metronome
    @Environment(SpeechCommandService.self) private var speech
    @Environment(RewardsRuntime.self) private var rewards
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.scenePhase) private var scenePhase
    private var usesSidebar: Bool { UIDevice.current.userInterfaceIdiom == .pad && !dynamicTypeSize.isAccessibilitySize }
    @State private var destination = Destination.today
    @State private var selectedPiece: UUID?
    @State private var practicingWarmup = false
    @State private var activeCelebration: MilestoneEvent?
    @State private var showOnboarding = false
    private var hasNoLiveInstruments: Bool { store.state.instruments.filter { $0.deletedAt == nil }.isEmpty }
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
                        if !store.realPieces.isEmpty {
                            Section("On your music stand") {
                                ForEach(store.realPieces.filter { $0.status != .resting }.prefix(8)) { piece in
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
            if selectedPiece == nil, phoneScore == nil, !practicingWarmup, let active = store.activeSet, active.status != .ended {
                let isWarmup = active.configuration.pieceID == WarmupsPiece.id
                HStack(spacing: 12) {
                    Button { isWarmup ? (practicingWarmup = true) : openPiece(active.configuration.pieceID) } label: {
                        HStack {
                            if active.status == .running {
                                Circle().fill(PraeludeColor.live).frame(width: 7, height: 7)
                            } else {
                                PraeludeIcon(glyph: active.isComplete ? .verdictClean : (isWarmup ? .warmup : .metronome), size: 18).foregroundStyle(PraeludeColor.ink)
                            }
                            VStack(alignment: .leading, spacing: 2) {
                                Text(isWarmup ? active.configuration.focus : (store.state.pieces.first { $0.id == active.configuration.pieceID }?.title ?? "Practice")).font(.subheadline.weight(.semibold)).lineLimit(1)
                                Text(active.isComplete ? "Set complete" : active.status == .paused ? "Paused · tap to resume" : "\(active.progressCount) of \(active.requiredCount) · \(Int(active.currentBPM)) BPM").font(.caption).foregroundStyle(PraeludeColor.inkSecondary)
                            }
                            Spacer()
                            Image(systemName: "chevron.up").foregroundStyle(PraeludeColor.inkTertiary)
                        }.frame(minHeight: 52).contentShape(Rectangle())
                    }.buttonStyle(.plain).accessibilityIdentifier("resumePractice")
                }.padding(.horizontal, 20).praeludeSurfacePanel().praeludeHairline(.top)
            }
        }
        .modifier(RewardsWiring(activeCelebration: $activeCelebration, showOnboarding: $showOnboarding, practicingWarmup: $practicingWarmup,
                                selectedPiece: selectedPiece, phoneScoreID: phoneScore?.id, hasNoLiveInstruments: hasNoLiveInstruments,
                                presentNextCelebrationIfSafe: presentNextCelebrationIfSafe))
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
        case .today: TodayView(onOpenPiece: openPiece, onAddPiece: { sheet = .add }, onContinueWarmup: { practicingWarmup = true })
        case .pieces: LibraryView(onOpenPiece: openPiece, onAddPiece: { sheet = .add })
        case .warmups: WarmupsView(onStartPractice: { practicingWarmup = true })
        case .progress: PracticeProgressView()
        case .history: HistoryView()
        case .calendar: CalendarView()
        case .notebook: NotebookView()
        case .insights: InsightsView()
        case .rewards: RewardsView()
        }
    }
    /// Shows the oldest queued big celebration once it is safe to (§14: "never mid-set") — no
    /// active-set screen on top, and nothing already showing. A no-op call when nothing qualifies.
    private func presentNextCelebrationIfSafe() {
        // "Never mid-set": also checked even when the practice screen itself has been navigated
        // away from (iPad sidebar navigation lets a set keep running in the background).
        guard activeCelebration == nil, selectedPiece == nil, phoneScore == nil, !practicingWarmup, !showOnboarding,
              store.activeSet?.status != .running else { return }
        activeCelebration = rewards.dequeueCelebration()
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

/// The reward-runtime/celebration/onboarding wiring, pulled out of `AppRootView.body` into its own
/// `ViewModifier` purely so the Swift type-checker has a smaller expression to solve — chaining this
/// many `onChange`/`fullScreenCover`/`overlay` closures directly onto the already-large root view
/// expression made it time out. Behavior is unchanged from an inline chain.
private struct RewardsWiring: ViewModifier {
    @Environment(PracticeStore.self) private var store
    @Environment(RewardsRuntime.self) private var rewards
    @Environment(\.scenePhase) private var scenePhase
    @Binding var activeCelebration: MilestoneEvent?
    @Binding var showOnboarding: Bool
    @Binding var practicingWarmup: Bool
    let selectedPiece: UUID?
    let phoneScoreID: UUID?
    let hasNoLiveInstruments: Bool
    let presentNextCelebrationIfSafe: () -> Void

    func body(content: Content) -> some View {
        content
            .fullScreenCover(isPresented: $practicingWarmup) {
                WarmupPracticeView(onClose: { practicingWarmup = false })
            }
            .overlay {
                if let activeCelebration {
                    CelebrationOverlayView(event: activeCelebration, onDismiss: {
                        self.activeCelebration = nil
                        presentNextCelebrationIfSafe()
                    })
                }
            }
            // Targeted, not `store.state.revision` (bumped by every mutation in the app, including
            // an ink stroke saved mid-drawing): reconcile only where a reward could newly qualify —
            // a recorded/undone attempt, a set pushed to history, or app foreground — so annotating
            // or editing library metadata never pays an O(n) reward-ledger scan it has nothing to
            // do with. Reconcile is idempotent, so this is a scheduling choice, not a correctness one.
            .onChange(of: store.activeSet?.attempts.count) { _, _ in rewards.reconcile(); presentNextCelebrationIfSafe() }
            .onChange(of: store.state.history.count) { _, _ in rewards.reconcile(); presentNextCelebrationIfSafe() }
            .onChange(of: rewards.celebrationQueue.count) { _, _ in presentNextCelebrationIfSafe() }
            .onChange(of: scenePhase) { _, phase in if phase == .active { rewards.reconcile(); presentNextCelebrationIfSafe() } }
            .onChange(of: selectedPiece) { _, _ in presentNextCelebrationIfSafe() }
            .onChange(of: phoneScoreID) { _, _ in presentNextCelebrationIfSafe() }
            .onChange(of: practicingWarmup) { _, _ in presentNextCelebrationIfSafe() }
            .onAppear {
                if hasNoLiveInstruments { showOnboarding = true }
                rewards.reconcile() // one catch-up pass for whatever happened since the last launch
            }
            .onChange(of: hasNoLiveInstruments) { _, empty in
                // Never force-closes here: deleting the last instrument reopens onboarding, but
                // OnboardingView's own "Start practicing" button is what explicitly closes it —
                // an instrument already exists by the time its confirmation screen shows.
                if empty { showOnboarding = true }
            }
            .fullScreenCover(isPresented: $showOnboarding) {
                OnboardingView(onFinished: { showOnboarding = false })
            }
    }
}
