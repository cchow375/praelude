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

// Like useDaySheet.test, this suite drives the component through the REAL invoke
// path against the dev-mock's stateful notebook + goal backend — load, edit,
// save, promotion and copy-forward are exercised end to end, not stubbed.
import {
  installTauriDevMock,
  uninstallTauriDevMock,
} from "../../devMock/tauriDevMock";
import { ReceiptCenterProvider } from "../receipts/ReceiptCenter";
import { DaySheet } from "./DaySheet";
import type { NotebookLine } from "./lines";

const DATE = "2026-03-10"; // never "today", so the legacy migration never fires
const YESTERDAY = "2026-03-09";
const LONELY_DATE = "2026-05-20"; // a date whose previous day is also empty

function wrapper({ children }: { children: ReactNode }) {
  return createElement(ReceiptCenterProvider, null, children);
}

function renderSheet(date = DATE, onOpenPiece?: (id: number) => void) {
  return render(<DaySheet date={date} onOpenPiece={onOpenPiece} />, {
    wrapper,
  });
}

interface Internals {
  invoke: (cmd: string, args?: unknown) => Promise<unknown>;
}
function internals(): Internals {
  return (window as unknown as { __TAURI_INTERNALS__: Internals })
    .__TAURI_INTERNALS__;
}

/** Pre-store a sheet so a render loads it (the backend already has the row). */
async function seedSheet(date: string, lines: NotebookLine[]) {
  await internals().invoke("day_sheet_save", {
    date,
    bodyJson: JSON.stringify(lines),
  });
}

/** Wrap the live invoke seam so a test can assert the exact command + args. */
function spyInvoke() {
  const seam = internals();
  const original = seam.invoke.bind(seam);
  const spy = vi.fn((cmd: string, args?: unknown) => original(cmd, args));
  seam.invoke = spy;
  return spy;
}

function setCaret(el: HTMLElement, at: number) {
  const field = el as HTMLTextAreaElement;
  field.selectionStart = at;
  field.selectionEnd = at;
}

beforeEach(() => {
  installTauriDevMock();
});

afterEach(() => {
  cleanup();
  uninstallTauriDevMock();
  vi.useRealTimers();
});

describe("DaySheet — blank state (spec 11)", () => {
  it("renders one quiet hint line and no copy-yesterday when yesterday is empty", async () => {
    renderSheet(LONELY_DATE);
    await screen.findByTestId("day-sheet-blank");
    // Exactly one hint — a placeholder line, not an explainer paragraph.
    expect(
      screen.getByPlaceholderText("Write your practice for the day…"),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /copy yesterday/i }),
    ).toBeNull();
  });

  it("turns typing on the empty page into the first text line", async () => {
    renderSheet(DATE);
    const ghost = await screen.findByLabelText("Start the day sheet");
    fireEvent.change(ghost, { target: { value: "scales" } });
    await waitFor(() =>
      expect(screen.getByDisplayValue("scales")).toBeTruthy(),
    );
    expect(screen.queryByTestId("day-sheet-blank")).toBeNull();
  });

  it("copies yesterday's lines in UNCHECKED (bite: a checked item comes over unchecked)", async () => {
    await seedSheet(YESTERDAY, [
      { type: "item", text: "arpeggios", checked: true },
    ]);
    renderSheet(DATE);
    const copy = await screen.findByRole("button", { name: /copy yesterday/i });
    fireEvent.click(copy);
    const box = await screen.findByRole("checkbox");
    expect(screen.getByDisplayValue("arpeggios")).toBeTruthy();
    // Would be "true" if copy-forward forgot to reset item state.
    expect(box.getAttribute("aria-checked")).toBe("false");
  });
});

