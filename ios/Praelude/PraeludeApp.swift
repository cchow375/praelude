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
    @State private var rewards: RewardsRuntime
    @State private var services: SupabaseServices
    @State private var auth: AuthManager
    @State private var syncCoordinator: SyncCoordinator
    @State private var storage: ScoreAndRecordingStorage
    @State private var social: SocialService
    @State private var socialHooks: SocialHooks
    @State private var presence: PresenceService
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
        let take = RecordingService()
        _store = State(initialValue: value)
        _metronome = State(initialValue: click)
        _speech = State(initialValue: voice)
        _tuner = State(initialValue: TunerService())
        _drone = State(initialValue: DroneService())
        _recording = State(initialValue: take)
        _runtime = State(initialValue: PracticeRuntime(store: value, metronome: click, speech: voice, recording: take))
        _rewards = State(initialValue: RewardsRuntime(store: value))
        // Accounts + sync (spec §4b/§4d). SupabaseServices/AuthManager never throw to construct, so
        // the app always launches and works fully offline (guest mode) even if account/sync
        // infrastructure has trouble - see SyncEngine.init's own doc comment for the same reasoning.
        let servicesValue = SupabaseServices()
        let authValue = AuthManager(services: servicesValue, store: value)
        let syncDirectory = directory.appendingPathComponent("Sync", isDirectory: true)
        let engine = SyncEngine(transport: PostgRESTSyncTransport(services: servicesValue), directory: syncDirectory)
        let coordinatorValue = SyncCoordinator(engine: engine, auth: authValue, store: value)
        // Sign-out (ordinary or the tail of a successful account deletion) must drop this device's
        // outbound queue and pull cursors so nothing crosses into whichever account signs in next
        // (AuthManager.onSignedOut's own doc comment). Wired here rather than via a View-level
        // onChange so it fires even if no view observing `auth.state` happens to be on screen.
        authValue.onSignedOut = { [weak coordinatorValue] in coordinatorValue?.resetLocalAccountState() }
        // §4a: private-bucket file transfer riding on top of the metadata sync above (scores/
        // recordings storage.objects policies — supabase/migrations/20260926220008_storage_buckets.sql).
        let storageValue = ScoreAndRecordingStorage(services: servicesValue, auth: authValue)
        coordinatorValue.setStorage(storageValue)
        _services = State(initialValue: servicesValue)
        _auth = State(initialValue: authValue)
        _syncCoordinator = State(initialValue: coordinatorValue)
        _storage = State(initialValue: storageValue)

        // Social (spec §5). No offline queue of its own (supabase/(C) Sync Protocol.md §1) — see
        // SocialService's own doc comment — so nothing here needs the same guest-mode fallback
        // SyncEngine's init comment describes; every method already no-ops in guest mode on its own.
        let socialValue = SocialService(services: servicesValue, auth: authValue)
        let hooksValue = SocialHooks(social: socialValue, auth: authValue, syncCoordinator: coordinatorValue)
        let presenceValue = PresenceService(services: servicesValue, auth: authValue, social: socialValue)
        _social = State(initialValue: socialValue)
        _socialHooks = State(initialValue: hooksValue)
        _presence = State(initialValue: presenceValue)
    }
    var body: some Scene {
        WindowGroup {
            AppRootView()
                .environment(store).environment(metronome).environment(speech).environment(runtime).environment(rewards)
                .environment(tuner).environment(drone).environment(recording)
                .environment(auth).environment(syncCoordinator).environment(storage)
                .environment(social).environment(socialHooks).environment(presence)
                .preferredColorScheme(colorScheme)
                .tint(PraeludeColor.ink)
                .onChange(of: store.state.preferences.keepScreenAwake) { _, _ in runtime.updateScreenAwake() }
                .onChange(of: store.activeSet?.id) { _, _ in runtime.syncRecording(); runtime.syncPulseCheck(); syncCoordinator.syncActiveSetProgress() }
                .onChange(of: store.activeSet?.status) { _, _ in runtime.syncRecording(); runtime.syncPulseCheck(); syncCoordinator.syncActiveSetProgress() }
                // Spec §4d/§9: the append-only rep log. Reacting to `attempts.count`/the undone-count
                // (rather than wrapping every `PracticeStore.record`/`undo` call site — `record`/`undo`
                // are already centralized in `PracticeRuntime`, but `startSet`/`pause`/`resume`/`endSet`
                // are not, called directly from several Views/`PracticeArmController`) is the same
                // "least invasive integration" `PracticeRuntime.syncRecording()`'s own doc comment
                // already uses for this exact class of problem — see `SyncCoordinator.syncSet(_:)`.
                .onChange(of: store.activeSet?.attempts.count) { _, _ in syncCoordinator.syncActiveSetProgress() }
                .onChange(of: store.activeSet?.attempts.filter { $0.undoneAt != nil }.count) { _, _ in syncCoordinator.syncActiveSetProgress() }
                .onChange(of: store.state.history.count) { _, _ in syncCoordinator.syncMostRecentFinishedSet() }
                .onChange(of: store.state.recordings.count) { _, _ in syncCoordinator.syncNewestRecording() }
                .onChange(of: scenePhase) { _, phase in if phase == .active { Task { await syncCoordinator.syncAll() } } }
                .task {
                    syncCoordinator.startObservingNetwork()
                    await syncCoordinator.syncAll()
                }
        }
        WindowGroup("Score", for: UUID.self) { $pieceID in
            NavigationStack {
                if let pieceID { ScoreWorkspace(pieceID: pieceID, onClose: nil) }
                else { ContentUnavailableView("Choose a score", systemImage: "music.note.list") }
            }
            .environment(store).environment(metronome).environment(speech).environment(runtime).environment(rewards)
            .environment(tuner).environment(drone).environment(recording)
            .environment(socialHooks)
            .preferredColorScheme(colorScheme)
            .tint(PraeludeColor.ink)
            .onChange(of: store.activeSet?.id) { _, _ in runtime.syncRecording(); runtime.syncPulseCheck(); syncCoordinator.syncActiveSetProgress() }
            .onChange(of: store.activeSet?.status) { _, _ in runtime.syncRecording(); runtime.syncPulseCheck(); syncCoordinator.syncActiveSetProgress() }
            .onChange(of: store.activeSet?.attempts.count) { _, _ in syncCoordinator.syncActiveSetProgress() }
            .onChange(of: store.activeSet?.attempts.filter { $0.undoneAt != nil }.count) { _, _ in syncCoordinator.syncActiveSetProgress() }
            .onChange(of: store.state.history.count) { _, _ in syncCoordinator.syncMostRecentFinishedSet() }
        }
    }
    private var colorScheme: ColorScheme? {
        switch store.state.preferences.theme { case "light": return .light; case "dark": return .dark; default: return nil }
    }
}

