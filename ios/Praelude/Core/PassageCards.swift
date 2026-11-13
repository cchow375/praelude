import Foundation

/// Photo passages use ordinary immutable PDF assets and ordinary passage rows. The explicit
/// Piece flag survives backup filename remapping and user edits to library folders.
public enum PassageCardLibrary {
    public static let photoFolderName = "Photo passages"

    public static func isPhotoPiece(_ piece: Piece) -> Bool {
        piece.isPhotoPassage
    }

    /// A card is unpracticed until an effective attempt exists. An undone attempt does not count.
    public static func practicedPassageIDs(in state: LibraryState) -> Set<UUID> {
        Set((state.history + [state.activeSet].compactMap { $0 }).compactMap { set in
            guard set.attempts.contains(where: \.isEffective) else { return nil }
            return set.configuration.passageID
        })
    }
}
