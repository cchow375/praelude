import AVFoundation
import Foundation
import Speech

/// One owner for the process audio session. Starting speech must not deactivate the click.
@MainActor
final class AudioSessionCoordinator {
    static let shared = AudioSessionCoordinator()
    /// `.tuner` and `.recording` both need microphone input, exactly like `.speech`; `.drone` and
    /// `.reward` are playback-only, like `.metronome`/`.feedback`. Any mix of these may be active
    /// together — a drone or the metronome must keep playing while the tuner listens or a take records.
    enum Client: Hashable { case metronome, speech, feedback, reward, tuner, drone, recording, recordingPlayback }

    private var clients: Set<Client> = []
    /// Read-only, local diagnostics. This does not reserve or transfer audio ownership.
    var activeClientLabels: [String] { clients.map { String(describing: $0) }.sorted() }
    private var configurationObservers: [(willChange: () -> Void, didChange: () -> Void)] = []
    private init() {}

    func observeConfiguration(willChange: @escaping () -> Void, didChange: @escaping () -> Void) {
        configurationObservers.append((willChange, didChange))
    }

    func acquire(_ client: Client) throws {
        guard !clients.contains(client) else { return }
        clients.insert(client)
        do { try configure(clients) }
        catch { clients.remove(client); throw error }
    }

    /// Media-service resets can clear the hardware session while logical clients remain owned.
    func refresh(_ client: Client) throws {
        if clients.contains(client) { try configure(clients) }
        else { try acquire(client) }
    }

    func release(_ client: Client) {
        guard clients.remove(client) != nil else { return }
        // A failed deactivation is harmless. A later explicit start attempts configuration again.
        try? configure(clients)
    }

    private func configure(_ proposed: Set<Client>) throws {
        let session = AVAudioSession.sharedInstance()
        if proposed.isEmpty {
            try session.setActive(false, options: .notifyOthersOnDeactivation)
            return
        }
        let needsInput = proposed.contains(.speech) || proposed.contains(.tuner) || proposed.contains(.recording)
        let category: AVAudioSession.Category = needsInput ? .playAndRecord : .playback
        let options: AVAudioSession.CategoryOptions = needsInput
            ? [.defaultToSpeaker, .mixWithOthers, .allowBluetoothHFP]
            : [.mixWithOthers]
        // Keep input mode stable across speech, tuner and take recording. Changing .voiceChat to
        // .default while another input engine has a tap can invalidate its hardware format. The
        // .voiceChat label alone also does not enable AVAudioEngine voice processing, so it must
        // not be advertised as echo cancellation or guaranteed command isolation from the click.
        let mode: AVAudioSession.Mode = .default
        let changesFormat = session.category != category || session.categoryOptions != options || session.mode != mode
        if changesFormat { configurationObservers.forEach { $0.willChange() } }
        defer { if changesFormat { configurationObservers.forEach { $0.didChange() } } }
        if changesFormat { try session.setCategory(category, mode: mode, options: options) }
        try? session.setPreferredSampleRate(48_000)
        try? session.setPreferredIOBufferDuration(0.005)
        try session.setActive(true)
    }
}

/// NotificationCenter tokens clean up without requiring a main-actor isolated deinitializer.
final class AudioNotificationBag: @unchecked Sendable {
    var tokens: [NSObjectProtocol] = []
    deinit { tokens.forEach(NotificationCenter.default.removeObserver) }
}

/// Copy notification values on the posting thread, then return immediately. An audio engine
/// can post while the main actor is waiting for its configuration work; delivering through
/// NotificationCenter's `.main` queue can make those two threads wait for each other.
/// The asynchronous main-queue handoff also keeps serial interruption notifications ordered.
@MainActor
func observeAudioNotification(_ name: Notification.Name, into bag: AudioNotificationBag,
                               action: @escaping @MainActor @Sendable (AudioNotificationContext) -> Void) {
    bag.tokens.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: nil) { @Sendable notification in
        let context = AudioNotificationContext(notification)
        DispatchQueue.main.async { action(context) }
    })
}

/// Copy values before entering main-actor isolation; Notification itself is not Sendable.
struct AudioNotificationContext: Sendable {
    let interruptionType: UInt?
    /// Only meaningful alongside `interruptionType == .ended`: whether the system says it is safe
    /// to resume (`AVAudioSession.InterruptionOptions.shouldResume`).
    let interruptionOptions: UInt?
    let routeReason: UInt?
    let sourceID: ObjectIdentifier?

    init(_ notification: Notification) {
        interruptionType = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt
        interruptionOptions = notification.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt
        routeReason = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt
        sourceID = notification.object.map { ObjectIdentifier($0 as AnyObject) }
    }
}

/// Permission completions arrive on system queues. These helpers are nonisolated, and their
/// explicit @Sendable callbacks cannot inherit a UI actor and trap on a background queue.
enum AudioInputPermissions {
    static func configurationIssue(requiresSpeech: Bool, info: [String: Any]? = Bundle.main.infoDictionary) -> String? {
        let keys = requiresSpeech ? ["NSMicrophoneUsageDescription", "NSSpeechRecognitionUsageDescription"]
            : ["NSMicrophoneUsageDescription"]
        guard keys.allSatisfy({ (info?[$0] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false }) else {
            return "Microphone access is unavailable in this installation. Your score and touch controls still work."
        }
        return nil
    }

    static func speechPermission() async -> SFSpeechRecognizerAuthorizationStatus {
        let existing = SFSpeechRecognizer.authorizationStatus()
        guard existing == .notDetermined else { return existing }
        return await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { @Sendable status in continuation.resume(returning: status) }
        }
    }

    static func microphoneGranted() async -> Bool {
        switch AVAudioApplication.shared.recordPermission {
        case .granted: return true
        case .denied: return false
        case .undetermined:
            return await withCheckedContinuation { continuation in
                AVAudioApplication.requestRecordPermission { @Sendable granted in continuation.resume(returning: granted) }
            }
        @unknown default: return false
        }
    }
}
