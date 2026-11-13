import Foundation
import XCTest
@testable import Praelude

/// §9: "every command confirmed... audibly." Covers the pure decision logic —
/// `VoiceConfirmationSound.forCommand`/`isVerdict` and `FeedbackService.playsAudibleConfirmation` —
/// never actual playback, the same restraint `RuntimeFeedbackTests` already documents for this app's
/// suite (no real audio-hardware service started in a test).
final class VoiceConfirmationTests: XCTestCase {
    private let verdicts: [VoiceCommand] = [.clean, .sloppy, .again, .shaky, .missed]
    private let nonVerdicts: [VoiceCommand] = [.start, .stop, .pause, .resume, .undo, .next, .slower, .faster,
                                                .metronomeStart, .metronomeStop, .setTempo(90), .nextPage, .previousPage]

    func testForCommandIsNilForEveryVerdictWord() {
        for verdict in verdicts { XCTAssertNil(VoiceConfirmationSound.forCommand(verdict), "\(verdict) already has its own FeedbackService tone") }
    }

    func testForCommandGivesEveryNonVerdictADistinctGenericTone() {
        for command in nonVerdicts { XCTAssertNotNil(VoiceConfirmationSound.forCommand(command), "\(command) must get an audible confirmation") }
    }

    func testIsVerdictMatchesExactlyTheFiveVerdictWords() {
        for verdict in verdicts { XCTAssertTrue(VoiceConfirmationSound.isVerdict(verdict)) }
        for command in nonVerdicts { XCTAssertFalse(VoiceConfirmationSound.isVerdict(command)) }
    }

    @MainActor
    func testPlaysAudibleConfirmationReflectsEachGate() {
        let suite = "Praelude-VoiceConfirmation-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        let feedback = FeedbackService(defaults: defaults)
        addTeardownBlock { UserDefaults(suiteName: suite)?.removePersistentDomain(forName: suite) }

        feedback.isEnabled = true; feedback.soundsEnabled = true; feedback.volume = 0.5
        XCTAssertTrue(feedback.playsAudibleConfirmation)

        feedback.isEnabled = false
        XCTAssertFalse(feedback.playsAudibleConfirmation, "Practice feedback off must count as 'no tone coming'")
        feedback.isEnabled = true

        feedback.soundsEnabled = false
        XCTAssertFalse(feedback.playsAudibleConfirmation, "Sounds specifically off must also count")
        feedback.soundsEnabled = true

        feedback.volume = 0
        XCTAssertFalse(feedback.playsAudibleConfirmation, "Zero volume plays nothing audible either")
        feedback.volume = 0.5
        XCTAssertTrue(feedback.playsAudibleConfirmation)
    }
}
