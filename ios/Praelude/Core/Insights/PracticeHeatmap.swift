import Foundation

/// Score heatmap coloring (§16): "recent results" reduced to three monochrome weights, solid the
/// lightest and failing the heaviest — matching `ScorePassageBoxStyle`'s own alpha-only convention
/// (the shape/weight carries the distinction, not a second hue). This is a separate renderer's input,
/// not a `ScorePageOverlay` change — see "(C) Design System.md" and the Views-level heatmap file.
public enum HeatLevel: Equatable, Sendable, CaseIterable {
    case solid, shaky, failing

    /// Fill alpha against `PraeludeColor.scoreInk` — a Views concern reads this; Core only orders
    /// the three levels by how much attention they deserve.
    public var weight: Double {
        switch self {
        case .solid: return 0.10
        case .shaky: return 0.22
        case .failing: return 0.40
        }
    }
}

public enum PracticeHeatmap {
    /// Cold grades/attempts older than this many days are ignored — a heatmap should read "recent
    /// results" (§16), not a passage's entire lifetime. Judgment call: 14 days, long enough to survive
    /// a normal practice gap, short enough that a months-old grade never paints today's picture.
    public static let recencyWindowDays = 14
    /// How many of a passage's most recent effective attempts are considered when no cold grade
    /// exists in the recency window — enough to smooth out one lucky/unlucky rep without diluting a
    /// real recent pattern.
    public static let recentAttemptSampleSize = 5

    /// A passage's heat level, or `nil` when there is no recent evidence at all (an honest "no data
    /// yet" rather than a fabricated color — §15/§16's empty-state rule applies here too).
    ///
    /// **Judgment call — cold grade first, attempts as fallback.** §11 R3/R4 (cold-graded spaced
    /// review) is the spec's authoritative "recent result" signal, but nothing in this codebase's live
    /// practice loop calls `applyColdGrade` yet (see "(C) Rules Engine.md": rule wiring belongs to the
    /// practice-HUD track, not this one). A freshly built library already has attempts — every
    /// recorded Clean/Sloppy/Again does — long before it has any `ColdGradeRecord`. Preferring the
    /// most recent in-window cold grade when one exists, and otherwise reading the clean ratio of the
    /// passage's most recent attempts (an `.again` counts as non-clean for this ratio, the same
    /// "didn't advance the streak" reading R5/R6 give it), means the heatmap is useful immediately and
    /// becomes more precise the moment cold-grading is wired in elsewhere, with no change needed here.
    public static func passageLevel(passageID: UUID, state: LibraryState, now: Date, calendar: Calendar) -> HeatLevel? {
        let windowStart = calendar.date(byAdding: .day, value: -recencyWindowDays, to: now) ?? .distantPast
        if let latestGrade = state.coldGrades.filter({ $0.passageID == passageID && $0.date >= windowStart })
            .max(by: { $0.date < $1.date }) {
            switch latestGrade.grade {
            case .clean: return .solid
            case .shaky: return .shaky
            case .missed: return .failing
            }
        }
        let sets = (state.history + [state.activeSet].compactMap { $0 }).filter { $0.configuration.passageID == passageID }
        let recentAttempts = sets.flatMap(\.attempts).filter(\.isEffective).filter { $0.date >= windowStart }
            .sorted { $0.date > $1.date }.prefix(recentAttemptSampleSize)
        guard !recentAttempts.isEmpty else { return nil }
        let cleanFraction = Double(recentAttempts.filter { $0.verdict == .clean }.count) / Double(recentAttempts.count)
        if cleanFraction >= 0.8 { return .solid }
        if cleanFraction >= 0.4 { return .shaky }
        return .failing
    }

    /// A break-point tap always marks a real failure location, so its color never reads weaker than
    /// `.failing`; only its opacity fades with age, floored so a months-old tap stays visible rather
    /// than disappearing — its passage may still be genuinely troubled there.
    public static func tapOpacity(_ tap: BreakPointTap, now: Date) -> Double {
        let ageDays = max(0, now.timeIntervalSince(tap.date) / 86400)
        let floor = 0.35
        let fade = max(0, 1 - ageDays / 30)
        return floor + (1 - floor) * fade
    }
}
