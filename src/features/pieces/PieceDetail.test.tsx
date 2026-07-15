import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
vi.mock("../references/ReferenceButtons", () => ({ ReferenceButtons: () => null }));
vi.mock("../score/ScoreView", () => ({ ScoreView: () => null }));
vi.mock("./HistoryPanel", () => ({
  HistoryPanel: ({ refreshToken }: { refreshToken: number }) => (
    <output data-testid="history-revision">{refreshToken}</output>
  ),
}));
vi.mock("../rep/BlockForm", () => ({
  BlockForm: ({ onOpen }: { onOpen: (args: RepOpenArgs) => void }) => (
    <button
      type="button"
      onClick={() => onOpen({
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
      })}
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
  it("does not refresh history when opening the block rejects", async () => {
    const onOpenBlock = vi.fn().mockRejectedValue(
      new Error("The practice block could not be opened."),
    );
    render(
      <PieceDetail
        piece={piece}
        onBack={vi.fn()}
        onOpenBlock={onOpenBlock}
      />,
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
      <PieceDetail
        piece={piece}
        onBack={vi.fn()}
        onOpenBlock={onOpenBlock}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open test block" }));

    await waitFor(() => {
      expect(screen.getByTestId("history-revision").textContent).toBe("1");
    });
  });
});
