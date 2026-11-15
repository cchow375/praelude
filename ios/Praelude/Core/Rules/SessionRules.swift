import Foundation

/// R9 stop grinding, R15 session builder, §10a default set configuration, §10c next-step line — the
/// rules and helpers that operate across a whole practice session rather than one passage in
/// isolation.
extension PracticeRulesEngine {
    // MARK: - R9 stop grinding

    /// A set "made progress" (§11 R9) if it completed, cleared at least one variant stage, or
    /// advanced its tempo above where it started — anything short of that, for a set that has
    /// already ended, is grinding in place.
    private static func madeProgress(_ set: ActiveSet) -> Bool {
        set.status == .completed || set.completedStages > 0 || set.currentBPM > set.configuration.startBPM
    }

    /// R9: park the passage until tomorrow after `r9Minutes` of total active time on it today, or
    /// after `r9Sets` consecutive today's-sets in a row without progress (counted from the most
    /// recent set backwards, stopping at the first one that did make progress — exactly the same
    /// "in a row" shape R6 uses for its own consecutive-failure count).
    public static func evaluateR9StopGrinding(passageID: UUID, context: RuleContext) -> Decision? {
        guard context.settings.r9Enabled,
              let passage = context.passages.first(where: { $0.id == passageID }), !passage.archived else { return nil }
        let todaysSets = allSets(forPassage: passageID, context: context)
            .filter { context.calendar.isDate($0.startedAt, inSameDayAs: context.now) }
        guard !todaysSets.isEmpty else { return nil }
        let totalActiveSeconds = todaysSets.reduce(0) { $0 + $1.activeSeconds }
        let overTime = totalActiveSeconds >= Double(context.settings.r9Minutes) * 60
        var trailingWithoutProgress = 0
        for set in todaysSets.reversed() {
            if madeProgress(set) { break }
            trailingWithoutProgress += 1
        }
        let overSets = trailingWithoutProgress >= context.settings.r9Sets
        guard overTime || overSets else { return nil }
        let until = context.calendar.startOfDay(afterAdding: 1, to: context.now)
        let reason = overTime
            ? "\(pluralize(context.settings.r9Minutes, "minute")) on this today. Back tomorrow."
            : "\(pluralize(trailingWithoutProgress, "set")), no progress. Back tomorrow."
        return Decision(ruleID: .r9StopGrinding, pieceID: passage.pieceID, passageID: passageID, reason: reason,
                         firedAt: context.now, outcome: .park(until: until))
    }

    // MARK: - §10a default set configuration

    /// A saved set retains the player's chosen count, technique chain and click conditions. R5
    /// supplies an initial count only when this target has no saved set; it never overwrites a
    /// deliberate previous choice. Tempo boundaries are cleared for the new set's empty rep log.
    ///
    /// Deliberately does *not* also apply R7's speed-up: R7 is "one-tap override, logged" like every
    /// other rule in §11, and `computeAfterSet`/`PracticeArmController.accept` already offer and stage
    /// it correctly (into `pendingTempo`, which *is* folded in here — see `arm(...)`). Auto-applying it
    /// a second time here, unconditionally and unlogged, bypassed the player's own accept/dismiss
    /// entirely and let `r7MaxIncreasesPerDay` never see a single logged increase to count against —
    /// see "(C) Audit.md".
    public static func defaultConfiguration(for passageID: UUID, context: RuleContext) -> PracticeConfiguration? {
        guard let passage = context.passages.first(where: { $0.id == passageID }), !passage.archived else { return nil }
        let lastSet = allSets(forPassage: passageID, context: context).last
        if let lastSet {
            var value = lastSet.nextSetConfiguration
            value.focus = passage.focus
            let piece = context.pieces.first { $0.id == passage.pieceID }
            let target = passage.performanceTempo ?? piece?.fullTempoBPM
            let priorTarget = lastSet.configuration.passageSnapshot?.performanceTempo ?? lastSet.configuration.fullTempoBPM
            // A saved set that finished at target is not a reason to start the next visit there.
            // Same-window explicit overrides live in PracticeArmController and still take priority.
            if let target,
               value.startBPM >= target || (priorTarget.map { value.startBPM >= $0 } ?? false) {
                value.startBPM = PracticeUXHelpers.startingPracticeTempo(target: target, explicitStart: piece?.defaultPracticeBPM)
                if value.basis == .totalPlays { value.targetBPM = value.startBPM }
            }
            // Editing a saved target changes the next set, never the historical contract.
            if let target, target != priorTarget,
               value.basis == .cleanStreak { value.targetBPM = max(value.startBPM, target) }
            return value
        }
        let goal = lastSet?.configuration.goal ?? .tempo
        let basis = lastSet?.configuration.basis ?? .cleanStreak
        let targetCount = r5StreakTarget(for: passage.learningState, settings: context.settings)
        let tempoStep = lastSet?.configuration.tempoStep ?? .fixed(4)
        let hands = lastSet?.configuration.hands ?? "Both hands"
        let piece = context.pieces.first { $0.id == passage.pieceID }
        let target = passage.performanceTempo ?? piece?.fullTempoBPM
        let startBPM = PracticeUXHelpers.startingPracticeTempo(target: target, explicitStart: piece?.defaultPracticeBPM)
        let targetBPM = max(target ?? startBPM, startBPM)
        return PracticeConfiguration(pieceID: passage.pieceID, passageID: passageID, focus: passage.focus, goal: goal,
                                      basis: basis, targetCount: targetCount, startBPM: startBPM, targetBPM: targetBPM,
                                      tempoStep: tempoStep, hands: hands, useMetronome: goal == .tempo)
    }

