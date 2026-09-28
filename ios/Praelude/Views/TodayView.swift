import SwiftUI

struct TodayView: View {
    @Environment(PracticeStore.self) private var store
    @State private var errorMessage: String?
    @State private var showGoals = false
    @State private var availableMinutes = 30
    @State private var sessionItems: [SessionItem] = []
    /// Skipped this app session only (§15 "skip"): the underlying passage/warmup/piece stays exactly
    /// as due as it already was — see "(C) Rules Engine.md"'s R15 section — this only keeps a locally
    /// dismissed item from reappearing the next time the plan is rebuilt in this same view session.
    @State private var locallySkippedIDs: Set<UUID> = []
    let onOpenPiece: (UUID) -> Void
    var onAddPiece: () -> Void = {}

    private var todaySessions: [PracticeSession] {
        store.sessions.filter { Calendar.current.isDateInToday($0.startedAt) }
    }

    private var recentPieces: [Piece] {
        // Resting is the one opt-out state; any other status (including a future one no
        // one has invented yet) belongs here (see LibraryView.visiblePieces).
        let active = store.pieces.filter { $0.status != .resting }
        return Array(active.sorted { left, right in
            (lastPractice(left.id) ?? left.createdAt) > (lastPractice(right.id) ?? right.createdAt)
        }.prefix(5))
    }

    private func ruleContext(now: Date = Date()) -> RuleContext { RuleContext(state: store.state, now: now, calendar: .current) }
    private var streakStatus: TodayOverview.StreakStatus {
        TodayOverview.streakStatus(rewardsState: store.state.rewardsState, calendar: .current, now: Date())
    }
    private var dueReviews: [TodayOverview.DueReview] { TodayOverview.dueReviews(context: ruleContext()) }
    private var upcomingPerformances: [TodayOverview.UpcomingPerformance] { TodayOverview.upcomingPerformances(context: ruleContext()) }

