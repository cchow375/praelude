import Foundation

// MARK: - Wire-format row DTOs (§3/§5 of "(C) Sync Protocol.md")
//
// Every stored property below is spelled exactly as its SQL column (snake_case), not camelCase —
// a deliberate departure from this codebase's usual style. The sync protocol doc's central warning
// is that an automatic camelCase -> snake_case conversion silently corrupts a pluralized acronym
// (`tagIDs` -> `tag_i_ds`, not `tag_ids`), so a hand-written mapping is required; naming the
// property itself after the column removes the one place that mapping could still drift, since
// there is only one spelling to get right, not a property name and a separate `CodingKeys` case
// that must agree. `init(_:)` / `coreValue` is the only place a Core <-> column translation happens,
// reading Core's own (camelCase) property names directly, so a rename in `Models.swift` et al. fails
// to compile here instead of silently mismapping.
//
// `sync_upsert` requires the *entire* row every time, including columns with a SQL default — the
// server builds the record via `jsonb_populate_record`, which fills any key missing from the JSON
// with SQL NULL, not the column's default (verified by reading `20260926220005_sync_rpc.sql`
// directly, not assumed). Every DTO below therefore encodes every column the table has except
// `id`/`owner_id`, which the RPC always forces server-side and which are omitted per §2 of the sync
// protocol doc. `created_at` is included but, per that same migration, is excluded from the RPC's
// own `ON CONFLICT ... DO UPDATE` set-clause — the value this app sends after the first insert is
// never applied, so stamping "now" on every push is harmless, not a lie about history.

// MARK: Instruments (`instruments`, spec §6)

public struct InstrumentSyncRow: Codable, Equatable, Sendable {
    public var id: UUID
    public var family: String
    public var name: String
    public var level: String
    public var transposition_semitones: Int?
    public var transposition_label: String?
    public var is_primary: Bool
    public var created_at: Date
    public var updated_at: Date
    public var deleted_at: Date?

    public init(_ instrument: Instrument) {
        id = instrument.id
        family = instrument.family.rawValue
        name = instrument.name
        level = instrument.level
        transposition_semitones = instrument.transposition?.writtenToConcertSemitones
        transposition_label = instrument.transposition?.label
        is_primary = instrument.isPrimary
        created_at = instrument.createdAt
        updated_at = instrument.updatedAt
        deleted_at = instrument.deletedAt
    }
    public var coreValue: Instrument? {
        guard let family = InstrumentFamily(rawValue: family) else { return nil }
        let transposition = transposition_semitones.map { Transposition(writtenToConcertSemitones: $0, label: transposition_label ?? "") }
        return Instrument(id: id, family: family, name: name, level: level, transposition: transposition,
                           isPrimary: is_primary, createdAt: created_at, updatedAt: updated_at, deletedAt: deleted_at)
    }
}

// MARK: Pieces (`pieces`)

public struct PieceSyncRow: Codable, Equatable, Sendable {
    public var id: UUID
    public var title: String
    public var composer: String
    public var pdf_file_name: String?
    public var page_count: Int
    public var last_page: Int
    public var status: String
    public var notes: String
    public var instrument_id: UUID?
    public var tag_ids: [UUID]
    public var folder_ids: [UUID]
    public var difficulty: Int?
    public var custom_cover_ref: String?
    public var performance_dates: [Date]
    public var created_at: Date
    public var updated_at: Date
    /// Own clock (Schema3.md): only `sync_update_last_page` (a dedicated RPC, not this whole-row
    /// upsert) ever advances this, so an ordinary metadata edit never races a page turn made offline
    /// on another device. Still included here — `sync_upsert` needs the entire record — but a page
    /// turn by itself should go through `SyncEngine.recordLastPage`, not a full `Piece` push.
    public var last_page_updated_at: Date
    public var deleted_at: Date?

