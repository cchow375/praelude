import SwiftUI
import PhotosUI
import UIKit

/// Edit every profile field (spec §4c): identity, instruments, currently-working-on pieces,
/// upcoming performances, per-field privacy, plus a read-only stats section and a "preview as
/// others" sheet. A local draft (`profile`/`extras`) so in-progress edits are never partially
/// pushed mid-keystroke; "Save" writes through `PracticeStore.updateProfile` and pushes via
/// `SyncCoordinator`. Instruments are separate Core records and take effect immediately
/// (`store.saveInstrument`/`deleteInstrument`), the same as every other list screen in this app —
/// there is no "cancel" for an instrument add/edit/delete.
struct ProfileEditView: View {
    @Environment(PracticeStore.self) private var store
    @Environment(AuthManager.self) private var auth
    @Environment(SyncCoordinator.self) private var syncCoordinator
    @Environment(SocialHooks.self) private var hooks
    @Environment(\.dismiss) private var dismiss

    @State private var profile = Profile()
    @State private var extras = ProfileBackendFields()
    @State private var hasLoaded = false
    @State private var errorMessage: String?
    /// The performance count as loaded, so `save()` can tell a genuinely new entry (spec §5a
    /// "performance date set" feed event) apart from an edit to an existing one — only the former is
    /// feed-worthy.
    @State private var loadedPerformanceCount = 0

    @State private var photoItem: PhotosPickerItem?
    @State private var avatarImage: Image?
    @State private var isUploadingPhoto = false

    @State private var editingInstrument: Instrument?
    @State private var isAddingInstrument = false
    @State private var showPreview = false

