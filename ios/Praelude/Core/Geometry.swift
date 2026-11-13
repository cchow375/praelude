import Foundation

/// A normalized (0...1) rectangle independent of any specific record's identity, shared by the
/// schema3 annotation types (page edits, links, text boxes, stamps, break-point taps) that need a
/// page-local position but are not themselves a `PassageRegion`. Kept separate from `PassageRegion`
/// so that type's on-disk shape (and schema1/2 compatibility) never changes.
public struct NormalizedRect: Codable, Equatable, Sendable {
    public var x: Double
    public var y: Double
    public var width: Double
    public var height: Double
    public init(x: Double, y: Double, width: Double, height: Double) {
        self.x = x; self.y = y; self.width = width; self.height = height
    }
    /// True when every coordinate is finite and the rectangle fits within the unit page.
    public var isValid: Bool {
        [x, y, width, height].allSatisfy(\.isFinite) && x >= 0 && y >= 0 && width > 0 && height > 0
            && x + width <= 1 && y + height <= 1
    }
}
