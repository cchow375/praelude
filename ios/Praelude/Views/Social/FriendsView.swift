import SwiftUI

/// The Friends tab (spec §5a): "practicing now" live strip, Notes, and the activity feed — the three
/// things spec §5a asks to be visible without navigating anywhere else. Search, requests, studios,
/// leaderboard and safety settings are one tap away from the toolbar (spec §5b/§5c), not crowded
/// onto this screen.
struct FriendsView: View {
    @Environment(AuthManager.self) private var auth
    @Environment(SocialService.self) private var social
    @Environment(PresenceService.self) private var presence

    @State private var feed: [ActivityEvent] = []
    @State private var notes: [NoteRow] = []
    @State private var friendCards: [UUID: ProfileCard] = [:]
    @State private var practicingFriends: [ProfileCard] = []
    @State private var loading = true
    @State private var openEvent: ActivityEvent?
    @State private var openNote: NoteRow?
    @State private var composeNote = false
    @State private var incomingRequestCount = 0
    @State private var showDeveloperContact = false

    var body: some View {
        NavigationStack {
            Group {
                switch auth.state {
                case .guest, .authenticating: signedOutState
                case .signedIn: signedInContent
                }
            }
            .navigationTitle("Friends")
            .toolbar { toolbarContent }
        }
        .sheet(isPresented: $composeNote) { NoteComposeView() }
        .sheet(item: $openEvent) { event in ActivityDetailSheet(event: event, authorCard: friendCards[event.ownerID]) }
        .sheet(item: $openNote) { note in NoteDetailSheet(note: note, authorCard: friendCards[note.ownerID]) }
        .sheet(isPresented: $showDeveloperContact) { ReportSheet(targetType: .developerContact, targetID: nil) }
    }

    @ViewBuilder private var signedOutState: some View {
        VStack(spacing: 20) {
            Spacer()
            PraeludeEmptyState(
                title: "Friends need an account",
                symbol: "person.2",
                message: "Sign in or create a free account to add friends, share your progress, and see who's practicing right now. Your local practice stays exactly as it is either way.")
            NavigationLink("Account and sync") { AccountView() }.buttonStyle(.praeludePrimary).frame(maxWidth: 320)
            Spacer()
        }
        .padding(24)
    }

    @ViewBuilder private var signedInContent: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if !practicingFriends.isEmpty {
                    section("Practicing now") {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 14) {
                                ForEach(practicingFriends) { card in
                                    VStack(spacing: 6) {
                                        ZStack(alignment: .bottomTrailing) {
                                            AvatarView(photoPath: card.photoPath, fallbackText: card.displayNameOrUsernameOrFallback, size: 52)
                                            Circle().fill(PraeludeColor.live).frame(width: 13, height: 13)
                                                .overlay(Circle().stroke(PraeludeColor.paper, lineWidth: 2))
                                        }
                                        Text((card.displayNameOrUsernameOrFallback).components(separatedBy: " ").first ?? "")
                                            .font(.caption2).foregroundStyle(PraeludeColor.inkSecondary).lineLimit(1)
                                    }
                                }
                            }.padding(.horizontal, 16)
                        }
                    }
                }

                section("Notes") {
                    NotesStrip(notes: notes, cards: friendCards, onCompose: { composeNote = true }, onOpen: { openNote = $0 })
                }

                section("Activity") {
                    if feed.isEmpty, !loading {
                        Text("Nothing yet. Add a friend to see their progress here.")
                            .font(.subheadline).foregroundStyle(PraeludeColor.inkSecondary)
                            .padding(.horizontal, 16)
                    }
                    LazyVStack(spacing: 0) {
                        ForEach(feed) { event in
                            ActivityFeedRow(event: event, authorCard: friendCards[event.ownerID], onOpen: { openEvent = event })
                                .padding(.horizontal, 16)
                            Divider().overlay(PraeludeColor.hairline).padding(.leading, 68)
                        }
                    }
                }
            }
            .padding(.vertical, 12)
        }
        .background(PraeludeColor.paper)
        .refreshable { await load() }
        .task { await load() }
    }

    @ViewBuilder private func section(_ title: String, @ViewBuilder content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.headline).padding(.horizontal, 16)
            content()
        }
    }

    @ToolbarContentBuilder private var toolbarContent: some ToolbarContent {
        if case .signedIn = auth.state {
            ToolbarItem(placement: .topBarLeading) {
                NavigationLink { FriendRequestsView() } label: {
                    ZStack(alignment: .topTrailing) {
                        Image(systemName: "person.crop.circle.badge.plus")
                        if incomingRequestCount > 0 {
                            Circle().fill(PraeludeColor.live).frame(width: 8, height: 8).offset(x: 4, y: -2)
                        }
                    }
                }.accessibilityLabel("Friend requests")
            }
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    NavigationLink("Find friends") { FriendSearchView() }
                    NavigationLink("All friends") { AllFriendsView() }
                    NavigationLink("Studios") { StudiosView() }
                    NavigationLink("Leaderboard") { LeaderboardView() }
                    Divider()
                    NavigationLink("Blocked accounts") { BlockedUsersView() }
                    Button("Contact developer") { showDeveloperContact = true }
                } label: { Image(systemName: "ellipsis.circle") }.accessibilityLabel("More")
            }
        }
    }

    private func load() async {
        loading = true
        async let feedTask = social.friendActivityFeed()
        async let notesTask = social.friendNotes()
        async let friendsTask = social.friendCards()
        async let presenceTask = social.friendPresence()
        async let requestsTask = social.pendingFriendRequests()
        let (fetchedFeed, fetchedNotes, fetchedFriends, fetchedPresence, requests) =
            await (feedTask, notesTask, friendsTask, presenceTask, requestsTask)

        feed = fetchedFeed
        notes = fetchedNotes
        for card in fetchedFriends { friendCards[card.id] = card }
        incomingRequestCount = requests.incoming.count

        let liveIDs = fetchedFriends.map(\.id)
        presence.observe(friendIDs: liveIDs)
        let practicingIDs = Set(fetchedPresence.filter(\.isCurrentlyPracticing).map(\.ownerID))
            .union(presence.livePracticing.filter(\.value).map(\.key))
        practicingFriends = fetchedFriends.filter { practicingIDs.contains($0.id) }
        loading = false
    }
}
