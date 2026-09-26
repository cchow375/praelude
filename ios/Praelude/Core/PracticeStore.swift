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
    public var pieces: [Piece] { state.pieces }
    public var sessions: [PracticeSession] { state.sessions }
    public var activeSet: ActiveSet? { state.activeSet }
    public var preferences: Preferences { state.preferences }
    public static let maximumDrawingBytes = 8 * 1024 * 1024
    public static let maximumTotalDrawingBytes = 32 * 1024 * 1024

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
                let needsMigration = restored.schemaVersion < 3
                if needsMigration {
                    // Preserve the exact pre-migration bytes before schema3 is ever written, whether
                    // the source was schema1 or schema2 (hard rule: never lose user data).
                    preservedOriginalURL = try preserveOriginal(prefix: "library-schema\(restored.schemaVersion)")
                    restored = SchemaMigration.migrateToSchema3(restored, at: now())
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

    public func addPiece(_ piece: Piece) throws {
        try transaction { next in
            guard !next.pieces.contains(where: { $0.id == piece.id }) else { throw PracticeError.conflict("This piece is already in your library.") }
            next.pieces.append(piece)
        }
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
        try transaction { next in
            guard next.activeSet?.configuration.pieceID != id else { throw PracticeError.conflict("End this piece’s practice set before removing it.") }
            guard !next.history.contains(where: { $0.configuration.pieceID == id }), !next.sessions.contains(where: { $0.pieceID == id }) else {
                throw PracticeError.conflict("This piece has practice history. Move it to Resting to preserve your record.")
            }
            next.pieces.removeAll { $0.id == id }; next.passages.removeAll { $0.pieceID == id }
            next.goals.removeAll { $0.pieceID == id }
            next.inkStrokes.removeAll { $0.pieceID == id }
        }
    }
    public func updateLastPage(pieceID: UUID, page: Int) throws {
        let date = now()
        try transaction { next in
            guard let index = next.pieces.firstIndex(where: { $0.id == pieceID }) else { throw PracticeError.invalid("Piece not found.") }
            next.pieces[index].lastPage = page; next.pieces[index].lastPageUpdatedAt = date
        }
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
    /// Replaces one page/layer's ink with exactly the given strokes (§4d/§7). Diffs by content
    /// against the rows already stored for that page/layer: a blob that already exists keeps its
    /// id/createdAt (so an untouched stroke never looks "updated" to a future sync engine), a blob
    /// no longer present is tombstoned, and a new blob becomes a new row — so replicas can merge
    /// annotations by stroke instead of by whole page. Native callers validate PencilKit encoding
    /// before calling this Foundation-only boundary.
    public func replaceInk(pieceID: UUID, page: Int, layer: InkLayer, strokes: [Data]) throws {
        let date = now()
        try transaction { next in
            guard let piece = next.pieces.first(where: { $0.id == pieceID }), piece.pdfFileName != nil,
                  page >= 1, page <= piece.pageCount else { throw PracticeError.invalid("Choose an existing score page before saving ink.") }
            for stroke in strokes {
                guard !stroke.isEmpty, stroke.count <= Self.maximumDrawingBytes else {
                    throw PracticeError.invalid("This page has reached the supported 8 MB of ink.")
                }
            }
            // Ordinal = position in the caller's own array, before any filtering below, so splitting
            // the same drawing the same way on two devices assigns the same ordinal — and therefore
            // the same stable id (see `InkStroke.stableID`) — to the same stroke on both.
            var remainingNew: [(ordinal: Int, data: Data)] = Array(strokes.enumerated())
            for index in next.inkStrokes.indices
            where next.inkStrokes[index].pieceID == pieceID && next.inkStrokes[index].page == page
                && next.inkStrokes[index].layer == layer && next.inkStrokes[index].deletedAt == nil {
                if let match = remainingNew.firstIndex(where: { $0.data == next.inkStrokes[index].data }) {
                    remainingNew.remove(at: match)
                } else {
                    next.inkStrokes[index].deletedAt = date; next.inkStrokes[index].updatedAt = date
                }
            }
            for (ordinal, data) in remainingNew {
                let id = InkStroke.stableID(pieceID: pieceID, page: page, layer: layer, data: data, ordinal: ordinal)
                next.inkStrokes.append(InkStroke(id: id, pieceID: pieceID, page: page, layer: layer, data: data, createdAt: date, updatedAt: date))
            }
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

    public func startSet(_ configuration: PracticeConfiguration) throws {
        let date = now()
        try transaction { next in
            var configuration = configuration
            configuration.passageSnapshot = configuration.passageID.flatMap { id in next.passages.first { $0.id == id && $0.pieceID == configuration.pieceID } }
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
    }

    /// Returns false for an already committed event. Callers must reward only true results.
    @discardableResult public func record(_ verdict: Verdict, eventID: UUID = UUID()) throws -> Bool {
        let existing = (state.history + [state.activeSet].compactMap { $0 }).flatMap(\.attempts).first { $0.id == eventID }
        if let existing {
            guard existing.verdict == verdict else { throw PracticeError.conflict("This event identifier was already used for a different verdict.") }
            return false
        }
        let date = now()
        try transaction { next in
            guard var set = next.activeSet, set.status == .running else { throw PracticeError.conflict("Resume a practice set before recording a repetition.") }
            Self.accrue(&set, at: date)
            set.attempts.append(Attempt(id: eventID, verdict: verdict, date: date, bpm: set.currentBPM, stageIndex: set.stageIndex))
            set = PracticeEngine.project(set)
            if set.status == .completed { set.endedAt = date; set.lastCheckpoint = nil }
            next.activeSet = set
        }
        return true
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
    public func checkpoint() throws {
        guard state.activeSet?.status == .running else { return }
        let date = now()
        try transaction { next in
            if var set = next.activeSet { Self.accrue(&set, at: date); next.activeSet = set }
        }
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
        try transaction { next in
            if let index = next.goals.firstIndex(where: { $0.id == goal.id }) { next.goals[index] = goal }
            else { next.goals.append(goal) }
        }
    }
    public func deleteGoal(_ id: UUID) throws { try transaction { $0.goals.removeAll { $0.id == id } } }
    public func saveRoutine(_ routine: PracticeRoutine) throws {
        try transaction { next in
            if let index = next.routines.firstIndex(where: { $0.id == routine.id }) { next.routines[index] = routine }
            else { next.routines.append(routine) }
        }
    }
    public func deleteRoutine(_ id: UUID) throws { try transaction { $0.routines.removeAll { $0.id == id } } }
    public func updatePreferences(_ preferences: Preferences) throws { try transaction { $0.preferences = preferences } }

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

    // MARK: - §12 Warmups
    public func saveWarmupExercise(_ exercise: WarmupExercise) throws {
        let date = now()
        try transaction { next in
            var exercise = exercise; exercise.updatedAt = date
            if let index = next.warmupExercises.firstIndex(where: { $0.id == exercise.id }) { next.warmupExercises[index] = exercise } else { next.warmupExercises.append(exercise) }
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
    public func appendRewardLedgerEntry(_ entry: RewardLedgerEntry) throws { try transaction { $0.rewardLedger.append(entry) } }
    public func awardBadge(_ badge: Badge) throws { try transaction { $0.badges.append(badge) } }
    public func recordMilestone(_ event: MilestoneEvent) throws { try transaction { $0.milestoneEvents.append(event) } }
    public func updateRewardsState(_ rewardsState: RewardsState) throws {
        let date = now()
        try transaction { next in var rewardsState = rewardsState; rewardsState.updatedAt = date; next.rewardsState = rewardsState }
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
        return SchemaMigration.migrateToSchema3(state, at: Date())
    }
    public func restoreBackup(_ restored: LibraryState) throws {
        guard state.activeSet == nil else { throw PracticeError.conflict("End your current set before restoring a backup.") }
        guard restored.activeSet?.status != .running else { throw PracticeError.invalid("This backup contains a running set. Pause it on the source device before exporting.") }
        try Self.validate(restored)
        let migrated = SchemaMigration.migrateToSchema3(restored, at: now())
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
            Self.projectSessions(&next)
            next.revision = state.revision + 1
            try Self.validate(next)
            let data = try Self.encoder().encode(next)
            guard data.count <= 64 * 1024 * 1024 else { throw PracticeError.invalid("The practice library has reached its supported 64 MB size. Export a backup before continuing.") }
            try writeData(data, fileURL)
            state = next; errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
            throw error
        }
    }
    private static func accrue(_ set: inout ActiveSet, at date: Date) {
        guard set.status == .running, let last = set.lastCheckpoint else { return }
        // Bounded crash/suspension credit; foreground UI checkpoints every 15 seconds.
        set.activeSeconds += min(60, max(0, date.timeIntervalSince(last)))
        set.lastCheckpoint = date
    }
    private static func projectSessions(_ state: inout LibraryState) {
        let sets = state.history + [state.activeSet].compactMap { $0 }
        for index in state.sessions.indices {
            let own = sets.filter { $0.sessionID == state.sessions[index].id }
            state.sessions[index].activeSeconds = own.reduce(0) { $0 + $1.activeSeconds }
            state.sessions[index].attempts = own.flatMap(\.attempts).filter(\.isEffective).sorted { $0.date < $1.date }
            state.sessions[index].completedSets = own.filter { $0.status == .completed }.count
        }
    }
    private static func encoder() -> JSONEncoder {
        // Foundation's native reference-date encoding preserves Date's exact Double value.
        // Millisecond conversion introduced rounding drift in snapshot round-trip tests.
        let encoder = JSONEncoder(); encoder.dateEncodingStrategy = .deferredToDate
        encoder.outputFormatting = [.sortedKeys]; return encoder
    }
    private static func decoder() -> JSONDecoder { let decoder = JSONDecoder(); decoder.dateDecodingStrategy = .deferredToDate; return decoder }

    public static func validate(_ state: LibraryState) throws {
        func require(_ condition: Bool, _ message: String) throws { if !condition { throw PracticeError.invalid(message) } }
        func unique<T: Hashable>(_ values: [T]) -> Bool { Set(values).count == values.count }
        func text(_ value: String, maximum: Int = 500, blank: Bool = false) -> Bool {
            value.count <= maximum && (blank || !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
        // Bounds also keep calendar formatting and duration-to-Int conversions safe for imported data.
        func date(_ value: Date) -> Bool { value.timeIntervalSince1970.isFinite && (0...4_102_444_800).contains(value.timeIntervalSince1970) }
        let maximumFocusedSeconds: Double = 100 * 366 * 24 * 60 * 60
        try require((1...3).contains(state.schemaVersion) && state.revision >= 0, "This practice library uses an unsupported format.")
        try require(state.revision < Int.max - 1 && state.pieces.count <= 10000 && state.passages.count <= 100000 && state.history.count <= 100000 && state.sessions.count <= 100000 && state.goals.count <= 10000 && state.routines.count <= 10000, "The library contains more records than this version supports.")
        try require(unique(state.pieces.map(\.id)) && unique(state.passages.map(\.id)) && unique(state.sessions.map(\.id)) && unique(state.goals.map(\.id)) && unique(state.routines.map(\.id)), "The library contains duplicate record identifiers.")
        let pieceIDs = Set(state.pieces.map(\.id)); let sessionIDs = Set(state.sessions.map(\.id))
        for piece in state.pieces {
            try require(text(piece.title) && text(piece.composer, blank: true) && text(piece.notes, maximum: 100_000, blank: true) && date(piece.createdAt), "A piece contains invalid text or dates.")
            try require((0...10000).contains(piece.pageCount) && (1...max(1, piece.pageCount)).contains(piece.lastPage), "A score contains an invalid page number.")
            if let name = piece.pdfFileName {
                try require(!name.isEmpty && name.count <= 255 && !name.contains("/") && !name.contains("\\") && !name.contains("..") && name.lowercased().hasSuffix(".pdf") && !name.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }), "A score filename is not a local PDF filename.")
            }
        }
        func validatePassage(_ passage: Passage) throws {
            let piece = state.pieces.first { $0.id == passage.pieceID }
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
            let piece = state.pieces.first { $0.id == stroke.pieceID }
            try require(piece?.pdfFileName != nil && stroke.page >= 1 && stroke.page <= (piece?.pageCount ?? 0), "A stroke references a missing score page.")
            try require(!stroke.data.isEmpty && stroke.data.count <= maximumDrawingBytes && date(stroke.createdAt) && date(stroke.updatedAt) && stroke.deletedAt.map(date) != false,
                        "A stroke is empty, exceeds the supported 8 MB size, or has an invalid date.")
            inkBytes += stroke.data.count
            try require(inkBytes <= maximumTotalDrawingBytes, "The library has reached its supported 32 MB of ink. Export a backup before continuing.")
        }
        let sets = state.history + [state.activeSet].compactMap { $0 }
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
        try require(unique(sets.map(\.id)) && unique(sets.flatMap(\.attempts).map(\.id)), "Practice events contain duplicate identifiers.")
        try require(state.history.allSatisfy { $0.status == .ended || $0.status == .completed }, "History contains an unfinished set.")
        try require(state.activeSet?.status != .ended, "An ended set cannot be active.")
        for set in sets {
            try PracticeEngine.validate(set.configuration)
            try require(pieceIDs.contains(set.configuration.pieceID) && sessionIDs.contains(set.sessionID), "A practice set references a missing piece or session.")
            if let passageID = set.configuration.passageID {
                try require(state.passages.contains { $0.id == passageID && $0.pieceID == set.configuration.pieceID }, "A practice set references a missing passage.")
            }
            if let snapshot = set.configuration.passageSnapshot {
                try require(snapshot.pieceID == set.configuration.pieceID && (set.configuration.passageID == nil || snapshot.id == set.configuration.passageID), "A practice set contains an unrelated passage snapshot.")
                try validatePassage(snapshot)
            }
            try require(date(set.startedAt) && set.endedAt.map(date) != false && set.lastCheckpoint.map(date) != false && set.activeSeconds.isFinite && (0...maximumFocusedSeconds).contains(set.activeSeconds), "A practice set contains invalid timing.")
            try require((set.status == .running) == (set.lastCheckpoint != nil), "A practice set has inconsistent pause state.")
            try require((set.status == .completed || set.status == .ended) == (set.endedAt != nil), "A practice set has inconsistent completion timing.")
            try require(set.attempts.count <= 100000 && unique(set.configuration.stages.map(\.id)), "A practice set contains too many attempts or duplicate variant identifiers.")
            for attempt in set.attempts {
                try require(date(attempt.date) && attempt.undoneAt.map(date) != false && attempt.bpm.isFinite && (20...300).contains(attempt.bpm) && (0...max(0, set.configuration.stages.count - 1)).contains(attempt.stageIndex), "A practice event has invalid timing, tempo, or variant attribution.")
            }
            let projection = PracticeEngine.project(set)
            try require(projection.currentBPM == set.currentBPM && projection.streak == set.streak && projection.totalPlays == set.totalPlays && projection.stageIndex == set.stageIndex && projection.completedStages == set.completedStages && (projection.status == .completed) == (set.status == .completed), "A practice set does not match its saved human verdicts.")
        }
        try require(state.sessions.filter { $0.endedAt == nil }.count <= 1, "The library contains multiple open sessions.")
        for session in state.sessions {
            try require(pieceIDs.contains(session.pieceID) && text(session.focus) && date(session.startedAt) && session.endedAt.map(date) != false && session.activeSeconds.isFinite && (0...maximumFocusedSeconds).contains(session.activeSeconds) && session.completedSets >= 0, "A session has invalid references or timing.")
            try require(sets.filter { $0.sessionID == session.id }.allSatisfy { $0.configuration.pieceID == session.pieceID }, "A session mixes practice attributed to different pieces.")
        }
        if let active = state.activeSet {
            try require(state.sessions.contains { $0.id == active.sessionID && $0.endedAt == nil }, "An active set belongs to a closed session.")
        }
        var projected = state; projectSessions(&projected)
        try require(projected.sessions == state.sessions, "Session totals do not match the saved practice ledger.")
        for goal in state.goals {
            try require(text(goal.title) && (goal.pieceID == nil || pieceIDs.contains(goal.pieceID!)) && goal.dueDate.map(date) != false, "A goal contains invalid text or references.")
        }
        for routine in state.routines {
            try require(text(routine.name) && !routine.stages.isEmpty && routine.stages.count <= 24 && unique(routine.stages.map(\.id)) && routine.stages.allSatisfy { text($0.name, maximum: 100) && (1...100).contains($0.targetCount) }, "A routine contains invalid variants.")
        }
        try require(["system", "light", "dark"].contains(state.preferences.theme), "The appearance preference is invalid.")

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
            let piece = state.pieces.first { $0.id == bookmark.pieceID }
            try require(piece != nil && bookmark.page >= 1 && bookmark.page <= max(1, piece?.pageCount ?? 0) && text(bookmark.label, maximum: 200), "A bookmark references a missing piece/page or has invalid text.")
        }
        try require(unique(state.pageEdits.map(\.id)) && state.pageEdits.count <= 20000, "The library contains duplicate or too many page edits.")
        for edit in state.pageEdits {
            let piece = state.pieces.first { $0.id == edit.pieceID }
            try require(piece != nil, "A page edit references a missing piece.")
            try require(edit.sourcePage == nil || (edit.sourcePage! >= 1 && edit.sourcePage! <= max(1, piece?.pageCount ?? 0)), "A page edit references a missing source page.")
            try require(edit.displayOrder >= 1 && [0, 90, 180, 270].contains(edit.rotationDegrees) && (edit.cropRect?.isValid ?? true), "A page edit has an invalid order, rotation, or crop.")
        }
        try require(unique(state.scoreLinks.map(\.id)) && state.scoreLinks.count <= 20000, "The library contains duplicate or too many score links.")
        for link in state.scoreLinks {
            let piece = state.pieces.first { $0.id == link.pieceID }
            try require(piece != nil && link.sourcePage >= 1 && link.sourcePage <= max(1, piece?.pageCount ?? 0)
                        && link.targetPage >= 1 && link.targetPage <= max(1, piece?.pageCount ?? 0), "A score link references a missing piece or page.")
            try require((link.sourceRegion?.isValid ?? true) && (link.targetRegion?.isValid ?? true) && text(link.label, maximum: 100, blank: true), "A score link has an invalid region or label.")
        }
        try require(unique(state.textAnnotations.map(\.id)) && state.textAnnotations.count <= 20000, "The library contains duplicate or too many text annotations.")
        for annotation in state.textAnnotations {
            let piece = state.pieces.first { $0.id == annotation.pieceID }
            try require(piece != nil && annotation.page >= 1 && annotation.page <= max(1, piece?.pageCount ?? 0) && annotation.region.isValid && text(annotation.text, maximum: 2000, blank: true), "A text annotation references a missing piece/page or has invalid text/region.")
        }
        try require(unique(state.stampAnnotations.map(\.id)) && state.stampAnnotations.count <= 50000, "The library contains duplicate or too many stamps.")
        for stamp in state.stampAnnotations {
            let piece = state.pieces.first { $0.id == stamp.pieceID }
            try require(piece != nil && stamp.page >= 1 && stamp.page <= max(1, piece?.pageCount ?? 0) && stamp.position.isValid, "A stamp references a missing piece/page or has an invalid position.")
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
            try require(text(exercise.key, maximum: 20) && text(exercise.name, maximum: 200) && exercise.useCount >= 0
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
            recordingBytes += max(0, recording.byteSize)
            try require(recordingBytes <= 2_000_000_000, "The library's recordings exceed the supported 2 GB total size.")
        }
        try require(unique(state.rewardLedger.map(\.id)) && state.rewardLedger.count <= 500000, "The library contains duplicate or too many reward entries.")
        for entry in state.rewardLedger {
            // Honesty: coins/xp only ever move forward. Sloppy (or anything else) can never post a penalty here.
            try require(entry.coinsDelta >= 0 && entry.xpDelta >= 0 && date(entry.date) && text(entry.reason, maximum: 200), "A reward entry is negative or has invalid text/timing.")
        }
        try require(unique(state.badges.map(\.id)) && state.badges.count <= 1000, "The library contains duplicate or too many badges.")
        for badge in state.badges { try require(text(badge.key, maximum: 100) && date(badge.earnedAt), "A badge has an invalid key or date.") }
        try require(unique(state.milestoneEvents.map(\.id)) && state.milestoneEvents.count <= 20000, "The library contains duplicate or too many milestone events.")
        for milestone in state.milestoneEvents { try require(text(milestone.kind, maximum: 100) && date(milestone.date) && text(milestone.detail, maximum: 500, blank: true), "A milestone event has invalid text or a date.") }
        try require(state.rewardsState.division >= 1 && state.rewardsState.streakDays >= 0 && state.rewardsState.streakFreezesAvailable >= 0
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
