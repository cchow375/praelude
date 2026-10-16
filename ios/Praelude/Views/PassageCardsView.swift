import SwiftUI
import UIKit

/// Shared visual identity across Cards, the review queue and the phone practice console.
struct PassageCardArtwork: View {
    @Environment(PracticeStore.self) private var store
    let passage: Passage
    let piece: Piece?
    @State private var thumbnail: UIImage?
    @State private var loading = true
    @State private var availabilityRevision = 0

    var body: some View {
        GeometryReader { geometry in
          Group {
            if let thumbnail {
                Image(uiImage: thumbnail).resizable().scaledToFit()
                    .frame(width: geometry.size.width, height: geometry.size.height)
            } else if loading {
                ProgressView().tint(.black.opacity(0.6)).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                VStack(spacing: 8) {
                    Image(systemName: piece?.pdfFileName == nil ? "music.book.closed" : "rectangle.dashed")
                        .font(.title2)
                    Text(piece?.pdfFileName == nil ? "Paper score" : "Preview unavailable")
                        .font(.caption)
                }.foregroundStyle(.black.opacity(0.6)).frame(maxWidth: .infinity, maxHeight: .infinity)
            }
          }
          .frame(width: geometry.size.width, height: geometry.size.height)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Music for \(passage.title). \(passage.locationLabel)")
        .accessibilityValue(thumbnail != nil ? "Ready" : loading ? "Loading" : "Unavailable")
        .accessibilityIdentifier("passageArtwork_\(passage.id)")
        .onReceive(NotificationCenter.default.publisher(for: .praeludeLibraryAssetAvailable).receive(on: RunLoop.main)) { notification in
            guard let arriving = notification.object as? URL, let piece,
                  NativeLibraryFiles(store: store).scoreURL(for: piece)?.path == arriving.path else { return }
            availabilityRevision &+= 1
        }
        .task(id: identity) {
            thumbnail = nil; loading = true
            guard let piece, let url = NativeLibraryFiles(store: store).scoreURL(for: piece), !Task.isCancelled else {
                loading = false; return
            }
            let result = await PassageThumbnailRenderer.shared.render(url: url, passage: passage)
            guard !Task.isCancelled else { return }
            thumbnail = result; loading = false
        }
    }

    private var identity: String {
        // Parking, naming and first-attempt scheduling do not change the music. Keeping those
        // edits out of this identity also keeps a recycled List row's loaded bitmap stable.
        "\(piece?.pdfFileName ?? "none")_\(passage.id)_\(passage.page)_\(passage.regions)_\(availabilityRevision)"
    }
}

struct PassageCardsView: View {
    @Environment(PracticeStore.self) private var store
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let onStart: (UUID, UUID) -> Void
    var onOpenScore: (UUID, Int) -> Void = { _, _ in }
    @State private var search = ""
    @State private var filter: CardFilter = .all
    @State private var capture = false
    @State private var selected: Passage?
    @State private var shuffleOrder: [UUID] = []
    @State private var recall = false
    @State private var revealed: Set<UUID> = []
    @State private var reviewDetails: Passage?

