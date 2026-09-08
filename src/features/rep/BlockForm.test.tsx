import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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
    expect(
      screen.getByText("Each stage advances after its clean count."),
    ).toBeTruthy();
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
    expect(screen.queryByLabelText("Custom variant name")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "+ Custom" }));
    expect(document.activeElement).toBe(
      screen.getByLabelText("Custom variant name"),
    );
    fireEvent.change(screen.getByLabelText("Custom variant name"), {
      target: { value: "octave runs" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add custom variant" }));
    expect(
      (screen.getByLabelText("Variant 1 name") as HTMLInputElement).value,
    ).toBe("octave runs");
    expect(screen.queryByLabelText("Custom variant name")).toBeNull();
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

    const slowInput = screen.getByDisplayValue("slow");
    fireEvent.click(screen.getByRole("button", { name: "Move variant 2 up" }));
    expect(
      (screen.getByLabelText("Variant 1 name") as HTMLInputElement).value,
    ).toBe("dotted");
    expect(
      (screen.getByLabelText("Variant 2 name") as HTMLInputElement).value,
    ).toBe("slow");
    expect(
      screen.getByDisplayValue("slow"),
      "stable draft ids keep the edited input mounted through reorder",
    ).toBe(slowInput);

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

  it("uses one Tab stop and arrow keys for the target-type radio group", async () => {
    render(<BlockForm pieceId={1} onOpen={vi.fn()} />);
    const streak = screen.getByRole("radio", { name: "Clean streak" });
    const plays = screen.getByRole("radio", { name: "Total plays" });

    expect(streak.tabIndex).toBe(0);
    expect(plays.tabIndex).toBe(-1);
    streak.focus();
    fireEvent.keyDown(streak, { key: "ArrowRight" });

    await waitFor(() => expect(document.activeElement).toBe(plays));
    expect(plays.getAttribute("aria-checked")).toBe("true");
    expect(plays.tabIndex).toBe(0);
    expect(streak.tabIndex).toBe(-1);

    fireEvent.keyDown(plays, { key: "Home" });
    await waitFor(() => expect(document.activeElement).toBe(streak));
    expect(streak.getAttribute("aria-checked")).toBe("true");
  });

  it("offers a one-tap total-play target with the requested presets and no competing chain or ladder", () => {
    const onOpen = vi.fn();
    render(<BlockForm pieceId={1} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: "Dotted" }));

    fireEvent.click(screen.getByRole("radio", { name: "Total plays" }));
    const count = screen.getByLabelText(
      "Total plays target",
    ) as HTMLSelectElement;
    expect(Array.from(count.options).map((option) => option.value)).toEqual([
      "5",
      "10",
      "15",
      "25",
      "custom",
    ]);
    expect(screen.queryByRole("group", { name: "Variant chain" })).toBeNull();
    expect(screen.queryByLabelText("Target bpm")).toBeNull();
    expect(
      screen.getByText(
        "Fixed tempo · no variants · every verdict counts; Undo removes one.",
      ),
    ).toBeTruthy();

    fireEvent.change(count, { target: { value: "15" } });
    openAdvanced();
    expect(screen.queryByRole("group", { name: "Tempo ladder" })).toBeNull();
    expect(screen.queryByLabelText("Attempt review boundary")).toBeNull();
    expect(
      screen.getByRole("group", { name: "Metronome tuning" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Start set" }));

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0][0]).toMatchObject({
      planned_reps: null,
      required_clean_streak: null,
      attempt_target: 15,
      target_bpm: null,
      increment: null,
      variants: [],
    });
  });

  it("keeps a hidden variant draft intact when switching back from total plays", () => {
    render(<BlockForm pieceId={1} onOpen={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Legato" }));
    fireEvent.click(screen.getByRole("radio", { name: "Total plays" }));
    expect(screen.queryByDisplayValue("legato")).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Clean streak" }));
    expect(screen.getByDisplayValue("legato")).toBeTruthy();
  });

  it("removes a drafted demotion override from the total-play summary", () => {
    render(<BlockForm pieceId={1} onOpen={vi.fn()} />);
    openAdvanced();
    fireEvent.change(
      screen.getByRole("combobox", { name: "Tempo demotion for this set" }),
      { target: { value: "on" } },
    );
    expect(screen.getByText(/demote after 3, then 2 sloppy/)).toBeTruthy();

    fireEvent.click(screen.getByRole("radio", { name: "Total plays" }));
    expect(screen.queryByText(/demote after/)).toBeNull();
    expect(screen.queryByRole("group", { name: "Tempo demotion" })).toBeNull();
  });

  it("submits a compact custom total-play count", () => {
    const onOpen = vi.fn();
    render(<BlockForm pieceId={1} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("radio", { name: "Total plays" }));
    fireEvent.change(screen.getByLabelText("Total plays target"), {
      target: { value: "custom" },
    });
    fireEvent.change(screen.getByLabelText("Custom total plays"), {
      target: { value: "37" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start set" }));
    expect(onOpen.mock.calls[0][0].attempt_target).toBe(37);
  });

  it("pins the compact single-row variant CSS contract", () => {
    const css = readFileSync(join(process.cwd(), "src/ui/forms.css"), "utf8");
    expect(css).toMatch(/\.ck-chip-row\s*\{[^}]*flex-wrap:\s*nowrap/s);
    expect(css).toMatch(
      /\.ck-chain-item\s*\{[^}]*grid-template-columns:\s*1rem minmax\(4\.5rem, 1fr\) 3rem auto/s,
    );
    expect(css).toMatch(/\.ck-chain-count\s*\{[^}]*height:\s*32px/s);
  });

  it("groups the core controls into compact logical pairs", () => {
    render(<BlockForm pieceId={1} onOpen={vi.fn()} />);
    const fromRow = screen
      .getByLabelText("From measure")
      .closest(".ck-field-grid");
    const toRow = screen.getByLabelText("To measure").closest(".ck-field-grid");
    const startRow = screen
      .getByLabelText("Start bpm")
      .closest(".ck-field-grid");
    const targetRow = screen
      .getByLabelText("Target bpm")
      .closest(".ck-field-grid");
    const focusRow = screen.getByLabelText("Focus").closest(".ck-field-grid");
    const metroRow = screen
      .getByLabelText("Use metronome")
      .closest(".ck-field-grid");

    expect(fromRow).toBe(toRow);
    expect(fromRow?.classList.contains("ck-core-pair")).toBe(true);
    expect(startRow).toBe(targetRow);
    expect(startRow?.classList.contains("ck-core-pair")).toBe(true);
    expect(focusRow).toBe(metroRow);
    expect(focusRow?.classList.contains("ck-focus-grid")).toBe(true);
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

  it("submits an explicit per-set demotion override without replacing the auto ladder", () => {
    const onOpen = vi.fn();
    render(<BlockForm pieceId={7} onOpen={onOpen} />);
    openAdvanced();
    fireEvent.change(
      screen.getByRole("combobox", { name: "Tempo demotion for this set" }),
      { target: { value: "on" } },
    );
    fireEvent.change(
      screen.getByRole("spinbutton", {
        name: "First demotion after sloppy reps",
      }),
      { target: { value: "4" } },
    );
    fireEvent.change(
      screen.getByRole("spinbutton", {
        name: "Later demotions after sloppy reps",
      }),
      { target: { value: "2" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Start set" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0][0].increment).toBeNull();
    expect(onOpen.mock.calls[0][1]).toBeUndefined();
    expect(onOpen.mock.calls[0][2]).toEqual({
      enabled: true,
      first: 4,
      repeat: 2,
    });
  });
});

describe("BlockForm compact score presentation", () => {
  it("submits the exposed goal and tempo controls without opening Settings", () => {
    const onOpen = vi.fn();
    render(<BlockForm pieceId={1} presentation="compact" onOpen={onOpen} />);
    fireEvent.change(screen.getByLabelText("Start bpm"), { target: { value: "40" } });
    fireEvent.change(screen.getByLabelText("Target bpm"), { target: { value: "60" } });
    fireEvent.click(screen.getByRole("button", { name: "Start set" }));
    expect(onOpen.mock.calls[0][0]).toMatchObject({
      focus: "tempo", start_bpm: 40, target_bpm: 60, use_metronome: true,
    });
    fireEvent.change(screen.getByLabelText("Goal"), { target: { value: "notes" } });
    expect(screen.queryByLabelText("Target bpm")).toBeNull();
    expect(screen.queryByLabelText("Start bpm")).toBeNull();
    fireEvent.click(screen.getByLabelText("Use metronome"));
    expect(screen.getByLabelText("Start bpm")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Start set" }));
    expect(onOpen.mock.calls[1][0]).toMatchObject({
      focus: "notes", start_bpm: 40, target_bpm: null, use_metronome: true,
    });
  });

  it("keeps Settings target mode connected to the exposed tempo and variants", () => {
    const onOpen = vi.fn();
    render(<BlockForm pieceId={1} presentation="compact" onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: "Practice settings" }));
    fireEvent.click(screen.getByRole("radio", { name: "Total plays" }));
    fireEvent.change(screen.getByLabelText("Total plays target"), { target: { value: "15" } });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByLabelText("Target bpm")).toBeNull();
    expect(screen.getByRole("button", { name: "Choose variants" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Start set" }));
    expect(onOpen.mock.calls[0][0]).toMatchObject({ attempt_target: 15, target_bpm: null });
  });

  it("keeps the score launchpad short and opens a focused, toggleable variant picker", () => {
    render(<BlockForm pieceId={1} presentation="compact" onOpen={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Choose variants" }));
    expect(screen.getByRole("dialog", { name: "Choose variants" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Left hand only" }).getAttribute("aria-pressed"),
    ).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "Left hand only" }));
    fireEvent.click(screen.getByRole("button", { name: "Right hand only" }));
    expect(
      screen.getByRole("button", { name: "Left hand only" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen.getByRole("button", { name: "Right hand only" }).getAttribute("aria-pressed"),
    ).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog", { name: "Choose variants" })).toBeNull();
    expect(screen.getByRole("button", { name: "2 variants selected" })).toBeTruthy();
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
      screen.getByText(
        /Changing this label never converts or changes the BPM/i,
      ),
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
      within(screen.getByRole("group", { name: "Subdivision" })).getByText("3"),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Start set" }));
    expect(onOpen.mock.calls[0][0].tuning).toEqual({
      beat_unit: "dotted_quarter",
      subdivision: 3,
      beats_per_bar: 6,
    });
  });

  it("keeps one Start set action in the persistent header outside variable content", () => {
    const { container } = render(<BlockForm pieceId={1} onOpen={vi.fn()} />);
    openAdvanced();
    const body = container.querySelector(".block-form-body") as HTMLElement;
    const head = container.querySelector(".block-form-head") as HTMLElement;
    const start = screen.getByRole("button", { name: "Start set" });
    expect(body.contains(screen.getByLabelText("BPM note value"))).toBe(true);
    expect(body.contains(start)).toBe(false);
    expect(head.contains(start)).toBe(true);
    expect(screen.getAllByRole("button", { name: "Start set" })).toHaveLength(
      1,
    );

    // jsdom has no layout engine, so pin the actual CSS contract that makes
    // the structure safe at 720×520; screenshot QA remains the pixel proof.
    const css = readFileSync(join(process.cwd(), "src/ui/forms.css"), "utf8");
    expect(css).toMatch(/\.block-form\s*\{[^}]*max-height:\s*100vh/s);
    expect(css).toMatch(/\.block-form-body\s*\{[^}]*overflow-y:\s*auto/s);
    expect(css).toMatch(/\.block-form-head\s*\{[^}]*display:\s*flex/s);
    expect(css).toMatch(
      /\.ck-primary\.block-form-submit\s*\{[^}]*height:\s*34px/s,
    );
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
