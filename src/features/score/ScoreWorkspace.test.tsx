import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

// Capture the props ScoreWorkspace hands to ScoreView. The real ScoreView
// needs pdfjs; here we only prove the workspace forwards the practice seam
// (the Practice tab renders nothing unless onOpenBlock reaches ScoreView).
const scoreViewProps = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("./ScoreView", () => ({
  ScoreView: (props: unknown) => {
    scoreViewProps.current = props;
    return <div data-testid="score-view-stub" />;
  },
}));

import { ScoreWorkspace } from "./ScoreWorkspace";
import type { ScoreViewProps } from "./ScoreView";

afterEach(() => {
  cleanup();
  invokeMock.mockReset();
});

const PIECES = [
  {
    id: 1,
    title: "Scherzo No. 2",
    composer: "Chopin",
    has_xml: true,
    has_pdf: true,
    intake_done: true,
  },
  {
    id: 2,
    title: "The White Peacock",
    composer: "Griffes",
    has_xml: false,
    has_pdf: true,
    intake_done: true,
  },
];

describe("ScoreWorkspace", () => {
  it("loads pieces and renders the picker + the score view for the first piece", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "pieces_list") return Promise.resolve(PIECES);
      // No PDF editions → ScoreView stays on its empty state (no pdfjs in jsdom).
      if (command === "score_pdf_editions") return Promise.resolve([]);
      return Promise.resolve(undefined);
    });

    render(<ScoreWorkspace />);

    expect(await screen.findByTestId("score-workspace")).toBeTruthy();
    const picker = (await screen.findByLabelText(
      "Choose a piece",
    )) as HTMLSelectElement;
    expect(picker.value).toBe("1");
    expect(screen.getByRole("heading", { name: "Scherzo No. 2" })).toBeTruthy();
    // Both PDF-bearing pieces are offered.
    expect(screen.getAllByRole("option")).toHaveLength(2);
  });

  it("forwards the practice seam so the Practice tab can open a block", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "pieces_list") return Promise.resolve(PIECES);
      return Promise.resolve(undefined);
    });
    const onOpenBlock = vi.fn().mockResolvedValue(undefined);

    render(<ScoreWorkspace onOpenBlock={onOpenBlock} defaultCleanStreak={4} />);

    await screen.findByTestId("score-view-stub");
    const props = scoreViewProps.current as ScoreViewProps;
    expect(typeof props.onOpenBlock).toBe("function");
    expect(props.defaultCleanStreak).toBe(4);

    // The forwarded handler must reach the shell's rep.open.
    const args = {
      piece_id: 2,
      m_start: 1,
      m_end: 8,
      target_bpm: 96,
    };
    await props.onOpenBlock?.(args as never);
    expect(onOpenBlock).toHaveBeenCalledWith(args);
  });

  it("lifts the selected piece and exact Score focus into Brain context", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "pieces_list") return Promise.resolve(PIECES);
      return Promise.resolve(undefined);
    });
    const onPracticeContextChange = vi.fn();

    render(
      <ScoreWorkspace onPracticeContextChange={onPracticeContextChange} />,
    );

    await screen.findByTestId("score-view-stub");
    await waitFor(() =>
      expect(onPracticeContextChange).toHaveBeenCalledWith(
        expect.objectContaining({
          piece_id: 1,
          piece_title: "Scherzo No. 2",
          surface: "score",
          region: null,
        }),
      ),
    );

    const props = scoreViewProps.current as ScoreViewProps;
    props.onContextChange?.({
      region: {
        id: 44,
        name: "Coda landing",
        notes: "Release before the leap",
        m_start: 720,
        m_end: 732,
      },
      current_page: 18,
      edition_id: "ekier.pdf",
      edition_label: "Ekier National Edition",
    });

    expect(onPracticeContextChange).toHaveBeenLastCalledWith({
      piece_id: 1,
      piece_title: "Scherzo No. 2",
      composer: "Chopin",
      surface: "score",
      region: {
        id: 44,
        name: "Coda landing",
        notes: "Release before the leap",
        m_start: 720,
        m_end: 732,
      },
      current_page: 18,
      edition_id: "ekier.pdf",
      edition_label: "Ekier National Edition",
      active_block: null,
    });
  });

  it("shows an empty state when no piece has a PDF", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "pieces_list") return Promise.resolve([]);
      return Promise.resolve(undefined);
    });
    render(<ScoreWorkspace />);
    await waitFor(() =>
      expect(screen.getByText(/No pieces with a PDF score yet/i)).toBeTruthy(),
    );
  });
});
