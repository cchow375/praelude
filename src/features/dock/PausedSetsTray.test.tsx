import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { DockProvider } from "./DockProvider";
import { PausedSetsTray } from "./PausedSetsTray";
import {
  installTauriDevMock,
  setMockPausedSetsAfterResume,
  setMockResumeRejects,
  uninstallTauriDevMock,
} from "../../devMock/tauriDevMock";
import { ReceiptCenterProvider } from "../receipts/ReceiptCenter";
import type { PausedSetRow } from "../rep/pausedSets";

// Task A4: the paused-sets tray reads `sets_paused_list` and resumes through
// the existing `rep_resume` command — no new write path. These tests run
// against the dev-mock seam (the brief's "tray lists rows (devMock fixture)")
// rather than injected callbacks, since the tray owns its own IPC calls the
// way RepPanel's host does not.

function seamInvoke<T>(cmd: string, args?: unknown): Promise<T> {
  const internals = (
    window as unknown as {
      __TAURI_INTERNALS__: { invoke: (c: string, a?: unknown) => Promise<T> };
    }
  ).__TAURI_INTERNALS__;
  return internals.invoke(cmd, args);
}

function Harness({ repSetState }: { repSetState: string | null | undefined }) {
  return (
    <DockProvider>
      <PausedSetsTray repSetState={repSetState} />
    </DockProvider>
  );
}

// Task A4b fix round 1: a separate harness (rather than changing the shared
// one above) so this is the ONLY suite exercising the `ReceiptCenter`
// surface — `ReceiptCenter` always renders an (empty when idle) `role="alert"`
// live region alongside the tray's own content-only one, which would make
// the existing rejected-receipt test's unscoped `findByRole("alert")` above
// ambiguous if the shared harness carried it too.
function ReceiptHarness({
  repSetState,
}: {
  repSetState: string | null | undefined;
}) {
  return (
    <ReceiptCenterProvider>
      <DockProvider>
        <PausedSetsTray repSetState={repSetState} />
      </DockProvider>
    </ReceiptCenterProvider>
  );
}

beforeEach(() => {
  installTauriDevMock();
});

afterEach(() => {
  cleanup();
  uninstallTauriDevMock();
});

