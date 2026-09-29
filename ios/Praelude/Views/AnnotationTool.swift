import PencilKit
import SwiftUI

// MARK: - Annotation tools (§7 annotation bullets)
//
// A small, custom toolbar replaces the raw system `PKToolPicker` (still used underneath for
// PencilKit's own double-tap/squeeze shortcuts, but no longer the primary way to choose a tool —
// see `AnnotationToolbar.swift`), so the palette can be curated (§3b: no stock rainbow color
// picker) while `PKLassoTool`'s native move/resize/duplicate/delete interaction and the canvas's
// own `undoManager` are reused as-is rather than reimplemented.

/// What the writing-mode canvas does with the next touch.
enum AnnotationToolKind: String, CaseIterable, Identifiable, Sendable {
    case pen, highlighter, eraser, lasso, stamp, text
    var id: String { rawValue }
    var label: String {
        switch self {
        case .pen: return "Pen"
        case .highlighter: return "Highlighter"
        case .eraser: return "Eraser"
        case .lasso: return "Lasso"
        case .stamp: return "Stamp"
        case .text: return "Text"
        }
    }
    /// Stamp and text placement are handled by `ScorePageOverlay`'s own tap gesture, not by handing
    /// PencilKit a drawing tool, so only these four ever become the canvas's live `PKTool`.
    var isInkingTool: Bool { self == .pen || self == .highlighter || self == .eraser || self == .lasso }
}

/// The musician's own marking colors (§7: "monochrome ink + a small set of annotation colors
/// appropriate for marking music" — an explicit, named exception to the app's otherwise strictly
/// monochrome palette, the same way a pencil case has a graphite pencil plus a red and a blue).
/// Kept separate from `PraeludeColor` (`Design/DesignColor.swift`), which stays strictly monochrome
/// for the app's own chrome; these are never used for anything but ink the person actually draws.
enum AnnotationColor: String, CaseIterable, Identifiable, Codable, Sendable {
    case graphite, red, blue, green
    var id: String { rawValue }
    var label: String {
        switch self {
        case .graphite: return "Graphite"
        case .red: return "Red pencil"
        case .blue: return "Blue pencil"
        case .green: return "Green pencil"
        }
    }
    /// Pinned, not dynamic — like `PraeludeColor.scoreInk`, this must read the same in light and
    /// dark, because it sits on the pinned paper-white score page (never `PraeludeColor.ink`, which
    /// turns parchment in dark mode and would vanish against the page).
    var uiColor: UIColor {
        switch self {
        case .graphite: return UIColor(PraeludeColor.scoreInk)
        case .red: return UIColor(red: 0.675, green: 0.153, blue: 0.129, alpha: 1)
        case .blue: return UIColor(red: 0.129, green: 0.271, blue: 0.675, alpha: 1)
        case .green: return UIColor(red: 0.169, green: 0.404, blue: 0.216, alpha: 1)
        }
    }
    var color: Color { Color(uiColor) }
}

/// A handful of preset stops rather than a continuous slider — one fewer decision while a passage
/// is open, and easy to hit at arm's length on an iPad.
enum AnnotationWidth: Int, CaseIterable, Identifiable, Sendable {
    case fine, medium, bold
    var id: Int { rawValue }
    var label: String {
        switch self {
        case .fine: return "Fine"
        case .medium: return "Medium"
        case .bold: return "Bold"
        }
    }
    /// Points, for `PKInkingTool`. A highlighter reads its own separate, wider scale (below) — a
    /// "Bold" pen and a "Bold" highlighter are not the same stroke weight in real pencil cases either.
    var penPoints: CGFloat {
        switch self { case .fine: return 1.4; case .medium: return 2.6; case .bold: return 5 }
    }
    var highlighterPoints: CGFloat {
        switch self { case .fine: return 10; case .medium: return 16; case .bold: return 24 }
    }
}

/// What the next tap/stroke does, bundled so `ScoreMarkupState` can carry (and `AnnotationToolbar`
/// can bind to) one value instead of three loose ones.
struct AnnotationTool: Equatable {
    var kind: AnnotationToolKind = .pen
    var color: AnnotationColor = .graphite
    var width: AnnotationWidth = .medium

    /// `nil` for `.lasso`/`.eraser` (no ink attributes to show) and for `.stamp`/`.text` (placement
    /// tools, not inking tools — `ScorePageOverlay` never sets these as the canvas's live `PKTool`).
    var pkTool: PKTool? {
        switch kind {
        case .pen: return PKInkingTool(.pen, color: color.uiColor, width: width.penPoints)
        case .highlighter: return PKInkingTool(.marker, color: color.uiColor, width: width.highlighterPoints)
        case .eraser: return PKEraserTool(.vector)
        case .lasso: return PKLassoTool()
        case .stamp, .text: return nil
        }
    }
}
