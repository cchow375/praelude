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
        for index in state.pieces.indices {
            if state.pieces[index].updatedAt == .praeludeEpochSentinel { state.pieces[index].updatedAt = date }
            if state.pieces[index].lastPageUpdatedAt == .praeludeEpochSentinel { state.pieces[index].lastPageUpdatedAt = date }
        }
        for index in state.passages.indices {
            if state.passages[index].createdAt == .praeludeEpochSentinel { state.passages[index].createdAt = date }
            if state.passages[index].updatedAt == .praeludeEpochSentinel { state.passages[index].updatedAt = date }
        }
        for index in state.inkStrokes.indices {
            if state.inkStrokes[index].createdAt == .praeludeEpochSentinel { state.inkStrokes[index].createdAt = date }
            if state.inkStrokes[index].updatedAt == .praeludeEpochSentinel { state.inkStrokes[index].updatedAt = date }
        }
        state.schemaVersion = 3
        return state
    }
}