describe("DaySheet — line editing (spec 9/12)", () => {
  it("splits a line at the caret on Enter (bite: exact offset, tail preserved)", async () => {
    await seedSheet(DATE, [{ type: "text", text: "abcdef" }]);
    renderSheet();
    const line = await screen.findByDisplayValue("abcdef");
    setCaret(line, 3);
    fireEvent.keyDown(line, { key: "Enter" });
    expect(screen.getByDisplayValue("abc")).toBeTruthy();
    expect(screen.getByDisplayValue("def")).toBeTruthy();
  });

  it("joins into the previous line when Backspace is pressed at the start", async () => {
    await seedSheet(DATE, [
      { type: "text", text: "first" },
      { type: "text", text: "second" },
    ]);
    renderSheet();
    const second = await screen.findByDisplayValue("second");
    setCaret(second, 0);
    fireEvent.keyDown(second, { key: "Backspace" });
    await waitFor(() =>
      expect(screen.getByDisplayValue("firstsecond")).toBeTruthy(),
    );
    expect(screen.queryByDisplayValue("second")).toBeNull();
  });

  it("toggles a plan item's checkbox as display state", async () => {
    await seedSheet(DATE, [
      { type: "item", text: "octave run", checked: false },
    ]);
    renderSheet();
    const box = await screen.findByRole("checkbox");
    expect(box.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(box);
    await waitFor(() =>
      expect(screen.getByRole("checkbox").getAttribute("aria-checked")).toBe(
        "true",
      ),
    );
  });

  it("indents a text line into a checkbox item under the piece on Tab", async () => {
    await seedSheet(DATE, [
      { type: "piece", piece_id: 1 },
      { type: "text", text: "trill" },
    ]);
    renderSheet();
    const line = await screen.findByDisplayValue("trill");
    fireEvent.focus(line);
    fireEvent.keyDown(line, { key: "Tab" });
    await waitFor(() => expect(screen.getByRole("checkbox")).toBeTruthy());
    // Still fully editable as text after becoming structured.
    expect(screen.getByDisplayValue("trill")).toBeTruthy();
  });
});

describe("DaySheet — chips insert editable text (spec C1)", () => {
  it("inserts a chip's text at the focused item's caret (bite: at the caret, not the end)", async () => {
    await seedSheet(DATE, [
      { type: "piece", piece_id: 1 },
      { type: "item", text: "abcdef", checked: false, piece_id: 1 },
    ]);
    renderSheet();
    const item = await screen.findByDisplayValue("abcdef");
    fireEvent.focus(item);
    setCaret(item, 3);
    fireEvent.click(screen.getByRole("button", { name: "mm." }));
    await waitFor(() =>
      expect(screen.getByDisplayValue("abcmm. def")).toBeTruthy(),
    );
  });
});

describe("DaySheet — piece picker (spec C1)", () => {
  it("adds a piece heading from the picker", async () => {
    await seedSheet(DATE, [{ type: "text", text: "warmup" }]);
    renderSheet();
    await screen.findByDisplayValue("warmup");
    fireEvent.click(screen.getByRole("button", { name: "piece" }));
    const picker = await screen.findByTestId("piece-picker");
    fireEvent.click(await within(picker).findByText("Scherzo No. 2"));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Scherzo No. 2" }),
      ).toBeTruthy(),
    );
    expect(screen.queryByTestId("piece-picker")).toBeNull();
  });

  it("opens the picker when a line becomes '/piece' and converts it to a heading", async () => {
    await seedSheet(DATE, [{ type: "text", text: "" }]);
    renderSheet();
    const line = await screen.findByLabelText("Line 1");
    fireEvent.change(line, { target: { value: "/piece" } });
    const picker = await screen.findByTestId("piece-picker");
    fireEvent.click(await within(picker).findByText("The White Peacock"));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "The White Peacock" }),
      ).toBeTruthy(),
    );
  });
});

describe("DaySheet — timed blocks + header total (spec 1/2)", () => {
  it("totals block minutes in the header and re-totals when a block is edited", async () => {
    await seedSheet(DATE, [
      { type: "piece", piece_id: 1 },
      { type: "block", minutes: 25, piece_id: 1 },
      { type: "block", minutes: 10, piece_id: 1 },
    ]);
    renderSheet();
    await waitFor(() =>
      expect(screen.getByText("Σ 35 min planned")).toBeTruthy(),
    );
    const minutes = screen.getAllByLabelText("Block minutes");
    fireEvent.change(minutes[1], { target: { value: "20" } });
    fireEvent.blur(minutes[1]);
    await waitFor(() =>
      expect(screen.getByText("Σ 45 min planned")).toBeTruthy(),
    );
  });

  it("adds a timed block from the focused item's chip", async () => {
    await seedSheet(DATE, [
      { type: "piece", piece_id: 1 },
      { type: "item", text: "slow hands", checked: false, piece_id: 1 },
    ]);
    renderSheet();
    const item = await screen.findByDisplayValue("slow hands");
    fireEvent.focus(item);
    fireEvent.click(screen.getByRole("button", { name: "25 min" }));
    await waitFor(() =>
      expect(
        screen.getByText("Σ 25 min planned · 1 lines unestimated"),
      ).toBeTruthy(),
    );
  });
});

