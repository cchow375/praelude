import AVFoundation
import Observation

/// Optional per-set take recording (§13): AAC files in the app sandbox, alongside `Scores/` under
/// the same `PracticeStore.directory`. Metadata goes through `PracticeStore.saveRecording`/
/// `deleteRecording` exactly like every other schema3 collection. This never analyzes a take —
/// `PitchDetector`/grading are never applied to anything captured here; it is a listen-back tool.
@MainActor @Observable
final class RecordingService {
    private(set) var isRecording = false
    private(set) var isPaused = false
    private(set) var isPlaying = false
    /// Which saved recording `isPlaying` refers to — lets a UI with more than one listen-back
    /// button (e.g. "latest" and "~a week ago") show Stop on only the one actually playing.
    private(set) var nowPlayingID: UUID?
    private(set) var errorMessage: String?
    /// The set (if any) a take is currently open for — `RecordingLifecycle` compares this against
    /// the store's active set to decide the next action.
    private(set) var recordingSetID: UUID?
    var takesEnabled: Bool {
        get { storedTakesEnabled }
        set {
            guard newValue != storedTakesEnabled else { return }
            storedTakesEnabled = newValue
            defaults.set(newValue, forKey: enabledKey)
        }
    }

    @ObservationIgnored private var storedTakesEnabled: Bool
    @ObservationIgnored private var recorder: AVAudioRecorder?
    @ObservationIgnored private var player: AVAudioPlayer?
    @ObservationIgnored private var playbackWatch: Task<Void, Never>?
    @ObservationIgnored private var currentPassageID: UUID?
    @ObservationIgnored private var currentFileName: String?
    @ObservationIgnored private var takeStartedAt: Date?
    @ObservationIgnored private var pausedByInterruption = false
    @ObservationIgnored private let notifications = AudioNotificationBag()
    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private let enabledKey = "praelude.ios.recording.takesEnabled"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        storedTakesEnabled = defaults.bool(forKey: enabledKey)
        observeAudioNotification(AVAudioSession.interruptionNotification, into: notifications) { [weak self] notification in
            guard let self, let raw = notification.interruptionType,
                  let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
            switch type {
            case .began:
                guard self.isRecording, !self.isPaused else { return }
                self.pausedByInterruption = true
                self.recorder?.pause()
                self.isPaused = true
            case .ended:
                guard self.pausedByInterruption else { return }
                self.pausedByInterruption = false
                let options = notification.interruptionOptions.map { AVAudioSession.InterruptionOptions(rawValue: $0) } ?? []
                guard options.contains(.shouldResume), self.isRecording else { return }
                self.isPaused = !(self.recorder?.record() ?? false)
            @unknown default: break
            }
        }
    }

    static func recordingsDirectory(in store: PracticeStore) -> URL {
        store.directory.appendingPathComponent("Recordings", isDirectory: true)
    }

    func fileURL(for recording: AudioRecording, in store: PracticeStore) -> URL {
        Self.recordingsDirectory(in: store).appendingPathComponent(recording.fileName)
    }

    // MARK: - Capture, driven by `RecordingLifecycle.action` (see `PracticeRuntime.syncRecording`)

    func startTake(passageID: UUID?, setID: UUID, in store: PracticeStore) {
        guard !isRecording else { return }
        errorMessage = nil
        do {
            try AudioSessionCoordinator.shared.acquire(.recording)
            let directory = Self.recordingsDirectory(in: store)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let fileName = "take-\(UUID().uuidString).m4a"
            let url = directory.appendingPathComponent(fileName)
            let settings: [String: Any] = [
                AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 44_100, AVNumberOfChannelsKey: 1,
                AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue
            ]
            let newRecorder = try AVAudioRecorder(url: url, settings: settings)
            guard newRecorder.record() else { throw RecordingError.couldNotStart }
            recorder = newRecorder
            recordingSetID = setID
            currentPassageID = passageID
            currentFileName = fileName
            takeStartedAt = Date()
            isRecording = true
            isPaused = false
        } catch {
            recorder = nil
            AudioSessionCoordinator.shared.release(.recording)
            errorMessage = "The recording could not start: \(error.localizedDescription)"
        }
    }

    func pauseTake() {
        guard isRecording, !isPaused else { return }
        recorder?.pause()
        isPaused = true
    }

    func resumeTake() {
        guard isRecording, isPaused else { return }
        isPaused = !(recorder?.record() ?? false)
    }

    /// Stops capture and saves what was recorded as `AudioRecording` metadata. A take shorter than
    /// one second (e.g. started right before the set immediately ended) is discarded rather than
    /// saved as noise.
    func finishTake(in store: PracticeStore) {
        guard isRecording else { return }
        let duration = recorder?.currentTime ?? 0
        recorder?.stop()
        defer { resetCaptureState() }
        guard duration >= 1, let fileName = currentFileName else {
            deleteFile(named: currentFileName, in: store)
            return
        }
        let url = Self.recordingsDirectory(in: store).appendingPathComponent(fileName)
        let attributes = try? FileManager.default.attributesOfItem(atPath: url.path)
        let byteSize = (attributes?[.size] as? Int) ?? 0
        let recording = AudioRecording(passageID: currentPassageID, setID: recordingSetID, date: takeStartedAt ?? Date(),
                                        fileName: fileName, duration: duration, byteSize: byteSize)
        do { try store.saveRecording(recording) }
        catch {
            errorMessage = "The recording could not be saved: \(error.localizedDescription)"
            deleteFile(named: fileName, in: store)
        }
    }

    /// Stops capture and throws the file away without saving metadata (§13's `.discard` action —
    /// the set it belonged to vanished before it could be attributed to anything).
    func discardTake(in store: PracticeStore) {
        guard isRecording else { return }
        recorder?.stop()
        deleteFile(named: currentFileName, in: store)
        resetCaptureState()
    }

    private func resetCaptureState() {
        recorder = nil
        isRecording = false
        isPaused = false
        pausedByInterruption = false
        recordingSetID = nil
        currentPassageID = nil
        currentFileName = nil
        takeStartedAt = nil
        AudioSessionCoordinator.shared.release(.recording)
    }

    private func deleteFile(named fileName: String?, in store: PracticeStore) {
        guard let fileName else { return }
        try? FileManager.default.removeItem(at: Self.recordingsDirectory(in: store).appendingPathComponent(fileName))
    }

    // MARK: - Listen back ("tap passage to hear last recording")

    func play(_ recording: AudioRecording, in store: PracticeStore) {
        stopPlayback()
        errorMessage = nil
        do {
            try AudioSessionCoordinator.shared.acquire(.recordingPlayback)
            let newPlayer = try AVAudioPlayer(contentsOf: fileURL(for: recording, in: store))
            guard newPlayer.play() else { throw RecordingError.couldNotPlay }
            player = newPlayer
            isPlaying = true
            nowPlayingID = recording.id
            watchPlaybackCompletion()
        } catch {
            player = nil
            nowPlayingID = nil
            AudioSessionCoordinator.shared.release(.recordingPlayback)
            errorMessage = "That recording could not be played: \(error.localizedDescription)"
        }
    }

    func stopPlayback() {
        playbackWatch?.cancel()
        playbackWatch = nil
        guard isPlaying || player != nil else { return }
        player?.stop()
        player = nil
        isPlaying = false
        nowPlayingID = nil
        AudioSessionCoordinator.shared.release(.recordingPlayback)
    }

    /// `AVAudioPlayer` has no async completion API; a short poll (mirrors `MetronomeService`'s own
    /// display-update task) notices when playback ends on its own so the UI's Stop/Play state
    /// stays correct without the caller having to guess a duration.
    private func watchPlaybackCompletion() {
        playbackWatch?.cancel()
        playbackWatch = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(200))
                guard !Task.isCancelled, let self else { return }
                guard let player = self.player, player.isPlaying else { self.stopPlayback(); return }
            }
        }
    }

    // MARK: - Storage and cleanup

    /// Deletes both the audio files and their metadata for non-deleted recordings older than
    /// `days`. Returns the number removed.
    @discardableResult
    func cleanUpRecordings(olderThanDays days: Int, in store: PracticeStore) -> Int {
        let candidates = store.recordings.recordingsOlderThan(days: days)
        for recording in candidates {
            try? FileManager.default.removeItem(at: fileURL(for: recording, in: store))
            try? store.deleteRecording(recording.id)
        }
        return candidates.count
    }

    private enum RecordingError: LocalizedError {
        case couldNotStart, couldNotPlay
        var errorDescription: String? {
            switch self {
            case .couldNotStart: return "The audio recorder could not start."
            case .couldNotPlay: return "The audio player could not start."
            }
        }
    }
}
