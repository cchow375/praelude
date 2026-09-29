import SwiftUI

/// Notes (spec §5a): "Instagram-Notes style" — a short line of text over a friend's avatar, 24h,
/// optional piece, private replies. `notes` shown "above avatar" per spec: a bubble sits above each
/// person's `AvatarView` in the strip, matching that reference exactly rather than a generic list.
struct NotesStrip: View {
    let notes: [NoteRow]
    let cards: [UUID: ProfileCard]
    let onCompose: () -> Void
    let onOpen: (NoteRow) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(alignment: .top, spacing: 14) {
                VStack(spacing: 6) {
                    Button(action: onCompose) {
                        ZStack {
                            Circle().fill(PraeludeColor.inkFillQuiet).frame(width: 52, height: 52)
                            Image(systemName: "plus").foregroundStyle(PraeludeColor.ink)
                        }
                    }.buttonStyle(.plain).accessibilityLabel("Post a note")
                    Text("Your note").font(.caption2).foregroundStyle(PraeludeColor.inkSecondary)
                }
                ForEach(notes) { note in
                    Button { onOpen(note) } label: {
                        VStack(spacing: 6) {
                            noteBubble(note.text)
                            AvatarView(photoPath: cards[note.ownerID]?.photoPath, fallbackText: cards[note.ownerID]?.displayNameOrUsernameOrFallback ?? "?", size: 52)
                            Text((cards[note.ownerID]?.displayNameOrUsernameOrFallback ?? "Musician").components(separatedBy: " ").first ?? "")
                                .font(.caption2).foregroundStyle(PraeludeColor.inkSecondary).lineLimit(1)
                        }
                    }.buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 16).padding(.vertical, 4)
        }
    }
    private func noteBubble(_ text: String) -> some View {
        Text(text).font(.caption).lineLimit(2)
            .padding(.horizontal, 10).padding(.vertical, 6)
            .frame(width: 96)
            .background(PraeludeColor.surface, in: RoundedRectangle(cornerRadius: PraeludeRadius.tight, style: .continuous))
            .praeludeHairline(.top)
    }
}

/// Compose a Note — the one call site of `SocialHooks.postNote`, the "post-as-note" hook every other
/// track's own "share this to a Note" action is expected to reuse rather than posting directly.
struct NoteComposeView: View {
    var piece: Piece?
    @Environment(SocialHooks.self) private var hooks
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var attachPiece: Bool
    @State private var posting = false
    @State private var error: String?
    @FocusState private var focused: Bool

    init(piece: Piece? = nil) { self.piece = piece; _attachPiece = State(initialValue: piece != nil) }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("What's on your mind?", text: $text, axis: .vertical).lineLimit(3...6).focused($focused)
                } footer: { Text("Visible to friends for 24 hours, then it's gone.") }
                if let piece {
                    Section { Toggle("Attach “\(piece.title)”", isOn: $attachPiece) }
                }
                if let error { Section { ErrorMessage(message: error) } }
            }
            .navigationTitle("New note").navigationBarTitleDisplayMode(.inline)
            .disabled(posting)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Post") { post() }.disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
            .onAppear { focused = true }
        }
        .presentationDetents([.medium])
    }
    private func post() {
        posting = true
        Task {
            let ok = await hooks.postNote(text: text, pieceID: attachPiece ? piece?.id : nil, pieceTitle: attachPiece ? piece?.title : nil)
            posting = false
            if ok { dismiss() } else { error = hooks.lastError ?? "Couldn't post that note." }
        }
    }
}

/// A note's full text plus private replies (spec §5a: "private replies" — visible only to the note's
/// author and whichever specific friend sent that reply, never to other repliers; enforced server-side
/// by `note_replies_select_participant`, so this view simply shows whatever comes back).
struct NoteDetailSheet: View {
    let note: NoteRow
    let authorCard: ProfileCard?
    @Environment(SocialService.self) private var social
    @Environment(\.dismiss) private var dismiss
    @State private var replies: [NoteReplyRow] = []
    @State private var draft = ""
    @State private var sending = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                List {
                    Section {
                        HStack(alignment: .top, spacing: 10) {
                            AvatarView(photoPath: authorCard?.photoPath, fallbackText: authorCard?.displayNameOrUsernameOrFallback ?? "?", size: 40)
                            VStack(alignment: .leading, spacing: 4) {
                                Text(authorCard?.displayNameOrUsernameOrFallback ?? "Praelude musician").fontWeight(.semibold)
                                Text(note.text)
                                if let title = note.pieceTitle { Text(title).font(.caption).foregroundStyle(PraeludeColor.inkSecondary) }
                            }
                        }
                    }
                    if !replies.isEmpty {
                        Section("Replies") {
                            ForEach(replies) { reply in
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(reply.ownerID == social.myUserID ? "You" : "Reply").font(.caption).foregroundStyle(PraeludeColor.inkTertiary)
                                    Text(reply.body)
                                }
                            }
                        }
                    }
                }
                .scrollContentBackground(.hidden)
                HStack {
                    TextField("Reply privately…", text: $draft)
                    Button("Send") { send() }.disabled(draft.trimmingCharacters(in: .whitespaces).isEmpty || sending)
                }
                .padding(12).praeludeSurfacePanel().praeludeHairline(.top)
            }
            .background(PraeludeColor.paper)
            .navigationTitle("Note").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
        }
        .task { replies = await social.replies(toNote: note.id) }
        .presentationDetents([.medium, .large])
    }
    private func send() {
        let body = draft; draft = ""; sending = true
        Task {
            if await social.replyToNote(note.id, body: body) { replies = await social.replies(toNote: note.id) }
            sending = false
        }
    }
}
