import SwiftUI
import PDFKit

/// Establish a fit-page minimum and six-times maximum after native layout,
/// preserving the reader's zoom as the available reading area changes.
final class ZoomableScorePDFView: PDFView {
    private var fittedSize: CGSize = .zero
    private var fittedScale: CGFloat = 0
    private var needsScaleRange = true

    #if DEBUG
    override var accessibilityValue: String? {
        get {
            guard ProcessInfo.processInfo.arguments.contains("--uitesting") else { return super.accessibilityValue }
            func scrolls(_ root: UIView) -> [UIScrollView] {
                root.subviews.flatMap { child in (child as? UIScrollView).map { [$0] } ?? scrolls(child) }
            }
            let details = scrolls(self).map {
                "scroll=\($0.zoomScale),min=\($0.minimumZoomScale),max=\($0.maximumZoomScale),pinch=\($0.pinchGestureRecognizer?.isEnabled == true),frame=\($0.frame)"
            }.joined(separator: ";")
            return "scale=\(scaleFactor),min=\(minScaleFactor),max=\(maxScaleFactor),auto=\(autoScales);\(details)"
        }
        set { super.accessibilityValue = newValue }
    }
    #endif

    func refreshScaleRange() {
        needsScaleRange = true
        setNeedsLayout()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        guard document != nil, bounds.width > 0, bounds.height > 0,
              needsScaleRange || fittedSize != bounds.size else { return }
        let fit = scaleFactorForSizeToFit
        guard fit.isFinite, fit > 0 else { return }
        let zoom = fittedScale > 0 ? min(6, max(1, scaleFactor / fittedScale)) : 1
        fittedSize = bounds.size
        fittedScale = fit
        needsScaleRange = false
        autoScales = false
        minScaleFactor = fit
        maxScaleFactor = fit * 6
        scaleFactor = fit * zoom
    }
}

struct PagedScoreView: UIViewRepresentable {
    let url: URL
    @Binding var page: Int
    var twoPages: Bool
    var focusPageTurns: Bool = false
    var onTurnPage: (Int) -> Void = { _ in }
    var onPageChanged: (Int) -> Void
    func makeCoordinator() -> Coordinator { Coordinator(parent: self) }
    func makeUIView(context: Context) -> ZoomableScorePDFView {
        let view = ZoomableScorePDFView()
        view.accessibilityIdentifier = "scorePDF"
        let pageTap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.pageTapped(_:)))
        pageTap.cancelsTouchesInView = false
        pageTap.delegate = context.coordinator
        view.addGestureRecognizer(pageTap)
        view.backgroundColor = .secondarySystemBackground
        view.displayDirection = .horizontal
        view.displayMode = twoPages ? .twoUp : .singlePage
        view.displaysAsBook = false
        view.autoScales = true
        view.document = PDFDocument(url: url)
        if let target = view.document?.page(at: max(0, page - 1)) { view.go(to: target) }
        context.coordinator.observer = NotificationCenter.default.addObserver(forName: .PDFViewPageChanged, object: view, queue: .main) { [weak coordinator = context.coordinator, weak view] _ in
            MainActor.assumeIsolated {
                guard let coordinator, let view, let current = view.currentPage, let doc = view.document else { return }
                let index = doc.index(for: current) + 1
                guard index != coordinator.parent.page else { return }
                coordinator.parent.page = index
                coordinator.parent.onPageChanged(index)
            }
        }
        context.coordinator.loadedURL = url
        return view
    }
    func updateUIView(_ view: ZoomableScorePDFView, context: Context) {
        context.coordinator.parent = self
        if context.coordinator.loadedURL != url {
            view.document = PDFDocument(url: url); context.coordinator.loadedURL = url
            view.refreshScaleRange()
        }
        let mode: PDFDisplayMode = twoPages ? .twoUp : .singlePage
        if view.displayMode != mode { view.displayMode = mode; view.refreshScaleRange() }
        if let doc = view.document, let target = doc.page(at: max(0, page - 1)), view.currentPage != target {
            view.go(to: target)
            view.refreshScaleRange()
        }
    }
    static func dismantleUIView(_ uiView: ZoomableScorePDFView, coordinator: Coordinator) {
        if let observer = coordinator.observer { NotificationCenter.default.removeObserver(observer) }
    }
    @MainActor final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        var parent: PagedScoreView
        var loadedURL: URL?
        var observer: NSObjectProtocol?
        init(parent: PagedScoreView) { self.parent = parent }
        @objc func pageTapped(_ recognizer: UITapGestureRecognizer) {
            guard parent.focusPageTurns, recognizer.state == .ended, let view = recognizer.view else { return }
            parent.onTurnPage(recognizer.location(in: view).x < view.bounds.width / 3 ? -1 : 1)
        }
        func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool { parent.focusPageTurns }
        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool { true }

    }
}

struct ScorePagePicker: View {
    let url: URL
    let currentPage: Int
    let onSelect: (Int) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var document: PDFDocument?
    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 110), spacing: 20)], spacing: 24) {
                    if let document {
                        ForEach(0..<document.pageCount, id: \.self) { index in
                            Button {
                                onSelect(index + 1); dismiss()
                            } label: {
                                VStack(spacing: 8) {
                                    if let pdfPage = document.page(at: index) {
                                        Image(uiImage: pdfPage.thumbnail(of: CGSize(width: 180, height: 250), for: .cropBox))
                                            .resizable().scaledToFit().frame(height: 160)
                                            .clipShape(RoundedRectangle(cornerRadius: 3))
                                    }
                                    Text("\(index + 1)").font(.subheadline.monospacedDigit())
                                }.padding(8).frame(maxWidth: .infinity)
                                    .background(index + 1 == currentPage ? Color.accentColor.opacity(0.12) : Color.clear, in: RoundedRectangle(cornerRadius: 10))
                            }.buttonStyle(.plain).accessibilityLabel("Page \(index + 1)")
                        }
                    }
                }.padding(20)
            }
            .navigationTitle("Pages").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .onAppear { document = PDFDocument(url: url) }
        }.presentationDetents([.large])
    }
}
