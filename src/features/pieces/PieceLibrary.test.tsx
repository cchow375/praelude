import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PieceLibrary } from "./PieceLibrary";
import type { PieceFolder, PieceSummary } from "./types";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

const FOLDERS: PieceFolder[] = [
  { id: 1, name: "Romantic", parent_id: null },
  { id: 2, name: "Chopin", parent_id: 1 },
];
const PIECES: PieceSummary[] = [
  { id: 1, title: "Ballade", composer: "Chopin", has_xml: false, has_pdf: true, intake_done: true, folder_id: 2, completed_at: null, archived_at: null },
  { id: 2, title: "Sonata", composer: "Mozart", has_xml: false, has_pdf: true, intake_done: true, folder_id: null, completed_at: 100, archived_at: null },
  { id: 3, title: "Old étude", composer: "Czerny", has_xml: false, has_pdf: true, intake_done: true, folder_id: 1, completed_at: null, archived_at: 200 },
];

beforeEach(() => invokeMock.mockReset().mockResolvedValue(null));
afterEach(cleanup);

function renderLibrary(overrides: Partial<React.ComponentProps<typeof PieceLibrary>> = {}) {
  const props: React.ComponentProps<typeof PieceLibrary> = {
    pieces: PIECES,
    folders: FOLDERS,
    location: "all",
    onLocationChange: vi.fn(),
    onOpen: vi.fn(),
    onReload: vi.fn().mockResolvedValue(undefined),
    onError: vi.fn(),
    ...overrides,
  };
  render(<PieceLibrary {...props} />);
  return props;
}

describe("PieceLibrary", () => {
  it("shows nested folders and separates active, completed, and archived pieces", () => {
    const props = renderLibrary();
    expect(screen.getByRole("button", { name: "Romantic" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Chopin" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open Ballade" })).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Completed 1" }));
    expect(screen.getByRole("button", { name: "Open Sonata" })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Archived 1" }));
    expect(screen.getByRole("button", { name: "Open Old étude" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Romantic" }));
    expect(props.onLocationChange).toHaveBeenCalledWith(1);
  });

  it("offers the same actions from the ellipsis and right-click menu", async () => {
    const props = renderLibrary();
    fireEvent.click(screen.getByRole("button", { name: "Actions for Ballade" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Mark complete" }));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("piece_complete_set", { id: 1, completed: true }),
    );
    expect(props.onReload).toHaveBeenCalled();

    fireEvent.contextMenu(screen.getByRole("button", { name: "Open Ballade" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove…" }));
    expect(screen.getByText(/practice history stays in History/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("piece_remove", { id: 1 }));
  });

  it("creates a subfolder under the selected folder without prompts", async () => {
    renderLibrary({ location: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Add subfolder" }));
    fireEvent.change(screen.getByLabelText("Folder name"), { target: { value: "Chamber" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("piece_folder_create", { name: "Chamber", parentId: 1 }),
    );
  });
});

describe("Pieces.css minimum-window folder menu", () => {
  const css = readFileSync(
    join(process.cwd(), "src/features/pieces/Pieces.css"),
    "utf8",
  );

  it("unclips the folder rail while an actions menu is open", () => {
    expect(css).toMatch(
      /\.piece-folder-tree:has\(\.piece-folder-menu\)\s*\{[^}]*max-height:\s*none;[^}]*overflow:\s*visible;/s,
    );
  });
});
