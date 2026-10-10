import UIKit

/// Note typography uses a common paper width, independent of an imported PDF's units.
/// The reader and flattened export share layout, fitting down to a readable minimum when needed.
@MainActor enum TextAnnotationRenderer {
    static let paperWidth = CGFloat(TextAnnotationStyle.referencePageWidth)
    static let paperColor = UIColor(red: 1, green: 0.93, blue: 0.58, alpha: 1)

    static func font(for style: TextAnnotationStyle, scale: CGFloat = 1) -> UIFont {
        let size = CGFloat(style.fontSize) * scale
        var descriptor = UIFont.systemFont(ofSize: size).fontDescriptor
        let design: UIFontDescriptor.SystemDesign
        switch style.fontFamily {
        case .system: design = .default
        case .serif: design = .serif
        case .rounded: design = .rounded
        case .monospaced: design = .monospaced
        }
        descriptor = descriptor.withDesign(design) ?? descriptor
        var traits = descriptor.symbolicTraits
        if style.isBold { traits.insert(.traitBold) }
        if style.isItalic { traits.insert(.traitItalic) }
        descriptor = descriptor.withSymbolicTraits(traits) ?? descriptor
        return UIFont(descriptor: descriptor, size: size)
    }

    static func backgroundColor(for style: TextAnnotationStyle) -> UIColor {
        let color = style.backgroundColor
        return UIColor(red: CGFloat(color.red), green: CGFloat(color.green), blue: CGFloat(color.blue), alpha: CGFloat(color.alpha))
    }

    /// Prefer the chosen size. Shrink only enough to fit a smaller box, never below 12 canonical
    /// points; a very short legacy chip can still be expanded to read its full contents.
    static func fittedStyle(for text: String, style: TextAnnotationStyle, in size: CGSize) -> TextAnnotationStyle {
        guard size.width > 0, size.height > 0, !text.isEmpty else { return style }
        func fits(_ candidate: TextAnnotationStyle) -> Bool {
            let measured = (text as NSString).boundingRect(
                with: CGSize(width: size.width, height: .greatestFiniteMagnitude),
                options: [.usesLineFragmentOrigin, .usesFontLeading], attributes: attributes(for: candidate), context: nil)
            return ceil(measured.height) <= size.height && ceil(measured.width) <= ceil(size.width)
        }
        if fits(style) { return style }
        var result = style
        var low = min(style.fontSize, TextAnnotationStyle.fontSizeRange.lowerBound)
        var high = style.fontSize
        for _ in 0..<10 {
            let middle = (low + high) / 2
            result.fontSize = middle
            if fits(result) { low = middle } else { high = middle }
        }
        result.fontSize = low
        return result
    }

    static func color(for style: TextAnnotationStyle) -> UIColor {
        switch style.textColor {
        case .black: return UIColor(white: 0.12, alpha: 1)
        case .white: return .white
        case .blue: return UIColor(red: 0.05, green: 0.20, blue: 0.55, alpha: 1)
        case .red: return UIColor(red: 0.60, green: 0.08, blue: 0.07, alpha: 1)
        case .green: return UIColor(red: 0.06, green: 0.32, blue: 0.13, alpha: 1)
        case .purple: return UIColor(red: 0.36, green: 0.12, blue: 0.48, alpha: 1)
        }
    }

    static func attributes(for style: TextAnnotationStyle, scale: CGFloat = 1) -> [NSAttributedString.Key: Any] {
        let paragraph = NSMutableParagraphStyle()
        paragraph.lineBreakMode = .byWordWrapping
        switch style.alignment {
        case .leading: paragraph.alignment = .left
        case .center: paragraph.alignment = .center
        case .trailing: paragraph.alignment = .right
        }
        return [.font: font(for: style, scale: scale), .foregroundColor: color(for: style), .paragraphStyle: paragraph]
    }

    /// Draws into a UIKit/top-left coordinate context. Never rasterizes an entire source page.
    static func draw(note: TextBoxAnnotation, in rect: CGRect, pageWidth: CGFloat, context: CGContext) {
        guard rect.width > 0, rect.height > 0, pageWidth.isFinite, pageWidth > 0 else { return }
        let scale = pageWidth / paperWidth
        context.saveGState()
        context.clip(to: rect)
        context.translateBy(x: rect.minX, y: rect.minY)
        context.scaleBy(x: scale, y: scale)
        let paperRect = CGRect(x: 0, y: 0, width: rect.width / scale, height: rect.height / scale)
        context.setFillColor(backgroundColor(for: note.style).cgColor)
        context.fill(paperRect)
        if note.style.backgroundColor.alpha > 0 {
            context.setStrokeColor(color(for: note.style).withAlphaComponent(CGFloat(0.25 * note.style.backgroundColor.alpha)).cgColor)
            context.setLineWidth(0.75)
            context.stroke(paperRect)
        }
        let verticalPadding = min(5, paperRect.height * 0.12)
        var inset = paperRect.insetBy(dx: min(6, paperRect.width * 0.08), dy: verticalPadding)
        if inset.width > 0, inset.height > 0 {
            // Older notes were short chips. Lay out at least one line so they don't become
            // blank merely because their stored height predates adjustable note boxes.
            let style = fittedStyle(for: note.text, style: note.style, in: inset.size)
            inset.size.height = max(inset.height, font(for: style).lineHeight)
            // Scale the drawing coordinates, not UIFont's requested size. System fonts use
            // optical variants at different sizes; huge PDF units must not select a different
            // font design or change line wrapping from the equivalent ordinary page.
            UIGraphicsPushContext(context)
            (note.text as NSString).draw(with: inset, options: [.usesLineFragmentOrigin, .usesFontLeading, .truncatesLastVisibleLine],
                                        attributes: attributes(for: style), context: nil)
            UIGraphicsPopContext()
        }
        context.restoreGState()
    }
}
