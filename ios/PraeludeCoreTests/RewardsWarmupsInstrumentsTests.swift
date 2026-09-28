import Foundation
import XCTest
@testable import PraeludeCore

final class RewardsWarmupsInstrumentsTests: XCTestCase {
    @MainActor private func makeStore(now: @escaping () -> Date = Date.init) -> (PracticeStore, URL) {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("praelude-ios-tests-\(UUID())")
        return (PracticeStore(directory: directory, now: now), directory)
    }

    // MARK: - InstrumentCatalog (§6)

    func testEveryFamilyHasLevelsAndPartsVocabulary() {
        XCTAssertFalse(InstrumentCatalog.levels.isEmpty)
        for family in InstrumentFamily.allCases {
            XCTAssertFalse(family.partsVocabulary.isEmpty, "\(family) has no parts vocabulary")
            XCTAssertFalse(InstrumentCatalog.suggestedTranspositions(for: family).isEmpty)
            // Concert pitch must always be offered, even for a transposing family.
            XCTAssertTrue(InstrumentCatalog.suggestedTranspositions(for: family).contains { $0.writtenToConcertSemitones == 0 })
        }
    }

    func testOnlyWindsAndBrassAreOfferedTheTranspositionStep() {
        for family in InstrumentFamily.allCases {
            let relevant = InstrumentCatalog.transpositionIsRelevant(for: family)
            XCTAssertEqual(relevant, family == .woodwinds || family == .brass, "\(family)")
        }
    }

    func testDefaultVariantNamesMatchTheSpecPerFamily() {
        XCTAssertEqual(InstrumentCatalog.defaultVariantNames(for: .keyboard), ["Hands separately", "Dotted rhythm", "Reverse dotted", "Blocked chords"])
        XCTAssertTrue(InstrumentCatalog.defaultVariantNames(for: .voice).contains("On \u{201c}nee\u{201d}"))
        XCTAssertTrue(InstrumentCatalog.defaultVariantNames(for: .strings).contains("Open strings"))
    }

    // MARK: - WarmupCatalog / WarmupsPiece / seeding (§12)

    func testCircleOfFifthsHasTwelveUniqueKeys() {
        XCTAssertEqual(WarmupCatalog.circleOfFifths.count, 12)
        XCTAssertEqual(Set(WarmupCatalog.circleOfFifths).count, 12)
    }

    func testSeedDefaultsCoversEveryKeyAndStaysWithinLibraryBounds() {
        for family in InstrumentFamily.allCases {
            let seeded = WarmupCatalog.seedDefaults(family: family)
            XCTAssertEqual(Set(seeded.map(\.id)).count, seeded.count, "\(family) produced duplicate ids")
            let keys = Set(seeded.map(\.key))
            XCTAssertEqual(keys, Set(WarmupCatalog.circleOfFifths), "\(family) did not cover every key")
            XCTAssertTrue(seeded.allSatisfy { $0.instrumentFamily == family })
            XCTAssertLessThan(seeded.count, 300)
        }
    }

    @MainActor func testSeedWarmupsIfNeededIsIdempotentAndValidates() throws {
        let (store, directory) = makeStore()
        defer { try? FileManager.default.removeItem(at: directory) }
        try store.seedWarmupsIfNeeded(family: .keyboard)
        let firstCount = store.state.warmupExercises.count
        XCTAssertGreaterThan(firstCount, 0)
        try store.seedWarmupsIfNeeded(family: .keyboard)
        XCTAssertEqual(store.state.warmupExercises.count, firstCount, "seeding twice must not duplicate")
        try store.seedWarmupsIfNeeded(family: .strings)
        XCTAssertGreaterThan(store.state.warmupExercises.count, firstCount, "a second family still seeds")
    }

