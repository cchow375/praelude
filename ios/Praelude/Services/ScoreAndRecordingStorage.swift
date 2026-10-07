import Foundation
import Observation
import Storage
import CryptoKit

/// Uploads score PDFs / recordings to their private Storage buckets (spec §4a) and downloads them on
/// demand when a device has a synced `pieces`/`audio_recordings` row pointing at a file it does not
/// have locally yet (a second device, or this device after reinstall). Owner-only, server-enforced:
/// `supabase/migrations/20260926220008_storage_buckets.sql`'s `scores_*`/`recordings_*` policies
/// restrict every operation to `(storage.foldername(name))[1] = auth.uid()::text`, and
/// `supabase/tests/03_social_privacy_blocks_notes_storage.sql` §3.8 proves that holds for both
/// buckets at the RLS layer — this type only ever has to get the *path* right (always
/// `{bucket}/{owner_id}/{record_id}/{file_name}`, matching `supabase/(C) Backend.md`'s documented
/// convention exactly), never re-implement the access check itself.
///
/// Best-effort throughout: a failed upload/download never throws into a caller or blocks the local
/// practice flow (the schema3 rule "never lose user data" is already satisfied by the file staying on
/// this device — `NativeLibraryFiles`/`RecordingService` write it before this type is ever involved);
/// it only ever adds cross-device availability on top when the network cooperates, the same
/// "degrades gracefully offline" contract `PresenceService`'s own doc comment documents for presence.
/// A class (not a struct), even though it holds no observable state, so it can be injected into the
/// SwiftUI environment the same way every other service in this app is (`.environment(_:)` needs
/// `Observable`, which the `@Observable` macro only applies to a class) and shared as one instance
/// between `PraeludeApp.init` (which hands it to `SyncCoordinator.setStorage`) and any View that
/// wants to trigger an upload right after its own local save (e.g. `AddPieceView`).
@MainActor @Observable
public final class ScoreAndRecordingStorage {
    private let services: SupabaseServices
    private let auth: AuthManager
    public private(set) var pendingCount = 0
    public private(set) var lastError: String?
    private var inFlight: Set<String> = []

    /// Revisit files independently of changed metadata. A failed upload/download therefore retries
    /// after a foreground/network regain even when its Piece row was already acknowledged.
    public func reconcileFiles(library: LibraryState, directory: URL) async {
        lastError = nil
        pendingCount = 0
        for piece in library.pieces where piece.deletedAt == nil {
            guard let fileName = piece.pdfFileName else { continue }
            let url = directory.appendingPathComponent("Scores").appendingPathComponent(fileName)
            if FileManager.default.fileExists(atPath: url.path) {
                if !(await uploadScorePDF(pieceID: piece.id, fileName: fileName, localURL: url)) { pendingCount += 1 }
            } else if !(await downloadScorePDFIfNeeded(pieceID: piece.id, fileName: fileName, to: url)) { pendingCount += 1 }
        }
        for piece in library.pieces where piece.deletedAt == nil {
            guard let fileName = piece.customCoverRef else { continue }
            let url = directory.appendingPathComponent("Covers").appendingPathComponent(fileName)
            if FileManager.default.fileExists(atPath: url.path) {
                if !(await uploadCover(pieceID: piece.id, fileName: fileName, localURL: url)) { pendingCount += 1 }
            } else if !(await downloadCoverIfNeeded(pieceID: piece.id, fileName: fileName, to: url)) { pendingCount += 1 }
        }
        for recording in library.recordings where recording.deletedAt == nil {
            let url = directory.appendingPathComponent("Recordings").appendingPathComponent(recording.fileName)
            if FileManager.default.fileExists(atPath: url.path) {
                if !(await uploadRecording(recordingID: recording.id, fileName: recording.fileName, localURL: url)) { pendingCount += 1 }
            } else if !(await downloadRecordingIfNeeded(recordingID: recording.id, fileName: recording.fileName, to: url)) { pendingCount += 1 }
        }
    }

