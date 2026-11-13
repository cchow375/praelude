import Foundation

/// A piece's practice-readiness state (§16), blending §11 R4's spaced-review ladder (the
/// authoritative signal, once something grades cold attempts — see `PracticeHeatmap`'s own note on
/// the same gap) with whether the piece has been attempted at all, so a freshly added piece reads as
/// "Not started" rather than indistinguishable from one deep in Review.
public enum PieceReadinessState: String, Equatable, Sendable {
    case notStarted, learning, review, performanceReady, atRisk
}

public struct PieceReadinessSummary: Identifiable, Equatable, Sendable {
    public var id: UUID { pieceID }
    public var pieceID: UUID
    public var state: PieceReadinessState
    /// Passages in `.performanceReady` over every non-archived passage; `nil` when the piece has none.
    public var readyFraction: Double?
    public var daysToPerformance: Int?
    public var reason: String
}

public enum PieceReadiness {
    /// `nil` only when the piece itself no longer exists (deleted); a piece with zero passages still
    /// returns a summary (`.notStarted`) — readiness is meaningful to show from the moment a piece is
    /// added, per §15/§16's "empty states tell the user exactly what to do next".
    public static func evaluate(pieceID: UUID, context: RuleContext) -> PieceReadinessSummary? {
        guard let piece = context.pieces.first(where: { $0.id == pieceID }) else { return nil }
        let passages = context.passages.filter { $0.pieceID == pieceID && !$0.archived }
        let today = context.calendar.startOfDay(for: context.now)
        let nearestPerformance = piece.performanceDates.map { context.calendar.startOfDay(for: $0) }.filter { $0 >= today }.min()
        let daysToPerformance = nearestPerformance.flatMap { context.calendar.dateComponents([.day], from: today, to: $0).day }

        var atRisk = false
        var notReadyCount = 0
        if let decision = PracticeRulesEngine.evaluateR11PerformanceDate(pieceID: pieceID, context: context),
           case let .performanceCaps(_, _, notReadyPassageIDs, inFinalWeek) = decision.outcome {
            atRisk = inFinalWeek && !notReadyPassageIDs.isEmpty
            notReadyCount = notReadyPassageIDs.count
        }

        guard !passages.isEmpty else {
            return PieceReadinessSummary(pieceID: pieceID, state: .notStarted, readyFraction: nil,
                                          daysToPerformance: daysToPerformance, reason: "No passages marked yet.")
        }
        let readyCount = passages.filter { $0.learningState == .performanceReady }.count
        let fraction = Double(readyCount) / Double(passages.count)
        if atRisk {
            return PieceReadinessSummary(pieceID: pieceID, state: .atRisk, readyFraction: fraction,
                                          daysToPerformance: daysToPerformance,
                                          reason: "\(PracticeRulesEngine.pluralize(notReadyCount, "passage")) not performance-ready.")
        }
        if readyCount == passages.count {
            return PieceReadinessSummary(pieceID: pieceID, state: .performanceReady, readyFraction: fraction,
                                          daysToPerformance: daysToPerformance, reason: "Every passage is performance-ready.")
        }
        if readyCount > 0 || passages.contains(where: { $0.learningState == .review }) {
            return PieceReadinessSummary(pieceID: pieceID, state: .review, readyFraction: fraction,
                                          daysToPerformance: daysToPerformance,
                                          reason: "\(readyCount) of \(passages.count) passages ready.")
        }
        let anyPracticed = passages.contains { $0.learningState != .new }
            || (context.history + [context.activeSet].compactMap { $0 }).contains { $0.configuration.pieceID == pieceID && !$0.attempts.isEmpty }
        if anyPracticed {
            return PieceReadinessSummary(pieceID: pieceID, state: .learning, readyFraction: fraction,
                                          daysToPerformance: daysToPerformance, reason: "In progress.")
        }
        return PieceReadinessSummary(pieceID: pieceID, state: .notStarted, readyFraction: fraction,
                                      daysToPerformance: daysToPerformance, reason: "Not started yet.")
    }
}
