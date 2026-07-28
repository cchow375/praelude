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
  it("mounts Today and shows the most-recently-practiced piece", async () => {
    renderWorkspace(
      <TodayWorkspace
        onOpenAtlas={() => {}}
        onOpenCalendar={() => {}}
        onOpenPiece={() => {}}
        onOpenBrain={() => {}}
        onOpenLedger={() => {}}
        onOpenUniverse={() => {}}
        onOpenSettings={() => {}}
      />,
    );
    // Today is the app menu now; the day surfaces open as a window over it.
    fireEvent.click(screen.getByRole("button", { name: "Today's Practice" }));
    // universe_snapshot drives the "Next honest move" card with the recent piece.
    expect(
      await screen.findByRole("heading", { name: "Scherzo No. 2" }),
    ).toBeTruthy();
  });

  it("mounts Atlas (Score Atlas piece library) and lists pieces", async () => {
    renderWorkspace(<PiecesPanel onOpenBlock={async () => {}} />);
    // pieces_list populates the library rows.
    expect(await screen.findByText("Scherzo No. 2")).toBeTruthy();
    expect(screen.getByText("The White Peacock")).toBeTruthy();
  });

  it("mounts Ledger and discloses an anomaly group", async () => {
    renderWorkspace(<LedgerWorkspace />);
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

  it("mounts Universe and draws a sun + planet for an earned system", async () => {
    const { container } = renderWorkspace(
      <UniverseWorkspace onOpenPractice={() => {}} />,
    );
    // universe_snapshot with earned signal renders the live force-graph galaxy:
    // a sun for the piece and a planet for each earned region.
    await screen.findByRole("heading", { name: "Your earned systems" });
    expect(container.querySelector('[data-node-id="piece-1"]')).toBeTruthy();
    expect(container.querySelector(".universe-node-planet")).toBeTruthy();
  });
});
