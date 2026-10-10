import Foundation

/// The wire-format JSON encoder/decoder for everything crossing the sync boundary (§3 of
/// "(C) Sync Protocol.md"). Deliberately separate from `PracticeStore`'s own `encoder()`/`decoder()`
/// (`.deferredToDate`, for `library.json` on disk) — `timestamptz` needs ISO 8601 text, not
/// `Date`'s raw reference-seconds `Double`. Every sync DTO in `SyncDTO.swift` is encoded/decoded
/// through these, never through a type's own ad hoc `JSONEncoder()`.
public enum SyncCoding {
    private static let dates = SyncDateCodec()
    public static var encoder: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .custom { date, encoder in
            var container = encoder.singleValueContainer()
            try container.encode(dates.string(from: date))
        }
        return encoder
    }
    public static var decoder: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let text = try container.decode(String.self)
            guard let date = parseDate(text) else {
                throw DecodingError.dataCorruptedError(in: container, debugDescription: "Invalid sync timestamp.")
            }
            return date
        }
        return decoder
    }
    /// For the few call sites that need a bare ISO 8601 string rather than a whole encoded payload —
    /// e.g. a `PostgrestClient.rpc` parameter struct whose own default encoder's date strategy this
    /// app does not control and should not depend on (see `PostgRESTSyncTransport`). A computed
    /// property, not a shared `static let` instance, for the same reason `encoder`/`decoder` above
    /// are: `ISO8601DateFormatter` is a mutable Foundation class, not `Sendable`, so a single shared
    /// instance is not safe to read from more than one isolation context at once under Swift 6's
    /// strict concurrency checking (this app target builds with `SWIFT_VERSION = 6.0`).
    public static var iso8601Formatter: ISO8601DateFormatter {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }
    public static func parseDate(_ value: String) -> Date? {
        dates.date(from: value)
    }
    public static func string(from date: Date) -> String { dates.string(from: date) }
}

/// Reuse ICU formatter setup without exposing mutable formatters across executors. Every access
/// to these private instances holds the same lock; the wire format and parsing fallback are unchanged.
private final class SyncDateCodec: @unchecked Sendable {
    private let lock = NSLock()
    private let fractional = SyncCoding.iso8601Formatter
    private let wholeSeconds = ISO8601DateFormatter()

    func string(from date: Date) -> String {
        lock.lock(); defer { lock.unlock() }
        return fractional.string(from: date)
    }
    func date(from value: String) -> Date? {
        lock.lock(); defer { lock.unlock() }
        return fractional.date(from: value) ?? wholeSeconds.date(from: value)
    }
}

extension Data {
    /// Postgres `bytea` textual-input format: `\x` followed by lowercase hex pairs. Swift's `Data`
    /// encodes to base64 by default, which `bytea`'s input function does not accept — verified
    /// against a live copy of this schema, see "(C) Sync Protocol.md" §3. Used for
    /// `ink_strokes.data`/`.fingerprint`, the only `bytea` columns this sync engine touches.
    public var praeludeHexLiteral: String {
        // Ink can contain megabytes. Formatting every byte through NSString/locale machinery
        // occupied the physical iPad's UI thread for seconds during a library sync.
        let digits = Array("0123456789abcdef".utf8)
        var encoded = [UInt8]()
        encoded.reserveCapacity(2 + count * 2)
        encoded.append(92); encoded.append(120) // Postgres bytea prefix: \\x
        for byte in self {
            encoded.append(digits[Int(byte >> 4)])
            encoded.append(digits[Int(byte & 15)])
        }
        return String(decoding: encoded, as: UTF8.self)
    }
    /// The inverse of `praeludeHexLiteral`. Accepts the `\x`-prefixed form this app always writes,
    /// and the bare hex form Postgres may hand back on read (`bytea`'s default output style already
    /// includes the `\x` prefix, but this stays lenient rather than assume the server never changes
    /// `bytea_output`). Returns `nil` for anything that is not valid hex of even length.
    public init?(praeludeHexLiteral literal: String) {
        var hex = Substring(literal)
        if hex.hasPrefix("\\x") { hex = hex.dropFirst(2) }
        guard hex.count.isMultiple(of: 2) else { return nil }
        var bytes = [UInt8](); bytes.reserveCapacity(hex.count / 2)
        var index = hex.startIndex
        while index < hex.endIndex {
            let next = hex.index(index, offsetBy: 2)
            guard let byte = UInt8(hex[index..<next], radix: 16) else { return nil }
            bytes.append(byte); index = next
        }
        self = Data(bytes)
    }
}
