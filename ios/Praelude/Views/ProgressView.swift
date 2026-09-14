import SwiftUI

struct PracticeProgressView: View {
    @Environment(PracticeStore.self) private var store
    @State private var showCalendar = false

    private var sessions: [PracticeSession] { store.sessions.sorted { $0.startedAt > $1.startedAt } }
    private var progress: PracticeProgress { store.progress }

    var body: some View {
        List {
            if sessions.isEmpty {
                PraeludeEmptyState(title: "No practice recorded", symbol: "chart.bar.xaxis",
                                  message: "Your time, repetitions, and completed sets will appear here as you practice.")
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            } else {
                Section {
                    HStack(alignment: .top, spacing: 20) {
                        PracticeMetric(value: practiceDuration(progress.activeSeconds), title: "Focused time", symbol: "clock")
                        PracticeMetric(value: "\(progress.practicedDays)", title: "Practice days", symbol: "calendar")
                    }
                    .padding(.vertical, 8)
                    HStack(alignment: .top, spacing: 20) {
                        PracticeMetric(value: "\(progress.totalAttempts)", title: "Repetitions", symbol: "repeat")
                        PracticeMetric(value: "\(progress.completedSets)", title: "Completed sets", symbol: "checkmark.circle")
                    }
                    .padding(.vertical, 8)
                } header: {
                    Text("Your practice record")
                } footer: {
                    Text("This is the work you recorded. It measures commitment, not musical ability.")
                }

                Section("This week") {
                    WeekPracticeView(sessions: sessions)
                        .padding(.vertical, 10)
                }

                Section {
                    VStack(alignment: .leading, spacing: 10) {
                        HStack(alignment: .firstTextBaseline) {
                            Text("Level \(max(0, progress.xp) / 100 + 1)").font(.headline)
                            Spacer()
                            Text("\(progress.xp) XP").font(.subheadline.monospacedDigit()).foregroundStyle(.secondary)
                        }
                        SwiftUI.ProgressView(value: Double(max(0, progress.xp) % 100), total: 100)
                            .accessibilityLabel("Practice level progress")
                            .accessibilityValue("\(max(0, progress.xp) % 100) of 100 experience points")
                        Text("\(100 - max(0, progress.xp) % 100) XP to your next level")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 5)
                } header: {
                    Text("Practice level")
                } footer: {
                    Text("Focused time and completed sets earn XP. Native practice levels advance every 100 XP; they are separate from the Mac Studio.")
                }

                Section("Sessions") {
                    ForEach(sessions) { session in
                        NavigationLink {
                            SessionDetailView(sessionID: session.id)
                        } label: {
                            VStack(alignment: .leading, spacing: 6) {
                                HStack(alignment: .firstTextBaseline) {
                                    Text(pieceTitle(session.pieceID)).font(.headline).lineLimit(2)
                                    Spacer(minLength: 12)
                                    Text(practiceDuration(session.activeSeconds))
                                        .font(.subheadline.monospacedDigit()).foregroundStyle(.secondary)
                                }
                                HStack(spacing: 5) {
                                    Text(session.startedAt, format: .dateTime.month(.abbreviated).day())
                                    Text("·")
                                    Text("\(session.attempts.count) reps")
                                    if session.endedAt == nil {
                                        Text("· Open")
                                    }
                                }
                                .font(.subheadline).foregroundStyle(.secondary)
                                if !session.focus.isEmpty {
                                    Text(session.focus).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                                }
                            }
                            .padding(.vertical, 5)
                        }
                    }
                }
            }
        }
        .navigationTitle("Progress")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Practice calendar", systemImage: "calendar") { showCalendar = true }
            }
        }
        .sheet(isPresented: $showCalendar) { PracticeCalendarView() }
    }

    private func pieceTitle(_ id: UUID) -> String {
        store.pieces.first(where: { $0.id == id })?.title ?? "Practice session"
    }
}

