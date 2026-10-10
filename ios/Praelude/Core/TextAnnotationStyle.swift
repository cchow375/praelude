import Foundation

/// Text sizing uses points on a canonical 595-point-wide score, not the source PDF's often
/// arbitrary media-box units. The renderer scales from that basis on both screen and export.
public struct TextAnnotationStyle: Codable, Equatable, Sendable {
    public enum FontFamily: String, Codable, CaseIterable, Sendable { case system, serif, rounded, monospaced }
    public enum TextColor: String, Codable, CaseIterable, Sendable { case black, blue, red, green, purple }
    public enum Alignment: String, Codable, CaseIterable, Sendable { case leading, center, trailing }

    public static let referencePageWidth: Double = 595
    public static let fontSizeRange: ClosedRange<Double> = 12...48
    public var fontSize: Double
    public var fontFamily: FontFamily
    public var isBold: Bool
    public var isItalic: Bool
    public var textColor: TextColor
    public var alignment: Alignment

    public init(fontSize: Double = 20, fontFamily: FontFamily = .system,
                isBold: Bool = false, isItalic: Bool = false,
                textColor: TextColor = .black, alignment: Alignment = .leading) {
        self.fontSize = fontSize; self.fontFamily = fontFamily
        self.isBold = isBold; self.isItalic = isItalic
        self.textColor = textColor; self.alignment = alignment
    }

    public var isValid: Bool { fontSize.isFinite && Self.fontSizeRange.contains(fontSize) }

    private enum CodingKeys: String, CodingKey { case fontSize, fontFamily, isBold, isItalic, textColor, alignment }
    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        fontSize = try values.decodeIfPresent(Double.self, forKey: .fontSize) ?? 20
        fontFamily = FontFamily(rawValue: try values.decodeIfPresent(String.self, forKey: .fontFamily) ?? "") ?? .system
        isBold = try values.decodeIfPresent(Bool.self, forKey: .isBold) ?? false
        isItalic = try values.decodeIfPresent(Bool.self, forKey: .isItalic) ?? false
        textColor = TextColor(rawValue: try values.decodeIfPresent(String.self, forKey: .textColor) ?? "") ?? .black
        alignment = Alignment(rawValue: try values.decodeIfPresent(String.self, forKey: .alignment) ?? "") ?? .leading
    }
}
