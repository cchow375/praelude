import AVFoundation
import Speech
import XCTest
@testable import Praelude

final class VoiceCaptureSafetyTests: XCTestCase {
    @MainActor func testMetronomeRegistrationsNeverBlockBackgroundAudioPosting() async throws {
        let suite = "Praelude-MetronomeNotifications-\(UUID())"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        // A private center exercises the actual service registrations without resetting the
        // app-wide metronome, interrupting other fixtures, or touching audio hardware.
        let center = NotificationCenter()
        let metronome = MetronomeService(defaults: defaults, notificationCenter: center)
        defer { metronome.stop() }
        let posted = DispatchSemaphore(value: 0)
        let handedOff = expectation(description: "Metronome notifications reach the main actor")
        DispatchQueue.global(qos: .userInitiated).async {
            center.post(name: .AVAudioEngineConfigurationChange, object: nil)
            center.post(name: AVAudioSession.routeChangeNotification, object: nil, userInfo: [
                AVAudioSessionRouteChangeReasonKey: AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue
            ])
            center.post(name: AVAudioSession.interruptionNotification, object: nil, userInfo: [
                AVAudioSessionInterruptionTypeKey: AVAudioSession.InterruptionType.began.rawValue
            ])
            center.post(name: AVAudioSession.interruptionNotification, object: nil, userInfo: [
                AVAudioSessionInterruptionTypeKey: AVAudioSession.InterruptionType.ended.rawValue,
                AVAudioSessionInterruptionOptionKey: UInt(0)
            ])
            center.post(name: AVAudioSession.mediaServicesWereResetNotification, object: nil)
            posted.signal()
            // Enqueued after the service's serial handoffs, so this is also a delivery barrier.
            DispatchQueue.main.async { handedOff.fulfill() }
        }
        // Model engine.start/stop occupying the UI actor while its worker posts notifications.
        // A synchronous queue:.main registration fails within this bounded wait instead of hanging.
        XCTAssertEqual(posted.wait(timeout: .now() + .milliseconds(250)), .success,
                       "Actual metronome registrations must let an audio posting thread return")
        await fulfillment(of: [handedOff], timeout: 2)
        metronome.start()
        XCTAssertFalse(metronome.isPlaying)
        XCTAssertEqual(metronome.errorMessage,
                       "Audio was reset by iOS. Reopen Praelude before restarting the metronome.",
                       "The real media-reset observer must still execute after the asynchronous handoff")
    }

    @MainActor func testAudioNotificationPosterReturnsWhileMainActorIsBusy() async {
        let name = Notification.Name("PraeludeAudioHandoff-\(UUID())")
        let bag = AudioNotificationBag()
        let delivered = expectation(description: "Copied audio notification reaches main actor")
        let posted = DispatchSemaphore(value: 0)
        observeAudioNotification(name, into: bag) { context in
            XCTAssertTrue(Thread.isMainThread)
            XCTAssertEqual(context.interruptionType, AVAudioSession.InterruptionType.began.rawValue)
            XCTAssertEqual(context.routeReason, AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue)
            delivered.fulfill()
        }
        DispatchQueue.global(qos: .userInitiated).async {
            NotificationCenter.default.post(name: name, object: nil, userInfo: [
                AVAudioSessionInterruptionTypeKey: AVAudioSession.InterruptionType.began.rawValue,
                AVAudioSessionRouteChangeReasonKey: AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue
            ])
            posted.signal()
        }
        // Deliberately occupy the UI actor to model engine.start/stop waiting for its worker.
        // This bounded wait fails with queue:.main delivery, without hanging the test process.
        XCTAssertEqual(posted.wait(timeout: .now() + .milliseconds(250)), .success,
                       "Posting audio notifications must never wait for the main actor")
        await fulfillment(of: [delivered], timeout: 2)
        withExtendedLifetime(bag) { }
    }

