import SwiftUI
import PDFKit

struct PassagePickerView: View {
    @Environment(PracticeStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var editingPassage: Passage?
    @State private var pendingDelete: Passage?
    @State private var errorMessage: String?
    let pieceID: UUID
    let currentPage: Int
    let onSelect: (Passage) -> Void
    var onDraw: (Passage?) -> Void = { _ in }
    private var piece: Piece? { store.pieces.first { $0.id == pieceID } }
    private var passages: [Passage] {
        store.state.passages.filter { $0.pieceID == pieceID }.sorted {
            $0.page == $1.page ? $0.title.localizedStandardCompare($1.title) == .orderedAscending : $0.page < $1.page
        }
    }
    var body: some View {
        NavigationStack {
            List {
                if let errorMessage { ErrorMessage(message: errorMessage) }
                if passages.isEmpty {
                    PraeludeEmptyState(title: "Mark what you want to practice", symbol: "rectangle.dashed",
                                      message: "Draw lightly highlighted boxes on the score. Add as many as you need, then tap Done.",
                                      actionTitle: "Draw a passage", action: { draw(nil) })
                        .listRowBackground(Color.clear).listRowSeparator(.hidden)
                }
                ForEach(passages) { passage in
                    Button { onSelect(passage); dismiss() } label: {
                        HStack(spacing: 14) {
                            if let piece, let url = NativeLibraryFiles(store: store).scoreURL(for: piece) {
                                PassagePreview(url: url, passage: passage).frame(width: 96, height: 76)
                            }
                            VStack(alignment: .leading, spacing: 5) {
                                Text(passage.title).font(.headline).foregroundStyle(.primary)
                                Text(passage.locationLabel).font(.subheadline).foregroundStyle(.secondary)
                                Text(passage.focus).font(.caption).foregroundStyle(.secondary)
                            }.frame(maxWidth: .infinity, alignment: .leading)
                        }.padding(.vertical, 6).contentShape(Rectangle())
                    }.buttonStyle(.plain).accessibilityIdentifier("savedPassage_\(passage.id)")
                    .contextMenu {
                        Button("Edit boxes", systemImage: "rectangle.dashed") { draw(passage) }
                        Button("Edit details", systemImage: "slider.horizontal.3") { editingPassage = passage }
                        Button("Delete passage", systemImage: "trash", role: .destructive) { pendingDelete = passage }
                    }
                    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                        Button("Delete", systemImage: "trash", role: .destructive) { pendingDelete = passage }
                        Button("Boxes", systemImage: "rectangle.dashed") { draw(passage) }.tint(PraeludeColor.ink)
                        Button("Details", systemImage: "slider.horizontal.3") { editingPassage = passage }.tint(PraeludeColor.inkSecondary)
                    }
                }
            }
            .navigationTitle("Passages").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Draw passage", systemImage: "rectangle.badge.plus") { draw(nil) }.accessibilityIdentifier("drawPassage")
                }
            }
            .sheet(item: $editingPassage) { passage in
                NavigationStack {
                    PassageEditorView(passage: passage, pageCount: max(1, piece?.pageCount ?? 1), onSaved: { editingPassage = nil })
                        .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { editingPassage = nil } } }
                }
            }
            .confirmationDialog("Delete passage?", isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } }), titleVisibility: .visible, presenting: pendingDelete) { passage in
                Button("Delete passage", role: .destructive) {
                    do { try store.deletePassage(passage.id) } catch { errorMessage = error.localizedDescription }
                    pendingDelete = nil
                }
            } message: { _ in Text("Recorded practice keeps its original visual target. This removes the saved shortcut.") }
        }
    }
    private func draw(_ passage: Passage?) { onDraw(passage); dismiss() }
}

extension Passage {
    var locationLabel: String {
        let pages = Set(regions.map(\.page))
        let visual = regions.isEmpty ? "Page \(page)" : "\(regions.count) \(regions.count == 1 ? "box" : "boxes") · \(pages.count == 1 ? "page \(pages.first ?? page)" : "\(pages.count) pages")"
        return measureLabel.isEmpty ? visual : "\(measureLabel) · \(visual)"
    }
}

