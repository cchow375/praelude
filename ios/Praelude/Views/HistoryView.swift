import SwiftUI
import UniformTypeIdentifiers

/// §15 History: sessions, sets, per-passage grade/tempo history over time, and CSV/JSON export via
/// share sheet/Files.
struct HistoryView: View {
    @Environment(PracticeStore.self) private var store
    @State private var exportingCSV = false
    @State private var exportingJSON = false
    @State private var csvDocument: HistoryCSVDocument?
    @State private var jsonDocument: HistoryJSONDocument?
    @State private var sharingURL: URL?
    @State private var showShare = false
    @State private var errorMessage: String?

    private var sessions: [PracticeSession] { store.sessions.sorted { $0.startedAt > $1.startedAt } }
    private var passagesWithHistory: [Passage] {
        let touched = Set((store.state.history + [store.activeSet].compactMap { $0 }).compactMap(\.configuration.passageID))
            .union(store.state.coldGrades.map(\.passageID))
        return store.state.passages.filter { touched.contains($0.id) }.sorted { $0.title < $1.title }
    }

    var body: some View {
        List {
            if sessions.isEmpty && passagesWithHistory.isEmpty {
                PraeludeEmptyState(title: "No history yet", symbol: "clock.arrow.circlepath",
                                  message: "Practice a set and your sessions, repetitions and per-passage grades build up here.")
                    .listRowBackground(Color.clear).listRowSeparator(.hidden)
            } else {
                Section {
                    Button("Export CSV", systemImage: "tablecells") {
                        csvDocument = HistoryCSVDocument(text: HistoryExport.csv(state: store.state)); exportingCSV = true
                    }
                    Button("Export JSON", systemImage: "curlybraces") {
                        do { jsonDocument = HistoryJSONDocument(data: try HistoryExport.json(state: store.state)); exportingJSON = true }
                        catch { errorMessage = error.localizedDescription }
                    }
                    Button("Share as CSV", systemImage: "square.and.arrow.up", action: share)
                } header: {
                    Text("Export")
                } footer: {
                    Text("Includes every recorded repetition: date, piece, passage, focus, verdict and tempo.")
                }

                if !passagesWithHistory.isEmpty {
                    Section("By passage") {
                        ForEach(passagesWithHistory) { passage in
                            NavigationLink {
                                PassageHistoryDetailView(passage: passage)
                            } label: {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(passage.title).font(.headline)
                                    Text(pieceTitle(passage.pieceID) ?? "").font(.subheadline).foregroundStyle(.secondary)
                                }.padding(.vertical, 3)
                            }
                        }
                    }
                }

                if !sessions.isEmpty {
                    Section("Sessions") {
                        ForEach(sessions) { session in
                            NavigationLink { HistorySessionDetailView(sessionID: session.id) } label: {
                                HistorySessionRow(session: session, pieceTitle: pieceTitle(session.pieceID))
                            }
                        }
                    }
                }
            }
            if let errorMessage { Section { ErrorMessage(message: errorMessage) } }
        }
        .scrollContentBackground(.hidden)
        .background(PraeludeColor.paper)
        .navigationTitle("History")
        .fileExporter(isPresented: $exportingCSV, document: csvDocument, contentType: .commaSeparatedText, defaultFilename: "Praelude History") { result in
            if case .failure(let failure) = result { errorMessage = failure.localizedDescription }
        }
        .fileExporter(isPresented: $exportingJSON, document: jsonDocument, contentType: .json, defaultFilename: "Praelude History") { result in
            if case .failure(let failure) = result { errorMessage = failure.localizedDescription }
        }
        .sheet(isPresented: $showShare, onDismiss: {
            if let sharingURL { try? FileManager.default.removeItem(at: sharingURL.deletingLastPathComponent()) }
            sharingURL = nil
        }) {
            if let sharingURL { ScoreShareView(url: sharingURL) }
        }
    }

    private func pieceTitle(_ id: UUID) -> String? { store.state.pieces.first { $0.id == id }?.title }

    private func share() {
        do {
            let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let url = directory.appendingPathComponent("Praelude History.csv")
            try Data(HistoryExport.csv(state: store.state).utf8).write(to: url)
            sharingURL = url; showShare = true
        } catch { errorMessage = error.localizedDescription }
    }
}

private struct HistorySessionRow: View {
    let session: PracticeSession
    let pieceTitle: String?
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text(pieceTitle ?? "Practice session").font(.headline).lineLimit(2)
                Spacer(minLength: 12)
                Text(practiceDuration(session.activeSeconds)).font(.subheadline.monospacedDigit()).foregroundStyle(.secondary)
            }
            HStack(spacing: 5) {
                Text(session.startedAt, format: .dateTime.month(.abbreviated).day())
                Text("·")
                Text("\(session.attempts.count) reps")
                if session.endedAt == nil { Text("· Open") }
            }.font(.subheadline).foregroundStyle(.secondary)
        }.padding(.vertical, 4)
    }
}

