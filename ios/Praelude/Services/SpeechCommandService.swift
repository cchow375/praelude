import AVFoundation
import Observation
import Speech
import UIKit

/// A bounded handoff between requests keeps capturing the next utterance while iOS finalizes
/// the previous one. Only this short lock guards the request pointer and append/end ordering.
/// Audio buffers remain in Apple's recognition request; no files or user recordings are created.
final class SpeechAudioRequestBridge: @unchecked Sendable {
    private let lock = NSLock()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var durationLimit: TimeInterval?
    private var appendedSeconds: TimeInterval = 0
    var bufferedSeconds: TimeInterval {
        lock.lock(); defer { lock.unlock() }
        return appendedSeconds
    }
    func replace(with next: SFSpeechAudioBufferRecognitionRequest?, limitSeconds: TimeInterval? = nil) {
        lock.lock()
        request = next
        durationLimit = limitSeconds
        appendedSeconds = 0
        lock.unlock()
    }
    func append(_ buffer: AVAudioPCMBuffer) {
        lock.lock(); defer { lock.unlock() }
        guard let request, buffer.format.sampleRate.isFinite, buffer.format.sampleRate > 0 else { return }
        let seconds = Double(buffer.frameLength) / buffer.format.sampleRate
        if let limit = durationLimit, appendedSeconds + seconds > limit { return }
        request.append(buffer)
        if durationLimit != nil { appendedSeconds += seconds }
    }
}

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
    private(set) var isRecovering = false
    private(set) var recoveryCount = 0
    private(set) var lastRecoveryMessage: String?
    /// Opt-in remains owned during a recoverable interruption; explicit Off always clears it.
    var isEnabled: Bool { wantsListening }
    var activeRecognitionID: UUID { generation }
    var isCapturingNextUtterance: Bool { stagedRequest != nil }
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
    @ObservationIgnored private var stagedRequest: SFSpeechAudioBufferRecognitionRequest?
    @ObservationIgnored private let audioBridge = SpeechAudioRequestBridge()
    @ObservationIgnored private var recoveryTask: Task<Void, Never>?
    @ObservationIgnored private var recoveryAttempts = 0
    @ObservationIgnored private var audioInterrupted = false
    @ObservationIgnored private var lastCaptureStartedAt: TimeInterval?
    @ObservationIgnored private var lastSegmentTimestamp: TimeInterval?
    @ObservationIgnored private let captureOverride: (@MainActor () throws -> Void)?
    @ObservationIgnored private let recoveryDelay: @Sendable (Int) -> UInt64
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
         logMisrecognition: @escaping @MainActor (String) -> Void = { VoiceMisrecognitionLog.shared.record($0) },
         captureOverride: (@MainActor () throws -> Void)? = nil,
         recoveryDelay: @escaping @Sendable (Int) -> UInt64 = { UInt64(min(2_000, 250 * (1 << min($0 - 1, 3)))) }) {
        self.defaults = defaults
        if let data = defaults.data(forKey: Self.aliasesKey),
           let aliases = try? JSONDecoder().decode(VoiceAliasConfiguration.self, from: data),
           (try? aliases.validate()) != nil { commandAliases = aliases }
        else { commandAliases = VoiceAliasConfiguration() }
        self.speechPermission = speechPermission
        self.microphonePermission = microphonePermission
        self.confirmation = confirmation
        self.logMisrecognition = logMisrecognition
        self.captureOverride = captureOverride
        self.recoveryDelay = recoveryDelay
        observe(AVAudioSession.interruptionNotification) { [weak self] notification in
            guard let self, self.isListening || self.isRecovering,
                  let raw = notification.interruptionType else { return }
            if AVAudioSession.InterruptionType(rawValue: raw) == .began {
                self.audioInterrupted = true
                self.recover("iOS interrupted microphone audio.")
            } else {
                self.audioInterrupted = false
                if self.wantsListening { self.recover("Audio interruption ended.") }
            }
        }
        observe(UIApplication.didEnterBackgroundNotification) { [weak self] _ in self?.stop() }
        observe(AVAudioSession.routeChangeNotification) { [weak self] notification in
            guard let self else { return }
            self.refreshDiagnostics()
            guard self.isListening || self.isRecovering, let raw = notification.routeReason else { return }
            let reason = AVAudioSession.RouteChangeReason(rawValue: raw)
            if reason == .oldDeviceUnavailable || reason == .newDeviceAvailable {
                self.recover("Microphone route changed; reconnecting to the current input.")
            }
        }
        observe(AVAudioSession.mediaServicesWereResetNotification) { [weak self] _ in
            guard let self, self.isListening || self.isRecovering else { return }
            self.recover("iOS reset audio services; restoring microphone input.")
        }
        observe(.AVAudioEngineConfigurationChange) { [weak self] notification in
            guard let self, notification.sourceID == ObjectIdentifier(self.engine),
                  self.isListening, !self.engine.isRunning else { return }
            self.recover("Microphone configuration changed; restoring command input.")
        }
    }

    /// Calling this method is the opt-in. Neither initialization nor app launch asks for a microphone.
    func start(ownerID: UUID? = nil, onCommand: @escaping (VoiceCommand) -> Void) {
        guard !wantsListening else {
            if self.ownerID != ownerID { errorMessage = "Voice is already in use in another score or editor. Turn it off there before starting here." }
            else if !isListening && !isPreparing { retryListening(ifOwnedBy: ownerID) }
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
        recoveryAttempts = 0
        audioInterrupted = false
        isRecovering = false
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
            if self.captureOverride == nil {
                guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US")),
                      recognizer.supportsOnDeviceRecognition else {
                    self.fail("On-device English recognition is unavailable on this device. Touch controls work offline; voice never falls back to a server.")
                    return
                }
                self.recognizer = recognizer
            }
            do {
                if self.captureOverride == nil { try AudioSessionCoordinator.shared.acquire(.speech) }
                try self.beginUtterance()
            } catch {
                self.recover("Voice could not start: \(error.localizedDescription)")
            }
        }
    }

    func stop() {
        wantsListening = false
        generation = UUID() // Invalidates every queued permission/recognition callback.
        permissionTask?.cancel()
        permissionTask = nil
        recoveryTask?.cancel()
        recoveryTask = nil
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
        isRecovering = false
        audioInterrupted = false
        recoveryAttempts = 0
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
        guard value != isMuted else { return }
        isMuted = value
        if value { cancelPendingCommand() }
        guard wantsListening else { return }
        if isListening, !isDictating {
            // A delayed final must never deliver words spoken before mute or while muted.
            // Reuse the live engine/tap, but discard any staged audio from the old mute state.
            let discarded = stagedRequest
            stagedRequest = nil
            defer { discarded?.endAudio() }
            do { try beginUtterance(continuingCapture: true) }
            catch { recover("Voice mute changed: \(error.localizedDescription)") }
        }
        if isListening { status = value ? "Muted — listening paused" : "Listening on this device" }
        else if isRecovering { status = value ? "Muted · reconnecting microphone…" : "Reconnecting microphone…" }
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
        // The first saved rep enables Undo within the same set. That availability update must
        // not discard later separated verdicts in its final result or the next command's audio.
        // Delivery still checks the current action set, including when the last Undo is removed.
        let undoAvailabilityOnly = contextToken == token && self.supportedActions.symmetricDifference(actions) == [.undo]
        if changed { cancelPendingCommand() }
        contextToken = token
        self.supportedActions = actions
        if changed, !undoAvailabilityOnly, isListening, !isDictating, !isRecovering {
            // Old callbacks carry the prior generation. Discard them rather than applying speech
            // begun for a different set, grade prompt, or modal after the UI context has changed.
            do { try beginUtterance() }
            catch { recover("Voice context changed: \(error.localizedDescription)") }
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
    func processCommandTranscript(_ transcript: String, segments: [VoiceRecognizedSegment] = []) {
        guard wantsListening, !isDictating, !isMuted else { return }
        let phrases = VoiceFinalUtterances.phrases(transcript, segments: segments, aliases: commandAliases, supportedActions: supportedActions)
        let originalGeneration = generation
        for phrase in phrases {
            guard wantsListening, generation == originalGeneration else { break }
            processSingleCommandTranscript(phrase)
        }
    }

    private func processSingleCommandTranscript(_ transcript: String) {
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

    private func makeRequest() -> SFSpeechAudioBufferRecognitionRequest {
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.requiresOnDeviceRecognition = true
        request.shouldReportPartialResults = true
        request.taskHint = isDictating ? .dictation : .confirmation
        if isDictating { request.addsPunctuation = true }
        request.contextualStrings = isDictating ? [] : recognitionHints
        return request
    }

    private func beginUtterance(continuingCapture: Bool = false) throws {
        let next = continuingCapture ? (stagedRequest ?? makeRequest()) : nil
        if continuingCapture { audioBridge.replace(with: next) }
        cleanUpUtterance(keepCapture: continuingCapture)
        stagedRequest = nil
        guard wantsListening else { return }
        let utteranceID = UUID()
        generation = utteranceID
        endingUtterance = false
        finalDelivered = false
        firstTranscriptAt = nil
        endpointRequestedAt = nil
        lastSegmentTimestamp = nil
        lastTranscript = ""
        if let captureOverride {
            try captureOverride()
        } else {
            guard let recognizer, recognizer.isAvailable,
                  recognizer.supportsOnDeviceRecognition else { throw VoiceError.localRecognitionUnavailable }
            let request = next ?? makeRequest()
            self.request = request
            audioBridge.replace(with: request)
            if !tapInstalled {
                let input = engine.inputNode
                let format = input.outputFormat(forBus: 0)
                guard AVAudioSession.sharedInstance().isInputAvailable,
                      format.sampleRate.isFinite, format.sampleRate > 0, format.channelCount > 0 else { throw VoiceError.noMicrophone }
                let bridge = audioBridge
                input.installTap(onBus: 0, bufferSize: 1024, format: format) { @Sendable buffer, _ in bridge.append(buffer) }
                tapInstalled = true
            }
            recognitionTask = recognizer.recognitionTask(with: request) { @Sendable [weak self] result, error in
                let transcript = result?.bestTranscription.formattedString
                let segments = result?.bestTranscription.segments.map {
                    VoiceRecognizedSegment(text: $0.substring, timestamp: $0.timestamp, duration: $0.duration)
                } ?? []
                let isFinal = result?.isFinal ?? false
                let message = error?.localizedDescription
                Task { @MainActor [weak self] in
                    self?.receive(transcript: transcript, segments: segments, isFinal: isFinal, error: message, id: utteranceID)
                }
            }
            if !engine.isRunning { engine.prepare(); try engine.start() }
        }
        lastCaptureStartedAt = ProcessInfo.processInfo.systemUptime
        isPreparing = false
        isRecovering = false
        isListening = true
        errorMessage = nil
        status = isDictating ? "Listening for your text…" : (isMuted ? "Muted — listening paused" : (pendingConfirmation == nil ? "Listening on this device" : "Confirm the command you meant"))
        if let start = captureRequestedAt {
            lastStartupMilliseconds = (ProcessInfo.processInfo.systemUptime - start) * 1_000
            captureRequestedAt = nil
        }
        refreshDiagnostics()
        renewalTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(45))
            guard !Task.isCancelled, let self, self.generation == utteranceID else { return }
            // Quiet piano practice is an expected state, not a permanent microphone failure.
            self.recoveryAttempts = 0
            self.finishUtterance()
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

    func receive(transcript: String?, segments: [VoiceRecognizedSegment] = [], isFinal: Bool, error: String?, id: UUID) {
        guard wantsListening, generation == id, !finalDelivered else { return }
        if let transcript, !transcript.isEmpty {
            if firstTranscriptAt == nil { firstTranscriptAt = ProcessInfo.processInfo.systemUptime }
            // Equal words at a new acoustic timestamp are a new utterance; duplicate partial
            // callbacks for the same segment must not extend the deadline forever.
            let segmentTimestamp = segments.last?.timestamp
            if (transcript != lastTranscript || (segmentTimestamp != nil && segmentTimestamp != lastSegmentTimestamp)), !endingUtterance {
                lastTranscript = transcript
                lastSegmentTimestamp = segmentTimestamp
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
            recoveryAttempts = 0
            processCommandTranscript(finalText, segments: segments)
            // The command may itself have turned off listening or dismissed the practice view.
            guard wantsListening, generation == id else { return }
            do { try beginUtterance(continuingCapture: true) }
            catch { recover("Voice renewal failed: \(error.localizedDescription)") }
        } else if let error {
            recover("Recognition interrupted: \(error)")
        }
    }

    func finishUtterance() {
        guard wantsListening, !endingUtterance else { return }
        endingUtterance = true
        endpointRequestedAt = ProcessInfo.processInfo.systemUptime
        endpointTask?.cancel()
        renewalTask?.cancel()
        if isDictating {
            audioBridge.replace(with: nil)
            engine.stop()
            removeInputTap()
        } else {
            // Append the next command's audio immediately, before starting its recognition task.
            // Only one recognition task runs at a time. The timeout bounds this staging to 4s.
            stagedRequest = makeRequest()
            audioBridge.replace(with: stagedRequest, limitSeconds: 4)
        }
        request?.endAudio()
        status = isDictating ? "Finishing your text…" : "Listening · finishing command…"
        let id = generation
        finalTimeoutTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(4))
            guard !Task.isCancelled, self?.generation == id else { return }
            self?.recover("Local speech did not finish in time. The unfinished command was discarded.")
        }
    }

    private func cleanUpUtterance(keepCapture: Bool = false) {
        endpointTask?.cancel()
        renewalTask?.cancel()
        finalTimeoutTask?.cancel()
        endpointTask = nil
        renewalTask = nil
        finalTimeoutTask = nil
        if !keepCapture {
            audioBridge.replace(with: nil)
            engine.stop()
            removeInputTap()
            stagedRequest?.endAudio()
            stagedRequest = nil
        }
        request?.endAudio()
        recognitionTask?.cancel()
        recognitionTask = nil
        request = nil
    }

    private func removeInputTap() {
        if tapInstalled { engine.inputNode.removeTap(onBus: 0); tapInstalled = false }
    }

    func retryListening(ifOwnedBy owner: UUID?) {
        guard wantsListening, ownerID == owner, !isDictating else { return }
        recoveryAttempts = 0
        recover("Retrying microphone input.")
    }

    /// Retain explicit opt-in and ownership through transient failures. Never replay unfinished text.
    /// Four bounded backoff attempts avoid a hot retry loop if the hardware/recognizer stays broken.
    func recover(_ message: String) {
        guard wantsListening else { return }
        if isDictating { fail(message + " Tap the microphone to dictate again."); return }
        if captureOverride == nil {
            guard SFSpeechRecognizer.authorizationStatus() == .authorized else {
                fail("Speech permission is off. Allow Speech Recognition in Settings, then enable voice."); return
            }
            guard AVAudioApplication.shared.recordPermission == .granted else {
                fail("Microphone permission is off. Allow it in Settings, then enable voice."); return
            }
        }
        if let started = lastCaptureStartedAt, ProcessInfo.processInfo.systemUptime - started >= 10 { recoveryAttempts = 0 }
        lastCaptureStartedAt = nil
        generation = UUID()
        recoveryTask?.cancel()
        cancelPendingCommand()
        cleanUpUtterance()
        isListening = false
        isRecovering = true
        isPreparing = true
        errorMessage = nil
        lastRecoveryMessage = message
        if audioInterrupted {
            status = "Waiting for iOS audio interruption to end…"
            return
        }
        recoveryAttempts += 1
        guard recoveryAttempts <= 4 else {
            isRecovering = false
            isPreparing = false
            errorMessage = "Voice is paused after repeated audio failures. Tap the microphone to retry; your practice is preserved."
            status = "Tap microphone to retry"
            return
        }
        recoveryCount += 1
        status = "Reconnecting microphone…"
        let id = generation
        let delay = recoveryDelay(recoveryAttempts)
        recoveryTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .milliseconds(delay))
            guard !Task.isCancelled, let self, self.wantsListening, self.generation == id, !self.audioInterrupted else { return }
            self.recoveryTask = nil
            do {
                if self.captureOverride == nil {
                    self.engine = AVAudioEngine()
                    self.recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
                    guard self.recognizer?.supportsOnDeviceRecognition == true else {
                        self.fail("On-device English recognition is unavailable. Enable voice after local speech support is restored."); return
                    }
                    try AudioSessionCoordinator.shared.refresh(.speech)
                }
                try self.beginUtterance()
            } catch { self.recover("Microphone retry failed: \(error.localizedDescription)") }
        }
    }

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
