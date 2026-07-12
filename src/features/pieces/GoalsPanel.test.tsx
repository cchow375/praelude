import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));
import { GoalsPanel } from "./GoalsPanel";

afterEach(cleanup);

const goals = [
  { id: 1, piece_id: 5, text: "Shape phrase", kind: "big", parent_goal_id: null, done: false, order: 0, target_date: null, created_ts: "now" },
  { id: 2, piece_id: 5, text: "Memorize", kind: "big", parent_goal_id: null, done: false, order: 1, target_date: null, created_ts: "now" },
];

describe("GoalsPanel", () => {
  beforeEach(() => {
    invokeMock.mockReset().mockImplementation((command: string) =>
      command === "goal_list" ? Promise.resolve(goals) : Promise.resolve(null),
    );
  });

  it("reorders goals with their stable ids", async () => {
    render(<GoalsPanel pieceId={5} />);
    await screen.findByText("Shape phrase");
    fireEvent.click(screen.getByLabelText("Move Shape phrase down"));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("goal_reorder", {
      pieceId: 5,
      orderedIds: [2, 1],
    }));
  });
});
