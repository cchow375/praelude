import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
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

function renderWorkspace(
  props: React.ComponentProps<typeof LedgerCalendarWorkspace> = {},
) {
  return render(
    <ReceiptCenterProvider>
      <LedgerCalendarWorkspace {...props} />
    </ReceiptCenterProvider>,
  );
}

describe("LedgerCalendarWorkspace", () => {
  it("mounts under one shell slot and defaults to the Pieces Library", async () => {
    renderWorkspace();
    expect(screen.getByTestId("workspace-ledger")).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "Pieces Library" })).toBeTruthy();
    const libraryTab = screen.getByRole("tab", { name: "Library" });
    expect(libraryTab.getAttribute("aria-selected")).toBe("true");
  });

  it("switches to the Calendar surface without a sixth top-level tab", async () => {
    renderWorkspace();
    await screen.findByRole("heading", { name: "Pieces Library" });
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

  it("implements arrow-key tab navigation with one tab stop", async () => {
    renderWorkspace();
    const library = screen.getByRole("tab", { name: "Library" });
    const ledger = screen.getByRole("tab", { name: "History" });
    const calendar = screen.getByRole("tab", { name: "Calendar" });
    expect(library.getAttribute("tabindex")).toBe("0");
    expect(ledger.getAttribute("tabindex")).toBe("-1");
    expect(calendar.getAttribute("tabindex")).toBe("-1");

    library.focus();
    fireEvent.keyDown(library, { key: "ArrowRight" });
    expect(await screen.findByTestId("ledger-workspace")).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(ledger));
    expect(ledger.getAttribute("tabindex")).toBe("0");
    expect(document.getElementById("history-panel-ledger")?.getAttribute("aria-labelledby")).toBe(
      "history-tab-ledger",
    );
  });

  it("lands directly on the requested Calendar surface", async () => {
    renderWorkspace({ requestedSurface: "calendar" });
    expect(await screen.findByTestId("calendar-workspace")).toBeTruthy();
    expect(screen.queryByTestId("ledger-workspace")).toBeNull();
    expect(
      screen
        .getByRole("tab", { name: "Calendar" })
        .getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("mounts the editable Pieces Library with history kept as a sub-tab", async () => {
    renderWorkspace();
    expect(await screen.findByRole("heading", { name: "Pieces Library" })).toBeTruthy();
    expect(await screen.findByText("Scherzo")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Rescan pieces folder" }),
    ).toBeTruthy();
    // Only the chosen surface mounts — the ledger surface is gone.
    expect(screen.queryByTestId("ledger-workspace")).toBeNull();
    expect(
      within(screen.getByRole("tablist", { name: "Pieces workspace view" }))
        .getByRole("tab", { name: "Library" })
        .getAttribute("aria-selected"),
    ).toBe("true");
  });
});
