import Foundation

/// One session's rollup (§16): how many touched passages moved up in tempo, how many were set back,
/// how many are now parked, how many are due tomorrow, and the session's total time.
///
/// **Judgment call — derived from observable set/passage data, not a `RuleEvent` replay.** §11's
/// rules (R6 slow down, R7 speed up, R9 stop grinding, R4 spaced review) are this app's authoritative
/// vocabulary for these same four ideas, but nothing in the live practice loop calls
/// `PracticeStore.recordRuleEvent` yet (see "(C) Rules Engine.md": no UI/wiring was that track's
/// scope, and wiring rule *decisions* into the moment-to-moment verdict flow is the practice HUD's
/// scope, not this one's). Re-deriving "did R6 fire" here would either duplicate that rule's logic
/// outside `Core/Rules/` or read as always-empty until another track wires event logging. Instead
/// this summary reads only what the already-live practice loop already guarantees — which way each
/// touched passage's tempo actually moved this session — plus whatever the passage's stored
/// `parkedUntil`/`schedule.dueDate` already say. Honest today, and it keeps working unchanged once
/// rule-event logging exists elsewhere, since those are the same fields R4/R9 would write to.
public struct SessionSummaryData: Equatable, Sendable {
    public var movedUp: Int
    public var droppedBack: Int
    public var parked: Int
    public var dueTomorrow: Int
    public var focusedSeconds: TimeInterval
    public var repetitions: Int
    public var completedSets: Int
}

public enum SessionSummary {
    public static func summarize(sessionID: UUID, state: LibraryState, calendar: Calendar, now: Date) -> SessionSummaryData? {
        guard let session = state.sessions.first(where: { $0.id == sessionID }) else { return nil }
        let allSets = state.history + [state.activeSet].compactMap { $0 }
        let sessionSets = allSets.filter { $0.sessionID == sessionID }.sorted { $0.startedAt < $1.startedAt }

        var movedUp = 0, droppedBack = 0
        // "Moved up"/"dropped back" per passage this session: compare each set's own starting tempo
        // to the previous set THAT PASSAGE reached (its endpoint `currentBPM`), so several sets on one
        // passage in one session (e.g. after a break) still reads as one honest before/after per pair.
        var lastKnownBPM: [UUID: Double] = [:]
        for set in sessionSets {
            guard let passageID = set.configuration.passageID else { continue }
            if let previous = lastKnownBPM[passageID] {
                if set.configuration.startBPM > previous { movedUp += 1 }
                else if set.configuration.startBPM < previous { droppedBack += 1 }
            }
            lastKnownBPM[passageID] = set.currentBPM
        }

        let touchedPassageIDs = Set(sessionSets.compactMap(\.configuration.passageID))
        let touchedPassages = state.passages.filter { touchedPassageIDs.contains($0.id) }
        let tomorrow = calendar.startOfDay(afterAdding: 1, to: now)
        let dueTomorrow = touchedPassages.filter {
            guard let due = $0.schedule.dueDate else { return false }
            return calendar.isDate(due, inSameDayAs: tomorrow)
        }.count
        let parked = touchedPassages.filter {
            guard let until = $0.parkedUntil else { return false }
            return until > now
        }.count

        return SessionSummaryData(movedUp: movedUp, droppedBack: droppedBack, parked: parked, dueTomorrow: dueTomorrow,
                                   focusedSeconds: session.activeSeconds, repetitions: session.attempts.count,
                                   completedSets: session.completedSets)
    }
}
