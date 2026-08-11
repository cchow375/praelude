import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installTauriDevMock, uninstallTauriDevMock } from "./tauriDevMock";

// `imslp_search`'s own branching (empty query -> [], multi-term AND-filter
// against the canned hits, and the "fail" dev affordance that rejects like a
// real network failure) is untested through the real dev mock — AddScore.test.tsx
// exercises the AddScore panel's UI against a `vi.mock("@tauri-apps/api/core")`
// stub instead, so this file's actual filtering/rejection code never runs
// there. The real backend's IMSLP search genuinely can fail over the network,
// which is exactly what the "fail" trigger simulates.

function seamInvoke<T>(cmd: string, args?: unknown): Promise<T> {
  const internals = (
    window as unknown as {
      __TAURI_INTERNALS__: { invoke: (c: string, a?: unknown) => Promise<T> };
    }
  ).__TAURI_INTERNALS__;
  return internals.invoke(cmd, args);
}

interface ImslpHit {
  title: string;
  page_id: number;
  snippet: string;
}

describe("dev-mock imslp_search handler", () => {
  beforeEach(() => installTauriDevMock());
  afterEach(() => uninstallTauriDevMock());

  it("returns an empty array for a blank query", async () => {
    const hits = await seamInvoke<ImslpHit[]>("imslp_search", { query: "  " });
    expect(hits).toEqual([]);
  });

  it("matches on every whitespace-separated term (AND, case-insensitive)", async () => {
    const hits = await seamInvoke<ImslpHit[]>("imslp_search", {
      query: "nocturnes chopin",
    });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((hit) => /nocturnes/i.test(hit.title))).toBe(true);
  });

  it("returns no matches for a query none of the canned hits satisfy", async () => {
    const hits = await seamInvoke<ImslpHit[]>("imslp_search", {
      query: "beethoven sonata",
    });
    expect(hits).toEqual([]);
  });

  it("rejects with a network-style error when the query contains 'fail'", async () => {
    await expect(
      seamInvoke("imslp_search", { query: "fail please" }),
    ).rejects.toThrow(
      "Could not reach IMSLP. Check your connection and try again.",
    );
  });
});