    func testPackagedMicrophoneAndSpeechDescriptionsArePresent() {
        XCTAssertNil(AudioInputPermissions.configurationIssue(requiresSpeech: true),
                     "The running app must carry both privacy descriptions before it requests either permission.")
    }

    func testMissingOrBlankPrivacyDescriptionsAreRejectedBeforePermissionRequest() {
        XCTAssertNotNil(AudioInputPermissions.configurationIssue(requiresSpeech: false, info: [:]))
        XCTAssertNotNil(AudioInputPermissions.configurationIssue(requiresSpeech: true,
                                                                 info: ["NSMicrophoneUsageDescription": "Microphone"]))
        XCTAssertNotNil(AudioInputPermissions.configurationIssue(requiresSpeech: true,
                                                                 info: ["NSMicrophoneUsageDescription": "Microphone", "NSSpeechRecognitionUsageDescription": "  "]))
        XCTAssertNil(AudioInputPermissions.configurationIssue(requiresSpeech: false,
                                                              info: ["NSMicrophoneUsageDescription": "Microphone"]))
    }

    @MainActor func testDeniedSpeechNeverRequestsMicrophoneAndReturnsRecoverableError() async {
        let reachedPermission = expectation(description: "Speech permission checked")
        let microphone = PermissionCallCount()
        let service = SpeechCommandService(speechPermission: {
            reachedPermission.fulfill()
            return .denied
        }, microphonePermission: {
            await microphone.increment()
            return true
        })
        service.start(ownerID: UUID()) { _ in XCTFail("A denied microphone must never deliver a command") }
        await fulfillment(of: [reachedPermission], timeout: 2)
        for _ in 0..<20 { await Task.yield() }
        XCTAssertFalse(service.isListening)
        XCTAssertFalse(service.isPreparing)
        XCTAssertNotNil(service.errorMessage)
        let calls = await microphone.value
        XCTAssertEqual(calls, 0)
    }

    @MainActor func testStopDuringPermissionPromptIgnoresLateGrant() async {
        let requested = expectation(description: "Speech prompt started")
        let gate = PermissionResultGate()
        let microphone = PermissionCallCount()
        let service = SpeechCommandService(speechPermission: {
            requested.fulfill()
            return await gate.wait()
        }, microphonePermission: {
            await microphone.increment()
            return true
        })
        let owner = UUID()
        service.startDictation(ownerID: owner) { _ in XCTFail("Canceled dictation cannot publish text") }
        XCTAssertTrue(service.isPreparing)
        XCTAssertTrue(service.isDictating)
        await fulfillment(of: [requested], timeout: 2)
        service.stop(ifOwnedBy: owner)
        await gate.resolve(.authorized)
        for _ in 0..<20 { await Task.yield() }
        XCTAssertNil(service.ownerID)
        XCTAssertFalse(service.isPreparing)
        XCTAssertFalse(service.isDictating)
        XCTAssertFalse(service.isListening)
        let calls = await microphone.value
        XCTAssertEqual(calls, 0, "A dismissed editor must not proceed to a second privacy prompt")
    }

    @MainActor func testUnrelatedWindowCannotStopPendingVoiceOwner() async {
        let requested = expectation(description: "Speech prompt started")
        let gate = PermissionResultGate()
        let service = SpeechCommandService(speechPermission: {
            requested.fulfill()
            return await gate.wait()
        }, microphonePermission: { false })
        let owner = UUID()
        service.start(ownerID: owner) { _ in XCTFail("No audio was started") }
        await fulfillment(of: [requested], timeout: 2)
        service.stop(ifOwnedBy: UUID())
        XCTAssertEqual(service.ownerID, owner)
        XCTAssertTrue(service.isPreparing)
        service.stop(ifOwnedBy: owner)
        await gate.resolve(.denied)
    }
    @MainActor func testCustomPhrasesPersistAndRestoreWithoutChangingDefaultVocabulary() throws {
        let suite = "Praelude-VoiceAliases-\(UUID())"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let service = SpeechCommandService(defaults: defaults)
        try service.updateAliases(["all clear"], for: .clean)
        try service.updateAliases(["speed"], for: .tempo)
        let reopened = SpeechCommandService(defaults: defaults)
        XCTAssertEqual(reopened.commandAliases.aliases(for: .clean), ["all clear"])
        XCTAssertEqual(VoiceCommandRecognition.recognize("speed ninety six", aliases: reopened.commandAliases), .command(.setTempo(96)))
        XCTAssertThrowsError(try service.updateAliases(["all clear"], for: .again))
        XCTAssertEqual(service.commandAliases.aliases(for: .again), [])
        reopened.restoreDefaultAliases()
        XCTAssertEqual(SpeechCommandService(defaults: defaults).commandAliases, VoiceAliasConfiguration())
        XCTAssertEqual(VoiceCommandRecognition.recognize("clean"), .command(.clean))
    }

