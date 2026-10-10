import PhotosUI
import SwiftUI
import UIKit
import UniformTypeIdentifiers

struct AddPieceView: View {
    @Environment(PracticeStore.self) private var store
    @Environment(SyncCoordinator.self) private var syncCoordinator
    @Environment(ScoreAndRecordingStorage.self) private var storage
    @Environment(SocialHooks.self) private var hooks
    @Environment(\.dismiss) private var dismiss
    let importedURL: URL?
    let onAdded: (UUID) -> Void
    @State private var title = ""
    @State private var composer = ""
    @State private var fullTempo = ""
    @State private var pdfURL: URL?
    @State private var showPicker = false
    @State private var showScanner = false
    @State private var photoSelections: [PhotosPickerItem] = []
    @State private var composing = false
    @State private var error: String?
    @State private var saving = false
    @State private var instrumentID: UUID?
    @FocusState private var titleFocused: Bool
    private var liveInstruments: [Instrument] { store.state.instruments.filter { $0.deletedAt == nil } }
    private var fullTempoValue: Double? { Double(fullTempo.trimmingCharacters(in: .whitespacesAndNewlines)) }
    private var validFullTempo: Bool {
        fullTempo.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || fullTempoValue.map { $0.isFinite && (20...300).contains($0) } == true
    }
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Title", text: $title).accessibilityIdentifier("pieceTitle")
                        .focused($titleFocused).textInputAutocapitalization(.words)
                    TextField("Composer", text: $composer).textInputAutocapitalization(.words)
                }
                Section {
                    TextField("Full-tempo target · BPM (optional)", text: $fullTempo).keyboardType(.decimalPad)
                        .accessibilityIdentifier("pieceFullTempo")
                    if !validFullTempo { Text("Enter 20–300 BPM or leave blank.").font(.caption).foregroundStyle(.red) }
                } footer: {
                    Text("A reference for practice history, separate from attempt tempo. Use the same beat unit when practicing. You can set or edit it later in History → By piece.")
                }
                if liveInstruments.count > 1 {
                    Section {
                        Picker("Instrument", selection: $instrumentID) {
                            ForEach(liveInstruments) { instrument in Text(instrument.name).tag(Optional(instrument.id)) }
                        }
                    } footer: {
                        Text("Praelude tailors parts wording and variant defaults to this piece’s instrument.")
                    }
                }
                Section {
                    Button { showPicker = true } label: {
                        Label(pdfURL?.lastPathComponent ?? "Choose a PDF", systemImage: "doc.badge.plus")
                            .lineLimit(2).frame(minHeight: 36)
                    }.accessibilityIdentifier("choosePDF").disabled(composing)
                    // §7 import: photo/camera multi-page scan, alongside a plain PDF file. Both
                    // paths land in the same `pdfURL`, so "Remove PDF" below clears either one.
                    Button { showScanner = true } label: {
                        Label("Scan pages with camera", systemImage: "camera").frame(minHeight: 36)
                    }.accessibilityIdentifier("scanPages").disabled(composing)
                    PhotosPicker(selection: $photoSelections, maxSelectionCount: 400, matching: .images) {
                        Label("Choose photos", systemImage: "photo.on.rectangle").frame(minHeight: 36)
                    }.disabled(composing)
                    if composing {
                        HStack(spacing: 8) { ProgressView().controlSize(.small); Text("Preparing scan…") }
                            .foregroundStyle(.secondary)
                    }
                    if pdfURL != nil { Button("Remove PDF", role: .destructive) { pdfURL = nil } }
                } footer: { Text("Your score is copied into Praelude. You can also practice with a paper score.") }
                if let error { Section { Text(error).foregroundStyle(.red) } }
            }
            .navigationTitle("Add piece").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add", action: save).fontWeight(.semibold)
                        .disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || saving || composing || !validFullTempo)
                        .accessibilityIdentifier("savePiece")
                }
            }
            .fileImporter(isPresented: $showPicker, allowedContentTypes: [.pdf]) { result in
                switch result {
                case .success(let url): select(url)
                case .failure(let failure): error = failure.localizedDescription
                }
            }
            .fullScreenCover(isPresented: $showScanner) {
                DocumentScannerView(onFinish: handleScan, onCancel: { showScanner = false }, onFailure: handleScanFailure)
                    .ignoresSafeArea()
            }
            .onChange(of: photoSelections) { _, items in composePhotos(items) }
            .onAppear {
                if instrumentID == nil { instrumentID = store.primaryInstrument?.id }
                if let importedURL { select(importedURL) }
                else { titleFocused = true }
            }
        }
        .presentationDetents([.large]).presentationDragIndicator(.visible)
        .interactiveDismissDisabled(saving)
    }
    private func select(_ url: URL) {
        pdfURL = url
        if title.isEmpty { title = url.deletingPathExtension().lastPathComponent }
    }
    /// A composed scan/photo PDF has no meaningful source filename to derive a title from (see
    /// `select(_:)` above for the Files-import case), so this fills in a plain default instead —
    /// only when the player has not already typed a title.
    private func adopt(scannedPDF url: URL, defaultTitle: String) {
        pdfURL = url
        if title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { title = defaultTitle }
    }
    private func handleScan(_ images: [UIImage]) {
        showScanner = false
        guard !images.isEmpty else { return }
        composeAndAdopt(images)
    }
    private func handleScanFailure(_ error: Error) {
        showScanner = false
        self.error = error.localizedDescription
    }
    private func composePhotos(_ items: [PhotosPickerItem]) {
        guard !items.isEmpty else { return }
        composing = true
        Task {
            defer { composing = false; photoSelections = [] }
            do {
                var images: [UIImage] = []
                for item in items {
                    guard let data = try await item.loadTransferable(type: Data.self), let image = UIImage(data: data) else { continue }
                    images.append(image)
                }
                guard !images.isEmpty else { throw PracticeError.invalid("None of the selected photos could be opened.") }
                try await adoptScan(images)
            } catch { self.error = error.localizedDescription }
        }
    }
    private func composeAndAdopt(_ images: [UIImage]) {
        composing = true
        Task {
            defer { composing = false }
            do { try await adoptScan(images) } catch { self.error = error.localizedDescription }
        }
    }
    private func adoptScan(_ images: [UIImage]) async throws {
        let url = try await Task.detached(priority: .userInitiated) {
            let data = try ScoreScanImport.makePDF(images: images)
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("scan-\(UUID().uuidString).pdf")
            try data.write(to: url)
            return url
        }.value
        guard !Task.isCancelled else { try? FileManager.default.removeItem(at: url); throw CancellationError() }
        adopt(scannedPDF: url, defaultTitle: "Scanned score")
    }
    private func save() {
        saving = true
        defer { saving = false }
        do {
            let id: UUID
            if let pdfURL {
                id = try NativeLibraryFiles(store: store).importPDF(pdfURL, title: title, composer: composer, instrumentID: instrumentID, fullTempoBPM: fullTempoValue)
            } else {
                let piece = Piece(title: title, composer: composer, instrumentID: instrumentID, fullTempoBPM: fullTempoValue)
                try store.addPiece(piece); id = piece.id
            }
            // Not previously wired (this is the only place a Piece is created): §4d sync needs this
            // regardless of §5, and `SocialHooks.shareMilestone` below specifically needs this piece
            // to exist server-side first — `post_activity_event`'s ownership trigger rejects a
            // piece_id nothing has pushed yet.
            if let piece = store.state.pieces.first(where: { $0.id == id }) {
                syncCoordinator.pushPiece(piece)
                // §4a: upload the PDF itself to the private "scores" bucket so a second device (or
                // this one after reinstall) can download it on demand — see ScoreAndRecordingStorage.
                if let fileName = piece.pdfFileName, let localURL = NativeLibraryFiles(store: store).scoreURL(for: piece) {
                    Task { await storage.uploadScorePDF(pieceID: id, fileName: fileName, localURL: localURL) }
                }
            }
            hooks.shareMilestone(kind: .newPiece, pieceID: id, detail: title)
            dismiss(); onAdded(id)
        } catch { self.error = error.localizedDescription }
    }
}