struct PassageEditorView: View {
    @Environment(PracticeStore.self) private var store
    @State private var draft: Passage
    @State private var firstMeasure: String
    @State private var lastMeasure: String
    @State private var showMeasures: Bool
    @State private var page: Int
    @State private var errorMessage: String?
    let pageCount: Int
    private let baseline: Passage
    let onSaved: () -> Void
    init(passage: Passage, pageCount: Int, onSaved: @escaping () -> Void) {
        _draft = State(initialValue: passage)
        baseline = passage
        _firstMeasure = State(initialValue: passage.startMeasure.map(String.init) ?? "")
        _lastMeasure = State(initialValue: passage.endMeasure.map(String.init) ?? "")
        _showMeasures = State(initialValue: passage.startMeasure != nil)
        _page = State(initialValue: passage.page)
        self.pageCount = pageCount; self.onSaved = onSaved
    }
    private var valid: Bool {
        let textValid = !draft.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && draft.title.count <= 500 && !draft.focus.isEmpty && draft.focus.count <= 500
        guard showMeasures else { return textValid }
        guard let first = Int(firstMeasure), let last = Int(lastMeasure) else { return false }
        return textValid && first > 0 && last >= first && last <= 100_000
    }
    var body: some View {
        Form {
            Section("Passage") {
                TextField("Name", text: $draft.title).accessibilityIdentifier("passageName")
                PracticeFocusField(focus: $draft.focus)
                if !draft.regions.isEmpty { Text(draft.locationLabel).foregroundStyle(.secondary) }
                else { Stepper("Page \(page)", value: $page, in: 1...pageCount) }
            }
            Section {
                Toggle("Measure numbers", isOn: $showMeasures).praeludeToggleHaptic(showMeasures)
                if showMeasures {
                    TextField("First measure", text: $firstMeasure).keyboardType(.numberPad)
                    TextField("Last measure", text: $lastMeasure).keyboardType(.numberPad)
                }
            } footer: { Text("Optional labels. Your boxes identify what you practice.") }
            if let errorMessage { Section { ErrorMessage(message: errorMessage) } }
        }
        .navigationTitle("Passage details").navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Save", action: save).disabled(!valid) } }
    }
    private func save() {
        do {
            draft.title = draft.title.trimmingCharacters(in: .whitespacesAndNewlines)
            draft.startMeasure = showMeasures ? Int(firstMeasure) : nil
            draft.endMeasure = showMeasures ? Int(lastMeasure) : nil
            draft.page = draft.regions.map(\.page).min() ?? page
            draft.updatedAt = Date()
            try store.savePassage(draft, replacing: baseline); onSaved()
        } catch { errorMessage = error.localizedDescription }
    }
}

struct PassagePreview: View {
    let url: URL
    let passage: Passage
    @State private var thumbnail: UIImage?
    var body: some View {
        Group {
            if let thumbnail { Image(uiImage: thumbnail).resizable().scaledToFit() }
            else { Image(systemName: "rectangle.dashed").foregroundStyle(.secondary) }
        }
        .background(Color.white).clipShape(RoundedRectangle(cornerRadius: PraeludeRadius.tight))
        .accessibilityLabel("Visual target, \(passage.locationLabel)")
        .task(id: passage) { thumbnail = Self.makeThumbnail(url: url, passage: passage) }
    }
    @MainActor static func makeThumbnail(url: URL, passage: Passage) -> UIImage? {
        let number = passage.regions.map(\.page).min() ?? passage.page
        guard let page = PDFDocument(url: url)?.page(at: max(0, number-1)) else { return nil }
        let image = page.thumbnail(of: CGSize(width: 480, height: 640), for: .cropBox)
        let boxes = passage.regions.filter { $0.page == number }.map { region in
            var rect = CGRect(x: region.x, y: region.y, width: region.width, height: region.height)
            switch ((page.rotation % 360) + 360) % 360 {
            case 90: rect = CGRect(x: 1-rect.maxY, y: rect.minX, width: rect.height, height: rect.width)
            case 180: rect = CGRect(x: 1-rect.maxX, y: 1-rect.maxY, width: rect.width, height: rect.height)
            case 270: rect = CGRect(x: rect.minY, y: 1-rect.maxX, width: rect.height, height: rect.width)
            default: break
            }
            return CGRect(x: rect.minX*image.size.width, y: rect.minY*image.size.height,
                          width: rect.width*image.size.width, height: rect.height*image.size.height)
        }
        let pageBounds = CGRect(origin: .zero, size: image.size)
        let target = boxes.reduce(CGRect.null) { $0.union($1) }
        let crop = target.isNull ? pageBounds : target.insetBy(dx: -16, dy: -16).intersection(pageBounds)
        return UIGraphicsImageRenderer(size: crop.size).image { context in
            context.cgContext.translateBy(x: -crop.minX, y: -crop.minY)
            image.draw(at: .zero)
            context.cgContext.setFillColor(UIColor(PraeludeColor.ink).withAlphaComponent(0.105).cgColor)
            for box in boxes { context.cgContext.fill(box) }
        }
    }
}
