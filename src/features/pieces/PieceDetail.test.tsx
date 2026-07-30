import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RepOpenArgs } from "../rep/useRep";
import type { PieceDetailData } from "./types";
import { PieceDetail } from "./PieceDetail";

vi.mock("../rep/useCrud", () => ({
  useCrud: () => ({
    pieceFieldUpdate: vi.fn(),
  }),
}));
vi.mock("./GoalsPanel", () => ({ GoalsPanel: () => null }));
vi.mock("./RegionEditor", () => ({ TrickySectionsPanel: () => null }));
vi.mock("../references/ReferenceButtons", () => ({
  ReferenceButtons: () => null,
}));
vi.mock("../score/ScoreView", () => ({ ScoreView: () => null }));
vi.mock("../notebook/usePiecePlan", () => ({
  usePiecePlan: () => ({
    bodyText: "",
    setBodyText: vi.fn(),
    status: "ready",
    error: null,
    saving: false,
    updatedAt: null,
    flush: vi.fn(),
  }),
}));
vi.mock("./HistoryPanel", () => ({
  HistoryPanel: ({ refreshToken }: { refreshToken: number }) => (
    <output data-testid="history-revision">{refreshToken}</output>
  ),
}));
vi.mock("../rep/BlockForm", () => ({
  BlockForm: ({ onOpen }: { onOpen: (args: RepOpenArgs) => void }) => (
    <button
      type="button"
      onClick={() =>
        onOpen({
          piece_id: 7,
          m_start: 1,
          m_end: 8,
          label: null,
          start_bpm: 60,
          target_bpm: 80,
          planned_reps: null,
          increment: null,
          variants: [],
          focus: "tempo",
          use_metronome: true,
        })
      }
    >
      Open test block
    </button>
  ),
}));

const piece: PieceDetailData = {
  id: 7,
  title: "Scherzo",
  composer: "Chopin",
  folder_path: "/vault/Scherzo",
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
};

afterEach(cleanup);

describe("PieceDetail block-open history revision", () => {
  it("provides keyboard navigation and tabpanel semantics for Score and Details", async () => {
    render(
      <PieceDetail
        piece={{
          ...piece,
          has_pdf: true,
          pdf_path: "/vault/Scherzo/score.pdf",
        }}
        onBack={vi.fn()}
        onOpenBlock={vi.fn()}
      />,
    );

    const score = screen.getByRole("tab", { name: "Score" });
    const details = screen.getByRole("tab", { name: "Details" });
    expect(score.getAttribute("tabindex")).toBe("0");
    score.focus();
    fireEvent.keyDown(score, { key: "ArrowRight" });
    await waitFor(() => expect(document.activeElement).toBe(details));
    expect(details.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(
      "piece-surface-tab-practice",
    );
  });

  it("does not refresh history when opening the block rejects", async () => {
    const onOpenBlock = vi
      .fn()
      .mockRejectedValue(new Error("The practice block could not be opened."));
    render(
      <PieceDetail piece={piece} onBack={vi.fn()} onOpenBlock={onOpenBlock} />,
    );

    expect(screen.getByTestId("history-revision").textContent).toBe("0");
    fireEvent.click(screen.getByRole("button", { name: "Open test block" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "The practice block could not be opened.",
    );
    expect(screen.getByTestId("history-revision").textContent).toBe("0");
  });

  it("refreshes history only after a successful open", async () => {
    const onOpenBlock = vi.fn().mockResolvedValue(undefined);
    render(
      <PieceDetail piece={piece} onBack={vi.fn()} onOpenBlock={onOpenBlock} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open test block" }));

    await waitFor(() => {
      expect(screen.getByTestId("history-revision").textContent).toBe("1");
    });
  });
});
