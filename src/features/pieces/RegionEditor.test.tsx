import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));
import { RegionEditor, TrickySectionsPanel } from "./RegionEditor";
import type { Region } from "./types";

afterEach(cleanup);
const region: Region = { id: 1, piece_id: 2, name: "legato", notes: "Shape the phrase", m_start: 1, m_end: 16, kind: "section", order: 0, color: null, pdf_anchor: null };
const other: Region = { ...region, id: 2, name: "coda", m_start: 17, m_end: 24 };

describe("RegionEditor", () => {
  beforeEach(() => invokeMock.mockReset().mockResolvedValue(region));

  it("saves the canonical title, practice notes, and measures in one region_update", async () => {
    render(<RegionEditor region={region} regions={[region, other]} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByText("Edit title, notes, measures or color"));
    fireEvent.change(screen.getByLabelText("Tricky section title"), { target: { value: "bridge" } });
    fireEvent.change(screen.getByLabelText("Tricky section practice notes"), { target: { value: "Read ahead" } });
    fireEvent.change(screen.getByLabelText("Tricky section start measure"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Tricky section end measure"), { target: { value: "18" } });
    fireEvent.click(screen.getByText("Save section"));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("region_update", {
      id: 1,
      patch: { name: "bridge", notes: "Read ahead", m_start: 3, m_end: 18 },
    }));
  });

  it("merges the current region into the chosen target", async () => {
    render(<RegionEditor region={region} regions={[region, other]} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByText("Edit title, notes, measures or color"));
    fireEvent.click(screen.getByText("Advanced section tools"));
    fireEvent.change(screen.getByLabelText("Merge target"), { target: { value: "2" } });
    fireEvent.click(screen.getByText("Merge"));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("region_merge", { idKeep: 2, idAbsorb: 1 }));
  });

  it("confirms and sends one atomic region_split command", async () => {
    const anchored = { ...region, pdf_anchor: { v: 1, editions: {} } };
    render(<RegionEditor region={anchored} regions={[anchored, other]} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByText("Edit title, notes, measures or color"));
    fireEvent.click(screen.getByText("Advanced section tools"));
    fireEvent.change(screen.getByLabelText("Split measure"), { target: { value: "9" } });
    fireEvent.click(screen.getByText("Split"));
    expect(screen.getByText(/All score boxes, highlights, and notes/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("region_split", { id: 1, splitAt: 9 }));
  });

  it("keeps a valid 146-character imported header editable", async () => {
    const longRegion = { ...region, name: "Read ahead ".repeat(13).trim() };
    expect(longRegion.name.length).toBeGreaterThan(120);
    render(<RegionEditor region={longRegion} regions={[longRegion]} alwaysOpen onChanged={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Tricky section practice notes"), { target: { value: "New cue" } });
    fireEvent.click(screen.getByText("Save section"));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("region_update", {
      id: 1,
      patch: { name: longRegion.name, notes: "New cue", m_start: 1, m_end: 16 },
    }));
  });

  it("sends null when practice notes are deliberately cleared", async () => {
    render(<RegionEditor region={region} regions={[region]} alwaysOpen onChanged={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Tricky section practice notes"), { target: { value: "" } });
    fireEvent.click(screen.getByText("Save section"));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("region_update", {
      id: 1,
      patch: { name: "legato", notes: null, m_start: 1, m_end: 16 },
    }));
  });

  it("shows Details tricky sections in the same measure order as Score", async () => {
    const later = { ...region, id: 7, name: "Later", m_start: 65, m_end: 80 };
    const earlier = { ...region, id: 8, name: "Earlier", m_start: 2, m_end: 8 };
    invokeMock.mockImplementation((command: string) => {
      if (command === "region_list") return Promise.resolve([later, earlier]);
      if (command === "rep_blocks_for_piece") return Promise.resolve([]);
      return Promise.resolve(undefined);
    });
    const { container } = render(<TrickySectionsPanel pieceId={2} />);
    await screen.findByText("Earlier");
    expect([...container.querySelectorAll(".tricky-section-card strong")].map((item) => item.textContent)).toEqual(["Earlier", "Later"]);
  });
});
