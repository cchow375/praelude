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

    // MARK: Ink stroke sync (`ink_strokes`) — blocker regression (verifier "reader lens", 2026-09-29)
    //
    // `InkStrokeSyncRow` used to have no `fingerprint` field at all, so a pulled row always decoded
    // with `fingerprint == nil` regardless of what the pushing device sent — see the type's own doc
    // comment in `SyncDTO.swift` and `ios/supabase/migrations/20260926220023_ink_strokes_add_fingerprint.sql`.

    func testInkStrokeSyncRowRoundTripsFingerprintThroughJSON() throws {
        let stroke = InkStroke(pieceID: UUID(), page: 1, layer: .mine, data: Data([1, 2, 3]), fingerprint: Data([0xAA, 0xBB]))
        let row = try XCTUnwrap(InkStrokeSyncRow(stroke))
        let json = try SyncCoding.encoder.encode(row)
        let decoded = try SyncCoding.decoder.decode(InkStrokeSyncRow.self, from: json)
        let roundTripped = try XCTUnwrap(decoded.coreValue)
        XCTAssertEqual(roundTripped.fingerprint, stroke.fingerprint, "The fingerprint must survive the wire round trip")
        XCTAssertEqual(roundTripped.data, stroke.data)
    }

    func testInkWireHexPreservesEveryByteAndLargeSlicedData() throws {
        XCTAssertEqual(Data().praeludeHexLiteral, "\\x")
        XCTAssertEqual(Data([0, 1, 15, 16, 127, 128, 254, 255]).praeludeHexLiteral,
                       "\\x00010f107f80feff")
        let bytes = Data((0..<131_072).map { UInt8(truncatingIfNeeded: $0) })
        let slice = bytes.dropFirst(17).dropLast(11)
        let encoded = slice.praeludeHexLiteral
        XCTAssertEqual(encoded.utf8.count, slice.count * 2 + 2)
        XCTAssertEqual(Data(praeludeHexLiteral: encoded), slice)
        XCTAssertEqual(Data(praeludeHexLiteral: String(encoded.dropFirst(2))), slice)
    }

    func testConcurrentSyncDateCodingKeepsTheExistingWireFormat() async throws {
        let dates = (0..<128).map { Date(timeIntervalSince1970: 1_700_000_000 + Double($0) * 0.123456) }
        let expected = dates.map { SyncCoding.iso8601Formatter.string(from: $0) }
        let encoded = try await withThrowingTaskGroup(of: (Int, String).self) { group in
            for (index, date) in dates.enumerated() {
                group.addTask {
                    let bytes = try SyncCoding.encoder.encode(["date": date])
                    let row = try JSONDecoder().decode([String: String].self, from: bytes)
                    return (index, try XCTUnwrap(row["date"]))
                }
            }
            var values = [String](repeating: "", count: dates.count)
            for try await (index, value) in group { values[index] = value }
            return values
        }
        XCTAssertEqual(encoded, expected)
        for (date, text) in zip(dates, encoded) {
            XCTAssertEqual(try XCTUnwrap(SyncCoding.parseDate(text)).timeIntervalSince1970,
                           date.timeIntervalSince1970, accuracy: 0.001)
        }
    }

    /// A row written before this fix — or by the whole-page compatibility shim, which never computes
    /// a fingerprint at all — has none. It must still decode, with `fingerprint == nil`, not fail.
    func testInkStrokeSyncRowWithNoFingerprintStillDecodes() throws {
        let stroke = InkStroke(pieceID: UUID(), page: 1, layer: .mine, data: Data([9]))
        let row = try XCTUnwrap(InkStrokeSyncRow(stroke))
        XCTAssertNil(row.fingerprint)
        let json = try SyncCoding.encoder.encode(row)
        let decoded = try SyncCoding.decoder.decode(InkStrokeSyncRow.self, from: json)
        XCTAssertNil(decoded.coreValue?.fingerprint)
    }

    /// The end-to-end failure this DTO gap caused (audit probe P9): a second "device" pulls strokes
    /// through the sync row, then saves an edit through the exact `replaceInk` path a real canvas
    /// save uses. Before this fix, the pulled rows' lost fingerprints made every unchanged stroke look
    /// "new" on the next save, tombstoning and recreating each one under an id that collided with the
    /// row just tombstoned in the very same transaction — failing the whole page. `applySyncedInkStroke`
    /// is what a real `SyncCoordinator` pull calls (`SyncCoordinator.swift`); this proves the Core half
    /// without needing PencilKit or the app target — see `AnnotationAppTests.swift` for the PencilKit-
    /// level probes of the same `replaceInk` path.
    @MainActor func testDeviceBCanSaveAfterPullingInkThatKeptItsFingerprintThroughSync() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("praelude-ink-sync-\(UUID())")
        let deviceB = PracticeStore(directory: directory)
        defer { try? FileManager.default.removeItem(at: directory) }
        var piece = Piece(title: "Test score", pageCount: 1); piece.pdfFileName = "fixture.pdf"
        try deviceB.addPiece(piece)
        // Device A's original strokes, exactly as they would arrive over the wire.
        let fingerprintA = Data([0x01, 0x02])
        let fingerprintB = Data([0x03, 0x04])
        let strokeA = InkStroke(pieceID: piece.id, page: 1, layer: .mine, data: Data([0xA0]), fingerprint: fingerprintA)
        let strokeB = InkStroke(pieceID: piece.id, page: 1, layer: .mine, data: Data([0xB0]), fingerprint: fingerprintB)
        for stroke in [strokeA, strokeB] {
            let row = try XCTUnwrap(InkStrokeSyncRow(stroke))
            let json = try SyncCoding.encoder.encode(row)
            let pulled = try SyncCoding.decoder.decode(InkStrokeSyncRow.self, from: json)
            try deviceB.applySyncedInkStroke(try XCTUnwrap(pulled.coreValue))
        }
        XCTAssertEqual(deviceB.inkStrokes(pieceID: piece.id, page: 1).map(\.fingerprint), [fingerprintA, fingerprintB],
                       "A pulled row must keep its fingerprint, not decode to nil")
        // Device B re-splits the same two strokes — independently re-serialized, so different `data`
        // but the same fingerprint, exactly what a real PKDrawing round trip produces — plus one new
        // stroke of its own.
        try deviceB.replaceInk(pieceID: piece.id, page: 1, layer: .mine, strokes: [
            .init(data: Data([0xA1]), fingerprint: fingerprintA),
            .init(data: Data([0xB1]), fingerprint: fingerprintB),
            .init(data: Data([0xC0]), fingerprint: Data([0x05, 0x06])),
        ])
        let rows = deviceB.inkStrokes(pieceID: piece.id, page: 1)
        XCTAssertEqual(rows.count, 3, "The two synced strokes must be recognized as unchanged, not tombstoned and duplicated")
        XCTAssertEqual(Set(rows.map(\.fingerprint)), [fingerprintA, fingerprintB, Data([0x05, 0x06])])
        try PracticeStore.validate(deviceB.state)
    }
    @MainActor func testRemoteUndoMergesIntoAnAlreadyPulledRepAndNeverResurrectsIt() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("praelude-sync-undo-\(UUID())")
        let store = PracticeStore(directory: directory)
        defer { try? FileManager.default.removeItem(at: directory) }
        let piece = Piece(title: "Sonata")
        try store.addPiece(piece)
        try store.startSet(PracticeConfiguration(pieceID: piece.id, targetCount: 100))
        try store.record(.clean)
        let set = try XCTUnwrap(store.activeSet)
        var attempt = try XCTUnwrap(set.attempts.first)
        attempt.undoneAt = Date()
        try store.applySyncedAttempt(attempt, setID: set.id)
        XCTAssertEqual(store.activeSet?.attempts.count, 1)
        XCTAssertEqual(store.activeSet?.attempts.first?.undoneAt, attempt.undoneAt)
        XCTAssertEqual(store.activeSet?.totalPlays, 0)
        attempt.undoneAt = nil
        try store.applySyncedAttempt(attempt, setID: set.id)
        XCTAssertNotNil(store.activeSet?.attempts.first?.undoneAt)
        XCTAssertEqual(store.activeSet?.totalPlays, 0)
    }

    @MainActor func testIndependentLastPageClockMergesWithoutOverwritingNewerPieceMetadata() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("praelude-page-clock-\(UUID())")
        let store = PracticeStore(directory: directory)
        defer { try? FileManager.default.removeItem(at: directory) }
        let local = Piece(title: "Local new title", pageCount: 10, lastPage: 2,
                          updatedAt: Date(timeIntervalSince1970: 200), lastPageUpdatedAt: Date(timeIntervalSince1970: 100))
        try store.addPiece(local)
        var remote = local
        remote.title = "Old title"; remote.updatedAt = Date(timeIntervalSince1970: 150)
        remote.lastPage = 7; remote.lastPageUpdatedAt = Date(timeIntervalSince1970: 300)
        try store.applySyncedPiece(remote)
        XCTAssertEqual(store.pieces.first?.title, "Local new title")
        XCTAssertEqual(store.pieces.first?.lastPage, 7)
    }

    @MainActor func testOrphanedRemoteRepReportsFailureSoItCanBeRetried() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("praelude-sync-orphan-\(UUID())")
        let store = PracticeStore(directory: directory)
        defer { try? FileManager.default.removeItem(at: directory) }
        XCTAssertThrowsError(try store.applySyncedAttempt(Attempt(verdict: .clean, bpm: 60), setID: UUID()))
    }

    @MainActor func testLargeRemoteRepLogMergesWithOneDurableLibraryWrite() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("praelude-sync-batch-\(UUID())")
        var writes = 0
        let store = PracticeStore(directory: directory, writeData: { data, url in
            writes += 1; try data.write(to: url, options: .atomic)
        })
        defer { try? FileManager.default.removeItem(at: directory) }
        let piece = Piece(title: "Sonata")
        try store.addPiece(piece)
        try store.startSet(PracticeConfiguration(pieceID: piece.id, targetCount: 100))
        let set = try XCTUnwrap(store.activeSet)
        let attempts = (0..<1505).map { (attempt: Attempt(verdict: .sloppy, date: set.startedAt.addingTimeInterval(Double($0)), bpm: 60), setID: set.id) }
        let initialWrites = writes
        try store.applySyncedAttempts(attempts)
        XCTAssertEqual(writes - initialWrites, 1)
        XCTAssertEqual(store.activeSet?.attempts.count, 1505)
        try store.applySyncedAttempts(attempts)
        XCTAssertEqual(writes - initialWrites, 1, "An unchanged second pull does not rewrite the library.")
    }

    @MainActor func testFreshDevicePullsRealCompletedHistoryAsOneValidatedPracticeSnapshot() async throws {
        let sourceURL = FileManager.default.temporaryDirectory.appendingPathComponent("praelude-sync-complete-source-\(UUID())")
        let destinationURL = FileManager.default.temporaryDirectory.appendingPathComponent("praelude-sync-complete-destination-\(UUID())")
        defer { try? FileManager.default.removeItem(at: sourceURL); try? FileManager.default.removeItem(at: destinationURL) }
        let source = PracticeStore(directory: sourceURL)
        let piece = Piece(title: "Sonata")
        try source.addPiece(piece)
        try source.startSet(PracticeConfiguration(pieceID: piece.id, targetCount: 1))
        try source.record(.clean)
        try source.endSession()
        let completed = try XCTUnwrap(source.state.history.first)
        XCTAssertEqual(completed.status, .completed)
        var writes = 0
        let destination = PracticeStore(directory: destinationURL, writeData: { data, url in writes += 1; try data.write(to: url, options: .atomic) })
        try destination.addPiece(piece)
        let server = FakeSyncServer()
        let writer = SyncEngine(transport: FakeSyncTransport(server: server), directory: sourceURL.appendingPathComponent("Sync"))
        try writer.enqueueLibrarySnapshot(source.state)
        let drained = await writer.drain(); XCTAssertTrue(drained)
        let reader = SyncEngine(transport: FakeSyncTransport(server: server), directory: destinationURL.appendingPathComponent("Sync"))
        let initialWrites = writes
        try await reader.pullPracticeSnapshot { rows in
            let sessions = try (rows["practice_sessions"] ?? []).map { try SyncJSON.object($0).decoded(as: PracticeSessionSyncRow.self).coreValue }
            let sets = try (rows["sets"] ?? []).map { try XCTUnwrap(try SyncJSON.object($0).decoded(as: SetSyncRow.self).coreValue) }
            let attempts = try (rows["attempts"] ?? []).map { row -> (attempt: Attempt, setID: UUID) in
                let dto = try SyncJSON.object(row).decoded(as: AttemptSyncRow.self)
                return (try XCTUnwrap(dto.coreValue), dto.set_id)
            }
            try destination.applySyncedPracticeSnapshot(sessions: sessions, sets: sets, attempts: attempts)
        }
        XCTAssertEqual(writes - initialWrites, 1)
        XCTAssertNil(destination.activeSet)
        XCTAssertEqual(destination.state.history.first?.status, .completed)
        XCTAssertEqual(destination.state.history.first?.attempts.map(\.id), completed.attempts.map(\.id))
        XCTAssertEqual(destination.sessions.first?.completedSets, 1)
        XCTAssertTrue(destination.state.rewardLedger.isEmpty, "Practice replication must not invent earned reward events.")
        XCTAssertTrue(destination.state.ruleEvents.isEmpty)
        XCTAssertTrue(destination.state.milestoneEvents.isEmpty)
        XCTAssertNotNil(destination.sessions.first?.endedAt)
        try PracticeStore.validate(destination.state)
    }

    @MainActor func testRemoteSessionClosureAndItsSetAreAppliedAtomicallyToAMirroredActiveSet() throws {
        let sourceURL = FileManager.default.temporaryDirectory.appendingPathComponent("praelude-sync-close-source-\(UUID())")
        let destinationURL = FileManager.default.temporaryDirectory.appendingPathComponent("praelude-sync-close-destination-\(UUID())")
        defer { try? FileManager.default.removeItem(at: sourceURL); try? FileManager.default.removeItem(at: destinationURL) }
        let source = PracticeStore(directory: sourceURL), destination = PracticeStore(directory: destinationURL)
        let piece = Piece(title: "Sonata")
        try source.addPiece(piece); try destination.addPiece(piece)
        try source.startSet(PracticeConfiguration(pieceID: piece.id, targetCount: 3))
        try source.record(.clean); try source.pause()
        let paused = try XCTUnwrap(source.activeSet)
        try destination.applySyncedPracticeSnapshot(sessions: source.sessions, sets: [try XCTUnwrap(SetSyncRow(paused).coreValue)],
                                                   attempts: paused.attempts.map { ($0, paused.id) })
        XCTAssertEqual(destination.activeSet?.status, .paused)
        try source.endSession()
        let ended = try XCTUnwrap(source.state.history.first)
        try destination.applySyncedPracticeSnapshot(sessions: source.sessions, sets: [try XCTUnwrap(SetSyncRow(ended).coreValue)],
                                                   attempts: ended.attempts.map { ($0, ended.id) })
        XCTAssertNil(destination.activeSet)
        XCTAssertEqual(destination.state.history.first?.status, .ended)
        XCTAssertEqual(destination.state.history.first?.attempts, ended.attempts)
        XCTAssertNotNil(destination.sessions.first?.endedAt)
        try PracticeStore.validate(destination.state)
    }

    @MainActor func testIncompleteCompletedPracticeSnapshotPreservesLibraryAndAllPullCursors() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("praelude-sync-partial-\(UUID())")
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = PracticeStore(directory: directory)
        let piece = Piece(title: "Sonata")
        try store.addPiece(piece); try store.startSet(PracticeConfiguration(pieceID: piece.id, targetCount: 1))
        try store.record(.clean); try store.endSession()
        let set = try XCTUnwrap(store.state.history.first), session = try XCTUnwrap(store.sessions.first)
        let server = FakeSyncServer()
        _ = try server.upsert(table: "practice_sessions", row: try XCTUnwrap(SyncJSON(encoding: PracticeSessionSyncRow(session)).objectValue))
        _ = try server.upsert(table: "sets", row: try XCTUnwrap(SyncJSON(encoding: SetSyncRow(set)).objectValue))
        let reader = SyncEngine(transport: FakeSyncTransport(server: server), directory: directory.appendingPathComponent("Sync"))
        let receiver = PracticeStore(directory: directory.appendingPathComponent("Receiver"))
        try receiver.addPiece(piece)
        let previous = try Data(contentsOf: receiver.fileURL)
        do {
            try await reader.pullPracticeSnapshot { _ in
                try receiver.applySyncedPracticeSnapshot(sessions: [session], sets: [try XCTUnwrap(SetSyncRow(set).coreValue)], attempts: [])
            }
            XCTFail("A completed snapshot without its rep log must fail rather than invent completion.")
        } catch {}
        XCTAssertTrue(reader.state.cursors.isEmpty)
        XCTAssertEqual(try Data(contentsOf: receiver.fileURL), previous)
    }

    func testGoalAndRoutineDTOsRoundTripEveryEditableFieldAndTombstone() throws {
        let created = Date(timeIntervalSince1970: 1_700_000_000)
        let changed = created.addingTimeInterval(100)
        let goal = PracticeGoal(title: "Opening from memory", pieceID: UUID(), dueDate: changed,
            isComplete: true, createdAt: created, updatedAt: changed, deletedAt: changed)
        let routine = PracticeRoutine(name: "Hands", stages: PracticeTechnique.hands.stages(targetCount: 7),
            createdAt: created, updatedAt: changed, deletedAt: changed)
        XCTAssertEqual(try SyncJSON(encoding: PracticeGoalSyncRow(goal)).decoded(as: PracticeGoalSyncRow.self).coreValue, goal)
        XCTAssertEqual(try SyncJSON(encoding: PracticeRoutineSyncRow(routine)).decoded(as: PracticeRoutineSyncRow.self).coreValue, routine)
    }

    func testGoalAndRoutineSnapshotSyncConvergesEditsAndDeletionWithoutResurrection() async throws {
        let directory = directory()
        defer { try? FileManager.default.removeItem(at: directory) }
        var clock = Date(timeIntervalSince1970: 1_700_000_000)
        let source = PracticeStore(directory: directory.appendingPathComponent("A"), now: { clock })
        let target = PracticeStore(directory: directory.appendingPathComponent("B"))
        let server = FakeSyncServer()
        let writer = SyncEngine(transport: FakeSyncTransport(server: server), directory: directory.appendingPathComponent("ASync"))
        let reader = SyncEngine(transport: FakeSyncTransport(server: server), directory: directory.appendingPathComponent("BSync"))
        let piece = Piece(title: "Sonata")
        try source.addPiece(piece)
        let goal = PracticeGoal(title: "Opening", pieceID: piece.id, dueDate: clock.addingTimeInterval(3600), createdAt: clock, updatedAt: clock)
        let routine = PracticeRoutine(name: "Hands", stages: PracticeTechnique.hands.stages(), createdAt: clock, updatedAt: clock)
        try source.saveGoal(goal); try source.saveRoutine(routine)
        func pull() async throws {
            try await reader.pull(table: "pieces") { row in
                try target.applySyncedPiece(try XCTUnwrap(SyncJSON.object(row).decoded(as: PieceSyncRow.self).coreValue))
            }
            try await reader.pull(table: "practice_goals") { row in
                let value = try SyncJSON.object(row).decoded(as: PracticeGoalSyncRow.self).coreValue
                if LastWriteWins.shouldApplyPulled(pulledUpdatedAt: value.updatedAt,
                    localUpdatedAt: target.state.goals.first { $0.id == value.id }?.updatedAt ?? .distantPast) {
                    try target.applySyncedGoal(value)
                }
            }
            try await reader.pull(table: "practice_routines") { row in
                let value = try SyncJSON.object(row).decoded(as: PracticeRoutineSyncRow.self).coreValue
                if LastWriteWins.shouldApplyPulled(pulledUpdatedAt: value.updatedAt,
                    localUpdatedAt: target.state.routines.first { $0.id == value.id }?.updatedAt ?? .distantPast) {
                    try target.applySyncedRoutine(value)
                }
            }
        }
        try writer.enqueueLibrarySnapshot(source.state)
        let firstDrain = await writer.drain(); XCTAssertTrue(firstDrain)
        try await pull()
        XCTAssertEqual(target.state.goals, source.state.goals); XCTAssertEqual(target.state.routines, source.state.routines)
        let staleGoal = try XCTUnwrap(target.state.goals.first)
        let staleRoutine = try XCTUnwrap(target.state.routines.first)
        clock = clock.addingTimeInterval(100)
        var editedGoal = staleGoal; editedGoal.isComplete = true; editedGoal.title = "Opening memorized"
        var editedRoutine = staleRoutine; editedRoutine.stages = PracticeTechnique.leftHand.stages(targetCount: 9)
        try source.saveGoal(editedGoal); try source.saveRoutine(editedRoutine)
        try writer.enqueueLibrarySnapshot(source.state)
        let editDrain = await writer.drain(); XCTAssertTrue(editDrain)
        try await pull()
        XCTAssertEqual(target.state.goals.first?.title, "Opening memorized")
        XCTAssertEqual(target.state.routines.first?.stages.first?.targetCount, 9)
        clock = clock.addingTimeInterval(100)
        try source.deleteGoal(goal.id); try source.deleteRoutine(routine.id)
        try writer.enqueueLibrarySnapshot(source.state)
        let deleteDrain = await writer.drain(); XCTAssertTrue(deleteDrain)
        try await pull()
        XCTAssertEqual(target.state.goals, source.state.goals); XCTAssertEqual(target.state.routines, source.state.routines)
        XCTAssertNotNil(target.state.goals.first?.deletedAt); XCTAssertNotNil(target.state.routines.first?.deletedAt)
        try reader.enqueueUpsert(table: "practice_goals", row: try XCTUnwrap(SyncJSON(encoding: PracticeGoalSyncRow(staleGoal)).objectValue))
        try reader.enqueueUpsert(table: "practice_routines", row: try XCTUnwrap(SyncJSON(encoding: PracticeRoutineSyncRow(staleRoutine)).objectValue))
        let staleDrain = await reader.drain(); XCTAssertTrue(staleDrain)
        try await pull()
        XCTAssertNotNil(target.state.goals.first?.deletedAt); XCTAssertNotNil(target.state.routines.first?.deletedAt)
        let reopened = PracticeStore(directory: target.fileURL.deletingLastPathComponent())
        XCTAssertEqual(reopened.state.goals, source.state.goals); XCTAssertEqual(reopened.state.routines, source.state.routines)
    }

}
