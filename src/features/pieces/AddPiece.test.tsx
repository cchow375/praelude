import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PieceDetailData } from "./types";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { AddPiece } from "./AddPiece";

const CREATED: PieceDetailData = {
  id: 12,
  title: "Clair de lune",
  composer: "Claude Debussy",
  has_xml: false,
  has_pdf: true,
  intake_done: true,
  folder_id: 2,
  completed_at: null,
  archived_at: null,
  folder_path: "/library/12",
  xml_path: null,
  pdf_path: "/library/12/score/clair.pdf",
  goals: [],
  deadline: null,
  target_tempo: null,
  hard_spots: [],
  current_state: null,
  notes: null,
  banner_text: null,
};

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation((command: string) => {
    if (command === "pick_import_file") return Promise.resolve("/Downloads/clair.pdf");
    if (command === "piece_create_from_pdf") return Promise.resolve(CREATED);
    return Promise.resolve(null);
  });
});

afterEach(cleanup);

describe("AddPiece", () => {
  it("creates a titled piece directly from a chosen PDF in the selected folder", async () => {
    const onImported = vi.fn();
    render(
      <AddPiece
        folders={[
          { id: 1, name: "Romantic", parent_id: null },
          { id: 2, name: "French", parent_id: 1 },
        ]}
        initialFolderId={2}
        onImported={onImported}
        onClose={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Clair de lune" } });
    fireEvent.change(screen.getByLabelText(/Composer/), { target: { value: "Claude Debussy" } });
    fireEvent.click(screen.getByRole("button", { name: "Choose PDF" }));
    expect(await screen.findByText("clair.pdf")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add Piece" }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("piece_create_from_pdf", {
        title: "Clair de lune",
        composer: "Claude Debussy",
        sourcePath: "/Downloads/clair.pdf",
        folderId: 2,
      }),
    );
    expect(onImported).toHaveBeenCalledWith(CREATED);
  });

  it("explains missing title and PDF instead of starting an incomplete import", async () => {
    render(<AddPiece onImported={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Add Piece" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Give the piece a title.");

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "New piece" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Piece" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Choose a PDF first.");
    expect(invokeMock).not.toHaveBeenCalledWith("piece_create_from_pdf", expect.anything());
  });

  it("opens IMSLP only as an optional public-domain source", async () => {
    render(<AddPiece onImported={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Find a public-domain score on IMSLP/ }));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("piece_open_source_url", { url: "https://imslp.org" }),
    );
  });
});
