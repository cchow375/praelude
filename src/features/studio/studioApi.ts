import { invoke } from "@tauri-apps/api/core";

export type StudioSlot =
  "piano" | "seat" | "shelf" | "decor" | "room" | "theme";
export type StudioEquipped = Record<StudioSlot, string>;

export interface StudioItem {
  id: string;
  name: string;
  description: string;
  slot: StudioSlot;
  price: number;
  unlock_rank: number;
}

export interface StudioProgress {
  total_xp: number;
  focused_seconds: number;
  focus_xp: number;
  set_xp: number;
  completed_sets: number;
  current_session_sets: number;
  next_set_milestone: number | null;
  rank_index: number;
  rank_name: string;
  division: number;
  division_xp: number;
  division_xp_required: number;
  divisions_completed: number;
}

export interface StudioSnapshot {
  revision: number;
  profile: { display_name: string };
  progress: StudioProgress;
  wallet: { earned_coins: number; spent_coins: number; balance: number };
  owned_item_ids: string[];
  equipped: StudioEquipped;
  catalog: StudioItem[];
}

export function studioSnapshot(): Promise<StudioSnapshot> {
  return invoke("studio_snapshot");
}

export function studioPurchase(
  itemId: string,
  expectedRevision: number,
): Promise<StudioSnapshot> {
  return invoke("studio_purchase", { itemId, expectedRevision });
}

export function studioEquip(
  itemId: string,
  expectedRevision: number,
): Promise<StudioSnapshot> {
  return invoke("studio_equip", { itemId, expectedRevision });
}

export function studioProfileSave(
  displayName: string,
  expectedRevision: number,
): Promise<StudioSnapshot> {
  return invoke("studio_profile_save", { displayName, expectedRevision });
}
