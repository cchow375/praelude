import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { ScoreWorkspace } from "./ScoreWorkspace";

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