    private var pieces: [UUID: Piece] {
        Dictionary(store.pieces.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
    }
    private var dueIDs: Set<UUID> { Set(TodayOverview.dueReviews(context: RuleContext(state: store.state, now: Date())).map(\.passageID)) }
    private var practicedIDs: Set<UUID> { PassageCardLibrary.practicedPassageIDs(in: store.state) }
    private var allPassages: [Passage] {
        let pieces = pieces
        return store.state.passages.filter { !$0.archived && $0.deletedAt == nil && pieces[$0.pieceID] != nil }
    }
    private var visible: [Passage] {
        let due = dueIDs, practiced = practicedIDs, pieces = pieces
        let filtered = allPassages.filter { passage in
            let piece = pieces[passage.pieceID]
            let matches = search.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
                [passage.title, passage.focus, passage.measureLabel, piece?.title ?? "", piece?.composer ?? ""]
                .joined(separator: " ").localizedCaseInsensitiveContains(search)
            guard matches else { return false }
            switch filter {
            case .all: return true
            case .due: return due.contains(passage.id)
            case .unpracticed: return !practiced.contains(passage.id)
            case .photo: return piece.map(PassageCardLibrary.isPhotoPiece) ?? false
            }
        }
        let rank = Dictionary(uniqueKeysWithValues: shuffleOrder.enumerated().map { ($0.element, $0.offset) })
        return filtered.sorted { left, right in
            if !shuffleOrder.isEmpty {
                let a = rank[left.id] ?? Int.max, b = rank[right.id] ?? Int.max
                if a != b { return a < b }
            }
            if due.contains(left.id) != due.contains(right.id) { return due.contains(left.id) }
            if left.createdAt != right.createdAt { return left.createdAt > right.createdAt }
            return left.id.uuidString < right.id.uuidString
        }
    }

    var body: some View {
        let due = dueIDs, practiced = practicedIDs, pieceIndex = pieces
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    introduction
                    if visible.isEmpty {
                        PraeludeEmptyState(title: allPassages.isEmpty ? "Start with a few bars" : "No cards here yet",
                                          symbol: "rectangle.stack",
                                          message: allPassages.isEmpty ? "Take a photo of your paper score, or mark a passage on a PDF. Its music becomes the card." : "Try another filter or search. Your saved passages are kept.",
                                          actionTitle: "Add photo passage", action: { capture = true })
                            .frame(minHeight: 280)
                    } else {
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 270, maximum: 500), spacing: 16)], spacing: 16) {
                            ForEach(visible) { passage in
                                card(passage, piece: pieceIndex[passage.pieceID], due: due, practiced: practiced)
                                    .contextMenu {
                                        Button("Review details", systemImage: "clock.arrow.circlepath") { reviewDetails = passage }
                                        Button("Open score", systemImage: "music.book.closed") { onOpenScore(passage.pieceID, passage.regions.first?.page ?? passage.page) }
                                    }
                            }
                        }
                    }
                }.padding(16).frame(maxWidth: 1400).frame(maxWidth: .infinity)
            }
            .accessibilityIdentifier("passageCardLibraryScroll")
            .background(PraeludeColor.paper)
            .navigationTitle("Passage cards")
            .searchable(text: $search, prompt: "Piece, passage, composer or focus")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Menu {
                        Picker("Show cards", selection: $filter) {
                            ForEach(CardFilter.allCases) { Text($0.rawValue).tag($0) }
                        }
                        Divider()
                        Toggle("Recall mode", isOn: $recall)
                        Button("Shuffle visible cards", systemImage: "shuffle") {
                            withAnimation(PraeludeMotion.tap(reduceMotion: reduceMotion)) { shuffleOrder = visible.map(\.id).shuffled() }
                            PraeludeHaptic.toggle()
                        }.disabled(visible.count < 2)
                        if !shuffleOrder.isEmpty { Button("Due first, newest next") { shuffleOrder = [] } }
                    } label: { Label("Card options", systemImage: "line.3.horizontal.decrease") }
                    .accessibilityIdentifier("passageCardOptions")
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Add photo", systemImage: "camera.badge.ellipsis") { capture = true }
                        .accessibilityIdentifier("addPhotoPassage")
                }
            }
            .sheet(isPresented: $capture) {
                PassageCaptureView(onSaved: { _, _ in capture = false; filter = .all; search = "" })
            }
            .sheet(item: $selected) { passage in
                PassageCardDetailView(passage: passage, piece: pieces[passage.pieceID], onStart: {
                    selected = nil; onStart(passage.pieceID, passage.id)
                }, onOpenScore: { page in
                    selected = nil; onOpenScore(passage.pieceID, page)
                })
            }
            .sheet(item: $reviewDetails) { passage in PassageReviewDetailsView(passageID: passage.id) }
            .onChange(of: recall) { _, _ in revealed = []; PraeludeHaptic.toggle() }
        }
    }

    private var introduction: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(filter.rawValue).font(.headline)
                Spacer()
                Text("\(visible.count)").font(.subheadline.monospacedDigit()).foregroundStyle(.secondary)
            }
            Text("Recognize the music. Do a practice set. Your first-attempt report sets the next review.")
                .font(.subheadline).foregroundStyle(.secondary)
            if recall {
                Label("Recall mode · Picture the opening, then reveal the music. Nothing is graded automatically.", systemImage: "eye.slash")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private func card(_ passage: Passage, piece: Piece?, due: Set<UUID>, practiced: Set<UUID>) -> some View {
        let hidden = recall && !revealed.contains(passage.id)
        return VStack(alignment: .leading, spacing: 12) {
            Button {
                if hidden { withAnimation(PraeludeMotion.tap(reduceMotion: reduceMotion)) { _ = revealed.insert(passage.id) }; PraeludeHaptic.toggle() }
                else { selected = passage }
            } label: {
                Group {
                    if hidden {
                        VStack(spacing: 10) {
                            Image(systemName: "eye.slash").font(.title2)
                            Text("Recall the opening").font(.headline)
                            Text("Tap to reveal").font(.subheadline)
                        }.frame(maxWidth: .infinity, maxHeight: .infinity)
                            .foregroundStyle(PraeludeColor.inkSecondary).background(PraeludeColor.inkFillQuiet)
                    } else { PassageCardArtwork(passage: passage, piece: piece) }
                }.frame(height: 160).clipShape(RoundedRectangle(cornerRadius: 12))
            }.buttonStyle(.plain)
                .accessibilityLabel(hidden ? "Reveal music for \(passage.title)" : "Enlarge music for \(passage.title)")
                .accessibilityIdentifier("passageCardImage_\(passage.id)")
            VStack(alignment: .leading, spacing: 4) {
                Text(passage.title).font(.headline).lineLimit(2)
                if piece?.title != passage.title { Text(piece?.title ?? "Piece").font(.subheadline).foregroundStyle(.secondary).lineLimit(1) }
                HStack {
                    Label(status(passage, due: due, practiced: practiced), systemImage: due.contains(passage.id) ? "clock" : "rectangle.stack")
                    Spacer()
                    if let tempo = passage.performanceTempo { Text("Goal \(PracticeReferenceFormatting.bpm(tempo)) BPM") }
                }.font(.caption).foregroundStyle(.secondary)
                Text(passage.focus).font(.caption).foregroundStyle(.secondary).lineLimit(2)
            }
            Button { onStart(passage.pieceID, passage.id) } label: {
                Label("Practice", systemImage: "play.fill").frame(maxWidth: .infinity, minHeight: 30)
            }.buttonStyle(.praeludePrimary).accessibilityIdentifier("practiceCard_\(passage.id)")
        }.padding(14).background(PraeludeColor.surface, in: RoundedRectangle(cornerRadius: 18))
            .overlay(RoundedRectangle(cornerRadius: 18).stroke(PraeludeColor.hairline, lineWidth: 0.5))
    }

    private func status(_ passage: Passage, due: Set<UUID>, practiced: Set<UUID>) -> String {
        if due.contains(passage.id) { return "Review due" }
        if !practiced.contains(passage.id) { return "Unpracticed" }
        if let date = passage.schedule.dueDate { return "Review \(date.formatted(date: .abbreviated, time: .omitted))" }
        return passage.learningState == .performanceReady ? "Performance ready" : "In practice"
    }

    private enum CardFilter: String, CaseIterable, Identifiable {
        case all = "All passages", due = "Due for review", unpracticed = "Unpracticed", photo = "Photo passages"
        var id: String { rawValue }
    }
}

