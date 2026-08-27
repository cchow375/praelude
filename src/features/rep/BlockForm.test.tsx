import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BlockForm } from "./BlockForm";

afterEach(cleanup);

const openAdvanced = () =>
  fireEvent.click(screen.getByRole("button", { name: /advanced/i }));

describe("BlockForm payload", () => {
  // These assert the WHOLE RepOpenArgs object for the frictionless default and
  // a run that touches every capability. A5 deliberately adds only `tuning`;
  // any other accidental payload drift still fails loudly.
  it("submits the full default payload with no interaction at all", () => {
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
      tuning: {
        beat_unit: "quarter",
        subdivision: 1,
        beats_per_bar: 4,
      },
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

    // Focus, the variant chain, and clean streak are always visible now
    // (spec §5.3) — no disclosure needed to reach them.
    fireEvent.change(screen.getByLabelText("Clean streak target"), {
      target: { value: "custom" },
    });
    fireEvent.change(screen.getByLabelText("Custom clean streak"), {
      target: { value: "8" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Hands separate" }));
    fireEvent.change(screen.getByLabelText("Variant 1 consecutive cleans"), {
      target: { value: "3" },
    });

    // The tempo ladder, review boundary, and metronome tuning stay Advanced.
    openAdvanced();
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
    fireEvent.change(screen.getByLabelText("BPM note value"), {
      target: { value: "dotted_quarter" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Increase Beats per bar" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Increase Beats per bar" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Increase Subdivision" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Increase Subdivision" }),
    );

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
      variants: [{ name: "hands separate", reps: 3, clean_streak: 3 }],
      focus: "tempo",
      use_metronome: true,
      tuning: {
        beat_unit: "dotted_quarter",
        subdivision: 3,
        beats_per_bar: 6,
      },
    });
  });
});

describe("BlockForm layout (A3 — un-bury the variants)", () => {
  it("shows the variant chain builder with zero clicks", () => {
    render(<BlockForm pieceId={1} onOpen={vi.fn()} />);
    expect(screen.getByRole("group", { name: /variant/i })).toBeTruthy();
  });

  it("offers one-tap preset variants", () => {
    render(<BlockForm pieceId={1} onOpen={vi.fn()} />);
    for (const preset of ["Slow", "Dotted", "Reverse dotted", "Staccato"]) {
      expect(screen.getByRole("button", { name: preset })).toBeTruthy();
    }
  });

  it("appends a variant to the chain when a preset chip is tapped", () => {
    render(<BlockForm pieceId={1} onOpen={vi.fn()} />);
    expect(screen.queryByLabelText("Variant 1 name")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Staccato" }));
    expect(
      (screen.getByLabelText("Variant 1 name") as HTMLInputElement).value,
    ).toBe("staccato");
    expect(screen.getByText("Consecutive cleans")).toBeTruthy();
    expect(
      (
        screen.getByLabelText(
          "Variant 1 consecutive cleans",
        ) as HTMLInputElement
      ).value,
    ).toBe("5");
  });

  it("adds a custom free-text variant and remembers it as a chip", () => {
    render(<BlockForm pieceId={1} onOpen={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Custom variant name"), {
      target: { value: "octave runs" },
    });
    fireEvent.click(screen.getByRole("button", { name: "+ Add" }));
    expect(
      (screen.getByLabelText("Variant 1 name") as HTMLInputElement).value,
    ).toBe("octave runs");
    // Remembered as a chip: a second tap re-adds it without retyping.
    fireEvent.click(screen.getByRole("button", { name: "octave runs" }));
    expect(
      (screen.getByLabelText("Variant 2 name") as HTMLInputElement).value,
    ).toBe("octave runs");
  });

  it("reorders and removes variants in the chain", () => {
    render(<BlockForm pieceId={1} onOpen={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Slow" }));
    fireEvent.click(screen.getByRole("button", { name: "Dotted" }));
    expect(
      (screen.getByLabelText("Variant 1 name") as HTMLInputElement).value,
    ).toBe("slow");

    fireEvent.click(screen.getByRole("button", { name: "Move variant 2 up" }));
    expect(
      (screen.getByLabelText("Variant 1 name") as HTMLInputElement).value,
    ).toBe("dotted");
    expect(
      (screen.getByLabelText("Variant 2 name") as HTMLInputElement).value,
    ).toBe("slow");

    fireEvent.click(screen.getByRole("button", { name: "Remove variant 1" }));
    expect(screen.queryByLabelText("Variant 2 name")).toBeNull();
    expect(
      (screen.getByLabelText("Variant 1 name") as HTMLInputElement).value,
    ).toBe("slow");
  });

  it("shows practice focus and clean streak target with zero clicks", () => {
    render(<BlockForm pieceId={1} onOpen={vi.fn()} />);
    expect(screen.getByLabelText("Focus")).toBeTruthy();
    expect(
      (screen.getByLabelText("Clean streak target") as HTMLSelectElement).value,
    ).toBe("5");
  });

  it("keeps the tempo ladder and review boundary collapsed under Advanced", async () => {
    render(<BlockForm pieceId={1} onOpen={vi.fn()} />);
    expect(screen.queryByLabelText(/attempt review boundary/i)).toBeNull();
    expect(screen.queryByRole("radio", { name: "Manual" })).toBeNull();
    expect(screen.queryByLabelText("One pass seconds")).toBeNull();
    expect(screen.queryByLabelText("BPM note value")).toBeNull();

    openAdvanced();
    expect(
      await screen.findByLabelText(/attempt review boundary/i),
    ).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Manual" })).toBeTruthy();
    expect(screen.getByLabelText("BPM note value")).toBeTruthy();
  });
});

describe("BlockForm per-set metronome tuning (A5)", () => {
  it("labels BPM with a note value without converting the entered BPM", () => {
    const onOpen = vi.fn();
    render(<BlockForm pieceId={1} onOpen={onOpen} />);
    fireEvent.change(screen.getByLabelText("Start bpm"), {
      target: { value: "96" },
    });
    openAdvanced();
    fireEvent.change(screen.getByLabelText("BPM note value"), {
      target: { value: "eighth" },
    });
    expect(
      screen.getByText(/Changing this label never converts or changes the BPM/i),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Start set" }));

    const args = onOpen.mock.calls[0][0];
    expect(args.start_bpm).toBe(96);
    expect(args.tuning).toEqual({
      beat_unit: "eighth",
      subdivision: 1,
      beats_per_bar: 4,
    });
  });

  it("rehydrates stored tuning and submits it unchanged on reopen", () => {
    const onOpen = vi.fn();
    render(
      <BlockForm
        pieceId={1}
        defaultTuning={{
          beat_unit: "dotted_quarter",
          subdivision: 3,
          beats_per_bar: 6,
        }}
        onOpen={onOpen}
      />,
    );
    openAdvanced();

    expect(
      (screen.getByLabelText("BPM note value") as HTMLSelectElement).value,
    ).toBe("dotted_quarter");
    expect(
      within(screen.getByRole("group", { name: "Beats per bar" })).getByText(
        "6",
      ),
    ).toBeTruthy();
    expect(
      within(screen.getByRole("group", { name: "Subdivision" })).getByText(
        "3",
      ),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Start set" }));
    expect(onOpen.mock.calls[0][0].tuning).toEqual({
      beat_unit: "dotted_quarter",
      subdivision: 3,
      beats_per_bar: 6,
    });
  });

  it("keeps Advanced in the scroll body and Start set pinned outside it at the dense floor", () => {
    const { container } = render(<BlockForm pieceId={1} onOpen={vi.fn()} />);
    openAdvanced();
    const body = container.querySelector(".block-form-body") as HTMLElement;
    const start = screen.getByRole("button", { name: "Start set" });
    expect(body.contains(screen.getByLabelText("BPM note value"))).toBe(true);
    expect(body.contains(start)).toBe(false);

    // jsdom has no layout engine, so pin the actual CSS contract that makes
    // the structure safe at 720×520; screenshot QA remains the pixel proof.
    const css = readFileSync(join(process.cwd(), "src/ui/forms.css"), "utf8");
    expect(css).toMatch(/\.block-form\s*\{[^}]*max-height:\s*100vh/s);
    expect(css).toMatch(/\.block-form-body\s*\{[^}]*overflow-y:\s*auto/s);
  });
});

describe("BlockForm pass-seconds estimate (Task A10)", () => {
  it("submits with a single argument when no pass-time is entered (byte-compatible with pre-A10 callers)", () => {
    const onOpen = vi.fn();
    render(<BlockForm pieceId={7} onOpen={onOpen} />);

    fireEvent.click(screen.getByRole("button", { name: "Start set" }));

    expect(onOpen).toHaveBeenCalledTimes(1);
    // A single positional argument — no second `context` argument at all,
    // not even `undefined` or `null`. A5's additive tuning stays inside that
    // first RepOpenArgs object.
    expect(onOpen.mock.calls[0]).toHaveLength(1);
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
      tuning: {
        beat_unit: "quarter",
        subdivision: 1,
        beats_per_bar: 4,
      },
    });
  });

  it("passes pass_seconds as a second context argument once entered", () => {
    const onOpen = vi.fn();
    render(<BlockForm pieceId={7} onOpen={onOpen} />);
    openAdvanced();
    fireEvent.change(screen.getByLabelText("One pass seconds"), {
      target: { value: "30" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Start set" }));

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0]).toHaveLength(2);
    expect(onOpen.mock.calls[0][1]).toEqual({ pass_seconds: 30 });
  });

  it("renders no estimate until a pass-time is entered, then the worked-example minutes", () => {
    render(<BlockForm pieceId={7} onOpen={vi.fn()} />);
    openAdvanced();
    expect(screen.queryByLabelText("Set time estimate")).toBeNull();

    // Ladder preview from defaults (start 60, no target) is one rung of 3
    // reps at 60 bpm; pass=30s -> low = 3*30*1 + 3*3 = 99s, high = 148.5s,
    // both round up to whole minutes: 2 and 3.
    fireEvent.change(screen.getByLabelText("One pass seconds"), {
      target: { value: "30" },
    });
    expect(screen.getByLabelText("Set time estimate").textContent).toBe(
      "≈ 2–3 min",
    );
  });

  it("has no pass-seconds field for a non-tempo focus", () => {
    render(<BlockForm pieceId={7} onOpen={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Focus"), {
      target: { value: "notes" },
    });
    openAdvanced();
    expect(screen.queryByLabelText("One pass seconds")).toBeNull();
  });
});

describe("BlockForm behavior", () => {
  it("adopts a newly saved default until this form's clean target has been edited", () => {
    const onOpen = vi.fn();
    const { rerender } = render(
      <BlockForm pieceId={1} defaultCleanStreak={5} onOpen={onOpen} />,
    );

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
