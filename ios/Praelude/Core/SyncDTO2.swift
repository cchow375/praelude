import Foundation

// MARK: - Wire-format row DTOs, part 2 (§4d gap closure)
//
// `SyncDTO.swift` wired the first seven tables (instruments, pieces, passages, ink_strokes,
// rule_settings, rewards_state, profiles). This file follows its exact convention — every stored
// property spelled as its SQL column, `init(_:)`/`coreValue` the only place a Core <-> column
// translation happens, every non-append-only DTO carrying every column the table has except
// `id`/`owner_id` (see that file's header for why `sync_upsert` needs the whole row every time) —
// for the remaining tables registered in `public.sync_tables`/`public.append_only_tables` that
// `supabase/(C) Sync Protocol.md` §5 documents but no DTO existed for yet.
//
// Practice goals/routines use explicit clocks and tombstones, like the other editable library
// records. Legacy local metadata is backfilled during schema migration before its first push.

// MARK: Library organization (`tags`, `folders`, `setlists`, `bookmarks`, `page_edits`,
// `score_links`, `annotations` — spec §7)

public struct TagSyncRow: Codable, Equatable, Sendable {
    public var id: UUID
    public var name: String
    public var created_at: Date
    public var updated_at: Date
    public var deleted_at: Date?
    public init(_ tag: Tag) {
        id = tag.id; name = tag.name; created_at = tag.createdAt; updated_at = tag.updatedAt; deleted_at = tag.deletedAt
    }
    public var coreValue: Tag { Tag(id: id, name: name, createdAt: created_at, updatedAt: updated_at, deletedAt: deleted_at) }
}

public struct FolderSyncRow: Codable, Equatable, Sendable {
    public var id: UUID
    public var name: String
    public var parent_folder_id: UUID?
    public var created_at: Date
    public var updated_at: Date
    public var deleted_at: Date?
    public init(_ folder: Folder) {
        id = folder.id; name = folder.name; parent_folder_id = folder.parentFolderID
        created_at = folder.createdAt; updated_at = folder.updatedAt; deleted_at = folder.deletedAt
    }
    public var coreValue: Folder {
        Folder(id: id, name: name, parentFolderID: parent_folder_id, createdAt: created_at, updatedAt: updated_at, deletedAt: deleted_at)
    }
}

public struct SetlistSyncRow: Codable, Equatable, Sendable {
    public var id: UUID
    public var name: String
    public var items: [SetlistItem]
    public var created_at: Date
    public var updated_at: Date
    public var deleted_at: Date?
    public init(_ setlist: Setlist) {
        id = setlist.id; name = setlist.name; items = setlist.items
        created_at = setlist.createdAt; updated_at = setlist.updatedAt; deleted_at = setlist.deletedAt
    }
    public var coreValue: Setlist {
        Setlist(id: id, name: name, items: items, createdAt: created_at, updatedAt: updated_at, deletedAt: deleted_at)
    }
}

public struct BookmarkSyncRow: Codable, Equatable, Sendable {
    public var id: UUID
    public var piece_id: UUID
    public var page: Int
    public var label: String
    public var created_at: Date
    public var updated_at: Date
    public var deleted_at: Date?
    public init(_ bookmark: Bookmark) {
        id = bookmark.id; piece_id = bookmark.pieceID; page = bookmark.page; label = bookmark.label
        created_at = bookmark.createdAt; updated_at = bookmark.updatedAt; deleted_at = bookmark.deletedAt
    }
    public var coreValue: Bookmark {
        Bookmark(id: id, pieceID: piece_id, page: page, label: label, createdAt: created_at, updatedAt: updated_at, deletedAt: deleted_at)
    }
}

