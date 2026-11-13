import XCTest
@testable import Praelude

/// Guards the one hard rule around this file (spec 4a/0): only a client-safe key may ever live here.
final class SupabaseConfigTests: XCTestCase {
    func testProjectURLIsWellFormedHTTPS() {
        XCTAssertEqual(SupabaseConfig.projectURL.scheme, "https")
        XCTAssertEqual(SupabaseConfig.projectURL.host, "zotswpjyvmhnxdyibnnz.supabase.co")
    }

    func testPublishableKeyLooksLikeAPublishableKeyNotASecret() {
        let key = SupabaseConfig.publishableKey
        XCTAssertTrue(key.hasPrefix("sb_publishable_"), "Only the publishable key may appear in this repo/app")
        XCTAssertFalse(key.hasPrefix("sb_secret_"), "The secret key must never appear in this repo/app")
        XCTAssertFalse(key.lowercased().contains("service_role"), "The legacy service_role key must never appear in this repo/app")
        XCTAssertGreaterThan(key.count, "sb_publishable_".count, "Key must carry an actual identifier past the prefix")
    }
}
