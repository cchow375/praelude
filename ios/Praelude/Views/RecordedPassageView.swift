import SwiftUI

/// History keeps the exact boxes used for that set, even after the shortcut is edited.
struct RecordedPassageView: View {
    let url: URL
    let passage: Passage
    @State private var page: Int
    @State private var markup = ScoreMarkupState()

    init(url: URL, passage: Passage) {
        self.url = url; self.passage = passage
        _page = State(initialValue: passage.regions.map(\.page).min() ?? passage.page)
    }
    private var pages: [Int] { Array(Set(passage.regions.map(\.page))).sorted() }
    var body: some View {
        PagedScoreView(url: url, page: $page, twoPages: false, markup: markup, allowsInk: false,
                       regions: passage.regions, emphasizedIDs: Set(passage.regions.map(\.id)),
                       onPageChanged: { _ in })
            .safeAreaInset(edge: .bottom) {
                HStack {
                    Button("Previous", systemImage: "chevron.left") { step(-1) }
                        .labelStyle(.iconOnly).frame(width: 48, height: 48)
                        .disabled(page <= (pages.first ?? page))
                    Spacer()
                    VStack(spacing: 3) {
                        Text("Page \(page)").font(.subheadline.weight(.medium))
                        Text("Target recorded with this set").font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button("Next", systemImage: "chevron.right") { step(1) }
                        .labelStyle(.iconOnly).frame(width: 48, height: 48)
                        .disabled(page >= (pages.last ?? page))
                }.padding(.horizontal).background(.regularMaterial)
            }
            .navigationTitle(passage.title).navigationBarTitleDisplayMode(.inline)
    }
    private func step(_ direction: Int) {
        let target = direction > 0 ? pages.first { $0 > page } : pages.last { $0 < page }
        if let target { page = target }
    }
}