public struct PageEditSyncRow: Codable, Equatable, Sendable {
    public var id: UUID
    public var piece_id: UUID
    public var source_page: Int?
    public var display_order: Int
    public var kind: String
    public var crop_rect: NormalizedRect?
    public var rotation_degrees: Int
    public var deleted: Bool
    public var created_at: Date
    public var updated_at: Date
    public var deleted_at: Date?
    public init(_ edit: PageEdit) {
        id = edit.id; piece_id = edit.pieceID; source_page = edit.sourcePage; display_order = edit.displayOrder
        kind = edit.kind.rawValue; crop_rect = edit.cropRect; rotation_degrees = edit.rotationDegrees; deleted = edit.deleted
        created_at = edit.createdAt; updated_at = edit.updatedAt; deleted_at = edit.deletedAt
    }
    public var coreValue: PageEdit? {
        guard let kind = PageKind(rawValue: kind) else { return nil }
        return PageEdit(id: id, pieceID: piece_id, sourcePage: source_page, displayOrder: display_order, kind: kind,
                         cropRect: crop_rect, rotationDegrees: rotation_degrees, deleted: deleted,
                         createdAt: created_at, updatedAt: updated_at, deletedAt: deleted_at)
    }
}

public struct ScoreLinkSyncRow: Codable, Equatable, Sendable {
    public var id: UUID
    public var piece_id: UUID
    public var source_page: Int
    public var source_region: NormalizedRect?
    public var target_page: Int
    public var target_region: NormalizedRect?
    public var label: String
    public var created_at: Date
    public var updated_at: Date
    public var deleted_at: Date?
    public init(_ link: ScoreLink) {
        id = link.id; piece_id = link.pieceID; source_page = link.sourcePage; source_region = link.sourceRegion
        target_page = link.targetPage; target_region = link.targetRegion; label = link.label
        created_at = link.createdAt; updated_at = link.updatedAt; deleted_at = link.deletedAt
    }
    public var coreValue: ScoreLink {
        ScoreLink(id: id, pieceID: piece_id, sourcePage: source_page, sourceRegion: source_region,
                  targetPage: target_page, targetRegion: target_region, label: label,
                  createdAt: created_at, updatedAt: updated_at, deletedAt: deleted_at)
    }
}

/// Unifies `TextBoxAnnotation`/`StampAnnotation` (two Core types) onto the one `annotations` table
/// (`kind` discriminator, matching `annotations_kind_shape`'s check constraint) — construct from
/// either Core type via the matching initializer, read back via whichever of `textValue`/`stampValue`
/// applies to this row's `kind` (the other is always `nil`, exactly mirroring the SQL check).
public struct AnnotationSyncRow: Codable, Equatable, Sendable {
    public var id: UUID
    public var piece_id: UUID
    public var page: Int
    public var region: NormalizedRect
    public var layer: String
    public var kind: String
    public var text: String?
    public var stamp_kind: String?
    public var stamp_label: String?
    public var created_at: Date
    public var updated_at: Date
    public var deleted_at: Date?

    public init(_ annotation: TextBoxAnnotation) {
        id = annotation.id; piece_id = annotation.pieceID; page = annotation.page; region = annotation.region
        layer = annotation.layer.rawValue; kind = "text"; text = annotation.text; stamp_kind = nil; stamp_label = nil
        created_at = annotation.createdAt; updated_at = annotation.updatedAt; deleted_at = annotation.deletedAt
    }
    public init(_ stamp: StampAnnotation) {
        id = stamp.id; piece_id = stamp.pieceID; page = stamp.page; region = stamp.position
        layer = stamp.layer.rawValue; kind = "stamp"; text = nil; stamp_kind = stamp.kind.rawValue; stamp_label = stamp.label
        created_at = stamp.createdAt; updated_at = stamp.updatedAt; deleted_at = stamp.deletedAt
    }
    public var textValue: TextBoxAnnotation? {
        guard kind == "text", let text, let layer = InkLayer(rawValue: layer) else { return nil }
        return TextBoxAnnotation(id: id, pieceID: piece_id, page: page, region: region, text: text, layer: layer,
                                  createdAt: created_at, updatedAt: updated_at, deletedAt: deleted_at)
    }
    public var stampValue: StampAnnotation? {
        guard kind == "stamp", let rawStampKind = stamp_kind, let stampKind = StampKind(rawValue: rawStampKind),
              let layer = InkLayer(rawValue: layer) else { return nil }
        return StampAnnotation(id: id, pieceID: piece_id, page: page, position: region, kind: stampKind, label: stamp_label,
                                layer: layer, createdAt: created_at, updatedAt: updated_at, deletedAt: deleted_at)
    }
}