    @MainActor func testNearMatchNeedsExplicitConfirmationAndContextChangeDiscardsIt() {
        var commands: [VoiceCommand] = []
        var confirmations: [VoiceCommand] = []
        let service = SpeechCommandService(speechPermission: { .denied }, confirmation: { confirmations.append($0) }, logMisrecognition: { _ in })
        let owner = UUID()
        // Test routing final text only; permission work cannot run until this actor yields.
        service.start(ownerID: owner) { commands.append($0) }
        service.processCommandTranscript("green")
        XCTAssertEqual(service.pendingConfirmation?.candidates, [.clean])
        XCTAssertTrue(commands.isEmpty)
        XCTAssertTrue(confirmations.isEmpty)
        service.processCommandTranscript("confirm")
        XCTAssertEqual(commands, [.clean])
        XCTAssertEqual(confirmations, [.clean])
        XCTAssertNil(service.pendingConfirmation)
        service.processCommandTranscript("glean")
        service.setCommandContext(UUID(), ifOwnedBy: owner)
        XCTAssertNil(service.pendingConfirmation)
        service.processCommandTranscript("confirm")
        XCTAssertEqual(commands, [.clean])
        service.stop()
    }

    @MainActor func testAmbiguousNearMatchRequiresSpecificChoiceAndCancelDoesNotWrite() throws {
        var commands: [VoiceCommand] = []
        let suite = "Praelude-VoiceAmbiguity-\(UUID())"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let service = SpeechCommandService(defaults: defaults, speechPermission: { .denied }, confirmation: { _ in }, logMisrecognition: { _ in })
        try service.updateAliases(["bloom"], for: .clean)
        try service.updateAliases(["brood"], for: .again)
        service.start(ownerID: UUID()) { commands.append($0) }
        defer { service.stop(); service.restoreDefaultAliases() }
        service.processCommandTranscript("broom")
        XCTAssertEqual(service.pendingConfirmation?.candidates, [.clean, .again])
        service.processCommandTranscript("confirm")
        XCTAssertTrue(commands.isEmpty, "An ambiguous spoken confirmation cannot choose between actions")
        service.confirmPendingCommand(.again)
        XCTAssertEqual(commands, [.again])
        service.processCommandTranscript("broom")
        service.processCommandTranscript("cancel")
        XCTAssertNil(service.pendingConfirmation)
        XCTAssertEqual(commands, [.again])
    }

    @MainActor func testFocusAndMuteKeepOwnershipWhileRejectingHistoryInput() {
        var commands: [VoiceCommand] = []
        let service = SpeechCommandService(speechPermission: { .denied }, confirmation: { _ in }, logMisrecognition: { _ in })
        let owner = UUID()
        service.start(ownerID: owner) { commands.append($0) }
        service.setPracticeInputSuspended(true)
        for phrase in ["clean", "again", "undo", "start", "stop", "next set", "green"] { service.processCommandTranscript(phrase) }
        XCTAssertTrue(commands.isEmpty)
        XCTAssertNil(service.pendingConfirmation)
        XCTAssertEqual(service.ownerID, owner)
        for phrase in ["next page", "metronome off", "tempo 72", "pause", "resume"] { service.processCommandTranscript(phrase) }
        XCTAssertEqual(commands, [.nextPage, .metronomeStop, .setTempo(72), .pause, .resume])
        service.setPracticeInputSuspended(false)
        service.setMuted(true)
        service.processCommandTranscript("clean")
        XCTAssertEqual(commands.count, 5)
        service.setMuted(false)
        service.processCommandTranscript("clean")
        XCTAssertEqual(commands.last, .clean)
        service.stop()
    }

