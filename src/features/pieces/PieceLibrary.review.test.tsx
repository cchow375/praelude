import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PieceLibrary } from "./PieceLibrary";
import type { PieceFolder, PieceSummary } from "./types";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));
vi.mock("./pieceCovers", async (original) => ({
  ...await original<typeof import("./pieceCovers")>(),
  preparePieceCover: vi.fn().mockResolvedValue("data:image/jpeg;base64,bmV3"),
}));
const folders: PieceFolder[] = [{ id: 1, parent_id: null, name: "Recital" }, { id: 2, parent_id: 1, name: "Chopin" }];
function piece(id: number): PieceSummary {
  return { id, title: `Étude ${String(id).padStart(3, "0")}`, composer: "Frédéric Chopin", has_xml: false, has_pdf: true, intake_done: true, folder_id: id % 2 ? 2 : null, completed_at: null, archived_at: null };
}
function mount(pieces = [piece(1)], extra: Partial<React.ComponentProps<typeof PieceLibrary>> = {}) {
  return render(<PieceLibrary pieces={pieces} folders={folders} location="all" onLocationChange={vi.fn()} onOpen={vi.fn()} onReload={vi.fn().mockResolvedValue(undefined)} onError={vi.fn()} {...extra} />);
}
beforeEach(() => invokeMock.mockReset().mockImplementation((command) => Promise.resolve(command === "piece_covers_get" ? {} : null)));
afterEach(cleanup);

describe("independent library review", () => {
  it("sorts and searches the whole library, then resets pagination when filters change", async () => {
    mount(Array.from({ length: 100 }, (_, i) => piece(100 - i)));
    fireEvent.change(screen.getByLabelText("Sort pieces"), { target: { value: "title" } });
    expect(screen.getAllByRole("button", { name: /^Open Étude/ })[0].getAttribute("aria-label")).toBe("Open Étude 001");
    for (let i = 0; i < 4; i++) fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(screen.getAllByRole("button", { name: /^Open Étude/ })).toHaveLength(100);
    await waitFor(() => expect(invokeMock.mock.calls.filter(([command]) => command === "piece_covers_get").some(([, args]) => args.ids.includes(100))).toBe(true));
    expect(invokeMock.mock.calls.filter(([command]) => command === "piece_covers_get").every(([, args]) => args.ids.length <= 48)).toBe(true);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "etude 100" } });
    expect(screen.getAllByRole("button", { name: /^Open Étude/ })).toHaveLength(1);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });
    expect(screen.getAllByRole("button", { name: /^Open Étude/ })).toHaveLength(24);
  });

  it("includes descendants in folder scope while excluding unfiled pieces", () => {
    mount([piece(1), piece(2)], { location: 1 });
    expect(screen.getByRole("button", { name: "Open Étude 001" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open Étude 002" })).toBeNull();
  });

  it("rest and restore preserve the same piece identity and folder", async () => {
    let stored = piece(1);
    invokeMock.mockImplementation((command, args) => {
      if (command === "piece_archive_set") stored = { ...stored, archived_at: args.archived ? 900 : null };
      return Promise.resolve(command === "piece_covers_get" ? {} : null);
    });
    function Harness() {
      const [pieces, setPieces] = useState([stored]);
      return <PieceLibrary pieces={pieces} folders={folders} location="all" onLocationChange={vi.fn()} onOpen={vi.fn()} onReload={async () => setPieces([stored])} onError={vi.fn()} />;
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Actions for Étude 001" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Put to rest" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Open Étude 001" })).toBeNull());
    fireEvent.click(screen.getByRole("tab", { name: "Resting 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Actions for Étude 001" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Restore" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Open Étude 001" })).toBeNull());
    fireEvent.click(screen.getByRole("tab", { name: "Active 1" }));
    expect(screen.getByRole("button", { name: "Open Étude 001" })).toBeTruthy();
    expect(stored).toEqual(piece(1));
    expect(invokeMock.mock.calls.some(([command]) => command === "piece_remove")).toBe(false);
  });

  it("keeps a new cover when an older thumbnail read finishes late, including layout changes", async () => {
    let finishRead: (value: Record<number, string>) => void = () => {};
    invokeMock.mockImplementation((command) => command === "piece_covers_get"
      ? new Promise((resolve) => { finishRead = resolve; }) : Promise.resolve(null));
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Actions for Étude 001" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Choose cover…" }));
    fireEvent.change(screen.getByLabelText("Choose a piece cover image"), { target: { files: [new File(["fixture"], "cover.jpg", { type: "image/jpeg" })] } });
    await screen.findByText("Cover saved.");
    finishRead({ 1: "data:image/jpeg;base64,b2xk" });
    fireEvent.click(screen.getByRole("button", { name: "Compact list" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Open Étude 001" }).querySelector("img")?.getAttribute("src")).toBe("data:image/jpeg;base64,bmV3"));
    fireEvent.click(screen.getByRole("button", { name: "Cover grid" }));
    expect(screen.getByRole("button", { name: "Open Étude 001" }).querySelector("img")?.getAttribute("src")).toBe("data:image/jpeg;base64,bmV3");
  });

  it("closes the folder menu before opening its rename editor", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Folder actions for Recital" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    expect(screen.getByRole("textbox", { name: "New name" })).toBe(document.activeElement);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("dismisses the floating menu when keyboard focus leaves it", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Actions for Étude 001" }));
    const search = screen.getByRole("searchbox");
    fireEvent.blur(screen.getByRole("menuitem", { name: "Open" }), { relatedTarget: search });
    search.focus();
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