private struct PassageHistoryDetailView: View {
    @Environment(PracticeStore.self) private var store
    let passage: Passage
    private var points: [PassageHistory.Point] { PassageHistory.timeline(passageID: passage.id, state: store.state) }

    var body: some View {
        List {
            if points.isEmpty {
                PraeludeEmptyState(title: "No history yet", symbol: "chart.xyaxis.line",
                                  message: "Grades and tempos recorded on this passage build a timeline here.")
                    .listRowBackground(Color.clear).listRowSeparator(.hidden)
            } else {
                Section {
                    ForEach(points.reversed()) { point in
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(label(for: point.kind)).font(.subheadline.weight(.medium))
                                Text(point.date, format: .dateTime.month(.abbreviated).day().hour().minute())
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Text("\(Int(point.tempo.rounded())) bpm").font(.subheadline.monospacedDigit())
                        }.padding(.vertical, 3)
                    }
                } footer: {
                    Text("\(PracticeRulesEngine.pluralize(points.count, "point")) recorded.")
                }
            }
        }
        .navigationTitle(passage.title)
        .navigationBarTitleDisplayMode(.inline)
    }

    private func label(for kind: PassageHistory.PointKind) -> String {
        switch kind {
        case .coldGrade(let grade): return "Cold · \(grade.rawValue.capitalized)"
        case .attempt(let verdict): return verdict.rawValue.capitalized
        }
    }
}

private struct HistorySessionDetailView: View {
    @Environment(PracticeStore.self) private var store
    let sessionID: UUID
    private var session: PracticeSession? { store.sessions.first { $0.id == sessionID } }
    private var summary: SessionSummaryData? {
        SessionSummary.summarize(sessionID: sessionID, state: store.state, calendar: .current, now: Date())
    }

    var body: some View {
        List {
            if let session {
                Section("Summary") {
                    LabeledContent("Piece", value: store.state.pieces.first { $0.id == session.pieceID }?.title ?? "Practice session")
                    LabeledContent("Started", value: session.startedAt.formatted(date: .abbreviated, time: .shortened))
                    LabeledContent("Focused time", value: practiceDuration(session.activeSeconds))
                    LabeledContent("Repetitions", value: "\(session.attempts.count)")
                    LabeledContent("Completed sets", value: "\(session.completedSets)")
                }
                if let summary {
                    Section {
                        LabeledContent("Moved up", value: "\(summary.movedUp)")
                        LabeledContent("Dropped back", value: "\(summary.droppedBack)")
                        LabeledContent("Parked", value: "\(summary.parked)")
                        LabeledContent("Due tomorrow", value: "\(summary.dueTomorrow)")
                    } header: {
                        Text("What changed")
                    } footer: {
                        Text("Counts the passages you practiced this session whose tempo or schedule moved.")
                    }
                }
                if !session.attempts.isEmpty {
                    Section("Recorded repetitions") {
                        ForEach(Array(session.attempts.enumerated()), id: \.element.id) { index, attempt in
                            HStack(spacing: 13) {
                                Text("\(index + 1)").font(.subheadline.monospacedDigit()).foregroundStyle(.secondary)
                                    .frame(minWidth: 24, alignment: .trailing)
                                Text(attempt.verdict.rawValue.capitalized)
                                Spacer()
                                VStack(alignment: .trailing, spacing: 3) {
                                    Text("\(Int(attempt.bpm)) bpm").font(.subheadline.monospacedDigit())
                                    Text(attempt.date, format: .dateTime.hour().minute()).font(.caption).foregroundStyle(.secondary)
                                }
                            }.padding(.vertical, 3)
                        }
                    }
                }
            } else {
                ContentUnavailableView("Session unavailable", systemImage: "clock",
                                       description: Text("This session is no longer in the current practice record."))
            }
        }
        .navigationTitle("Session")
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct HistoryCSVDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.commaSeparatedText] }
    var text: String
    init(text: String) { self.text = text }
    init(configuration: ReadConfiguration) throws { throw CocoaError(.fileReadCorruptFile) }
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper { FileWrapper(regularFileWithContents: Data(text.utf8)) }
}

private struct HistoryJSONDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.json] }
    var data: Data
    init(data: Data) { self.data = data }
    init(configuration: ReadConfiguration) throws { throw CocoaError(.fileReadCorruptFile) }
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper { FileWrapper(regularFileWithContents: data) }
}
