import Foundation

/// The warmup rotation/neglected-key decision logic (§12) that "(C) Schema3.md" explicitly left for
/// a future feature track ("warmup rotation... are not implemented here"): schema3 only gave
/// `WarmupExercise` a home (`lastUsedAt`/`useCount`/`isFavorite`) for whichever engine decides what
/// "Next in rotation" means. Pure and Foundation-only so it is directly unit-testable without a
/// `PracticeStore`.
public enum WarmupRotation {
    /// One-tap "Next in rotation" (§12): the least-recently-used non-deleted exercise, optionally
    /// scoped to one instrument family. Never-used exercises (`lastUsedAt == nil`) come first, oldest
    /// first; ties break by lower use count, then by circle-of-fifths key order, then by name, so the
    /// result is deterministic for a given library rather than dependent on array/storage order.
    public static func nextInRotation(among exercises: [WarmupExercise], family: InstrumentFamily? = nil,
                                       favoritesOnly: Bool = false) -> WarmupExercise? {
        candidates(exercises, family: family, favoritesOnly: favoritesOnly)
            .min { orderingKey($0) < orderingKey($1) }
    }

    private static func orderingKey(_ exercise: WarmupExercise) -> (Double, Int, Int, String) {
        let recency = exercise.lastUsedAt?.timeIntervalSinceReferenceDate ?? -.greatestFiniteMagnitude
        let keyIndex = WarmupCatalog.circleOfFifths.firstIndex(of: exercise.key) ?? WarmupCatalog.circleOfFifths.count
        return (recency, exercise.useCount, keyIndex, exercise.name)
    }

    private static func candidates(_ exercises: [WarmupExercise], family: InstrumentFamily?, favoritesOnly: Bool) -> [WarmupExercise] {
        exercises.filter { exercise in
            exercise.deletedAt == nil
                && (family == nil || exercise.instrumentFamily == family)
                && (!favoritesOnly || exercise.isFavorite)
        }
    }

    /// Keys the rotation has neglected, in circle-of-fifths order, so the visual key picker can
    /// highlight them (§12: "rotation covering all keys, shows neglected keys"). A key is neglected
    /// when every one of its exercises (scoped to `family`) is either untouched or was last used
    /// before `staleAfter` (default 14 days) — i.e. it has fallen out of the rotation's recent reach.
    public static func neglectedKeys(among exercises: [WarmupExercise], family: InstrumentFamily? = nil,
                                      asOf now: Date = Date(), staleAfter: TimeInterval = 14 * 24 * 60 * 60) -> [String] {
        let scoped = candidates(exercises, family: family, favoritesOnly: false)
        return WarmupCatalog.circleOfFifths.filter { key in
            let inKey = scoped.filter { $0.key == key }
            guard !inKey.isEmpty else { return false } // no exercise exists for this key yet; nothing to neglect
            return inKey.allSatisfy { exercise in
                guard let lastUsedAt = exercise.lastUsedAt else { return true }
                return now.timeIntervalSince(lastUsedAt) >= staleAfter
            }
        }
    }

    /// The exercises to list under "Favorites" or "Last used" (§12), most-recent first.
    public static func lastUsed(among exercises: [WarmupExercise], family: InstrumentFamily? = nil, limit: Int = 5) -> [WarmupExercise] {
        Array(candidates(exercises, family: family, favoritesOnly: false)
            .filter { $0.lastUsedAt != nil }
            .sorted { ($0.lastUsedAt ?? .distantPast) > ($1.lastUsedAt ?? .distantPast) }
            .prefix(limit))
    }

    public static func favorites(among exercises: [WarmupExercise], family: InstrumentFamily? = nil) -> [WarmupExercise] {
        candidates(exercises, family: family, favoritesOnly: true).sorted { $0.name < $1.name }
    }
}
