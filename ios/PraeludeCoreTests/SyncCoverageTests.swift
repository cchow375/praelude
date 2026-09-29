import Foundation
import XCTest
@testable import PraeludeCore

/// Core-level proof for the "wire every registered sync table" pass: the `attempts.set_id -> sets`
/// foreign key ordering contract at the raw `SyncEngine`/`SyncTransport` level (no `SyncCoordinator`
/// — that lives in the app target, not this package; see `PraeludeAppTests/SyncCoordinatorCoverageTests.swift`
/// for the full reactive-hook, two-device convergence proof "incl. reps" the task asks for), and every
/// new `PracticeStore.applySynced*` method this pass added, including the two real bugs found and
/// fixed along the way (`applySyncedPiece`'s upsert-vs-update-only gap; `applySyncedInstrument`/
/// `applySyncedRuleSettings`/`applySyncedRewardsState`/`applySyncedProfile` no longer clobbering a
/// pulled row's real `updatedAt` with this device's own clock — see each one's doc comment in
/// `PracticeStore.swift`).
@MainActor
final class SyncCoverageTests: XCTestCase {
    private func directory() -> URL { FileManager.default.temporaryDirectory.appendingPathComponent("praelude-sync-coverage-\(UUID())") }
    private func store() -> PracticeStore { PracticeStore(directory: directory()) }

    // MARK: FK ordering (`FakeSyncServer.foreignKeys`, `SyncEngineTests.swift`): `sets.session_id ->
    // practice_sessions(id)` and `attempts.set_id -> sets(id)`, the two-deep chain this pass's
    // "push sets before attempts" task item actually has to handle end to end.

    func testAttemptAppendFailsWithoutItsSetPushedFirstAndSucceedsOnceItIs() async throws {
        let server = FakeSyncServer()
        let transport = FakeSyncTransport(server: server)
        let sessionID = UUID()
        let setID = UUID()
        let now = SyncCoding.iso8601Formatter.string(from: Date())
        let attemptRow: [String: SyncJSON] = ["id": .string(UUID().uuidString), "set_id": .string(setID.uuidString), "verdict": .string("clean")]

        do {
            _ = try await transport.append(table: "attempts", row: attemptRow)
            XCTFail("Expected the FK-violation throw — the referenced set was never pushed.")
        } catch SyncError.transport { /* expected */ }

        // A set pushed before its own session exists must also fail — the chain is two deep.
        let setRow: [String: SyncJSON] = ["id": .string(setID.uuidString), "session_id": .string(sessionID.uuidString), "updated_at": .string(now)]
        do {
            _ = try await transport.upsert(table: "sets", row: setRow)
            XCTFail("Expected the FK-violation throw — the referenced session was never pushed.")
        } catch SyncError.transport { /* expected */ }

        // Pushing the session, then the set, then the attempt (exactly what SyncCoordinator.syncSet(_:)
        // does on every call) makes the identical attempt append succeed.
        _ = try await transport.upsert(table: "practice_sessions", row: ["id": .string(sessionID.uuidString), "updated_at": .string(now)])
        _ = try await transport.upsert(table: "sets", row: setRow)
        let result = try await transport.append(table: "attempts", row: attemptRow)
        XCTAssertTrue(result.applied)
    }

    /// `SyncEngine.drain()` stops at the first failure rather than reordering later entries ahead of
    /// a stuck one (its own doc comment) — proves that property specifically for the attempts/sets
    /// case: an attempt enqueued (by mistake, or a future bug) *before* its set is ever pushed stays
    /// stuck at the front, never silently dropped and never lets a later, unrelated push jump ahead
    /// of it out of order.
    func testDrainStopsAtAnAttemptWhoseSetWasNeverPushedRatherThanSkippingIt() async throws {
        let server = FakeSyncServer()
        let engine = SyncEngine(transport: FakeSyncTransport(server: server), directory: directory())
        let setID = UUID()
        let attemptID = UUID()
        try engine.enqueueAppend(table: "attempts", row: ["id": .string(attemptID.uuidString), "set_id": .string(setID.uuidString), "verdict": .string("clean")])
        try engine.enqueueUpsert(table: "tags", row: ["id": .string(UUID().uuidString), "name": .string("Should not jump ahead"),
                                                        "updated_at": .string(SyncCoding.iso8601Formatter.string(from: Date()))])
        XCTAssertEqual(engine.pendingCount, 2)

        let applied = await engine.drain()
        XCTAssertFalse(applied)
        XCTAssertEqual(engine.pendingCount, 2, "Both entries must still be queued — the tag must not have been sent ahead of the stuck attempt.")
        XCTAssertEqual(server.count(table: "tags"), 0)
    }

