import Foundation
import XCTest
@testable import PraeludeCore

final class SocialSupportTests: XCTestCase {

    // MARK: ActivityEventKind / ReactionKind / SocialTargetKind / ReportTargetKind raw values —
    // must match `supabase/migrations/20260926220006_social.sql` /
    // `20260926220007_moderation_and_leaderboard.sql`'s plain-text check constraints byte-for-byte;
    // a drift here is a silent 23514 check-constraint failure at runtime, not a compile error.

    func testActivityEventKindRawValuesMatchTheBackendCheckConstraint() {
        let expected: Set<String> = [
            "session_finished", "streak_milestone", "passage_performance_ready",
            "new_piece", "performance_date_set", "note_posted", "rank_badge",
        ]
        XCTAssertEqual(Set(ActivityEventKind.allCases.map(\.rawValue)), expected)
    }
    func testReactionKindRawValuesMatchTheBackendCheckConstraint() {
        let expected: Set<String> = ["bravo", "encore", "applause", "crescendo", "fermata"]
        XCTAssertEqual(Set(ReactionKind.allCases.map(\.rawValue)), expected)
    }
    func testSocialTargetKindRawValues() {
        XCTAssertEqual(SocialTargetKind.activityEvent.rawValue, "activity_event")
        XCTAssertEqual(SocialTargetKind.note.rawValue, "note")
    }
    func testReportTargetKindRawValuesMatchTheBackendCheckConstraint() {
        let expected: Set<String> = ["user", "note", "comment", "activity_event", "developer_contact"]
        XCTAssertEqual(Set(ReportTargetKind.allCases.map(\.rawValue)), expected)
    }

    // MARK: AgeBracket

    func testAgeBracketRawValuesMatchProfileEditViewsExistingStrings() {
        // ProfileEditView's ageBracketBinding already writes/reads these exact literals into
        // extras.ageBracket; the signup gate must agree on them without either file needing to change.
        XCTAssertEqual(AgeBracket.under13.rawValue, "under13")
        XCTAssertEqual(AgeBracket.teen.rawValue, "13-17")
        XCTAssertEqual(AgeBracket.adult.rawValue, "18plus")
    }
    func testOnlyEighteenPlusIsNotAMinor() {
        XCTAssertTrue(AgeBracket.under13.isMinor)
        XCTAssertTrue(AgeBracket.teen.isMinor)
        XCTAssertFalse(AgeBracket.adult.isMinor)
    }

    // MARK: ProfileBackendFields.applyingAgeGate — the actual signup-time decision AccountView fires.

    func testAdultGateLeavesPrivacyDefaultsUntouched() {
        let result = ProfileBackendFields().applyingAgeGate(.adult)
        XCTAssertEqual(result.ageBracket, "18plus")
        XCTAssertFalse(result.isPrivateAccount)
        XCTAssertFalse(result.leaderboardOptOut)
    }
    func testMinorGatesForcePrivateAccountAndLeaderboardOptOut() {
        for bracket in [AgeBracket.under13, .teen] {
            let result = ProfileBackendFields().applyingAgeGate(bracket)
            XCTAssertTrue(result.isPrivateAccount, "\(bracket) must start private")
            XCTAssertTrue(result.leaderboardOptOut, "\(bracket) must start opted out of leaderboards")
        }
    }
    func testAgeGateNeverLoosensAnAlreadyStricterSetting() {
        // A person who had already set isPrivateAccount before somehow re-running the gate (e.g. a
        // retry) must never have it flipped back to false by an adult bracket.
        var already = ProfileBackendFields()
        already.isPrivateAccount = true
        let result = already.applyingAgeGate(.adult)
        XCTAssertTrue(result.isPrivateAccount, "applyingAgeGate must never loosen an existing stricter setting")
    }
    func testAgeGatePreservesEveryOtherFieldUntouched() {
        var fields = ProfileBackendFields()
        fields.privacyPresence = .onlyMe
        fields.privacyNotes = .publicVisibility
        fields.upcomingPerformances = [BackendPerformance(date: Date())]
        let result = fields.applyingAgeGate(.teen)
        XCTAssertEqual(result.privacyPresence, .onlyMe)
        XCTAssertEqual(result.privacyNotes, .publicVisibility)
        XCTAssertEqual(result.upcomingPerformances, fields.upcomingPerformances)
    }

    // MARK: PresenceFreshness — mirrors friend_presence()'s ">2 minutes is stale" rule.

