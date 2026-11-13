import Foundation
import XCTest
@testable import PraeludeCore

@MainActor final class AccountPreferencesSyncTests: XCTestCase {
    private func directory() -> URL { FileManager.default.temporaryDirectory.appendingPathComponent("preferences-sync-\(UUID())") }
    func testPreferencesWireRoundTripAndRemoteClockSurvivesStorage() throws {
        var value = Preferences()
        value.showPassageBoxes = false; value.compactScoreControls = false
        value.autoTurnPassageAfterVerdict = true; value.theme = "dark"
        value.updatedAt = Date(timeIntervalSince1970: 1_720_000_000)
        let row = AccountPreferencesSyncRow(value)
        let decoded = try SyncJSON(encoding: row).decoded(as: AccountPreferencesSyncRow.self)
        XCTAssertEqual(decoded.coreValue, value)
        let store = PracticeStore(directory: directory())
        try store.applySyncedPreferences(decoded.coreValue)
        XCTAssertEqual(store.preferences, value)
        let reopened = PracticeStore(directory: store.directory)
        XCTAssertEqual(reopened.preferences, value)
    }
    func testFreshDeviceDoesNotOverwriteAccountSettingsButOfflineEditQueues() throws {
        let engine = SyncEngine(transport: FakeSyncTransport(server: FakeSyncServer()), directory: directory())
        var library = LibraryState()
        try engine.enqueueLibrarySnapshot(library)
        XCTAssertFalse(engine.hasSnapshot(table: "account_preferences"))
        library.preferences.showPassageBoxes = false
        library.preferences.updatedAt = Date(timeIntervalSince1970: 1_730_000_000)
        try engine.enqueueLibrarySnapshot(library)
        XCTAssertTrue(engine.hasSnapshot(table: "account_preferences"))
        let count = engine.pendingCount
        try engine.enqueueLibrarySnapshot(library)
        XCTAssertEqual(engine.pendingCount, count)
    }
    func testOlderPreferencesDecodeWithoutResettingTheirKnownChoices() throws {
        let data = Data(#"{"keepScreenAwake":false,"metronomeHaptics":true,"voiceEnabled":false,"theme":"light"}"#.utf8)
        let value = try JSONDecoder().decode(Preferences.self, from: data)
        XCTAssertFalse(value.keepScreenAwake); XCTAssertTrue(value.metronomeHaptics)
        XCTAssertTrue(value.showPassageBoxes); XCTAssertTrue(value.compactScoreControls)
        XCTAssertFalse(value.autoTurnPassageAfterVerdict)
    }
    func testServerAdvancedClockDoesNotEchoPreferencesOnNextSnapshot() throws {
        let path = directory(); defer { try? FileManager.default.removeItem(at: path) }
        let engine = SyncEngine(transport: FakeSyncTransport(server: FakeSyncServer()), directory: path)
        var older = Preferences(); older.showPassageBoxes = false
        older.updatedAt = Date(timeIntervalSince1970: 1_730_000_000)
        let serverClock = older.updatedAt.addingTimeInterval(100)
        var wire = try XCTUnwrap(SyncJSON(encoding: AccountPreferencesSyncRow(older)).objectValue)
        wire["updated_at"] = .string(SyncCoding.iso8601Formatter.string(from: serverClock))
        let dto = try SyncJSON.object(wire).decoded(as: AccountPreferencesSyncRow.self)
        XCTAssertEqual(dto.preferences.updatedAt, serverClock)
        try engine.acknowledgePulledRow(table: "account_preferences", row: try XCTUnwrap(SyncJSON(encoding: dto).objectValue))
        var library = LibraryState(); library.preferences = dto.coreValue
        try engine.enqueueLibrarySnapshot(library)
        XCTAssertEqual(engine.pendingCount, 0, "The authoritative server clock must also normalize the nested JSON cache clock.")
    }
}