    @MainActor func testStableSingleWordEndpointIsShorterButTempoAndUncertainTextKeepSettleTime() throws {
        XCTAssertEqual(SpeechCommandService.settleMilliseconds(for: "clean"), 300)
        XCTAssertEqual(SpeechCommandService.settleMilliseconds(for: "confirm"), 300)
        XCTAssertEqual(SpeechCommandService.settleMilliseconds(for: "green"), 600)
        XCTAssertEqual(SpeechCommandService.settleMilliseconds(for: "tempo ninety"), 600)
        XCTAssertEqual(SpeechCommandService.settleMilliseconds(for: "next page"), 600)
        let aliases = try VoiceAliasConfiguration().updating(["done"], for: .clean)
        XCTAssertEqual(SpeechCommandService.settleMilliseconds(for: "done", aliases: aliases), 300)
        XCTAssertEqual(SpeechCommandService.settleMilliseconds(for: "all clear", aliases: aliases), 600)
    }

    @MainActor private func eventually(_ predicate: @MainActor () -> Bool) async {
        let deadline = ProcessInfo.processInfo.systemUptime + 3
        while !predicate() && ProcessInfo.processInfo.systemUptime < deadline { try? await Task.sleep(for: .milliseconds(5)) }
        XCTAssertTrue(predicate())
    }

    @MainActor func testFinalCallbacksCountRepeatedCleanOncePerUtteranceAndKeepNextAudioStaged() async {
        var commands: [VoiceCommand] = []
        var captures = 0
        let service = SpeechCommandService(speechPermission: { .authorized }, microphonePermission: { true }, confirmation: { _ in }, logMisrecognition: { _ in }, captureOverride: { captures += 1 }, recoveryDelay: { _ in 0 })
        service.start(ownerID: UUID()) { commands.append($0) }
        defer { service.stop() }
        await eventually { service.isListening }
        let first = service.activeRecognitionID
        service.receive(transcript: "clean", isFinal: false, error: nil, id: first)
        XCTAssertTrue(commands.isEmpty, "Partial text cannot mutate repetitions")
        service.finishUtterance()
        XCTAssertTrue(service.isCapturingNextUtterance)
        service.receive(transcript: "clean", isFinal: true, error: nil, id: first)
        XCTAssertFalse(service.isCapturingNextUtterance)
        XCTAssertEqual(commands, [.clean])
        service.receive(transcript: "clean", isFinal: true, error: nil, id: first)
        XCTAssertEqual(commands, [.clean], "Duplicate final callbacks must not double count")
        let second = service.activeRecognitionID
        XCTAssertNotEqual(second, first)
        service.receive(transcript: "clean", isFinal: true, error: nil, id: second)
        XCTAssertEqual(commands, [.clean, .clean], "The same phrase in a new utterance is a new user verdict")
        let combined = service.activeRecognitionID
        service.receive(transcript: "clean clean", segments: [VoiceRecognizedSegment(text: "clean", timestamp: 0, duration: 0.2), VoiceRecognizedSegment(text: "clean", timestamp: 1, duration: 0.2)], isFinal: true, error: nil, id: combined)
        XCTAssertEqual(commands, [.clean, .clean, .clean, .clean])
        XCTAssertEqual(captures, 4)
    }

