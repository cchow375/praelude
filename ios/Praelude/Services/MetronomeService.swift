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
            if !estimatingTap { tapEstimator.reset() }
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
    var supportsCompoundPulse: Bool { settings.supportsCompoundPulse }
    var groupedCompoundPulse: Bool {
        get { settings.beatGrouping == 3 }
        set {
            let group = newValue && supportsCompoundPulse ? 3 : 1
            guard settings.beatGrouping != group else { return }
            settings.beatGrouping = group
            tapEstimator.reset()
            resetAccents()
        }
    }
    var pulsesPerBar: Int { settings.pulsesPerBar }
    var pulseAccents: [BeatAccent] { settings.pulseAccents }
    var barDurationSeconds: Double { settings.barDurationSeconds }
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
    /// Bars of the ordinary click played once, unlooped, before the music starts (0 = off).
    var countInBars: Int {
        get { settings.countInBars }
        set {
            let value = min(4, max(0, newValue))
            guard value != settings.countInBars else { return }
            settings.countInBars = value
            persistSettings()
        }
    }
    /// When on, backgrounding the app (including locking the screen) leaves the click running,
    /// using the `audio` background mode; when off (default), backgrounding stops it as before.
    var keepRunningWhenLocked: Bool {
        get { settings.keepRunningWhenLocked }
        set { settings.keepRunningWhenLocked = newValue; persistSettings() }
    }
    var accents: [BeatAccent] { settings.accents }
    private(set) var isPlaying = false
    /// One-based displayed beat; zero while stopped.
    private(set) var beat = 0
    private(set) var pulse = 0
    private(set) var beatSequence: Int64 = 0
    private(set) var beatProgress = 0.0
    /// True while a count-in bar (not yet the music) is sounding.
    private(set) var isCountingIn = false
    /// True while the current bar is a pulse-check "off" bar (R14) — silent by design, not a fault.
    private(set) var isDropoutSilent = false
    /// The active pulse-check dropout cycle (§11 R14 hook), or `nil` when the click plays every bar.
    private(set) var dropoutPlan: MetronomeDropoutPlan?
    private(set) var errorMessage: String?

    @ObservationIgnored private let engine = AVAudioEngine()
    @ObservationIgnored private let player = AVAudioPlayerNode()
    @ObservationIgnored private let notifications = AudioNotificationBag()
    @ObservationIgnored private let notificationCenter: NotificationCenter
    @ObservationIgnored private var displayTask: Task<Void, Never>?
    @ObservationIgnored private var sampleRate = 48_000.0
    @ObservationIgnored private var barFrames: AVAudioFramePosition = 1
    @ObservationIgnored private var lastAbsoluteBeat: Int64?
    @ObservationIgnored private var tapEstimator = TapTempoEstimator()
    @ObservationIgnored private var estimatingTap = false
    @ObservationIgnored private var clockOffsetFrames: Int64 = 0
    @ObservationIgnored private var scheduledPulsesPerBar = 4
    @ObservationIgnored private var configurationPosition: (frames: Int64, pausedAt: TimeInterval)?
    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private let settingsKey = "praelude.ios.metronome.v1"
    @ObservationIgnored private let beatHaptic = UIImpactFeedbackGenerator(style: .soft)
    @ObservationIgnored private var rebuilding = false
    @ObservationIgnored private var audioRequiresRelaunch = false
    @ObservationIgnored private var resumeAfterInterruption = false
    /// The count-in belongs to the current epoch. Phase-preserving edits retain its clock offset;
    /// explicit meter/dropout restarts omit it. Changing the preference affects only the next Start.
    @ObservationIgnored private var scheduledCountInBars = 0

    init(defaults: UserDefaults = .standard, notificationCenter: NotificationCenter = .default) {
        self.defaults = defaults
        self.notificationCenter = notificationCenter
        if let data = defaults.data(forKey: settingsKey),
           let saved = try? JSONDecoder().decode(MetronomeSettings.self, from: data), saved.isValid { settings = saved }
        engine.attach(player)
        player.volume = Float(settings.volume)
        AudioSessionCoordinator.shared.observeConfiguration(
            willChange: { [weak self] in self?.pauseEngineForConfiguration() },
            didChange: { [weak self] in self?.resumeEngineAfterConfiguration() }
        )
        observe(AVAudioSession.interruptionNotification) { [weak self] notification in
            guard let self, let raw = notification.interruptionType,
                  let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
            switch type {
            case .began:
                self.resumeAfterInterruption = self.stopWithReason("Metronome stopped for an audio interruption. Tap Play when ready.")
            case .ended:
                guard self.resumeAfterInterruption else { return }
                self.resumeAfterInterruption = false
                let options = notification.interruptionOptions.map { AVAudioSession.InterruptionOptions(rawValue: $0) } ?? []
                guard options.contains(.shouldResume), self.keepRunningWhenLocked || UIApplication.shared.applicationState == .active else { return }
                self.errorMessage = nil
                self.start()
            @unknown default: break
            }
        }
        observe(UIApplication.didEnterBackgroundNotification) { [weak self] _ in
            guard let self, !self.settings.keepRunningWhenLocked else { return }
            self.stop()
        }
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
            isCountingIn = scheduledCountInBars > 0
            isDropoutSilent = false
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
        resumeAfterInterruption = false
        isPlaying = false
        displayTask?.cancel()
        displayTask = nil
        player.stop()
        engine.stop()
        beat = 0
        pulse = 0
        beatProgress = 0
        isCountingIn = false
        isDropoutSilent = false
        scheduledCountInBars = 0
        clockOffsetFrames = 0
        configurationPosition = nil
        lastAbsoluteBeat = nil
        AudioSessionCoordinator.shared.release(.metronome)
    }

    func toggle() { isPlaying ? stop() : start() }
    func setTempo(_ value: Double) { guard value.isFinite else { return }; bpm = value }

    /// R14 pulse check: the practice track calls this to make the click drop out for
    /// `plan.barsOff` bars every `plan.barsOn` bars (and back to `nil` to return to playing every
    /// bar). This is the mechanism only — deciding *when* to apply it is a rules-track concern.
    func applyDropoutPlan(_ plan: MetronomeDropoutPlan?) {
        guard plan == nil || plan?.isValid == true, plan != dropoutPlan else { return }
        dropoutPlan = plan
        guard isPlaying else { return }
        do { try playBar(preservePhase: false); beat = 1 }
        catch { stopWithReason("The metronome could not update: \(error.localizedDescription)") }
    }

    func tap() {
        estimatingTap = true
        defer { estimatingTap = false }
        if let value = tapEstimator.tap(at: ProcessInfo.processInfo.systemUptime) { setTempo(value) }
    }

    /// Computes a tap without touching audio. Active practice callers commit it durably first.
    func tappedTempo() -> Double? {
        tapEstimator.tap(at: ProcessInfo.processInfo.systemUptime)
    }
    func applyTappedTempo(_ value: Double) {
        estimatingTap = true
        defer { estimatingTap = false }
        setTempo(value)
    }

    func setMeter(beats: Int, denominator: Int) {
        guard (1...12).contains(beats), [2, 4, 8].contains(denominator) else { return }
        guard beats != settings.beatsPerBar || denominator != settings.denominator else { return }
        settings.beatsPerBar = beats
        settings.denominator = denominator
        if !settings.supportsCompoundPulse { settings.beatGrouping = 1 }
        tapEstimator.reset()
        settings.accents = MetronomeSettings.accents(for: beats, denominator: denominator)
        if settings.beatGrouping == 3 { resetAccents() } else { settingsChanged() }
    }

    func cycleAccent(at index: Int) {
        guard settings.accents.indices.contains(index) else { return }
        settings.accents[index] = settings.accents[index].next
        settingsChanged()
    }

    func cyclePulseAccent(at index: Int) { cycleAccent(at: index * settings.beatGrouping) }

    func resetAccents() {
        settings.accents = MetronomeSettings.accents(for: beatsPerBar, denominator: denominator)
        if settings.beatGrouping == 3 {
            for index in stride(from: 3, to: beatsPerBar, by: 3) { settings.accents[index] = .regular }
        }
        settingsChanged()
    }

    private func persistSettings() {
        guard let data = try? JSONEncoder().encode(settings) else { return }
        defaults.set(data, forKey: settingsKey)
    }

    private func settingsChanged() {
        persistSettings()
        guard isPlaying else { return }
        do { try playBar() }
        catch { stopWithReason("The metronome could not update: \(error.localizedDescription)") }
    }

    private func playBar(preservePhase: Bool = true) throws {
        rebuilding = true
        defer { rebuilding = false }
        let rate = max(8_000, AVAudioSession.sharedInstance().sampleRate)
        guard let format = AVAudioFormat(standardFormatWithSampleRate: rate, channels: 1) else {
            throw MetronomeError.invalidAudioFormat
        }
        let pattern = try MetronomePattern(bpm: bpm, beatsPerBar: pulsesPerBar,
                                          subdivision: subdivision, sampleRate: rate, accents: pulseAccents, sound: settings.sound)
        let nextBarFrames = Int64(pattern.frameCount)
        let cycleBars = dropoutPlan?.cycleBars ?? 1
        // A pathological 128-bar, 20-BPM plan otherwise allocates nearly a gigabyte on the main
        // actor. Actual practice plans are short; refuse oversized PCM before allocating it.
        guard pattern.frameCount <= 16_000_000 / cycleBars else { throw MetronomeError.patternTooLong }
        let bar = pattern.renderSamples()
        var cycle = [Float](repeating: 0, count: pattern.frameCount * cycleBars)
        for index in 0..<cycleBars where !(dropoutPlan?.isSilent(barIndex: Int64(index)) ?? false) {
            cycle.replaceSubrange((index * pattern.frameCount)..<((index + 1) * pattern.frameCount), with: bar)
        }
        let continuing = isPlaying && engine.isRunning && sampleRate == rate
        var offset: Int64 = 0
        let canPreserve = isPlaying && preservePhase && scheduledPulsesPerBar == pulsesPerBar
            && (continuing || configurationPosition != nil)
        let countInBars = isPlaying ? (canPreserve ? scheduledCountInBars : 0) : settings.countInBars
        if canPreserve {
            var oldFrames: Int64?
            if let position = configurationPosition {
                let elapsed = max(0, ProcessInfo.processInfo.systemUptime - position.pausedAt)
                oldFrames = position.frames + Int64((elapsed * sampleRate).rounded())
            } else if let nodeTime = player.lastRenderTime,
                      let time = player.playerTime(forNodeTime: nodeTime), time.sampleTime >= 0 {
                oldFrames = time.sampleTime + clockOffsetFrames
            }
            if let oldFrames {
                offset = MetronomePlaybackPhase.rescaledOffset(sampleTime: oldFrames,
                                                                previousBarFrames: barFrames, nextBarFrames: nextBarFrames)
            }
        }
        configurationPosition = nil
        // Stop only the node for ordinary controls: the engine/session stays active. Rotate the
        // new sample-clock loop to its current bar phase, so a drag doesn't hammer new downbeats.
        player.stop()
        if !continuing {
            engine.stop()
            engine.disconnectNodeOutput(player)
            engine.connect(player, to: engine.mainMixerNode, format: format)
            engine.prepare()
            try engine.start()
        }
        sampleRate = rate
        barFrames = nextBarFrames
        scheduledPulsesPerBar = pulsesPerBar
        scheduledCountInBars = countInBars
        clockOffsetFrames = offset
        if !canPreserve { lastAbsoluteBeat = nil }
        let countInFrames = Int64(countInBars) * nextBarFrames
        if offset < countInFrames {
            // Count-in is audible even when the practice accents are intentionally all silent.
            // Only plain main beats, so a dense subdivision does not obscure the entry count.
            let plain = try MetronomePattern(bpm: bpm, beatsPerBar: pulsesPerBar, subdivision: 1,
                                            sampleRate: rate, sound: sound).renderSamples()
            let remaining = Int(countInFrames - offset)
            var countIn = [Float](repeating: 0, count: remaining)
            for index in 0..<remaining { countIn[index] = plain[(Int(offset) + index) % plain.count] }
            player.scheduleBuffer(try makeBuffer(format: format, samples: countIn), at: nil, options: [])
        }
        let musicOffset = Int(max(0, offset - countInFrames) % Int64(cycle.count))
        cycle = MetronomeSamples.rotated(cycle, startingAt: musicOffset)
        player.scheduleBuffer(try makeBuffer(format: format, samples: cycle), at: nil, options: .loops)
        player.volume = Float(settings.volume)
        player.play()
    }

    private func makeBuffer(format: AVAudioFormat, samples: [Float]) throws -> AVAudioPCMBuffer {
        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(samples.count)),
              let channel = buffer.floatChannelData?[0] else { throw MetronomeError.invalidAudioFormat }
        buffer.frameLength = AVAudioFrameCount(samples.count)
        samples.withUnsafeBufferPointer { source in
            if let base = source.baseAddress { channel.update(from: base, count: source.count) }
        }
        return buffer
    }

    /// Polling cadence is display-only: `MetronomeClock.position` recomputes the exact bar/beat
    /// from the engine's absolute sample clock every time, so a late or irregular poll (a busy
    /// main thread) can only delay what is *shown*, never drift what is *played* (see
    /// "MetronomeDriftTests").
    private func startDisplayUpdates() {
        displayTask?.cancel()
        displayTask = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(33))
                guard !Task.isCancelled, let self, self.isPlaying else { return }
                guard let nodeTime = self.player.lastRenderTime,
                      let time = self.player.playerTime(forNodeTime: nodeTime), time.sampleTime >= 0,
                      let position = MetronomeClock.position(sampleTime: time.sampleTime + self.clockOffsetFrames, barFrames: self.barFrames,
                                                              beatsPerBar: self.scheduledPulsesPerBar, subdivision: self.subdivision,
                                                              countInBars: self.scheduledCountInBars, dropoutPlan: self.dropoutPlan)
                else { continue }
                if position.absoluteBeatIndex != self.lastAbsoluteBeat {
                    self.lastAbsoluteBeat = position.absoluteBeatIndex
                    self.beatSequence &+= 1
                    if self.hapticsEnabled, !position.isSilentBar, self.pulseAccents[position.beat - 1] != .muted {
                        self.beatHaptic.impactOccurred(intensity: self.pulseAccents[position.beat - 1] == .accented ? 0.8 : 0.4)
                    }
                }
                self.beat = position.beat
                self.beatProgress = position.beatProgress
                self.pulse = position.pulse
                self.isCountingIn = position.isCountIn
                self.isDropoutSilent = position.isSilentBar
            }
        }
    }

    private func pauseEngineForConfiguration() {
        guard isPlaying else { return }
        if let nodeTime = player.lastRenderTime,
           let time = player.playerTime(forNodeTime: nodeTime), time.sampleTime >= 0 {
            configurationPosition = (time.sampleTime + clockOffsetFrames, ProcessInfo.processInfo.systemUptime)
        }
        player.stop()
        engine.stop()
    }

    private func resumeEngineAfterConfiguration() {
        guard isPlaying, !rebuilding else { return }
        do { try playBar(); beat = 1 }
        catch { stopWithReason("Audio output changed. Tap Play to restart the metronome.") }
    }

    @discardableResult
    private func stopWithReason(_ message: String) -> Bool {
        let wasPlaying = isPlaying
        stop()
        if wasPlaying { errorMessage = message }
        return wasPlaying
    }

    private func observe(_ name: Notification.Name, action: @escaping @MainActor @Sendable (AudioNotificationContext) -> Void) {
        observeAudioNotification(name, into: notifications, center: notificationCenter, action: action)
    }

    private enum MetronomeError: LocalizedError {
        case invalidAudioFormat, patternTooLong
        var errorDescription: String? {
            switch self {
            case .invalidAudioFormat: "No compatible audio output is available."
            case .patternTooLong: "This pulse-check cycle is too long. Use fewer bars or a faster tempo."
            }
        }
    }
}
