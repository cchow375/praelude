import AVFoundation
import Observation
import Speech
import UIKit

/// Explicit opt-in, local speech commands. Partial transcripts never mutate practice.
@MainActor @Observable
final class SpeechCommandService {
    private(set) var status = "Voice is off"
    private(set) var isListening = false
    private(set) var isPreparing = false
    private(set) var isDictating = false
    private(set) var errorMessage: String?
    private(set) var lastTranscript = ""
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
    @ObservationIgnored private var onCommand: ((VoiceCommand) -> Void)?
    @ObservationIgnored private var onTranscript: ((String) -> Void)?
    @ObservationIgnored private var generation = UUID()
    @ObservationIgnored private var wantsListening = false
    @ObservationIgnored private var tapInstalled = false
    @ObservationIgnored private var endingUtterance = false
    @ObservationIgnored private var finalDelivered = false
    @ObservationIgnored private let speechPermission: @Sendable () async -> SFSpeechRecognizerAuthorizationStatus
    @ObservationIgnored private let microphonePermission: @Sendable () async -> Bool

    init(speechPermission: @escaping @Sendable () async -> SFSpeechRecognizerAuthorizationStatus = AudioInputPermissions.speechPermission,
         microphonePermission: @escaping @Sendable () async -> Bool = AudioInputPermissions.microphoneGranted) {
        self.speechPermission = speechPermission
        self.microphonePermission = microphonePermission
        observe(AVAudioSession.interruptionNotification) { [weak self] notification in
            guard let raw = notification.interruptionType,
                  AVAudioSession.InterruptionType(rawValue: raw) == .began else { return }
            self?.failIfActive("Voice stopped for an audio interruption. Turn it on again when ready.")
        }
        observe(UIApplication.didEnterBackgroundNotification) { [weak self] _ in self?.stop() }
        observe(AVAudioSession.routeChangeNotification) { [weak self] notification in
            guard let raw = notification.routeReason,
                  AVAudioSession.RouteChangeReason(rawValue: raw) == .oldDeviceUnavailable else { return }
            self?.failIfActive("Microphone or headphones disconnected. Check your audio route and turn voice on again.")
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
        guard !wantsListening else { return }
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
            guard speechPermission == .authorized else {
                self.fail("Speech permission is off. Allow Speech Recognition for Praelude in Settings to use voice commands.")
                return
            }
            let microphoneGranted = await self.microphonePermission()
            guard self.wantsListening, self.generation == startID, !Task.isCancelled else { return }
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
        cleanUpUtterance()
        recognizer = nil
        onCommand = nil
        onTranscript = nil
        ownerID = nil
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
        guard wantsListening else { return }
        status = value ? "Muted — listening paused" : "Listening on this device"
    }

    private func beginUtterance() throws {
        cleanUpUtterance()
        guard wantsListening, let recognizer, recognizer.isAvailable,
              recognizer.supportsOnDeviceRecognition else { throw VoiceError.localRecognitionUnavailable }
        let utteranceID = UUID()
        generation = utteranceID
        endingUtterance = false
        finalDelivered = false
        lastTranscript = ""
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.requiresOnDeviceRecognition = true
        request.shouldReportPartialResults = true
        request.taskHint = isDictating ? .dictation : .confirmation
        if isDictating { request.addsPunctuation = true }
        request.contextualStrings = isDictating ? [] : ["clean", "sloppy", "again", "undo", "pause", "resume",
                                     "shaky", "missed", "start", "stop", "next", "slower", "faster",
                                     "metronome start", "metronome stop", "tempo", "next page", "previous page"]
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
        status = isDictating ? "Listening for your text…" : (isMuted ? "Muted — listening paused" : "Listening on this device")
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

    /// §9 asks for "~0.5 s latency" without losing accuracy. This was 1200ms; halved rather than cut
    /// to the literal 500ms floor, because a still-revising partial transcript (most likely mid-way
    /// through a multi-word phrase like "tempo ninety six") needs *some* settle time before commit —
    /// finalizing on an intermediate partial that the recognizer was about to correct is exactly the
    /// premature-finalization failure mode documented on the Mac side (`NOTES.md`/"(C) Flaws.md" B3,
    /// "Progressive-revision metronome artifact"). The silence deadline still restarts on every
    /// transcript *change* (below), so a genuinely still-speaking phrase keeps extending it; only a
    /// transcript that has stopped changing is ever finalized early.
    private static let silenceTimeoutMilliseconds: UInt64 = 600

    private func receive(transcript: String?, isFinal: Bool, error: String?, id: UUID) {
        guard wantsListening, generation == id, !finalDelivered else { return }
        if let transcript, !transcript.isEmpty {
            // Restart the silence deadline only when recognition actually changes its transcript.
            if transcript != lastTranscript, !endingUtterance {
                lastTranscript = transcript
                endpointTask?.cancel()
                endpointTask = Task { @MainActor [weak self] in
                    try? await Task.sleep(for: .milliseconds(self?.isDictating == true ? 1_600 : Self.silenceTimeoutMilliseconds))
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
            let command = VoiceCommand.parse(transcript ?? "")
            if isMuted {
                // Muted: still recognizes (so un-muting is instant), but takes no action and keeps
                // no record of what it heard — a deliberate no-op, not merely "no sound".
            } else if let command {
                VoiceConfirmationPlayer.shared.confirm(command)
                onCommand?(command)
            } else if let transcript, !transcript.isEmpty {
                status = "Command not recognized"
                VoiceMisrecognitionLog.shared.record(transcript)
            }
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
