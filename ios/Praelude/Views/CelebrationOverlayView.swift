import SwiftUI

/// The full-screen "big" celebration (§14): a performance-ready passage, a fully ready piece, a new
/// rank, or a streak milestone. `AppRootView` presents exactly one of these at a time, only when no
/// set is running and no score/warmup practice surface is on screen ("never mid-set"). Strictly
/// monochrome — ink background, paper content — so the one rare accent stays reserved for live
/// states, not celebrations.
struct CelebrationOverlayView: View {
    let event: MilestoneEvent
    let onDismiss: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var appeared = false

    private var kind: MilestoneKind? { MilestoneKind(rawValue: event.kind) }
    private var glyph: PraeludeGlyph {
        switch kind {
        case .rankUp: return .rank
        case .streakMilestone: return .streak
        case .passageReady, .pieceReady, nil: return .verdictClean
        }
    }
    private var headline: String {
        switch kind {
        case .passageReady: return "Performance-ready"
        case .pieceReady: return "Piece complete"
        case .rankUp: return "New rank"
        case .streakMilestone: return "Streak milestone"
        case nil: return "Milestone"
        }
    }

    var body: some View {
        ZStack {
            PraeludeColor.ink.ignoresSafeArea()
            VStack(spacing: 22) {
                PraeludeIcon(glyph: glyph, size: 44).foregroundStyle(PraeludeColor.paper)
                VStack(spacing: 8) {
                    Text(headline).praeludeDisplay(30).foregroundStyle(PraeludeColor.paper).multilineTextAlignment(.center)
                    Text(event.detail).font(.subheadline).foregroundStyle(PraeludeColor.paper.opacity(0.78)).multilineTextAlignment(.center)
                }.padding(.horizontal, 32)
                VStack(spacing: 12) {
                    ShareLink(item: MilestoneShareCard.text(for: event)) {
                        Label("Share", systemImage: "square.and.arrow.up")
                            .font(.headline).foregroundStyle(PraeludeColor.ink)
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .buttonStyle(.plain)
                    .background(PraeludeColor.paper, in: RoundedRectangle(cornerRadius: PraeludeRadius.control, style: .continuous))
                    .frame(maxWidth: 280)
                    Button("Continue") { onDismiss() }
                        .foregroundStyle(PraeludeColor.paper).font(.subheadline.weight(.semibold))
                        .frame(minWidth: 44, minHeight: 44)
                        .accessibilityIdentifier("celebrationContinue")
                }
            }
            .padding(.horizontal, 20)
            .scaleEffect(appeared ? 1 : 0.92)
            .opacity(appeared ? 1 : 0)
        }
        .onAppear {
            withAnimation(PraeludeMotion.entrance(reduceMotion: reduceMotion)) { appeared = true }
            PraeludeHaptic.celebrate()
        }
        .accessibilityAddTraits(.isModal)
        .transition(.opacity)
    }
}