describe("DaySheet — goal promotion (spec 13)", () => {
  it("promotes a plan item via goal_create with the right args, then renders a goal_ref", async () => {
    const spy = spyInvoke();
    await seedSheet(DATE, [
      { type: "piece", piece_id: 1 },
      { type: "item", text: "clean the coda", checked: false, piece_id: 1 },
    ]);
    renderSheet();
    const item = await screen.findByDisplayValue("clean the coda");
    fireEvent.focus(item);
    fireEvent.click(screen.getByRole("button", { name: "goal" }));

    // Assert the recorded call directly (invoke also passes a trailing options
    // arg, so a positional toHaveBeenCalledWith would miss it).
    await waitFor(() => {
      const call = spy.mock.calls.find((args) => args[0] === "goal_create");
      expect(call).toBeTruthy();
      expect(call?.[1]).toMatchObject({
        args: { piece_id: 1, text: "clean the coda" },
      });
    });
    // The line is swapped for a goal_ref: goal text + an inline-editable deadline.
    const goalField = await screen.findByLabelText("Goal");
    expect((goalField as HTMLInputElement).value).toBe("clean the coda");
    expect(screen.getByLabelText("Goal deadline")).toBeTruthy();
    // The plan item was swapped for the goal, so its checkbox is gone.
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("keeps a promoted goal's text after the sheet remounts (re-resolves via goal_list)", async () => {
    await seedSheet(DATE, [
      { type: "piece", piece_id: 1 },
      { type: "item", text: "clean the coda", checked: false, piece_id: 1 },
    ]);
    const first = renderSheet();
    const item = await screen.findByDisplayValue("clean the coda");
    fireEvent.focus(item);
    fireEvent.click(screen.getByRole("button", { name: "goal" }));
    const goalField = await screen.findByLabelText("Goal");
    expect((goalField as HTMLInputElement).value).toBe("clean the coda");

    // Unmount (flushes the autosave) then remount fresh: the goal cache is empty,
    // so the goal_ref text can only come back through goal_list.
    first.unmount();
    renderSheet();
    const reResolved = await screen.findByLabelText("Goal");
    await waitFor(() =>
      expect((reResolved as HTMLInputElement).value).toBe("clean the coda"),
    );
  });

  it("disables the goal chip on an item with no piece heading above it", async () => {
    await seedSheet(DATE, [
      { type: "item", text: "loose note", checked: false },
    ]);
    renderSheet();
    const item = await screen.findByDisplayValue("loose note");
    fireEvent.focus(item);
    expect(
      screen.getByRole("button", { name: "goal" }).hasAttribute("disabled"),
    ).toBe(true);
  });
});

describe("DaySheet — pin a goal to the score (A11)", () => {
  /** Promote a seeded plan item to a goal and return its rendered ⚑ row. */
  async function promoteToGoal(text: string) {
    await seedSheet(DATE, [
      { type: "piece", piece_id: 1 },
      { type: "item", text, checked: false, piece_id: 1 },
    ]);
    renderSheet();
    const item = await screen.findByDisplayValue(text);
    fireEvent.focus(item);
    fireEvent.click(screen.getByRole("button", { name: "goal" }));
    return await screen.findByLabelText("Goal");
  }

  function bannerCalls(spy: ReturnType<typeof spyInvoke>) {
    return spy.mock.calls.filter((args) => args[0] === "piece_banner_set");
  }

  it("pins the ⚑ line's text to its piece's score banner", async () => {
    const spy = spyInvoke();
    await promoteToGoal("clean the coda");

    fireEvent.click(
      screen.getByRole("button", { name: "Pin this goal to the score" }),
    );

    await waitFor(() => expect(bannerCalls(spy)).toHaveLength(1));
    expect(bannerCalls(spy)[0][1]).toEqual({
      pieceId: 1,
      text: "clean the coda",
    });

    // The pin really reached the piece, not just the wire.
    const detail = (await internals().invoke("piece_get", { id: 1 })) as {
      banner_text: string | null;
    };
    expect(detail.banner_text).toBe("clean the coda");
  });

  it("truncates an over-long goal to exactly 140 characters with an ellipsis", async () => {
    const spy = spyInvoke();
    const long = `${"a".repeat(200)}`;
    await promoteToGoal(long);

    fireEvent.click(
      screen.getByRole("button", { name: "Pin this goal to the score" }),
    );

    await waitFor(() => expect(bannerCalls(spy)).toHaveLength(1));
    const sent = (bannerCalls(spy)[0][1] as { text: string }).text;
    expect(Array.from(sent)).toHaveLength(140);
    expect(sent.endsWith("…")).toBe(true);
    expect(sent.startsWith("aaa")).toBe(true);
  });

  it("last pin wins — a second pin overwrites the banner unconditionally", async () => {
    const spy = spyInvoke();
    await promoteToGoal("first goal");
    fireEvent.click(
      screen.getByRole("button", { name: "Pin this goal to the score" }),
    );
    await waitFor(() => expect(bannerCalls(spy)).toHaveLength(1));

    // Retype the goal and pin again: no merge prompt, the new text simply wins.
    const goalField = await screen.findByLabelText("Goal");
    fireEvent.change(goalField, { target: { value: "second goal" } });
    fireEvent.click(
      screen.getByRole("button", { name: "Pin this goal to the score" }),
    );

    await waitFor(() => expect(bannerCalls(spy)).toHaveLength(2));
    expect(bannerCalls(spy)[1][1]).toEqual({
      pieceId: 1,
      text: "second goal",
    });
    const detail = (await internals().invoke("piece_get", { id: 1 })) as {
      banner_text: string | null;
    };
    expect(detail.banner_text).toBe("second goal");
  });

  it("renders no pin at all on a ⚑ line with no piece to pin it to", async () => {
    // A goal_ref with no piece heading above it has no piece context and no
    // resolvable goal, so there is nothing to pin — and no disabled button.
    await seedSheet(DATE, [{ type: "goal_ref", goal_id: 401 }]);
    renderSheet();
    await screen.findByLabelText("Goal");
    expect(
      screen.queryByRole("button", { name: "Pin this goal to the score" }),
    ).toBeNull();
  });
});
