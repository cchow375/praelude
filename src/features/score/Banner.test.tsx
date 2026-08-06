import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { ScoreBanner } from "./Banner";
import { BANNER_MAX_CHARS, truncateBanner } from "./bannerText";
import type { PieceDetailData } from "../pieces/types";

afterEach(() => {
  cleanup();
  invokeMock.mockReset();
});

function detail(banner_text: string | null): PieceDetailData {
  return {
    id: 1,
    title: "Scherzo No. 2",
    composer: "Chopin",
    has_xml: true,
    has_pdf: true,
    intake_done: true,
    folder_path: "/v/Scherzo",
    xml_path: null,
    pdf_path: "/v/Scherzo/score.pdf",
    goals: [],
    deadline: null,
    target_tempo: null,
    hard_spots: [],
    current_state: null,
    notes: null,
    banner_text,
  };
}

/** Backend that starts at `initial` and honours every piece_banner_set write. */
function mockBackend(initial: string | null) {
  let current = initial;
  invokeMock.mockImplementation((command: string, args?: unknown) => {
    if (command === "piece_get") return Promise.resolve(detail(current));
    if (command === "piece_banner_set") {
      current = ((args ?? {}) as { text?: string | null }).text ?? null;
      return Promise.resolve(detail(current));
    }
    return Promise.resolve(undefined);
  });
}

function saveCalls() {
  return invokeMock.mock.calls.filter((call) => call[0] === "piece_banner_set");
}

describe("truncateBanner", () => {
  it("passes short text through and cuts long text to exactly the bound", () => {
    expect(truncateBanner("  Even voicing  ")).toBe("Even voicing");
    const atLimit = "x".repeat(BANNER_MAX_CHARS);
    expect(truncateBanner(atLimit)).toBe(atLimit);

    const long = "y".repeat(BANNER_MAX_CHARS + 60);
    const cut = truncateBanner(long);
    expect(Array.from(cut)).toHaveLength(BANNER_MAX_CHARS);
    expect(cut.endsWith("…")).toBe(true);
  });

  it("counts code points, so accented text is not over-cut", () => {
    const accented = "é".repeat(BANNER_MAX_CHARS);
    expect(truncateBanner(accented)).toBe(accented);
  });
});

describe("ScoreBanner", () => {
  it("renders the piece's banner in the strip and no empty-state affordance", async () => {
    mockBackend("Even development voicing");
    render(<ScoreBanner pieceId={1} />);

    expect(await screen.findByTestId("score-banner")).toBeTruthy();
    expect(screen.getByText("Even development voicing")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Add a goal banner" }),
    ).toBeNull();
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("piece_get", { id: 1 }),
    );
  });

  it("renders only the small '+ goal' affordance when the piece has no banner", async () => {
    mockBackend(null);
    render(<ScoreBanner pieceId={1} />);

    expect(
      await screen.findByRole("button", { name: "Add a goal banner" }),
    ).toBeTruthy();
    expect(screen.queryByTestId("score-banner")).toBeNull();
  });

  it("edits in place: Enter saves through piece_banner_set and shows the new text", async () => {
    mockBackend("Old goal");
    render(<ScoreBanner pieceId={1} />);

    fireEvent.click(await screen.findByText("Old goal"));
    const field = screen.getByLabelText("Goal banner text") as HTMLInputElement;
    expect(field.value).toBe("Old goal");

    fireEvent.change(field, { target: { value: "Voice the melody" } });
    fireEvent.keyDown(field, { key: "Enter" });

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("piece_banner_set", {
        pieceId: 1,
        text: "Voice the melody",
      }),
    );
    expect(await screen.findByText("Voice the melody")).toBeTruthy();
    expect(screen.queryByLabelText("Goal banner text")).toBeNull();
  });

  it("Escape cancels the edit without saving anything", async () => {
    mockBackend("Old goal");
    render(<ScoreBanner pieceId={1} />);

    fireEvent.click(await screen.findByText("Old goal"));
    const field = screen.getByLabelText("Goal banner text");
    fireEvent.change(field, { target: { value: "abandoned" } });
    fireEvent.keyDown(field, { key: "Escape" });

    expect(await screen.findByText("Old goal")).toBeTruthy();
    expect(saveCalls()).toHaveLength(0);
  });

  it("writes a first banner from the '+ goal' affordance", async () => {
    mockBackend(null);
    render(<ScoreBanner pieceId={1} />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Add a goal banner" }),
    );
    const field = screen.getByLabelText("Goal banner text");
    fireEvent.change(field, { target: { value: "Perform from memory" } });
    fireEvent.keyDown(field, { key: "Enter" });

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("piece_banner_set", {
        pieceId: 1,
        text: "Perform from memory",
      }),
    );
    expect(await screen.findByText("Perform from memory")).toBeTruthy();
  });

  it("deletes only after the confirm step, then falls back to the empty state", async () => {
    mockBackend("Even development voicing");
    render(<ScoreBanner pieceId={1} />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Remove the goal banner" }),
    );
    // The first click only asks; nothing is written and the text is still there.
    expect(saveCalls()).toHaveLength(0);
    expect(screen.getByText("Even development voicing")).toBeTruthy();

    // Backing out leaves the banner alone.
    fireEvent.click(screen.getByRole("button", { name: "Keep the banner" }));
    expect(saveCalls()).toHaveLength(0);
    expect(screen.getByText("Even development voicing")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Remove the goal banner" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("piece_banner_set", {
        pieceId: 1,
        text: null,
      }),
    );
    expect(
      await screen.findByRole("button", { name: "Add a goal banner" }),
    ).toBeTruthy();
    expect(screen.queryByTestId("score-banner")).toBeNull();
  });

  it("dismisses for the session only: nothing is saved and a remount brings it back", async () => {
    mockBackend("Even development voicing");
    const first = render(<ScoreBanner pieceId={1} />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Hide the goal banner" }),
    );
    expect(screen.queryByTestId("score-banner")).toBeNull();
    // A dismiss is React state, never a write: no save AND no delete.
    expect(saveCalls()).toHaveLength(0);
    // It is also not the empty state — the banner still exists, it is just hidden.
    expect(
      screen.queryByRole("button", { name: "Add a goal banner" }),
    ).toBeNull();

    first.unmount();
    render(<ScoreBanner pieceId={1} />);
    expect(await screen.findByText("Even development voicing")).toBeTruthy();
    expect(saveCalls()).toHaveLength(0);
  });

  it("keeps the old text and reports a save that fails", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "piece_get") return Promise.resolve(detail("Old goal"));
      if (command === "piece_banner_set")
        return Promise.reject("A score banner is limited to 140 characters.");
      return Promise.resolve(undefined);
    });
    render(<ScoreBanner pieceId={1} />);

    fireEvent.click(await screen.findByText("Old goal"));
    const field = screen.getByLabelText("Goal banner text");
    fireEvent.change(field, { target: { value: "too much" } });
    fireEvent.keyDown(field, { key: "Enter" });

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "A score banner is limited to 140 characters.",
    );
    // The editor stays open on the rejected draft so it can be fixed, and
    // backing out restores the banner that is actually stored.
    expect(
      (screen.getByLabelText("Goal banner text") as HTMLInputElement).value,
    ).toBe("too much");
    fireEvent.keyDown(screen.getByLabelText("Goal banner text"), {
      key: "Escape",
    });
    expect(screen.getByText("Old goal")).toBeTruthy();
  });
});
