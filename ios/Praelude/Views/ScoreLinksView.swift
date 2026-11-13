import SwiftUI
import PDFKit
import UIKit

extension NormalizedRect {
    /// Whether a normalized (0...1) fraction of the page falls inside this rect — the hit test
    /// `PagedScoreView` runs when a reading tap might have landed on a link's tap region.
    /// `rect(in:)` lives on this same type in `ScoreMarkupState.swift`, shared with stamps/text boxes.
    func contains(_ fraction: CGPoint) -> Bool {
        fraction.x >= x && fraction.x <= x + width && fraction.y >= y && fraction.y <= y + height
    }
}

/// §7 links: a tap region on a repeat/D.S./coda that jumps the reader to another page, plus (from
/// `ScoreWorkspace`) a jump-back button. Source/target pages are *displayed* page numbers, so they
/// keep meaning the position the player taps/lands on even if page tools later reorder the score.
struct ScoreLinksView: View {
    let pieceID: UUID
    let pageCount: Int
    let currentPage: Int
    @Environment(PracticeStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var editing: ScoreLink?
    @State private var errorMessage: String?

    private var links: [ScoreLink] {
        store.state.scoreLinks.filter { $0.pieceID == pieceID && $0.deletedAt == nil }
            .sorted { $0.sourcePage == $1.sourcePage ? $0.label < $1.label : $0.sourcePage < $1.sourcePage }
    }
    var body: some View {
        NavigationStack {
            List {
                if let errorMessage { Section { ErrorMessage(message: errorMessage) } }
                if links.isEmpty {
                    PraeludeEmptyState(title: "No links yet", symbol: "arrow.triangle.turn.up.right.diamond",
                                      message: "Draw a tap region on a repeat, D.S. or coda, then choose where it jumps.",
                                      actionTitle: "Add a link", action: addLink)
                        .listRowBackground(Color.clear).listRowSeparator(.hidden)
                } else {
                    Section {
                        ForEach(links) { link in
                            Button { editing = link } label: {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(link.label.isEmpty ? "Page \(link.sourcePage) → \(link.targetPage)" : link.label)
                                        .foregroundStyle(.primary)
                                    Text("Page \(link.sourcePage) jumps to page \(link.targetPage)")
                                        .font(.caption).foregroundStyle(.secondary)
                                }.frame(minHeight: 44)
                            }
                            .swipeActions(edge: .trailing) { Button("Delete", role: .destructive) { delete(link) } }
                        }
                    } footer: { Text("Tap a link while reading to jump. The jump-back button in Score options returns you.") }
                }
            }
            .scrollContentBackground(.hidden).background(PraeludeColor.paper)
            .navigationTitle("Links").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("Add", systemImage: "plus", action: addLink) }
            }
            .sheet(item: $editing) { link in ScoreLinkEditorView(pieceID: pieceID, pageCount: pageCount, link: link) }
        }.presentationDetents([.large])
    }
    private func addLink() { editing = ScoreLink(pieceID: pieceID, sourcePage: currentPage, targetPage: currentPage) }
    private func delete(_ link: ScoreLink) {
        do { try store.deleteScoreLink(link.id) } catch { errorMessage = error.localizedDescription }
    }
}