// MARK: Warmups (`warmup_exercises`, spec §12)

public struct WarmupExerciseSyncRow: Codable, Equatable, Sendable {
    public var id: UUID
    public var kind: String
    public var key: String
    public var mode: String?
    public var instrument_family: String?
    public var custom_from_passage_id: UUID?
    public var name: String
    public var is_favorite: Bool
    public var last_used_at: Date?
    public var use_count: Int
    public var created_at: Date
    public var updated_at: Date
    public var deleted_at: Date?
    public init(_ exercise: WarmupExercise) {
        id = exercise.id; kind = exercise.kind.rawValue; key = exercise.key; mode = exercise.mode?.rawValue
        instrument_family = exercise.instrumentFamily?.rawValue; custom_from_passage_id = exercise.customFromPassageID
        name = exercise.name; is_favorite = exercise.isFavorite; last_used_at = exercise.lastUsedAt; use_count = exercise.useCount
        created_at = exercise.createdAt; updated_at = exercise.updatedAt; deleted_at = exercise.deletedAt
    }
    public var coreValue: WarmupExercise? {
        guard let kind = WarmupKind(rawValue: kind) else { return nil }
        return WarmupExercise(id: id, kind: kind, key: key, mode: mode.flatMap(ScaleMode.init(rawValue:)),
                               instrumentFamily: instrument_family.flatMap(InstrumentFamily.init(rawValue:)),
                               customFromPassageID: custom_from_passage_id, name: name, isFavorite: is_favorite,
                               lastUsedAt: last_used_at, useCount: use_count,
                               createdAt: created_at, updatedAt: updated_at, deletedAt: deleted_at)
    }
}

// MARK: Recordings metadata (`audio_recordings`, spec §13 — the bytes live in the "recordings"
// storage bucket; see `Services/ScoreAndRecordingStorage.swift`)

public struct AudioRecordingSyncRow: Codable, Equatable, Sendable {
    public var id: UUID
    public var passage_id: UUID?
    public var set_id: UUID?
    public var date: Date
    public var file_name: String
    public var duration: Double
    public var byte_size: Int
    public var created_at: Date
    public var updated_at: Date
    public var deleted_at: Date?
    public init(_ recording: AudioRecording) {
        id = recording.id; passage_id = recording.passageID; set_id = recording.setID; date = recording.date
        file_name = recording.fileName; duration = recording.duration; byte_size = recording.byteSize
        created_at = recording.createdAt; updated_at = recording.updatedAt; deleted_at = recording.deletedAt
    }
    public var coreValue: AudioRecording {
        AudioRecording(id: id, passageID: passage_id, setID: set_id, date: date, fileName: file_name,
                        duration: duration, byteSize: byte_size, createdAt: created_at, updatedAt: updated_at, deletedAt: deleted_at)
    }
}

// MARK: Notebook (`notebook_entries`, spec §15)

