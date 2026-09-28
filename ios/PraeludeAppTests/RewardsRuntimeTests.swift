import Foundation
import XCTest
@testable import Praelude

final class RewardsRuntimeTests: XCTestCase {
    @MainActor
    private struct Fixture {
        let store: PracticeStore
        let runtime: RewardsRuntime
    }

    @MainActor
    private func fixture(now: @escaping () -> Date = { Date(timeIntervalSince1970: 1_700_000_000) }) -> Fixture {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("Praelude-Rewards-\(UUID().uuidString)", isDirectory: true)
        let suite = "Praelude-Rewards-\(UUID().uuidString)"
        let defaults = try! XCTUnwrap(UserDefaults(suiteName: suite))
        let sound = RewardSoundService(defaults: defaults)
        sound.isEnabled = false // exercise reconcile's bookkeeping without touching real audio hardware
        let store = PracticeStore(directory: directory, now: now)
        let runtime = RewardsRuntime(store: store, sound: sound)
        addTeardownBlock {
            UserDefaults(suiteName: suite)?.removePersistentDomain(forName: suite)
            try? FileManager.default.removeItem(at: directory)
        }
        return Fixture(store: store, runtime: runtime)
    }

    @MainActor
    private func coinsFor(_ reason: String, in store: PracticeStore) -> Int {
        store.state.rewardLedger.filter { $0.reason == reason }.count
    }

    // MARK: - Completed reps (honesty, §14) — high-water-mark counting under Undo

    /// `reconcile` counts "completed reps" by comparing the currently-effective attempt count
    /// against how many "Completed repetition" ledger entries already exist, awarding only the
    /// difference. Undo can make the effective count dip (an undone attempt no longer counts) and
    /// later climb back past its previous peak; this must never let a genuinely new effective rep
    /// go permanently unrewarded, and must never claw back a coin already awarded for a rep the
    /// player later undid (honesty: coins only ever move forward).
    @MainActor func testCompletedRepCoinsSurviveInterleavedUndoAndNeverExceedEffectiveCount() throws {
        let f = fixture()
        let piece = Piece(title: "Study")
        try f.store.addPiece(piece)
        try f.store.startSet(PracticeConfiguration(pieceID: piece.id, basis: .totalPlays, targetCount: 100, startBPM: 60, targetBPM: 60))

        try f.store.record(.clean); try f.store.record(.clean); try f.store.record(.clean)
        f.runtime.reconcile()
        XCTAssertEqual(coinsFor("Completed repetition", in: f.store), 3)

        try f.store.undo() // now 2 effective
        f.runtime.reconcile()
        XCTAssertEqual(coinsFor("Completed repetition", in: f.store), 3, "undo must never claw back an already-awarded coin")

        try f.store.record(.clean); try f.store.record(.clean); try f.store.record(.clean); try f.store.record(.clean) // now 6 effective
        f.runtime.reconcile()
        XCTAssertEqual(coinsFor("Completed repetition", in: f.store), 6, "every effective rep above the prior high-water mark must still be rewarded")

        let effectiveNow = (f.store.state.history + [f.store.activeSet].compactMap { $0 }).flatMap(\.attempts).filter(\.isEffective).count
        XCTAssertEqual(effectiveNow, 6)
        XCTAssertTrue(f.store.state.rewardLedger.allSatisfy { $0.coinsDelta >= 0 && $0.xpDelta >= 0 }, "no ledger entry may ever be a penalty")
    }

    @MainActor func testCompletedSetAwardsExactlyOnceOncePushedToHistory() throws {
        let f = fixture()
        let piece = Piece(title: "Study")
        try f.store.addPiece(piece)
        try f.store.startSet(PracticeConfiguration(pieceID: piece.id, targetCount: 1, startBPM: 60, targetBPM: 60))
        try f.store.record(.clean)
        XCTAssertEqual(f.store.activeSet?.status, .completed)
        f.runtime.reconcile()
        XCTAssertEqual(coinsFor("Completed set", in: f.store), 0, "a still-active completed set is not yet in history")
        try f.store.endSet()
        f.runtime.reconcile()
        XCTAssertEqual(coinsFor("Completed set", in: f.store), 1)
        f.runtime.reconcile()
        XCTAssertEqual(coinsFor("Completed set", in: f.store), 1, "reconciling again must not double-award")
    }

    @MainActor func testFirstSetBadgeIsAwardedOnceAndNeverAgain() throws {
        let f = fixture()
        let piece = Piece(title: "Study")
        try f.store.addPiece(piece)
        try f.store.startSet(PracticeConfiguration(pieceID: piece.id, targetCount: 1, startBPM: 60, targetBPM: 60))
        try f.store.record(.clean)
        try f.store.endSet()
        f.runtime.reconcile()
        XCTAssertEqual(f.store.state.badges.filter { $0.key == "first_set" }.count, 1)
        try f.store.startSet(PracticeConfiguration(pieceID: piece.id, targetCount: 1, startBPM: 60, targetBPM: 60))
        try f.store.record(.clean); try f.store.endSet()
        f.runtime.reconcile()
        XCTAssertEqual(f.store.state.badges.filter { $0.key == "first_set" }.count, 1, "a badge is never re-awarded")
    }

