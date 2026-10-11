import AVFoundation
import Foundation

/// §9: "every command confirmed visibly+audibly (distinct sound per verdict + HUD flash)." Clean,
/// Sloppy, Again (and, via `PracticeUXHelpers.verdict(for:)`, Shaky and Missed) already have their
/// own distinct tones through the existing practice-feedback pipeline (`FeedbackService`) — this is
/// deliberately not re-wired onto those, to avoid double-firing audio for the same moment
/// (`DesignMotion.swift` documents the same rule for haptics). What every *other* voice command
/// currently lacks (per "(C) Audit.md" §9: "non-verdict commands have no sound") is any audible
/// confirmation at all. Three short, distinct tone shapes cover them: a rising chime for something
/// starting/turning on, a falling chime for something stopping/turning off, and a single soft tick
/// for a value changing (tempo) or simply "heard and understood" (Next, Undo, page turns). None of
/// these resemble the metronome's own click/wood/bell samples — different waveform family entirely
/// (a soft sine chime vs. a percussive sample) — so the click is never confused with a command
/// confirmation, and vice versa (§9: "works with metronome playing, click never misheard").
enum VoiceConfirmationSound: Equatable {
    case rise, fall, tick

    /// `nil` when `command` already has its own distinct sound through `FeedbackService` (the warm
    /// and cold verdicts) — this is how the caller knows not to also play a generic tone for it.
    static func forCommand(_ command: VoiceCommand) -> VoiceConfirmationSound? {
        switch command {
        case .clean, .sloppy, .again, .shaky, .missed: return nil
        case .start, .resume, .metronomeStart: return .rise
        case .stop, .pause, .undo, .metronomeStop: return .fall
        case .setTempo, .slower, .faster, .next, .nextPage, .previousPage: return .tick
        }
    }

    /// True for the five verdict words, whose normal audible confirmation is `FeedbackService`'s own
    /// distinct tone rather than one of these three generic ones (see `forCommand`'s doc comment
    /// above) — `VoiceConfirmationPlayer.confirm` uses this to know when it must fill in for that
    /// pipeline instead of relying on it.
    static func isVerdict(_ command: VoiceCommand) -> Bool {
        switch command {
        case .clean, .sloppy, .again, .shaky, .missed: return true
        default: return false
        }
    }

    /// A short, human-readable label for the HUD flash — what the player should see confirmed the
    /// instant a command lands, independent of whatever the app then does with it.
    static func label(for command: VoiceCommand) -> String {
        switch command {
        case .clean: "Clean"
        case .sloppy: "Sloppy"
        case .again: "Again"
        case .shaky: "Shaky"
        case .missed: "Missed"
        case .undo: "Undo"
        case .pause: "Pause"
        case .resume: "Resume"
        case .start: "Start"
        case .stop: "Stop"
        case .next: "Next set"
        case .slower: "Slower"
        case .faster: "Faster"
        case .metronomeStart: "Metronome on"
        case .metronomeStop: "Metronome off"
        case .setTempo(let bpm): "Tempo \(Int(bpm))"
        case .nextPage: "Next page"
        case .previousPage: "Previous page"
        }
    }
}

/// Renders and plays the tones above. A sibling to `PracticeFeedbackPCM`/`FeedbackService`, kept
/// separate because it confirms *recognition* of a spoken word — independent of whether the app then
/// accepts the resulting action — rather than a practice event.
enum VoiceConfirmationPCM {
    static func render(_ sound: VoiceConfirmationSound, sampleRate: Double = 48_000, volume: Double = 1) -> [Float] {
        let pitches: [Double]
        switch sound {
        case .rise: pitches = [523.2511, 783.9909] // C5 -> G5
        case .fall: pitches = [659.2551, 440.0] // E5 -> A4
        case .tick: pitches = [880.0] // A5, single soft tick
        }
        let duration = 0.16
        let count = Int(sampleRate * duration)
        var samples = [Float](repeating: 0, count: count)
        let amplitude = Float(0.16 * max(0, min(1, volume)) / Double(pitches.count).squareRoot())
        for (index, pitch) in pitches.enumerated() {
            let onset = Double(index) * 0.05
            for frame in Int(onset * sampleRate)..<count {
                let time = Double(frame) / sampleRate - onset
                let attack = min(1, time / 0.004)
                let release = min(1, (duration - Double(frame) / sampleRate) / 0.03)
                let decay = exp(-time * 14)
                samples[frame] += Float(attack * release * decay) * amplitude * Float(sin(2 * .pi * pitch * time))
            }
        }
        return samples
    }
}

@MainActor @Observable
final class VoiceConfirmationPlayer {
    static let shared = VoiceConfirmationPlayer()
    /// The most recently confirmed command, for the HUD flash. Cleared automatically a moment later.
    private(set) var lastCommand: VoiceCommand?
    private(set) var lastCommandID = UUID()

    @ObservationIgnored private var player: AVAudioPlayer?
    @ObservationIgnored private var clearTask: Task<Void, Never>?
    @ObservationIgnored private var releaseTask: Task<Void, Never>?

    /// The caller (`SpeechCommandService`) is the single source of truth for whether voice is
    /// muted — it gates whether this is even called, rather than this class tracking its own copy
    /// of that state, so there is exactly one place "muted" can disagree with itself.
    func confirm(_ command: VoiceCommand) {
        lastCommand = command
        lastCommandID = UUID()
        clearTask?.cancel()
        clearTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .milliseconds(1_100))
            guard !Task.isCancelled, let self, self.lastCommand == command else { return }
            self.lastCommand = nil
        }
        guard let sound = VoiceConfirmationSound.forCommand(command) else {
            // §9: "every command confirmed... audibly" is unconditional, but a verdict's normal
            // audible confirmation is `FeedbackService`'s own distinct tone, which the player's
            // separate "Practice feedback" preference (a discretionary nicety, per its own Settings
            // footer) can turn off. Fill in the plain `.tick` whenever that pipeline would not itself
            // sound anything right now, so a spoken verdict is never silently unconfirmed — see
            // "(C) Audit.md".
            if VoiceConfirmationSound.isVerdict(command), !FeedbackService.shared.playsAudibleConfirmation { play(.tick) }
            return
        }
        play(sound)
    }

    private func play(_ sound: VoiceConfirmationSound) {
        releaseTask?.cancel()
        player?.stop()
        do {
            let sampleRate = 48_000.0
            let samples = VoiceConfirmationPCM.render(sound, sampleRate: sampleRate)
            let wav = try PracticeFeedbackPCM.wavData(samples: samples, sampleRate: sampleRate)
            try AudioSessionCoordinator.shared.acquire(.feedback)
            let avPlayer = try AVAudioPlayer(data: wav)
            avPlayer.prepareToPlay()
            guard avPlayer.play() else { return }
            player = avPlayer
            let duration = avPlayer.duration + 0.08
            releaseTask = Task { @MainActor [weak self] in
                try? await Task.sleep(for: .seconds(duration))
                guard !Task.isCancelled else { return }
                self?.player?.stop(); self?.player = nil
                AudioSessionCoordinator.shared.release(.feedback)
            }
        } catch {
            // A confirmation tone is a nicety, not a durable write; a failure here is silent, the
            // same way `FeedbackService.playSound` treats an audio-output failure as non-fatal.
        }
    }
}
