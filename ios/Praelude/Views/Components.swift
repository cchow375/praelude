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
                .font(.title2.weight(.semibold).monospacedDigit())
                .foregroundStyle(.primary)
                .contentTransition(.numericText())
            Text(title)
                .font(.subheadline)
                .foregroundStyle(.secondary)
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
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
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
            .foregroundStyle(.tint)
            .frame(width: size, height: size * 1.22)
            .background(.quaternary, in: RoundedRectangle(cornerRadius: 7))
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
