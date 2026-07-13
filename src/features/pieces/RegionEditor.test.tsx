import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));
import { RegionEditor } from "./RegionEditor";
import type { Region } from "./types";

afterEach(cleanup);
const region: Region = { id: 1, piece_id: 2, name: "legato", m_start: 1, m_end: 16, kind: "section", order: 0, color: null, pdf_anchor: null };
const other: Region = { ...region, id: 2, name: "coda", m_start: 17, m_end: 24 };

describe("RegionEditor", () => {
  beforeEach(() => invokeMock.mockReset().mockResolvedValue(region));

  it("saves the canonical note and measures in one region_update", async () => {
    render(<RegionEditor region={region} regions={[region, other]} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByText("Edit note, measures, color or delete"));
    fireEvent.change(screen.getByLabelText("Tricky section note"), { target: { value: "bridge" } });
    fireEvent.change(screen.getByLabelText("Tricky section start measure"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Tricky section end measure"), { target: { value: "18" } });
    fireEvent.click(screen.getByText("Save note + measures"));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("region_update", {
      id: 1,
      patch: { name: "bridge", m_start: 3, m_end: 18 },
    }));
  });

  it("merges the current region into the chosen target", async () => {
    render(<RegionEditor region={region} regions={[region, other]} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByText("Edit note, measures, color or delete"));
    fireEvent.change(screen.getByLabelText("Merge target"), { target: { value: "2" } });
    fireEvent.click(screen.getByText("Merge"));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("region_merge", { idKeep: 2, idAbsorb: 1 }));
  });

  it("confirms and sends one atomic region_split command", async () => {
    const anchored = { ...region, pdf_anchor: { v: 1, editions: {} } };
    render(<RegionEditor region={anchored} regions={[anchored, other]} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByText("Edit note, measures, color or delete"));
    fireEvent.change(screen.getByLabelText("Split measure"), { target: { value: "9" } });
    fireEvent.click(screen.getByText("Split"));
    expect(screen.getByText(/All score boxes, highlights, and notes/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("region_split", { id: 1, splitAt: 9 }));
  });
});
