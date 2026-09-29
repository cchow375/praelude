import SwiftUI

/// Friends-only weekly leaderboard (spec §5b), opt-out via `ProfileEditView`'s existing
/// "Opt out of leaderboards" toggle. "This week" resets Monday 00:00 UTC — the same fixed boundary
/// `leaderboard_friends()` uses, so every friend's standing compares the same window.
struct LeaderboardView: View {
    @Environment(SocialService.self) private var social
    @State private var metric = LeaderboardMetric.time
    @State private var rows: [LeaderboardRow] = []
    @State private var loading = true

    var body: some View {
        List {
            Section {
                Picker("Metric", selection: $metric) {
                    ForEach(LeaderboardMetric.allCases, id: \.self) { Text($0.label).tag($0) }
                }
                .pickerStyle(.segmented).labelsHidden()
            }
            .listRowBackground(Color.clear)

            if rows.isEmpty, !loading {
                PraeludeEmptyState(title: "Nobody here yet", symbol: "list.number", message: "Add a friend to see how this week compares. Anyone who opted out of leaderboards is left off.")
                    .listRowBackground(Color.clear)
            }
            ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                HStack(spacing: 12) {
                    Text("\(index + 1)").praeludeNumeral(18).foregroundStyle(PraeludeColor.inkTertiary).frame(width: 24, alignment: .trailing)
                    AvatarView(photoPath: nil, fallbackText: row.displayName ?? row.username ?? "?", size: 34)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(row.isYou ? "You" : (row.displayName ?? row.username ?? "Praelude musician")).fontWeight(row.isYou ? .semibold : .regular)
                        Text(subtitle(row)).font(.caption).foregroundStyle(PraeludeColor.inkSecondary)
                    }
                    Spacer()
                    Text(headline(row)).praeludeNumeral(17)
                }
                .listRowBackground(row.isYou ? PraeludeColor.inkFillQuiet : Color.clear)
            }
        }
        .scrollContentBackground(.hidden)
        .background(PraeludeColor.paper)
        .navigationTitle("Leaderboard")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: metric) { await load() }
    }
    private func headline(_ row: LeaderboardRow) -> String {
        switch metric {
        case .time: practiceDuration(row.totalSeconds)
        case .days: "\(row.practiceDays)"
        case .reviews: "\(row.reviewsDone)"
        }
    }
    private func subtitle(_ row: LeaderboardRow) -> String {
        switch metric {
        case .time: "\(row.practiceDays) days · \(row.reviewsDone) reviews"
        case .days: "\(practiceDuration(row.totalSeconds)) · \(row.reviewsDone) reviews"
        case .reviews: "\(practiceDuration(row.totalSeconds)) · \(row.practiceDays) days"
        }
    }
    private func load() async {
        loading = true
        rows = await social.leaderboard(metric: metric)
        loading = false
    }
}
