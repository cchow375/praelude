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

import {
  installTauriDevMock,
  uninstallTauriDevMock,
} from "../../devMock/tauriDevMock";
import { ReceiptCenterProvider } from "../receipts/ReceiptCenter";
import { TodaySheetProvider, TodayDaySheet } from "./DaySheetStore";
import { ScorePlanTab } from "./ScorePlanTab";
import {
  PassageHelper,
  type AssistantSuggestions,
  type SuggestFn,
} from "./PassageHelper";
import type { ExcerptFetcher } from "../reader/ReaderWindow";
import { todayLocal } from "../calendar/dates";
import type { NotebookLine } from "./lines";

const TODAY = todayLocal();

// -- shared helpers ---------------------------------------------------------

function suggestions(...rows: AssistantSuggestions["suggestions"]) {
  return { suggestions: rows };
}

const twoRows = suggestions(
  { id: "s1", text: "Practice hands separately at half tempo." },
  {
    id: "s2",
    text: "Place a silent landing before the leap.",
    source_id: "roskell-complete-pianist",
    source_author: "Penelope Roskell",
    source_heading: "Leaps and lateral movements",
  },
);

async function ask(description = "the leap keeps missing") {
  fireEvent.change(screen.getByLabelText("Describe the passage"), {
    target: { value: description },
  });
  fireEvent.click(screen.getByRole("button", { name: "Ask" }));
}

beforeEach(() => {
  installTauriDevMock();
});
afterEach(() => {
  cleanup();
  uninstallTauriDevMock();
  vi.useRealTimers();
});

// -- isolated component behavior (stubbed provider) -------------------------

describe("PassageHelper — card behavior (spec C4)", () => {
  it("asks for strategies and renders 2–4 one-line rows with Accept / No / More", async () => {
    const suggest: SuggestFn = vi.fn(async () => twoRows);
    render(<PassageHelper pieceId={1} onAccept={() => {}} suggest={suggest} />);

    await ask();

    await waitFor(() =>
      expect(
        screen.getByText("Practice hands separately at half tempo."),
      ).toBeTruthy(),
    );
    expect(screen.getAllByRole("button", { name: "Accept" }).length).toBe(2);
    expect(screen.getAllByRole("button", { name: "No" }).length).toBe(2);
    expect(screen.getAllByRole("button", { name: "More" }).length).toBe(2);
  });

  it("Accept calls onAccept exactly once with the row text and dismisses the row", async () => {
    const onAccept = vi.fn();
    const suggest: SuggestFn = vi.fn(async () => twoRows);
    render(<PassageHelper pieceId={1} onAccept={onAccept} suggest={suggest} />);
    await ask();
    await screen.findByText("Practice hands separately at half tempo.");

    fireEvent.click(screen.getAllByRole("button", { name: "Accept" })[0]);

    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onAccept).toHaveBeenCalledWith(
      "Practice hands separately at half tempo.",
    );
    await waitFor(() =>
      expect(
        screen.queryByText("Practice hands separately at half tempo."),
      ).toBeNull(),
    );
  });

  it("No dismisses a row and never calls onAccept", async () => {
    const onAccept = vi.fn();
    const suggest: SuggestFn = vi.fn(async () => twoRows);
    render(<PassageHelper pieceId={1} onAccept={onAccept} suggest={suggest} />);
    await ask();
    await screen.findByText("Practice hands separately at half tempo.");

    fireEvent.click(screen.getAllByRole("button", { name: "No" })[0]);

    await waitFor(() =>
      expect(
        screen.queryByText("Practice hands separately at half tempo."),
      ).toBeNull(),
    );
    expect(onAccept).not.toHaveBeenCalled();
  });

  it("More re-invokes with expand_of and replaces that one row in place", async () => {
    const suggest = vi.fn<Parameters<SuggestFn>, ReturnType<SuggestFn>>(
      async (args) =>
        args.expandOf
          ? suggestions({
              id: "expanded",
              text: "Play the leap hand alone.\nStop silently on the landing.\nThen add the beat before at half tempo.",
            })
          : twoRows,
    );
    render(<PassageHelper pieceId={1} onAccept={() => {}} suggest={suggest} />);
    await ask();
    await screen.findByText("Practice hands separately at half tempo.");

    fireEvent.click(screen.getAllByRole("button", { name: "More" })[0]);

    await waitFor(() =>
      expect(screen.getByText(/Play the leap hand alone/)).toBeTruthy(),
    );
    // The expand call carried the original row text as expand_of.
    expect(suggest).toHaveBeenLastCalledWith(
      expect.objectContaining({
        pieceId: 1,
        expandOf: "Practice hands separately at half tempo.",
      }),
    );
    // The expanded version stays ≤3 lines.
    expect(
      screen
        .getByText(/Play the leap hand alone/)
        .textContent!.split("\n")
        .filter((line) => line.trim() !== "").length,
    ).toBeLessThanOrEqual(3);
  });

  it("shows an honest offline state when the provider is unavailable", async () => {
    const suggest: SuggestFn = vi.fn(async () => {
      throw new Error("no key configured");
    });
    render(<PassageHelper pieceId={1} onAccept={() => {}} suggest={suggest} />);

    await ask();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/offline/i);
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
  });

  it("a cited row shows a quiet source marker that opens the reader", async () => {
    const suggest: SuggestFn = vi.fn(async () => twoRows);
    const fetchExcerpt: ExcerptFetcher = vi.fn(async (req) => ({
      source_id: req.sourceId,
      title: "The Complete Pianist",
      author: "Penelope Roskell",
      heading: "Leaps and lateral movements",
      text: "Look ahead before a lateral jump and organize the arrival.",
    }));
    render(
      <PassageHelper
        pieceId={1}
        onAccept={() => {}}
        suggest={suggest}
        fetchExcerpt={fetchExcerpt}
      />,
    );
    await ask();
    // The uncited row has no marker; the cited row shows the author.
    const marker = await screen.findByRole("button", {
      name: "Penelope Roskell",
    });

    fireEvent.click(marker);

    expect(await screen.findByTestId("reader-window")).toBeTruthy();
    expect(fetchExcerpt).toHaveBeenCalledWith({
      sourceId: "roskell-complete-pianist",
      contains: "Leaps and lateral movements",
    });
  });
});