private struct PassageCardDetailView: View {
    @Environment(PracticeStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let passage: Passage
    let piece: Piece?
    let onStart: () -> Void
    let onOpenScore: (Int) -> Void
    @State private var rename = false
    @State private var reviewDetails = false
    private var livePassage: Passage? {
        store.state.passages.first { $0.id == passage.id && !$0.archived && $0.deletedAt == nil }
    }
    private var livePiece: Piece? { store.pieces.first { $0.id == passage.pieceID } }

    var body: some View {
        NavigationStack {
            ScrollView {
                if let passage = livePassage {
                VStack(alignment: .leading, spacing: 18) {
                    PassageCardZoomView(passage: passage, piece: livePiece).frame(height: 360)
                    Text("Pinch to zoom. Drag to inspect the notes.").font(.caption).foregroundStyle(.secondary)
                    Text(passage.title).font(.title2.weight(.semibold))
                    Text(livePiece?.title ?? "Piece").font(.subheadline).foregroundStyle(.secondary)
                    Text(passage.focus).font(.body)
                    Button("Review date & first-attempt history", systemImage: "clock.arrow.circlepath") { reviewDetails = true }
                        .font(.subheadline).frame(minHeight: 44)
                    Button("Practice this passage", systemImage: "play.fill", action: onStart).buttonStyle(.praeludePrimary)
                    HStack {
                        Button("Name & goal tempo", systemImage: "pencil") { rename = true }
                        Spacer()
                        Button("Open score", systemImage: "music.book.closed") { onOpenScore(passage.regions.first?.page ?? passage.page) }
                    }.font(.subheadline).frame(minHeight: 44)
                    if passage.regions.count > 1 {
                        Text("The cover shows the first of \(passage.regions.count) selected boxes. Open the score to see the complete passage.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }.padding(20).frame(maxWidth: 780).frame(maxWidth: .infinity)
                } else {
                    ContentUnavailableView("Passage unavailable", systemImage: "rectangle.stack", description: Text("This passage was archived or removed from the library."))
                }
            }.accessibilityIdentifier("passageCardDetailScroll").background(PraeludeColor.paper)
                .navigationTitle("Passage").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
                .sheet(isPresented: $rename) {
                    if let passage = livePassage { PassageRenameView(passage: passage, onSaved: { rename = false }) }
                }
                .sheet(isPresented: $reviewDetails) { PassageReviewDetailsView(passageID: passage.id) }
        }
    }
}

struct PassageCardZoomView: View {
    @Environment(PracticeStore.self) private var store
    let passage: Passage
    let piece: Piece?
    @State private var image: UIImage?
    @State private var availabilityRevision = 0
    var body: some View {
        Group {
            if let image { PassageZoomImage(image: image) }
            else { PassageCardArtwork(passage: passage, piece: piece) }
        }.background(Color.white).clipShape(RoundedRectangle(cornerRadius: 12))
            .onReceive(NotificationCenter.default.publisher(for: .praeludeLibraryAssetAvailable).receive(on: RunLoop.main)) { notification in
                guard let arriving = notification.object as? URL, let piece,
                      NativeLibraryFiles(store: store).scoreURL(for: piece)?.path == arriving.path else { return }
                availabilityRevision &+= 1
            }
            .task(id: "\(piece?.pdfFileName ?? "none")_\(passage.regions)_\(passage.page)_\(availabilityRevision)") {
                image = nil
                guard let piece, let url = NativeLibraryFiles(store: store).scoreURL(for: piece) else { return }
                let loaded = await PassageThumbnailRenderer.shared.render(url: url, passage: passage)
                guard !Task.isCancelled else { return }
                image = loaded
            }
    }
}

private struct PassageZoomImage: UIViewRepresentable {
    let image: UIImage
    func makeUIView(context: Context) -> PassageZoomScroll {
        let scroll = PassageZoomScroll()
        scroll.imageView.image = image
        return scroll
    }
    func updateUIView(_ uiView: PassageZoomScroll, context: Context) { uiView.imageView.image = image }
}

private final class PassageZoomScroll: UIScrollView, UIScrollViewDelegate {
    let imageView = UIImageView()
    private var previousBounds = CGSize.zero
    override init(frame: CGRect) {
        super.init(frame: frame)
        delegate = self; minimumZoomScale = 1; maximumZoomScale = 6
        backgroundColor = .white; imageView.contentMode = .scaleAspectFit
        addSubview(imageView)
        imageView.accessibilityLabel = "Passage music. Pinch to zoom."
        imageView.isAccessibilityElement = true
    }
    required init?(coder: NSCoder) { nil }
    override func layoutSubviews() {
        super.layoutSubviews()
        guard bounds.size != previousBounds, bounds.width > 0, bounds.height > 0 else { return }
        previousBounds = bounds.size; setZoomScale(1, animated: false)
        imageView.frame = CGRect(origin: .zero, size: bounds.size); contentSize = bounds.size
    }
    func viewForZooming(in scrollView: UIScrollView) -> UIView? { imageView }
}