    public init(_ piece: Piece) {
        id = piece.id; title = piece.title; composer = piece.composer; pdf_file_name = piece.pdfFileName
        page_count = piece.pageCount; last_page = piece.lastPage; status = piece.status.rawValue; notes = piece.notes
        instrument_id = piece.instrumentID; tag_ids = piece.tagIDs; folder_ids = piece.folderIDs
        difficulty = piece.difficulty; custom_cover_ref = piece.customCoverRef; performance_dates = piece.performanceDates
        created_at = piece.createdAt; updated_at = piece.updatedAt; last_page_updated_at = piece.lastPageUpdatedAt
        deleted_at = piece.deletedAt
    }
    public var coreValue: Piece? {
        guard let status = PieceStatus(rawValue: status) else { return nil }
        return Piece(id: id, title: title, composer: composer, pdfFileName: pdf_file_name, pageCount: page_count,
                      lastPage: last_page, status: status, notes: notes, createdAt: created_at, instrumentID: instrument_id,
                      tagIDs: tag_ids, folderIDs: folder_ids, difficulty: difficulty, customCoverRef: custom_cover_ref,
                      performanceDates: performance_dates, updatedAt: updated_at, lastPageUpdatedAt: last_page_updated_at,
                      deletedAt: deleted_at)
    }
}

// MARK: Passages (`passages`, spec §8/§11)

public struct PassageSyncRow: Codable, Equatable, Sendable {
    public var id: UUID
    public var piece_id: UUID
    public var title: String
    public var start_measure: Int?
    public var end_measure: Int?
    public var page: Int
    public var focus: String
    /// jsonb array of `PassageRegion`; opaque to the server, round-tripped through Core's own Codable.
    public var regions: [PassageRegion]
    public var color: String?
    public var parent_passage_id: UUID?
    public var joined_from_passage_ids: [UUID]
    public var archived: Bool
    public var learning_state: String
    public var schedule_due_date: Date?
    public var schedule_interval_days: Int
    public var schedule_review_step: Int
    public var parked_until: Date?
    public var performance_tempo: Double?
    public var created_at: Date
    public var updated_at: Date
    public var deleted_at: Date?

    public init(_ passage: Passage) {
        id = passage.id; piece_id = passage.pieceID; title = passage.title
        start_measure = passage.startMeasure; end_measure = passage.endMeasure
        page = passage.page; focus = passage.focus; regions = passage.regions
        color = passage.color; parent_passage_id = passage.parentPassageID
        joined_from_passage_ids = passage.joinedFromPassageIDs; archived = passage.archived
        learning_state = passage.learningState.rawValue
        schedule_due_date = passage.schedule.dueDate; schedule_interval_days = passage.schedule.intervalDays
        schedule_review_step = passage.schedule.reviewStep
        parked_until = passage.parkedUntil; performance_tempo = passage.performanceTempo
        created_at = passage.createdAt; updated_at = passage.updatedAt; deleted_at = passage.deletedAt
    }
    public var coreValue: Passage? {
        guard let learningState = LearningState(rawValue: learning_state) else { return nil }
        return Passage(id: id, pieceID: piece_id, title: title, startMeasure: start_measure, endMeasure: end_measure,
                        page: page, focus: focus, regions: regions, color: color, parentPassageID: parent_passage_id,
                        joinedFromPassageIDs: joined_from_passage_ids, archived: archived, learningState: learningState,
                        schedule: PassageSchedule(dueDate: schedule_due_date, intervalDays: schedule_interval_days, reviewStep: schedule_review_step),
                        parkedUntil: parked_until, performanceTempo: performance_tempo,
                        createdAt: created_at, updatedAt: updated_at, deletedAt: deleted_at)
    }
}

// MARK: Ink strokes (`ink_strokes`, spec §7)

public struct InkStrokeSyncRow: Codable, Equatable, Sendable {
    public var id: UUID
    public var piece_id: UUID
    public var page: Int
    public var layer: String
    /// `bytea` as Postgres hex-literal text (`\x...`), never base64 — see `SyncCoding.swift`.
    public var data: String
    public var created_at: Date
    public var updated_at: Date
    public var deleted_at: Date?

    public init?(_ stroke: InkStroke) {
        id = stroke.id; piece_id = stroke.pieceID; page = stroke.page; layer = stroke.layer.rawValue
        data = stroke.data.praeludeHexLiteral
        created_at = stroke.createdAt; updated_at = stroke.updatedAt; deleted_at = stroke.deletedAt
    }
    public var coreValue: InkStroke? {
        guard let layer = InkLayer(rawValue: layer), let bytes = Data(praeludeHexLiteral: data) else { return nil }
        return InkStroke(id: id, pieceID: piece_id, page: page, layer: layer, data: bytes,
                          createdAt: created_at, updatedAt: updated_at, deletedAt: deleted_at)
    }
}