public struct NotebookEntrySyncRow: Codable, Equatable, Sendable {
    public var id: UUID
    public var kind: String
    public var piece_id: UUID?
    public var date: Date
    public var text: String
    public var passage_ids: [UUID]
    public var created_at: Date
    public var updated_at: Date
    public var deleted_at: Date?
    public init(_ entry: NotebookEntry) {
        id = entry.id; kind = entry.kind.rawValue; piece_id = entry.pieceID; date = entry.date; text = entry.text
        passage_ids = entry.passageIDs; created_at = entry.createdAt; updated_at = entry.updatedAt; deleted_at = entry.deletedAt
    }
    public var coreValue: NotebookEntry? {
        guard let kind = NotebookEntryKind(rawValue: kind) else { return nil }
        return NotebookEntry(id: id, kind: kind, pieceID: piece_id, date: date, text: text, passageIDs: passage_ids,
                              createdAt: created_at, updatedAt: updated_at, deletedAt: deleted_at)
    }
}

// MARK: Practice sessions (`practice_sessions`, spec §10) — `sets.session_id` is a hard FK to this
// table (`references public.practice_sessions (id) on delete cascade`, `20260926220003_
// library_sync_tables.sql`), exactly like `attempts.set_id -> sets(id)`: a session must be pushed
// before any set that references it, for the same reason `SyncCoordinator.syncSet(_:)` always pushes
// a set before any of that set's attempts. `PracticeSession` (Models.swift), like `ActiveSet`, has no
// `createdAt`/`updatedAt`/`deletedAt` of its own — see `SetSyncRow`'s doc comment just below for why
// stamping this DTO's timestamps at push time, not from a stored Core field, is the right call here
// too, and does not touch `Models.swift`.
public struct PracticeSessionSyncRow: Codable, Equatable, Sendable {
    public var id: UUID
    public var piece_id: UUID
    public var focus: String
    public var started_at: Date
    public var ended_at: Date?
    public var active_seconds: Double
    public var completed_sets: Int
    public var created_at: Date
    public var updated_at: Date
    public var deleted_at: Date?

    public init(_ session: PracticeSession, pushedAt: Date = Date()) {
        id = session.id; piece_id = session.pieceID; focus = session.focus
        started_at = session.startedAt; ended_at = session.endedAt
        active_seconds = session.activeSeconds; completed_sets = session.completedSets
        created_at = pushedAt; updated_at = pushedAt; deleted_at = nil
    }
    public var coreValue: PracticeSession {
        var session = PracticeSession(id: id, pieceID: piece_id, focus: focus, startedAt: started_at)
        session.endedAt = ended_at; session.activeSeconds = active_seconds; session.completedSets = completed_sets
        return session
    }
}

// MARK: Practice sets + the append-only rep log (`sets`/`attempts`, spec §9/§10)
//
// `ActiveSet` carries no `createdAt`/`updatedAt`/`deletedAt` of its own — it is ephemeral-while-
// running, then-immutable-in-history practice state, not a user-edited library record, so
// `Models.swift` never gave it a sync clock. `SyncCoordinator` pushes a fresh snapshot immediately
// after every observed change (see its own doc comment), so the *push* timestamp is always within
// moments of the real edit; `updated_at`/`created_at` are stamped with that push time here rather
// than invented a stale/duplicated value. `deleted_at` is always nil: this schema has no concept of
// deleting a practice set once it exists. None of this touches `Models.swift`.
/// The backend treats tempo_step as opaque jsonb. Keep the original enum keys and carry the
/// optional tempo-edit log alongside them, without inventing a new database column.
private struct SetTempoSyncPayload: Codable, Equatable, Sendable {
    var step: TempoStep
    var changes: [SetTempoChange]
    private enum CodingKeys: String, CodingKey { case tempoChanges }
    init(step: TempoStep, changes: [SetTempoChange]) { self.step = step; self.changes = changes }
    init(from decoder: Decoder) throws {
        step = try TempoStep(from: decoder)
        changes = try decoder.container(keyedBy: CodingKeys.self).decodeIfPresent([SetTempoChange].self, forKey: .tempoChanges) ?? []
    }
    func encode(to encoder: Encoder) throws {
        try step.encode(to: encoder)
        if !changes.isEmpty {
            var values = encoder.container(keyedBy: CodingKeys.self)
            try values.encode(changes, forKey: .tempoChanges)
        }
    }
}

