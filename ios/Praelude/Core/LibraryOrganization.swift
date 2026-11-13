import Foundation

/// A user-defined label for filtering the library (§7).
public struct Tag: Identifiable, Codable, Equatable, Hashable, Sendable {
    public var id: UUID
    public var name: String
    public var createdAt: Date
    public var updatedAt: Date
    public var deletedAt: Date?
    public init(id: UUID = UUID(), name: String, createdAt: Date = Date(), updatedAt: Date = Date(), deletedAt: Date? = nil) {
        self.id = id; self.name = name; self.createdAt = createdAt; self.updatedAt = updatedAt; self.deletedAt = deletedAt
    }
}

/// A library folder. `parentFolderID` allows light nesting; flat use (all folders at the top level)
/// is equally valid.
public struct Folder: Identifiable, Codable, Equatable, Sendable {
    public var id: UUID
    public var name: String
    public var parentFolderID: UUID?
    public var createdAt: Date
    public var updatedAt: Date
    public var deletedAt: Date?
    public init(id: UUID = UUID(), name: String, parentFolderID: UUID? = nil,
                createdAt: Date = Date(), updatedAt: Date = Date(), deletedAt: Date? = nil) {
        self.id = id; self.name = name; self.parentFolderID = parentFolderID
        self.createdAt = createdAt; self.updatedAt = updatedAt; self.deletedAt = deletedAt
    }
}

/// One ordered entry in a `Setlist`, optionally scoped to a movement or page range within the piece.
public struct SetlistItem: Identifiable, Codable, Equatable, Sendable {
    public var id: UUID
    public var pieceID: UUID
    public var movementLabel: String?
    public var startPage: Int?
    public var endPage: Int?
    public init(id: UUID = UUID(), pieceID: UUID, movementLabel: String? = nil, startPage: Int? = nil, endPage: Int? = nil) {
        self.id = id; self.pieceID = pieceID; self.movementLabel = movementLabel
        self.startPage = startPage; self.endPage = endPage
    }
}

public struct Setlist: Identifiable, Codable, Equatable, Sendable {
    public var id: UUID
    public var name: String
    public var items: [SetlistItem]
    public var createdAt: Date
    public var updatedAt: Date
    public var deletedAt: Date?
    public init(id: UUID = UUID(), name: String, items: [SetlistItem] = [],
                createdAt: Date = Date(), updatedAt: Date = Date(), deletedAt: Date? = nil) {
        self.id = id; self.name = name; self.items = items
        self.createdAt = createdAt; self.updatedAt = updatedAt; self.deletedAt = deletedAt
    }
}

/// A quick-jump bookmark to a movement or section (§7), distinct from a `Passage`.
public struct Bookmark: Identifiable, Codable, Equatable, Sendable {
    public var id: UUID
    public var pieceID: UUID
    public var page: Int
    public var label: String
    public var createdAt: Date
    public var updatedAt: Date
    public var deletedAt: Date?
    public init(id: UUID = UUID(), pieceID: UUID, page: Int, label: String,
                createdAt: Date = Date(), updatedAt: Date = Date(), deletedAt: Date? = nil) {
        self.id = id; self.pieceID = pieceID; self.page = page; self.label = label
        self.createdAt = createdAt; self.updatedAt = updatedAt; self.deletedAt = deletedAt
    }
}

/// Whether a reading-order page comes from the source PDF or was inserted by the player.
public enum PageKind: String, Codable, CaseIterable, Sendable { case original, blank, staff }

/// A non-destructive edit to how one source page (or an inserted page) is read (§7): crop, rotation,
/// reading-order position, soft deletion, or insertion. The underlying PDF is never modified; the
/// reader composes these on top of it. One row per effective page, keyed by `pieceID` + `displayOrder`.
public struct PageEdit: Identifiable, Codable, Equatable, Sendable {
    public var id: UUID
    public var pieceID: UUID
    /// The source PDF page this display page renders, or `nil` for an inserted blank/staff page.
    public var sourcePage: Int?
    /// Position in the effective reading order (1-based), independent of `sourcePage`.
    public var displayOrder: Int
    public var kind: PageKind
    public var cropRect: NormalizedRect?
    public var rotationDegrees: Int
    public var deleted: Bool
    public var createdAt: Date
    public var updatedAt: Date
    public var deletedAt: Date?
    public init(id: UUID = UUID(), pieceID: UUID, sourcePage: Int?, displayOrder: Int, kind: PageKind = .original,
                cropRect: NormalizedRect? = nil, rotationDegrees: Int = 0, deleted: Bool = false,
                createdAt: Date = Date(), updatedAt: Date = Date(), deletedAt: Date? = nil) {
        self.id = id; self.pieceID = pieceID; self.sourcePage = sourcePage; self.displayOrder = displayOrder
        self.kind = kind; self.cropRect = cropRect; self.rotationDegrees = rotationDegrees; self.deleted = deleted
        self.createdAt = createdAt; self.updatedAt = updatedAt; self.deletedAt = deletedAt
    }
}

