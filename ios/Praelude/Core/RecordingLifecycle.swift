import Foundation

/// What a per-set take recorder should do next (§13), decided purely from the current active set
/// and the recorder's own state — no AVFoundation here, so the tricky state-machine part of
/// "optional per-set recording" is fully unit-testable without a microphone or a device.
/// `PracticeRuntime`/`RecordingService` are a thin imperative wrapper around this.
public enum RecordingLifecycleAction: Equatable, Sendable {
    /// Begin a new take for this set (its id is the take's `setID`; `passageID` may be nil for a
    /// set with no passage).
    case start(setID: UUID, passageID: UUID?)
    case pause
    case resume
    /// Stop and keep the audio captured so far (the set finished, ended, or a different set began).
    case finish
    /// Stop and discard — the set that was recording no longer exists to attach the take to.
    case discard
    case none
}

public enum RecordingLifecycle {
    /// - Parameters:
    ///   - enabled: the user's "record my takes" preference.
    ///   - activeSetID: `store.activeSet?.id`.
    ///   - activeSetStatus: `store.activeSet?.status`.
    ///   - passageID: `store.activeSet?.configuration.passageID`.
    ///   - recordingSetID: the set id the recorder currently has an in-progress take for, or nil.
    ///   - isPaused: whether that in-progress take is currently paused.
    public static func action(enabled: Bool, activeSetID: UUID?, activeSetStatus: SetStatus?, passageID: UUID?,
                               recordingSetID: UUID?, isPaused: Bool) -> RecordingLifecycleAction {
        guard let recordingSetID else {
            // Nothing in progress: start only for a freshly running set, when the preference is on.
            guard enabled, let activeSetID, activeSetStatus == .running else { return .none }
            return .start(setID: activeSetID, passageID: passageID)
        }
        guard recordingSetID == activeSetID else {
            // The set we were recording is no longer the active one (it ended/changed underneath
            // us, or the preference was flipped off mid-set) — its audio is still worth keeping.
            return .finish
        }
        guard enabled else { return .finish }
        switch activeSetStatus {
        case .running: return isPaused ? .resume : .none
        case .paused: return isPaused ? .none : .pause
        case .completed, .ended: return .finish
        case nil: return .discard // The set vanished (e.g. history/backup replaced it) mid-take.
        }
    }
}
