import SwiftUI

/// First-launch onboarding (§6): pick an instrument family, then its specific instrument, level and
/// (only when relevant) transposition — reusing `InstrumentFormView`, the same editor "Instruments"
/// settings uses later. `AppRootView` shows this whenever no instrument is live yet
/// (`store.state.instruments` all tombstoned or never created), so deleting every instrument later
/// naturally returns here rather than needing a separate "has onboarded" flag.
struct OnboardingView: View {
    @Environment(PracticeStore.self) private var store
    let onFinished: () -> Void
    @State private var pickedFamily: InstrumentFamily?
    @State private var justFinishedFirst = false

    private var hasAnyInstrument: Bool { !store.state.instruments.filter { $0.deletedAt == nil }.isEmpty }

    var body: some View {
        NavigationStack {
            Group {
                if let pickedFamily, !justFinishedFirst {
                    InstrumentFormView(lockedFamily: pickedFamily, isFirst: !hasAnyInstrument,
                                       onSaved: { _ in justFinishedFirst = true })
                } else if justFinishedFirst {
                    confirmation
                } else {
                    familyPicker
                }
            }
        }
        .interactiveDismissDisabled()
    }

    private var familyPicker: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Welcome to Praelude").praeludeDisplay(30)
                    Text("Choose what you play. Praelude tailors parts, variants and warmups to it.")
                        .font(.subheadline).foregroundStyle(PraeludeColor.inkSecondary)
                }
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 148), spacing: 12)], spacing: 12) {
                    ForEach(InstrumentFamily.allCases) { family in
                        Button { pickedFamily = family } label: {
                            VStack(alignment: .leading, spacing: 10) {
                                Image(systemName: family.symbolName).font(.title2).foregroundStyle(PraeludeColor.ink)
                                Text(family.displayName).font(.headline).foregroundStyle(PraeludeColor.ink)
                                Text(family.partsVocabulary.prefix(2).joined(separator: " · "))
                                    .font(.caption).foregroundStyle(PraeludeColor.inkSecondary).lineLimit(2)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(14)
                            .frame(minHeight: 108)
                        }
                        .buttonStyle(.plain)
                        .background(PraeludeColor.surface, in: RoundedRectangle(cornerRadius: PraeludeRadius.card, style: .continuous))
                        .accessibilityIdentifier("onboardingFamily-\(family.rawValue)")
                    }
                }
            }
            .padding(20)
        }
        .scrollContentBackground(.hidden)
        .background(PraeludeColor.paper)
    }

    private var confirmation: some View {
        VStack(spacing: 20) {
            Spacer()
            PraeludeIcon(glyph: .verdictClean, size: 40).foregroundStyle(PraeludeColor.ink)
            VStack(spacing: 8) {
                Text("You're set up").praeludeDisplay(26)
                Text("A warmup library is ready for your instrument. Add another instrument any time from Settings.")
                    .font(.subheadline).foregroundStyle(PraeludeColor.inkSecondary)
                    .multilineTextAlignment(.center)
            }
            .padding(.horizontal, 32)
            Spacer()
            VStack(spacing: 10) {
                Button("Start practicing") { onFinished() }
                    .buttonStyle(.praeludePrimary)
                    .accessibilityIdentifier("onboardingFinish")
                Button("Add another instrument") { pickedFamily = nil; justFinishedFirst = false }
                    .buttonStyle(.praeludeQuiet)
            }
            .padding(.horizontal, 20).padding(.bottom, 24)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(PraeludeColor.paper)
    }
}