    var body: some View {
        List {
            if let activeSet = store.activeSet,
               let piece = store.pieces.first(where: { $0.id == activeSet.configuration.pieceID }) {
                Section {
                    VStack(alignment: .leading, spacing: 17) {
                        VStack(alignment: .leading, spacing: 6) {
                            HStack(spacing: 6) {
                                if activeSet.status == .running {
                                    Circle().fill(PraeludeColor.live).frame(width: 6, height: 6)
                                }
                                Text(activeSet.isComplete ? "Set complete" : activeSet.status == .paused ? "Paused set" : "Practicing now")
                                    .font(.caption.weight(.medium)).foregroundStyle(PraeludeColor.inkSecondary)
                            }
                            Text(piece.title).praeludeDisplay(24)
                            if !activeSet.configuration.focus.isEmpty {
                                Text(activeSet.configuration.focus).font(.subheadline).foregroundStyle(PraeludeColor.inkSecondary)
                            }
                        }
                        HStack(spacing: 22) {
                            Label { Text("\(Int(activeSet.currentBPM)) bpm") } icon: { PraeludeIcon(glyph: .tempo, size: 16) }
                            Label { Text("\(activeSet.totalPlays) played") } icon: { Image(systemName: "repeat") }
                        }
                        .font(.subheadline).foregroundStyle(PraeludeColor.inkSecondary)
                        Button {
                            continuePractice(activeSet, pieceID: piece.id)
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

            if store.pieces.isEmpty {
                PraeludeEmptyState(title: "Start practicing", symbol: "pianokeys",
                                  message: "Add a piece and its PDF score, then choose a passage to practice.",
                                  actionTitle: "Add your first piece", action: onAddPiece)
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            } else {
                Section {
                    HStack(spacing: 10) {
                        Image(systemName: "flame").font(.subheadline).foregroundStyle(streakStatus.currentDays > 0 ? PraeludeColor.ink : PraeludeColor.inkTertiary)
                        Text(streakStatus.message).font(.subheadline)
                        Spacer(minLength: 8)
                        if streakStatus.freezesAvailable > 0 {
                            Text(PracticeRulesEngine.pluralize(streakStatus.freezesAvailable, "freeze")).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    HStack(spacing: 10) {
                        Image(systemName: "arrow.triangle.2.circlepath").font(.subheadline).foregroundStyle(dueReviews.isEmpty ? PraeludeColor.inkTertiary : PraeludeColor.ink)
                        Text(dueReviews.isEmpty ? "No reviews due." : "\(PracticeRulesEngine.pluralize(dueReviews.count, "review")) due.").font(.subheadline)
                        Spacer(minLength: 8)
                    }
                }

                Section {
                    Stepper(value: $availableMinutes, in: 5...180, step: 5) {
                        HStack {
                            Text("Available time")
                            Spacer()
                            Text("\(availableMinutes) min").font(.subheadline.monospacedDigit()).foregroundStyle(.secondary)
                        }
                    }
                    .onChange(of: availableMinutes) { _, _ in refreshPlan() }

                    if sessionItems.isEmpty {
                        Text("Nothing fits your available time right now.").font(.subheadline).foregroundStyle(.secondary)
                    } else {
                        ForEach(Array(sessionItems.enumerated()), id: \.element.id) { index, item in
                            SessionItemRow(item: item, title: sessionItemTitle(item),
                                          onStart: { startItem(item) }, onSkip: { skip(item) },
                                          onMoveUp: index > 0 ? { move(index, by: -1) } : nil,
                                          onMoveDown: index < sessionItems.count - 1 ? { move(index, by: 1) } : nil)
                        }
                        Button {
                            // Skip past a leading warmup (no practice flow to start yet) to the
                            // first item "Start session" can actually begin.
                            if let first = sessionItems.first(where: { $0.kind != .warmup }) { startItem(first) }
                        } label: {
                            Label("Start session", systemImage: "play.fill").frame(maxWidth: .infinity, minHeight: 38)
                        }
                        .buttonStyle(.praeludePrimary)
                        .disabled(sessionItems.allSatisfy { $0.kind == .warmup })
                        .accessibilityIdentifier("startSession")
                    }
                } header: {
                    Text("Today's session")
                } footer: {
                    Text("Built from due reviews, pieces you're learning, and up to a few new passages, fit to your available time.")
                }

                if !upcomingPerformances.isEmpty {
                    Section("Upcoming performances") {
                        ForEach(upcomingPerformances) { performance in
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(store.state.pieces.first { $0.id == performance.pieceID }?.title ?? "Piece").font(.subheadline.weight(.medium))
                                    Text(performance.date, format: .dateTime.month(.abbreviated).day()).font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer()
                                Text(performance.daysRemaining <= 0 ? "Today" : "\(performance.daysRemaining)d")
                                    .praeludeNumeral(17).foregroundStyle(PraeludeColor.ink)
                            }.padding(.vertical, 2)
                        }
                    }
                }

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
                Button("Rebuild session", systemImage: "arrow.clockwise") { refreshPlan() }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button("Goals", systemImage: "checklist") { showGoals = true }
            }
        }
        .sheet(isPresented: $showGoals) { PracticeGoalsView() }
        .onAppear { if sessionItems.isEmpty { refreshPlan() } }
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

    private func refreshPlan() {
        let plan = PracticeRulesEngine.buildSession(availableMinutes: availableMinutes, context: ruleContext())
        sessionItems = plan.items.filter { !locallySkippedIDs.contains($0.id) }
    }

    private func sessionItemTitle(_ item: SessionItem) -> String {
        switch item.kind {
        case .warmup:
            return store.state.warmupExercises.first { $0.id == item.id }?.name ?? "Warmup"
        case .runThrough:
            return store.state.pieces.first { $0.id == item.pieceID }?.title ?? "Run-through"
        case .review, .learning, .new:
            let passageTitle = store.state.passages.first { $0.id == item.passageID }?.title
            let pieceTitle = store.state.pieces.first { $0.id == item.pieceID }?.title
            return [passageTitle, pieceTitle].compactMap { $0 }.joined(separator: " · ")
        }
    }

    private func move(_ index: Int, by offset: Int) {
        let target = index + offset
        guard sessionItems.indices.contains(target) else { return }
        sessionItems.swapAt(index, target)
    }

    private func skip(_ item: SessionItem) {
        locallySkippedIDs.insert(item.id)
        sessionItems.removeAll { $0.id == item.id }
    }

    private func startItem(_ item: SessionItem) {
        errorMessage = nil
        let context = ruleContext()
        do {
            switch item.kind {
            case .warmup:
                return // No warmup practice flow exists yet (§12 is a separate track).
            case .review, .learning, .new:
                guard let passageID = item.passageID,
                      let configuration = PracticeRulesEngine.defaultConfiguration(for: passageID, context: context) else { return }
                try store.startSet(configuration)
                if let pieceID = item.pieceID { onOpenPiece(pieceID) }
            case .runThrough:
                guard let pieceID = item.pieceID else { return }
                let configuration = PracticeConfiguration(pieceID: pieceID, focus: "Run-through", basis: .totalPlays, targetCount: 1)
                try store.startSet(configuration)
                onOpenPiece(pieceID)
            }
        } catch { errorMessage = error.localizedDescription }
    }
}

private struct SessionItemRow: View {
    let item: SessionItem
    let title: String
    let onStart: () -> Void
    let onSkip: () -> Void
    let onMoveUp: (() -> Void)?
    let onMoveDown: (() -> Void)?

    var body: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(kindLabel).font(.caption.weight(.semibold)).foregroundStyle(PraeludeColor.inkSecondary)
                    Text("\(item.estimatedMinutes) min").font(.caption).foregroundStyle(PraeludeColor.inkTertiary)
                }
                Text(title.isEmpty ? "Untitled" : title).font(.subheadline.weight(.medium)).lineLimit(1)
                Text(item.reason).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer(minLength: 6)
            if item.kind != .warmup {
                Button("Start", action: onStart)
                    .font(.caption.weight(.semibold)).buttonStyle(.plain)
                    .padding(.horizontal, 10).padding(.vertical, 6)
                    .background(PraeludeColor.inkFillQuiet, in: Capsule())
            }
            VStack(spacing: 2) {
                Button { onMoveUp?() } label: { Image(systemName: "chevron.up") }
                    .disabled(onMoveUp == nil).accessibilityLabel("Move earlier")
                Button { onMoveDown?() } label: { Image(systemName: "chevron.down") }
                    .disabled(onMoveDown == nil).accessibilityLabel("Move later")
            }
            .font(.caption).buttonStyle(.plain).foregroundStyle(PraeludeColor.inkTertiary)
        }
        .padding(.vertical, 4)
        .swipeActions(edge: .trailing) {
            Button("Skip", role: .destructive, action: onSkip)
        }
    }

    private var kindLabel: String {
        switch item.kind {
        case .warmup: return "Warmup"
        case .review: return "Review"
        case .learning: return "Learning"
        case .new: return "New"
        case .runThrough: return "Run-through"
        }
    }
}
