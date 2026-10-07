import Foundation
import CryptoKit
import XCTest
@testable import Praelude

@MainActor final class StorageIdentityTests: XCTestCase {
    func testOwnerFolderMatchesPostgresCanonicalUUID() {
        let owner = UUID(uuidString: "ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDEF")!
        let record = UUID(uuidString: "FEDCBAFE-DCBA-4FED-8CBA-FEDCBAFEDCBA")!
        let path = ScoreAndRecordingStorage.objectPath(ownerID: owner, recordID: record, fileName: "Score.pdf")
        XCTAssertEqual(path, "abcdefab-cdef-4abc-8def-abcdefabcdef/fedcbafe-dcba-4fed-8cba-fedcbafedcba/Score.pdf")
    }
    func testUntrustedRemoteFileNamesCannotEscapeOwnedFolder() {
        for name in ["../library.json", "/private/file.pdf", "a/b.pdf", "a\\b.pdf", ".", "..", ""] {
            XCTAssertFalse(ScoreAndRecordingStorage.isSafeFileName(name), name)
        }
        XCTAssertTrue(ScoreAndRecordingStorage.isSafeFileName("score.pdf"))
    }
    func testBackgroundFileFingerprintMatchesCompleteDataDigest() async throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("praelude-hash-\(UUID())")
        let data = Data(repeating: 0xA5, count: 170_000)
        try data.write(to: url); defer { try? FileManager.default.removeItem(at: url) }
        let digest = try await Task.detached { try ScoreAndRecordingStorage.fingerprint(url) }.value
        XCTAssertEqual(digest, SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined())
    }

}
