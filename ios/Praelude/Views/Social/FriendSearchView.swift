import Contacts
import SwiftUI

/// Find friends (spec §5b): username search, invite link + QR + scanner, opt-in contacts
/// suggestions. Three independent ways in — none required for any other one to work.
struct FriendSearchView: View {
    @Environment(SocialService.self) private var social
    @Environment(AuthManager.self) private var auth
    @State private var query = ""
    @State private var results: [ProfileSearchResult] = []
    @State private var sentTo: Set<UUID> = []
    @State private var inviteCode: String?
    @State private var showScanner = false
    @State private var redeemedName: String?
    @State private var error: String?

    @State private var contactsEnabled = false
    @State private var contactSuggestions: [ProfileSearchResult] = []
    @State private var loadingContacts = false

    var body: some View {
        List {
            Section {
                TextField("Search by username", text: $query)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                ForEach(results) { result in
                    HStack {
                        Text(result.displayName ?? "@\(result.username)")
                        Text("@\(result.username)").font(.caption).foregroundStyle(PraeludeColor.inkTertiary)
                        Spacer()
                        requestButton(for: result.id)
                    }
                }
            } header: { Text("Search") }

            Section {
                if let inviteCode {
                    VStack(spacing: 12) {
                        QRCodeView(text: InviteLink.url(code: inviteCode)?.absoluteString ?? inviteCode)
                            .frame(width: 180, height: 180).frame(maxWidth: .infinity)
                        Text(inviteCode).praeludeNumeral(20).textSelection(.enabled)
                        ShareLink(item: InviteLink.url(code: inviteCode) ?? URL(string: "https://praelude.app")!) {
                            Label("Share invite link", systemImage: "square.and.arrow.up")
                        }.buttonStyle(.praeludeQuiet)
                    }
                    .frame(maxWidth: .infinity)
                    .listRowBackground(Color.clear)
                } else {
                    Button("Create invite link") { Task { await createInvite() } }
                }
                Button("Scan a code") { showScanner = true }
            } header: { Text("Invite") } footer: { Text("Scanning or opening an invite link adds you both as friends right away.") }

            Section {
                Toggle("Suggest friends from contacts", isOn: $contactsEnabled)
                    .praeludeToggleHaptic(contactsEnabled)
                if loadingContacts { ProgressView() }
                ForEach(contactSuggestions) { result in
                    HStack {
                        Text(result.displayName ?? "@\(result.username)")
                        Spacer()
                        requestButton(for: result.id)
                    }
                }
            } header: { Text("From your contacts") } footer: {
                Text("Contacts are matched on this device by hashed phone number and email — Praelude never sees your address book.")
            }

            if let error { Section { ErrorMessage(message: error) } }
        }
        .scrollContentBackground(.hidden)
        .background(PraeludeColor.paper)
        .navigationTitle("Find friends")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: query) {
            let requested = query
            results = []
            guard !requested.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
            do { try await Task.sleep(for: .milliseconds(250)) } catch { return }
            let found = await social.searchProfiles(query: requested)
            guard !Task.isCancelled, query == requested else { return }
            results = found
        }
        .task(id: contactsEnabled) {
            if contactsEnabled { await enableContacts() }
            else { contactSuggestions = []; loadingContacts = false }
        }
        .sheet(isPresented: $showScanner) {
            InviteScannerView(onCode: { text in Task { await redeem(text) } })
        }
        .alert("Added as a friend", isPresented: Binding(get: { redeemedName != nil }, set: { if !$0 { redeemedName = nil } })) {
            Button("OK") { redeemedName = nil }
        } message: { Text(redeemedName ?? "") }
    }

    @ViewBuilder private func requestButton(for id: UUID) -> some View {
        if sentTo.contains(id) {
            Text("Sent").font(.caption).foregroundStyle(PraeludeColor.inkTertiary)
        } else {
            Button("Add") { Task { await sendRequest(id) } }.buttonStyle(.praeludeQuiet).fixedSize()
        }
    }
    private func sendRequest(_ id: UUID) async {
        guard await social.sendFriendRequest(to: id) else { error = social.lastError; return }
        sentTo.insert(id)
    }
    private func createInvite() async {
        inviteCode = await social.createInviteCode()
        if inviteCode == nil { error = social.lastError ?? "Couldn't create an invite link." }
    }
    /// Accepts either a bare code or a full `praelude://invite/<code>` URL (a pasted link and a
    /// scanned code both land here).
    private func redeem(_ text: String) async {
        let code = URL(string: text).flatMap(InviteLink.code(from:)) ?? text
        guard let friendID = await social.redeemInviteCode(code) else { error = social.lastError ?? "That invite link isn't valid."; return }
        let card = await social.profileCard(for: friendID)
        redeemedName = card?.displayNameOrUsernameOrFallback ?? "your new friend"
    }

    private func enableContacts() async {
        loadingContacts = true
        defer { loadingContacts = false }
        // Discoverable-by-others is a separate, explicit opt-in from "find my own contacts" — the
        // caller's own signed-in email is the one identifier this app already knows is genuinely
        // theirs, so that's what makes them discoverable; a phone number would need the person to
        // type it, which this v1 doesn't ask for.
        if case .signedIn(_, let email) = auth.state, let email, let hash = ContactHasher.hash(email, kind: .email) {
            await social.makeDiscoverable(hash: hash, kind: .email)
        }
        let store = CNContactStore()
        let granted = await withCheckedContinuation { continuation in
            store.requestAccess(for: .contacts) { granted, _ in continuation.resume(returning: granted) }
        }
        guard granted else { contactsEnabled = false; error = "Contacts access was declined."; return }
        // The address book can be large; enumerate off the main actor so this doesn't hitch the UI
        // the moment the toggle flips.
        guard !Task.isCancelled, contactsEnabled else { return }
        let hashes: [(String, ContactHashKind)] = await Task.detached(priority: .userInitiated) {
            var collected: [(String, ContactHashKind)] = []
            let keys = [CNContactPhoneNumbersKey, CNContactEmailAddressesKey] as [CNKeyDescriptor]
            let request = CNContactFetchRequest(keysToFetch: keys)
            try? CNContactStore().enumerateContacts(with: request) { contact, _ in
                for phone in contact.phoneNumbers { if let h = ContactHasher.hash(phone.value.stringValue, kind: .phone) { collected.append((h, .phone)) } }
                for email in contact.emailAddresses { if let h = ContactHasher.hash(email.value as String, kind: .email) { collected.append((h, .email)) } }
            }
            return collected
        }.value
        guard !Task.isCancelled, contactsEnabled else { return }
        guard await social.uploadContactHashes(hashes.map { (hash: $0.0, kind: $0.1) }) else {
            error = social.lastError; return
        }
        let suggestions = await social.contactSuggestions()
        guard !Task.isCancelled, contactsEnabled else { return }
        contactSuggestions = suggestions
    }
}
