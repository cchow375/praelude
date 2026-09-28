import SwiftUI

/// The warmup library (§12): one-tap "Next in rotation", favorites, last used, a visual
/// circle-of-fifths key picker with neglected keys highlighted, and a full library grouped by key.
/// Scoped to `store.primaryInstrument`'s family, with a one-tap switcher when more than one
/// instrument exists (§6). Starting a warmup reuses the exact same practice-set engine as a
/// passage (`WarmupsPiece`, `PracticeConfiguration`, `PracticeStore.startSet`).
struct WarmupsView: View {
    @Environment(PracticeStore.self) private var store
    @Environment(MetronomeService.self) private var metronome
    /// Presents the practice HUD once a set has actually started.
    let onStartPractice: () -> Void

    @State private var selectedKey: String?
    @State private var errorMessage: String?
    @State private var composing: WarmupExercise?
    @State private var addingCustom = false

    private var liveInstruments: [Instrument] { store.state.instruments.filter { $0.deletedAt == nil } }
    private var family: InstrumentFamily? { store.primaryInstrument?.family }
    private var exercises: [WarmupExercise] {
        store.state.warmupExercises.filter { $0.deletedAt == nil && (family == nil || $0.instrumentFamily == family) }
    }
    private var neglectedKeys: Set<String> { Set(WarmupRotation.neglectedKeys(among: exercises, family: family)) }
    private var favorites: [WarmupExercise] { WarmupRotation.favorites(among: exercises, family: family) }
    private var lastUsed: [WarmupExercise] { WarmupRotation.lastUsed(among: exercises, family: family) }
    private var customExercises: [WarmupExercise] { exercises.filter { !WarmupCatalog.circleOfFifths.contains($0.key) }.sorted { $0.name < $1.name } }
    private var keyedExercises: [WarmupExercise] {
        guard let selectedKey else { return [] }
        return exercises.filter { $0.key == selectedKey }.sorted { $0.name < $1.name }
    }

    var body: some View {
        List {
            if let errorMessage { ErrorMessage(message: errorMessage) }
            if liveInstruments.isEmpty {
                PraeludeEmptyState(title: "No instrument yet", symbol: "pianokeys",
                                  message: "Add an instrument in Settings to see scales, arpeggios, and technique tailored to it.")
                    .listRowBackground(Color.clear).listRowSeparator(.hidden)
            } else {
                nextInRotationSection
                if !favorites.isEmpty { chipSection(title: "Favorites", items: favorites) }
                if !lastUsed.isEmpty { chipSection(title: "Last used", items: lastUsed) }
                keyWheelSection
                if let selectedKey { keyedSection(selectedKey) }
                if !customExercises.isEmpty { customSection }
            }
        }
        .scrollContentBackground(.hidden)
        .background(PraeludeColor.paper)
        .navigationTitle("Warmups")
        .toolbar {
            if liveInstruments.count > 1 {
                ToolbarItem(placement: .topBarLeading) { instrumentSwitcher }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button("New from a passage", systemImage: "plus") { addingCustom = true }
                    .disabled(store.realPieces.isEmpty)
            }
        }
        .sheet(item: $composing) { exercise in
            SetComposerView(pieceID: WarmupsPiece.id, displayTitle: exercise.name, initialFocus: exercise.name,
                            initialBPM: WarmupCatalog.defaultBPM(for: exercise.kind),
                            onStarted: { try? store.recordWarmupUse(exercise.id); onStartPractice() })
        }
        .sheet(isPresented: $addingCustom) { CustomWarmupView() }
        .onAppear {
            do {
                try store.ensureWarmupsPiece()
                if let family, !store.state.warmupExercises.contains(where: { $0.instrumentFamily == family && $0.deletedAt == nil }) {
                    try store.seedWarmupsIfNeeded(family: family)
                }
            } catch { errorMessage = error.localizedDescription }
        }
    }

    private var instrumentSwitcher: some View {
        Menu {
            ForEach(liveInstruments) { instrument in
                Button {
                    do { try store.setPrimaryInstrument(instrument.id); PraeludeHaptic.confirm() }
                    catch { errorMessage = error.localizedDescription }
                } label: {
                    if instrument.isPrimary { Label(instrument.name, systemImage: "checkmark") } else { Text(instrument.name) }
                }
            }
        } label: {
            HStack(spacing: 5) {
                Text(store.primaryInstrument?.name ?? "Instrument").font(.subheadline.weight(.semibold))
                Image(systemName: "chevron.up.chevron.down").font(.caption2)
            }.frame(minHeight: 44)
        }
        .accessibilityIdentifier("warmupInstrumentSwitcher")
    }

