import AVFoundation
import Observation
import UIKit

/// §14: "Sound design musical, in tune synthesized sounds never confusable with the metronome
/// click. Volume/intensity settings." Small set-completion sounds already exist and are reused as-is
/// (`FeedbackService`'s `.set`/`.chain` tones fire from the same practice-event pipeline this file
/// never touches, so a completed set is never double-signaled). This service adds only the two
/// sounds §14 needs that do not already exist: a big milestone celebration (passage/piece ready, new
/// rank, streak milestone) and a small badge chime — both original, procedurally synthesized tones
/// (no sample files, no network), reusing `PracticeFeedbackPCM`'s WAV packaging so the two pipelines
/// stay byte-for-byte consistent, with their own enable/volume settings as the spec asks for.
enum RewardSound { case celebration, badge }

@MainActor @Observable
final class RewardSoundService {
    static let shared = RewardSoundService()
    private(set) var soundError: String?
    private var storedEnabled = true
    private var storedVolume = 0.6
    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private var player: AVAudioPlayer?
    @ObservationIgnored private var releaseTask: Task<Void, Never>?

    var isEnabled: Bool {
        get { storedEnabled }
        set { storedEnabled = newValue; defaults.set(newValue, forKey: "praelude.ios.rewards.sound.enabled") }
    }
    var volume: Double {
        get { storedVolume }
        set {
            guard newValue.isFinite else { return }
            storedVolume = min(1, max(0, newValue))
            defaults.set(storedVolume, forKey: "praelude.ios.rewards.sound.volume")
        }
    }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        if defaults.object(forKey: "praelude.ios.rewards.sound.enabled") != nil {
            storedEnabled = defaults.bool(forKey: "praelude.ios.rewards.sound.enabled")
        }
        if let volume = defaults.object(forKey: "praelude.ios.rewards.sound.volume") as? Double, volume.isFinite {
            storedVolume = min(1, max(0, volume))
        }
    }

    func play(_ sound: RewardSound) {
        guard isEnabled, volume > 0 else { return }
        releaseTask?.cancel()
        player?.stop()
        do {
            let sampleRate = 48_000.0
            let samples = try Self.render(sound, sampleRate: sampleRate, volume: volume)
            let wav = try PracticeFeedbackPCM.wavData(samples: samples, sampleRate: sampleRate)
            try AudioSessionCoordinator.shared.acquire(.reward)
            let instance = try AVAudioPlayer(data: wav)
            instance.prepareToPlay()
            guard instance.play() else { throw RewardSoundError.unavailable }
            player = instance
            soundError = nil
            let duration = instance.duration + 0.1
            releaseTask = Task { @MainActor [weak self] in
                try? await Task.sleep(for: .seconds(duration))
                guard !Task.isCancelled else { return }
                self?.stop()
            }
        } catch {
            stop()
            soundError = "Celebration sounds are unavailable on this audio output. Your progress was saved."
        }
    }

    func stop() {
        releaseTask?.cancel(); releaseTask = nil
        player?.stop(); player = nil
        AudioSessionCoordinator.shared.release(.reward)
    }

    /// A rising major arpeggio (celebration) or a two-note chime (badge) — deliberately built from
    /// plain sine partials with a soft attack, unlike the metronome's short percussive click, so the
    /// two can never be mistaken for each other even with the metronome running underneath.
    private static func render(_ sound: RewardSound, sampleRate: Double, volume: Double) throws -> [Float] {
        let pitches: [Double]
        let duration: Double
        switch sound {
        case .celebration: pitches = [261.6256, 329.6276, 391.9954, 523.2511, 659.2551]; duration = 1.1
        case .badge: pitches = [440.0, 554.3653]; duration = 0.42
        }
        let count = Int(sampleRate * duration)
        guard count > 0, count <= Int(sampleRate) * 10 else { throw RewardSoundError.unavailable }
        var samples = [Float](repeating: 0, count: count)
        let amplitude = 0.28 * volume / sqrt(Double(pitches.count))
        for (index, pitch) in pitches.enumerated() {
            let onset = Double(index) * (sound == .celebration ? 0.09 : 0.11)
            for frame in Int(onset * sampleRate)..<count {
                let time = Double(frame) / sampleRate - onset
                let attack = min(1, time / 0.02)
                let release = min(1, (duration - Double(frame) / sampleRate) / 0.12)
                let decay = exp(-time * (sound == .celebration ? 1.6 : 3.2))
                // A quiet fifth-above partial gives the tone body without turning it into a chord
                // that could be misheard as a metronome accent pattern.
                let wave = sin(2 * .pi * pitch * time) + 0.15 * sin(2 * .pi * pitch * 1.5 * time)
                samples[frame] += Float(amplitude * attack * release * decay * wave)
            }
        }
        return samples
    }

    private enum RewardSoundError: Error { case unavailable }
}
