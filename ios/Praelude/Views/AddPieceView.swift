import SwiftUI
import UniformTypeIdentifiers

struct AddPieceView: View {
    @Environment(PracticeStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let importedURL: URL?
    let onAdded: (UUID) -> Void
    @State private var title = ""
    @State private var composer = ""
    @State private var pdfURL: URL?
    @State private var showPicker = false
    @State private var error: String?
    @State private var saving = false
    @State private var instrumentID: UUID?
    @FocusState private var titleFocused: Bool
    private var liveInstruments: [Instrument] { store.state.instruments.filter { $0.deletedAt == nil } }
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Title", text: $title).accessibilityIdentifier("pieceTitle")
                        .focused($titleFocused).textInputAutocapitalization(.words)
                    TextField("Composer", text: $composer).textInputAutocapitalization(.words)
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
                    }.accessibilityIdentifier("choosePDF")
                    if pdfURL != nil { Button("Remove PDF", role: .destructive) { pdfURL = nil } }
                } footer: { Text("Your score is copied into Praelude. You can also practice with a paper score.") }
                if let error { Section { Text(error).foregroundStyle(.red) } }
            }
            .navigationTitle("Add piece").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add", action: save).fontWeight(.semibold)
                        .disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || saving)
                        .accessibilityIdentifier("savePiece")
                }
            }
            .fileImporter(isPresented: $showPicker, allowedContentTypes: [.pdf]) { result in
                switch result {
                case .success(let url): select(url)
                case .failure(let failure): error = failure.localizedDescription
                }
            }
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
    private func save() {
        saving = true
        defer { saving = false }
        do {
            let id: UUID
            if let pdfURL {
                id = try NativeLibraryFiles(store: store).importPDF(pdfURL, title: title, composer: composer, instrumentID: instrumentID)
            } else {
                let piece = Piece(title: title, composer: composer, instrumentID: instrumentID)
                try store.addPiece(piece); id = piece.id
            }
            dismiss(); onAdded(id)
        } catch { self.error = error.localizedDescription }
    }
}