    @MainActor func testSaveWarmupExercisesBatchesIntoOneTransaction() throws {
        let (store, directory) = makeStore()
        defer { try? FileManager.default.removeItem(at: directory) }
        let before = store.state.revision
        try store.saveWarmupExercises(WarmupCatalog.seedDefaults(family: .keyboard))
        XCTAssertEqual(store.state.revision, before + 1, "seeding a whole family must be one atomic write, not one per exercise")
        // Upsert semantics still hold: re-saving the same ids with a change replaces them in place.
        var updated = store.state.warmupExercises
        updated[0].isFavorite = true
        try store.saveWarmupExercises(updated)
        XCTAssertEqual(store.state.warmupExercises.count, updated.count, "re-saving the same ids must not duplicate rows")
        XCTAssertTrue(store.state.warmupExercises.contains { $0.id == updated[0].id && $0.isFavorite })
    }

    @MainActor func testSeedDefaultVariantRoutineIfNeededIsIdempotentAndSkipsFamiliesWithNoDefaults() throws {
        let (store, directory) = makeStore()
        defer { try? FileManager.default.removeItem(at: directory) }
        try store.seedDefaultVariantRoutineIfNeeded(family: .keyboard)
        XCTAssertEqual(store.state.routines.count, 1)
        XCTAssertEqual(store.state.routines.first?.stages.map(\.name), InstrumentCatalog.defaultVariantNames(for: .keyboard))
        try store.seedDefaultVariantRoutineIfNeeded(family: .keyboard)
        XCTAssertEqual(store.state.routines.count, 1, "seeding twice must not duplicate the routine")
        try store.seedDefaultVariantRoutineIfNeeded(family: .other)
        XCTAssertEqual(store.state.routines.count, 1, ".other has no default variants and seeds nothing")
    }

    @MainActor func testWarmupsPieceIsCreatedOnceAndFilteredFromRealPieces() throws {
        let (store, directory) = makeStore()
        defer { try? FileManager.default.removeItem(at: directory) }
        try store.addPiece(Piece(title: "Sonata"))
        XCTAssertEqual(store.realPieces.count, 1)
        try store.ensureWarmupsPiece()
        XCTAssertEqual(store.pieces.count, 2, "the warmups piece is a real, persisted Piece")
        XCTAssertEqual(store.realPieces.count, 1, "but it never appears in the player-facing list")
        try store.ensureWarmupsPiece()
        XCTAssertEqual(store.pieces.count, 2, "creating it twice is a no-op")
    }

    @MainActor func testWarmupPracticeSetReusesTheSameEngineAsAPassageSet() throws {
        let (store, directory) = makeStore()
        defer { try? FileManager.default.removeItem(at: directory) }
        try store.ensureWarmupsPiece()
        try store.startSet(PracticeConfiguration(pieceID: WarmupsPiece.id, focus: "C major scale", targetCount: 2, startBPM: 60, targetBPM: 60))
        try store.record(.clean); try store.record(.clean)
        XCTAssertEqual(store.activeSet?.status, .completed)
        XCTAssertEqual(store.sessions.last?.pieceID, WarmupsPiece.id)
    }

    // MARK: - WarmupRotation (§12)

    private func exercise(key: String, useCount: Int = 0, lastUsedAt: Date? = nil, isFavorite: Bool = false,
                          family: InstrumentFamily = .keyboard) -> WarmupExercise {
        WarmupExercise(kind: .scale, key: key, mode: .major, instrumentFamily: family, name: "\(key) major",
                       isFavorite: isFavorite, lastUsedAt: lastUsedAt, useCount: useCount)
    }

    func testNextInRotationPrefersNeverUsedThenLeastRecentlyUsed() {
        let now = Date()
        let used = exercise(key: "G", lastUsedAt: now.addingTimeInterval(-60))
        let older = exercise(key: "D", lastUsedAt: now.addingTimeInterval(-3600))
        let never = exercise(key: "C")
        XCTAssertEqual(WarmupRotation.nextInRotation(among: [used, older, never])?.key, "C")
        XCTAssertEqual(WarmupRotation.nextInRotation(among: [used, older])?.key, "D", "the older last-used wins over the more recent one")
    }

