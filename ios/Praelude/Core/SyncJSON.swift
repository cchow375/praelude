import Foundation

/// A generic JSON value, so the sync engine (`SyncTransport`, `SyncEngine`) and every table DTO in
/// `SyncDTO.swift` can stay Foundation-only — no Supabase SDK type leaks into `Core` (see
/// "(C) Schema3.md": Core depends on nothing beyond Foundation). `PostgrestClient.rpc(_:params:)`
/// only needs `some Encodable`, so this type crosses into the Services layer (which does import the
/// SDK) as a plain `Encodable`/`Decodable` value with no bridging type required.
public indirect enum SyncJSON: Equatable, Sendable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([SyncJSON])
    case object([String: SyncJSON])

    public var objectValue: [String: SyncJSON]? { if case .object(let value) = self { return value } else { return nil } }
    public var stringValue: String? { if case .string(let value) = self { return value } else { return nil } }
    public var boolValue: Bool? { if case .bool(let value) = self { return value } else { return nil } }
    public var doubleValue: Double? { if case .number(let value) = self { return value } else { return nil } }
    public var arrayValue: [SyncJSON]? { if case .array(let value) = self { return value } else { return nil } }
    public var isNull: Bool { if case .null = self { return true } else { return false } }
}

extension SyncJSON: Codable {
    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() { self = .null; return }
        if let value = try? container.decode(Bool.self) { self = .bool(value); return }
        if let value = try? container.decode(Double.self) { self = .number(value); return }
        if let value = try? container.decode(String.self) { self = .string(value); return }
        if let value = try? container.decode([SyncJSON].self) { self = .array(value); return }
        if let value = try? container.decode([String: SyncJSON].self) { self = .object(value); return }
        throw DecodingError.dataCorruptedError(in: container, debugDescription: "Unrecognized JSON value")
    }
    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .null: try container.encodeNil()
        case .bool(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .string(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .object(let value): try container.encode(value)
        }
    }
}

extension SyncJSON {
    /// Round-trips any `Encodable` DTO through `SyncCoding`'s wire-format encoder into a generic
    /// `.object` value, so a per-table DTO's own `CodingKeys` (the exact SQL column spelling) is
    /// the only place that mapping is written down (see "(C) Sync Protocol.md" §3).
    public init<T: Encodable>(encoding value: T) throws {
        let data = try SyncCoding.encoder.encode(value)
        self = try SyncCoding.decoder.decode(SyncJSON.self, from: data)
    }
    /// The inverse of `init(encoding:)`: decodes a generic `.object` pulled from the wire back into
    /// a concrete DTO type.
    public func decoded<T: Decodable>(as type: T.Type) throws -> T {
        let data = try SyncCoding.encoder.encode(self)
        return try SyncCoding.decoder.decode(T.self, from: data)
    }
}
