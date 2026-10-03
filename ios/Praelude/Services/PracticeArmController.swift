import Observation
import Foundation

/// Owns the practice loop's "arm -> start" state machine (§10a: tap a passage, then Start, in ≤2
/// taps total, with rule defaults filled) so both a touch and a voice "Start"/"Clean"/"Shaky"/
/// "Missed" funnel through the same methods, and §10c/§11's post-set next-step line and dismissible
/// rule suggestions. A sibling to `PracticeRuntime`, which owns the already-running-set side of the
/// loop (recording verdicts, undo); this owns the side before a set exists yet and the moment right
/// after one ends. No UI belongs here — `PracticeArmView`/`PracticeHUDView` read it and call it.
@MainActor @Observable
final class PracticeArmController {
    private(set) var pieceID: UUID?
    private(set) var passage: Passage?
    var configuration: PracticeConfiguration?
    /// §9/R3: a cold-eligible passage's first `start(grade:...)` call stops here instead of starting,
    /// so the arm view can ask for Clean/Shaky/Missed before the set actually begins.
    private(set) var awaitingColdGrade = false
    /// §9/§11: R4's own "next review in N days"/"back to Learning" line for the grade that just
    /// started this set — shown for the running set's whole lifetime (nothing re-arms mid-set), so a
    /// player can still see *why* their cold grade scheduled what it did, not only that it did. Falls
    /// back to R3's own reason when R4 is disabled. See "(C) Audit.md": this used to be logged and
    /// never displayed anywhere.
    private(set) var lastColdGradeDecision: Decision?

    /// §11 R6/R7/R12/R13 suggestions a player accepted before the *next* set on this passage is
    /// armed — a tempo, a variant chain, or a parts/hands default to carry forward. Local, in-memory,
    /// this-app-launch-only (never persisted): a pre-fill hint, not committed practice data.
    private var pendingTempo: [UUID: Double] = [:]
    private var pendingStages: [UUID: [VariantStage]] = [:]
    private var pendingHands: [UUID: String] = [:]
    private var chosenConfigurations: [UUID: PracticeConfiguration] = [:]
    private(set) var errorMessage: String?

    /// §11 R1/R2/R6-R13: every other rule that fired for the just-ended set's passage, as dismissible
    /// one-line prompts. §10c's single headline (`nextStep`) is kept separate and never duplicated
    /// into this list.
    private(set) var suggestions: [Decision] = []
    /// §10c: "after every set, one-line next step with reason."
    private(set) var nextStep: Decision?

    /// Fills the practice view with rule defaults for `passage` (or a plain default for whole-piece
    /// practice, when `passage` is `nil`), folding in any pending override from an accepted
    /// suggestion. Clears any suggestions/next-step being shown for whatever was armed before —
    /// moving on to arm something else means they no longer apply.
    /// Cold-eligibility (§9/R3) is decided right here, at arm time, not deferred to `start(grade:)` —
    /// that is what keeps the whole flow at exactly "tap passage, then Start or say Start" (≤2 taps
    /// total, §10a): a cold-eligible passage's *second* tap/word is already the grade, in place of a
    /// plain Start, never an extra third step.
    func arm(pieceID: UUID, passage: Passage?, store: PracticeStore) {
        // "Moving on to arm something else" (see this method's own doc comment above) means the
        // target actually changes — a re-arm of the *same* piece/passage (how every idle rearm after
        // a set ends, including a manual Stop, reaches this) must not wipe out a next-step/suggestions
        // `computeAfterSet` just populated for it. `NextStepAndSuggestionsView` only ever renders while
        // idle (no active set for this piece) anyway, so anything preserved here that turns out stale
        // is always overwritten by the *next* `computeAfterSet` before it would be shown again.
        let isSameTarget = self.pieceID == pieceID && self.passage?.id == passage?.id
        self.pieceID = pieceID
        self.passage = passage
        if !isSameTarget { suggestions = []; nextStep = nil }
        // Mid-set context (unlike `nextStep`/`suggestions` above, which are meant for the idle screen
        // right after a set): always stale once anything is armed again, same-target or not.
        lastColdGradeDecision = nil
        guard let passage else {
            let tempo = store.pieces.first { $0.id == pieceID }?.defaultPracticeBPM ?? 60
            configuration = chosenConfigurations[pieceID] ?? PracticeConfiguration(pieceID: pieceID, focus: "Pulse", startBPM: tempo, targetBPM: tempo)
            awaitingColdGrade = false
            return
        }
        let context = RuleContext(state: store.state, now: Date())
        var draft = PracticeRulesEngine.defaultConfiguration(for: passage.id, context: context)
            ?? PracticeConfiguration(pieceID: pieceID, passageID: passage.id, focus: passage.focus)
        if let chosen = chosenConfigurations[passage.id] { draft = chosen }
        if let tempo = pendingTempo[passage.id] { draft.startBPM = tempo; draft.targetBPM = max(draft.targetBPM, tempo) }
        if let stages = pendingStages[passage.id] { draft.stages = stages }
        if let hands = pendingHands[passage.id] { draft.hands = hands }
        configuration = draft
        awaitingColdGrade = context.settings.r3Enabled && PracticeRulesEngine.isColdAttemptEligible(passageID: passage.id, context: context)
    }

