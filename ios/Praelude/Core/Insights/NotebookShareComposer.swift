import Foundation

/// Pure text composition for the notebook's "Post as Note" hook (§15 → §5a): what text a social
/// track's implementation would actually post, decided here so the format is one tested place rather
/// than duplicated wherever the hook is invoked. No networking, no `Services` dependency — this only
/// turns a `NotebookEntry` into text; a real post is entirely the hook implementor's job.
public enum NotebookShareComposer {
    public static func summary(for entry: NotebookEntry, pieceTitle: String?) -> String {
        let heading: String
        switch entry.kind {
        case .daily: heading = pieceTitle.map { "Practice note · \($0)" } ?? "Practice note"
        case .lessonNote: heading = pieceTitle.map { "Lesson note · \($0)" } ?? "Lesson note"
        case .lessonPrep: heading = pieceTitle.map { "Lesson prep · \($0)" } ?? "Lesson prep"
        }
        let body = entry.text.trimmingCharacters(in: .whitespacesAndNewlines)
        return body.isEmpty ? heading : "\(heading)\n\(body)"
    }
}
