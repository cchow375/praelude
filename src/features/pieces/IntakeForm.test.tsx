import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IntakeForm } from "./IntakeForm";
import type { Intake, PieceDetailData } from "./types";

afterEach(cleanup);

function basePiece(overrides: Partial<PieceDetailData> = {}): PieceDetailData {
  return {
    id: 5,
    title: "Clair de Lune",
    composer: "Debussy",
    has_xml: false,
    has_pdf: true,
    intake_done: false,
    folder_path: "/pieces/clair-de-lune",
    xml_path: null,
    pdf_path: "/pieces/clair-de-lune/score.pdf",
    goals: [],
    deadline: null,
    target_tempo: null,
    hard_spots: [],
    current_state: null,
    notes: null,
    ...overrides,
  };
}

function getForm(): HTMLFormElement {
  return screen.getByRole("button", { name: "Save intake" }).closest("form")!;
}

describe("IntakeForm", () => {
  it("defaults to one blank goal row and one blank hard-spot row for a fresh piece", () => {
    render(<IntakeForm piece={basePiece()} onSave={vi.fn()} />);
    expect((screen.getByLabelText("Goal 1") as HTMLInputElement).value).toBe(
      "",
    );
    expect(screen.queryByLabelText("Goal 2")).toBeNull();
    expect(
      (screen.getByLabelText("Hard spot 1 measures") as HTMLInputElement).value,
    ).toBe("");
    expect(
      (screen.getByLabelText("Hard spot 1 note") as HTMLInputElement).value,
    ).toBe("");
  });

  it("prefills every field from an existing piece", () => {
    const piece = basePiece({
      goals: ["Learn the A section", "Play with pedal"],
      deadline: "2026-08-01",
      target_tempo: 96,
      hard_spots: [{ measures: "17-24", note: "awkward turn" }],
      current_state: "Can play hands separately",
    });
    render(<IntakeForm piece={piece} onSave={vi.fn()} />);
    expect((screen.getByLabelText("Goal 1") as HTMLInputElement).value).toBe(
      "Learn the A section",
    );
    expect((screen.getByLabelText("Goal 2") as HTMLInputElement).value).toBe(
      "Play with pedal",
    );
    expect((screen.getByLabelText("Deadline") as HTMLInputElement).value).toBe(
      "2026-08-01",
    );
    expect(
      (screen.getByLabelText("Target tempo (bpm)") as HTMLInputElement).value,
    ).toBe("96");
    expect(
      (screen.getByLabelText("Hard spot 1 measures") as HTMLInputElement).value,
    ).toBe("17-24");
    expect(
      (screen.getByLabelText("Hard spot 1 note") as HTMLInputElement).value,
    ).toBe("awkward turn");
    expect(
      (screen.getByLabelText("Where I am now") as HTMLInputElement).value,
    ).toBe("Can play hands separately");
  });

  it("submits a trimmed Intake, dropping blank goals and keeping a hard spot with only a note", () => {
    const onSave = vi.fn<(intake: Intake) => void>();
    render(<IntakeForm piece={basePiece()} onSave={onSave} />);

    fireEvent.change(screen.getByLabelText("Goal 1"), {
      target: { value: "  Memorize the coda  " },
    });
    fireEvent.click(screen.getByText("+ Add goal"));
    // second goal row is left blank on purpose

    fireEvent.change(screen.getByLabelText("Hard spot 1 measures"), {
      target: { value: "   " },
    });
    fireEvent.change(screen.getByLabelText("Hard spot 1 note"), {
      target: { value: "  rushes here  " },
    });

    fireEvent.change(screen.getByLabelText("Deadline"), {
      target: { value: "2026-09-01" },
    });
    fireEvent.change(screen.getByLabelText("Target tempo (bpm)"), {
      target: { value: "110" },
    });
    fireEvent.change(screen.getByLabelText("Where I am now"), {
      target: { value: "  slow but clean  " },
    });

    fireEvent.submit(getForm());

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({
      goals: ["Memorize the coda"],
      deadline: "2026-09-01",
      target_tempo: 110,
      hard_spots: [{ measures: "", note: "rushes here" }],
      current_state: "slow but clean",
    } satisfies Intake);
  });

  it("submits an entirely empty intake (no validation blocks a blank submission)", () => {
    const onSave = vi.fn();
    render(<IntakeForm piece={basePiece()} onSave={onSave} />);
    fireEvent.submit(getForm());
    expect(onSave).toHaveBeenCalledWith({
      goals: [],
      deadline: null,
      target_tempo: null,
      hard_spots: [],
      current_state: null,
    });
  });

  it("does not call onSave until the form is actually submitted", () => {
    const onSave = vi.fn();
    render(<IntakeForm piece={basePiece()} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText("Goal 1"), {
      target: { value: "Draft goal" },
    });
    expect(onSave).not.toHaveBeenCalled();
  });

  it("adds and removes goal rows but never drops below one row", () => {
    render(<IntakeForm piece={basePiece()} onSave={vi.fn()} />);
    fireEvent.click(screen.getByText("+ Add goal"));
    fireEvent.click(screen.getByText("+ Add goal"));
    expect(screen.getByLabelText("Goal 3")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Remove goal 3"));
    fireEvent.click(screen.getByLabelText("Remove goal 2"));
    expect(screen.queryByLabelText("Goal 2")).toBeNull();
    expect(screen.getByLabelText("Goal 1")).toBeTruthy();

    // Only row left: remove is a no-op, the row survives.
    fireEvent.click(screen.getByLabelText("Remove goal 1"));
    expect(screen.getByLabelText("Goal 1")).toBeTruthy();
  });

  it("adds and removes hard-spot rows but never drops below one row", () => {
    render(<IntakeForm piece={basePiece()} onSave={vi.fn()} />);
    fireEvent.click(screen.getByText("+ Add hard spot"));
    expect(screen.getByLabelText("Hard spot 2 measures")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Remove hard spot 2"));
    expect(screen.queryByLabelText("Hard spot 2 measures")).toBeNull();

    fireEvent.click(screen.getByLabelText("Remove hard spot 1"));
    expect(screen.getByLabelText("Hard spot 1 measures")).toBeTruthy();
  });

  it("edits each goal row independently by index", () => {
    render(
      <IntakeForm
        piece={basePiece({ goals: ["first", "second"] })}
        onSave={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Goal 2"), {
      target: { value: "second, edited" },
    });
    expect((screen.getByLabelText("Goal 1") as HTMLInputElement).value).toBe(
      "first",
    );
    expect((screen.getByLabelText("Goal 2") as HTMLInputElement).value).toBe(
      "second, edited",
    );
  });

  describe("tempo parsing on submit", () => {
    const submitWithTempo = (raw: string) => {
      const onSave = vi.fn();
      render(<IntakeForm piece={basePiece()} onSave={onSave} />);
      fireEvent.change(screen.getByLabelText("Target tempo (bpm)"), {
        target: { value: raw },
      });
      fireEvent.submit(getForm());
      return onSave.mock.calls[0][0] as Intake;
    };

    it("treats a blank value as null", () => {
      expect(submitWithTempo("").target_tempo).toBeNull();
    });

    it("treats a whitespace-only value as null", () => {
      expect(submitWithTempo("   ").target_tempo).toBeNull();
    });

    it("treats non-numeric text as null instead of NaN", () => {
      expect(submitWithTempo("fast").target_tempo).toBeNull();
    });

    it("treats a non-finite numeric string (Infinity) as null", () => {
      expect(submitWithTempo("Infinity").target_tempo).toBeNull();
    });

    it("parses a plain integer", () => {
      expect(submitWithTempo("120").target_tempo).toBe(120);
    });

    it("parses a decimal value even though the field represents bpm", () => {
      expect(submitWithTempo("120.5").target_tempo).toBe(120.5);
    });

    it("does not reject a negative value client-side (the min=1 attribute is not enforced here)", () => {
      expect(submitWithTempo("-5").target_tempo).toBe(-5);
    });
  });

  it("shows the saving label and disables submit while saving, and is idle otherwise", () => {
    const { rerender } = render(
      <IntakeForm piece={basePiece()} onSave={vi.fn()} saving />,
    );
    const savingButton = screen.getByRole("button", {
      name: "Saving…",
    }) as HTMLButtonElement;
    expect(savingButton.disabled).toBe(true);

    rerender(
      <IntakeForm piece={basePiece()} onSave={vi.fn()} saving={false} />,
    );
    const idleButton = screen.getByRole("button", {
      name: "Save intake",
    }) as HTMLButtonElement;
    expect(idleButton.disabled).toBe(false);
  });

  it("does not catch a synchronous throw from onSave; it surfaces as an uncaught error instead", () => {
    const onSave = vi.fn(() => {
      throw new Error("piece_intake_save rejected");
    });
    const onWindowError = vi.fn((e: ErrorEvent | Event) => {
      if ("preventDefault" in e) e.preventDefault();
    });
    window.addEventListener("error", onWindowError);
    try {
      render(<IntakeForm piece={basePiece()} onSave={onSave} />);
      fireEvent.submit(getForm());
      // submit() has no try/catch around onSave(intake), so React re-throws
      // the error asynchronously instead of it being handled in this form.
      expect(onSave).toHaveBeenCalledTimes(1);
      expect(onWindowError).toHaveBeenCalled();
    } finally {
      window.removeEventListener("error", onWindowError);
    }
  });

  it("crashes on a malformed backend response where goals/hard_spots arrive as null instead of []", () => {
    const malformed = basePiece({
      goals: null as unknown as string[],
      hard_spots: null as unknown as PieceDetailData["hard_spots"],
    });
    expect(() =>
      render(<IntakeForm piece={malformed} onSave={vi.fn()} />),
    ).toThrow();
  });

  it("does not resync local edits when the piece prop changes without the component remounting", () => {
    const piece1 = basePiece({ deadline: "2026-08-01" });
    const piece2 = basePiece({ deadline: "2099-01-01" });
    const { rerender } = render(<IntakeForm piece={piece1} onSave={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Deadline"), {
      target: { value: "2026-12-25" },
    });
    rerender(<IntakeForm piece={piece2} onSave={vi.fn()} />);

    // Stale draft wins: the parent must remount (e.g. via `key`) to push fresh piece data in.
    expect((screen.getByLabelText("Deadline") as HTMLInputElement).value).toBe(
      "2026-12-25",
    );
  });
});
