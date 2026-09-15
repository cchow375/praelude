import Observation
import UIKit

/// App-wide timing and lifecycle ownership survives closing an individual score window.
@MainActor @Observable
final class PracticeRuntime {
    let feedback: FeedbackService
    @ObservationIgnored private let store: PracticeStore
    @ObservationIgnored private let metronome: MetronomeService
    @ObservationIgnored private let speech: SpeechCommandService
    @ObservationIgnored private let notifications = AudioNotificationBag()
    @ObservationIgnored private var scoreOwners: Set<UUID> = []
    @ObservationIgnored private var checkpointTimer: Timer?

    init(store: PracticeStore, metronome: MetronomeService, speech: SpeechCommandService, feedback: FeedbackService = .shared) {
        self.store = store
        self.metronome = metronome
        self.speech = speech
        self.feedback = feedback
        feedback.prime(existingAttemptIDs: (store.state.history + [store.activeSet].compactMap { $0 }).flatMap(\.attempts).map(\.id))
        observe(UIApplication.didEnterBackgroundNotification) { [weak self] in
            guard let self else { return }
            self.metronome.stop()
            self.speech.stop()
            self.feedback.stop()
            // PracticeStore retains a failed durable mutation in errorMessage; never silently
            // change its in-memory ledger when writing the pause failed.
            do { try self.store.pause() } catch { /* Store already exposes the failure. */ }
            UIApplication.shared.isIdleTimerDisabled = false
        }
        observe(UIApplication.willEnterForegroundNotification) { [weak self] in self?.updateScreenAwake() }
        observe(UIApplication.didBecomeActiveNotification) { [weak self] in self?.updateScreenAwake() }
        observe(UIApplication.willResignActiveNotification) { UIApplication.shared.isIdleTimerDisabled = false }

        let timer = Timer(timeInterval: 15, repeats: true) { [weak self] timer in
            guard self != nil else { timer.invalidate(); return }
            MainActor.assumeIsolated {
                guard let self else { return }
                guard UIApplication.shared.applicationState == .active else { return }
                if self.store.activeSet?.status == .running {
                    do { try self.store.checkpoint() } catch { /* Store already exposes the failure. */ }
                }
                self.updateScreenAwake()
            }
        }
        checkpointTimer = timer
        RunLoop.main.add(timer, forMode: .common)
    }

    /// The ledger commits first. Only its newly saved event may trigger transient feedback.
    @discardableResult
    func record(_ verdict: Verdict, eventID: UUID = UUID()) throws -> Bool {
        let before = store.activeSet
        // Preserve the store's idempotent retry semantics even after a set has completed.
        if let before, metronome.isPlaying, abs(metronome.bpm - before.currentBPM) > 0.001 {
            let known = (store.state.history + [before]).contains { $0.attempts.contains { $0.id == eventID } }
            if !known {
                metronome.setTempo(before.currentBPM)
                throw PracticeError.conflict("The click was restored to your set tempo. Repeat the passage before recording it.")
            }
        }
        guard try store.record(verdict, eventID: eventID) else { return false }
        if verdict == .reset { feedback.stop(); return true }
        guard let before, let after = store.activeSet, after.id == before.id,
              after.attempts.contains(where: { $0.id == eventID && $0.undoneAt == nil }),
              let feedbackVerdict = FeedbackVerdict(rawValue: verdict.rawValue) else { return true }
        let effective = after.attempts.filter { $0.undoneAt == nil && $0.verdict != .reset }
        let setbacks = effective.reversed().prefix { $0.verdict == .sloppy || $0.verdict == .again }.count
        feedback.emit(PracticeFeedbackInput(
            attemptID: eventID, setID: after.id, verdict: feedbackVerdict,
            progressCount: after.progressCount, targetCount: after.requiredCount, ordinal: effective.count,
            consecutiveSetbacks: setbacks, stageAdvanced: after.stageIndex > before.stageIndex,
            tempoAdvanced: after.currentBPM > before.currentBPM,
            setCompleted: after.isComplete && !before.isComplete,
            hasVariants: !after.configuration.stages.isEmpty, nextVariant: after.currentStage?.name,
            bpm: after.currentBPM
        ))
        return true
    }

    func undo() throws {
        try store.undo()
        feedback.stop()
    }

    func reset() throws {
        try store.reset()
        feedback.stop()
    }

    func scoreAppeared(ownerID: UUID) {
        scoreOwners.insert(ownerID)
        updateScreenAwake()
    }

    func scoreDisappeared(ownerID: UUID) {
        scoreOwners.remove(ownerID)
        updateScreenAwake()
    }

    func updateScreenAwake() {
        UIApplication.shared.isIdleTimerDisabled = store.preferences.keepScreenAwake
            && !scoreOwners.isEmpty && UIApplication.shared.applicationState == .active
    }

    private func observe(_ name: Notification.Name, action: @escaping @MainActor @Sendable () -> Void) {
        notifications.tokens.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated { action() }
        })
    }
}