// MARK: Rule settings (`rule_settings`, owner-keyed singleton — no `id` column)

public struct RuleSettingsSyncRow: Codable, Equatable, Sendable {
    public var r1_enabled: Bool; public var r1_max_measures: Int; public var r1_max_systems: Double
    public var r2_enabled: Bool
    public var r3_enabled: Bool
    public var r4_enabled: Bool; public var r4_clean_intervals_days: [Int]; public var r4_shaky_interval_days: Int
    public var r5_enabled: Bool; public var r5_learning_streak: Int; public var r5_review_streak: Int
    public var r6_enabled: Bool; public var r6_resets_before_step_down: Int; public var r6_step_down_percent: Double
    public var r7_enabled: Bool; public var r7_max_increases_per_day: Int
    public var r8_enabled: Bool; public var r8_taps_to_offer_split: Int
    public var r9_enabled: Bool; public var r9_minutes: Int; public var r9_sets: Int
    public var r10_enabled: Bool; public var r10_distinct_days: Int; public var r10_requires_first_in_session: Bool
    public var r11_enabled: Bool; public var r11_final_week_days: Int; public var r11_final_two_weeks_days: Int
    public var r12_enabled: Bool; public var r12_slow_downs_per_day: Int
    public var r13_enabled: Bool; public var r13_consecutive_missed: Int
    public var r14_enabled: Bool; public var r14_dropout_bars: Int
    public var r15_enabled: Bool; public var r15_max_new_per_session: Int
    public var created_at: Date
    public var updated_at: Date

    public init(_ settings: RuleSettings, createdAt: Date = Date()) {
        r1_enabled = settings.r1Enabled; r1_max_measures = settings.r1MaxMeasures; r1_max_systems = settings.r1MaxSystems
        r2_enabled = settings.r2Enabled
        r3_enabled = settings.r3Enabled
        r4_enabled = settings.r4Enabled; r4_clean_intervals_days = settings.r4CleanIntervalsDays; r4_shaky_interval_days = settings.r4ShakyIntervalDays
        r5_enabled = settings.r5Enabled; r5_learning_streak = settings.r5LearningStreak; r5_review_streak = settings.r5ReviewStreak
        r6_enabled = settings.r6Enabled; r6_resets_before_step_down = settings.r6ResetsBeforeStepDown; r6_step_down_percent = settings.r6StepDownPercent
        r7_enabled = settings.r7Enabled; r7_max_increases_per_day = settings.r7MaxIncreasesPerDay
        r8_enabled = settings.r8Enabled; r8_taps_to_offer_split = settings.r8TapsToOfferSplit
        r9_enabled = settings.r9Enabled; r9_minutes = settings.r9Minutes; r9_sets = settings.r9Sets
        r10_enabled = settings.r10Enabled; r10_distinct_days = settings.r10DistinctDays; r10_requires_first_in_session = settings.r10RequiresFirstInSession
        r11_enabled = settings.r11Enabled; r11_final_week_days = settings.r11FinalWeekDays; r11_final_two_weeks_days = settings.r11FinalTwoWeeksDays
        r12_enabled = settings.r12Enabled; r12_slow_downs_per_day = settings.r12SlowDownsPerDay
        r13_enabled = settings.r13Enabled; r13_consecutive_missed = settings.r13ConsecutiveMissed
        r14_enabled = settings.r14Enabled; r14_dropout_bars = settings.r14DropoutBars
        r15_enabled = settings.r15Enabled; r15_max_new_per_session = settings.r15MaxNewPerSession
        created_at = createdAt; updated_at = settings.updatedAt
    }
    public var coreValue: RuleSettings {
        var settings = RuleSettings()
        settings.r1Enabled = r1_enabled; settings.r1MaxMeasures = r1_max_measures; settings.r1MaxSystems = r1_max_systems
        settings.r2Enabled = r2_enabled
        settings.r3Enabled = r3_enabled
        settings.r4Enabled = r4_enabled; settings.r4CleanIntervalsDays = r4_clean_intervals_days; settings.r4ShakyIntervalDays = r4_shaky_interval_days
        settings.r5Enabled = r5_enabled; settings.r5LearningStreak = r5_learning_streak; settings.r5ReviewStreak = r5_review_streak
        settings.r6Enabled = r6_enabled; settings.r6ResetsBeforeStepDown = r6_resets_before_step_down; settings.r6StepDownPercent = r6_step_down_percent
        settings.r7Enabled = r7_enabled; settings.r7MaxIncreasesPerDay = r7_max_increases_per_day
        settings.r8Enabled = r8_enabled; settings.r8TapsToOfferSplit = r8_taps_to_offer_split
        settings.r9Enabled = r9_enabled; settings.r9Minutes = r9_minutes; settings.r9Sets = r9_sets
        settings.r10Enabled = r10_enabled; settings.r10DistinctDays = r10_distinct_days; settings.r10RequiresFirstInSession = r10_requires_first_in_session
        settings.r11Enabled = r11_enabled; settings.r11FinalWeekDays = r11_final_week_days; settings.r11FinalTwoWeeksDays = r11_final_two_weeks_days
        settings.r12Enabled = r12_enabled; settings.r12SlowDownsPerDay = r12_slow_downs_per_day
        settings.r13Enabled = r13_enabled; settings.r13ConsecutiveMissed = r13_consecutive_missed
        settings.r14Enabled = r14_enabled; settings.r14DropoutBars = r14_dropout_bars
        settings.r15Enabled = r15_enabled; settings.r15MaxNewPerSession = r15_max_new_per_session
        settings.updatedAt = updated_at
        return settings
    }
}