    func testNextInRotationRespectsFamilyAndFavoritesFilters() {
        let piano = exercise(key: "C", family: .keyboard)
        let violin = exercise(key: "C", family: .strings)
        XCTAssertEqual(WarmupRotation.nextInRotation(among: [piano, violin], family: .strings)?.instrumentFamily, .strings)
        let favorite = exercise(key: "G", isFavorite: true)
        let plain = exercise(key: "C", isFavorite: false)
        XCTAssertEqual(WarmupRotation.nextInRotation(among: [favorite, plain], favoritesOnly: true)?.key, "G")
    }

    func testNextInRotationIgnoresDeletedExercises() {
        var deleted = exercise(key: "C")
        deleted.deletedAt = Date()
        let live = exercise(key: "G")
        XCTAssertEqual(WarmupRotation.nextInRotation(among: [deleted, live])?.key, "G")
    }

    func testNeglectedKeysFindsUntouchedAndStaleKeysButNotFreshOnes() {
        let now = Date()
        let fresh = exercise(key: "C", lastUsedAt: now)
        let stale = exercise(key: "G", lastUsedAt: now.addingTimeInterval(-30 * 24 * 60 * 60))
        let neglected = WarmupRotation.neglectedKeys(among: [fresh, stale], asOf: now)
        XCTAssertTrue(neglected.contains("G"))
        XCTAssertFalse(neglected.contains("C"))
        // A key with no exercise at all for this scope is not "neglected" — there is nothing to show for it yet.
        XCTAssertFalse(neglected.contains("D"))
    }

    func testLastUsedOrdersMostRecentFirstAndExcludesNeverUsed() {
        let now = Date()
        let recent = exercise(key: "C", lastUsedAt: now)
        let older = exercise(key: "G", lastUsedAt: now.addingTimeInterval(-100))
        let never = exercise(key: "D")
        let result = WarmupRotation.lastUsed(among: [never, older, recent])
        XCTAssertEqual(result.map(\.key), ["C", "G"])
    }

    // MARK: - RewardsEngine ledger honesty (§14)

    func testEveryLedgerEntryIsNonNegative() {
        for event in [RewardEvent.completedRep, .completedSet, .onTimeReview, .performanceReadyPassage, .pieceFullyReady] {
            let entry = RewardsEngine.ledgerEntry(for: event)
            XCTAssertGreaterThanOrEqual(entry.coinsDelta, 0)
            XCTAssertGreaterThanOrEqual(entry.xpDelta, 0)
        }
    }

    func testCelebrationTiersMatchTheSpecNeverMidSet() {
        XCTAssertEqual(RewardsEngine.celebrationTier(for: .completedRep), .none)
        XCTAssertEqual(RewardsEngine.celebrationTier(for: .completedSet), .small)
        XCTAssertEqual(RewardsEngine.celebrationTier(for: .performanceReadyPassage), .big)
        XCTAssertEqual(RewardsEngine.celebrationTier(for: .pieceFullyReady), .big)
    }

    // MARK: - RewardsEngine rank/division (ported Mac formula)

    func testRankProgressStartsAtRankOneDivisionOne() {
        let progress = RewardsEngine.rankProgress(totalXP: 0)
        XCTAssertEqual(progress.rank, 1)
        XCTAssertEqual(progress.rankName, "Prelude")
        XCTAssertEqual(progress.division, 1)
        XCTAssertEqual(progress.divisionXP, 0)
    }

    func testRankProgressAdvancesAtExactRankBoundary() {
        // rankStartXP(2) = 250 * 1 * 4 = 1000
        let justBefore = RewardsEngine.rankProgress(totalXP: 999)
        XCTAssertEqual(justBefore.rank, 1)
        let atBoundary = RewardsEngine.rankProgress(totalXP: 1000)
        XCTAssertEqual(atBoundary.rank, 2)
        XCTAssertEqual(atBoundary.rankName, "Etude")
        XCTAssertEqual(atBoundary.division, 1)
        XCTAssertEqual(atBoundary.divisionXP, 0)
        XCTAssertEqual(atBoundary.divisionXPRequired, 100 + 50) // divisionXPRequired(2)
    }

