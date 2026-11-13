import SwiftUI

/// One reusable report composer (spec §5c: "report user/note/comment") for any target — including
/// `.developerContact` (`targetID: nil`), the spec's separately-named "developer contact" channel,
/// which `submit_report` doubles as rather than needing its own screen.
struct ReportSheet: View {
    let targetType: ReportTargetKind
    let targetID: UUID?
    @Environment(SocialService.self) private var social
    @Environment(\.dismiss) private var dismiss
    @State private var reason = ""
    @State private var sending = false
    @State private var didSend = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField(placeholder, text: $reason, axis: .vertical).lineLimit(4...8)
                } footer: {
                    Text(targetType == .developerContact
                         ? "Goes straight to the developer. Include what happened and, if useful, when."
                         : "Reviewed by the developer. This does not notify the person you're reporting.")
                }
                if let error { Section { ErrorMessage(message: error) } }
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .disabled(sending || didSend)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(didSend ? "Sent" : "Send") { send() }
                        .disabled(reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
        .presentationDetents([.medium])
    }
    private var title: String { targetType == .developerContact ? "Contact developer" : "Report" }
    private var placeholder: String { targetType == .developerContact ? "What's going on?" : "What happened?" }
    private func send() {
        sending = true
        Task {
            let ok = await social.submitReport(targetType: targetType, targetID: targetID, reason: reason)
            sending = false
            if ok { didSend = true; try? await Task.sleep(nanoseconds: 500_000_000); dismiss() }
            else { error = social.lastError ?? "Couldn't send that. Try again." }
        }
    }
}

/// Accounts this person has blocked (spec §5c) — unblock from here; blocking itself happens from a
/// friend card or a report flow, not this list (there is no "block someone new" entry point here on
/// purpose: blocking always starts from looking at the person, never from a blind id).
struct BlockedUsersView: View {
    @Environment(SocialService.self) private var social
    @State private var blocked: [ProfileCard] = []
    @State private var loading = true

    var body: some View {
        List {
            if blocked.isEmpty, !loading {
                PraeludeEmptyState(title: "No blocked accounts", symbol: "hand.raised", message: "Anyone you block stops seeing your activity, presence, and notes, and you stop seeing theirs.")
                    .listRowBackground(Color.clear)
            }
            ForEach(blocked) { card in
                HStack {
                    AvatarView(photoPath: card.photoPath, fallbackText: card.displayNameOrUsernameOrFallback, size: 36)
                    Text(card.displayNameOrUsernameOrFallback)
                    Spacer()
                    Button("Unblock") { Task { await unblock(card.id) } }.buttonStyle(.praeludeQuiet).fixedSize()
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(PraeludeColor.paper)
        .navigationTitle("Blocked accounts")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }
    private func load() async {
        loading = true
        let ids = await social.blockedUserIDs()
        var cards: [ProfileCard] = []
        for id in ids { if let card = await social.profileCard(for: id) { cards.append(card) } }
        blocked = cards
        loading = false
    }
    private func unblock(_ id: UUID) async {
        guard await social.unblockUser(id) else { return }
        blocked.removeAll { $0.id == id }
    }
}
