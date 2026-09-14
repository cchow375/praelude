import SwiftUI

struct TodayView: View {
    @Environment(PracticeStore.self) private var store
    @State private var errorMessage: String?
    @State private var showGoals = false
    let onOpenPiece: (UUID) -> Void
    var onAddPiece: () -> Void = {}

    private var todaySessions: [PracticeSession] {
        store.sessions.filter { Calendar.current.isDateInToday($0.startedAt) }
    }

    private var recentPieces: [Piece] {
        let active = store.pieces.filter { $0.status == .active }
        return Array(active.sorted { left, right in
            (lastPractice(left.id) ?? left.createdAt) > (lastPractice(right.id) ?? right.createdAt)
        }.prefix(5))
    }

    var body: some View {
        List {
            if let activeSet = store.activeSet,
               let piece = store.pieces.first(where: { $0.id == activeSet.configuration.pieceID }) {
                Section {
                    VStack(alignment: .leading, spacing: 17) {
                        VStack(alignment: .leading, spacing: 6) {
                            Text(activeSet.isComplete ? "Set complete" : activeSet.status == .paused ? "Paused set" : "Current set")
                                .font(.caption.weight(.medium)).foregroundStyle(.secondary)
                            Text(piece.title).font(.title2.weight(.semibold))
                            if !activeSet.configuration.focus.isEmpty {
                                Text(activeSet.configuration.focus).font(.subheadline).foregroundStyle(.secondary)
                            }
                        }
                        HStack(spacing: 22) {
                            Label("\(Int(activeSet.currentBPM)) bpm", systemImage: "metronome")
                            Label("\(activeSet.totalPlays) played", systemImage: "repeat")
                        }
                        .font(.subheadline).foregroundStyle(.secondary)
                        Button {
                            continuePractice(activeSet, pieceID: piece.id)
                        } label: {
                            Label(activeSet.isComplete ? "Review set" : activeSet.status == .paused ? "Resume practice" : "Continue practice",
                                  systemImage: activeSet.isComplete ? "checkmark.circle" : "play.fill")
                                .font(.headline)
                                .frame(maxWidth: .infinity, minHeight: 38)
                        }
                        .buttonStyle(.borderedProminent)
                        .controlSize(.large)
                    }
                    .padding(.vertical, 7)
                }
            }

            if let errorMessage { ErrorMessage(message: errorMessage) }

            if store.pieces.isEmpty {
                PraeludeEmptyState(title: "Start practicing", symbol: "pianokeys",
                                  message: "Add a piece and its PDF score, then choose a passage to practice.",
                                  actionTitle: "Add your first piece", action: onAddPiece)
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            } else {
                Section {
                    ViewThatFits(in: .horizontal) {
                        dailyMetrics
                        VStack(alignment: .leading, spacing: 20) {
                            PracticeMetric(value: practiceDuration(todaySessions.reduce(0) { $0 + $1.activeSeconds }),
                                           title: "Focused today", symbol: "clock")
                            PracticeMetric(value: "\(todaySessions.reduce(0) { $0 + $1.attempts.count })",
                                           title: "Repetitions", symbol: "repeat")
                            PracticeMetric(value: "\(todaySessions.reduce(0) { $0 + $1.completedSets })",
                                           title: "Completed sets", symbol: "checkmark.circle")
                        }
                    }
                    .padding(.vertical, 10)
                } header: {
                    Text("Today, \(Date.now.formatted(.dateTime.month(.abbreviated).day()))")
                } footer: {
                    if todaySessions.isEmpty {
                        Text("Your recorded work will appear here after practice.")
                    }
                }

                if !recentPieces.isEmpty {
                    Section("At your piano") {
                        ForEach(recentPieces) { piece in
                            Button { onOpenPiece(piece.id) } label: {
                                LibraryPieceRow(piece: piece, lastPractice: lastPractice(piece.id))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                } else {
                    Section {
                        Text("Your pieces are resting. Open Pieces to make one active, or add new music.")
                            .foregroundStyle(.secondary)
                        Button("Add a piece", systemImage: "plus", action: onAddPiece)
                    }
                }
            }
        }
        .navigationTitle("Today")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Goals", systemImage: "checklist") { showGoals = true }
            }
        }
        .sheet(isPresented: $showGoals) { PracticeGoalsView() }
    }

    private var dailyMetrics: some View {
        HStack(alignment: .top, spacing: 20) {
            PracticeMetric(value: practiceDuration(todaySessions.reduce(0) { $0 + $1.activeSeconds }),
                           title: "Focused today", symbol: "clock")
            PracticeMetric(value: "\(todaySessions.reduce(0) { $0 + $1.attempts.count })",
                           title: "Repetitions", symbol: "repeat")
            PracticeMetric(value: "\(todaySessions.reduce(0) { $0 + $1.completedSets })",
                           title: "Completed sets", symbol: "checkmark.circle")
        }
    }

    private func lastPractice(_ pieceID: UUID) -> Date? {
        store.sessions.filter { $0.pieceID == pieceID }.map(\.startedAt).max()
    }

    private func continuePractice(_ activeSet: ActiveSet, pieceID: UUID) {
        do {
            if activeSet.status == .paused { try store.resume() }
            errorMessage = nil
            onOpenPiece(pieceID)
        } catch { errorMessage = error.localizedDescription }
    }
}
