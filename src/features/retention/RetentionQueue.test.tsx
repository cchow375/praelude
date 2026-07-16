import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ReceiptCenterProvider,
  type MutationReceipt,
} from "../receipts/ReceiptCenter";
import { RetentionQueue } from "./RetentionQueue";
import type {
  RetentionApi,
  RetentionCheckView,
  RetentionDecision,
  RetentionResult,
} from "./types";
import { useRetention } from "./useRetention";

function check(overrides: Partial<RetentionCheckView> = {}): RetentionCheckView {
  return {
    id: 7,
    region_id: 7,
    source_set_id: 11,
    due_date: "2026-07-15",
    original_due_date: "2026-07-14",
    condition: { bpm: 96, hands: "together" },
    state: "due",
    result: null,
    completed_ts: null,
    created_ts: "2026-07-14T10:00:00Z",
    updated_ts: "2026-07-14T10:00:00Z",
    ...overrides,
  };
}

function committed(
  value: RetentionCheckView,
  overrides: Partial<MutationReceipt<RetentionCheckView>> = {},
): MutationReceipt<RetentionCheckView> {
  return {
    receipt_id: `receipt-${value.id}-${value.state}`,
    command_id: "native-command",
    status: "committed",
    summary: `Retention check ${value.state}.`,
    value,
    entity_refs: [{ entity_type: "retention_check", entity_id: value.id }],
    event_ids: [90],
    replayed: false,
    committed_ts: "2026-07-15T10:00:00Z",
    ...overrides,
  };
}

function mockApi(overrides: Partial<RetentionApi> = {}): RetentionApi {
  return {
    due: vi.fn(async () => []),
    snooze: vi.fn(async (_commandId, _checkId, dueDate) => committed(check({
      due_date: dueDate,
      state: "snoozed",
    }))),
    confirm: vi.fn(async () => committed(check({ state: "confirmed" }))),
    lower: vi.fn(async () => committed(check({ state: "lowered" }))),
    reopen: vi.fn(async () => committed(check({ state: "reopened" }))),
    ...overrides,
  };
}

function renderQueue(api: RetentionApi, asOfDate = "2026-07-15") {
  return render(
    <ReceiptCenterProvider>
      <RetentionQueue api={api} asOfDate={asOfDate} />
    </ReceiptCenterProvider>,
  );
}

afterEach(cleanup);

