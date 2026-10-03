import Foundation

/// Platform-neutral account preferences. Hardware permissions, microphone state and a live
/// metronome never travel with these choices; each device grants permissions and starts audio.
public struct AccountPreferencesSyncRow: Codable, Equatable, Sendable {
    public var preferences: Preferences
    public var created_at: Date
    public var updated_at: Date

    public init(_ preferences: Preferences) {
        self.preferences = preferences
        created_at = preferences.updatedAt
        updated_at = preferences.updatedAt
    }
    private enum CodingKeys: String, CodingKey { case preferences, created_at, updated_at }
    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        preferences = try values.decode(Preferences.self, forKey: .preferences)
        created_at = try values.decode(Date.self, forKey: .created_at)
        updated_at = try values.decode(Date.self, forKey: .updated_at)
        // The server may advance its LWW clock. Normalize the nested cache clock too so an
        // acknowledged pull compares equal to the next local snapshot instead of echoing forever.
        preferences.updatedAt = updated_at
    }
    public var coreValue: Preferences {
        var value = preferences
        value.updatedAt = updated_at
        return value
    }
}
