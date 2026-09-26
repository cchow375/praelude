import SwiftUI

// MARK: - Praelude Design System — Icons
//
// A small, consistent-stroke icon set drawn once for this app's core musical actions, instead
// of SF Symbols for these specific glyphs. Never emoji. Each glyph is built from straight lines
// and a small number of primitive shapes on a shared 24-unit grid, stroked at one consistent
// weight so the family reads as one instrument rather than mixed icon styles.

enum PraeludeGlyph {
    case metronome, passageBox, verdictClean, verdictSloppy, verdictAgain
    case tempo, mic, warmup
    case recording(live: Bool)
}

struct PraeludeIcon: View {
    var glyph: PraeludeGlyph
    var size: CGFloat = 24
    var weight: CGFloat? = nil

    private var lineWidth: CGFloat { weight ?? max(1.3, size * 0.075) }
    private var style: StrokeStyle { StrokeStyle(lineWidth: lineWidth, lineCap: .round, lineJoin: .round) }

    var body: some View {
        Group {
            switch glyph {
            case .metronome: PraeludeGlyphShape.metronome.stroke(style: style)
            case .passageBox: PraeludeGlyphShape.passageBox.stroke(style: style)
            case .verdictClean: PraeludeGlyphShape.verdictClean.stroke(style: style)
            case .verdictSloppy: PraeludeGlyphShape.verdictSloppy.stroke(style: style)
            case .verdictAgain: PraeludeGlyphShape.verdictAgain.stroke(style: style)
            case .tempo: PraeludeGlyphShape.tempo.stroke(style: style)
            case .mic: PraeludeGlyphShape.mic.stroke(style: style)
            case .warmup: PraeludeGlyphShape.warmup.stroke(style: style)
            case .recording(let live):
                ZStack {
                    Circle().stroke(style: style)
                    if live { Circle().padding(size * 0.24) }
                }
            }
        }
        .frame(width: size, height: size)
    }
}

/// The glyphs that reduce to a single stroked `Path` on the shared 24-unit grid. `.recording`
/// is composed separately above since it needs a conditional fill, not a single path.
private enum PraeludeGlyphShape: Shape {
    case metronome, passageBox, verdictClean, verdictSloppy, verdictAgain, tempo, mic, warmup

    func path(in rect: CGRect) -> Path {
        var path = Path()
        let s = rect.width / 24
        func P(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: rect.minX + x * s, y: rect.minY + y * s) }

        switch self {
        case .metronome:
            // A pendulum case with its arm tilted off-center, as if mid-tick.
            path.move(to: P(7, 21)); path.addLine(to: P(17, 21)); path.addLine(to: P(14, 4)); path.addLine(to: P(10, 4))
            path.closeSubpath()
            path.move(to: P(12, 20)); path.addLine(to: P(15.6, 7))

        case .passageBox:
            // Four viewfinder corners — evokes drawing a box around a passage, not a full frame.
            let c: CGFloat = 5
            path.move(to: P(4, 4 + c)); path.addLine(to: P(4, 4)); path.addLine(to: P(4 + c, 4))
            path.move(to: P(20 - c, 4)); path.addLine(to: P(20, 4)); path.addLine(to: P(20, 4 + c))
            path.move(to: P(20, 20 - c)); path.addLine(to: P(20, 20)); path.addLine(to: P(20 - c, 20))
            path.move(to: P(4 + c, 20)); path.addLine(to: P(4, 20)); path.addLine(to: P(4, 20 - c))

        case .verdictClean:
            // A hand-drawn checkmark, not the system glyph.
            path.move(to: P(4.5, 12.5)); path.addLine(to: P(9.5, 18)); path.addLine(to: P(19.5, 5.5))

        case .verdictSloppy:
            // An uneven zigzag — the shape itself reads "rough," not just its color.
            path.move(to: P(3, 16)); path.addLine(to: P(7.5, 7)); path.addLine(to: P(12, 16))
            path.addLine(to: P(16.5, 7)); path.addLine(to: P(21, 16))

        case .verdictAgain:
            // A near-full circle with a deliberate gap, plus a short arrowhead at its open end.
            path.addArc(center: P(12, 12.5), radius: 7 * s, startAngle: .degrees(-55), endAngle: .degrees(215), clockwise: false)
            path.move(to: P(17.6, 6.2)); path.addLine(to: P(19.3, 9))
            path.move(to: P(17.6, 6.2)); path.addLine(to: P(14.6, 7.4))

        case .tempo:
            // A five-bar tempo/level meter, peaking in the center.
            let bars: [(CGFloat, CGFloat)] = [(4, 6), (8.5, 10), (13, 15), (17.5, 10), (22, 6)]
            for (x, h) in bars {
                path.move(to: P(x, 19)); path.addLine(to: P(x, 19 - h))
            }

        case .mic:
            let head = CGRect(x: P(9, 3).x, y: P(9, 3).y, width: 6 * s, height: 11 * s)
            path.addPath(Capsule().path(in: head))
            path.move(to: P(7, 12)); path.addLine(to: P(7, 14)); path.addLine(to: P(9, 16.5))
            path.move(to: P(17, 12)); path.addLine(to: P(17, 14)); path.addLine(to: P(15, 16.5))
            path.move(to: P(12, 16.5)); path.addLine(to: P(12, 20))
            path.move(to: P(8, 20)); path.addLine(to: P(16, 20))

        case .warmup:
            // Rising bars on a baseline — building up, not up-and-down like Sloppy.
            path.move(to: P(2, 20)); path.addLine(to: P(22, 20))
            let bars: [(CGFloat, CGFloat)] = [(5.5, 4), (10.5, 8), (15.5, 12), (20.5, 16)]
            for (x, h) in bars {
                path.move(to: P(x, 20)); path.addLine(to: P(x, 20 - h))
            }
        }
        return path
    }
}