public struct SetSyncRow: Codable, Equatable, Sendable {
    public var id: UUID
    public var session_id: UUID
    public var piece_id: UUID
    public var passage_id: UUID?
    public var focus: String
    public var goal: String
    public var basis: String
    public var target_count: Int
    public var start_bpm: Double
    public var target_bpm: Double
    private var tempoPayload: SetTempoSyncPayload
    public var tempo_step: TempoStep {
        get { tempoPayload.step }
        set { tempoPayload.step = newValue }
    }
    public var tempo_changes: [SetTempoChange] { tempoPayload.changes }
    private enum CodingKeys: String, CodingKey {
        case id, session_id, piece_id, passage_id, focus, goal, basis, target_count, start_bpm, target_bpm
        case tempoPayload = "tempo_step"
        case stages, hands, use_metronome, passage_snapshot, current_bpm, stage_index, streak, total_plays, completed_stages
        case status, started_at, ended_at, active_seconds, last_checkpoint, created_at, updated_at, deleted_at
    }
    public var stages: [VariantStage]
    public var hands: String
    public var use_metronome: Bool
    public var passage_snapshot: Passage?
    public var current_bpm: Double
    public var stage_index: Int
    public var streak: Int
    public var total_plays: Int
    public var completed_stages: Int
    public var status: String
    public var started_at: Date
    public var ended_at: Date?
    public var active_seconds: Double
    public var last_checkpoint: Date?
    public var created_at: Date
    public var updated_at: Date
    public var deleted_at: Date?

    public init(_ set: ActiveSet, pushedAt: Date = Date()) {
        id = set.id; session_id = set.sessionID
        piece_id = set.configuration.pieceID; passage_id = set.configuration.passageID
        focus = set.configuration.focus; goal = set.configuration.goal.rawValue; basis = set.configuration.basis.rawValue
        target_count = set.configuration.targetCount; start_bpm = set.configuration.startBPM; target_bpm = set.configuration.targetBPM
        tempoPayload = SetTempoSyncPayload(step: set.configuration.tempoStep, changes: set.configuration.tempoChanges); stages = set.configuration.stages; hands = set.configuration.hands
        use_metronome = set.configuration.useMetronome; passage_snapshot = set.configuration.passageSnapshot
        current_bpm = set.currentBPM; stage_index = set.stageIndex; streak = set.streak
        total_plays = set.totalPlays; completed_stages = set.completedStages; status = set.status.rawValue
        started_at = set.startedAt; ended_at = set.endedAt; active_seconds = set.activeSeconds; last_checkpoint = set.lastCheckpoint
        created_at = pushedAt; updated_at = pushedAt; deleted_at = nil
    }
    /// Reconstructs everything this row carries about a set EXCEPT its attempts (a separate table —
    /// see `AttemptSyncRow`); the caller must splice in whatever attempts belong locally to this id
    /// (already-applied ones from this device, plus any this same sync pass also pulls from
    /// `attempts`) rather than lose them. `PracticeStore.applySyncedSet` does exactly that.
    public var coreValue: ActiveSet? {
        guard let status = SetStatus(rawValue: status), let goal = SetGoal(rawValue: goal), let basis = CompletionBasis(rawValue: basis)
        else { return nil }
        let configuration = PracticeConfiguration(pieceID: piece_id, passageID: passage_id, focus: focus, goal: goal, basis: basis,
                                                   targetCount: target_count, startBPM: start_bpm, targetBPM: target_bpm,
                                                   tempoStep: tempo_step, stages: stages, hands: hands, useMetronome: use_metronome,
                                                   passageSnapshot: passage_snapshot, tempoChanges: tempoPayload.changes)
        var set = ActiveSet(id: id, sessionID: session_id, configuration: configuration, startedAt: started_at)
        set.currentBPM = current_bpm; set.stageIndex = stage_index; set.streak = streak
        set.totalPlays = total_plays; set.completedStages = completed_stages; set.status = status
        set.endedAt = ended_at; set.activeSeconds = active_seconds; set.lastCheckpoint = last_checkpoint
        return set
    }
}

