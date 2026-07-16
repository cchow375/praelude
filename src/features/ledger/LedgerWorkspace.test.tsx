import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));

import { LedgerWorkspace } from "./LedgerWorkspace";

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation((command: string) => {
    if (command === "pieces_list") return Promise.resolve([
      { id: 1, title: "Scherzo", composer: "Chopin", has_xml: true, has_pdf: true, intake_done: true },
      { id: 2, title: "Poem", composer: "Griffes", has_xml: true, has_pdf: true, intake_done: true },
    ]);
    if (command === "region_list" || command === "rep_blocks_for_piece") return Promise.resolve([]);
    if (command === "progress_summary") return Promise.resolve({ per_region_mastery: [] });
    return Promise.resolve(null);
  });
});

afterEach(cleanup);

describe("LedgerWorkspace", () => {
  it("selects repertoire without duplicating the piece ledger projection", async () => {
    render(<LedgerWorkspace />);

    expect(await screen.findByRole("heading", { name: "Scherzo" })).toBeTruthy();
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("rep_blocks_for_piece", { pieceId: 1 }));
    fireEvent.click(screen.getByRole("button", { name: /02PoemGriffes/ }));
    expect(await screen.findByRole("heading", { name: "Poem" })).toBeTruthy();
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("rep_blocks_for_piece", { pieceId: 2 }));
  });

  it("surfaces a failed piece index instead of inventing empty evidence", async () => {
    invokeMock.mockRejectedValue(new Error("Database unavailable"));
    render(<LedgerWorkspace />);
    expect((await screen.findByRole("alert")).textContent).toContain("Database unavailable");
    expect(screen.queryByRole("heading", { name: "Scherzo" })).toBeNull();
  });
});
