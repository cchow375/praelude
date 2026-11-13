import AVFoundation
import Observation
import UIKit

/// A sustained reference tone at any pitch (§13). Same buffer-loop trick as `MetronomeService`:
/// `DronePattern` renders an exact-integer-cycle-count buffer, so looping it is bit-continuous —
/// no click or wobble at the seam — and the audio engine's own sample clock (not a repeating
/// timer) keeps it playing, so it can run alongside the metronome without either fighting for
/// scheduling. Never analyzes anything; it only produces a tone for the player to tune against.
@MainActor @Observable
final class DroneService {
    private(set) var isPlaying = false
    private(set) var errorMessage: String?
    var frequencyHz: Double {
        get { storedFrequencyHz }
        set {
            guard newValue.isFinite else { return }
            let value = min(4_000, max(20, newValue))
            guard value != storedFrequencyHz else { return }
            storedFrequencyHz = value
            rebuildIfPlaying()
        }
    }
    var timbre: DroneTimbre {
        get { storedTimbre }
        set {
            guard newValue != storedTimbre else { return }
            storedTimbre = newValue
            rebuildIfPlaying()
        }
    }
    var volume: Double {
        get { storedVolume }
        set {
            guard newValue.isFinite else { return }
            storedVolume = min(1, max(0, newValue))
            player.volume = Float(storedVolume)
        }
    }
    /// The nearest named pitch to the current frequency, for display (e.g. "A4 · 440 Hz").
    var namedPitch: Tuning.NamedPitch? { Tuning.nearestPitch(forFrequency: storedFrequencyHz) }

    @ObservationIgnored private var storedFrequencyHz = Tuning.defaultReferenceA4
    @ObservationIgnored private var storedTimbre = DroneTimbre.sine
    @ObservationIgnored private var storedVolume = 0.5
    @ObservationIgnored private let engine = AVAudioEngine()
    @ObservationIgnored private let player = AVAudioPlayerNode()
    @ObservationIgnored private let notifications = AudioNotificationBag()
    @ObservationIgnored private var rebuilding = false

    init() {
        engine.attach(player)
        player.volume = Float(storedVolume)
        AudioSessionCoordinator.shared.observeConfiguration(
            willChange: { [weak self] in self?.pauseEngineForConfiguration() },
            didChange: { [weak self] in self?.resumeEngineAfterConfiguration() }
        )
        observeAudioNotification(AVAudioSession.interruptionNotification, into: notifications) { [weak self] notification in
            guard let raw = notification.interruptionType, AVAudioSession.InterruptionType(rawValue: raw) == .began else { return }
            self?.stopWithReason("The drone stopped for an audio interruption. Tap Play when ready.")
        }
        observeAudioNotification(UIApplication.didEnterBackgroundNotification, into: notifications) { [weak self] _ in self?.stop() }
        observeAudioNotification(AVAudioSession.routeChangeNotification, into: notifications) { [weak self] notification in
            guard let raw = notification.routeReason, AVAudioSession.RouteChangeReason(rawValue: raw) == .oldDeviceUnavailable else { return }
            self?.stopWithReason("Audio output disconnected. Check your output, then tap Play.")
        }
        observeAudioNotification(.AVAudioEngineConfigurationChange, into: notifications) { [weak self] notification in
            guard let self, notification.sourceID == ObjectIdentifier(self.engine),
                  self.isPlaying, !self.engine.isRunning, !self.rebuilding else { return }
            self.resumeEngineAfterConfiguration()
        }
    }

    func start() {
        guard !isPlaying else { return }
        errorMessage = nil
        do {
            try AudioSessionCoordinator.shared.acquire(.drone)
            try playTone()
            isPlaying = true
        } catch {
            player.stop(); engine.stop()
            AudioSessionCoordinator.shared.release(.drone)
            errorMessage = "The drone could not start: \(error.localizedDescription)"
        }
    }

    func stop() {
        guard isPlaying else { return }
        isPlaying = false
        player.stop()
        engine.stop()
        AudioSessionCoordinator.shared.release(.drone)
    }

    func toggle() { isPlaying ? stop() : start() }

    /// Step by one equal-tempered semitone (a musician-friendly control over a raw Hz slider).
    func stepSemitone(_ delta: Int) {
        guard let midi = Tuning.midiNumber(forFrequency: storedFrequencyHz),
              let stepped = Tuning.frequency(forMIDI: (midi.rounded()) + Double(delta)) else { return }
        frequencyHz = stepped
    }

    private func rebuildIfPlaying() {
        guard isPlaying, !rebuilding else { return }
        do { try playTone() }
        catch { stopWithReason("The drone could not update: \(error.localizedDescription)") }
    }

    private func playTone() throws {
        rebuilding = true
        defer { rebuilding = false }
        player.stop()
        engine.stop()
        engine.disconnectNodeOutput(player)
        let sampleRate = max(8_000, AVAudioSession.sharedInstance().sampleRate)
        guard let format = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 1) else {
            throw DroneError.invalidAudioFormat
        }
        let pattern = try DronePattern(frequencyHz: storedFrequencyHz, sampleRate: sampleRate, timbre: storedTimbre)
        let samples = pattern.renderSamples()
        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(samples.count)),
              let channel = buffer.floatChannelData?[0] else { throw DroneError.invalidAudioFormat }
        buffer.frameLength = AVAudioFrameCount(samples.count)
        samples.withUnsafeBufferPointer { source in
            if let base = source.baseAddress { channel.update(from: base, count: source.count) }
        }
        engine.connect(player, to: engine.mainMixerNode, format: format)
        engine.prepare()
        try engine.start()
        player.scheduleBuffer(buffer, at: nil, options: .loops)
        player.volume = Float(storedVolume)
        player.play()
    }

    private func pauseEngineForConfiguration() {
        guard isPlaying else { return }
        player.stop()
        engine.stop()
    }

    private func resumeEngineAfterConfiguration() {
        guard isPlaying, !rebuilding else { return }
        do { try playTone() }
        catch { stopWithReason("Audio output changed. Tap Play to restart the drone.") }
    }

    private func stopWithReason(_ message: String) {
        let wasPlaying = isPlaying
        stop()
        if wasPlaying { errorMessage = message }
    }

    private enum DroneError: LocalizedError {
        case invalidAudioFormat
        var errorDescription: String? { "No compatible audio output is available." }
    }
}