    func clearArm() {
        pieceID = nil; passage = nil; configuration = nil; awaitingColdGrade = false
    }

    /// §9: lets the player start practicing without formally grading today's first attempt — a
    /// declined cold grade, not a missing one. Nothing is logged or recorded (there is no `Decision`
    /// to decline — R3 never evaluated), and `awaitingColdGrade` recomputes fresh (still cold-eligible)
    /// the next time this passage is armed, so this is local to *this* visit, not a standing choice.
    /// See "(C) Audit.md": the cold-grade prompt previously had no way out except picking a grade.
    func skipColdGrade() {
        awaitingColdGrade = false
    }

    /// Begin practicing. When `awaitingColdGrade` (set by `arm(...)` above), a `grade` is required —
    /// passing `nil` is a no-op that leaves the cold-grade prompt showing, since there is nothing
    /// meaningful to start yet. The grade itself becomes the set's first recorded attempt (via
    /// `PracticeUXHelpers.verdict(for:)`) rather than a separate pre-check, so grading cold is the
    /// same one tap/word as recording the set's own first repetition, not an extra step.
    @discardableResult
    func start(grade: ColdGrade? = nil, skippingColdGrade: Bool = false, store: PracticeStore, runtime: PracticeRuntime) throws -> Bool {
        guard let configuration else { return false }
        if awaitingColdGrade && !skippingColdGrade {
            guard let grade, passage != nil else { return false }
            try runtime.validateAttemptTempo(configuration.startBPM)
            let eventID = UUID()
            let application = try store.startColdGradedSet(configuration, grade: grade, eventID: eventID)
            applyConfigurationOverride(configuration)
            awaitingColdGrade = false
            lastColdGradeDecision = application.decisions.last
            if let after = store.activeSet {
                var before = after
                before.attempts = []
                before = PracticeEngine.project(before)
                runtime.confirmCommittedAttempt(before: before, after: after,
                                                verdict: PracticeUXHelpers.verdict(for: grade), eventID: eventID)
            }
            return true
        }
        try store.startSet(configuration)
        applyConfigurationOverride(configuration)
        awaitingColdGrade = false
        return true
    }

    /// A deliberate setup choice survives switching away/back and repeating a set in this score
    /// window. Starting a set is what persists its configuration; an unstarted draft earns nothing.
    func applyConfigurationOverride(_ value: PracticeConfiguration) {
        var value = value
        if value.basis == .totalPlays { value.targetBPM = value.startBPM; value.stages = [] }
        value.tempoChanges = []
        let key = value.passageID ?? value.pieceID
        chosenConfigurations[key] = value
        pendingTempo[key] = nil; pendingStages[key] = nil; pendingHands[key] = nil
        if pieceID == value.pieceID, passage?.id == value.passageID { configuration = value }
    }

