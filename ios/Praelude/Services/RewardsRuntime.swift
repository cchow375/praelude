import Foundation
import Observation

/// Wires `RewardsEngine`'s pure decisions to the live `PracticeStore` (§14). Every step below
/// reconciles by *counting* what already exists against what should exist now, rather than
/// tracking "have I already processed event X" separately — history and the reward ledger only ever
/// grow, so counting is naturally idempotent and self-healing across app relaunches with no further
/// bookkeeping. `reconcile()` is safe to call as often as convenient; `AppRootView` calls it after
/// every change that could newly qualify a reward (a recorded attempt, a completed set, app
/// foreground) rather than only once, and a call that finds nothing new does none of the work below.
///
/// Coins/XP only ever come from `RewardsEngine.ledgerEntry`, which only ever returns a non-negative
/// delta (§14 honesty) — this runtime never constructs a `RewardLedgerEntry` itself.
@MainActor @Observable
final class RewardsRuntime {
    @ObservationIgnored private let store: PracticeStore
    @ObservationIgnored private let sound: RewardSoundService
    @ObservationIgnored private let sharePublisher: any MilestoneSharePublisher
    /// Queued big celebrations (§14: "never mid-set" — the UI shows these one at a time, only when
    /// nothing else is capturing the screen). Small celebrations (a badge, a completed set — the
    /// latter already has its own tone via `FeedbackService`) never enter this queue.
    private(set) var celebrationQueue: [MilestoneEvent] = []

    init(store: PracticeStore, sound: RewardSoundService = .shared, sharePublisher: any MilestoneSharePublisher = NullMilestoneSharePublisher()) {
        self.store = store
        self.sound = sound
        self.sharePublisher = sharePublisher
    }

    func reconcile(asOf now: Date = Date()) {
        do {
            let xpBefore = totalXP
            try awardCompletedReps()
            try awardCompletedSets()
            try awardOnTimeReviews()
            try awardPerformanceReadyMilestones(now: now)
            try updateStreakAndCelebrateMilestone(now: now)
            try celebrateRankUpIfNeeded(xpBefore: xpBefore)
            try awardBadges(now: now)
        } catch {
            // A reward side effect never blocks or corrupts the practice ledger it reads from; the
            // store already surfaces its own write failures through `errorMessage`.
        }
    }

    /// The UI calls this once it is safe to show something new (no active set in progress). Removes
    /// and returns the oldest queued celebration, or `nil` when there is nothing waiting.
    func dequeueCelebration() -> MilestoneEvent? {
        guard !celebrationQueue.isEmpty else { return nil }
        return celebrationQueue.removeFirst()
    }

    /// Manual share (§14: "share milestones to feed auto/manual"): hands the event to whichever
    /// publisher this runtime was configured with — a deliberate no-op until a social track exists
    /// (see `MilestoneSharing.swift`), or a system share sheet driven by `MilestoneShareCard.text`.
    func share(_ event: MilestoneEvent) async { await sharePublisher.publish(event, profile: store.state.profile) }

    private var totalXP: Int { store.state.rewardLedger.reduce(0) { $0 + $1.xpDelta } }

    private func award(_ event: RewardEvent) throws {
        try store.appendRewardLedgerEntry(RewardsEngine.ledgerEntry(for: event))
    }

    private func awardCompletedReps() throws {
        let effective = allSets.flatMap(\.attempts).filter(\.isEffective).count
        let already = store.state.rewardLedger.filter { $0.reason == "Completed repetition" }.count
        guard effective > already else { return }
        for _ in already..<effective { try award(.completedRep) }
    }

    private func awardCompletedSets() throws {
        let completed = store.state.history.filter { $0.status == .completed }.count
        let already = store.state.rewardLedger.filter { $0.reason == "Completed set" }.count
        guard completed > already else { return }
        for _ in already..<completed { try award(.completedSet) }
        // Small (§14: "small for set completion"): the existing `.set`/`.chain` tone already marks
        // this moment (`FeedbackService`, wired through the untouched practice-event pipeline), so
        // this runtime adds no second sound for it — only the honest coin/xp entry above is new.
    }

    /// "On-time review": a passage's spaced-review schedule (`PassageSchedule.dueDate`, §11 R4) was
    /// cleared on or before its due date. Nothing sets `dueDate` yet (R4 is a separate, not-yet-built
    /// rules track — see "(C) Schema3.md"), so this genuinely awards nothing today; it activates on
    /// its own the day a rules track starts scheduling reviews, with no further change needed here.
    private func awardOnTimeReviews() throws {
        let onTime = store.state.coldGrades.filter { grade in
            guard let passage = store.state.passages.first(where: { $0.id == grade.passageID }),
                  let due = passage.schedule.dueDate else { return false }
            return grade.date <= due
        }.count
        let already = store.state.rewardLedger.filter { $0.reason == "Reviewed on time" }.count
        guard onTime > already else { return }
        for _ in already..<onTime { try award(.onTimeReview) }
    }

