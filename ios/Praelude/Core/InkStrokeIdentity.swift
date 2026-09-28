import Foundation

// MARK: - Deterministic per-stroke identity (§7 annotate track)
//
// `PracticeStore.replaceInk` stores an arbitrary array of stroke blobs per page/layer and keeps an
// existing row's id/createdAt stable whenever its content still matches (see "(C) Schema3.md" —
// "Ink: per-stroke storage"). A genuinely *new* row's id must be derived from stable inputs, not a
// random `UUID()`, so splitting the same drawing into per-stroke rows on two devices (or twice on
// one device, before either has synced) converges on the same ids for identical content.
//
// The `data` passed in is *not* automatically a stable input to hash: `PKDrawing`'s own binary
// format embeds a fresh random value on every independent construction (confirmed empirically —
// re-encoding one already-built `PKDrawing` twice is stable, but building two separate `PKDrawing`
// values from identical `PKStroke` content is not), so hashing raw re-serialized PencilKit bytes
// would never converge. `InkPerStroke.fingerprint` is the app layer's fix: a manually-extracted,
// PencilKit-serializer-independent encoding of a stroke's own geometry, passed here as `data`
// through `PracticeStore.InkStrokeInput.fingerprint` (`replaceInk` uses `fingerprint ?? data`) —
// this file only needs a stable `Data` to hash, and does not care which one it was given.

extension InkStroke {
    /// A deterministic id for a brand-new ink row, used by `PracticeStore.replaceInk` in place of
    /// a random `UUID()`. Two devices (or two runs) that independently split the same drawing into
    /// the same ordered per-stroke content — the scenario `InkPerStroke.split`'s fingerprints
    /// guarantee — compute the identical id for the identical stroke, so a future sync engine sees
    /// one row appearing twice rather than two unrelated rows.
    ///
    /// Never built from `Hasher`/`hashValue`: Swift randomizes those per process (by design, to
    /// resist hash-flooding), which would make "the same content" hash differently on every launch.
    /// This uses FNV-1a, a fixed, public, seed-only algorithm, run twice with different seeds to
    /// fill a 128-bit value.
    static func stableID(pieceID: UUID, page: Int, layer: InkLayer, data: Data, ordinal: Int) -> UUID {
        var input = Data()
        withUnsafeBytes(of: pieceID.uuid) { input.append(contentsOf: $0) }
        withUnsafeBytes(of: Int64(page).littleEndian) { input.append(contentsOf: $0) }
        input.append(contentsOf: layer.rawValue.utf8)
        withUnsafeBytes(of: Int64(ordinal).littleEndian) { input.append(contentsOf: $0) }
        input.append(data)
        let low = fnv1a64(input, seed: 0xcbf2_9ce4_8422_2325)
        let high = fnv1a64(input, seed: 0x9e37_79b9_7f4a_7c15)
        var bytes = [UInt8]()
        bytes.reserveCapacity(16)
        withUnsafeBytes(of: high.bigEndian) { bytes.append(contentsOf: $0) }
        withUnsafeBytes(of: low.bigEndian) { bytes.append(contentsOf: $0) }
        // RFC 9562 version 8 ("custom"): marks these 16 bytes as a deterministic, non-random UUID
        // to a future reader, without changing how Foundation treats the value as a UUID.
        bytes[6] = (bytes[6] & 0x0F) | 0x80
        bytes[8] = (bytes[8] & 0x3F) | 0x80
        let uuid = uuid_t(bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
                          bytes[8], bytes[9], bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15])
        return UUID(uuid: uuid)
    }

    /// FNV-1a, 64-bit: a small, fast, non-cryptographic, seed-deterministic hash. Good enough here
    /// because the goal is convergent identity for identical bytes, not collision-resistance
    /// against an adversary — the worst case of a collision is two strokes sharing a row identity,
    /// which `replaceInk`'s content diff already tolerates (see its tests).
    private static func fnv1a64(_ data: Data, seed: UInt64) -> UInt64 {
        var hash = seed
        for byte in data {
            hash ^= UInt64(byte)
            hash = hash &* 0x0000_0100_0000_01B3
        }
        return hash
    }
}
