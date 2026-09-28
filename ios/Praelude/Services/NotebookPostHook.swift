import SwiftUI

/// The "Post as Note" hook (§15 → §5a): the extension point a social track's implementation fills in
/// to actually publish a notebook entry to the friends feed's Notes surface. No networking happens
/// here — `NotebookShareComposer` (Core) composes the text; this file only defines the interface and
/// carries it through the environment, so `NotebookView` can offer "Post as Note" without knowing
/// whether a real implementation exists yet.
@MainActor protocol NotebookPostHook {
    /// Sends `entry`, already composed to `summary` (`NotebookShareComposer.summary(for:pieceTitle:)`),
    /// as a Note. Throws to report a failure back to the caller.
    func post(_ entry: NotebookEntry, summary: String) async throws
}

private struct NotebookPostHookKey: EnvironmentKey {
    // `nonisolated(unsafe)`: always `nil` here (a compile-time constant, never mutated), but the
    // `@MainActor` protocol's existential isn't provably `Sendable`, and `EnvironmentKey.defaultValue`
    // itself is a nonisolated static requirement.
    nonisolated(unsafe) static let defaultValue: (any NotebookPostHook)? = nil
}

extension EnvironmentValues {
    /// `nil` until a social track installs a real implementation; `NotebookView` disables "Post as
    /// Note" rather than pretending to send anything when this is unset.
    var notebookPostHook: (any NotebookPostHook)? {
        get { self[NotebookPostHookKey.self] }
        set { self[NotebookPostHookKey.self] = newValue }
    }
}