    var body: some View {
        Form {
            photoSection
            identitySection
            instrumentsSection
            currentlyWorkingOnSection
            upcomingPerformancesSection
            privacySection
            statsSection
            if let errorMessage { Section { ErrorMessage(message: errorMessage) } }
        }
        .scrollContentBackground(.hidden)
        .background(PraeludeColor.paper)
        .navigationTitle("Edit profile")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) { Button("Save", action: save) }
        }
        .onAppear {
            guard !hasLoaded else { return }
            hasLoaded = true
            profile = store.state.profile
            extras = syncCoordinator.profileBackendFields
            loadedPerformanceCount = extras.upcomingPerformances.count
        }
        .task(id: profile.photoRef) { await loadAvatarPreview() }
        .onChange(of: photoItem) { _, item in Task { await upload(item) } }
        .sheet(item: $editingInstrument) { instrument in
            NavigationStack {
                InstrumentEditSheet(instrument: instrument, isNew: false, onSave: saveInstrument, onDelete: deleteInstrument)
            }
        }
        .sheet(isPresented: $isAddingInstrument) {
            NavigationStack {
                InstrumentEditSheet(instrument: Instrument(family: .keyboard, name: ""), isNew: true, onSave: saveInstrument, onDelete: nil)
            }
        }
        .sheet(isPresented: $showPreview) {
            NavigationStack { ProfilePreviewView(profile: profile, extras: extras) }
        }
    }

    // MARK: Photo

    @ViewBuilder private var photoSection: some View {
        Section {
            HStack(spacing: 16) {
                ZStack {
                    Circle().fill(PraeludeColor.inkFillQuiet).frame(width: 64, height: 64)
                    if let avatarImage {
                        avatarImage.resizable().scaledToFill().frame(width: 64, height: 64).clipShape(Circle())
                    } else {
                        Image(systemName: "person.fill").foregroundStyle(PraeludeColor.inkTertiary)
                    }
                }
                // A plain local String, not `self.isUploadingPhoto` itself, is what the trailing
                // closure captures — PhotosPicker's label closure is @Sendable, so capturing a
                // main-actor-isolated property directly there is a (harmless in practice, since
                // SwiftUI only ever evaluates it on the main actor, but still worth avoiding)
                // Swift 6 warning; a value-captured String has no isolation to complain about.
                let photoPickerLabel = isUploadingPhoto ? "Uploading…" : "Change photo"
                PhotosPicker(selection: $photoItem, matching: .images) {
                    Text(photoPickerLabel)
                }
                .buttonStyle(.praeludeQuiet)
                .disabled(isUploadingPhoto)
                Spacer()
            }
            .listRowBackground(Color.clear)
        }
    }

    private func upload(_ item: PhotosPickerItem?) async {
        guard let item else { return }
        isUploadingPhoto = true
        defer { isUploadingPhoto = false }
        guard let data = try? await item.loadTransferable(type: Data.self),
              let uiImage = UIImage(data: data),
              let jpeg = uiImage.jpegData(compressionQuality: 0.85) else {
            errorMessage = "Couldn't read that photo."
            return
        }
        guard let path = await auth.uploadAvatar(jpegData: jpeg) else {
            errorMessage = auth.lastError ?? "Couldn't upload your photo."
            return
        }
        profile.photoRef = path
    }
    private func loadAvatarPreview() async {
        guard let path = profile.photoRef else { avatarImage = nil; return }
        guard let url = await auth.avatarSignedURL(path: path),
              let (data, _) = try? await URLSession.shared.data(from: url),
              let uiImage = UIImage(data: data) else { return }
        avatarImage = Image(uiImage: uiImage)
    }

    // MARK: Identity

    @ViewBuilder private var identitySection: some View {
        Section {
            TextField("Display name", text: $profile.displayName)
            TextField("Username", text: usernameBinding)
                .textInputAutocapitalization(.never).autocorrectionDisabled()
            TextField("Bio", text: $profile.bio, axis: .vertical).lineLimit(2...4)
            TextField("Teacher or school", text: $profile.teacherOrSchool)
            TextField("Location", text: $profile.location)
        } header: {
            Text("Identity")
        } footer: {
            Text("Usernames must be unique. A taken username is rejected the next time this syncs.")
        }
    }
    private var usernameBinding: Binding<String> {
        Binding(get: { profile.username }, set: { profile.username = Self.sanitizeUsername($0) })
    }
    private static func sanitizeUsername(_ raw: String) -> String {
        let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyz0123456789_")
        return String(raw.lowercased().unicodeScalars.filter(allowed.contains).prefix(30))
    }

    // MARK: Instruments

    @ViewBuilder private var instrumentsSection: some View {
        Section {
            ForEach(liveInstruments) { instrument in
                Button { editingInstrument = instrument } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(instrument.name.isEmpty ? instrument.family.rawValue.capitalized : instrument.name)
                                .foregroundStyle(PraeludeColor.ink)
                            if !instrument.level.isEmpty {
                                Text(instrument.level).font(.caption).foregroundStyle(PraeludeColor.inkSecondary)
                            }
                        }
                        Spacer()
                        if instrument.isPrimary {
                            Text("Primary").font(.caption).foregroundStyle(PraeludeColor.inkTertiary)
                        }
                    }
                }
            }
            Button("Add instrument") { isAddingInstrument = true }
        } header: {
            Text("Instruments")
        }
    }
    private var liveInstruments: [Instrument] { store.state.instruments.filter { $0.deletedAt == nil } }

    private func saveInstrument(_ instrument: Instrument) {
        do {
            if instrument.isPrimary {
                for other in liveInstruments where other.id != instrument.id && other.isPrimary {
                    var demoted = other; demoted.isPrimary = false
                    try store.saveInstrument(demoted)
                    syncCoordinator.pushInstrument(demoted)
                }
            }
            try store.saveInstrument(instrument)
            syncCoordinator.pushInstrument(instrument)
        } catch { errorMessage = error.localizedDescription }
    }
    private func deleteInstrument(_ id: UUID) {
        do {
            try store.deleteInstrument(id)
            if let tombstoned = store.state.instruments.first(where: { $0.id == id }) { syncCoordinator.pushInstrument(tombstoned) }
        } catch { errorMessage = error.localizedDescription }
    }

    // MARK: Currently working on

    @ViewBuilder private var currentlyWorkingOnSection: some View {
        Section {
            if livePieces.isEmpty {
                Text("Add a piece in Pieces to feature it here.").foregroundStyle(PraeludeColor.inkSecondary)
            }
            ForEach(livePieces) { piece in
                Button { toggleWorkingOn(piece.id) } label: {
                    HStack {
                        Text(piece.title).foregroundStyle(PraeludeColor.ink)
                        Spacer()
                        if profile.currentlyWorkingOnPieceIDs.contains(piece.id) {
                            Image(systemName: "checkmark").foregroundStyle(PraeludeColor.ink)
                        }
                    }
                }
            }
        } header: {
            Text("Currently working on")
        }
    }
    private var livePieces: [Piece] { store.state.pieces.filter { $0.deletedAt == nil && $0.status != .completed } }
    private func toggleWorkingOn(_ id: UUID) {
        if let index = profile.currentlyWorkingOnPieceIDs.firstIndex(of: id) { profile.currentlyWorkingOnPieceIDs.remove(at: index) }
        else { profile.currentlyWorkingOnPieceIDs.append(id) }
    }

    // MARK: Upcoming performances

    @ViewBuilder private var upcomingPerformancesSection: some View {
        Section {
            ForEach(Array(extras.upcomingPerformances.enumerated()), id: \.offset) { index, _ in
                VStack(alignment: .leading, spacing: 6) {
                    TextField("Title (optional)", text: performanceTitleBinding(index))
                    DatePicker("Date", selection: performanceDateBinding(index), displayedComponents: .date)
                    TextField("Location (optional)", text: performanceLocationBinding(index))
                }
            }
            .onDelete { extras.upcomingPerformances.remove(atOffsets: $0) }
            Button("Add performance") {
                extras.upcomingPerformances.append(BackendPerformance(date: Date().addingTimeInterval(30 * 86_400)))
            }
        } header: {
            Text("Upcoming performances")
        }
    }
    private func performanceTitleBinding(_ index: Int) -> Binding<String> {
        Binding(get: { extras.upcomingPerformances[index].title ?? "" },
                set: { extras.upcomingPerformances[index].title = $0.isEmpty ? nil : $0 })
    }
    private func performanceDateBinding(_ index: Int) -> Binding<Date> {
        Binding(get: { extras.upcomingPerformances[index].date }, set: { extras.upcomingPerformances[index].date = $0 })
    }
    private func performanceLocationBinding(_ index: Int) -> Binding<String> {
        Binding(get: { extras.upcomingPerformances[index].location ?? "" },
                set: { extras.upcomingPerformances[index].location = $0.isEmpty ? nil : $0 })
    }

    // MARK: Privacy

    @ViewBuilder private var privacySection: some View {
        Section {
            Toggle("Private account", isOn: $extras.isPrivateAccount)
            Picker("Age", selection: ageBracketBinding) {
                Text("Not set").tag("")
                Text("Under 13").tag("under13")
                Text("13–17").tag("13-17")
                Text("18+").tag("18plus")
            }
            Toggle("Opt out of leaderboards", isOn: $extras.leaderboardOptOut)
        } header: {
            Text("Account privacy")
        } footer: {
            Text("A private account only shows Public-flagged fields to friends, never to anyone else.")
        }
        Section("Per-field privacy") {
            visibilityRow("Name", $profile.privacy.name)
            visibilityRow("Username", $profile.privacy.username)
            visibilityRow("Photo", $profile.privacy.photo)
            visibilityRow("Bio", $profile.privacy.bio)
            visibilityRow("Instruments", $profile.privacy.instruments)
            visibilityRow("Teacher or school", $profile.privacy.teacherOrSchool)
            visibilityRow("Location", $profile.privacy.location)
            visibilityRow("Currently working on", $profile.privacy.currentlyWorkingOn)
            visibilityRow("Upcoming performances", $profile.privacy.upcomingPerformances)
            visibilityRow("Stats", $profile.privacy.stats)
            visibilityRow("Practicing now", $extras.privacyPresence)
            visibilityRow("Notes", $extras.privacyNotes)
        }
        Section {
            Button("Preview as others") { showPreview = true }
                .buttonStyle(.praeludeQuiet).listRowInsets(EdgeInsets())
        }
    }
    private var ageBracketBinding: Binding<String> {
        Binding(get: { extras.ageBracket ?? "" }, set: { extras.ageBracket = $0.isEmpty ? nil : $0 })
    }
    @ViewBuilder private func visibilityRow(_ label: String, _ selection: Binding<ProfileVisibility>) -> some View {
        Picker(label, selection: selection) {
            Text("Public").tag(ProfileVisibility.publicVisibility)
            Text("Friends").tag(ProfileVisibility.friends)
            Text("Only me").tag(ProfileVisibility.onlyMe)
        }
    }

    // MARK: Stats (read-only)

    @ViewBuilder private var statsSection: some View {
        Section {
            LabeledContent("Current streak", value: "\(store.state.rewardsState.streakDays) days")
            LabeledContent("Total practice time", value: Self.durationFormatter.string(from: store.progress.activeSeconds) ?? "0m")
            LabeledContent("Pieces performance-ready", value: "\(store.piecesPerformanceReadyCount)")
            LabeledContent("Rank", value: "\(store.state.rewardsState.rank) · Division \(store.state.rewardsState.division)")
            ForEach(store.state.badges.sorted { $0.earnedAt > $1.earnedAt }) { badge in
                LabeledContent(Self.humanize(badge.key), value: badge.earnedAt.formatted(date: .abbreviated, time: .omitted))
            }
        } header: {
            Text("Stats")
        } footer: {
            Text("Stats reflect this device's own recorded practice.")
        }
    }
    private static let durationFormatter: DateComponentsFormatter = {
        let formatter = DateComponentsFormatter()
        formatter.allowedUnits = [.hour, .minute]
        formatter.unitsStyle = .abbreviated
        formatter.zeroFormattingBehavior = .dropAll
        return formatter
    }()
    private static func humanize(_ key: String) -> String { key.replacingOccurrences(of: "_", with: " ").capitalized }

    // MARK: Save

    private func save() {
        do {
            try store.updateProfile(profile)
            syncCoordinator.setProfileBackendFields(extras)
            syncCoordinator.pushProfile()
            // Spec §5a activity feed: "performance date set" — only a genuinely new entry, not an
            // edit to an existing date/title/location, matches that event's own name.
            if extras.upcomingPerformances.count > loadedPerformanceCount, let newest = extras.upcomingPerformances.last {
                let when = newest.date.formatted(date: .abbreviated, time: .omitted)
                let detail = newest.title.map { "\($0) — \(when)" } ?? when
                hooks.shareMilestone(kind: .performanceDateSet, detail: detail)
            }
            dismiss()
        } catch { errorMessage = error.localizedDescription }
    }
}

