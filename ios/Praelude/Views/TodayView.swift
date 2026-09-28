import SwiftUI

struct TodayView: View {
    @Environment(PracticeStore.self) private var store
    @State private var errorMessage: String?
    @State private var showGoals = false
    let onOpenPiece: (UUID) -> Void
    var onAddPiece: () -> Void = {}
    var onContinueWarmup: () -> Void = {}

    private var todaySessions: [PracticeSession] {
        store.sessions.filter { Calendar.current.isDateInToday($0.startedAt) }
    }

    private var recentPieces: [Piece] {
        // Resting is the one opt-out state; any other status belongs here (see LibraryView.visiblePieces).
        // realPieces (not pieces): the internal warmups attachment point never browses as a piece.
        let active = store.realPieces.filter { $0.status != .resting }
        return Array(active.sorted { left, right in
            (lastPractice(left.id) ?? left.createdAt) > (lastPractice(right.id) ?? right.createdAt)
        }.prefix(5))
    }

    var body: some View {
        List {
            if let activeSet = store.activeSet,
               let piece = store.pieces.first(where: { $0.id == activeSet.configuration.pieceID }) {
                let isWarmup = piece.id == WarmupsPiece.id
                Section {
                    VStack(alignment: .leading, spacing: 17) {
                        VStack(alignment: .leading, spacing: 6) {
                            HStack(spacing: 6) {
                                if activeSet.status == .running {
                                    Circle().fill(PraeludeColor.live).frame(width: 6, height: 6)
                                }
                                Text(activeSet.isComplete ? "Set complete" : activeSet.status == .paused ? "Paused set" : (isWarmup ? "Warming up" : "Practicing now"))
                                    .font(.caption.weight(.medium)).foregroundStyle(PraeludeColor.inkSecondary)
                            }
                            Text(isWarmup ? activeSet.configuration.focus : piece.title).praeludeDisplay(24)
                            if !isWarmup, !activeSet.configuration.focus.isEmpty {
                                Text(activeSet.configuration.focus).font(.subheadline).foregroundStyle(PraeludeColor.inkSecondary)
                            }
                        }
                        HStack(spacing: 22) {
                            Label { Text("\(Int(activeSet.currentBPM)) bpm") } icon: { PraeludeIcon(glyph: .tempo, size: 16) }
                            Label { Text("\(activeSet.totalPlays) played") } icon: { Image(systemName: "repeat") }
                        }
                        .font(.subheadline).foregroundStyle(PraeludeColor.inkSecondary)
                        Button {
                            if isWarmup { errorMessage = nil; onContinueWarmup() }
                            else { continuePractice(activeSet, pieceID: piece.id) }
                        } label: {
                            Label(activeSet.isComplete ? "Review set" : activeSet.status == .paused ? "Resume practice" : "Continue practice",
                                  systemImage: activeSet.isComplete ? "checkmark.circle" : "play.fill")
                                .font(.headline)
                                .frame(maxWidth: .infinity, minHeight: 38)
                        }
                        .buttonStyle(.praeludePrimary)
                    }
                    .padding(.vertical, 7)
                    .listRowBackground(Color.clear)
                }
            }

            if let errorMessage { ErrorMessage(message: errorMessage) }

            if store.realPieces.isEmpty {
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
                            Button {
                                #if DEBUG
                                if ProcessInfo.processInfo.arguments.contains("--uitesting") { NSLog("PraeludeUITest: Today row action") }
                                #endif
                                onOpenPiece(piece.id)
                            } label: {
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
        .scrollContentBackground(.hidden)
        .background(PraeludeColor.paper)
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