private enum Destination: String, CaseIterable, Identifiable {
    case today = "Today", pieces = "Pieces", friends = "Friends", warmups = "Warmups", progress = "Progress"
    case history = "History", calendar = "Calendar", notebook = "Notebook", insights = "Data"
    case rewards = "Rewards"
    var id: String { rawValue }
    var symbol: String {
        switch self {
        case .today: return "sun.max"
        case .pieces: return "music.note.list"
        case .friends: return "person.2"
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
    @Environment(AuthManager.self) private var auth
    @Environment(SocialService.self) private var social
    @Environment(PresenceService.self) private var presence
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
    /// One-shot hand-off for `TodayView.onStartPassage` (§9/R3 — see its own doc comment): which
    /// passage the score should arm as soon as it appears, so "Start session" lands on the same
    /// cold-grade prompt a manual on-score tap would. Cleared by `ScoreWorkspace.onAutoSelectConsumed`
    /// right after it is read, so it never re-fires on a later, unrelated visit to this piece.
    @State private var pendingAutoSelectPassage: (pieceID: UUID, passageID: UUID)?
    @State private var pendingBackupAction: String?
    @State private var sidebarVisibility = NavigationSplitViewVisibility.automatic
    @State private var backup: NativeBackupDocument?
    @State private var exporting = false
    @State private var importing = false
    @State private var pendingBackup: Data?
    @State private var confirmRestore = false
    @State private var error: String?
    @State private var pendingInviteCode: String?
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
                        }, sharedMarkup: scoreMarkup,
                        autoSelectPassageID: pendingAutoSelectPassage?.pieceID == selectedPiece ? pendingAutoSelectPassage?.passageID : nil,
                        onAutoSelectConsumed: { pendingAutoSelectPassage = nil }) }
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
                    NavigationStack {
                        ScoreWorkspace(pieceID: route.id, onClose: { navigateFromScore { phoneScore = nil } }, sharedMarkup: scoreMarkup,
                                       autoSelectPassageID: pendingAutoSelectPassage?.pieceID == route.id ? pendingAutoSelectPassage?.passageID : nil,
                                       onAutoSelectConsumed: { pendingAutoSelectPassage = nil })
                    }
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
        .onOpenURL { url in
            if url.scheme == AuthManager.authCallbackURLScheme, url.host == AuthManager.authCallbackHost {
                Task { await auth.handleAuthCallback(url: url) }
            } else if let code = InviteLink.code(from: url) {
                pendingInviteCode = code
            } else {
                incomingURL = url; sheet = .add
            }
        }
        .sheet(item: Binding(get: { pendingInviteCode.map { IdentifiableCode(value: $0) } }, set: { if $0 == nil { pendingInviteCode = nil } })) { code in
            InviteRedeemSheet(code: code.value)
        }
        .onChange(of: presenceSignal) { _, signal in presence.publish(isPracticing: signal.running, pieceID: signal.pieceID) }
        .onChange(of: auth.state) { _, state in
            if case .guest = state { presence.stopPublishing(); presence.stopObservingAll() }
        }
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
        case .today: TodayView(onOpenPiece: openPiece, onAddPiece: { sheet = .add }, onContinueWarmup: { practicingWarmup = true },
                               onStartPassage: startPassage)
        case .pieces: LibraryView(onOpenPiece: openPiece, onAddPiece: { sheet = .add })
        case .friends: FriendsView()
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
    /// §9/R3: `TodayView.onStartPassage` — open `pieceID` exactly like `openPiece`, but also stage
    /// `passageID` to be armed (not started) the moment the score appears, so a cold-eligible
    /// passage's grade prompt shows instead of silently skipping it.
    private func startPassage(pieceID: UUID, passageID: UUID) {
        pendingAutoSelectPassage = (pieceID, passageID)
        openPiece(pieceID)
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
    /// Drives `PresenceService.publish` (spec §5a "practicing now"): live while any set is actively
    /// running, anywhere in the app — not scoped to the Friends tab being visible, the same way the
    /// bottom-of-screen active-set dock above isn't. A plain `Bool`/`UUID?` pair wrapped in one
    /// `Equatable` struct so `onChange` fires once per real transition, not once per unrelated
    /// `PracticeStore` mutation.
    private var presenceSignal: PresenceSignal {
        PresenceSignal(running: store.activeSet?.status == .running, pieceID: store.activeSet?.configuration.pieceID)
    }
}

