import Foundation

/// The wire-format JSON encoder/decoder for everything crossing the sync boundary (§3 of
/// "(C) Sync Protocol.md"). Deliberately separate from `PracticeStore`'s own `encoder()`/`decoder()`
/// (`.deferredToDate`, for `library.json` on disk) — `timestamptz` needs ISO 8601 text, not
/// `Date`'s raw reference-seconds `Double`. Every sync DTO in `SyncDTO.swift` is encoded/decoded
/// through these, never through a type's own ad hoc `JSONEncoder()`.
public enum SyncCoding {
    public static var encoder: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }
    public static var decoder: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
    /// Shared formatter for the few call sites that need a bare ISO 8601 string rather than a whole
    /// encoded payload — e.g. a `PostgrestClient.rpc` parameter struct whose own default encoder's
    /// date strategy this app does not control and should not depend on (see `PostgRESTSyncTransport`).
    public static let iso8601Formatter = ISO8601DateFormatter()
}

extension Data {
    /// Postgres `bytea` textual-input format: `\x` followed by lowercase hex pairs. Swift's `Data`
    /// encodes to base64 by default, which `bytea`'s input function does not accept — verified
    /// against a live copy of this schema, see "(C) Sync Protocol.md" §3. Used for `ink_strokes.data`,
    /// the one `bytea` column this sync engine touches.
    public var praeludeHexLiteral: String {
        "\\x" + map { String(format: "%02x", $0) }.joined()
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
