import Foundation

/// R1 small chunks, R2 join the seams, R8 split weak spot, R13 parts separately — the rules that
/// look at a passage's shape and location history rather than its review schedule.
extension PracticeRulesEngine {
    // MARK: - R1 small chunks

    /// A page is assumed to fit roughly six or seven systems of engraving (a reasonable middle
    /// ground across piano/orchestral/lead-sheet layouts) — so one system is treated as about 15%
    /// of a page's normalized height. `r1MaxSystems` (default 2) is compared against that fraction,
    /// not against a literal system count Core has no way to read off a PDF. See "(C) Rules Engine.md".
    public static let assumedSystemHeightFraction: Double = 0.15

    /// R1: offer a split when a passage's tallest region exceeds `r1MaxSystems` systems (by the
    /// heuristic above), or — when measure numbers are set (§8: optional, never required) — when it
    /// spans more than `r1MaxMeasures` measures. When exactly one region stands out as the tall one,
    /// that region is named in the suggestion; otherwise (a pure measure-count trigger with no
    /// standout region, or several regions all oversized) the suggestion is passage-general.
    public static func evaluateR1SmallChunks(passageID: UUID, context: RuleContext) -> Decision? {
        guard context.settings.r1Enabled,
              let passage = context.passages.first(where: { $0.id == passageID }), !passage.archived else { return nil }
        let systemThreshold = context.settings.r1MaxSystems * assumedSystemHeightFraction
        let tallRegions = passage.regions.filter { $0.height > systemThreshold }
        let measureCount: Int? = {
            guard let start = passage.startMeasure, let end = passage.endMeasure else { return nil }
            return end - start + 1
        }()
        let overMeasures = measureCount.map { $0 > context.settings.r1MaxMeasures } ?? false
        guard !tallRegions.isEmpty || overMeasures else { return nil }
        let regionID = tallRegions.count == 1 ? tallRegions[0].id : nil
        let systemsLabel = String(format: "%g", context.settings.r1MaxSystems)
        let reason: String
        if !tallRegions.isEmpty && overMeasures {
            reason = "\(measureCount!) measures, taller than \(systemsLabel) systems. Worth splitting."
        } else if !tallRegions.isEmpty {
            reason = "Taller than \(systemsLabel) systems. Worth splitting."
        } else {
            reason = "\(measureCount!) measures in one box. Worth splitting."
        }
        return Decision(ruleID: .r1SmallChunks, pieceID: passage.pieceID, passageID: passageID, reason: reason,
                         firedAt: context.now, outcome: .suggestSplit(regionID: regionID))
    }

    // MARK: - R2 join the seams

    /// R2: two non-archived, Review-state passages of the same piece whose measure ranges are
    /// exactly adjacent (`a.endMeasure + 1 == b.startMeasure`) are offered as one joined passage.
    /// Measure numbers are optional and never asked for (§8), so a passage missing either bound can
    /// never be matched this way — a documented limitation: there is no page/region-based adjacency
    /// test that would not also misfire across a page turn or a multi-region passage. Returns every
    /// adjacent pair, oldest-measure-first first, so a run of three or more offers each seam once.
    public static func evaluateR2JoinSeams(pieceID: UUID, context: RuleContext) -> [Decision] {
        guard context.settings.r2Enabled else { return [] }
        let candidates = context.passages
            .filter { $0.pieceID == pieceID && !$0.archived && $0.learningState == .review
                      && $0.startMeasure != nil && $0.endMeasure != nil }
            .sorted { $0.startMeasure! < $1.startMeasure! }
        guard candidates.count > 1 else { return [] }
        var decisions: [Decision] = []
        for (a, b) in zip(candidates, candidates.dropFirst()) {
            guard a.endMeasure! + 1 == b.startMeasure! else { continue }
            decisions.append(Decision(ruleID: .r2JoinSeams, pieceID: pieceID, passageID: a.id,
                                       reason: "\(a.measureLabel) and \(b.measureLabel) meet at the barline. Join them?",
                                       firedAt: context.now, outcome: .suggestJoin(passageIDs: [a.id, b.id])))
        }
        return decisions
    }

    // MARK: - R8 split weak spot

    private static func tapCenter(_ tap: BreakPointTap) -> (x: Double, y: Double)? {
        guard let location = tap.location else { return nil }
        return (location.x + location.width / 2, location.y + location.height / 2)
    }

    private static func distance(_ a: (x: Double, y: Double), _ b: (x: Double, y: Double)) -> Double {
        let dx = a.x - b.x, dy = a.y - b.y
        return (dx * dx + dy * dy).squareRoot()
    }