    // MARK: - Performance-ready milestones dedupe by identity, not by title text

    @MainActor func testTwoPassagesSharingATitleBothGetCelebratedAndPaid() throws {
        let f = fixture()
        let pieceA = Piece(title: "Sonata")
        let pieceB = Piece(title: "Etude")
        try f.store.addPiece(pieceA); try f.store.addPiece(pieceB)
        var passageA = Passage(pieceID: pieceA.id, title: "mm. 1\u{2013}4")
        var passageB = Passage(pieceID: pieceB.id, title: "mm. 1\u{2013}4") // deliberately the same title
        try f.store.savePassage(passageA); try f.store.savePassage(passageB)
        passageA.learningState = .performanceReady
        try f.store.savePassage(passageA)
        f.runtime.reconcile()
        XCTAssertEqual(coinsFor("Passage performance-ready", in: f.store), 1)
        XCTAssertEqual(f.store.state.milestoneEvents.filter { $0.kind == MilestoneKind.passageReady.rawValue }.count, 1)

        passageB.learningState = .performanceReady
        try f.store.savePassage(passageB)
        f.runtime.reconcile()
        XCTAssertEqual(coinsFor("Passage performance-ready", in: f.store), 2, "a second passage becoming ready must be rewarded even with an identical title")
        XCTAssertEqual(f.store.state.milestoneEvents.filter { $0.kind == MilestoneKind.passageReady.rawValue }.count, 2)
        let passageIDs = Set(f.store.state.milestoneEvents.compactMap(\.passageID))
        XCTAssertEqual(passageIDs, [passageA.id, passageB.id])

        f.runtime.reconcile()
        XCTAssertEqual(coinsFor("Passage performance-ready", in: f.store), 2, "reconciling again must not re-pay either passage")
    }

    @MainActor func testPieceFullyReadyFiresOnceAllOwnPassagesAreReady() throws {
        let f = fixture()
        let piece = Piece(title: "Sonata")
        try f.store.addPiece(piece)
        var first = Passage(pieceID: piece.id, title: "Exposition")
        var second = Passage(pieceID: piece.id, title: "Development")
        try f.store.savePassage(first); try f.store.savePassage(second)
        first.learningState = .performanceReady
        try f.store.savePassage(first)
        f.runtime.reconcile()
        XCTAssertEqual(coinsFor("Piece fully ready", in: f.store), 0, "one of two passages is not enough")

        second.learningState = .performanceReady
        try f.store.savePassage(second)
        f.runtime.reconcile()
        XCTAssertEqual(coinsFor("Piece fully ready", in: f.store), 1)
        XCTAssertEqual(f.store.state.milestoneEvents.first { $0.kind == MilestoneKind.pieceReady.rawValue }?.pieceID, piece.id)
    }

    // MARK: - Streak

    @MainActor func testQualifyingDayUpdatesStreakAndQueuesAMilestoneAtSevenDays() throws {
        let calendar = Calendar.current
        let start = Date(timeIntervalSince1970: 1_700_000_000)
        var current = start
        let f = fixture(now: { current })
        let piece = Piece(title: "Study")
        try f.store.addPiece(piece)
        for day in 0..<7 {
            current = calendar.date(byAdding: .day, value: day, to: start)!
            try f.store.startSet(PracticeConfiguration(pieceID: piece.id, targetCount: 1, startBPM: 60, targetBPM: 60))
            try f.store.record(.clean)
            try f.store.endSession()
            f.runtime.reconcile(asOf: current)
        }
        XCTAssertEqual(f.store.state.rewardsState.streakDays, 7)
        XCTAssertEqual(f.store.state.rewardsState.streakFreezesAvailable, 1, "a 7-day extension earns one freeze")
        let milestone = f.runtime.dequeueCelebration()
        XCTAssertEqual(milestone?.kind, MilestoneKind.streakMilestone.rawValue)
        XCTAssertNil(f.runtime.dequeueCelebration(), "only the streak milestone was queued")
    }

    @MainActor func testReconcileToleratesAStoreWhoseWritesAlwaysFail() {
        // Every mutation below silently fails (writeData always throws), so the store never
        // accumulates any real state; reconcile — which is not `throws` — must still complete
        // cleanly rather than crash when its own appendRewardLedgerEntry/awardBadge calls fail.
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("Praelude-Rewards-failing-\(UUID().uuidString)", isDirectory: true)
        let store = PracticeStore(directory: directory, writeData: { _, _ in throw CocoaError(.fileWriteOutOfSpace) })
        try? store.addPiece(Piece(title: "Study"))
        let runtime = RewardsRuntime(store: store)
        runtime.reconcile()
        XCTAssertTrue(store.state.rewardLedger.isEmpty)
        addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
    }
}
