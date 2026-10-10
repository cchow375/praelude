import Foundation

public enum PracticeHand: String, CaseIterable, Codable, Sendable {
    case left, both, right, unknown
    public var title: String {
        switch self { case .left: return "Left hand"; case .both: return "Both hands"; case .right: return "Right hand"; case .unknown: return "Unspecified hands" }
    }
    public static func canonicalSelection(_ value: String) -> String? {
        let hand = classify(value)
        return hand == .unknown ? nil : hand.title
    }
    public static func isExplicitSelection(_ value: String) -> Bool {
        [Self.left.title, Self.both.title, Self.right.title].contains(value)
    }
    public static func classify(_ value: String) -> PracticeHand {
        switch value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "left hand", "left", "lh": return .left
        case "right hand", "right", "rh": return .right
        case "both hands", "both", "ht": return .both
        default: return .unknown
        }
    }
}

/// Optional, pianist-chosen minimum shares of recorded repetitions. Zero means no check.
/// Resources support purposeful hands, proportional tempo and variation, not universal quotas.
public struct PracticeBalancePlan: Codable, Equatable, Sendable {
    public var leftHandPercent: Int
    public var rightHandPercent: Int
    public var verySlowPercent: Int
    public var variantPercent: Int
    public init(leftHandPercent: Int = 0, rightHandPercent: Int = 0, verySlowPercent: Int = 0, variantPercent: Int = 0) {
        self.leftHandPercent = leftHandPercent; self.rightHandPercent = rightHandPercent
        self.verySlowPercent = verySlowPercent; self.variantPercent = variantPercent
    }
    public var isValid: Bool {
        [leftHandPercent, rightHandPercent, verySlowPercent, variantPercent].allSatisfy { (0...100).contains($0) }
            && leftHandPercent + rightHandPercent <= 100
    }
    public var isConfigured: Bool { leftHandPercent + rightHandPercent + verySlowPercent + variantPercent > 0 }
}

public enum TempoPracticeBand: String, CaseIterable, Sendable {
    case belowQuarter, quarter, belowHalf, moderate, nearFull, aboveFull, unknown
    public var title: String {
        switch self {
        case .belowQuarter: return "Below 20%"
        case .quarter: return "Around quarter tempo · 20–30%"
        case .belowHalf: return "Above 30%, below 50%"
        case .moderate: return "50% to below 80%"
        case .nearFull: return "80–105%"
        case .aboveFull: return "Above 105%"
        case .unknown: return "Full tempo not specified"
        }
    }
    public static func classify(bpm: Double, fullTempoBPM: Double?) -> Self {
        guard let target = fullTempoBPM, target.isFinite, target > 0, bpm.isFinite, bpm > 0 else { return .unknown }
        let fraction = bpm / target
        if fraction < 0.2 { return .belowQuarter }
        if fraction <= 0.3 { return .quarter }
        if fraction < 0.5 { return .belowHalf }
        if fraction < 0.8 { return .moderate }
        if fraction <= 1.05 { return .nearFull }
        return .aboveFull
    }
}

public struct PracticeObservation: Identifiable, Equatable, Sendable {
    public var id: UUID
    public var setID: UUID
    public var sessionID: UUID
    public var pieceID: UUID
    public var date: Date
    public var verdict: Verdict
    public var bpm: Double
    public var hands: PracticeHand
    public var handsCapturedPerAttempt: Bool
    public var variant: String?
    public var fullTempoBPM: Double?
    public var usesCurrentTempoReference: Bool
    public var tempoBand: TempoPracticeBand { .classify(bpm: bpm, fullTempoBPM: fullTempoBPM) }
    public var relativeTempoPercent: Double? { fullTempoBPM.map { bpm / $0 * 100 } }
}

public struct PracticeBreakdown: Identifiable, Equatable, Sendable {
    public var id: String
    public var title: String
    public var repetitions: Int
    public var sessions: Int
}

public enum PracticeBalanceSignal: String, Equatable, Sendable {
    case notConfigured, insufficient, bad, middle, good
    public var title: String {
        switch self {
        case .notConfigured: return "Choose your checks"
        case .insufficient: return "Not enough information"
        case .bad: return "Bad · below your chosen coverage"
        case .middle: return "Middle · some chosen checks met"
        case .good: return "Good · chosen checks met"
        }
    }
}

public struct PracticeCoverageCheck: Identifiable, Equatable, Sendable {
    public var id: String
    public var title: String
    public var repetitions: Int
    public var denominator: Int
    public var minimumPercent: Int
    public var hasCompleteAttribution: Bool
    public var isMet: Bool { hasCompleteAttribution && denominator > 0 && Double(repetitions) * 100 >= Double(minimumPercent * denominator) }
    public var actualPercent: Int { denominator > 0 ? Int((Double(repetitions) / Double(denominator) * 100).rounded()) : 0 }
}

