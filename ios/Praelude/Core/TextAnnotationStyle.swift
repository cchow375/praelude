import Foundation

/// Text sizing uses points on a canonical 595-point-wide score, not the source PDF's often
/// arbitrary media-box units. The renderer scales from that basis on both screen and export.
public struct TextAnnotationStyle: Codable, Equatable, Sendable {
    public enum FontFamily: String, Codable, CaseIterable, Sendable { case system, serif, rounded, monospaced }
    public enum TextColor: String, Codable, CaseIterable, Sendable { case black, white, blue, red, green, purple }
    public enum Alignment: String, Codable, CaseIterable, Sendable { case leading, center, trailing }

    /// Components stay in the existing nested note-style JSON and sync region payload.
    public struct BackgroundColor: Codable, Equatable, Sendable {
        public var red: Double
        public var green: Double
        public var blue: Double
        public var alpha: Double
        public init(red: Double, green: Double, blue: Double, alpha: Double = 1) {
            self.red = red; self.green = green; self.blue = blue; self.alpha = alpha
        }
        public static let yellow = Self(red: 1, green: 0.93, blue: 0.58)
        public static let clear = Self(red: 1, green: 1, blue: 1, alpha: 0)
        public var isValid: Bool {
            [red, green, blue, alpha].allSatisfy { $0.isFinite && (0...1).contains($0) }
        }
    }

    public static let referencePageWidth: Double = 595
    public static let fontSizeRange: ClosedRange<Double> = 12...48
    public var fontSize: Double
    public var fontFamily: FontFamily
    public var isBold: Bool
    public var isItalic: Bool
    public var textColor: TextColor
    public var alignment: Alignment
    public var backgroundColor: BackgroundColor

    public init(fontSize: Double = 20, fontFamily: FontFamily = .system,
                isBold: Bool = false, isItalic: Bool = false,
                textColor: TextColor = .black, alignment: Alignment = .leading,
                backgroundColor: BackgroundColor = .yellow) {
        self.fontSize = fontSize; self.fontFamily = fontFamily
        self.isBold = isBold; self.isItalic = isItalic
        self.textColor = textColor; self.alignment = alignment; self.backgroundColor = backgroundColor
    }

    public var isValid: Bool { fontSize.isFinite && Self.fontSizeRange.contains(fontSize) && backgroundColor.isValid }

    private enum CodingKeys: String, CodingKey { case fontSize, fontFamily, isBold, isItalic, textColor, alignment, backgroundColor }
    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        fontSize = try values.decodeIfPresent(Double.self, forKey: .fontSize) ?? 20
        fontFamily = FontFamily(rawValue: try values.decodeIfPresent(String.self, forKey: .fontFamily) ?? "") ?? .system
        isBold = try values.decodeIfPresent(Bool.self, forKey: .isBold) ?? false
        isItalic = try values.decodeIfPresent(Bool.self, forKey: .isItalic) ?? false
        textColor = TextColor(rawValue: try values.decodeIfPresent(String.self, forKey: .textColor) ?? "") ?? .black
        backgroundColor = try values.decodeIfPresent(BackgroundColor.self, forKey: .backgroundColor) ?? .yellow
        alignment = Alignment(rawValue: try values.decodeIfPresent(String.self, forKey: .alignment) ?? "") ?? .leading
    }
}
