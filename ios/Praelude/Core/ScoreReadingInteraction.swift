import Foundation

/// Viewport-relative touch zones. This policy never interprets playing or changes practice data.
public enum ScoreReadingInteraction {
    public static func togglesFocus(x: Double, y: Double) -> Bool {
        x.isFinite && y.isFinite && (1.0 / 3.0...2.0 / 3.0).contains(x)
            && (0...1).contains(y) && (y <= 0.16 || y >= 0.84)
    }

    public static func pageDirection(x: Double) -> Int { x < 1.0 / 3.0 ? -1 : 1 }
}