    // MARK: - R15 session builder

    /// A run-through (playing the whole piece, not one passage) is estimated at this multiple of
    /// `r15EstimatedMinutesPerItem` — the spec gives no figure, so this is the engine's documented
    /// choice.
    public static let runThroughMinutesMultiplier = 3

    private static func nearestPerformanceDate(for piece: Piece, context: RuleContext) -> Date? {
        let today = context.calendar.startOfDay(for: context.now)
        return piece.performanceDates.map { context.calendar.startOfDay(for: $0) }.filter { $0 >= today }.min()
    }

    /// A minimal stand-in for §12's own warmup rotation (favorites, neglected keys, a key picker —
    /// that section's job, not this rule's): the least-recently-used exercise, never-used ones first.
    /// Enough to satisfy R15's "warmups at start"; a real rotation is a future track's work.
    private static func nextWarmupInRotation(context: RuleContext) -> WarmupExercise? {
        context.warmupExercises.filter { $0.deletedAt == nil }
            .min { ($0.lastUsedAt ?? .distantPast) < ($1.lastUsedAt ?? .distantPast) }
    }

    /// R15 (§11/§15): fits warmups, then due reviews/learning (overdue and tough spots first;
    /// performance date breaks ties), then up to `r15MaxNewPerSession` new passages, then run-throughs for pieces performing soon,
    /// into `availableMinutes` at `r15EstimatedMinutesPerItem` per item (a run-through costs
    /// `runThroughMinutesMultiplier` times as much). Items that do not fit are simply left off the
    /// plan — nothing about their own schedule changes, so "skip keeps due" and "drag reorder" need
    /// no extra bookkeeping here: `SessionPlan.items` is a plain, freely-reorderable array, and a
    /// passage left out (skipped or never offered) stays exactly as due as it already was.
    public static func buildSession(availableMinutes: Int, context: RuleContext) -> SessionPlan {
        guard context.settings.r15Enabled, availableMinutes > 0 else { return SessionPlan(items: [], totalEstimatedMinutes: 0) }
        let perItem = max(1, context.settings.r15EstimatedMinutesPerItem)
        var remaining = availableMinutes
        var items: [SessionItem] = []
        func take(_ candidate: SessionItem) {
            guard candidate.estimatedMinutes <= remaining else { return }
            items.append(candidate); remaining -= candidate.estimatedMinutes
        }

        if let warmup = nextWarmupInRotation(context: context) {
            take(SessionItem(id: warmup.id, kind: .warmup, pieceID: nil, passageID: nil, estimatedMinutes: perItem,
                              reason: warmup.lastUsedAt == nil ? "Never in rotation yet." : "Next in rotation."))
        }

        func piece(for passage: Passage) -> Piece? { context.pieces.first { $0.id == passage.pieceID } }

        // Pieces R11 currently flags, so "due reviews"/"run-throughs" can fold its verdict in.
        var runThroughPieceIDs: [UUID] = []
        for candidatePiece in context.pieces {
            guard let decision = evaluateR11PerformanceDate(pieceID: candidatePiece.id, context: context),
                  case let .performanceCaps(_, includeRunThroughs, _, _) = decision.outcome else { continue }
            if includeRunThroughs { runThroughPieceIDs.append(candidatePiece.id) }
        }

        let activePassages = context.passages.filter {
            !$0.archived && $0.deletedAt == nil && piece(for: $0) != nil &&
            ($0.parkedUntil.map { $0 <= context.now } ?? true) && piece(for: $0)?.status != .resting
        }
        // The same finite round powers Today and session planning. Do not append a second new
        // passage loop: an ungraded completed set can still have `.new` metadata, but its work
        // already occupied a daily slot and must not silently re-enter through another path.
        for review in TodayOverview.dailyPlan(context: context).items {
            guard let passage = activePassages.first(where: { $0.id == review.passageID }) else { continue }
            let kind: SessionItemKind = review.priority == .new ? .new :
                (passage.learningState == .learning ? .learning : .review)
            take(SessionItem(id: passage.id, kind: kind, pieceID: passage.pieceID, passageID: passage.id,
                             estimatedMinutes: perItem, reason: "\(review.label). \(review.reason)"))
        }

        let today = context.calendar.startOfDay(for: context.now)
        let orderedRunThroughs = runThroughPieceIDs.sorted { a, b in
            let pieceA = context.pieces.first { $0.id == a }, pieceB = context.pieces.first { $0.id == b }
            let dateA = pieceA.flatMap { nearestPerformanceDate(for: $0, context: context) } ?? .distantFuture
            let dateB = pieceB.flatMap { nearestPerformanceDate(for: $0, context: context) } ?? .distantFuture
            return dateA < dateB
        }
        for pieceID in orderedRunThroughs {
            guard let matchedPiece = context.pieces.first(where: { $0.id == pieceID }) else { continue }
            let days = nearestPerformanceDate(for: matchedPiece, context: context)
                .flatMap { context.calendar.dateComponents([.day], from: today, to: $0).day } ?? 0
            let reason = days <= 0 ? "Performance today. Run it through." : "\(pluralize(days, "day")) out. Run it through."
            take(SessionItem(id: pieceID, kind: .runThrough, pieceID: pieceID, passageID: nil,
                              estimatedMinutes: perItem * runThroughMinutesMultiplier, reason: reason))
        }

        return SessionPlan(items: items, totalEstimatedMinutes: items.reduce(0) { $0 + $1.estimatedMinutes })
    }

