import AVFoundation
import Observation
import Speech
import UIKit

struct VoicePendingConfirmation: Identifiable, Equatable {
    let id = UUID()
    let transcript: String
    let candidates: [VoiceCommand]
}

struct VoiceRecognitionTiming: Equatable {
    /// Starts at the first text callback, not the beginning of spoken audio.
    let firstTextToFinalMilliseconds: Double
    let endpointToFinalMilliseconds: Double?
    let commandWasRecognized: Bool
}


/// Explicit opt-in, local speech commands. Partial transcripts never mutate practice.
@MainActor @Observable
final class SpeechCommandService {
    private(set) var status = "Voice is off"
    private(set) var isListening = false
    private(set) var isPreparing = false
    private(set) var isDictating = false
    private(set) var errorMessage: String?
    private(set) var lastTranscript = ""
    private(set) var pendingConfirmation: VoicePendingConfirmation?
    private(set) var lastTiming: VoiceRecognitionTiming?
    private(set) var lastStartupMilliseconds: Double?
    private(set) var commandAliases: VoiceAliasConfiguration
    private(set) var practiceInputSuspended = false
    private(set) var supportedActions = Set(VoiceCommandAction.allCases)
    private(set) var diagnosticInput = "No microphone route checked yet"
    private(set) var diagnosticOutput = "No output route checked yet"
    private(set) var diagnosticAudioOwners = "None"
    private(set) var diagnosticPermission = "Not checked"
    private(set) var diagnosticSampleRate = 0.0
    private(set) var diagnosticBufferMilliseconds = 0.0

    /// A score window may stop only the microphone session it started.
    private(set) var ownerID: UUID?
    /// §9's "one-tap mute": distinct from `stop()`. Muting keeps the recognizer/audio engine running
    /// (so un-muting is instant) but stops delivering commands, playing confirmation tones, and
    /// logging misrecognitions — `stop()` remains the heavier "turn hands-free off entirely" action,
    /// which tears the engine down and re-requests permission/setup on the next `start()`.
    private(set) var isMuted = false

    @ObservationIgnored private var engine = AVAudioEngine()
    @ObservationIgnored private let notifications = AudioNotificationBag()
    @ObservationIgnored private var recognizer: SFSpeechRecognizer?
    @ObservationIgnored private var request: SFSpeechAudioBufferRecognitionRequest?
    @ObservationIgnored private var recognitionTask: SFSpeechRecognitionTask?
    @ObservationIgnored private var permissionTask: Task<Void, Never>?
    @ObservationIgnored private var endpointTask: Task<Void, Never>?
    @ObservationIgnored private var renewalTask: Task<Void, Never>?
    @ObservationIgnored private var finalTimeoutTask: Task<Void, Never>?
    @ObservationIgnored private var confirmationTimeoutTask: Task<Void, Never>?
    @ObservationIgnored private let defaults: UserDefaults
    private static let aliasesKey = "praelude.ios.voice.commandAliases"
    @ObservationIgnored private var contextToken: UUID?
    @ObservationIgnored private var firstTranscriptAt: TimeInterval?
    @ObservationIgnored private var endpointRequestedAt: TimeInterval?
    @ObservationIgnored private var captureRequestedAt: TimeInterval?

    @ObservationIgnored private var onCommand: ((VoiceCommand) -> Void)?
    @ObservationIgnored private var onTranscript: ((String) -> Void)?
    @ObservationIgnored private var generation = UUID()
    @ObservationIgnored private var wantsListening = false
    @ObservationIgnored private var tapInstalled = false
    @ObservationIgnored private var endingUtterance = false
    @ObservationIgnored private var finalDelivered = false
    @ObservationIgnored private let speechPermission: @Sendable () async -> SFSpeechRecognizerAuthorizationStatus
    @ObservationIgnored private let microphonePermission: @Sendable () async -> Bool
    @ObservationIgnored private let confirmation: @MainActor (VoiceCommand) -> Void
    @ObservationIgnored private let logMisrecognition: @MainActor (String) -> Void

