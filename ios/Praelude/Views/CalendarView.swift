import SwiftUI

/// §15 Calendar: practice days, minutes per day, and performances.
struct CalendarView: View {
    @Environment(PracticeStore.self) private var store
    @State private var visibleMonth = Calendar.current.startOfDay(for: .now)
    @State private var selectedDay = Calendar.current.startOfDay(for: .now)
    @State private var addingPerformanceFor: DayRoute?
    @State private var errorMessage: String?
    private let calendar = Calendar.current

    private var dailyTotals: [Date: PracticeCalendarStats.DayTotal] {
        PracticeCalendarStats.dailyTotals(state: store.state, calendar: calendar)
    }
    private var performanceDays: [PracticeCalendarStats.PerformanceDay] {
        PracticeCalendarStats.performanceDays(state: store.state, calendar: calendar)
    }

    var body: some View {
        let totals = dailyTotals
        let performances = performanceDays
        let streak = PracticeCalendarStats.recordedStreak(state: store.state, calendar: calendar, now: .now)
        List {
            Section {
                HStack(alignment: .top, spacing: 20) {
                    PracticeMetric(value: "\(streak.currentDays)", title: "Recorded day streak", symbol: "flame")
                    PracticeMetric(value: "\(streak.longestDays)", title: "Longest run", symbol: "calendar")
                }.padding(.vertical, 6)
                Text(streak.practicedToday ? "Today's practice is recorded." : streak.currentDays > 0 ? "Your run includes yesterday. Today is still open." : "No focused work recorded today. Start whenever you are ready.")
                    .font(.subheadline).foregroundStyle(.secondary)
                Text("\(PracticeRulesEngine.pluralize(streak.daysThisWeek, "practice day")) this week")
                    .font(.caption).foregroundStyle(.secondary)
            } footer: {
                Text("A recorded day has focused time or a saved repetition. Empty sessions and undone repetitions do not count. Work belongs to the session's start date in your current time zone. Reward freezes are separate from this record.")
            }
            Section {
                monthHeader
                monthGrid(totals: totals, performances: performances).padding(.vertical, 6)
                let month = calendar.dateInterval(of: .month, for: visibleMonth)
                let monthTotals = totals.values.filter { month?.contains($0.date) == true }
                Text("\(PracticeRulesEngine.pluralize(monthTotals.filter(\.hasPractice).count, "day")) · \(practiceDuration(monthTotals.reduce(0) { $0 + $1.seconds })) · \(PracticeRulesEngine.pluralize(monthTotals.reduce(0) { $0 + $1.repetitions }, "rep"))")
                    .font(.caption).foregroundStyle(.secondary)
            }.listRowBackground(Color.clear)

            Section(selectedDay.formatted(.dateTime.weekday(.wide).month().day())) {
                let daySessions = store.sessions.filter { calendar.isDate($0.startedAt, inSameDayAs: selectedDay) }
                let dayPerformances = performances.filter { calendar.isDate($0.date, inSameDayAs: selectedDay) }
                if let total = totals[calendar.startOfDay(for: selectedDay)] {
                    LabeledContent("Practiced", value: "\(practiceDuration(total.seconds)) · \(PracticeRulesEngine.pluralize(total.sessionCount, "session"))")
                    LabeledContent("Saved repetitions", value: "\(total.repetitions)")
                } else if daySessions.isEmpty {
                    Text("No practice recorded on this day.").foregroundStyle(.secondary)
                }
                ForEach(daySessions.sorted { $0.startedAt < $1.startedAt }) { session in
                    NavigationLink {
                        SessionDetailView(sessionID: session.id)
                    } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(pieceTitle(session.pieceID) ?? "Practice session").font(.headline)
                            Text("\(session.startedAt.formatted(date: .omitted, time: .shortened)) · \(practiceDuration(session.activeSeconds))")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    .accessibilityIdentifier("calendarSession_\(session.id)")
                }
                ForEach(dayPerformances) { performance in
                    Label(pieceTitle(performance.pieceID) ?? "Performance", systemImage: "star.fill")
                }
                Button("Add a performance on this day", systemImage: "star") { addingPerformanceFor = DayRoute(date: selectedDay) }
            }

            Section {
                let upcoming = performanceDays.filter { $0.date >= calendar.startOfDay(for: .now) }.sorted { $0.date < $1.date }
                if upcoming.isEmpty {
                    Text("No performance dates yet. Add one from a day above.").foregroundStyle(.secondary)
                } else {
                    ForEach(upcoming) { performance in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(pieceTitle(performance.pieceID) ?? "Performance").font(.headline)
                            Text(performance.date, format: .dateTime.month(.wide).day().year()).font(.subheadline).foregroundStyle(.secondary)
                        }.padding(.vertical, 2)
                    }
                    .onDelete { offsets in remove(upcoming, at: offsets) }
                }
            } header: {
                Text("Upcoming performances")
            }

            if let errorMessage { Section { ErrorMessage(message: errorMessage) } }
        }
        .scrollContentBackground(.hidden)
        .accessibilityIdentifier("practiceCalendarList")
        .background(PraeludeColor.paper)
        .navigationTitle("Calendar")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Today") { selectedDay = calendar.startOfDay(for: .now); visibleMonth = selectedDay }
            }
        }
        .sheet(item: $addingPerformanceFor) { route in AddPerformanceView(date: route.date) }
    }

    private var weekdaySymbols: [String] {
        let symbols = calendar.veryShortWeekdaySymbols
        let shift = min(max(0, calendar.firstWeekday - 1), symbols.count - 1)
        return Array(symbols[shift...] + symbols[..<shift])
    }

    private var monthHeader: some View {
        HStack {
            Button { changeMonth(-1) } label: { Image(systemName: "chevron.left").frame(width: 44, height: 44) }
                .accessibilityLabel("Previous month")
            Spacer()
            Text(visibleMonth, format: .dateTime.month(.wide).year()).font(.headline)
            Spacer()
            Button { changeMonth(1) } label: { Image(systemName: "chevron.right").frame(width: 44, height: 44) }
                .accessibilityLabel("Next month")
        }
    }

    private var monthDays: [Date?] {
        guard let range = calendar.range(of: .day, in: .month, for: visibleMonth),
              let firstOfMonth = calendar.date(from: calendar.dateComponents([.year, .month], from: visibleMonth)) else { return [] }
        let firstWeekday = calendar.component(.weekday, from: firstOfMonth)
        let leading = (firstWeekday - calendar.firstWeekday + 7) % 7
        var days: [Date?] = Array(repeating: nil, count: leading)
        for day in range {
            if let date = calendar.date(byAdding: .day, value: day - 1, to: firstOfMonth) { days.append(date) }
        }
        while days.count % 7 != 0 { days.append(nil) }
        return days
    }

    private func monthGrid(totals: [Date: PracticeCalendarStats.DayTotal], performances: [PracticeCalendarStats.PerformanceDay]) -> some View {
        let columns = Array(repeating: GridItem(.flexible(), spacing: 4), count: 7)
        let performanceDates = Set(performances.map(\.date))
        let maxSeconds = max(60, totals.values.map(\.seconds).max() ?? 0)
        return LazyVGrid(columns: columns, spacing: 6) {
            // Indexed, not `id: \.self`: `veryShortWeekdaySymbols` repeats letters (S/T), which
            // would give ForEach non-unique ids for a plain string identity.
            ForEach(Array(weekdaySymbols.enumerated()), id: \.offset) { _, symbol in
                Text(symbol).font(.caption2).foregroundStyle(.secondary)
            }
            ForEach(Array(monthDays.enumerated()), id: \.offset) { _, day in
                if let day { dayCell(day, total: totals[day], hasPerformance: performanceDates.contains(day), maxSeconds: maxSeconds) }
                else { Color.clear.frame(height: 44) }
            }
        }
    }

    private func dayCell(_ day: Date, total: PracticeCalendarStats.DayTotal?, hasPerformance: Bool, maxSeconds: Double) -> some View {
        let seconds = total?.seconds ?? 0
        let hasPractice = total?.hasPractice ?? false
        let isSelected = calendar.isDate(day, inSameDayAs: selectedDay)
        let isToday = calendar.isDateInToday(day)
        return Button { selectedDay = calendar.startOfDay(for: day) } label: {
            VStack(spacing: 3) {
                Text("\(calendar.component(.day, from: day))")
                    .font(.subheadline.monospacedDigit()).fontWeight(isToday ? .bold : .regular)
                    .foregroundStyle(PraeludeColor.ink)
                Circle()
                    .fill(hasPractice ? PraeludeColor.ink.opacity(min(1, 0.25 + 0.75 * seconds / maxSeconds)) : Color.clear)
                    .frame(width: 5, height: 5)
                Image(systemName: "star.fill").font(.system(size: 7)).foregroundStyle(PraeludeColor.inkSecondary)
                    .opacity(hasPerformance ? 1 : 0)
            }
            .frame(maxWidth: .infinity, minHeight: 44)
            .background(isSelected ? PraeludeColor.inkFillQuiet : Color.clear, in: RoundedRectangle(cornerRadius: PraeludeRadius.tight))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(day.formatted(.dateTime.weekday(.wide).month().day()))
        .accessibilityValue(hasPractice ? "\(practiceDuration(seconds)), \(total?.repetitions ?? 0) repetitions" : "No practice")
    }

    private func changeMonth(_ delta: Int) {
        if let next = calendar.date(byAdding: .month, value: delta, to: visibleMonth) { visibleMonth = next }
    }

    private func pieceTitle(_ id: UUID) -> String? { store.state.pieces.first { $0.id == id }?.title }

    private func remove(_ list: [PracticeCalendarStats.PerformanceDay], at offsets: IndexSet) {
        for index in offsets {
            let performance = list[index]
            guard let piece = store.state.pieces.first(where: { $0.id == performance.pieceID }) else { continue }
            var updated = piece
            updated.performanceDates.removeAll { calendar.isDate($0, inSameDayAs: performance.date) }
            updated.updatedAt = Date()
            do { try store.updatePiece(updated) } catch { errorMessage = error.localizedDescription }
        }
    }
}

private struct DayRoute: Identifiable { let date: Date; var id: TimeInterval { date.timeIntervalSince1970 } }

private struct AddPerformanceView: View {
    @Environment(PracticeStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let date: Date
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            List {
                let pieces = store.realPieces.filter { $0.status != .resting }.sorted { $0.title < $1.title }
                if pieces.isEmpty {
                    Text("Add a piece first.").foregroundStyle(.secondary)
                } else {
                    ForEach(pieces) { piece in
                        Button(piece.title) { add(to: piece) }.frame(minHeight: 44)
                    }
                }
                if let errorMessage { ErrorMessage(message: errorMessage) }
            }
            .navigationTitle("Performance on \(date.formatted(.dateTime.month(.abbreviated).day()))")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
    }

    private func add(to piece: Piece) {
        do {
            var updated = piece
            updated.performanceDates.append(date)
            updated.updatedAt = Date()
            try store.updatePiece(updated)
            dismiss()
        } catch { errorMessage = error.localizedDescription }
    }
}
