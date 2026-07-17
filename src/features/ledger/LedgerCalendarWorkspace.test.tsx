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

import { LedgerCalendarWorkspace } from "./LedgerCalendarWorkspace";
import { ReceiptCenterProvider } from "../receipts/ReceiptCenter";

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation((command: string) => {
    if (command === "pieces_list") {
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
    }
    if (
      command === "region_list" ||
      command === "rep_blocks_for_piece" ||
      command === "goal_list"
    ) {
      return Promise.resolve([]);
    }
    if (command === "progress_summary")
      return Promise.resolve({ per_region_mastery: [] });
    if (command === "anomalies_list")
      return Promise.resolve({ generated_at: "", total: 0, groups: [] });
    if (command === "daily_work_list") return Promise.resolve([]);
    if (command === "recovery_preview") {
      return Promise.resolve({
        today: "2026-07-16",
        capacity_minutes: 60,
        items: [],
        days: [],
      });
    }
    return Promise.resolve(null);
  });
});

afterEach(cleanup);

function renderWorkspace() {
  return render(
    <ReceiptCenterProvider>
      <LedgerCalendarWorkspace />
    </ReceiptCenterProvider>,
  );
}

describe("LedgerCalendarWorkspace", () => {
  it("mounts under one shell slot and defaults to the Ledger surface", async () => {
    renderWorkspace();
    expect(screen.getByTestId("workspace-ledger")).toBeTruthy();
    expect(await screen.findByTestId("ledger-workspace")).toBeTruthy();
    const ledgerTab = screen.getByRole("tab", { name: "Ledger" });
    expect(ledgerTab.getAttribute("aria-selected")).toBe("true");
  });

  it("switches to the Calendar surface without a sixth top-level tab", async () => {
    renderWorkspace();
    await screen.findByTestId("ledger-workspace");
    fireEvent.click(screen.getByRole("tab", { name: "Calendar" }));
    await waitFor(() =>
      expect(screen.getByTestId("calendar-workspace")).toBeTruthy(),
    );
    expect(screen.queryByTestId("ledger-workspace")).toBeNull();
    expect(
      screen
        .getByRole("tab", { name: "Calendar" })
        .getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("mounts the Pieces surface (browser/intake/goals) in the same slot", async () => {
    renderWorkspace();
    await screen.findByTestId("ledger-workspace");
    fireEvent.click(screen.getByRole("tab", { name: "Pieces" }));
    // The piece library (browser + pieces_scan) is now reachable.
    expect(
      await screen.findByRole("heading", { name: "Score Atlas" }),
    ).toBeTruthy();
    expect(await screen.findByText("Scherzo")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Rescan pieces folder" }),
    ).toBeTruthy();
    // Only the chosen surface mounts — the ledger surface is gone.
    expect(screen.queryByTestId("ledger-workspace")).toBeNull();
    expect(
      screen.getByRole("tab", { name: "Pieces" }).getAttribute("aria-selected"),
    ).toBe("true");
  });
});