    private var nextInRotationSection: some View {
        Section {
            if let next = WarmupRotation.nextInRotation(among: exercises, family: family) {
                Button { startDirectly(next) } label: {
                    HStack(spacing: 14) {
                        PraeludeIcon(glyph: .warmup, size: 22).foregroundStyle(PraeludeColor.paper)
                            .frame(width: 46, height: 46).background(PraeludeColor.ink, in: Circle())
                        VStack(alignment: .leading, spacing: 3) {
                            Text("Next in rotation").font(.caption.weight(.medium)).foregroundStyle(PraeludeColor.inkSecondary)
                            Text(next.name).font(.headline)
                        }
                        Spacer()
                        Image(systemName: "play.fill").foregroundStyle(PraeludeColor.inkTertiary)
                    }.padding(.vertical, 6).contentShape(Rectangle())
                }.buttonStyle(.plain).accessibilityIdentifier("warmupNextInRotation")
            } else {
                Text("Your warmup library is empty for this instrument.").foregroundStyle(.secondary)
            }
        }
    }

    private func chipSection(title: String, items: [WarmupExercise]) -> some View {
        Section(title) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(items) { exercise in
                        Button { composing = exercise } label: {
                            HStack(spacing: 6) {
                                if exercise.isFavorite { Image(systemName: "star.fill").font(.caption2) }
                                Text(exercise.name).font(.subheadline.weight(.medium))
                            }
                            .frame(minHeight: 44)
                            .padding(.horizontal, 14)
                            .background(PraeludeColor.inkFillQuiet, in: Capsule())
                            .foregroundStyle(PraeludeColor.ink)
                        }.buttonStyle(.plain)
                    }
                }.padding(.horizontal, 1).padding(.vertical, 1)
            }
            .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 8, trailing: 0))
        }
    }

    private var keyWheelSection: some View {
        Section {
            VStack(spacing: 12) {
                WarmupKeyWheel(keys: WarmupCatalog.circleOfFifths, selectedKey: selectedKey, neglectedKeys: neglectedKeys) { key in
                    withAnimation(PraeludeMotion.tap) { selectedKey = (selectedKey == key) ? nil : key }
                    PraeludeHaptic.toggle()
                }
                .frame(maxWidth: .infinity)
                if !neglectedKeys.isEmpty {
                    Text("Neglected: \(neglectedKeys.count == WarmupCatalog.circleOfFifths.count ? "all keys" : neglectedKeys.joined(separator: ", "))")
                        .font(.caption).foregroundStyle(PraeludeColor.inkSecondary).multilineTextAlignment(.center)
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
            .listRowBackground(Color.clear)
        } header: { Text("Any key, two taps") }
    }

    private func keyedSection(_ key: String) -> some View {
        Section(key) {
            if keyedExercises.isEmpty {
                Text("Nothing built for \(key) yet.").foregroundStyle(.secondary)
            } else {
                ForEach(keyedExercises) { exercise in exerciseRow(exercise) }
            }
        }
    }

    private var customSection: some View {
        Section("Custom") {
            ForEach(customExercises) { exercise in exerciseRow(exercise) }
        }
    }

    private func exerciseRow(_ exercise: WarmupExercise) -> some View {
        Button { composing = exercise } label: {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(exercise.name).font(.body).foregroundStyle(PraeludeColor.ink)
                    if exercise.useCount > 0 {
                        Text("Practiced \(exercise.useCount)\u{d7}").font(.caption).foregroundStyle(PraeludeColor.inkSecondary)
                    }
                }
                Spacer()
                if exercise.isFavorite { Image(systemName: "star.fill").font(.caption).foregroundStyle(PraeludeColor.inkTertiary) }
            }.contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            Button(exercise.isFavorite ? "Unfavorite" : "Favorite", systemImage: exercise.isFavorite ? "star.slash" : "star") {
                toggleFavorite(exercise)
            }.tint(PraeludeColor.ink)
        }
    }

    private func toggleFavorite(_ exercise: WarmupExercise) {
        do { var updated = exercise; updated.isFavorite.toggle(); try store.saveWarmupExercise(updated) }
        catch { errorMessage = error.localizedDescription }
    }

    /// True one-tap start (§12): skips the setup sheet entirely with a sensible default goal/tempo
    /// from `WarmupCatalog.defaultBPM`; the practice HUD's own controls still allow adjustment.
    private func startDirectly(_ exercise: WarmupExercise) {
        do {
            try store.ensureWarmupsPiece()
            let bpm = WarmupCatalog.defaultBPM(for: exercise.kind)
            let configuration = PracticeConfiguration(pieceID: WarmupsPiece.id, focus: exercise.name, goal: .tempo,
                                                       basis: .cleanStreak, targetCount: 5, startBPM: bpm, targetBPM: bpm,
                                                       useMetronome: true)
            try store.startSet(configuration)
            metronome.setTempo(bpm); metronome.start()
            try store.recordWarmupUse(exercise.id)
            errorMessage = nil
            onStartPractice()
        } catch { errorMessage = error.localizedDescription }
    }
}

