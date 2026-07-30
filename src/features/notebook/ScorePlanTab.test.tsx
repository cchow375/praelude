import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

// Drive the Plan tab and the day sheet through the REAL invoke seam against the
// dev-mock's stateful notebook backend, so the shared-store two-way sync (spec
// C3) is exercised end to end rather than stubbed.
import {
  installTauriDevMock,
  uninstallTauriDevMock,
} from "../../devMock/tauriDevMock";
import { ReceiptCenterProvider } from "../receipts/ReceiptCenter";
import { TodaySheetProvider, TodayDaySheet } from "./DaySheetStore";
import { ScorePlanTab } from "./ScorePlanTab";
import { todayLocal } from "../calendar/dates";
import type { NotebookLine } from "./lines";

const TODAY = todayLocal();

interface Internals {
  invoke: (cmd: string, args?: unknown) => Promise<unknown>;
}
function internals(): Internals {
  return (window as unknown as { __TAURI_INTERNALS__: Internals })
    .__TAURI_INTERNALS__;
}

async function seedSheet(lines: NotebookLine[]) {
  await internals().invoke("day_sheet_save", {
    date: TODAY,
    bodyJson: JSON.stringify(lines),
  });
}

function spyInvoke() {
  const seam = internals();
  const original = seam.invoke.bind(seam);
  const spy = vi.fn((cmd: string, args?: unknown) => original(cmd, args));
  seam.invoke = spy;
  return spy;
}

/** Both surfaces live under ONE provider so they read/write the same store. */
function renderBoth(pieceId = 1) {
  function Harness({ children }: { children: ReactNode }) {
    return createElement(
      ReceiptCenterProvider,
      null,
      createElement(TodaySheetProvider, null, children),
    );
  }
  return render(
    <>
      <TodayDaySheet />
      <ScorePlanTab pieceId={pieceId} />
    </>,
    { wrapper: Harness },
  );
}

beforeEach(() => {
  installTauriDevMock();
});
afterEach(() => {
  cleanup();
  uninstallTauriDevMock();
  vi.useRealTimers();
});

describe("ScorePlanTab — shared-store two-way sync (spec C3)", () => {
  it("shows the day's plan items for the visible piece from the shared store", async () => {
    await seedSheet([
      { type: "piece", piece_id: 1 },
      { type: "item", text: "Slow hands separately", checked: false },
      // A different piece's item must NOT appear in piece 1's Plan tab.
      { type: "piece", piece_id: 2 },
      { type: "item", text: "Voicing the melody", checked: false },
    ]);
    renderBoth(1);

    const plan = await screen.findByRole("region", {
      name: "Today's plan for this piece",
    });
    await waitFor(() =>
      expect(
        within(plan).queryByDisplayValue("Slow hands separately"),
      ).toBeTruthy(),
    );
    expect(within(plan).queryByDisplayValue("Voicing the melody")).toBeNull();
  });

  it("propagates a Plan-tab text edit to the day sheet (Plan → sheet)", async () => {
    await seedSheet([
      { type: "piece", piece_id: 1 },
      { type: "item", text: "Slow hands", checked: false },
    ]);
    renderBoth(1);

    // The item sits at body index 1 in BOTH surfaces (same shared body), so both
    // its day-sheet field and its Plan-tab field carry the label "Plan item 2".
    await waitFor(() =>
      expect(screen.getAllByLabelText("Plan item 2").length).toBe(2),
    );
    const [sheetField, planField] = screen.getAllByLabelText(
      "Plan item 2",
    ) as HTMLInputElement[];

    fireEvent.change(planField, { target: { value: "Slow hands at 60" } });

    await waitFor(() =>
      expect((sheetField as HTMLTextAreaElement).value).toBe(
        "Slow hands at 60",
      ),
    );
  });

  it("propagates a day-sheet text edit to the Plan tab (sheet → Plan)", async () => {
    await seedSheet([
      { type: "piece", piece_id: 1 },
      { type: "item", text: "Slow hands", checked: false },
    ]);
    renderBoth(1);

    await waitFor(() =>
      expect(screen.getAllByLabelText("Plan item 2").length).toBe(2),
    );
    const [sheetField, planField] = screen.getAllByLabelText(
      "Plan item 2",
    ) as HTMLInputElement[];

    fireEvent.change(sheetField, { target: { value: "Dotted rhythms" } });

    await waitFor(() => expect(planField.value).toBe("Dotted rhythms"));
  });

  it("adds a Plan-tab item as a checkbox line on the day sheet", async () => {
    await seedSheet([{ type: "piece", piece_id: 1 }]);
    renderBoth(1);

    const plan = await screen.findByRole("region", {
      name: "Today's plan for this piece",
    });
    fireEvent.change(within(plan).getByLabelText("Add a plan item"), {
      target: { value: "Left hand alone" },
    });
    fireEvent.click(within(plan).getByRole("button", { name: "Add" }));

    // It appears on the day sheet (outside the Plan section) as an editable line.
    await waitFor(() =>
      expect(
        screen.getAllByDisplayValue("Left hand alone").length,
      ).toBeGreaterThanOrEqual(2),
    );
  });

  it("checking an item never writes practice truth — only the day sheet saves", async () => {
    await seedSheet([
      { type: "piece", piece_id: 1 },
      { type: "item", text: "Slow hands", checked: false },
    ]);
    const spy = spyInvoke();
    renderBoth(1);

    const plan = await screen.findByRole("region", {
      name: "Today's plan for this piece",
    });
    const check = within(plan).getByRole("checkbox", { name: "Mark done" });
    spy.mockClear();
    fireEvent.click(check);

    // The check reflects on both surfaces (display state).
    await waitFor(() =>
      expect(
        within(plan).getByRole("checkbox", { name: "Mark not done" }),
      ).toBeTruthy(),
    );

    // The only write the debounced save issues is day_sheet_save. No attempt,
    // rep, or set command is ever invoked — attempt history stays the sole truth.
    await waitFor(() =>
      expect(spy.mock.calls.some(([cmd]) => cmd === "day_sheet_save")).toBe(
        true,
      ),
    );
    const forbidden = spy.mock.calls
      .map(([cmd]) => String(cmd))
      .filter((cmd) =>
        /^(rep_|attempt|set_|retention_(confirm|record)|block_)/.test(cmd),
      );
    expect(forbidden).toEqual([]);
  });
});
