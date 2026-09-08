import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PieceLibrary } from "./PieceLibrary";
import type { PieceFolder, PieceSummary } from "./types";
import { preparePieceCover } from "./pieceCovers";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock("./pieceCovers", async (importOriginal) => ({
  ...await importOriginal<typeof import("./pieceCovers")>(),
  preparePieceCover: vi.fn().mockResolvedValue("data:image/jpeg;base64,Y292ZXI="),
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
    fireEvent.click(screen.getByRole("tab", { name: "Resting 1" }));
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

  it("searches accents and composers across a large library before paginating", async () => {
    const pieces = Array.from({ length: 80 }, (_, index) => ({ ...PIECES[0], id: index + 1, title: `Étude ${String(index + 1).padStart(2, "0")}` }));
    renderLibrary({ pieces });
    expect(screen.getAllByRole("button", { name: /^Open Étude/ })).toHaveLength(24);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search pieces" }), { target: { value: "etude 80" } });
    expect(screen.getByRole("button", { name: "Open Étude 80" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /^Open Étude/ })).toHaveLength(1);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "CHOPIN" } });
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(screen.getAllByRole("button", { name: /^Open Étude/ })).toHaveLength(48);
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    await waitFor(() => expect(invokeMock.mock.calls.filter(([command]) => command === "piece_covers_get").every(([, args]) => args.ids.length <= 48)).toBe(true));
  });

  it("lets a keyboard user navigate and dismiss a menu back to its trigger", async () => {
    renderLibrary();
    const trigger = screen.getByRole("button", { name: "Actions for Ballade" });
    fireEvent.click(trigger);
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Open" }));
    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Choose cover…" }));
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("puts a piece to rest using the reversible archive boundary", async () => {
    renderLibrary();
    fireEvent.click(screen.getByRole("button", { name: "Actions for Ballade" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Put to rest" }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("piece_archive_set", { id: 1, archived: true }));
    expect(invokeMock).not.toHaveBeenCalledWith("piece_remove", expect.anything());
  });

  it("saves a selected cover durably and restores the generated artwork", async () => {
    renderLibrary();
    fireEvent.click(screen.getByRole("button", { name: "Actions for Ballade" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Choose cover…" }));
    const file = new File(["fixture"], "cover.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByLabelText("Choose a piece cover image"), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByText("Cover saved.")).toBeTruthy());
    expect(preparePieceCover).toHaveBeenCalledWith(file);
    expect(invokeMock).toHaveBeenCalledWith("piece_cover_set", { id: 1, dataUrl: "data:image/jpeg;base64,Y292ZXI=" });
    expect(screen.getByRole("button", { name: "Open Ballade" }).querySelector("img")?.getAttribute("src")).toBe("data:image/jpeg;base64,Y292ZXI=");
    fireEvent.click(screen.getByRole("button", { name: "Actions for Ballade" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Reset cover" }));
    await waitFor(() => expect(screen.getByText("Original cover restored.")).toBeTruthy());
    expect(invokeMock).toHaveBeenCalledWith("piece_cover_set", { id: 1, dataUrl: null });
    expect(screen.getByRole("button", { name: "Open Ballade" }).querySelector("img")).toBeNull();
  });

  it("retains the current image when a cover reset cannot be saved", async () => {
    const stored = "data:image/jpeg;base64,Y292ZXI=";
    invokeMock.mockImplementation((command) => command === "piece_covers_get" ? Promise.resolve({ 1: stored }) : command === "piece_cover_set" ? Promise.reject("Disk is full") : Promise.resolve(null));
    const props = renderLibrary();
    await waitFor(() => expect(screen.getByRole("button", { name: "Open Ballade" }).querySelector("img")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Actions for Ballade" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Reset cover" }));
    await waitFor(() => expect(props.onError).toHaveBeenCalledWith("Disk is full"));
    expect(screen.getByRole("button", { name: "Open Ballade" }).querySelector("img")?.getAttribute("src")).toBe(stored);
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
