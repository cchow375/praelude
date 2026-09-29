import SwiftUI

struct PracticeMetric: View {
    let value: String
    let title: String
    var symbol: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            if let symbol {
                Image(systemName: symbol)
                    .font(.body.weight(.medium))
                    .foregroundStyle(.secondary)
                    .accessibilityHidden(true)
            }
            Text(value)
                .praeludeNumeral(26)
                .foregroundStyle(PraeludeColor.ink)
                .contentTransition(.numericText())
            Text(title)
                .font(.subheadline)
                .foregroundStyle(PraeludeColor.inkSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

struct PraeludeEmptyState: View {
    let title: String
    let symbol: String
    let message: String
    var actionTitle: String? = nil
    var action: (() -> Void)? = nil

    var body: some View {
        ContentUnavailableView {
            Label(title, systemImage: symbol)
        } description: {
            Text(message)
        } actions: {
            if let actionTitle, let action {
                Button(actionTitle, action: action)
                    .buttonStyle(.praeludePrimary)
                    .frame(maxWidth: 320)
            }
        }
    }
}

struct ScoreThumbnail: View {
    var size: CGFloat = 46
    var symbol = "music.note"

    var body: some View {
        Image(systemName: symbol)
            .font(.system(size: size * 0.4, weight: .regular))
            .foregroundStyle(PraeludeColor.inkSecondary)
            .frame(width: size, height: size * 1.22)
            .background(PraeludeColor.inkFillQuiet, in: RoundedRectangle(cornerRadius: PraeludeRadius.tight))
            .accessibilityHidden(true)
    }
}

func practiceDuration(_ seconds: TimeInterval) -> String {
    let minutes = max(0, Int(seconds)) / 60
    if minutes < 1 { return seconds > 0 ? "<1 min" : "0 min" }
    if minutes < 60 { return "\(minutes) min" }
    let hours = minutes / 60
    let remainder = minutes % 60
    return remainder == 0 ? "\(hours) hr" : "\(hours) hr \(remainder) min"
}

/// "Tap passage to hear last recording" (§13): the latest take for a passage, plus one to compare
/// against from about a week ago when one exists. Never shown if the passage has no recordings —
/// recording is opt-in, and most passages will have none.
struct LastRecordingCard: View {
    @Environment(RecordingService.self) private var recording
    @Environment(PracticeStore.self) private var store
    let passageID: UUID

    private var latest: AudioRecording? { store.recordings.latestRecording(forPassage: passageID) }
    private var compare: AudioRecording? { store.recordings.recording(forPassage: passageID, nearestDaysAgo: 7) }

    var body: some View {
        if let latest {
            VStack(alignment: .leading, spacing: 10) {
                Text("Recordings").font(.subheadline.weight(.medium)).foregroundStyle(PraeludeColor.inkSecondary)
                takeRow(latest, label: "Latest", caption: relativeLabel(latest.date))
                if let compare {
                    takeRow(compare, label: "~A week ago", caption: relativeLabel(compare.date))
                }
            }
            .padding(.vertical, 4)
        }
    }

    private func takeRow(_ take: AudioRecording, label: String, caption: String) -> some View {
        let isThisPlaying = recording.isPlaying && recording.nowPlayingID == take.id
        return Button {
            if isThisPlaying { recording.stopPlayback() } else { recording.play(take, in: store) }
        } label: {
            HStack {
                Image(systemName: isThisPlaying ? "stop.circle.fill" : "play.circle.fill")
                    .font(.title3).foregroundStyle(PraeludeColor.ink).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 1) {
                    Text(label).font(.subheadline)
                    Text(caption).font(.caption).foregroundStyle(PraeludeColor.inkSecondary)
                }
                Spacer()
                Text(practiceDuration(take.duration)).font(.caption).foregroundStyle(PraeludeColor.inkSecondary)
            }
            .frame(minHeight: 44).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(label) recording, \(caption), \(practiceDuration(take.duration))")
        .accessibilityHint(isThisPlaying ? "Stop playback" : "Play recording")
    }

    private func relativeLabel(_ date: Date) -> String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .short
        return formatter.localizedString(for: date, relativeTo: Date())
    }
}

struct ErrorMessage: View {
    let message: String

    var body: some View {
        Label(message, systemImage: "exclamationmark.circle")
            .font(.subheadline)
            .foregroundStyle(.red)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityAddTraits(.isStaticText)
    }
}