// -- host integration through the real invoke seam --------------------------

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

function Harness({ children }: { children: ReactNode }) {
  return createElement(
    ReceiptCenterProvider,
    null,
    createElement(TodaySheetProvider, null, children),
  );
}

describe("PassageHelper — host integration (spec C4)", () => {
  it("renders in the Score Plan tab host", async () => {
    await seedSheet([{ type: "piece", piece_id: 1 }]);
    render(<ScorePlanTab pieceId={1} />, { wrapper: Harness });

    expect(
      await screen.findByPlaceholderText("Stuck? Describe the passage."),
    ).toBeTruthy();
  });

  it("renders in the day-sheet host under a focused piece heading", async () => {
    await seedSheet([{ type: "piece", piece_id: 1 }]);
    render(<TodayDaySheet />, { wrapper: Harness });

    // The helper is quiet until the piece heading is focused.
    await waitFor(() => expect(screen.getByText("Scherzo No. 2")).toBeTruthy());
    expect(
      screen.queryByPlaceholderText("Stuck? Describe the passage."),
    ).toBeNull();

    fireEvent.focus(screen.getByRole("button", { name: /Scherzo No\. 2/ }));

    expect(
      await screen.findByPlaceholderText("Stuck? Describe the passage."),
    ).toBeTruthy();
  });

  it("Accept appends exactly one checkbox plan item and invokes no practice command", async () => {
    await seedSheet([{ type: "piece", piece_id: 1 }]);
    const spy = spyInvoke();
    render(
      <>
        <TodayDaySheet />
        <ScorePlanTab pieceId={1} />
      </>,
      { wrapper: Harness },
    );

    const plan = await screen.findByRole("region", {
      name: "Today's plan for this piece",
    });
    // No plan items yet.
    expect(within(plan).getByTestId("score-plan-empty")).toBeTruthy();

    // Ask (through the dev-mock's canned assistant_suggest) inside the Plan tab.
    const helper = within(plan).getByTestId("passage-helper");
    fireEvent.change(within(helper).getByLabelText("Describe the passage"), {
      target: { value: "the leap keeps missing" },
    });
    fireEvent.click(within(helper).getByRole("button", { name: "Ask" }));

    const accepts = await within(helper).findAllByRole("button", {
      name: "Accept",
    });
    spy.mockClear();
    const acceptedText = within(helper)
      .getAllByText(/./, { selector: ".passage-helper-text" })[0]
      .textContent!.replace("Penelope Roskell", "")
      .trim();
    fireEvent.click(accepts[0]);

    // Exactly one plan item now belongs to the piece (store assertion via the
    // shared Plan-tab view over the same body).
    await waitFor(() =>
      expect(within(plan).getByDisplayValue(acceptedText)).toBeTruthy(),
    );
    const items = within(plan).getAllByLabelText(/^Plan item /);
    expect(items.length).toBe(1);

    // The only writes are day-sheet saves; no rep/attempt/set/block command runs.
    await waitFor(() =>
      expect(spy.mock.calls.some(([cmd]) => cmd === "day_sheet_save")).toBe(
        true,
      ),
    );
    const forbidden = spy.mock.calls
      .map(([cmd]) => String(cmd))
      .filter((cmd) =>
        /^(rep_|attempt|set_|retention_(confirm|record)|block_|metro_)/.test(
          cmd,
        ),
      );
    expect(forbidden).toEqual([]);
  });

  it("No writes nothing to the shared store", async () => {
    await seedSheet([{ type: "piece", piece_id: 1 }]);
    render(<ScorePlanTab pieceId={1} />, { wrapper: Harness });

    const plan = await screen.findByRole("region", {
      name: "Today's plan for this piece",
    });
    const helper = within(plan).getByTestId("passage-helper");
    fireEvent.change(within(helper).getByLabelText("Describe the passage"), {
      target: { value: "the leap keeps missing" },
    });
    fireEvent.click(within(helper).getByRole("button", { name: "Ask" }));

    const nos = await within(helper).findAllByRole("button", { name: "No" });
    const spy = spyInvoke();
    fireEvent.click(nos[0]);

    // The row is gone and no day_sheet_save was triggered by a dismissal.
    await waitFor(() =>
      expect(
        within(helper).queryAllByRole("button", { name: "No" }).length,
      ).toBe(nos.length - 1),
    );
    expect(spy.mock.calls.some(([cmd]) => cmd === "day_sheet_save")).toBe(
      false,
    );
    // The piece still has no plan items.
    expect(within(plan).getByTestId("score-plan-empty")).toBeTruthy();
  });
});