private struct PresenceSignal: Equatable { var running: Bool; var pieceID: UUID? }
private struct IdentifiableCode: Identifiable, Equatable { let value: String; var id: String { value } }

/// Confirms and redeems an invite link (spec §5b) opened from outside the app
/// (`praelude://invite/<code>`) or pasted/typed in. Redeeming implies mutual consent — the backend
/// goes straight to an accepted friendship, no separate accept step (see `redeem_invite_code` in
/// `supabase/migrations/20260926220006_social.sql`), so this sheet's own "Add friend" tap is the one
/// confirmation before that happens.
private struct InviteRedeemSheet: View {
    let code: String
    @Environment(SocialService.self) private var social
    @Environment(AuthManager.self) private var auth
    @Environment(\.dismiss) private var dismiss
    @State private var redeeming = false
    @State private var result: ProfileCard?
    @State private var error: String?

    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                Spacer()
                if case .signedIn = auth.state {
                    if let result {
                        PraeludeIcon(glyph: .verdictClean, size: 40).foregroundStyle(PraeludeColor.ink)
                        Text("You and \(result.displayNameOrUsernameOrFallback) are friends.").font(.headline)
                        Button("Done") { dismiss() }.buttonStyle(.praeludePrimary).frame(maxWidth: 260)
                    } else {
                        Text("Add friend from invite link?").font(.headline)
                        if let error { ErrorMessage(message: error) }
                        Button("Add friend") { Task { await redeem() } }.buttonStyle(.praeludePrimary).frame(maxWidth: 260).disabled(redeeming)
                        Button("Cancel") { dismiss() }.buttonStyle(.praeludeQuiet).frame(maxWidth: 260)
                    }
                } else {
                    Text("Sign in to accept this invite.").font(.headline)
                    NavigationLink("Account and sync") { AccountView() }.buttonStyle(.praeludePrimary).frame(maxWidth: 260)
                }
                Spacer()
            }
            .padding(24)
            .navigationTitle("Invite").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
        }
        .presentationDetents([.medium])
    }
    private func redeem() async {
        redeeming = true
        guard let friendID = await social.redeemInviteCode(code) else {
            redeeming = false; error = social.lastError ?? "That invite link isn't valid."
            return
        }
        result = await social.profileCard(for: friendID)
        redeeming = false
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