    @MainActor func testTransientRecognitionFailureRecoversWithOwnerContextAndNoStaleVerdict() async {
        var commands: [VoiceCommand] = []
        let service = SpeechCommandService(speechPermission: { .authorized }, microphonePermission: { true }, confirmation: { _ in }, logMisrecognition: { _ in }, captureOverride: { }, recoveryDelay: { _ in 0 })
        let owner = UUID()
        service.start(ownerID: owner) { commands.append($0) }
        defer { service.stop() }
        await eventually { service.isListening }
        service.setCommandContext(UUID(), supportedActions: [.clean, .nextPage], ifOwnedBy: owner)
        let stale = service.activeRecognitionID
        service.receive(transcript: "clean", isFinal: false, error: nil, id: stale)
        service.receive(transcript: nil, isFinal: false, error: "Transient recognizer failure", id: stale)
        XCTAssertTrue(service.isEnabled)
        XCTAssertTrue(service.isRecovering)
        XCTAssertNil(service.errorMessage, "Expected reconnection should not leave a red terminal error")
        XCTAssertEqual(service.ownerID, owner)
        service.receive(transcript: "clean", isFinal: true, error: nil, id: stale)
        XCTAssertTrue(commands.isEmpty)
        await eventually { service.isListening && !service.isRecovering }
        XCTAssertEqual(service.supportedActions, [.clean, .nextPage])
        XCTAssertNil(service.errorMessage)
        service.receive(transcript: "next", isFinal: true, error: nil, id: service.activeRecognitionID)
        XCTAssertEqual(commands, [.nextPage])
        service.receive(transcript: "clean", isFinal: true, error: nil, id: service.activeRecognitionID)
        XCTAssertEqual(commands, [.nextPage, .clean])
    }

    @MainActor func testFirstCleanEnablesUndoWithoutDroppingRepeatedFinalVerdictsOrStagedAudio() async {
        var commands: [VoiceCommand] = []
        let capture = VoiceCaptureProbe()
        let service = SpeechCommandService(speechPermission: { .authorized }, microphonePermission: { true },
                                           confirmation: { _ in }, logMisrecognition: { _ in },
                                           captureOverride: { try capture.start() })
        let owner = UUID(), setID = UUID()
        let baseActions: Set<VoiceCommandAction> = [.clean, .nextPage]
        service.start(ownerID: owner) { command in
            commands.append(command)
            if commands.count == 1 {
                let generation = service.activeRecognitionID
                let captures = capture.count
                service.setCommandContext(setID, supportedActions: baseActions.union([.undo]), ifOwnedBy: owner)
                XCTAssertEqual(service.activeRecognitionID, generation)
                XCTAssertEqual(capture.count, captures, "Enabling Undo must not renew capture during a final result")
                XCTAssertTrue(service.isCapturingNextUtterance, "The staged next utterance must survive enabling Undo")
            }
        }
        defer { service.stop() }
        await eventually { service.isListening }
        service.setCommandContext(setID, supportedActions: baseActions, ifOwnedBy: owner)
        let first = service.activeRecognitionID
        let segments = [
            VoiceRecognizedSegment(text: "clean", timestamp: 0, duration: 0.2),
            VoiceRecognizedSegment(text: "clean", timestamp: 1, duration: 0.2),
            VoiceRecognizedSegment(text: "clean", timestamp: 2, duration: 0.2)
        ]
        service.receive(transcript: "clean clean clean", segments: segments, isFinal: false, error: nil, id: first)
        service.finishUtterance()
        XCTAssertTrue(service.isCapturingNextUtterance)
        let captures = capture.count
        service.receive(transcript: "clean clean clean", segments: segments, isFinal: true, error: nil, id: first)
        XCTAssertEqual(commands, [.clean, .clean, .clean])
        XCTAssertEqual(capture.count, captures + 1, "Only the normal final-result handoff renews recognition")
        XCTAssertNotEqual(service.activeRecognitionID, first)
        XCTAssertTrue(service.supportedActions.contains(.undo))

        let second = service.activeRecognitionID
        service.receive(transcript: "undo", isFinal: false, error: nil, id: second)
        service.finishUtterance()
        let capturesBeforeRemoval = capture.count
        service.setCommandContext(setID, supportedActions: baseActions, ifOwnedBy: owner)
        XCTAssertEqual(service.activeRecognitionID, second)
        XCTAssertEqual(capture.count, capturesBeforeRemoval)
        XCTAssertTrue(service.isCapturingNextUtterance, "Removing Undo must also retain staged audio")
        service.receive(transcript: "undo", isFinal: true, error: nil, id: second)
        XCTAssertEqual(commands, [.clean, .clean, .clean], "An Undo removed before final delivery must be rejected")
        XCTAssertEqual(service.ownerID, owner)
    }

