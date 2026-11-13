import Foundation

/// The "share milestones to feed auto/manual" hook (§14/§5). Social (§5: feed, friends, presence) is
/// entirely unimplemented today (see "(C) Audit.md" §5), so there is nowhere yet to auto-post a
/// milestone. This protocol is the seam the social track implements against, so wiring a future feed
/// publisher in never touches `RewardsRuntime`'s call site again — only which publisher it is handed.
///
/// Manual sharing does not need the feed to exist: `MilestoneShareCard.text(for:profile:)` renders a
/// plain, shareable description of a milestone that `RewardsView` hands to the system share sheet
/// (`ShareLink`) today, independent of this protocol.
public protocol MilestoneSharePublisher: Sendable {
    /// Called after a milestone is durably recorded. Implementations should not throw for an
    /// unreachable or not-signed-in backend; log and return instead, the same way today's app never
    /// lets an optional side effect fail a saved practice event.
    func publish(_ event: MilestoneEvent, profile: Profile) async
}

/// The default publisher while no social/backend track exists: a deliberate no-op, not a stub that
/// silently pretends to succeed at something real. `RewardsRuntime` is handed this until a future
/// track supplies a real one.
public struct NullMilestoneSharePublisher: MilestoneSharePublisher {
    public init() {}
    public func publish(_ event: MilestoneEvent, profile: Profile) async {}
}

/// Plain, human copy for a milestone — used for manual sharing today (a `ShareLink` text) and
/// reusable as-is by whatever auto-share feed row a future social track renders.
public enum MilestoneShareCard {
    public static func text(for event: MilestoneEvent) -> String {
        guard let kind = MilestoneKind(rawValue: event.kind) else { return event.detail }
        switch kind {
        case .passageReady: return "Performance-ready on Praelude: \(event.detail)"
        case .pieceReady: return "Praelude: \(event.detail)"
        case .rankUp: return "Praelude \(event.detail)"
        case .streakMilestone: return "Praelude \(event.detail)"
        }
    }
}
