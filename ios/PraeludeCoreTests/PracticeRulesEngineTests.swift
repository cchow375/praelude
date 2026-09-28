import Foundation
import XCTest
@testable import PraeludeCore

/// Staged-data tests for the practice rules façade (§11 R1–R15, §10a/§10c, §17a): every rule is
/// exercised directly against a hand-built `RuleContext`, with no `PracticeStore` involved, per
/// `RuleContext`'s own documented intent. Each rule gets at least one test proving it fires, shows
/// its one-line reason, and supports a logged override; most also get a "does not fire" or boundary
/// case. A few cross-cutting edge cases close the file: day boundaries under a real time zone, and a
/// daylight-saving transition.
final class PracticeRulesEngineTests: XCTestCase {
    // MARK: - Fixtures

    private func makeCalendar() -> Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/New_York")!
        return calendar
    }

    private func makeDate(_ year: Int, _ month: Int, _ day: Int, _ hour: Int = 12, _ minute: Int = 0, calendar: Calendar) -> Date {
        var components = DateComponents()
        components.year = year; components.month = month; components.day = day
        components.hour = hour; components.minute = minute; components.timeZone = calendar.timeZone
        return calendar.date(from: components)!
    }

    private func makeContext(now: Date, calendar: Calendar, settings: RuleSettings = RuleSettings(),
                              pieces: [Piece] = [], passages: [Passage] = [], instruments: [Instrument] = [],
                              coldGrades: [ColdGradeRecord] = [], breakPointTaps: [BreakPointTap] = [],
                              ruleEvents: [RuleEvent] = [], sessions: [PracticeSession] = [], history: [ActiveSet] = [],
                              activeSet: ActiveSet? = nil, warmupExercises: [WarmupExercise] = []) -> RuleContext {
        RuleContext(now: now, calendar: calendar, settings: settings, pieces: pieces, passages: passages,
                    instruments: instruments, coldGrades: coldGrades, breakPointTaps: breakPointTaps,
                    ruleEvents: ruleEvents, sessions: sessions, history: history, activeSet: activeSet,
                    warmupExercises: warmupExercises)
    }

    private func makePiece(performanceDates: [Date] = [], instrumentID: UUID? = nil) -> Piece {
        Piece(title: "Nocturne", composer: "Chopin", instrumentID: instrumentID, performanceDates: performanceDates)
    }

    private func makePassage(pieceID: UUID, learningState: LearningState = .new, schedule: PassageSchedule = PassageSchedule(),
                              startMeasure: Int? = nil, endMeasure: Int? = nil, regions: [PassageRegion] = [],
                              performanceTempo: Double? = nil, archived: Bool = false, createdAt: Date = Date()) -> Passage {
        Passage(pieceID: pieceID, title: "Passage", startMeasure: startMeasure, endMeasure: endMeasure,
                regions: regions, archived: archived, learningState: learningState, schedule: schedule,
                performanceTempo: performanceTempo, createdAt: createdAt)
    }

    private func makeConfiguration(pieceID: UUID, passageID: UUID?, targetCount: Int = 5, startBPM: Double = 100,
                                    targetBPM: Double = 100, tempoStep: TempoStep = .fixed(4), stages: [VariantStage] = [],
                                    goal: SetGoal = .tempo, basis: CompletionBasis = .cleanStreak, hands: String = "Both hands") -> PracticeConfiguration {
        PracticeConfiguration(pieceID: pieceID, passageID: passageID, goal: goal, basis: basis, targetCount: targetCount,
                               startBPM: startBPM, targetBPM: targetBPM, tempoStep: tempoStep, stages: stages, hands: hands)
    }

    private func makeSet(configuration: PracticeConfiguration, attempts: [Attempt] = [], status: SetStatus = .running,
                          startedAt: Date, currentBPM: Double? = nil, completedStages: Int = 0, activeSeconds: TimeInterval = 0) -> ActiveSet {
        var set = ActiveSet(sessionID: UUID(), configuration: configuration, startedAt: startedAt)
        set.attempts = attempts
        set.status = status
        set.completedStages = completedStages
        set.activeSeconds = activeSeconds
        if let currentBPM { set.currentBPM = currentBPM }
        return set
    }

    private func attempt(_ verdict: Verdict, stageIndex: Int = 0, bpm: Double = 100) -> Attempt {
        Attempt(verdict: verdict, bpm: bpm, stageIndex: stageIndex)
    }

    /// Every rule "supports one-tap override, which is logged" (§11) through the same mechanism:
    /// confirms both directions of `Decision.asRuleEvent(overridden:)` for a fired decision.
    private func assertOverridable(_ decision: Decision, ruleID: RuleID, file: StaticString = #filePath, line: UInt = #line) {
        let declined = decision.asRuleEvent(overridden: true)
        XCTAssertEqual(declined.ruleID, ruleID, file: file, line: line)
        XCTAssertTrue(declined.overridden, file: file, line: line)
        XCTAssertEqual(declined.reasonText, decision.reason, file: file, line: line)
        XCTAssertEqual(declined.id, decision.id, file: file, line: line)
        XCTAssertFalse(decision.asRuleEvent(overridden: false).overridden, file: file, line: line)
    }

    // MARK: - Shared helper

    func testPluralizeFormatsSingularAndPlural() {
        XCTAssertEqual(PracticeRulesEngine.pluralize(1, "day"), "1 day")
        XCTAssertEqual(PracticeRulesEngine.pluralize(2, "day"), "2 days")
        XCTAssertEqual(PracticeRulesEngine.pluralize(0, "set"), "0 sets")
    }

    // MARK: - R1 small chunks

    func testR1FiresOnTallRegionAndSupportsOverride() throws {
        let calendar = makeCalendar()
        let now = makeDate(2026, 1, 5, calendar: calendar)
        let piece = makePiece()
        let tallRegion = PassageRegion(page: 1, x: 0, y: 0, width: 1, height: 0.5)
        let passage = makePassage(pieceID: piece.id, regions: [tallRegion])
        let context = makeContext(now: now, calendar: calendar, pieces: [piece], passages: [passage])

        let decision = try XCTUnwrap(PracticeRulesEngine.evaluateR1SmallChunks(passageID: passage.id, context: context))
        XCTAssertEqual(decision.reason, "Taller than 2 systems. Worth splitting.")
        XCTAssertEqual(decision.outcome, .suggestSplit(regionID: tallRegion.id))
        assertOverridable(decision, ruleID: .r1SmallChunks)
    }

    func testR1FiresOnMeasureCountAloneAndDoesNotFireWithinLimits() {
        let calendar = makeCalendar()
        let now = makeDate(2026, 1, 5, calendar: calendar)
        let piece = makePiece()
        let shortRegion = PassageRegion(page: 1, x: 0, y: 0, width: 1, height: 0.1)

        let wide = makePassage(pieceID: piece.id, startMeasure: 1, endMeasure: 6, regions: [])
        let wideContext = makeContext(now: now, calendar: calendar, pieces: [piece], passages: [wide])
        let decision = PracticeRulesEngine.evaluateR1SmallChunks(passageID: wide.id, context: wideContext)
        XCTAssertEqual(decision?.reason, "6 measures in one box. Worth splitting.")
        XCTAssertEqual(decision?.outcome, .suggestSplit(regionID: nil))

        let small = makePassage(pieceID: piece.id, startMeasure: 1, endMeasure: 3, regions: [shortRegion])
        let smallContext = makeContext(now: now, calendar: calendar, pieces: [piece], passages: [small])
        XCTAssertNil(PracticeRulesEngine.evaluateR1SmallChunks(passageID: small.id, context: smallContext))
    }

    // MARK: - R2 join the seams

    func testR2OffersJoinOnlyForAdjacentReviewPassages() {
        let calendar = makeCalendar()
        let now = makeDate(2026, 1, 5, calendar: calendar)
        let piece = makePiece()
        let a = makePassage(pieceID: piece.id, learningState: .review, startMeasure: 1, endMeasure: 4)
        let b = makePassage(pieceID: piece.id, learningState: .review, startMeasure: 5, endMeasure: 8)
        // Measure-adjacent to `b` but not in Review: must not be offered.
        let wrongState = makePassage(pieceID: piece.id, learningState: .learning, startMeasure: 9, endMeasure: 11)
        // Same piece, Review, but with a gap: must not be offered.
        let farAway = makePassage(pieceID: piece.id, learningState: .review, startMeasure: 20, endMeasure: 22)
        let passages = [a, b, wrongState, farAway]
        let context = makeContext(now: now, calendar: calendar, pieces: [piece], passages: passages)

        let decisions = PracticeRulesEngine.evaluateR2JoinSeams(pieceID: piece.id, context: context)
        XCTAssertEqual(decisions.count, 1)
        let decision = try! XCTUnwrap(decisions.first)
        XCTAssertEqual(decision.outcome, .suggestJoin(passageIDs: [a.id, b.id]))
        XCTAssertTrue(decision.reason.contains(a.measureLabel) && decision.reason.contains(b.measureLabel))
        assertOverridable(decision, ruleID: .r2JoinSeams)
    }

    // MARK: - R3 cold attempt

    func testR3GradesFirstAttemptOfDayAndBlocksASecond() throws {
        let calendar = makeCalendar()
        let now = makeDate(2026, 1, 5, 9, 0, calendar: calendar)
        let piece = makePiece()
        let passage = makePassage(pieceID: piece.id)
        var settings = RuleSettings()
        settings.r4Enabled = false // isolate R3 from R4's own schedule math here
        let context = makeContext(now: now, calendar: calendar, settings: settings, pieces: [piece], passages: [passage])

        XCTAssertTrue(PracticeRulesEngine.isColdAttemptEligible(passageID: passage.id, context: context))
        let application = try XCTUnwrap(PracticeRulesEngine.applyColdGrade(passageID: passage.id, grade: .clean, tempo: 90, context: context))
        XCTAssertEqual(application.decisions.count, 1)
        let r3 = application.decisions[0]
        XCTAssertEqual(r3.ruleID, .r3ColdAttempt)
        XCTAssertEqual(r3.reason, "First attempt today: graded Clean.")
        assertOverridable(r3, ruleID: .r3ColdAttempt)

        // A second attempt later the same day is no longer a cold attempt.
        let laterSameDay = makeContext(now: now.addingTimeInterval(3600), calendar: calendar, settings: settings,
                                        pieces: [piece], passages: [passage], coldGrades: [application.record])
        XCTAssertFalse(PracticeRulesEngine.isColdAttemptEligible(passageID: passage.id, context: laterSameDay))
        XCTAssertNil(PracticeRulesEngine.applyColdGrade(passageID: passage.id, grade: .clean, tempo: 90, context: laterSameDay))

        // Disabled outright.
        var disabled = settings
        disabled.r3Enabled = false
        let disabledContext = makeContext(now: now, calendar: calendar, settings: disabled, pieces: [piece], passages: [passage])
        XCTAssertNil(PracticeRulesEngine.applyColdGrade(passageID: passage.id, grade: .clean, tempo: 90, context: disabledContext))
    }

    // MARK: - R4 spaced review

    func testR4CleanClimbsLadderAndGraduatesToReviewAtThirdRung() throws {
        let calendar = makeCalendar()
        let piece = makePiece()
        var passage = makePassage(pieceID: piece.id, learningState: .new)
        let settings = RuleSettings()

        // Rung 1: New -> Learning, 1 day (singular copy).
        let now1 = makeDate(2026, 1, 5, calendar: calendar)
        let context1 = makeContext(now: now1, calendar: calendar, settings: settings, pieces: [piece], passages: [passage])
        let app1 = try XCTUnwrap(PracticeRulesEngine.applyColdGrade(passageID: passage.id, grade: .clean, tempo: 90, context: context1))
        XCTAssertEqual(app1.newLearningState, .learning)
        XCTAssertEqual(app1.newSchedule.intervalDays, 1)
        XCTAssertEqual(app1.newSchedule.reviewStep, 1)
        XCTAssertEqual(app1.newSchedule.dueDate, calendar.startOfDay(afterAdding: 1, to: now1))
        XCTAssertEqual(app1.decisions.last?.reason, "Clean. Next review in 1 day.")
        assertOverridable(try XCTUnwrap(app1.decisions.last), ruleID: .r4SpacedReview)
        passage.learningState = app1.newLearningState; passage.schedule = app1.newSchedule

        // Rung 2: still Learning, 3 days.
        let now2 = makeDate(2026, 1, 6, calendar: calendar)
        let context2 = makeContext(now: now2, calendar: calendar, settings: settings, pieces: [piece], passages: [passage],
                                    coldGrades: [app1.record])
        let app2 = try XCTUnwrap(PracticeRulesEngine.applyColdGrade(passageID: passage.id, grade: .clean, tempo: 90, context: context2))
        XCTAssertEqual(app2.newLearningState, .learning)
        XCTAssertEqual(app2.newSchedule.intervalDays, 3)
        XCTAssertEqual(app2.decisions.last?.reason, "Clean. Next review in 3 days.")
        passage.learningState = app2.newLearningState; passage.schedule = app2.newSchedule

        // Rung 3: graduates to Review, 7 days.
        let now3 = makeDate(2026, 1, 9, calendar: calendar)
        let context3 = makeContext(now: now3, calendar: calendar, settings: settings, pieces: [piece], passages: [passage],
                                    coldGrades: [app1.record, app2.record])
        let app3 = try XCTUnwrap(PracticeRulesEngine.applyColdGrade(passageID: passage.id, grade: .clean, tempo: 90, context: context3))
        XCTAssertEqual(app3.newLearningState, .review)
        XCTAssertEqual(app3.newSchedule.intervalDays, 7)
        XCTAssertEqual(app3.decisions.last?.reason, "Clean. Next review in 7 days.")
    }

    func testR4ShakyKeepsLadderPositionAndReschedulesSoon() throws {
        let calendar = makeCalendar()
        let now = makeDate(2026, 1, 5, calendar: calendar)
        let piece = makePiece()
        let passage = makePassage(pieceID: piece.id, learningState: .review,
                                   schedule: PassageSchedule(dueDate: nil, intervalDays: 7, reviewStep: 3))
        let context = makeContext(now: now, calendar: calendar, pieces: [piece], passages: [passage])
        let app = try XCTUnwrap(PracticeRulesEngine.applyColdGrade(passageID: passage.id, grade: .shaky, tempo: 90, context: context))
        XCTAssertEqual(app.newLearningState, .review)
        XCTAssertEqual(app.newSchedule.reviewStep, 3, "Shaky is a quick recheck, not a ladder reset")
        XCTAssertEqual(app.newSchedule.intervalDays, 2)
        XCTAssertEqual(app.newSchedule.dueDate, calendar.startOfDay(afterAdding: 2, to: now))
        XCTAssertEqual(app.decisions.last?.reason, "Shaky. Review in 2 days.")

        // Singular copy at a custom 1-day shaky interval.
        var singularSettings = RuleSettings(); singularSettings.r4ShakyIntervalDays = 1
        let singularContext = makeContext(now: now, calendar: calendar, settings: singularSettings, pieces: [piece], passages: [passage])
        let singular = try XCTUnwrap(PracticeRulesEngine.applyColdGrade(passageID: passage.id, grade: .shaky, tempo: 90, context: singularContext))
        XCTAssertEqual(singular.decisions.last?.reason, "Shaky. Review in 1 day.")
    }

    func testR4MissedFallsBackToLearningDueTomorrow() throws {
        let calendar = makeCalendar()
        let now = makeDate(2026, 1, 5, calendar: calendar)
        let piece = makePiece()
        let passage = makePassage(pieceID: piece.id, learningState: .review,
                                   schedule: PassageSchedule(dueDate: nil, intervalDays: 14, reviewStep: 3))
        let context = makeContext(now: now, calendar: calendar, pieces: [piece], passages: [passage])
        let app = try XCTUnwrap(PracticeRulesEngine.applyColdGrade(passageID: passage.id, grade: .missed, tempo: 90, context: context))
        XCTAssertEqual(app.newLearningState, .learning)
        XCTAssertEqual(app.newSchedule, PassageSchedule(dueDate: calendar.startOfDay(afterAdding: 1, to: now), intervalDays: 1, reviewStep: 0))
        XCTAssertEqual(app.decisions.last?.reason, "Missed. Back to Learning, due tomorrow.")
        assertOverridable(try XCTUnwrap(app.decisions.last), ruleID: .r4SpacedReview)
    }

    // MARK: - R5 streak goal by state

    func testR5StreakTargetByLearningState() throws {
        let calendar = makeCalendar()
        let now = makeDate(2026, 1, 5, calendar: calendar)
        let piece = makePiece()
        let learning = makePassage(pieceID: piece.id, learningState: .learning)
        let review = makePassage(pieceID: piece.id, learningState: .review)
        let context = makeContext(now: now, calendar: calendar, pieces: [piece], passages: [learning, review])

        let learningDecision = try XCTUnwrap(PracticeRulesEngine.evaluateR5StreakTarget(passageID: learning.id, context: context))
        XCTAssertEqual(learningDecision.reason, "Learning: streak to 5.")
        XCTAssertEqual(learningDecision.outcome, .streakTarget(5))
        assertOverridable(learningDecision, ruleID: .r5StreakGoal)

        let reviewDecision = try XCTUnwrap(PracticeRulesEngine.evaluateR5StreakTarget(passageID: review.id, context: context))
        XCTAssertEqual(reviewDecision.reason, "Review: streak to 3.")
        XCTAssertEqual(reviewDecision.outcome, .streakTarget(3))

        XCTAssertEqual(PracticeRulesEngine.r5StreakTarget(for: .new, settings: RuleSettings()), 5)
        XCTAssertEqual(PracticeRulesEngine.r5StreakTarget(for: .performanceReady, settings: RuleSettings()), 3)
    }

    func testR5StreakEffectMapsVerdictsIncludingAgainNeutral() {
        XCTAssertEqual(PracticeRulesEngine.r5StreakEffect(for: .clean), .increments)
        XCTAssertEqual(PracticeRulesEngine.r5StreakEffect(for: .sloppy), .resets)
        XCTAssertEqual(PracticeRulesEngine.r5StreakEffect(for: .reset), .resets)
        XCTAssertEqual(PracticeRulesEngine.r5StreakEffect(for: .again), .neutral, "§11 R5: Again is neutral")
    }

    // MARK: - R6 slow down

    func testR6FiresAfterThreeUnderHalfResetsWithAgainNeutral() throws {
        let calendar = makeCalendar()
        let now = makeDate(2026, 1, 5, calendar: calendar)
        let piece = makePiece()
        let passage = makePassage(pieceID: piece.id)
        let configuration = makeConfiguration(pieceID: piece.id, passageID: passage.id, targetCount: 10, startBPM: 100, tempoStep: .fixed(4))
        // clean(streak1), sloppy(peak1), again(neutral — must not break the run), sloppy(peak0), reset(peak0).
        let attempts = [attempt(.clean), attempt(.sloppy), attempt(.again), attempt(.sloppy), attempt(.reset)]
        let set = makeSet(configuration: configuration, attempts: attempts, startedAt: now)
        let context = makeContext(now: now, calendar: calendar, pieces: [piece], passages: [passage])

        let decision = try XCTUnwrap(PracticeRulesEngine.evaluateR6SlowDown(set: set, context: context))
        XCTAssertEqual(decision.reason, "3 resets under half the goal. Down to 96.")
        XCTAssertEqual(decision.outcome, .tempoChange(newBPM: 96))
        assertOverridable(decision, ruleID: .r6SlowDown)
    }

    func testR6DoesNotFireBelowThresholdOrAtOrAboveHalf() {
        let calendar = makeCalendar()
        let now = makeDate(2026, 1, 5, calendar: calendar)
        let piece = makePiece()
        let passage = makePassage(pieceID: piece.id)
        let configuration = makeConfiguration(pieceID: piece.id, passageID: passage.id, targetCount: 10, startBPM: 100)
        let context = makeContext(now: now, calendar: calendar, pieces: [piece], passages: [passage])

        let tooFew = makeSet(configuration: configuration, attempts: [attempt(.sloppy), attempt(.sloppy)], startedAt: now)
        XCTAssertNil(PracticeRulesEngine.evaluateR6SlowDown(set: tooFew, context: context))

        // Third peak (5) is not under half of the 10-goal: must not fire.
        let atHalf = makeSet(configuration: configuration, attempts: [
            attempt(.sloppy), attempt(.sloppy),
            attempt(.clean), attempt(.clean), attempt(.clean), attempt(.clean), attempt(.clean),
            attempt(.sloppy)
        ], startedAt: now)
        XCTAssertNil(PracticeRulesEngine.evaluateR6SlowDown(set: atHalf, context: context))
    }

    func testR6UsesEachAttemptsOwnStageGoal() throws {
        let calendar = makeCalendar()
        let now = makeDate(2026, 1, 5, calendar: calendar)
        let piece = makePiece()
        let passage = makePassage(pieceID: piece.id)
        // Stage 0's goal (2) is much smaller than stage 1's (20): a replay that used one constant
        // goal for the whole history would either miss stage 0's real graduation or judge stage 1's
        // peaks against the wrong half. Each peak here (1 out of 20) is nowhere near half of its own
        // stage's goal, so this should fire — proving per-attempt stage attribution, not a specific
        // pre-fix crash or wrong number.
        let stages = [VariantStage(name: "Dotted", targetCount: 2), VariantStage(name: "Straight", targetCount: 20)]
        let configuration = makeConfiguration(pieceID: piece.id, passageID: passage.id, startBPM: 100, tempoStep: .fixed(4), stages: stages)
        let attempts = [
            attempt(.clean, stageIndex: 0), attempt(.clean, stageIndex: 0), // reaches stage 0's goal (2) -> graduates
            attempt(.clean, stageIndex: 1), attempt(.sloppy, stageIndex: 1),
            attempt(.clean, stageIndex: 1), attempt(.sloppy, stageIndex: 1),
            attempt(.clean, stageIndex: 1), attempt(.sloppy, stageIndex: 1)
        ]
        let set = makeSet(configuration: configuration, attempts: attempts, startedAt: now)
        let context = makeContext(now: now, calendar: calendar, pieces: [piece], passages: [passage])
        let decision = try XCTUnwrap(PracticeRulesEngine.evaluateR6SlowDown(set: set, context: context))
        XCTAssertEqual(decision.outcome, .tempoChange(newBPM: 96))
    }

    // MARK: - R7 speed up

    func testR7SpeedsUpAfterACompletedSetCappedPerDay() throws {
        let calendar = makeCalendar()
        let now = makeDate(2026, 1, 5, calendar: calendar)
        let piece = makePiece()
        let passage = makePassage(pieceID: piece.id, performanceTempo: 130)
        let configuration = makeConfiguration(pieceID: piece.id, passageID: passage.id, targetBPM: 120, tempoStep: .fixed(4))
        let finishedToday = makeSet(configuration: configuration, status: .completed, startedAt: now, currentBPM: 100)

        let context = makeContext(now: now, calendar: calendar, pieces: [piece], passages: [passage], history: [finishedToday])
        let decision = try XCTUnwrap(PracticeRulesEngine.evaluateR7SpeedUp(passageID: passage.id, context: context))
        XCTAssertEqual(decision.reason, "Nice work. Up to 104 next time.")
        XCTAssertEqual(decision.outcome, .tempoChange(newBPM: 104))
        assertOverridable(decision, ruleID: .r7SpeedUp)

        // Two applied increases already today caps the third.
        let events = [
            RuleEvent(ruleID: .r7SpeedUp, passageID: passage.id, reasonText: "x", firedAt: now, overridden: false),
            RuleEvent(ruleID: .r7SpeedUp, passageID: passage.id, reasonText: "x", firedAt: now, overridden: false)
        ]
        let cappedContext = makeContext(now: now, calendar: calendar, pieces: [piece], passages: [passage],
                                         ruleEvents: events, history: [finishedToday])
        XCTAssertNil(PracticeRulesEngine.evaluateR7SpeedUp(passageID: passage.id, context: cappedContext))

        // An overridden (declined) increase never counted against the cap.
        let declinedEvents = [
            RuleEvent(ruleID: .r7SpeedUp, passageID: passage.id, reasonText: "x", firedAt: now, overridden: true),
            RuleEvent(ruleID: .r7SpeedUp, passageID: passage.id, reasonText: "x", firedAt: now, overridden: true)
        ]
        let stillOpenContext = makeContext(now: now, calendar: calendar, pieces: [piece], passages: [passage],
                                            ruleEvents: declinedEvents, history: [finishedToday])
        XCTAssertNotNil(PracticeRulesEngine.evaluateR7SpeedUp(passageID: passage.id, context: stillOpenContext))
    }

    // MARK: - R8 split weak spot

    private func tap(_ passageID: UUID, _ x: Double, _ y: Double) -> BreakPointTap {
        BreakPointTap(passageID: passageID, location: NormalizedRect(x: x, y: y, width: 0, height: 0))
    }

    func testR8OffersSubPassageFromClusteredTapsNotScattered() throws {
        let calendar = makeCalendar()
        let now = makeDate(2026, 1, 5, calendar: calendar)
        let piece = makePiece()
        let passage = makePassage(pieceID: piece.id)

        let clustered = [tap(passage.id, 0.50, 0.50), tap(passage.id, 0.52, 0.50), tap(passage.id, 0.50, 0.52)]
        let clusteredContext = makeContext(now: now, calendar: calendar, pieces: [piece], passages: [passage], breakPointTaps: clustered)
        let decision = try XCTUnwrap(PracticeRulesEngine.evaluateR8SplitWeakSpot(passageID: passage.id, context: clusteredContext))
        XCTAssertEqual(decision.reason, "3 taps land in the same spot. Split it out?")
        guard case let .suggestSubPassage(region) = decision.outcome else { return XCTFail("expected suggestSubPassage") }
        XCTAssertLessThanOrEqual(region.x, 0.50); XCTAssertGreaterThanOrEqual(region.x + region.width, 0.52)
        XCTAssertLessThanOrEqual(region.y, 0.50); XCTAssertGreaterThanOrEqual(region.y + region.height, 0.52)
        assertOverridable(decision, ruleID: .r8SplitWeakSpot)

        let scattered = [tap(passage.id, 0.1, 0.1), tap(passage.id, 0.9, 0.9), tap(passage.id, 0.1, 0.9)]
        let scatteredContext = makeContext(now: now, calendar: calendar, pieces: [piece], passages: [passage], breakPointTaps: scattered)
        XCTAssertNil(PracticeRulesEngine.evaluateR8SplitWeakSpot(passageID: passage.id, context: scatteredContext))
    }

    /// Regression for the fix that clamps `r8TapsToOfferSplit` to at least 1: zero (or negative)
    /// evidence must never reach the bounding-box math's forced unwraps.
    func testR8NeverFiresOffZeroEvidenceWithAMisconfiguredThreshold() {
        let calendar = makeCalendar()
        let now = makeDate(2026, 1, 5, calendar: calendar)
        let piece = makePiece()
        let passage = makePassage(pieceID: piece.id)
        for threshold in [0, -5] {
            var settings = RuleSettings(); settings.r8TapsToOfferSplit = threshold
            let context = makeContext(now: now, calendar: calendar, settings: settings, pieces: [piece], passages: [passage], breakPointTaps: [])
            XCTAssertNil(PracticeRulesEngine.evaluateR8SplitWeakSpot(passageID: passage.id, context: context))
        }
    }

    // MARK: - R9 stop grinding

    func testR9ParksAfterConsecutiveSetsWithoutProgress() throws {
        let calendar = makeCalendar()
        let now = makeDate(2026, 1, 5, calendar: calendar)
        let piece = makePiece()
        let passage = makePassage(pieceID: piece.id)
        let configuration = makeConfiguration(pieceID: piece.id, passageID: passage.id, startBPM: 100)
        let noProgress = (0..<3).map { _ in makeSet(configuration: configuration, status: .ended, startedAt: now, currentBPM: 100, activeSeconds: 30) }
        let context = makeContext(now: now, calendar: calendar, pieces: [piece], passages: [passage], history: noProgress)
        let decision = try XCTUnwrap(PracticeRulesEngine.evaluateR9StopGrinding(passageID: passage.id, context: context))
        XCTAssertEqual(decision.reason, "3 sets, no progress. Back tomorrow.")
        XCTAssertEqual(decision.outcome, .park(until: calendar.startOfDay(afterAdding: 1, to: now)))
        assertOverridable(decision, ruleID: .r9StopGrinding)

        // Progress on the most recent set breaks the "in a row" count.
        var progressed = noProgress
        progressed[2].status = .completed
        let progressedContext = makeContext(now: now, calendar: calendar, pieces: [piece], passages: [passage], history: progressed)
        XCTAssertNil(PracticeRulesEngine.evaluateR9StopGrinding(passageID: passage.id, context: progressedContext))
    }

    func testR9ParksAfterTimeBudgetExceeded() throws {
        let calendar = makeCalendar()
        let now = makeDate(2026, 1, 5, calendar: calendar)
        let piece = makePiece()
        let passage = makePassage(pieceID: piece.id)
        let configuration = makeConfiguration(pieceID: piece.id, passageID: passage.id, startBPM: 100)
        // A single completed (progressed) set, but over the time budget: overTime alone still fires.
        let long = makeSet(configuration: configuration, status: .completed, startedAt: now, currentBPM: 100, activeSeconds: 700)
        let context = makeContext(now: now, calendar: calendar, pieces: [piece], passages: [passage], history: [long])
        let decision = try XCTUnwrap(PracticeRulesEngine.evaluateR9StopGrinding(passageID: passage.id, context: context))
        XCTAssertEqual(decision.reason, "10 minutes on this today. Back tomorrow.")

        // Singular copy at a custom 1-minute budget.
        var singularSettings = RuleSettings(); singularSettings.r9Minutes = 1
        let short = makeSet(configuration: configuration, status: .completed, startedAt: now, currentBPM: 100, activeSeconds: 70)
        let singularContext = makeContext(now: now, calendar: calendar, settings: singularSettings, pieces: [piece], passages: [passage], history: [short])
        let singularDecision = try XCTUnwrap(PracticeRulesEngine.evaluateR9StopGrinding(passageID: passage.id, context: singularContext))
        XCTAssertEqual(singularDecision.reason, "1 minute on this today. Back tomorrow.")
    }

    // MARK: - R10 performance-ready

    func testR10FiresOnThreeDistinctCleanDaysAtTempo() throws {
        let calendar = makeCalendar()
        let now = makeDate(2026, 1, 5, calendar: calendar)
        let piece = makePiece()
        let passage = makePassage(pieceID: piece.id, performanceTempo: 120)
        let grades = [
            ColdGradeRecord(passageID: passage.id, date: makeDate(2026, 1, 1, calendar: calendar), grade: .clean, tempo: 120),
            ColdGradeRecord(passageID: passage.id, date: makeDate(2026, 1, 2, calendar: calendar), grade: .clean, tempo: 122),
            ColdGradeRecord(passageID: passage.id, date: makeDate(2026, 1, 3, calendar: calendar), grade: .clean, tempo: 125)
        ]
        let context = makeContext(now: now, calendar: calendar, pieces: [piece], passages: [passage], coldGrades: grades)
        let decision = try XCTUnwrap(PracticeRulesEngine.evaluateR10PerformanceReady(passageID: passage.id, context: context))
        XCTAssertEqual(decision.reason, "Clean at tempo on 3 different days. Performance-ready.")
        XCTAssertEqual(decision.outcome, .performanceReady)
        assertOverridable(decision, ruleID: .r10PerformanceReady)

        let onlyTwoDays = makeContext(now: now, calendar: calendar, pieces: [piece], passages: [passage], coldGrades: Array(grades.prefix(2)))
        XCTAssertNil(PracticeRulesEngine.evaluateR10PerformanceReady(passageID: passage.id, context: onlyTwoDays))
    }

    func testR10RequiresFirstOfDayWhenConfigured() {
        let calendar = makeCalendar()
        let now = makeDate(2026, 1, 5, calendar: calendar)
        let piece = makePiece()
        let passage = makePassage(pieceID: piece.id, performanceTempo: 120)
        let days = [makeDate(2026, 1, 1, 14, 0, calendar: calendar), makeDate(2026, 1, 2, 14, 0, calendar: calendar), makeDate(2026, 1, 3, 14, 0, calendar: calendar)]
        let grades = days.map { ColdGradeRecord(passageID: passage.id, date: $0, grade: .clean, tempo: 120) }
        // An earlier same-day attempt on every qualifying day means none of them was "first".
        let earlierSets = days.map { day -> ActiveSet in
            let configuration = makeConfiguration(pieceID: piece.id, passageID: passage.id, startBPM: 100)
            var set = makeSet(configuration: configuration, startedAt: day.addingTimeInterval(-7200))
            set.attempts = [Attempt(verdict: .clean, date: day.addingTimeInterval(-7200), bpm: 90)]
            return set
        }

        let requiring = makeContext(now: now, calendar: calendar, pieces: [piece], passages: [passage], coldGrades: grades, history: earlierSets)
        XCTAssertNil(PracticeRulesEngine.evaluateR10PerformanceReady(passageID: passage.id, context: requiring))

        var relaxed = RuleSettings(); relaxed.r10RequiresFirstInSession = false
        let notRequiring = makeContext(now: now, calendar: calendar, settings: relaxed, pieces: [piece], passages: [passage],
                                        coldGrades: grades, history: earlierSets)
        XCTAssertNotNil(PracticeRulesEngine.evaluateR10PerformanceReady(passageID: passage.id, context: notRequiring))
    }

    // MARK: - R11 performance date

    func testR11FlagsFinalWeekWithSingularDayCopy() throws {
        let calendar = makeCalendar()
        let piece = makePiece(performanceDates: [makeDate(2026, 1, 15, calendar: calendar)])
        let ready = makePassage(pieceID: piece.id, learningState: .performanceReady)
        let notReady = makePassage(pieceID: piece.id, learningState: .review)
        let passages = [ready, notReady]

        let oneDayOut = makeContext(now: makeDate(2026, 1, 14, calendar: calendar), calendar: calendar, pieces: [piece], passages: passages)
        let decision = try XCTUnwrap(PracticeRulesEngine.evaluateR11PerformanceDate(pieceID: piece.id, context: oneDayOut))
        XCTAssertEqual(decision.reason, "1 day out. 1 passage not performance-ready.")
        XCTAssertEqual(decision.outcome, .performanceCaps(cappedIntervalDays: 1, includeRunThroughs: true,
                                                            notReadyPassageIDs: [notReady.id], inFinalWeek: true))
        assertOverridable(decision, ruleID: .r11PerformanceDate)

        // Exactly on the final-week boundary (7 days out): still the final week.
        let boundary = makeContext(now: makeDate(2026, 1, 8, calendar: calendar), calendar: calendar, pieces: [piece], passages: passages)
        let boundaryDecision = try XCTUnwrap(PracticeRulesEngine.evaluateR11PerformanceDate(pieceID: piece.id, context: boundary))
        XCTAssertEqual(boundaryDecision.reason, "7 days out. 1 passage not performance-ready.")
    }

    func testR11CapsIntervalsInTheTwoWeeksBeforeFinalWeek() throws {
        let calendar = makeCalendar()
        let piece = makePiece(performanceDates: [makeDate(2026, 1, 15, calendar: calendar)])
        let context = makeContext(now: makeDate(2026, 1, 5, calendar: calendar), calendar: calendar, pieces: [piece])
        let decision = try XCTUnwrap(PracticeRulesEngine.evaluateR11PerformanceDate(pieceID: piece.id, context: context))
        XCTAssertEqual(decision.reason, "Two weeks out. Run-throughs added; reviews capped at 3 days.")
        XCTAssertEqual(decision.outcome, .performanceCaps(cappedIntervalDays: 3, includeRunThroughs: true,
                                                            notReadyPassageIDs: [], inFinalWeek: false))
    }

    func testR11DoesNotFireBeyondTwoWeeksOrWithNoUpcomingDate() {
        let calendar = makeCalendar()
        let piece = makePiece(performanceDates: [makeDate(2026, 1, 15, calendar: calendar)])
        let tooFar = makeContext(now: makeDate(2025, 12, 31, calendar: calendar), calendar: calendar, pieces: [piece])
        XCTAssertNil(PracticeRulesEngine.evaluateR11PerformanceDate(pieceID: piece.id, context: tooFar))

        let noDate = makePiece(performanceDates: [])
        let context = makeContext(now: makeDate(2026, 1, 5, calendar: calendar), calendar: calendar, pieces: [noDate])
        XCTAssertNil(PracticeRulesEngine.evaluateR11PerformanceDate(pieceID: noDate.id, context: context))
    }

    // MARK: - R12 variants when stuck

    func testR12SuggestsVariantsAfterTwoAppliedSlowDownsToday() throws {
        let calendar = makeCalendar()
        let now = makeDate(2026, 1, 5, calendar: calendar)
        let piece = makePiece()
        let passage = makePassage(pieceID: piece.id)
        let events = [
            RuleEvent(ruleID: .r6SlowDown, passageID: passage.id, reasonText: "x", firedAt: now, overridden: false),
            RuleEvent(ruleID: .r6SlowDown, passageID: passage.id, reasonText: "x", firedAt: now, overridden: false)
        ]
        let context = makeContext(now: now, calendar: calendar, pieces: [piece], passages: [passage], ruleEvents: events)
        let decision = try XCTUnwrap(PracticeRulesEngine.evaluateR12VariantsWhenStuck(passageID: passage.id, context: context))
        XCTAssertEqual(decision.reason, "Two slow-downs today. Try a variant chain.")
        XCTAssertEqual(decision.outcome, .suggestVariants)
        assertOverridable(decision, ruleID: .r12VariantsWhenStuck)

        let notEnough = [RuleEvent(ruleID: .r6SlowDown, passageID: passage.id, reasonText: "x", firedAt: now, overridden: false),
                          RuleEvent(ruleID: .r6SlowDown, passageID: passage.id, reasonText: "x", firedAt: now, overridden: true)]
        let notEnoughContext = makeContext(now: now, calendar: calendar, pieces: [piece], passages: [passage], ruleEvents: notEnough)
        XCTAssertNil(PracticeRulesEngine.evaluateR12VariantsWhenStuck(passageID: passage.id, context: notEnoughContext))
    }

    // MARK: - R13 parts separately

    func testR13SuggestsPartsAfterConsecutiveMissedColdAttempts() throws {
        let calendar = makeCalendar()
        let now = makeDate(2026, 1, 5, calendar: calendar)
        let instrument = Instrument(family: .keyboard, name: "Piano")
        let piece = makePiece(instrumentID: instrument.id)
        let passage = makePassage(pieceID: piece.id)
        let grades = [
            ColdGradeRecord(passageID: passage.id, date: makeDate(2026, 1, 3, calendar: calendar), grade: .missed, tempo: 60),
            ColdGradeRecord(passageID: passage.id, date: makeDate(2026, 1, 4, calendar: calendar), grade: .missed, tempo: 60)
        ]
        let context = makeContext(now: now, calendar: calendar, pieces: [piece], passages: [passage], instruments: [instrument], coldGrades: grades)
        let decision = try XCTUnwrap(PracticeRulesEngine.evaluateR13PartsSeparately(passageID: passage.id, context: context))
        XCTAssertEqual(decision.reason, "2 missed cold attempts in a row. Try Right hand instead?")
        XCTAssertEqual(decision.outcome, .suggestParts("Right hand"))
        assertOverridable(decision, ruleID: .r13PartsSeparately)

        // A family with nothing beyond "Full" never fires, even with the same streak.
        let otherInstrument = Instrument(family: .other, name: "Theremin")
        let otherPiece = makePiece(instrumentID: otherInstrument.id)
        let otherPassage = makePassage(pieceID: otherPiece.id)
        let otherGrades = grades.map { ColdGradeRecord(passageID: otherPassage.id, date: $0.date, grade: .missed, tempo: 60) }
        let otherContext = makeContext(now: now, calendar: calendar, pieces: [otherPiece], passages: [otherPassage],
                                        instruments: [otherInstrument], coldGrades: otherGrades)
        XCTAssertNil(PracticeRulesEngine.evaluateR13PartsSeparately(passageID: otherPassage.id, context: otherContext))
    }

    // MARK: - R14 pulse check

    func testR14PulseCheckPlanNearPerformanceTempo() throws {
        let calendar = makeCalendar()
        let now = makeDate(2026, 1, 5, calendar: calendar)
        let piece = makePiece()
        let passage = makePassage(pieceID: piece.id, performanceTempo: 120)
        let configuration = makeConfiguration(pieceID: piece.id, passageID: passage.id, startBPM: 110)
        let near = makeSet(configuration: configuration, startedAt: now, currentBPM: 110) // 110 >= 120 * 0.9
        let context = makeContext(now: now, calendar: calendar, pieces: [piece], passages: [passage])

        XCTAssertTrue(PracticeRulesEngine.isPulseCheckEligible(set: near, context: context))
        let decision = try XCTUnwrap(PracticeRulesEngine.evaluateR14PulseCheck(set: near, context: context))
        XCTAssertEqual(decision.reason, "Near tempo. Metronome drops out for 2 bars.")
        XCTAssertEqual(decision.outcome, .pulseCheck(PulseCheckPlan(leadInBars: 4, silentBars: 2, recoveryBars: 2)))
        assertOverridable(decision, ruleID: .r14PulseCheck)

        let far = makeSet(configuration: configuration, startedAt: now, currentBPM: 90)
        XCTAssertFalse(PracticeRulesEngine.isPulseCheckEligible(set: far, context: context))
        XCTAssertNil(PracticeRulesEngine.evaluateR14PulseCheck(set: far, context: context))

        var singularSettings = RuleSettings(); singularSettings.r14DropoutBars = 1
        let singularContext = makeContext(now: now, calendar: calendar, settings: singularSettings, pieces: [piece], passages: [passage])
        let singular = try XCTUnwrap(PracticeRulesEngine.evaluateR14PulseCheck(set: near, context: singularContext))
        XCTAssertEqual(singular.reason, "Near tempo. Metronome drops out for 1 bar.")
    }

    // MARK: - §10a default set configuration

    func test10aDefaultConfigurationCarriesForwardAndFoldsInRules() throws {
        let calendar = makeCalendar()
        let now = makeDate(2026, 1, 5, calendar: calendar)
        let piece = makePiece()
        let passage = makePassage(pieceID: piece.id, learningState: .review, performanceTempo: 130)
        let lastConfiguration = makeConfiguration(pieceID: piece.id, passageID: passage.id, targetBPM: 125, tempoStep: .percent(5),
                                                    goal: .notesAndAccuracy, basis: .totalPlays, hands: "Right hand")
        let lastSet = makeSet(configuration: lastConfiguration, status: .completed, startedAt: now, currentBPM: 120)
        let context = makeContext(now: now, calendar: calendar, pieces: [piece], passages: [passage], history: [lastSet])

        let result = try XCTUnwrap(PracticeRulesEngine.defaultConfiguration(for: passage.id, context: context))
        let expected = PracticeConfiguration(pieceID: piece.id, passageID: passage.id, focus: "Pulse", goal: .notesAndAccuracy,
                                              basis: .totalPlays, targetCount: 3, startBPM: 126, targetBPM: 126,
                                              tempoStep: .percent(5), hands: "Right hand", useMetronome: false)
        XCTAssertEqual(result, expected, "carries goal/basis/tempoStep/hands forward, applies R5's Review target, folds in R7's speed-up, and turns the click off for a non-tempo goal")
    }

    // MARK: - §10c next-step line

    func test10cNextStepLinePicksHighestPriorityRule() throws {
        let calendar = makeCalendar()
        let now = makeDate(2026, 1, 5, calendar: calendar)
        let piece = makePiece()
        // Qualifies for both R9 (over the time budget) and R7 (a completed set below performance tempo):
        // R9 must win, since it is checked first.
        let passage = makePassage(pieceID: piece.id, performanceTempo: 130)
        let configuration = makeConfiguration(pieceID: piece.id, passageID: passage.id, targetBPM: 125, tempoStep: .fixed(4))
        let set = makeSet(configuration: configuration, status: .completed, startedAt: now, currentBPM: 120, activeSeconds: 700)
        let context = makeContext(now: now, calendar: calendar, pieces: [piece], passages: [passage], history: [set])

        XCTAssertNotNil(PracticeRulesEngine.evaluateR7SpeedUp(passageID: passage.id, context: context), "sanity: R7 would also fire here")
        let line = PracticeRulesEngine.nextStepLine(afterSet: set, context: context)
        XCTAssertEqual(line.ruleID, .r9StopGrinding)
    }

    func test10cNextStepLineFallsBackWhenNothingFires() {
        let calendar = makeCalendar()
        let now = makeDate(2026, 1, 5, calendar: calendar)
        let piece = makePiece()
        let passage = makePassage(pieceID: piece.id)
        let configuration = makeConfiguration(pieceID: piece.id, passageID: passage.id)
        let context = makeContext(now: now, calendar: calendar, pieces: [piece], passages: [passage])

        let completed = makeSet(configuration: configuration, status: .completed, startedAt: now, currentBPM: 100)
        XCTAssertEqual(PracticeRulesEngine.nextStepLine(afterSet: completed, context: context).reason, "Nice work. See you next time.")

        let ended = makeSet(configuration: configuration, status: .ended, startedAt: now, currentBPM: 100)
        XCTAssertEqual(PracticeRulesEngine.nextStepLine(afterSet: ended, context: context).reason, "Ended early. Picks up where you left off.")

        let noPassageConfiguration = makeConfiguration(pieceID: piece.id, passageID: nil)
        let noPassageSet = makeSet(configuration: noPassageConfiguration, status: .completed, startedAt: now)
        XCTAssertEqual(PracticeRulesEngine.nextStepLine(afterSet: noPassageSet, context: context).reason, "Set complete.")
    }

    // MARK: - R15 session builder

    func testR15SessionBuilderOrdersItemsAndCapsNewPassages() {
        let calendar = makeCalendar()
        let now = makeDate(2026, 1, 10, 12, 0, calendar: calendar)
        let piece1 = makePiece()
        let piece2 = makePiece(performanceDates: [makeDate(2026, 1, 20, 15, 0, calendar: calendar)]) // 10 days out

        let due = PassageSchedule(dueDate: now.addingTimeInterval(-3600), intervalDays: 7, reviewStep: 2)
        let review1 = makePassage(pieceID: piece1.id, learningState: .review, schedule: due)
        let learning1 = makePassage(pieceID: piece1.id, learningState: .learning, schedule: due)
        let review2 = makePassage(pieceID: piece2.id, learningState: .review, schedule: due)
        let newPassages = (1...5).map { day in
            makePassage(pieceID: piece1.id, learningState: .new, createdAt: makeDate(2026, 1, day, calendar: calendar))
        }
        let warmup = WarmupExercise(kind: .scale, key: "C", name: "C major scale")

        let context = makeContext(now: now, calendar: calendar, pieces: [piece1, piece2],
                                   passages: [review1, learning1, review2] + newPassages, warmupExercises: [warmup])
        let plan = PracticeRulesEngine.buildSession(availableMinutes: 1000, context: context)

        XCTAssertEqual(plan.items.map(\.kind), [.warmup, .review, .review, .learning, .new, .new, .new, .runThrough])
        XCTAssertEqual(plan.items[0].reason, "Never in rotation yet.")
        // The piece with a nearer performance date is reviewed first.
        XCTAssertEqual(plan.items[1].passageID, review2.id)
        XCTAssertEqual(plan.items[2].passageID, review1.id)
        XCTAssertEqual(plan.items[3].passageID, learning1.id)
        // Only the three oldest new passages made the cut, oldest first.
        XCTAssertEqual(Array(plan.items[4...6]).map(\.passageID), newPassages.prefix(3).map { $0.id })
        let includedIDs = Set(plan.items.compactMap(\.passageID))
        XCTAssertFalse(includedIDs.contains(newPassages[3].id))
        XCTAssertFalse(includedIDs.contains(newPassages[4].id))
        // Skipped passages are untouched — still new, still due whenever they were.
        XCTAssertEqual(newPassages[3].learningState, .new)

        let runThrough = plan.items[7]
        XCTAssertEqual(runThrough.pieceID, piece2.id)
        XCTAssertNil(runThrough.passageID)
        XCTAssertEqual(runThrough.reason, "10 days out. Run it through.")
        XCTAssertEqual(runThrough.estimatedMinutes, PracticeRulesEngine.runThroughMinutesMultiplier * 3)
    }

    func testR15SessionBuilderRespectsMinutesBudgetAndCanBeDisabled() {
        let calendar = makeCalendar()
        let now = makeDate(2026, 1, 10, calendar: calendar)
        let piece = makePiece()
        let due = PassageSchedule(dueDate: now.addingTimeInterval(-3600), intervalDays: 7, reviewStep: 2)
        let review = makePassage(pieceID: piece.id, learningState: .review, schedule: due)
        let warmup = WarmupExercise(kind: .scale, key: "C", name: "C major scale")
        let context = makeContext(now: now, calendar: calendar, pieces: [piece], passages: [review], warmupExercises: [warmup])

        let tight = PracticeRulesEngine.buildSession(availableMinutes: 5, context: context)
        XCTAssertEqual(tight.items.map(\.kind), [.warmup])
        XCTAssertEqual(tight.totalEstimatedMinutes, 3)

        XCTAssertEqual(PracticeRulesEngine.buildSession(availableMinutes: 0, context: context).items, [])

        var disabled = RuleSettings(); disabled.r15Enabled = false
        let disabledContext = makeContext(now: now, calendar: calendar, settings: disabled, pieces: [piece], passages: [review], warmupExercises: [warmup])
        XCTAssertEqual(PracticeRulesEngine.buildSession(availableMinutes: 100, context: disabledContext).items, [])
    }

    // MARK: - Edge cases: day boundaries, time zones, DST

    func testDayBoundaryRespectsInjectedTimeZoneNotUTC() {
        let calendar = makeCalendar()
        let piece = makePiece()
        let passage = makePassage(pieceID: piece.id)

        // Same local calendar day (Jan 15), ~23 hours apart: not a new cold attempt.
        let earlyThatDay = ColdGradeRecord(passageID: passage.id, date: makeDate(2026, 1, 15, 0, 15, calendar: calendar), grade: .clean, tempo: 90)
        let lateSameLocalDay = makeContext(now: makeDate(2026, 1, 15, 23, 30, calendar: calendar), calendar: calendar,
                                            pieces: [piece], passages: [passage], coldGrades: [earlyThatDay])
        XCTAssertFalse(PracticeRulesEngine.isColdAttemptEligible(passageID: passage.id, context: lateSameLocalDay))

        // Different local calendar days (Jan 15 23:45 vs Jan 16 00:15) only 30 minutes apart, which
        // land on the SAME UTC calendar day (04:45 and 05:15 UTC) — a UTC-based calendar would wrongly
        // call these "the same day".
        let lateJan15 = ColdGradeRecord(passageID: passage.id, date: makeDate(2026, 1, 15, 23, 45, calendar: calendar), grade: .clean, tempo: 90)
        let earlyJan16 = makeContext(now: makeDate(2026, 1, 16, 0, 15, calendar: calendar), calendar: calendar,
                                      pieces: [piece], passages: [passage], coldGrades: [lateJan15])
        XCTAssertTrue(PracticeRulesEngine.isColdAttemptEligible(passageID: passage.id, context: earlyJan16))
    }

    func testStartOfDayAfterAddingCrossesDaylightSavingTime() throws {
        let calendar = makeCalendar()
        // U.S. spring-forward in 2026 is Sunday, March 8 (2:00 AM -> 3:00 AM; a 23-hour day).
        let beforeTransition = makeDate(2026, 3, 7, 10, 0, calendar: calendar)
        let nextDay = calendar.startOfDay(afterAdding: 1, to: beforeTransition)
        let components = calendar.dateComponents([.year, .month, .day, .hour, .minute], from: nextDay)
        XCTAssertEqual(components.year, 2026); XCTAssertEqual(components.month, 3); XCTAssertEqual(components.day, 8)
        XCTAssertEqual(components.hour, 0); XCTAssertEqual(components.minute, 0)

        // The same correctness flows through an actual rule: a Missed grade the day before the
        // transition is still due at local midnight the next calendar day, not 25 real hours later.
        let piece = makePiece()
        let passage = makePassage(pieceID: piece.id, learningState: .review)
        let context = makeContext(now: beforeTransition, calendar: calendar, pieces: [piece], passages: [passage])
        let application = try XCTUnwrap(PracticeRulesEngine.applyColdGrade(passageID: passage.id, grade: .missed, tempo: 90, context: context))
        XCTAssertEqual(application.newSchedule.dueDate, nextDay)
    }
}
