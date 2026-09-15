import SwiftUI

/// Only the score that owns the saved set shows this brief, noninteractive acknowledgement.
struct PracticeFeedbackView: View {
    var feedback: FeedbackService
    var setID: UUID?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var ignoredInitialEventID: UUID?

    init(feedback: FeedbackService, setID: UUID?) {
        self.feedback = feedback
        self.setID = setID
        // A newly opened score must not replay an acknowledgement already on screen elsewhere.
        _ignoredInitialEventID = State(initialValue: feedback.latest?.id)
    }

    var body: some View {
        Group {
            if let event = feedback.latest, event.setID == setID, event.id != ignoredInitialEventID {
                FeedbackMark(event: event, reduceMotion: reduceMotion)
                    .id(event.id)
                    .transition(reduceMotion ? .opacity : .opacity.combined(with: .scale(scale: 0.94)))
            }
        }
        .animation(reduceMotion ? .easeOut(duration: 0.15) : .spring(response: 0.32, dampingFraction: 0.78), value: feedback.latest?.id)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        .onChange(of: setID) { _, _ in ignoredInitialEventID = feedback.latest?.id }
    }
}

private struct FeedbackMark: View {
    let event: PracticeFeedbackEvent
    let reduceMotion: Bool
    @State private var appeared = false
    private var isSetback: Bool { event.kind == .sloppy || event.kind == .again }
    private var color: Color { isSetback ? .orange : .accentColor }
    private var symbol: String {
        switch event.kind {
        case .clean: "checkmark"
        case .sloppy: "arrow.uturn.backward"
        case .again: "arrow.clockwise"
        case .variant, .tempo: "arrow.up"
        case .set: "checkmark.circle.fill"
        case .chain: "checkmark.seal.fill"
        }
    }

    var body: some View {
        HStack(spacing: 14) {
            ZStack {
                if event.kind.isCompletion {
                    Circle().stroke(color.opacity(0.22), lineWidth: 1)
                        .frame(width: 52, height: 52)
                        .scaleEffect(reduceMotion ? 1 : appeared ? 1.18 : 0.72)
                        .opacity(reduceMotion ? 1 : appeared ? 0 : 1)
                    if event.kind == .chain {
                        ForEach(0..<6) { index in
                            Capsule().fill(color.opacity(0.6)).frame(width: 2, height: 5)
                                .offset(y: reduceMotion ? -28 : appeared ? -32 : -20)
                                .rotationEffect(.degrees(Double(index) * 60))
                                .opacity(reduceMotion ? 1 : appeared ? 0 : 1)
                        }
                    }
                }
                Circle().stroke(color.opacity(0.18), lineWidth: 2).frame(width: 42, height: 42)
                Circle().trim(from: 0, to: appeared || reduceMotion ? event.progress : 0)
                    .stroke(color, style: StrokeStyle(lineWidth: 2, lineCap: .round))
                    .rotationEffect(.degrees(-90)).frame(width: 42, height: 42)
                Image(systemName: symbol).font(.system(size: event.kind.isCompletion ? 24 : 18, weight: .semibold))
                    .foregroundStyle(color)
                    .scaleEffect(reduceMotion ? 1 : appeared ? 1 : 0.8 - event.intensity * 0.1)
            }.frame(width: 52, height: 52)
            VStack(alignment: .leading, spacing: 3) {
                Text(event.title).font(.headline)
                Text(event.detail).font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
            }
        }
        .padding(.horizontal, 18).padding(.vertical, 12)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 22))
        .overlay(RoundedRectangle(cornerRadius: 22).stroke(.primary.opacity(0.08), lineWidth: 0.5))
        .frame(maxWidth: 320)
        .task {
            if reduceMotion { appeared = true }
            else { withAnimation(.spring(response: event.kind.isCompletion ? 0.65 : 0.4, dampingFraction: 0.7)) { appeared = true } }
        }
    }
}
