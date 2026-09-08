import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { studioEquip, studioProfileSave, studioPurchase, studioSnapshot } from "../features/studio/studioApi";
import { installTauriDevMock, uninstallTauriDevMock } from "./tauriDevMock";

describe("Studio browser fixture at the real IPC seam", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
    installTauriDevMock();
  });
  afterEach(() => {
    uninstallTauriDevMock();
    window.history.replaceState(null, "", "/");
  });

  it("spends exactly once, equips the purchase, and keeps read snapshots independent", async () => {
    const initial = await studioSnapshot();
    expect(initial).toMatchObject({ revision: 0, progress: { total_xp: 350 }, wallet: { balance: 75 } });
    const plant = await studioPurchase("decor-plant", initial.revision);
    expect(plant).toMatchObject({ revision: 1, wallet: { balance: 50, spent_coins: 25 }, equipped: { decor: "decor-plant" } });
    await expect(studioPurchase("seat-stool", 0)).rejects.toBeTruthy();
    const seat = await studioPurchase("seat-stool", plant.revision);
    expect(seat.wallet.balance).toBe(0);
    await expect(studioPurchase("shelf-oak", seat.revision)).rejects.toBeTruthy();
    expect(await studioPurchase("seat-stool", seat.revision)).toEqual(seat);
    seat.equipped.piano = "local-edit";
    expect((await studioSnapshot()).equipped.piano).toBe("piano-digital");
    expect((await studioSnapshot()).progress.total_xp).toBe(350);
  });

  it("switches owned equipment without refunding coins and rejects locked equipment", async () => {
    const plant = await studioPurchase("decor-plant", 0);
    const quiet = await studioEquip("decor-none", plant.revision);
    expect(quiet.equipped.decor).toBe("decor-none");
    expect(quiet.wallet).toEqual(plant.wallet);
    expect(quiet.owned_item_ids).toContain("decor-plant");
    await expect(studioEquip("piano-concert-grand", quiet.revision)).rejects.toBeTruthy();
    await expect(studioPurchase("piano-concert-grand", quiet.revision)).rejects.toBeTruthy();
    expect(await studioSnapshot()).toEqual(quiet);
  });

  it("normalizes local names and rejects invalid edits without losing the saved profile", async () => {
    const saved = await studioProfileSave("  Clara   Schumann  ", 0);
    expect(saved.profile.display_name).toBe("Clara Schumann");
    await expect(studioProfileSave("Name", 0)).rejects.toBeTruthy();
    await expect(studioProfileSave("", 1)).rejects.toBeTruthy();
    await expect(studioProfileSave("x".repeat(41), 1)).rejects.toBeTruthy();
    await expect(studioProfileSave("New\nName", 1)).rejects.toBeTruthy();
    expect(await studioSnapshot()).toEqual(saved);
  });

  it("has honest blank and beyond-rank-ten visual fixtures", async () => {
    uninstallTauriDevMock();
    window.history.replaceState(null, "", "/?qaStudio=empty");
    installTauriDevMock();
    expect(await studioSnapshot()).toMatchObject({ progress: { total_xp: 0, rank_name: "Prelude", division: 1 }, wallet: { balance: 0 } });
    await expect(studioPurchase("decor-plant", 0)).rejects.toBeTruthy();
    uninstallTauriDevMock();
    window.history.replaceState(null, "", "/?qaStudio=encore");
    installTauriDevMock();
    expect(await studioSnapshot()).toMatchObject({ progress: { rank_index: 11, rank_name: "Encore 1", division: 1, division_xp_required: 600 } });
  });
});