    func testFreshPresenceIsNotStale() {
        let now = Date()
        XCTAssertFalse(PresenceFreshness.isStale(updatedAt: now.addingTimeInterval(-60), now: now))
        XCTAssertTrue(PresenceFreshness.isCurrentlyPracticing(isPracticing: true, updatedAt: now.addingTimeInterval(-60), now: now))
    }
    func testPresenceOlderThanTwoMinutesIsStale() {
        let now = Date()
        XCTAssertTrue(PresenceFreshness.isStale(updatedAt: now.addingTimeInterval(-121), now: now))
        XCTAssertFalse(PresenceFreshness.isCurrentlyPracticing(isPracticing: true, updatedAt: now.addingTimeInterval(-121), now: now))
    }
    func testPresenceExactlyAtTheBoundaryIsNotYetStale() {
        let now = Date()
        XCTAssertFalse(PresenceFreshness.isStale(updatedAt: now.addingTimeInterval(-120), now: now))
    }
    func testNotPracticingIsNeverCurrentlyPracticingRegardlessOfAge() {
        let now = Date()
        XCTAssertFalse(PresenceFreshness.isCurrentlyPracticing(isPracticing: false, updatedAt: now, now: now))
    }

    // MARK: InviteLink — build/parse round trip and strict rejection of anything else.

    func testInviteLinkRoundTrips() {
        let url = InviteLink.url(code: "a1b2c3d4e5f6")
        XCTAssertEqual(url?.absoluteString, "praelude://invite/a1b2c3d4e5f6")
        XCTAssertEqual(url.flatMap(InviteLink.code(from:)), "a1b2c3d4e5f6")
    }
    func testInviteLinkRejectsTheAuthCallbackURL() {
        // The same custom scheme is reused for the unrelated magic-link callback; parsing must not
        // cross-trigger between the two hosts.
        let authCallback = URL(string: "praelude://auth-callback")!
        XCTAssertNil(InviteLink.code(from: authCallback))
    }
    func testInviteLinkRejectsAForeignScheme() {
        XCTAssertNil(InviteLink.code(from: URL(string: "https://example.com/invite/abc123")!))
    }
    func testInviteLinkRejectsAnEmptyCode() {
        XCTAssertNil(InviteLink.code(from: URL(string: "praelude://invite/")!))
    }

    // MARK: ContactHasher — deterministic, normalized, never hashes an empty field.

    func testSamePhoneNumberTypedDifferentlyHashesTheSame() {
        let a = ContactHasher.hash("(555) 123-4567", kind: .phone)
        let b = ContactHasher.hash("555-123-4567", kind: .phone)
        XCTAssertNotNil(a)
        XCTAssertEqual(a, b)
    }
    func testPhoneHashIncludesACountryCodeDigitDistinction() {
        // Different digit strings must not collide.
        let withCountryCode = ContactHasher.hash("+15551234567", kind: .phone)
        let withoutCountryCode = ContactHasher.hash("5551234567", kind: .phone)
        XCTAssertNotEqual(withCountryCode, withoutCountryCode)
    }
    func testEmailHashIsCaseAndWhitespaceInsensitive() {
        let a = ContactHasher.hash("  Friend@Example.com ", kind: .email)
        let b = ContactHasher.hash("friend@example.com", kind: .email)
        XCTAssertNotNil(a)
        XCTAssertEqual(a, b)
    }
    func testEmailAndPhoneOfTheSameDigitsHashDifferently() {
        // .phone and .email must be namespaced against each other, not just against raw input.
        let asPhone = ContactHasher.hash("5551234567", kind: .phone)
        let asEmailLookingTheSame = ContactHasher.hash("5551234567", kind: .email)
        XCTAssertNotEqual(asPhone, asEmailLookingTheSame)
    }
    func testBlankContactFieldsHashToNilRatherThanTheEmptyStringsHash() {
        XCTAssertNil(ContactHasher.hash("", kind: .phone))
        XCTAssertNil(ContactHasher.hash("   ", kind: .email))
        XCTAssertNil(ContactHasher.hash("+", kind: .phone))
    }
    func testHashIsLowercaseHex() {
        let hash = ContactHasher.hash("test@example.com", kind: .email)!
        XCTAssertEqual(hash.count, 64)
        XCTAssertTrue(hash.allSatisfy { $0.isHexDigit && !$0.isUppercase })
    }
}