private struct ScoreLinkEditorView: View {
    let pieceID: UUID
    let pageCount: Int
    @State var link: ScoreLink
    @Environment(PracticeStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var errorMessage: String?
    @State private var dragStart: CGPoint?
    @State private var regionFraction: CGRect?
    @State private var previewSize: CGSize?

    /// `link.sourcePage` is a *displayed* page number (this type's own doc comment); `PageThumbnail`
    /// (also used by the page-tools editor, which always passes a real source page directly) expects
    /// a *source* PDF page. Resolves through the same effective order the reader uses, so the preview
    /// always matches the actual page the tap region will land on — `nil` for a generated blank/staff
    /// display page, which has no source PDF page to preview at all.
    private var resolvedSourcePage: Int? {
        guard let piece = store.state.pieces.first(where: { $0.id == pieceID }) else { return nil }
        let pages = PageLayout.effectivePages(pageEdits: store.state.pageEdits, pieceID: pieceID, sourcePageCount: piece.pageCount)
        return pages.first { $0.displayOrder == link.sourcePage }?.sourcePage
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    GeometryReader { geometry in
                        // `PageThumbnail` renders with `.scaledToFit()`, which letterboxes whenever the
                        // page's own aspect ratio doesn't match this container's — the actual page sits
                        // centered in `fit`, smaller than `geometry.size`. Every drag/overlay coordinate
                        // below is measured against `fit`, not the raw container, or a region drawn
                        // partly (or entirely) in the letterbox margin would be saved at the wrong place
                        // on the page (see "(C) Audit.md").
                        let fit = previewSize.flatMap { PageThumbnail.fitFrame(imageSize: $0, in: geometry.size) }
                            ?? CGRect(origin: .zero, size: geometry.size)
                        ZStack(alignment: .topLeading) {
                            if let resolvedSourcePage {
                                PageThumbnail(pieceID: pieceID, page: resolvedSourcePage, onImageSize: { previewSize = $0 })
                            } else {
                                PraeludeColor.inkFillQuiet
                                Text("This page has no source PDF page to preview.").font(.caption).foregroundStyle(.secondary).padding()
                            }
                            if let regionFraction {
                                Rectangle()
                                    .fill(PraeludeColor.ink.opacity(0.12))
                                    .overlay(Rectangle().stroke(PraeludeColor.ink.opacity(0.5), lineWidth: 1.5))
                                    .frame(width: max(2, regionFraction.width * fit.width), height: max(2, regionFraction.height * fit.height))
                                    .position(x: fit.minX + (regionFraction.minX + regionFraction.width / 2) * fit.width,
                                              y: fit.minY + (regionFraction.minY + regionFraction.height / 2) * fit.height)
                            }
                        }
                        .contentShape(Rectangle())
                        .gesture(DragGesture(minimumDistance: 4)
                            .onChanged { value in
                                guard previewSize != nil, fit.width > 0, fit.height > 0 else { return }
                                if dragStart == nil { dragStart = value.startLocation }
                                guard let start = dragStart else { return }
                                let rect = CGRect(x: min(start.x, value.location.x), y: min(start.y, value.location.y),
                                                  width: abs(value.location.x - start.x), height: abs(value.location.y - start.y))
                                // Clip to the actual thumbnail before normalizing, so a drag that
                                // strays into (or starts in) the letterbox margin never produces a
                                // fraction outside the page it is supposed to describe.
                                let clipped = rect.intersection(fit)
                                guard !clipped.isNull else { regionFraction = nil; return }
                                regionFraction = CGRect(x: (clipped.minX - fit.minX) / fit.width, y: (clipped.minY - fit.minY) / fit.height,
                                                        width: clipped.width / fit.width, height: clipped.height / fit.height)
                            }
                            .onEnded { _ in dragStart = nil })
                    }
                    .frame(height: 220)
                    .background(PraeludeColor.inkFillQuiet)
                    .clipShape(RoundedRectangle(cornerRadius: PraeludeRadius.tight))
                    Stepper("Source page \(link.sourcePage)", value: $link.sourcePage, in: 1...max(1, pageCount))
                        .onChange(of: link.sourcePage) { regionFraction = nil; previewSize = nil }
                } header: {
                    Text("Draw the tap region")
                } footer: { Text("Drag on the page above to mark where the repeat, D.S. or coda is written.") }
                Section("Jumps to") {
                    Stepper("Page \(link.targetPage)", value: $link.targetPage, in: 1...max(1, pageCount))
                }
                Section("Label") {
                    TextField("e.g. “D.S. al Coda”", text: $link.label)
                }
                if let errorMessage { Section { ErrorMessage(message: errorMessage) } }
            }
            .scrollContentBackground(.hidden).background(PraeludeColor.paper)
            .navigationTitle("Link").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("Save", action: save) }
            }
            .onAppear {
                if let region = link.sourceRegion { regionFraction = CGRect(x: region.x, y: region.y, width: region.width, height: region.height) }
            }
        }.presentationDetents([.medium, .large])
    }
    private func save() {
        do {
            var saved = link
            if let regionFraction {
                let width = max(0.02, min(1 - max(0, regionFraction.minX), regionFraction.width))
                let height = max(0.02, min(1 - max(0, regionFraction.minY), regionFraction.height))
                saved.sourceRegion = NormalizedRect(x: max(0, min(1, regionFraction.minX)), y: max(0, min(1, regionFraction.minY)),
                                                    width: width, height: height)
            }
            saved.label = saved.label.trimmingCharacters(in: .whitespacesAndNewlines)
            saved.updatedAt = Date()
            try store.saveScoreLink(saved)
            dismiss()
        } catch { errorMessage = error.localizedDescription }
    }
}