/// A tap target that jumps the reader from one score location to another (repeat, D.S., coda, jump-back; §7).
public struct ScoreLink: Identifiable, Codable, Equatable, Sendable {
    public var id: UUID
    public var pieceID: UUID
    public var sourcePage: Int
    public var sourceRegion: NormalizedRect?
    public var targetPage: Int
    public var targetRegion: NormalizedRect?
    public var label: String
    public var createdAt: Date
    public var updatedAt: Date
    public var deletedAt: Date?
    public init(id: UUID = UUID(), pieceID: UUID, sourcePage: Int, sourceRegion: NormalizedRect? = nil,
                targetPage: Int, targetRegion: NormalizedRect? = nil, label: String = "",
                createdAt: Date = Date(), updatedAt: Date = Date(), deletedAt: Date? = nil) {
        self.id = id; self.pieceID = pieceID; self.sourcePage = sourcePage; self.sourceRegion = sourceRegion
        self.targetPage = targetPage; self.targetRegion = targetRegion; self.label = label
        self.createdAt = createdAt; self.updatedAt = updatedAt; self.deletedAt = deletedAt
    }
}

/// A free-text annotation box (§7), layered like ink so mine/teacher/performance can show/hide together.
public struct TextBoxAnnotation: Identifiable, Codable, Equatable, Sendable {
    public var id: UUID
    public var pieceID: UUID
    public var page: Int
    public var region: NormalizedRect
    public var text: String
    public var layer: InkLayer
    public var style: TextAnnotationStyle
    public var createdAt: Date
    public var updatedAt: Date
    public var deletedAt: Date?
    public init(id: UUID = UUID(), pieceID: UUID, page: Int, region: NormalizedRect, text: String,
                layer: InkLayer = .mine, style: TextAnnotationStyle = .init(),
                createdAt: Date = Date(), updatedAt: Date = Date(), deletedAt: Date? = nil) {
        self.id = id; self.pieceID = pieceID; self.page = page; self.region = region; self.text = text
        self.layer = layer; self.style = style
        self.createdAt = createdAt; self.updatedAt = updatedAt; self.deletedAt = deletedAt
    }

    private enum CodingKeys: String, CodingKey { case id, pieceID, page, region, text, layer, style, createdAt, updatedAt, deletedAt }
    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decode(UUID.self, forKey: .id)
        pieceID = try values.decode(UUID.self, forKey: .pieceID)
        page = try values.decode(Int.self, forKey: .page)
        region = try values.decode(NormalizedRect.self, forKey: .region)
        text = try values.decode(String.self, forKey: .text)
        layer = try values.decode(InkLayer.self, forKey: .layer)
        // Existing schema5 libraries/backups carry no style. Their content, geometry and clocks
        // stay exact; only display defaults are supplied, without a migration or eager rewrite.
        style = try values.decodeIfPresent(TextAnnotationStyle.self, forKey: .style) ?? .init()
        createdAt = try values.decode(Date.self, forKey: .createdAt)
        updatedAt = try values.decode(Date.self, forKey: .updatedAt)
        deletedAt = try values.decodeIfPresent(Date.self, forKey: .deletedAt)
    }
}

/// A music stamp (§7): fingerings, dynamics, breath marks, bowings, accidentals, circles, or a
/// "watch this" marker, placed at a small page-local position.
public enum StampKind: String, Codable, CaseIterable, Sendable {
    case fingering, dynamic, breath, bowing, accidental, circle, watch
}

public struct StampAnnotation: Identifiable, Codable, Equatable, Sendable {
    public var id: UUID
    public var pieceID: UUID
    public var page: Int
    public var position: NormalizedRect
    public var kind: StampKind
    public var label: String?
    public var layer: InkLayer
    public var createdAt: Date
    public var updatedAt: Date
    public var deletedAt: Date?
    public init(id: UUID = UUID(), pieceID: UUID, page: Int, position: NormalizedRect, kind: StampKind,
                label: String? = nil, layer: InkLayer = .mine, createdAt: Date = Date(), updatedAt: Date = Date(), deletedAt: Date? = nil) {
        self.id = id; self.pieceID = pieceID; self.page = page; self.position = position; self.kind = kind
        self.label = label; self.layer = layer; self.createdAt = createdAt; self.updatedAt = updatedAt; self.deletedAt = deletedAt
    }
}