public struct PracticeBalanceSummary: Equatable, Sendable {
    public var observations: [PracticeObservation]
    public var plan: PracticeBalancePlan
    public var repetitions: Int { observations.count }
    public var sessions: Int { Set(observations.map(\.sessionID)).count }
    public var legacyHandsRepetitions: Int { observations.filter { !$0.handsCapturedPerAttempt }.count }
    public var currentReferenceRepetitions: Int { observations.filter(\.usesCurrentTempoReference).count }
    public var missingTempoRepetitions: Int { observations.filter { $0.fullTempoBPM == nil }.count }
    public var missingVariantRepetitions: Int { observations.filter { $0.variant == nil }.count }
    public var hasCompleteHandAttribution: Bool {
        legacyHandsRepetitions == 0 && !observations.contains { $0.hands == .unknown }
    }
    public var missingSignalReasons: [String] {
        var reasons: [String] = []
        if (plan.leftHandPercent > 0 || plan.rightHandPercent > 0), !hasCompleteHandAttribution {
            reasons.append("Hand checks need per-repetition selections. Older set-level hands or unspecified hands cannot establish how each repetition was played.")
        }
        if plan.variantPercent > 0, missingVariantRepetitions > 0 {
            reasons.append("\(missingVariantRepetitions) reps have no recorded variant. Missing variant data cannot be counted as practice without a variant.")
        }
        if plan.verySlowPercent > 0, missingTempoRepetitions > 0 {
            reasons.append("\(missingTempoRepetitions) reps have no full-tempo reference, so their slow-practice coverage is unknown.")
        }
        return reasons
    }
    public var verySlowRepetitions: Int { observations.filter { [.belowQuarter, .quarter].contains($0.tempoBand) }.count }

    public var hands: [PracticeBreakdown] {
        PracticeHand.allCases.map { hand in breakdown(id: hand.rawValue, title: hand.title, rows: observations.filter { $0.hands == hand }) }
    }
    public var tempos: [PracticeBreakdown] {
        TempoPracticeBand.allCases.map { band in breakdown(id: band.rawValue, title: band.title, rows: observations.filter { $0.tempoBand == band }) }
    }
    public var variants: [PracticeBreakdown] {
        let grouped = Dictionary(grouping: observations) { $0.variant ?? "No variant recorded" }
        return grouped.keys.sorted().map { name in breakdown(id: name, title: name, rows: grouped[name] ?? []) }
    }
    public var checks: [PracticeCoverageCheck] {
        var result: [PracticeCoverageCheck] = []
        func append(_ id: String, _ title: String, _ minimum: Int, _ rows: [PracticeObservation], complete: Bool) {
            if minimum > 0 { result.append(PracticeCoverageCheck(id: id, title: title, repetitions: rows.count, denominator: repetitions, minimumPercent: minimum, hasCompleteAttribution: complete)) }
        }
        append("left", "Left hand", plan.leftHandPercent, observations.filter { $0.hands == .left }, complete: hasCompleteHandAttribution)
        append("right", "Right hand", plan.rightHandPercent, observations.filter { $0.hands == .right }, complete: hasCompleteHandAttribution)
        append("slow", "At or below 30% of full tempo", plan.verySlowPercent, observations.filter { [.belowQuarter, .quarter].contains($0.tempoBand) }, complete: missingTempoRepetitions == 0)
        append("variant", "Named variant", plan.variantPercent, observations.filter { $0.variant != nil }, complete: missingVariantRepetitions == 0)
        return result
    }
    /// A conservative display guard, not a claim about an effective practice dose. The signal
    /// describes coverage against the player's plan, never sound, attention or musical quality.
    public var signal: PracticeBalanceSignal {
        guard plan.isConfigured else { return .notConfigured }
        guard repetitions >= 20, sessions >= 2 else { return .insufficient }
        guard checks.allSatisfy(\.hasCompleteAttribution) else { return .insufficient }
        let met = checks.filter(\.isMet).count
        return met == checks.count ? .good : (met == 0 ? .bad : .middle)
    }
    private func breakdown(id: String, title: String, rows: [PracticeObservation]) -> PracticeBreakdown {
        PracticeBreakdown(id: id, title: title, repetitions: rows.count, sessions: Set(rows.map(\.sessionID)).count)
    }
}

public enum PracticeBalance {
    /// Reads sets, the authoritative attempt ledger, once. Session.attempts is a derived mirror
    /// and must never be added again. Undo/reset events remain durable but do not count as reps.
    /// An old attempt without a reference can be compared with today's target, clearly marked as
    /// a current-reference calculation. No ledger or snapshot is rewritten to do this.
    public static func summarize(pieceID: UUID, state: LibraryState, since: Date? = nil, through: Date? = nil,
                                 sessionID: UUID? = nil) -> PracticeBalanceSummary {
        let piece = state.pieces.first { $0.id == pieceID }
        var seen: Set<UUID> = []
        var rows: [PracticeObservation] = []
        for set in state.history + [state.activeSet].compactMap({ $0 }) where set.configuration.pieceID == pieceID {
            if let sessionID, set.sessionID != sessionID { continue }
            let config = set.configuration
            for attempt in set.attempts where attempt.isEffective {
                guard (since == nil || attempt.date >= since!), (through == nil || attempt.date <= through!), seen.insert(attempt.id).inserted else { continue }
                let capturedHands = config.recordedHands[attempt.id.uuidString]
                let variant = config.stages.indices.contains(attempt.stageIndex) ? config.stages[attempt.stageIndex].name : nil
                rows.append(PracticeObservation(id: attempt.id, setID: set.id, sessionID: set.sessionID, pieceID: pieceID,
                                                date: attempt.date, verdict: attempt.verdict, bpm: attempt.bpm,
                                                hands: .classify(capturedHands ?? config.hands), handsCapturedPerAttempt: capturedHands != nil,
                                                variant: variant, fullTempoBPM: config.fullTempoBPM ?? piece?.fullTempoBPM,
                                                usesCurrentTempoReference: config.fullTempoBPM == nil && piece?.fullTempoBPM != nil))
            }
        }
        return PracticeBalanceSummary(observations: rows.sorted { $0.date == $1.date ? $0.id.uuidString < $1.id.uuidString : $0.date < $1.date },
                                      plan: piece?.practiceBalancePlan ?? PracticeBalancePlan())
    }
}
