import Foundation
import Observation
import Storage

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

    public init(services: SupabaseServices, auth: AuthManager) { self.services = services; self.auth = auth }

    private var ownerID: UUID? {
        guard case .signedIn(let userID, _) = auth.state else { return nil }
        return userID
    }

    /// `{bucket}/{owner_id}/{record_id}/{file_name}` — pure and side-effect-free so it is unit-
    /// testable without a network client (`ScoreAndRecordingStorageTests`): the one thing that must
    /// never drift from the server policies' own `(storage.foldername(name))[1]` check is that the
    /// first path segment is always the *real* owner id, never anything caller-suppliable.
    static func objectPath(ownerID: UUID, recordID: UUID, fileName: String) -> String {
        "\(ownerID.uuidString)/\(recordID.uuidString)/\(fileName)"
    }

    // MARK: Scores (`scores` bucket)

    /// Call right after `NativeLibraryFiles.importPDF` succeeds (and after replacing a piece's PDF).
    /// No-op in guest mode — there is no bucket to upload to until an account exists.
    public func uploadScorePDF(pieceID: UUID, fileName: String, localURL: URL) async {
        guard let ownerID else { return }
        let path = Self.objectPath(ownerID: ownerID, recordID: pieceID, fileName: fileName)
        do {
            let storage = try await services.storage()
            try await storage.from("scores").upload(path, fileURL: localURL, options: FileOptions(contentType: "application/pdf", upsert: true))
        } catch {
            // Best-effort (see type doc comment): the local file is unaffected, and the next
            // foreground/network-regain sync (or a future explicit retry) tries again.
        }
    }

    /// Downloads a piece's PDF to `localURL` if it is not already there. Returns whether the file is
    /// present at `localURL` afterward (either already-local, or a successful download) — never
    /// throws, so a caller can use the return value as a plain "can I open this now" check.
    @discardableResult
    public func downloadScorePDFIfNeeded(pieceID: UUID, fileName: String, to localURL: URL) async -> Bool {
        if FileManager.default.fileExists(atPath: localURL.path) { return true }
        guard let ownerID else { return false }
        let path = Self.objectPath(ownerID: ownerID, recordID: pieceID, fileName: fileName)
        do {
            let storage = try await services.storage()
            let data = try await storage.from("scores").download(path: path)
            try FileManager.default.createDirectory(at: localURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            try data.write(to: localURL, options: [.atomic, .completeFileProtectionUnlessOpen])
            return true
        } catch {
            return false
        }
    }

    // MARK: Recordings (`recordings` bucket)

    public func uploadRecording(recordingID: UUID, fileName: String, localURL: URL) async {
        guard let ownerID else { return }
        let path = Self.objectPath(ownerID: ownerID, recordID: recordingID, fileName: fileName)
        do {
            let storage = try await services.storage()
            try await storage.from("recordings").upload(path, fileURL: localURL, options: FileOptions(upsert: true))
        } catch { /* best-effort — see type doc comment */ }
    }

    @discardableResult
    public func downloadRecordingIfNeeded(recordingID: UUID, fileName: String, to localURL: URL) async -> Bool {
        if FileManager.default.fileExists(atPath: localURL.path) { return true }
        guard let ownerID else { return false }
        let path = Self.objectPath(ownerID: ownerID, recordID: recordingID, fileName: fileName)
        do {
            let storage = try await services.storage()
            let data = try await storage.from("recordings").download(path: path)
            try FileManager.default.createDirectory(at: localURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            try data.write(to: localURL, options: [.atomic, .completeFileProtectionUnlessOpen])
            return true
        } catch {
            return false
        }
    }
}
