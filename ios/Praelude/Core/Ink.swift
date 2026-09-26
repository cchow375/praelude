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
    public var createdAt: Date
    public var updatedAt: Date
    public var deletedAt: Date?
    public init(id: UUID = UUID(), pieceID: UUID, page: Int, layer: InkLayer = .mine, data: Data,
                createdAt: Date = Date(), updatedAt: Date = Date(), deletedAt: Date? = nil) {
        self.id = id; self.pieceID = pieceID; self.page = page; self.layer = layer; self.data = data
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
