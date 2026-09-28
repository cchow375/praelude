import SwiftUI
import PDFKit

/// §16: score heatmap — passages and break-point taps colored by recent results (solid/shaky/failing,
/// monochrome weights) — toggleable from Score options. A separate, self-contained page renderer
/// (a static page image with the heat coloring baked in, the same technique `PassagePreview` already
/// uses for a passage thumbnail, rotation correction included), not a `ScorePageOverlay` change: it
/// never touches that file or `PagedScoreView`'s live ink/passage-box overlay, so it can't conflict
/// with the annotation track's edits there, and it reads its own zoom/scroll rather than needing to
/// track PDFKit's. See `PracticeHeatmap` (Core) for the coloring rule itself.
struct ScoreHeatmapView: View {
    @Environment(PracticeStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let pieceID: UUID
    let url: URL
    @State private var page: Int
    @State private var image: UIImage?

    init(pieceID: UUID, url: URL, startPage: Int) {
        self.pieceID = pieceID; self.url = url
        _page = State(initialValue: max(1, startPage))
    }

    private var piece: Piece? { store.state.pieces.first { $0.id == pieceID } }
    private var passages: [Passage] { store.state.passages.filter { $0.pieceID == pieceID && !$0.archived } }
    private var taps: [BreakPointTap] {
        let ids = Set(passages.map(\.id))
        return store.state.breakPointTaps.filter { ids.contains($0.passageID) }
    }

    var body: some View {
        NavigationStack {
            ScrollView([.horizontal, .vertical]) {
                Group {
                    if let image { Image(uiImage: image).resizable().scaledToFit().frame(maxWidth: .infinity) }
                    else { SwiftUI.ProgressView().frame(maxWidth: .infinity, minHeight: 300) }
                }
            }
            .background(PraeludeColor.scorePaper)
            .safeAreaInset(edge: .bottom) { legend }
            .navigationTitle("Score heatmap")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } }
                ToolbarItem(placement: .topBarTrailing) { pageControls }
            }
            .task(id: page) { render() }
            .onChange(of: store.state.revision) { _, _ in render() }
        }
    }

    private var pageControls: some View {
        HStack(spacing: 2) {
            Button { page = max(1, page - 1) } label: { Image(systemName: "chevron.left").frame(width: 36, height: 36) }
                .disabled(page <= 1).accessibilityLabel("Previous page")
            Text("\(page) / \(max(1, piece?.pageCount ?? 1))").font(.subheadline.monospacedDigit()).fixedSize()
            Button { page = min(piece?.pageCount ?? 1, page + 1) } label: { Image(systemName: "chevron.right").frame(width: 36, height: 36) }
                .disabled(page >= (piece?.pageCount ?? 1)).accessibilityLabel("Next page")
        }
    }

    private var legend: some View {
        HStack(spacing: 16) {
            legendSwatch(.solid, "Solid")
            legendSwatch(.shaky, "Shaky")
            legendSwatch(.failing, "Failing")
            Spacer(minLength: 8)
            Text("Unmarked passages have no recent result.").font(.caption2).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 16).padding(.vertical, 10).praeludeScoreChrome()
    }

    private func legendSwatch(_ level: HeatLevel, _ label: String) -> some View {
        HStack(spacing: 5) {
            RoundedRectangle(cornerRadius: 3).fill(PraeludeColor.scoreInk.opacity(level.weight)).frame(width: 14, height: 14)
                .overlay(RoundedRectangle(cornerRadius: 3).strokeBorder(PraeludeColor.scoreInk.opacity(0.4)))
            Text(label).font(.caption)
        }
    }

    private func render() {
        image = ScoreHeatmapRenderer.render(
            url: url, page: page, passages: passages, taps: taps, now: Date(),
            levelForPassage: { PracticeHeatmap.passageLevel(passageID: $0, state: store.state, now: Date(), calendar: .current) })
    }
}

/// Composes one page's base render with heat-colored passage boxes and break-point-tap dots into a
/// single `UIImage`, mirroring `PassagePreview.makeThumbnail`'s draw-then-overlay technique (including
/// its page-rotation correction) rather than inventing a second convention for the same job.
/// Internal (not `private`) so `PraeludeAppTests` can exercise it directly — see
/// `ScoreHeatmapRendererTests.swift`.
@MainActor enum ScoreHeatmapRenderer {
    static func render(url: URL, page: Int, passages: [Passage], taps: [BreakPointTap], now: Date,
                        levelForPassage: (UUID) -> HeatLevel?) -> UIImage? {
        guard let pdfPage = PDFDocument(url: url)?.page(at: max(0, page - 1)) else { return nil }
        let bounds = pdfPage.bounds(for: .cropBox)
        guard bounds.width > 0, bounds.height > 0 else { return nil }
        let scale = min(3, 1400 / bounds.width)
        let base = pdfPage.thumbnail(of: CGSize(width: bounds.width * scale, height: bounds.height * scale), for: .cropBox)
        let rotation = ((pdfPage.rotation % 360) + 360) % 360

        func mapped(_ unit: CGRect) -> CGRect {
            var rect = unit
            switch rotation {
            case 90: rect = CGRect(x: 1 - rect.maxY, y: rect.minX, width: rect.height, height: rect.width)
            case 180: rect = CGRect(x: 1 - rect.maxX, y: 1 - rect.maxY, width: rect.width, height: rect.height)
            case 270: rect = CGRect(x: rect.minY, y: 1 - rect.maxX, width: rect.height, height: rect.width)
            default: break
            }
            return CGRect(x: rect.minX * base.size.width, y: rect.minY * base.size.height,
                          width: rect.width * base.size.width, height: rect.height * base.size.height)
        }

        let ink = UIColor(PraeludeColor.scoreInk)
        return UIGraphicsImageRenderer(size: base.size).image { context in
            base.draw(at: .zero)
            let cg = context.cgContext
            for passage in passages {
                guard let level = levelForPassage(passage.id) else { continue }
                for region in passage.regions where region.page == page {
                    let box = mapped(CGRect(x: region.x, y: region.y, width: region.width, height: region.height))
                    cg.setFillColor(ink.withAlphaComponent(level.weight).cgColor)
                    cg.fill(box)
                    cg.setStrokeColor(ink.withAlphaComponent(0.4).cgColor)
                    cg.setLineWidth(level == .failing ? 1.6 : level == .shaky ? 1.1 : 0.6)
                    cg.stroke(box)
                }
            }
            for tap in taps {
                guard let location = tap.location else { continue }
                let center = CGPoint(x: location.x + location.width / 2, y: location.y + location.height / 2)
                // `BreakPointTap` carries no page of its own (§4d keeps append-only rows minimal); a
                // tap's already page-normalized point is attributed to this page only when it falls
                // inside one of its own passage's regions here — the same "page-normalized units"
                // geometry R8's own clustering already assumes (see "(C) Rules Engine.md").
                guard let passage = passages.first(where: { $0.id == tap.passageID }),
                      passage.regions.contains(where: { $0.page == page && CGRect(x: $0.x, y: $0.y, width: $0.width, height: $0.height).contains(center) })
                else { continue }
                let mappedCenter = mapped(CGRect(x: center.x, y: center.y, width: 0, height: 0)).origin
                let radius: CGFloat = 5
                cg.setFillColor(ink.withAlphaComponent(PracticeHeatmap.tapOpacity(tap, now: now)).cgColor)
                cg.fillEllipse(in: CGRect(x: mappedCenter.x - radius, y: mappedCenter.y - radius, width: radius * 2, height: radius * 2))
            }
        }
    }
}