    init(defaults: UserDefaults = .standard, speechPermission: @escaping @Sendable () async -> SFSpeechRecognizerAuthorizationStatus = AudioInputPermissions.speechPermission,
         microphonePermission: @escaping @Sendable () async -> Bool = AudioInputPermissions.microphoneGranted,
         confirmation: @escaping @MainActor (VoiceCommand) -> Void = { VoiceConfirmationPlayer.shared.confirm($0) },
         logMisrecognition: @escaping @MainActor (String) -> Void = { VoiceMisrecognitionLog.shared.record($0) }) {
        self.defaults = defaults
        if let data = defaults.data(forKey: Self.aliasesKey),
           let aliases = try? JSONDecoder().decode(VoiceAliasConfiguration.self, from: data),
           (try? aliases.validate()) != nil { commandAliases = aliases }
        else { commandAliases = VoiceAliasConfiguration() }
        self.speechPermission = speechPermission
        self.microphonePermission = microphonePermission
        self.confirmation = confirmation
        self.logMisrecognition = logMisrecognition
        observe(AVAudioSession.interruptionNotification) { [weak self] notification in
            guard let raw = notification.interruptionType,
                  AVAudioSession.InterruptionType(rawValue: raw) == .began else { return }
            self?.failIfActive("Voice stopped for an audio interruption. Turn it on again when ready.")
        }
        observe(UIApplication.didEnterBackgroundNotification) { [weak self] _ in self?.stop() }
        observe(AVAudioSession.routeChangeNotification) { [weak self] notification in
            guard let self else { return }
            self.refreshDiagnostics()
            guard let raw = notification.routeReason else { return }
            if AVAudioSession.RouteChangeReason(rawValue: raw) == .oldDeviceUnavailable {
                self.failIfActive("Microphone or headphones disconnected. Check your audio route and turn voice on again.")
            } else if AVAudioSession.RouteChangeReason(rawValue: raw) == .newDeviceAvailable,
                      self.isListening, !self.endingUtterance {
                // A new route can invalidate the input node's cached format even while it runs.
                self.cleanUpUtterance()
                self.engine = AVAudioEngine()
                do { try self.beginUtterance() }
                catch { self.fail("Microphone route changed. Turn voice on to retry: \(error.localizedDescription)") }
            }
        }
        observe(AVAudioSession.mediaServicesWereResetNotification) { [weak self] _ in
            self?.failIfActive("Audio was reset by iOS. Tap the microphone to start again.")
            self?.engine = AVAudioEngine()
        }
        observe(.AVAudioEngineConfigurationChange) { [weak self] notification in
            guard let self, notification.sourceID == ObjectIdentifier(self.engine),
                  self.isListening, !self.endingUtterance, !self.engine.isRunning else { return }
            self.fail("The microphone changed. Tap the microphone to start again.")
        }
    }

    /// Calling this method is the opt-in. Neither initialization nor app launch asks for a microphone.
    func start(ownerID: UUID? = nil, onCommand: @escaping (VoiceCommand) -> Void) {
        guard !wantsListening else {
            if self.ownerID != ownerID { errorMessage = "Voice is already in use in another score or editor. Turn it off there before starting here." }
            return
        }
        startCapture(ownerID: ownerID, onCommand: onCommand, onTranscript: nil)
    }

    /// One microphone owner for command listening and short, user-initiated text dictation.
    /// Partial text is preview-only; the caller receives one final transcript and decides when to save.
    func startDictation(ownerID: UUID, onTranscript: @escaping (String) -> Void) {
        stop()
        startCapture(ownerID: ownerID, onCommand: nil, onTranscript: onTranscript)
    }

    func finishDictation(ifOwnedBy owner: UUID) {
        guard ownerID == owner, isDictating, isListening else { return }
        finishUtterance()
    }

