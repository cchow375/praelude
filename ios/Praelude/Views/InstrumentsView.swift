import SwiftUI

/// Manage instruments (§6): list, one-tap primary switch, add/edit, delete (tombstoned — a piece
/// tied to a removed instrument simply loses that reference; see `PracticeStore.validate`, which
/// only requires a piece's `instrumentID` to resolve while the instrument is still live).
struct InstrumentsView: View {
    @Environment(PracticeStore.self) private var store
    @State private var editingInstrument: Instrument?
    @State private var addingFamily: InstrumentFamily?
    @State private var errorMessage: String?

    private var instruments: [Instrument] {
        store.state.instruments.filter { $0.deletedAt == nil }.sorted { $0.isPrimary && !$1.isPrimary }
    }

    var body: some View {
        List {
            if let errorMessage { ErrorMessage(message: errorMessage) }
            if instruments.isEmpty {
                PraeludeEmptyState(title: "No instruments yet", symbol: "pianokeys",
                                  message: "Add an instrument so Praelude can tailor parts, variants and warmups to it.",
                                  actionTitle: "Add an instrument", action: { addingFamily = .keyboard })
                    .listRowBackground(Color.clear).listRowSeparator(.hidden)
            } else {
                Section {
                    ForEach(instruments) { instrument in
                        Button { editingInstrument = instrument } label: { row(instrument) }
                            .buttonStyle(.plain)
                            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                if !instrument.isPrimary {
                                    Button("Make primary", systemImage: "checkmark.seal") { makePrimary(instrument) }
                                        .tint(PraeludeColor.ink)
                                }
                                Button("Delete", systemImage: "trash", role: .destructive) { delete(instrument) }
                            }
                    }
                } footer: {
                    Text("Tap an instrument to edit it. Swipe to switch your primary instrument or remove one.")
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(PraeludeColor.paper)
        .navigationTitle("Instruments")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Add instrument", systemImage: "plus") { addingFamily = .keyboard }
            }
        }
        .sheet(item: $addingFamily) { family in
            NavigationStack { InstrumentFormView(lockedFamily: family, isFirst: instruments.isEmpty) }
        }
        .sheet(item: $editingInstrument) { instrument in
            NavigationStack { InstrumentFormView(existing: instrument) }
        }
    }

    private func row(_ instrument: Instrument) -> some View {
        HStack(spacing: 14) {
            Image(systemName: instrument.family.symbolName).font(.title3).frame(width: 22)
                .foregroundStyle(PraeludeColor.inkSecondary)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(instrument.name).font(.headline)
                    if instrument.isPrimary {
                        Text("Primary").font(.caption.weight(.medium)).foregroundStyle(PraeludeColor.inkSecondary)
                            .padding(.horizontal, 8).padding(.vertical, 2)
                            .background(PraeludeColor.inkFillQuiet, in: Capsule())
                    }
                }
                Text([instrument.level, instrument.transposition?.label].compactMap { $0?.isEmpty == false ? $0 : nil }.joined(separator: " · "))
                    .font(.subheadline).foregroundStyle(.secondary)
            }
            Spacer()
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    private func makePrimary(_ instrument: Instrument) {
        do { try store.setPrimaryInstrument(instrument.id); errorMessage = nil; PraeludeHaptic.confirm() }
        catch { errorMessage = error.localizedDescription }
    }

    private func delete(_ instrument: Instrument) {
        do { try store.deleteInstrument(instrument.id); errorMessage = nil }
        catch { errorMessage = error.localizedDescription }
    }
}

extension InstrumentFamily: Identifiable { public var id: String { rawValue } }

