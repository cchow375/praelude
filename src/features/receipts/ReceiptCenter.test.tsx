import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReceiptCenterProvider, useReceipts, type MutationReceipt } from "./ReceiptCenter";

const receiptCss = readFileSync(resolve("src/features/receipts/ReceiptCenter.css"), "utf8");

function Harness() {
  const receipts = useReceipts();
  return (
    <div>
      <button onClick={() => receipts.committed("Practice block opened.")}>
        Commit
      </button>
      <button onClick={() => receipts.undone("Last attempt undone.")}>
        Undo
      </button>
      <button onClick={() => receipts.error(
        { code: "db_busy", message: "Practice could not be saved." },
        "Save failed.",
      )}>
        Fail
      </button>
      <button onClick={() => receipts.mutation({
        receipt_id: "receipt:delivery-1",
        command_id: "delivery-1",
        status: "committed",
        summary: "Attempt 8 saved — clean.",
        entity_refs: [{ entity_type: "practice_set", entity_id: 42 }],
        event_ids: [88],
        replayed: true,
        committed_ts: "2026-07-15T18:00:00Z",
      })}>
        Replay
      </button>
      <button onClick={() => receipts.mutation({
        // Models a native event that omits retry metadata despite the
        // contract; the center must still dedupe by stable receipt_id.
        receipt_id: "receipt:native-1",
        status: "committed",
        summary: "Practice paused.",
        entity_refs: [{ entity_type: "set", entity_id: 42 }],
        event_ids: [89],
      } as unknown as MutationReceipt)}>
        Native durable result
      </button>
      <button onClick={() => receipts.mutation({
        receipt_id: "receipt:draft-1",
        command_id: "draft-1",
        status: "confirmation_required",
        summary: "Confirm restarting the set.",
        entity_refs: [],
        event_ids: [],
        replayed: false,
        committed_ts: null,
      })}>
        Confirm
      </button>
    </div>
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ReceiptCenter", () => {
  it("announces committed and undone receipts politely", () => {
    render(<ReceiptCenterProvider><Harness /></ReceiptCenterProvider>);
    const polite = screen.getByRole("status");

    expect(polite.getAttribute("aria-live")).toBe("polite");
    fireEvent.click(screen.getByRole("button", { name: "Commit" }));
    expect(polite.textContent).toBe("Practice block opened.");

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(polite.textContent).toBe("Last attempt undone.");
    expect(screen.getByRole("region", { name: "Receipt center" })).toBeTruthy();
  });

  it("announces errors assertively and keeps them visibly dismissible", () => {
    render(<ReceiptCenterProvider><Harness /></ReceiptCenterProvider>);

    fireEvent.click(screen.getByRole("button", { name: "Fail" }));

    const alert = screen.getByRole("alert");
    expect(alert.getAttribute("aria-live")).toBe("assertive");
    expect(alert.textContent).toBe("Practice could not be saved.");

    const activity = screen.getByRole("list", { name: "Recent app activity" });
    expect(within(activity).getByText("Practice could not be saved.")).toBeTruthy();
    fireEvent.click(within(activity).getByRole("button", {
      name: "Dismiss error receipt: Practice could not be saved.",
    }));
    expect(screen.queryByRole("list", { name: "Recent app activity" })).toBeNull();
  });

  it("renders durable replay and confirmation receipts without claiming a second write", () => {
    render(<ReceiptCenterProvider><Harness /></ReceiptCenterProvider>);

    fireEvent.click(screen.getByRole("button", { name: "Replay" }));
    const activity = screen.getByRole("list", { name: "Recent app activity" });
    const replay = within(activity).getByText(/Already applied; no second write was made/).closest("li");
    expect(replay?.getAttribute("data-kind")).toBe("duplicate");
    expect(replay?.getAttribute("data-receipt-id")).toBe("receipt:delivery-1");

    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    const confirmation = within(activity).getByText("Confirm restarting the set.").closest("li");
    expect(confirmation?.getAttribute("data-kind")).toBe("confirmation");
    expect(screen.getByRole("status").textContent).toBe("Confirm restarting the set.");
  });

  it("recognizes a native replay by stable receipt id when retry metadata is omitted", () => {
    render(<ReceiptCenterProvider><Harness /></ReceiptCenterProvider>);
    const button = screen.getByRole("button", { name: "Native durable result" });

    fireEvent.click(button);
    let activity = screen.getByRole("list", { name: "Recent app activity" });
    expect(within(activity).getByText("Practice paused.").closest("li")?.getAttribute("data-kind"))
      .toBe("committed");

    fireEvent.click(button);
    activity = screen.getByRole("list", { name: "Recent app activity" });
    const duplicate = within(activity)
      .getByText(/Practice paused\. Already applied; no second write was made\./)
      .closest("li");
    expect(duplicate?.getAttribute("data-kind")).toBe("duplicate");
    expect(duplicate?.getAttribute("data-receipt-id")).toBe("receipt:native-1");
  });

  it("auto-dismisses each routine receipt after 1.5 seconds without resetting older timers", () => {
    vi.useFakeTimers();
    render(<ReceiptCenterProvider><Harness /></ReceiptCenterProvider>);

    fireEvent.click(screen.getByRole("button", { name: "Commit" }));
    let activity = screen.getByRole("list", { name: "Recent app activity" });
    expect(within(activity).getByText("Practice block opened.")).toBeTruthy();

    act(() => vi.advanceTimersByTime(1_000));
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));

    act(() => vi.advanceTimersByTime(500));
    activity = screen.getByRole("list", { name: "Recent app activity" });
    expect(within(activity).queryByText("Practice block opened.")).toBeNull();
    expect(within(activity).getByText("Last attempt undone.")).toBeTruthy();

    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.queryByRole("list", { name: "Recent app activity" })).toBeNull();
  });

  it("expires a rapid stack independently and clears a timer on manual dismiss", () => {
    vi.useFakeTimers();
    render(<ReceiptCenterProvider><Harness /></ReceiptCenterProvider>);
    const commit = screen.getByRole("button", { name: "Commit" });

    for (let i = 0; i < 5; i += 1) fireEvent.click(commit);
    const activity = screen.getByRole("list", { name: "Recent app activity" });
    expect(within(activity).getAllByText("Practice block opened.")).toHaveLength(5);
    expect(vi.getTimerCount()).toBe(5);

    fireEvent.click(screen.getAllByRole("button", {
      name: "Dismiss committed receipt: Practice block opened.",
    })[0]);
    expect(vi.getTimerCount()).toBe(4);

    act(() => vi.advanceTimersByTime(1_500));
    expect(screen.queryByRole("list", { name: "Recent app activity" })).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps errors and confirmations reviewable until explicitly dismissed", () => {
    vi.useFakeTimers();
    render(<ReceiptCenterProvider><Harness /></ReceiptCenterProvider>);

    fireEvent.click(screen.getByRole("button", { name: "Fail" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    act(() => vi.advanceTimersByTime(10_000));

    const activity = screen.getByRole("list", { name: "Recent app activity" });
    expect(within(activity).getByText("Practice could not be saved.")).toBeTruthy();
    expect(within(activity).getByText("Confirm restarting the set.")).toBeTruthy();
  });

  it("never evicts a sticky receipt when more than five require review", () => {
    vi.useFakeTimers();
    render(<ReceiptCenterProvider><Harness /></ReceiptCenterProvider>);

    const fail = screen.getByRole("button", { name: "Fail" });
    for (let i = 0; i < 6; i += 1) fireEvent.click(fail);

    const activity = screen.getByRole("list", { name: "Recent app activity" });
    expect(within(activity).getAllByRole("listitem")).toHaveLength(6);
    expect(within(activity).getAllByText("Practice could not be saved.")).toHaveLength(6);
    act(() => vi.advanceTimersByTime(10_000));
    expect(within(activity).getAllByRole("listitem")).toHaveLength(6);
  });

  it("does not evict a sticky failure during a burst of routine hot-loop receipts", () => {
    vi.useFakeTimers();
    render(<ReceiptCenterProvider><Harness /></ReceiptCenterProvider>);

    fireEvent.click(screen.getByRole("button", { name: "Fail" }));
    const commit = screen.getByRole("button", { name: "Commit" });
    for (let i = 0; i < 8; i += 1) fireEvent.click(commit);

    const activity = screen.getByRole("list", { name: "Recent app activity" });
    expect(within(activity).getAllByRole("listitem")).toHaveLength(5);
    expect(within(activity).getByText("Practice could not be saved.")).toBeTruthy();
    expect(within(activity).getAllByText("Practice block opened.")).toHaveLength(4);

    act(() => vi.advanceTimersByTime(1_500));
    expect(within(activity).getByText("Practice could not be saved.")).toBeTruthy();
  });

  it("lets pointer input pass through the card body while keeping dismiss clickable", () => {
    render(<ReceiptCenterProvider><Harness /></ReceiptCenterProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Commit" }));

    const activity = screen.getByRole("list", { name: "Recent app activity" });
    const receipt = within(activity).getByText("Practice block opened.").closest("li");
    const dismiss = screen.getByRole("button", {
      name: "Dismiss committed receipt: Practice block opened.",
    });
    expect(receipt?.className).toBe("receipt-item");
    expect(receiptCss).toMatch(/\.receipt-item\s*\{[^}]*pointer-events:\s*none/s);
    expect(receiptCss).toMatch(/\.receipt-dismiss\s*\{[^}]*pointer-events:\s*auto/s);

    fireEvent.click(dismiss);
    expect(screen.queryByRole("list", { name: "Recent app activity" })).toBeNull();
  });
});