// MARK: Rewards state (`rewards_state`, owner-keyed singleton — no `id` column)

public struct RewardsStateSyncRow: Codable, Equatable, Sendable {
    public var rank: String
    public var division: Int
    public var streak_days: Int
    public var streak_freezes_available: Int
    public var last_practice_date: Date?
    public var created_at: Date
    public var updated_at: Date

    public init(_ state: RewardsState, createdAt: Date = Date()) {
        rank = state.rank; division = state.division; streak_days = state.streakDays
        streak_freezes_available = state.streakFreezesAvailable; last_practice_date = state.lastPracticeDate
        created_at = createdAt; updated_at = state.updatedAt
    }
    public var coreValue: RewardsState {
        var state = RewardsState()
        state.rank = rank; state.division = division; state.streakDays = streak_days
        state.streakFreezesAvailable = streak_freezes_available; state.lastPracticeDate = last_practice_date
        state.updatedAt = updated_at
        return state
    }
}

// MARK: Profile (`profiles`, spec §4c — id-is-owner singleton, superset of Core's `Profile`)

/// The spec §4c/§5c fields `Profile.swift` deliberately does not mirror locally (Schema3.md: "the
/// backend/sync track owns the authoritative copy"). Round-tripped by the sync engine so a pull
/// preserves them instead of a later push clobbering them with a default — this app has no UI yet
/// for most of these (age gate, private-account toggle, per-field presence/notes privacy all belong
/// to a future social-surface track), so the honest contract is "keep whatever the server last had,"
/// not "silently reset them."
public struct ProfileBackendFields: Codable, Equatable, Sendable {
    public var ageBracket: String?
    public var isPrivateAccount: Bool = false
    public var leaderboardOptOut: Bool = false
    public var privacyPresence: ProfileVisibility = .friends
    public var privacyNotes: ProfileVisibility = .friends
    public var upcomingPerformances: [BackendPerformance] = []
    public init() {}
}

public struct BackendPerformance: Codable, Equatable, Sendable {
    public var title: String?
    public var date: Date
    public var location: String?
    public init(title: String? = nil, date: Date, location: String? = nil) {
        self.title = title; self.date = date; self.location = location
    }
}