    @MainActor func testUndoAvailabilityExceptionStillRejectsOtherOwnersAndRenewsChangedContexts() async {
        let service = SpeechCommandService(speechPermission: { .authorized }, microphonePermission: { true },
                                           confirmation: { _ in }, logMisrecognition: { _ in }, captureOverride: {})
        let owner = UUID(), firstSet = UUID(), secondSet = UUID()
        service.start(ownerID: owner) { _ in XCTFail("No final result should be delivered") }
        defer { service.stop() }
        await eventually { service.isListening }
        service.setCommandContext(firstSet, supportedActions: [.clean], ifOwnedBy: owner)
        let original = service.activeRecognitionID
        service.finishUtterance()
        service.setCommandContext(firstSet, supportedActions: [.clean, .undo], ifOwnedBy: UUID())
        XCTAssertEqual(service.activeRecognitionID, original)
        XCTAssertEqual(service.supportedActions, [.clean])
        XCTAssertTrue(service.isCapturingNextUtterance)

        service.setCommandContext(secondSet, supportedActions: [.clean, .undo], ifOwnedBy: owner)
        XCTAssertNotEqual(service.activeRecognitionID, original, "Changing sets renews even when only Undo availability differs")
        XCTAssertFalse(service.isCapturingNextUtterance)
        let changedSet = service.activeRecognitionID
        service.finishUtterance()
        service.setCommandContext(secondSet, supportedActions: [], ifOwnedBy: owner)
        XCTAssertNotEqual(service.activeRecognitionID, changedSet, "Modal suspension must still retire the old generation")
        XCTAssertFalse(service.isCapturingNextUtterance)
    }

    @MainActor func testUnmuteDiscardsMutedPartialFinalAndStagedAudioButKeepsOwner() async {
        var commands: [VoiceCommand] = []
        let capture = VoiceCaptureProbe()
        let service = SpeechCommandService(speechPermission: { .authorized }, microphonePermission: { true },
                                           confirmation: { _ in }, logMisrecognition: { _ in },
                                           captureOverride: { try capture.start() }, recoveryDelay: { _ in 0 })
        let owner = UUID()
        service.start(ownerID: owner) { commands.append($0) }
        defer { service.stop() }
        await eventually { service.isListening }
        service.setCommandContext(owner, supportedActions: [.clean, .nextPage], ifOwnedBy: owner)
        let beforeMute = service.activeRecognitionID
        service.receive(transcript: "next", isFinal: false, error: nil, id: beforeMute)
        service.setMuted(true)
        let muted = service.activeRecognitionID
        XCTAssertNotEqual(muted, beforeMute)
        service.receive(transcript: "clean", isFinal: false, error: nil, id: muted)
        service.finishUtterance()
        XCTAssertTrue(service.isCapturingNextUtterance)

        service.setMuted(false)
        let unmuted = service.activeRecognitionID
        XCTAssertNotEqual(unmuted, muted)
        XCTAssertFalse(service.isCapturingNextUtterance, "The next request must discard staged muted audio")
        XCTAssertTrue(service.isEnabled)
        XCTAssertTrue(service.isListening)
        XCTAssertEqual(service.ownerID, owner)
        XCTAssertEqual(service.supportedActions, [.clean, .nextPage])
        service.receive(transcript: "next", isFinal: true, error: nil, id: beforeMute)
        service.receive(transcript: "clean", isFinal: true, error: nil, id: muted)
        XCTAssertTrue(commands.isEmpty, "A final from either retired mute state cannot turn pages or record reps")

        service.receive(transcript: "clean", isFinal: true, error: nil, id: unmuted)
        XCTAssertEqual(commands, [.clean], "A fresh utterance after unmute uses the retained command callback")
        XCTAssertNotEqual(service.activeRecognitionID, unmuted)
        XCTAssertTrue(service.isListening)
    }

