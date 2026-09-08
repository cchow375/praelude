// Disposable browser QA fixture. Production imports no devMock code and derives XP in Rust.
import type { StudioEquipped, StudioItem, StudioSnapshot } from "../features/studio/studioApi";

const CATALOG: StudioItem[] = [
  {
    "id": "piano-digital",
    "name": "First keys",
    "description": "A simple electric piano. Every practice room starts somewhere.",
    "slot": "piano",
    "price": 0,
    "unlock_rank": 1
  },
  {
    "id": "piano-upright",
    "name": "Walnut upright",
    "description": "Warm wood and a familiar acoustic silhouette.",
    "slot": "piano",
    "price": 150,
    "unlock_rank": 2
  },
  {
    "id": "piano-baby-grand",
    "name": "Baby grand",
    "description": "A little more room for a growing repertoire.",
    "slot": "piano",
    "price": 500,
    "unlock_rank": 3
  },
  {
    "id": "piano-concert-grand",
    "name": "Concert grand",
    "description": "The centerpiece of your dream practice room.",
    "slot": "piano",
    "price": 1200,
    "unlock_rank": 5
  },
  {
    "id": "seat-box",
    "name": "Humble beginnings",
    "description": "The cardboard box you started with.",
    "slot": "seat",
    "price": 0,
    "unlock_rank": 1
  },
  {
    "id": "seat-stool",
    "name": "Oak stool",
    "description": "Your first proper place at the keyboard.",
    "slot": "seat",
    "price": 50,
    "unlock_rank": 1
  },
  {
    "id": "seat-bench",
    "name": "Piano bench",
    "description": "A classic bench in dark walnut.",
    "slot": "seat",
    "price": 150,
    "unlock_rank": 2
  },
  {
    "id": "seat-tufted",
    "name": "Tufted bench",
    "description": "A comfortable finishing touch for the long journey.",
    "slot": "seat",
    "price": 400,
    "unlock_rank": 4
  },
  {
    "id": "shelf-none",
    "name": "Open wall",
    "description": "Keep a little breathing room.",
    "slot": "shelf",
    "price": 0,
    "unlock_rank": 1
  },
  {
    "id": "shelf-oak",
    "name": "Score shelf",
    "description": "A home for the music you return to.",
    "slot": "shelf",
    "price": 75,
    "unlock_rank": 1
  },
  {
    "id": "shelf-library",
    "name": "Music library",
    "description": "A whole wall for a lifetime of music.",
    "slot": "shelf",
    "price": 350,
    "unlock_rank": 3
  },
  {
    "id": "decor-none",
    "name": "Quiet space",
    "description": "Nothing extra, just the music.",
    "slot": "decor",
    "price": 0,
    "unlock_rank": 1
  },
  {
    "id": "decor-plant",
    "name": "Studio fern",
    "description": "Something green beside the keys.",
    "slot": "decor",
    "price": 25,
    "unlock_rank": 1
  },
  {
    "id": "decor-lamp",
    "name": "Reading light",
    "description": "A warm pool of light for evening practice.",
    "slot": "decor",
    "price": 75,
    "unlock_rank": 1
  },
  {
    "id": "decor-table",
    "name": "Walnut side table",
    "description": "A place for a pencil, a notebook and the next idea.",
    "slot": "decor",
    "price": 100,
    "unlock_rank": 1
  },
  {
    "id": "decor-art",
    "name": "Abstract study",
    "description": "A framed composition for your studio wall.",
    "slot": "decor",
    "price": 200,
    "unlock_rank": 2
  },
  {
    "id": "decor-sculpture",
    "name": "Resonance sculpture",
    "description": "A small celebration of the time you have put in.",
    "slot": "decor",
    "price": 600,
    "unlock_rank": 4
  },
  {
    "id": "room-starter",
    "name": "First room",
    "description": "An open room with space to grow.",
    "slot": "room",
    "price": 0,
    "unlock_rank": 1
  },
  {
    "id": "room-oak",
    "name": "Oak studio",
    "description": "Warm timber and a softer afternoon light.",
    "slot": "room",
    "price": 250,
    "unlock_rank": 2
  },
  {
    "id": "room-loft",
    "name": "City loft",
    "description": "Tall windows, quiet evenings, your own corner of the city.",
    "slot": "room",
    "price": 750,
    "unlock_rank": 4
  },
  {
    "id": "room-conservatory",
    "name": "Garden room",
    "description": "Practice among the light and greenery.",
    "slot": "room",
    "price": 1500,
    "unlock_rank": 6
  },
  {
    "id": "theme-graphite",
    "name": "Graphite",
    "description": "The original neutral dark palette.",
    "slot": "theme",
    "price": 0,
    "unlock_rank": 1
  },
  {
    "id": "theme-sand",
    "name": "Warm ivory",
    "description": "A warm, paper-inspired studio palette.",
    "slot": "theme",
    "price": 100,
    "unlock_rank": 1
  },
  {
    "id": "theme-midnight",
    "name": "Midnight",
    "description": "A deep blue palette for after-hours practice.",
    "slot": "theme",
    "price": 250,
    "unlock_rank": 2
  },
  {
    "id": "theme-forest",
    "name": "Forest",
    "description": "A quiet green palette inspired by the outdoors.",
    "slot": "theme",
    "price": 400,
    "unlock_rank": 3
  }
];

