import AVFoundation
import Speech
import XCTest
@testable import Praelude

final class VoiceCaptureSafetyTests: XCTestCase {
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
