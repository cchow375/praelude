import SwiftUI

/// Sign up/in, magic link, password reset, sign out, and in-app account deletion (spec §4b). A
/// guest keeps practicing fully offline either way — nothing here is required to use the app.
struct AccountView: View {
    @Environment(AuthManager.self) private var auth
    @Environment(SyncCoordinator.self) private var syncCoordinator

    private enum Mode: Hashable { case signIn, signUp }

    @State private var email = ""
    @State private var password = ""
    @State private var mode = Mode.signIn
    @State private var isWorking = false
    @State private var confirmDeleteStep1 = false
    @State private var confirmDeleteStep2 = false
    @State private var deleteError: String?

    /// The age gate (spec §5c "age gate at signup with stricter defaults for minors"). `nil` until
    /// chosen; required before "Create account" enables, so a new account is never created without
    /// it. Applied once, the moment `auth.state` actually flips to `.signedIn` for the first time
    /// after that tap — sign-up itself only sends a confirmation email (`AccountView`'s own footer
    /// copy says so), so the account this needs to write to doesn't exist yet at the point of tap.
    @State private var pendingAgeBracket: AgeBracket?
    @State private var appliedAgeGate = false

    var body: some View {
        Form {
            switch auth.state {
            case .guest, .authenticating:
                signedOutSections
            case .signedIn(_, let signedInEmail):
                signedInSections(email: signedInEmail)
            }
        }
        .scrollContentBackground(.hidden)
        .background(PraeludeColor.paper)
        .navigationTitle("Account")
        .navigationBarTitleDisplayMode(.inline)
        .disabled(isWorking)
        .confirmationDialog("Delete your account?", isPresented: $confirmDeleteStep1, titleVisibility: .visible) {
            Button("Continue", role: .destructive) { confirmDeleteStep2 = true }
        } message: {
            Text("This removes your account, profile, friends, and everything else synced to it. It cannot be undone.")
        }
        .alert("Delete account permanently?", isPresented: $confirmDeleteStep2) {
            Button("Delete permanently", role: .destructive) {
                Task {
                    isWorking = true
                    let success = await auth.deleteAccount()
                    isWorking = false
                    if !success { deleteError = auth.lastError ?? "Couldn't delete your account. Try again." }
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("There is no way to undo this.")
        }
        .onChange(of: auth.state) { _, state in
            guard case .signedIn = state, !appliedAgeGate, let bracket = pendingAgeBracket else { return }
            appliedAgeGate = true
            applyAgeGate(bracket)
        }
    }

    /// See `ProfileBackendFields.applyingAgeGate` (Core) for exactly which fields this changes and
    /// why — kept there, not inline here, so the decision itself is unit-testable without a View.
    private func applyAgeGate(_ bracket: AgeBracket) {
        syncCoordinator.setProfileBackendFields(syncCoordinator.profileBackendFields.applyingAgeGate(bracket))
        syncCoordinator.pushProfile()
    }

    @ViewBuilder private var signedOutSections: some View {
        Section {
            Text("Practice stays on this device either way. An account adds sync across your iPhone and iPad, and a backup off this device.")
                .foregroundStyle(PraeludeColor.inkSecondary)
        }
        Section {
            Picker("Mode", selection: $mode) {
                Text("Sign in").tag(Mode.signIn)
                Text("Create account").tag(Mode.signUp)
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .listRowBackground(Color.clear)
            TextField("Email", text: $email)
                .keyboardType(.emailAddress).textContentType(.username)
                .textInputAutocapitalization(.never).autocorrectionDisabled()
            SecureField("Password", text: $password)
                .textContentType(mode == .signIn ? .password : .newPassword)
            if mode == .signUp {
                Picker("Age", selection: $pendingAgeBracket) {
                    Text("Choose one").tag(AgeBracket?.none)
                    ForEach(AgeBracket.allCases, id: \.self) { Text($0.label).tag(AgeBracket?.some($0)) }
                }
            }
            Button(mode == .signIn ? "Sign in" : "Create account") {
                Task {
                    isWorking = true
                    if mode == .signIn { await auth.signIn(email: email, password: password) }
                    else { appliedAgeGate = false; await auth.signUp(email: email, password: password) }
                    isWorking = false
                }
            }
            .buttonStyle(.praeludePrimary)
            .disabled(email.isEmpty || password.count < 6 || (mode == .signUp && pendingAgeBracket == nil))
            .listRowInsets(EdgeInsets())
        } footer: {
            Text(mode == .signUp
                 ? "A confirmation email is sent before a new account can sign in. Age sets your starting privacy defaults — stricter for under 18 — which you can always change in Edit profile."
                 : "At least 6 characters.")
        }
        Section {
            Button("Email me a sign-in link") { Task { await send(auth.sendMagicLink) } }
                .buttonStyle(.praeludeQuiet).disabled(email.isEmpty).listRowInsets(EdgeInsets())
            Button("Forgot password") { Task { await send(auth.resetPassword) } }
                .buttonStyle(.praeludeQuiet).disabled(email.isEmpty).listRowInsets(EdgeInsets())
            if let sent = auth.lastSentEmail {
                Label("Check \(sent) for a link.", systemImage: "envelope")
                    .font(.footnote).foregroundStyle(PraeludeColor.inkSecondary)
            }
        }
        if let error = auth.lastError { Section { ErrorMessage(message: error) } }
    }

    private func send(_ action: (String) async -> Bool) async {
        isWorking = true
        _ = await action(email)
        isWorking = false
    }

    @ViewBuilder private func signedInSections(email: String?) -> some View {
        Section {
            LabeledContent("Signed in as", value: email ?? "Your account")
            syncStatusRow
        }
        Section { NavigationLink("Edit profile") { ProfileEditView() } }
        Section {
            Button("Sign out") { Task { await auth.signOut() } }
                .buttonStyle(.praeludeQuiet).listRowInsets(EdgeInsets())
        }
        Section {
            Button("Delete account", role: .destructive) { confirmDeleteStep1 = true }
        } footer: {
            Text("Permanently deletes your account, profile and everything synced to it from the server. Practice already saved on this device is not touched.")
        }
        if let deleteError { Section { ErrorMessage(message: deleteError) } }
    }

    @ViewBuilder private var syncStatusRow: some View {
        HStack {
            Text(syncStatusText).font(.footnote).foregroundStyle(syncStatusColor)
            Spacer()
            if syncCoordinator.pendingCount > 0 {
                Text("\(syncCoordinator.pendingCount) waiting").font(.caption).foregroundStyle(PraeludeColor.inkTertiary)
            }
        }
    }
    private var syncStatusText: String {
        switch syncCoordinator.status {
        case .idle: "Synced"
        case .syncing: "Syncing…"
        case .offline: "Offline — will sync when connected"
        case .stuck(let message): message
        }
    }
    private var syncStatusColor: Color {
        if case .stuck = syncCoordinator.status { return PraeludeColor.live }
        return PraeludeColor.inkSecondary
    }
}
