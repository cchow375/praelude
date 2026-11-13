import SwiftUI

/// §10c/§11: "After every set, one-line next step with reason; rule suggestions (R1/R2/R6–R13)
/// appear as dismissible one-line prompts with one-tap override, never mid-attempt." Shown only
/// between sets (right after completion, or after Stop) — `ScoreWorkspace` never presents this while
/// a set is running.
struct NextStepAndSuggestionsView: View {
    var arm: PracticeArmController
    var onApply: (Decision) -> Void
    var onDismiss: (Decision) -> Void

    var body: some View {
        if arm.nextStep != nil || !arm.suggestions.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                if let nextStep = arm.nextStep {
                    HStack(alignment: .top, spacing: 8) {
                        PraeludeMusicGlyph(symbol: .quarterNote, size: 14).foregroundStyle(PraeludeColor.inkTertiary).padding(.top, 2)
                        if nextStep.outcome == .none {
                            // A plain acknowledgement ("Nice work.", "Set complete.") — nothing to
                            // accept or decline.
                            Text(nextStep.reason).font(.subheadline.weight(.medium)).foregroundStyle(PraeludeColor.ink)
                                .fixedSize(horizontal: false, vertical: true)
                        } else {
                            // §11 "one-tap override, logged" still applies when a rule (R6-R13) is
                            // urgent enough to *also* be §10c's single headline — it is still that
                            // rule, not merely a status message. `PracticeArmController.computeAfterSet`
                            // already excludes it from `suggestions` below (never duplicated there),
                            // so this is the only place it can be accepted or dismissed at all. See
                            // "(C) Audit.md".
                            Button { onApply(nextStep) } label: {
                                Text(nextStep.reason).font(.subheadline.weight(.medium)).foregroundStyle(PraeludeColor.ink)
                                    .multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }.buttonStyle(.plain)
                            Button { onDismiss(nextStep) } label: {
                                Image(systemName: "xmark").font(.caption.weight(.semibold))
                                    .frame(width: 32, height: 32).contentShape(Rectangle())
                            }
                            .foregroundStyle(PraeludeColor.inkTertiary)
                            .accessibilityLabel("Dismiss suggestion")
                            .accessibilityIdentifier("dismissSuggestion_\(nextStep.ruleID.rawValue)")
                        }
                    }.accessibilityIdentifier("nextStepLine")
                }
                ForEach(arm.suggestions) { decision in
                    SuggestionRow(decision: decision, onApply: { onApply(decision) }, onDismiss: { onDismiss(decision) })
                }
            }
            .padding(.vertical, 4)
        }
    }
}

private struct SuggestionRow: View {
    let decision: Decision
    let onApply: () -> Void
    let onDismiss: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            Button(action: onApply) {
                Text(decision.reason).font(.subheadline).foregroundStyle(PraeludeColor.inkSecondary)
                    .multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }.buttonStyle(.plain)
            Button(action: onDismiss) {
                Image(systemName: "xmark").font(.caption.weight(.semibold))
                    .frame(width: 32, height: 32).contentShape(Rectangle())
            }
            .foregroundStyle(PraeludeColor.inkTertiary)
            .accessibilityLabel("Dismiss suggestion")
            .accessibilityIdentifier("dismissSuggestion_\(decision.ruleID.rawValue)")
        }
        .padding(.horizontal, 10).padding(.vertical, 6)
        .background(PraeludeColor.inkFillQuiet, in: RoundedRectangle(cornerRadius: PraeludeRadius.tight))
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("suggestion_\(decision.ruleID.rawValue)")
    }
}
