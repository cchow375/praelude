import { createElement, type ReactNode } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  installTauriDevMock,
  uninstallTauriDevMock,
} from "../../devMock/tauriDevMock";
import { ReceiptCenterProvider } from "../receipts/ReceiptCenter";
import { PieceDetail } from "./PieceDetail";
import type { PieceDetailData } from "./types";

// The Schedule section (usePiecePlan) is exercised end to end through the
// dev-mock's stateful piece_plan backend. The sibling Details panels are stubbed
// so only the plan round-trip is under test.
vi.mock("../rep/useCrud", () => ({
  useCrud: () => ({ pieceFieldUpdate: vi.fn() }),
}));
vi.mock("./GoalsPanel", () => ({ GoalsPanel: () => null }));
vi.mock("./RegionEditor", () => ({ TrickySectionsPanel: () => null }));
vi.mock("../references/ReferenceButtons", () => ({
  ReferenceButtons: () => null,
}));
vi.mock("./HistoryPanel", () => ({ HistoryPanel: () => null }));
vi.mock("../score/ScoreView", () => ({ ScoreView: () => null }));
vi.mock("../rep/BlockForm", () => ({ BlockForm: () => null }));

const piece: PieceDetailData = {
  id: 3,
  title: "Prelude",
  composer: "Bach",
  folder_path: "/vault/Prelude",
  xml_path: null,
  pdf_path: null,
  has_xml: false,
  has_pdf: false,
  intake_done: true,
  goals: [],
  deadline: null,
  target_tempo: 80,
  hard_spots: [],
  current_state: null,
  notes: null,
  banner_text: null,
};

function wrapper({ children }: { children: ReactNode }) {
  return createElement(ReceiptCenterProvider, null, children);
}

function renderDetail() {
  return render(
    <PieceDetail piece={piece} onBack={vi.fn()} onOpenBlock={vi.fn()} />,
    { wrapper },
  );
}

beforeEach(() => installTauriDevMock());
afterEach(() => {
  cleanup();
  uninstallTauriDevMock();
});

describe("PieceDetail — Schedule section", () => {
  it("shows a blank editor (one quiet hint) when the piece has no plan", async () => {
    renderDetail();
    const field = (await screen.findByLabelText(
      "Piece schedule",
    )) as HTMLTextAreaElement;
    await waitFor(() => expect(field.disabled).toBe(false));
    expect(field.value).toBe("");
    expect(field.getAttribute("placeholder")).toBeTruthy();
  });

  it("saves an edit and reloads it after a remount", async () => {
    const first = renderDetail();
    const field = (await screen.findByLabelText(
      "Piece schedule",
    )) as HTMLTextAreaElement;
    await waitFor(() => expect(field.disabled).toBe(false));

    fireEvent.change(field, {
      target: { value: "Weeks 1–2: hands separate, then slow together." },
    });
    // Blur flushes the debounced save immediately (piece_plan_save fires now).
    fireEvent.blur(field);

    first.unmount();

    renderDetail();
    const reloaded = (await screen.findByLabelText(
      "Piece schedule",
    )) as HTMLTextAreaElement;
    await waitFor(() =>
      expect(reloaded.value).toBe(
        "Weeks 1–2: hands separate, then slow together.",
      ),
    );
  });
});