/// Add or edit one instrument (§6): family (locked when arriving from onboarding's own family grid,
/// or from "Add instrument" which always starts at `.keyboard` and lets the player change it),
/// specific instrument name, level, and — only when relevant — written/concert transposition.
struct InstrumentFormView: View {
    @Environment(PracticeStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var family: InstrumentFamily
    @State private var name: String
    @State private var level: String
    @State private var transposition: Transposition?
    @State private var isPrimary: Bool
    @State private var errorMessage: String?
    private let existingID: UUID?
    private let familyIsLocked: Bool
    var onSaved: (Instrument) -> Void = { _ in }

    /// Onboarding's path: family already chosen from the grid.
    init(lockedFamily: InstrumentFamily, isFirst: Bool, onSaved: @escaping (Instrument) -> Void = { _ in }) {
        _family = State(initialValue: lockedFamily)
        _name = State(initialValue: InstrumentCatalog.instrumentNames(for: lockedFamily).first ?? "")
        _level = State(initialValue: InstrumentCatalog.levels.first ?? "Beginner")
        _transposition = State(initialValue: InstrumentCatalog.suggestedTranspositions(for: lockedFamily).first)
        _isPrimary = State(initialValue: isFirst)
        existingID = nil
        familyIsLocked = true
        self.onSaved = onSaved
    }

    /// Settings' path: editing an existing instrument, family changeable.
    init(existing: Instrument) {
        _family = State(initialValue: existing.family)
        _name = State(initialValue: existing.name)
        _level = State(initialValue: existing.level.isEmpty ? (InstrumentCatalog.levels.first ?? "Beginner") : existing.level)
        _transposition = State(initialValue: existing.transposition)
        _isPrimary = State(initialValue: existing.isPrimary)
        existingID = existing.id
        familyIsLocked = false
    }

    private var nameChoices: [String] { InstrumentCatalog.instrumentNames(for: family) }

    var body: some View {
        Form {
            if !familyIsLocked {
                Section("Family") {
                    Picker("Family", selection: $family) {
                        ForEach(InstrumentFamily.allCases) { Text($0.displayName).tag($0) }
                    }
                    .onChange(of: family) { _, newFamily in
                        name = InstrumentCatalog.instrumentNames(for: newFamily).first ?? name
                        transposition = InstrumentCatalog.suggestedTranspositions(for: newFamily).first
                    }
                }
            }

            Section("Instrument") {
                HStack {
                    TextField("Instrument name", text: $name).textInputAutocapitalization(.words)
                    if !nameChoices.isEmpty {
                        Menu {
                            ForEach(nameChoices, id: \.self) { choice in Button(choice) { name = choice } }
                        } label: {
                            Image(systemName: "chevron.up.chevron.down").frame(minWidth: 44, minHeight: 44)
                        }
                        .accessibilityLabel("Choose an instrument")
                    }
                }
                Picker("Level", selection: $level) {
                    ForEach(InstrumentCatalog.levels, id: \.self) { Text($0).tag($0) }
                }
            }

            if InstrumentCatalog.transpositionIsRelevant(for: family) {
                Section {
                    Picker("Transposition", selection: $transposition) {
                        ForEach(InstrumentCatalog.suggestedTranspositions(for: family), id: \.label) { option in
                            Text(option.label).tag(Optional(option))
                        }
                    }
                } footer: {
                    Text("Written vs. concert pitch, so transposed passages and warmups stay correct for this instrument.")
                }
            }

            Section {
                Toggle("Primary instrument", isOn: $isPrimary).praeludeToggleHaptic(isPrimary)
            } footer: {
                Text("Your primary instrument decides the default warmups and parts wording shown across the app. Switch it any time with one tap.")
            }

            if let errorMessage { Section { ErrorMessage(message: errorMessage) } }
        }
        .navigationTitle(existingID == nil ? "Add instrument" : "Edit instrument")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            ToolbarItem(placement: .confirmationAction) {
                Button("Save") { save() }.disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
    }

    private func save() {
        do {
            let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
            var instrument = Instrument(id: existingID ?? UUID(), family: family, name: trimmed, level: level,
                                        transposition: InstrumentCatalog.transpositionIsRelevant(for: family) ? transposition : nil,
                                        isPrimary: isPrimary)
            instrument.updatedAt = Date()
            try store.saveInstrument(instrument)
            if isPrimary { try store.setPrimaryInstrument(instrument.id) }
            try store.seedWarmupsIfNeeded(family: family)
            onSaved(instrument)
            dismiss()
        } catch { errorMessage = error.localizedDescription }
    }
}
