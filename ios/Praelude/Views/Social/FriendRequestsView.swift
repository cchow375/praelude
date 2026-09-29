import SwiftUI

/// Incoming requests to accept/decline, and outgoing ones still pending (spec §5b). Accepting a
/// private account's own outgoing/incoming distinction is unchanged here — "private account approves
/// followers" is exactly the ordinary accept/decline flow (`supabase/(C) Backend.md`: a private
/// account doesn't change the request mechanics, only default content visibility).
struct FriendRequestsView: View {
    @Environment(SocialService.self) private var social
    @State private var incoming: [FriendshipRow] = []
    @State private var outgoing: [FriendshipRow] = []
    @State private var cards: [UUID: ProfileCard] = [:]
    @State private var loading = true

    var body: some View {
        List {
            Section {
                if incoming.isEmpty, !loading { Text("No pending requests.").foregroundStyle(PraeludeColor.inkSecondary) }
                ForEach(incoming, id: \.requesterID) { row in
                    HStack {
                        AvatarView(photoPath: cards[row.requesterID]?.photoPath, fallbackText: cards[row.requesterID]?.displayNameOrUsernameOrFallback ?? "?", size: 40)
                        Text(cards[row.requesterID]?.displayNameOrUsernameOrFallback ?? "Praelude musician")
                        Spacer()
                        Button("Decline") { Task { await respond(row.requesterID, accept: false) } }.buttonStyle(.praeludeQuiet).fixedSize()
                        Button("Accept") { Task { await respond(row.requesterID, accept: true) } }.buttonStyle(.praeludePrimary).fixedSize()
                    }
                }
            } header: { Text("Requests") }

            if !outgoing.isEmpty {
                Section {
                    ForEach(outgoing, id: \.addresseeID) { row in
                        HStack {
                            AvatarView(photoPath: cards[row.addresseeID]?.photoPath, fallbackText: cards[row.addresseeID]?.displayNameOrUsernameOrFallback ?? "?", size: 40)
                            Text(cards[row.addresseeID]?.displayNameOrUsernameOrFallback ?? "Praelude musician")
                            Spacer()
                            Text("Waiting").font(.caption).foregroundStyle(PraeludeColor.inkTertiary)
                        }
                    }
                } header: { Text("Sent") }
            }
        }
        .scrollContentBackground(.hidden)
        .background(PraeludeColor.paper)
        .navigationTitle("Requests")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
    }
    private func load() async {
        loading = true
        (incoming, outgoing) = await social.pendingFriendRequests()
        for row in incoming + outgoing {
            let id = row.requesterID == social.myUserID ? row.addresseeID : row.requesterID
            if cards[id] == nil, let card = await social.profileCard(for: id) { cards[id] = card }
        }
        loading = false
    }
    private func respond(_ requesterID: UUID, accept: Bool) async {
        guard await social.respondToFriendRequest(from: requesterID, accept: accept) else { return }
        incoming.removeAll { $0.requesterID == requesterID }
    }
}