private struct PracticeCalendarView: View {
    @Environment(PracticeStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var selectedDate = Date.now

    private var sessions: [PracticeSession] {
        store.sessions.filter { Calendar.current.isDate($0.startedAt, inSameDayAs: selectedDate) }
            .sorted { $0.startedAt > $1.startedAt }
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    DatePicker("Practice date", selection: $selectedDate, displayedComponents: .date)
                        .datePickerStyle(.graphical)
                        .listRowInsets(EdgeInsets(top: 0, leading: 4, bottom: 0, trailing: 4))
                }
                Section(selectedDate.formatted(.dateTime.weekday(.wide).month().day())) {
                    if sessions.isEmpty {
                        Text("No practice recorded on this date.").foregroundStyle(.secondary)
                    } else {
                        HStack(alignment: .top, spacing: 20) {
                            PracticeMetric(value: practiceDuration(sessions.reduce(0) { $0 + $1.activeSeconds }),
                                           title: "Focused time")
                            PracticeMetric(value: "\(sessions.reduce(0) { $0 + $1.attempts.count })", title: "Repetitions")
                        }
                        .padding(.vertical, 8)
                        ForEach(sessions) { session in
                            NavigationLink {
                                SessionDetailView(sessionID: session.id)
                            } label: {
                                VStack(alignment: .leading, spacing: 5) {
                                    Text(store.pieces.first { $0.id == session.pieceID }?.title ?? "Practice session")
                                        .font(.headline)
                                    HStack(spacing: 6) {
                                        Text(session.startedAt, format: .dateTime.hour().minute())
                                        Text("·")
                                        Text(practiceDuration(session.activeSeconds))
                                    }
                                    .font(.subheadline).foregroundStyle(.secondary)
                                }
                                .padding(.vertical, 5)
                            }
                        }
                    }
                }
            }
            .navigationTitle("Practice calendar")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } }
            }
        }
    }
}

private struct WeekPracticeView: View {
    let sessions: [PracticeSession]
    private let calendar = Calendar.current

    private var days: [Date] {
        let today = calendar.startOfDay(for: .now)
        return (-6...0).compactMap { calendar.date(byAdding: .day, value: $0, to: today) }
    }

    private func seconds(on date: Date) -> TimeInterval {
        sessions.filter { calendar.isDate($0.startedAt, inSameDayAs: date) }
            .reduce(0) { $0 + $1.activeSeconds }
    }

    private var largest: TimeInterval { max(60, days.map { seconds(on: $0) }.max() ?? 0) }

    var body: some View {
        HStack(alignment: .bottom, spacing: 12) {
            ForEach(days, id: \.self) { day in
                VStack(spacing: 9) {
                    Spacer(minLength: 0)
                    RoundedRectangle(cornerRadius: 4)
                        .fill(seconds(on: day) > 0 ? Color.accentColor : Color.secondary.opacity(0.15))
                        .frame(height: max(3, 80 * seconds(on: day) / largest))
                    Text(day, format: .dateTime.weekday(.narrow))
                        .font(.caption)
                        .foregroundStyle(calendar.isDateInToday(day) ? .primary : .secondary)
                }
                .frame(maxWidth: .infinity)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(day.formatted(.dateTime.weekday(.wide).month().day()))
                .accessibilityValue(practiceDuration(seconds(on: day)))
            }
        }
        .frame(height: 110)
        .accessibilityLabel("Focused time in sessions started over the last seven days")
    }
}

private struct SessionDetailView: View {
    @Environment(PracticeStore.self) private var store
    let sessionID: UUID
    private var session: PracticeSession? { store.sessions.first { $0.id == sessionID } }

    var body: some View {
        List {
            if let session {
                Section {
                    LabeledContent("Piece", value: store.pieces.first { $0.id == session.pieceID }?.title ?? "Practice session")
                    LabeledContent("Started", value: session.startedAt.formatted(date: .abbreviated, time: .shortened))
                    LabeledContent("Focused time", value: practiceDuration(session.activeSeconds))
                    LabeledContent("Repetitions", value: "\(session.attempts.count)")
                    LabeledContent("Completed sets", value: "\(session.completedSets)")
                    if !session.focus.isEmpty { LabeledContent("Focus", value: session.focus) }
                }
                if !session.attempts.isEmpty {
                    Section("Recorded repetitions") {
                        ForEach(Array(session.attempts.enumerated()), id: \.element.id) { index, attempt in
                            HStack(spacing: 13) {
                                Text("\(index + 1)")
                                    .font(.subheadline.monospacedDigit()).foregroundStyle(.secondary)
                                    .frame(minWidth: 24, alignment: .trailing)
                                Label(verdictTitle(attempt.verdict), systemImage: verdictSymbol(attempt.verdict))
                                Spacer()
                                VStack(alignment: .trailing, spacing: 3) {
                                    Text("\(Int(attempt.bpm)) bpm").font(.subheadline.monospacedDigit())
                                    Text(attempt.date, format: .dateTime.hour().minute())
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                            }
                            .padding(.vertical, 3)
                            .accessibilityElement(children: .combine)
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

    private func verdictTitle(_ verdict: Verdict) -> String {
        switch verdict {
        case .clean: "Clean"
        case .sloppy: "Sloppy"
        case .again: "Again"
        case .reset: "Reset"
        }
    }

    private func verdictSymbol(_ verdict: Verdict) -> String {
        switch verdict {
        case .clean: "checkmark.circle"
        case .sloppy: "minus.circle"
        case .again: "arrow.counterclockwise"
        case .reset: "arrow.uturn.backward.circle"
        }
    }
}
