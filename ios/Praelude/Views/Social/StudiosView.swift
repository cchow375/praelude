import SwiftUI

/// Studios/groups with shared goals (spec §5b) — a teacher's or ensemble's shared space. Membership
/// itself (adding/removing people) is owner-only server-side (`add_studio_member`/
/// `remove_studio_member`); goals are addable by any member.
struct StudiosView: View {
    @Environment(SocialService.self) private var social
    @State private var studios: [StudioRow] = []
    @State private var loading = true
    @State private var showCreate = false
    @State private var newName = ""

    var body: some View {
        List {
            if studios.isEmpty, !loading {
                PraeludeEmptyState(title: "No studios yet", symbol: "person.3", message: "Start one for a teacher's studio or an ensemble to share goals and repertoire.",
                                    actionTitle: "New studio") { showCreate = true }
                    .listRowBackground(Color.clear)
            }
            ForEach(studios) { studio in
                NavigationLink(studio.name) { StudioDetailView(studio: studio) }
            }
        }
        .scrollContentBackground(.hidden)
        .background(PraeludeColor.paper)
        .navigationTitle("Studios")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .primaryAction) { Button { showCreate = true } label: { Image(systemName: "plus") }.accessibilityLabel("New studio") } }
        .task { await load() }
        .alert("New studio", isPresented: $showCreate) {
            TextField("Name", text: $newName)
            Button("Create") { Task { await create() } }.disabled(newName.trimmingCharacters(in: .whitespaces).isEmpty)
            Button("Cancel", role: .cancel) { newName = "" }
        }
    }
    private func load() async { loading = true; studios = await social.myStudios(); loading = false }
    private func create() async {
        let name = newName; newName = ""
        guard await social.createStudio(name: name) != nil else { return }
        await load()
    }
}

private struct StudioDetailView: View {
    let studio: StudioRow
    @Environment(SocialService.self) private var social
    @State private var members: [StudioMemberRow] = []
    @State private var memberCards: [UUID: ProfileCard] = [:]
    @State private var goals: [StudioGoalRow] = []
    @State private var showAddGoal = false
    @State private var goalTitle = ""
    @State private var goalDate = Date().addingTimeInterval(30 * 86_400)
    @State private var showAddMember = false
    @State private var memberQuery = ""
    @State private var memberResults: [ProfileSearchResult] = []

    var body: some View {
        List {
            Section("Goals") {
                if goals.isEmpty { Text("No shared goals yet.").foregroundStyle(PraeludeColor.inkSecondary) }
                ForEach(goals) { goal in
                    HStack {
                        Text(goal.title)
                        Spacer()
                        if let date = goal.targetDate { Text(date.formatted(date: .abbreviated, time: .omitted)).font(.caption).foregroundStyle(PraeludeColor.inkTertiary) }
                    }
                }
                Button("Add goal") { showAddGoal = true }
            }
            Section("Members") {
                ForEach(members, id: \.memberID) { member in
                    HStack {
                        AvatarView(photoPath: memberCards[member.memberID]?.photoPath, fallbackText: memberCards[member.memberID]?.displayNameOrUsernameOrFallback ?? "?", size: 32)
                        Text(memberCards[member.memberID]?.displayNameOrUsernameOrFallback ?? "Loading…")
                        Spacer()
                        if member.role == "owner" { Text("Owner").font(.caption).foregroundStyle(PraeludeColor.inkTertiary) }
                    }
                }
                Button("Add member") { showAddMember = true }
            }
        }
        .scrollContentBackground(.hidden)
        .background(PraeludeColor.paper)
        .navigationTitle(studio.name)
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .alert("Add goal", isPresented: $showAddGoal) {
            TextField("Goal", text: $goalTitle)
            Button("Add") { Task { await addGoal() } }.disabled(goalTitle.trimmingCharacters(in: .whitespaces).isEmpty)
            Button("Cancel", role: .cancel) { goalTitle = "" }
        }
        .sheet(isPresented: $showAddMember) { addMemberSheet }
    }
    private var addMemberSheet: some View {
        NavigationStack {
            List {
                Section { TextField("Search by username", text: $memberQuery).textInputAutocapitalization(.never) }
                ForEach(memberResults) { result in
                    Button(result.displayName ?? "@\(result.username)") { Task { await addMember(result.id) } }
                }
            }
            .navigationTitle("Add member").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { showAddMember = false } } }
            .onChange(of: memberQuery) { _, query in Task { memberResults = await social.searchProfiles(query: query) } }
        }
        .presentationDetents([.medium])
    }
    private func load() async {
        async let m = social.studioMembers(studio.id)
        async let g = social.studioGoals(studio.id)
        members = await m
        goals = await g
        for member in members where memberCards[member.memberID] == nil {
            if let card = await social.profileCard(for: member.memberID) { memberCards[member.memberID] = card }
        }
    }
    private func addGoal() async {
        let title = goalTitle; goalTitle = ""
        guard await social.addStudioGoal(studioID: studio.id, title: title, targetDate: goalDate) else { return }
        goals = await social.studioGoals(studio.id)
    }
    private func addMember(_ id: UUID) async {
        guard await social.addStudioMember(studioID: studio.id, userID: id) else { return }
        showAddMember = false; memberQuery = ""; memberResults = []
        await load()
    }
}
