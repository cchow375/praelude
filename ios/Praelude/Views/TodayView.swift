import SwiftUI

/// One finite daily list leads the screen. Library browsing and optional planning stay secondary;
/// opening Today never fabricates practice, grades a passage or changes a saved review date.
struct TodayView: View {
    @Environment(PracticeStore.self) private var store
    @Environment(MetronomeService.self) private var metronome
    @State private var errorMessage: String?
    @State private var showGoals = false
    @State private var showReviews = false
    @State private var showPlanner = false
    @State private var renamingPassage: Passage?
    @State private var reviewDetails: Passage?
    @State private var organizingPassages = false
    @State private var availableMinutes = 30
    @State private var sessionItems: [SessionItem] = []
    @State private var locallySkippedIDs: Set<UUID> = []
    @State private var now = Date()
    let onOpenPiece: (UUID) -> Void
    var onAddPiece: () -> Void = {}
    var onContinueWarmup: () -> Void = {}
    var onStartPassage: (UUID, UUID) -> Void = { _, _ in }
    var onOpenCards: () -> Void = {}

    private var recentPieces: [Piece] {
        let active = store.realPieces.filter { $0.status != .resting }
        let practiced = store.sessions.reduce(into: [UUID: Date]()) { dates, session in
            dates[session.pieceID] = max(dates[session.pieceID] ?? .distantPast, session.startedAt)
        }
        return Array(active.sorted {
            (practiced[$0.id] ?? $0.createdAt) > (practiced[$1.id] ?? $1.createdAt)
        }.prefix(3))
    }
    private func ruleContext() -> RuleContext { RuleContext(state: store.state, now: max(now, Date()), calendar: .current) }
    private var dailyPlan: TodayOverview.DailyPassagePlan { TodayOverview.dailyPlan(context: ruleContext()) }

