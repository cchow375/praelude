import AVFoundation
import Observation
import UIKit

/// Rewards only fresh durable verdict IDs. Audio/haptics are optional and never affect a save.
@MainActor @Observable
final class FeedbackService {
    static let shared = FeedbackService()
    private(set) var latest: PracticeFeedbackEvent?
    private(set) var soundError: String?
    private var storedSoundEnabled = true
    private var storedHapticsEnabled = true
    private var storedVolume = 0.4
    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private var gate = PracticeFeedbackGate()
    @ObservationIgnored private var player: AVAudioPlayer?
    @ObservationIgnored private var clearTask: Task<Void, Never>?
    @ObservationIgnored private var releaseAudioTask: Task<Void, Never>?

    /// Read the existing AppStorage preference fresh so Settings changes take effect immediately.
    var isEnabled: Bool {
        get { defaults.object(forKey: "ios.feedback") == nil || defaults.bool(forKey: "ios.feedback") }
        set { defaults.set(newValue, forKey: "ios.feedback"); if !newValue { stop() } }
    }
    var soundsEnabled: Bool {
        get { storedSoundEnabled }
        set { storedSoundEnabled = newValue; defaults.set(newValue, forKey: "praelude.ios.feedback.sounds"); if !newValue { stopSound() } }
    }
    var hapticsEnabled: Bool {
        get { storedHapticsEnabled }
        set { storedHapticsEnabled = newValue; defaults.set(newValue, forKey: "praelude.ios.feedback.haptics") }
    }
    var volume: Double {
        get { storedVolume }
        set {
            guard newValue.isFinite else { return }
            storedVolume = min(1, max(0, newValue))
            defaults.set(storedVolume, forKey: "praelude.ios.feedback.volume")
        }
    }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        if defaults.object(forKey: "praelude.ios.feedback.sounds") != nil { storedSoundEnabled = defaults.bool(forKey: "praelude.ios.feedback.sounds") }
        if defaults.object(forKey: "praelude.ios.feedback.haptics") != nil { storedHapticsEnabled = defaults.bool(forKey: "praelude.ios.feedback.haptics") }
        if let volume = defaults.object(forKey: "praelude.ios.feedback.volume") as? Double, volume.isFinite { storedVolume = min(1, max(0, volume)) }
    }

    func prime(existingAttemptIDs: [UUID]) { gate.prime(existingAttemptIDs) }

    func emit(_ input: PracticeFeedbackInput) {
        guard let event = gate.accept(input) else { return }
        guard isEnabled else { stop(); return }
        clearTask?.cancel()
        latest = event
        if hapticsEnabled {
            if event.kind == .set || event.kind == .chain {
                UINotificationFeedbackGenerator().notificationOccurred(.success)
            } else {
                UIImpactFeedbackGenerator(style: event.kind.isCompletion ? .medium : .soft)
                    .impactOccurred(intensity: event.intensity)
            }
        }
        if soundsEnabled, volume > 0 { playSound(event) }
        clearTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .milliseconds(event.kind.isCompletion ? 1_800 : 1_000))
            guard !Task.isCancelled, self?.latest?.id == event.id else { return }
            self?.latest = nil
        }
    }

    func stop() { clearTask?.cancel(); clearTask = nil; latest = nil; stopSound() }

    private func playSound(_ event: PracticeFeedbackEvent) {
        releaseAudioTask?.cancel()
        player?.stop()
        do {
            let sampleRate = 48_000.0
            let samples = try PracticeFeedbackPCM.render(event, sampleRate: sampleRate, volume: volume)
            let wav = try PracticeFeedbackPCM.wavData(samples: samples, sampleRate: sampleRate)
            try AudioSessionCoordinator.shared.acquire(.feedback)
            let sound = try AVAudioPlayer(data: wav)
            sound.prepareToPlay()
            guard sound.play() else { throw FeedbackAudioError.unavailable }
            player = sound
            soundError = nil
            let duration = sound.duration + 0.08
            releaseAudioTask = Task { @MainActor [weak self] in
                try? await Task.sleep(for: .seconds(duration))
                guard !Task.isCancelled else { return }
                self?.stopSound()
            }
        } catch {
            stopSound()
            soundError = "Reward sounds are unavailable on this audio output. Your repetition was saved."
        }
    }

    private func stopSound() {
        releaseAudioTask?.cancel(); releaseAudioTask = nil
        player?.stop(); player = nil
        AudioSessionCoordinator.shared.release(.feedback)
    }
    private enum FeedbackAudioError: Error { case unavailable }
}
