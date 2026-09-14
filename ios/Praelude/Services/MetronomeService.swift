import AVFoundation
import Observation
import UIKit

/// The bar is PCM audio, scheduled as a loop by the audio engine's sample clock.
/// The UI polling task only reads the playhead; it never schedules a click.
@MainActor @Observable
final class MetronomeService {
    private var storedBPM: Double = 80
    private var storedBeatsPerBar = 4
    private var storedSubdivision = 1
    var bpm: Double {
        get { storedBPM }
        set {
            guard newValue.isFinite else { return }
            let value = min(300, max(20, newValue))
            guard value != storedBPM else { return }
            storedBPM = value
            settingsChanged()
        }
    }
    var beatsPerBar: Int {
        get { storedBeatsPerBar }
        set {
            let value = min(12, max(1, newValue))
            guard value != storedBeatsPerBar else { return }
            storedBeatsPerBar = value
            settingsChanged()
        }
    }
    var subdivision: Int {
        get { storedSubdivision }
        set {
            let value = min(4, max(1, newValue))
            guard value != storedSubdivision else { return }
            storedSubdivision = value
            settingsChanged()
        }
    }
    private(set) var isPlaying = false
    /// One-based displayed beat; zero while stopped.
    private(set) var beat = 0
    private(set) var errorMessage: String?

    @ObservationIgnored private let engine = AVAudioEngine()
    @ObservationIgnored private let player = AVAudioPlayerNode()
    @ObservationIgnored private let notifications = AudioNotificationBag()
    @ObservationIgnored private var displayTask: Task<Void, Never>?
    @ObservationIgnored private var sampleRate = 48_000.0
    @ObservationIgnored private var barFrames: AVAudioFramePosition = 1
    @ObservationIgnored private var taps: [TimeInterval] = []
    @ObservationIgnored private var rebuilding = false
    @ObservationIgnored private var audioRequiresRelaunch = false

    init() {
        engine.attach(player)
        AudioSessionCoordinator.shared.observeConfiguration(
            willChange: { [weak self] in self?.pauseEngineForConfiguration() },
            didChange: { [weak self] in self?.resumeEngineAfterConfiguration() }
        )
        observe(AVAudioSession.interruptionNotification) { [weak self] notification in
            guard let raw = notification.interruptionType,
                  AVAudioSession.InterruptionType(rawValue: raw) == .began else { return }
            self?.stopWithReason("Metronome stopped for an audio interruption. Tap Play when ready.")
        }
        observe(UIApplication.didEnterBackgroundNotification) { [weak self] _ in self?.stop() }
        observe(AVAudioSession.routeChangeNotification) { [weak self] notification in
            guard let raw = notification.routeReason,
                  AVAudioSession.RouteChangeReason(rawValue: raw) == .oldDeviceUnavailable else { return }
            self?.stopWithReason("Audio output disconnected. Check your output, then tap Play.")
        }
        observe(AVAudioSession.mediaServicesWereResetNotification) { [weak self] _ in
            self?.audioRequiresRelaunch = true
            self?.stopWithReason("Audio was reset by iOS. Reopen Praelude before restarting the metronome.")
        }
        observe(.AVAudioEngineConfigurationChange) { [weak self] notification in
            guard let self, notification.sourceID == ObjectIdentifier(self.engine),
                  self.isPlaying, !self.engine.isRunning,
                  !self.rebuilding else { return }
            self.resumeEngineAfterConfiguration()
        }
    }

    func start() {
        guard !isPlaying else { return }
        guard !audioRequiresRelaunch else {
            errorMessage = "Audio was reset by iOS. Reopen Praelude before restarting the metronome."
            return
        }
        errorMessage = nil
        do {
            try AudioSessionCoordinator.shared.acquire(.metronome)
            try playBar()
            isPlaying = true
            beat = 1
            startDisplayUpdates()
        } catch {
            player.stop()
            engine.stop()
            AudioSessionCoordinator.shared.release(.metronome)
            errorMessage = "The metronome could not start: \(error.localizedDescription)"
        }
    }

