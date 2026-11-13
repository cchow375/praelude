import SwiftUI
import UniformTypeIdentifiers
import PencilKit

private enum ScoreSheet: String, Identifiable {
    case setup, passages, metronome, pages, voice, passageDetails, share, heatmap, bookmarks, links, pageTools, sections, measureMap, gestures, practiceBalance, camera
    var id: String { rawValue }
}
enum ScoreDisplayIntent: Equatable { case score, practice }

/// Serialization cache is not UI state. Writing it during a PDF representable refresh must not
/// invalidate SwiftUI and schedule another refresh of that same canvas.
final class ScoreInkCache {
    private var entries: [String: (signature: Int, data: Data?)] = [:]
    private var recentKeys: [String] = []
    private var byteCount = 0
    private let budget: Int
    init(budget: Int = 16 * 1024 * 1024) { self.budget = budget }

    static func signature(_ rows: [InkStroke]) -> Int {
        var hasher = Hasher()
        hasher.combine(rows.count)
        for row in rows {
            hasher.combine(row.id); hasher.combine(row.updatedAt); hasher.combine(row.fingerprint ?? row.data)
        }
        return hasher.finalize()
    }

    static func mergedData(_ rows: [InkStroke]) -> Data? {
        guard !rows.isEmpty else { return nil }
        do { return try InkPerStroke.merge(rows.map(\.data)).dataRepresentation() }
        catch {
            // Nil means genuinely blank. Invalid bytes trigger read-only recovery rather than
            // accepting a replacement drawing over unreadable originals.
            return Data("Praelude-invalid-saved-ink".utf8)
        }
    }