    // MARK: - §10c next-step line

    /// §10c: "after every set, one-line next step with reason" — the single most relevant decision
    /// for what just happened, in priority order (most decisive first): R9 stop-grinding (today's
    /// cumulative pattern says stop entirely), R10 performance-ready (a milestone worth leading
    /// with), R13/R12 (repeated trouble), R6 (this set's own slow-down), R7 (this set finished —
    /// offer the next tempo), R8/R1/R2 (structural suggestions), falling back to a plain
    /// acknowledgement. Every candidate rule still fires (and can still be logged/overridden)
    /// independently through its own `evaluate…` function; this only picks which one is worth
    /// surfacing as the single headline line. The fallback (and the no-specific-passage case) is
    /// logged under `.r15SessionBuilder`, since deciding what belongs in the flow of a session — even
    /// "nothing in particular" — is that rule's domain; no other `RuleID` fits a plain acknowledgement.
    public static func nextStepLine(afterSet set: ActiveSet, context: RuleContext) -> Decision {
        guard let passageID = set.configuration.passageID else {
            let reason = set.status == .completed ? "Set complete." : "Session ended."
            return Decision(ruleID: .r15SessionBuilder, pieceID: set.configuration.pieceID, reason: reason, firedAt: context.now)
        }
        let passage = context.passages.first { $0.id == passageID }
        if let parked = evaluateR9StopGrinding(passageID: passageID, context: context) { return parked }
        if let ready = evaluateR10PerformanceReady(passageID: passageID, context: context) { return ready }
        if let parts = evaluateR13PartsSeparately(passageID: passageID, context: context) { return parts }
        if let variants = evaluateR12VariantsWhenStuck(passageID: passageID, context: context) { return variants }
        if let slowDown = evaluateR6SlowDown(set: set, context: context) { return slowDown }
        if let speedUp = evaluateR7SpeedUp(passageID: passageID, context: context) { return speedUp }
        if let split = evaluateR8SplitWeakSpot(passageID: passageID, context: context) { return split }
        if let smallChunks = evaluateR1SmallChunks(passageID: passageID, context: context) { return smallChunks }
        if let pieceID = passage?.pieceID, let join = evaluateR2JoinSeams(pieceID: pieceID, context: context).first { return join }
        let fallback = set.status == .completed ? "Nice work. See you next time." : "Ended early. Picks up where you left off."
        return Decision(ruleID: .r15SessionBuilder, pieceID: passage?.pieceID, passageID: passageID, reason: fallback, firedAt: context.now)
    }
}