    @MainActor func testFourFailedRetriesRemainRecoverableAndExplicitOffCancelsQueuedRestart() async {
        let capture = VoiceCaptureProbe()
        let service = SpeechCommandService(speechPermission: { .authorized }, microphonePermission: { true }, confirmation: { _ in }, logMisrecognition: { _ in }, captureOverride: {
            try capture.start()
        }, recoveryDelay: { _ in 0 })
        let owner = UUID()
        service.start(ownerID: owner) { _ in XCTFail("Unfinished text is not a command") }
        await eventually { service.isListening }
        capture.shouldFail = true
        service.recover("Transient input failure")
        await eventually { service.isEnabled && !service.isPreparing && !service.isListening }
        XCTAssertEqual(capture.count, 5, "Initial capture plus four bounded retries")
        XCTAssertEqual(service.ownerID, owner)
        XCTAssertNotNil(service.errorMessage)
        capture.shouldFail = false
        service.start(ownerID: owner) { _ in XCTFail("Retry must retain the original callback") }
        await eventually { service.isListening }
        XCTAssertNil(service.errorMessage)
        service.recover("Another transient failure")
        service.stop(ifOwnedBy: owner)
        let stoppedCaptureCount = capture.count
        try? await Task.sleep(for: .milliseconds(30))
        XCTAssertEqual(capture.count, stoppedCaptureCount)
        XCTAssertFalse(service.isEnabled)
        XCTAssertFalse(service.isRecovering)
        XCTAssertNil(service.ownerID)
    }

    @MainActor func testStagedAudioRequestHasAFourSecondMemoryBound() throws {
        let bridge = SpeechAudioRequestBridge()
        let format = try XCTUnwrap(AVAudioFormat(standardFormatWithSampleRate: 48_000, channels: 1))
        let buffer = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 48_000))
        buffer.frameLength = 48_000
        if let data = buffer.floatChannelData { data[0].initialize(repeating: 0, count: 48_000) }
        bridge.replace(with: SFSpeechAudioBufferRecognitionRequest(), limitSeconds: 4)
        for _ in 0..<10 { bridge.append(buffer) }
        XCTAssertEqual(bridge.bufferedSeconds, 4, accuracy: 0.0001)
        bridge.replace(with: nil)
        bridge.append(buffer)
        XCTAssertEqual(bridge.bufferedSeconds, 0)
    }

}

@MainActor private final class VoiceCaptureProbe {
    var shouldFail = false
    private(set) var count = 0

    func start() throws {
        count += 1
        if shouldFail { throw CocoaError(.fileReadUnknown) }
    }
}

private actor PermissionCallCount {
    private(set) var value = 0
    func increment() { value += 1 }
}

private actor PermissionResultGate {
    private var continuation: CheckedContinuation<SFSpeechRecognizerAuthorizationStatus, Never>?
    private var resolved: SFSpeechRecognizerAuthorizationStatus?
    func wait() async -> SFSpeechRecognizerAuthorizationStatus {
        if let resolved { return resolved }
        return await withCheckedContinuation { continuation = $0 }
    }
    func resolve(_ value: SFSpeechRecognizerAuthorizationStatus) {
        resolved = value
        continuation?.resume(returning: value)
        continuation = nil
    }
}
