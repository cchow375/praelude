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
  uninstallTauriDevMock,
} from "../../devMock/tauriDevMock";

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
});