    var body: some View {
        let plan = dailyPlan
        List {
            if let activeSet = store.activeSet,
               let piece = store.pieces.first(where: { $0.id == activeSet.configuration.pieceID }) {
                Section {
                    Button {
                        if piece.id == WarmupsPiece.id { errorMessage = nil; onContinueWarmup() }
                        else { continuePractice(activeSet, pieceID: piece.id) }
                    } label: {
                        HStack(spacing: 10) {
                            Image(systemName: activeSet.isComplete ? "checkmark.circle" : "play.circle")
                                .font(.title3)
                            VStack(alignment: .leading, spacing: 3) {
                                Text(activeSet.isComplete ? "Review completed set" : activeSet.status == .paused ? "Resume practice" : "Continue practice")
                                    .font(.subheadline.weight(.semibold))
                                Text("\(piece.id == WarmupsPiece.id ? activeSet.configuration.focus : piece.title) · \(activeSet.progressCount) of \(activeSet.requiredCount)")
                                    .font(.caption).foregroundStyle(.secondary).lineLimit(2)
                            }
                            Spacer(minLength: 0)
                            Image(systemName: "chevron.right").font(.caption).foregroundStyle(.secondary)
                        }.frame(minHeight: 44)
                    }.buttonStyle(.plain).accessibilityIdentifier("todayContinuePractice")
                }
            }
            if let errorMessage { ErrorMessage(message: errorMessage) }
            if store.realPieces.isEmpty {
                PraeludeEmptyState(title: "Start practicing", symbol: "pianokeys",
                                  message: "Use a PDF score, or photograph a passage from your paper music.",
                                  actionTitle: "Add your first piece", action: onAddPiece)
                    .listRowBackground(Color.clear).listRowSeparator(.hidden)
                Button("Photograph a passage", systemImage: "camera", action: onOpenCards).frame(minHeight: 44)
            } else {
                Section {
                    if let first = plan.items.first {
                        Button {
                            onStartPassage(first.pieceID, first.passageID)
                        } label: {
                            Label("Start next passage", systemImage: "play.fill")
                                .font(.subheadline.weight(.semibold)).frame(maxWidth: .infinity, minHeight: 32)
                        }.buttonStyle(.praeludePrimary).accessibilityIdentifier("startNextPassage")
                        ForEach(Array(plan.items.enumerated()), id: \.element.id) { index, item in
                            dailyRow(item, position: index + 1)
                        }
                    } else {
                        Label(plan.completedToday.isEmpty ? "No passage checks needed today" : "Today's passage work is done", systemImage: "checkmark.circle")
                            .font(.subheadline.weight(.medium)).frame(minHeight: 44)
                            .accessibilityIdentifier("todayPassagesComplete")
                        Text(plan.completedToday.isEmpty ? "Choose a piece below, or add a passage you want to remember." : "Your saved work is counted. Tomorrow's checks are separate; you can keep playing freely.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                } header: {
                    HStack {
                        Text("Next at the piano")
                        Spacer()
                        Text("\(plan.completedToday.count) done · \(plan.items.count) left")
                            .font(.caption.monospacedDigit())
                    }
                } footer: {
                    Text("Up to \(plan.dailyLimit) passages today. Check recall first, then rebuild weak spots. Finishing today's work clears its place in this list.")
                }

                if !plan.completedToday.isEmpty || !plan.tomorrow.isEmpty || plan.laterCount > 0 {
                    Section {
                        if !plan.completedToday.isEmpty {
                            DisclosureGroup("Done today · \(plan.completedToday.count)") {
                                ForEach(plan.completedToday) { item in summaryRow(item, showReason: false) }
                            }.accessibilityIdentifier("todayCompletedPassages")
                        }
                        if !plan.tomorrow.isEmpty {
                            DisclosureGroup("Tomorrow · \(PracticeRulesEngine.pluralize(plan.tomorrow.count, "check"))") {
                                Text("Tomorrow's saved checks stay separate from today's work. A passage that took work to reach target needs a fresh first attempt.")
                                    .font(.caption).foregroundStyle(.secondary)
                                ForEach(plan.tomorrow) { item in summaryRow(item, showReason: true) }
                            }.accessibilityIdentifier("tomorrowPassages")
                        }
                        if plan.laterCount > 0 {
                            DisclosureGroup("Later · \(PracticeRulesEngine.pluralize(plan.laterCount, "passage"))") {
                                Text("Kept in your library, outside today's small list. Missing a date never creates a failed attempt.")
                                    .font(.caption).foregroundStyle(.secondary)
                                Button("Browse all passages", systemImage: "rectangle.stack", action: onOpenCards)
                                    .font(.subheadline).frame(minHeight: 44)
                            }.accessibilityIdentifier("laterPassages")
                        }
                    }
                }
                if plan.laterCount == 0 { Section { reviewQueueButton } }

                if !recentPieces.isEmpty {
                    Section("Your pieces") {
                        ForEach(recentPieces) { piece in
                            Button { onOpenPiece(piece.id) } label: {
                                HStack(spacing: 10) {
                                    Image(systemName: "music.book.closed").foregroundStyle(.secondary)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(piece.title).font(.subheadline.weight(.medium)).lineLimit(2)
                                        if !piece.composer.isEmpty { Text(piece.composer).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                                    }
                                    Spacer(minLength: 0)
                                    Image(systemName: "chevron.right").font(.caption).foregroundStyle(.secondary)
                                }.frame(minHeight: 44).contentShape(Rectangle())
                            }.buttonStyle(.plain)
                        }
                    }
                }
            }
        }
        .accessibilityIdentifier("todayPracticeList")
        .scrollContentBackground(.hidden).background(PraeludeColor.paper)
        .navigationTitle("Today").navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button("Plan by available time", systemImage: "clock") { refreshPlan(); showPlanner = true }
                    Button("Goals", systemImage: "checklist") { showGoals = true }
                    Button("Passage names & goal tempos", systemImage: "character.cursor.ibeam") { organizingPassages = true }
                        .accessibilityIdentifier("organizePassagesToday")
                    Button("Practice order & review guide", systemImage: "rectangle.stack") { showReviews = true }
                } label: {
                    Image(systemName: "ellipsis.circle").frame(width: 44, height: 44)
                }.accessibilityLabel("Practice tools").accessibilityIdentifier("todayPracticeTools")
            }
        }
        .sheet(isPresented: $showGoals) { PracticeGoalsView() }
        .sheet(isPresented: $showReviews) { PassageReviewQueueView(onStart: onStartPassage) }
        .sheet(item: $renamingPassage) { passage in PassageRenameView(passage: passage) }
        .sheet(item: $reviewDetails) { passage in PassageReviewDetailsView(passageID: passage.id) }
        .sheet(isPresented: $organizingPassages) { PassageLibraryNamesView() }
        // Read the items while constructing the sheet so SwiftUI observes this state even while
        // the sheet is closed. Otherwise the first presentation can capture an empty old array.
        .sheet(isPresented: $showPlanner) { [sessionItems] in timePlanner(items: sessionItems) }
        // Roll the daily readout forward while Today stays open across midnight. No data is written.
        .onReceive(Timer.publish(every: 60, on: .main, in: .common).autoconnect()) { now = $0 }
        .onAppear { now = Date() }
    }

    private var reviewQueueButton: some View {
        Button("Practice order & review guide", systemImage: "rectangle.stack") { showReviews = true }
            .font(.subheadline).frame(minHeight: 44).accessibilityIdentifier("allPassageReviews")
    }

    @ViewBuilder private func dailyRow(_ item: TodayOverview.DueReview, position: Int) -> some View {
        if let passage = store.state.passages.first(where: { $0.id == item.passageID }) {
            let piece = store.pieces.first { $0.id == item.pieceID }
            Button { onStartPassage(item.pieceID, item.passageID) } label: {
                HStack(alignment: .center, spacing: 10) {
                    PassageCardArtwork(passage: passage, piece: piece).frame(width: 66, height: 54).clipped()
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 3) {
                        Text("\(position). \(item.label)").font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
                        Text(piece?.title ?? "Piece").font(.subheadline.weight(.semibold)).lineLimit(2)
                        Text("\(passage.title) · \(ScoreOrganization.locationLabel(for: passage, in: piece))")
                            .font(.caption).foregroundStyle(.secondary).lineLimit(2)
                        if position == 1 || item.priority == .rebuild {
                            Text(item.reason).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                        }
                    }.frame(maxWidth: .infinity, alignment: .leading)
                    Image(systemName: "play.fill").font(.caption).foregroundStyle(.secondary)
                }.frame(minHeight: 54).contentShape(Rectangle())
            }.buttonStyle(.plain)
                .accessibilityIdentifier("startSessionItem_\(item.priority == .new ? "new" : "review")_\(item.id)")
                .contextMenu {
                    Button("Review details", systemImage: "clock.arrow.circlepath") { reviewDetails = passage }
                    Button("Name & goal tempo", systemImage: "pencil") { renamingPassage = passage }
                }
        }
    }

    @ViewBuilder private func summaryRow(_ item: TodayOverview.DueReview, showReason: Bool) -> some View {
        if let passage = store.state.passages.first(where: { $0.id == item.passageID }) {
            let piece = store.pieces.first { $0.id == item.pieceID }
            VStack(alignment: .leading, spacing: 3) {
                Text(piece?.title ?? "Piece").font(.subheadline)
                Text("\(passage.title) · \(ScoreOrganization.locationLabel(for: passage, in: piece))")
                    .font(.caption).foregroundStyle(.secondary)
                if showReason { Text(item.reason).font(.caption).foregroundStyle(.secondary) }
            }.padding(.vertical, 3)
        }
    }

    private func timePlanner(items: [SessionItem]) -> some View {
        NavigationStack {
            List {
                Section {
                    Stepper(value: $availableMinutes, in: 5...180, step: 5) {
                        LabeledContent("Available time", value: "\(availableMinutes) min")
                    }.onChange(of: availableMinutes) { _, _ in refreshPlan() }
                    if let first = items.first {
                        Button("Start session", systemImage: "play.fill") { showPlanner = false; startItem(first) }
                            .frame(minHeight: 44).accessibilityIdentifier("startSession")
                    }
                    ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                        SessionItemRow(item: item, title: sessionItemTitle(item),
                                       tempoGoal: store.state.passages.first { $0.id == item.passageID }?.performanceTempo,
                                       onStart: { showPlanner = false; startItem(item) },
                                       onRename: nil,
                                       onSkip: { skip(item) }, onMoveUp: index > 0 ? { move(index, by: -1) } : nil,
                                       onMoveDown: index < items.count - 1 ? { move(index, by: 1) } : nil)
                    }
                    if items.isEmpty { Text("Nothing fits this time. You can choose any piece or passage.").foregroundStyle(.secondary) }
                } footer: { Text("Optional: arrange warmups, passages and run-throughs for the time you have. This does not change review dates.") }
            }.accessibilityIdentifier("timePlannerList")
                .navigationTitle("Plan by time").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { showPlanner = false } } }
                .onAppear { refreshPlan() }
        }
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
        // §11 "one-tap override, logged" — R15 built this item into today's plan; skipping it is
        // that same override, previously kept only in `locallySkippedIDs` (in-memory, unlogged).
        let decision = Decision(ruleID: .r15SessionBuilder, pieceID: item.pieceID, passageID: item.passageID, reason: item.reason)
        try? store.recordRuleEvent(decision.asRuleEvent(overridden: true))
    }

    private func startItem(_ item: SessionItem) {
        errorMessage = nil
        let context = ruleContext()
        do {
            switch item.kind {
            case .warmup:
                guard let exercise = store.state.warmupExercises.first(where: { $0.id == item.id && $0.deletedAt == nil }) else {
                    throw PracticeError.unavailable("This warmup is no longer available. Rebuild your session to choose another.")
                }
                try store.ensureWarmupsPiece()
                let bpm = WarmupCatalog.defaultBPM(for: exercise.kind)
                let configuration = PracticeConfiguration(pieceID: WarmupsPiece.id, focus: exercise.name, goal: .tempo,
                                                           basis: .cleanStreak, targetCount: 5, startBPM: bpm, targetBPM: bpm,
                                                           useMetronome: true)
                try store.startSet(configuration)
                metronome.setTempo(bpm); metronome.start()
                try store.recordWarmupUse(exercise.id)
                onContinueWarmup()
            case .review, .learning, .new:
                guard let passageID = item.passageID, let pieceID = item.pieceID else { return }
                // §9/R3: "the first attempt of the day... prompts Clean/Shaky/Missed" — that grade is
                // what actually drives R4's schedule (`PracticeArmController.start(grade:...)` is the
                // only writer of `coldGrades`). Starting the set directly here, the way the run-through
                // branch below still does, would silently skip both rules on every cold-eligible
                // passage, the same way tapping this passage on the score itself never would — so this
                // hands off to that exact flow instead, landing on the score already armed. Only once
                // today's cold grade is already behind this passage (nothing left for R3 to do) is a
                // direct start here equivalent to going through the arm controller, so that case keeps
                // the original ≤1-tap behavior rather than adding a needless extra confirmation.
                if PracticeRulesEngine.isColdAttemptEligible(passageID: passageID, context: context) {
                    onStartPassage(pieceID, passageID)
                    return
                }
                guard let configuration = PracticeRulesEngine.defaultConfiguration(for: passageID, context: context) else { return }
                try store.startSet(configuration)
                onOpenPiece(pieceID)
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
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let item: SessionItem
    let title: String
    let tempoGoal: Double?
    let onStart: () -> Void
    let onRename: (() -> Void)?
    let onSkip: () -> Void
    let onMoveUp: (() -> Void)?
    let onMoveDown: (() -> Void)?

    var body: some View {
        let layout = dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 10)) : AnyLayout(HStackLayout(spacing: 10))
        return layout {
            VStack(alignment: .leading, spacing: 3) {
                let heading = dynamicTypeSize.isAccessibilitySize
                    ? AnyLayout(VStackLayout(alignment: .leading, spacing: 3)) : AnyLayout(HStackLayout(spacing: 6))
                heading {
                    Text(kindLabel).font(.caption.weight(.semibold)).foregroundStyle(PraeludeColor.inkSecondary)
                    Text("\(item.estimatedMinutes) min").font(.caption).foregroundStyle(PraeludeColor.inkTertiary)
                }
                Text(title.isEmpty ? "Untitled" : title).onTapGesture(count: 2) { onRename?() }.font(.subheadline.weight(.medium))
                    .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 1)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityIdentifier("plannerTitle_\(item.id)")
                if let tempoGoal {
                    Text("Goal \(PracticeReferenceFormatting.bpm(tempoGoal)) BPM").font(.caption).foregroundStyle(.secondary)
                }
                Text(item.reason).font(.caption).foregroundStyle(.secondary).lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 2)
            }.frame(maxWidth: .infinity, alignment: .leading)
            HStack(spacing: 8) {
            if let onRename {
                Button(action: onRename) {
                    Image(systemName: "pencil").frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }.buttonStyle(.plain)
                    .accessibilityLabel("Edit name and goal tempo")
                    .accessibilityIdentifier("editSessionPassage_\(item.id)")
            }
            Button(action: onStart) {
                Text("Start").font(.caption.weight(.semibold)).padding(.horizontal, 10)
                    .frame(minHeight: 44).contentShape(Rectangle())
            }.buttonStyle(.plain)
                .background(PraeludeColor.inkFillQuiet, in: Capsule())
                .accessibilityIdentifier("startSessionItem_\(item.kind.rawValue)_\(item.id)")
            Menu {
                if let onRename { Button("Name & goal tempo", systemImage: "character.cursor.ibeam", action: onRename) }
                Button("Move earlier", systemImage: "arrow.up") { onMoveUp?() }.disabled(onMoveUp == nil)
                Button("Move later", systemImage: "arrow.down") { onMoveDown?() }.disabled(onMoveDown == nil)
                Button("Skip", systemImage: "forward", action: onSkip)
            } label: {
                Image(systemName: "ellipsis").frame(width: 44, height: 44)
            }.accessibilityLabel("Session item options")
                .foregroundStyle(PraeludeColor.inkSecondary)
            }
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
