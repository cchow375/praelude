import Foundation

extension Date {
    /// Marks a sync-metadata field decoded from pre-schema3 data that never carried one. No genuine
    /// record is created at the Unix epoch, so this is safe to use as a decode-time placeholder;
    /// `migrateToSchema3` sweeps every occurrence to the real migration timestamp before the state
    /// is ever published or written back to disk.
    static let praeludeEpochSentinel = Date(timeIntervalSince1970: 0)
}

enum SchemaMigration {
    /// Losslessly upgrades a decoded schema1 or schema2 `LibraryState` to schema3. Every schema2
    /// field already decodes into its schema3 shape for free (see each type's `decodeIfPresent`
    /// fallbacks); the two exceptions handled here are `scoreDrawings` → `inkStrokes`, whose
    /// shape genuinely changed, and the sync-metadata fields schema1/2 never had at all, which
    /// `LibraryState.init(from:)` decoded as `.praeludeEpochSentinel` and this function now stamps
    /// with the single, consistent timestamp of this migration event.
    ///
    /// Pure and idempotent: migrating an already-schema3 state (no sentinels left) only sets
    /// `schemaVersion = 3`, which it already was.
    static func migrateToSchema3(_ state: LibraryState, at date: Date) -> LibraryState {
        var state = state
        // `decodeBackup`/`restoreBackup` call this on every state they read, already-schema3 or not,
        // relying on it staying a no-op past this point for one already at schema3. The sentinel
        // sweeps below are naturally idempotent (a schema3 state has no sentinels left to find), but
        // `ruleSettings`/`rewardsState`/`profile` carry no sentinel to check — the wall-clock defaults
        // they decode with only need restamping when this state genuinely predates schema3.
        let wasPreSchema3 = state.schemaVersion < 3
        for index in state.pieces.indices {
            if state.pieces[index].updatedAt == .praeludeEpochSentinel { state.pieces[index].updatedAt = date }
            if state.pieces[index].lastPageUpdatedAt == .praeludeEpochSentinel { state.pieces[index].lastPageUpdatedAt = date }
        }
        for index in state.passages.indices {
            sweepSentinel(&state.passages[index], at: date)
        }
        for index in state.inkStrokes.indices {
            if state.inkStrokes[index].createdAt == .praeludeEpochSentinel { state.inkStrokes[index].createdAt = date }
            if state.inkStrokes[index].updatedAt == .praeludeEpochSentinel { state.inkStrokes[index].updatedAt = date }
        }
        // A `PracticeConfiguration.passageSnapshot` is a full copy of a `Passage` taken when its set
        // started, stored inside `activeSet`/`history`, not inside `state.passages` — the sweep above
        // never reaches it, so it needs its own pass (§ "Migration" doc: "sweeps the whole decoded
        // state", which this snapshot is part of).
        if state.activeSet != nil { sweepSentinel(&state.activeSet!.configuration.passageSnapshot, at: date) }
        for index in state.history.indices {
            sweepSentinel(&state.history[index].configuration.passageSnapshot, at: date)
        }
        // `ruleSettings`/`rewardsState`/`profile` are wholly new schema3 collections (see
        // "(C) Schema3.md"): a pre-schema3 source never had these keys at all, so
        // `LibraryState.init(from:)` always constructs them fresh via their own default
        // initializer, which stamps `updatedAt`/`joinDate` with the wall clock at decode time
        // rather than this migration's clock. Restamp them here so migration stays deterministic
        // and every invented timestamp — like the sentinel-backed fields above — comes from the
        // single `date` this function was given, never `Date()`. Gated on `wasPreSchema3`: an
        // already-schema3 state's values here are real data, not migration-invented defaults.
        if wasPreSchema3 {
            state.ruleSettings.updatedAt = date
            state.rewardsState.updatedAt = date
            state.profile.updatedAt = date
            state.profile.joinDate = date
        }
        state.schemaVersion = 3
        return state
    }

    private static func sweepSentinel(_ passage: inout Passage?, at date: Date) {
        guard passage != nil else { return }
        sweepSentinel(&passage!, at: date)
    }
    private static func sweepSentinel(_ passage: inout Passage, at date: Date) {
        if passage.createdAt == .praeludeEpochSentinel { passage.createdAt = date }
        if passage.updatedAt == .praeludeEpochSentinel { passage.updatedAt = date }
    }
}