    // MARK: `PracticeStore.applySyncedPiece` — the fixed insert-or-update gap

    func testApplySyncedPieceInsertsAPieceThisDeviceHasNeverSeenBefore() throws {
        let store = store()
        XCTAssertTrue(store.state.pieces.isEmpty)
        let fresh = Piece(id: UUID(), title: "Pulled from another device", pageCount: 3)
        try store.applySyncedPiece(fresh)
        XCTAssertEqual(store.state.pieces.first?.id, fresh.id, "A piece pulled for the first time must be inserted, not silently dropped.")
    }
    func testApplySyncedPieceUpdatesAnAlreadyKnownPiece() throws {
        let store = store()
        let piece = Piece(id: UUID(), title: "Original", pageCount: 1)
        try store.addPiece(piece)
        var edited = piece; edited.title = "Renamed on another device"; edited.updatedAt = Date()
        try store.applySyncedPiece(edited)
        XCTAssertEqual(store.state.pieces.count, 1)
        XCTAssertEqual(store.state.pieces.first?.title, "Renamed on another device")
    }

    // MARK: `applySynced*` preserves the pulled `updatedAt` verbatim (the LWW-corruption bug class)

    func testApplySyncedInstrumentPreservesThePulledUpdatedAtRatherThanStampingNow() throws {
        let store = store()
        let old = Date(timeIntervalSince1970: 1_700_000_000)
        let instrument = Instrument(id: UUID(), family: .keyboard, name: "Steinway", level: "Advanced", updatedAt: old)
        try store.applySyncedInstrument(instrument)
        XCTAssertEqual(store.state.instruments.first?.updatedAt, old, "The pulled record's real updatedAt must survive verbatim, not be replaced by this device's now().")
    }
    func testApplySyncedRuleSettingsPreservesThePulledUpdatedAt() throws {
        let store = store()
        let old = Date(timeIntervalSince1970: 1_700_000_000)
        var settings = RuleSettings(); settings.updatedAt = old
        try store.applySyncedRuleSettings(settings)
        XCTAssertEqual(store.state.ruleSettings.updatedAt, old)
    }
    func testApplySyncedRewardsStatePreservesThePulledUpdatedAt() throws {
        let store = store()
        let old = Date(timeIntervalSince1970: 1_700_000_000)
        var rewards = RewardsState(); rewards.updatedAt = old
        try store.applySyncedRewardsState(rewards)
        XCTAssertEqual(store.state.rewardsState.updatedAt, old)
    }
    func testApplySyncedProfilePreservesThePulledUpdatedAt() throws {
        let store = store()
        let old = Date(timeIntervalSince1970: 1_700_000_000)
        var profile = Profile(); profile.updatedAt = old
        try store.applySyncedProfile(profile)
        XCTAssertEqual(store.state.profile.updatedAt, old)
    }

    // MARK: `applySyncedSet`/`applySyncedAttempt` — splicing a pulled set without losing local reps

