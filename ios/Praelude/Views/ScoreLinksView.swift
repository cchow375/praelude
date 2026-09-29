import SwiftUI
import PDFKit
import UIKit

extension NormalizedRect {
    /// Whether a normalized (0...1) fraction of the page falls inside this rect — the hit test
    /// `PagedScoreView` runs when a reading tap might have landed on a link's tap region.
    func contains(_ fraction: CGPoint) -> Bool {
        fraction.x >= x && fraction.x <= x + width && fraction.y >= y && fraction.y <= y + height
    }
    /// The rect this normalized fraction occupies in a view of the given pixel size — the same
    /// top-left-origin convention `PassageRegion.rect(in:)` already uses.
    func rect(in size: CGSize) -> CGRect {
        CGRect(x: x * size.width, y: y * size.height, width: width * size.width, height: height * size.height)
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

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    GeometryReader { geometry in
                        ZStack(alignment: .topLeading) {
                            PageThumbnail(pieceID: pieceID, page: link.sourcePage)
                            if let regionFraction {
                                Rectangle()
                                    .fill(PraeludeColor.ink.opacity(0.12))
                                    .overlay(Rectangle().stroke(PraeludeColor.ink.opacity(0.5), lineWidth: 1.5))
                                    .frame(width: max(2, regionFraction.width * geometry.size.width), height: max(2, regionFraction.height * geometry.size.height))
                                    .position(x: (regionFraction.minX + regionFraction.width / 2) * geometry.size.width,
                                              y: (regionFraction.minY + regionFraction.height / 2) * geometry.size.height)
                            }
                        }
                        .contentShape(Rectangle())
                        .gesture(DragGesture(minimumDistance: 4)
                            .onChanged { value in
                                let size = geometry.size
                                guard size.width > 0, size.height > 0 else { return }
                                if dragStart == nil { dragStart = value.startLocation }
                                guard let start = dragStart else { return }
                                let rect = CGRect(x: min(start.x, value.location.x), y: min(start.y, value.location.y),
                                                  width: abs(value.location.x - start.x), height: abs(value.location.y - start.y))
                                regionFraction = CGRect(x: rect.minX / size.width, y: rect.minY / size.height,
                                                        width: rect.width / size.width, height: rect.height / size.height)
                            }
                            .onEnded { _ in dragStart = nil })
                    }
                    .frame(height: 220)
                    .background(PraeludeColor.inkFillQuiet)
                    .clipShape(RoundedRectangle(cornerRadius: PraeludeRadius.tight))
                    Stepper("Source page \(link.sourcePage)", value: $link.sourcePage, in: 1...max(1, pageCount))
                        .onChange(of: link.sourcePage) { regionFraction = nil }
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
    @Environment(PracticeStore.self) private var store
    var body: some View {
        GeometryReader { geometry in
            if let image = renderedImage(size: geometry.size) {
                Image(uiImage: image).resizable().scaledToFit().frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                PraeludeColor.inkFillQuiet
            }
        }
    }
    private func renderedImage(size: CGSize) -> UIImage? {
        guard size.width > 1, size.height > 1,
              let piece = store.state.pieces.first(where: { $0.id == pieceID }),
              let url = NativeLibraryFiles(store: store).scoreURL(for: piece),
              let document = PDFDocument(url: url), page >= 1, page <= document.pageCount,
              let pdfPage = document.page(at: page - 1) else { return nil }
        let box = pdfPage.bounds(for: .cropBox)
        guard box.width > 0, box.height > 0 else { return nil }
        let scale = min(4, max(0.3, size.width * UIScreen.main.scale / box.width))
        return pdfPage.thumbnail(of: CGSize(width: box.width * scale, height: box.height * scale), for: .cropBox)
    }
}
