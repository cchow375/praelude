import Foundation
import CryptoKit
import XCTest
import UIKit
import AVFAudio
@testable import Praelude

@MainActor final class StorageIdentityTests: XCTestCase {
    @MainActor private final class AssetNoticeProbe {
        var receiptSaved = false
        var urls: [URL] = []
        var noticeSawDurableBytes = false
        var noticePrecededReceipt = false
    }
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

    func testRefreshedCredentialsMustMatchQueueOrStorageOwner() throws {
        let owner = UUID()
        XCTAssertNoThrow(try SupabaseServices.requireExpectedOwner(owner, actualOwnerID: owner))
        XCTAssertThrowsError(try SupabaseServices.requireExpectedOwner(owner, actualOwnerID: UUID()))
        XCTAssertNoThrow(try SupabaseServices.requireExpectedOwner(nil, actualOwnerID: owner))
    }

    func testBackgroundDownloadPublishesExactCompleteBytes() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("praelude-download-\(UUID())")
        defer { try? FileManager.default.removeItem(at: directory) }
        let destination = directory.appendingPathComponent("score.pdf")
        let bytes = Data(repeating: 0x59, count: 1_200_000)
        let staged = try await Task.detached { try ScoreAndRecordingStorage.stageDownload(bytes, destination: destination) }.value
        XCTAssertFalse(FileManager.default.fileExists(atPath: destination.path), "Incomplete bytes must not become an available score.")
        XCTAssertEqual(staged.fingerprint, SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined())
        XCTAssertTrue(try ScoreAndRecordingStorage.publishDownload(staged, destination: destination))
        XCTAssertEqual(try Data(contentsOf: destination), bytes)
        XCTAssertFalse(FileManager.default.fileExists(atPath: staged.url.path))
    }

    func testAssetAvailabilityFollowsNewPublicationEvenWhenReceiptPersistenceFails() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("praelude-download-notice-\(UUID())")
        defer { try? FileManager.default.removeItem(at: directory) }
        let destination = directory.appendingPathComponent("score.pdf")
        let bytes = Data("complete synthetic score bytes".utf8)
        let probe = AssetNoticeProbe()
        let observer = NotificationCenter.default.addObserver(forName: .praeludeLibraryAssetAvailable, object: nil, queue: .main) { notification in
            let url = notification.object as? URL
            MainActor.assumeIsolated {
                // The derived parent URL has a directory slash; the constructed fixture URL may
                // not. Compare normalized filesystem paths rather than URL directory syntax.
                guard let url, url.deletingLastPathComponent().standardizedFileURL.path == directory.standardizedFileURL.path else { return }
                probe.urls.append(url)
                probe.noticeSawDurableBytes = (try? Data(contentsOf: url)) == bytes
                probe.noticePrecededReceipt = !probe.receiptSaved
            }
        }
        defer { NotificationCenter.default.removeObserver(observer) }

        let staged = try ScoreAndRecordingStorage.stageDownload(bytes, destination: destination)
        XCTAssertTrue(try ScoreAndRecordingStorage.publishAndAcknowledgeDownload(staged, destination: destination) {
            probe.receiptSaved = true
        })
        XCTAssertEqual(probe.urls, [destination])
        XCTAssertTrue(probe.noticeSawDurableBytes, "The notice must follow complete published bytes")
        XCTAssertTrue(probe.noticePrecededReceipt, "Local availability must not depend on later receipt persistence")

        let redundant = try ScoreAndRecordingStorage.stageDownload(bytes, destination: destination)
        defer { try? FileManager.default.removeItem(at: redundant.url) }
        XCTAssertFalse(try ScoreAndRecordingStorage.publishAndAcknowledgeDownload(redundant, destination: destination) {
            XCTFail("An existing local asset must not be acknowledged as a new download")
        })
        let receiptFailureURL = directory.appendingPathComponent("receipt-failure.pdf")
        let receiptFailure = try ScoreAndRecordingStorage.stageDownload(bytes, destination: receiptFailureURL)
        probe.receiptSaved = false
        XCTAssertThrowsError(try ScoreAndRecordingStorage.publishAndAcknowledgeDownload(receiptFailure, destination: receiptFailureURL) {
            throw CocoaError(.fileWriteOutOfSpace)
        })
        XCTAssertEqual(try Data(contentsOf: receiptFailureURL), bytes, "A receipt failure must retain the complete downloaded file")
        XCTAssertEqual(probe.urls, [destination, receiptFailureURL])
        XCTAssertTrue(probe.noticeSawDurableBytes)
        XCTAssertTrue(probe.noticePrecededReceipt)
        let missingStage = ScoreAndRecordingStorage.StagedDownload(url: directory.appendingPathComponent("missing-stage"), fingerprint: "unused")
        XCTAssertThrowsError(try ScoreAndRecordingStorage.publishAndAcknowledgeDownload(missingStage, destination: directory.appendingPathComponent("missing.pdf")) {
            XCTFail("A publication failure must not persist a success receipt")
        })
        XCTAssertThrowsError(try ScoreAndRecordingStorage.stageDownload(Data("malformed score".utf8), destination: directory.appendingPathComponent("invalid.pdf"), validatingBucket: "scores"))
        XCTAssertEqual(probe.urls, [destination, receiptFailureURL], "Existing/rejected assets and malformed staging emit no availability event")
    }

    func testLateCloudDownloadCannotReplaceNewlyLocalScore() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("praelude-download-preserve-\(UUID())")
        defer { try? FileManager.default.removeItem(at: directory) }
        let destination = directory.appendingPathComponent("score.pdf")
        let staged = try await Task.detached { try ScoreAndRecordingStorage.stageDownload(Data("cloud copy".utf8), destination: destination) }.value
        defer { try? FileManager.default.removeItem(at: staged.url) }
        let localBytes = Data("newly restored local score".utf8)
        try localBytes.write(to: destination)
        XCTAssertFalse(try ScoreAndRecordingStorage.publishDownload(staged, destination: destination))
        XCTAssertEqual(try Data(contentsOf: destination), localBytes)
    }

    func testEmptyCloudFileIsNeverPublished() {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("praelude-download-empty-\(UUID())")
        defer { try? FileManager.default.removeItem(at: directory) }
        let destination = directory.appendingPathComponent("score.pdf")
        XCTAssertThrowsError(try ScoreAndRecordingStorage.stageDownload(Data(), destination: destination))
        XCTAssertFalse(FileManager.default.fileExists(atPath: destination.path))
    }

    func testMalformedCloudAssetsAreRejectedWithoutLocalPublicationOrStagingDebris() {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("praelude-download-invalid-\(UUID())")
        defer { try? FileManager.default.removeItem(at: directory) }
        for (bucket, name) in [("scores", "score.pdf"), ("covers", "cover.jpg"), ("recordings", "take.wav")] {
            let destination = directory.appendingPathComponent(name)
            XCTAssertThrowsError(try ScoreAndRecordingStorage.stageDownload(Data("a nonempty damaged cloud object".utf8), destination: destination, validatingBucket: bucket))
            XCTAssertFalse(FileManager.default.fileExists(atPath: destination.path))
        }
        XCTAssertEqual((try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? [], [])
    }

    func testReadableCloudPDFAndCoverValidateOnWorkerBeforePublication() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("praelude-download-valid-\(UUID())")
        defer { try? FileManager.default.removeItem(at: directory) }
        let pdf = UIGraphicsPDFRenderer(bounds: CGRect(x: 0, y: 0, width: 300, height: 200)).pdfData { $0.beginPage() }
        let image = UIGraphicsImageRenderer(size: CGSize(width: 40, height: 20)).image { context in
            UIColor.white.setFill(); context.fill(CGRect(x: 0, y: 0, width: 40, height: 20))
        }
        let jpeg = try XCTUnwrap(image.jpegData(compressionQuality: 0.8))
        for (bucket, name, bytes) in [("scores", "score.pdf", pdf), ("covers", "cover.jpg", jpeg)] {
            let destination = directory.appendingPathComponent(name)
            let staged = try await Task.detached { try ScoreAndRecordingStorage.stageDownload(bytes, destination: destination, validatingBucket: bucket) }.value
            XCTAssertFalse(FileManager.default.fileExists(atPath: destination.path))
            XCTAssertTrue(try ScoreAndRecordingStorage.publishDownload(staged, destination: destination))
            XCTAssertEqual(try Data(contentsOf: destination), bytes)
        }
    }

    func testReadableCloudRecordingValidatesBeforePublication() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("praelude-download-audio-\(UUID())")
        defer { try? FileManager.default.removeItem(at: directory) }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let source = directory.appendingPathComponent("source.wav")
        let format = try XCTUnwrap(AVAudioFormat(standardFormatWithSampleRate: 44_100, channels: 1))
        let buffer = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 1024))
        buffer.frameLength = 1024
        for index in 0..<1024 { buffer.floatChannelData?[0][index] = 0 }
        do { let file = try AVAudioFile(forWriting: source, settings: format.settings); try file.write(from: buffer) }
        let data = try Data(contentsOf: source)
        let destination = directory.appendingPathComponent("take.wav")
        let staged = try await Task.detached { try ScoreAndRecordingStorage.stageDownload(data, destination: destination, validatingBucket: "recordings") }.value
        XCTAssertTrue(try ScoreAndRecordingStorage.publishDownload(staged, destination: destination))
        XCTAssertEqual(try Data(contentsOf: destination), data)
    }

}
