import Foundation

/// A movement or piece inside one PDF. Source pages never move, so ink and recorded targets
/// retain their identity when a player organizes a sonata or collection.
public struct ScoreSection: Identifiable, Codable, Equatable, Sendable {
    public var id: UUID
    public var title: String
    public var startPage: Int
    public var endPage: Int
    public init(id: UUID = UUID(), title: String, startPage: Int, endPage: Int) {
        self.id = id; self.title = title; self.startPage = startPage; self.endPage = endPage
    }
}

/// A player-confirmed measure or system region on the original, unrotated source page.
/// A whole-system range labels that system's range, never an invented individual measure.
public struct ScoreMeasureAnchor: Identifiable, Codable, Equatable, Sendable {
    public var id: UUID
    public var page: Int
    public var region: NormalizedRect
    public var startMeasure: Int
    public var endMeasure: Int
    public init(id: UUID = UUID(), page: Int, region: NormalizedRect, startMeasure: Int, endMeasure: Int) {
        self.id = id; self.page = page; self.region = region
        self.startMeasure = startMeasure; self.endMeasure = endMeasure
    }
}

public enum ScoreOrganization {
    /// A set may target a whole reviewed movement without creating a saved passage or page boxes.
    /// Its existing snapshot field carries the name and complete source range through history,
    /// backups and sync, even if the movement is renamed or removed later. Passage rules use only
    /// passageID, which stays nil for these sets.
    public static func practiceSnapshot(for section: ScoreSection, pieceID: UUID, at date: Date) -> Passage {
        let range = section.startPage == section.endPage ? "source page \(section.startPage)"
            : "source pages \(section.startPage)–\(section.endPage)"
        return Passage(id: section.id, pieceID: pieceID, title: "\(section.title) · \(range)",
                       page: section.startPage, createdAt: date, updatedAt: date)
    }

    public static func section(for sourcePage: Int, in piece: Piece) -> ScoreSection? {
        piece.scoreSections.first { $0.startPage <= sourcePage && sourcePage <= $0.endPage }
    }
    public static func pageLabel(_ sourcePage: Int, in piece: Piece) -> String {
        guard let section = section(for: sourcePage, in: piece) else { return "Page \(sourcePage)" }
        return "\(section.title) · page \(sourcePage - section.startPage + 1)"
    }
    public static func locationLabel(for passage: Passage, in piece: Piece?) -> String {
        let pages = passage.regions.isEmpty ? [passage.page] : Array(Set(passage.regions.map(\.page))).sorted()
        let pageLabels = pages.map { page in piece.map { pageLabel(page, in: $0) } ?? "Page \(page)" }
        let location = pageLabels.joined(separator: " / ")
        let measures = displayMeasureLabel(for: passage, in: piece)
        return measures.isEmpty ? location : "\(measures) · \(location)"
    }
    /// Existing passages and immutable set snapshots gain useful labels when their original
    /// geometry is covered by a confirmed map. This never rewrites their recorded contract.
    public static func displayMeasureLabel(for passage: Passage, in piece: Piece?) -> String {
        if !passage.measureLabel.isEmpty { return passage.measureLabel }
        guard let piece, let range = measureRange(for: passage.regions, in: piece) else { return "" }
        return range.lowerBound == range.upperBound ? "m. \(range.lowerBound)" : "mm. \(range.lowerBound)–\(range.upperBound)"
    }
    /// Only known regions intersecting a box are eligible. If boxes touch different movements
    /// (whose measure numbering restarts), there is no meaningful single range to return.
    public static func measureRange(for regions: [PassageRegion], in piece: Piece) -> ClosedRange<Int>? {
        guard !regions.isEmpty else { return nil }
        let sectionIDs = Set(regions.map { section(for: $0.page, in: piece)?.id })
        guard sectionIDs.count == 1 else { return nil }
        var matches: [ScoreMeasureAnchor] = []
        for box in regions {
            let anchors = piece.measureAnchors.filter { anchor in
                anchor.page == box.page && box.x < anchor.region.x + anchor.region.width
                    && box.x + box.width > anchor.region.x && box.y < anchor.region.y + anchor.region.height
                    && box.y + box.height > anchor.region.y
            }
            // Require complete coverage, not just a tiny intersection that could label unknown bars.
            guard !anchors.isEmpty, covers(box, with: anchors) else { return nil }
            matches.append(contentsOf: anchors)
        }
        guard let first = matches.map(\.startMeasure).min(), let last = matches.map(\.endMeasure).max() else { return nil }
        return first...last
    }
    private static func covers(_ box: PassageRegion, with anchors: [ScoreMeasureAnchor]) -> Bool {
        let slices = Set([box.x, box.x + box.width] + anchors.flatMap {
            [max(box.x, $0.region.x), min(box.x + box.width, $0.region.x + $0.region.width)]
        }).sorted()
        for index in 1..<slices.count {
            let middle = (slices[index - 1] + slices[index]) / 2
            let intervals = anchors.filter { $0.region.x <= middle && middle <= $0.region.x + $0.region.width }
                .map { (max(box.y, $0.region.y), min(box.y + box.height, $0.region.y + $0.region.height)) }
                .sorted { $0.0 < $1.0 }
            var coveredUntil = box.y
            for interval in intervals {
                if interval.0 > coveredUntil + 0.000001 { return false }
                coveredUntil = max(coveredUntil, interval.1)
            }
            if coveredUntil < box.y + box.height - 0.000001 { return false }
        }
        return true
    }
    /// Group once, with current page first, instead of repeatedly filtering for each row.
    public static func passageGroups(_ passages: [Passage], currentPage: Int, in piece: Piece? = nil) -> [(page: Int, passages: [Passage])] {
        // Map each target once; comparator calls must remain cheap for large imported books.
        let measureStarts = Dictionary(passages.map { passage in
            (passage.id, passage.startMeasure ?? piece.flatMap { measureRange(for: passage.regions, in: $0)?.lowerBound } ?? Int.max)
        }, uniquingKeysWith: { first, _ in first })
        let sorted = passages.sorted { left, right in
            let a = measureStarts[left.id] ?? Int.max, b = measureStarts[right.id] ?? Int.max
            if a != b { return a < b }
            if left.page != right.page { return left.page < right.page }
            return left.title.localizedStandardCompare(right.title) == .orderedAscending
        }
        let groups = Dictionary(grouping: sorted) { passage in
            passage.regions.contains { $0.page == currentPage } ? currentPage : passage.page
        }
        return groups.keys.sorted {
            if $0 == currentPage { return true }; if $1 == currentPage { return false }; return $0 < $1
        }.map { (page: $0, passages: groups[$0] ?? []) }
    }
}
