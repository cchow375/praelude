import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));

import { AnomaliesPanel } from "./AnomaliesPanel";

const REPORT = {
  generated_at: "2026-07-16T10:00:00Z",
  total: 3,
  groups: [
    {
      kind: "reversed_range",
      severity: "error",
      count: 1,
      rows: [
        {
          id: 1,
          entity_type: "set",
          entity_id: 45,
          review_state: "open",
          detail: { m_start: 452, m_end: 449 },
          created_ts: "2026-07-16T09:00:00Z",
          reviewed_ts: null,
        },
      ],
    },
    {
      kind: "empty_set",
      severity: "info",
      count: 2,
      rows: [
        {
          id: 2,
          entity_type: "set",
          entity_id: 7,
          review_state: "open",
          detail: { recorded_attempts: 0 },
          created_ts: "2026-07-16T09:00:00Z",
          reviewed_ts: null,
        },
        {
          id: 3,
          entity_type: "set",
          entity_id: 9,
          review_state: "open",
          detail: { recorded_attempts: 0 },
          created_ts: "2026-07-16T09:00:00Z",
          reviewed_ts: null,
        },
      ],
    },
  ],
};

beforeEach(() => {
  invokeMock.mockReset();
});

afterEach(cleanup);

describe("AnomaliesPanel", () => {
  it("renders per-kind groups, counts, explanations, and affected rows", async () => {
    invokeMock.mockResolvedValue(REPORT);
    render(<AnomaliesPanel />);

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("anomalies_list"));

    // Per-kind group with its human label and count.
    const reversed = await screen.findByTestId("anomaly-group-reversed_range");
    expect(within(reversed).getByText("Reversed measure range")).toBeTruthy();
    expect(screen.getByTestId("anomaly-count-reversed_range").textContent).toBe("1");
    expect(screen.getByTestId("anomaly-count-empty_set").textContent).toBe("2");

    // Explanation: what it means AND why it is disclosed rather than repaired.
    expect(within(reversed).getByText(/What this means/)).toBeTruthy();
    expect(within(reversed).getByText(/Why it is disclosed, not repaired/)).toBeTruthy();
    expect(reversed.textContent).toContain("later audited correction");

    // Expandable rows list the affected entities with their observed facts.
    const emptyRows = screen.getByTestId("anomaly-rows-empty_set");
    expect(within(emptyRows).getByText("Set 7")).toBeTruthy();
    expect(within(emptyRows).getByText("Set 9")).toBeTruthy();
    const reversedRows = screen.getByTestId("anomaly-rows-reversed_range");
    expect(reversedRows.textContent).toContain("452");
    expect(reversedRows.textContent).toContain("449");
  });

  it("shows an honest, calm empty state when nothing is disclosed", async () => {
    invokeMock.mockResolvedValue({ generated_at: "2026-07-16T10:00:00Z", total: 0, groups: [] });
    render(<AnomaliesPanel />);

    const empty = await screen.findByTestId("anomalies-empty");
    expect(empty.textContent).toBe("No anomalies disclosed for this database.");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does not judge playing quality — copy stays a data-shape observation", async () => {
    invokeMock.mockResolvedValue(REPORT);
    render(<AnomaliesPanel />);

    const panel = await screen.findByTestId("ledger-anomalies");
    expect(panel.textContent).toContain("shape");
    expect(panel.textContent).not.toMatch(/wrong|mistake|badly|poor/i);
  });

  it("surfaces a load failure instead of inventing an empty disclosure", async () => {
    invokeMock.mockRejectedValue(new Error("Store unavailable"));
    render(<AnomaliesPanel />);

    const alert = await screen.findByTestId("anomalies-error");
    expect(alert.textContent).toContain("Store unavailable");
    expect(screen.queryByTestId("anomalies-empty")).toBeNull();
  });
});