    func stop() {
        isPlaying = false
        displayTask?.cancel()
        displayTask = nil
        player.stop()
        engine.stop()
        beat = 0
        AudioSessionCoordinator.shared.release(.metronome)
    }

    func toggle() { isPlaying ? stop() : start() }
    func setTempo(_ value: Double) { guard value.isFinite else { return }; bpm = value }

    func tap() {
        let now = ProcessInfo.processInfo.systemUptime
        if let previous = taps.last, now - previous > 3 { taps.removeAll() }
        taps.append(now)
        taps = Array(taps.suffix(6))
        guard taps.count >= 2 else { return }
        let intervals = zip(taps.dropFirst(), taps).map(-)
        guard intervals.allSatisfy({ $0 >= 0.15 }), let first = taps.first,
              let last = taps.last, last > first else { return }
        setTempo((60 * Double(taps.count - 1) / (last - first)).rounded())
    }

    private func settingsChanged() {
        guard isPlaying else { return }
        do { try playBar(); beat = 1 }
        catch { stopWithReason("The metronome could not update: \(error.localizedDescription)") }
    }

    private func playBar() throws {
        rebuilding = true
        defer { rebuilding = false }
        player.stop()
        engine.stop()
        engine.disconnectNodeOutput(player)
        sampleRate = max(8_000, AVAudioSession.sharedInstance().sampleRate)
        guard let format = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 1) else {
            throw MetronomeError.invalidAudioFormat
        }
        let pattern = try MetronomePattern(bpm: bpm, beatsPerBar: beatsPerBar,
                                          subdivision: subdivision, sampleRate: sampleRate)
        barFrames = AVAudioFramePosition(pattern.frameCount)
        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(barFrames)),
              let samples = buffer.floatChannelData?[0] else { throw MetronomeError.invalidAudioFormat }
        buffer.frameLength = AVAudioFrameCount(barFrames)
        let waveform = pattern.renderSamples()
        waveform.withUnsafeBufferPointer { source in
            if let base = source.baseAddress { samples.update(from: base, count: source.count) }
        }
        engine.connect(player, to: engine.mainMixerNode, format: format)
        engine.prepare()
        try engine.start()
        player.scheduleBuffer(buffer, at: nil, options: .loops)
        player.play()
    }

    private func startDisplayUpdates() {
        displayTask?.cancel()
        displayTask = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(33))
                guard !Task.isCancelled, let self, self.isPlaying else { return }
                if let nodeTime = self.player.lastRenderTime,
                   let time = self.player.playerTime(forNodeTime: nodeTime), time.sampleTime >= 0 {
                    let position = time.sampleTime % self.barFrames
                    self.beat = min(self.beatsPerBar, Int(Double(position) / Double(self.barFrames) * Double(self.beatsPerBar)) + 1)
                }
            }
        }
    }

    private func pauseEngineForConfiguration() {
        guard isPlaying else { return }
        player.stop()
        engine.stop()
    }

    private func resumeEngineAfterConfiguration() {
        guard isPlaying, !rebuilding else { return }
        do { try playBar(); beat = 1 }
        catch { stopWithReason("Audio output changed. Tap Play to restart the metronome.") }
    }

    private func stopWithReason(_ message: String) {
        let wasPlaying = isPlaying
        stop()
        if wasPlaying { errorMessage = message }
    }

    private func observe(_ name: Notification.Name, action: @escaping @MainActor @Sendable (AudioNotificationContext) -> Void) {
        notifications.tokens.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { notification in
            let context = AudioNotificationContext(notification)
            MainActor.assumeIsolated { action(context) }
        })
    }

    private enum MetronomeError: LocalizedError {
        case invalidAudioFormat
        var errorDescription: String? { "No compatible audio output is available." }
    }
}
