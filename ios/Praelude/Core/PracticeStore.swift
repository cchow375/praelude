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
                // Never credit time while the app was absent. Persist this pause before exposing it.
                if restored.activeSet?.status == .running {
                    restored.activeSet?.status = .paused; restored.activeSet?.lastCheckpoint = nil
                    restored.revision += 1
                    try writeData(Self.encoder().encode(restored), fileURL)
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
    public func updatePiece(_ piece: Piece) throws {
        try transaction { next in
            guard let index = next.pieces.firstIndex(where: { $0.id == piece.id }) else { throw PracticeError.invalid("This piece is no longer in your library.") }
            next.pieces[index] = piece
        }
    }
    public func setPieceStatus(_ id: UUID, status: PieceStatus) throws {
        try transaction { next in
            guard let index = next.pieces.firstIndex(where: { $0.id == id }) else { throw PracticeError.invalid("Piece not found.") }
            next.pieces[index].status = status
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
        }
    }
    public func updateLastPage(pieceID: UUID, page: Int) throws {
        try transaction { next in
            guard let index = next.pieces.firstIndex(where: { $0.id == pieceID }) else { throw PracticeError.invalid("Piece not found.") }
            next.pieces[index].lastPage = page
        }
    }
    public func savePassage(_ passage: Passage) throws {
        try transaction { next in
            if let index = next.passages.firstIndex(where: { $0.id == passage.id }) { next.passages[index] = passage }
            else { next.passages.append(passage) }
        }
    }
    public func deletePassage(_ id: UUID) throws {
        try transaction { next in
            guard next.activeSet?.configuration.passageID != id else { throw PracticeError.conflict("End the current set before removing its passage.") }
            // Historic configurations retain their measure-independent focus snapshot; unlink only the optional navigation reference.
            next.passages.removeAll { $0.id == id }
            for index in next.history.indices where next.history[index].configuration.passageID == id { next.history[index].configuration.passageID = nil }
        }
    }

    public func startSet(_ configuration: PracticeConfiguration) throws {
        let date = now()
        try transaction { next in
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
    public func backupData() throws -> Data {
        guard !isReadOnly else { throw PracticeError.unavailable("The saved library could not be read. Export is unavailable so an empty snapshot cannot replace your backup.") }
        return try Self.encoder().encode(state)
    }
    public static func decodeBackup(_ data: Data) throws -> LibraryState {
        guard data.count <= 64 * 1024 * 1024 else { throw PracticeError.invalid("The practice library exceeds the supported 64 MB size.") }
        let state = try decoder().decode(LibraryState.self, from: data); try validate(state); return state
    }
    public func restoreBackup(_ restored: LibraryState) throws {
        guard state.activeSet == nil else { throw PracticeError.conflict("End your current set before restoring a backup.") }
        guard restored.activeSet?.status != .running else { throw PracticeError.invalid("This backup contains a running set. Pause it on the source device before exporting.") }
        try Self.validate(restored)
        if isReadOnly { try recoverUnreadableLibrary(with: restored); return }
        try transaction { next in next = restored }
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
            let original = try fileURL.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
            guard original.isRegularFile == true, original.isSymbolicLink != true else {
                throw PracticeError.unavailable("The original library could not be preserved as a regular file. Restore has not replaced it.")
            }
            let preserved = directory.appendingPathComponent("library-preserved-\(UUID().uuidString).json")
            try preserveFile(fileURL, preserved)
            guard FileManager.default.contentsEqual(atPath: fileURL.path, andPath: preserved.path) else {
                throw PracticeError.unavailable("The preserved library could not be verified. Restore has not replaced the original.")
            }
            preservedOriginalURL = preserved
            try writeData(data, fileURL)
            state = next
            isReadOnly = false
            errorMessage = nil
        } catch {
            errorMessage = "Restore could not safely replace the unreadable library. The original is preserved. \(error.localizedDescription)"
            throw error
        }
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
        try require(state.schemaVersion == 1 && state.revision >= 0, "This practice library uses an unsupported format.")
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
        for passage in state.passages {
            let pageCount = state.pieces.first { $0.id == passage.pieceID }?.pageCount ?? 0
            try require(pieceIDs.contains(passage.pieceID) && text(passage.title) && text(passage.focus) && (1...100000).contains(passage.startMeasure) && (passage.startMeasure...100000).contains(passage.endMeasure) && (1...max(1, pageCount)).contains(passage.page), "A passage has an invalid piece, measure range, or page.")
        }
        let sets = state.history + [state.activeSet].compactMap { $0 }
        try require(unique(sets.map(\.id)) && unique(sets.flatMap(\.attempts).map(\.id)), "Practice events contain duplicate identifiers.")
        try require(state.history.allSatisfy { $0.status == .ended || $0.status == .completed }, "History contains an unfinished set.")
        try require(state.activeSet?.status != .ended, "An ended set cannot be active.")
        for set in sets {
            try PracticeEngine.validate(set.configuration)
            try require(pieceIDs.contains(set.configuration.pieceID) && sessionIDs.contains(set.sessionID), "A practice set references a missing piece or session.")
            if let passageID = set.configuration.passageID {
                try require(state.passages.contains { $0.id == passageID && $0.pieceID == set.configuration.pieceID }, "A practice set references a missing passage.")
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
    }
}