    private func receiptURL(_ localURL: URL) -> URL {
        localURL.deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("Sync/file-transfers.json")
    }
    private func receiptKey(bucket: String, path: String) -> String { "\(bucket)/\(path)" }
    private func receipts(at url: URL) throws -> [String: String] {
        guard FileManager.default.fileExists(atPath: url.path) else { return [:] }
        return try JSONDecoder().decode([String: String].self, from: Data(contentsOf: url))
    }
    nonisolated static func fingerprint(_ url: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        var hash = SHA256()
        while let data = try handle.read(upToCount: 65_536), !data.isEmpty {
            try Task.checkCancellation()
            hash.update(data: data)
        }
        return hash.finalize().map { String(format: "%02x", $0) }.joined()
    }
    private func saveReceipt(bucket: String, path: String, localURL: URL, fingerprint: String) throws {
        let url = receiptURL(localURL)
        var values = try receipts(at: url)
        values[receiptKey(bucket: bucket, path: path)] = fingerprint
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONEncoder().encode(values).write(to: url, options: [.atomic, .completeFileProtectionUnlessOpen])
    }
    private func upload(bucket: String, recordID: UUID, fileName: String, localURL: URL, contentType: String?) async -> Bool {
        guard let ownerID else { return false }
        guard Self.isSafeFileName(fileName) else { lastError = "A library file has an invalid file name."; return false }
        let path = Self.objectPath(ownerID: ownerID, recordID: recordID, fileName: fileName)
        let key = receiptKey(bucket: bucket, path: path)
        guard !inFlight.contains(key) else { return false }
        inFlight.insert(key); defer { inFlight.remove(key) }
        do {
            let work = Task.detached(priority: .utility) { try Self.fingerprint(localURL) }
            let digest = try await withTaskCancellationHandler(operation: { try await work.value }, onCancel: { work.cancel() })
            guard !Task.isCancelled, self.ownerID == ownerID else { return false }
            if try receipts(at: receiptURL(localURL))[key] == digest { return true }
            let storage = try await services.storage()
            guard !Task.isCancelled, self.ownerID == ownerID else { return false }
            try await storage.from(bucket).upload(path, fileURL: localURL, options: FileOptions(contentType: contentType, upsert: true))
            guard !Task.isCancelled, self.ownerID == ownerID else { return false }
            try saveReceipt(bucket: bucket, path: path, localURL: localURL, fingerprint: digest)
            return true
        } catch {
            if !Task.isCancelled, self.ownerID == ownerID {
                lastError = "A library file transfer will be retried. \(error.localizedDescription)"
            }
            return false
        }
    }
    private func download(bucket: String, recordID: UUID, fileName: String, localURL: URL) async -> Bool {
        if FileManager.default.fileExists(atPath: localURL.path) { return true }
        guard let ownerID else { return false }
        guard Self.isSafeFileName(fileName) else { lastError = "A library file has an invalid file name."; return false }
        let path = Self.objectPath(ownerID: ownerID, recordID: recordID, fileName: fileName)
        do {
            let storage = try await services.storage()
            let data = try await storage.from(bucket).download(path: path)
            guard !Task.isCancelled, self.ownerID == ownerID else { return false }
            try FileManager.default.createDirectory(at: localURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            try data.write(to: localURL, options: [.atomic, .completeFileProtectionUnlessOpen])
            try saveReceipt(bucket: bucket, path: path, localURL: localURL, fingerprint: SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined())
            return true
        } catch { lastError = "A library file transfer will be retried. \(error.localizedDescription)"; return false }
    }

    public init(services: SupabaseServices, auth: AuthManager) { self.services = services; self.auth = auth }

    private var ownerID: UUID? {
        guard auth.canSyncLocalLibrary, case .signedIn(let userID, _) = auth.state else { return nil }
        return userID
    }

    /// `{bucket}/{owner_id}/{record_id}/{file_name}` — pure and side-effect-free so it is unit-
    /// testable without a network client (`ScoreAndRecordingStorageTests`): the one thing that must
    /// never drift from the server policies' own `(storage.foldername(name))[1]` check is that the
    /// first path segment is always the *real* owner id, never anything caller-suppliable.
    static func isSafeFileName(_ fileName: String) -> Bool {
        !fileName.isEmpty && fileName != "." && fileName != ".." && !fileName.contains("/") && !fileName.contains("\\")
    }

    static func objectPath(ownerID: UUID, recordID: UUID, fileName: String) -> String {
        "\(ownerID.uuidString.lowercased())/\(recordID.uuidString.lowercased())/\(fileName)"
    }

    // MARK: Scores (`scores` bucket)

    /// Call right after `NativeLibraryFiles.importPDF` succeeds (and after replacing a piece's PDF).
    /// No-op in guest mode — there is no bucket to upload to until an account exists.
    @discardableResult
    public func uploadScorePDF(pieceID: UUID, fileName: String, localURL: URL) async -> Bool {
        await upload(bucket: "scores", recordID: pieceID, fileName: fileName, localURL: localURL, contentType: "application/pdf")
    }

    /// Downloads a piece's PDF to `localURL` if it is not already there. Returns whether the file is
    /// present at `localURL` afterward (either already-local, or a successful download) — never
    /// throws, so a caller can use the return value as a plain "can I open this now" check.
    @discardableResult
    public func downloadScorePDFIfNeeded(pieceID: UUID, fileName: String, to localURL: URL) async -> Bool {
        await download(bucket: "scores", recordID: pieceID, fileName: fileName, localURL: localURL)
    }

    // MARK: Covers (`covers` bucket, owner-private and immutable file names)
    @discardableResult
    public func uploadCover(pieceID: UUID, fileName: String, localURL: URL) async -> Bool {
        let type = localURL.pathExtension.lowercased() == "png" ? "image/png" : "image/jpeg"
        return await upload(bucket: "covers", recordID: pieceID, fileName: fileName, localURL: localURL, contentType: type)
    }
    @discardableResult
    public func downloadCoverIfNeeded(pieceID: UUID, fileName: String, to localURL: URL) async -> Bool {
        await download(bucket: "covers", recordID: pieceID, fileName: fileName, localURL: localURL)
    }

    // MARK: Recordings (`recordings` bucket)

    @discardableResult
    public func uploadRecording(recordingID: UUID, fileName: String, localURL: URL) async -> Bool {
        await upload(bucket: "recordings", recordID: recordingID, fileName: fileName, localURL: localURL, contentType: nil)
    }

    @discardableResult
    public func downloadRecordingIfNeeded(recordingID: UUID, fileName: String, to localURL: URL) async -> Bool {
        await download(bucket: "recordings", recordID: recordingID, fileName: fileName, localURL: localURL)
    }
}
