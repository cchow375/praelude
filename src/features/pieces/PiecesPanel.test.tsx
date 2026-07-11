import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mock the Tauri IPC surface. PiecesPanel + PieceDetail only use `invoke`; the
// mock dispatches per command name so a test can drive scan / select / intake.
// ---------------------------------------------------------------------------
const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { PiecesPanel } from "./PiecesPanel";
import type { PieceDetailData, PieceSummary } from "./types";

const LISZT: PieceSummary = {
  id: 1,
  title: "Liebestraum No. 3",
  composer: "Liszt",
  has_xml: true,
  has_pdf: false,
  intake_done: false,
};
const SATIE: PieceSummary = {
  id: 2,
  title: "Gymnopédie No. 1",
  composer: "Satie",
  has_xml: true,
  has_pdf: true,
  intake_done: true,
};

function detailOf(p: PieceSummary, over: Partial<PieceDetailData> = {}): PieceDetailData {
  return {
    ...p,
    folder_path: `/pieces/${p.id}`,
    xml_path: null,
    pdf_path: null,
    goals: [],
    deadline: null,
    target_tempo: null,
    hard_spots: [],
    current_state: null,
    notes: null,
    ...over,
  };
}

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue([]);
});

afterEach(cleanup);

describe("PiecesPanel", () => {
  it("lists pieces from pieces_list with XML/PDF/needs-intake badges", async () => {
    invokeMock.mockImplementation((cmd: string) =>
      cmd === "pieces_list" ? Promise.resolve([LISZT, SATIE]) : Promise.resolve([]),
    );

    render(<PiecesPanel onOpenBlock={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("Liebestraum No. 3")).toBeTruthy());
    expect(screen.getByText("Gymnopédie No. 1")).toBeTruthy();
    // Liszt: XML + needs intake; Satie: XML + PDF (intake done).
    expect(screen.getByText("needs intake")).toBeTruthy();
    expect(screen.getAllByText("XML")).toHaveLength(2);
    expect(screen.getByText("PDF")).toBeTruthy();
  });

  it("rescans via pieces_scan when the scan button is clicked", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "pieces_list") return Promise.resolve([]);
      if (cmd === "pieces_scan") return Promise.resolve([SATIE]);
      return Promise.resolve([]);
    });

    render(<PiecesPanel onOpenBlock={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("No pieces yet.")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Rescan pieces folder" }));

    await waitFor(() => expect(screen.getByText("Gymnopédie No. 1")).toBeTruthy());
    expect(invokeMock).toHaveBeenCalledWith("pieces_scan");
  });

  it("selects a piece: piece_select + piece_get, then shows the intake form when intake is undone", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "pieces_list") return Promise.resolve([LISZT]);
      if (cmd === "piece_select") return Promise.resolve(undefined);
      if (cmd === "piece_get") return Promise.resolve(detailOf(LISZT));
      if (cmd === "rep_blocks_for_piece") return Promise.resolve([]);
      return Promise.resolve([]);
    });

    render(<PiecesPanel onOpenBlock={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Liebestraum No. 3")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /Liebestraum No\. 3/ }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save intake" })).toBeTruthy(),
    );
    expect(invokeMock).toHaveBeenCalledWith("piece_select", { id: 1 });
    expect(invokeMock).toHaveBeenCalledWith("piece_get", { id: 1 });
  });

  it("shows summary + block form (not intake) for a piece with intake done", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "pieces_list") return Promise.resolve([SATIE]);
      if (cmd === "piece_select") return Promise.resolve(undefined);
      if (cmd === "piece_get")
        return Promise.resolve(detailOf(SATIE, { goals: ["from memory"], target_tempo: 120 }));
      if (cmd === "rep_blocks_for_piece") return Promise.resolve([]);
      return Promise.resolve([]);
    });

    render(<PiecesPanel onOpenBlock={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Gymnopédie No. 1")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /Gymnopédie No\. 1/ }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Open block" })).toBeTruthy(),
    );
    expect(screen.getByText("from memory")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save intake" })).toBeNull();
  });
});
