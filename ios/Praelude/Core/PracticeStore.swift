import Foundation
import Observation

/// Owns one independent iOS library. A mutation writes atomically before observable state changes.
/// A corrupt or newer-format library is never replaced with an empty library.
@MainActor @Observable public final class PracticeStore {
    public let directory: URL
    public private(set) var state = LibraryState()
    public private(set) var errorMessage: String?
    public private(set) var isReadOnly = false
    public private(set) var preservedOriginalURL: URL?
    @ObservationIgnored private let now: () -> Date
    @ObservationIgnored private let writeData: (Data, URL) throws -> Void
    @ObservationIgnored private let preserveFile: (URL, URL) throws -> Void
    public var fileURL: URL { directory.appendingPathComponent("library.json") }
    public var pieces: [Piece] { state.pieces.filter { $0.deletedAt == nil } }
    public var sessions: [PracticeSession] { state.sessions }
    public var activeSet: ActiveSet? { state.activeSet }
    public var preferences: Preferences { state.preferences }
    public var recordings: [AudioRecording] { state.recordings }
    nonisolated public static let maximumDrawingBytes = 8 * 1024 * 1024
    nonisolated public static let maximumTotalDrawingBytes = 32 * 1024 * 1024

    public init(directory: URL, now: @escaping () -> Date = Date.init,
                writeData: @escaping (Data, URL) throws -> Void = { try $0.write(to: $1, options: .atomic) },
                preserveFile: @escaping (URL, URL) throws -> Void = { try FileManager.default.copyItem(at: $0, to: $1) }) {
        self.directory = directory; self.now = now; self.writeData = writeData; self.preserveFile = preserveFile
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            if FileManager.default.fileExists(atPath: fileURL.path) {
                let data = try Data(contentsOf: fileURL)
                guard data.count <= 64 * 1024 * 1024 else { throw PracticeError.invalid("The practice library exceeds the supported size.") }
                var restored = try Self.decoder().decode(LibraryState.self, from: data)
                try Self.validate(restored)
                let needsMigration = restored.schemaVersion < LibraryState.currentSchemaVersion
                if needsMigration {
                    // Preserve exact original bytes before publishing a newer format, including
                    // schema3, whose older readers cannot retain durable in-set tempo edits.
                    preservedOriginalURL = try preserveOriginal(prefix: "library-schema\(restored.schemaVersion)")
                    restored = SchemaMigration.migrateToCurrent(restored, at: now())
                }
                // Never credit time while the app was absent. Persist this pause before exposing it.
                if needsMigration || restored.activeSet?.status == .running {
                    if restored.activeSet?.status == .running {
                        restored.activeSet?.status = .paused; restored.activeSet?.lastCheckpoint = nil
                    }
                    restored.revision += 1
                    try Self.validate(restored)
                    let migrated = try Self.encoder().encode(restored)
                    guard migrated.count <= 64 * 1024 * 1024 else { throw PracticeError.invalid("The migrated library exceeds the supported size.") }
                    try writeData(migrated, fileURL)
                }
                state = restored
            }
        } catch {
            isReadOnly = true
            errorMessage = "Your practice library could not be opened safely. The original file is preserved. \(error.localizedDescription)"
        }
    }

    public var progress: PracticeProgress {
        let attempts = state.sessions.flatMap(\.attempts).filter(\.isEffective)
        let seconds = state.sessions.reduce(0) { $0 + $1.activeSeconds }
        let completed = state.sessions.reduce(0) { $0 + $1.completedSets }
        let bonuses = state.sessions.reduce(0) { total, session in
            let count = session.completedSets
            return total + (count >= 10 ? 6 : count >= 7 ? 4 : count >= 5 ? 2 : count >= 3 ? 1 : 0)
        }
        let days = Set(attempts.map { Calendar.current.startOfDay(for: $0.date) }).count
        return PracticeProgress(totalAttempts: attempts.count, cleanAttempts: attempts.filter { $0.verdict == .clean }.count,
                                completedSets: completed, activeSeconds: seconds,
                                xp: Int(seconds / 600) + bonuses, practicedDays: days)
    }

    /// Profile stats (§4c "pieces performance-ready"): a piece counts once it has at least one live
    /// (non-archived, non-tombstoned) passage and every one of those passages has reached
    /// `.performanceReady` — a piece with no passages yet, or with any passage still short of that
    /// state, does not count. Read-only derivation over `state.passages`; nothing is stored.
    public var piecesPerformanceReadyCount: Int {
        let livePassagesByPiece = Dictionary(grouping: state.passages.filter { $0.deletedAt == nil && !$0.archived }, by: \.pieceID)
        return livePassagesByPiece.values.filter { passages in
            !passages.isEmpty && passages.allSatisfy { $0.learningState == .performanceReady }
        }.count
    }

    public func addPiece(_ piece: Piece) throws {
        try transaction { next in
            guard !next.pieces.contains(where: { $0.id == piece.id }) else { throw PracticeError.conflict("This piece is already in your library.") }
            next.pieces.append(piece)
        }
    }
    /// The caller stages a new, immutable one-page PDF first. Piece, visible origin folder and
    /// passage publish together, so a failed ledger write cannot leave a half-created card.
    public func addPassageCard(piece: Piece, passage: Passage) throws {
        let date = now()
        try transaction { next in try Self.appendPassageCard(piece: piece, passage: passage, at: date, to: &next) }
    }
    /// Photo decoding and PDF writing already happen off the UI actor. Prepare the potentially
    /// much larger library ledger there too, then publish once against its unchanged revision.
    public func addPassageCardPreparedAsync(piece: Piece, passage: Passage) async throws {
        guard !isReadOnly else { throw PracticeError.unavailable(errorMessage ?? "The library is read-only.") }
        let date = now()
        for _ in 0..<3 {
            try Task.checkCancellation()
            let baseline = state
            let (next, data) = try await prepareMutation(baseline) { next in
                try Self.appendPassageCard(piece: piece, passage: passage, at: date, to: &next)
            }
            try Task.checkCancellation()
            guard state.revision == baseline.revision else { continue }
            try publishPrepared(next, data: data); return
        }
        throw PracticeError.conflict("Your library is busy saving another change. The photo remains open; try Save again.")
    }
    nonisolated private static func appendPassageCard(piece: Piece, passage: Passage, at date: Date, to next: inout LibraryState) throws {
            guard passage.pieceID == piece.id, piece.pdfFileName != nil, piece.pageCount == 1,
                  passage.page == 1, passage.regions.count == 1,
                  !next.pieces.contains(where: { $0.id == piece.id }),
                  !next.passages.contains(where: { $0.id == passage.id }) else {
                throw PracticeError.invalid("This photo passage could not be added safely.")
            }
            // Folder IDs are global server primary keys. Never use a shared constant UUID for
            // an account-owned row: a second user's sync would collide under row-level security.
            let folderID: UUID
            if let folder = next.folders.first(where: { $0.deletedAt == nil && $0.name == PassageCardLibrary.photoFolderName }) {
                folderID = folder.id
            } else {
                let folder = Folder(name: PassageCardLibrary.photoFolderName, createdAt: date, updatedAt: date)
                next.folders.append(folder); folderID = folder.id
            }
            var saved = piece
            saved.isPhotoPassage = true
            if !saved.folderIDs.contains(folderID) { saved.folderIDs.append(folderID) }
            next.pieces.append(saved)
            next.passages.append(passage)
    }
    /// Replaces a piece's fields wholesale, like schema2 always did. As with `createdAt` already,
    /// `updatedAt` is whatever the caller's struct carries — an editor is expected to set it to
    /// the edit time before calling this, the same way it already sets every other changed field;
    /// the store does not second-guess a caller-constructed struct. `lastPage`/`lastPageUpdatedAt`
    /// are the one exception (see `updateLastPage`): turning a page never goes through this method.
    public func updatePiece(_ piece: Piece) throws {
        try transaction { next in
            guard let index = next.pieces.firstIndex(where: { $0.id == piece.id }) else { throw PracticeError.invalid("This piece is no longer in your library.") }
            let old = next.pieces[index]
            if old.pdfFileName != piece.pdfFileName || old.pageCount != piece.pageCount {
                try Self.requireReplaceableScore(pieceID: piece.id, in: next)
            }
            next.pieces[index] = piece
        }
    }
    /// A narrow, store-owned counter like `updateLastPage`/`recordWarmupUse` (no caller struct to
    /// trust): it takes just an id and a status, so the store itself must stamp `updatedAt`, or an
    /// Active/Resting change made offline would silently lose to any older edit under last-write-wins.
    public func setPieceStatus(_ id: UUID, status: PieceStatus) throws {
        let date = now()
        try transaction { next in
            guard let index = next.pieces.firstIndex(where: { $0.id == id }) else { throw PracticeError.invalid("Piece not found.") }
            next.pieces[index].status = status; next.pieces[index].updatedAt = date
        }
    }
    /// A piece with practice evidence stays available in Resting; its ledger is never deleted.
    public func deletePiece(_ id: UUID) throws {
        let date = now()
        try transaction { next in
            guard next.activeSet?.configuration.pieceID != id else { throw PracticeError.conflict("End this piece’s practice set before removing it.") }
            guard !next.history.contains(where: { $0.configuration.pieceID == id }), !next.sessions.contains(where: { $0.pieceID == id }) else {
                throw PracticeError.conflict("This piece has practice history. Move it to Resting to preserve your record.")
            }
            guard let index = next.pieces.firstIndex(where: { $0.id == id }) else { return }
            next.pieces[index].deletedAt = date; next.pieces[index].updatedAt = date
            // Parent rows remain available to FK-constrained sync, even when created and deleted
            // offline before the first push. Keep source files and annotation data for backups.
            for index in next.passages.indices where next.passages[index].pieceID == id {
                next.passages[index].archived = true; next.passages[index].deletedAt = date; next.passages[index].updatedAt = date
            }
            for index in next.goals.indices where next.goals[index].pieceID == id {
                next.goals[index].deletedAt = date; next.goals[index].updatedAt = date
            }
            for index in next.inkStrokes.indices where next.inkStrokes[index].pieceID == id {
                next.inkStrokes[index].deletedAt = date; next.inkStrokes[index].updatedAt = date
            }
            for index in next.bookmarks.indices where next.bookmarks[index].pieceID == id {
                next.bookmarks[index].deletedAt = date; next.bookmarks[index].updatedAt = date
            }
            for index in next.pageEdits.indices where next.pageEdits[index].pieceID == id {
                next.pageEdits[index].deletedAt = date; next.pageEdits[index].updatedAt = date
            }
            for index in next.scoreLinks.indices where next.scoreLinks[index].pieceID == id {
                next.scoreLinks[index].deletedAt = date; next.scoreLinks[index].updatedAt = date
            }
            for index in next.textAnnotations.indices where next.textAnnotations[index].pieceID == id {
                next.textAnnotations[index].deletedAt = date; next.textAnnotations[index].updatedAt = date
            }
            for index in next.stampAnnotations.indices where next.stampAnnotations[index].pieceID == id {
                next.stampAnnotations[index].deletedAt = date; next.stampAnnotations[index].updatedAt = date
            }
        }
    }
    public func setDefaultPracticeTempo(_ bpm: Double?, for pieceID: UUID) throws {
        let date = now()
        try transaction { next in
            guard let index = next.pieces.firstIndex(where: { $0.id == pieceID }) else { throw PracticeError.invalid("Piece not found.") }
            next.pieces[index].defaultPracticeBPM = bpm; next.pieces[index].updatedAt = date
        }
    }
    /// Edits the reference and an optional user-chosen coverage plan, never prior set contracts.
    public func setPracticeReference(_ bpm: Double?, plan: PracticeBalancePlan, for pieceID: UUID) throws {
        let date = now()
        try transaction { next in
            guard let index = next.pieces.firstIndex(where: { $0.id == pieceID }) else { throw PracticeError.invalid("Piece not found.") }
            next.pieces[index].fullTempoBPM = bpm; next.pieces[index].practiceBalancePlan = plan
            next.pieces[index].updatedAt = date
        }
    }
    public func setScoreSections(_ sections: [ScoreSection], for pieceID: UUID) throws {
        let date = now()
        try transaction { next in
            guard let index = next.pieces.firstIndex(where: { $0.id == pieceID }) else { throw PracticeError.invalid("Piece not found.") }
            next.pieces[index].scoreSections = sections; next.pieces[index].updatedAt = date
        }
    }
    public func setMeasureAnchors(_ anchors: [ScoreMeasureAnchor], for pieceID: UUID) throws {
        let date = now()
        try transaction { next in
            guard let index = next.pieces.firstIndex(where: { $0.id == pieceID }) else { throw PracticeError.invalid("Piece not found.") }
            next.pieces[index].measureAnchors = anchors; next.pieces[index].updatedAt = date
        }
    }
    public func updateLastPage(pieceID: UUID, page: Int) throws {
        // PDFKit can notify both a requested turn and its completed layout. Rewriting the entire
        // ledger for that second notification adds a pause to navigation and advances its sync
        // clock even though the reader has not moved.
        if !isReadOnly, state.pieces.first(where: { $0.id == pieceID })?.lastPage == page { return }
        let date = now()
        try transaction { next in
            guard let index = next.pieces.firstIndex(where: { $0.id == pieceID }) else { throw PracticeError.invalid("Piece not found.") }
            next.pieces[index].lastPage = page; next.pieces[index].lastPageUpdatedAt = date
        }
    }

    /// Prepare the full ledger away from the UI actor, merging only this reading position.
    /// A later turn of the same score wins; unrelated edits are retained on a bounded retry.
    public func updateLastPagePreparedAsync(pieceID: UUID, page: Int) async throws {
        guard !isReadOnly else { throw PracticeError.unavailable(errorMessage ?? "The library is read-only.") }
        guard let original = state.pieces.first(where: { $0.id == pieceID && $0.deletedAt == nil }) else {
            throw PracticeError.invalid("Piece not found.")
        }
        if original.lastPage == page { return }
        let originalPageEdits = state.pageEdits.filter { $0.pieceID == pieceID }
        let firstBaseline = state
        let date = now()
        for retry in 0..<4 {
            try Task.checkCancellation()
            guard !isReadOnly else { throw PracticeError.unavailable(errorMessage ?? "The library is read-only.") }
            guard let current = state.pieces.first(where: { $0.id == pieceID && $0.deletedAt == nil }),
                  current.lastPage == original.lastPage, current.lastPageUpdatedAt == original.lastPageUpdatedAt,
                  current.pdfFileName == original.pdfFileName, current.pageCount == original.pageCount,
                  state.pageEdits.filter({ $0.pieceID == pieceID }) == originalPageEdits else {
                throw PracticeError.conflict("The score position changed while saving this page.")
            }
            let baseline = retry == 0 ? firstBaseline : state
            let (next, data) = try await prepareMutation(baseline) { next in
                guard let index = next.pieces.firstIndex(where: { $0.id == pieceID }) else {
                    throw PracticeError.invalid("Piece not found.")
                }
                next.pieces[index].lastPage = page
                next.pieces[index].lastPageUpdatedAt = date
            }
            try Task.checkCancellation()
            guard state.revision == baseline.revision else { continue }
            guard !isReadOnly else { throw PracticeError.unavailable(errorMessage ?? "The library is read-only.") }
            try publishPrepared(next, data: data)
            return
        }
        throw PracticeError.conflict("The library is busy saving other changes. Try saving this page again.")
    }
    public func savePassage(_ passage: Passage) throws {
        try savePassage(passage, expected: nil, compareExpected: false)
    }
    /// A new passage passes nil; an editor passes the exact saved value it opened.
    public func savePassage(_ passage: Passage, replacing expected: Passage?) throws {
        try savePassage(passage, expected: expected, compareExpected: true)
    }
    private func savePassage(_ passage: Passage, expected: Passage?, compareExpected: Bool) throws {
        try transaction { next in
            if compareExpected {
                guard expected == nil || expected?.id == passage.id,
                      next.passages.first(where: { $0.id == passage.id }) == expected else {
                    throw PracticeError.conflict("This passage changed in another window. Your edits are still open. Cancel and reopen the passage to use its latest saved version.")
                }
            }
            if let index = next.passages.firstIndex(where: { $0.id == passage.id }) { next.passages[index] = passage }
            else { next.passages.append(passage) }
        }
    }
    /// Non-deleted ink for one page, optionally filtered to a single layer, oldest first.
    public func inkStrokes(pieceID: UUID, page: Int, layer: InkLayer? = nil) -> [InkStroke] {
        state.inkStrokes.filter { $0.pieceID == pieceID && $0.page == page && $0.deletedAt == nil && (layer == nil || $0.layer == layer) }
            .sorted { $0.createdAt < $1.createdAt }
    }
    /// One new ink row to write via `replaceInk`. `fingerprint` is what identity/diffing is based on
    /// when present (see `InkStroke.fingerprint`); `nil` falls back to `data` itself, exactly
    /// matching this method's original (pre-fingerprint) behavior.
    public struct InkStrokeInput: Sendable {
        public var data: Data
        public var fingerprint: Data?
        public init(data: Data, fingerprint: Data? = nil) { self.data = data; self.fingerprint = fingerprint }
    }
    /// Compatibility overload: every stroke's own bytes are its identity, exactly as before this
    /// type existed. This is what the whole-page shim (`saveDrawing`) still calls, unchanged.
    public func replaceInk(pieceID: UUID, page: Int, layer: InkLayer, strokes: [Data]) throws {
        try replaceInk(pieceID: pieceID, page: page, layer: layer, strokes: strokes.map { InkStrokeInput(data: $0) })
    }
    /// Replaces one page/layer's ink with exactly the given strokes (§4d/§7). Diffs by content
    /// (`fingerprint ?? data`) against the rows already stored for that page/layer: a stroke whose
    /// key already exists keeps its id/createdAt (so an untouched stroke never looks "updated" to a
    /// future sync engine), a key no longer present is tombstoned, and a new key becomes a new row —
    /// so replicas can merge annotations by stroke instead of by whole page. A caller that can
    /// compute a real content fingerprint (see `InkPerStroke.fingerprint`) gets identity that
    /// survives PencilKit re-serializing the same stroke to different bytes; the whole-page overload
    /// above does not need to, since it always re-diffs its single row against its own prior save.
    /// Native callers validate PencilKit encoding before calling this Foundation-only boundary.
    public func replaceInk(pieceID: UUID, page: Int, layer: InkLayer, strokes: [InkStrokeInput]) throws {
        let date = now()
        try transaction { next in
            try Self.mergeInk(pieceID: pieceID, page: page, layer: layer, strokes: strokes, at: date, into: &next)
        }
    }

    /// Idle autosave prepares immutable values away from the UI. No worker ever writes the
    /// library file: revision and original ink are checked again on this actor before a single
    /// atomic write and publication. Explicit transitions retain the synchronous save above.
    @discardableResult public func replaceInkPreparedAsync(pieceID: UUID, page: Int, layer: InkLayer,
                                        strokes: [InkStrokeInput], expectedRows: [InkStroke]) async throws -> [InkStroke] {
        for _ in 0..<4 {
            try Task.checkCancellation()
            guard !isReadOnly else { throw PracticeError.unavailable(errorMessage ?? "The library is read-only.") }
            guard inkStrokes(pieceID: pieceID, page: page, layer: layer) == expectedRows else {
                throw PracticeError.conflict("The saved drawing changed while preparing this annotation.")
            }
            let baseline = state
            let date = now()
            let preparation = Task.detached(priority: .utility) {
                try Task.checkCancellation()
                var next = baseline
                try Self.mergeInk(pieceID: pieceID, page: page, layer: layer, strokes: strokes, at: date, into: &next)
                if next == baseline { return (next, Data?.none) }
                next.revision = baseline.revision + 1
                try Self.validate(next, trustedPrevious: baseline)
                try Task.checkCancellation()
                let data = try Self.encoder().encode(next)
                guard data.count <= 64 * 1024 * 1024 else {
                    throw PracticeError.invalid("The practice library has reached its supported 64 MB size. Export a backup before continuing.")
                }
                return (next, Optional(data))
            }
            let (next, data) = try await withTaskCancellationHandler {
                try await preparation.value
            } onCancel: { preparation.cancel() }
            try Task.checkCancellation()
            guard state.revision == baseline.revision else { continue }
            // No suspension is permitted between this CAS and publishing the matching snapshot.
            guard !isReadOnly, inkStrokes(pieceID: pieceID, page: page, layer: layer) == expectedRows else {
                throw PracticeError.conflict("The saved drawing changed while preparing this annotation.")
            }
            do {
                if let data { try writeData(data, fileURL); state = next }
                errorMessage = nil
                // Capture the exact committed row order before any actor suspension. The caller
                // can distinguish this save from a later writer without assuming requested stroke
                // order survives the content-preserving merge of existing and edited rows.
                return inkStrokes(pieceID: pieceID, page: page, layer: layer)
            } catch { errorMessage = error.localizedDescription; throw error }
        }
        throw PracticeError.conflict("The library is busy saving other changes. Your drawing remains open; try saving again.")
    }

    nonisolated private static func mergeInk(pieceID: UUID, page: Int, layer: InkLayer,
                                             strokes: [InkStrokeInput], at date: Date, into next: inout LibraryState) throws {
        guard let piece = next.pieces.first(where: { $0.id == pieceID }), piece.pdfFileName != nil,
              page >= 1, page <= piece.pageCount else { throw PracticeError.invalid("Choose an existing score page before saving ink.") }
        for stroke in strokes {
            guard !stroke.data.isEmpty, stroke.data.count <= Self.maximumDrawingBytes else {
                throw PracticeError.invalid("This page has reached the supported 8 MB of ink.")
            }
        }
        // Ordinal = position in the caller's own array, before any filtering below, so splitting
        // the same drawing the same way on two devices assigns the same ordinal — and therefore
        // the same stable id (see `InkStroke.stableID`) — to the same stroke on both.
        let ordinalsByKey = Dictionary(grouping: strokes.indices, by: { strokes[$0].fingerprint ?? strokes[$0].data })
        var consumedByKey: [Data: Int] = [:]
        var matchedOrdinals: Set<Int> = []
        var storedIndexByID = Dictionary(next.inkStrokes.enumerated().map { ($0.element.id, $0.offset) }, uniquingKeysWith: { first, _ in first })
        for index in next.inkStrokes.indices
        where next.inkStrokes[index].pieceID == pieceID && next.inkStrokes[index].page == page
            && next.inkStrokes[index].layer == layer && next.inkStrokes[index].deletedAt == nil {
            let existingKey = next.inkStrokes[index].fingerprint ?? next.inkStrokes[index].data
            let consumed = consumedByKey[existingKey, default: 0]
            if let ordinals = ordinalsByKey[existingKey], consumed < ordinals.count {
                matchedOrdinals.insert(ordinals[consumed])
                consumedByKey[existingKey] = consumed + 1
            } else {
                next.inkStrokes[index].deletedAt = date; next.inkStrokes[index].updatedAt = date
            }
        }
        for (ordinal, input) in strokes.enumerated() where !matchedOrdinals.contains(ordinal) {
            let key = input.fingerprint ?? input.data
            let id = InkStroke.stableID(pieceID: pieceID, page: page, layer: layer, data: key, ordinal: ordinal)
            // The exact same (page, layer, content, ordinal) combination can recur after its row
            // was already tombstoned above — Redo after Undo, Undo of an erase, or Undo of a lasso
            // move that restores a stroke's original transform all put identical content back at
            // its original position. `stableID` is a pure function of those inputs, so it
            // recomputes the *same id* the earlier (now-deleted) row already has. Resurrecting
            // that row in place — instead of unconditionally appending a second row with the same
            // id — is what keeps this a no-op for real content that never left, and what stops
            // `validate`'s uniqueness check from rejecting the whole page the moment restored
            // content collides with its own tombstone.
            if let resurrect = storedIndexByID[id] {
                next.inkStrokes[resurrect].data = input.data
                next.inkStrokes[resurrect].fingerprint = input.fingerprint
                next.inkStrokes[resurrect].deletedAt = nil
                next.inkStrokes[resurrect].updatedAt = date.addingTimeInterval(Double(ordinal) * 0.000_001)
                continue
            }
            // Several new rows can land in the same flush (e.g. splitting a legacy multi-stroke
            // page blob into per-stroke rows for the first time). A shared `date` would make their
            // draw order (see `inkStrokes`' `createdAt` sort) depend on however `Set`/dictionary
            // iteration happens to break the tie — not deterministic, and not necessarily the
            // z-order the strokes were actually drawn in. Spacing new rows a microsecond apart by
            // their ordinal (their position in the caller's full current array) keeps that order
            // exact without changing the model: two strokes overlapping (e.g. a highlighter under
            // a correction) always redraw in their original relative order, on every device that
            // performs the same split. Real previously-kept rows are never touched here, so this
            // never perturbs an already-stable `createdAt`.
            let stamp = date.addingTimeInterval(Double(ordinal) * 0.000_001)
            storedIndexByID[id] = next.inkStrokes.count
            next.inkStrokes.append(InkStroke(id: id, pieceID: pieceID, page: page, layer: layer, data: input.data,
                                             fingerprint: input.fingerprint, createdAt: stamp, updatedAt: stamp))
        }
    }
    /// Whole-page compatibility view of `.mine`-layer ink for today's single-editor call sites
    /// (`ScoreWorkspace`, `NativeLibraryFiles`, `ScoreExport`). As long as every save goes through
    /// `saveDrawing`, at most one active row exists per page, so this returns its bytes unchanged
    /// and the optimistic-concurrency `expected` check in `ScoreWorkspace` keeps working exactly as
    /// before. A future PencilKit-aware call site can call `replaceInk`/`inkStrokes` directly for
    /// real per-`PKStroke` rows without any further Core change.
    public func drawing(pieceID: UUID, page: Int) -> Data? {
        inkStrokes(pieceID: pieceID, page: page, layer: .mine).first?.data
    }
    /// Empty data removes the saved drawing; it does not create an empty record.
    public func saveDrawing(pieceID: UUID, page: Int, data: Data) throws {
        try replaceInk(pieceID: pieceID, page: page, layer: .mine, strokes: data.isEmpty ? [] : [data])
    }
    /// Upserts (or replaces) one ink row by its own id — the row-identity counterpart to
    /// `replaceInk`'s content-diffing merge, for a caller that already has a specific row's identity
    /// rather than "the full current set of blobs for a page/layer". `replaceInk`'s two call sites
    /// (`saveDrawing`, and any future per-`PKStroke` call site) are content-diff compatibility layers
    /// over the same storage; this is for the sync engine applying a pulled `ink_strokes` row (spec
    /// §4d) with the server's own id/timestamps, which a content diff cannot reproduce — Schema3.md
    /// already describes each `InkStroke` row as "its own merge unit".
    public func applySyncedInkStroke(_ stroke: InkStroke) throws {
        try transaction { next in
            if let index = next.inkStrokes.firstIndex(where: { $0.id == stroke.id }) {
                next.inkStrokes[index] = stroke
            } else {
                next.inkStrokes.append(stroke)
            }
        }
    }

    // MARK: - §4d Sync: applying a pulled row (or a rejected push's "adopt this" reply)
    //
    // `applySyncedInkStroke` above was the one precedent for this shape before this pass. It matters
    // that these are distinct methods from `save*`/`update*`, not a reuse of them: several `save*`
    // methods (`saveInstrument`, `saveTag`, `saveFolder`, `saveSetlist`, `saveBookmark`,
    // `savePageEdit`, `saveScoreLink`, `saveTextAnnotation`, `saveStampAnnotation`,
    // `saveWarmupExercise`, `saveRecording`, `saveNotebookEntry`) and `updateRuleSettings`/
    // `updateRewardsState`/`updateProfile` deliberately *self-stamp* `updatedAt` with this device's
    // own clock (correct for a local edit — Schema3.md: an offline status/counter change must not
    // silently lose to an older edit). Calling any of those from the pull path would silently
    // overwrite the server's real `updated_at` with "whenever this device happened to pull it",
    // permanently drifting this record's clock away from its true edit time — a later, genuinely
    // newer edit from a third device could then lose a last-write-wins comparison it should have won,
    // purely because this device's own pull inflated the timestamp it is compared against. Every
    // method below instead stores the incoming record's fields (including its `updatedAt`) verbatim,
    // exactly like `applySyncedInkStroke`/`updatePiece`/`savePassage` (Schema3.md: "trust the
    // caller's struct") already do. `SyncCoordinator` makes the LWW "should this even apply" decision
    // before calling any of these; none of them re-check it.

    /// `Piece` is the one collection with a split `addPiece`/`updatePiece` pair (every other
    /// collection's `save*` already upserts — see e.g. `saveTag` above) instead of one upsert-style
    /// method: `updatePiece` throws "no longer in your library" for an id it does not already have,
    /// and `addPiece` throws "already in your library" for one it does. Before this method existed,
    /// `SyncCoordinator`'s pull path called `updatePiece` directly, which silently failed (`try?`
    /// swallows the thrown error) for the ordinary case of a fresh device — or an existing device
    /// that never had this specific piece — pulling a piece it has never seen before: exactly the
    /// "reinstall/second device gets the whole library back" guarantee spec 4d promises, silently not
    /// happening for pieces specifically. Fixed here, at the one call site (`applyPulledRow`) that
    /// needs upsert semantics, rather than changing `addPiece`/`updatePiece`'s own long-standing
    /// contracts (`updatePiece`'s own doc comment: local edits still make the deliberate choice to
    /// fail loudly on an id that should already exist, e.g. a stale in-memory reference after a
    /// delete elsewhere in this same launch - only the sync path needs "insert-or-update").
    public func applySyncedPiece(_ piece: Piece) throws {
        guard let existing = state.pieces.first(where: { $0.id == piece.id }) else { try addPiece(piece); return }
        var merged = piece.updatedAt > existing.updatedAt ? piece : existing
        if piece.lastPageUpdatedAt > existing.lastPageUpdatedAt {
            merged.lastPage = piece.lastPage; merged.lastPageUpdatedAt = piece.lastPageUpdatedAt
        } else {
            merged.lastPage = existing.lastPage; merged.lastPageUpdatedAt = existing.lastPageUpdatedAt
        }
        if merged != existing { try updatePiece(merged) }
    }

    /// Inserted pages can make a valid display bookmark exceed the PDF's source page count.
    /// Commit score metadata with its reading-order rows so neither half is ever an orphan.
    public func applySyncedScoreSnapshot(pieces: [Piece], pageEdits: [PageEdit]) throws {
        guard !pieces.isEmpty || !pageEdits.isEmpty else { return }
        try transaction { next in
            for piece in pieces {
                if let index = next.pieces.firstIndex(where: { $0.id == piece.id }) {
                    let existing = next.pieces[index]
                    var merged = piece.updatedAt > existing.updatedAt ? piece : existing
                    if piece.lastPageUpdatedAt > existing.lastPageUpdatedAt {
                        merged.lastPage = piece.lastPage; merged.lastPageUpdatedAt = piece.lastPageUpdatedAt
                    } else {
                        merged.lastPage = existing.lastPage; merged.lastPageUpdatedAt = existing.lastPageUpdatedAt
                    }
                    if existing.pdfFileName != merged.pdfFileName || existing.pageCount != merged.pageCount {
                        try Self.requireReplaceableScore(pieceID: piece.id, in: next)
                    }
                    next.pieces[index] = merged
                } else { next.pieces.append(piece) }
            }
            for edit in pageEdits {
                if let index = next.pageEdits.firstIndex(where: { $0.id == edit.id }) {
                    if edit.updatedAt > next.pageEdits[index].updatedAt { next.pageEdits[index] = edit }
                } else { next.pageEdits.append(edit) }
            }
        }
    }

    public func applySyncedInstrument(_ instrument: Instrument) throws { try transaction { next in
        if let index = next.instruments.firstIndex(where: { $0.id == instrument.id }) { next.instruments[index] = instrument }
        else { next.instruments.append(instrument) }
    } }
    public func applySyncedRuleSettings(_ settings: RuleSettings) throws { try transaction { next in next.ruleSettings = settings } }
    public func applySyncedRewardsState(_ rewardsState: RewardsState) throws { try transaction { next in next.rewardsState = rewardsState } }
    public func applySyncedProfile(_ profile: Profile) throws { try transaction { next in next.profile = profile } }

    public func applySyncedTag(_ tag: Tag) throws { try transaction { next in
        if let index = next.tags.firstIndex(where: { $0.id == tag.id }) { next.tags[index] = tag } else { next.tags.append(tag) }
    } }
    public func applySyncedFolder(_ folder: Folder) throws { try transaction { next in
        if let index = next.folders.firstIndex(where: { $0.id == folder.id }) { next.folders[index] = folder } else { next.folders.append(folder) }
    } }
    /// Related rows can arrive in UUID order with a child before its parent. Merge the complete
    /// table in one validated transaction; never publish an intermediate orphan or drop local edits.
    public func applySyncedFolders(_ folders: [Folder]) throws {
        guard !folders.isEmpty else { return }
        try transaction { next in
            for folder in folders {
                if let index = next.folders.firstIndex(where: { $0.id == folder.id }) {
                    if folder.updatedAt > next.folders[index].updatedAt { next.folders[index] = folder }
                } else { next.folders.append(folder) }
            }
        }
    }
    public func applySyncedPassages(_ passages: [Passage]) throws {
        guard !passages.isEmpty else { return }
        try transaction { next in
            for passage in passages {
                if let index = next.passages.firstIndex(where: { $0.id == passage.id }) {
                    if passage.updatedAt > next.passages[index].updatedAt { next.passages[index] = passage }
                } else { next.passages.append(passage) }
            }
        }
    }
    public func applySyncedSetlist(_ setlist: Setlist) throws { try transaction { next in
        if let index = next.setlists.firstIndex(where: { $0.id == setlist.id }) { next.setlists[index] = setlist } else { next.setlists.append(setlist) }
    } }
    public func applySyncedBookmark(_ bookmark: Bookmark) throws { try transaction { next in
        if let index = next.bookmarks.firstIndex(where: { $0.id == bookmark.id }) { next.bookmarks[index] = bookmark } else { next.bookmarks.append(bookmark) }
    } }
    public func applySyncedPageEdit(_ edit: PageEdit) throws { try transaction { next in
        if let index = next.pageEdits.firstIndex(where: { $0.id == edit.id }) { next.pageEdits[index] = edit } else { next.pageEdits.append(edit) }
    } }
    public func applySyncedScoreLink(_ link: ScoreLink) throws { try transaction { next in
        if let index = next.scoreLinks.firstIndex(where: { $0.id == link.id }) { next.scoreLinks[index] = link } else { next.scoreLinks.append(link) }
    } }
    public func applySyncedTextAnnotation(_ annotation: TextBoxAnnotation) throws { try transaction { next in
        if let index = next.textAnnotations.firstIndex(where: { $0.id == annotation.id }) { next.textAnnotations[index] = annotation }
        else { next.textAnnotations.append(annotation) }
    } }
    public func applySyncedStampAnnotation(_ stamp: StampAnnotation) throws { try transaction { next in
        if let index = next.stampAnnotations.firstIndex(where: { $0.id == stamp.id }) { next.stampAnnotations[index] = stamp }
        else { next.stampAnnotations.append(stamp) }
    } }
    public func applySyncedWarmupExercise(_ exercise: WarmupExercise) throws { try transaction { next in
        if let index = next.warmupExercises.firstIndex(where: { $0.id == exercise.id }) { next.warmupExercises[index] = exercise }
        else { next.warmupExercises.append(exercise) }
    } }
    public func applySyncedRecording(_ recording: AudioRecording) throws { try transaction { next in
        if let index = next.recordings.firstIndex(where: { $0.id == recording.id }) { next.recordings[index] = recording }
        else { next.recordings.append(recording) }
    } }
    public func applySyncedNotebookEntry(_ entry: NotebookEntry) throws { try transaction { next in
        if let index = next.notebookEntries.firstIndex(where: { $0.id == entry.id }) { next.notebookEntries[index] = entry }
        else { next.notebookEntries.append(entry) }
    } }

    /// A practice set pulled from another device (or the server's "adopt this" reply to a rejected
    /// push). `SetSyncRow.coreValue` (`SyncDTO2.swift`) cannot know this device's own attempt history
    /// for that set id, so it is spliced back in here from whichever local copy already holds it —
    /// never dropped, never duplicated (the splice source is either `history` or the live
    /// `activeSet`; `applySyncedAttempt` below is the only other writer of either array, and is
    /// itself id-deduplicated).
    /// True upsert (unlike `applySyncedSet` just below, this one is simple: `PracticeSession`'s own
    /// `attempts`/`activeSeconds`/`completedSets` are entirely derived by `projectSessions`, called
    /// automatically at the end of every `transaction { ... }` — including this one — so whatever
    /// this method itself sets for those three fields never matters; only `pieceID`/`focus`/
    /// `startedAt`/`endedAt` are real, non-derived data). `sets.session_id` is a hard FK
    /// (`references public.practice_sessions (id)`), so a set pulled/applied before its own session
    /// exists locally fails `validate`'s `sessionIDs.contains(set.sessionID)` check — apply this
    /// before `applySyncedSet` for the same session, the same ordering `SyncCoordinator.syncSet(_:)`
    /// already guarantees on push.
    /// A remote practice ledger spans three tables. Reconstruct the complete graph before
    /// validation: a completed set cannot be projected without its reps, and a session close
    /// cannot be saved while its old running set is still active locally.
    public func applySyncedPracticeSnapshot(sessions receivedSessions: [PracticeSession], sets receivedSets: [ActiveSet],
                                           attempts receivedAttempts: [(attempt: Attempt, setID: UUID)]) throws {
        var sessions = state.sessions
        for session in receivedSessions {
            if let index = sessions.firstIndex(where: { $0.id == session.id }) { sessions[index] = session }
            else { sessions.append(session) }
        }
        var sets = Dictionary(uniqueKeysWithValues: (state.history + [state.activeSet].compactMap { $0 }).map { ($0.id, $0) })
        for var set in receivedSets {
            try Self.preservePracticeContext(in: &set, from: sets[set.id])
            set.attempts = sets[set.id]?.attempts ?? []
            sets[set.id] = set
        }
        for (setID, items) in Dictionary(grouping: receivedAttempts, by: { $0.setID }) {
            guard var set = sets[setID] else { throw PracticeError.conflict("A synced repetition's practice set is not available yet. It will be retried.") }
            var attempts = Dictionary(uniqueKeysWithValues: set.attempts.map { ($0.id, $0) })
            for item in items {
                if var attempt = attempts[item.attempt.id] {
                    if attempt.undoneAt == nil { attempt.undoneAt = item.attempt.undoneAt }
                    attempts[attempt.id] = attempt
                } else { attempts[item.attempt.id] = item.attempt }
            }
            set.attempts = attempts.values.sorted { $0.date == $1.date ? $0.id.uuidString < $1.id.uuidString : $0.date < $1.date }
            sets[setID] = set
        }
        var active: ActiveSet?
        var history: [ActiveSet] = []
        for source in sets.values.sorted(by: { $0.startedAt == $1.startedAt ? $0.id.uuidString < $1.id.uuidString : $0.startedAt < $1.startedAt }) {
            let set = PracticeEngine.project(source)
            guard let session = sessions.first(where: { $0.id == set.sessionID }) else { throw PracticeError.invalid("A synced set is missing its session.") }
            // A truncated/inconsistent remote snapshot must be retried, never filed as invented
            // completion or a silently unfinished historical set.
            if source.status == .completed, set.status != .completed { throw PracticeError.conflict("A completed synced set is missing its effective repetitions. Sync will retry the complete ledger.") }
            let retainsLocalActive = state.activeSet?.id == set.id && session.endedAt == nil && set.status != .ended
            if set.status == .ended || (set.status == .completed && !retainsLocalActive) {
                history.append(set)
            } else {
                guard active == nil else { throw PracticeError.conflict("Another device has an unfinished set. Finish a set before syncing both.") }
                guard session.endedAt == nil else { throw PracticeError.conflict("A synced session closed before its unfinished set. Sync will retry the complete ledger.") }
                active = set
            }
        }
        guard sessions != state.sessions || history != state.history || active != state.activeSet else { return }
        try transaction { next in next.sessions = sessions; next.history = history; next.activeSet = active }
    }

    public func applySyncedSession(_ session: PracticeSession) throws { try transaction { next in
        if let index = next.sessions.firstIndex(where: { $0.id == session.id }) { next.sessions[index] = session }
        else { next.sessions.append(session) }
    } }

    /// `validate(_:)` requires every set's cached progress fields (`currentBPM`/`streak`/
    /// `totalPlays`/`stageIndex`/`completedStages`/completed-ness) to always equal
    /// `PracticeEngine.project(set)` replayed over its own `attempts` — the same invariant
    /// `record()`/`undo()` already maintain locally by calling `project` themselves after every
    /// mutation. A cross-device merge can change `.attempts` (union two devices' reps, or mark one
    /// undone) without going through either of those, so every method below re-runs `project` itself
    /// before storing, on the *final*, already-spliced attempts array — never trusting a remote
    /// device's own cached fields (computed against its own, possibly different, view of `.attempts`)
    /// or leaving a stale local cache behind. `project` is pure and total (never throws), so this is
    /// always safe to call unconditionally, matching `record()`/`undo()`'s own unconditional calls.
    /// Optional metadata is not an invitation for an older client to erase a captured reference
    /// or an event's hand selection. Conflicting immutable selections require recovery, not guessing.
    private static func preservePracticeContext(in incoming: inout ActiveSet, from existing: ActiveSet?) throws {
        guard let existing else { return }
        if let original = existing.configuration.fullTempoBPM {
            if let remote = incoming.configuration.fullTempoBPM, remote != original {
                throw PracticeError.conflict("The same set has conflicting full-tempo references. Keep the local record and retry sync.")
            }
            incoming.configuration.fullTempoBPM = original
        }
        for (eventID, hands) in existing.configuration.recordedHands {
            if let remote = incoming.configuration.recordedHands[eventID], remote != hands {
                throw PracticeError.conflict("The same repetition has conflicting hand selections. Keep the local record and retry sync.")
            }
            incoming.configuration.recordedHands[eventID] = hands
        }
    }

    public func applySyncedSet(_ incoming: ActiveSet) throws {
        try transaction { next in
            var incoming = incoming
            let existing = next.activeSet?.id == incoming.id ? next.activeSet : next.history.first { $0.id == incoming.id }
            try Self.preservePracticeContext(in: &incoming, from: existing)
            if next.activeSet?.id == incoming.id {
                incoming.attempts = next.activeSet?.attempts ?? []
                next.activeSet = PracticeEngine.project(incoming)
            } else if let index = next.history.firstIndex(where: { $0.id == incoming.id }) {
                incoming.attempts = next.history[index].attempts
                next.history[index] = PracticeEngine.project(incoming)
            } else if incoming.status == .completed || incoming.status == .ended {
                // Never seen locally before, and already finished on whichever device ran it —
                // `validate(_:)` requires every `history` entry to be finished, so this is always
                // safe to file there.
                next.history.append(PracticeEngine.project(incoming))
            } else if next.activeSet == nil {
                // Never seen locally before and still live (running/paused) on another device, and
                // this device has no live set of its own right now: mirrors the same in-progress
                // session across devices (e.g. "started on the iPad, picked up the iPhone mid-set").
                next.activeSet = PracticeEngine.project(incoming)
            }
            else { throw PracticeError.conflict("Another device has an unfinished set. Finish this device's set before syncing it.") }
            // This device already has its own different live set. A genuine same-account,
            // simultaneous-device conflict (rare — the same person cannot really practice two things
            // at once, but two sockets can each think they own "the" active set for a moment). Not
            // solved here: applying the pulled snapshot would either silently replace this device's
            // own in-progress session or violate the "history is always finished" invariant, so this
            // one pulled row is skipped for now rather than forcing either. Never a rep-loss risk
            // either way — the reps themselves sync through the separate, append-only `attempts`
            // table regardless of what happens to this specific `sets` snapshot.
        }
    }

    /// One rep pulled from another device. Finds the set it belongs to (active or history) and
    /// appends it only if not already present by id — `sync_append`'s own `on conflict (id) do
    /// nothing` is the server-side half of this idempotency; this is the client-side half, since
    /// Core's storage (an array nested inside the owning `ActiveSet`) has no unique-index of its own
    /// to lean on. A set this device has not pulled/pushed yet is a no-op, not an error: `pullTables`
    /// (`SyncCoordinator`) lists `sets` ahead of `attempts` every pass, so in practice the set already
    /// exists locally by the time its attempts are applied within the same `syncAll()`.
    public func applySyncedAttempt(_ attempt: Attempt, setID: UUID) throws {
        try applySyncedAttempts([(attempt, setID)])
    }
    /// Imports/refreshes the full remote rep log in one durable transaction. Event times order
    /// replay; Undo only advances nil -> timestamp and can never resurrect an already-undone rep.
    public func applySyncedAttempts(_ incoming: [(attempt: Attempt, setID: UUID)]) throws {
        guard !incoming.isEmpty else { return }
        var active = state.activeSet
        var history = state.history
        func merged(_ original: [Attempt], _ received: [(attempt: Attempt, setID: UUID)]) -> [Attempt] {
            var values = Dictionary(uniqueKeysWithValues: original.map { ($0.id, $0) })
            for item in received {
                if var current = values[item.attempt.id] {
                    if current.undoneAt == nil { current.undoneAt = item.attempt.undoneAt }
                    values[current.id] = current
                } else { values[item.attempt.id] = item.attempt }
            }
            return values.values.sorted { $0.date == $1.date ? $0.id.uuidString < $1.id.uuidString : $0.date < $1.date }
        }
        for (setID, attempts) in Dictionary(grouping: incoming, by: { $0.setID }) {
            if var set = active, set.id == setID {
                set.attempts = merged(set.attempts, attempts); active = PracticeEngine.project(set)
            } else if let index = history.firstIndex(where: { $0.id == setID }) {
                var set = history[index]; set.attempts = merged(set.attempts, attempts)
                history[index] = PracticeEngine.project(set)
            } else {
                throw PracticeError.conflict("A synced repetition's practice set is not available yet. It will be retried.")
            }
        }
        guard active != state.activeSet || history != state.history else { return }
        try transaction { next in next.activeSet = active; next.history = history }
    }

    /// The one legitimate post-insert edit on an append-only attempt (spec 9 Undo), applied locally
    /// the same way `sync_undo_attempt` applies it server-side: a no-op if already undone or if the
    /// attempt is not found locally yet.
    public func applySyncedUndoAttempt(attemptID: UUID, undoneAt: Date) throws {
        try transaction { next in
            if var activeSet = next.activeSet, let index = activeSet.attempts.firstIndex(where: { $0.id == attemptID }), activeSet.attempts[index].undoneAt == nil {
                activeSet.attempts[index].undoneAt = undoneAt
                next.activeSet = PracticeEngine.project(activeSet)
                return
            }
            for historyIndex in next.history.indices {
                var set = next.history[historyIndex]
                if let index = set.attempts.firstIndex(where: { $0.id == attemptID }), set.attempts[index].undoneAt == nil {
                    set.attempts[index].undoneAt = undoneAt
                    next.history[historyIndex] = PracticeEngine.project(set)
                    return
                }
            }
        }
    }

    // Append-only logs: id-deduplicated union merge (Schema3.md: "replicas merge by set union").
    public func applySyncedRuleEvent(_ event: RuleEvent) throws { try transaction { next in
        guard !next.ruleEvents.contains(where: { $0.id == event.id }) else { return }; next.ruleEvents.append(event)
    } }
    public func applySyncedRewardLedgerEntry(_ entry: RewardLedgerEntry) throws { try transaction { next in
        guard !next.rewardLedger.contains(where: { $0.id == entry.id }) else { return }; next.rewardLedger.append(entry)
    } }
    public func applySyncedBadge(_ badge: Badge) throws { try transaction { next in
        guard !next.badges.contains(where: { $0.id == badge.id }) else { return }; next.badges.append(badge)
    } }
    public func applySyncedMilestoneEvent(_ event: MilestoneEvent) throws { try transaction { next in
        guard !next.milestoneEvents.contains(where: { $0.id == event.id }) else { return }; next.milestoneEvents.append(event)
    } }
    public func applySyncedColdGrade(_ record: ColdGradeRecord) throws { try transaction { next in
        guard !next.coldGrades.contains(where: { $0.id == record.id }) else { return }; next.coldGrades.append(record)
    } }
    public func applySyncedBreakPointTap(_ tap: BreakPointTap) throws { try transaction { next in
        guard !next.breakPointTaps.contains(where: { $0.id == tap.id }) else { return }; next.breakPointTaps.append(tap)
    } }

    public func requireReplaceableScore(pieceID: UUID) throws { try Self.requireReplaceableScore(pieceID: pieceID, in: state) }
    private static func requireReplaceableScore(pieceID: UUID, in state: LibraryState) throws {
        let snapshots = (state.history + [state.activeSet].compactMap { $0 }).compactMap { $0.configuration.passageSnapshot }
        guard !state.inkStrokes.contains(where: { $0.pieceID == pieceID && $0.deletedAt == nil }),
              !(state.passages + snapshots).contains(where: { $0.pieceID == pieceID && !$0.regions.isEmpty }) else {
            throw PracticeError.conflict("This score has ink or marked passages. Import the new PDF as a separate piece to preserve those marks and practice history.")
        }
    }
    /// §8: deleting archives rather than erases. The row stays — with `archived` and the sync
    /// tombstone `deletedAt` both set — so its history stays reachable and a future sync engine
    /// sees a real tombstone instead of a row that silently vanished from one replica. Every
    /// passage-listing View is expected to filter `archived` (`PassagePickerView`, `ScoreWorkspace`).
    /// As before archiving existed, a finished set's own `passageSnapshot` already preserves
    /// everything needed to show what was practiced, so history's *live* navigation reference is
    /// still unlinked — it should not invite jumping back into an archived passage.
    public func deletePassage(_ id: UUID) throws {
        let date = now()
        try transaction { next in
            guard next.activeSet?.configuration.passageID != id else { throw PracticeError.conflict("End the current set before removing its passage.") }
            guard let index = next.passages.firstIndex(where: { $0.id == id }) else { throw PracticeError.invalid("This passage is no longer in your library.") }
            next.passages[index].archived = true
            next.passages[index].deletedAt = date
            next.passages[index].updatedAt = date
            for historyIndex in next.history.indices where next.history[historyIndex].configuration.passageID == id {
                next.history[historyIndex].configuration.passageID = nil
            }
        }
    }
    /// §8: moves the given regions out of `id`'s passage into a brand-new passage. The original
    /// keeps every other region, its learning history and its schedule; the new passage starts
    /// fresh (§4d "never lose user data" is about practice evidence, and the split-off boxes have
    /// none yet). Region ids move with their regions, so the library-wide "every mark id is unique"
    /// invariant (`validate`) holds without regenerating them.
    @discardableResult public func splitPassage(_ id: UUID, movingRegionIDs: Set<UUID>, newTitle: String) throws -> Passage {
        let date = now()
        var created: Passage!
        try transaction { next in
            guard let index = next.passages.firstIndex(where: { $0.id == id && !$0.archived }) else {
                throw PracticeError.invalid("This passage is no longer in your library.")
            }
            var original = next.passages[index]
            let moving = original.regions.filter { movingRegionIDs.contains($0.id) }
            guard !moving.isEmpty, moving.count < original.regions.count else {
                throw PracticeError.invalid("Choose at least one box to split off, and leave at least one behind.")
            }
            original.regions.removeAll { movingRegionIDs.contains($0.id) }
            original.page = original.regions.map(\.page).min() ?? original.page
            original.updatedAt = date
            next.passages[index] = original
            let trimmed = newTitle.trimmingCharacters(in: .whitespacesAndNewlines)
            let split = Passage(pieceID: original.pieceID, title: trimmed.isEmpty ? "\(original.title) (split)" : trimmed,
                                page: moving.map(\.page).min() ?? original.page, focus: original.focus, regions: moving,
                                color: original.color, parentPassageID: original.id,
                                createdAt: date, updatedAt: date)
            next.passages.append(split)
            created = split
        }
        return created
    }
    /// Creates a fresh larger practice target while retaining the two original shortcuts and their
    /// history as archived rows. Copies need fresh mark IDs; the entire join is one durable write.
    @discardableResult public func joinPassages(_ ids: [UUID]) throws -> Passage {
        let date = now()
        var joined: Passage!
        try transaction { next in
            guard ids.count == 2, Set(ids).count == 2,
                  let aIndex = next.passages.firstIndex(where: { $0.id == ids[0] && !$0.archived }),
                  let bIndex = next.passages.firstIndex(where: { $0.id == ids[1] && !$0.archived }),
                  next.passages[aIndex].pieceID == next.passages[bIndex].pieceID else {
                throw PracticeError.invalid("Choose two live passages from the same piece.")
            }
            let a = next.passages[aIndex], b = next.passages[bIndex]
            let regions = (a.regions + b.regions).map {
                PassageRegion(page: $0.page, x: $0.x, y: $0.y, width: $0.width, height: $0.height)
            }
            joined = Passage(pieceID: a.pieceID, title: "\(a.title) + \(b.title)",
                             startMeasure: [a.startMeasure, b.startMeasure].compactMap { $0 }.min(),
                             endMeasure: [a.endMeasure, b.endMeasure].compactMap { $0 }.max(),
                             page: regions.map(\.page).min() ?? min(a.page, b.page), focus: a.focus,
                             regions: regions, joinedFromPassageIDs: ids)
            for index in [aIndex, bIndex] {
                next.passages[index].archived = true
                next.passages[index].deletedAt = date
                next.passages[index].updatedAt = date
            }
            next.passages.append(joined)
        }
        return joined
    }

    /// §8/R2 "join the seams": folds `secondaryIDs` into `primary`. `primary` keeps its own id,
    /// title, learning state and schedule — it is the survivor a caller keeps navigating to. Every
    /// secondary passage's regions move (not copy) into `primary`, so the global mark-id-uniqueness
    /// invariant holds, and each secondary is archived (never hard-deleted) with its id recorded in
    /// `joinedFromPassageIDs` for provenance and future undo.
    @discardableResult public func mergePassages(primary: UUID, into secondaryIDs: [UUID]) throws -> Passage {
        let date = now()
        var merged: Passage!
        try transaction { next in
            guard !secondaryIDs.isEmpty, !secondaryIDs.contains(primary) else {
                throw PracticeError.invalid("Choose at least one other passage to merge in.")
            }
            guard let primaryIndex = next.passages.firstIndex(where: { $0.id == primary && !$0.archived }) else {
                throw PracticeError.invalid("This passage is no longer in your library.")
            }
            var result = next.passages[primaryIndex]
            for secondaryID in secondaryIDs {
                guard let secondaryIndex = next.passages.firstIndex(where: { $0.id == secondaryID && !$0.archived }),
                      next.passages[secondaryIndex].pieceID == result.pieceID else {
                    throw PracticeError.invalid("Choose passages from the same piece to merge.")
                }
                var secondary = next.passages[secondaryIndex]
                result.regions.append(contentsOf: secondary.regions)
                for provenanceID in secondary.joinedFromPassageIDs + [secondary.id]
                where !result.joinedFromPassageIDs.contains(provenanceID) {
                    result.joinedFromPassageIDs.append(provenanceID)
                }
                secondary.regions = []
                secondary.archived = true; secondary.deletedAt = date; secondary.updatedAt = date
                next.passages[secondaryIndex] = secondary
            }
            result.page = result.regions.map(\.page).min() ?? result.page
            result.updatedAt = date
            next.passages[primaryIndex] = result
            merged = result
        }
        return merged
    }

    public func startSet(_ configuration: PracticeConfiguration, scoreSectionID: UUID? = nil) throws {
        let date = now()
        try transaction { next in try Self.beginSet(configuration, scoreSectionID: scoreSectionID, in: &next, at: date) }
    }

    /// The first verdict, learning schedule and new set are one durable mutation. A failed write
    /// leaves all of them unchanged, so the same visible cold prompt can safely be retried.
    @discardableResult public func startColdGradedSet(_ configuration: PracticeConfiguration, grade: ColdGrade,
                                                      eventID: UUID = UUID()) throws -> ColdGradeApplication {
        let date = now()
        var result: ColdGradeApplication!
        try transaction { next in
            guard let passageID = configuration.passageID,
                  let passageIndex = next.passages.firstIndex(where: { $0.id == passageID && !$0.archived }),
                  let application = PracticeRulesEngine.applyColdGrade(passageID: passageID, grade: grade,
                    tempo: configuration.startBPM, context: RuleContext(state: next, now: date)) else {
                throw PracticeError.conflict("This passage is no longer eligible for a first-attempt grade. Choose it again to refresh practice options.")
            }
            try Self.beginSet(configuration, in: &next, at: date)
            next.coldGrades.append(application.record)
            next.passages[passageIndex].learningState = application.newLearningState
            next.passages[passageIndex].schedule = application.newSchedule
            next.passages[passageIndex].updatedAt = date
            next.ruleEvents.append(contentsOf: application.decisions.map { $0.asRuleEvent(overridden: false) })
            var set = next.activeSet!
            set.attempts.append(Attempt(id: eventID, verdict: PracticeUXHelpers.verdict(for: grade), date: date,
                                       bpm: set.currentBPM, stageIndex: set.stageIndex))
            set = PracticeEngine.project(set)
            if set.status == .completed { set.endedAt = date; set.lastCheckpoint = nil }
            next.activeSet = set
            result = application
        }
        return result
    }

    private static func beginSet(_ configuration: PracticeConfiguration, scoreSectionID: UUID? = nil, in next: inout LibraryState, at date: Date) throws {
        var configuration = configuration
        configuration.tempoChanges = [] // A new set gets its own tempo-event boundaries.
        configuration.recordedHands = [:]
        configuration.fullTempoBPM = next.pieces.first { $0.id == configuration.pieceID }?.fullTempoBPM
        if let scoreSectionID {
            guard configuration.passageID == nil,
                  let piece = next.pieces.first(where: { $0.id == configuration.pieceID && $0.deletedAt == nil }),
                  let section = piece.scoreSections.first(where: { $0.id == scoreSectionID }) else {
                throw PracticeError.conflict("This movement is no longer available. Choose a movement or passage again.")
            }
            configuration.passageSnapshot = ScoreOrganization.practiceSnapshot(for: section, pieceID: piece.id, at: date)
        } else {
            // Only the explicit, validated section path can create a boxless movement snapshot.
            // Ordinary callers cannot inject a snapshot unrelated to their saved passage.
            configuration.passageSnapshot = configuration.passageID.flatMap { id in next.passages.first { $0.id == id && $0.pieceID == configuration.pieceID } }
        }
        try PracticeEngine.validate(configuration)
        if let active = next.activeSet {
            guard active.status == .completed else { throw PracticeError.conflict("Pause or finish your current set before starting another.") }
            next.history.append(active); next.activeSet = nil
        }
        let sessionID: UUID
        if let session = next.sessions.last, session.endedAt == nil,
           session.pieceID == configuration.pieceID,
           Calendar.current.isDate(session.startedAt, inSameDayAs: date) { sessionID = session.id }
        else {
            for index in next.sessions.indices where next.sessions[index].endedAt == nil { next.sessions[index].endedAt = date }
            let session = PracticeSession(pieceID: configuration.pieceID, focus: configuration.focus, startedAt: date)
            next.sessions.append(session); sessionID = session.id
        }
        next.activeSet = ActiveSet(sessionID: sessionID, configuration: configuration, startedAt: date)
    }

    /// Returns false for an already committed event. Callers must reward only true results.
    @discardableResult public func record(_ verdict: Verdict, hands: String? = nil, eventID: UUID = UUID()) throws -> Bool {
        let existing = (state.history + [state.activeSet].compactMap { $0 }).flatMap(\.attempts).first { $0.id == eventID }
        if let existing {
            guard existing.verdict == verdict else { throw PracticeError.conflict("This event identifier was already used for a different verdict.") }
            return false
        }
        if let hands, !PracticeHand.isExplicitSelection(hands) { throw PracticeError.invalid("Choose Left hand, Both hands or Right hand.") }
        let date = now()
        try transaction { next in
            guard var set = next.activeSet, set.status == .running else { throw PracticeError.conflict("Resume a practice set before recording a repetition.") }
            Self.accrue(&set, at: date)
            set.attempts.append(Attempt(id: eventID, verdict: verdict, date: date, bpm: set.currentBPM, stageIndex: set.stageIndex))
            // Reset is a command boundary, not a repetition. Preserve the selection only on reps.
            if verdict != .reset, let selected = hands ?? PracticeHand.canonicalSelection(set.configuration.hands) {
                set.configuration.recordedHands[eventID.uuidString] = selected
            }
            set = PracticeEngine.project(set)
            if set.status == .completed { set.endedAt = date; set.lastCheckpoint = nil }
            next.activeSet = set
        }
        return true
    }

    /// A camera action keeps its identity and timestamp while projection, validation and JSON
    /// encoding run off the UI actor. Only the MainActor may atomically write and publish it.
    /// Timing checkpoints may be merged; a different set, verdict, Undo, tempo or status retires
    /// the original action instead of applying it to a context the player did not gesture in.
    @discardableResult public func recordPreparedAsync(_ verdict: Verdict, hands: String? = nil,
                                                       expectedActiveSetID: UUID, eventID: UUID = UUID(),
                                                       canCommit: @MainActor () -> Bool = { true }) async throws -> Bool {
        if try existingEvent(eventID, verdict: verdict) { return false }
        guard !isReadOnly else { throw PracticeError.unavailable(errorMessage ?? "The library is read-only.") }
        guard let original = activeSet, original.id == expectedActiveSetID, original.status == .running else {
            throw PracticeError.conflict("Resume the same practice set before recording a repetition.")
        }
        if let hands, !PracticeHand.isExplicitSelection(hands) { throw PracticeError.invalid("Choose Left hand, Both hands or Right hand.") }
        guard canCommit() else { throw PracticeError.conflict("This repetition is no longer available in the current score context.") }
        let firstBaseline = state
        let date = now()
        for retry in 0..<4 {
            try Task.checkCancellation()
            if try existingEvent(eventID, verdict: verdict) { return false }
            guard !isReadOnly else { throw PracticeError.unavailable(errorMessage ?? "The library is read-only.") }
            guard let current = activeSet, Self.sameRecordingContext(current, original) else {
                throw PracticeError.conflict("The practice set changed while preparing this repetition.")
            }
            let baseline = retry == 0 ? firstBaseline : state
            let (next, data) = try await prepareMutation(baseline) { next in
                guard var set = next.activeSet, set.id == expectedActiveSetID, set.status == .running else {
                    throw PracticeError.conflict("Resume the same practice set before recording a repetition.")
                }
                Self.accrue(&set, at: date)
                set.attempts.append(Attempt(id: eventID, verdict: verdict, date: date, bpm: set.currentBPM, stageIndex: set.stageIndex))
                if verdict != .reset, let selected = hands ?? PracticeHand.canonicalSelection(set.configuration.hands) {
                    set.configuration.recordedHands[eventID.uuidString] = selected
                }
                set = PracticeEngine.project(set)
                if set.status == .completed { set.endedAt = date; set.lastCheckpoint = nil }
                next.activeSet = set
            }
            try Task.checkCancellation()
            // The callback runs on MainActor and may inspect current score/scene/input gates.
            // Nothing suspends between these final checks, atomic write and state publication.
            guard canCommit() else { throw PracticeError.conflict("This repetition is no longer available in the current score context.") }
            guard state.revision == baseline.revision else { continue }
            guard !isReadOnly, let current = activeSet, Self.sameRecordingContext(current, original) else {
                throw PracticeError.conflict("The practice set changed while preparing this repetition.")
            }
            try publishPrepared(next, data: data)
            return true
        }
        throw PracticeError.conflict("The library is busy saving other changes. Try recording this repetition again.")
    }

    private func existingEvent(_ eventID: UUID, verdict: Verdict) throws -> Bool {
        let existing = (state.history + [activeSet].compactMap { $0 }).lazy.flatMap(\.attempts).first { $0.id == eventID }
        guard let existing else { return false }
        guard existing.verdict == verdict else {
            throw PracticeError.conflict("This event identifier was already used for a different verdict.")
        }
        return true
    }

    nonisolated private static func sameRecordingContext(_ lhs: ActiveSet, _ rhs: ActiveSet) -> Bool {
        var lhs = lhs; var rhs = rhs
        lhs.activeSeconds = 0; lhs.lastCheckpoint = nil
        rhs.activeSeconds = 0; rhs.lastCheckpoint = nil
        return lhs == rhs
    }
    public func reset() throws { try record(.reset) }
    public func undo() throws {
        let date = now()
        try transaction { next in
            guard var set = next.activeSet,
                  let index = set.attempts.lastIndex(where: { $0.undoneAt == nil }) else { throw PracticeError.conflict("There is no repetition to undo.") }
            Self.accrue(&set, at: date)
            set.attempts[index].undoneAt = date
            set = PracticeEngine.project(set)
            next.activeSet = set
        }
    }
    /// Record tempo edits at their original boundary. Rewriting the original start tempo would
    /// replay earned ladder advances on top of the requested BPM and silently change history.
    public func adjustActiveTempo(_ bpm: Double) throws {
        try transaction { next in
            guard var set = next.activeSet, set.status == .running || set.status == .paused else {
                throw PracticeError.conflict("There is no running set to change the tempo of.")
            }
            guard bpm.isFinite else { throw PracticeError.invalid("Choose a tempo from 20–300 BPM.") }
            let clamped = min(max(bpm, 20), 300)
            guard clamped != set.currentBPM else { return }
            // Repeated drag changes before the next attempt are one boundary; keep its final
            // requested value rather than producing thousands of redundant configuration events.
            let change = SetTempoChange(bpm: clamped, afterAttemptCount: set.attempts.count)
            if set.configuration.tempoChanges.last?.afterAttemptCount == set.attempts.count {
                set.configuration.tempoChanges[set.configuration.tempoChanges.count - 1] = change
            } else { set.configuration.tempoChanges.append(change) }
            next.activeSet = PracticeEngine.project(set)
        }
    }
    public func checkpoint() throws {
        guard state.activeSet?.status == .running else { return }
        let date = now()
        try transaction { next in
            if var set = next.activeSet { Self.accrue(&set, at: date); next.activeSet = set }
        }
    }
    /// Foreground timing checkpoints prepare the same durable projection without holding the UI.
    public func checkpointPreparedAsync() async throws {
        guard let setID = activeSet?.id, activeSet?.status == .running else { return }
        let firstBaseline = state
        let date = now()
        for retry in 0..<4 {
            try Task.checkCancellation()
            guard !isReadOnly else { throw PracticeError.unavailable(errorMessage ?? "The library is read-only.") }
            guard activeSet?.id == setID, activeSet?.status == .running else { return }
            let baseline = retry == 0 ? firstBaseline : state
            let (next, data) = try await prepareMutation(baseline) { next in
                if var set = next.activeSet { Self.accrue(&set, at: date); next.activeSet = set }
            }
            try Task.checkCancellation()
            guard state.revision == baseline.revision else { continue }
            guard !isReadOnly else { throw PracticeError.unavailable(errorMessage ?? "The library is read-only.") }
            try publishPrepared(next, data: data)
            return
        }
        throw PracticeError.conflict("The library is busy saving other changes. Practice timing will checkpoint again.")
    }
    public func pause() throws {
        guard state.activeSet?.status == .running else { return }
        let date = now()
        try transaction { next in
            if var set = next.activeSet { Self.accrue(&set, at: date); set.status = .paused; set.lastCheckpoint = nil; next.activeSet = set }
        }
    }
    public func suspend() throws { try pause() }
    public func resume() throws {
        let date = now()
        try transaction { next in
            guard next.activeSet?.status == .paused else { throw PracticeError.conflict("There is no paused set to resume.") }
            next.activeSet?.status = .running; next.activeSet?.lastCheckpoint = date
        }
    }
    public func endSet() throws {
        guard state.activeSet != nil else { return }
        let date = now()
        try transaction { next in
            if var set = next.activeSet {
                Self.accrue(&set, at: date)
                if set.status != .completed { set.status = .ended }
                set.endedAt = date; set.lastCheckpoint = nil
                next.history.append(set); next.activeSet = nil
            }
        }
    }
    public func endSession() throws {
        let date = now()
        try transaction { next in
            if var set = next.activeSet {
                Self.accrue(&set, at: date)
                if set.status != .completed { set.status = .ended }
                set.endedAt = date; set.lastCheckpoint = nil; next.history.append(set); next.activeSet = nil
            }
            for index in next.sessions.indices where next.sessions[index].endedAt == nil { next.sessions[index].endedAt = date }
        }
    }
    public func saveGoal(_ goal: PracticeGoal) throws {
        var value = goal; value.updatedAt = now(); try applySyncedGoal(value)
    }
    public func applySyncedGoal(_ goal: PracticeGoal) throws {
        try transaction { next in
            if let index = next.goals.firstIndex(where: { $0.id == goal.id }) { next.goals[index] = goal }
            else { next.goals.append(goal) }
        }
    }
    public func deleteGoal(_ id: UUID) throws {
        let date = now()
        try transaction { next in
            guard let index = next.goals.firstIndex(where: { $0.id == id }) else { return }
            next.goals[index].deletedAt = date; next.goals[index].updatedAt = date
        }
    }
    public func saveRoutine(_ routine: PracticeRoutine) throws {
        var value = routine; value.updatedAt = now(); try applySyncedRoutine(value)
    }
    public func applySyncedRoutine(_ routine: PracticeRoutine) throws {
        try transaction { next in
            if let index = next.routines.firstIndex(where: { $0.id == routine.id }) { next.routines[index] = routine }
            else { next.routines.append(routine) }
        }
    }
    public func deleteRoutine(_ id: UUID) throws {
        let date = now()
        try transaction { next in
            guard let index = next.routines.firstIndex(where: { $0.id == id }) else { return }
            next.routines[index].deletedAt = date; next.routines[index].updatedAt = date
        }
    }
    public func updatePreferences(_ preferences: Preferences) throws {
        var updated = preferences; updated.updatedAt = now()
        try transaction { $0.preferences = updated }
    }
    public func applySyncedPreferences(_ preferences: Preferences) throws {
        guard preferences.updatedAt > state.preferences.updatedAt else { return }
        try transaction { $0.preferences = preferences }
    }

    // MARK: - §6 Instruments
    public func saveInstrument(_ instrument: Instrument) throws {
        let date = now()
        try transaction { next in
            var instrument = instrument; instrument.updatedAt = date
            if let index = next.instruments.firstIndex(where: { $0.id == instrument.id }) { next.instruments[index] = instrument }
            else { next.instruments.append(instrument) }
        }
    }
    public func deleteInstrument(_ id: UUID) throws {
        let date = now()
        try transaction { next in
            guard let index = next.instruments.firstIndex(where: { $0.id == id }) else { return }
            next.instruments[index].deletedAt = date; next.instruments[index].updatedAt = date
        }
    }

    // MARK: - §7 Library organization
    public func saveTag(_ tag: Tag) throws {
        let date = now()
        try transaction { next in
            var tag = tag; tag.updatedAt = date
            if let index = next.tags.firstIndex(where: { $0.id == tag.id }) { next.tags[index] = tag } else { next.tags.append(tag) }
        }
    }
    public func deleteTag(_ id: UUID) throws {
        let date = now()
        try transaction { next in
            guard let index = next.tags.firstIndex(where: { $0.id == id }) else { return }
            next.tags[index].deletedAt = date; next.tags[index].updatedAt = date
        }
    }
    public func saveFolder(_ folder: Folder) throws {
        let date = now()
        try transaction { next in
            var folder = folder; folder.updatedAt = date
            if let index = next.folders.firstIndex(where: { $0.id == folder.id }) { next.folders[index] = folder } else { next.folders.append(folder) }
        }
    }
    public func deleteFolder(_ id: UUID) throws {
        let date = now()
        try transaction { next in
            guard let index = next.folders.firstIndex(where: { $0.id == id }) else { return }
            next.folders[index].deletedAt = date; next.folders[index].updatedAt = date
        }
    }
    public func saveSetlist(_ setlist: Setlist) throws {
        let date = now()
        try transaction { next in
            var setlist = setlist; setlist.updatedAt = date
            if let index = next.setlists.firstIndex(where: { $0.id == setlist.id }) { next.setlists[index] = setlist } else { next.setlists.append(setlist) }
        }
    }
    public func deleteSetlist(_ id: UUID) throws {
        let date = now()
        try transaction { next in
            guard let index = next.setlists.firstIndex(where: { $0.id == id }) else { return }
            next.setlists[index].deletedAt = date; next.setlists[index].updatedAt = date
        }
    }
    public func saveBookmark(_ bookmark: Bookmark) throws {
        let date = now()
        try transaction { next in
            var bookmark = bookmark; bookmark.updatedAt = date
            if let index = next.bookmarks.firstIndex(where: { $0.id == bookmark.id }) { next.bookmarks[index] = bookmark } else { next.bookmarks.append(bookmark) }
        }
    }
    public func deleteBookmark(_ id: UUID) throws {
        let date = now()
        try transaction { next in
            guard let index = next.bookmarks.firstIndex(where: { $0.id == id }) else { return }
            next.bookmarks[index].deletedAt = date; next.bookmarks[index].updatedAt = date
        }
    }
    /// Upserts one effective page's crop/rotation/order/deletion, or an inserted blank/staff page.
    public func savePageEdit(_ edit: PageEdit) throws {
        let date = now()
        try transaction { next in
            var edit = edit; edit.updatedAt = date
            if let index = next.pageEdits.firstIndex(where: { $0.id == edit.id }) { next.pageEdits[index] = edit } else { next.pageEdits.append(edit) }
        }
    }
    public func deletePageEdit(_ id: UUID) throws {
        let date = now()
        try transaction { next in
            guard let index = next.pageEdits.firstIndex(where: { $0.id == id }) else { return }
            next.pageEdits[index].deletedAt = date; next.pageEdits[index].updatedAt = date
        }
    }
    /// Upserts many page edits in one transaction (one validate, one write) — the page-tools editor's
    /// save point after seeding a full row set or after a reorder/crop/rotate/insert/delete batch,
    /// so re-laying out a several-hundred-page score is one disk write, not one per row.
    public func savePageEdits(_ edits: [PageEdit]) throws {
        guard !edits.isEmpty else { return }
        let date = now()
        try transaction { next in
            for var edit in edits {
                edit.updatedAt = date
                if let index = next.pageEdits.firstIndex(where: { $0.id == edit.id }) { next.pageEdits[index] = edit }
                else { next.pageEdits.append(edit) }
            }
        }
    }
    public func saveScoreLink(_ link: ScoreLink) throws {
        let date = now()
        try transaction { next in
            var link = link; link.updatedAt = date
            if let index = next.scoreLinks.firstIndex(where: { $0.id == link.id }) { next.scoreLinks[index] = link } else { next.scoreLinks.append(link) }
        }
    }
    public func deleteScoreLink(_ id: UUID) throws {
        let date = now()
        try transaction { next in
            guard let index = next.scoreLinks.firstIndex(where: { $0.id == id }) else { return }
            next.scoreLinks[index].deletedAt = date; next.scoreLinks[index].updatedAt = date
        }
    }
    public func saveTextAnnotation(_ annotation: TextBoxAnnotation) throws {
        let date = now()
        try transaction { next in
            var annotation = annotation; annotation.updatedAt = date
            if let index = next.textAnnotations.firstIndex(where: { $0.id == annotation.id }) { next.textAnnotations[index] = annotation } else { next.textAnnotations.append(annotation) }
        }
    }
    public func deleteTextAnnotation(_ id: UUID) throws {
        let date = now()
        try transaction { next in
            guard let index = next.textAnnotations.firstIndex(where: { $0.id == id }) else { return }
            next.textAnnotations[index].deletedAt = date; next.textAnnotations[index].updatedAt = date
        }
    }
    public func saveStampAnnotation(_ stamp: StampAnnotation) throws {
        let date = now()
        try transaction { next in
            var stamp = stamp; stamp.updatedAt = date
            if let index = next.stampAnnotations.firstIndex(where: { $0.id == stamp.id }) { next.stampAnnotations[index] = stamp } else { next.stampAnnotations.append(stamp) }
        }
    }
    public func deleteStampAnnotation(_ id: UUID) throws {
        let date = now()
        try transaction { next in
            guard let index = next.stampAnnotations.firstIndex(where: { $0.id == id }) else { return }
            next.stampAnnotations[index].deletedAt = date; next.stampAnnotations[index].updatedAt = date
        }
    }

    // MARK: - §8/§11 Passage history (append-only: a stable id and event date are enough to merge by union)
    public func recordColdGrade(_ record: ColdGradeRecord) throws {
        try transaction { next in
            guard next.passages.contains(where: { $0.id == record.passageID }) else { throw PracticeError.invalid("This passage is no longer in your library.") }
            next.coldGrades.append(record)
        }
    }
    public func recordBreakPointTap(_ tap: BreakPointTap) throws {
        try transaction { next in
            guard next.passages.contains(where: { $0.id == tap.passageID }) else { throw PracticeError.invalid("This passage is no longer in your library.") }
            next.breakPointTaps.append(tap)
        }
    }

    // MARK: - §11 Rules
    public func updateRuleSettings(_ settings: RuleSettings) throws {
        let date = now()
        try transaction { next in var settings = settings; settings.updatedAt = date; next.ruleSettings = settings }
    }
    public func recordRuleEvent(_ event: RuleEvent) throws { try transaction { $0.ruleEvents.append(event) } }

    /// Apply the in-set rule and its log together after background preparation. The exact set,
    /// settings and rule log used by the decision must still be current; unrelated saves rebase.
    @discardableResult public func applyPracticeRulePreparedAsync(_ decision: Decision,
                                                                  expectedSet: ActiveSet,
                                                                  canCommit: @MainActor () -> Bool = { true }) async throws -> Bool {
        let event = decision.asRuleEvent(overridden: false)
        let expectedSettings = state.ruleSettings
        let expectedEvents = state.ruleEvents
        for _ in 0..<4 {
            try Task.checkCancellation()
            if let existing = state.ruleEvents.first(where: { $0.id == event.id }) {
                guard existing == event else { throw PracticeError.conflict("This rule event identifier is already in use.") }
                return false
            }
            guard !isReadOnly else { throw PracticeError.unavailable(errorMessage ?? "The library is read-only.") }
            guard canCommit() else { throw PracticeError.conflict("This practice rule is no longer available in the current score context.") }
            guard let current = activeSet, current.status == .running,
                  Self.sameRecordingContext(current, expectedSet), state.ruleSettings == expectedSettings,
                  state.ruleEvents == expectedEvents else {
                throw PracticeError.conflict("The practice context changed before applying this rule.")
            }
            let baseline = state
            let (next, data) = try await prepareMutation(baseline) { next in
                next.ruleEvents.append(event)
                if case .tempoChange(let bpm) = decision.outcome {
                    guard bpm.isFinite, var set = next.activeSet else { throw PracticeError.invalid("Choose a tempo from 20–300 BPM.") }
                    let clamped = min(max(bpm, 20), 300)
                    if clamped != set.currentBPM {
                        let change = SetTempoChange(bpm: clamped, afterAttemptCount: set.attempts.count)
                        if set.configuration.tempoChanges.last?.afterAttemptCount == set.attempts.count {
                            set.configuration.tempoChanges[set.configuration.tempoChanges.count - 1] = change
                        } else { set.configuration.tempoChanges.append(change) }
                        next.activeSet = PracticeEngine.project(set)
                    }
                }
            }
            try Task.checkCancellation()
            guard canCommit() else { throw PracticeError.conflict("This practice rule is no longer available in the current score context.") }
            guard state.revision == baseline.revision else { continue }
            guard !isReadOnly else { throw PracticeError.unavailable(errorMessage ?? "The library is read-only.") }
            try publishPrepared(next, data: data)
            return true
        }
        throw PracticeError.conflict("The library is busy saving other changes. This rule was not applied.")
    }

    // MARK: - §12 Warmups
    public func saveWarmupExercise(_ exercise: WarmupExercise) throws {
        let date = now()
        try transaction { next in
            var exercise = exercise; exercise.updatedAt = date
            if let index = next.warmupExercises.firstIndex(where: { $0.id == exercise.id }) { next.warmupExercises[index] = exercise } else { next.warmupExercises.append(exercise) }
        }
    }
    /// Upserts every exercise in one transaction/disk write instead of one per exercise — seeding a
    /// family's whole built-in library (a dozen-plus shapes crossed with 12 keys, see
    /// `WarmupCatalog.seedDefaults`) through the single-item `saveWarmupExercise` would mean well
    /// over a hundred synchronous atomic writes on the main actor during onboarding; this keeps the
    /// same upsert semantics (existing id replaced, new id appended) but pays that cost once.
    public func saveWarmupExercises(_ exercises: [WarmupExercise]) throws {
        guard !exercises.isEmpty else { return }
        let date = now()
        try transaction { next in
            for exercise in exercises {
                var exercise = exercise; exercise.updatedAt = date
                if let index = next.warmupExercises.firstIndex(where: { $0.id == exercise.id }) { next.warmupExercises[index] = exercise }
                else { next.warmupExercises.append(exercise) }
            }
        }
    }
    public func deleteWarmupExercise(_ id: UUID) throws {
        let date = now()
        try transaction { next in
            guard let index = next.warmupExercises.firstIndex(where: { $0.id == id }) else { return }
            next.warmupExercises[index].deletedAt = date; next.warmupExercises[index].updatedAt = date
        }
    }
    /// Bumps rotation state for a use starting now, e.g. when the player taps "Next in rotation".
    public func recordWarmupUse(_ id: UUID) throws {
        let date = now()
        try transaction { next in
            guard let index = next.warmupExercises.firstIndex(where: { $0.id == id }) else { throw PracticeError.invalid("This warmup is no longer in your library.") }
            next.warmupExercises[index].lastUsedAt = date; next.warmupExercises[index].useCount += 1; next.warmupExercises[index].updatedAt = date
        }
    }

    // MARK: - §13 Audio
    public func saveRecording(_ recording: AudioRecording) throws {
        let date = now()
        try transaction { next in
            var recording = recording; recording.updatedAt = date
            if let index = next.recordings.firstIndex(where: { $0.id == recording.id }) { next.recordings[index] = recording } else { next.recordings.append(recording) }
        }
    }
    public func deleteRecording(_ id: UUID) throws {
        let date = now()
        try transaction { next in
            guard let index = next.recordings.firstIndex(where: { $0.id == id }) else { return }
            next.recordings[index].deletedAt = date; next.recordings[index].updatedAt = date
        }
    }

    // MARK: - §14 Rewards (append-only ledger/badges/milestones; `validate` rejects a negative ledger delta)
    public func appendRewardLedgerEntry(_ entry: RewardLedgerEntry) throws { try appendRewardLedgerEntries([entry]) }
    /// Catch-up retains each append-only award while validating/writing the library once.
    public func appendRewardLedgerEntries(_ entries: [RewardLedgerEntry]) throws {
        guard !entries.isEmpty else { return }
        try transaction { $0.rewardLedger.append(contentsOf: entries) }
    }
    public func awardBadge(_ badge: Badge) throws { try transaction { $0.badges.append(badge) } }
    public func recordMilestone(_ event: MilestoneEvent) throws { try transaction { $0.milestoneEvents.append(event) } }
    public func updateRewardsState(_ rewardsState: RewardsState) throws {
        let date = now()
        try transaction { next in var rewardsState = rewardsState; rewardsState.updatedAt = date; next.rewardsState = rewardsState }
    }

    public struct RewardsReconciliationReceipt: Sendable {
        public var badges: [Badge]
        public var milestones: [MilestoneEvent]
    }

    /// Reconcile the same high-water awards as RewardsRuntime in one background-prepared change.
    /// Each retry recomputes against the newest ledger, so another reconciler or sync cannot pay
    /// an award twice or be overwritten. Receipts describe only this successful atomic commit.
    public func reconcileRewardsPreparedAsync(asOf date: Date = Date()) async throws -> RewardsReconciliationReceipt {
        let stamp = now()
        for _ in 0..<4 {
            try Task.checkCancellation()
            guard !isReadOnly else { throw PracticeError.unavailable(errorMessage ?? "The library is read-only.") }
            let baseline = state
            let (next, data) = try await prepareMutation(baseline) { next in
                try Self.reconcileRewards(in: &next, asOf: date, stamp: stamp)
            }
            try Task.checkCancellation()
            guard state.revision == baseline.revision else { continue }
            guard !isReadOnly else { throw PracticeError.unavailable(errorMessage ?? "The library is read-only.") }
            try publishPrepared(next, data: data)
            return RewardsReconciliationReceipt(badges: Array(next.badges.dropFirst(baseline.badges.count)),
                                                 milestones: Array(next.milestoneEvents.dropFirst(baseline.milestoneEvents.count)))
        }
        throw PracticeError.conflict("The library is busy saving other changes. Rewards will reconcile again.")
    }

    nonisolated private static func reconcileRewards(in next: inout LibraryState, asOf date: Date, stamp: Date) throws {
        let xpBefore = next.rewardLedger.reduce(0) { $0 + $1.xpDelta }
        func award(_ event: RewardEvent, count: Int = 1) throws {
            guard count > 0 else { return }
            guard count <= 500_000 - next.rewardLedger.count else {
                throw PracticeError.invalid("The reward ledger has reached its supported size. Export a backup before continuing.")
            }
            next.rewardLedger.append(contentsOf: (0..<count).map { _ in RewardsEngine.ledgerEntry(for: event, at: date) })
        }
        func celebrate(_ kind: MilestoneKind, detail: String, pieceID: UUID? = nil, passageID: UUID? = nil) {
            next.milestoneEvents.append(MilestoneEvent(kind: kind.rawValue, date: date, detail: detail,
                                                      pieceID: pieceID, passageID: passageID))
        }
        let sets = next.history + [next.activeSet].compactMap { $0 }
        try award(.completedRep, count: sets.flatMap(\.attempts).filter(\.isEffective).count
                  - next.rewardLedger.filter { $0.reason == "Completed repetition" }.count)
        try award(.completedSet, count: next.history.filter { $0.status == .completed }.count
                  - next.rewardLedger.filter { $0.reason == "Completed set" }.count)
        let passagesByID = Dictionary(uniqueKeysWithValues: next.passages.map { ($0.id, $0) })
        let onTime = next.coldGrades.filter { grade in
            guard let due = passagesByID[grade.passageID]?.schedule.dueDate else { return false }
            return grade.date <= due
        }.count
        try award(.onTimeReview, count: onTime - next.rewardLedger.filter { $0.reason == "Reviewed on time" }.count)
        let passageMilestones = Set(next.milestoneEvents.filter { $0.kind == MilestoneKind.passageReady.rawValue }.compactMap(\.passageID))
        for passage in next.passages.filter({ $0.learningState == .performanceReady && $0.deletedAt == nil })
            .sorted(by: { $0.id.uuidString < $1.id.uuidString }) where !passageMilestones.contains(passage.id) {
            try award(.performanceReadyPassage)
            celebrate(.passageReady, detail: MilestoneKind.passageReady.detail(passage.title), pieceID: passage.pieceID, passageID: passage.id)
        }
        let pieceMilestones = Set(next.milestoneEvents.filter { $0.kind == MilestoneKind.pieceReady.rawValue }.compactMap(\.pieceID))
        for piece in next.pieces.filter({ $0.id != WarmupsPiece.id && $0.deletedAt == nil })
            .sorted(by: { $0.id.uuidString < $1.id.uuidString }) where !pieceMilestones.contains(piece.id) {
            let passages = next.passages.filter { $0.pieceID == piece.id && !$0.archived && $0.deletedAt == nil }
            guard !passages.isEmpty, passages.allSatisfy({ $0.learningState == .performanceReady }) else { continue }
            try award(.pieceFullyReady)
            celebrate(.pieceReady, detail: MilestoneKind.pieceReady.detail(piece.title), pieceID: piece.id)
        }
        let today = next.sessions.filter { Calendar.current.isDate($0.startedAt, inSameDayAs: date) }
        if RewardsEngine.dayQualifies(focusedSeconds: today.reduce(0) { $0 + $1.activeSeconds },
                                     completedSets: today.reduce(0) { $0 + $1.completedSets }) {
            let before = next.rewardsState
            var after = RewardsEngine.recordQualifyingDay(before, today: date)
            if after != before {
                after.updatedAt = stamp; next.rewardsState = after
                if after.streakDays > before.streakDays, RewardsEngine.isStreakMilestone(after.streakDays) {
                    celebrate(.streakMilestone, detail: MilestoneKind.streakMilestone.detail("\(after.streakDays)"))
                }
            }
        }
        let oldRank = RewardsEngine.rankProgress(totalXP: xpBefore)
        let rank = RewardsEngine.rankProgress(totalXP: next.rewardLedger.reduce(0) { $0 + $1.xpDelta })
        if rank.rankName != next.rewardsState.rank || rank.division != next.rewardsState.division {
            next.rewardsState.rank = rank.rankName; next.rewardsState.division = rank.division; next.rewardsState.updatedAt = stamp
        }
        if rank.rank > oldRank.rank { celebrate(.rankUp, detail: MilestoneKind.rankUp.detail(rank.rankName)) }
        let badges = RewardsEngine.evaluateBadges(history: next.history, passages: next.passages, warmups: next.warmupExercises,
                                                  streakDays: next.rewardsState.streakDays,
                                                  alreadyEarned: Set(next.badges.map(\.key)), asOf: date)
        next.badges.append(contentsOf: badges.map { Badge(key: $0, earnedAt: date) })
    }

    // MARK: - §15 Notebook
    public func saveNotebookEntry(_ entry: NotebookEntry) throws {
        let date = now()
        try transaction { next in
            var entry = entry; entry.updatedAt = date
            if let index = next.notebookEntries.firstIndex(where: { $0.id == entry.id }) { next.notebookEntries[index] = entry } else { next.notebookEntries.append(entry) }
        }
    }
    public func deleteNotebookEntry(_ id: UUID) throws {
        let date = now()
        try transaction { next in
            guard let index = next.notebookEntries.firstIndex(where: { $0.id == id }) else { return }
            next.notebookEntries[index].deletedAt = date; next.notebookEntries[index].updatedAt = date
        }
    }

    // MARK: - §4c/§5 Profile
    public func updateProfile(_ profile: Profile) throws {
        let date = now()
        try transaction { next in var profile = profile; profile.updatedAt = date; next.profile = profile }
    }

    public func backupData() throws -> Data {
        guard !isReadOnly else { throw PracticeError.unavailable("The saved library could not be read. Export is unavailable so an empty snapshot cannot replace your backup.") }
        return try Self.encoder().encode(state)
    }
    public static func decodeBackup(_ data: Data) throws -> LibraryState {
        guard data.count <= 64 * 1024 * 1024 else { throw PracticeError.invalid("The practice library exceeds the supported 64 MB size.") }
        let state = try decoder().decode(LibraryState.self, from: data); try validate(state)
        return SchemaMigration.migrateToCurrent(state, at: Date())
    }
    /// Add a desktop snapshot without replacing mobile records, preferences, active history or
    /// rewards. Existing stable IDs win: a repeated import cannot overwrite an edited target.
    public func importDesktop(_ library: LibraryState, receipt: DesktopImportReceipt) throws {
        guard state.activeSet == nil else { throw PracticeError.conflict("Finish your current set before importing Mac data.") }
        guard !state.desktopImports.contains(where: { $0.id == receipt.id }) else { return }
        try Self.validate(library)
        try transaction { next in
            if FileManager.default.fileExists(atPath: fileURL.path) {
                _ = try preserveOriginal(prefix: "library-before-mac-import")
            }
            let pieceIDs = Set(next.pieces.map(\.id)), passageIDs = Set(next.passages.map(\.id)), goalIDs = Set(next.goals.map(\.id))
            next.pieces += library.pieces.filter { !pieceIDs.contains($0.id) }
            next.passages += library.passages.filter { !passageIDs.contains($0.id) }
            next.goals += library.goals.filter { !goalIDs.contains($0.id) }
            let strokeIDs = Set(next.inkStrokes.map(\.id))
            next.inkStrokes += library.inkStrokes.filter { !strokeIDs.contains($0.id) }
            next.desktopImports.append(receipt)
        }
    }

    public func restoreBackup(_ restored: LibraryState) throws {
        guard state.activeSet == nil else { throw PracticeError.conflict("End your current set before restoring a backup.") }
        guard restored.activeSet?.status != .running else { throw PracticeError.invalid("This backup contains a running set. Pause it on the source device before exporting.") }
        try Self.validate(restored)
        let migrated = SchemaMigration.migrateToCurrent(restored, at: now())
        if isReadOnly { try recoverUnreadableLibrary(with: migrated); return }
        try transaction { next in next = migrated }
    }

    /// The caller explicitly chose Restore. Preserve and verify the unreadable original before
    /// replacing it; failed preservation or replacement keeps the store read-only.
    private func recoverUnreadableLibrary(with restored: LibraryState) throws {
        var next = restored
        next.revision = state.revision + 1
        try Self.validate(next)
        let data = try Self.encoder().encode(next)
        guard data.count <= 64 * 1024 * 1024 else { throw PracticeError.invalid("The restored practice library exceeds the supported 64 MB size.") }
        do {
            preservedOriginalURL = try preserveOriginal(prefix: "library-preserved")
            try writeData(data, fileURL)
            state = next
            isReadOnly = false
            errorMessage = nil
        } catch {
            errorMessage = "Restore could not safely replace the unreadable library. The original is preserved. \(error.localizedDescription)"
            throw error
        }
    }

    private func preserveOriginal(prefix: String) throws -> URL {
        let original = try fileURL.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
        guard original.isRegularFile == true, original.isSymbolicLink != true else {
            throw PracticeError.unavailable("The original library could not be preserved as a regular file. It has not been replaced.")
        }
        let preserved = directory.appendingPathComponent("\(prefix)-\(UUID().uuidString).json")
        try preserveFile(fileURL, preserved)
        guard FileManager.default.contentsEqual(atPath: fileURL.path, andPath: preserved.path) else {
            throw PracticeError.unavailable("The preserved library could not be verified. The original has not been replaced.")
        }
        return preserved
    }

    private func transaction(_ change: (inout LibraryState) throws -> Void) throws {
        guard !isReadOnly else { throw PracticeError.unavailable(errorMessage ?? "The library is read-only until its original file is recovered.") }
        var next = state
        do {
            try change(&next)
            // Score/ink/preference changes cannot affect the practice projection. Re-sorting all
            // historical attempts on every annotation checkpoint needlessly occupies the UI actor.
            if next.history != state.history || next.activeSet != state.activeSet || next.sessions != state.sessions {
                Self.projectSessions(&next)
            }
            guard next != state else { errorMessage = nil; return }
            next.revision = state.revision + 1
            try Self.validate(next, trustedPrevious: state)
            let data = try Self.encoder().encode(next)
            guard data.count <= 64 * 1024 * 1024 else { throw PracticeError.invalid("The practice library has reached its supported 64 MB size. Export a backup before continuing.") }
            try writeData(data, fileURL)
            state = next; errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
            throw error
        }
    }
    nonisolated private static func accrue(_ set: inout ActiveSet, at date: Date) {
        guard set.status == .running, let last = set.lastCheckpoint else { return }
        // Bounded crash/suspension credit; foreground UI checkpoints every 15 seconds.
        set.activeSeconds += min(60, max(0, date.timeIntervalSince(last)))
        set.lastCheckpoint = max(last, date)
    }

    private func prepareMutation(_ baseline: LibraryState,
                       change: @escaping @Sendable (inout LibraryState) throws -> Void) async throws -> (LibraryState, Data?) {
        let preparation = Task.detached(priority: .userInitiated) {
            try Task.checkCancellation()
            var next = baseline
            try change(&next)
            if next.history != baseline.history || next.activeSet != baseline.activeSet || next.sessions != baseline.sessions {
                Self.projectSessions(&next)
            }
            if next == baseline { return (next, Data?.none) }
            next.revision = baseline.revision + 1
            try Self.validate(next, trustedPrevious: baseline)
            try Task.checkCancellation()
            let data = try Self.encoder().encode(next)
            guard data.count <= 64 * 1024 * 1024 else {
                throw PracticeError.invalid("The practice library has reached its supported 64 MB size. Export a backup before continuing.")
            }
            return (next, Optional(data))
        }
        do {
            return try await withTaskCancellationHandler {
                try await preparation.value
            } onCancel: { preparation.cancel() }
        } catch is CancellationError { throw CancellationError() }
        catch { errorMessage = error.localizedDescription; throw error }
    }

    private func publishPrepared(_ next: LibraryState, data: Data?) throws {
        do {
            if let data { try writeData(data, fileURL); state = next }
            errorMessage = nil
        } catch { errorMessage = error.localizedDescription; throw error }
    }
    nonisolated private static func projectSessions(_ state: inout LibraryState) {
        let sets = state.history + [state.activeSet].compactMap { $0 }
        let setsBySession = Dictionary(grouping: sets, by: \.sessionID)
        for index in state.sessions.indices {
            let own = setsBySession[state.sessions[index].id] ?? []
            state.sessions[index].activeSeconds = own.reduce(0) { $0 + $1.activeSeconds }
            state.sessions[index].attempts = own.flatMap(\.attempts).filter(\.isEffective).sorted { $0.date < $1.date }
            state.sessions[index].completedSets = own.filter { $0.status == .completed }.count
        }
    }
    nonisolated private static func encoder() -> JSONEncoder {
        // Foundation's native reference-date encoding preserves Date's exact Double value.
        // Millisecond conversion introduced rounding drift in snapshot round-trip tests.
        let encoder = JSONEncoder(); encoder.dateEncodingStrategy = .deferredToDate
        encoder.outputFormatting = [.sortedKeys]; return encoder
    }
    private static func decoder() -> JSONDecoder { let decoder = JSONDecoder(); decoder.dateDecodingStrategy = .deferredToDate; return decoder }

    nonisolated public static func validate(_ state: LibraryState) throws {
        try validate(state, trustedPrevious: nil)
    }

    /// Only an already-loaded, fully validated store snapshot may provide the baseline. External
    /// input, backups, migration and sync validation always enter the exhaustive public method.
    nonisolated private static func validate(_ state: LibraryState, trustedPrevious: LibraryState?) throws {
        func require(_ condition: Bool, _ message: String) throws { if !condition { throw PracticeError.invalid(message) } }
        func unique<T: Hashable>(_ values: [T]) -> Bool { Set(values).count == values.count }
        func text(_ value: String, maximum: Int = 500, blank: Bool = false) -> Bool {
            value.count <= maximum && (blank || !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
        // Bounds also keep calendar formatting and duration-to-Int conversions safe for imported data.
        func date(_ value: Date) -> Bool { value.timeIntervalSince1970.isFinite && (0...4_102_444_800).contains(value.timeIntervalSince1970) }
        let maximumFocusedSeconds: Double = 100 * 366 * 24 * 60 * 60
        try require((1...LibraryState.currentSchemaVersion).contains(state.schemaVersion) && state.revision >= 0, "This practice library uses an unsupported format.")
        try require(state.revision < Int.max - 1 && state.pieces.count <= 10000 && state.passages.count <= 100000 && state.history.count <= 100000 && state.sessions.count <= 100000 && state.goals.count <= 10000 && state.routines.count <= 10000, "The library contains more records than this version supports.")
        try require(unique(state.pieces.map(\.id)) && unique(state.passages.map(\.id)) && unique(state.sessions.map(\.id)) && unique(state.goals.map(\.id)) && unique(state.routines.map(\.id)), "The library contains duplicate record identifiers.")
        try require(unique(state.desktopImports.map(\.id)) && state.desktopImports.allSatisfy {
            $0.id.count == 64 && $0.id.allSatisfy { $0.isHexDigit } && DesktopTransfer.localName($0.archiveFileName)
                && date($0.importedAt) && $0.scoreCount >= 0 && $0.tableCounts.values.allSatisfy { $0 >= 0 }
        }, "The Mac import records are invalid.")
        let piecesByID = Dictionary(uniqueKeysWithValues: state.pieces.map { ($0.id, $0) })
        let passagesByID = Dictionary(uniqueKeysWithValues: state.passages.map { ($0.id, $0) })
        let pieceIDs = Set(piecesByID.keys); let sessionIDs = Set(state.sessions.map(\.id))
        // §7 page tools: once a piece has its own page-edit rows (reorder/insert/delete), its
        // effective reading order can be longer or shorter than its source `pageCount`. `lastPage`/
        // bookmarks/score-link pages are display positions, so their bound is whichever of the two
        // counts is larger — identical to `pageCount` alone for the (overwhelmingly common) piece
        // with no page edits yet, so this never narrows what earlier data already validated as.
        let pageEditCounts = Dictionary(grouping: state.pageEdits.filter { $0.deletedAt == nil && !$0.deleted }, by: \.pieceID).mapValues(\.count)
        func effectivePageBound(_ piece: Piece) -> Int { max(1, piece.pageCount, pageEditCounts[piece.id] ?? 0) }
        for piece in state.pieces {
            try require(text(piece.title) && text(piece.composer, blank: true) && text(piece.notes, maximum: 100_000, blank: true) && date(piece.createdAt), "A piece contains invalid text or dates.")
            try require((0...10000).contains(piece.pageCount) && (1...effectivePageBound(piece)).contains(piece.lastPage), "A score contains an invalid page number.")
            try require(piece.fullTempoBPM.map { $0.isFinite && (20...300).contains($0) } != false, "The full-tempo target must be between 20 and 300 bpm.")
            try require(piece.practiceBalancePlan.isValid, "Choose minimum practice coverage from 0–100%, with separate-hand totals no greater than 100%.")
            try require(piece.defaultPracticeBPM.map { $0.isFinite && (20...300).contains($0) } != false, "The default practice tempo must be between 20 and 300 bpm.")
            try require(piece.scoreSections.count <= 1000 && unique(piece.scoreSections.map(\.id)), "The score has too many or duplicate sections.")
            let ordered = piece.scoreSections.sorted { $0.startPage < $1.startPage }
            for (index, section) in ordered.enumerated() {
                try require(text(section.title, maximum: 200) && section.startPage >= 1 && section.endPage >= section.startPage && section.endPage <= piece.pageCount,
                            "A movement has an invalid title or source page range.")
                if index > 0 { try require(ordered[index - 1].endPage < section.startPage, "Movement page ranges overlap. Choose separate source pages.") }
            }
            try require(piece.measureAnchors.count <= 10000 && unique(piece.measureAnchors.map(\.id)), "The score has too many or duplicate measure anchors.")
            for anchor in piece.measureAnchors {
                try require(anchor.page >= 1 && anchor.page <= piece.pageCount && anchor.region.isValid && anchor.startMeasure >= 1 && anchor.endMeasure >= anchor.startMeasure && anchor.endMeasure <= 100000,
                            "A measure anchor has an invalid page, region or measure range.")
            }
            try require(state.schemaVersion >= 5 || (piece.scoreSections.isEmpty && piece.measureAnchors.isEmpty && piece.defaultPracticeBPM == nil),
                        "This score metadata requires a newer library format.")
            if let name = piece.pdfFileName {
                try require(!name.isEmpty && name.count <= 255 && !name.contains("/") && !name.contains("\\") && !name.contains("..") && name.lowercased().hasSuffix(".pdf") && !name.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }), "A score filename is not a local PDF filename.")
            }
        }
        func validatePassage(_ passage: Passage) throws {
            let piece = piecesByID[passage.pieceID]
            try require(piece != nil && text(passage.title) && text(passage.focus) && (1...max(1, piece?.pageCount ?? 0)).contains(passage.page), "A passage has an invalid piece, title, or page.")
            switch (passage.startMeasure, passage.endMeasure) {
            case (nil, nil): break
            case (.some(let start), .some(let end)):
                try require((1...100000).contains(start) && end >= start && end <= 100000, "A passage has an invalid measure range.")
            default: throw PracticeError.invalid("Enter both measure numbers or leave both empty.")
            }
            try require(passage.regions.count <= 256 && unique(passage.regions.map(\.id)), "A passage contains too many marks or duplicate mark identifiers.")
            for region in passage.regions {
                try require(piece?.pdfFileName != nil && region.page >= 1 && region.page <= (piece?.pageCount ?? 0), "A passage mark references a missing score page.")
                try require([region.x, region.y, region.width, region.height].allSatisfy(\.isFinite)
                            && region.x >= 0 && region.y >= 0 && region.width > 0 && region.height > 0
                            && region.x + region.width <= 1 && region.y + region.height <= 1,
                            "A passage mark must fit within its score page.")
            }
        }
        for passage in state.passages { try validatePassage(passage) }
        try require(unique(state.passages.flatMap(\.regions).map(\.id)), "Saved passages contain duplicate mark identifiers.")
        // Schema3 stores ink per stroke (possibly several rows per page/layer), so unlike schema2's
        // one-drawing-per-page, duplicate (piece, page) is expected and not checked here.
        try require(state.inkStrokes.count <= 50000 && unique(state.inkStrokes.map(\.id)), "The library contains too many strokes or duplicate stroke identifiers.")
        var inkBytes = 0
        for stroke in state.inkStrokes {
            let piece = piecesByID[stroke.pieceID]
            try require(piece?.pdfFileName != nil && stroke.page >= 1 && stroke.page <= (piece?.pageCount ?? 0), "A stroke references a missing score page.")
            try require(!stroke.data.isEmpty && stroke.data.count <= maximumDrawingBytes && (stroke.fingerprint?.count ?? 0) <= 8192
                        && date(stroke.createdAt) && date(stroke.updatedAt) && stroke.deletedAt.map(date) != false,
                        "A stroke is empty, exceeds the supported 8 MB size, or has an invalid fingerprint or date.")
            inkBytes += stroke.data.count
            try require(inkBytes <= maximumTotalDrawingBytes, "The library has reached its supported 32 MB of ink. Export a backup before continuing.")
        }
        let sets = state.history + [state.activeSet].compactMap { $0 }
        let setsBySession = Dictionary(grouping: sets, by: \.sessionID)
        if state.schemaVersion == 1 {
            try require(state.inkStrokes.isEmpty && state.passages.allSatisfy { $0.regions.isEmpty && $0.startMeasure != nil && $0.endMeasure != nil }
                        && sets.allSatisfy { $0.configuration.passageSnapshot == nil }, "A legacy library contains unsupported markup fields.")
        }
        if state.schemaVersion < 3 {
            try require(state.instruments.isEmpty && state.tags.isEmpty && state.folders.isEmpty && state.setlists.isEmpty
                        && state.bookmarks.isEmpty && state.pageEdits.isEmpty && state.scoreLinks.isEmpty
                        && state.textAnnotations.isEmpty && state.stampAnnotations.isEmpty && state.coldGrades.isEmpty
                        && state.breakPointTaps.isEmpty && state.ruleEvents.isEmpty && state.warmupExercises.isEmpty
                        && state.recordings.isEmpty && state.rewardLedger.isEmpty && state.badges.isEmpty
                        && state.milestoneEvents.isEmpty && state.notebookEntries.isEmpty,
                        "A library declares an older format but contains newer fields.")
        }
        let unchangedPractice = trustedPrevious.map { previous in
            previous.schemaVersion == state.schemaVersion && previous.pieces == state.pieces &&
            previous.passages == state.passages && previous.history == state.history &&
            previous.activeSet == state.activeSet && previous.sessions == state.sessions
        } ?? false
        if !unchangedPractice {
            try require(unique(sets.map(\.id)) && unique(sets.flatMap(\.attempts).map(\.id)), "Practice events contain duplicate identifiers.")
            try require(state.history.allSatisfy { $0.status == .ended || $0.status == .completed }, "History contains an unfinished set.")
            try require(state.activeSet?.status != .ended, "An ended set cannot be active.")
            for set in sets {
                try require(state.schemaVersion >= 4 || set.configuration.tempoChanges.isEmpty,
                            "Durable tempo changes require the newer practice library format.")
                try PracticeEngine.validate(set.configuration)
                try require(pieceIDs.contains(set.configuration.pieceID) && sessionIDs.contains(set.sessionID), "A practice set references a missing piece or session.")
                if let passageID = set.configuration.passageID {
                    try require(passagesByID[passageID]?.pieceID == set.configuration.pieceID, "A practice set references a missing passage.")
                }
                if let snapshot = set.configuration.passageSnapshot {
                    try require(snapshot.pieceID == set.configuration.pieceID && (set.configuration.passageID == nil || snapshot.id == set.configuration.passageID), "A practice set contains an unrelated passage snapshot.")
                    try validatePassage(snapshot)
                }
                try require(date(set.startedAt) && set.endedAt.map(date) != false && set.lastCheckpoint.map(date) != false && set.activeSeconds.isFinite && (0...maximumFocusedSeconds).contains(set.activeSeconds), "A practice set contains invalid timing.")
                try require((set.status == .running) == (set.lastCheckpoint != nil), "A practice set has inconsistent pause state.")
                try require((set.status == .completed || set.status == .ended) == (set.endedAt != nil), "A practice set has inconsistent completion timing.")
                try require(set.attempts.count <= 100000 && unique(set.configuration.stages.map(\.id)), "A practice set contains too many attempts or duplicate variant identifiers.")
                try require(set.configuration.tempoChanges.allSatisfy { $0.afterAttemptCount <= set.attempts.count }, "A tempo change lies beyond the saved attempt log.")
                for attempt in set.attempts {
                    try require(date(attempt.date) && attempt.undoneAt.map(date) != false && attempt.bpm.isFinite && (20...300).contains(attempt.bpm) && (0...max(0, set.configuration.stages.count - 1)).contains(attempt.stageIndex), "A practice event has invalid timing, tempo, or variant attribution.")
                }
                let projection = PracticeEngine.project(set)
                try require(projection.currentBPM == set.currentBPM && projection.streak == set.streak && projection.totalPlays == set.totalPlays && projection.stageIndex == set.stageIndex && projection.completedStages == set.completedStages && (projection.status == .completed) == (set.status == .completed), "A practice set does not match its saved human verdicts.")
            }
            try require(state.sessions.filter { $0.endedAt == nil }.count <= 1, "The library contains multiple open sessions.")
            for session in state.sessions {
                try require(pieceIDs.contains(session.pieceID) && text(session.focus) && date(session.startedAt) && session.endedAt.map(date) != false && session.activeSeconds.isFinite && (0...maximumFocusedSeconds).contains(session.activeSeconds) && session.completedSets >= 0, "A session has invalid references or timing.")
                try require((setsBySession[session.id] ?? []).allSatisfy { $0.configuration.pieceID == session.pieceID }, "A session mixes practice attributed to different pieces.")
            }
            if let active = state.activeSet {
                try require(state.sessions.contains { $0.id == active.sessionID && $0.endedAt == nil }, "An active set belongs to a closed session.")
            }
            var projected = state; projectSessions(&projected)
            try require(projected.sessions == state.sessions, "Session totals do not match the saved practice ledger.")
        }
        for goal in state.goals {
            try require(text(goal.title) && (goal.deletedAt != nil || goal.pieceID == nil || pieceIDs.contains(goal.pieceID!)) && goal.dueDate.map(date) != false && date(goal.createdAt) && date(goal.updatedAt) && goal.deletedAt.map(date) != false, "A goal contains invalid text or references.")
        }
        for routine in state.routines {
            try require(date(routine.createdAt) && date(routine.updatedAt) && routine.deletedAt.map(date) != false && text(routine.name) && !routine.stages.isEmpty && routine.stages.count <= 24 && unique(routine.stages.map(\.id)) && routine.stages.allSatisfy { text($0.name, maximum: 100) && (1...100).contains($0.targetCount) }, "A routine contains invalid variants.")
        }
        try require(state.schemaVersion >= 5 || (state.preferences.updatedAt == .distantPast && state.preferences.showPassageBoxes && state.preferences.compactScoreControls && !state.preferences.autoTurnPassageAfterVerdict
                    && state.goals.allSatisfy { $0.deletedAt == nil } && state.routines.allSatisfy { $0.deletedAt == nil }),
                    "These preferences and deleted records require a newer library format.")
        try require((state.preferences.updatedAt == .distantPast || date(state.preferences.updatedAt)) && ["system", "light", "dark"].contains(state.preferences.theme), "The appearance preference is invalid.")

        // MARK: New in schema3 (§6-§15). Each collection gets unique ids and sane bounds; append-only
        // logs (coldGrades, breakPointTaps, ruleEvents, rewardLedger, badges, milestoneEvents) skip
        // referential re-checks beyond that, since nothing about an appended row can go stale.
        try require(unique(state.instruments.map(\.id)) && state.instruments.count <= 100, "The library contains duplicate or too many instruments.")
        for instrument in state.instruments {
            try require(text(instrument.name, maximum: 200) && text(instrument.level, maximum: 100, blank: true) && date(instrument.createdAt) && date(instrument.updatedAt) && instrument.deletedAt.map(date) != false, "An instrument contains invalid text or dates.")
        }
        let instrumentIDs = Set(state.instruments.map(\.id))
        for piece in state.pieces {
            try require(piece.instrumentID == nil || instrumentIDs.contains(piece.instrumentID!), "A piece references a missing instrument.")
            try require(piece.difficulty == nil || (1...5).contains(piece.difficulty!), "A piece has an invalid difficulty.")
            if let name = piece.customCoverRef {
                try require(!name.isEmpty && name.count <= 255 && !name.contains("/") && !name.contains("\\") && !name.contains("..")
                            && (name.lowercased().hasSuffix(".jpg") || name.lowercased().hasSuffix(".jpeg") || name.lowercased().hasSuffix(".png"))
                            && !name.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }), "A piece has an invalid custom cover filename.")
            }
            try require(piece.performanceDates.allSatisfy(date) && piece.performanceDates.count <= 100, "A piece has invalid performance dates.")
            try require(date(piece.updatedAt) && date(piece.lastPageUpdatedAt) && piece.deletedAt.map(date) != false, "A piece has invalid sync timing.")
        }
        try require(unique(state.tags.map(\.id)) && state.tags.count <= 1000, "The library contains duplicate or too many tags.")
        for tag in state.tags { try require(text(tag.name, maximum: 60) && date(tag.createdAt) && date(tag.updatedAt), "A tag contains invalid text or dates.") }
        try require(unique(state.folders.map(\.id)) && state.folders.count <= 1000, "The library contains duplicate or too many folders.")
        let folderIDs = Set(state.folders.map(\.id)); let tagIDs = Set(state.tags.map(\.id))
        for folder in state.folders {
            try require(text(folder.name, maximum: 100) && date(folder.createdAt) && date(folder.updatedAt), "A folder contains invalid text or dates.")
            try require(folder.parentFolderID == nil || (folderIDs.contains(folder.parentFolderID!) && folder.parentFolderID != folder.id), "A folder references a missing or circular parent.")
        }
        for piece in state.pieces {
            try require(piece.tagIDs.allSatisfy { tagIDs.contains($0) } && unique(piece.tagIDs), "A piece references a missing or duplicate tag.")
            try require(piece.folderIDs.allSatisfy { folderIDs.contains($0) } && unique(piece.folderIDs), "A piece references a missing or duplicate folder.")
        }
        try require(unique(state.setlists.map(\.id)) && state.setlists.count <= 500, "The library contains duplicate or too many setlists.")
        for setlist in state.setlists {
            try require(text(setlist.name, maximum: 200) && setlist.items.count <= 500 && unique(setlist.items.map(\.id)) && date(setlist.createdAt) && date(setlist.updatedAt), "A setlist contains invalid text, items, or dates.")
            for item in setlist.items {
                try require(pieceIDs.contains(item.pieceID), "A setlist references a missing piece.")
                try require((item.startPage ?? 1) >= 1 && (item.endPage ?? item.startPage ?? 1) >= (item.startPage ?? 1), "A setlist item has an invalid page range.")
            }
        }
        try require(unique(state.bookmarks.map(\.id)) && state.bookmarks.count <= 10000, "The library contains duplicate or too many bookmarks.")
        for bookmark in state.bookmarks {
            let piece = piecesByID[bookmark.pieceID]
            try require(piece != nil && bookmark.page >= 1 && bookmark.page <= (piece.map(effectivePageBound) ?? 0) && text(bookmark.label, maximum: 200), "A bookmark references a missing piece/page or has invalid text.")
        }
        try require(unique(state.pageEdits.map(\.id)) && state.pageEdits.count <= 20000, "The library contains duplicate or too many page edits.")
        for edit in state.pageEdits {
            let piece = piecesByID[edit.pieceID]
            try require(piece != nil, "A page edit references a missing piece.")
            try require(edit.sourcePage == nil || (edit.sourcePage! >= 1 && edit.sourcePage! <= max(1, piece?.pageCount ?? 0)), "A page edit references a missing source page.")
            try require(edit.displayOrder >= 1 && [0, 90, 180, 270].contains(edit.rotationDegrees) && (edit.cropRect?.isValid ?? true), "A page edit has an invalid order, rotation, or crop.")
        }
        try require(unique(state.scoreLinks.map(\.id)) && state.scoreLinks.count <= 20000, "The library contains duplicate or too many score links.")
        for link in state.scoreLinks {
            let piece = piecesByID[link.pieceID]
            let bound = piece.map(effectivePageBound) ?? 0
            try require(piece != nil && link.sourcePage >= 1 && link.sourcePage <= bound
                        && link.targetPage >= 1 && link.targetPage <= bound, "A score link references a missing piece or page.")
            try require((link.sourceRegion?.isValid ?? true) && (link.targetRegion?.isValid ?? true) && text(link.label, maximum: 100, blank: true), "A score link has an invalid region or label.")
        }
        try require(unique(state.textAnnotations.map(\.id)) && state.textAnnotations.count <= 20000, "The library contains duplicate or too many text annotations.")
        for annotation in state.textAnnotations {
            let piece = piecesByID[annotation.pieceID]
            try require(piece != nil && annotation.page >= 1 && annotation.page <= max(1, piece?.pageCount ?? 0) && annotation.region.isValid && text(annotation.text, maximum: 2000, blank: true), "A text annotation references a missing piece/page or has invalid text/region.")
            try require(annotation.style.isValid, "A note's text size must be between 12 and 48 points.")
        }
        try require(unique(state.stampAnnotations.map(\.id)) && state.stampAnnotations.count <= 50000, "The library contains duplicate or too many stamps.")
        for stamp in state.stampAnnotations {
            let piece = piecesByID[stamp.pieceID]
            try require(piece != nil && stamp.page >= 1 && stamp.page <= max(1, piece?.pageCount ?? 0) && stamp.position.isValid
                        && text(stamp.label ?? "", maximum: 20, blank: true), "A stamp references a missing piece/page or has an invalid position or label.")
        }
        let passageIDs = Set(state.passages.map(\.id))
        for passage in state.passages {
            try require(passage.parentPassageID == nil || (passageIDs.contains(passage.parentPassageID!) && passage.parentPassageID != passage.id), "A passage references a missing or circular parent passage.")
            try require(passage.joinedFromPassageIDs.allSatisfy { passageIDs.contains($0) && $0 != passage.id }, "A passage references a missing join source.")
            try require((passage.color?.count ?? 0) <= 40 && passage.schedule.intervalDays >= 0 && passage.schedule.reviewStep >= 0
                        && passage.parkedUntil.map(date) != false && (passage.performanceTempo.map { $0.isFinite && (20...300).contains($0) } ?? true)
                        && date(passage.createdAt) && date(passage.updatedAt) && passage.deletedAt.map(date) != false, "A passage has an invalid schedule, color, tempo, or sync field.")
        }
        try require(unique(state.coldGrades.map(\.id)) && state.coldGrades.count <= 200000, "The library contains duplicate or too many cold-grade records.")
        for grade in state.coldGrades {
            try require(passageIDs.contains(grade.passageID) && date(grade.date) && grade.tempo.isFinite && (20...300).contains(grade.tempo), "A cold-grade record references a missing passage or has an invalid tempo.")
        }
        try require(unique(state.breakPointTaps.map(\.id)) && state.breakPointTaps.count <= 200000, "The library contains duplicate or too many break-point taps.")
        for tap in state.breakPointTaps {
            try require(passageIDs.contains(tap.passageID) && date(tap.date) && (tap.location?.isValid ?? true), "A break-point tap references a missing passage or has an invalid location.")
        }
        try require(unique(state.ruleEvents.map(\.id)) && state.ruleEvents.count <= 200000, "The library contains duplicate or too many rule events.")
        for event in state.ruleEvents {
            try require((event.pieceID == nil || pieceIDs.contains(event.pieceID!)) && (event.passageID == nil || passageIDs.contains(event.passageID!))
                        && text(event.reasonText, maximum: 500) && date(event.firedAt), "A rule event references a missing piece/passage or has invalid text/timing.")
        }
        try require(date(state.ruleSettings.updatedAt), "The rule settings have an invalid sync date.")
        try require(unique(state.warmupExercises.map(\.id)) && state.warmupExercises.count <= 2000, "The library contains duplicate or too many warmup exercises.")
        for exercise in state.warmupExercises {
            try require(text(exercise.key, maximum: 20) && text(exercise.name, maximum: 200) && exercise.useCount >= 0 && exercise.useCount < Int.max
                        && (exercise.customFromPassageID == nil || passageIDs.contains(exercise.customFromPassageID!))
                        && exercise.lastUsedAt.map(date) != false && date(exercise.createdAt) && date(exercise.updatedAt) && exercise.deletedAt.map(date) != false,
                        "A warmup exercise has invalid text, references, or dates.")
        }
        try require(unique(state.recordings.map(\.id)) && state.recordings.count <= 20000, "The library contains duplicate or too many recordings.")
        var recordingBytes = 0
        for recording in state.recordings {
            try require((recording.passageID == nil || passageIDs.contains(recording.passageID!)) && !recording.fileName.isEmpty && recording.fileName.count <= 255
                        && !recording.fileName.contains("/") && !recording.fileName.contains("..")
                        && recording.duration.isFinite && recording.duration >= 0 && recording.duration <= 24 * 60 * 60
                        && recording.byteSize >= 0 && date(recording.date), "A recording references a missing passage or has an invalid file, duration, or date.")
            try require(recording.byteSize <= 2_000_000_000 - recordingBytes, "The library's recordings exceed the supported 2 GB total size.")
            recordingBytes += recording.byteSize
        }
        try require(unique(state.rewardLedger.map(\.id)) && state.rewardLedger.count <= 500000, "The library contains duplicate or too many reward entries.")
        var totalCoins = 0, totalXP = 0
        for entry in state.rewardLedger {
            // Honesty: coins/xp only ever move forward. Sloppy (or anything else) can never post a penalty here.
            try require(entry.coinsDelta >= 0 && entry.xpDelta >= 0 && date(entry.date) && text(entry.reason, maximum: 200), "A reward entry is negative or has invalid text/timing.")
            let coins = totalCoins.addingReportingOverflow(entry.coinsDelta)
            let xp = totalXP.addingReportingOverflow(entry.xpDelta)
            try require(!coins.overflow && !xp.overflow, "The reward ledger exceeds the supported totals.")
            totalCoins = coins.partialValue; totalXP = xp.partialValue
        }
        try require(unique(state.badges.map(\.id)) && state.badges.count <= 1000, "The library contains duplicate or too many badges.")
        for badge in state.badges { try require(text(badge.key, maximum: 100) && date(badge.earnedAt), "A badge has an invalid key or date.") }
        try require(unique(state.milestoneEvents.map(\.id)) && state.milestoneEvents.count <= 20000, "The library contains duplicate or too many milestone events.")
        for milestone in state.milestoneEvents { try require(text(milestone.kind, maximum: 100) && date(milestone.date) && text(milestone.detail, maximum: 500, blank: true), "A milestone event has invalid text or a date.") }
        try require(state.rewardsState.division >= 1 && state.rewardsState.streakDays >= 0 && state.rewardsState.streakDays < Int.max
                    && state.rewardsState.streakFreezesAvailable >= 0 && state.rewardsState.streakFreezesAvailable < Int.max
                    && state.rewardsState.lastPracticeDate.map(date) != false && date(state.rewardsState.updatedAt) && text(state.rewardsState.rank, maximum: 100),
                    "The rewards state has an invalid value.")
        try require(unique(state.notebookEntries.map(\.id)) && state.notebookEntries.count <= 20000, "The library contains duplicate or too many notebook entries.")
        for entry in state.notebookEntries {
            try require((entry.pieceID == nil || pieceIDs.contains(entry.pieceID!)) && text(entry.text, maximum: 20_000, blank: true) && date(entry.date)
                        && entry.passageIDs.allSatisfy { passageIDs.contains($0) } && date(entry.createdAt) && date(entry.updatedAt) && entry.deletedAt.map(date) != false,
                        "A notebook entry references a missing piece/passage or has invalid text/dates.")
        }
        try require(text(state.profile.displayName, maximum: 200, blank: true) && text(state.profile.username, maximum: 60, blank: true)
                    && text(state.profile.bio, maximum: 2000, blank: true) && date(state.profile.joinDate) && date(state.profile.updatedAt)
                    && state.profile.currentlyWorkingOnPieceIDs.allSatisfy { pieceIDs.contains($0) },
                    "The profile has invalid text, references, or dates.")
    }
}