/// Append-only (Schema3.md: "an append-only log carries only id and its own event date") — no
/// `updated_at`/`deleted_at` at all, and `undone_at` is deliberately never part of the *push*
/// payload (`init(_:setID:)` below never sets it): the one legitimate post-insert edit (spec 9 Undo)
/// goes through `sync_undo_attempt` (`SyncEngine.enqueueUndoAttempt`), never a whole-row append. It
/// IS read back on *pull* (`coreValue`), so an attempt this device is pulling for the first time that
/// was already undone on another device before this device ever heard of it decodes as undone, not
/// silently reset to active.
///
/// Pulls currently revisit this whole table in ordered pages, so an older offline upload and a
/// later remote Undo remain visible. A future server-owned ingestion/change sequence can make
/// this incremental without confusing the musician's original event time with sync arrival time.
public struct AttemptSyncRow: Codable, Equatable, Sendable {
    public var id: UUID
    public var set_id: UUID
    public var verdict: String
    public var date: Date
    public var bpm: Double
    public var stage_index: Int
    public var undone_at: Date?
    public init(_ attempt: Attempt, setID: UUID) {
        id = attempt.id; set_id = setID; verdict = attempt.verdict.rawValue
        date = attempt.date; bpm = attempt.bpm; stage_index = attempt.stageIndex; undone_at = nil
    }
    /// `set_id` is consumed by the caller (`PracticeStore.applySyncedAttempt`) to find which set this
    /// belongs to, not stored again on the reconstructed `Attempt` (which, like the SQL row's shape
    /// once nested, has no such field of its own).
    public var coreValue: Attempt? {
        guard let verdict = Verdict(rawValue: verdict) else { return nil }
        return Attempt(id: id, verdict: verdict, date: date, bpm: bpm, stageIndex: stage_index, undoneAt: undone_at)
    }
}

// MARK: Append-only logs, part 2 (`rule_events`, `reward_ledger`, `badges`, `milestone_events`,
// `cold_grades`, `break_point_taps` — spec §11/§14; `attempts` above)

public struct RuleEventSyncRow: Codable, Equatable, Sendable {
    public var id: UUID
    public var rule_id: String
    public var piece_id: UUID?
    public var passage_id: UUID?
    public var reason_text: String
    public var fired_at: Date
    public var overridden: Bool
    public init(_ event: RuleEvent) {
        id = event.id; rule_id = event.ruleID.rawValue; piece_id = event.pieceID; passage_id = event.passageID
        reason_text = event.reasonText; fired_at = event.firedAt; overridden = event.overridden
    }
    public var coreValue: RuleEvent? {
        guard let ruleID = RuleID(rawValue: rule_id) else { return nil }
        return RuleEvent(id: id, ruleID: ruleID, pieceID: piece_id, passageID: passage_id,
                          reasonText: reason_text, firedAt: fired_at, overridden: overridden)
    }
}

public struct RewardLedgerEntrySyncRow: Codable, Equatable, Sendable {
    public var id: UUID
    public var date: Date
    public var coins_delta: Int
    public var xp_delta: Int
    public var reason: String
    public init(_ entry: RewardLedgerEntry) {
        id = entry.id; date = entry.date; coins_delta = entry.coinsDelta; xp_delta = entry.xpDelta; reason = entry.reason
    }
    public var coreValue: RewardLedgerEntry {
        RewardLedgerEntry(id: id, date: date, coinsDelta: coins_delta, xpDelta: xp_delta, reason: reason)
    }
}

