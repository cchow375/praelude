import AVFoundation
import Observation
import UIKit

/// The bar is PCM audio, scheduled as a loop by the audio engine's sample clock.
/// The UI polling task only reads the playhead; it never schedules a click.
@MainActor @Observable
final class MetronomeService {
    private var settings = MetronomeSettings()
    var bpm: Double {
        get { settings.bpm }
        set {
            guard newValue.isFinite else { return }
            let value = min(300, max(20, newValue))
            guard value != settings.bpm else { return }
            settings.bpm = value
            settingsChanged()
        }
    }
    var beatsPerBar: Int {
        get { settings.beatsPerBar }
        set {
            let value = min(12, max(1, newValue))
            guard value != settings.beatsPerBar else { return }
            setMeter(beats: value, denominator: settings.denominator)
        }
    }
    var subdivision: Int {
        get { settings.subdivision }
        set {
            let value = min(4, max(1, newValue))
            guard value != settings.subdivision else { return }
            settings.subdivision = value
            settingsChanged()
        }
    }
    var denominator: Int {
        get { settings.denominator }
        set { guard [2, 4, 8].contains(newValue) else { return }; setMeter(beats: beatsPerBar, denominator: newValue) }
    }
    var sound: MetronomeSound {
        get { settings.sound }
        set { guard settings.sound != newValue else { return }; settings.sound = newValue; settingsChanged() }
    }
    var volume: Double {
        get { settings.volume }
        set {
            guard newValue.isFinite else { return }
            settings.volume = min(1, max(0, newValue))
            player.volume = Float(settings.volume)
            persistSettings()
        }
    }
    var hapticsEnabled: Bool {
        get { settings.haptics }
        set { settings.haptics = newValue; persistSettings() }
    }
    var accents: [BeatAccent] { settings.accents }
    private(set) var isPlaying = false
    /// One-based displayed beat; zero while stopped.
    private(set) var beat = 0
    private(set) var pulse = 0
    private(set) var beatSequence: Int64 = 0
    private(set) var beatProgress = 0.0
    private(set) var errorMessage: String?

    @ObservationIgnored private let engine = AVAudioEngine()
    @ObservationIgnored private let player = AVAudioPlayerNode()
    @ObservationIgnored private let notifications = AudioNotificationBag()
    @ObservationIgnored private var displayTask: Task<Void, Never>?
    @ObservationIgnored private var sampleRate = 48_000.0
    @ObservationIgnored private var barFrames: AVAudioFramePosition = 1
    @ObservationIgnored private var lastAbsoluteBeat: Int64?
    @ObservationIgnored private var tapEstimator = TapTempoEstimator()
    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private let settingsKey = "praelude.ios.metronome.v1"
    @ObservationIgnored private let beatHaptic = UIImpactFeedbackGenerator(style: .soft)
    @ObservationIgnored private var rebuilding = false
    @ObservationIgnored private var audioRequiresRelaunch = false

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        if let data = defaults.data(forKey: settingsKey),
           let saved = try? JSONDecoder().decode(MetronomeSettings.self, from: data), saved.isValid { settings = saved }
        engine.attach(player)
        player.volume = Float(settings.volume)
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
            pulse = 1
            beatProgress = 0
            if hapticsEnabled { beatHaptic.prepare() }
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
        pulse = 0
        beatProgress = 0
        lastAbsoluteBeat = nil
        AudioSessionCoordinator.shared.release(.metronome)
    }

    func toggle() { isPlaying ? stop() : start() }
    func setTempo(_ value: Double) { guard value.isFinite else { return }; bpm = value }

    func tap() {
        if let value = tapEstimator.tap(at: ProcessInfo.processInfo.systemUptime) { setTempo(value) }
    }

    func setMeter(beats: Int, denominator: Int) {
        guard (1...12).contains(beats), [2, 4, 8].contains(denominator) else { return }
        guard beats != settings.beatsPerBar || denominator != settings.denominator else { return }
        settings.beatsPerBar = beats
        settings.denominator = denominator
        settings.accents = MetronomeSettings.accents(for: beats, denominator: denominator)
        settingsChanged()
    }

    func cycleAccent(at index: Int) {
        guard settings.accents.indices.contains(index) else { return }
        settings.accents[index] = settings.accents[index].next
        settingsChanged()
    }

    func resetAccents() {
        settings.accents = MetronomeSettings.accents(for: beatsPerBar, denominator: denominator)
        settingsChanged()
    }

    private func persistSettings() {
        guard let data = try? JSONEncoder().encode(settings) else { return }
        defaults.set(data, forKey: settingsKey)
    }

    private func settingsChanged() {
        persistSettings()
        guard isPlaying else { return }
        do { try playBar(); beat = 1 }
        catch { stopWithReason("The metronome could not update: \(error.localizedDescription)") }
    }

    private func playBar() throws {
        rebuilding = true
        defer { rebuilding = false }
        player.stop()
        engine.stop()
        lastAbsoluteBeat = nil
        engine.disconnectNodeOutput(player)
        sampleRate = max(8_000, AVAudioSession.sharedInstance().sampleRate)
        guard let format = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 1) else {
            throw MetronomeError.invalidAudioFormat
        }
        let pattern = try MetronomePattern(bpm: bpm, beatsPerBar: beatsPerBar,
                                          subdivision: subdivision, sampleRate: sampleRate, accents: settings.accents, sound: settings.sound)
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
        player.volume = Float(settings.volume)
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
                    let continuousBeat = Double(position) / Double(self.barFrames) * Double(self.beatsPerBar)
                    let nextBeat = min(self.beatsPerBar, Int(continuousBeat) + 1)
                    let absoluteBeat = time.sampleTime / self.barFrames * Int64(self.beatsPerBar) + Int64(nextBeat - 1)
                    if absoluteBeat != self.lastAbsoluteBeat {
                        self.lastAbsoluteBeat = absoluteBeat
                        self.beatSequence &+= 1
                        if self.hapticsEnabled, self.settings.accents[nextBeat - 1] != .muted {
                            self.beatHaptic.impactOccurred(intensity: self.settings.accents[nextBeat - 1] == .accented ? 0.8 : 0.4)
                        }
                    }
                    self.beat = nextBeat
                    self.beatProgress = continuousBeat - floor(continuousBeat)
                    self.pulse = min(self.beatsPerBar * self.subdivision, Int(continuousBeat * Double(self.subdivision)) + 1)
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