/// A single source-PDF page rendered at the view's size — used by the link editor and the crop
/// editor. Renders directly from the piece's original PDF (not a page-tool-composed view), which
/// matches what the player sees for the common piece that has no page edits yet.
struct PageThumbnail: View {
    let pieceID: UUID
    let page: Int
    var onImageSize: (CGSize?) -> Void = { _ in }
    @Environment(PracticeStore.self) private var store
    @State private var image: UIImage?
    var body: some View {
        GeometryReader { geometry in
            Group {
                if let image {
                    Image(uiImage: image).resizable().scaledToFit().frame(maxWidth: .infinity, maxHeight: .infinity)
                } else { PraeludeColor.inkFillQuiet }
            }
            .task(id: "\(pieceID)_\(page)_\(Int(geometry.size.width))x\(Int(geometry.size.height))") {
                image = nil; onImageSize(nil)
                guard geometry.size.width > 1, geometry.size.height > 1,
                      let piece = store.state.pieces.first(where: { $0.id == pieceID }),
                      let url = NativeLibraryFiles(store: store).scoreURL(for: piece), !Task.isCancelled else { return }
                let pixels = CGSize(width: geometry.size.width * UIScreen.main.scale,
                                    height: geometry.size.height * UIScreen.main.scale)
                let loaded = await PassageThumbnailRenderer.shared.renderPage(url: url, number: page, size: pixels)
                guard !Task.isCancelled else { return }
                image = loaded; onImageSize(loaded?.size)
            }
        }
    }
    /// The actual on-screen frame `.scaledToFit()` gives this view's rendered page image within a
    /// container of `size` — a page whose aspect ratio doesn't match `size` is letterboxed, centered,
    /// not stretched to fill it. A caller that overlays or measures something on top of this view (the
    /// link editor's drag region) must use this, not the raw container size, or it silently measures
    /// against the wrong frame whenever the two aspect ratios differ (see "(C) Audit.md").
    static func fitFrame(pieceID: UUID, page: Int, store: PracticeStore, in size: CGSize) -> CGRect? {
        guard size.width > 0, size.height > 0,
              let piece = store.state.pieces.first(where: { $0.id == pieceID }),
              let url = NativeLibraryFiles(store: store).scoreURL(for: piece),
              let document = PDFDocument(url: url), page >= 1, page <= document.pageCount,
              let pdfPage = document.page(at: page - 1) else { return nil }
        let box = pdfPage.bounds(for: .cropBox)
        guard box.width > 0, box.height > 0 else { return nil }
        let rotation = ((pdfPage.rotation % 360) + 360) % 360
        let rotated = rotation == 90 || rotation == 270 ? CGSize(width: box.height, height: box.width) : box.size
        return fitFrame(imageSize: rotated, in: size)
    }

    /// Pure geometry for live gestures; the PDF is read only once by the background preview task.
    static func fitFrame(imageSize: CGSize, in size: CGSize) -> CGRect? {
        guard imageSize.width.isFinite, imageSize.height.isFinite, imageSize.width > 0, imageSize.height > 0,
              size.width.isFinite, size.height.isFinite, size.width > 0, size.height > 0 else { return nil }
        let aspect = imageSize.width / imageSize.height
        let containerAspect = size.width / size.height
        let fitSize = aspect > containerAspect ? CGSize(width: size.width, height: size.width / aspect)
                                                : CGSize(width: size.height * aspect, height: size.height)
        return CGRect(x: (size.width - fitSize.width) / 2, y: (size.height - fitSize.height) / 2, width: fitSize.width, height: fitSize.height)
    }
}
