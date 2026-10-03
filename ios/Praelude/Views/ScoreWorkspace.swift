import SwiftUI
import UniformTypeIdentifiers
import PencilKit

private enum ScoreSheet: String, Identifiable {
    case setup, passages, metronome, pages, voice, passageDetails, share, heatmap, bookmarks, links, pageTools, sections, measureMap
    var id: String { rawValue }
}

struct ScoreWorkspace: View {
    let pieceID: UUID
    let onClose: (() -> Void)?
    var sharedMarkup: ScoreMarkupState? = nil
    /// Today's "Start"/"Start session" (§15) hands a specific cold-eligible passage off here rather
    /// than starting it directly, so it goes through the exact same `selectPassage`/`arm` cold-grade
    /// path a manual on-score tap already does (see `TodayView.startItem`). Consumed once on appear.
    var autoSelectPassageID: UUID? = nil
    var onAutoSelectConsumed: () -> Void = {}
    /// §7 setlists: "open by movement" — a one-shot override for the page this score opens to,
    /// exactly like `autoSelectPassageID`/`onAutoSelectConsumed` above (a setlist item's own
    /// `startPage`, which previously was stored but never acted on).
    var initialPage: Int? = nil
    var onInitialPageConsumed: () -> Void = {}
    @Environment(PracticeStore.self) private var store
    @Environment(SyncCoordinator.self) private var syncCoordinator
    @Environment(MetronomeService.self) private var metronome
    @Environment(SpeechCommandService.self) private var speech
    @Environment(PracticeRuntime.self) private var runtime
    @Environment(SocialHooks.self) private var socialHooks
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.verticalSizeClass) private var verticalSizeClass
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.openWindow) private var openWindow
    @Environment(\.supportsMultipleWindows) private var supportsMultipleWindows
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.dismiss) private var dismiss
    @AppStorage("ios.feedback") private var feedbackEnabled = true
    private var showPassageBoxes: Bool { store.preferences.showPassageBoxes }
    private var compactScoreControls: Bool { store.preferences.compactScoreControls }
    private var autoTurnPassageAfterVerdict: Bool { store.preferences.autoTurnPassageAfterVerdict }
    private func preference<Value>(_ keyPath: WritableKeyPath<Preferences, Value>) -> Binding<Value> {
        Binding(get: { store.preferences[keyPath: keyPath] }, set: { value in
            perform { var updated = store.preferences; updated[keyPath: keyPath] = value; try store.updatePreferences(updated); syncCoordinator.pushPreferences() }
        })
    }
    /// §9 "onboarding voice setup... check recognition in room": previously reachable only from
    /// Settings, never from the point a player actually turns hands-free on for the first time. See
    /// "(C) Audit.md".
    @AppStorage("ios.voiceCheckedOnce") private var voiceCheckedOnce = false
    @State private var showFirstVoiceCheck = false
    @State private var voiceOwnerID = UUID()
    @State private var arm = PracticeArmController()
    @State private var page = 1
    @State private var localMarkup = ScoreMarkupState()
    private var markup: ScoreMarkupState { sharedMarkup ?? localMarkup }
    @State private var drawAfterDismiss: Passage?
    @State private var confirmDiscardSelection = false
    @State private var closeAfterDiscard = false
    @State private var selectedPassage: Passage?
    @State private var pendingPracticePassage: Passage?
    @State private var sheet: ScoreSheet?
    /// §11 R8: "after Sloppy, optional tap where it broke" — offers the tap-to-mark control below the
    /// HUD; `markup.breakPointArmed` is the separate "currently waiting for that tap on the score"
    /// state `ScorePageOverlay` reads.
    @State private var offerBreakPointTap = false
    @State private var focusMode = false
    /// §7 performance mode: a stronger focus that also hides the compact top row focus mode still
    /// shows (Exit focus/jump-back/page indicator) and disables ink, so the only surviving
    /// interaction is turning pages. Always implies `focusMode` (tap-zone-only turning, hidden
    /// navigation bar and practice dock) — see `enterPerformanceMode`/`exitPerformanceMode`.
    @State private var performanceMode = false
    @State private var showPerformanceExitHint = false
    @State private var twoPages = false
    @State private var halfPageTurns = false
    @State private var jumpBackStack: [Int] = []
    @State private var importing = false
    @State private var ending = false
    @State private var error: String?
    @State private var sharingURL: URL?
    @State private var editingTextBox: TextBoxAnnotation?
    /// §8: a long press landing on a saved passage's outline while reading (not performance mode,
    /// which uses the same gesture to exit) — drives `.passageQuickActions` below.
    @State private var longPressedPassage: Passage?
    private var piece: Piece? { store.state.pieces.first { $0.id == pieceID } }
    private var active: ActiveSet? { store.activeSet?.configuration.pieceID == pieceID ? store.activeSet : nil }
    private var scoreURL: URL? { piece.flatMap { NativeLibraryFiles(store: store).scoreURL(for: $0) } }
    // §8: `deletePassage` archives (tombstones) rather than erasing, so every list must filter it out.
    private var savedPassages: [Passage] { store.state.passages.filter { $0.pieceID == pieceID && !$0.archived } }
    private var visibleRegions: [PassageRegion] {
        let snapshot = active?.configuration.passageSnapshot?.regions ?? []
        let snapshotIDs = Set(snapshot.map(\.id))
        return savedPassages.flatMap(\.regions).filter { !snapshotIDs.contains($0.id) } + snapshot
    }
    private var emphasizedIDs: Set<UUID> { Set((active?.configuration.passageSnapshot ?? selectedPassage)?.regions.map(\.id) ?? []) }
    /// §7 page tools: this piece's own page edits. Empty for the overwhelmingly common piece that
    /// has never touched a page tool, in which case `PagedScoreView` reads the source PDF directly.
    private var effectivePageEdits: [PageEdit] { store.state.pageEdits.filter { $0.pieceID == pieceID } }
    /// §7 links: `sourcePage`/`targetPage` are *displayed* page numbers (see "(C) Schema3.md").
    private var effectiveScoreLinks: [ScoreLink] { store.state.scoreLinks.filter { $0.pieceID == pieceID && $0.deletedAt == nil } }
    private var effectivePageCount: Int { PageLayout.effectiveCount(pageEdits: effectivePageEdits, pieceID: pieceID, sourcePageCount: piece?.pageCount ?? 0) }
    /// §7 page tools: this piece's effective reading order — the same one `PagedScoreView.Coordinator`
    /// independently computes from the identical inputs, so the two always agree on what a source vs.
    /// a displayed page number means. `page` (this view's own `@State`) is always a *displayed* page
    /// number (`PagedScoreView` navigates its composed/display document by it); a stored mark's own
    /// `.page` (`PassageRegion`, ink) is always a *source* page number (see "(C) Schema3.md") — the two
    /// must never be assigned to each other directly.
    private var effectivePages: [EffectivePage] { PageLayout.effectivePages(pageEdits: effectivePageEdits, pieceID: pieceID, sourcePageCount: piece?.pageCount ?? 0) }
    /// The displayed page a source-page-anchored mark currently shows on, for navigating *to* it.
    /// Falls back to `source` itself, exactly right for the overwhelmingly common piece with no page
    /// edits (identity order, where source and display always coincide).
    private func displayPage(forSourcePage source: Int) -> Int { effectivePages.first { $0.sourcePage == source }?.displayOrder ?? source }
    /// The inverse, for comparing the page currently on screen *against* stored source pages. `nil`
    /// for a generated blank/staff display page, which has no source page to compare against at all.
    private func sourcePage(forDisplayPage display: Int) -> Int? {
        guard !effectivePages.isEmpty else { return display }
        guard display >= 1, display <= effectivePages.count else { return nil }
        return effectivePages[display - 1].sourcePage
    }
    private var practicedIDs: Set<UUID> {
        let practiced = Dictionary(grouping: (store.state.history + [active].compactMap { $0 }).filter { !$0.effectiveAttempts.isEmpty }
            .compactMap(\.configuration.passageSnapshot).flatMap(\.regions), by: \.id)
        return Set(visibleRegions.filter { practiced[$0.id]?.contains($0) == true }.map(\.id))
    }
    // §8 recolor: every saved passage's chosen color, keyed by region so ScorePageOverlay can paint
    // a box in the color its own passage (not necessarily the practicing one) was given.
    private var passageColors: [UUID: String] {
        var colors: [UUID: String] = [:]
        for passage in savedPassages { guard let color = passage.color else { continue }; for region in passage.regions { colors[region.id] = color } }
        return colors
    }
    private var visibleStamps: [StampAnnotation] { store.state.stampAnnotations.filter { $0.pieceID == pieceID && $0.deletedAt == nil } }
    private var visibleTextBoxes: [TextBoxAnnotation] { store.state.textAnnotations.filter { $0.pieceID == pieceID && $0.deletedAt == nil } }
    /// §7: the active layer's ink, merged back into one blob for `PagedScoreView`'s existing
    /// whole-canvas conflict-check/load boundary — `persistInk` below is what actually splits a
    /// save back into true per-stroke rows, so storage is per-stroke even though this boundary still
    /// speaks one `Data` blob per page (see "(C) Schema3.md" — the compatibility shim's replacement).
    ///
    /// **Cached, deliberately.** `InkPerStroke.merge` rebuilds a fresh `PKDrawing(strokes:)` on every
    /// call, which — per that type's own doc comment — embeds a new random value each time,
    /// independent of content. Called twice in a row against *unchanged* storage it therefore never
    /// returns equal bytes. Every optimistic-concurrency check that reads this function
    /// (`persistInk`'s guard below, and `PagedScoreView.Coordinator.refresh`'s "did storage change
    /// elsewhere" comparison) is a `==`/`!=` against a value captured from an earlier call, so without
    /// this cache a page that already has one saved stroke could never save a second edit — every
    /// later save would see its own unrelated re-serialization noise as a false "changed elsewhere"
    /// conflict. Keyed by the stored rows' own stable identity (id + content), mirroring
    /// `PagedScoreView.Coordinator.refreshOtherLayersImage`'s existing signature-cache idiom for this
    /// exact same instability one layer up (the read-only underlay image).
    @State private var mergedInkCache: [String: (signature: Int, data: Data?)] = [:]
    private func mergedInkData(_ page: Int) -> Data? {
        let rows = store.inkStrokes(pieceID: pieceID, page: page, layer: markup.activeLayer)
        var signature = rows.count &* 31
        for row in rows { signature = signature ^ row.id.hashValue ^ (row.fingerprint ?? row.data).hashValue }
        let key = "\(pieceID)|\(page)|\(markup.activeLayer.rawValue)"
        if let cached = mergedInkCache[key], cached.signature == signature { return cached.data }
        let data = rows.isEmpty ? nil : try? InkPerStroke.merge(rows.map(\.data)).dataRepresentation()
        mergedInkCache[key] = (signature, data)
        return data
    }
    /// Every visible layer other than the active one, flattened for `ScorePageOverlay`'s read-only
    /// underlay (§7 "layers mine/teacher/performance show/hide").
    private func otherLayersInk(_ page: Int) -> [Data] {
        InkLayer.allCases.filter { $0 != markup.activeLayer && markup.visibleLayers.contains($0) }
            .flatMap { store.inkStrokes(pieceID: pieceID, page: page, layer: $0).map(\.data) }
    }
    var body: some View {
        Group {
            if let piece {
                GeometryReader { geometry in
                    ZStack {
                        if let scoreURL, FileManager.default.fileExists(atPath: scoreURL.path) {
                            // Pinned paper-white, not the paper/stage token: the score stays paper in both appearances.
                            PraeludeColor.scorePaper
                            scoreView(url: scoreURL)
                        } else {
                            PraeludeColor.paper
                            ContentUnavailableView {
                                Label(piece.pdfFileName == nil ? "No score attached" : "Score unavailable", systemImage: "pianokeys")
                            } description: {
                                Text(piece.pdfFileName == nil ? "Practice from a paper score, or add a PDF to keep your music here." : "The saved PDF could not be opened. Choose the score again to keep practicing.")
                            } actions: {
                                Button("Add score PDF") { importing = true }.buttonStyle(.praeludeQuiet).frame(maxWidth: 220)
                            }
                        }
                    }
                    .safeAreaInset(edge: .top, spacing: 0) {
                        if markup.mode != .reading {
                            markupHeader
                        } else if performanceMode {
                            EmptyView()
                        } else if focusMode {
                            HStack {
                                Button(action: closeScore) { Image(systemName: "chevron.left").frame(width: 44, height: 44) }.accessibilityLabel("Close score")
                                Button { focusMode = false } label: { Label("Exit focus", systemImage: "arrow.down.right.and.arrow.up.left") }.buttonStyle(.praeludeQuiet).fixedSize()
                                Spacer()
                                jumpBackButton
                                pageControls(compact: true)
                            }.padding(.horizontal, 16).padding(.vertical, 8).praeludeScoreChrome()
                        }
                    }
                    .safeAreaInset(edge: .bottom, spacing: 0) {
                        if markup.mode == .selecting {
                            selectionTools
                        } else if markup.mode == .writing {
                            writingTools
                        } else if markup.mode == .reading && focusMode && !performanceMode {
                            // "Focus on score" must still leave Stop/Undo/the metronome toggle and a
                            // verdict fallback one tap away (§3d) — only true performance mode ("the
                            // only surviving interaction is turning pages") hides the dock entirely.
                            // Collapsing the HUD first (its own, separately reachable control) is how
                            // a player recovers the vertical space this used to free by hiding
                            // everything — see "(C) Audit.md".
                            if active != nil { withFeedback { practiceDock } }
                        } else if markup.mode == .reading && !focusMode {
                            if dynamicTypeSize.isAccessibilitySize {
                                withFeedback {
                                    ScrollView {
                                        practiceDock.fixedSize(horizontal: false, vertical: true)
                                    }
                                    .frame(height: min(520, geometry.size.height * 0.6))
                                    .accessibilityIdentifier("accessiblePracticeControls")
                                }
                            } else { withFeedback { practiceDock } }
                        }
                    }
                }
                .navigationTitle(piece.title).navigationBarTitleDisplayMode(.inline)
                .navigationBarBackButtonHidden(true)
                .toolbar(focusMode || performanceMode ? .hidden : .visible, for: .navigationBar)
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        Button(action: closeScore) { Label("Library", systemImage: "chevron.left").font(.subheadline).frame(minHeight: 44) }
                            .accessibilityLabel("Close score").accessibilityIdentifier("closeScore")
                    }
                    ToolbarItemGroup(placement: .topBarTrailing) {
                        Button { sheet = .metronome } label: { PraeludeIcon(glyph: .metronome, size: 22).frame(width: 44, height: 44).contentShape(Rectangle()) }
                            .accessibilityLabel("Metronome").accessibilityIdentifier("openMetronome")
                        Menu {
                            Button { performanceMode = false; focusMode = true } label: { Label("Focus on score", systemImage: "arrow.up.left.and.arrow.down.right") }
                            Button { enterPerformanceMode() } label: { Label("Performance mode · hold score to exit", systemImage: "rectangle.compress.vertical") }
                                .accessibilityIdentifier("performanceMode")
                            if sizeClass == .regular {
                                Toggle("Two pages", isOn: $twoPages).praeludeToggleHaptic(twoPages)
                                if twoPages { Toggle("Half-page turns", isOn: $halfPageTurns).praeludeToggleHaptic(halfPageTurns) }
                                if supportsMultipleWindows { Button("Open score in new window", systemImage: "rectangle.on.rectangle") { openWindow(value: pieceID) } }
                            }
                            Button("Passages", systemImage: "bookmark") { sheet = .passages }
                            Button("Draw a passage", systemImage: "rectangle.dashed") { beginSelection(nil) }
                            Button("Bookmarks", systemImage: "bookmark.fill") { sheet = .bookmarks }
                            Button("Links", systemImage: "arrow.triangle.turn.up.right.diamond") { sheet = .links }
                            if !jumpBackStack.isEmpty { Button("Jump back to page \(jumpBackStack.last ?? page)", systemImage: "arrow.uturn.backward") { jumpBack() } }
                            Button("Movements & pieces", systemImage: "list.bullet.rectangle") { sheet = .sections }
                            Button("Measure map", systemImage: "number.square") { sheet = .measureMap }
                            Button("Page tools", systemImage: "square.stack") { sheet = .pageTools }
                            Toggle("Show passage boxes", isOn: preference(\.showPassageBoxes))
                            Toggle("Compact score controls", isOn: preference(\.compactScoreControls))
                            if let selectedPassage {
                                Button("Edit passage boxes", systemImage: "rectangle.and.pencil.and.ellipsis") { beginSelection(selectedPassage) }
                                Button("Passage details", systemImage: "slider.horizontal.3") { sheet = .passageDetails }
                                Button("Practice whole piece", systemImage: "doc") { self.selectedPassage = nil }
                            }
                            Button(speech.isListening ? "Turn voice off" : "Hands-free commands", systemImage: speech.isListening ? "mic.slash" : "mic") {
                                if speech.isListening { speech.stop() } else { sheet = .voice }
                            }
                            Button("Practice results on score", systemImage: "square.grid.3x3.fill") { sheet = .heatmap }
                                .disabled(scoreURL == nil)
                            Toggle("Turn passage page after each verdict", isOn: preference(\.autoTurnPassageAfterVerdict))
                            Button("Replace score PDF", systemImage: "doc.badge.plus") { importing = true }
                            Button("Share annotated score", systemImage: "square.and.arrow.up") {
                                guard markup.flushInk() else { return }
                                perform { sharingURL = try ScoreExport.annotatedPDF(pieceID: pieceID, store: store); sheet = .share }
                            }.disabled(scoreURL == nil)
                            if active != nil { Button("End practice", systemImage: "stop.circle", role: .destructive) { ending = true } }
                        } label: { Image(systemName: "ellipsis").frame(width: 44, height: 44).contentShape(Rectangle()) }.accessibilityLabel("Score options")
                    }
                }
            } else { ContentUnavailableView("Piece unavailable", systemImage: "music.note") }
        }
        // §7 performance mode: hides literally everything else the system itself would still draw
        // over the score — the status bar and the home-indicator/Dynamic Island's persistent
        // overlays — on top of the app's own chrome already hidden above.
        .statusBarHidden(performanceMode)
        .persistentSystemOverlays(performanceMode ? .hidden : .automatic)
        .overlay(alignment: .bottom) {
            if performanceMode && showPerformanceExitHint {
                Text("Touch and hold the score to exit performance mode")
                    .font(.subheadline.weight(.medium)).multilineTextAlignment(.center)
                    .padding(12).praeludeScoreChrome()
                    .clipShape(RoundedRectangle(cornerRadius: 12)).padding(16)
                    .allowsHitTesting(false).accessibilityIdentifier("performanceExitHint")
            }
        }
        .task(id: performanceMode) {
            guard performanceMode else { showPerformanceExitHint = false; return }
            showPerformanceExitHint = true
            try? await Task.sleep(for: .seconds(4))
            guard !Task.isCancelled else { return }
            showPerformanceExitHint = false
        }
        .sheet(item: $sheet, onDismiss: {
            if let sharingURL { try? FileManager.default.removeItem(at: sharingURL.deletingLastPathComponent()); self.sharingURL = nil }
            if let passage = drawAfterDismiss { drawAfterDismiss = nil; markup.begin(passage, baseline: savedPassages.first { $0.id == passage.id }) }
        }) { item in
            switch item {
            case .setup: SetComposerView(pieceID: pieceID, passage: selectedPassage,
                                         initialConfiguration: arm.configuration,
                                         onConfigured: { arm.applyConfigurationOverride($0) }, onStarted: { refreshAudio() })
            case .passages: PassagePickerView(pieceID: pieceID, currentPage: sourcePage(forDisplayPage: page) ?? 0,
                                              selectedPassageID: selectedPassage?.id, onSelect: selectPassage,
                                              onDraw: { passage in drawAfterDismiss = passage ?? newPassage() })
            case .passageDetails:
                if let selectedPassage {
                    NavigationStack {
                        PassageEditorView(passage: selectedPassage, pageCount: max(1, piece?.pageCount ?? 1)) {
                            self.selectedPassage = store.state.passages.first { $0.id == selectedPassage.id }; sheet = nil
                        }.toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { sheet = nil } } }
                    }
                }
            case .metronome: MetronomeView()
            case .pages: if let scoreURL { ScorePagePicker(url: scoreURL, pageEdits: effectivePageEdits, currentPage: page, onSelect: { if markup.flushInk() { page = $0; savePage($0) } }) }
            case .voice: voiceSheet
            case .share: if let sharingURL { ScoreShareView(url: sharingURL) }
            case .heatmap: if let scoreURL { ScoreHeatmapView(pieceID: pieceID, url: scoreURL, startPage: page) }
            case .bookmarks: BookmarksView(pieceID: pieceID, currentPage: page, onJump: { if markup.flushInk() { page = $0; savePage($0) } })
            case .links: ScoreLinksView(pieceID: pieceID, pageCount: max(1, effectivePageCount), currentPage: page)
            case .pageTools: PageToolsView(pieceID: pieceID, pageCount: max(1, piece?.pageCount ?? 1))
            case .sections: ScoreSectionsView(pieceID: pieceID, onOpenPage: { source in
                if markup.flushInk() { page = displayPage(forSourcePage: source); savePage(page) }
            })
            case .measureMap: ScoreMeasureMapView(pieceID: pieceID, currentPage: sourcePage(forDisplayPage: page) ?? 1)
            }
        }
        .confirmationDialog("Switch practice passage?", isPresented: Binding(get: { pendingPracticePassage != nil }, set: { if !$0 { pendingPracticePassage = nil } }), titleVisibility: .visible, presenting: pendingPracticePassage) { passage in
            Button("Finish current set and switch") {
                do {
                    try store.endSet()
                    metronome.stop()
                    selectIdlePassage(passage)
                    pendingPracticePassage = nil
                } catch { self.error = error.localizedDescription }
            }
            Button("Keep current passage", role: .cancel) { pendingPracticePassage = nil }
        } message: { passage in Text("Saved repetitions stay with the current passage. Then prepare \(passage.title).") }
        .confirmationDialog("Discard these passage edits?", isPresented: $confirmDiscardSelection, titleVisibility: .visible) {
            Button("Discard edits", role: .destructive) {
                markup.finish()
                if closeAfterDiscard { closeAfterDiscard = false; if let onClose { onClose() } else { dismiss() } }
            }
            Button("Keep editing", role: .cancel) { closeAfterDiscard = false }
        }
        .confirmationDialog("Ink changed in another window", isPresented: Binding(get: { markup.conflictPage != nil }, set: { if !$0 { markup.conflictPage = nil } }), titleVisibility: .visible, presenting: markup.conflictPage) { page in
            Button("Keep my drawing") { markup.resolveInkConflict(page, true) }
            Button("Use the saved drawing", role: .destructive) { markup.resolveInkConflict(page, false) }
            Button("Keep editing", role: .cancel) { markup.conflictPage = nil }
        } message: { _ in Text("Both windows edited this page. Choose which drawing to keep. Your unsaved drawing stays open until you decide.") }
        .passageQuickActions(target: $longPressedPassage, allPassages: savedPassages, pageCount: piece?.pageCount ?? 1, onEditBoxes: { beginSelection($0) })
        .fileImporter(isPresented: $importing, allowedContentTypes: [.pdf]) { result in
            guard let piece else { return }
            perform {
                let url = try result.get()
                _ = try NativeLibraryFiles(store: store).importPDF(url, title: piece.title, composer: piece.composer, replacing: piece)
                page = 1
            }
        }
        .sheet(item: $editingTextBox) { box in
            let isSaved = store.state.textAnnotations.contains { $0.id == box.id }
            TextBoxEditorView(text: box.text, onSave: { text in
                do {
                    try store.saveTextAnnotation(TextBoxAnnotation(id: box.id, pieceID: box.pieceID, page: box.page, region: box.region,
                                                                  text: text, layer: box.layer, createdAt: box.createdAt))
                    return true
                } catch { self.error = error.localizedDescription; return false }
            }, onDelete: isSaved ? {
                do { try store.deleteTextAnnotation(box.id); return true }
                catch { self.error = error.localizedDescription; return false }
            } : nil)
        }
        .confirmationDialog("End this practice session?", isPresented: $ending, titleVisibility: .visible) {
            Button("End practice", role: .destructive) { perform { try endSessionAndShare(); metronome.stop(); speech.stop() } }
            Button("Cancel", role: .cancel) {}
        } message: { Text("Your repetitions and time stay saved. Unfinished work remains in your history.") }
        .alert("Couldn’t complete that", isPresented: Binding(get: { error != nil }, set: { if !$0 { error = nil } })) { Button("OK") { error = nil } } message: { Text(error ?? "") }
        .onAppear {
            page = min(max(1, initialPage ?? piece?.lastPage ?? 1), max(1, effectivePageCount))
            if initialPage != nil { savePage(page); onInitialPageConsumed() }
            markup.showPassageBoxes = showPassageBoxes
            markup.onConfirmSelection = saveSelection
            runtime.scoreAppeared(ownerID: voiceOwnerID)
            if let autoSelectPassageID, let target = savedPassages.first(where: { $0.id == autoSelectPassageID }) {
                selectPassage(target)
                onAutoSelectConsumed()
            } else {
                rearmIfIdle()
            }
        }
        .onDisappear { _ = markup.flushInk(); speech.stop(ifOwnedBy: voiceOwnerID); runtime.scoreDisappeared(ownerID: voiceOwnerID) }
        .onChange(of: pieceID) { _, _ in
            markup.onConfirmSelection = saveSelection
            markup.showPassageBoxes = showPassageBoxes
            if markup.flushInk() { markup.finish() }
            page = piece?.lastPage ?? 1; selectedPassage = nil; jumpBackStack = []; speech.stop(ifOwnedBy: voiceOwnerID); arm.clearArm()
            offerBreakPointTap = false; markup.breakPointArmed = false
        }
        .onChange(of: showPassageBoxes) { _, value in markup.showPassageBoxes = value }
        .onChange(of: scenePhase) { _, phase in if phase != .active { _ = markup.flushInk() } }
        .onChange(of: markup.errorMessage) { _, message in if let message { error = message; markup.errorMessage = nil } }
        .onChange(of: markup.pendingQuickBox) { _, box in
            guard let box else { return }
            createQuickSubPassage(box); markup.pendingQuickBox = nil
        }
        .onChange(of: store.state.passages) { _, passages in
            if let selectedPassage { self.selectedPassage = passages.first { $0.id == selectedPassage.id } }
        }
        .onChange(of: active?.currentBPM) { _, _ in refreshAudio() }
        .onChange(of: active?.status) { _, newStatus in
            refreshAudio(); runtime.updateScreenAwake()
            if newStatus == .completed { offerBreakPointTap = false; markup.breakPointArmed = false }
            if newStatus == .completed, let active { arm.computeAfterSet(active, store: store) }
            // Covers every path back to "no active set for this piece" in one place — Finish,
            // relaunching mid-set and then finishing, a different window ending the set, and so
            // on — not just the touch actions below that already rearm explicitly. Without this,
            // a `PracticeArmController` created fresh by a relaunch (`.onAppear`'s own
            // `rearmIfIdle()` correctly declines to arm while a set is still paused/running) would
            // otherwise stay unarmed forever once that set later completes.
            if newStatus == nil { rearmIfIdle() }
        }
        .background {
            Button("Toggle metronome") {
                if let set = store.activeSet, !set.isComplete { metronome.setTempo(set.currentBPM) }
                metronome.toggle()
            }.keyboardShortcut(.space, modifiers: [])
                .frame(width: 0, height: 0).opacity(0).accessibilityHidden(true)
        }
    }
    /// Split out of `body` — with every page-tools/link parameter inlined, the containing
    /// `GeometryReader`/`ZStack` expression was too large for the type checker to solve in one pass.
    @ViewBuilder private func scoreView(url: URL) -> some View {
        PagedScoreView(url: url, page: $page, twoPages: twoPages && sizeClass == .regular, focusPageTurns: focusMode, markup: markup,
                       allowsInk: !performanceMode, activeLayer: markup.activeLayer,
                       regions: visibleRegions, regionColors: passageColors, emphasizedIDs: emphasizedIDs, practicedIDs: practicedIDs,
                       pageEdits: effectivePageEdits, scoreLinks: effectiveScoreLinks, onLinkActivated: activateLink,
                       stamps: visibleStamps, textBoxes: visibleTextBoxes, otherLayersInkData: otherLayersInk,
                       drawingData: mergedInkData, saveDrawing: persistInk, onRegionSelected: onRegionSelected,
                       onPlaceStamp: placeStamp, onPlaceTextBox: placeTextBox, onPlaceBreakPoint: placeBreakPointTap, onEditTextBox: { editingTextBox = $0 },
                       onTurnPage: turnPage, onLongPress: handleLongPress, onPageChanged: savePage)
            .accessibilityIdentifier("scorePDF")
    }
    private func onRegionSelected(_ id: UUID) {
        guard let tapped = savedPassages.first(where: { $0.regions.contains { $0.id == id } }) else { return }
        selectPassage(tapped)
    }
    private var markupHeader: some View {
        HStack(spacing: 8) {
            Text(markup.mode == .selecting ? "\(markup.regions.count) \(markup.regions.count == 1 ? "box" : "boxes")" : markup.fingerDrawing ? "Finger drawing on" : "Pencil writes · fingers navigate")
                .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                .accessibilityIdentifier("markupStatus")
            Spacer(minLength: 0)
            pageControls(compact: true)
        }.padding(.horizontal, 12).praeludeScoreChrome()
    }
    private var writingTools: some View {
        VStack(spacing: 2) {
            AnnotationToolbar(markup: markup, simplifiedLabels: verticalSizeClass == .compact || dynamicTypeSize.isAccessibilitySize,
                              onRemoveSelectedStamp: removeSelectedStamp)
            scoreModeControls
        }.padding(.horizontal, 12).praeludeScoreChrome()
    }
    private var scoreModeControls: some View {
        HStack(spacing: 4) {
            Button { sheet = .passages } label: { Image(systemName: "bookmark").frame(width: 44, height: 44) }
                .accessibilityLabel("Passages").accessibilityIdentifier("passages")
            if markup.mode == .reading { pageControls(compact: true) }
            Spacer(minLength: 0)
            Button { returnToPractice() } label: {
                Image(systemName: markup.mode == .writing ? "checkmark" : "play.rectangle").frame(width: 44, height: 44)
                    .background(markup.mode == .reading ? Color.primary.opacity(0.08) : .clear, in: RoundedRectangle(cornerRadius: 9))
            }.accessibilityLabel(markup.mode == .writing ? "Done" : "Practice mode")
                .accessibilityIdentifier(markup.mode == .writing ? "finishScoreMarkup" : "scorePracticeMode")
            Button { beginSelection(nil) } label: {
                Image(systemName: "rectangle.dashed").frame(width: 44, height: 44)
            }.accessibilityLabel("Draw passage").accessibilityIdentifier("drawPassageOnScore")
            Button { beginWriting() } label: {
                Image(systemName: "pencil.tip.crop.circle").frame(width: 44, height: 44)
                    .background(markup.mode == .writing ? Color.primary.opacity(0.08) : .clear, in: RoundedRectangle(cornerRadius: 9))
            }.accessibilityLabel("Annotate score").accessibilityIdentifier("annotateScore")
        }.font(.system(size: 18))
    }
    private func returnToPractice() {
        if markup.mode == .selecting { confirmDiscardSelection = true; return }
        guard markup.flushInk() else { return }
        markup.stampDraft = nil
        if !markup.tool.kind.isInkingTool { markup.tool.kind = .pen }
        markup.mode = .reading
    }
    private func closeScore() {
        guard markup.flushInk() else { return }
        if markup.mode == .selecting { closeAfterDiscard = true; confirmDiscardSelection = true; return }
        markup.stampDraft = nil
        if let onClose { onClose() } else { dismiss() }
    }
    private var selectionTools: some View {
        VStack(spacing: 2) {
            if verticalSizeClass != .compact && !dynamicTypeSize.isAccessibilitySize {
                Text("Drag a box. Double-tap the score or tap Done to save.")
                    .font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.center)
            }
            HStack(spacing: 6) {
                Button { markup.undoSelection() } label: {
                    Image(systemName: "arrow.uturn.backward").font(.system(size: 20))
                        .frame(width: 44, height: 44).contentShape(Rectangle())
                }
                .disabled(!markup.canUndoSelection).accessibilityLabel("Undo")
                .accessibilityIdentifier("undoBox")
                Button { markup.redoSelection() } label: {
                    Image(systemName: "arrow.uturn.forward").font(.system(size: 20))
                        .frame(width: 44, height: 44).contentShape(Rectangle())
                }
                .disabled(!markup.canRedoSelection).accessibilityLabel("Redo")
                .accessibilityIdentifier("redoBox")
                Spacer(minLength: 0)
                Button { markup.removeSelected() } label: {
                    Image(systemName: "trash").font(.system(size: 20))
                        .frame(width: 44, height: 44).contentShape(Rectangle())
                }
                .disabled(markup.selectedRegionID == nil).accessibilityLabel("Remove selected box")
                .accessibilityIdentifier("removeBox")
                Button("Cancel") { confirmDiscardSelection = true }.frame(minWidth: 44, minHeight: 44)
                Button("Done") { saveSelection() }.fontWeight(.semibold).frame(minWidth: 52, minHeight: 44)
                    .disabled(markup.regions.isEmpty).accessibilityIdentifier("finishScoreMarkup")
            }
        }.padding(.horizontal, 12).padding(.top, 2).praeludeScoreChrome()
    }
    private func newPassage() -> Passage {
        let count = savedPassages.count + 1
        let palette = ["blue", "green", "purple", "orange", "red"]
        return Passage(pieceID: pieceID, title: "Passage \(count)", page: sourcePage(forDisplayPage: page) ?? 1,
                       color: palette[(count - 1) % palette.count])
    }
    private func beginSelection(_ passage: Passage?) {
        focusMode = false
        guard scoreURL != nil else { importing = true; return }
        guard markup.flushInk() else { return }
        markup.stampDraft = nil
        markup.begin(passage ?? newPassage(), baseline: passage)
    }
    private func beginWriting() {
        guard scoreURL != nil else { importing = true; return }
        guard markup.flushInk() else { return }
        if markup.mode == .selecting { confirmDiscardSelection = true; return }
        focusMode = false; markup.quickBoxArmed = false; markup.breakPointArmed = false; markup.mode = .writing
    }
    private func saveSelection() {
        guard var draft = markup.draft, !draft.regions.isEmpty else { return }
        perform {
            draft.page = draft.regions.map(\.page).min() ?? page
            if let piece, let range = ScoreOrganization.measureRange(for: draft.regions, in: piece) {
                draft.startMeasure = range.lowerBound; draft.endMeasure = range.upperBound
            }
            draft.updatedAt = Date()
            try store.savePassage(draft, replacing: markup.baseline)
            selectedPassage = draft; markup.finish()
            rearmIfIdle()
        }
    }
    /// §7 "true per-stroke storage": splits the canvas's current whole-page drawing into one row per
    /// `PKStroke` (`InkPerStroke.split`) before writing, so an unchanged stroke keeps its own stable
    /// id/`createdAt` (`PracticeStore.replaceInk`'s content diff) and a legacy coarse row is replaced
    /// by its fine-grained equivalent losslessly the next time that page is saved.
    private func persistInk(_ page: Int, _ data: Data, _ expected: Data?) -> Bool {
        do {
            guard mergedInkData(page) == expected else { markup.conflictPage = page; return false }
            // `reusing:` lets an unchanged stroke keep its own previously-stored bytes instead of a
            // fresh (but pointlessly different) re-serialization — see InkPerStroke's own doc.
            let existingRows = store.inkStrokes(pieceID: pieceID, page: page, layer: markup.activeLayer)
            let strokes = data.isEmpty ? [] : InkPerStroke.split(try PKDrawing(data: data), reusing: existingRows)
            try store.replaceInk(pieceID: pieceID, page: page, layer: markup.activeLayer, strokes: strokes)
            return true
        } catch { markup.errorMessage = "Ink could not be saved. \(error.localizedDescription)"; return false }
    }
    private func placeStamp(_ page: Int, _ position: NormalizedRect) -> Bool {
        guard let armed = markup.armedStamp else { return false }
        do {
            try store.saveStampAnnotation(StampAnnotation(pieceID: pieceID, page: page, position: position,
                                                           kind: armed.kind, label: armed.label, layer: markup.activeLayer))
            return true
        } catch { self.error = error.localizedDescription; return false }
    }
    private func placeTextBox(_ page: Int, _ position: NormalizedRect) {
        editingTextBox = TextBoxAnnotation(pieceID: pieceID, page: page, region: position, text: "", layer: markup.activeLayer)
    }
    /// §11 R8: "after Sloppy, optional tap where it broke." `active`'s own passage (not
    /// `selectedPassage`, which can drift once a set is running against a snapshot — e.g. after §8's
    /// quick-create) is what a fired R8 decision, and the next `computeAfterSet`, actually key off of.
    private func placeBreakPointTap(_ page: Int, _ position: NormalizedRect) {
        markup.breakPointArmed = false
        offerBreakPointTap = false
        guard let passageID = active?.configuration.passageID else { return }
        perform { try store.recordBreakPointTap(BreakPointTap(passageID: passageID, location: position)) }
    }
    private func removeSelectedStamp() {
        guard let id = markup.selectedStampID else { return }
        perform { try store.deleteStampAnnotation(id) }
        markup.selectedStampID = nil
    }
    /// §8 "quick-create a sub-passage by drawing a box while practicing": the box drawn on
    /// `markup.pendingQuickBox` becomes a brand-new passage, a child of whatever is currently
    /// selected (or piece-level if practicing the whole piece), inheriting its focus/color but
    /// starting its own fresh learning history (no practice evidence exists for it yet).
    private func createQuickSubPassage(_ region: PassageRegion) {
        perform {
            let parent = selectedPassage
            let siblingCount = savedPassages.filter { $0.parentPassageID == parent?.id }.count
            let title = parent.map { "\($0.title) — spot \(siblingCount + 1)" } ?? "New spot \(siblingCount + 1)"
            var passage = Passage(pieceID: pieceID, title: title, page: region.page, focus: parent?.focus ?? "Pulse",
                                  regions: [region], color: parent?.color ?? "blue", parentPassageID: parent?.id)
            if let piece, let range = ScoreOrganization.measureRange(for: [region], in: piece) {
                passage.startMeasure = range.lowerBound; passage.endMeasure = range.upperBound
            }
            try store.savePassage(passage)
        }
    }
    /// Feedback stays inside the dock's existing bounds. Inserting a new row into the score's
    /// safe-area inset changed PDFKit's fit scale on every repetition, moving the notation just as
    /// the pianist started the next try. This overlay never changes the score viewport.
    @ViewBuilder private func withFeedback<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        content().overlay(alignment: .top) {
            PracticeFeedbackView(feedback: runtime.feedback, setID: active?.id).allowsHitTesting(false)
        }
    }
    @ViewBuilder private var practiceDock: some View {
        VStack(spacing: compactScoreControls ? 4 : 12) {
            if markup.quickBoxArmed {
                HStack {
                    Text("Drag on the score to mark this spot.").font(.caption).foregroundStyle(PraeludeColor.inkSecondary)
                    Spacer(minLength: 8)
                    Button("Cancel") { markup.quickBoxArmed = false }.font(.caption.weight(.semibold)).accessibilityIdentifier("cancelQuickSubPassage")
                }
            }
            // §11 R8: "after Sloppy, optional tap where it broke" — three clustered taps across sets
            // offer a split. Never forced: Skip (or simply moving on) leaves nothing recorded.
            if markup.breakPointArmed {
                HStack {
                    Text("Tap the score to mark where it broke.").font(.caption).foregroundStyle(PraeludeColor.inkSecondary)
                    Spacer(minLength: 8)
                    Button("Cancel") { markup.breakPointArmed = false }.font(.caption.weight(.semibold)).accessibilityIdentifier("cancelBreakPointTap")
                }
            }
            if let active {
                PracticeHUDView(
                    // §10c: the passage actually being practiced, not the set's focus text or its
                    // current variant stage name — those already show one row down. A whole-piece set
                    // (no `passageSnapshot`) falls back to the piece title, never a blank line. See
                    // "(C) Audit.md" (commit 325871f's claim of always-the-passage-name did not hold
                    // at this call site).
                    active: active, passageTitle: active.configuration.passageSnapshot?.title ?? piece?.title ?? active.configuration.focus, arm: arm,
                    speech: speech, voiceOwnerID: voiceOwnerID, flashedCommand: VoiceConfirmationPlayer.shared.lastCommand,
                    flashedCommandID: VoiceConfirmationPlayer.shared.lastCommandID,
                    onVerdict: record, onUndo: { perform { try runtime.undo() } }, onTogglePause: togglePause,
                    onStop: stopPractice, onFinishSession: { perform { try endSessionAndShare(); metronome.stop() } },
                    onAnotherSet: repeatSet,
                    onToggleMetronome: {
                        if let set = store.activeSet, !set.isComplete { metronome.setTempo(set.currentBPM) }
                        metronome.toggle()
                    }, metronomeOn: metronome.isPlaying,
                    onAdjustTempo: adjustRunningTempo,
                    onMuteVoice: { speech.setMuted(!speech.isMuted) }, onVoiceOff: { speech.stop() },
                    onApplySuggestion: applySuggestion, onDismissSuggestion: { arm.dismiss($0, store: store) },
                    // §8: draw one box without stopping the set — a new sub-passage, not a mode
                    // change, so the dock/HUD/music never move.
                    quickSubPassageArmed: markup.quickBoxArmed, onQuickSubPassage: { markup.quickBoxArmed = true },
                    offersBreakPoint: offerBreakPointTap && !markup.breakPointArmed,
                    onMarkBreakPoint: { markup.breakPointArmed = true }, onSkipBreakPoint: { offerBreakPointTap = false },
                    activePulseCheck: runtime.activePulseCheck, onDismissPulseCheck: { runtime.dismissPulseCheck() }
                )
            } else if let other = store.activeSet, !other.isComplete {
                Text("A set is open for \(store.state.pieces.first { $0.id == other.configuration.pieceID }?.title ?? "another piece").")
                    .font(.callout).foregroundStyle(PraeludeColor.inkSecondary)
                Button("Finish current practice") { ending = true }.buttonStyle(.praeludeQuiet)
            } else {
                NextStepAndSuggestionsView(arm: arm, onApply: applySuggestion, onDismiss: { arm.dismiss($0, store: store) })
                PracticeArmView(
                    arm: arm, passage: selectedPassage, pieceSubtitle: "Choose a passage",
                    onStarted: {}, onOpenAdvanced: { sheet = .setup },
                    onSplitPassage: { beginSelection($0) }
                )

            }
            if let failure = arm.errorMessage { ErrorMessage(message: failure) }
            if let failure = store.errorMessage { Text(failure).font(.caption).foregroundStyle(.red) }
            if let failure = metronome.errorMessage { Text(failure).font(.caption).foregroundStyle(.red) }
            if let failure = speech.errorMessage { Text(failure).font(.caption).foregroundStyle(.red) }
            if active == nil, speech.isListening, speech.ownerID == voiceOwnerID {
                HStack(spacing: 8) {
                    Circle().fill(speech.isMuted ? PraeludeColor.inkTertiary : PraeludeColor.live).frame(width: 6, height: 6)
                    PraeludeIcon(glyph: .mic, size: 14).foregroundStyle(speech.isMuted ? PraeludeColor.inkTertiary : PraeludeColor.live)
                    Text(speech.status).font(.caption)
                    Spacer()
                    Button(speech.isMuted ? "Unmute" : "Mute") { speech.setMuted(!speech.isMuted) }.font(.caption.weight(.semibold))
                        .frame(minHeight: 44).contentShape(Rectangle())
                    Button("Off") { speech.stop() }.font(.caption.weight(.semibold))
                        .frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
                }.accessibilityElement(children: .combine)
            }
            scoreModeControls
        }
        .padding(.horizontal, sizeClass == .regular ? 16 : 8).padding(.vertical, compactScoreControls ? 2 : 14)
        .frame(maxWidth: .infinity)
        .praeludeFloatingControls()
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("scorePracticeDock")
    }
    /// §10a: tap 1. Both an on-score box tap and a Passages-list row land here, arming rule defaults
    /// immediately so the very next tap (or "Start") is tap 2 — no modal in between.
    private func selectPassage(_ passage: Passage) {
        if let active, !active.isComplete, active.configuration.passageID != passage.id {
            pendingPracticePassage = passage
            return
        }
        if active?.isComplete == true {
            do { try store.endSet() } catch { self.error = error.localizedDescription; return }
        }
        selectIdlePassage(passage)
    }
    private func selectIdlePassage(_ passage: Passage) {
        guard markup.flushInk() else { return }
        selectedPassage = passage
        page = displayPage(forSourcePage: passage.page)
        savePage(page)
        rearmIfIdle()
    }
    private func repeatSet() {
        guard let completed = active else { return }
        perform {
            let value = completed.nextSetConfiguration
            try store.endSet()
            arm.applyConfigurationOverride(value)
            rearm()
        }
    }
    private func rearm() {
        arm.arm(pieceID: pieceID, passage: selectedPassage, store: store)
    }
    private func rearmIfIdle() {
        guard store.activeSet == nil || store.activeSet?.isComplete == true else { return }
        rearm()
    }
    /// §11: applying a suggestion is fully mechanical for most rules (`PracticeArmController.accept`);
    /// R1 (no computed split point) and R12 (a whole variant chain) need the player's own input, so
    /// this layers the one UI-only step each of those two still needs on top of the same accept call.
    private func applySuggestion(_ decision: Decision) {
        arm.accept(decision, store: store)
        switch decision.outcome {
        case .suggestSplit:
            if let passageID = decision.passageID, let target = store.state.passages.first(where: { $0.id == passageID }) { beginSelection(target) }
        case .suggestVariants:
            rearmIfIdle()
        default: break
        }
    }
    private var pageIndicatorText: String {
        if let piece, let source = sourcePage(forDisplayPage: page),
           let section = ScoreOrganization.section(for: source, in: piece) {
            return "\(source - section.startPage + 1) / \(section.endPage - section.startPage + 1)"
        }
        return "\(page) / \(max(1, effectivePageCount))"
    }
    private var pageIndicatorDescription: String {
        if let piece, let source = sourcePage(forDisplayPage: page),
           let section = ScoreOrganization.section(for: source, in: piece) {
            return "\(section.title), page \(source - section.startPage + 1) of \(section.endPage - section.startPage + 1), PDF page \(source)"
        }
        return "Page \(page) of \(max(1, effectivePageCount))"
    }
    private func pageControls(compact: Bool) -> some View {
        HStack(spacing: compact ? 8 : 4) {
            Button { turnPage(-1) } label: { Image(systemName: "chevron.left").frame(width: 44, height: 44) }
                .disabled(page <= 1).accessibilityLabel("Previous page").keyboardShortcut(.leftArrow, modifiers: [])
            Button { sheet = .pages } label: { Text(pageIndicatorText).font(.subheadline.monospacedDigit()).fixedSize(horizontal: true, vertical: false).frame(minWidth: 54, minHeight: 44) }
                .accessibilityLabel(pageIndicatorDescription).accessibilityIdentifier("pageIndicator")
            Button { turnPage(1) } label: { Image(systemName: "chevron.right").frame(width: 44, height: 44) }
                .disabled(page >= max(1, effectivePageCount)).accessibilityLabel("Next page").keyboardShortcut(.rightArrow, modifiers: [])
        }
    }
    @ViewBuilder private var jumpBackButton: some View {
        if let backPage = jumpBackStack.last {
            Button { jumpBack() } label: { Image(systemName: "arrow.uturn.backward").frame(width: 44, height: 44) }
                .accessibilityLabel("Jump back to page \(backPage)").accessibilityIdentifier("jumpBack")
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
                    LabeledContent("Shaky · Missed", value: "Grade the first try today")
                    LabeledContent("Undo", value: "Correct the last rep")
                    LabeledContent("Start · Stop", value: "Begin or end the set")
                    LabeledContent("Pause · Resume", value: "Hold the set")
                    LabeledContent("Next", value: "Another set once this one is complete")
                    LabeledContent("Slower · Faster", value: "Nudge the armed tempo ±5")
                    LabeledContent("Next page · Previous page", value: "Turn pages")
                    LabeledContent("Metronome start · Stop metronome", value: "Control the click")
                    LabeledContent("Tempo eighty", value: "Set 80 BPM")
                }
                if let failure = speech.errorMessage { Section { Text(failure).foregroundStyle(.red) } }
                Section {
                    Button(speech.isListening ? "Stop listening" : "Enable hands-free") {
                        if speech.isListening { speech.stop() }
                        else if voiceCheckedOnce { speech.start(ownerID: voiceOwnerID, onCommand: handleVoice) }
                        else {
                            // First-ever enable: the natural moment to actually check recognition in
                            // this room, not a step buried in Settings — see "(C) Audit.md".
                            voiceCheckedOnce = true
                            showFirstVoiceCheck = true
                        }
                    }.frame(minHeight: 44).fontWeight(.semibold).accessibilityIdentifier("enableHandsFree")
                    if speech.isListening {
                        Button(speech.isMuted ? "Unmute" : "Mute") { speech.setMuted(!speech.isMuted) }.frame(minHeight: 44)
                    }
                    Text(speech.status).font(.caption).foregroundStyle(.secondary)
                } footer: { Text("Microphone and Speech Recognition permissions are requested only when you enable this. On-device speech availability depends on your device and downloaded language support.") }
                Section {
                    NavigationLink("Check voice recognition") { VoiceOnboardingView() }
                }
            }.navigationTitle("Hands-free").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { sheet = nil } } }
                .sheet(isPresented: $showFirstVoiceCheck, onDismiss: {
                    speech.start(ownerID: voiceOwnerID, onCommand: handleVoice)
                }) { VoiceOnboardingView() }
        }.presentationDetents([.large])
    }
    private func turnPage(_ direction: Int) {
        guard markup.flushInk() else { return }
        let step = (twoPages && sizeClass == .regular && !halfPageTurns) ? 2 : 1
        page = min(max(1, effectivePageCount), max(1, page + direction * step))
        savePage(page)
    }
    private func savePage(_ page: Int) { perform { try store.updateLastPage(pieceID: pieceID, page: page) } }
    /// §7 links: jumps to a repeat/D.S./coda target, remembering where we came from so the jump-back
    /// button (or menu item) can return there.
    private func activateLink(_ link: ScoreLink) {
        guard markup.flushInk(), link.targetPage != page else { return }
        jumpBackStack.append(page)
        page = link.targetPage
        savePage(page)
        PraeludeHaptic.confirm()
    }
    private func jumpBack() {
        guard let target = jumpBackStack.popLast(), markup.flushInk() else { return }
        page = target
        savePage(page)
    }
    /// §7 performance mode. Refuses to enter with unsaved ink still pending, the same guard every
    /// other page-changing action here already uses — performance mode is exited by a long press
    /// with no confirmation, so it should never risk a silent ink loss on the way in.
    private func enterPerformanceMode() {
        guard markup.flushInk() else { return }
        performanceMode = true; focusMode = true
        PraeludeHaptic.confirm()
    }
    private func exitPerformanceMode() {
        guard performanceMode else { return }
        performanceMode = false; focusMode = false
        PraeludeHaptic.toggle()
    }
    /// §7/§8: one gesture, two jobs, picked by mode — performance mode's only way out (its own long
    /// press already ignores this while not active, so the plain call is safe unconditionally), or —
    /// while reading normally — a saved passage's on-score quick actions (see "(C) Audit.md": these
    /// previously existed only as a context menu on rows in the Passages sheet).
    private func handleLongPress(_ regionID: UUID?) {
        guard !performanceMode else { exitPerformanceMode(); return }
        guard let regionID, let passage = savedPassages.first(where: { $0.regions.contains { $0.id == regionID } }) else { return }
        longPressedPassage = passage
    }
    private func perform(_ action: () throws -> Void) { do { try action() } catch { self.error = error.localizedDescription } }

    /// `store.endSession()` plus the spec §5a "session finished" feed event — one place for both of
    /// this screen's two "End practice"/"Finish" buttons, so the hook can't be added to one and
    /// forgotten on the other. The just-ended session is `store.state.sessions.last` immediately
    /// after `endSession()` returns (it stamps that session's own `endedAt`, not a new one).
    private func endSessionAndShare() throws {
        try store.endSession()
        guard let piece, let session = store.state.sessions.last else { return }
        // Spec §5a: "session finished (duration+pieces)" — a friend can't resolve piece_id to a
        // title themselves (their read of this event never reaches the *author's* private `pieces`
        // row), so the title travels in `detail`, the same way AddPieceView/ProfileEditView already
        // put their own event's readable summary in `detail` rather than relying on the id alone.
        socialHooks.shareMilestone(kind: .sessionFinished, pieceID: piece.id,
                                    detail: "\(practiceDuration(session.activeSeconds)) · \(piece.title)")
    }
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
            FeedbackService.shared.isEnabled = feedbackEnabled
            _ = try runtime.record(verdict)
            // §11 R8: only a Sloppy is ever worth asking "where did it break?" — offered until the
            // player either marks a spot, records the set's next repetition, or stops.
            offerBreakPointTap = verdict == .sloppy
            advancePassagePageIfNeeded()
        }
    }
    /// §8: "Multi-region, multi-page; practicing auto-turns pages." With no real playing-position
    /// signal (§2: no audio grading), a recorded verdict is the one moment the app has real ground
    /// truth about progress through a cross-page passage — see `PracticeUXHelpers.nextPassagePage`
    /// — so that is when the score follows, cycling the passage's own pages rather than requiring a
    /// manual turn to see the rest of it.
    private func advancePassagePageIfNeeded() {
        guard autoTurnPassageAfterVerdict else { return }
        // `nextPassagePage` compares against `PassageRegion.page` (source pages), so the currently
        // *displayed* page must be converted to its source equivalent before comparing, and the
        // result converted back before it reaches `page` (displayed) — see `EffectivePage`'s own
        // doc comment and the property above.
        guard let snapshot = active?.configuration.passageSnapshot,
              let currentSource = sourcePage(forDisplayPage: page),
              let next = PracticeUXHelpers.nextPassagePage(after: currentSource, pages: PracticeUXHelpers.distinctPages(snapshot.regions)),
              markup.flushInk() else { return }
        page = displayPage(forSourcePage: next)
        savePage(page)
    }
    /// §10a tap 2 (touch or "Start"/a cold grade word). Mirrors `PracticeArmView.start(grade:)` —
    /// kept separate because voice dispatch lives here, not inside that view.
    private func armStart(grade: ColdGrade? = nil, skippingColdGrade: Bool = false) {
        perform {
            guard try arm.start(grade: grade, skippingColdGrade: skippingColdGrade, store: store, runtime: runtime) else { return }
            refreshAudio()
            // A cold grade is the set's first recorded attempt too (§9/R3) — it deserves the same
            // auto page-turn treatment as every later verdict, not just attempt #2 onward.
            if grade != nil { advancePassagePageIfNeeded() }
        }
    }
    private func stopPractice() {
        guard let current = active else { return }
        arm.computeAfterSet(current, store: store)
        perform { try store.endSet(); metronome.stop() }
        offerBreakPointTap = false; markup.breakPointArmed = false
    }
    /// §10a "tempo in one gesture... never a modal": before a set exists, nudges the armed
    /// configuration's starting tempo; once one is running or paused, nudges the set actually in
    /// progress (`store.adjustActiveTempo` — the metronome then follows via `refreshAudio`'s own
    /// `.onChange(of: active?.currentBPM)`). Previously this returned early while a set was active at
    /// all, so the HUD's own tempo dial/±5 controls had nothing to call — see "(C) Audit.md".
    private func nudgeTempo(_ delta: Double) {
        if store.activeSet == nil || store.activeSet?.isComplete == true, var configuration = arm.configuration {
            configuration.startBPM = min(max(configuration.startBPM + delta, 20), 300)
            if configuration.targetBPM < configuration.startBPM { configuration.targetBPM = configuration.startBPM }
            arm.applyConfigurationOverride(configuration)
        } else if let active {
            adjustRunningTempo(active.currentBPM + delta)
        }
    }
    private func adjustRunningTempo(_ bpm: Double) {
        perform { try store.adjustActiveTempo(bpm) }
    }
    private func refreshAudio() {
        runtime.refreshMetronome(for: active)
    }
    private func handleVoice(_ command: VoiceCommand) {
        // A modal editor owns its own input; speech never writes through an open setup sheet.
        guard markup.mode == .reading, sheet == nil || sheet == .voice else { return }
        let idle = store.activeSet == nil || store.activeSet?.isComplete == true
        switch command {
        case .clean: if arm.awaitingColdGrade { armStart(grade: .clean) } else { record(.clean) }
        case .sloppy: record(.sloppy)
        case .again: record(.again)
        // §9: cold grading only means something while the cold-grade prompt is actually showing —
        // outside that moment these two words are inert, the same firewall as every other command.
        case .shaky: if arm.awaitingColdGrade { armStart(grade: .shaky) }
        case .missed: if arm.awaitingColdGrade { armStart(grade: .missed) }
        case .undo: if active != nil { perform { try runtime.undo() } }
        case .pause: if active != nil { perform { try store.pause() } }
        case .resume: if active != nil { perform { try store.resume() } }
        case .start: if idle { armStart(skippingColdGrade: true) }
        case .stop: if active != nil { stopPractice() }
        case .next:
            // No session-queue feature exists yet (out of this track's scope); "Next" is defined as
            // moving straight on to another set on the same passage once this one is complete.
            if let active, active.isComplete { repeatSet(); if store.activeSet == nil { armStart(skippingColdGrade: true) } }
        case .slower: nudgeTempo(-5)
        case .faster: nudgeTempo(5)
        case .metronomeStart:
            if let set = store.activeSet, !set.isComplete { metronome.setTempo(set.currentBPM) }
            metronome.start()
        case .metronomeStop: metronome.stop()
        case .setTempo(let bpm):
            if idle {
                metronome.setTempo(bpm)
                if var configuration = arm.configuration {
                    configuration.startBPM = bpm
                    if configuration.targetBPM < bpm { configuration.targetBPM = bpm }
                    arm.applyConfigurationOverride(configuration)
                }
            } else if let active, active.status == .running || active.status == .paused {
                // §10a: a spoken tempo is a direct gesture-equivalent command, not blocked by a modal
                // just because a set happens to be running — see "(C) Audit.md".
                adjustRunningTempo(bpm)
            } else { error = "Tempo follows your current set. Finish the set to choose a new tempo." }
        case .nextPage: turnPage(1)
        case .previousPage: turnPage(-1)
        }
    }
}