public struct ProfileSyncRow: Codable, Equatable, Sendable {
    public var username: String
    public var display_name: String
    public var photo_path: String?
    public var bio: String
    public var teacher_or_school: String
    public var location: String
    public var currently_working_on_piece_ids: [UUID]
    public var upcoming_performances: [BackendPerformance]
    public var join_date: Date
    public var is_private_account: Bool
    public var age_bracket: String?
    public var leaderboard_opt_out: Bool
    public var privacy_name: String
    public var privacy_username: String
    public var privacy_photo: String
    public var privacy_bio: String
    public var privacy_instruments: String
    public var privacy_teacher_or_school: String
    public var privacy_location: String
    public var privacy_currently_working_on: String
    public var privacy_upcoming_performances: String
    public var privacy_stats: String
    public var privacy_presence: String
    public var privacy_notes: String
    public var created_at: Date
    public var updated_at: Date

    public init(_ profile: Profile, extras: ProfileBackendFields, createdAt: Date = Date()) {
        username = profile.username; display_name = profile.displayName; photo_path = profile.photoRef
        bio = profile.bio; teacher_or_school = profile.teacherOrSchool; location = profile.location
        currently_working_on_piece_ids = profile.currentlyWorkingOnPieceIDs
        upcoming_performances = extras.upcomingPerformances
        join_date = profile.joinDate
        is_private_account = extras.isPrivateAccount; age_bracket = extras.ageBracket; leaderboard_opt_out = extras.leaderboardOptOut
        let privacy = profile.privacy
        privacy_name = privacy.name.rawValue; privacy_username = privacy.username.rawValue; privacy_photo = privacy.photo.rawValue
        privacy_bio = privacy.bio.rawValue; privacy_instruments = privacy.instruments.rawValue
        privacy_teacher_or_school = privacy.teacherOrSchool.rawValue; privacy_location = privacy.location.rawValue
        privacy_currently_working_on = privacy.currentlyWorkingOn.rawValue
        privacy_upcoming_performances = privacy.upcomingPerformances.rawValue; privacy_stats = privacy.stats.rawValue
        privacy_presence = extras.privacyPresence.rawValue; privacy_notes = extras.privacyNotes.rawValue
        created_at = createdAt; updated_at = profile.updatedAt
    }
    /// `ownerID`/`username` are supplied by the caller (`ownerID` is never a column here — see the
    /// type doc comment; `username` round-trips fine but is still needed to satisfy `Profile.init`).
    public func coreProfile(ownerID: UUID?) -> Profile {
        var profile = Profile()
        profile.ownerID = ownerID
        profile.displayName = display_name; profile.username = username; profile.photoRef = photo_path
        profile.bio = bio; profile.teacherOrSchool = teacher_or_school; profile.location = location
        profile.currentlyWorkingOnPieceIDs = currently_working_on_piece_ids
        profile.joinDate = join_date
        profile.privacy.name = ProfileVisibility(rawValue: privacy_name) ?? .publicVisibility
        profile.privacy.username = ProfileVisibility(rawValue: privacy_username) ?? .publicVisibility
        profile.privacy.photo = ProfileVisibility(rawValue: privacy_photo) ?? .publicVisibility
        profile.privacy.bio = ProfileVisibility(rawValue: privacy_bio) ?? .friends
        profile.privacy.instruments = ProfileVisibility(rawValue: privacy_instruments) ?? .friends
        profile.privacy.teacherOrSchool = ProfileVisibility(rawValue: privacy_teacher_or_school) ?? .friends
        profile.privacy.location = ProfileVisibility(rawValue: privacy_location) ?? .friends
        profile.privacy.currentlyWorkingOn = ProfileVisibility(rawValue: privacy_currently_working_on) ?? .friends
        profile.privacy.upcomingPerformances = ProfileVisibility(rawValue: privacy_upcoming_performances) ?? .friends
        profile.privacy.stats = ProfileVisibility(rawValue: privacy_stats) ?? .friends
        profile.updatedAt = updated_at
        return profile
    }
    public var backendFields: ProfileBackendFields {
        var extras = ProfileBackendFields()
        extras.ageBracket = age_bracket; extras.isPrivateAccount = is_private_account; extras.leaderboardOptOut = leaderboard_opt_out
        extras.privacyPresence = ProfileVisibility(rawValue: privacy_presence) ?? .friends
        extras.privacyNotes = ProfileVisibility(rawValue: privacy_notes) ?? .friends
        extras.upcomingPerformances = upcoming_performances
        return extras
    }
}
