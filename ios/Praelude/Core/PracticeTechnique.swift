import Foundation

/// Optional, musician-chosen ways to work on a passage. These are instructions for the player,
/// never audio analysis, tempo automation or a prescription. Every applied chain remains editable.
public enum PracticeTechnique: String, CaseIterable, Identifiable, Sendable {
    case rhythmPair, rightHand, leftHand, hands, overlap, slowConnection, articulation, memory
    public var id: String { rawValue }
    public var title: String {
        switch self {
        case .rhythmPair: "Rhythm pair"
        case .rightHand: "Right hand"
        case .leftHand: "Left hand"
        case .hands: "Hands then together"
        case .overlap: "Work on the join"
        case .slowConnection: "Slow and connected"
        case .articulation: "Touch contrast"
        case .memory: "Memory checkpoint"
        }
    }
    public var instruction: String {
        switch self {
        case .rhythmPair: "For an even-note run, try long–short, then short–long. Finish with the written rhythm. Keep the grouping you want to hear."
        case .rightHand: "Work on the right hand alone. Listen to its line and pulse before returning to both hands."
        case .leftHand: "Work on the left hand alone. Listen to its line and pulse before returning to both hands."
        case .hands: "Try each hand, then bring them together. Listen for the same pulse and phrase when the second hand returns."
        case .overlap: "Mark a short spot across the difficult join, including notes on both sides. Practice the connection, then return to the longer phrase."
        case .slowConnection: "Choose a tempo where you can connect the notes deliberately. Keep listening to the phrase; this choice does not change your tempo."
        case .articulation: "Where it helps the passage, contrast detached and connected touch. Return to the articulation in your score."
        case .memory: "Choose a familiar section. Try without looking, check the score, then play it as written. You decide how it went."
        }
    }
    public var stageNames: [String] {
        switch self {
        case .rhythmPair: ["Long–short", "Short–long", "As written"]
        case .rightHand: ["Right hand"]
        case .leftHand: ["Left hand"]
        case .hands: ["Right hand", "Left hand", "Together"]
        case .overlap: ["Connect the join", "In the phrase"]
        case .slowConnection: ["Slow and connected", "As written"]
        case .articulation: ["Detached touch", "Connected touch", "As written"]
        case .memory: ["From memory", "Check the score", "As written"]
        }
    }
    public func stages(targetCount: Int = 3) -> [VariantStage] {
        stageNames.map { VariantStage(name: $0, targetCount: min(max(targetCount, 1), 100)) }
    }
}

// A saved set is also the durable source of its repeat settings. Old tempo boundaries belong to
// the old attempts; a repeat begins at today's chosen tempo with the same editable conditions.
extension ActiveSet {
    public var nextSetConfiguration: PracticeConfiguration {
        var value = configuration
        value.startBPM = currentBPM
        value.targetBPM = value.basis == .totalPlays ? currentBPM : max(currentBPM, effectiveTargetBPM)
        value.tempoChanges = []
        value.passageSnapshot = nil
        return value
    }
}

extension PracticeConfiguration {
    public var targetSummary: String {
        guard !stages.isEmpty, basis == .cleanStreak else {
            return "\(targetCount) \(basis == .cleanStreak ? "clean" : "plays")"
        }
        if Set(stages.map(\.targetCount)).count == 1, let count = stages.first?.targetCount {
            return "\(stages.count) \(stages.count == 1 ? "stage" : "stages") · \(count) clean each"
        }
        return "\(stages.count) \(stages.count == 1 ? "stage" : "stages") · individual targets"
    }
}
