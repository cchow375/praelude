#if DEBUG
import Foundation
import UIKit

/// Disposable UI-test content only. A normal install always starts blank.
@MainActor
enum UITestFixture {
    /// An already-onboarded instrument, so a `--uitesting` launch never stops at AppRootView's
    /// "no live instrument" onboarding gate unless a test is specifically exercising §6 onboarding
    /// (none currently are). Called on every `--uitesting` launch, independent of `--seed`, so even
    /// a genuinely blank/reset library (`testBlankInstallAndAddPaperPiece`) starts past onboarding.
    static func ensureOnboarded(into store: PracticeStore) {
        guard store.state.instruments.allSatisfy({ $0.deletedAt != nil }) else { return }
        try? store.saveInstrument(Instrument(family: .keyboard, name: "Piano", level: "Intermediate", isPrimary: true))
    }

    static func install(into store: PracticeStore) {
        guard store.state.pieces.isEmpty else { return }
        do {
            ensureOnboarded(into: store)
            try store.seedWarmupsIfNeeded(family: .keyboard)
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("Praelude UI study.pdf")
            let renderer = UIGraphicsPDFRenderer(bounds: CGRect(x: 0, y: 0, width: 595, height: 842))
            let data = renderer.pdfData { context in
                for page in 1...4 {
                    context.beginPage()
                    let cg = context.cgContext
                    let title = page == 1 ? "Practice study" : "Practice study · \(page)"
                    (title as NSString).draw(at: CGPoint(x: 52, y: 42), withAttributes: [.font: UIFont(name: "NewYork-Regular", size: 26) ?? UIFont.systemFont(ofSize: 26, weight: .medium)])
                    ("Praelude · original test score" as NSString).draw(at: CGPoint(x: 52, y: 78), withAttributes: [.font: UIFont.systemFont(ofSize: 11), .foregroundColor: UIColor.darkGray])
                    for system in 0..<4 {
                        let y = CGFloat(150 + system * 160)
                        ("\((page - 1) * 16 + system * 4 + 1)" as NSString).draw(at: CGPoint(x: 43, y: y - 22), withAttributes: [.font: UIFont.systemFont(ofSize: 10), .foregroundColor: UIColor.darkGray])
                        cg.setStrokeColor(UIColor.black.cgColor); cg.setLineWidth(0.65)
                        for staff in 0..<2 {
                            let baseline = y + CGFloat(staff * 62)
                            for line in 0..<5 {
                                cg.move(to: CGPoint(x: 55, y: baseline + CGFloat(line * 8)))
                                cg.addLine(to: CGPoint(x: 543, y: baseline + CGFloat(line * 8)))
                            }
                            for bar in 0...4 {
                                let x = 55 + CGFloat(bar * 122)
                                cg.move(to: CGPoint(x: x, y: baseline)); cg.addLine(to: CGPoint(x: x, y: baseline + 32))
                            }
                            cg.strokePath()
                            for note in 0..<16 {
                                let x = CGFloat(74 + note * 30)
                                let noteY = baseline + CGFloat(((note + system + staff) % 7) * 4 + 4)
                                cg.fillEllipse(in: CGRect(x: x, y: noteY, width: 9, height: 6))
                                cg.move(to: CGPoint(x: x + 8, y: noteY + 2)); cg.addLine(to: CGPoint(x: x + 8, y: noteY - 25)); cg.strokePath()
                            }
                        }
                    }
                    ("\(page)" as NSString).draw(at: CGPoint(x: 294, y: 810), withAttributes: [.font: UIFont.systemFont(ofSize: 11)])
                }
            }
            try data.write(to: url, options: .atomic)
            let id = try NativeLibraryFiles(store: store).importPDF(url, title: "Practice study", composer: "Praelude test score")
            try store.savePassage(Passage(pieceID: id, title: "Evenness and pulse", startMeasure: 1, endMeasure: 4, page: 1, focus: "Pulse"))
            try store.addPiece(Piece(title: "Scale practice", composer: "Technique"))
        } catch { assertionFailure("UI fixture failed: \(error)") }
    }
}
#endif