    func testApplySyncedSetNeverLosesAttemptsAlreadyLocalWhenTheSetRowItselfIsPulled() throws {
        let store = store()
        let piece = Piece(id: UUID(), title: "Sonata", pageCount: 2)
        try store.addPiece(piece)
        try store.startSet(PracticeConfiguration(pieceID: piece.id))
        try store.record(.clean)
        try store.record(.clean)
        let localSet = try XCTUnwrap(store.activeSet)
        XCTAssertEqual(localSet.attempts.count, 2)

        // A pulled "sets" row (e.g. the server's own current snapshot, or this exact device's own
        // rejected-push "adopt this" reply) never carries attempts — that is a separate table. Apply
        // it and confirm this device's own two locally-recorded reps are still there afterward, and
        // that a field `PracticeEngine.project` does not derive from attempts (`configuration.focus`)
        // still comes through from the pulled row, while a derived field (`currentBPM`) is correctly
        // *re-derived* from the (unchanged, still 2) attempts rather than trusting the remote row's
        // own cached value verbatim (see `applySyncedSet`'s own doc comment for why: the remote
        // device computed its cached fields against its own view of `.attempts`, which need not equal
        // this device's post-splice view).
        var incoming = localSet
        incoming.configuration.focus = "Renamed on another device"
        incoming.currentBPM = 999 // a remote-computed value this device must NOT trust verbatim
        incoming.attempts = [] // exactly what SetSyncRow.coreValue always produces — see its own doc comment
        try store.applySyncedSet(incoming)

        XCTAssertEqual(store.activeSet?.attempts.count, 2, "Applying a pulled set row must never wipe out this device's own already-recorded reps.")
        XCTAssertEqual(store.activeSet?.configuration.focus, "Renamed on another device", "A pulled, non-derived field must still apply.")
        XCTAssertEqual(store.activeSet?.currentBPM, PracticeEngine.project(localSet).currentBPM,
                        "currentBPM must be re-derived from this device's real (spliced) attempts, not trusted from the remote row.")
    }

    func testApplySyncedAttemptIsIdempotentAndFindsTheRightSetInHistory() throws {
        let store = store()
        let piece = Piece(id: UUID(), title: "Sonata", pageCount: 2)
        try store.addPiece(piece)
        try store.startSet(PracticeConfiguration(pieceID: piece.id, targetCount: 1))
        try store.record(.clean) // completes and immediately... stays active until endSet
        try store.endSet()
        let finished = try XCTUnwrap(store.state.history.last)
        XCTAssertEqual(finished.attempts.count, 1)

        // A second device's rep for the same (already-finished-on-this-device) set.
        let remoteAttempt = Attempt(verdict: .clean, bpm: 90)
        try store.applySyncedAttempt(remoteAttempt, setID: finished.id)
        XCTAssertEqual(store.state.history.last?.attempts.count, 2)

        // Re-applying the identical id must not duplicate it (sync_append's own "on conflict do
        // nothing" is the server half; this is the client-side half).
        try store.applySyncedAttempt(remoteAttempt, setID: finished.id)
        XCTAssertEqual(store.state.history.last?.attempts.count, 2, "A retried/duplicate pulled attempt must not be appended twice.")
    }

    func testApplySyncedUndoAttemptMarksTheRightAttemptUndoneAndIsIdempotent() throws {
        let store = store()
        let piece = Piece(id: UUID(), title: "Sonata", pageCount: 2)
        try store.addPiece(piece)
        try store.startSet(PracticeConfiguration(pieceID: piece.id))
        try store.record(.clean)
        let attemptID = try XCTUnwrap(store.activeSet?.attempts.first?.id)

        let undoneAt = Date()
        try store.applySyncedUndoAttempt(attemptID: attemptID, undoneAt: undoneAt)
        XCTAssertEqual(store.activeSet?.attempts.first?.undoneAt, undoneAt)

        // A second, later undo of the same id (e.g. a redundant pull) must not overwrite the first
        // undo's timestamp — sync_undo_attempt's own SQL only ever updates `where undone_at is null`.
        try store.applySyncedUndoAttempt(attemptID: attemptID, undoneAt: undoneAt.addingTimeInterval(60))
        XCTAssertEqual(store.activeSet?.attempts.first?.undoneAt, undoneAt, "A second undo of an already-undone attempt must be a no-op.")
    }

    // MARK: Append-only log dedup (`applySynced*` for the six remaining logs)

    func testAppendOnlyApplySyncedMethodsAreIdDeduplicated() throws {
        let store = store()
        let ruleEvent = RuleEvent(ruleID: .r1SmallChunks, reasonText: "Test")
        try store.applySyncedRuleEvent(ruleEvent); try store.applySyncedRuleEvent(ruleEvent)
        XCTAssertEqual(store.state.ruleEvents.count, 1)

        let ledgerEntry = RewardLedgerEntry(reason: "Test")
        try store.applySyncedRewardLedgerEntry(ledgerEntry); try store.applySyncedRewardLedgerEntry(ledgerEntry)
        XCTAssertEqual(store.state.rewardLedger.count, 1)

        let badge = Badge(key: "test_badge")
        try store.applySyncedBadge(badge); try store.applySyncedBadge(badge)
        XCTAssertEqual(store.state.badges.count, 1)
    }

