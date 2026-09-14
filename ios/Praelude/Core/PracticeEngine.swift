import Foundation

/// Replays persisted human verdicts. No microphone, inference, timer, or reward side effects.
public enum PracticeEngine {
    public static func validate(_ configuration: PracticeConfiguration) throws {
        guard (1...100).contains(configuration.targetCount),
              configuration.startBPM.isFinite, configuration.targetBPM.isFinite,
              (20...300).contains(configuration.startBPM),
              (configuration.startBPM...300).contains(configuration.targetBPM),
              configuration.tempoStep.amount.isFinite, (1...100).contains(configuration.tempoStep.amount),
              !configuration.focus.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              configuration.focus.count <= 500, configuration.hands.count <= 100,
              configuration.stages.count <= 24,
              configuration.stages.allSatisfy({ !$0.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && $0.name.count <= 100 && (1...100).contains($0.targetCount) }) else {
            throw PracticeError.invalid("Choose 1–100 repetitions, a tempo from 20–300 BPM, and valid variant names.")
        }
        guard configuration.basis != .totalPlays || (configuration.targetBPM == configuration.startBPM && configuration.stages.isEmpty) else {
            throw PracticeError.invalid("Total plays uses one fixed tempo. Use Clean streak for a tempo ladder or variant chain.")
        }
    }

    public static func project(_ original: ActiveSet) -> ActiveSet {
        var set = original
        let configuration = set.configuration
        set.currentBPM = configuration.startBPM; set.streak = 0; set.totalPlays = 0
        set.stageIndex = 0; set.completedStages = 0
        var complete = false
        for attempt in set.attempts where attempt.undoneAt == nil {
            if attempt.verdict == .reset {
                // A deliberate reset restarts current-rung clean work, preserving recorded volume.
                set.streak = 0; set.stageIndex = 0; set.completedStages = 0; complete = false
                continue
            }
            set.totalPlays += 1
            if complete { continue }
            if configuration.basis == .totalPlays {
                if attempt.verdict == .clean { set.streak += 1 } else { set.streak = 0 }
                complete = set.totalPlays >= configuration.targetCount
                continue
            }
            switch attempt.verdict {
            case .clean: set.streak += 1
            case .sloppy: set.streak = 0
            case .again: if configuration.stages.isEmpty { set.streak = 0 }
            case .reset: break
            }
            guard set.streak >= set.requiredCount else { continue }
            if !configuration.stages.isEmpty {
                set.completedStages = set.stageIndex + 1
                if set.stageIndex + 1 < configuration.stages.count {
                    set.stageIndex += 1; set.streak = 0
                    continue
                }
            }
            if set.currentBPM < configuration.targetBPM {
                set.currentBPM = configuration.tempoStep.next(after: set.currentBPM, target: configuration.targetBPM)
                set.streak = 0; set.stageIndex = 0; set.completedStages = 0
            } else { complete = true }
        }
        if complete { set.status = .completed }
        else if original.status == .completed { set.status = .paused; set.endedAt = nil; set.lastCheckpoint = nil }
        return set
    }
}
