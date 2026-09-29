import AVFoundation
import Observation
import UIKit

/// On-device tuner (§13): taps the mic input, runs `PitchDetector` off the audio thread, and only
/// ever reports a pitch back to the player. It never records, stores or judges what was played —
/// no buffer here is retained past the detection pass, and nothing is written to disk.
@MainActor @Observable
final class TunerService {
    private(set) var isListening = false
    private(set) var frequencyHz: Double?
    private(set) var errorMessage: String?
    /// Concert-pitch reading of `frequencyHz` (never transposed — `Tuning.writtenPitch` is applied
    /// by the caller/view for a chosen instrument, the same measured cents either way).
    var concertReading: Tuning.NamedPitch? { frequencyHz.flatMap { Tuning.nearestPitch(forFrequency: $0) } }

    @ObservationIgnored private let engine = AVAudioEngine()
    @ObservationIgnored private let notifications = AudioNotificationBag()
    @ObservationIgnored private var smoother = TunerSmoother()
    @ObservationIgnored private var generation = 0

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
    }

    func start() {
        guard !isListening else { return }
        errorMessage = nil
        smoother.reset()
        frequencyHz = nil
        generation += 1
        let thisGeneration = generation
        do {
            try AudioSessionCoordinator.shared.acquire(.tuner)
            let input = engine.inputNode
            let format = input.inputFormat(forBus: 0)
            guard format.sampleRate > 0, format.channelCount > 0 else { throw TunerError.noInput }
            input.removeTap(onBus: 0)
            // The tap block itself must be `nonisolated`: AVAudioEngine invokes it synchronously on
            // its own realtime audio thread, never hopping through Swift concurrency first. A plain
            // closure written inside this `@MainActor` method infers `@MainActor` isolation from its
            // lexical context (installTap's block parameter carries no isolation of its own), which
            // makes the compiler insert a synchronous "am I on the main actor?" check at the very top
            // of the closure — and since the audio thread never is, that check traps on the first
            // buffer instead of hopping. `weakSelf` is `nonisolated(unsafe)` so the closure can carry
            // it across into the `@Sendable` block below without requiring `TunerService: Sendable`;
            // every actual read/write of `self`'s state still happens back on the main actor via
            // `MainActor.run`, same as before.
            nonisolated(unsafe) let weakSelf = self
            input.installTap(onBus: 0, bufferSize: 4_096, format: format) { @Sendable [weak weakSelf] buffer, _ in
                guard let channel = buffer.floatChannelData?[0] else { return }
                let samples = Array(UnsafeBufferPointer(start: channel, count: Int(buffer.frameLength)))
                let sampleRate = format.sampleRate
                Task.detached(priority: .userInitiated) {
                    let pitch = PitchDetector.detectPitch(samples: samples, sampleRate: sampleRate)
                    await MainActor.run { weakSelf?.ingest(pitch: pitch, generation: thisGeneration) }
                }
            }
            try engine.start()
            isListening = true
        } catch {
            engine.inputNode.removeTap(onBus: 0)
            AudioSessionCoordinator.shared.release(.tuner)
            errorMessage = "The tuner could not start: \(error.localizedDescription)"
        }
    }

    func stop() {
        guard isListening else { return }
        isListening = false
        generation += 1 // Any in-flight detection Task for the old session is now stale and ignored.
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        AudioSessionCoordinator.shared.release(.tuner)
        frequencyHz = nil
        smoother.reset()
    }

    func toggle() { isListening ? stop() : start() }

    /// Called back on the main actor once per input buffer; `generation` guards against a stale
    /// detection landing after `stop()`/a restart already moved on.
    private func ingest(pitch: Double?, generation: Int) {
        guard isListening, generation == self.generation else { return }
        frequencyHz = smoother.ingest(pitch)
    }

    private func stopWithReason(_ message: String) {
        let wasListening = isListening
        stop()
        if wasListening { errorMessage = message }
    }

    private enum TunerError: LocalizedError {
        case noInput
        var errorDescription: String? { "No microphone input is available." }
    }
}
