import SwiftUI

/// One activity-feed row (spec §5a). Copy is short, specific, and dry — no "🎉 Amazing job!!" — the
/// same restraint `ScoreExport`/`FeedbackService`'s own copy already keeps.
struct ActivityFeedRow: View {
    let event: ActivityEvent
    let authorCard: ProfileCard?
    let onOpen: () -> Void

    var body: some View {
        Button(action: onOpen) {
            HStack(alignment: .top, spacing: 12) {
                AvatarView(photoPath: authorCard?.photoPath, fallbackText: authorCard?.displayNameOrUsernameOrFallback ?? "?", size: 40)
                VStack(alignment: .leading, spacing: 3) {
                    (Text(authorCard?.displayNameOrUsernameOrFallback ?? "Praelude musician").fontWeight(.semibold) + Text(" " + headline))
                        .font(.subheadline).foregroundStyle(PraeludeColor.ink)
                    if !event.detail.isEmpty { Text(event.detail).font(.subheadline).foregroundStyle(PraeludeColor.inkSecondary).lineLimit(2) }
                    Text(event.createdAt.formatted(.relative(presentation: .named))).font(.caption).foregroundStyle(PraeludeColor.inkTertiary)
                }
                Spacer(minLength: 0)
            }
        }
        .buttonStyle(.plain)
        .padding(.vertical, 4)
    }
    private var headline: String {
        switch event.eventKind {
        case .sessionFinished: "finished practicing"
        case .streakMilestone: "hit a streak milestone"
        case .passagePerformanceReady: "got a passage performance-ready"
        case .newPiece: "added a new piece"
        case .performanceDateSet: "set a performance date"
        case .notePosted: "posted a note"
        case .rankBadge: "earned a badge"
        case nil: "posted an update"
        }
    }
}

/// Reactions + comments on one feed event, and a report entry point (spec §5a/§5c). Music-flavored
/// reactions, not generic thumbs/hearts — `ReactionKind`'s own set.
struct ActivityDetailSheet: View {
    let event: ActivityEvent
    let authorCard: ProfileCard?
    @Environment(SocialService.self) private var social
    @Environment(\.dismiss) private var dismiss
    @State private var reactions: [ReactionRow] = []
    @State private var comments: [CommentRow] = []
    @State private var commentDraft = ""
    @State private var showReport = false

    private var myReactions: Set<ReactionKind> {
        Set(reactions.filter { $0.ownerID == social.myUserID }.compactMap { ReactionKind(rawValue: $0.kind) })
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                List {
                    Section { ActivityFeedRow(event: event, authorCard: authorCard, onOpen: {}).allowsHitTesting(false) }
                    Section {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack {
                                ForEach(ReactionKind.allCases, id: \.self) { kind in
                                    let mine = myReactions.contains(kind)
                                    Button(kind.label) { Task { await toggle(kind) } }
                                        .buttonStyle(.praeludeQuiet)
                                        .fixedSize()
                                        .opacity(mine ? 1 : 0.6)
                                        .overlay(alignment: .topTrailing) {
                                            if let count = countFor(kind), count > 0 {
                                                Text("\(count)").font(.caption2).padding(4).background(PraeludeColor.ink, in: Circle()).foregroundStyle(PraeludeColor.paper).offset(x: 6, y: -6)
                                            }
                                        }
                                }
                            }
                        }
                    } header: { Text("React") }
                    if !comments.isEmpty {
                        Section("Comments") {
                            ForEach(comments) { comment in Text(comment.body) }
                        }
                    }
                    Section {
                        Button("Report this", role: .destructive) { showReport = true }
                    }
                }
                .scrollContentBackground(.hidden)
                HStack {
                    TextField("Add a comment…", text: $commentDraft)
                    Button("Post") { Task { await addComment() } }.disabled(commentDraft.trimmingCharacters(in: .whitespaces).isEmpty)
                }
                .padding(12).praeludeSurfacePanel().praeludeHairline(.top)
            }
            .background(PraeludeColor.paper)
            .navigationTitle("Activity").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
        }
        .task { await load() }
        .sheet(isPresented: $showReport) { ReportSheet(targetType: .activityEvent, targetID: event.id) }
        .presentationDetents([.medium, .large])
    }
    private func countFor(_ kind: ReactionKind) -> Int? { reactions.filter { $0.kind == kind.rawValue }.count }
    private func load() async {
        async let r = social.reactions(onActivityEvent: event.id)
        async let c = social.comments(onActivityEvent: event.id)
        reactions = await r; comments = await c
    }
    private func toggle(_ kind: ReactionKind) async {
        if myReactions.contains(kind) { _ = await social.removeReaction(targetType: .activityEvent, targetID: event.id, kind: kind) }
        else { _ = await social.react(targetType: .activityEvent, targetID: event.id, kind: kind) }
        reactions = await social.reactions(onActivityEvent: event.id)
    }
    private func addComment() async {
        let body = commentDraft; commentDraft = ""
        guard await social.addComment(targetType: .activityEvent, targetID: event.id, body: body) else { return }
        comments = await social.comments(onActivityEvent: event.id)
    }
}
