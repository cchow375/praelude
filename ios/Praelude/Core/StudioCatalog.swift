import Foundation

/// One furnishing slot in the Studio room (§14), ported from the Mac's `StudioSlot`
/// (`src-tauri/src/store/studio/catalog.rs`).
public enum StudioSlot: String, CaseIterable, Codable, Sendable {
    case piano, seat, shelf, decor, room, theme

    public var title: String {
        switch self {
        case .piano: return "Instrument"
        case .seat: return "Seat"
        case .shelf: return "Shelf"
        case .decor: return "Decor"
        case .room: return "Room"
        case .theme: return "Palette"
        }
    }
}

/// One piece of furniture (§14). Ported near-verbatim from the Mac's catalog (same ids, names,
/// descriptions, slots, prices and unlock ranks) — the behavior half of "port and improve the Mac
/// reward system"; only the screen presenting it is new and native (never the Mac's UI).
public struct StudioItem: Identifiable, Equatable, Sendable {
    public let id: String
    public let name: String
    public let description: String
    public let slot: StudioSlot
    public let price: Int
    public let unlockRank: Int
}

/// A read-only "trophy case" rather than a spend-down shop: coins in this app's ledger only ever
/// move forward (see `RewardsEngine`'s doc on honesty), so a purchase that debits a balance would
/// need its own persisted, undoable transaction log — a new top-level collection this pass
/// deliberately avoids (see the track's report). Instead, a furnishing permanently unlocks once
/// lifetime coins and rank both clear its price/rank, and the room always shows the best unlocked
/// item per slot automatically — nothing to choose, buy or lose.
public enum StudioCatalog {
    public static let items: [StudioItem] = [
        StudioItem(id: "piano-digital", name: "First keys", description: "A simple electric piano. Every practice room starts somewhere.", slot: .piano, price: 0, unlockRank: 1),
        StudioItem(id: "piano-upright", name: "Walnut upright", description: "Warm wood and a familiar acoustic silhouette.", slot: .piano, price: 150, unlockRank: 2),
        StudioItem(id: "piano-baby-grand", name: "Baby grand", description: "A little more room for a growing repertoire.", slot: .piano, price: 500, unlockRank: 3),
        StudioItem(id: "piano-concert-grand", name: "Concert grand", description: "The centerpiece of your dream practice room.", slot: .piano, price: 1200, unlockRank: 5),

        StudioItem(id: "seat-box", name: "Humble beginnings", description: "The cardboard box you started with.", slot: .seat, price: 0, unlockRank: 1),
        StudioItem(id: "seat-stool", name: "Oak stool", description: "Your first proper place at the keyboard.", slot: .seat, price: 50, unlockRank: 1),
        StudioItem(id: "seat-bench", name: "Piano bench", description: "A classic bench in dark walnut.", slot: .seat, price: 150, unlockRank: 2),
        StudioItem(id: "seat-tufted", name: "Tufted bench", description: "A comfortable finishing touch for the long journey.", slot: .seat, price: 400, unlockRank: 4),

        StudioItem(id: "shelf-none", name: "Open wall", description: "Keep a little breathing room.", slot: .shelf, price: 0, unlockRank: 1),
        StudioItem(id: "shelf-oak", name: "Score shelf", description: "A home for the music you return to.", slot: .shelf, price: 75, unlockRank: 1),
        StudioItem(id: "shelf-library", name: "Music library", description: "A whole wall for a lifetime of music.", slot: .shelf, price: 350, unlockRank: 3),

        StudioItem(id: "decor-none", name: "Quiet space", description: "Nothing extra, just the music.", slot: .decor, price: 0, unlockRank: 1),
        StudioItem(id: "decor-plant", name: "Studio fern", description: "Something green beside the keys.", slot: .decor, price: 25, unlockRank: 1),
        StudioItem(id: "decor-lamp", name: "Reading light", description: "A warm pool of light for evening practice.", slot: .decor, price: 75, unlockRank: 1),
        StudioItem(id: "decor-table", name: "Walnut side table", description: "A place for a pencil, a notebook and the next idea.", slot: .decor, price: 100, unlockRank: 1),
        StudioItem(id: "decor-art", name: "Abstract study", description: "A framed composition for your studio wall.", slot: .decor, price: 200, unlockRank: 2),
        StudioItem(id: "decor-sculpture", name: "Resonance sculpture", description: "A small celebration of the time you have put in.", slot: .decor, price: 600, unlockRank: 4),

        StudioItem(id: "room-starter", name: "First room", description: "An open room with space to grow.", slot: .room, price: 0, unlockRank: 1),
        StudioItem(id: "room-oak", name: "Oak studio", description: "Warm timber and a softer afternoon light.", slot: .room, price: 250, unlockRank: 2),
        StudioItem(id: "room-loft", name: "City loft", description: "Tall windows, quiet evenings, your own corner of the city.", slot: .room, price: 750, unlockRank: 4),
        StudioItem(id: "room-conservatory", name: "Garden room", description: "Practice among the light and greenery.", slot: .room, price: 1500, unlockRank: 6),

        StudioItem(id: "theme-graphite", name: "Graphite", description: "The original neutral dark palette.", slot: .theme, price: 0, unlockRank: 1),
        StudioItem(id: "theme-sand", name: "Warm ivory", description: "A warm, paper-inspired studio palette.", slot: .theme, price: 100, unlockRank: 1),
        StudioItem(id: "theme-midnight", name: "Midnight", description: "A deep, quiet palette for after-hours practice.", slot: .theme, price: 250, unlockRank: 2),
        StudioItem(id: "theme-forest", name: "Forest", description: "A quiet green palette inspired by the outdoors.", slot: .theme, price: 400, unlockRank: 3),
    ]

    public static func items(in slot: StudioSlot) -> [StudioItem] { items.filter { $0.slot == slot }.sorted { $0.price < $1.price } }

    /// Whether lifetime coins and rank both clear this item's requirement.
    public static func isUnlocked(_ item: StudioItem, lifetimeCoins: Int, rank: Int) -> Bool {
        lifetimeCoins >= item.price && rank >= item.unlockRank
    }

    /// The best (highest-price, then highest-unlock-rank) unlocked item in each slot, for the room
    /// view to render automatically.
    public static func bestUnlocked(lifetimeCoins: Int, rank: Int) -> [StudioSlot: StudioItem] {
        var result: [StudioSlot: StudioItem] = [:]
        for slot in StudioSlot.allCases {
            let unlocked = items(in: slot).filter { isUnlocked($0, lifetimeCoins: lifetimeCoins, rank: rank) }
            if let best = unlocked.max(by: { ($0.price, $0.unlockRank) < ($1.price, $1.unlockRank) }) { result[slot] = best }
        }
        return result
    }

    /// The next locked item in `slot`, if any, and how many more coins it needs — for a "25 coins to
    /// the next shelf" style progress line.
    public static func nextLocked(in slot: StudioSlot, lifetimeCoins: Int, rank: Int) -> StudioItem? {
        items(in: slot).first { !isUnlocked($0, lifetimeCoins: lifetimeCoins, rank: rank) }
    }
}
