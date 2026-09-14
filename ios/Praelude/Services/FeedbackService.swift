import UIKit

/// Call only after a new verdict has been saved. Feedback never participates in persistence.
@MainActor
final class FeedbackService {
    static let shared = FeedbackService()
    var isEnabled = true
    private init() {}

    func verdictSaved(completedSet: Bool = false) {
        guard isEnabled else { return }
        if completedSet {
            UINotificationFeedbackGenerator().notificationOccurred(.success)
        } else {
            UIImpactFeedbackGenerator(style: .soft).impactOccurred(intensity: 0.65)
        }
    }
}
