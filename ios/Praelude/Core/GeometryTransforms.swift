import Foundation

// MARK: - Coordinate transforms for non-destructive page edits (§7 annotation alignment)
//
// Every normalized mark this app stores (`PassageRegion`, `StampAnnotation.position`,
// `TextBoxAnnotation.region`, `ScoreLink` regions) is defined against a page's *original,
// unrotated, uncropped* bounds — the same basis regardless of the current display rotation or
// whether a non-destructive crop (`PageEdit.cropRect`, §7 "page tools") is active, so a later
// rotate/crop/uncrop never moves an existing mark and two replicas agree on where a mark is without
// needing to know each other's current view settings. `ScorePageOverlay`'s live rendering never
// needs a rotation transform of its own — `PDFPageOverlayViewProvider` already hands it bounds and
// gestures in that same unrotated basis and applies the page's own rotation itself, proved by
// `ScoreMarkupTests.testNativePDFOverlayCoordinatesMatchCroppedPageAtEveryRotation`. This file is
// the crop half: `PageEdit.cropRect` is stored in the same original-page basis a mark is, and a
// display surface that shows only that crop (a future non-destructive crop reader) needs to remap
// a mark's coordinates into — and, for a mark drawn while that crop is showing, back out of — the
// crop's own normalized frame. Pure `Double` math, so it lives here rather than needing CoreGraphics
// (see "(C) Schema3.md" — Core stays Foundation-only).
extension NormalizedRect {
    /// Remaps a rect defined against the page's original, uncropped bounds into normalized
    /// coordinates relative to `crop` (also defined against the original page) — the basis a
    /// non-destructive crop page-tool would display. Returns `nil` when the two rects do not overlap
    /// at all (nothing of the mark would be visible on the cropped page); otherwise the visible
    /// remainder is clipped to `crop`, mirroring `PassageRegion.clamped`'s existing rule that a
    /// normalized mark always fits within the page it is shown against.
    func croppedForDisplay(within crop: NormalizedRect) -> NormalizedRect? {
        guard crop.width > 0, crop.height > 0 else { return nil }
        let minX = max(x, crop.x), minY = max(y, crop.y)
        let maxX = min(x + width, crop.x + crop.width), maxY = min(y + height, crop.y + crop.height)
        guard maxX > minX, maxY > minY else { return nil }
        return NormalizedRect(x: (minX - crop.x) / crop.width, y: (minY - crop.y) / crop.height,
                              width: (maxX - minX) / crop.width, height: (maxY - minY) / crop.height)
    }

    /// The inverse of `croppedForDisplay`: maps a rect the person drew or placed while looking at a
    /// cropped page (so its coordinates are relative to `crop`) back into the page's original,
    /// uncropped normalized basis — the basis every stored mark uses regardless of which crop
    /// happens to be active when it is created, so a later crop change never moves it.
    func uncroppedFromDisplay(within crop: NormalizedRect) -> NormalizedRect {
        NormalizedRect(x: crop.x + x * crop.width, y: crop.y + y * crop.height, width: width * crop.width, height: height * crop.height)
    }
}