    /// R8: two break-point taps "cluster" when the straight-line distance between their normalized
    /// page centers (a tap's location rect, collapsed to its own center point) is within
    /// `r8ClusterRadius`. The offered cluster is the single largest such neighborhood — the tap with
    /// the most neighbors within radius (ties broken by recording order) plus those neighbors — not
    /// a full hierarchical clustering, which this rule does not need. Fires once that neighborhood
    /// reaches `r8TapsToOfferSplit`, offering a sub-passage sized to its bounding box plus a small
    /// margin.
    public static func evaluateR8SplitWeakSpot(passageID: UUID, context: RuleContext) -> Decision? {
        guard context.settings.r8Enabled,
              let passage = context.passages.first(where: { $0.id == passageID }), !passage.archived else { return nil }
        let centers = context.breakPointTaps
            .filter { $0.passageID == passageID }
            .compactMap { tap -> (x: Double, y: Double)? in tapCenter(tap) }
        // Clamped to at least 1: a misconfigured (zero or negative) `r8TapsToOfferSplit` must never
        // let an empty `centers`/`bestNeighbors` reach the `.min()!`/`.max()!` below.
        let threshold = max(1, context.settings.r8TapsToOfferSplit)
        guard centers.count >= threshold else { return nil }
        let radius = context.settings.r8ClusterRadius
        var bestNeighbors: [Int] = []
        for i in centers.indices {
            let neighbors = centers.indices.filter { distance(centers[i], centers[$0]) <= radius }
            if neighbors.count > bestNeighbors.count { bestNeighbors = neighbors }
        }
        guard bestNeighbors.count >= threshold, !bestNeighbors.isEmpty else { return nil }
        let clusterCenters = bestNeighbors.map { centers[$0] }
        let minX = clusterCenters.map(\.x).min()!, maxX = clusterCenters.map(\.x).max()!
        let minY = clusterCenters.map(\.y).min()!, maxY = clusterCenters.map(\.y).max()!
        let padding = 0.03
        let x = max(0, minX - padding), y = max(0, minY - padding)
        let width = max(0.02, min(1 - x, (maxX - minX) + padding * 2))
        let height = max(0.02, min(1 - y, (maxY - minY) + padding * 2))
        let region = NormalizedRect(x: x, y: y, width: width, height: height)
        return Decision(ruleID: .r8SplitWeakSpot, pieceID: passage.pieceID, passageID: passageID,
                         reason: "\(bestNeighbors.count) taps land in the same spot. Split it out?",
                         firedAt: context.now, outcome: .suggestSubPassage(region: region))
    }

    // MARK: - R13 parts separately

    /// R13: `r13ConsecutiveMissed` (default 2) consecutive Missed cold grades suggest practicing a
    /// part alone, using the instrument family's own parts vocabulary (§6). The suggestion is always
    /// `partsVocabulary[1]` — the first alternative to the family's "together" entry (e.g. "Right
    /// hand" for keyboard, "Left hand only" for strings, "Articulation" for winds) — a defensible
    /// universal default since that vocabulary mixes literal parts (hands/bow) and techniques
    /// (articulation/vowel) under one umbrella; a future UI can offer the rest of the same list.
    /// Families with nothing to offer beyond "Full" (only `.other` today) do not fire.
    public static func evaluateR13PartsSeparately(passageID: UUID, context: RuleContext) -> Decision? {
        guard context.settings.r13Enabled,
              let passage = context.passages.first(where: { $0.id == passageID }), !passage.archived else { return nil }
        let grades = context.coldGrades.filter { $0.passageID == passageID }.sorted { $0.date < $1.date }
        guard grades.count >= context.settings.r13ConsecutiveMissed else { return nil }
        let trailing = grades.suffix(context.settings.r13ConsecutiveMissed)
        guard trailing.allSatisfy({ $0.grade == .missed }) else { return nil }
        var family: InstrumentFamily = .other
        if let piece = context.pieces.first(where: { $0.id == passage.pieceID }),
           let instrumentID = piece.instrumentID,
           let instrument = context.instruments.first(where: { $0.id == instrumentID }) {
            family = instrument.family
        }
        let vocabulary = family.partsVocabulary
        guard vocabulary.count > 1 else { return nil }
        let suggestion = vocabulary[1]
        return Decision(ruleID: .r13PartsSeparately, pieceID: passage.pieceID, passageID: passageID,
                         reason: "\(pluralize(context.settings.r13ConsecutiveMissed, "missed cold attempt")) in a row. Try \(suggestion) instead?",
                         firedAt: context.now, outcome: .suggestParts(suggestion))
    }
}
