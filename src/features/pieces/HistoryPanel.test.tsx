import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
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

  it("preserves missing-region blocks in deterministic groups distinct from true ungrouped", () => {
    const missingSeven = { ...block, block_id: 11, region_id: 7, label: "missing seven" };
    const missingThree = { ...block, block_id: 12, region_id: 3, label: "missing three" };
    const ungrouped = { ...block, block_id: 13, region_id: null, label: "actually ungrouped" };

    const groups = groupBlocksByRegion(
      [missingSeven, ungrouped, block, missingThree],
      [region],
    );

    expect(groups.map((group) => group.region?.id ?? group.unavailableRegionId ?? null)).toEqual([
      1,
      3,
      7,
      null,
    ]);
    expect(groups[1].blocks).toEqual([missingThree]);
    expect(groups[2].blocks).toEqual([missingSeven]);
    expect(groups[3].blocks).toEqual([ungrouped]);
  });

  it("renders a compact region summary", async () => {
    render(<HistoryPanel pieceId={1} />);
    await waitFor(() => expect(screen.getAllByText("legato section").length).toBeGreaterThan(0));
    expect(screen.getByText(/1 set · best ♩44/)).toBeTruthy();
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

  it("ignores an older piece refresh that resolves after the current piece", async () => {
    const oldBlock = { ...block, block_id: 101, region_id: null, label: "stale piece set" };
    const newBlock = { ...block, block_id: 202, region_id: null, label: "current piece set" };
    let resolveOld: (value: BlockHistory[]) => void = () => undefined;
    const oldRequest = new Promise<BlockHistory[]>((resolve) => { resolveOld = resolve; });
    invokeMock.mockImplementation((command: string, args?: { pieceId?: number }) => {
      if (command === "region_list") return Promise.resolve([]);
      if (command === "rep_blocks_for_piece") {
        return args?.pieceId === 1 ? oldRequest : Promise.resolve([newBlock]);
      }
      if (command === "progress_summary") {
        return Promise.resolve({
          piece_id: args?.pieceId ?? 0,
          focused_seconds: 0,
          streak: 0,
          best_tempo_reached: null,
          time_by_focus: [],
          per_region_mastery: [],
        });
      }
      return Promise.resolve(null);
    });
    const view = render(<HistoryPanel pieceId={1} />);
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith(
      "rep_blocks_for_piece",
      { pieceId: 1 },
    ));

    view.rerender(<HistoryPanel pieceId={2} />);
    expect(await screen.findByText("current piece set")).toBeTruthy();
    await act(async () => { resolveOld([oldBlock]); await oldRequest; });

    expect(screen.queryByText("stale piece set")).toBeNull();
    expect(screen.getByText("current piece set")).toBeTruthy();
  });

  it("clears the old piece generation and surfaces region and summary failures with current blocks", async () => {
    const currentBlock = {
      ...block,
      block_id: 303,
      region_id: 77,
      label: "current partial piece set",
    };
    invokeMock.mockImplementation((command: string, args?: { pieceId?: number }) => {
      if (args?.pieceId === 1) {
        if (command === "region_list") return Promise.resolve([region]);
        if (command === "rep_blocks_for_piece") return Promise.resolve([block]);
        if (command === "progress_summary") {
          return Promise.resolve({
            piece_id: 1,
            focused_seconds: 10,
            streak: 1,
            best_tempo_reached: 44,
            time_by_focus: [],
            per_region_mastery: [{ region_id: 1, name: region.name, blocks: 1, reps: 6, clean_ratio: 0.5, best_bpm: 44, last_practiced: "2026-07-12T12:00:00Z" }],
          });
        }
      }
      if (command === "region_list") {
        return Promise.reject({ code: "region_read_failed", message: "Current sections are unavailable." });
      }
      if (command === "rep_blocks_for_piece") return Promise.resolve([currentBlock]);
      if (command === "progress_summary") {
        return Promise.reject({ code: "summary_read_failed", message: "Current progress summary is unavailable." });
      }
      return Promise.resolve(null);
    });
    const view = render(<HistoryPanel pieceId={1} />);
    expect(await screen.findByText("bridge")).toBeTruthy();
    expect(screen.getAllByText("legato section").length).toBeGreaterThan(0);

    view.rerender(<HistoryPanel pieceId={2} />);
    expect(screen.getByText("Loading history…")).toBeTruthy();
    expect(screen.queryByText("bridge")).toBeNull();
    expect(screen.queryByText("legato section")).toBeNull();

    expect(await screen.findByText("current partial piece set")).toBeTruthy();
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Current sections are unavailable.");
    expect(alert.textContent).toContain("Current progress summary is unavailable.");
    expect(screen.getByText("Section metadata unavailable")).toBeTruthy();
    expect(screen.getAllByText("mm. 544–552").length).toBeGreaterThan(0);
    expect(screen.queryByText("Ungrouped")).toBeNull();
    expect(document.body.textContent).not.toContain("#77");
    expect(document.body.textContent).not.toContain("77");
    expect(screen.queryByText(/best ♩44/)).toBeNull();
  });

  it("enters a clean loading generation on explicit refresh", async () => {
    const refreshedBlock = { ...block, block_id: 404, region_id: null, label: "refreshed set" };
    let refreshing = false;
    let resolveRegions: (value: Region[]) => void = () => undefined;
    let resolveBlocks: (value: BlockHistory[]) => void = () => undefined;
    let resolveSummary: (value: object) => void = () => undefined;
    const pendingRegions = new Promise<Region[]>((resolve) => { resolveRegions = resolve; });
    const pendingBlocks = new Promise<BlockHistory[]>((resolve) => { resolveBlocks = resolve; });
    const pendingSummary = new Promise<object>((resolve) => { resolveSummary = resolve; });
    invokeMock.mockImplementation((command: string) => {
      if (!refreshing) {
        if (command === "region_list") return Promise.resolve([region]);
        if (command === "rep_blocks_for_piece") return Promise.resolve([block]);
        if (command === "progress_summary") {
          return Promise.resolve({ piece_id: 1, focused_seconds: 0, streak: 0, best_tempo_reached: 44, time_by_focus: [], per_region_mastery: [] });
        }
      }
      if (command === "region_list") return pendingRegions;
      if (command === "rep_blocks_for_piece") return pendingBlocks;
      if (command === "progress_summary") return pendingSummary;
      return Promise.resolve(null);
    });
    const view = render(<HistoryPanel pieceId={1} refreshToken={0} />);
    expect(await screen.findByText("bridge")).toBeTruthy();

    refreshing = true;
    view.rerender(<HistoryPanel pieceId={1} refreshToken={1} />);
    expect(screen.getByText("Loading history…")).toBeTruthy();
    expect(screen.queryByText("bridge")).toBeNull();

    await act(async () => {
      resolveRegions([]);
      resolveBlocks([refreshedBlock]);
      resolveSummary({ piece_id: 1, focused_seconds: 0, streak: 0, best_tempo_reached: null, time_by_focus: [], per_region_mastery: [] });
      await Promise.all([pendingRegions, pendingBlocks, pendingSummary]);
    });
    expect(await screen.findByText("refreshed set")).toBeTruthy();
    expect(screen.queryByText("bridge")).toBeNull();
  });
});
