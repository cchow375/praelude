import Foundation

/// One position in a piece's effective reading order (§7 page tools): the source PDF page it
/// renders (or `nil` for an inserted blank/staff page), with any crop/rotation applied on top.
/// Pure geometry/ordering — no PDFKit dependency, so it lives in the Foundation-only Core package.
/// `ScorePageComposer` (Views/Services, which does depend on PDFKit) turns this into an actual
/// displayed document; the reader and page-tools editor both build their view of a piece's pages
/// from this one function so they never disagree about what "page 4" means.
public struct EffectivePage: Identifiable, Equatable, Sendable {
    public var id: UUID
    public var displayOrder: Int
    public var sourcePage: Int?
    public var kind: PageKind
    public var cropRect: NormalizedRect?
    public var rotationDegrees: Int
    public init(id: UUID, displayOrder: Int, sourcePage: Int?, kind: PageKind, cropRect: NormalizedRect?, rotationDegrees: Int) {
        self.id = id; self.displayOrder = displayOrder; self.sourcePage = sourcePage
        self.kind = kind; self.cropRect = cropRect; self.rotationDegrees = rotationDegrees
    }
}

/// Resolves a piece's non-destructive `PageEdit` rows into its effective reading order.
public enum PageLayout {
    /// The reading order for one piece: its saved page edits in `displayOrder` if it has any,
    /// otherwise the identity order `1...sourcePageCount` (every score starts this way — a piece
    /// gains page-edit rows only the first time the player opens page tools on it; see
    /// `PageLayout.seedEdits`). A deleted (tombstoned or soft-deleted) edit never appears.
    public static func effectivePages(pageEdits: [PageEdit], pieceID: UUID, sourcePageCount: Int) -> [EffectivePage] {
        let active = pageEdits.filter { $0.pieceID == pieceID && $0.deletedAt == nil && !$0.deleted }
        guard !active.isEmpty else {
            guard sourcePageCount > 0 else { return [] }
            return (1...sourcePageCount).map {
                EffectivePage(id: UUID(), displayOrder: $0, sourcePage: $0, kind: .original, cropRect: nil, rotationDegrees: 0)
            }
        }
        return active.sorted { $0.displayOrder < $1.displayOrder }.enumerated().map { offset, edit in
            EffectivePage(id: edit.id, displayOrder: offset + 1, sourcePage: edit.sourcePage, kind: edit.kind,
                          cropRect: edit.cropRect, rotationDegrees: edit.rotationDegrees)
        }
    }

    /// Convenience for a caller that already scoped `pageEdits` to one piece (e.g. `PagedScoreView`
    /// and the page-tools editor, each handed one piece's rows at a time) — skips the redundant
    /// `pieceID` filter. Safe even when `pageEdits` is empty: the identity fallback doesn't consult
    /// `pieceID` either way.
    public static func effectivePages(pageEdits: [PageEdit], sourcePageCount: Int) -> [EffectivePage] {
        effectivePages(pageEdits: pageEdits, pieceID: pageEdits.first?.pieceID ?? UUID(), sourcePageCount: sourcePageCount)
    }

    /// How many display pages a piece currently has — the number `Piece.lastPage`, `Bookmark.page`
    /// and `ScoreLink` page fields are bounded by once page tools are in use (see "(C) Schema3.md").
    public static func effectiveCount(pageEdits: [PageEdit], pieceID: UUID, sourcePageCount: Int) -> Int {
        let active = pageEdits.filter { $0.pieceID == pieceID && $0.deletedAt == nil && !$0.deleted }
        return active.isEmpty ? sourcePageCount : active.count
    }

    /// The one-time upgrade from "no page edits yet" to a complete, editable row per existing
    /// source page — identity order, no crop/rotation — so the page-tools editor always has a full
    /// set of rows to reorder/insert/delete/crop against. A no-op (returns the piece's existing
    /// rows unchanged) once any row already exists. Callers persist the result with
    /// `PracticeStore.savePageEdits`.
    public static func seedEdits(existing: [PageEdit], pieceID: UUID, sourcePageCount: Int, now: Date) -> [PageEdit] {
        let current = existing.filter { $0.pieceID == pieceID && $0.deletedAt == nil && !$0.deleted }
        guard current.isEmpty, sourcePageCount > 0 else { return existing.filter { $0.pieceID == pieceID } }
        return (1...sourcePageCount).map {
            PageEdit(pieceID: pieceID, sourcePage: $0, displayOrder: $0, kind: .original, createdAt: now, updatedAt: now)
        }
    }

    /// Renumbers a full edited set to a contiguous `1...count` `displayOrder` after a reorder,
    /// insertion, or deletion in the editor, preserving every other field untouched.
    public static func renumbered(_ edits: [PageEdit]) -> [PageEdit] {
        edits.enumerated().map { offset, edit in
            var edit = edit; edit.displayOrder = offset + 1; return edit
        }
    }
}
