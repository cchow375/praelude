import CoreGraphics

/// Coordinate transforms for placing a normalized (page-original-basis) mark onto an already
/// *rendered* (rotation-baked-in) bitmap, such as `PDFPage.thumbnail(of:for:)`. See
/// "(C) Schema3.md"-adjacent commentary in `GeometryTransforms.swift` for why the live reader
/// (`ScorePageOverlay`) never needs this: PDFKit already hands its overlay bounds and gestures in
/// the page's unrotated basis. A raster thumbnail, unlike the overlay, is always rendered in the
/// page's final *displayed* orientation, so a normalized rect must be rotated to match before it is
/// scaled onto the image.
extension CGRect {
    /// Rotates a normalized (0...1, top-left origin, page-original-basis) rect into the basis a PDF
    /// page is rendered in once its own `/Rotate` (`PDFPage.rotation`; PDF's clockwise rotation, one
    /// of 0/90/180/270) is applied for display.
    func normalizedRotatedForDisplay(pageRotationDegrees: Int) -> CGRect {
        switch ((pageRotationDegrees % 360) + 360) % 360 {
        case 90: return CGRect(x: 1 - maxY, y: minX, width: height, height: width)
        case 180: return CGRect(x: 1 - maxX, y: 1 - maxY, width: width, height: height)
        case 270: return CGRect(x: minY, y: 1 - maxX, width: height, height: width)
        default: return self
        }
    }
}
