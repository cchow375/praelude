import XCTest
@testable import PraeludeCore

final class PracticeTechniqueTests: XCTestCase {
    func testRhythmAndHandChainsReturnToTheWrittenMusic() {
        XCTAssertEqual(PracticeTechnique.rhythmPair.stageNames, ["Long–short", "Short–long", "As written"])
        XCTAssertEqual(PracticeTechnique.hands.stageNames, ["Right hand", "Left hand", "Together"])
    }
    func testIndividualHandChoicesStayIndependentFromTheHandsChain() {
        XCTAssertEqual(PracticeTechnique.rightHand.stageNames, ["Right hand"])
        XCTAssertEqual(PracticeTechnique.leftHand.stageNames, ["Left hand"])
        XCTAssertEqual(PracticeTechnique.hands.stageNames, ["Right hand", "Left hand", "Together"])
    }
    func testEveryChoiceProducesAnIndependentEditableChainWithBoundedTargets() {
        for technique in PracticeTechnique.allCases {
            let first = technique.stages(targetCount: 7)
            let second = technique.stages(targetCount: 7)
            XCTAssertFalse(technique.instruction.isEmpty)
            XCTAssertTrue(first.allSatisfy { $0.targetCount == 7 })
            XCTAssertTrue(Set(first.map(\.id)).isDisjoint(with: second.map(\.id)))
            XCTAssertTrue(technique.stages(targetCount: 0).allSatisfy { $0.targetCount == 1 })
            XCTAssertTrue(technique.stages(targetCount: 1000).allSatisfy { $0.targetCount == 100 })
        }
    }
    @MainActor func testColdGradeCommitsOneWriteAndRestoresTheSameEvidence() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        var writes = 0
        let store = PracticeStore(directory: directory, writeData: { data, url in
            writes += 1; try data.write(to: url, options: .atomic)
        })
        let piece = Piece(title: "Score", pdfFileName: "score.pdf", pageCount: 2)
        try store.addPiece(piece)
        let passage = Passage(pieceID: piece.id, title: "Join", regions: [PassageRegion(page: 1, x: 0.1, y: 0.1, width: 0.5, height: 0.1)])
        try store.savePassage(passage)
        let before = writes, eventID = UUID()
        let configuration = PracticeConfiguration(pieceID: piece.id, passageID: passage.id,
            targetCount: 3, startBPM: 72, targetBPM: 72, stages: PracticeTechnique.rhythmPair.stages())
        let application = try store.startColdGradedSet(configuration, grade: .clean, eventID: eventID)
        XCTAssertEqual(writes - before, 1)
        XCTAssertEqual(store.activeSet?.attempts.map(\.id), [eventID])
        XCTAssertEqual(store.activeSet?.attempts.first?.bpm, 72)
        XCTAssertEqual(store.activeSet?.progressCount, 1)
        XCTAssertEqual(store.state.coldGrades, [application.record])
        XCTAssertEqual(store.state.passages.first?.schedule, application.newSchedule)
        XCTAssertEqual(store.state.ruleEvents.count, application.decisions.count)
        let reopened = PracticeStore(directory: directory)
        XCTAssertEqual(reopened.state.coldGrades, store.state.coldGrades)
        XCTAssertEqual(reopened.activeSet?.attempts, store.activeSet?.attempts)
    }

    @MainActor func testColdGradeFailureLeavesEveryPracticeRecordAndExactDiskBytesUnchanged() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        var fail = false
        let store = PracticeStore(directory: directory, writeData: { data, url in
            if fail { throw CocoaError(.fileWriteOutOfSpace) }
            try data.write(to: url, options: .atomic)
        })
        let piece = Piece(title: "Score", pdfFileName: "score.pdf", pageCount: 2)
        try store.addPiece(piece)
        let passage = Passage(pieceID: piece.id, title: "Section")
        try store.savePassage(passage)
        let original = store.state, bytes = try Data(contentsOf: store.fileURL)
        let configuration = PracticeConfiguration(pieceID: piece.id, passageID: passage.id)
        fail = true
        XCTAssertThrowsError(try store.startColdGradedSet(configuration, grade: .shaky))
        XCTAssertEqual(store.state, original)
        XCTAssertEqual(try Data(contentsOf: store.fileURL), bytes)
        XCTAssertEqual(PracticeStore(directory: directory).state, original)
        fail = false
        try store.startColdGradedSet(configuration, grade: .shaky)
        XCTAssertEqual(store.state.coldGrades.count, 1)
        XCTAssertEqual(store.activeSet?.attempts.count, 1)
    }

    @MainActor func testJoiningVisualPassagesCopiesUniqueBoxesAndKeepsProvenanceAtomically() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        var fail = false
        let store = PracticeStore(directory: directory, writeData: { data, url in
            if fail { throw CocoaError(.fileWriteOutOfSpace) }; try data.write(to: url, options: .atomic)
        })
        let piece = Piece(title: "Score", pdfFileName: "score.pdf", pageCount: 2)
        try store.addPiece(piece)
        let a = Passage(pieceID: piece.id, title: "A", startMeasure: 1, endMeasure: 8,
            regions: [PassageRegion(page: 1, x: 0.1, y: 0.1, width: 0.5, height: 0.1)])
        let b = Passage(pieceID: piece.id, title: "B", startMeasure: 9, endMeasure: 16,
            regions: [PassageRegion(page: 2, x: 0.1, y: 0.1, width: 0.5, height: 0.1)])
        try store.savePassage(a); try store.savePassage(b)
        let original = store.state, bytes = try Data(contentsOf: store.fileURL)
        fail = true
        XCTAssertThrowsError(try store.joinPassages([b.id, a.id]))
        XCTAssertEqual(store.state, original); XCTAssertEqual(try Data(contentsOf: store.fileURL), bytes)
        fail = false
        let joined = try store.joinPassages([b.id, a.id])
        XCTAssertEqual(joined.startMeasure, 1); XCTAssertEqual(joined.endMeasure, 16)
        XCTAssertEqual(joined.joinedFromPassageIDs, [b.id, a.id])
        XCTAssertEqual(store.state.passages.filter { !$0.archived }.map(\.id), [joined.id])
        XCTAssertTrue(Set(joined.regions.map(\.id)).isDisjoint(with: Set((a.regions + b.regions).map(\.id))))
        XCTAssertNil(PracticeStore(directory: directory).errorMessage)
    }

    @MainActor func testRepeatedTotalPlaysUsesItsAdjustedFixedTempoAndRetainsConditionsAfterRelaunch() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = PracticeStore(directory: directory)
        let piece = Piece(title: "Paper")
        try store.addPiece(piece)
        let passage = Passage(pieceID: piece.id, title: "Section")
        try store.savePassage(passage)
        try store.startSet(PracticeConfiguration(pieceID: piece.id, passageID: passage.id, goal: .memory,
            basis: .totalPlays, targetCount: 7, startBPM: 80, targetBPM: 80, hands: "Left hand"))
        try store.adjustActiveTempo(72); try store.record(.clean); try store.endSet()
        let reopened = PracticeStore(directory: directory)
        let repeated = try XCTUnwrap(PracticeRulesEngine.defaultConfiguration(for: passage.id, context: RuleContext(state: reopened.state)))
        XCTAssertEqual(repeated.startBPM, 72); XCTAssertEqual(repeated.targetBPM, 72)
        XCTAssertEqual(repeated.targetCount, 7); XCTAssertEqual(repeated.goal, .memory)
        XCTAssertEqual(repeated.hands, "Left hand"); XCTAssertTrue(repeated.tempoChanges.isEmpty)
        XCTAssertNoThrow(try reopened.startSet(repeated))
    }

}