/// Add/edit/remove one instrument (§6, as surfaced from §4c's profile editor). `instrument` is a
/// local `@State` draft; nothing is written until "Save".
private struct InstrumentEditSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State var instrument: Instrument
    let isNew: Bool
    let onSave: (Instrument) -> Void
    let onDelete: ((UUID) -> Void)?

    var body: some View {
        Form {
            Section {
                Picker("Family", selection: $instrument.family) {
                    ForEach(InstrumentFamily.allCases, id: \.self) { family in
                        Text(family.rawValue.capitalized).tag(family)
                    }
                }
                TextField("Name (optional)", text: $instrument.name)
                TextField("Level (optional)", text: $instrument.level)
                Toggle("Primary instrument", isOn: $instrument.isPrimary)
            }
            if let onDelete, !isNew {
                Section { Button("Remove", role: .destructive) { onDelete(instrument.id); dismiss() } }
            }
        }
        .scrollContentBackground(.hidden)
        .background(PraeludeColor.paper)
        .navigationTitle(isNew ? "Add instrument" : "Edit instrument")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            ToolbarItem(placement: .confirmationAction) { Button("Save") { onSave(instrument); dismiss() } }
        }
    }
}

/// Read-only "preview as others" (§4c): renders `profile`/`extras` filtered by
/// `ProfileVisibility.isVisible(to:isPrivateAccount:)` for the chosen viewer perspective. Takes a
/// snapshot, not live bindings — previewing does not need to react to further edits made after it
/// was opened.
private struct ProfilePreviewView: View {
    @Environment(\.dismiss) private var dismiss
    let profile: Profile
    let extras: ProfileBackendFields
    @State private var viewer = ProfileViewer.friend

