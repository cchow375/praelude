import Foundation

/// Warmups (§12) reuse the exact same practice-set engine as passages — verdicts, ladders, the
/// metronome, sessions, streak-qualifying focused time — all of which `PracticeStore.validate`
/// requires an `ActiveSet`/`PracticeSession` to attach to a real `Piece` (see `validate`'s
/// `pieceIDs.contains(set.configuration.pieceID)` check in "PracticeStore.swift"). Rather than a
/// synthetic piece per warmup or per instrument (which would need a stored "is this a system piece"
/// field on `Piece`, i.e. editing Models.swift), every warmup set attaches to one single, fixed,
/// well-known piece. It is filtered out of every piece-browsing surface by this stable id, and the
/// player never sees, edits or deletes it directly.
public enum WarmupsPiece {
    /// Stable across launches/devices so there is exactly one, with no persisted pointer to it
    /// needed anywhere else.
    public static let id = UUID(uuidString: "00000000-0000-0000-0000-000000005A11")!

    /// A piece with no PDF (`pdfFileName == nil`, `pageCount == 0`) is already a valid, if unusual,
    /// `Piece` under `PracticeStore.validate` (see the schema1-legacy "no score attached" case
    /// `LibraryPieceRow` already renders); this one is never shown in a picker, so its title only
    /// ever surfaces as a session/session-history subject ("Warmups"), which is the correct label.
    public static func makeIfMissing(in pieces: [Piece]) -> Piece? {
        guard !pieces.contains(where: { $0.id == id }) else { return nil }
        return Piece(id: id, title: "Warmups", status: .active)
    }
}

extension PracticeStore {
    /// Creates the warmups piece on first need. Idempotent; safe to call before every warmup set.
    public func ensureWarmupsPiece() throws {
        guard let piece = WarmupsPiece.makeIfMissing(in: state.pieces) else { return }
        try addPiece(piece)
    }

    /// Every piece except the internal warmups attachment point — what "Pieces", "Today" and the
    /// sidebar's "On your music stand" list should always browse instead of `pieces` directly.
    public var realPieces: [Piece] { state.pieces.filter { $0.id != WarmupsPiece.id && $0.deletedAt == nil } }
}