describe("PausedSetsTray (Task A4)", () => {
  it("shows the subdued empty state when nothing is paused", async () => {
    // Force the panel open via a real pause->resume round trip first — an
    // empty state that never opens would trivially "pass" without proving
    // anything (same reasoning as RepPanel's equivalent test).
    const { rerender } = render(<Harness repSetState="active" />);
    await seamInvoke("rep_pause", { commandId: "test-pause" });
    rerender(<Harness repSetState="paused" />);
    await screen.findByRole("dialog", { name: "Paused Sets" });

    await seamInvoke("rep_resume", { commandId: "test-resume" });
    rerender(<Harness repSetState="active" />);

    const panel = await screen.findByRole("dialog", { name: "Paused Sets" });
    await waitFor(() =>
      expect(within(panel).getByText("No paused sets")).toBeTruthy(),
    );
  });

  it("auto-opens and lists a paused set's fields from the devMock fixture", async () => {
    const { rerender } = render(<Harness repSetState="active" />);
    // Pause through the mock's rep_pause path (the rep panel's own Pause
    // button exercises this same command — see RepHud's Pause/Resume chip).
    await seamInvoke("rep_pause", { commandId: "test-pause" });
    rerender(<Harness repSetState="paused" />);

    const panel = await screen.findByRole("dialog", { name: "Paused Sets" });
    await waitFor(() =>
      expect(within(panel).getByText("Scherzo No. 2")).toBeTruthy(),
    );
    expect(within(panel).getByText(/mm\. 65–96/)).toBeTruthy();
    expect(within(panel).getByRole("button", { name: "Resume" })).toBeTruthy();

    // Paused sets appear NOWHERE else — there is no separate pinned/top-strip
    // render of paused-set data left over from before the dock. A grep of
    // src/ for any such site (e.g. a "PausedStrip" component or an in-flow
    // shell render keyed off set_state==='paused') turns up nothing; this is
    // the tray-only assertion in place of "assert the old site is gone"
    // (there is no old site to assert against — see the task report).
    expect(screen.getAllByText("Scherzo No. 2")).toHaveLength(1);
  });

  it("Resume calls rep_resume and removes the row on the success receipt", async () => {
    const { rerender } = render(<Harness repSetState="active" />);
    await seamInvoke("rep_pause", { commandId: "test-pause" });
    rerender(<Harness repSetState="paused" />);

    const panel = await screen.findByRole("dialog", { name: "Paused Sets" });
    await screen.findByText("Scherzo No. 2");

    fireEvent.click(within(panel).getByRole("button", { name: "Resume" }));

    await waitFor(() =>
      expect(within(panel).getByText("No paused sets")).toBeTruthy(),
    );
    expect(within(panel).queryByText("Scherzo No. 2")).toBeNull();

    // The mock's paused-sets store agrees — proves the row disappeared
    // because the resume receipt committed, not merely a stale local filter.
    const rows = await seamInvoke<unknown[]>("sets_paused_list");
    expect(rows).toEqual([]);
  });

  // Fix round 1: `rep_resume` resolves business rejections as a REJECTED
  // MutationReceipt rather than throwing (lib.rs's `rejected_snapshot`). The
  // tray must gate row removal on `receipt.status === "committed"`, matching
  // useRetention.ts/useRep.ts's own receipt-status checks, instead of
  // treating any resolved promise as success.
  it("keeps the row and surfaces the receipt's message when rep_resume rejects", async () => {
    const { rerender } = render(<Harness repSetState="active" />);
    await seamInvoke("rep_pause", { commandId: "test-pause" });
    rerender(<Harness repSetState="paused" />);

    const panel = await screen.findByRole("dialog", { name: "Paused Sets" });
    await screen.findByText("Scherzo No. 2");

    setMockResumeRejects(true);
    fireEvent.click(within(panel).getByRole("button", { name: "Resume" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Mock-forced rejection for testing.");

    // The row stays — a rejected receipt must not remove it.
    expect(within(panel).getByText("Scherzo No. 2")).toBeTruthy();
    expect(within(panel).getByRole("button", { name: "Resume" })).toBeTruthy();

    // The backend agrees the set is still paused — proves this isn't just a
    // stale local view but the true rejected state.
    const rows =
      await seamInvoke<Array<{ piece_title: string }>>("sets_paused_list");
    expect(rows).toHaveLength(1);
    expect(rows[0].piece_title).toBe("Scherzo No. 2");

    // Sanity: the committed path still works once the mock stops rejecting
    // (proves the gate checks status, not just "did the promise resolve").
    setMockResumeRejects(false);
    fireEvent.click(within(panel).getByRole("button", { name: "Resume" }));
    await waitFor(() =>
      expect(within(panel).getByText("No paused sets")).toBeTruthy(),
    );
  });

  // Task A4b fix round 1 (IMPORTANT 2): a committed resume can atomically
  // auto-pause a DIFFERENT set (`Store::v2_resume`'s auto-pause-then-resume).
  // That other set's own transition never touches THIS engine's own
  // `repSetState` (it goes active -> active from this tray's point of view),
  // so the tray must refetch explicitly on every committed resume, not only
  // on a `repSetState` change — otherwise the newly auto-paused set appears
  // nowhere and the receipt's "Paused X · Resumed Y" summary is discarded.
  it("refetches after a committed resume and lists the set the backend just auto-paused", async () => {
    const { rerender } = render(<ReceiptHarness repSetState="active" />);
    await seamInvoke("rep_pause", { commandId: "test-pause" });
    rerender(<ReceiptHarness repSetState="paused" />);

    const panel = await screen.findByRole("dialog", { name: "Paused Sets" });
    await screen.findByText("Scherzo No. 2");

    const otherPausedRow: PausedSetRow = {
      set_id: 777,
      block_id: 777,
      piece_id: 42,
      piece_title: "Clair de Lune",
      m_start: 1,
      m_end: 8,
      bpm: 60,
      target_bpm: 90,
      paused_since_ts: new Date().toISOString(),
      current_clean_streak: 2,
    };
    setMockPausedSetsAfterResume([otherPausedRow]);

    fireEvent.click(within(panel).getByRole("button", { name: "Resume" }));

    // The resumed row (Scherzo No. 2) leaves, and the just-auto-paused one
    // (Clair de Lune) appears — proving a refetch happened, not a local
    // filter of the resumed row alone (which would have left the tray
    // empty, exactly IMPORTANT 2's failure mode).
    await waitFor(() =>
      expect(within(panel).getByText("Clair de Lune")).toBeTruthy(),
    );
    expect(within(panel).queryByText("Scherzo No. 2")).toBeNull();

    // The receipt's "Paused X · Resumed Y" summary is surfaced through the
    // established ReceiptCenter surface (its polite `role="status"` live
    // region), not silently discarded.
    const status = await screen.findByRole("status");
    await waitFor(() => {
      expect(status.textContent).toContain("Paused Clair de Lune");
      expect(status.textContent).toContain("Resumed Scherzo No. 2");
    });

    setMockPausedSetsAfterResume(null);
  });
});
