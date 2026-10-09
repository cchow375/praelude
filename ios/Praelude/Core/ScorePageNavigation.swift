import Foundation

/// Movement pages can be noncontiguous after a reader reorders or inserts PDF pages.
/// Navigate the permitted reading-order entries, never the numeric interval between their ends.
public enum ScorePageNavigation {
    public static func nearest(_ requested: Int, among pages: [Int]) -> Int {
        pages.min { abs($0 - requested) < abs($1 - requested) } ?? max(1, requested)
    }

    public static func advance(_ current: Int, by offset: Int, among pages: [Int]) -> Int {
        guard !pages.isEmpty else { return max(1, current) }
        let selected = nearest(current, among: pages)
        let index = pages.firstIndex(of: selected) ?? 0
        return pages[min(pages.count - 1, max(0, index + offset))]
    }
}
