import AVFoundation
import Foundation

/// One owner for the process audio session. Starting speech must not deactivate the click.
@MainActor
final class AudioSessionCoordinator {
    static let shared = AudioSessionCoordinator()
    enum Client: Hashable { case metronome, speech, feedback, reward }

    private var clients: Set<Client> = []
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
        let category: AVAudioSession.Category = proposed.contains(.speech) ? .playAndRecord : .playback
        let options: AVAudioSession.CategoryOptions = proposed.contains(.speech)
            ? [.defaultToSpeaker, .mixWithOthers, .allowBluetoothHFP]
            : [.mixWithOthers]
        let changesFormat = session.category != category || session.categoryOptions != options
        if changesFormat { configurationObservers.forEach { $0.willChange() } }
        defer { if changesFormat { configurationObservers.forEach { $0.didChange() } } }
        if changesFormat { try session.setCategory(category, mode: .default, options: options) }
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

/// Copy values before entering main-actor isolation; Notification itself is not Sendable.
struct AudioNotificationContext: Sendable {
    let interruptionType: UInt?
    let routeReason: UInt?
    let sourceID: ObjectIdentifier?

    init(_ notification: Notification) {
        interruptionType = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt
        routeReason = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt
        sourceID = notification.object.map { ObjectIdentifier($0 as AnyObject) }
    }
}