    // MARK: `AnnotationSyncRow` — one SQL table, two Core types

    func testAnnotationSyncRowRoundTripsBothTextAndStampKindsThroughTheSharedShape() throws {
        let textAnnotation = TextBoxAnnotation(pieceID: UUID(), page: 1, region: NormalizedRect(x: 0, y: 0, width: 0.2, height: 0.1), text: "Watch the pedal")
        let textRow = AnnotationSyncRow(textAnnotation)
        XCTAssertEqual(textRow.kind, "text")
        XCTAssertNil(textRow.stamp_kind)
        XCTAssertEqual(textRow.textValue?.text, "Watch the pedal")
        XCTAssertNil(textRow.stampValue)

        let stamp = StampAnnotation(pieceID: UUID(), page: 1, position: NormalizedRect(x: 0.1, y: 0.1, width: 0.05, height: 0.05), kind: .fingering, label: "2")
        let stampRow = AnnotationSyncRow(stamp)
        XCTAssertEqual(stampRow.kind, "stamp")
        XCTAssertNil(stampRow.text)
        XCTAssertEqual(stampRow.stampValue?.kind, .fingering)
        XCTAssertNil(stampRow.textValue)
    }

    // MARK: `SetSyncRow`/`AttemptSyncRow` field mapping (spot checks against the SQL check constraints)

    func testSetSyncRowMapsEveryEnumToItsRawValueMatchingTheSQLCheckConstraints() throws {
        let piece = Piece(id: UUID(), title: "P", pageCount: 1)
        let configuration = PracticeConfiguration(pieceID: piece.id, goal: .phrasing, basis: .totalPlays)
        let set = ActiveSet(sessionID: UUID(), configuration: configuration)
        let row = SetSyncRow(set)
        XCTAssertEqual(row.goal, "phrasing")
        XCTAssertEqual(row.basis, "totalPlays")
        XCTAssertEqual(row.status, "running")
        XCTAssertNotNil(row.coreValue)
    }

