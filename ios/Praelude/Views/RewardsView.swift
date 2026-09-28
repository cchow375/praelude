import SwiftUI

/// Rank/division, coins, streak, the Studio trophy case, badges, and milestone history with a
/// manual share hook (§14). All figures are derived read-only from `store.state` via
/// `RewardsEngine`/`StudioCatalog` — nothing here mutates the reward ledger; `RewardsRuntime`
/// (wired from `AppRootView`) is the only writer.
struct RewardsView: View {
    @Environment(PracticeStore.self) private var store

    private var totalXP: Int { store.state.rewardLedger.reduce(0) { $0 + $1.xpDelta } }
    private var totalCoins: Int { store.state.rewardLedger.reduce(0) { $0 + $1.coinsDelta } }
    private var rankProgress: RewardsEngine.RankProgress { RewardsEngine.rankProgress(totalXP: totalXP) }
    private var streakDays: Int { RewardsEngine.currentStreakDisplay(store.state.rewardsState) }

    var body: some View {
        List {
            Section { header }.listRowBackground(Color.clear).listRowSeparator(.hidden)
            studioSection
            badgesSection
            milestonesSection
        }
        .scrollContentBackground(.hidden)
        .background(PraeludeColor.paper)
        .navigationTitle("Rewards")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var header: some View {
        VStack(spacing: 16) {
            VStack(spacing: 3) {
                Text(rankProgress.rankName).praeludeDisplay(32)
                Text("Division \(rankProgress.division)").font(.subheadline).foregroundStyle(PraeludeColor.inkSecondary)
            }
            SwiftUI.ProgressView(value: Double(rankProgress.divisionXP), total: Double(max(1, rankProgress.divisionXPRequired)))
                .tint(PraeludeColor.ink).frame(maxWidth: 280)
                .accessibilityLabel("\(rankProgress.divisionXP) of \(rankProgress.divisionXPRequired) experience toward the next division")
            HStack(spacing: 30) {
                statTile(glyph: .coin, value: "\(totalCoins)", label: "Coins")
                statTile(glyph: .streak, value: "\(streakDays)", label: streakDays == 1 ? "Day streak" : "Day streak")
                statTile(glyph: .rank, value: "\(rankProgress.rank)", label: "Rank")
            }
            if store.state.rewardsState.streakFreezesAvailable > 0 {
                let count = store.state.rewardsState.streakFreezesAvailable
                Text("\(count) streak freeze\(count == 1 ? "" : "s") available").font(.caption).foregroundStyle(PraeludeColor.inkSecondary)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 18)
        .accessibilityElement(children: .combine)
    }

    private func statTile(glyph: PraeludeGlyph, value: String, label: String) -> some View {
        VStack(spacing: 6) {
            PraeludeIcon(glyph: glyph, size: 19).foregroundStyle(PraeludeColor.inkSecondary)
            Text(value).praeludeNumeral(22)
            Text(label).font(.caption).foregroundStyle(PraeludeColor.inkSecondary)
        }
    }

    private var studioSection: some View {
        Section {
            ForEach(StudioSlot.allCases, id: \.self) { slot in
                if let item = StudioCatalog.bestUnlocked(lifetimeCoins: totalCoins, rank: rankProgress.rank)[slot] {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(slot.title).font(.caption.weight(.medium)).foregroundStyle(PraeludeColor.inkSecondary)
                        Text(item.name).font(.headline)
                        Text(item.description).font(.subheadline).foregroundStyle(PraeludeColor.inkSecondary)
                        if let next = StudioCatalog.nextLocked(in: slot, lifetimeCoins: totalCoins, rank: rankProgress.rank) {
                            Text(nextHint(next)).font(.caption).foregroundStyle(PraeludeColor.inkTertiary)
                        }
                    }.padding(.vertical, 4)
                }
            }
        } header: {
            Text("Studio")
        } footer: {
            Text("Furnishings unlock automatically as your lifetime coins and rank grow — nothing to buy or lose.")
        }
    }

    private func nextHint(_ item: StudioItem) -> String {
        if rankProgress.rank < item.unlockRank { return "Next: \(item.name), at rank \(item.unlockRank)." }
        let coinsNeeded = max(0, item.price - totalCoins)
        return "Next: \(item.name) — \(coinsNeeded) more coin\(coinsNeeded == 1 ? "" : "s")."
    }

    private var badgesSection: some View {
        Section("Badges") {
            ForEach(RewardsEngine.badgeCatalog, id: \.key) { definition in
                let earned = store.state.badges.first { $0.key == definition.key }
                HStack(spacing: 12) {
                    PraeludeIcon(glyph: .badge, size: 22).foregroundStyle(earned != nil ? PraeludeColor.ink : PraeludeColor.inkTertiary)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(definition.title).font(.headline).foregroundStyle(earned != nil ? PraeludeColor.ink : PraeludeColor.inkTertiary)
                        Text(definition.detail).font(.subheadline).foregroundStyle(PraeludeColor.inkSecondary)
                    }
                    Spacer()
                    if let earned {
                        Text(earned.earnedAt, format: .dateTime.month(.abbreviated).day()).font(.caption).foregroundStyle(PraeludeColor.inkTertiary)
                    }
                }
                .padding(.vertical, 3)
                .opacity(earned != nil ? 1 : 0.55)
                .accessibilityElement(children: .combine)
            }
        }
    }

    private var milestonesSection: some View {
        Section("Milestones") {
            let events = store.state.milestoneEvents.sorted { $0.date > $1.date }.prefix(30)
            if events.isEmpty {
                Text("Big moments — a performance-ready passage, a new rank, a streak milestone — show up here.")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(Array(events)) { event in
                    HStack(alignment: .top, spacing: 10) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(MilestoneShareCard.text(for: event)).font(.subheadline)
                            Text(event.date, format: .dateTime.month(.abbreviated).day().year()).font(.caption).foregroundStyle(PraeludeColor.inkTertiary)
                        }
                        Spacer()
                        ShareLink(item: MilestoneShareCard.text(for: event)) {
                            Image(systemName: "square.and.arrow.up").frame(width: 44, height: 44).contentShape(Rectangle())
                        }.accessibilityLabel("Share milestone")
                    }
                }
            }
        }
    }
}