    /// §10c/§11: call once a set ends (completed, or manually stopped) to populate the headline
    /// next-step line and the separate dismissible rule-suggestion prompts. Never called mid-attempt.
    func computeAfterSet(_ set: ActiveSet, store: PracticeStore) {
        let context = RuleContext(state: store.state, now: Date())
        let headline = PracticeRulesEngine.nextStepLine(afterSet: set, context: context)
        nextStep = headline
        guard let passageID = set.configuration.passageID else { suggestions = []; return }
        var others: [Decision] = []
        func offer(_ decision: Decision?) {
            // Every `evaluate…` call here is a pure, deterministic function of (rule, passage,
            // context) — the same rule firing for the same passage always produces the same reason,
            // just wrapped in a freshly minted `Decision.id`. Comparing `id`s (as this used to) can
            // never actually catch that: the headline and this candidate are always different
            // `Decision` values even when they are the identical rule firing twice, which is exactly
            // how the §10c headline used to end up duplicated into its own dismissible suggestions list.
            guard let decision, !(decision.ruleID == headline.ruleID && decision.passageID == headline.passageID) else { return }
            others.append(decision)
        }
        offer(PracticeRulesEngine.evaluateR1SmallChunks(passageID: passageID, context: context))
        for decision in PracticeRulesEngine.evaluateR2JoinSeams(pieceID: set.configuration.pieceID, context: context) { offer(decision) }
        offer(PracticeRulesEngine.evaluateR6SlowDown(set: set, context: context))
        offer(PracticeRulesEngine.evaluateR7SpeedUp(passageID: passageID, context: context))
        offer(PracticeRulesEngine.evaluateR8SplitWeakSpot(passageID: passageID, context: context))
        offer(PracticeRulesEngine.evaluateR9StopGrinding(passageID: passageID, context: context))
        offer(PracticeRulesEngine.evaluateR10PerformanceReady(passageID: passageID, context: context))
        offer(PracticeRulesEngine.evaluateR12VariantsWhenStuck(passageID: passageID, context: context))
        offer(PracticeRulesEngine.evaluateR13PartsSeparately(passageID: passageID, context: context))
        suggestions = others
    }

    /// One-tap dismiss (§11: "one-tap override, overrides logged"). Never mutates passage/tempo data.
    /// `decision` may be a plain suggestion or (per `RuleSuggestionsView`) the §10c headline itself.
    func dismiss(_ decision: Decision, store: PracticeStore) {
        suggestions.removeAll { $0.id == decision.id }
        if nextStep?.id == decision.id { nextStep = nil }
        try? store.recordRuleEvent(decision.asRuleEvent(overridden: true))
    }

    /// Accepts a suggestion: applies it immediately where that is fully mechanical from the
    /// `Decision`'s own outcome (R2 join, R8 sub-passage, R9 park, R10 performance-ready), or stages
    /// it as a pending override for the *next* arm where a value alone is enough (R6/R7 tempo, R13
    /// hands). R1 (no computed split point — see "(C) Rules Engine.md") and R12 (a whole variant
    /// chain) need more player input than a single tap can supply; their callers open the relevant
    /// editor themselves after calling this, which only logs the acceptance for those two.
    func accept(_ decision: Decision, store: PracticeStore) {
        errorMessage = nil
        if case .suggestJoin(let passageIDs) = decision.outcome {
            do { _ = try store.joinPassages(passageIDs) }
            catch { errorMessage = error.localizedDescription; return }
        }
        suggestions.removeAll { $0.id == decision.id }
        if nextStep?.id == decision.id { nextStep = nil }
        try? store.recordRuleEvent(decision.asRuleEvent(overridden: false))
        switch decision.outcome {
        case .suggestJoin:
            break // The atomic join above must succeed before accepting the suggestion.
        case .suggestSubPassage(let region):
            guard let passageID = decision.passageID,
                  let source = store.state.passages.first(where: { $0.id == passageID }) else { return }
            let page = PracticeUXHelpers.distinctPages(source.regions).first ?? source.page
            let sub = Passage(pieceID: source.pieceID, title: "\(source.title) — trouble spot",
                               page: page, focus: source.focus,
                               regions: [PassageRegion(page: page, x: region.x, y: region.y, width: region.width, height: region.height)],
                               parentPassageID: source.id)
            try? store.savePassage(sub)
        case .park(let until):
            guard let passageID = decision.passageID, var target = store.state.passages.first(where: { $0.id == passageID }) else { return }
            let original = target
            target.parkedUntil = until; target.updatedAt = Date()
            try? store.savePassage(target, replacing: original)
        case .performanceReady:
            guard let passageID = decision.passageID, var target = store.state.passages.first(where: { $0.id == passageID }) else { return }
            let original = target
            target.learningState = .performanceReady; target.updatedAt = Date()
            try? store.savePassage(target, replacing: original)
        case .tempoChange(let newBPM):
            guard let passageID = decision.passageID else { return }
            pendingTempo[passageID] = newBPM
        case .suggestParts(let hands):
            guard let passageID = decision.passageID else { return }
            pendingHands[passageID] = hands
        case .suggestSplit, .suggestVariants, .none, .schedule, .streakTarget, .pulseCheck, .sessionPlan, .performanceCaps:
            break
        }
    }

    /// R12's accepted variant chain, once the player has actually built one in the editor the caller
    /// opened after `accept(_:store:)`.
    func applyStagesOverride(_ stages: [VariantStage], passageID: UUID) {
        pendingStages[passageID] = stages
        if passage?.id == passageID { configuration?.stages = stages }
    }
}