    func testRankNameFallsBackToEncoreBeyondTheNamedTable() {
        XCTAssertEqual(RewardsEngine.rankName(11), "Encore 1")
        XCTAssertEqual(RewardsEngine.rankName(15), "Encore 5")
    }

    func testRankProgressIsMonotonicNonDecreasingWithXP() {
        var previousRank = 1
        for xp in stride(from: 0, through: 50_000, by: 137) {
            let progress = RewardsEngine.rankProgress(totalXP: xp)
            XCTAssertGreaterThanOrEqual(progress.rank, previousRank)
            previousRank = progress.rank
        }
    }

    // MARK: - RewardsEngine streak (§14)

    private func day(_ offset: Int, from base: Date = Date(timeIntervalSince1970: 1_700_000_000)) -> Date {
        Calendar.current.date(byAdding: .day, value: offset, to: base)!
    }

    func testFirstQualifyingDayStartsAOneDayStreak() {
        let updated = RewardsEngine.recordQualifyingDay(RewardsState(), today: day(0))
        XCTAssertEqual(updated.streakDays, 1)
    }

    func testConsecutiveDaysExtendTheStreak() {
        var state = RewardsEngine.recordQualifyingDay(RewardsState(), today: day(0))
        state = RewardsEngine.recordQualifyingDay(state, today: day(1))
        state = RewardsEngine.recordQualifyingDay(state, today: day(2))
        XCTAssertEqual(state.streakDays, 3)
    }

    func testCallingTwiceOnTheSameDayNeverDoubleCounts() {
        var state = RewardsEngine.recordQualifyingDay(RewardsState(), today: day(0))
        state = RewardsEngine.recordQualifyingDay(state, today: day(0))
        XCTAssertEqual(state.streakDays, 1)
    }

    func testAMissedDayWithoutAFreezeResetsToOne() {
        var state = RewardsEngine.recordQualifyingDay(RewardsState(), today: day(0))
        state = RewardsEngine.recordQualifyingDay(state, today: day(2)) // day 1 was skipped, no freeze
        XCTAssertEqual(state.streakDays, 1)
    }

    func testAMissedDayWithAnAvailableFreezeBridgesTheStreak() {
        var state = RewardsEngine.recordQualifyingDay(RewardsState(), today: day(0))
        state.streakFreezesAvailable = 1
        state = RewardsEngine.recordQualifyingDay(state, today: day(2)) // day 1 skipped, freeze spent
        XCTAssertEqual(state.streakDays, 2, "the freeze preserves continuity rather than restarting at 1")
        XCTAssertEqual(state.streakFreezesAvailable, 0)
    }

    func testTwoMissedDaysExhaustAFreezeAndStillReset() {
        var state = RewardsEngine.recordQualifyingDay(RewardsState(), today: day(0))
        state.streakFreezesAvailable = 1
        state = RewardsEngine.recordQualifyingDay(state, today: day(3)) // two days skipped
        XCTAssertEqual(state.streakDays, 1)
        XCTAssertEqual(state.streakFreezesAvailable, 1, "an unusable gap never spends the freeze")
    }

    func testASevenDayExtensionEarnsOneFreezeUpToTheCap() {
        var state = RewardsState()
        for offset in 0..<7 { state = RewardsEngine.recordQualifyingDay(state, today: day(offset)) }
        XCTAssertEqual(state.streakDays, 7)
        XCTAssertEqual(state.streakFreezesAvailable, 1)
    }