    private func startCapture(ownerID: UUID?, onCommand: ((VoiceCommand) -> Void)?,
                              onTranscript: ((String) -> Void)?) {
        if let issue = AudioInputPermissions.configurationIssue(requiresSpeech: true) {
            errorMessage = issue
            status = "Voice unavailable"
            return
        }
        wantsListening = true
        captureRequestedAt = ProcessInfo.processInfo.systemUptime
        isPreparing = true
        isDictating = onTranscript != nil
        lastTranscript = ""
        // Input nodes cache the route format. A fresh explicit start must use the current route,
        // including when headphones changed while voice was off or media services restarted.
        engine = AVAudioEngine()
        self.ownerID = ownerID
        errorMessage = nil
        self.onCommand = onCommand
        self.onTranscript = onTranscript
        status = "Preparing local voice…"
        let startID = UUID()
        generation = startID
        permissionTask = Task { @MainActor [weak self] in
            guard let permission = self?.speechPermission else { return }
            let speechPermission = await permission()
            guard let self, self.wantsListening, self.generation == startID, !Task.isCancelled else { return }
            self.refreshDiagnostics()
            guard speechPermission == .authorized else {
                self.fail("Speech permission is off. Allow Speech Recognition for Praelude in Settings to use voice commands.")
                return
            }
            let microphoneGranted = await self.microphonePermission()
            guard self.wantsListening, self.generation == startID, !Task.isCancelled else { return }
            self.refreshDiagnostics()
            guard microphoneGranted else {
                self.fail("Microphone permission is off. Allow the microphone for Praelude in Settings to use voice commands.")
                return
            }
            guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US")),
                  recognizer.supportsOnDeviceRecognition else {
                self.fail("On-device English recognition is unavailable on this device. Touch controls work offline; voice never falls back to a server.")
                return
            }
            guard recognizer.isAvailable else {
                self.fail("Local speech recognition is temporarily unavailable. Try voice again later.")
                return
            }
            self.recognizer = recognizer
            do {
                try AudioSessionCoordinator.shared.acquire(.speech)
                try self.beginUtterance()
            } catch {
                self.fail("Voice could not start: \(error.localizedDescription)")
            }
        }
    }

    func stop() {
        wantsListening = false
        generation = UUID() // Invalidates every queued permission/recognition callback.
        permissionTask?.cancel()
        permissionTask = nil
        cancelPendingCommand()
        cleanUpUtterance()
        recognizer = nil
        onCommand = nil
        onTranscript = nil
        ownerID = nil
        contextToken = nil
        supportedActions = Set(VoiceCommandAction.allCases)
        captureRequestedAt = nil
        isListening = false
        isPreparing = false
        isDictating = false
        isMuted = false
        status = "Voice is off"
        AudioSessionCoordinator.shared.release(.speech)
    }

    func stop(ifOwnedBy owner: UUID) {
        guard ownerID == owner else { return }
        stop()
    }

    /// §9's one-tap mute. Never used to satisfy `stop()`'s job — see `isMuted`'s doc comment.
    func setMuted(_ value: Bool) {
        isMuted = value
        if value { cancelPendingCommand() }
        guard wantsListening else { return }
        status = value ? "Muted — listening paused" : "Listening on this device"
    }

    /// Custom phrases and diagnostics stay in this device's preferences; they are not practice data or synced.
    func updateAliases(_ phrases: [String], for action: VoiceCommandAction) throws {
        let updated = try commandAliases.updating(phrases, for: action)
        let data = try JSONEncoder().encode(updated)
        defaults.set(data, forKey: Self.aliasesKey)
        commandAliases = updated
        cancelPendingCommand()
        if !isDictating { request?.contextualStrings = recognitionHints }
    }

    func restoreDefaultAliases() {
        commandAliases = VoiceAliasConfiguration()
        defaults.removeObject(forKey: Self.aliasesKey)
        cancelPendingCommand()
        if !isDictating { request?.contextualStrings = recognitionHints }
    }

    /// Called when the focused set/grade changes. A suggestion from an old set must never write to a new one.
    func setCommandContext(_ token: UUID?, supportedActions: Set<VoiceCommandAction>? = nil, ifOwnedBy owner: UUID) {
        guard ownerID == owner else { return }
        let actions = supportedActions ?? Set(VoiceCommandAction.allCases)
        let changed = contextToken != token || self.supportedActions != actions
        if changed { cancelPendingCommand() }
        contextToken = token
        self.supportedActions = actions
        if changed, isListening, !isDictating {
            // Old callbacks carry the prior generation. Discard them rather than applying speech
            // begun for a different set, grade prompt, or modal after the UI context has changed.
            do { try beginUtterance() }
            catch { fail("Voice context changed. Turn voice on to retry: \(error.localizedDescription)") }
        }
    }

