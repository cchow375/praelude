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
              configuration.tempoChanges.count <= 100001,
              configuration.tempoChanges.allSatisfy({ $0.bpm.isFinite && (20...300).contains($0.bpm) && (0...100000).contains($0.afterAttemptCount) }),
              zip(configuration.tempoChanges, configuration.tempoChanges.dropFirst()).allSatisfy({ $0.afterAttemptCount < $1.afterAttemptCount }),
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
        var targetBPM = configuration.targetBPM
        var changeIndex = 0
        func applyChanges(at boundary: Int) {
            while changeIndex < configuration.tempoChanges.count,
                  configuration.tempoChanges[changeIndex].afterAttemptCount == boundary {
                let change = configuration.tempoChanges[changeIndex]
                set.currentBPM = change.bpm
                targetBPM = max(targetBPM, change.bpm)
                changeIndex += 1
            }
        }
        for (index, attempt) in set.attempts.enumerated() {
            applyChanges(at: index)
            guard attempt.undoneAt == nil else { continue }
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
            // R5 (§11): "Again" is neutral for every set shape, not only a variant chain — it
            // neither counts toward nor resets the streak, matching `r5StreakEffect`'s own
            // `.neutral` vocabulary in Core/Rules and R6's already-correct attempt replay (see
            // "(C) Rules Engine.md"'s R5 section, "Known pre-existing mismatch, left alone" — this
            // is that reconciliation).
            case .again: break
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
            if set.currentBPM < targetBPM {
                set.currentBPM = configuration.tempoStep.next(after: set.currentBPM, target: targetBPM)
                set.streak = 0; set.stageIndex = 0; set.completedStages = 0
            } else { complete = true }
        }
        applyChanges(at: set.attempts.count)
        if complete { set.status = .completed }
        else if original.status == .completed { set.status = .paused; set.endedAt = nil; set.lastCheckpoint = nil }
        return set
    }
}
