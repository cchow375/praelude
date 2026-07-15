import { cleanup, fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));

import { BlockRow } from "./BlockRow";
import type { BlockHistory, Rep } from "./types";
import { ReceiptCenterProvider } from "../receipts/ReceiptCenter";

afterEach(cleanup);

const block: BlockHistory = {
  block_id: 987654,
  m_start: 1,
  m_end: 8,
  label: "opening phrase",
  start_bpm: 40,
  bpm: 44,
  target_bpm: 60,
  planned_reps: 10,
  reps_done: 3,
  attempts_recorded: 3,
  tries: 3,
  status: "done",
  set_state: "closed_unresolved",
  verdicts: { clean: 1, flawed: 1, failed: 1 },
  region_id: 1,
  focus: "tempo",
  use_metronome: true,
  required_clean_streak: 5,
  effective_required_clean_streak: 5,
  mastery_status: "not_satisfied",
  mastery_verified: true,
  attempt_ceiling: 10,
  contract_source: "user_click",
};

let reps: Rep[];

describe("BlockRow", () => {
  beforeEach(() => {
    reps = [];
    invokeMock.mockReset().mockImplementation((command: string) => {
      if (command === "reps_for_block") return Promise.resolve(reps);
      return Promise.resolve(undefined);
    });
  });

  it("renders historical set metadata and its captured contract as immutable evidence", () => {
    render(<BlockRow block={block} regions={[{ id: 1, name: "Exposition" }]} onChanged={vi.fn()} />);

    expect(screen.getByText("opening phrase")).toBeTruthy();
    expect(screen.getByText("Captured contract").parentElement?.textContent).toContain("5 consecutive clean attempts");
    expect(screen.getByText("Review after 10 attempts · not mastery")).toBeTruthy();
    expect(screen.getByText("Contract source").parentElement?.textContent).toContain("set setup");
    expect(screen.getByText("Exposition")).toBeTruthy();
    expect(screen.queryByLabelText("block label")).toBeNull();
    expect(screen.queryByLabelText("block focus")).toBeNull();
    expect(screen.queryByRole("button", { name: /delete set/i })).toBeNull();

    fireEvent.doubleClick(screen.getByText("opening phrase"));
    expect(screen.queryByLabelText("block label")).toBeNull();
    expect(invokeMock).not.toHaveBeenCalledWith("block_update", expect.anything());
    expect(invokeMock).not.toHaveBeenCalledWith("block_delete", expect.anything());
  });

  it("does not expose database ids in visible or accessible history copy", () => {
    render(<BlockRow block={block} onChanged={vi.fn()} />);

    expect(document.body.textContent).not.toContain(String(block.block_id));
    const names = screen.getAllByRole("button").map((button) => button.getAttribute("aria-label") ?? button.textContent ?? "");
    expect(names.join(" ")).not.toContain(String(block.block_id));
    expect(screen.getByRole("button", { name: "Expand attempts for measures 1–8, opening phrase" })).toBeTruthy();
  });

  it("shows source, correction, void, and null-tempo lineage without editable voided controls", async () => {
    reps = [
      {
        id: 401,
        block_id: block.block_id,
        ts: "2026-07-15T10:00:00Z",
        bpm: null,
        variant: null,
        verdict: "clean",
        original_verdict: "failed",
        note: "voice was right",
        voided: false,
        source: "voice_hot_loop",
        active_adjustment_ids: [11, 12],
      },
      {
        id: 402,
        block_id: block.block_id,
        ts: "2026-07-15T10:01:00Z",
        bpm: null,
        variant: null,
        verdict: "failed",
        original_verdict: "failed",
        note: null,
        voided: true,
        source: "migration_legacy",
        active_adjustment_ids: [13],
      },
    ];
    render(<BlockRow block={{ ...block, start_bpm: null, bpm: null }} onChanged={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /Expand attempts/ }));
    await screen.findByText("Corrected from Again to Clean · 2 active changes");

    expect(screen.getByText("Logged by voice")).toBeTruthy();
    expect(screen.getByText("Logged by legacy import")).toBeTruthy();
    expect(screen.getByText("Voided · excluded from totals")).toBeTruthy();
    expect(document.body.textContent).not.toContain("♩ null");
    expect(screen.queryByLabelText("Attempt 2 verdict")).toBeNull();
    expect(screen.queryByLabelText("Attempt 2 note")).toBeNull();
    expect(screen.queryByRole("button", { name: "Void attempt 2" })).toBeNull();
  });

  it("keeps attempt correction and void controls on append-only backend commands", async () => {
    reps = [{
      id: 403,
      block_id: block.block_id,
      ts: "2026-07-15T10:02:00Z",
      bpm: 44,
      variant: null,
      verdict: "failed",
      original_verdict: "failed",
      note: "old note",
      voided: false,
      source: "user_click",
      active_adjustment_ids: [],
    }];
    render(<ReceiptCenterProvider><BlockRow block={block} onChanged={vi.fn()} /></ReceiptCenterProvider>);
    fireEvent.click(screen.getByRole("button", { name: /Expand attempts/ }));
    await screen.findByLabelText("Attempt 1 verdict");

    fireEvent.change(screen.getByLabelText("Attempt 1 verdict"), { target: { value: "clean" } });
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("rep_update", {
      repId: 403,
      patch: { verdict: "clean" },
    }));

    fireEvent.doubleClick(screen.getByText("old note"));
    fireEvent.change(screen.getByLabelText("Attempt 1 note"), { target: { value: "steady" } });
    fireEvent.keyDown(screen.getByLabelText("Attempt 1 note"), { key: "Enter" });
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("rep_update", {
      repId: 403,
      patch: { note: "steady" },
    }));

    fireEvent.click(screen.getByRole("button", { name: "Void attempt 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("rep_delete", { repId: 403 }));
    const activity = screen.getByRole("list", { name: "Recent app activity" });
    expect(activity.textContent).toContain("Attempt 1 verdict correction saved.");
    expect(activity.textContent).toContain("Attempt 1 note correction saved.");
    expect(activity.textContent).toContain("Attempt 1 voided. The original remains in the ledger.");
    expect(invokeMock).not.toHaveBeenCalledWith("block_update", expect.anything());
    expect(invokeMock).not.toHaveBeenCalledWith("block_delete", expect.anything());
  });

  it("labels legacy contracts honestly when v2 contract fields are absent", () => {
    render(<BlockRow block={{
      ...block,
      mastery_verified: false,
      mastery_status: "unverified_legacy",
      attempt_ceiling: undefined,
      contract_source: undefined,
    }} onChanged={vi.fn()} />);

    expect(screen.getAllByText(/Legacy/).length).toBeGreaterThan(0);
    expect(screen.getByText("Legacy review count: 10 attempts · not mastery")).toBeTruthy();
    expect(screen.getByText("Contract source").parentElement?.textContent).toContain("legacy source not captured");
  });

  it("keeps the newest attempt reload when an older expand request resolves last", async () => {
    const oldRep: Rep = {
      id: 501,
      block_id: block.block_id,
      ts: "2026-07-15T11:00:00Z",
      bpm: 44,
      variant: null,
      verdict: "failed",
      note: "stale attempt response",
      original_verdict: "failed",
      voided: false,
      source: "user_click",
      active_adjustment_ids: [],
    };
    const newRep: Rep = { ...oldRep, id: 502, note: "newest attempt response" };
    let resolveOld: (value: Rep[]) => void = () => undefined;
    const oldRequest = new Promise<Rep[]>((resolve) => { resolveOld = resolve; });
    let requests = 0;
    invokeMock.mockImplementation((command: string) => {
      if (command !== "reps_for_block") return Promise.resolve(undefined);
      requests += 1;
      return requests === 1 ? oldRequest : Promise.resolve([newRep]);
    });
    render(<BlockRow block={block} onChanged={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /Expand attempts/ }));
    fireEvent.click(screen.getByRole("button", { name: /Collapse attempts/ }));
    fireEvent.click(screen.getByRole("button", { name: /Expand attempts/ }));
    expect(await screen.findByText("newest attempt response")).toBeTruthy();

    await act(async () => { resolveOld([oldRep]); await oldRequest; });
    expect(screen.queryByText("stale attempt response")).toBeNull();
    expect(screen.getByText("newest attempt response")).toBeTruthy();
  });

  it("publishes a normalized correction error even after the history row unmounts", async () => {
    reps = [{
      id: 601,
      block_id: block.block_id,
      ts: "2026-07-15T11:10:00Z",
      bpm: 44,
      variant: null,
      verdict: "failed",
      note: null,
      original_verdict: "failed",
      voided: false,
      source: "user_click",
      active_adjustment_ids: [],
    }];
    let rejectUpdate: (reason: unknown) => void = () => undefined;
    const pending = new Promise<void>((_resolve, reject) => { rejectUpdate = reject; });
    invokeMock.mockImplementation((command: string) => {
      if (command === "reps_for_block") return Promise.resolve(reps);
      if (command === "rep_update") return pending;
      return Promise.resolve(undefined);
    });
    const view = render(
      <ReceiptCenterProvider><BlockRow block={block} onChanged={vi.fn()} /></ReceiptCenterProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Expand attempts/ }));
    await screen.findByLabelText("Attempt 1 verdict");
    fireEvent.change(screen.getByLabelText("Attempt 1 verdict"), { target: { value: "clean" } });
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("rep_update", {
      repId: 601,
      patch: { verdict: "clean" },
    }));

    view.rerender(<ReceiptCenterProvider><p>History row closed.</p></ReceiptCenterProvider>);
    await act(async () => {
      rejectUpdate({ code: "ledger_conflict", message: "History correction conflicted." });
      await pending.catch(() => undefined);
    });

    expect(screen.getByRole("list", { name: "Recent app activity" }).textContent).toContain(
      "History correction conflicted.",
    );
  });
});
