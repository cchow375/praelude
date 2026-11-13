import Foundation
import Observation
import Realtime

/// Live "practicing now" (spec §5a) over Supabase Realtime Presence, layered on top of the
/// `presence` table fallback `SocialService.setPresence`/`friendPresence()` already read/write
/// (`supabase/(C) Backend.md`, "Presence: table + Realtime, not table alone" — that doc explicitly
/// leaves the exact channel shape to "the iOS integration track").
///
/// **Channel topology, and why**: one topic per user, `"presence:<userID>"`. Every channel this
/// service opens sets `config.isPrivate = true` (Supabase Realtime Authorization —
/// https://supabase.com/docs/guides/realtime/authorization, linked from `RealtimeChannelConfig.
/// isPrivate`'s own doc comment in the SDK), which routes every subscribe/track attempt through the
/// `realtime.messages` RLS policies `supabase/migrations/20260926220021_presence_realtime_
/// authorization.sql` adds: `presence_topic_select_own_or_friend` (receive) checks
/// `can_receive_presence()` — the owner themself, or a non-blocked accepted friend whose
/// `privacy_presence` allows it, exactly mirroring `friend_presence()`'s own table-fallback predicate
/// — and `presence_topic_insert_own` (track/publish) restricts to the topic's own owner, so nothing
/// can announce fake presence on someone else's topic either. This used to be a client-side-only
/// boundary (a viewer could only reach a topic by already knowing the friend's id, from an
/// already-gated read) with **no server enforcement at all** — fixed in the migration above; see its
/// own header for exactly what was, and was not, independently re-verified about how Realtime
/// evaluates these policies. Piece-title exposure on top of "is this person practicing" is a further,
/// separate privacy gate — see `SocialService.friendPresencePieceTitle(owner:pieceID:)`.
///
/// **Degrades gracefully offline**: every entry point is wrapped so a connection failure (no network,
/// Realtime unreachable) never throws into a caller or leaves `livePracticing` in a stuck state —
/// `SocialService.friendPresence()`'s table read remains the source of truth a view can always fall
/// back to; this service only ever adds faster, live updates on top when it can.
@MainActor @Observable
public final class PresenceService {
    private let services: SupabaseServices
    private let auth: AuthManager
    private let social: SocialService
    private var client: RealtimeClientV2?
    private var friendChannels: [UUID: RealtimeChannelV2] = [:]
    private var friendSubscriptions: [UUID: RealtimeSubscription] = [:]
    private var ownChannel: RealtimeChannelV2?
    private var connectTask: Task<RealtimeClientV2?, Never>?

    /// The latest live-tracked state per friend id this device has subscribed to. A friend absent
    /// from this dictionary has simply never been subscribed to (or their socket hasn't announced
    /// itself yet) — `nil` here does not mean "not practicing"; callers fall back to
    /// `SocialService.friendPresence()`'s table read for that case.
    public private(set) var livePracticing: [UUID: Bool] = [:]
    private var myLastPublished: LivePresenceState?

    public init(services: SupabaseServices, auth: AuthManager, social: SocialService) {
        self.services = services
        self.auth = auth
        self.social = social
    }

    private func connectedClient() async -> RealtimeClientV2? {
        if let connectTask { return await connectTask.value }
        let task = Task<RealtimeClientV2?, Never> { [services] in
            let realtimeURL = SupabaseConfig.projectURL.appendingPathComponent("realtime/v1")
            let options = RealtimeClientOptions(
                headers: ["apikey": SupabaseConfig.publishableKey],
                accessToken: { try? await services.auth.session.accessToken }
            )
            let client = RealtimeClientV2(url: realtimeURL, options: options)
            await client.connect()
            return client
        }
        connectTask = task
        let value = await task.value
        client = value
        return value
    }

    // MARK: Publishing my own presence

    /// Called from the app root whenever `PracticeStore.activeSet` changes (running vs. not) —
    /// idempotent, safe to call on every change even when the state didn't actually flip.
    public func publish(isPracticing: Bool, pieceID: UUID?) {
        guard case .signedIn = auth.state else { return }
        let state = LivePresenceState(isPracticing: isPracticing, pieceID: pieceID)
        guard state != myLastPublished else { return }
        myLastPublished = state
        Task {
            // The table fallback always gets written, even if the Realtime leg below never connects.
            await social.setPresence(isPracticing: isPracticing, pieceID: pieceID)
            guard let client = await connectedClient(), let me = social.myUserID else { return }
            let channel = ownChannel ?? client.channel("presence:\(me.uuidString)") { config in
                config.presence = PresenceJoinConfig(key: me.uuidString)
                config.isPrivate = true
            }
            if ownChannel == nil {
                ownChannel = channel
                try? await channel.subscribeWithError()
            }
            try? await channel.track(state)
        }
    }

    /// Sign-out / app-background-long-enough-to-stop-practicing: stop announcing presence at all
    /// (distinct from `publish(isPracticing: false, ...)`, which still leaves the channel joined).
    public func stopPublishing() {
        myLastPublished = nil
        guard let ownChannel else { return }
        self.ownChannel = nil
        Task { await ownChannel.untrack(); await ownChannel.unsubscribe() }
    }

    // MARK: Observing friends

    /// Subscribes to exactly this set of friends' presence topics, unsubscribing from any this
    /// device was previously watching but that dropped out of the list (e.g. the Friends tab's
    /// visible card list changed). Cheap to call repeatedly with the same set.
    public func observe(friendIDs: [UUID]) {
        guard case .signedIn = auth.state else { return }
        let wanted = Set(friendIDs)
        for id in Array(friendChannels.keys) where !wanted.contains(id) { stopObserving(id) }
        let toAdd = wanted.subtracting(friendChannels.keys)
        guard !toAdd.isEmpty else { return }
        Task {
            guard let client = await connectedClient() else { return }
            for id in toAdd where friendChannels[id] == nil {
                let channel = client.channel("presence:\(id.uuidString)") { config in
                    config.presence = PresenceJoinConfig(key: id.uuidString)
                    config.isPrivate = true
                }
                friendChannels[id] = channel
                friendSubscriptions[id] = channel.onPresenceChange { [weak self] action in
                    Task { @MainActor in self?.apply(action, for: id) }
                }
                try? await channel.subscribeWithError()
            }
        }
    }
    public func stopObservingAll() {
        for id in Array(friendChannels.keys) { stopObserving(id) }
        livePracticing.removeAll()
    }
    private func stopObserving(_ id: UUID) {
        let channel = friendChannels.removeValue(forKey: id)
        friendSubscriptions.removeValue(forKey: id)
        livePracticing.removeValue(forKey: id)
        guard let channel else { return }
        Task { await channel.unsubscribe() }
    }
    private func apply(_ action: any PresenceAction, for friendID: UUID) {
        for presence in action.joins.values {
            guard let state = try? presence.decodeState(as: LivePresenceState.self) else { continue }
            livePracticing[friendID] = state.isPracticing
        }
        if !action.leaves.isEmpty { livePracticing[friendID] = false }
    }
}
