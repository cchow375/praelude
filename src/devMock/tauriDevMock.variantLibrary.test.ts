import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installTauriDevMock, uninstallTauriDevMock } from "./tauriDevMock";
import type { VariantLibrary } from "../features/rep/useVariantLibrary";

function invoke(command: string, args?: unknown): Promise<VariantLibrary> {
  return (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a?: unknown) => Promise<VariantLibrary> } }).__TAURI_INTERNALS__.invoke(command, args);
}
describe("variant library mock command contract", () => {
  beforeEach(() => installTauriDevMock());
  afterEach(() => uninstallTauriDevMock());
  it("round-trips names, visibility, and ordered routine copies without shared references", async () => {
    const library = await invoke("variant_library_get");
    library.custom_variants = ["  Feather   touch  "];
    library.hidden_variants = ["TENUTO"];
    library.routines = [{ id: "rhythm", name: "Rhythm", stages: [{ name: "dotted", clean_streak: 3 }, { name: "reverse dotted", clean_streak: 4 }, { name: "staccato", clean_streak: 5 }] }];
    const result = await invoke("variant_library_save", { library });
    expect(result).toMatchObject({ revision: 1, custom_variants: ["Feather touch"], hidden_variants: ["tenuto"] });
    result.routines[0].stages[0].name = "local edit";
    library.routines[0].stages.reverse();
    expect((await invoke("variant_library_get")).routines[0].stages.map(s => s.name)).toEqual(["dotted", "reverse dotted", "staccato"]);
  });
  it("rejects stale and invalid saves without losing prior library contents", async () => {
    const initial = await invoke("variant_library_get");
    const committed = await invoke("variant_library_save", { library: { ...initial, custom_variants: ["Feather touch"] } });
    await expect(invoke("variant_library_save", { library: initial })).rejects.toBeTruthy();
    await expect(invoke("variant_library_save", { library: { ...committed, custom_variants: ["DOTTED"] } })).rejects.toBeTruthy();
    expect(await invoke("variant_library_get")).toEqual(committed);
  });
});