    /// Passage/piece performance-readiness (§11 R10 sets `Passage.learningState`; unreached today for
    /// the same reason `awardOnTimeReviews` is — see its doc). Matched by the passage/piece's stable
    /// id (`MilestoneEvent.passageID`/`.pieceID`), not by `detail` text: two different passages can
    /// share a generic default title (e.g. "mm. 1–4"), and matching by text would silently skip a
    /// real second milestone that happens to render the same headline as an earlier one.
    private func awardPerformanceReadyMilestones(now: Date) throws {
        let readyPassages = store.state.passages.filter { $0.learningState == .performanceReady && $0.deletedAt == nil }
        let recordedPassageIDs = Set(store.state.milestoneEvents.filter { $0.kind == MilestoneKind.passageReady.rawValue }.compactMap(\.passageID))
        for passage in readyPassages.sorted(by: { $0.id.uuidString < $1.id.uuidString }) {
            guard !recordedPassageIDs.contains(passage.id) else { continue }
            try award(.performanceReadyPassage)
            try celebrate(.passageReady, detail: MilestoneKind.passageReady.detail(passage.title), now: now, pieceID: passage.pieceID, passageID: passage.id)
        }
        let pieces = store.state.pieces.filter { $0.id != WarmupsPiece.id && $0.deletedAt == nil }
        let recordedPieceIDs = Set(store.state.milestoneEvents.filter { $0.kind == MilestoneKind.pieceReady.rawValue }.compactMap(\.pieceID))
        for piece in pieces.sorted(by: { $0.id.uuidString < $1.id.uuidString }) {
            guard !recordedPieceIDs.contains(piece.id) else { continue }
            let ownPassages = store.state.passages.filter { $0.pieceID == piece.id && !$0.archived && $0.deletedAt == nil }
            guard !ownPassages.isEmpty, ownPassages.allSatisfy({ $0.learningState == .performanceReady }) else { continue }
            try award(.pieceFullyReady)
            try celebrate(.pieceReady, detail: MilestoneKind.pieceReady.detail(piece.title), now: now, pieceID: piece.id)
        }
    }

    private func updateStreakAndCelebrateMilestone(now: Date) throws {
        let today = todaySessions(asOf: now)
        let focusedToday = today.reduce(0) { $0 + $1.activeSeconds }
        let completedSetsToday = today.reduce(0) { $0 + $1.completedSets }
        guard RewardsEngine.dayQualifies(focusedSeconds: focusedToday, completedSets: completedSetsToday) else { return }
        let before = store.state.rewardsState
        let after = RewardsEngine.recordQualifyingDay(before, today: now)
        guard after != before else { return }
        try store.updateRewardsState(after)
        if after.streakDays > before.streakDays, RewardsEngine.isStreakMilestone(after.streakDays) {
            try celebrate(.streakMilestone, detail: MilestoneKind.streakMilestone.detail("\(after.streakDays)"), now: now)
        }
    }

    private func celebrateRankUpIfNeeded(xpBefore: Int) throws {
        let before = RewardsEngine.rankProgress(totalXP: xpBefore).rank
        let after = RewardsEngine.rankProgress(totalXP: totalXP)
        guard after.rank > before else { return }
        try celebrate(.rankUp, detail: MilestoneKind.rankUp.detail(after.rankName), now: Date())
    }

    private func awardBadges(now: Date) throws {
        let alreadyEarned = Set(store.state.badges.map(\.key))
        let newlyEarned = RewardsEngine.evaluateBadges(history: store.state.history, passages: store.state.passages,
                                                        warmups: store.state.warmupExercises,
                                                        streakDays: store.state.rewardsState.streakDays,
                                                        alreadyEarned: alreadyEarned, asOf: now)
        for key in newlyEarned {
            try store.awardBadge(Badge(key: key))
            sound.play(.badge) // small: a badge earns a quiet chime, never the big celebration overlay.
        }
    }

    private func celebrate(_ kind: MilestoneKind, detail: String, now: Date, pieceID: UUID? = nil, passageID: UUID? = nil) throws {
        let event = MilestoneEvent(kind: kind.rawValue, date: now, detail: detail, pieceID: pieceID, passageID: passageID)
        try store.recordMilestone(event)
        celebrationQueue.append(event)
        sound.play(.celebration)
    }

    private var allSets: [ActiveSet] { store.state.history + [store.activeSet].compactMap { $0 } }

    private func todaySessions(asOf now: Date) -> [PracticeSession] {
        store.state.sessions.filter { Calendar.current.isDate($0.startedAt, inSameDayAs: now) }
    }
}