public struct BadgeSyncRow: Codable, Equatable, Sendable {
    public var id: UUID
    public var key: String
    public var earned_at: Date
    public init(_ badge: Badge) { id = badge.id; key = badge.key; earned_at = badge.earnedAt }
    public var coreValue: Badge { Badge(id: id, key: key, earnedAt: earned_at) }
}

/// `piece_id`/`passage_id` need `20260926220021_milestone_events_add_piece_passage.sql` (this pass) —
/// the table as originally shipped only had `id`/`kind`/`date`/`detail`, silently dropping these two
/// Core-side fields on every push (`jsonb_populate_record` ignores JSON keys with no matching column;
/// it does not error). See that migration's own header.
public struct MilestoneEventSyncRow: Codable, Equatable, Sendable {
    public var id: UUID
    public var kind: String
    public var date: Date
    public var detail: String
    public var piece_id: UUID?
    public var passage_id: UUID?
    public init(_ event: MilestoneEvent) {
        id = event.id; kind = event.kind; date = event.date; detail = event.detail
        piece_id = event.pieceID; passage_id = event.passageID
    }
    public var coreValue: MilestoneEvent {
        MilestoneEvent(id: id, kind: kind, date: date, detail: detail, pieceID: piece_id, passageID: passage_id)
    }
}

public struct ColdGradeRecordSyncRow: Codable, Equatable, Sendable {
    public var id: UUID
    public var passage_id: UUID
    public var date: Date
    public var grade: String
    public var tempo: Double
    public init(_ record: ColdGradeRecord) {
        id = record.id; passage_id = record.passageID; date = record.date; grade = record.grade.rawValue; tempo = record.tempo
    }
    public var coreValue: ColdGradeRecord? {
        guard let grade = ColdGrade(rawValue: grade) else { return nil }
        return ColdGradeRecord(id: id, passageID: passage_id, date: date, grade: grade, tempo: tempo)
    }
}

public struct BreakPointTapSyncRow: Codable, Equatable, Sendable {
    public var id: UUID
    public var passage_id: UUID
    public var date: Date
    public var location: NormalizedRect?
    public init(_ tap: BreakPointTap) { id = tap.id; passage_id = tap.passageID; date = tap.date; location = tap.location }
    public var coreValue: BreakPointTap { BreakPointTap(id: id, passageID: passage_id, date: date, location: location) }
}

// MARK: Goals and reusable practice routines

public struct PracticeGoalSyncRow: Codable, Equatable, Sendable {
    public var id: UUID
    public var title: String
    public var piece_id: UUID?
    public var due_date: Date?
    public var is_complete: Bool
    public var created_at: Date
    public var updated_at: Date
    public var deleted_at: Date?
    public init(_ goal: PracticeGoal) {
        id = goal.id; title = goal.title; piece_id = goal.pieceID; due_date = goal.dueDate
        is_complete = goal.isComplete; created_at = goal.createdAt; updated_at = goal.updatedAt; deleted_at = goal.deletedAt
    }
    public var coreValue: PracticeGoal {
        PracticeGoal(id: id, title: title, pieceID: piece_id, dueDate: due_date, isComplete: is_complete,
                     createdAt: created_at, updatedAt: updated_at, deletedAt: deleted_at)
    }
}

public struct PracticeRoutineSyncRow: Codable, Equatable, Sendable {
    public var id: UUID
    public var name: String
    public var stages: [VariantStage]
    public var created_at: Date
    public var updated_at: Date
    public var deleted_at: Date?
    public init(_ routine: PracticeRoutine) {
        id = routine.id; name = routine.name; stages = routine.stages
        created_at = routine.createdAt; updated_at = routine.updatedAt; deleted_at = routine.deletedAt
    }
    public var coreValue: PracticeRoutine {
        PracticeRoutine(id: id, name: name, stages: stages, createdAt: created_at, updatedAt: updated_at, deletedAt: deleted_at)
    }
}