    func setPracticeInputSuspended(_ suspended: Bool) {
        practiceInputSuspended = suspended
        if suspended { cancelPendingCommand() }
    }

    func cancelPendingCommand() {
        confirmationTimeoutTask?.cancel()
        confirmationTimeoutTask = nil
        pendingConfirmation = nil
    }

    /// Ambiguous suggestions require the player to choose a specific action on screen.
    func confirmPendingCommand(_ choice: VoiceCommand? = nil) {
        guard wantsListening, !isMuted, !isDictating, let pending = pendingConfirmation else { return }
        let selected = choice ?? (pending.candidates.count == 1 ? pending.candidates.first : nil)
        guard let selected, pending.candidates.contains(selected), supportedActions.contains(selected.action) else { return }
        cancelPendingCommand()
        deliver(selected)
    }

    func refreshDiagnostics() {
        let session = AVAudioSession.sharedInstance()
        diagnosticInput = session.currentRoute.inputs.map { "\($0.portName) (\($0.portType.rawValue))" }.joined(separator: ", ")
        if diagnosticInput.isEmpty { diagnosticInput = "No active input route" }
        diagnosticOutput = session.currentRoute.outputs.map { "\($0.portName) (\($0.portType.rawValue))" }.joined(separator: ", ")
        if diagnosticOutput.isEmpty { diagnosticOutput = "No active output route" }
        diagnosticSampleRate = session.sampleRate
        diagnosticBufferMilliseconds = session.ioBufferDuration * 1_000
        diagnosticAudioOwners = AudioSessionCoordinator.shared.activeClientLabels.joined(separator: ", ")
        if diagnosticAudioOwners.isEmpty { diagnosticAudioOwners = "None" }
        let mic: String
        switch AVAudioApplication.shared.recordPermission {
        case .granted: mic = "allowed"
        case .denied: mic = "denied"
        default: mic = "not requested"
        }
        let recognition: String
        switch SFSpeechRecognizer.authorizationStatus() {
        case .authorized: recognition = "allowed"
        case .denied: recognition = "denied"
        case .restricted: recognition = "restricted"
        default: recognition = "not requested"
        }
        diagnosticPermission = "Microphone \(mic); speech \(recognition)"
    }

    private var recognitionHints: [String] {
        VoiceCommandAction.allCases.flatMap { $0.phrases + commandAliases.aliases(for: $0) } + ["confirm", "cancel"]
    }

    private func deliver(_ command: VoiceCommand) {
        guard supportedActions.contains(command.action) else { return }
        guard !practiceInputSuspended || !command.altersPracticeHistory else {
            status = "Focus mode: rep input is suspended"
            return
        }
        confirmation(command)
        onCommand?(command)
    }

    /// Routes one final recognition result. Internal so tests can exercise policy without microphone hardware.
    func processCommandTranscript(_ transcript: String) {
        guard wantsListening, !isDictating, !isMuted else { return }
        let phrase = VoiceCommand.normalizedPhrase(transcript)
        if phrase == "cancel" { cancelPendingCommand(); return }
        if phrase == "confirm", pendingConfirmation != nil { confirmPendingCommand(); return }
        cancelPendingCommand()
        let recognition = VoiceCommandRecognition.recognize(transcript, aliases: commandAliases, supportedActions: supportedActions)
        switch recognition {
        case .command(let command): deliver(command)
        case .needsConfirmation(let candidates):
            let allowed = candidates.filter { !practiceInputSuspended || !$0.altersPracticeHistory }
            guard !allowed.isEmpty else { status = "Focus mode: rep input is suspended"; return }
            pendingConfirmation = VoicePendingConfirmation(transcript: transcript, candidates: allowed)
            status = "Confirm the command you meant"
            let confirmationID = pendingConfirmation?.id
            confirmationTimeoutTask = Task { @MainActor [weak self] in
                try? await Task.sleep(for: .seconds(8))
                guard !Task.isCancelled, self?.pendingConfirmation?.id == confirmationID else { return }
                self?.cancelPendingCommand()
            }
            logMisrecognition(transcript)
        case .ignored:
            if !transcript.isEmpty { status = "Command not recognized"; logMisrecognition(transcript) }
        }
    }

