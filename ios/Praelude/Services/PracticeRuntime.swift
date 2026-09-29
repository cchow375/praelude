import Observation
import UIKit

/// App-wide timing and lifecycle ownership survives closing an individual score window.
@MainActor @Observable
final class PracticeRuntime {
    let feedback: FeedbackService
    @ObservationIgnored private let store: PracticeStore
    @ObservationIgnored private let metronome: MetronomeService
    @ObservationIgnored private let speech: SpeechCommandService
    @ObservationIgnored private let recording: RecordingService
    @ObservationIgnored private let notifications = AudioNotificationBag()
    @ObservationIgnored private var scoreOwners: Set<UUID> = []
    @ObservationIgnored private var checkpointTimer: Timer?
    /// R14 pulse check (§11): the decision currently in effect, or `nil` when the click plays every
    /// bar as usual. The HUD shows `.reason` verbatim, the same "one dry human-readable line" every
    /// other rule already surfaces (`NextStepAndSuggestionsView`); the verdict for whatever attempt
    /// happens during one stays entirely the player's own judgement — nothing here reads or grades
    /// audio, matching every other rule in this engine.
    private(set) var activePulseCheck: Decision?
    @ObservationIgnored private var pulseCheckSetID: UUID?
    @ObservationIgnored private var pulseCheckTask: Task<Void, Never>?

    init(store: PracticeStore, metronome: MetronomeService, speech: SpeechCommandService,
         recording: RecordingService, feedback: FeedbackService = .shared) {
        self.store = store
        self.metronome = metronome
        self.speech = speech
        self.recording = recording
        self.feedback = feedback
        feedback.prime(existingAttemptIDs: (store.state.history + [store.activeSet].compactMap { $0 }).flatMap(\.attempts).map(\.id))
        observe(UIApplication.didEnterBackgroundNotification) { [weak self] in
            guard let self else { return }
            // The metronome owns its own backgrounding decision (§13 "keep running when locked");
            // stopping it here unconditionally would silence that preference. Speech recognition
            // and reward feedback have no such preference, so they always stop.
            if !self.metronome.keepRunningWhenLocked { self.metronome.stop() }
            self.speech.stop()
            self.feedback.stop()
            self.endPulseCheck()
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
                self.syncRecording() // Cheap, idempotent safety net alongside the `.onChange`-driven calls.
            }
        }
        checkpointTimer = timer
        RunLoop.main.add(timer, forMode: .common)
        syncRecording() // Covers relaunching mid-set (a paused set is restored active on launch).
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
        checkPulseCheck(for: store.activeSet)
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

    /// Drives `RecordingService` from `RecordingLifecycle`'s pure decision (§13 "optional per-set
    /// recording"). Called from the `.onChange`s on `store.activeSet` at the app root — active-set
    /// mutations happen through `PracticeStore` methods Views call directly (`startSet`/`pause`/
    /// `resume`/`endSet`/`endSession`), not through this runtime, so reacting to the resulting
    /// state (rather than wrapping every call site) is both the least invasive integration and the
    /// one place already used for this kind of cross-cutting sync (see `updateScreenAwake`).
    func syncRecording() {
        let action = RecordingLifecycle.action(
            enabled: recording.takesEnabled, activeSetID: store.activeSet?.id, activeSetStatus: store.activeSet?.status,
            passageID: store.activeSet?.configuration.passageID, recordingSetID: recording.recordingSetID, isPaused: recording.isPaused
        )
        switch action {
        case .start(let setID, let passageID): recording.startTake(passageID: passageID, setID: setID, in: store)
        case .pause: recording.pauseTake()
        case .resume: recording.resumeTake()
        case .finish: recording.finishTake(in: store)
        case .discard: recording.discardTake(in: store)
        case .none: break
        }
    }

    /// R14 (§11): after any recorded, non-reset attempt, offers a pulse check at most once per
    /// *running set* — not once per attempt, since staying near performance tempo for many reps in
    /// the same set should not keep re-silencing the click every single rep; `pulseCheckSetID` is the
    /// guard, cleared only by `syncPulseCheck()` once this set stops being the live running one.
    /// Requires `useMetronome`: a set practiced without the click has nothing for R14 to drop out of.
    /// Deliberately does *not* also require `metronome.isPlaying` at this exact instant — applying the
    /// plan is safe either way (`MetronomeService.applyDropoutPlan`'s own doc comment: it only skips
    /// the live audio rebuild while stopped, never the stored plan itself), it takes effect the
    /// moment the click is next actually playing, and `startPulseCheck`'s own duration timer clears
    /// it again on schedule regardless — so a momentarily-silenced metronome cannot leave this stuck.
    private func checkPulseCheck(for set: ActiveSet?) {
        guard let set, set.status == .running, set.configuration.useMetronome,
              activePulseCheck == nil, pulseCheckSetID != set.id else { return }
        let context = RuleContext(state: store.state, now: Date())
        guard let decision = PracticeRulesEngine.evaluateR14PulseCheck(set: set, context: context),
              case .pulseCheck(let plan) = decision.outcome else { return }
        try? store.recordRuleEvent(decision.asRuleEvent(overridden: false))
        startPulseCheck(decision, plan: plan, setID: set.id)
    }

    private func startPulseCheck(_ decision: Decision, plan: PulseCheckPlan, setID: UUID) {
        activePulseCheck = decision
        pulseCheckSetID = setID
        metronome.applyDropoutPlan(plan.metronomeDropoutPlan)
        // Bar duration at the tempo/meter this plan started under — matches `MetronomeClock`'s own
        // bar-frames math (`60 / bpm` seconds per beat, times the bar's beat count). A mid-check
        // tempo/meter change is a rare edge case this timer does not chase; the worst case is the
        // HUD/dropout clearing a little early or late, never a stuck or crashing state, and
        // `syncPulseCheck()` still clears it immediately once the set itself stops being current.
        let beatsPerBar = max(1, metronome.beatsPerBar)
        let barSeconds = metronome.bpm > 0 ? 60.0 / metronome.bpm * Double(beatsPerBar) : 0
        let duration = barSeconds * Double(max(0, plan.totalBars))
        pulseCheckTask?.cancel()
        pulseCheckTask = Task { [weak self] in
            if duration > 0 { try? await Task.sleep(for: .seconds(duration)) }
            guard let self, !Task.isCancelled else { return }
            self.endPulseCheck()
        }
    }

    /// Idempotent: safe to call whether the check finished on its own (`startPulseCheck`'s timer) or
    /// the set moved on first (`syncPulseCheck`), or when nothing was in flight at all — always
    /// clears the metronome's dropout plan too (itself a cheap no-op when it is already `nil`, per
    /// `applyDropoutPlan`'s own guard), so a stale plan from an interrupted check (e.g. the app
    /// backgrounded mid-check) can never linger past the next call.
    private func endPulseCheck() {
        pulseCheckTask?.cancel(); pulseCheckTask = nil
        pulseCheckSetID = nil
        activePulseCheck = nil
        metronome.applyDropoutPlan(nil)
    }

    /// Mirrors `syncRecording()`'s own reasoning (see its doc comment): active-set mutations happen
    /// through `PracticeStore` methods Views call directly, not through this runtime, so reacting to
    /// the resulting state is the least invasive integration. Call this from the same `.onChange`s as
    /// `syncRecording()`. A no-op whenever no pulse check is in flight.
    func syncPulseCheck() {
        guard let pulseCheckSetID else { return }
        if store.activeSet?.id != pulseCheckSetID || store.activeSet?.status != .running { endPulseCheck() }
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
