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
    /// Counter layout has its own local, opt-in awake policy. A false entry also prevents the
    /// score preference from keeping a paused counter awake. One owner cannot release another.
    @ObservationIgnored private var counterScreenPolicies: [UUID: Bool] = [:]
    @ObservationIgnored private var previousIdleTimerDisabled: Bool?
    private var suspendedRepOwners: Set<UUID> = []
    var isRepInputSuspended: Bool { !suspendedRepOwners.isEmpty }

    /// Focus is a transient input guard. It never pauses, completes, or rewrites the active set.
    func setRepInputSuspended(_ suspended: Bool, ownerID: UUID) {
        if suspended { suspendedRepOwners.insert(ownerID) } else { suspendedRepOwners.remove(ownerID) }
        speech.setPracticeInputSuspended(isRepInputSuspended)
    }

    private func requireRepInput() throws {
        guard !isRepInputSuspended else { throw PracticeError.conflict("Leave score focus mode before recording or changing repetitions.") }
    }
    @ObservationIgnored private var checkpointTimer: Timer?
    @ObservationIgnored private var checkpointTask: Task<Void, Never>?
    /// SwiftUI can deliver the background pause's status change only after the app is active
    /// again. Remember that specific retained click so a late observer cannot silence it.
    @ObservationIgnored private var retainedBackgroundClickSetID: UUID?
    /// A player's explicit Click off wins over the set's initial click preference. Keep this
    /// local to the current set; changing tempo, pausing or reopening controls cannot undo it.
    @ObservationIgnored private var manualClickOffSetID: UUID?
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
            self.retainedBackgroundClickSetID = self.metronome.keepRunningWhenLocked && self.metronome.isPlaying
                ? self.store.activeSet?.id : nil
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
                if self.store.activeSet?.status == .running, self.checkpointTask == nil {
                    self.checkpointTask = Task { @MainActor [weak self] in
                        guard let self else { return }
                        defer { self.checkpointTask = nil }
                        do { try await self.store.checkpointPreparedAsync() } catch { /* Store retains write failures. */ }
                    }
                }
                self.updateScreenAwake()
                self.syncRecording() // Cheap, idempotent safety net alongside the `.onChange`-driven calls.
            }
        }
        checkpointTimer = timer
        RunLoop.main.add(timer, forMode: .common)
        syncRecording() // Covers relaunching mid-set (a paused set is restored active on launch).
    }

    /// A first-attempt grade must describe the tempo that was actually audible. Restore a
    /// mismatched click for the next attempt, but do not commit the just-reported repetition.
    func validateAttemptTempo(_ bpm: Double) throws {
        try requireRepInput()
        if metronome.isPlaying, abs(metronome.bpm - bpm) > 0.001 {
            metronome.setTempo(bpm)
            throw PracticeError.conflict("The click was restored to your set tempo. Repeat the passage before recording it.")
        }
    }

    /// The ledger commits first. Only its newly saved event may trigger transient feedback.
    @discardableResult
    func record(_ verdict: Verdict, eventID: UUID = UUID(), hands: String? = nil) throws -> Bool {
        try requireRepInput()
        let before = store.activeSet
        // Preserve the store's idempotent retry semantics even after a set has completed.
        if let before, metronome.isPlaying, abs(metronome.bpm - before.currentBPM) > 0.001 {
            let known = (store.state.history + [before]).contains { $0.attempts.contains { $0.id == eventID } }
            if !known {
                metronome.setTempo(before.currentBPM)
                throw PracticeError.conflict("The click was restored to your set tempo. Repeat the passage before recording it.")
            }
        }
        guard try store.record(verdict, hands: hands, eventID: eventID) else { return false }
        didRecord(verdict, eventID: eventID, before: before)
        return true
    }

    /// Camera input can await immutable ledger preparation without blocking score rendering.
    /// Input/context and audible tempo are checked again at the final atomic commit boundary.
    @discardableResult
    func recordPreparedAsync(_ verdict: Verdict, eventID: UUID = UUID(), hands: String? = nil,
                             canCommit: @MainActor () -> Bool = { true }) async throws -> Bool {
        try requireRepInput()
        let before = store.activeSet
        if let before, metronome.isPlaying, abs(metronome.bpm - before.currentBPM) > 0.001 {
            let known = (store.state.history + [before]).contains { $0.attempts.contains { $0.id == eventID } }
            if !known {
                metronome.setTempo(before.currentBPM)
                throw PracticeError.conflict("The click was restored to your set tempo. Repeat the passage before recording it.")
            }
        }
        guard try await store.recordPreparedAsync(verdict, hands: hands,
                expectedActiveSetID: before?.id ?? UUID(), eventID: eventID, canCommit: { [self] in
                    guard !isRepInputSuspended, !Task.isCancelled, canCommit() else { return false }
                    if let before, metronome.isPlaying, abs(metronome.bpm - before.currentBPM) > 0.001 {
                        metronome.setTempo(before.currentBPM)
                        return false
                    }
                    return true
                }) else { return false }
        let committedSetID = before?.id
        let ruleCanCommit = { @MainActor [self] in
            !Task.isCancelled && !isRepInputSuspended && store.activeSet?.id == committedSetID && canCommit()
        }
        if let set = store.activeSet, set.id == committedSetID {
            await checkR6SlowDownPreparedAsync(for: set, justRecorded: verdict, canCommit: ruleCanCommit)
        }
        if verdict == .reset {
            if store.activeSet?.id == committedSetID { feedback.stop() }
            return true
        }
        if let set = store.activeSet, set.id == committedSetID {
            await checkPulseCheckPreparedAsync(for: set, canCommit: ruleCanCommit)
        }
        if let before, let after = store.activeSet,
           after.attempts.last?.id == eventID {
            // A newer touch/voice attempt may have committed while a rule was prepared.
            // Its confirmation must not be replaced by this older camera event.
            confirmCommittedAttempt(before: before, after: after, verdict: verdict, eventID: eventID)
        }
        return true
    }

    private func didRecord(_ verdict: Verdict, eventID: UUID, before: ActiveSet?) {
        // R6's own replay counts a manual Reset exactly like a Sloppy (`evaluateR6SlowDown`: "3
        // *resets* in a row") toward its under-half-goal window, so this must run before the early
        // return below — a Reset that completes a qualifying run must still slow the set down.
        checkR6SlowDown(for: store.activeSet, justRecorded: verdict)
        if verdict == .reset { feedback.stop(); return }
        checkPulseCheck(for: store.activeSet)
        if let before, let after = store.activeSet {
            confirmCommittedAttempt(before: before, after: after, verdict: verdict, eventID: eventID)
        }
    }

    /// A cold grade uses one Store transaction; acknowledge its saved attempt without writing
    /// another repetition. The feedback service deduplicates the committed event identifier.
    func confirmCommittedAttempt(before: ActiveSet, after: ActiveSet, verdict: Verdict, eventID: UUID) {
        guard after.id == before.id,
              after.attempts.contains(where: { $0.id == eventID && $0.undoneAt == nil }),
              let feedbackVerdict = FeedbackVerdict(rawValue: verdict.rawValue) else { return }
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
    }

    /// A background pause checkpoints the ledger without silencing an explicitly requested
    /// locked-screen click, including an observer delivered after returning to the foreground.
    /// Manual foreground pauses, finished sets and absent sets still stop it.
    /// The optional foreground value lets lifecycle tests exercise the real view/runtime boundary.
    func refreshMetronome(for set: ActiveSet?, applicationIsActive: Bool? = nil) {
        if manualClickOffSetID != set?.id { manualClickOffSetID = nil }
        guard let set else { retainedBackgroundClickSetID = nil; metronome.stop(); return }
        if manualClickOffSetID == set.id {
            retainedBackgroundClickSetID = nil
            metronome.setTempo(set.currentBPM)
            metronome.stop()
            return
        }
        if let retained = retainedBackgroundClickSetID, retained != set.id {
            retainedBackgroundClickSetID = nil
            metronome.stop()
        }
        if set.status == .running {
            retainedBackgroundClickSetID = nil
            metronome.setTempo(set.currentBPM)
            if set.configuration.useMetronome && !metronome.isPlaying { metronome.start() }
        } else if set.status == .paused && metronome.keepRunningWhenLocked &&
                    (retainedBackgroundClickSetID == set.id ||
                     !(applicationIsActive ?? (UIApplication.shared.applicationState == .active))) {
            // Keep the existing click only; a background refresh never starts or resumes audio.
            if !metronome.isPlaying { retainedBackgroundClickSetID = nil }
            return
        } else { retainedBackgroundClickSetID = nil; metronome.stop() }
    }

    /// Explicit user transport, shared by Counter, Score, voice and the metronome sheet.
    /// The set's saved starting preference is retained; this override ends with the current set.
    func setMetronomePlaying(_ playing: Bool, for set: ActiveSet?) {
        if let set, set.status != .completed, set.status != .ended {
            manualClickOffSetID = playing ? nil : set.id
            metronome.setTempo(set.currentBPM)
        } else { manualClickOffSetID = nil }
        if playing { metronome.start() }
        else { retainedBackgroundClickSetID = nil; metronome.stop() }
    }

    func undo() throws {
        try requireRepInput()
        try store.undo()
        feedback.stop()
    }

    func reset() throws {
        try requireRepInput()
        try store.reset()
        feedback.stop()
    }

    func scoreAppeared(ownerID: UUID) {
        if scoreOwners.isEmpty { previousIdleTimerDisabled = UIApplication.shared.isIdleTimerDisabled }
        scoreOwners.insert(ownerID)
        updateScreenAwake()
    }

    func setCounterScreenPolicy(ownerID: UUID, enabled: Bool?, isRunning: Bool) {
        if let enabled { counterScreenPolicies[ownerID] = enabled && isRunning }
        else { counterScreenPolicies.removeValue(forKey: ownerID) }
        updateScreenAwake()
    }

    func scoreDisappeared(ownerID: UUID) {
        scoreOwners.remove(ownerID)
        counterScreenPolicies.removeValue(forKey: ownerID)
        setRepInputSuspended(false, ownerID: ownerID)
        updateScreenAwake()
        if scoreOwners.isEmpty { previousIdleTimerDisabled = nil }
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

    /// R6 (§11): demotes the tempo of the set actually in progress, not only a suggestion offered
    /// once it ends — the Mac reference (`src/`) already demotes within a set; the iPad previously
    /// only ever evaluated R6 in `computeAfterSet`/`nextStepLine`, after the set was already over, so
    /// a player grinding at an unreachable tempo got no relief until they stopped (see "(C) Audit.md").
    /// Only ever checked right after a Sloppy or Reset verdict: `evaluateR6SlowDown`'s own replay only
    /// grows its "consecutive under-half-goal" window on one of those two, so a Clean or Again cannot
    /// newly satisfy it — restricting this call to those two verdicts is what keeps a demotion firing
    /// exactly once per *new* qualifying run, not on every later attempt that leaves that window
    /// unchanged.
    private func checkR6SlowDown(for set: ActiveSet?, justRecorded verdict: Verdict) {
        guard verdict == .sloppy || verdict == .reset, let set, set.status == .running,
              set.configuration.passageID != nil else { return }
        let context = RuleContext(state: store.state, now: Date())
        guard let decision = PracticeRulesEngine.evaluateR6SlowDown(set: set, context: context),
              case let .tempoChange(newBPM) = decision.outcome, newBPM < set.currentBPM else { return }
        try? store.recordRuleEvent(decision.asRuleEvent(overridden: false))
        try? store.adjustActiveTempo(newBPM)
    }

    private func checkR6SlowDownPreparedAsync(for set: ActiveSet?, justRecorded verdict: Verdict,
                                            canCommit: @MainActor () -> Bool) async {
        guard verdict == .sloppy || verdict == .reset, let set, set.status == .running,
              set.configuration.passageID != nil else { return }
        let context = RuleContext(state: store.state, now: Date())
        guard let decision = PracticeRulesEngine.evaluateR6SlowDown(set: set, context: context),
              case let .tempoChange(newBPM) = decision.outcome, newBPM < set.currentBPM else { return }
        // The log and tempo are one durable change; a later set/input change fences both.
        _ = try? await store.applyPracticeRulePreparedAsync(decision, expectedSet: set, canCommit: canCommit)
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

    private func checkPulseCheckPreparedAsync(for set: ActiveSet?, canCommit: @MainActor () -> Bool) async {
        guard let set, set.status == .running, set.configuration.useMetronome,
              activePulseCheck == nil, pulseCheckSetID != set.id else { return }
        let context = RuleContext(state: store.state, now: Date())
        guard let decision = PracticeRulesEngine.evaluateR14PulseCheck(set: set, context: context),
              case .pulseCheck(let plan) = decision.outcome else { return }
        guard (try? await store.applyPracticeRulePreparedAsync(decision, expectedSet: set, canCommit: canCommit)) == true,
              canCommit(),
              store.activeSet?.id == set.id, store.activeSet?.status == .running,
              activePulseCheck == nil, pulseCheckSetID != set.id else { return }
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
        let barSeconds = metronome.barDurationSeconds
        let duration = barSeconds * Double(max(0, plan.totalBars))
        pulseCheckTask?.cancel()
        pulseCheckTask = Task { [weak self] in
            if duration > 0 { try? await Task.sleep(for: .seconds(duration)) }
            guard let self, !Task.isCancelled else { return }
            self.endPulseCheck()
        }
    }

    /// §11: "one-tap override, logged" — a player-initiated end to an in-flight check, restoring the
    /// click immediately rather than waiting out its remaining silent bars. `RuleEvent`s are
    /// append-only *with a unique id* (`validate(_:)` rejects two rows sharing one — `decision.id`
    /// was already spent by `checkPulseCheck`'s own fire-time log), so this is a fresh event, not
    /// `decision.asRuleEvent(overridden:)`: a second, distinct row for the same rule/passage/reason,
    /// an accurate record of "fired, then dismissed" rather than a rewrite of the fact it fired at
    /// all. A no-op when nothing is active.
    func dismissPulseCheck() {
        guard let decision = activePulseCheck else { return }
        try? store.recordRuleEvent(RuleEvent(ruleID: decision.ruleID, pieceID: decision.pieceID, passageID: decision.passageID,
                                              reasonText: decision.reason, overridden: true))
        endPulseCheck()
    }

    /// Idempotent: safe to call whether the check finished on its own (`startPulseCheck`'s timer) or
    /// the set moved on first (`syncPulseCheck`), or when nothing was in flight at all — always
    /// clears the metronome's dropout plan too (itself a cheap no-op when it is already `nil`, per
    /// `applyDropoutPlan`'s own guard), so a stale plan from an interrupted check (e.g. the app
    /// backgrounded mid-check) can never linger past the next call.
    private func endPulseCheck() {
        pulseCheckTask?.cancel(); pulseCheckTask = nil
        // `pulseCheckSetID` deliberately survives this call — it is what `checkPulseCheck`'s own
        // `pulseCheckSetID != set.id` guard uses to remember *which* set already had its one-per-
        // running-set check (§11 R14's own contract), not only which set a check is *currently*
        // showing for. Clearing it here (as this used to) let the same still-running set re-qualify
        // the moment its own check ended — on this timer, or on `syncPulseCheck` ending it early for
        // a pause — producing a second R14 event on one set (see "(C) Audit.md"). It is only ever
        // reset forward, in `startPulseCheck`, to the set a *new* check actually starts for.
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
        guard UIApplication.shared.applicationState == .active else {
            UIApplication.shared.isIdleTimerDisabled = false
            return
        }
        guard !scoreOwners.isEmpty else {
            if let previousIdleTimerDisabled { UIApplication.shared.isIdleTimerDisabled = previousIdleTimerDisabled }
            return
        }
        let scoreAwake = store.preferences.keepScreenAwake && scoreOwners.contains { counterScreenPolicies[$0] == nil }
        let counterAwake = scoreOwners.contains { counterScreenPolicies[$0] == true }
        UIApplication.shared.isIdleTimerDisabled = scoreAwake || counterAwake
    }

    private func observe(_ name: Notification.Name, action: @escaping @MainActor @Sendable () -> Void) {
        notifications.tokens.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated { action() }
        })
    }
}
