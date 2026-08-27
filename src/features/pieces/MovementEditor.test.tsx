import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { MovementEditor } from "./MovementEditor";
import type { PieceMovement } from "./types";

let rows: PieceMovement[];

beforeEach(() => {
  rows = [
    {
      id: 1,
      piece_id: 7,
      title: "I · Allegro",
      start_page: 1,
      display_order: 0,
    },
    {
      id: 2,
      piece_id: 7,
      title: "II · Adagio",
      start_page: 7,
      display_order: 1,
    },
  ];
  invokeMock.mockReset();
  invokeMock.mockImplementation(
    (command: string, payload?: Record<string, unknown>) => {
      if (command === "piece_movement_list") return Promise.resolve([...rows]);
      if (command === "piece_movement_create") {
        const input = payload?.input as {
          piece_id: number;
          title: string;
          start_page: number;
        };
        rows.push({ id: 3, display_order: 2, ...input });
        return Promise.resolve(rows[rows.length - 1]);
      }
      if (command === "piece_movement_update") {
        const id = payload?.id as number;
        const patch = payload?.patch as Partial<PieceMovement>;
        rows = rows.map((row) => (row.id === id ? { ...row, ...patch } : row));
        return Promise.resolve(rows.find((row) => row.id === id));
      }
      if (command === "piece_movement_delete") {
        rows = rows.filter((row) => row.id !== payload?.id);
        return Promise.resolve(undefined);
      }
      return Promise.resolve(undefined);
    },
  );
});

afterEach(cleanup);

describe("MovementEditor", () => {
  it("derives page ranges and supports movement create, edit, and delete", async () => {
    render(<MovementEditor pieceId={7} />);

    expect(await screen.findByText("pp. 1–6")).toBeTruthy();
    expect(screen.getByText("pp. 7–end")).toBeTruthy();

    fireEvent.change(
      screen.getByRole("textbox", { name: "New movement title" }),
      {
        target: { value: "III · Presto" },
      },
    );
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "New movement start page" }),
      {
        target: { value: "12" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Add movement" }));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("piece_movement_create", {
        input: { piece_id: 7, title: "III · Presto", start_page: 12 },
      }),
    );
    expect(await screen.findByText("pp. 12–end")).toBeTruthy();

    const title = screen.getByRole("textbox", {
      name: "Movement title II · Adagio",
    });
    fireEvent.change(title, { target: { value: "II · Andante" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Save" })[1]);
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("piece_movement_update", {
        id: 2,
        patch: { title: "II · Andante", start_page: 7 },
      }),
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]);
    fireEvent.click(await screen.findByRole("button", { name: "Confirm" }));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("piece_movement_delete", {
        id: 1,
      }),
    );
    expect(screen.queryByDisplayValue("I · Allegro")).toBeNull();
  });
});
