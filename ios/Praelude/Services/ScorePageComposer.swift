import Foundation
import PDFKit
import UIKit

/// Builds the pages a piece's `PageEdit` rows ask for that don't come straight from the source
/// PDF — blank and staff-paper insertions (§7) — and composes a piece's effective reading order
/// into an actual `PDFDocument` for display. Non-destructive: the source file on disk is never
/// written to; a fresh, in-memory document is built from copies of its pages whenever the
/// effective order is not simply "every source page, in order". `ScoreExport` renders from the
/// same per-page helper so an exported PDF matches what the reader shows.
@MainActor enum ScorePageComposer {
    /// The page size new blank/staff insertions (and a piece with no source pages at all) use —
    /// the source's own first page when one exists, else US Letter, so an inserted page reads as
    /// a natural part of the score rather than a mismatched size.
    static func referenceSize(_ document: PDFDocument) -> CGSize {
        guard let first = document.page(at: 0) else { return CGSize(width: 612, height: 792) }
        let box = first.bounds(for: .mediaBox)
        return box.width > 1 && box.height > 1 ? box.size : CGSize(width: 612, height: 792)
    }

    /// A generated blank or staff-paper page at the given size. Rendered once with
    /// `UIGraphicsPDFRenderer` and reopened as a `PDFPage` so it stays vector — crisp at any
    /// zoom, like the rest of an engraved or cleanly scanned score.
    static func generatedPage(kind: PageKind, size: CGSize) -> PDFPage? {
        guard kind == .blank || kind == .staff, size.width > 1, size.height > 1 else { return nil }
        let renderer = UIGraphicsPDFRenderer(bounds: CGRect(origin: .zero, size: size))
        let data = renderer.pdfData { context in
            context.beginPage()
            if kind == .staff { drawStaffPaper(size: size) }
        }
        return PDFDocument(data: data)?.page(at: 0)
    }

    /// Five-line staves, evenly spaced with generous margins — generic manuscript paper for a
    /// quick handwritten cadenza or fingering chart, not tied to any one clef or instrument.
    private static func drawStaffPaper(size: CGSize) {
        guard let context = UIGraphicsGetCurrentContext() else { return }
        let margin = min(size.width, size.height) * 0.09
        let staffWidth = size.width - margin * 2
        let lineSpacing = max(4, size.height * 0.016)
        let staffHeight = lineSpacing * 4
        let staffGap = staffHeight * 2.1
        guard staffWidth > 0, staffHeight + staffGap > 0 else { return }
        let staffCount = max(1, Int((size.height - margin * 2) / (staffHeight + staffGap)))
        context.setStrokeColor(UIColor.black.withAlphaComponent(0.62).cgColor)
        context.setLineWidth(max(0.6, size.width * 0.0009))
        for staff in 0..<staffCount {
            let top = margin + CGFloat(staff) * (staffHeight + staffGap)
            for line in 0..<5 {
                let y = top + CGFloat(line) * lineSpacing
                context.move(to: CGPoint(x: margin, y: y))
                context.addLine(to: CGPoint(x: margin + staffWidth, y: y))
            }
        }
        context.strokePath()
    }

    /// True when the effective order is nothing but the plain `1...sourcePageCount` identity —
    /// the overwhelming common case (no page tool has ever touched this piece) — where the reader
    /// should load the source URL directly rather than pay to copy every page into a new document.
    static func isIdentity(_ pages: [EffectivePage], sourcePageCount: Int) -> Bool {
        pages.count == sourcePageCount && pages.enumerated().allSatisfy { offset, page in
            page.kind == .original && page.sourcePage == offset + 1 && page.cropRect == nil && page.rotationDegrees == 0
        }
    }

    /// One effective page's `PDFPage` — a source page copied and transformed, or a freshly
    /// generated blank/staff page — shared by the live reader and `ScoreExport` so both draw the
    /// same content. `source` itself is never mutated: rotation/crop land on a copy.
    static func renderedPage(source: PDFDocument, effective: EffectivePage, fallbackSize: CGSize) -> PDFPage? {
        switch effective.kind {
        case .blank, .staff:
            return generatedPage(kind: effective.kind, size: fallbackSize)
        case .original:
            guard let sourcePage = effective.sourcePage, sourcePage >= 1, sourcePage <= source.pageCount,
                  let original = source.page(at: sourcePage - 1), let copy = original.copy() as? PDFPage else { return nil }
            if effective.rotationDegrees != 0 {
                copy.rotation = ((copy.rotation + effective.rotationDegrees) % 360 + 360) % 360
            }
            if let crop = effective.cropRect, crop.isValid {
                let media = original.bounds(for: .mediaBox)
                let rect = CGRect(x: media.minX + crop.x * media.width,
                                  y: media.minY + (1 - crop.y - crop.height) * media.height,
                                  width: crop.width * media.width, height: crop.height * media.height)
                copy.setBounds(rect, for: .cropBox)
            }
            return copy
        }
    }

    /// Loads `url` and resolves it against `pageEdits` into the document that should actually be
    /// displayed — the shared entry point `PagedScoreView` and `ScorePagePicker` both use so a page
    /// picker thumbnail always matches what turning to that page in the reader shows.
    static func displayDocument(url: URL, pageEdits: [PageEdit]) -> PDFDocument? {
        guard let raw = PDFDocument(url: url) else { return nil }
        let pages = PageLayout.effectivePages(pageEdits: pageEdits, sourcePageCount: raw.pageCount)
        return isIdentity(pages, sourcePageCount: raw.pageCount) ? raw : composedDocument(source: raw, effectivePages: pages)
    }

    /// Builds the actual displayed document for a non-identity effective order.
    static func composedDocument(source: PDFDocument, effectivePages: [EffectivePage]) -> PDFDocument {
        let output = PDFDocument()
        let size = referenceSize(source)
        for (index, effective) in effectivePages.enumerated() {
            guard let page = renderedPage(source: source, effective: effective, fallbackSize: size) else { continue }
            output.insert(page, at: index)
        }
        return output
    }
}
