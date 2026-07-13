import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));
import { filterSortHistory, groupBlocksByRegion, HistoryPanel } from "./HistoryPanel";
import type { BlockHistory, Region } from "./types";

afterEach(cleanup);

const region: Region = { id: 1, piece_id: 1, name: "legato section", notes: null, m_start: 544, m_end: 570, kind: "section", order: 0, color: null, pdf_anchor: null };
const block: BlockHistory = { block_id: 9, region_id: 1, m_start: 544, m_end: 552, label: "bridge", start_bpm: 40, bpm: 44, target_bpm: 80, planned_reps: 10, reps_done: 6, status: "done", verdicts: { clean: 3, flawed: 2, failed: 1 }, focus: "tempo", use_metronome: true };

describe("HistoryPanel", () => {
  beforeEach(() => invokeMock.mockReset().mockImplementation((command: string) => {
    if (command === "region_list") return Promise.resolve([region]);
    if (command === "rep_blocks_for_piece") return Promise.resolve([block]);
    if (command === "progress_summary") return Promise.resolve({ piece_id: 1, focused_seconds: 10, streak: 1, best_tempo_reached: 44, time_by_focus: [], per_region_mastery: [{ region_id: 1, name: "legato section", blocks: 1, reps: 6, clean_ratio: 0.5, best_bpm: 44, last_practiced: "2026-07-12T12:00:00Z" }] });
    return Promise.resolve(null);
  }));

  it("groups blocks by stable region id and preserves ungrouped blocks", () => {
    const ungrouped = { ...block, block_id: 10, region_id: null };
    const groups = groupBlocksByRegion([block, ungrouped], [region]);
    expect(groups.map((group) => group.region?.name ?? "Ungrouped")).toEqual(["legato section", "Ungrouped"]);
  });

  it("renders a compact region summary", async () => {
    render(<HistoryPanel pieceId={1} />);
    await waitFor(() => expect(screen.getAllByText("legato section").length).toBeGreaterThan(0));
    expect(screen.getByText(/1 block · best ♩44/)).toBeTruthy();
  });

  it("filters by a measure token and sorts by measure", () => {
    const laterRegion = { ...region, id: 2, name: "B (mm.544-552)", m_start: 544, m_end: 552 };
    const earlyRegion = { ...region, id: 3, name: "A", m_start: 1, m_end: 8 };
    const groups = [
      { region: laterRegion, blocks: [{ ...block, region_id: 2 }], mastery: null },
      { region: earlyRegion, blocks: [{ ...block, region_id: 3, m_start: 1, m_end: 8 }], mastery: null },
    ];
    const output = filterSortHistory(groups, { query: "544", sort: "by-measure" });
    expect(output.map((group) => group.region?.name)).toEqual(["B (mm.544-552)"]);
  });
});