/// A dozen tappable keys arranged in circle-of-fifths order on a ring, so any key is reachable in
/// one tap here (a second tap on a listed exercise starts it) — the "visual key picker" §12 asks for.
private struct WarmupKeyWheel: View {
    let keys: [String]
    let selectedKey: String?
    let neglectedKeys: Set<String>
    let onSelect: (String) -> Void

    private let ringDiameter: CGFloat = 216
    private let buttonSize: CGFloat = 44 // the app's minimum touch target
    private var containerSize: CGFloat { ringDiameter + buttonSize + 4 }

    var body: some View {
        ZStack {
            Circle().stroke(PraeludeColor.hairline, lineWidth: PraeludeMetric.hairline).frame(width: ringDiameter, height: ringDiameter)
            ForEach(Array(keys.enumerated()), id: \.offset) { index, key in keyButton(index: index, key: key) }
        }
        .frame(width: containerSize, height: containerSize)
        .accessibilityElement(children: .contain)
    }

    private func keyButton(index: Int, key: String) -> some View {
        let angle = Double(index) / Double(keys.count) * 2 * .pi - .pi / 2
        let radius = ringDiameter / 2
        let isSelected = key == selectedKey
        let isNeglected = neglectedKeys.contains(key)
        return Button { onSelect(key) } label: {
            Text(key).praeludeDisplay(15, weight: .semibold)
                .frame(width: buttonSize, height: buttonSize)
                .foregroundStyle(isSelected ? PraeludeColor.paper : PraeludeColor.ink)
                .background(isSelected ? PraeludeColor.ink : PraeludeColor.inkFillQuiet, in: Circle())
                .overlay(alignment: .topTrailing) {
                    // Monochrome, not the live accent: a neglected key is a status, not a live state
                    // (the design system reserves `.live` for exactly two places — see DesignColor.swift).
                    if isNeglected { Circle().fill(PraeludeColor.inkSecondary).frame(width: 7, height: 7) }
                }
        }
        .buttonStyle(.plain)
        .position(x: containerSize / 2 + radius * cos(angle), y: containerSize / 2 + radius * sin(angle))
        .accessibilityLabel(isNeglected ? "\(key), neglected" : key)
        .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
    }
}

/// Turns an already-drawn passage into a custom warmup entry (§12: "custom from a user-drawn
/// passage"). Reuses the player's existing pieces/passages rather than a new drawing surface.
private struct CustomWarmupView: View {
    @Environment(PracticeStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var selectedPassageID: UUID?
    @State private var name = ""
    @State private var key = ""
    @State private var errorMessage: String?

    private var pieces: [Piece] { store.realPieces }
    private func passages(for pieceID: UUID) -> [Passage] {
        store.state.passages.filter { $0.pieceID == pieceID && $0.deletedAt == nil && !$0.archived }
    }

    var body: some View {
        NavigationStack {
            Form {
                if pieces.allSatisfy({ passages(for: $0.id).isEmpty }) {
                    Section { Text("Draw a passage on a score first, then turn it into a warmup here.").foregroundStyle(.secondary) }
                }
                ForEach(pieces) { piece in
                    let ownPassages = passages(for: piece.id)
                    if !ownPassages.isEmpty {
                        Section(piece.title) {
                            ForEach(ownPassages) { passage in
                                Button { select(piece: piece, passage: passage) } label: {
                                    HStack {
                                        Text(passage.title.isEmpty ? passage.measureLabel : passage.title)
                                        Spacer()
                                        if selectedPassageID == passage.id { Image(systemName: "checkmark") }
                                    }
                                }.buttonStyle(.plain)
                            }
                        }
                    }
                }
                if selectedPassageID != nil {
                    Section {
                        TextField("Name", text: $name)
                        TextField("Key (optional)", text: $key)
                    } footer: {
                        Text("This warmup reuses the passage’s marked region. It practices with the same set engine as everything else.")
                    }
                }
                if let errorMessage { Section { ErrorMessage(message: errorMessage) } }
            }
            .navigationTitle("New warmup")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save", action: save).disabled(selectedPassageID == nil || name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
        .presentationDetents([.large])
    }

    private func select(piece: Piece, passage: Passage) {
        selectedPassageID = passage.id
        if name.isEmpty { name = passage.title.isEmpty ? piece.title : passage.title }
    }

    private func save() {
        guard let selectedPassageID else { return }
        do {
            let trimmedKey = key.trimmingCharacters(in: .whitespacesAndNewlines)
            let exercise = WarmupExercise(kind: .custom, key: trimmedKey.isEmpty ? "Custom" : trimmedKey,
                                          instrumentFamily: store.primaryInstrument?.family,
                                          customFromPassageID: selectedPassageID,
                                          name: name.trimmingCharacters(in: .whitespacesAndNewlines))
            try store.saveWarmupExercise(exercise)
            dismiss()
        } catch { errorMessage = error.localizedDescription }
    }
}
