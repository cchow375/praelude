import SwiftUI
import UniformTypeIdentifiers

private enum ScoreSheet: String, Identifiable {
    case setup, passages, metronome, pages, voice, passageDetails, share
    var id: String { rawValue }
}

struct ScoreWorkspace: View {
    let pieceID: UUID
    let onClose: (() -> Void)?
    var sharedMarkup: ScoreMarkupState? = nil
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
    @State private var localMarkup = ScoreMarkupState()
    private var markup: ScoreMarkupState { sharedMarkup ?? localMarkup }
    @State private var drawAfterDismiss: Passage?
    @State private var confirmDiscardSelection = false
    @State private var selectedPassage: Passage?
    @State private var sheet: ScoreSheet?
    @State private var setupAfterDismiss = false
    @State private var focusMode = false
    @State private var twoPages = false
    @State private var importing = false
    @State private var ending = false
    @State private var error: String?
    @State private var sharingURL: URL?
    private var piece: Piece? { store.state.pieces.first { $0.id == pieceID } }
    private var active: ActiveSet? { store.activeSet?.configuration.pieceID == pieceID ? store.activeSet : nil }
    private var scoreURL: URL? { piece.flatMap { NativeLibraryFiles(store: store).scoreURL(for: $0) } }
    private var savedPassages: [Passage] { store.state.passages.filter { $0.pieceID == pieceID } }
    private var visibleRegions: [PassageRegion] {
        let snapshot = active?.configuration.passageSnapshot?.regions ?? []
        let snapshotIDs = Set(snapshot.map(\.id))
        return savedPassages.flatMap(\.regions).filter { !snapshotIDs.contains($0.id) } + snapshot
    }
    private var emphasizedIDs: Set<UUID> { Set((active?.configuration.passageSnapshot ?? selectedPassage)?.regions.map(\.id) ?? []) }
    private var practicedIDs: Set<UUID> {
        let practiced = (store.state.history + [active].compactMap { $0 }).filter { !$0.effectiveAttempts.isEmpty }
            .compactMap(\.configuration.passageSnapshot).flatMap(\.regions)
        return Set(visibleRegions.filter { practiced.contains($0) }.map(\.id))
    }
    var body: some View {
        Group {
            if let piece {
                GeometryReader { geometry in
                    ZStack {
                        if let scoreURL, FileManager.default.fileExists(atPath: scoreURL.path) {
                            // Pinned paper-white, not the paper/stage token: the score stays paper in both appearances.
                            PraeludeColor.scorePaper
                            PagedScoreView(url: scoreURL, page: $page, twoPages: twoPages && sizeClass == .regular, focusPageTurns: focusMode, markup: markup,
                                           regions: visibleRegions, emphasizedIDs: emphasizedIDs, practicedIDs: practicedIDs,
                                           drawingData: { store.drawing(pieceID: pieceID, page: $0) },
                                           saveDrawing: persistInk, onRegionSelected: { id in
                                               selectedPassage = savedPassages.first { $0.regions.contains { $0.id == id } }
                                           }, onTurnPage: turnPage, onPageChanged: savePage)
                                .accessibilityIdentifier("scorePDF")

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
                    .overlay(alignment: .bottom) {
                        if markup.mode == .reading {
                            PracticeFeedbackView(feedback: runtime.feedback, setID: active?.id)
                                .padding(.bottom, 12).allowsHitTesting(false)
                        }
                    }
                    .safeAreaInset(edge: .top, spacing: 0) {
                        if markup.mode != .reading {
                            markupHeader
                        } else if focusMode {
                            HStack {
                                Button { focusMode = false } label: { Label("Exit focus", systemImage: "arrow.down.right.and.arrow.up.left") }.buttonStyle(.praeludeQuiet).fixedSize()
                                Spacer()
                                pageControls(compact: true)
                            }.padding(.horizontal, 16).padding(.vertical, 8).praeludeScoreChrome()
                        } else if piece.pageCount > 0 {
                            HStack {
                                Button { sheet = .passages } label: {
                                    if dynamicTypeSize.isAccessibilitySize {
                                        PraeludeIcon(glyph: .passageBox, size: 20).frame(minWidth: 44)
                                            .accessibilityLabel(selectedPassage?.title ?? "Passages")
                                    } else {
                                        Label {
                                            Text(selectedPassage?.title ?? "Passages").lineLimit(1).font(.subheadline.weight(.medium))
                                        } icon: { PraeludeIcon(glyph: .passageBox, size: 16) }
                                            .frame(minHeight: 44).contentShape(Rectangle())
                                    }
                                }.frame(minHeight: 44).accessibilityIdentifier("passages")
                                Button { beginSelection(nil) } label: { PraeludeIcon(glyph: .passageBox, size: 20).frame(width: 44, height: 44) }
                                    .accessibilityLabel("Draw passage").accessibilityIdentifier("drawPassageOnScore")
                                Spacer(minLength: 8)
                                pageControls(compact: false)
                            }.padding(.horizontal, 16).praeludeScoreChrome()
                        }
                    }
                    .safeAreaInset(edge: .bottom, spacing: 0) {
                        if markup.mode == .selecting {
                            selectionTools
                        } else if markup.mode == .reading && !focusMode {
                            if dynamicTypeSize.isAccessibilitySize {
                                ScrollView {
                                    practiceDock.fixedSize(horizontal: false, vertical: true)
                                }
                                .frame(height: min(520, geometry.size.height * 0.6))
                                .praeludeScoreChrome()
                                .accessibilityIdentifier("accessiblePracticeControls")
                            } else { practiceDock }
                        }
                    }
                }
                .navigationTitle(piece.title).navigationBarTitleDisplayMode(.inline)
                .toolbar(focusMode || markup.mode != .reading ? .hidden : .visible, for: .navigationBar)
                .toolbar {
                    if let onClose { ToolbarItem(placement: .topBarLeading) { Button(action: onClose) { Image(systemName: "chevron.down").frame(width: 44, height: 44).contentShape(Rectangle()) }.accessibilityLabel("Close score") } }
                    ToolbarItemGroup(placement: .topBarTrailing) {
                        Button { beginWriting() } label: { Image(systemName: "pencil.tip.crop.circle").frame(width: 44, height: 44).contentShape(Rectangle()) }
                            .accessibilityLabel("Annotate score").accessibilityIdentifier("annotateScore")
                        Button { sheet = .metronome } label: { PraeludeIcon(glyph: .metronome, size: 22).frame(width: 44, height: 44).contentShape(Rectangle()) }
                            .accessibilityLabel("Metronome").accessibilityIdentifier("openMetronome")
                        Menu {
                            Button { focusMode = true } label: { Label("Focus on score", systemImage: "arrow.up.left.and.arrow.down.right") }
                            if sizeClass == .regular {
                                Toggle("Two pages", isOn: $twoPages).praeludeToggleHaptic(twoPages)
                                if supportsMultipleWindows { Button("Open score in new window", systemImage: "rectangle.on.rectangle") { openWindow(value: pieceID) } }
                            }
                            Button("Passages", systemImage: "bookmark") { sheet = .passages }
                            Button("Draw a passage", systemImage: "rectangle.dashed") { beginSelection(nil) }
                            if let selectedPassage {
                                Button("Edit passage boxes", systemImage: "rectangle.and.pencil.and.ellipsis") { beginSelection(selectedPassage) }
                                Button("Passage details", systemImage: "slider.horizontal.3") { sheet = .passageDetails }
                                Button("Practice whole piece", systemImage: "doc") { self.selectedPassage = nil }
                            }
                            Button(speech.isListening ? "Turn voice off" : "Hands-free commands", systemImage: speech.isListening ? "mic.slash" : "mic") {
                                if speech.isListening { speech.stop() } else { sheet = .voice }
                            }
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
        .sheet(item: $sheet, onDismiss: {
            if let sharingURL { try? FileManager.default.removeItem(at: sharingURL.deletingLastPathComponent()); self.sharingURL = nil }
            if let passage = drawAfterDismiss { drawAfterDismiss = nil; markup.begin(passage, baseline: savedPassages.first { $0.id == passage.id }) }
            else if setupAfterDismiss { setupAfterDismiss = false; sheet = .setup }
        }) { item in
            switch item {
            case .setup: SetComposerView(pieceID: pieceID, passage: selectedPassage, onStarted: { refreshAudio() })
            case .passages: PassagePickerView(pieceID: pieceID, currentPage: page, onSelect: { passage in
                selectedPassage = passage; page = passage.page; savePage(page)
                if store.activeSet == nil || store.activeSet?.isComplete == true { setupAfterDismiss = true }
            }, onDraw: { passage in drawAfterDismiss = passage ?? newPassage() })
            case .passageDetails:
                if let selectedPassage {
                    NavigationStack {
                        PassageEditorView(passage: selectedPassage, pageCount: max(1, piece?.pageCount ?? 1)) {
                            self.selectedPassage = store.state.passages.first { $0.id == selectedPassage.id }; sheet = nil
                        }.toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { sheet = nil } } }
                    }
                }
            case .metronome: MetronomeView()
            case .pages: if let scoreURL { ScorePagePicker(url: scoreURL, currentPage: page, onSelect: { if markup.flushInk() { page = $0; savePage($0) } }) }
            case .voice: voiceSheet
            case .share: if let sharingURL { ScoreShareView(url: sharingURL) }
            }
        }
        .confirmationDialog("Discard these passage edits?", isPresented: $confirmDiscardSelection, titleVisibility: .visible) {
            Button("Discard edits", role: .destructive) { markup.finish() }
            Button("Keep editing", role: .cancel) {}
        }
        .confirmationDialog("Ink changed in another window", isPresented: Binding(get: { markup.conflictPage != nil }, set: { if !$0 { markup.conflictPage = nil } }), titleVisibility: .visible, presenting: markup.conflictPage) { page in
            Button("Keep my drawing") { markup.resolveInkConflict(page, true) }
            Button("Use the saved drawing", role: .destructive) { markup.resolveInkConflict(page, false) }
            Button("Keep editing", role: .cancel) { markup.conflictPage = nil }
        } message: { _ in Text("Both windows edited this page. Choose which drawing to keep. Your unsaved drawing stays open until you decide.") }
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
        .onDisappear { _ = markup.flushInk(); speech.stop(ifOwnedBy: voiceOwnerID); runtime.scoreDisappeared(ownerID: voiceOwnerID) }
        .onChange(of: pieceID) { _, _ in page = piece?.lastPage ?? 1; selectedPassage = nil; speech.stop(ifOwnedBy: voiceOwnerID) }
        .onChange(of: scenePhase) { _, phase in if phase != .active { _ = markup.flushInk() } }
        .onChange(of: markup.errorMessage) { _, message in if let message { error = message; markup.errorMessage = nil } }
        .onChange(of: store.state.passages) { _, passages in
            if let selectedPassage { self.selectedPassage = passages.first { $0.id == selectedPassage.id } }
        }
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
    private var markupHeader: some View {
        @Bindable var markup = markup
        let shortScreen = verticalSizeClass == .compact
        let simplifiedLabels = shortScreen || dynamicTypeSize.isAccessibilitySize
        return VStack(spacing: 4) {
            HStack(spacing: 8) {
                if markup.mode == .selecting {
                    Button { confirmDiscardSelection = true } label: {
                        if simplifiedLabels {
                            Image(systemName: "xmark").font(.system(size: 20))
                                .frame(width: 44, height: 44).contentShape(Rectangle())
                        } else {
                            Text("Cancel").frame(minWidth: 60, minHeight: 44).contentShape(Rectangle())
                        }
                    }.accessibilityLabel("Cancel")
                }
                if shortScreen {
                    pageControls(compact: true)
                } else if !simplifiedLabels {
                    Text(markup.mode == .selecting ? "Select passage" : "Write on score")
                        .font(.headline).frame(maxWidth: .infinity, alignment: .leading)
                }
                Spacer(minLength: 0)
                Button {
                    if markup.mode == .selecting { saveSelection() }
                    else if markup.flushInk() { markup.mode = .reading }
                } label: {
                    Text("Done").fontWeight(.semibold).fixedSize(horizontal: true, vertical: false)
                        .frame(minWidth: 60, minHeight: 44).contentShape(Rectangle())
                }
                .disabled(markup.mode == .selecting && markup.regions.isEmpty)
                .accessibilityIdentifier("finishScoreMarkup")
            }
            if markup.mode == .writing {
                HStack(spacing: 8) {
                    Toggle(isOn: $markup.fingerDrawing) {
                        if simplifiedLabels {
                            Image(systemName: "hand.draw").font(.system(size: 20))
                                .frame(width: 32, height: 32)
                        } else {
                            Text("Draw with finger").font(.subheadline)
                        }
                    }
                    .accessibilityLabel("Draw with finger")
                    .accessibilityIdentifier("fingerDrawing")
                    .praeludeToggleHaptic(markup.fingerDrawing)
                    Button(action: markup.undoInk) {
                        Image(systemName: "arrow.uturn.backward").font(.system(size: 20))
                            .frame(width: 44, height: 44).contentShape(Rectangle())
                    }.disabled(!markup.canUndoInk).accessibilityLabel("Undo ink")
                    Button(action: markup.redoInk) {
                        Image(systemName: "arrow.uturn.forward").font(.system(size: 20))
                            .frame(width: 44, height: 44).contentShape(Rectangle())
                    }.disabled(!markup.canRedoInk).accessibilityLabel("Redo ink")
                }
            }
            if !shortScreen {
                let status = markup.mode == .selecting ? "\(markup.regions.count) \(markup.regions.count == 1 ? "box" : "boxes")" : markup.fingerDrawing ? "Finger drawing on" : "Pencil writes · fingers navigate"
                if dynamicTypeSize.isAccessibilitySize {
                    pageControls(compact: true)
                        .frame(maxWidth: .infinity, alignment: .trailing)
                    Text(status).font(.subheadline).foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .accessibilityIdentifier("markupStatus")
                } else {
                    HStack {
                        Text(status).font(.subheadline).foregroundStyle(.secondary)
                            .accessibilityIdentifier("markupStatus")
                        Spacer(minLength: 0)
                        pageControls(compact: true)
                    }
                }
            }
        }.padding(.horizontal, 14).padding(.bottom, 4).praeludeScoreChrome()
    }
    private var selectionTools: some View {
        VStack(spacing: 2) {
            if verticalSizeClass != .compact && !dynamicTypeSize.isAccessibilitySize {
                Text("Drag to add a box. Drag a box or its corners to edit.")
                    .font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.center)
            }
            HStack(spacing: 20) {
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
            }
        }.padding(.horizontal, 20).padding(.top, 8).praeludeScoreChrome()
    }
    private func newPassage() -> Passage {
        let count = savedPassages.count + 1
        return Passage(pieceID: pieceID, title: "Passage \(count)", page: page)
    }
    private func beginSelection(_ passage: Passage?) {
        focusMode = false
        guard scoreURL != nil else { importing = true; return }
        markup.begin(passage ?? newPassage(), baseline: passage)
    }
    private func beginWriting() {
        guard scoreURL != nil else { importing = true; return }
        focusMode = false; markup.mode = .writing
    }
    private func saveSelection() {
        guard var draft = markup.draft, !draft.regions.isEmpty else { return }
        perform {
            draft.page = draft.regions.map(\.page).min() ?? page
            draft.updatedAt = Date()
            try store.savePassage(draft, replacing: markup.baseline)
            selectedPassage = draft; markup.finish()
        }
    }
    private func persistInk(_ page: Int, _ data: Data, _ expected: Data?) -> Bool {
        do {
            guard store.drawing(pieceID: pieceID, page: page) == expected else {
                markup.conflictPage = page
                return false
            }
            try NativeLibraryFiles(store: store).saveDrawing(pieceID: pieceID, page: page, data: data)
            return true
        } catch { markup.errorMessage = "Ink could not be saved. \(error.localizedDescription)"; return false }
    }
    @ViewBuilder private var practiceDock: some View {
        VStack(spacing: 12) {
            if let active {
                if active.isComplete {
                    HStack {
                        PraeludeIcon(glyph: .verdictClean, size: 26).foregroundStyle(PraeludeColor.ink)
                        VStack(alignment: .leading, spacing: 3) {
                            Text("Set complete").font(.headline)
                            Text("\(active.totalPlays) repetitions saved").font(.subheadline).foregroundStyle(PraeludeColor.inkSecondary)
                        }
                        Spacer()
                        Button { perform { try runtime.undo() } } label: { Image(systemName: "arrow.uturn.backward") }
                            .buttonStyle(.praeludeEdgeControl)
                            .accessibilityLabel("Undo last repetition").keyboardShortcut("z", modifiers: .command)
                    }
                    HStack(spacing: 12) {
                        Button("Finish") { perform { try store.endSession(); metronome.stop() } }.buttonStyle(.praeludeQuiet)
                        Button("Another set") {
                            perform { try store.endSet(); sheet = .setup }
                        }.buttonStyle(.praeludePrimary)
                    }
                } else {
                    HStack(spacing: 12) {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(active.currentStage?.name ?? active.configuration.focus).font(.subheadline.weight(.semibold)).lineLimit(1)
                            Text(active.status == .paused ? "Paused" : "\(active.progressCount) of \(active.requiredCount) \(active.configuration.basis == .cleanStreak ? "clean" : "plays") · \(Int(active.currentBPM)) BPM")
                                .font(.subheadline.monospacedDigit()).foregroundStyle(PraeludeColor.inkSecondary).accessibilityIdentifier("repProgress")
                        }
                        Spacer(minLength: 4)
                        Button { perform { try runtime.undo() } } label: { Image(systemName: "arrow.uturn.backward") }
                            .buttonStyle(.praeludeEdgeControl)
                            .accessibilityLabel("Undo last repetition").accessibilityIdentifier("undoRep").keyboardShortcut("z", modifiers: .command)
                            .disabled(!active.attempts.contains { $0.undoneAt == nil })
                        Button { togglePause() } label: { Image(systemName: active.status == .paused ? "play.fill" : "pause.fill") }
                            .buttonStyle(.praeludeEdgeControl)
                            .accessibilityLabel(active.status == .paused ? "Resume practice" : "Pause practice").accessibilityIdentifier("pausePractice")
                    }
                    SwiftUI.ProgressView(value: active.progressFraction).tint(PraeludeColor.live).accessibilityLabel("Set progress")
                    let verdictLayout = dynamicTypeSize.isAccessibilitySize && sizeClass == .compact && verticalSizeClass != .compact
                        ? AnyLayout(VStackLayout(spacing: 8)) : AnyLayout(HStackLayout(spacing: 10))
                    verdictLayout {
                        if dynamicTypeSize.isAccessibilitySize {
                            verdictButton(.clean, title: "Clean", glyph: .verdictClean, key: "1", primary: true)
                            verdictButton(.sloppy, title: "Sloppy", glyph: .verdictSloppy, key: "2", primary: false)
                            verdictButton(.again, title: "Again", glyph: .verdictAgain, key: "3", primary: false)
                        } else {
                            verdictButton(.again, title: "Again", glyph: .verdictAgain, key: "3", primary: false)
                            verdictButton(.sloppy, title: "Sloppy", glyph: .verdictSloppy, key: "2", primary: false)
                            verdictButton(.clean, title: "Clean", glyph: .verdictClean, key: "1", primary: true)
                        }
                    }.disabled(active.status != .running).opacity(active.status == .running ? 1 : 0.45)
                }
            } else if let other = store.activeSet, !other.isComplete {
                Text("A set is open for \(store.state.pieces.first { $0.id == other.configuration.pieceID }?.title ?? "another piece").")
                    .font(.callout).foregroundStyle(PraeludeColor.inkSecondary)
                Button("Finish current practice") { ending = true }.buttonStyle(.praeludeQuiet)
            } else {
                HStack(spacing: 12) {
                    Button { sheet = .passages } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(selectedPassage?.title ?? "Whole piece").font(.headline)
                            Text(selectedPassage?.locationLabel ?? "Choose a passage").font(.subheadline).foregroundStyle(PraeludeColor.inkSecondary).lineLimit(1)
                        }.frame(maxWidth: .infinity, alignment: .leading).frame(minHeight: 54).contentShape(Rectangle())
                    }.buttonStyle(.plain).accessibilityIdentifier("choosePassage")
                    Button { sheet = .setup } label: { Label("Start set", systemImage: "play.fill").frame(minHeight: 36) }
                        .buttonStyle(.praeludePrimary).fixedSize(horizontal: true, vertical: false).accessibilityIdentifier("startSet")
                }
            }
            if let failure = store.errorMessage { Text(failure).font(.caption).foregroundStyle(.red) }
            if let failure = metronome.errorMessage { Text(failure).font(.caption).foregroundStyle(.red) }
            if let failure = speech.errorMessage { Text(failure).font(.caption).foregroundStyle(.red) }
            if speech.isListening && speech.ownerID == voiceOwnerID {
                HStack(spacing: 8) {
                    Circle().fill(PraeludeColor.live).frame(width: 6, height: 6)
                    PraeludeIcon(glyph: .mic, size: 14).foregroundStyle(PraeludeColor.live)
                    Text(speech.status).font(.caption)
                    Spacer()
                    Button("Off") { speech.stop() }.font(.caption.weight(.semibold))
                        .frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
                }.accessibilityElement(children: .combine)
            }
        }
        .padding(.horizontal, sizeClass == .regular ? 24 : 16).padding(.vertical, 14)
        .frame(maxWidth: sizeClass == .regular ? 760 : .infinity)
        .frame(maxWidth: .infinity)
        .praeludeScoreChrome()
        .praeludeHairline(.top)
    }
    private func verdictButton(_ verdict: Verdict, title: String, glyph: PraeludeGlyph, key: KeyEquivalent, primary: Bool) -> some View {
        Button { record(verdict) } label: {
            VStack(spacing: 7) {
                if !dynamicTypeSize.isAccessibilitySize { PraeludeIcon(glyph: glyph, size: 22) }
                Text(title).font(.headline).fixedSize(horizontal: false, vertical: true)
            }
            .padding(.vertical, dynamicTypeSize.isAccessibilitySize ? 12 : 0)
        }
        .buttonStyle(.praeludeVerdict(emphasis: primary))
        .keyboardShortcut(key, modifiers: [])
        .accessibilityIdentifier("verdict_\(verdict.rawValue)")
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
    private func turnPage(_ direction: Int) { guard markup.flushInk() else { return }; page = min(max(1, piece?.pageCount ?? 1), max(1, page + direction * (twoPages && sizeClass == .regular ? 2 : 1))); savePage(page) }
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
            FeedbackService.shared.isEnabled = feedbackEnabled
            _ = try runtime.record(verdict)
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
        guard markup.mode == .reading, sheet == nil || sheet == .voice else { return }
        switch command {
        case .clean: record(.clean)
        case .sloppy: record(.sloppy)
        case .again: record(.again)
        case .undo: if active != nil { perform { try runtime.undo() } }
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
