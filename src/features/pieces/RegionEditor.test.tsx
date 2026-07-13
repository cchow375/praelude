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

  it("renames a region through region_update", async () => {
    render(<RegionEditor region={region} regions={[region, other]} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByText("Manage section"));
    fireEvent.doubleClick(screen.getByText("legato"));
    fireEvent.change(screen.getByLabelText("region name"), { target: { value: "bridge" } });
    fireEvent.keyDown(screen.getByLabelText("region name"), { key: "Enter" });
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("region_update", { id: 1, patch: { name: "bridge" } }));
  });

  it("merges the current region into the chosen target", async () => {
    render(<RegionEditor region={region} regions={[region, other]} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByText("Manage section"));
    fireEvent.change(screen.getByLabelText("Merge target"), { target: { value: "2" } });
    fireEvent.click(screen.getByText("Merge"));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("region_merge", { idKeep: 2, idAbsorb: 1 }));
  });

  it("clears stale PDF geometry when a region is split", async () => {
    const anchored = { ...region, pdf_anchor: { v: 1, editions: {} } };
    invokeMock.mockImplementation((command: string) => {
      if (command === "region_create") return Promise.resolve({ ...other, id: 3, m_start: 9 });
      return Promise.resolve(anchored);
    });
    render(<RegionEditor region={anchored} regions={[anchored, other]} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByText("Manage section"));
    fireEvent.change(screen.getByLabelText("Split measure"), { target: { value: "9" } });
    fireEvent.click(screen.getByText("Split"));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("region_update", {
      id: 1,
      patch: { m_end: 8, pdf_anchor: null },
    }));
  });
});
