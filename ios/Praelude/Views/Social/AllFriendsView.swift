import SwiftUI

/// The full friend grid (spec §5a "friend cards": photo, name, instrument, streak; "current
/// practice" is presence, surfaced separately — see the type doc comment on `PresenceService` for
/// why a specific piece title isn't shown for a friend, only that they are practicing).
struct AllFriendsView: View {
    @Environment(SocialService.self) private var social
    @State private var friends: [ProfileCard] = []
    @State private var loading = true
    @State private var openFriend: ProfileCard?

    private let columns = [GridItem(.adaptive(minimum: 150), spacing: 12)]

    var body: some View {
        ScrollView {
            if friends.isEmpty, !loading {
                PraeludeEmptyState(title: "No friends yet", symbol: "person.2", message: "Search by username or share an invite link to add your first friend.")
                    .padding(.top, 40)
            }
            LazyVGrid(columns: columns, spacing: 12) {
                ForEach(friends) { card in
                    Button { openFriend = card } label: { FriendCard(card: card) }.buttonStyle(.plain)
                }
            }
            .padding(16)
        }
        .background(PraeludeColor.paper)
        .navigationTitle("Friends")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
        .sheet(item: $openFriend) { card in FriendDetailSheet(card: card) }
    }
    private func load() async { loading = true; friends = await social.friendCards(); loading = false }
}

private struct FriendCard: View {
    let card: ProfileCard
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            AvatarView(photoPath: card.photoPath, fallbackText: card.displayNameOrUsernameOrFallback, size: 56)
            Text(card.displayNameOrUsernameOrFallback).font(.subheadline.weight(.semibold)).foregroundStyle(PraeludeColor.ink).lineLimit(1)
            if let instrument = card.instruments?.first(where: { $0.is_primary })?.coreValue ?? card.instruments?.first?.coreValue {
                Text(instrument.name.isEmpty ? instrument.family.rawValue.capitalized : instrument.name).font(.caption).foregroundStyle(PraeludeColor.inkSecondary).lineLimit(1)
            }
            if let streak = card.stats?.streakDays, streak > 0 {
                Label("\(streak) day streak", systemImage: "flame").font(.caption).foregroundStyle(PraeludeColor.inkTertiary).labelStyle(.titleAndIcon)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .praeludeCard()
    }
}

private struct FriendDetailSheet: View {
    let card: ProfileCard
    @Environment(SocialService.self) private var social
    @Environment(\.dismiss) private var dismiss
    @State private var repertoire: [SharedRepertoireItem] = []
    @State private var confirmUnfriend = false
    @State private var confirmBlock = false
    @State private var showReport = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack(spacing: 14) {
                        AvatarView(photoPath: card.photoPath, fallbackText: card.displayNameOrUsernameOrFallback, size: 60)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(card.displayNameOrUsernameOrFallback).font(.title3.weight(.semibold))
                            if let username = card.username { Text("@\(username)").font(.subheadline).foregroundStyle(PraeludeColor.inkSecondary) }
                        }
                    }
                    if let bio = card.bio, !bio.isEmpty { Text(bio) }
                }
                if let stats = card.stats {
                    Section("Stats") {
                        LabeledContent("Streak", value: "\(stats.streakDays) days")
                        LabeledContent("Rank", value: "\(stats.rank) · Division \(stats.division)")
                        LabeledContent("Performance-ready pieces", value: "\(stats.piecesPerformanceReady)")
                    }
                }
                if !repertoire.isEmpty {
                    Section("Shared repertoire") {
                        ForEach(repertoire) { item in
                            VStack(alignment: .leading) { Text(item.title); Text(item.composer).font(.caption).foregroundStyle(PraeludeColor.inkSecondary) }
                        }
                    }
                }
                Section {
                    Button("Unfriend", role: .destructive) { confirmUnfriend = true }
                    Button("Block", role: .destructive) { confirmBlock = true }
                    Button("Report") { showReport = true }
                }
            }
            .scrollContentBackground(.hidden)
            .background(PraeludeColor.paper)
            .navigationTitle("Friend").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
        }
        .task { repertoire = await social.sharedRepertoire(with: card.id) }
        .confirmationDialog("Unfriend \(card.displayNameOrUsernameOrFallback)?", isPresented: $confirmUnfriend, titleVisibility: .visible) {
            Button("Unfriend", role: .destructive) { Task { _ = await social.unfriend(card.id); dismiss() } }
        }
        .confirmationDialog("Block \(card.displayNameOrUsernameOrFallback)?", isPresented: $confirmBlock, titleVisibility: .visible) {
            Button("Block", role: .destructive) { Task { _ = await social.blockUser(card.id); dismiss() } }
        } message: { Text("They won't see your activity, presence, or notes, and you won't see theirs. This also removes the friendship.") }
        .sheet(isPresented: $showReport) { ReportSheet(targetType: .user, targetID: card.id) }
        .presentationDetents([.medium, .large])
    }
}