    private func beginUtterance() throws {
        cleanUpUtterance()
        guard wantsListening, let recognizer, recognizer.isAvailable,
              recognizer.supportsOnDeviceRecognition else { throw VoiceError.localRecognitionUnavailable }
        let utteranceID = UUID()
        generation = utteranceID
        endingUtterance = false
        finalDelivered = false
        firstTranscriptAt = nil
        endpointRequestedAt = nil
        lastTranscript = ""
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.requiresOnDeviceRecognition = true
        request.shouldReportPartialResults = true
        request.taskHint = isDictating ? .dictation : .confirmation
        if isDictating { request.addsPunctuation = true }
        request.contextualStrings = isDictating ? [] : recognitionHints
        self.request = request
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard AVAudioSession.sharedInstance().isInputAvailable,
              format.sampleRate.isFinite, format.sampleRate > 0, format.channelCount > 0 else { throw VoiceError.noMicrophone }
        // `nonisolated(unsafe)`: AVAudioEngine calls this block synchronously on its own realtime
        // audio thread, never through Swift concurrency. Written as a plain closure inside this
        // `@MainActor` method, it would infer `@MainActor` isolation from context and the compiler
        // would insert a synchronous main-actor check at the top of the closure — which traps the
        // instant the audio thread (never the main actor) delivers the first buffer. `request` is
        // captured through this unsafe local so the closure can be `@Sendable`/nonisolated without
        // requiring `SFSpeechAudioBufferRecognitionRequest: Sendable`; Apple documents `append(_:)`
        // as safe to call off the main thread, and nothing else here touches actor-isolated state.
        nonisolated(unsafe) let tapRequest = request
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { @Sendable buffer, _ in tapRequest.append(buffer) }
        tapInstalled = true
        recognitionTask = recognizer.recognitionTask(with: request) { @Sendable [weak self] result, error in
            // Move only value types across the callback boundary, never the audio buffer or result object.
            let transcript = result?.bestTranscription.formattedString
            let isFinal = result?.isFinal ?? false
            let message = error?.localizedDescription
            Task { @MainActor [weak self] in
                self?.receive(transcript: transcript, isFinal: isFinal, error: message, id: utteranceID)
            }
        }
        engine.prepare()
        try engine.start()
        isPreparing = false
        isListening = true
        status = isDictating ? "Listening for your text…" : (isMuted ? "Muted — listening paused" : (pendingConfirmation == nil ? "Listening on this device" : "Confirm the command you meant"))
        if let start = captureRequestedAt {
            lastStartupMilliseconds = (ProcessInfo.processInfo.systemUptime - start) * 1_000
            captureRequestedAt = nil
        }
        refreshDiagnostics()
        // Renew finite recognizer tasks before the platform's session limit. This is a speech
        // lifecycle timer; the metronome is an independent sample-clock audio engine.
        renewalTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(45))
            guard !Task.isCancelled, let self, self.generation == utteranceID else { return }
            if self.isDictating { self.finishUtterance() }
            else if self.lastTranscript.isEmpty {
                // Long stretches of playing contain no command. Renew an empty request directly
                // instead of treating the recognizer's no-speech finalization as a fatal error.
                do { try self.beginUtterance() }
                catch { self.fail("Voice stopped: \(error.localizedDescription)") }
            } else { self.finishUtterance() }
        }
    }

    /// Stable, complete single-word commands can endpoint sooner. Multi-word phrases retain
    /// settle time so an intermediate number ("tempo ninety" → "tempo ninety six") cannot commit.
    /// These are endpoint delays, not a claim about microphone-to-action hardware latency.
    static func settleMilliseconds(for transcript: String, aliases: VoiceAliasConfiguration = .init()) -> UInt64 {
        let phrase = VoiceCommand.normalizedPhrase(transcript)
        if phrase == "confirm" || phrase == "cancel" { return 300 }
        if phrase.split(separator: " ").count == 1,
           case .command = VoiceCommandRecognition.recognize(phrase, aliases: aliases) { return 300 }
        return 600
    }

    private func receive(transcript: String?, isFinal: Bool, error: String?, id: UUID) {
        guard wantsListening, generation == id, !finalDelivered else { return }
        if let transcript, !transcript.isEmpty {
            if firstTranscriptAt == nil { firstTranscriptAt = ProcessInfo.processInfo.systemUptime }
            // Restart the silence deadline only when recognition actually changes its transcript.
            if transcript != lastTranscript, !endingUtterance {
                lastTranscript = transcript
                endpointTask?.cancel()
                let settle = isDictating ? 1_600 : Self.settleMilliseconds(for: transcript, aliases: commandAliases)
                endpointTask = Task { @MainActor [weak self] in
                    try? await Task.sleep(for: .milliseconds(settle))
                    guard !Task.isCancelled, self?.generation == id else { return }
                    self?.finishUtterance()
                }
            }
        }
        if isFinal {
            finalDelivered = true
            if isDictating {
                let text = (transcript ?? lastTranscript).trimmingCharacters(in: .whitespacesAndNewlines)
                let deliver = onTranscript
                stop()
                if text.isEmpty {
                    errorMessage = "No words were heard. Tap the microphone to try again, or type your text."
                } else { deliver?(text) }
                return
            }
            let finalText = transcript ?? lastTranscript
            let finalAt = ProcessInfo.processInfo.systemUptime
            if let first = firstTranscriptAt {
                let recognized: Bool
                if case .command = VoiceCommandRecognition.recognize(finalText, aliases: commandAliases, supportedActions: supportedActions) { recognized = true }
                else { recognized = false }
                lastTiming = VoiceRecognitionTiming(firstTextToFinalMilliseconds: (finalAt - first) * 1_000,
                    endpointToFinalMilliseconds: endpointRequestedAt.map { (finalAt - $0) * 1_000 }, commandWasRecognized: recognized)
            }
            processCommandTranscript(finalText)
            // The command may itself have turned off listening or dismissed the practice view.
            guard wantsListening, generation == id else { return }
            do { try beginUtterance() }
            catch { fail("Voice stopped: \(error.localizedDescription)") }
        } else if let error {
            fail("Voice stopped: \(error). Touch controls are always available.")
        }
    }

    private func finishUtterance() {
        guard wantsListening, !endingUtterance else { return }
        endingUtterance = true
        endpointRequestedAt = ProcessInfo.processInfo.systemUptime
        endpointTask?.cancel()
        renewalTask?.cancel()
        engine.stop()
        removeInputTap()
        request?.endAudio()
        status = isDictating ? "Finishing your text…" : "Finishing command…"
        let id = generation
        finalTimeoutTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(4))
            guard !Task.isCancelled, self?.generation == id else { return }
            self?.fail("Local speech did not finish the command. Nothing was recorded. Turn voice on to try again.")
        }
    }

    private func cleanUpUtterance() {
        endpointTask?.cancel()
        renewalTask?.cancel()
        finalTimeoutTask?.cancel()
        endpointTask = nil
        renewalTask = nil
        finalTimeoutTask = nil
        engine.stop()
        removeInputTap()
        request?.endAudio()
        recognitionTask?.cancel()
        recognitionTask = nil
        request = nil
    }

    private func removeInputTap() {
        if tapInstalled { engine.inputNode.removeTap(onBus: 0); tapInstalled = false }
    }

    private func failIfActive(_ message: String) { if wantsListening { fail(message) } }
    private func fail(_ message: String) { stop(); errorMessage = message; status = "Voice unavailable" }

    private func observe(_ name: Notification.Name, action: @escaping @MainActor @Sendable (AudioNotificationContext) -> Void) {
        notifications.tokens.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: nil) { @Sendable notification in
            let context = AudioNotificationContext(notification)
            // The engine posts configuration changes from an internal queue. Never synchronously
            // stop or tear it down on that callback stack; Apple documents a deadlock risk.
            Task { @MainActor in action(context) }
        })
    }

    private enum VoiceError: LocalizedError {
        case localRecognitionUnavailable, noMicrophone
        var errorDescription: String? {
            switch self {
            case .localRecognitionUnavailable: "On-device English speech recognition is unavailable."
            case .noMicrophone: "No compatible microphone is available."
            }
        }
    }
}
