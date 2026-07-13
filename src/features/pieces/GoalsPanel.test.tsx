import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));
import { GoalsPanel } from "./GoalsPanel";
import type { GoalsApi } from "./GoalsPanel";

afterEach(cleanup);

const goals = [
  { id: 1, piece_id: 5, text: "Shape phrase", kind: "big", parent_goal_id: null, done: false, order: 0, target_date: null, created_ts: "now" },
  { id: 2, piece_id: 5, text: "Memorize", kind: "big", parent_goal_id: null, done: false, order: 1, target_date: null, created_ts: "now" },
  { id: 3, piece_id: 5, text: "Voice the return", kind: "sub", parent_goal_id: 1, done: true, order: 0, target_date: "2026-07-20", created_ts: "now" },
];

function api(): GoalsApi {
  return {
    goalList: vi.fn().mockResolvedValue(goals),
    goalCreate: vi.fn().mockResolvedValue(goals[0]),
    goalUpdate: vi.fn().mockResolvedValue(goals[0]),
    goalDelete: vi.fn().mockResolvedValue(undefined),
    goalReorder: vi.fn().mockResolvedValue(undefined),
  } as GoalsApi;
}

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

  it("renders the two-level tree, target dates, and completion summary", async () => {
    render(<GoalsPanel pieceId={5} api={api()} />);
    await screen.findByText("Shape phrase");
    expect(screen.getByText("Voice the return")).toBeTruthy();
    expect(screen.getByText("1/1 subgoals done")).toBeTruthy();
    expect((screen.getByLabelText("Target date for Voice the return") as HTMLInputElement).value).toBe("2026-07-20");
  });

  it("adds a subgoal only after explicit keyboard submit", async () => {
    const goalsApi = api();
    render(<GoalsPanel pieceId={5} api={goalsApi} />);
    fireEvent.click(await screen.findByRole("button", { name: "Add subgoal to Shape phrase" }));
    const input = screen.getByLabelText("New subgoal for Shape phrase");
    fireEvent.change(input, { target: { value: "  Stabilize the leap  " } });
    expect(goalsApi.goalCreate).not.toHaveBeenCalled();
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(goalsApi.goalCreate).toHaveBeenCalledWith({
      piece_id: 5,
      text: "Stabilize the leap",
      kind: "sub",
      parent_goal_id: 1,
      target_date: null,
    }));
  });

  it("shows loading and backend errors without optimistic success copy", async () => {
    let rejectList: (reason: string) => void = () => undefined;
    const goalsApi = api();
    goalsApi.goalList = vi.fn().mockReturnValue(new Promise((_resolve, reject) => { rejectList = reject; }));
    render(<GoalsPanel pieceId={5} api={goalsApi} />);
    expect(screen.getByRole("status").textContent).toContain("Loading goals");
    rejectList("Goal tree is stale.");
    expect((await screen.findByRole("alert")).textContent).toContain("Goal tree is stale");
  });
});