    // MARK: Two full devices, many tables including reps — the spec §17a proof this pass adds.
    //
    // `SyncCoordinator` itself (app target, not this package — `AuthManager.state` has no test seam
    // to force `.signedIn` without a live network sign-in; see `PraeludeAppTests/
    // SyncCoordinatorCoverageTests.swift`'s own header for why that is a deliberate, pre-existing
    // boundary this pass does not weaken) is orchestration on top of exactly the primitives this test
    // drives directly: `SyncEngine.enqueueUpsert`/`enqueueAppend`/`drain`/`pull`, and
    // `PracticeStore.applySynced*`. Driving them in the same order `SyncCoordinator.syncSet(_:)`
    // documents (a set's whole-row upsert enqueued strictly before any of its attempts, every single
    // call) is the actual property spec §17a and this pass's own task both ask for, proven at the
    // layer this package can reach.
    func testTwoDevicesConvergeToIdenticalHistoryAcrossManyTablesIncludingReps() async throws {
        let server = FakeSyncServer()
        let deviceA = (engine: SyncEngine(transport: FakeSyncTransport(server: server), directory: directory()), store: store())
        let deviceB = (engine: SyncEngine(transport: FakeSyncTransport(server: server), directory: directory()), store: store())

        // Device A creates a piece, a tag, a passage-less practice set, and three reps on it.
        let pieceID = UUID()
        let piece = Piece(id: pieceID, title: "Chopin Nocturne", pageCount: 4)
        try deviceA.store.addPiece(piece)
        let tag = Tag(name: "Recital")
        try deviceA.store.saveTag(tag)
        try deviceA.store.startSet(PracticeConfiguration(pieceID: pieceID, targetCount: 100)) // high target: stays running
        try deviceA.store.record(.clean); try deviceA.store.record(.clean); try deviceA.store.record(.sloppy)
        let setA = try XCTUnwrap(deviceA.store.activeSet)
        XCTAssertEqual(setA.attempts.count, 3)
        let sessionA = try XCTUnwrap(deviceA.store.state.sessions.first { $0.id == setA.sessionID })

        // Push exactly the way SyncCoordinator.syncSet(_:)/pushTag/pushPiece do: parent rows (piece,
        // tag, session — sets.session_id is a hard FK, exactly like attempts.set_id) upserted, then
        // the set upserted, then every one of its attempts appended in order.
        try deviceA.engine.enqueueUpsert(table: "pieces", row: SyncJSON(encoding: PieceSyncRow(piece)).objectValue!)
        try deviceA.engine.enqueueUpsert(table: "tags", row: SyncJSON(encoding: TagSyncRow(tag)).objectValue!)
        try deviceA.engine.enqueueUpsert(table: "practice_sessions", row: SyncJSON(encoding: PracticeSessionSyncRow(sessionA)).objectValue!)
        try deviceA.engine.enqueueUpsert(table: "sets", row: SyncJSON(encoding: SetSyncRow(setA)).objectValue!)
        for attempt in setA.attempts {
            try deviceA.engine.enqueueAppend(table: "attempts", row: SyncJSON(encoding: AttemptSyncRow(attempt, setID: setA.id)).objectValue!)
        }
        let drained = await deviceA.engine.drain()
        XCTAssertTrue(drained, "Every entry (parents before the set, the set before its attempts) must drain in one pass with no FK rejection.")
        XCTAssertEqual(deviceA.engine.pendingCount, 0)

        // Device B — a completely fresh device on the same account — pulls everything.
        for table in ["pieces", "tags", "practice_sessions", "sets"] {
            try await deviceB.engine.pull(table: table) { row in
                do {
                    switch table {
                    case "pieces": try deviceB.store.applySyncedPiece(try SyncJSON.object(row).decoded(as: PieceSyncRow.self).coreValue!)
                    case "tags": try deviceB.store.applySyncedTag(try SyncJSON.object(row).decoded(as: TagSyncRow.self).coreValue)
                    case "practice_sessions": try deviceB.store.applySyncedSession(try SyncJSON.object(row).decoded(as: PracticeSessionSyncRow.self).coreValue)
                    case "sets": try deviceB.store.applySyncedSet(try SyncJSON.object(row).decoded(as: SetSyncRow.self).coreValue!)
                    default: break
                    }
                } catch { XCTFail("apply \(table) failed: \(error)") }
            }
        }
        try await deviceB.engine.pull(table: "attempts", cursorField: "date") { row in
            guard let setIDString = row["set_id"]?.stringValue, let setID = UUID(uuidString: setIDString) else { return }
            do { try deviceB.store.applySyncedAttempt(try SyncJSON.object(row).decoded(as: AttemptSyncRow.self).coreValue!, setID: setID) }
            catch { XCTFail("apply attempt failed: \(error)") }
        }

        // Convergence: device B (which started completely empty) now has the same piece, tag, and
        // set-with-all-three-reps device A does — "incl. reps", the append-only log included.
        XCTAssertEqual(deviceB.store.state.pieces.first?.id, pieceID)
        XCTAssertEqual(deviceB.store.state.pieces.first?.title, "Chopin Nocturne")
        XCTAssertEqual(deviceB.store.state.tags.first?.name, "Recital")
        let convergedSet = try XCTUnwrap(deviceB.store.activeSet ?? deviceB.store.state.history.first { $0.id == setA.id })
        XCTAssertEqual(convergedSet.attempts.map(\.id).sorted { $0.uuidString < $1.uuidString },
                        setA.attempts.map(\.id).sorted { $0.uuidString < $1.uuidString },
                        "Device B must converge to the exact same set of reps device A recorded — none lost, none duplicated.")
        XCTAssertEqual(convergedSet.attempts.map(\.verdict.rawValue).sorted(), setA.attempts.map(\.verdict.rawValue).sorted())
    }

    func testAttemptSyncRowNeverEncodesAnUndoneAtOnPushButDecodesOneOnPull() throws {
        let attempt = Attempt(verdict: .sloppy, bpm: 72)
        let pushed = AttemptSyncRow(attempt, setID: UUID())
        XCTAssertNil(pushed.undone_at, "A freshly-recorded attempt must never push a non-nil undone_at — see the type's own doc comment.")

        var pulled = pushed
        pulled.undone_at = Date(timeIntervalSince1970: 1_700_000_100)
        XCTAssertEqual(pulled.coreValue?.undoneAt, pulled.undone_at, "A pulled row that was already undone elsewhere must decode as undone, not reset to active.")
    }
}
