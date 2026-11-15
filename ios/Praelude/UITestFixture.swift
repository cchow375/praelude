#if DEBUG
import Foundation
import UIKit
import SwiftUI

/// Disposable UI-test content only. A normal install always starts blank.
@MainActor
enum UITestFixture {
    static func configureMetronomeForAudit(_ metronome: MetronomeService) {
        let arguments = ProcessInfo.processInfo.arguments
        guard arguments.contains("--uitesting"), arguments.contains("--audit-max-tempo") else { return }
        metronome.setTempo(300)
    }
    /// Explicit, disposable simulator audit only. The caller must supply a readable copy; this
    /// path never runs in Release or against the ordinary app store.
    static func installDesktopTransferIfRequested(into store: PracticeStore) {
        let arguments = ProcessInfo.processInfo.arguments
        guard arguments.contains("--uitesting"), let flag = arguments.firstIndex(of: "--desktop-transfer"),
              arguments.indices.contains(flag + 1) else { return }
        do {
            let data = try Data(contentsOf: URL(fileURLWithPath: arguments[flag + 1]))
            let transfer = try DesktopTransfer.decode(data)
            try DesktopLibraryFiles(store: store).importTransfer(transfer, data: data)
        } catch { assertionFailure("Requested desktop audit transfer failed: \(error)") }
    }
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
            // Some imported scans use image-sized PDF points rather than paper-sized points.
            // Keep identical visible content while exercising that geometry in native UI tests.
            let oversized = ProcessInfo.processInfo.arguments.contains("--seed-large-page")
            let pageSize = oversized ? CGSize(width: 5609.6, height: 7764.01) : CGSize(width: 595, height: 842)
            let renderer = UIGraphicsPDFRenderer(bounds: CGRect(origin: .zero, size: pageSize))
            let data = renderer.pdfData { context in
                for page in 1...4 {
                    context.beginPage()
                    let cg = context.cgContext
                    cg.scaleBy(x: pageSize.width / 595, y: pageSize.height / 842)
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
            let sections = ProcessInfo.processInfo.arguments.contains("--uitesting") && ProcessInfo.processInfo.arguments.contains("--seed-sections")
            let centeredGestureTarget = ProcessInfo.processInfo.arguments.contains("--uitesting") && ProcessInfo.processInfo.arguments.contains("--audit-gesture-preservation")
            try store.savePassage(Passage(pieceID: id, title: "Evenness and pulse", startMeasure: 1, endMeasure: 4, page: 1, focus: "Pulse",
                regions: sections ? [PassageRegion(page: 1, x: 0.05, y: centeredGestureTarget ? 0.435 : 0.16, width: 0.9, height: 0.13)] : []))
            if sections {
                try store.savePassage(Passage(pieceID: id, title: "Phrase connection", startMeasure: 5, endMeasure: 8, page: 1, focus: "Phrasing",
                    regions: [PassageRegion(page: 1, x: 0.05, y: 0.35, width: 0.9, height: 0.13)]))
            }
            try store.addPiece(Piece(title: "Scale practice", composer: "Technique"))
            let arguments = ProcessInfo.processInfo.arguments
            if arguments.contains("--uitesting"), arguments.contains("--audit-daily-plan") {
                let calendar = Calendar.current, today = calendar.startOfDay(for: Date())
                let yesterday = calendar.date(byAdding: .day, value: -1, to: today)!.addingTimeInterval(12 * 3600)
                let piece = store.pieces.first { $0.id == id }!
                try store.setPracticeReference(100, plan: piece.practiceBalancePlan, for: id)
                for index in 141...149 {
                    let passage = Passage(id: UUID(uuidString: "00000000-0000-4000-8000-\(String(format: "%012d", index))")!,
                        pieceID: id, title: index == 141 ? "Yesterday’s hard-won passage" : "Phrase \(index - 140)",
                        startMeasure: (index - 141) * 4 + 1, endMeasure: (index - 141) * 4 + 4,
                        page: (index - 141) / 4 + 1, learningState: .learning,
                        schedule: PassageSchedule(dueDate: calendar.date(byAdding: .day, value: index == 149 ? 7 : -13, to: today)!))
                    try store.savePassage(passage)
                    if index == 141 {
                        try store.applySyncedColdGrade(ColdGradeRecord(passageID: passage.id, date: yesterday, grade: .shaky, tempo: 75))
                        var session = PracticeSession(pieceID: id, focus: "Recall fixture", startedAt: yesterday)
                        let config = PracticeConfiguration(pieceID: id, passageID: passage.id, focus: "Pulse", targetCount: 5,
                            startBPM: 100, targetBPM: 100, passageSnapshot: passage, fullTempoBPM: 100)
                        var set = ActiveSet(sessionID: session.id, configuration: config, startedAt: yesterday)
                        set.attempts = [Attempt(verdict: .sloppy, date: yesterday, bpm: 100)] + (1...5).map {
                            Attempt(verdict: .clean, date: yesterday.addingTimeInterval(Double($0 * 20)), bpm: 100)
                        }
                        set = PracticeEngine.project(set)
                        set.endedAt = yesterday.addingTimeInterval(100); set.lastCheckpoint = nil
                        session.endedAt = set.endedAt; session.attempts = set.attempts; session.completedSets = 1
                        try store.applySyncedPracticeSnapshot(sessions: [session], sets: [set],
                            attempts: set.attempts.map { (attempt: $0, setID: set.id) })
                    }
                }
            }
            if arguments.contains("--uitesting"), arguments.contains("--audit-review-priority") {
                let calendar = Calendar.current, today = calendar.startOfDay(for: Date())
                let fixtures: [(String, String, Int, ColdGrade)] = [
                    ("00000000-0000-4000-8000-000000000131", "Overdue synthetic review", -2, .missed),
                    ("00000000-0000-4000-8000-000000000132", "Due tough synthetic review", 0, .shaky),
                    ("00000000-0000-4000-8000-000000000133", "Future tough synthetic review", 2, .missed)
                ]
                for (identity, title, offset, grade) in fixtures {
                    let passage = Passage(id: UUID(uuidString: identity)!, pieceID: id, title: title,
                        learningState: .learning, schedule: PassageSchedule(dueDate: calendar.date(byAdding: .day, value: offset, to: today)!))
                    try store.savePassage(passage)
                    try store.applySyncedColdGrade(ColdGradeRecord(passageID: passage.id,
                        date: calendar.date(byAdding: .day, value: -3, to: today)!, grade: grade, tempo: 60))
                }
            }
            // Exact disposable-library baseline for an independent host-side preservation audit.
            // This entire file is excluded from Release; no ordinary app store is accessed.
            if arguments.contains("--uitesting"), arguments.contains("--audit-review-priority") || arguments.contains("--audit-gesture-preservation") {
                try Data(contentsOf: store.fileURL).write(to: store.directory.appendingPathComponent("fresh13-audit-before.json"), options: .atomic)
            }
        } catch { assertionFailure("UI fixture failed: \(error)") }
    }
}
/// Traits are scoped to the disposable UI-test root. Ordinary Debug and all Release launches use
/// their normal system preferences; no simulator or physical-device setting is written.
extension View {
    @ViewBuilder func uiTestAuditAppearance() -> some View {
        let arguments = ProcessInfo.processInfo.arguments
        if arguments.contains("--uitesting"), arguments.contains("--audit-accessibility") {
            self.environment(\.praeludeAuditOpaqueSurface, true)
                .preferredColorScheme(arguments.contains("--audit-dark") ? .dark : nil)
        } else if arguments.contains("--uitesting"), arguments.contains("--audit-dark") {
            self.preferredColorScheme(.dark)
        } else { self }
    }
}
#endif