    func testCurrentStreakDisplayNeverMutatesAndZeroesOnceGraceLapses() {
        let state = RewardsEngine.recordQualifyingDay(RewardsState(), today: day(0))
        XCTAssertEqual(RewardsEngine.currentStreakDisplay(state, asOf: day(0)), 1)
        XCTAssertEqual(RewardsEngine.currentStreakDisplay(state, asOf: day(1)), 1, "yesterday is still a live anchor")
        XCTAssertEqual(RewardsEngine.currentStreakDisplay(state, asOf: day(3)), 0, "the grace window has lapsed with no freeze")
    }

    func testCurrentStreakDisplayStaysAliveOneMoreDayWhenAFreezeCouldStillRescueIt() {
        var state = RewardsEngine.recordQualifyingDay(RewardsState(), today: day(0))
        state.streakFreezesAvailable = 1
        XCTAssertEqual(RewardsEngine.currentStreakDisplay(state, asOf: day(2)), 1, "still rescuable today")
    }

    func testStreakMilestonesMatchTheDocumentedList() {
        for milestone in [7, 14, 30, 60, 100, 200, 365] { XCTAssertTrue(RewardsEngine.isStreakMilestone(milestone)) }
        for ordinary in [1, 2, 8, 15, 29, 31, 99] { XCTAssertFalse(RewardsEngine.isStreakMilestone(ordinary)) }
    }

    // MARK: - RewardsEngine badges (§14)

    func testFirstSetBadgeOnlyAwardsOnceASetHasCompleted() {
        let piece = UUID()
        let notCompleted = ActiveSet(sessionID: UUID(), configuration: PracticeConfiguration(pieceID: piece))
        XCTAssertFalse(RewardsEngine.evaluateBadges(history: [notCompleted], passages: [], warmups: [], streakDays: 0, alreadyEarned: []).contains("first_set"))
        var completed = notCompleted
        completed.status = .completed
        XCTAssertTrue(RewardsEngine.evaluateBadges(history: [completed], passages: [], warmups: [], streakDays: 0, alreadyEarned: []).contains("first_set"))
    }

    func testBadgesAreNeverReAwardedOnceAlreadyEarned() {
        var completed = ActiveSet(sessionID: UUID(), configuration: PracticeConfiguration(pieceID: UUID()))
        completed.status = .completed
        let earned = RewardsEngine.evaluateBadges(history: [completed], passages: [], warmups: [], streakDays: 0, alreadyEarned: ["first_set"])
        XCTAssertFalse(earned.contains("first_set"))
    }

    func testPerformanceReadyPassageAwardsTheStageReadyBadge() {
        let passage = Passage(pieceID: UUID(), title: "Coda", learningState: .performanceReady)
        XCTAssertTrue(RewardsEngine.evaluateBadges(history: [], passages: [passage], warmups: [], streakDays: 0, alreadyEarned: []).contains("first_performance_ready"))
    }

    func testAllTwelveKeysWithinAMonthAwardsTheKeysBadge() {
        let now = Date()
        let complete = WarmupCatalog.circleOfFifths.map { exercise(key: $0, lastUsedAt: now) }
        XCTAssertTrue(RewardsEngine.evaluateBadges(history: [], passages: [], warmups: complete, streakDays: 0, alreadyEarned: [], asOf: now).contains("all_keys_month"))
        let missingOne = Array(complete.dropLast())
        XCTAssertFalse(RewardsEngine.evaluateBadges(history: [], passages: [], warmups: missingOne, streakDays: 0, alreadyEarned: [], asOf: now).contains("all_keys_month"))
    }

    // MARK: - StudioCatalog (§14)

    func testFreeItemsAreUnlockedFromTheStart() {
        for slot in StudioSlot.allCases {
            let cheapest = StudioCatalog.items(in: slot).first
            XCTAssertEqual(cheapest?.price, 0, "\(slot) should offer a free starting item")
            XCTAssertTrue(StudioCatalog.isUnlocked(cheapest!, lifetimeCoins: 0, rank: 1))
        }
    }