const RANKS = ["Prelude", "Etude", "Arabesque", "Nocturne", "Scherzo", "Sonata", "Rhapsody", "Concerto", "Cadenza", "Opus"];
let saved: StudioSnapshot;

export function resetStudioMock(): void {
  const fixture = new URLSearchParams(window.location.search).get("qaStudio");
  const totalXp = fixture === "empty" ? 0 : fixture === "encore" ? 32500 : 350;
  let rank = 1, divisionCost = 100, remainder = totalXp;
  while (remainder >= divisionCost * 10) {
    remainder -= divisionCost * 10;
    rank += 1;
    divisionCost += 50;
  }
  const completed = (rank - 1) * 10 + Math.floor(remainder / divisionCost);
  const equipped = Object.fromEntries(CATALOG.filter(item => item.price === 0).map(item => [item.slot, item.id])) as StudioEquipped;
  const setXp = totalXp === 0 ? 0 : 2;
  saved = {
    revision: 0,
    profile: { display_name: "Pianist" },
    progress: {
      total_xp: totalXp, focused_seconds: (totalXp - setXp) * 600, focus_xp: totalXp - setXp, set_xp: setXp,
      completed_sets: totalXp === 0 ? 0 : 6, current_session_sets: totalXp === 0 ? 0 : 5,
      next_set_milestone: totalXp === 0 ? 3 : 7,
      rank_index: rank, rank_name: RANKS[rank - 1] ?? `Encore ${rank - 10}`,
      division: Math.floor(remainder / divisionCost) + 1, division_xp: remainder % divisionCost,
      division_xp_required: divisionCost, divisions_completed: completed,
    },
    wallet: { earned_coins: completed * 25, spent_coins: 0, balance: completed * 25 },
    owned_item_ids: Object.values(equipped).sort(), equipped, catalog: structuredClone(CATALOG),
  };
}

export function studioSnapshotMock(): StudioSnapshot {
  if (new URLSearchParams(window.location.search).get("qaStudio") === "error") throw new Error("Studio fixture could not be loaded. Try again.");
  if (!saved) resetStudioMock();
  return structuredClone(saved);
}

export function studioMutationMock(command: string, args: Record<string, unknown>): StudioSnapshot {
  if (!saved) resetStudioMock();
  if (!Number.isSafeInteger(args.expectedRevision) || args.expectedRevision !== saved.revision) {
    throw new Error("Studio changed elsewhere. Refresh it before trying again.");
  }
  const next = structuredClone(saved);
  if (command === "studio_profile_save") {
    if (typeof args.displayName !== "string" || /[\u0000-\u001f\u007f-\u009f]/.test(args.displayName)) throw new Error("Display name cannot contain control characters.");
    const name = args.displayName.trim().replace(/\s+/g, " ");
    if (!name || [...name].length > 40) throw new Error("Choose a display name with 1–40 characters.");
    next.profile.display_name = name;
  } else if (command === "studio_purchase" || command === "studio_equip") {
    const item = CATALOG.find(item => item.id === args.itemId);
    if (!item) throw new Error("That Studio item does not exist.");
    const owned = next.owned_item_ids.includes(item.id);
    if (command === "studio_purchase" && !owned) {
      if (next.progress.rank_index < item.unlock_rank) throw new Error(`This item unlocks at rank ${item.unlock_rank}.`);
      if (next.wallet.balance < item.price) throw new Error("Keep practicing to earn enough coins for this item.");
      next.owned_item_ids = [...next.owned_item_ids, item.id].sort();
      next.wallet.spent_coins += item.price;
      next.wallet.balance -= item.price;
    } else if (!owned) throw new Error("Unlock this item before adding it to your room.");
    next.equipped[item.slot] = item.id;
  } else throw new Error("Unknown Studio fixture command.");
  if (JSON.stringify(next) !== JSON.stringify(saved)) {
    next.revision += 1;
    saved = next;
  }
  return studioSnapshotMock();
}