    var body: some View {
        List {
            Picker("Viewing as", selection: $viewer) {
                Text("A friend").tag(ProfileViewer.friend)
                Text("Everyone else").tag(ProfileViewer.everyoneElse)
            }
            .pickerStyle(.segmented)
            .listRowBackground(Color.clear)

            Section {
                if visible(profile.privacy.name) { LabeledContent("Name", value: profile.displayName.isEmpty ? "—" : profile.displayName) }
                if visible(profile.privacy.username) { LabeledContent("Username", value: profile.username.isEmpty ? "—" : "@\(profile.username)") }
                if visible(profile.privacy.photo) { LabeledContent("Photo", value: profile.photoRef == nil ? "None set" : "Visible") }
            }
            if visible(profile.privacy.bio), !profile.bio.isEmpty { Section("Bio") { Text(profile.bio) } }
            if visible(profile.privacy.instruments) { Section { LabeledContent("Instruments", value: "Visible to this viewer") } }
            if visible(profile.privacy.teacherOrSchool), !profile.teacherOrSchool.isEmpty {
                Section { LabeledContent("Teacher or school", value: profile.teacherOrSchool) }
            }
            if visible(profile.privacy.location), !profile.location.isEmpty {
                Section { LabeledContent("Location", value: profile.location) }
            }
            if visible(profile.privacy.currentlyWorkingOn), !profile.currentlyWorkingOnPieceIDs.isEmpty {
                Section { LabeledContent("Currently working on", value: "\(profile.currentlyWorkingOnPieceIDs.count) piece(s)") }
            }
            if visible(profile.privacy.upcomingPerformances), !extras.upcomingPerformances.isEmpty {
                Section { LabeledContent("Upcoming performances", value: "\(extras.upcomingPerformances.count)") }
            }
            if visible(profile.privacy.stats) { Section { LabeledContent("Stats", value: "Visible to this viewer") } }

            if !anyVisible {
                Section {
                    Text("Nothing on this profile is visible to \(viewer == .friend ? "a friend" : "anyone else") yet.")
                        .foregroundStyle(PraeludeColor.inkSecondary)
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(PraeludeColor.paper)
        .navigationTitle("Preview")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
    }
    private func visible(_ tier: ProfileVisibility) -> Bool { tier.isVisible(to: viewer, isPrivateAccount: extras.isPrivateAccount) }
    private var anyVisible: Bool {
        [profile.privacy.name, profile.privacy.username, profile.privacy.photo, profile.privacy.bio, profile.privacy.instruments,
         profile.privacy.teacherOrSchool, profile.privacy.location, profile.privacy.currentlyWorkingOn,
         profile.privacy.upcomingPerformances, profile.privacy.stats].contains { visible($0) }
    }
}
