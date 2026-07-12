import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));

import { BlockRow } from "./BlockRow";
import type { BlockHistory } from "./types";

afterEach(cleanup);

const block: BlockHistory = {
  block_id: 7,
  m_start: 1,
  m_end: 8,
  label: "mm.1-8",
  start_bpm: 40,
  bpm: 40,
  target_bpm: 60,
  planned_reps: 10,
  reps_done: 0,
  status: "done",
  verdicts: { clean: 0, flawed: 0, failed: 0 },
  region_id: 1,
  focus: "tempo",
  use_metronome: true,
};

describe("BlockRow", () => {
  beforeEach(() => invokeMock.mockReset().mockResolvedValue(block));

  it("saves an edited label through block_update", async () => {
    render(<BlockRow block={block} onChanged={vi.fn()} />);
    fireEvent.doubleClick(screen.getByText("mm.1-8"));
    fireEvent.change(screen.getByLabelText("block label"), { target: { value: "legato" } });
    fireEvent.keyDown(screen.getByLabelText("block label"), { key: "Enter" });
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("block_update", {
      blockId: 7,
      patch: { label: "legato" },
    }));
  });

  it("confirms before deleting a block", async () => {
    render(<BlockRow block={block} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("Delete block 7"));
    fireEvent.click(screen.getByText("Confirm"));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("block_delete", { blockId: 7 }));
  });
});