    func entry(for key: String) -> (signature: Int, data: Data?)? {
        guard let entry = entries[key] else { return nil }
        recentKeys.removeAll { $0 == key }; recentKeys.append(key)
        return entry
    }
    func insert(key: String, signature: Int, data: Data?, protectedKeys: Set<String>) {
        byteCount -= entries[key]?.data?.count ?? 0
        entries[key] = (signature, data); byteCount += data?.count ?? 0
        recentKeys.removeAll { $0 == key }; recentKeys.append(key)
        // Pin exact live/failed-save baselines: rebuilding identical PKDrawing changes its bytes.
        while byteCount > budget || entries.count > 24 {
            guard let victim = recentKeys.first(where: { $0 != key && !protectedKeys.contains($0) }) else { break }
            byteCount -= entries.removeValue(forKey: victim)?.data?.count ?? 0
            recentKeys.removeAll { $0 == victim }
        }
    }
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
    var initialDisplayIntent: ScoreDisplayIntent? = nil
    var onDisplayIntentConsumed: () -> Void = {}
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
    // Ergonomic device preference; intentionally local, independent of synced library settings.
    @AppStorage("ios.scoreControlsAtTop") private var controlsAtTop = false
    // A phone normally sits beside a paper score; an iPad normally is the score. This preference
    // is device-local so changing the phone does not move another device out of its reading mode.
    @AppStorage("ios.practiceDisplay") private var practiceDisplay = "automatic"
    @AppStorage("ios.counterKeepAwake") private var counterKeepAwake = false
    @State private var displayOverride: Bool?
    @State private var counterSaveTask: Task<Void, Never>?
    @State private var selectedHands = "Both hands"
    @State private var pageSaveTask: Task<Void, Never>?
    @State private var pendingBookmark: (pieceID: UUID, page: Int)?
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
    @State private var voiceControlsVisible = false
    @State private var resumeScoreVoiceAfterSettings = false
    @State private var resumeScoreVoiceMuted = false
    private struct EditorVoiceHandoff {
        enum Target { case passage(UUID), textAnnotation(UUID), passagePicker }
        let pieceID: UUID
        let ownerID: UUID
        let target: Target
        let muted: Bool
    }
    @State private var editorVoiceHandoff: EditorVoiceHandoff?
    #if DEBUG
    @State private var voiceAuditDialogPending = false
    @State private var voiceAuditDialogBatch = 0
    @State private var voiceAuditDialogDeliveryEnding = false
    #endif
    @State private var voiceOwnerID = UUID()
    @State private var camera = FaceGestureService()
    @State private var cameraActionTask: Task<Void, Never>?
    @State private var arm = PracticeArmController()
    @State private var page = 1
    @State private var scoreAssetRevision = 0
    @State private var scopedSectionID: UUID?
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
    @State private var exporting = false
    @State private var exportTask: Task<Void, Never>?
    @State private var editingTextBox: TextBoxAnnotation?
    @State private var editingSavedTextBox = false
    @State private var dictateTextBox = false
    @State private var renamingPassage: Passage?
    @State private var dictatePassageName = false
    /// §8: a long press landing on a saved passage's outline while reading (not performance mode,
    /// which uses the same gesture to exit) — drives `.passageQuickActions` below.
    @State private var longPressedPassage: Passage?
    private var piece: Piece? { store.state.pieces.first { $0.id == pieceID } }
    private var scopedSection: ScoreSection? { piece?.scoreSections.first { $0.id == scopedSectionID } }
    private var scopedPages: ClosedRange<Int>? { scopedSection.map { $0.startPage...$0.endPage } }
    private var scopedDisplayPages: [Int] {
        guard let scopedPages else { return Array(1...max(1, effectivePageCount)) }
        return effectivePages.filter { $0.sourcePage.map(scopedPages.contains) == true }.map(\.displayOrder)
    }
    private var active: ActiveSet? { store.activeSet?.configuration.pieceID == pieceID ? store.activeSet : nil }
    private var prefersCounter: Bool { displayOverride ?? (practiceDisplay == "counter" || (practiceDisplay == "automatic" && UIDevice.current.userInterfaceIdiom == .phone)) }
    private var showsCounter: Bool { prefersCounter && markup.mode == .reading && !focusMode && !performanceMode && !markup.quickBoxArmed && !markup.breakPointArmed }
    private var scoreURL: URL? { piece.flatMap { NativeLibraryFiles(store: store).scoreURL(for: $0) } }
    // §8: `deletePassage` archives (tombstones) rather than erasing, so every list must filter it out.
    private var savedPassages: [Passage] { store.state.passages.filter { $0.pieceID == pieceID && !$0.archived } }
    private var visibleRegions: [PassageRegion] {
        let snapshot = active?.configuration.passageSnapshot?.regions ?? []
        let snapshotIDs = Set(snapshot.map(\.id))
        return savedPassages.flatMap(\.regions).filter { !snapshotIDs.contains($0.id) && (scopedPages?.contains($0.page) ?? true) } + snapshot
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
    @State private var mergedInkCache = ScoreInkCache()
    private func mergedInkData(_ page: Int) -> Data? {
        let rows = store.inkStrokes(pieceID: pieceID, page: page, layer: markup.activeLayer)
        let signature = ScoreInkCache.signature(rows)
        let key = "\(pieceID)|\(page)|\(markup.activeLayer.rawValue)"
        if let cached = mergedInkCache.entry(for: key), cached.signature == signature { return cached.data }
        let data = ScoreInkCache.mergedData(rows)
        let visiblePages = (max(1, self.page - 2)...(self.page + 2)).compactMap(sourcePage(forDisplayPage:))
        var protected = Set(visiblePages.map { "\(pieceID)|\($0)|\(markup.activeLayer.rawValue)" })
        let pendingLayer = markup.pendingInkLayer ?? markup.activeLayer
        protected.formUnion(markup.pendingInk.keys.map { "\(pieceID)|\($0)|\(pendingLayer.rawValue)" })
        mergedInkCache.insert(key: key, signature: signature, data: data, protectedKeys: protected)
        return data
    }
    /// Every visible layer other than the active one, flattened for `ScorePageOverlay`'s read-only
    /// underlay (§7 "layers mine/teacher/performance show/hide").
    private func otherLayersInk(_ page: Int) -> [Data] {
        InkLayer.allCases.filter { $0 != markup.activeLayer && markup.visibleLayers.contains($0) }
            .flatMap { store.inkStrokes(pieceID: pieceID, page: page, layer: $0).map(\.data) }
    }
    private var scoreContent: some View {
        // File publication is external to the JSON ledger. Reading this revision makes a
        // missing-file branch re-evaluate after the matching private PDF finishes downloading.
        let _ = scoreAssetRevision
        return Group {
            if let piece {
                GeometryReader { geometry in
                    ZStack {
                        if showsCounter {
                            PraeludeColor.paper
                            counterWorkspace
                        } else if let scoreURL, FileManager.default.fileExists(atPath: scoreURL.path) {
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
                    .overlay {
                        if markup.mode == .writing && !performanceMode {
                            AnnotationPalette(markup: markup, onDone: returnToPractice, onRemoveStamp: removeSelectedStamp)
                        }
                    }
                    .safeAreaInset(edge: .top, spacing: 0) {
                        if !focusMode && !performanceMode {
                            VStack(spacing: 0) {
                                if markup.mode == .reading && !markup.quickBoxArmed && !markup.breakPointArmed { practiceDisplayPicker }
                                if markup.mode != .reading { markupHeader }
                                if controlsAtTop && !showsCounter { visibleControls(in: geometry.size) }
                            }
                        }
                    }
                    .safeAreaInset(edge: .bottom, spacing: 0) {
                        if !focusMode && !performanceMode && !controlsAtTop && !showsCounter {
                            visibleControls(in: geometry.size)
                        }
                    }
                    .overlay(alignment: .topTrailing) {
                        if focusMode && !performanceMode {
                            Button { setFocus(false) } label: {
                                Label("Exit focus", systemImage: "arrow.down.right.and.arrow.up.left")
                                    .font(.caption.weight(.semibold)).padding(.horizontal, 10).frame(minHeight: 44)
                            }
                            .praeludeScoreChrome().clipShape(Capsule()).padding(8)
                            .accessibilityIdentifier("exitScoreFocus")
                            .accessibilityHint("Counting resumes. You can also tap the top or bottom middle of the score.")
                        }
                    }
                }
                .navigationTitle(scopedSection?.title ?? piece.title).navigationBarTitleDisplayMode(.inline)
                .navigationBarBackButtonHidden(true)
                .toolbar(focusMode || performanceMode ? .hidden : .visible, for: .navigationBar)
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        Button(action: closeScore) { Label("Library", systemImage: "chevron.left").font(.subheadline).frame(minHeight: 44) }
                            .accessibilityLabel("Close score").accessibilityIdentifier("closeScore")
                    }
                    ToolbarItemGroup(placement: .topBarTrailing) {
                        if showsCounter {
                            Button(action: presentPassagePicker) {
                                Image(systemName: "rectangle.stack").frame(width: 44, height: 44).contentShape(Rectangle())
                            }.accessibilityLabel("Passages").accessibilityIdentifier("passages")
                        } else {
                            Button { if markup.flushInk() { sheet = .sections } } label: {
                                Image(systemName: "list.bullet.rectangle").frame(width: 44, height: 44).contentShape(Rectangle())
                            }.accessibilityLabel("Movements & pieces").accessibilityIdentifier("openScoreSections")
                        }
                        Button { sheet = .metronome } label: { PraeludeIcon(glyph: .metronome, size: 22).frame(width: 44, height: 44).contentShape(Rectangle()) }
                            .accessibilityLabel("Metronome").accessibilityIdentifier("openMetronome")
                        scoreOptions
                    }
                }
            } else { ContentUnavailableView("Piece unavailable", systemImage: "music.note") }
        }
    }
    private var scoreOptions: some View {
        Menu {
                            if active != nil {
                                Section("Current practice") {
                                    Button("End practice", systemImage: "stop.circle", role: .destructive) { ending = true }
                                }
                            }
                            Section("Reading") {
                                Button { setFocus(true) } label: { Label("Focus on score", systemImage: "arrow.up.left.and.arrow.down.right") }
                                    .accessibilityIdentifier("enterScoreFocus")
                                Button { enterPerformanceMode() } label: { Label("Performance mode · hold score to exit", systemImage: "rectangle.compress.vertical") }
                                    .accessibilityIdentifier("performanceMode")
                                Button("Camera gestures", systemImage: "faceid") {
                                    #if DEBUG
                                    InteractionAudit.record("score camera action before=\(String(describing: sheet))")
                                    #endif
                                    sheet = .camera
                                }.accessibilityIdentifier("openCameraGestures")
                                if sizeClass == .regular {
                                    Toggle("Two pages", isOn: $twoPages).praeludeToggleHaptic(twoPages)
                                    if twoPages { Toggle("Half-page turns", isOn: $halfPageTurns).praeludeToggleHaptic(halfPageTurns) }
                                    if supportsMultipleWindows { Button("Open score in new window", systemImage: "rectangle.on.rectangle") { openWindow(value: pieceID) } }
                                }
                                Button("Bookmarks", systemImage: "bookmark.fill") { sheet = .bookmarks }
                                Button("Links", systemImage: "arrow.triangle.turn.up.right.diamond") { sheet = .links }
                                if !jumpBackStack.isEmpty { Button("Jump back to page \(jumpBackStack.last ?? page)", systemImage: "arrow.uturn.backward") { jumpBack() } }
                            }
                            Section("Practice & passages") {
                                Button("Passages", systemImage: "bookmark", action: presentPassagePicker)
                                Button("Draw a passage", systemImage: "rectangle.dashed") { beginSelection(nil) }
                                Button("Movements & pieces", systemImage: "list.bullet.rectangle") { if markup.flushInk() { sheet = .sections } }
                                if scopedSection != nil { Button("Show whole score", systemImage: "doc") { scopedSectionID = nil } }
                                if let selectedPassage {
                                    Button("Name & goal tempo", systemImage: "character.cursor.ibeam") { presentPassageRename(selectedPassage) }
                                    Button("Edit passage boxes", systemImage: "rectangle.and.pencil.and.ellipsis") { beginSelection(selectedPassage) }
                                    Button("Passage details", systemImage: "slider.horizontal.3") { sheet = .passageDetails }
                                    Button("Practice whole piece", systemImage: "doc") { self.selectedPassage = nil }
                                }
                                Button("Practice balance & full-tempo target", systemImage: "chart.bar") { sheet = .practiceBalance }
                                Button("Practice results on score", systemImage: "square.grid.3x3.fill") { sheet = .heatmap }.disabled(scoreURL == nil)
                            }
                            Section("Score tools") {
                                Button("Measure map", systemImage: "number.square") { sheet = .measureMap }
                                Button("Page tools", systemImage: "square.stack") { if markup.flushInk() { sheet = .pageTools } }
                                Button("Replace score PDF", systemImage: "doc.badge.plus") { importing = true }
                                Button(exporting ? "Preparing annotated score…" : "Share annotated score", systemImage: "square.and.arrow.up", action: exportAnnotatedScore)
                                    .disabled(scoreURL == nil || exporting)
                            }
                            Section("Controls & help") {
                                Picker("Controls position", selection: $controlsAtTop) {
                                    Text("Top").tag(true)
                                    Text("Bottom").tag(false)
                                }.accessibilityIdentifier("scoreControlsPosition")
                                Toggle("Show passage boxes", isOn: preference(\.showPassageBoxes))
                                Toggle("Compact score controls", isOn: preference(\.compactScoreControls))
                                Toggle("Turn passage page after each verdict", isOn: preference(\.autoTurnPassageAfterVerdict))
                                Button("Hands-free commands", systemImage: "mic") { sheet = .voice }
                                Button("Score gestures", systemImage: "hand.tap") { sheet = .gestures }
                            }
                        } label: { Image(systemName: "ellipsis").frame(width: 44, height: 44).contentShape(Rectangle()) }.accessibilityLabel("Score options")
    }
    private var presentedScore: some View {
        scoreContent
        // §7 performance mode: hides literally everything else the system itself would still draw
        // over the score — the status bar and the home-indicator/Dynamic Island's persistent
        // overlays — on top of the app's own chrome already hidden above.
        .background(FaceCameraOrientationProbe(changed: camera.rotate).allowsHitTesting(false))
        .overlay(alignment: .topTrailing) { if camera.isEnabled && !performanceMode && sheet == nil { cameraOverlay.padding(8).padding(.top, 48) } }
        .statusBarHidden(performanceMode)
        .persistentSystemOverlays(performanceMode ? .hidden : .automatic)
        .overlay(alignment: .bottom) {
            if focusMode && !performanceMode && speech.pendingConfirmation != nil {
                VoiceCommandConfirmationView(speech: speech).padding(8)
            }
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
                                              selectedPassageID: selectedPassage?.id, sourcePageRange: scopedPages, onSelect: selectPassage,
                                              onDraw: { passage in drawAfterDismiss = passage ?? newPassage() })
                #if DEBUG
                .onAppear { InteractionAudit.record("score Passages sheet appeared") }
                #endif
            case .passageDetails:
                if let selectedPassage {
                    NavigationStack {
                        PassageEditorView(passage: selectedPassage, pageCount: max(1, piece?.pageCount ?? 1)) {
                            self.selectedPassage = store.state.passages.first { $0.id == selectedPassage.id }; sheet = nil
                        }.toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { sheet = nil } } }
                    }
                }
            case .metronome: MetronomeView()
            case .pages: if let scoreURL { ScorePagePicker(url: scoreURL, pageEdits: effectivePageEdits, currentPage: page, sourcePageRange: scopedPages, onSelect: { if markup.flushInk() { page = $0; savePage($0) } }) }
            case .voice: voiceSheet
            case .camera: FaceGestureControlsView(camera: camera)
                #if DEBUG
                .onAppear { InteractionAudit.record("score camera sheet appeared") }
                #endif
            case .practiceBalance:
                NavigationStack {
                    PiecePracticeInsightsView(pieceID: pieceID)
                        .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { sheet = nil } } }
                }
            case .share: if let sharingURL { ScoreShareView(url: sharingURL) }
            case .heatmap: if let scoreURL { ScoreHeatmapView(pieceID: pieceID, url: scoreURL, startPage: page) }
            case .bookmarks: BookmarksView(pieceID: pieceID, currentPage: page, onJump: { if markup.flushInk() { page = $0; savePage($0) } })
            case .links: ScoreLinksView(pieceID: pieceID, pageCount: max(1, effectivePageCount), currentPage: page)
            case .pageTools: PageToolsView(pieceID: pieceID, pageCount: max(1, piece?.pageCount ?? 1))
            case .sections: ScoreSectionsView(pieceID: pieceID, onOpenPage: { source in
                if markup.flushInk() {
                    openScoreSection(at: source)
                }
            })
            case .measureMap: ScoreMeasureMapView(pieceID: pieceID, currentPage: sourcePage(forDisplayPage: page) ?? 1)
            case .gestures: gestureGuide
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
            guard markup.flushInk() else { return }
            perform {
                let url = try result.get()
                _ = try NativeLibraryFiles(store: store).importPDF(url, title: piece.title, composer: piece.composer, replacing: piece)
                page = 1
            }
        }
        .sheet(item: $editingTextBox) { box in
            let isSaved = editingSavedTextBox
            TextBoxEditorView(text: box.text, style: box.style, startDictation: dictateTextBox, onSave: { text, style in
                if isSaved {
                    guard let current = store.state.textAnnotations.first(where: { $0.id == box.id }), current == box else {
                        throw PracticeError.conflict("This note changed elsewhere. Reopen it before saving your changes.")
                    }
                }
                var edited = box
                edited.text = text
                edited.style = style
                edited.updatedAt = Date()
                try store.saveTextAnnotation(edited)
            }, onDelete: isSaved ? {
                guard let current = store.state.textAnnotations.first(where: { $0.id == box.id }), current == box else {
                    throw PracticeError.conflict("This note changed elsewhere. Reopen it before deleting it.")
                }
                try store.deleteTextAnnotation(box.id)
            } : nil)
        }
        .sheet(item: $renamingPassage, onDismiss: { dictatePassageName = false }) { passage in
            PassageRenameView(passage: passage, startDictation: dictatePassageName)
                #if DEBUG
                .onAppear { InteractionAudit.record("score rename sheet appeared dictate=\(dictatePassageName)") }
                .onDisappear { InteractionAudit.record("score rename sheet disappeared") }
                #endif
        }
        .confirmationDialog("End this practice session?", isPresented: $ending, titleVisibility: .visible) {
            Button("End practice", role: .destructive) { perform { try endSessionAndShare(); metronome.stop(); editorVoiceHandoff = nil; speech.stop() } }
            Button("Cancel", role: .cancel) {}
        } message: { Text("Your repetitions and time stay saved. Unfinished work remains in your history.") }
        .alert("Couldn’t complete that", isPresented: Binding(get: { error != nil }, set: { if !$0 { error = nil } })) { Button("OK") { error = nil } } message: { Text(error ?? "") }
    }
    private var displayLifecycleScore: some View {
        presentedScore
        .onAppear(perform: scoreAppeared)
        .onDisappear { resumeScoreVoiceAfterSettings = false; editorVoiceHandoff = nil; flushBookmark(); exportTask?.cancel(); counterSaveTask?.cancel(); _ = markup.flushInk(); speech.stop(ifOwnedBy: voiceOwnerID); cameraActionTask?.cancel(); camera.stop(); camera.onAction = nil; runtime.scoreDisappeared(ownerID: voiceOwnerID) }
        .onChange(of: pieceID) { _, _ in
            displayOverride = nil
            consumeDisplayIntent()
            resumeScoreVoiceAfterSettings = false
            editorVoiceHandoff = nil
            flushBookmark(); setFocus(false); cameraActionTask?.cancel(); camera.stop(); camera.onAction = nil
            exportTask?.cancel()
            markup.onConfirmSelection = saveSelection
            markup.showPassageBoxes = showPassageBoxes
            if markup.flushInk() { markup.finish() }
            page = piece?.lastPage ?? 1; scopedSectionID = nil; selectedPassage = nil; jumpBackStack = []; speech.stop(ifOwnedBy: voiceOwnerID); arm.clearArm()
            offerBreakPointTap = false; markup.breakPointArmed = false
        }
        .onChange(of: initialPage) { _, source in
            guard let source, markup.flushInk() else { return }
            openScoreSection(at: source); onInitialPageConsumed()
        }
        .onChange(of: initialDisplayIntent) { _, _ in consumeDisplayIntent() }
        .onChange(of: showPassageBoxes) { _, value in markup.showPassageBoxes = value }
    }
    private var cameraLifecycleScore: some View {
        displayLifecycleScore
        .onChange(of: scenePhase) { _, phase in
            if phase != .active {
                flushBookmark(); _ = markup.flushInk()
                if phase == .background { resumeScoreVoiceAfterSettings = false; editorVoiceHandoff = nil; cameraActionTask?.cancel(); camera.stop() }
            }
            if phase == .active { restoreScoreVoiceIfNeeded(); restoreEditorVoiceIfNeeded() }
            updateCameraContext()
        }
        .onChange(of: page) { _, _ in camera.resetMotion() }
        .onChange(of: camera.isEnabled) { _, _ in updateCameraContext() }
        .onChange(of: focusMode) { _, value in runtime.setRepInputSuspended(value, ownerID: voiceOwnerID); updateVoiceContext(); updateCameraContext() }
        .onChange(of: active?.id) { _, _ in selectedHands = active?.configuration.hands ?? "Both hands"; camera.resetMotion(); updateVoiceContext(); updateCameraContext() }
        .onChange(of: speech.isListening) { _, _ in updateVoiceContext(); updateCameraContext() }
        .onChange(of: speech.ownerID) { _, _ in restoreScoreVoiceIfNeeded(); restoreEditorVoiceIfNeeded() }
        .onChange(of: arm.awaitingColdGrade) { _, _ in updateVoiceContext(); updateCameraContext() }
        .onChange(of: markup.mode) { _, _ in updateVoiceContext(); updateCameraContext() }
    }
    private var lifecycleScore: some View {
        cameraLifecycleScore
        .onChange(of: sheet) { _, value in
            #if DEBUG
            InteractionAudit.record("score sheet changed=\(String(describing: value))")
            #endif
            if value != .voice { resumeScoreVoiceAfterSettings = false }
            updateVoiceContext(); updateCameraContext()
            if value == nil { restoreEditorVoiceIfNeeded() }
        }
        .onChange(of: editingTextBox) { _, _ in updateVoiceContext(); updateCameraContext(); restoreEditorVoiceIfNeeded() }
        .onChange(of: renamingPassage) { _, value in
            #if DEBUG
            InteractionAudit.record("score rename state=\(value != nil)")
            #endif
            updateVoiceContext(); updateCameraContext(); restoreEditorVoiceIfNeeded()
        }
    }
    private var practiceObservedScore: some View {
        lifecycleScore
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
            refreshAudio(); updateCounterScreenPolicy(); updateVoiceContext(); updateCameraContext()
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
    }
    var body: some View {
        practiceObservedScore
        .onReceive(NotificationCenter.default.publisher(for: .praeludeLibraryAssetAvailable).receive(on: RunLoop.main)) { notice in
            guard let url = notice.object as? URL, url.path == scoreURL?.path else { return }
            scoreAssetRevision &+= 1
        }
        .onChange(of: showsCounter) { _, _ in updateCounterScreenPolicy() }
        .onChange(of: counterKeepAwake) { _, _ in updateCounterScreenPolicy() }
        .onChange(of: acceptsScoreCommands) { _, _ in updateVoiceContext(); restoreEditorVoiceIfNeeded() }
        .onChange(of: acceptsCameraActions) { _, _ in updateCameraContext() }
        .onChange(of: hasUndoableAttempt) { _, _ in updateVoiceContext() }
        .background {
            Group {
                Button("Previous page") { turnPage(-1) }.keyboardShortcut(.leftArrow, modifiers: [])
                Button("Next page") { turnPage(1) }.keyboardShortcut(.rightArrow, modifiers: [])
            }
            .disabled(!acceptsScoreCommands)
            .frame(width: 0, height: 0).opacity(0).accessibilityHidden(true)
            Button("Toggle metronome") {
                prepareMetronomeForCurrentContext()
                runtime.setMetronomePlaying(!metronome.isPlaying, for: store.activeSet)
            }.keyboardShortcut(.space, modifiers: [])
                .disabled(!acceptsScoreCommands)
                .frame(width: 0, height: 0).opacity(0).accessibilityHidden(true)
        }
        #if DEBUG
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if sheet != .voice { voiceAuditControls }
        }
        .onChange(of: ending) { _, value in
            if value { deliverVoiceAuditDialogCommandsIfArmed() }
        }
        #endif
    }
    private func scoreAppeared() {
            consumeDisplayIntent()
            if let initialPage { scopedSectionID = piece?.scoreSections.first { $0.startPage == initialPage }?.id }
            page = min(max(1, initialPage.map(displayPage(forSourcePage:)) ?? piece?.lastPage ?? 1), max(1, effectivePageCount))
            if initialPage != nil { savePage(page); onInitialPageConsumed() }
            markup.showPassageBoxes = showPassageBoxes
            markup.onConfirmSelection = saveSelection
            updateCameraContext()
            runtime.scoreAppeared(ownerID: voiceOwnerID)
            updateCounterScreenPolicy()
            runtime.setRepInputSuspended(focusMode, ownerID: voiceOwnerID)
            selectedHands = active?.configuration.hands ?? "Both hands"
            if let autoSelectPassageID, let target = savedPassages.first(where: { $0.id == autoSelectPassageID }) {
                selectPassage(target)
                onAutoSelectConsumed()
            } else {
                rearmIfIdle()
            }
    }
    private var practiceDisplayPicker: some View {
        Picker("Practice display", selection: Binding(get: { prefersCounter }, set: { counter in
            guard markup.flushInk() else { return }
            displayOverride = nil
            practiceDisplay = counter ? "counter" : "score"
            if FeedbackService.shared.isEnabled && FeedbackService.shared.hapticsEnabled { PraeludeHaptic.toggle() }
        })) {
            Label("Score", systemImage: "doc.text").tag(false)
            Label("Counter", systemImage: "number").tag(true)
        }.pickerStyle(.segmented).padding(.horizontal, 12).padding(.vertical, 8)
            .background(PraeludeColor.paper)
            .accessibilityIdentifier("practiceDisplayPicker")
    }
    private func consumeDisplayIntent() {
        guard let initialDisplayIntent else { return }
        displayOverride = initialDisplayIntent == .score ? false : nil
        onDisplayIntentConsumed()
    }
    private var counterWorkspace: some View {
        ScrollView {
            VStack(spacing: 18) {
                counterIdentity
                if let active {
                    CounterPracticeView(active: active, selectedHands: $selectedHands, keepAwake: $counterKeepAwake,
                        isSaving: counterSaveTask != nil || cameraActionTask != nil,
                        onVerdict: recordCounterVerdict, onUndo: { perform { try runtime.undo() } },
                        onTogglePause: togglePause, onStop: stopPractice,
                        onFinishSession: { perform { try endSessionAndShare(); metronome.stop() } }, onAnotherSet: repeatSet,
                        onAdjustTempo: adjustRunningTempo, onToggleMetronome: {
                            runtime.setMetronomePlaying(!metronome.isPlaying, for: store.activeSet)
                        }, onOpenMetronome: { sheet = .metronome }, onBeginRest: beginCounterRest)
                    if let activePulseCheck = runtime.activePulseCheck {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(activePulseCheck.reason).font(.caption).foregroundStyle(.secondary)
                            Button("Resume click") { runtime.dismissPulseCheck() }.frame(minHeight: 44)
                        }
                    }
                    if active.isComplete { NextStepAndSuggestionsView(arm: arm, onApply: applySuggestion, onDismiss: { arm.dismiss($0, store: store) }) }
                } else if let other = store.activeSet, !other.isComplete {
                    Text("A set is open for \(store.state.pieces.first { $0.id == other.configuration.pieceID }?.title ?? "another piece").")
                        .font(.callout).foregroundStyle(.secondary)
                    Button("Finish current practice") { ending = true }.buttonStyle(.praeludeQuiet)
                } else {
                    Text("Your music can stay on the stand. Play the passage, then tell Praelude how it went.")
                        .font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
                    PracticeArmView(arm: arm, passage: selectedPassage, pieceSubtitle: "Paper or digital score",
                        onRenamePassage: { if let selectedPassage { presentPassageRename(selectedPassage) } },
                        onStarted: {}, onOpenAdvanced: { sheet = .setup }, onSplitPassage: { beginSelection($0) })
                    Button("Choose a passage", action: presentPassagePicker).frame(minHeight: 48).buttonStyle(.praeludeQuiet)
                    NextStepAndSuggestionsView(arm: arm, onApply: applySuggestion, onDismiss: { arm.dismiss($0, store: store) })
                }
                VoiceCommandConfirmationView(speech: speech)
                if let failure = arm.errorMessage { ErrorMessage(message: failure) }
                if let failure = store.errorMessage { ErrorMessage(message: failure) }
                if let failure = metronome.errorMessage { ErrorMessage(message: failure) }
            }.padding(16).frame(maxWidth: 640)
                .frame(maxWidth: .infinity)
        }
        .overlay(alignment: .top) { PracticeFeedbackView(feedback: runtime.feedback, setID: active?.id).allowsHitTesting(false) }
        .accessibilityIdentifier("counterWorkspace")
    }
    private var counterIdentity: some View {
        let passage = active?.configuration.passageSnapshot ?? selectedPassage
        return HStack(spacing: 12) {
            if let passage {
                PassageCardArtwork(passage: passage, piece: piece)
                    .frame(width: 96, height: 64).clipShape(RoundedRectangle(cornerRadius: 8))
                    .accessibilityHidden(true)
            }
            VStack(alignment: .leading, spacing: 3) {
                Text(passage?.title ?? piece?.title ?? "Practice").font(.headline)
                    .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 2)
                Text(active.map { "\(PracticeArmView.goalLabel($0.configuration.goal)) · \(selectedHands)" } ?? "Ready to practice")
                    .font(.caption).foregroundStyle(.secondary)
                if let active, !active.configuration.focus.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                   active.configuration.focus != "Pulse" {
                    Text(active.configuration.focus).font(.caption).foregroundStyle(.secondary)
                }
            }.frame(maxWidth: .infinity, alignment: .leading)
        }
    }
    private func updateCounterScreenPolicy() {
        runtime.setCounterScreenPolicy(ownerID: voiceOwnerID, enabled: showsCounter ? counterKeepAwake : nil, isRunning: active?.status == .running)
    }
    private func beginCounterRest() -> Bool {
        guard let active, !active.isComplete, counterSaveTask == nil, cameraActionTask == nil else { return false }
        do {
            if active.status == .running { try store.pause() }
            metronome.stop()
            return store.activeSet?.status == .paused
        } catch { self.error = error.localizedDescription; return false }
    }
    private func recordCounterVerdict(_ verdict: Verdict) {
        guard !focusMode, let originatingSet = active, originatingSet.status == .running,
              counterSaveTask == nil, cameraActionTask == nil else { return }
        let hands = selectedHands
        counterSaveTask = Task { @MainActor in
            defer { counterSaveTask = nil }
            do {
                FeedbackService.shared.isEnabled = feedbackEnabled
                let committed = try await runtime.recordPreparedAsync(verdict, hands: hands, canCommit: {
                    !Task.isCancelled && !focusMode && active?.id == originatingSet.id && acceptsScoreCommands
                })
                guard committed, !Task.isCancelled, active?.id == originatingSet.id else { return }
                updateVoiceContext(); offerBreakPointTap = verdict == .sloppy
                advancePassagePageIfNeeded()
            } catch is CancellationError { }
            catch { if !Task.isCancelled { self.error = error.localizedDescription } }
        }
    }
    /// Split out of `body` — with every page-tools/link parameter inlined, the containing
    /// `GeometryReader`/`ZStack` expression was too large for the type checker to solve in one pass.
    @ViewBuilder private func scoreView(url: URL) -> some View {
        PagedScoreView(url: url, page: $page, twoPages: twoPages && sizeClass == .regular, focusPageTurns: focusMode, markup: markup,
                       allowsInk: !focusMode && !performanceMode, allowsFocusToggle: !performanceMode, onToggleFocus: { setFocus(!focusMode) }, activeLayer: markup.activeLayer,
                       regions: visibleRegions, regionColors: passageColors, emphasizedIDs: emphasizedIDs, practicedIDs: practicedIDs,
                       pageEdits: effectivePageEdits, scoreLinks: effectiveScoreLinks, onLinkActivated: activateLink,
                       stamps: visibleStamps, textBoxes: visibleTextBoxes, otherLayersInkData: otherLayersInk,
                       drawingData: mergedInkData, saveDrawing: persistInk, saveDrawingAsync: persistInkPrepared, onRegionSelected: onRegionSelected,
                       onPlaceStamp: placeStamp, onPlaceTextBox: placeTextBox, onPlaceBreakPoint: placeBreakPointTap,
                       onEditTextBox: { editTextBox($0, dictate: false) },
                       onRenameRegion: { editPassageName(regionID: $0, dictate: false) },
                       onDictateRegion: { editPassageName(regionID: $0, dictate: true) },
                       onMoveTextBox: moveTextBox,
                       onDictateTextBox: { editTextBox($0, dictate: true) },
                       onTurnPage: turnPage, onLongPress: handleLongPress, onPageChanged: savePage)
            .accessibilityIdentifier("scorePDF")
    }
    private func onRegionSelected(_ id: UUID) {
        let tapped = savedPassages.first(where: { $0.regions.contains { $0.id == id } })
        #if DEBUG
        if InteractionAudit.isEnabled {
            InteractionAudit.record("score.reading.lookup resolved=\(tapped != nil) passages=\(savedPassages.count) reading=\(markup.mode == .reading) active=\(active != nil)")
        }
        #endif
        guard let tapped else { return }
        selectPassage(tapped)
    }
    @ViewBuilder private func visibleControls(in size: CGSize) -> some View {
        withFeedback {
            if dynamicTypeSize.isAccessibilitySize || size.height < 420 {
                VStack(spacing: 0) {
                    if markup.mode == .selecting { selectionTools }
                    ScrollView { practiceDock.fixedSize(horizontal: false, vertical: true) }
                        .accessibilityIdentifier("accessiblePracticeControls")
                }.frame(height: min(520, size.height * (markup.mode == .writing && size.height < 420 ? 0.3 : 0.6)))
            } else { scoreFooter }
        }
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
    private var scoreFooter: some View {
        VStack(spacing: 0) {
            if markup.mode == .selecting { selectionTools }
            practiceDock
        }
    }
    private func editPassageName(regionID: UUID, dictate: Bool) {
        guard let passage = savedPassages.first(where: { $0.regions.contains { $0.id == regionID } }) else {
            #if DEBUG
            InteractionAudit.record("score rename rejected region missing")
            #endif
            return
        }
        let flushed = markup.flushInk()
        #if DEBUG
        InteractionAudit.record("score rename region found dictate=\(dictate) flushed=\(flushed)")
        #endif
        guard flushed else { return }
        presentPassageRename(passage, dictate: dictate)
    }
    private func presentPassageRename(_ passage: Passage, dictate: Bool = false) {
        // Dictation belongs to this presentation. An ordinary edit after a triple tap must
        // never inherit the previous editor's microphone request, even after Cancel or Save.
        #if DEBUG
        InteractionAudit.record("score present rename dictate=\(dictate) wasPresented=\(renamingPassage != nil)")
        #endif
        rememberScoreVoiceForEditor(.passage(passage.id))
        dictatePassageName = dictate
        renamingPassage = passage
    }
    private func presentPassagePicker() {
        rememberScoreVoiceForEditor(.passagePicker)
        sheet = .passages
    }
    private func editTextBox(_ displayed: TextBoxAnnotation, dictate: Bool) {
        // PDF overlays refresh asynchronously. A just-resized overlay can still carry the
        // pre-save timestamp, so establish the editor's conflict baseline from durable state.
        guard let current = store.state.textAnnotations.first(where: {
            $0.id == displayed.id && $0.pieceID == pieceID && $0.deletedAt == nil && $0.layer == markup.activeLayer
        }) else {
            error = "This note is no longer available in the active layer. Close and reopen the score."
            return
        }
        rememberScoreVoiceForEditor(.textAnnotation(current.id))
        dictateTextBox = dictate
        editingSavedTextBox = true
        editingTextBox = current
    }
    private func moveTextBox(_ box: TextBoxAnnotation, _ region: NormalizedRect) -> TextBoxAnnotation? {
        do {
            guard let current = store.state.textAnnotations.first(where: { $0.id == box.id }),
                  current == box else { error = "This note changed elsewhere. Reopen it before moving it."; return nil }
            var moved = current
            moved.region = region
            try store.saveTextAnnotation(moved)
            return store.state.textAnnotations.first { $0.id == box.id }
        } catch { self.error = error.localizedDescription; return nil }
    }
    private var scoreModeControls: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 4) {
                scoreNavigationControls
                Spacer(minLength: 0)
                scoreActionControls
            }
            VStack(spacing: 4) {
                HStack(spacing: 4) { scoreNavigationControls; Spacer(minLength: 0) }
                HStack(spacing: 4) { Spacer(minLength: 0); scoreActionControls }
            }
        }.font(.system(size: 18))
    }
    @ViewBuilder private var scoreNavigationControls: some View {
        Button {
            #if DEBUG
            InteractionAudit.record("score Passages action before=\(String(describing: sheet))")
            #endif
            presentPassagePicker()
        } label: { Image(systemName: "bookmark").frame(width: 44, height: 44).contentShape(Rectangle()) }
            .accessibilityLabel("Passages").accessibilityIdentifier("passages")
        if markup.mode == .reading { pageControls(compact: true) }
    }
    @ViewBuilder private var scoreActionControls: some View {
            Button {
                if speech.isEnabled || speech.isPreparing || speech.errorMessage != nil { sheet = .voice }
                else { startHandsFree() }
            } label: {
                Image(systemName: speech.isListening ? "mic.fill" : "mic").frame(width: 44, height: 44)
                    .overlay(alignment: .topTrailing) {
                        if speech.errorMessage != nil {
                            Image(systemName: "exclamationmark.circle.fill").font(.system(size: 11))
                                .foregroundStyle(.secondary).padding(5).allowsHitTesting(false)
                        }
                    }.contentShape(Rectangle())
            }.accessibilityLabel("Hands-free commands").accessibilityIdentifier("scoreVoice")
                .accessibilityValue(speech.errorMessage != nil ? "Needs attention" : speech.isPreparing ? "Starting" : speech.isListening ? "Listening" : "Off")
            Button { controlsAtTop.toggle() } label: {
                Image(systemName: controlsAtTop ? "arrow.down.to.line" : "arrow.up.to.line").frame(width: 44, height: 44).contentShape(Rectangle())
            }.accessibilityLabel(controlsAtTop ? "Move controls to bottom" : "Move controls to top").accessibilityIdentifier("swapScoreControls")
            Button { returnToPractice() } label: {
                Image(systemName: markup.mode == .writing ? "checkmark" : "play.rectangle").frame(width: 44, height: 44).contentShape(Rectangle())
                    .background(markup.mode == .reading ? Color.primary.opacity(0.08) : .clear, in: RoundedRectangle(cornerRadius: 9))
            }.accessibilityLabel("Practice mode").accessibilityIdentifier("scorePracticeMode")
            Button { beginSelection(nil) } label: {
                Image(systemName: "rectangle.dashed").frame(width: 44, height: 44).contentShape(Rectangle())
            }.accessibilityLabel("Draw passage").accessibilityIdentifier("drawPassageOnScore")
            Button { beginWriting() } label: {
                Image(systemName: "pencil.tip.crop.circle").frame(width: 44, height: 44).contentShape(Rectangle())
                    .background(markup.mode == .writing ? Color.primary.opacity(0.08) : .clear, in: RoundedRectangle(cornerRadius: 9))
            }.accessibilityLabel("Annotate score").accessibilityIdentifier("annotateScore")
    }
    private func returnToPractice() {
        if markup.mode == .selecting { confirmDiscardSelection = true; return }
        guard markup.flushInk() else { return }
        markup.stampDraft = nil
        if !markup.tool.kind.isInkingTool { markup.tool.kind = .pen }
        markup.mode = .reading
    }
    private func closeScore() {
        flushBookmark()
        guard markup.flushInk() else { return }
        if markup.mode == .selecting { closeAfterDiscard = true; confirmDiscardSelection = true; return }
        markup.stampDraft = nil
        if let onClose { onClose() } else { dismiss() }
    }
    private func exportAnnotatedScore() {
        guard !exporting, markup.flushInk() else { return }
        exporting = true
        exportTask = Task { @MainActor in
            defer { exporting = false; exportTask = nil }
            do {
                let url = try await ScoreExport.annotatedPDFResponsive(pieceID: pieceID, store: store)
                guard !Task.isCancelled else {
                    try? FileManager.default.removeItem(at: url.deletingLastPathComponent())
                    return
                }
                sharingURL = url; sheet = .share
            } catch is CancellationError { }
            catch { self.error = error.localizedDescription }
        }
    }
    private var selectionTools: some View {
        VStack(spacing: 2) {
            if verticalSizeClass != .compact && !dynamicTypeSize.isAccessibilitySize {
                Text("Drag a box. Double-tap the score or tap Done to save.")
                    .font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.center)
            }
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 6) {
                    selectionEditButtons
                    Spacer(minLength: 0)
                    selectionCompletionButtons.fixedSize(horizontal: true, vertical: false)
                }
                VStack(spacing: 2) {
                    HStack { selectionEditButtons; Spacer(minLength: 0) }
                    HStack { Spacer(minLength: 0); selectionCompletionButtons }
                }
            }
        }.padding(.horizontal, 12).padding(.top, 2).praeludeScoreChrome()
    }
    private var selectionEditButtons: some View {
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
            Button { markup.removeSelected() } label: {
                Image(systemName: "trash").font(.system(size: 20))
                    .frame(width: 44, height: 44).contentShape(Rectangle())
            }
            .disabled(markup.selectedRegionID == nil).accessibilityLabel("Remove selected box")
            .accessibilityIdentifier("removeBox")
        }.fixedSize()
    }
    private var selectionCompletionButtons: some View {
        HStack(spacing: 12) {
            Button("Cancel") {
                closeAfterDiscard = false
                markup.finish()
            }
                .padding(.horizontal, 6).frame(minWidth: 44, minHeight: 44)
                .accessibilityIdentifier("cancelScoreSelection")
            Button("Done") { saveSelection() }.fontWeight(.semibold)
                .padding(.horizontal, 6).frame(minWidth: 52, minHeight: 44)
                .disabled(markup.regions.isEmpty).accessibilityIdentifier("finishScoreMarkup")
        }
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
            _ = try savedInkData(page: page, layer: markup.activeLayer, data: data, strokes: strokes,
                                 rows: store.inkStrokes(pieceID: pieceID, page: page, layer: markup.activeLayer))
            return true
        } catch { markup.errorMessage = "Ink could not be saved. \(error.localizedDescription)"; return false }
    }
    private func savedInkData(page: Int, layer: InkLayer, data: Data, strokes: [PracticeStore.InkStrokeInput], rows: [InkStroke]) throws -> Data? {
        // Do not assume edits retain saved draw order: a lasso edit can tombstone an old row
        // and insert its replacement later. The receipt must describe the actual saved order.
        let sameOrder = rows.count == strokes.count &&
            zip(rows, strokes).allSatisfy { ($0.0.fingerprint ?? $0.0.data) == ($0.1.fingerprint ?? $0.1.data) }
        let saved = rows.isEmpty ? nil : (sameOrder ? data : try InkPerStroke.merge(rows.map(\.data)).dataRepresentation())
        // A newer writer may already have replaced this receipt. Never evict that writer's
        // cache entry with our older rows, but still return the baseline this operation committed.
        guard store.inkStrokes(pieceID: pieceID, page: page, layer: layer) == rows else { return saved }
        let key = "\(pieceID)|\(page)|\(layer.rawValue)"
        let visible = (max(1, self.page - 2)...(self.page + 2)).compactMap(sourcePage(forDisplayPage:))
        var protected = Set(visible.map { "\(pieceID)|\($0)|\(markup.activeLayer.rawValue)" })
        let pendingLayer = markup.pendingInkLayer ?? markup.activeLayer
        protected.formUnion(markup.pendingInk.keys.map { "\(pieceID)|\($0)|\(pendingLayer.rawValue)" })
        mergedInkCache.insert(key: key, signature: ScoreInkCache.signature(rows), data: saved, protectedKeys: protected)
        return saved
    }
    private func persistInkPrepared(_ page: Int, _ data: Data, _ expected: Data?) async -> ScoreInkSaveReceipt? {
        let layer = markup.activeLayer
        do {
            try Task.checkCancellation()
            guard mergedInkData(page) == expected else { markup.conflictPage = page; return nil }
            let rows = store.inkStrokes(pieceID: pieceID, page: page, layer: layer)
            let split = Task.detached(priority: .utility) {
                try Task.checkCancellation()
                return data.isEmpty ? [] : InkPerStroke.split(try PKDrawing(data: data), reusing: rows)
            }
            let strokes = try await withTaskCancellationHandler {
                try await split.value
            } onCancel: { split.cancel() }
            try Task.checkCancellation()
            let savedRows = try await store.replaceInkPreparedAsync(pieceID: pieceID, page: page, layer: layer, strokes: strokes, expectedRows: rows)
            // A completed store call has already committed. Always return success and publish
            // its cache baseline; a newer Pencil edit must stay dirty in the coordinator.
            return ScoreInkSaveReceipt(data: try savedInkData(page: page, layer: layer, data: data, strokes: strokes, rows: savedRows))
        } catch is CancellationError { return nil }
        catch {
            if !Task.isCancelled {
                if markup.activeLayer == layer && mergedInkData(page) != expected { markup.conflictPage = page }
                else { markup.errorMessage = "Ink could not be saved. \(error.localizedDescription)" }
            }
            return nil
        }
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
        let box = TextBoxAnnotation(pieceID: pieceID, page: page, region: position, text: "", layer: markup.activeLayer)
        rememberScoreVoiceForEditor(.textAnnotation(box.id))
        editingSavedTextBox = false
        dictateTextBox = false
        editingTextBox = box
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
                    active: active, selectedHands: $selectedHands, onRenamePassage: {
                        if let id = active.configuration.passageID, let passage = savedPassages.first(where: { $0.id == id }) { presentPassageRename(passage) }
                    }, passageTitle: active.configuration.passageSnapshot?.title ?? piece?.title ?? active.configuration.focus, arm: arm,
                    speech: speech, voiceOwnerID: voiceOwnerID, flashedCommand: VoiceConfirmationPlayer.shared.lastCommand,
                    flashedCommandID: VoiceConfirmationPlayer.shared.lastCommandID,
                    onVerdict: record, onUndo: { perform { try runtime.undo() } }, onTogglePause: togglePause,
                    onStop: stopPractice, onFinishSession: { perform { try endSessionAndShare(); metronome.stop() } },
                    onAnotherSet: repeatSet,
                    onToggleMetronome: {
                        runtime.setMetronomePlaying(!metronome.isPlaying, for: store.activeSet)
                    }, metronomeOn: metronome.isPlaying,
                    onAdjustTempo: adjustRunningTempo,
                    onMuteVoice: { speech.setMuted(!speech.isMuted) }, onVoiceOff: stopHandsFree,
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
                    onRenamePassage: { if let selectedPassage { presentPassageRename(selectedPassage) } }, onStarted: {}, onOpenAdvanced: { sheet = .setup },
                    onSplitPassage: { beginSelection($0) }
                )

            }
            VoiceCommandConfirmationView(speech: speech)
            if let failure = arm.errorMessage { ErrorMessage(message: failure) }
            if let failure = store.errorMessage { Text(failure).font(.caption).foregroundStyle(.red) }
            if let failure = metronome.errorMessage { Text(failure).font(.caption).foregroundStyle(.red) }
            if active == nil, speech.isListening, speech.ownerID == voiceOwnerID {
                HStack(spacing: 8) {
                    Circle().fill(speech.isMuted ? PraeludeColor.inkTertiary : PraeludeColor.live).frame(width: 6, height: 6)
                    PraeludeIcon(glyph: .mic, size: 14).foregroundStyle(speech.isMuted ? PraeludeColor.inkTertiary : PraeludeColor.live)
                    Text(speech.status).font(.caption)
                    Spacer()
                    Button(speech.isMuted ? "Unmute" : "Mute") { speech.setMuted(!speech.isMuted) }.font(.caption.weight(.semibold))
                        .frame(minHeight: 44).contentShape(Rectangle())
                    Button("Off", action: stopHandsFree).font(.caption.weight(.semibold))
                        .frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
                }.accessibilityElement(children: .combine)
            }
            if markup.mode != .selecting { scoreModeControls }
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
            #if DEBUG
            if InteractionAudit.isEnabled { InteractionAudit.record("score.reading.switchConfirmation") }
            #endif
            pendingPracticePassage = passage
            return
        }
        if active?.isComplete == true {
            #if DEBUG
            if InteractionAudit.isEnabled { InteractionAudit.record("score.reading.endCompletedSet") }
            #endif
            do { try store.endSet() } catch { self.error = error.localizedDescription; return }
        }
        selectIdlePassage(passage)
    }
    private func selectIdlePassage(_ passage: Passage) {
        let flushed = markup.flushInk()
        #if DEBUG
        if InteractionAudit.isEnabled { InteractionAudit.record("score.reading.flush accepted=\(flushed) pendingPages=\(markup.pendingInk.count)") }
        #endif
        guard flushed else { return }
        selectedPassage = passage
        page = displayPage(forSourcePage: passage.page)
        savePage(page)
        rearmIfIdle()
        #if DEBUG
        if InteractionAudit.isEnabled {
            InteractionAudit.record("score.reading.assigned selected=\(selectedPassage?.id == passage.id) armed=\(arm.configuration?.passageID == passage.id) page=\(page)")
        }
        #endif
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
        arm.arm(pieceID: pieceID, passage: selectedPassage, store: store, scoreSection: scopedSection)
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
                .disabled(page <= (scopedDisplayPages.first ?? 1)).accessibilityLabel("Previous page")
            Button { sheet = .pages } label: { Text(pageIndicatorText).font(.subheadline.monospacedDigit()).fixedSize(horizontal: true, vertical: false).frame(minWidth: 54, minHeight: 44) }
                .accessibilityLabel(pageIndicatorDescription).accessibilityIdentifier("pageIndicator")
            Button { turnPage(1) } label: { Image(systemName: "chevron.right").frame(width: 44, height: 44) }
                .disabled(page >= (scopedDisplayPages.last ?? max(1, effectivePageCount))).accessibilityLabel("Next page")
        }
    }
    @ViewBuilder private var jumpBackButton: some View {
        if let backPage = jumpBackStack.last {
            Button { jumpBack() } label: { Image(systemName: "arrow.uturn.backward").frame(width: 44, height: 44) }
                .accessibilityLabel("Jump back to page \(backPage)").accessibilityIdentifier("jumpBack")
        }
    }
    private var gestureGuide: some View {
        NavigationStack {
            List {
                Section("Practice from the score") {
                    Label("Tap the top or bottom middle to hide or restore controls; counting is suspended in focus", systemImage: "viewfinder")
                    Label("Tap a white side margin to turn pages", systemImage: "arrow.right")
                    Label("Use the arrow-to-edge button to move controls between top and bottom", systemImage: "arrow.up.arrow.down")
                    Label("Double-tap a passage name to edit its name and goal tempo", systemImage: "character.cursor.ibeam")
                    Label("Tap a passage to prepare it", systemImage: "hand.tap")
                    Label("Double-tap a selected passage to edit its name and goal tempo", systemImage: "character.cursor.ibeam")
                    Label("Triple-tap a selected passage to dictate its name", systemImage: "mic")
                    Label("Hold a passage for more actions", systemImage: "hand.tap.fill")
                    Label("Tap the tempo number to type a BPM", systemImage: "number")
                    Label("Slide the tempo up or down to adjust it", systemImage: "arrow.up.arrow.down")
                }
                Section("Mark your music") {
                    Label("Pencil writes; fingers move and zoom the score", systemImage: "pencil.tip")
                    Label("Two-finger tap undoes the last ink change", systemImage: "arrow.uturn.backward")
                    Label("Drag the palette handle to move your tools", systemImage: "line.3.horizontal")
                    Label("Minimize the tools to keep more music visible", systemImage: "minus")
                    Label("Tap a sticky note, then drag inside to move it", systemImage: "arrow.up.and.down.and.arrow.left.and.right")
                    Label("Drag a note’s corner handles to resize its box", systemImage: "arrow.up.left.and.arrow.down.right")
                    Label("Double-tap a note to edit; triple-tap to dictate", systemImage: "text.bubble")
                    Label("In the note editor, scroll down to Text style", systemImage: "textformat")
                }
                Section {
                    Text("The practice buttons stay available while you draw. Undo, passage actions and text editing also have visible button alternatives.")
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Score gestures").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { sheet = nil } } }
        }
    }
    private var voiceSheet: some View {
        voiceSheetLayout.presentationDetents([.large])
    }
    @ViewBuilder private var voiceSheetLayout: some View {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--uitesting"),
           ProcessInfo.processInfo.arguments.contains("--audit-simulated-voice") {
            // Give navigation its own bounds above the synthetic controls. An inset outside
            // the stack can leave its final List row underneath the audit strip.
            VStack(spacing: 0) {
                voiceSheetNavigation
                voiceAuditControls
            }
        } else { voiceSheetNavigation }
        #else
        voiceSheetNavigation
        #endif
    }
    private var voiceSheetNavigation: some View {
        NavigationStack {
            List {
                Section {
                    Label("Your voice is the verdict", systemImage: "mic")
                    Text("Praelude recognizes short commands on this device. It never listens for right or wrong notes.").foregroundStyle(.secondary)
                }
                if let failure = speech.errorMessage { Section { Text(failure).foregroundStyle(.secondary) } }
                Section {
                    Button((speech.isEnabled || speech.isPreparing) ? "Turn hands-free off" : "Enable hands-free") {
                        if speech.isEnabled || speech.isPreparing { stopHandsFree() }
                        else { startHandsFree() }
                    }.frame(minHeight: 44).fontWeight(.semibold).accessibilityIdentifier("enableHandsFree")
                    if speech.isListening {
                        Button(speech.isMuted ? "Unmute" : "Mute") { speech.setMuted(!speech.isMuted) }.frame(minHeight: 44)
                    }
                    if speech.isEnabled && !speech.isListening && !speech.isPreparing && !speech.isRecovering {
                        Button("Retry listening") { speech.retryListening(ifOwnedBy: voiceOwnerID) }.frame(minHeight: 44).accessibilityIdentifier("retryScoreVoice")
                    }
                    Text(speech.status).font(.caption).foregroundStyle(.secondary)
                } footer: { Text("Microphone and Speech Recognition permissions are requested only when you enable this. On-device speech availability depends on your device and downloaded language support.") }
                Section("Say a command") {
                    LabeledContent("Clean · Sloppy · Again", value: "Record a rep")
                    LabeledContent("Shaky · Missed", value: "Grade the first try today")
                    LabeledContent("Undo", value: "Correct the last rep")
                    LabeledContent("Start · Stop", value: "Begin or end the set")
                    LabeledContent("Pause · Resume", value: "Hold the set")
                    LabeledContent("Next set", value: "Another set once this one is complete")
                    LabeledContent("Slower · Faster", value: "Nudge the armed tempo ±5")
                    LabeledContent("Next · Next page · Previous page", value: "Turn pages")
                    LabeledContent("Metronome start · Stop metronome", value: "Control the click")
                    LabeledContent("Tempo eighty", value: "Set 80 BPM")
                }
                Section {
                    NavigationLink("Customize command phrases") { VoiceCommandSettingsView() }
                    NavigationLink("Microphone & recognition checks") { VoiceDiagnosticsView() }
                    NavigationLink("Check voice recognition") { VoiceOnboardingView() }
                }
            }.navigationTitle("Hands-free").navigationBarTitleDisplayMode(.inline)
                .onAppear { setVoiceControlsVisible(true) }
                .onDisappear { setVoiceControlsVisible(false) }
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { sheet = nil } } }
                .onChange(of: showFirstVoiceCheck) { _, _ in updateVoiceContext() }
                .sheet(isPresented: $showFirstVoiceCheck, onDismiss: {
                    speech.start(ownerID: voiceOwnerID, onCommand: handleVoice)
                    updateVoiceContext()
                }) { VoiceOnboardingView() }
        }
    }

    #if DEBUG
    private var voiceAuditStateValue: String {
        let attempts = active?.attempts.filter { $0.undoneAt == nil }.count ?? 0
        let rawAttemptRows = active?.attempts.count ?? 0
        let undoneRows = active?.attempts.filter { $0.undoneAt != nil }.count ?? 0
        let supported = speech.supportedActions.map(\.rawValue).sorted().joined(separator: ",")
        return "attempts=\(attempts);page=\(page);clickBPM=\(metronome.bpm);click=\(metronome.isPlaying ? 1 : 0);armedBPM=\(arm.configuration?.startBPM ?? -1);supported=\(supported);root=\(voiceControlsVisible ? 1 : 0);listening=\(speech.isListening ? 1 : 0);muted=\(speech.isMuted ? 1 : 0);rawAttemptRows=\(rawAttemptRows);undoneRows=\(undoneRows);historySets=\(store.state.history.count);sessions=\(store.state.sessions.count);ending=\(ending ? 1 : 0);dialogPending=\(voiceAuditDialogPending ? 1 : 0);dialogBatch=\(voiceAuditDialogBatch);dialogDeliveryEnding=\(voiceAuditDialogDeliveryEnding ? 1 : 0);scoreOwner=\(speech.ownerID == voiceOwnerID ? 1 : 0);ownerPresent=\(speech.ownerID == nil ? 0 : 1);resumePending=\(resumeScoreVoiceAfterSettings ? 1 : 0)"
    }
    @ViewBuilder private var voiceAuditControls: some View {
        if ProcessInfo.processInfo.arguments.contains("--uitesting"),
           ProcessInfo.processInfo.arguments.contains("--audit-simulated-voice") {
            VStack(spacing: 2) {
                Text("Synthetic recognition audit")
                    .font(.caption2)
                    .accessibilityIdentifier("voiceAuditState")
                    .accessibilityValue(voiceAuditStateValue)
                HStack(spacing: 8) {
                    voiceAuditButton("Clean", "voiceAuditInjectClean", "clean")
                    voiceAuditButton("Undo", "voiceAuditInjectUndo", "undo")
                    voiceAuditButton("Next", "voiceAuditInjectNext", "next")
                    voiceAuditButton("Click on", "voiceAuditInjectMetronomeStart", "metronome on")
                    voiceAuditButton("Click off", "voiceAuditInjectMetronomeStop", "metronome off")
                    Button("Retain 90") { metronome.setTempo(90) }
                        .accessibilityIdentifier("voiceAuditRetain90")
                    Button("Queue dialog commands") { voiceAuditDialogPending = true }
                        .accessibilityIdentifier("voiceAuditQueueDialogCommands")
                }.font(.caption).buttonStyle(.bordered)
            }.padding(4).frame(maxWidth: .infinity).background(.regularMaterial)
                .accessibilityElement(children: .contain).accessibilityIdentifier("voiceAuditStrip")
        }
    }
    private func voiceAuditButton(_ title: String, _ identifier: String, _ transcript: String) -> some View {
        Button(title) {
            speech.receive(transcript: transcript, isFinal: true, error: nil, id: speech.activeRecognitionID)
        }.accessibilityIdentifier(identifier)
    }
    private func deliverVoiceAuditDialogCommandsIfArmed() {
        guard ProcessInfo.processInfo.arguments.contains("--uitesting"),
              ProcessInfo.processInfo.arguments.contains("--audit-simulated-voice"),
              voiceAuditDialogPending else { return }
        voiceAuditDialogPending = false
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(2))
            guard ending else { return }
            voiceAuditDialogDeliveryEnding = ending
            for transcript in ["clean", "undo", "next", "metronome on"] {
                speech.receive(transcript: transcript, isFinal: true, error: nil, id: speech.activeRecognitionID)
            }
            voiceAuditDialogBatch += 1
        }
    }
    #endif
    private func openScoreSection(at source: Int) {
        scopedSectionID = piece?.scoreSections.first { $0.startPage == source }?.id
        if active == nil || active?.isComplete == true {
            if let selectedPassage, let scopedPages,
               !(selectedPassage.regions.isEmpty ? [selectedPassage.page] : selectedPassage.regions.map(\.page)).allSatisfy(scopedPages.contains) {
                self.selectedPassage = nil
                arm.clearArm()
            }
            rearmIfIdle()
        }
        page = displayPage(forSourcePage: source); savePage(page)
    }
    private func turnPage(_ direction: Int) {
        guard markup.flushInk() else { return }
        let step = (twoPages && sizeClass == .regular && !halfPageTurns) ? 2 : 1
        page = ScorePageNavigation.advance(page, by: direction * step, among: scopedDisplayPages)
        savePage(page)
    }
    private func savePage(_ requestedPage: Int) {
        let accepted = ScorePageNavigation.nearest(requestedPage, among: scopedDisplayPages)
        if page != accepted { page = accepted }
        pendingBookmark = (pieceID, accepted)
        pageSaveTask?.cancel()
        pageSaveTask = Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(250))
            guard !Task.isCancelled else { return }
            guard let pending = pendingBookmark else { return }
            do {
                try await store.updateLastPagePreparedAsync(pieceID: pending.pieceID, page: pending.page)
                if pendingBookmark?.pieceID == pending.pieceID && pendingBookmark?.page == pending.page { pendingBookmark = nil }
            } catch is CancellationError { }
            catch { if !Task.isCancelled { self.error = error.localizedDescription } }
        }
    }
    private func flushBookmark() {
        pageSaveTask?.cancel(); pageSaveTask = nil
        guard let pending = pendingBookmark else { return }
        do {
            try store.updateLastPage(pieceID: pending.pieceID, page: pending.page)
            pendingBookmark = nil
        } catch { self.error = error.localizedDescription }
    }
    private func setFocus(_ focused: Bool) {
        guard focused != focusMode else { return }
        if focused {
            guard markup.mode != .selecting, markup.flushInk() else { return }
            markup.mode = .reading
            markup.quickBoxArmed = false; markup.breakPointArmed = false
        }
        // The set remains intact. This gate also covers voice and keyboard verdicts.
        runtime.setRepInputSuspended(focused, ownerID: voiceOwnerID)
        focusMode = focused
    }
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
        guard let target = jumpBackStack.last, markup.flushInk() else { return }
        jumpBackStack.removeLast()
        page = target
        savePage(page)
    }
    /// §7 performance mode. Refuses to enter with unsaved ink still pending, the same guard every
    /// other page-changing action here already uses — performance mode is exited by a long press
    /// with no confirmation, so it should never risk a silent ink loss on the way in.
    private func enterPerformanceMode() {
        guard markup.flushInk() else { return }
        setFocus(true)
        guard focusMode else { return }
        performanceMode = true
        PraeludeHaptic.confirm()
    }
    private func exitPerformanceMode() {
        guard performanceMode else { return }
        performanceMode = false; setFocus(false)
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
        guard !focusMode, active?.status == .running else { return }
        perform {
            if metronome.isPlaying, let active, abs(metronome.bpm - active.currentBPM) > 0.001 {
                metronome.setTempo(active.currentBPM)
                throw PracticeError.conflict("The click was restored to your set tempo. Repeat the passage before recording it.")
            }
            FeedbackService.shared.isEnabled = feedbackEnabled
            _ = try runtime.record(verdict, hands: selectedHands)
            updateVoiceContext()
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
    private var cameraOverlay: some View {
        ScoreCameraControls(camera: camera, openSettings: { sheet = .camera })
    }
    private func updateCameraContext() {
        if camera.isEnabled { camera.onAction = handleCameraAction }
        else { camera.onAction = nil }
        camera.actionsAllowed = acceptsCameraActions
        camera.verdictActionsAllowed = !focusMode && active?.status == .running && !arm.awaitingColdGrade
        camera.verdictUnavailableReason = focusMode ? "leave score focus to record reps"
            : arm.awaitingColdGrade ? "choose the first-attempt grade on screen"
            : "start a practice set to record reps"
    }
    private var scoreInputIsUnobstructed: Bool {
        scenePhase == .active && editingTextBox == nil && renamingPassage == nil &&
        !importing && !ending && !exporting && pendingPracticePassage == nil &&
        !confirmDiscardSelection && markup.conflictPage == nil && longPressedPassage == nil && error == nil
    }
    private var acceptsCameraActions: Bool {
        scoreInputIsUnobstructed && sheet == nil && markup.mode == .reading && !showFirstVoiceCheck
    }
    private func handleCameraAction(_ action: FaceGestureAction) {
        // Recheck at dispatch; a tracked face never authorizes writing through another scene or editor.
        guard acceptsCameraActions else { return }
        switch action {
        case .off: break
        case .nextPage: turnPage(1)
        case .previousPage: turnPage(-1)
        case .clean, .sloppy, .again:
            guard camera.settings.allowVerdicts, !focusMode, !arm.awaitingColdGrade, active?.status == .running else { return }
            guard cameraActionTask == nil else { return }
            let verdict: Verdict = action == .clean ? .clean : action == .sloppy ? .sloppy : .again
            let camera = camera
            let originatingCameraContextID = camera.commandContextID
            let originatingSetID = active?.id
            let originatingPage = page
            let originatingPassageID = selectedPassage?.id
            camera.commandInFlight = true
            cameraActionTask = Task { @MainActor in
                defer { camera.commandInFlight = false; cameraActionTask = nil }
                do {
                    FeedbackService.shared.isEnabled = feedbackEnabled
                    let committed = try await runtime.recordPreparedAsync(verdict, hands: selectedHands, canCommit: {
                        !Task.isCancelled && camera.commandContextID == originatingCameraContextID &&
                        acceptsCameraActions && active?.id == originatingSetID && page == originatingPage &&
                        selectedPassage?.id == originatingPassageID && camera.isEnabled &&
                        camera.actionsAllowed && camera.verdictActionsAllowed && camera.settings.allowVerdicts
                    })
                    guard committed, !Task.isCancelled, camera.isEnabled,
                          camera.commandContextID == originatingCameraContextID, acceptsCameraActions,
                          active?.id == originatingSetID, page == originatingPage,
                          selectedPassage?.id == originatingPassageID else { return }
                    updateVoiceContext(); offerBreakPointTap = verdict == .sloppy
                    advancePassagePageIfNeeded()
                } catch is CancellationError { }
                catch { if !Task.isCancelled && camera.isEnabled { self.error = error.localizedDescription } }
            }
        }
    }

    private func startHandsFree() {
        speech.start(ownerID: voiceOwnerID, onCommand: handleVoice)
        updateVoiceContext()
    }
    private func stopHandsFree() {
        resumeScoreVoiceAfterSettings = false
        editorVoiceHandoff = nil
        speech.stop(ifOwnedBy: voiceOwnerID)
    }
    private func rememberScoreVoiceForEditor(_ target: EditorVoiceHandoff.Target) {
        // Capture before presentation: automatic dictation may take ownership in onAppear.
        guard speech.ownerID == voiceOwnerID, speech.isEnabled else { editorVoiceHandoff = nil; return }
        editorVoiceHandoff = EditorVoiceHandoff(pieceID: pieceID, ownerID: voiceOwnerID,
                                              target: target, muted: speech.isMuted)
    }
    private func restoreEditorVoiceIfNeeded() {
        Task { @MainActor in
            await Task.yield()
            guard let handoff = editorVoiceHandoff else { return }
            guard handoff.pieceID == pieceID, handoff.ownerID == voiceOwnerID else {
                editorVoiceHandoff = nil
                return
            }
            switch handoff.target {
            case .passage(let id): guard renamingPassage?.id != id else { return }
            case .textAnnotation(let id): guard editingTextBox?.id != id else { return }
            case .passagePicker: guard sheet != .passages else { return }
            }
            // Nested rename can release dictation while its picker still covers the score.
            guard sheet == nil, acceptsScoreCommands else { return }
            if speech.ownerID == voiceOwnerID { editorVoiceHandoff = nil; return }
            guard speech.ownerID == nil else { return }
            startHandsFree()
            guard speech.ownerID == voiceOwnerID else { return }
            speech.setMuted(handoff.muted)
            editorVoiceHandoff = nil
        }
    }
    private var acceptsScoreCommands: Bool {
        scoreInputIsUnobstructed && markup.mode != .selecting && !showFirstVoiceCheck &&
        (sheet == nil || (sheet == .voice && voiceControlsVisible && !showFirstVoiceCheck))
    }
    private func setVoiceControlsVisible(_ visible: Bool) {
        if !visible, sheet == .voice, speech.ownerID == voiceOwnerID, speech.isEnabled {
            resumeScoreVoiceAfterSettings = true
            resumeScoreVoiceMuted = speech.isMuted
        }
        voiceControlsVisible = visible
        updateVoiceContext()
        if visible { restoreScoreVoiceIfNeeded() }
    }
    private func restoreScoreVoiceIfNeeded() {
        // A native Back transition can reveal this root before the recognition check's
        // onDisappear releases its owner. Keep the prior opt-in until that release arrives.
        Task { @MainActor in
            await Task.yield()
            guard voiceControlsVisible, sheet == .voice, resumeScoreVoiceAfterSettings,
                  scenePhase == .active else { return }
            if speech.ownerID == voiceOwnerID {
                resumeScoreVoiceAfterSettings = false
                return
            }
            guard speech.ownerID == nil else { return }
            startHandsFree()
            guard speech.ownerID == voiceOwnerID else { return }
            speech.setMuted(resumeScoreVoiceMuted)
            resumeScoreVoiceAfterSettings = false
        }
    }
    private func prepareMetronomeForCurrentContext() {
        if let set = store.activeSet, !set.isComplete { metronome.setTempo(set.currentBPM) }
        else if let configuration = arm.configuration { metronome.setTempo(configuration.startBPM) }
    }
    private func updateVoiceContext() {
        var actions: Set<VoiceCommandAction> = [.nextPage, .previousPage, .metronomeStart, .metronomeStop, .tempo, .slower, .faster]
        if !focusMode {
            if let active {
                if active.status == .running { actions.formUnion([.clean, .sloppy, .again, .pause, .stop]) }
                if active.status == .paused { actions.formUnion([.resume, .stop]) }
                if active.isComplete { actions.insert(.next) }
                if hasUndoableAttempt { actions.insert(.undo) }
            } else if store.activeSet == nil || store.activeSet?.isComplete == true {
                actions.insert(.start)
                if arm.awaitingColdGrade { actions.formUnion([.clean, .shaky, .missed]) }
            }
        } else if active?.status == .running { actions.insert(.pause) }
        else if active?.status == .paused { actions.insert(.resume) }
        if !acceptsScoreCommands { actions = [] }
        speech.setCommandContext(active?.id ?? voiceOwnerID, supportedActions: actions, ifOwnedBy: voiceOwnerID)
    }
    private var hasUndoableAttempt: Bool {
        active?.attempts.contains(where: { $0.undoneAt == nil }) == true
    }
    private func handleVoice(_ command: VoiceCommand) {
        // A modal editor owns its own input; speech never writes through an open setup sheet.
        guard acceptsScoreCommands else { return }
        guard !focusMode || !command.altersPracticeHistory else { return }
        let idle = store.activeSet == nil || store.activeSet?.isComplete == true
        switch command {
        case .clean: if arm.awaitingColdGrade { armStart(grade: .clean) } else { record(.clean) }
        case .sloppy: record(.sloppy)
        case .again: record(.again)
        // §9: cold grading only means something while the cold-grade prompt is actually showing —
        // outside that moment these two words are inert, the same firewall as every other command.
        case .shaky: if arm.awaitingColdGrade { armStart(grade: .shaky) }
        case .missed: if arm.awaitingColdGrade { armStart(grade: .missed) }
        case .undo: if hasUndoableAttempt { perform { try runtime.undo(); updateVoiceContext() } }
        case .pause: if active != nil { perform { try store.pause() } }
        case .resume: if active != nil { perform { try store.resume() } }
        case .start: if idle { armStart(skippingColdGrade: true) }
        case .stop: if active != nil { stopPractice() }
        case .next:
            // The explicit "Next set" command is defined as
            // moving straight on to another set on the same passage once this one is complete.
            if let active, active.isComplete { repeatSet(); if store.activeSet == nil { armStart(skippingColdGrade: true) } }
        case .slower: nudgeTempo(-5)
        case .faster: nudgeTempo(5)
        case .metronomeStart:
            prepareMetronomeForCurrentContext()
            runtime.setMetronomePlaying(true, for: store.activeSet)
        case .metronomeStop: runtime.setMetronomePlaying(false, for: store.activeSet)
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

/// Observe live camera feedback in this small subtree, leaving score/PDF layout independent.
private struct ScoreCameraControls: View {
    @Bindable var camera: FaceGestureService
    let openSettings: () -> Void
    var body: some View {
        VStack(alignment: .trailing, spacing: 4) {
            if camera.showPreview { FaceCameraPreview(camera: camera).frame(width: 200, height: 160).clipShape(RoundedRectangle(cornerRadius: 10)) }
            HStack(spacing: 2) {
                Button(action: openSettings) { Image(systemName: "faceid").frame(width: 44, height: 44) }.accessibilityLabel("Camera gesture settings")
                Button { camera.showPreview.toggle() } label: { Image(systemName: camera.showPreview ? "minus" : "video").frame(width: 44, height: 44) }.accessibilityLabel(camera.showPreview ? "Minimize camera" : "Show camera")
                Button { camera.stop() } label: { Image(systemName: "xmark").frame(width: 44, height: 44) }.accessibilityLabel("Turn camera off")
            }.praeludeScoreChrome().clipShape(Capsule())
            Text(camera.status).font(.caption2).multilineTextAlignment(.trailing).frame(maxWidth: 200)
                .padding(6).praeludeScoreChrome().clipShape(RoundedRectangle(cornerRadius: 8))
        }.accessibilityIdentifier("scoreCameraControls")
    }
}
