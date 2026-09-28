import SwiftUI

/// §16 Data: piece readiness and a shareable weekly recap. The score heatmap toggles per score from
/// Score options (`ScoreHeatmapView`) since it colors one specific score's pages, not a cross-piece
/// list — this screen points there rather than duplicating it.
struct InsightsView: View {
    @Environment(PracticeStore.self) private var store
    @State private var showRecap = false

    private var context: RuleContext { RuleContext(state: store.state, now: Date(), calendar: .current) }
    private var readiness: [PieceReadinessSummary] {
        store.state.pieces.filter { $0.status != .resting }
            .compactMap { PieceReadiness.evaluate(pieceID: $0.id, context: context) }
            .sorted { ($0.daysToPerformance ?? .max) < ($1.daysToPerformance ?? .max) }
    }

    var body: some View {
        List {
            if store.state.pieces.isEmpty {
                PraeludeEmptyState(title: "Nothing to show yet", symbol: "chart.xyaxis.line",
                                  message: "Add a piece and start practicing. Readiness and your weekly recap build up here.")
                    .listRowBackground(Color.clear).listRowSeparator(.hidden)
            } else {
                Section {
                    Button("Weekly recap", systemImage: "photo.on.rectangle") { showRecap = true }
                        .frame(minHeight: 36)
                } footer: {
                    Text("A shareable image of this week's practice.")
                }
                Section {
                    ForEach(readiness) { summary in
                        PieceReadinessRow(summary: summary, title: pieceTitle(summary.pieceID) ?? "Piece")
                    }
                } header: {
                    Text("Piece readiness")
                } footer: {
                    Text("Open a score and use Score options → Score heatmap to see recent results by passage.")
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(PraeludeColor.paper)
        .navigationTitle("Data")
        .sheet(isPresented: $showRecap) { WeeklyRecapSheet() }
    }

    private func pieceTitle(_ id: UUID) -> String? { store.state.pieces.first { $0.id == id }?.title }
}

private struct PieceReadinessRow: View {
    let summary: PieceReadinessSummary
    let title: String

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.headline)
                Text(summary.reason).font(.subheadline).foregroundStyle(.secondary)
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 2) {
                Text(stateLabel).font(.subheadline.weight(.medium))
                if let days = summary.daysToPerformance {
                    Text(days <= 0 ? "Today" : "\(days)d").font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                }
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }

    private var stateLabel: String {
        switch summary.state {
        case .notStarted: return "Not started"
        case .learning: return "Learning"
        case .review: return "In review"
        case .performanceReady: return "Ready"
        case .atRisk: return "At risk"
        }
    }
}

private struct WeeklyRecapSheet: View {
    @Environment(PracticeStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @Environment(\.displayScale) private var displayScale
    @State private var sharingURL: URL?
    @State private var showShare = false
    @State private var errorMessage: String?

    private var data: WeeklyRecapData { WeeklyRecap.compute(state: store.state, asOf: Date(), calendar: .current) }

    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                WeeklyRecapCard(data: data).padding(.horizontal, 20)
                Button("Share", systemImage: "square.and.arrow.up", action: share)
                    .buttonStyle(.praeludePrimary).padding(.horizontal, 20)
                if let errorMessage { ErrorMessage(message: errorMessage).padding(.horizontal, 20) }
                Spacer(minLength: 0)
            }
            .padding(.top, 16)
            .background(PraeludeColor.paper)
            .navigationTitle("Weekly recap")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } } }
        }
        .sheet(isPresented: $showShare, onDismiss: {
            if let sharingURL { try? FileManager.default.removeItem(at: sharingURL.deletingLastPathComponent()) }
            sharingURL = nil
        }) {
            if let sharingURL { ScoreShareView(url: sharingURL) }
        }
    }

    private func share() {
        let renderer = ImageRenderer(content: WeeklyRecapCard(data: data).frame(width: 360).padding(24).background(PraeludeColor.surface))
        renderer.scale = displayScale
        guard let image = renderer.uiImage, let pngData = image.pngData() else {
            errorMessage = "The recap image could not be created."
            return
        }
        do {
            let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let url = directory.appendingPathComponent("Praelude Weekly Recap.png")
            try pngData.write(to: url)
            sharingURL = url; showShare = true
        } catch { errorMessage = error.localizedDescription }
    }
}

private struct WeeklyRecapCard: View {
    let data: WeeklyRecapData

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 4) {
                Text("This week").praeludeDisplay(22)
                Text("\(data.startDate.formatted(.dateTime.month(.abbreviated).day())) – \(data.endDate.formatted(.dateTime.month(.abbreviated).day()))")
                    .font(.subheadline).foregroundStyle(PraeludeColor.inkSecondary)
            }
            HStack(spacing: 22) {
                recapMetric(practiceDuration(data.focusedSeconds), "Focused time")
                recapMetric("\(data.practiceDays)", "Practice days")
            }
            HStack(spacing: 22) {
                recapMetric("\(data.repetitions)", "Repetitions")
                recapMetric("\(data.completedSets)", "Completed sets")
            }
            HStack(spacing: 22) {
                recapMetric("\(data.streakDays)", "Day streak")
                recapMetric("\(data.piecesPracticed)", "Pieces")
            }
            if data.newlyPerformanceReadyCount > 0 {
                Text("\(PracticeRulesEngine.pluralize(data.newlyPerformanceReadyCount, "passage")) became performance-ready this week.")
                    .font(.subheadline).foregroundStyle(PraeludeColor.inkSecondary)
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(PraeludeColor.surface, in: RoundedRectangle(cornerRadius: PraeludeRadius.card, style: .continuous))
    }

    private func recapMetric(_ value: String, _ title: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(value).praeludeNumeral(22)
            Text(title).font(.caption).foregroundStyle(PraeludeColor.inkSecondary)
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
}
