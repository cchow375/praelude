import SwiftUI

struct ScoreMeasureMapView: View {
    @Environment(PracticeStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let pieceID: UUID
    let currentPage: Int
    @State private var page = 1
    @State private var scan: ScoreMapScan?
    @State private var selectedRegion: NormalizedRect?
    @State private var firstMeasure = ""
    @State private var lastMeasure = ""
    @State private var scanning = false
    @State private var scanRequestID = UUID()
    @State private var errorMessage: String?
    private var piece: Piece? { store.pieces.first { $0.id == pieceID } }
    private var anchors: [ScoreMeasureAnchor] { piece?.measureAnchors.filter { $0.page == page } ?? [] }
    private var valid: Bool {
        guard selectedRegion?.isValid == true, let first = Int(firstMeasure), let last = Int(lastMeasure) else { return false }
        return first >= 1 && last >= first && last <= 100000
    }
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text("Map measures once, then new passage boxes inherit the confirmed numbers. Outline a measure for an exact label, or a whole system for its full range.")
                        .font(.subheadline).foregroundStyle(.secondary)
                    Stepper(piece.map { ScoreOrganization.pageLabel(page, in: $0) } ?? "Page \(page)", value: $page, in: 1...max(1, piece?.pageCount ?? 1))
                    if let scan { mapImage(scan) }
                    else { ProgressView().frame(maxWidth: .infinity, minHeight: 200) }
                    Button { Task { await load(recognize: true) } } label: {
                        Label(scanning ? "Scanning this page…" : "Scan printed numbers", systemImage: "viewfinder")
                    }.disabled(scanning).buttonStyle(.bordered)
                    if let scan, !scan.hints.isEmpty {
                        Text("Review hints — they may include page numbers or fingerings. Tap a number, then outline the measure or system it labels.")
                            .font(.caption).foregroundStyle(.secondary)
                        ScrollView(.horizontal) {
                            HStack {
                                ForEach(scan.hints) { hint in
                                    Button("\(hint.number)") { firstMeasure = String(hint.number); lastMeasure = String(hint.number); selectedRegion = nil }
                                        .buttonStyle(.bordered)
                                }
                            }
                        }
                    }
                    HStack {
                        TextField("First measure", text: $firstMeasure).keyboardType(.numberPad)
                        TextField("Last measure", text: $lastMeasure).keyboardType(.numberPad)
                    }.textFieldStyle(.roundedBorder)
                    Button("Confirm measure region", systemImage: "checkmark") { save() }
                        .buttonStyle(.borderedProminent).disabled(!valid)
                    if let errorMessage { ErrorMessage(message: errorMessage) }
                    if !anchors.isEmpty {
                        Text("Confirmed on this page").font(.headline)
                        ForEach(anchors) { anchor in
                            HStack {
                                Text(anchor.startMeasure == anchor.endMeasure ? "m. \(anchor.startMeasure)" : "mm. \(anchor.startMeasure)–\(anchor.endMeasure)")
                                Spacer()
                                Button("Delete", systemImage: "trash", role: .destructive) { remove(anchor) }.labelStyle(.iconOnly)
                            }.frame(minHeight: 44)
                        }
                    }
                }.padding()
            }
            .navigationTitle("Measure map").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } } }
            .onAppear { page = min(max(1, currentPage), max(1, piece?.pageCount ?? 1)) }
            .task(id: page) { selectedRegion = nil; scan = nil; await load(recognize: false) }
        }
    }
    private func mapImage(_ scan: ScoreMapScan) -> some View {
        Image(uiImage: scan.image).resizable().scaledToFit()
            .overlay {
                GeometryReader { proxy in
                    ZStack {
                        ForEach(anchors) { anchor in regionBox(anchor.region, color: .green, size: proxy.size, rotation: scan.rotation) }
                        if let selectedRegion { regionBox(selectedRegion, color: .blue, size: proxy.size, rotation: scan.rotation) }
                    }.contentShape(Rectangle())
                        .gesture(DragGesture(minimumDistance: 3).onChanged { value in
                            guard proxy.size.width > 0, proxy.size.height > 0 else { return }
                            let x = min(max(0, min(value.startLocation.x, value.location.x) / proxy.size.width), 0.999)
                            let y = min(max(0, min(value.startLocation.y, value.location.y) / proxy.size.height), 0.999)
                            let width = min(1 - x, max(0.001, abs(value.location.x - value.startLocation.x) / proxy.size.width))
                            let height = min(1 - y, max(0.001, abs(value.location.y - value.startLocation.y) / proxy.size.height))
                            let box = CGRect(x: x, y: y, width: width, height: height)
                                .normalizedRotatedForDisplay(pageRotationDegrees: -scan.rotation)
                            selectedRegion = NormalizedRect(x: box.minX, y: box.minY, width: box.width, height: box.height)
                        })
                }
            }
            .background(Color.white).clipShape(RoundedRectangle(cornerRadius: 8))
            .accessibilityLabel("Score page. Drag around a measure or a system to confirm its numbers.")
    }
    private func regionBox(_ region: NormalizedRect, color: Color, size: CGSize, rotation: Int) -> some View {
        let box = CGRect(x: region.x, y: region.y, width: region.width, height: region.height)
            .normalizedRotatedForDisplay(pageRotationDegrees: rotation)
        return Rectangle().fill(color.opacity(0.14)).overlay(Rectangle().stroke(color, lineWidth: 1.5))
            .frame(width: box.width * size.width, height: box.height * size.height)
            .position(x: box.midX * size.width, y: box.midY * size.height)
    }
    private func load(recognize: Bool) async {
        guard let piece, let url = NativeLibraryFiles(store: store).scoreURL(for: piece) else { return }
        let requestedPage = page
        let requestID = UUID(); scanRequestID = requestID
        scanning = true
        defer { if scanRequestID == requestID { scanning = false } }
        do {
            let result = try await ScoreOrganizationScanner.page(url: url, number: requestedPage, recognizeNumbers: recognize)
            guard !Task.isCancelled, page == requestedPage, scanRequestID == requestID else { return }
            scan = result
            errorMessage = recognize && result.hints.isEmpty ? "No readable printed numbers found. Outline a region and enter the numbers yourself." : nil
        } catch {
            guard !Task.isCancelled, page == requestedPage, scanRequestID == requestID else { return }
            errorMessage = error.localizedDescription
        }
    }
    private func save() {
        guard let piece, let region = selectedRegion, let first = Int(firstMeasure), let last = Int(lastMeasure) else { return }
        do {
            try store.setMeasureAnchors(piece.measureAnchors + [ScoreMeasureAnchor(page: page, region: region, startMeasure: first, endMeasure: last)], for: pieceID)
            selectedRegion = nil; firstMeasure = ""; lastMeasure = ""; errorMessage = nil
        } catch { errorMessage = error.localizedDescription }
    }
    private func remove(_ anchor: ScoreMeasureAnchor) {
        guard let piece else { return }
        do { try store.setMeasureAnchors(piece.measureAnchors.filter { $0.id != anchor.id }, for: pieceID) }
        catch { errorMessage = error.localizedDescription }
    }
}
