import SwiftUI

/// A friend's (or the caller's own) avatar, loaded on demand from `photoPath` via a short-lived
/// signed URL (the `avatars` bucket is private — see `AuthManager.avatarSignedURL`). Falls back to
/// an initial-letter monogram, never a generic person glyph over empty gray, so a friend list still
/// reads as *people* before any photo has loaded. No shadow/border card — a flat tonal fill, matching
/// the design system's own "no shadow-plus-border, anywhere" rule.
struct AvatarView: View {
    var photoPath: String?
    var fallbackText: String
    var size: CGFloat = 44
    @Environment(AuthManager.self) private var auth
    @State private var image: Image?
    @State private var loadedForPath: String?

    var body: some View {
        ZStack {
            Circle().fill(PraeludeColor.inkFillQuiet)
            if let image {
                image.resizable().scaledToFill()
            } else if let initial = fallbackText.trimmingCharacters(in: .whitespacesAndNewlines).first {
                Text(String(initial).uppercased())
                    .praeludeNumeral(size * 0.4)
                    .foregroundStyle(PraeludeColor.inkSecondary)
            } else {
                Image(systemName: "person.fill").foregroundStyle(PraeludeColor.inkTertiary)
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .task(id: photoPath) { await load() }
        .accessibilityHidden(true)
    }

    private func load() async {
        guard let photoPath, photoPath != loadedForPath || image == nil else {
            if photoPath == nil { image = nil; loadedForPath = nil }
            return
        }
        image = nil; loadedForPath = nil
        guard let url = await auth.avatarSignedURL(path: photoPath),
              let (data, _) = try? await URLSession.shared.data(from: url),
              let uiImage = UIImage(data: data) else { return }
        guard !Task.isCancelled, self.photoPath == photoPath else { return }
        loadedForPath = photoPath
        image = Image(uiImage: uiImage)
    }
}