describe("RetentionQueue", () => {
  it("shows loading, then the honest empty state", async () => {
    let resolveDue!: (value: RetentionCheckView[]) => void;
    const api = mockApi({
      due: vi.fn(() => new Promise<RetentionCheckView[]>((resolve) => { resolveDue = resolve; })),
    });
    renderQueue(api);

    expect(screen.getByText("Loading retention checks…").textContent).toContain("Loading retention checks");
    await act(async () => resolveDue([]));
    expect(await screen.findByText("No retention checks are due for 2026-07-15.")).toBeTruthy();
  });

  it("shows read errors without attempting a mutation", async () => {
    const api = mockApi({ due: vi.fn(async () => { throw new Error("Database unavailable"); }) });
    renderQueue(api);

    expect(await screen.findByText("Database unavailable")).toBeTruthy();
    expect(api.confirm).not.toHaveBeenCalled();
    expect(api.lower).not.toHaveBeenCalled();
    expect(api.reopen).not.toHaveBeenCalled();
    expect(api.snooze).not.toHaveBeenCalled();
  });

  it("loads only due facts and performs no write before an explicit click", async () => {
    const api = mockApi({ due: vi.fn(async () => [check()]) });
    renderQueue(api);

    expect(await screen.findByText("Check what survived.")).toBeTruthy();
    expect(screen.getByText("Yesterday’s peak is historical until checked.")).toBeTruthy();
    expect(api.due).toHaveBeenCalledWith("2026-07-15");
    expect(api.confirm).not.toHaveBeenCalled();
    expect(api.lower).not.toHaveBeenCalled();
    expect(api.reopen).not.toHaveBeenCalled();
    expect(api.snooze).not.toHaveBeenCalled();
  });

  it("re-arms async response guards across React StrictMode effect replay", async () => {
    const api = mockApi({ due: vi.fn(async () => [check()]) });
    render(
      <StrictMode>
        <ReceiptCenterProvider>
          <RetentionQueue api={api} asOfDate="2026-07-15" />
        </ReceiptCenterProvider>
      </StrictMode>,
    );

    expect(await screen.findByText("Check what survived.")).toBeTruthy();
    expect(vi.mocked(api.due).mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it.each([
    ["Confirm retained", "confirm", "confirm_retained"],
    ["Lower working condition", "lower", "lower_working_condition"],
    ["Reopen target", "reopen", "reopen_target"],
  ] as const)("requires a note, then records %s through a durable command receipt", async (
    buttonName,
    apiMethod,
    decision,
  ) => {
    const api = mockApi({ due: vi.fn(async () => [check()]) });
    renderQueue(api);
    const button = await screen.findByRole("button", {
      name: buttonName === "Reopen target"
        ? "Reopen target 7"
        : `${buttonName} for target 7`,
    });
    expect(button.hasAttribute("disabled")).toBe(true);

    fireEvent.change(screen.getByLabelText("Result or note for target 7"), {
      target: { value: "Reliable from a cold start." },
    });
    expect(button.hasAttribute("disabled")).toBe(false);
    fireEvent.click(button);

    await waitFor(() => expect(api[apiMethod]).toHaveBeenCalledTimes(1));
    const [commandId, checkId, result] = vi.mocked(api[apiMethod]).mock.calls[0] as [
      string,
      number,
      RetentionResult,
    ];
    expect(commandId).toMatch(new RegExp(`^ui:retention-${apiMethod}:`));
    expect(checkId).toBe(7);
    expect(result).toEqual({
      decision: decision as RetentionDecision,
      note: "Reliable from a cold start.",
      checked_as_of: "2026-07-15",
    });
    expect(await screen.findByText("No retention checks are due for 2026-07-15.")).toBeTruthy();
    expect(document.querySelector('[data-kind="committed"]')).not.toBeNull();
  });

  it("keeps the due item unchanged when the backend returns a rejected receipt", async () => {
    const rejected: MutationReceipt<RetentionCheckView> = {
      receipt_id: "rejected:lower",
      command_id: "native-lower",
      status: "rejected",
      summary: "Retention rejected.",
      value: null,
      entity_refs: [],
      event_ids: [],
      error_code: "retention_rejected",
      error_detail: "Check was already resolved elsewhere.",
      replayed: false,
      committed_ts: null,
    };
    const api = mockApi({
      due: vi.fn(async () => [check()]),
      lower: vi.fn(async () => rejected),
    });
    renderQueue(api);
    await screen.findByText("Check what survived.");
    fireEvent.change(screen.getByLabelText("Result or note for target 7"), {
      target: { value: "Needed a lower tempo." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Lower working condition for target 7" }));

    expect((await screen.findAllByText("Check was already resolved elsewhere.")).length).toBeGreaterThan(0);
    expect(screen.getByText("Check what survived.")).toBeTruthy();
    expect(document.querySelector('[data-kind="error"]')).not.toBeNull();
  });

  it("validates snooze dates before issuing a command and then reconciles the queue", async () => {
    const api = mockApi({ due: vi.fn(async () => [check()]) });
    renderQueue(api);
    const date = await screen.findByLabelText("Snooze target 7 until");
    const snooze = screen.getByRole("button", { name: /Snooze target 7 until/ });

    fireEvent.change(date, { target: { value: "2026-07-15" } });
    expect(snooze.hasAttribute("disabled")).toBe(true);
    fireEvent.click(snooze);
    expect(api.snooze).not.toHaveBeenCalled();

    fireEvent.change(date, { target: { value: "2026-07-16" } });
    expect(snooze.hasAttribute("disabled")).toBe(false);
    fireEvent.click(snooze);
    await waitFor(() => expect(api.snooze).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.snooze).mock.calls[0][0]).toMatch(/^ui:retention-snooze:/);
    expect(vi.mocked(api.snooze).mock.calls[0].slice(1)).toEqual([7, "2026-07-16"]);
    expect(await screen.findByText("No retention checks are due for 2026-07-15.")).toBeTruthy();
  });

  it("exposes semantic keyboard controls with target-specific labels", async () => {
    const api = mockApi({ due: vi.fn(async () => [check()]) });
    renderQueue(api);
    await screen.findByText("Check what survived.");

    expect(screen.getByRole("textbox", { name: "Result or note for target 7" })).toBeTruthy();
    expect(screen.getByLabelText("Snooze target 7 until").getAttribute("type")).toBe("date");
    for (const name of [
      "Confirm retained for target 7",
      "Lower working condition for target 7",
      "Reopen target 7",
    ]) {
      const button = screen.getByRole("button", { name });
      expect(button.tagName).toBe("BUTTON");
      expect(button.getAttribute("type")).toBe("button");
    }
  });

  it("ignores a stale slower load after the queue date changes", async () => {
    let resolveFirst!: (value: RetentionCheckView[]) => void;
    let resolveSecond!: (value: RetentionCheckView[]) => void;
    const api = mockApi({
      due: vi.fn((date: string) => new Promise<RetentionCheckView[]>((resolve) => {
        if (date === "2026-07-15") resolveFirst = resolve;
        else resolveSecond = resolve;
      })),
    });
    const view = renderQueue(api, "2026-07-15");
    view.rerender(
      <ReceiptCenterProvider>
        <RetentionQueue api={api} asOfDate="2026-07-16" />
      </ReceiptCenterProvider>,
    );

    await act(async () => resolveSecond([check({ id: 16, region_id: 16, due_date: "2026-07-16" })]));
    expect(await screen.findByText("Target 16")).toBeTruthy();
    await act(async () => resolveFirst([check({ id: 15, region_id: 15 })]));
    expect(screen.getByText("Target 16")).toBeTruthy();
    expect(screen.queryByText("Target 15")).toBeNull();
  });

  it("rejects an invalid queue date before calling native code", async () => {
    const api = mockApi();
    renderQueue(api, "2026-02-31");

    expect(await screen.findByText("Retention date must use YYYY-MM-DD.")).toBeTruthy();
    expect(api.due).not.toHaveBeenCalled();
  });
});

function ReplayHarness({ api }: { api: RetentionApi }) {
  const retention = useRetention({ asOfDate: "2026-07-15", api });
  return (
    <div>
      <span data-testid="count">{retention.checks.length}</span>
      <button
        type="button"
        disabled={retention.checks.length === 0}
        onClick={() => {
          void retention.snooze(7, "2026-07-16");
          void retention.snooze(7, "2026-07-16");
        }}
      >
        Retry same durable result
      </button>
    </div>
  );
}

describe("useRetention replay reconciliation", () => {
  it("applies one durable receipt once and publishes the repeated receipt as a replay", async () => {
    const updated = check({ due_date: "2026-07-16", state: "snoozed" });
    const sameReceipt = committed(updated, { receipt_id: "durable-same" });
    const api = mockApi({
      due: vi.fn(async () => [check()]),
      snooze: vi.fn(async () => sameReceipt),
    });
    render(
      <ReceiptCenterProvider>
        <ReplayHarness api={api} />
      </ReceiptCenterProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("count").textContent).toBe("1"));
    fireEvent.click(screen.getByRole("button", { name: "Retry same durable result" }));

    await waitFor(() => expect(api.snooze).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.snooze).mock.calls[0][0]).toBe(
      vi.mocked(api.snooze).mock.calls[1][0],
    );
    await waitFor(() => expect(screen.getByTestId("count").textContent).toBe("0"));
    expect(document.querySelectorAll('[data-receipt-id="durable-same"]')).toHaveLength(2);
    expect(document.querySelectorAll('[data-kind="committed"]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-kind="duplicate"]')).toHaveLength(1);
  });

  it("reuses the exact command identity after transport uncertainty", async () => {
    const updated = check({ due_date: "2026-07-16", state: "snoozed" });
    const api = mockApi({
      due: vi.fn(async () => [check()]),
      snooze: vi.fn()
        .mockRejectedValueOnce(new Error("Response lost after commit"))
        .mockResolvedValueOnce(committed(updated, { replayed: true })),
    });
    renderQueue(api);
    const date = await screen.findByLabelText("Snooze target 7 until");
    fireEvent.change(date, { target: { value: "2026-07-16" } });
    const snooze = screen.getByRole("button", { name: /Snooze target 7 until/ });

    fireEvent.click(snooze);
    expect((await screen.findAllByText("Response lost after commit")).length).toBeGreaterThan(0);
    fireEvent.click(snooze);

    await waitFor(() => expect(api.snooze).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.snooze).mock.calls[0][0]).toBe(
      vi.mocked(api.snooze).mock.calls[1][0],
    );
    expect(await screen.findByText("No retention checks are due for 2026-07-15.")).toBeTruthy();
  });
});
