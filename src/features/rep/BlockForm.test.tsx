import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BlockForm } from "./BlockForm";

afterEach(cleanup);

const openMore = () =>
  fireEvent.click(screen.getByRole("button", { name: /more/i }));

describe("BlockForm payload", () => {
  // The B3 declutter must NOT change the wire contract. These two assert the
  // WHOLE RepOpenArgs object for the frictionless default and for a run that
  // touches every capability, so any accidental payload drift fails loudly.
  it("submits the full default payload with no trip into More", () => {
    const onOpen = vi.fn();
    render(<BlockForm pieceId={7} onOpen={onOpen} />);

    fireEvent.click(screen.getByRole("button", { name: "Start set" }));

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith({
      piece_id: 7,
      region_id: null,
      m_start: 1,
      m_end: 1,
      label: null,
      start_bpm: 60,
      target_bpm: null,
      planned_reps: null,
      required_clean_streak: 5,
      increment: null,
      variants: [],
      focus: "tempo",
      use_metronome: true,
    });
  });

  it("submits the full customized payload across every option", () => {
    const onOpen = vi.fn();
    render(<BlockForm pieceId={3} onOpen={onOpen} />);

    // Section + target (top-level, always visible).
    fireEvent.change(screen.getByLabelText("From measure"), {
      target: { value: "4" },
    });
    fireEvent.change(screen.getByLabelText("To measure"), {
      target: { value: "12" },
    });
    fireEvent.change(screen.getByLabelText("Block label (optional)"), {
      target: { value: "left hand" },
    });
    fireEvent.change(screen.getByLabelText("Start bpm"), {
      target: { value: "72" },
    });
    fireEvent.change(screen.getByLabelText("Target bpm"), {
      target: { value: "120" },
    });

    // Everything else lives behind the single "More" disclosure.
    openMore();
    fireEvent.change(screen.getByLabelText("Clean streak target"), {
      target: { value: "custom" },
    });
    fireEvent.change(screen.getByLabelText("Custom clean streak"), {
      target: { value: "8" },
    });
    fireEvent.click(screen.getByRole("radio", { name: "Manual" }));
    fireEvent.change(screen.getByLabelText("Cleans needed"), {
      target: { value: "2" },
    });
    fireEvent.change(screen.getByLabelText("Bpm step"), {
      target: { value: "6" },
    });
    fireEvent.change(screen.getByLabelText("Attempt review boundary"), {
      target: { value: "30" },
    });
    fireEvent.click(screen.getByRole("button", { name: "+ Add variant" }));
    fireEvent.change(screen.getByLabelText("Variant 1 name"), {
      target: { value: "hands separate" },
    });
    fireEvent.change(screen.getByLabelText("Variant 1 attempts"), {
      target: { value: "3" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Start set" }));

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith({
      piece_id: 3,
      region_id: null,
      m_start: 4,
      m_end: 12,
      label: "left hand",
      start_bpm: 72,
      target_bpm: 120,
      planned_reps: 30,
      required_clean_streak: 8,
      increment: { clean_needed: 2, bpm_step: 6 },
      variants: [{ name: "hands separate", reps: 3 }],
      focus: "tempo",
      use_metronome: true,
    });
  });
});

describe("BlockForm layout", () => {
  it("collapses strategy options behind a one-line summary and a single More disclosure", () => {
    const onOpen = vi.fn();
    render(<BlockForm pieceId={1} onOpen={onOpen} />);

    // The plain-words defaults summary is visible up front (this element does
    // not exist on the pre-B3 form, so this assertion bites on old code).
    expect(screen.getByText(/5 clean in a row/i)).toBeTruthy();

    // The strategy editors are NOT mounted until "More" opens. On the pre-B3
    // form these were always present at top level, so each of these is a bite.
    expect(screen.queryByLabelText("Clean streak target")).toBeNull();
    expect(screen.queryByLabelText("Focus")).toBeNull();
    expect(screen.queryByLabelText("Attempt review boundary")).toBeNull();
    expect(screen.queryByRole("radio", { name: "Manual" })).toBeNull();
    expect(screen.queryByRole("button", { name: "+ Add variant" })).toBeNull();

    // Opening the one disclosure makes every capability reachable again, with
    // the same defaults it always had (5 cleans, no review boundary).
    openMore();
    expect(
      (screen.getByLabelText("Clean streak target") as HTMLSelectElement).value,
    ).toBe("5");
    expect(
      (screen.getByLabelText("Attempt review boundary") as HTMLInputElement)
        .value,
    ).toBe("");
    expect(screen.getByLabelText("Focus")).toBeTruthy();
    expect(screen.getByRole("button", { name: "+ Add variant" })).toBeTruthy();
  });

  it("keeps the summary in sync with edits made inside More", () => {
    const onOpen = vi.fn();
    render(<BlockForm pieceId={1} defaultCleanStreak={5} onOpen={onOpen} />);
    expect(screen.getByText(/5 clean in a row/i)).toBeTruthy();

    openMore();
    fireEvent.change(screen.getByLabelText("Clean streak target"), {
      target: { value: "10" },
    });
    expect(screen.getByText(/10 clean in a row/i)).toBeTruthy();
  });
});

describe("BlockForm behavior", () => {
  it("adopts a newly saved default until this form's clean target has been edited", () => {
    const onOpen = vi.fn();
    const { rerender } = render(
      <BlockForm pieceId={1} defaultCleanStreak={5} onOpen={onOpen} />,
    );
    openMore();

    rerender(<BlockForm pieceId={1} defaultCleanStreak={7} onOpen={onOpen} />);
    expect(
      (screen.getByLabelText("Clean streak target") as HTMLSelectElement).value,
    ).toBe("7");

    fireEvent.change(screen.getByLabelText("Clean streak target"), {
      target: { value: "3" },
    });
    rerender(<BlockForm pieceId={1} defaultCleanStreak={10} onOpen={onOpen} />);
    expect(
      (screen.getByLabelText("Clean streak target") as HTMLSelectElement).value,
    ).toBe("3");
  });

  it("opens a non-tempo block without fake BPM or a ladder", () => {
    const onOpen = vi.fn();
    render(<BlockForm pieceId={1} onOpen={onOpen} />);
    openMore();
    fireEvent.change(screen.getByLabelText("Focus"), {
      target: { value: "notes" },
    });
    expect(screen.queryByLabelText("Start bpm")).toBeNull();
    fireEvent.change(screen.getByLabelText("From measure"), {
      target: { value: "1" },
    });
    fireEvent.change(screen.getByLabelText("To measure"), {
      target: { value: "8" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start set" }));
    expect(onOpen).toHaveBeenCalledWith(
      expect.objectContaining({
        focus: "notes",
        use_metronome: false,
        start_bpm: null,
        target_bpm: null,
        increment: null,
      }),
    );
  });

  it("can use a metronome for non-tempo work without enabling a ladder", () => {
    const onOpen = vi.fn();
    render(<BlockForm pieceId={1} onOpen={onOpen} />);
    openMore();
    fireEvent.change(screen.getByLabelText("Focus"), {
      target: { value: "phrasing" },
    });
    fireEvent.click(screen.getByLabelText("Use metronome"));
    expect(screen.getByText("Metronome bpm")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Start set" }));
    expect(onOpen).toHaveBeenCalledWith(
      expect.objectContaining({
        focus: "phrasing",
        use_metronome: true,
        start_bpm: 60,
        increment: null,
      }),
    );
  });

  it("explains and blocks a second manual set while one is active", () => {
    const onOpen = vi.fn();
    render(
      <BlockForm
        pieceId={1}
        onOpen={onOpen}
        blockedReason="Close the active practice set before starting another."
      />,
    );

    expect(screen.getByRole("status").textContent).toContain(
      "Close the active practice set",
    );
    const start = screen.getByRole("button", { name: "Start set" });
    expect((start as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(start);
    expect(onOpen).not.toHaveBeenCalled();
  });
});