    func testBestUnlockedNeverExceedsWalletOrRank() {
        let best = StudioCatalog.bestUnlocked(lifetimeCoins: 100, rank: 1)
        for item in best.values {
            XCTAssertLessThanOrEqual(item.price, 100)
            XCTAssertLessThanOrEqual(item.unlockRank, 1)
        }
    }

    func testBestUnlockedImprovesAsCoinsAndRankGrow() {
        let poor = StudioCatalog.bestUnlocked(lifetimeCoins: 0, rank: 1)[.piano]
        let rich = StudioCatalog.bestUnlocked(lifetimeCoins: 10_000, rank: 10)[.piano]
        XCTAssertNotNil(rich)
        XCTAssertGreaterThanOrEqual(rich!.price, poor?.price ?? 0)
    }

    func testNextLockedIsNilOnceEverythingInASlotIsUnlocked() {
        XCTAssertNil(StudioCatalog.nextLocked(in: .theme, lifetimeCoins: 10_000, rank: 10))
        XCTAssertNotNil(StudioCatalog.nextLocked(in: .theme, lifetimeCoins: 0, rank: 1))
    }

    // MARK: - MilestoneSharing hook

    @MainActor func testMilestoneEventOutlivesTheHardDeletedPassageItPointsTo() throws {
        // MilestoneEvent.pieceID/passageID exist purely for dedup-by-identity (see RewardsRuntime);
        // unlike RuleEvent they are never existence-checked in validate, because a passage can be
        // hard-deleted (deletePassage) after being celebrated and the library must still load.
        let (store, directory) = makeStore()
        defer { try? FileManager.default.removeItem(at: directory) }
        try store.addPiece(Piece(id: UUID(uuidString: "00000000-0000-0000-0000-0000000000A1")!, title: "Sonata"))
        let pieceID = UUID(uuidString: "00000000-0000-0000-0000-0000000000A1")!
        try store.savePassage(Passage(pieceID: pieceID, title: "mm. 1\u{2013}4"))
        let passageID = store.state.passages[0].id
        try store.recordMilestone(MilestoneEvent(kind: MilestoneKind.passageReady.rawValue, detail: "mm. 1\u{2013}4 is performance-ready.", pieceID: pieceID, passageID: passageID))
        try store.deletePassage(passageID)
        // Re-decoding the persisted bytes exercises the exact `validate` path `PracticeStore.init` runs.
        let reloaded = PracticeStore(directory: directory)
        XCTAssertFalse(reloaded.isReadOnly, reloaded.errorMessage ?? "")
        XCTAssertEqual(reloaded.state.milestoneEvents.first?.passageID, passageID)
    }

    func testTwoPassagesWithTheSameTitleGetDistinctMilestoneIdentity() {
        // The dedup key RewardsRuntime uses (passageID) must differ even when detail text collides.
        let sharedTitle = "mm. 1\u{2013}4 is performance-ready."
        let first = MilestoneEvent(kind: MilestoneKind.passageReady.rawValue, detail: sharedTitle, passageID: UUID())
        let second = MilestoneEvent(kind: MilestoneKind.passageReady.rawValue, detail: sharedTitle, passageID: UUID())
        XCTAssertEqual(first.detail, second.detail)
        XCTAssertNotEqual(first.passageID, second.passageID)
    }

    func testMilestoneShareCardProducesReadableTextForEveryKind() {
        for kind in MilestoneKind.allCases {
            let event = MilestoneEvent(kind: kind.rawValue, detail: kind.detail("Test"))
            XCTAssertFalse(MilestoneShareCard.text(for: event).isEmpty)
        }
    }

    func testNullMilestonePublisherNeverThrowsOrBlocks() async {
        let publisher = NullMilestoneSharePublisher()
        await publisher.publish(MilestoneEvent(kind: MilestoneKind.rankUp.rawValue, detail: "Etude"), profile: Profile())
    }
}
