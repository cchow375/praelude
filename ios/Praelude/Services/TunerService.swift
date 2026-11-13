import AVFoundation
import Observation
import UIKit

/// On-device tuner (§13): taps the mic input, runs `PitchDetector` off the audio thread, and only
/// ever reports a pitch back to the player. It never records, stores or judges what was played —
/// no buffer here is retained past the detection pass, and nothing is written to disk.
@MainActor @Observable
final class TunerService {
    private(set) var isListening = false
    private(set) var isPreparing = false
    private(set) var frequencyHz: Double?
    private(set) var errorMessage: String?
    /// Concert-pitch reading of `frequencyHz` (never transposed — `Tuning.writtenPitch` is applied
    /// by the caller/view for a chosen instrument, the same measured cents either way).
    var concertReading: Tuning.NamedPitch? { frequencyHz.flatMap { Tuning.nearestPitch(forFrequency: $0) } }

    @ObservationIgnored private var engine = AVAudioEngine()
    @ObservationIgnored private let detectionGate = InFlightWorkGate()
    @ObservationIgnored private let notifications = AudioNotificationBag()
    @ObservationIgnored private var smoother = TunerSmoother()
    @ObservationIgnored private var generation = 0
    @ObservationIgnored private var permissionTask: Task<Void, Never>?
    @ObservationIgnored private var tapInstalled = false

    init() {
        observeAudioNotification(AVAudioSession.interruptionNotification, into: notifications) { [weak self] notification in
            guard let raw = notification.interruptionType, AVAudioSession.InterruptionType(rawValue: raw) == .began else { return }
            self?.stopWithReason("The tuner stopped for an audio interruption.")
        }
        observeAudioNotification(UIApplication.didEnterBackgroundNotification, into: notifications) { [weak self] _ in self?.stop() }
        observeAudioNotification(AVAudioSession.routeChangeNotification, into: notifications) { [weak self] notification in
            guard let raw = notification.routeReason, AVAudioSession.RouteChangeReason(rawValue: raw) == .oldDeviceUnavailable else { return }
            self?.stopWithReason("Audio input disconnected. Check your microphone, then tap Listen.")
        }
        observeAudioNotification(AVAudioSession.mediaServicesWereResetNotification, into: notifications) { [weak self] _ in
            self?.stopWithReason("Audio was reset. Tap Listen to start again.")
            self?.engine = AVAudioEngine()
        }
        observeAudioNotification(.AVAudioEngineConfigurationChange, into: notifications) { [weak self] notification in
            guard let self, notification.sourceID == ObjectIdentifier(self.engine), self.isListening,
                  !self.engine.isRunning else { return }
            self.stopWithReason("The microphone changed. Tap Listen to start again.")
        }
    }

    func start() {
        guard !isListening, !isPreparing else { return }
        if let issue = AudioInputPermissions.configurationIssue(requiresSpeech: false) {
            errorMessage = issue
            return
        }
        errorMessage = nil
        isPreparing = true
        smoother.reset()
        frequencyHz = nil
        generation += 1
        let thisGeneration = generation
        permissionTask = Task { @MainActor [weak self] in
            let allowed = await AudioInputPermissions.microphoneGranted()
            guard let self, !Task.isCancelled, self.generation == thisGeneration, self.isPreparing else { return }
            self.isPreparing = false
            guard allowed else {
                self.errorMessage = "Allow the microphone for Praelude in Settings to use the tuner."
                return
            }
            self.beginListening(generation: thisGeneration)
        }
    }

    private func beginListening(generation thisGeneration: Int) {
        engine = AVAudioEngine()
        do {
            try AudioSessionCoordinator.shared.acquire(.tuner)
            let input = engine.inputNode
            let format = input.outputFormat(forBus: 0)
            guard AVAudioSession.sharedInstance().isInputAvailable,
                  format.sampleRate.isFinite, format.sampleRate > 0, format.channelCount > 0 else { throw TunerError.noInput }
            // The tap block itself must be `nonisolated`: AVAudioEngine invokes it synchronously on
            // its own realtime audio thread, never hopping through Swift concurrency first. A plain
            // closure written inside this `@MainActor` method infers `@MainActor` isolation from its
            // lexical context (installTap's block parameter carries no isolation of its own), which
            // makes the compiler insert a synchronous "am I on the main actor?" check at the very top
            // of the closure — and since the audio thread never is, that check traps on the first
            // buffer instead of hopping. The main-actor-isolated service reference is Sendable; the tap captures it weakly,
            // and never reads its state on the audio thread.
            // every actual read/write of `self`'s state still happens back on the main actor via
            // `MainActor.run`, same as before.
            let weakSelf = self
            // A slower device must not queue one CPU-heavy detector per microphone buffer. Keep
            // at most one window in flight; dropped windows are replaced by fresh live input.
            let detectionGate = self.detectionGate
            input.installTap(onBus: 0, bufferSize: 4_096, format: format) { @Sendable [weak weakSelf] buffer, _ in
                guard let channel = buffer.floatChannelData?[0], detectionGate.tryBegin() else { return }
                let samples = Array(UnsafeBufferPointer(start: channel, count: Int(buffer.frameLength)))
                let sampleRate = format.sampleRate
                Task.detached(priority: .userInitiated) {
                    defer { detectionGate.finish() }
                    let pitch = PitchDetector.detectPitch(samples: samples, sampleRate: sampleRate)
                    await MainActor.run { weakSelf?.ingest(pitch: pitch, generation: thisGeneration) }
                }
            }
            tapInstalled = true
            try engine.start()
            isListening = true
        } catch {
            engine.stop()
            removeInputTap()
            AudioSessionCoordinator.shared.release(.tuner)
            errorMessage = "The tuner could not start: \(error.localizedDescription)"
        }
    }

    func stop() {
        isListening = false
        isPreparing = false
        permissionTask?.cancel()
        permissionTask = nil
        generation += 1 // Any in-flight detection Task for the old session is now stale and ignored.
        engine.stop()
        removeInputTap()
        AudioSessionCoordinator.shared.release(.tuner)
        frequencyHz = nil
        smoother.reset()
    }

    func toggle() { isListening || isPreparing ? stop() : start() }

    private func removeInputTap() {
        guard tapInstalled else { return }
        engine.inputNode.removeTap(onBus: 0)
        tapInstalled = false
    }

    /// Called back on the main actor once per input buffer; `generation` guards against a stale
    /// detection landing after `stop()`/a restart already moved on.
    private func ingest(pitch: Double?, generation: Int) {
        guard isListening, generation == self.generation else { return }
        frequencyHz = smoother.ingest(pitch)
    }

    private func stopWithReason(_ message: String) {
        let wasListening = isListening || isPreparing
        stop()
        if wasListening { errorMessage = message }
    }

    private enum TunerError: LocalizedError {
        case noInput
        var errorDescription: String? { "No microphone input is available." }
    }
}
