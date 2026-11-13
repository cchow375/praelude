import SwiftUI
import UniformTypeIdentifiers

struct DesktopTransferView: View {
    @Environment(PracticeStore.self) private var store
    @Environment(SyncCoordinator.self) private var sync
    @State private var chooseFile = false
    @State private var loading = false
    @State private var transfer: DesktopTransfer?
    @State private var transferData: Data?
    @State private var error: String?
    @State private var imported = false

    var body: some View {
        List {
            Section {
                Text("Bring your scores, passages, goals and original practice record from Praelude on your Mac.")
                Button("Choose Mac transfer", systemImage: "folder") { chooseFile = true }
                    .disabled(loading || store.activeSet != nil)
                if loading { SwiftUI.ProgressView("Reading your library…") }
                if store.activeSet != nil { Text("Finish your current set before importing.").foregroundStyle(.secondary) }
            } footer: {
                Text("Export a transfer with the Mac helper, then put it in Files or AirDrop it to this device. Existing mobile practice and settings are preserved.")
            }
            if let transfer {
                Section {
                    LabeledContent("Mac pieces", value: "\(transfer.rows("piece").count)")
                    LabeledContent("Score PDFs", value: "\(transfer.scores.count)")
                    LabeledContent("Passages", value: "\(transfer.rows("region").count)")
                    LabeledContent("Recorded repetitions", value: "\(transfer.rows("rep").count)")
                    LabeledContent("Original tables preserved", value: "\(transfer.tables.count)")
                    ForEach(transfer.warnings, id: \.self) { Text($0).font(.footnote).foregroundStyle(.secondary) }
                    Button(imported ? "Imported" : "Import library", systemImage: imported ? "checkmark" : "square.and.arrow.down") {
                        do {
                            guard let data = transferData else { return }
                            try DesktopLibraryFiles(store: store).importTransfer(transfer, data: data)
                            imported = true; error = nil
                            Task { await sync.syncAll() }
                        } catch { self.error = error.localizedDescription }
                    }.disabled(imported || store.activeSet != nil)
                } header: { Text("Ready to import") } footer: {
                    Text("Scores and equivalent practice targets become usable in Pieces. The original Mac history, rules, corrections and other data stay intact in Mac practice record. Importing does not grant new rewards. Cloud sync includes native goals, routines, score organization, practice records, private PDFs, recordings and custom covers. The original Mac archive stays on this device and in native backups. Ongoing Mac↔iOS sync is a separate step.")
                }
            }
            if !store.state.desktopImports.isEmpty {
                Section("Imported Mac record") {
                    NavigationLink("Mac practice record") { DesktopPracticeRecordView() }
                }
            }
            if let error { Section { ErrorMessage(message: error) } }
        }
        .navigationTitle("Import from Mac")
        .fileImporter(isPresented: $chooseFile, allowedContentTypes: [.json]) { result in
            switch result {
            case .failure(let failure): error = failure.localizedDescription
            case .success(let url):
                loading = true; error = nil; transfer = nil; transferData = nil; imported = false
                Task {
                    do {
                        let pair = try await Task.detached {
                            let scoped = url.startAccessingSecurityScopedResource()
                            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                            let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? Int.max
                            guard size <= 280_000_000 else { throw PracticeError.invalid("Choose a Mac transfer smaller than 280 MB.") }
                            let data = try Data(contentsOf: url, options: .mappedIfSafe)
                            return (try DesktopTransfer.decode(data), data)
                        }.value
                        transfer = pair.0; transferData = pair.1
                    } catch { self.error = error.localizedDescription }
                    loading = false
                }
            }
        }
    }
}

struct DesktopPracticeRecordView: View {
    @Environment(PracticeStore.self) private var store
    @State private var transfer: DesktopTransfer?
    @State private var error: String?
    var body: some View {
        List {
            if let transfer {
                Section("Your Mac practice") {
                    LabeledContent("Repetitions recorded", value: "\(transfer.rows("rep").count)")
                    LabeledContent("Practice sets", value: "\(transfer.rows("rep_block").count)")
                    LabeledContent("Sessions", value: "\(transfer.rows("session").count)")
                }
                Section("Practice sets") {
                    ForEach(Array(transfer.rows("rep_block").reversed().enumerated()), id: \.offset) { _, row in
                        NavigationLink {
                            DesktopSetRecordView(transfer: transfer, row: row)
                        } label: {
                            VStack(alignment: .leading) {
                                Text(DesktopTransfer.text(row, "label").isEmpty ? "Mac practice set" : DesktopTransfer.text(row, "label"))
                                Text("mm. \(DesktopTransfer.displayNumber(row["m_start"]))–\(DesktopTransfer.displayNumber(row["m_end"])) · \(DesktopTransfer.text(row, "created_at"))")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                Section("Complete original record") {
                    ForEach(transfer.tables.keys.sorted(), id: \.self) { table in
                        NavigationLink("\(table) (\(transfer.rows(table).count))") {
                            List(Array(transfer.rows(table).enumerated()), id: \.offset) { _, row in
                                DesktopRawRecordView(row: row)
                            }.navigationTitle(table)
                        }
                    }
                }
            } else if let error { ErrorMessage(message: error) }
            else { SwiftUI.ProgressView("Opening Mac record…") }
        }
        .navigationTitle("Mac practice record")
        .task {
            guard let receipt = store.state.desktopImports.last else { return }
            let path = DesktopLibraryFiles(store: store).directory.appendingPathComponent(receipt.archiveFileName)
            do {
                transfer = try await Task.detached {
                    try DesktopTransfer.decode(Data(contentsOf: path, options: .mappedIfSafe))
                }.value
            }
            catch { self.error = error.localizedDescription }
        }
    }
}

private struct DesktopSetRecordView: View {
    let transfer: DesktopTransfer
    let row: [String: SyncJSON]
    var attempts: [[String: SyncJSON]] { transfer.rows("rep").filter { $0["block_id"] == row["id"] } }
    var body: some View {
        List {
            Section("Original set") { DesktopRawRecordView(row: row) }
            Section("Original repetitions") {
                ForEach(Array(attempts.enumerated()), id: \.offset) { _, attempt in
                    VStack(alignment: .leading, spacing: 5) {
                        Text("\(DesktopTransfer.text(attempt, "verdict").capitalized) · \(DesktopTransfer.displayNumber(attempt["bpm"])) BPM")
                        Text(DesktopTransfer.text(attempt, "ts")).font(.caption).foregroundStyle(.secondary)
                        if let id = attempt["id"] {
                            ForEach(Array(transfer.rows("attempt_adjustment").filter { $0["rep_id"] == id }.enumerated()), id: \.offset) { _, correction in
                                Text("Correction: " + DesktopTransfer.text(correction, "after_json")).font(.footnote)
                            }
                        }
                    }
                }
            }
        }.navigationTitle("Mac practice set")
    }
}

private struct DesktopRawRecordView: View {
    let row: [String: SyncJSON]
    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            ForEach(row.keys.sorted(), id: \.self) { key in
                if let value = row[key], !value.isNull {
                    Text(key + ": " + display(value)).font(.footnote).textSelection(.enabled)
                }
            }
        }
    }
    private func display(_ value: SyncJSON) -> String {
        if let string = value.stringValue { return string }
        guard let data = try? JSONEncoder().encode(value), let text = String(data: data, encoding: .utf8) else { return "" }
        return text
    }
}
