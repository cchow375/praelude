import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { LedgerWorkspace } from "./LedgerWorkspace";

// jsdom has NO window.localStorage — install the Map-backed shim (pattern
// copied from src/features/dock/dockState.test.ts). LedgerWorkspace reads/
// writes `ck.history.view` on every render.
beforeEach(() => {
  const memory = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => memory.set(key, value),
      removeItem: (key: string) => memory.delete(key),
      clear: () => memory.clear(),
      key: (index: number) => [...memory.keys()][index] ?? null,
      get length() {
        return memory.size;
      },
    },
  });
});

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation((command: string) => {
    if (command === "pieces_list")
      return Promise.resolve([
        {
          id: 1,
          title: "Scherzo",
          composer: "Chopin",
          has_xml: true,
          has_pdf: true,
          intake_done: true,
        },
        {
          id: 2,
          title: "Poem",
          composer: "Griffes",
          has_xml: true,
          has_pdf: true,
          intake_done: true,
        },
      ]);
    if (command === "region_list" || command === "rep_blocks_for_piece")
      return Promise.resolve([]);
    if (command === "progress_summary")
      return Promise.resolve({ per_region_mastery: [] });
    if (command === "history_days") return Promise.resolve([]);
    return Promise.resolve(null);
  });
});

afterEach(cleanup);

describe("LedgerWorkspace", () => {
  it("defaults to the Days view, with Pieces reachable behind the switch", async () => {
    render(<LedgerWorkspace />);

    const daysTab = await screen.findByRole("tab", { name: "Days" });
    expect(daysTab.getAttribute("aria-selected")).toBe("true");
    expect(
      screen.getByRole("tab", { name: "Pieces" }).getAttribute("aria-selected"),
    ).toBe("false");
    // Days is showing, so the Pieces content (piece index) is not mounted yet.
    expect(screen.queryByRole("heading", { name: "Scherzo" })).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Pieces" }));
    expect(
      await screen.findByRole("heading", { name: "Scherzo" }),
    ).toBeTruthy();
  });

  it("selects repertoire without duplicating the piece ledger projection", async () => {
    render(<LedgerWorkspace />);
    fireEvent.click(screen.getByRole("tab", { name: "Pieces" }));

    expect(
      await screen.findByRole("heading", { name: "Scherzo" }),
    ).toBeTruthy();
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("rep_blocks_for_piece", {
        pieceId: 1,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: /02PoemGriffes/ }));
    expect(await screen.findByRole("heading", { name: "Poem" })).toBeTruthy();
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("rep_blocks_for_piece", {
        pieceId: 2,
      }),
    );
  });

  it("opens the exact requested record and keeps native piece context synchronized", async () => {
    render(<LedgerWorkspace requestedPieceId={2} />);
    fireEvent.click(screen.getByRole("tab", { name: "Pieces" }));

    expect(await screen.findByRole("heading", { name: "Poem" })).toBeTruthy();
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("piece_select", { id: 2 }),
    );
    expect(invokeMock).toHaveBeenCalledWith("rep_blocks_for_piece", {
      pieceId: 2,
    });
  });

  it("drills piece → block summary row → reps via reps_for_block on expand", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "pieces_list")
        return Promise.resolve([
          {
            id: 1,
            title: "Scherzo",
            composer: "Chopin",
            has_xml: true,
            has_pdf: true,
            intake_done: true,
          },
        ]);
      if (command === "region_list") return Promise.resolve([]);
      if (command === "rep_blocks_for_piece")
        return Promise.resolve([
          {
            block_id: 55,
            m_start: 1,
            m_end: 8,
            label: "Opening drill",
            start_bpm: 60,
            bpm: 72,
            target_bpm: 92,
            planned_reps: 8,
            reps_done: 4,
            status: "open",
            verdicts: { clean: 3, flawed: 1, failed: 0 },
            region_id: null,
            focus: "notes",
            use_metronome: true,
            attempts_recorded: 4,
            mastery_status: "not_satisfied",
            mastery_verified: true,
          },
        ]);
      if (command === "progress_summary")
        return Promise.resolve({ per_region_mastery: [] });
      if (command === "reps_for_block")
        return Promise.resolve([
          {
            id: 9001,
            block_id: 55,
            ts: "2026-07-15T10:00:00Z",
            bpm: 72,
            variant: null,
            verdict: "clean",
            note: "steady",
            source: "user_click",
            active_adjustment_ids: [],
          },
        ]);
      return Promise.resolve(null);
    });

    render(<LedgerWorkspace />);
    fireEvent.click(screen.getByRole("tab", { name: "Pieces" }));
    // The block appears as a compact SUMMARY row (its title), not a wall of reps.
    expect(await screen.findByText("Opening drill")).toBeTruthy();
    expect(screen.queryByText("steady")).toBeNull();
    // Expanding the row is what loads the attempts — detail stays behind the
    // disclosure until asked for.
    fireEvent.click(screen.getByRole("button", { name: /Expand attempts/ }));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("reps_for_block", {
        blockId: 55,
      }),
    );
    expect(await screen.findByText("steady")).toBeTruthy();
  });

  it("surfaces a failed piece index instead of inventing empty evidence", async () => {
    invokeMock.mockRejectedValue(new Error("Database unavailable"));
    render(<LedgerWorkspace />);
    // Switch to Pieces immediately: with every command rejecting, staying on
    // Days would surface DayTimeline's OWN alert too, and findByRole("alert")
    // requires exactly one match.
    fireEvent.click(screen.getByRole("tab", { name: "Pieces" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Database unavailable",
    );
    expect(screen.queryByRole("heading", { name: "Scherzo" })).toBeNull();
  });
});
