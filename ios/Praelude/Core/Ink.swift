import Foundation

/// Which hand drew a stroke, for the library's mine/teacher/performance annotation layers (§7).
public enum InkLayer: String, Codable, CaseIterable, Sendable { case mine, teacher, performance }

/// One page's worth of ink, stored as an opaque, app-encoded blob. Core never parses PencilKit's
/// format; it only tracks identity, page/layer placement and sync metadata so replicas can merge
/// annotations by stroke instead of last-write-wins on a whole page. In today's app, one save
/// replaces the layer's rows wholesale (see `PracticeStore.saveDrawing`), so `data` currently holds
/// a whole-page `PKDrawing.dataRepresentation()`; a future PencilKit-aware call site can instead
/// write one row per `PKStroke` (splitting/encoding each stroke is an app-layer concern, since
/// `PKStroke.identifier` and PencilKit itself are unavailable to this Foundation-only package) and
/// get real per-stroke merge for free from the same storage and the same `replaceInk` diff.
public struct InkStroke: Identifiable, Codable, Equatable, Sendable {
    public var id: UUID
    public var pieceID: UUID
    public var page: Int
    public var layer: InkLayer
    public var data: Data
    /// A caller-computed content key, distinct from `data` (§7 annotate track). `data` is whatever
    /// PencilKit's own `PKDrawing.dataRepresentation()` produced for this row, which the app layer
    /// has confirmed is **not** stable across independent re-serializations of identical stroke
    /// content (constructing a fresh `PKDrawing` from the same `PKStroke` embeds a new random value
    /// every time, even though re-encoding one unchanged, already-constructed drawing is stable).
    /// `fingerprint`, when present, is a manually-extracted, deterministic encoding of the stroke's
    /// own geometry that the app layer computes instead — `PracticeStore.replaceInk` diffs and
    /// derives a new row's id from `fingerprint ?? data`, so an app-layer caller that can compute one
    /// gets real content-stable identity, while a caller that cannot (the whole-page compatibility
    /// shim, `saveDrawing`) keeps exactly its original behavior with `fingerprint == nil`.
    public var fingerprint: Data?
    public var createdAt: Date
    public var updatedAt: Date
    public var deletedAt: Date?
    public init(id: UUID = UUID(), pieceID: UUID, page: Int, layer: InkLayer = .mine, data: Data, fingerprint: Data? = nil,
                createdAt: Date = Date(), updatedAt: Date = Date(), deletedAt: Date? = nil) {
        self.id = id; self.pieceID = pieceID; self.page = page; self.layer = layer; self.data = data
        self.fingerprint = fingerprint
        self.createdAt = createdAt; self.updatedAt = updatedAt; self.deletedAt = deletedAt
    }
}

/// The legacy schema2 shape of one page's ink, kept only to decode a pre-schema3 `scoreDrawings`
/// array during migration (see `SchemaMigration.swift`). Never written going forward.
struct LegacyScoreDrawing: Codable {
    var pieceID: UUID
    var page: Int
    var data: Data
}
