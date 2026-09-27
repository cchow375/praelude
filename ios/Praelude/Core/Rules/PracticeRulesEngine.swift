import Foundation

/// The practice rules façade (§11 R1–R15, §10a/§10b/§10c, §4 passage learning state). Pure and
/// deterministic: every function here is a plain transformation of the `RuleContext` (and whatever
/// specific subject — a passage, a piece, a set — it evaluates) into a `Decision` or a small,
/// caller-actionable value. Nothing in this file touches disk, the clock, or `PracticeStore`
/// directly; a real caller reads `PracticeStore.state` into a `RuleContext`, calls the rule it
/// wants, and — if the player accepts or overrides it — logs the result with
/// `PracticeStore.recordRuleEvent(decision.asRuleEvent(overridden:))`.
///
/// Implementation lives across this file's siblings, grouped by what they read:
/// - `PassageLearningRules.swift` — R3 cold grading, R4 spaced review, R10 performance-ready,
///   R11 performance date.
/// - `PracticeSetRules.swift` — R5 streak targets, R6 slow down, R7 speed up, R12 variants when
///   stuck, R14 pulse check.
/// - `PassageStructureRules.swift` — R1 small chunks, R2 join seams, R8 split weak spot,
///   R13 parts separately.
/// - `SessionRules.swift` — R9 stop grinding, R15 session builder, §10a default set configuration,
///   §10c next-step line.
///
/// See "(C) Rules Engine.md" for the full API reference and the documented heuristics (region-height
/// assumption for R1, tap-clustering radius for R8, and so on) that the condensed build spec leaves
/// for an implementation to define.
public enum PracticeRulesEngine {
    /// Logs a fired-or-overridden decision as the append-only `RuleEvent` schema3 already has a home
    /// for. Callers pass the result to `PracticeStore.recordRuleEvent`.
    public static func logEvent(for decision: Decision, overridden: Bool = false) -> RuleEvent {
        decision.asRuleEvent(overridden: overridden)
    }
}

extension Calendar {
    /// Shorthand used across the rule files: `date` advanced by `days` whole days, computed from
    /// its own start-of-day so a rule's day math is never thrown off by the time-of-day component
    /// (and so it steps correctly across a DST transition, since `Calendar.date(byAdding:)` — unlike
    /// naively adding `86400` seconds — accounts for the calendar's time zone).
    func startOfDay(afterAdding days: Int, to date: Date) -> Date {
        let day = startOfDay(for: date)
        return self.date(byAdding: .day, value: days, to: day) ?? date.addingTimeInterval(Double(days) * 86400)
    }
}

extension PracticeRulesEngine {
    /// "1 day"/"3 days" — the shared count-plus-noun formatter every rule's reason text uses, so an
    /// editable parameter set to 1 (or a performance-date countdown that lands on its last day) never
    /// reads as a grammar mistake in copy the player actually sees (§3a: copy is dry and specific).
    static func pluralize(_ count: Int, _ singular: String) -> String {
        "\(count) \(singular)\(count == 1 ? "" : "s")"
    }
}

extension PracticeRulesEngine {
    /// Every `ActiveSet` that practiced this passage — `history` plus the live `activeSet` when it
    /// belongs to this passage too — oldest first. Shared by R7, R9 and §10a, which all need "this
    /// passage's own sets" rather than the whole library's.
    static func allSets(forPassage passageID: UUID, context: RuleContext) -> [ActiveSet] {
        (context.history + [context.activeSet].compactMap { $0 })
            .filter { $0.configuration.passageID == passageID }
            .sorted { $0.startedAt < $1.startedAt }
    }
}
