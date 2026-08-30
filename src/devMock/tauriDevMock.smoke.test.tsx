import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
  type RenderResult,
} from "@testing-library/react";
import type { ReactElement } from "react";

// This suite deliberately does NOT mock "@tauri-apps/api/*": it exercises the
// real invoke/listen path against the dev-mock's window.__TAURI_INTERNALS__ seam,
// proving each of the five v2 workspaces MOUNTS and renders meaningful content
// with only the flag-gated dev mock installed. It is the objective acceptance
// for `npm run dev:mock` — a static render harness, not functional QA.
import { installTauriDevMock, uninstallTauriDevMock } from "./tauriDevMock";
import { ReceiptCenterProvider } from "../features/receipts/ReceiptCenter";
import { TodayWorkspace } from "../features/today/TodayWorkspace";
import { TodaySheetProvider } from "../features/notebook/DaySheetStore";
import { PiecesPanel } from "../features/pieces/PiecesPanel";
import { LedgerWorkspace } from "../features/ledger/LedgerWorkspace";
import { CalendarWorkspace } from "../features/calendar/CalendarWorkspace";
import { UniverseWorkspace } from "../features/universe/UniverseWorkspace";

function renderWorkspace(node: ReactElement): RenderResult {
  return render(<ReceiptCenterProvider>{node}</ReceiptCenterProvider>);
}

beforeEach(() => {
  installTauriDevMock();
});

afterEach(() => {
  cleanup();
  uninstallTauriDevMock();
});

describe("dev-mock five-workspace render harness", () => {
  it("mounts Today and opens the day-sheet-first practice window", async () => {
    renderWorkspace(
      <TodaySheetProvider>
        <TodayWorkspace
          onOpenAtlas={() => {}}
          onOpenCalendar={() => {}}
          onOpenPiecePlan={() => {}}
          onOpenBrain={() => {}}
          onOpenLedger={() => {}}
          onOpenUniverse={() => {}}
          onOpenSettings={() => {}}
        />
      </TodaySheetProvider>,
    );
    // Today is the app menu now; the day surfaces open as a window over it, and
    // the day sheet is the first surface inside (spec C5).
    fireEvent.click(screen.getByRole("button", { name: "Today's Practice" }));
    const dialog = await screen.findByRole("region", {
      name: "Today's Practice",
    });
    expect(within(dialog).getByTestId("day-sheet")).toBeTruthy();
  });

  it("mounts Atlas (Score Atlas piece library) and lists pieces", async () => {
    renderWorkspace(<PiecesPanel onOpenBlock={async () => {}} />);
    // pieces_list populates the library rows.
    expect(await screen.findByText("Scherzo No. 2")).toBeTruthy();
    expect(screen.getByText("The White Peacock")).toBeTruthy();
  });

  it("mounts Ledger and discloses an anomaly group", async () => {
    renderWorkspace(<LedgerWorkspace />);
    // Days is the History default; switch to By piece
    // to reach the untouched piece-index content this test exercises.
    fireEvent.click(await screen.findByRole("tab", { name: "By piece" }));
    // pieces_list fills the index and auto-selects the first piece (title shown
    // in both the index row and the selected-record header).
    expect(
      (await screen.findAllByText("Scherzo No. 2")).length,
    ).toBeGreaterThan(0);
    // anomalies_list drives the read-only disclosure panel.
    const anomalies = await screen.findByTestId("ledger-anomalies");
    expect(within(anomalies).getByText("3 disclosed")).toBeTruthy();
  });

  it("mounts Calendar and shows a big-goal milestone from goal_list", async () => {
    renderWorkspace(<CalendarWorkspace />);
    // goal_list yields a big goal whose target_date is today, rendered as a
    // deadline milestone in the week strip.
    expect(
      await screen.findByText("Perform Scherzo No. 2 from memory"),
    ).toBeTruthy();
  });

  it("mounts Universe and lays out a card + region marks for an earned piece", async () => {
    const { container } = renderWorkspace(
      <UniverseWorkspace onOpenPractice={() => {}} />,
    );
    // universe_snapshot with earned signal renders the still repertoire map:
    // a card per piece, one mark per earned region. (The force-graph galaxy
    // this used to assert was removed in the paper rewrite.)
    await screen.findByRole("heading", { name: "Your repertoire" });
    expect(screen.getByTestId("universe-piece-1")).toBeTruthy();
    expect(container.querySelector(".universe-block")).toBeTruthy();
  });
});
