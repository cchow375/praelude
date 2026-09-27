import Foundation

/// §7 setlists: pure ordering/navigation helpers on top of `Setlist.items`, which is already the
/// ordered array (no separate position field — reordering means reordering that array). Lives in
/// Core so "open in order" is one small, independently testable function rather than logic
/// re-derived inline wherever a setlist is browsed.
public enum SetlistNavigator {
    /// This setlist's items with any reference to a missing or deleted piece dropped, in the
    /// setlist's own stored order. A piece can legitimately appear more than once (e.g. two
    /// movements of the same work listed separately with different page ranges), so this never
    /// deduplicates by `pieceID`.
    public static func validItems(_ setlist: Setlist, pieces: [Piece]) -> [SetlistItem] {
        let liveIDs = Set(pieces.filter { $0.deletedAt == nil }.map(\.id))
        return setlist.items.filter { liveIDs.contains($0.pieceID) }
    }

    /// The item at `offset` steps from `currentItemID` in the valid (live-piece) ordering — `+1` for
    /// "open the next piece in this setlist", `-1` for the previous one. `nil` for `currentItemID`
    /// (nothing open yet) starts from just before the first item, so `offset: 1` returns the first
    /// item. Returns `nil` past either end rather than wrapping, so "Next" simply disables there.
    public static func item(after currentItemID: UUID?, offset: Int, in setlist: Setlist, pieces: [Piece]) -> SetlistItem? {
        let items = validItems(setlist, pieces: pieces)
        guard !items.isEmpty else { return nil }
        let currentIndex = currentItemID.flatMap { id in items.firstIndex { $0.id == id } } ?? -1
        let target = currentIndex + offset
        guard items.indices.contains(target) else { return nil }
        return items[target]
    }
}
