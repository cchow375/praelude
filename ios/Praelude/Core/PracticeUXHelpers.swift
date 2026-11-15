import Foundation

/// Pure helpers for the practice loop UX track (spec §8 auto page-turn, §9 cold grading, §10a tempo
/// gesture). Kept in Core, Foundation-only, so they can be unit tested without SwiftUI/PDFKit and
/// reused by the score view and its tests alike. No UI, wiring, or `PracticeStore` access belongs
/// here — see "(C) Rules Engine.md" for the same separation applied to the rules façade.
public enum PracticeUXHelpers {
    /// §9: cold-attempt grading (Clean/Shaky/Missed) and the ordinary in-set verdict scale
    /// (Clean/Sloppy/Again) are separate vocabularies for the same physical first attempt of the
    /// day — `ColdGrade` drives R3/R4's spaced-review schedule; `Verdict` drives `PracticeEngine`'s
    /// streak replay. This is the practice-ux track's documented mapping between them, chosen to
    /// match the app's own existing copy for what each `Verdict` means (Settings' practice guide:
    /// "Sloppy: a repetition with something to fix", "Again: record another try... doesn't count"):
    /// Clean -> clean, Shaky -> sloppy (a real attempt, something to fix), Missed -> again (no real
    /// attempt happened, so it neither counts toward nor resets a streak).
    public static func verdict(for grade: ColdGrade) -> Verdict {
        switch grade {
        case .clean: return .clean
        case .shaky: return .sloppy
        case .missed: return .again
        }
    }

    /// §8: "Multi-region, multi-page; practicing auto-turns pages." With no real playing-position
    /// signal (no audio grading, no OMR — see the build spec's §2 non-goals), the one moment the app
    /// has real ground truth about progress through a passage is a recorded verdict, not an invented
    /// timer. Returns the sorted, de-duplicated pages a passage's regions touch.
    public static func distinctPages(_ regions: [PassageRegion]) -> [Int] {
        Array(Set(regions.map(\.page))).sorted()
    }

    /// The next page in a passage's own page set after `current`, wrapping back to the first page.
    /// `nil` when the passage touches fewer than two distinct pages (nothing to auto-turn between)
    /// or `current` is not one of them (auto-turn only follows a passage the reader is already
    /// inside; it never yanks the score to a page the player didn't navigate to).
    public static func nextPassagePage(after current: Int, pages: [Int]) -> Int? {
        guard pages.count > 1, let index = pages.firstIndex(of: current) else { return nil }
        return pages[(index + 1) % pages.count]
    }

    /// New practice begins below the performance target. A saved slower start remains useful;
    /// a saved start at/above target cannot silently defeat that default. No history is changed.
    public static func startingPracticeTempo(target: Double?, explicitStart: Double? = nil) -> Double {
        if let explicitStart, explicitStart.isFinite, (20...300).contains(explicitStart) {
            if let target, target.isFinite, (20...300).contains(target) {
                if explicitStart < target { return explicitStart }
            } else { return explicitStart }
        }
        guard let target, target.isFinite, (20...300).contains(target) else { return 60 }
        return min(300, max(20, (target * 0.75).rounded()))
    }

    /// §10a: "Tempo in one gesture: drag/scroll on the number... never a modal/keyboard." A vertical
    /// drag maps linearly to BPM: dragging up (a negative translation, in SwiftUI's down-positive
    /// coordinate space) raises tempo, matching a physical fader/thermometer reading, at
    /// `pointsPerStep` screen points per whole BPM step. Both the live preview while dragging and the
    /// committed value on release go through this one function so they can never disagree.
    public static func tempo(fromDragTranslation translationY: Double, startBPM: Double,
                              pointsPerStep: Double = 6, bounds: ClosedRange<Double> = 20...300) -> Double {
        guard pointsPerStep > 0, translationY.isFinite, startBPM.isFinite else {
            return min(max(startBPM, bounds.lowerBound), bounds.upperBound)
        }
        let delta = (-translationY / pointsPerStep).rounded()
        return min(max(startBPM + delta, bounds.lowerBound), bounds.upperBound)
    }

    /// §10c HUD: "tempo, ladder rung, variant, passage name." A set's tempo ladder has no stored
    /// rung index of its own (only the running `currentBPM`), so this replays `TempoStep.next(...)`
    /// from `startBPM` to `targetBPM` — the exact same step sequence `PracticeEngine.project` itself
    /// walks — to find where `currentBPM` falls in it. Rung 1 is the starting tempo (before any
    /// clean streak has advanced it); the last rung is the target tempo. `nil` when there is no
    /// ladder (`targetBPM <= startBPM`), so the HUD can simply omit the rung line.
    public static func ladderRung(startBPM: Double, targetBPM: Double, currentBPM: Double, step: TempoStep) -> (rung: Int, total: Int)? {
        guard targetBPM > startBPM, startBPM.isFinite, targetBPM.isFinite else { return nil }
        var values = [startBPM]
        var value = startBPM
        // Bounded well above any realistic ladder (worst case: 20->300 BPM in 1 BPM fixed steps is
        // 280 rungs) so a misconfigured near-zero step can never loop unboundedly.
        while value < targetBPM, values.count < 500 {
            let next = step.next(after: value, target: targetBPM)
            guard next > value else { break } // a non-increasing step must never spin forever
            value = next
            values.append(value)
        }
        let total = values.count
        let rung = values.firstIndex(where: { abs($0 - currentBPM) < 0.001 }).map { $0 + 1 } ?? total
        return (rung: rung, total: total)
    }
}
