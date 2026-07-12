import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { RepHud } from "./RepHud";
import type { RepSnapshot } from "./useRep";

afterEach(cleanup);

function makeSnap(over: Partial<RepSnapshot> = {}): RepSnapshot {
  return {
    block_id: 1,
    piece_id: 7,
    piece_title: "Gymnopédie No. 1",
    m_start: 1,
    m_end: 8,
    label: null,
    bpm: 72,
    start_bpm: 60,
    target_bpm: 84,
    planned_reps: 30,
    reps_done: 4,
    cleans_at_step: 1,
    rule: { clean_needed: 3, bpm_step: 4 },
    variant: null,
    variants: [],
    verdicts: { clean: 3, flawed: 1, failed: 0 },
    last: null,
    status: "active",
    focus: "tempo",
    use_metronome: true,
    ...over,
  };
}

describe("RepHud", () => {
  it("renders nothing when there is no active block", () => {
    const { container } = render(
      <RepHud snap={null} feed={[]} error={null} onCheck={() => {}} onClose={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows the piece, range, counter, tempo and variant", () => {
    render(
      <RepHud
        snap={makeSnap({ variant: "hands separate" })}
        feed={[]}
        error={null}
        onCheck={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText("Gymnopédie No. 1")).toBeTruthy();
    expect(screen.getByText("mm. 1–8")).toBeTruthy();
    expect(screen.getByText("4")).toBeTruthy();
    expect(screen.getByText("30")).toBeTruthy();
    expect(screen.getByText("♩ = 72")).toBeTruthy();
    expect(screen.getByText("hands separate")).toBeTruthy();
  });

  it("maps Clean / Sloppy / Again to clean / flawed / failed verdicts", () => {
    const onCheck = vi.fn();
    render(
      <RepHud
        snap={makeSnap()}
        feed={[]}
        error={null}
        onCheck={onCheck}
        onClose={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Clean" }));
    fireEvent.click(screen.getByRole("button", { name: "Sloppy" }));
    fireEvent.click(screen.getByRole("button", { name: "Again" }));

    expect(onCheck).toHaveBeenNthCalledWith(1, "clean", null);
    expect(onCheck).toHaveBeenNthCalledWith(2, "flawed", null);
    expect(onCheck).toHaveBeenNthCalledWith(3, "failed", null);
  });

  it("passes the typed note along with the verdict, then clears it", () => {
    const onCheck = vi.fn();
    render(
      <RepHud
        snap={makeSnap()}
        feed={[]}
        error={null}
        onCheck={onCheck}
        onClose={() => {}}
      />,
    );

    const note = screen.getByLabelText("Rep note") as HTMLInputElement;
    fireEvent.change(note, { target: { value: "dragged the trill" } });
    fireEvent.click(screen.getByRole("button", { name: "Clean" }));

    expect(onCheck).toHaveBeenCalledWith("clean", "dragged the trill");
    expect(note.value).toBe("");
  });

  it("renders the last-verdict feed", () => {
    render(
      <RepHud
        snap={makeSnap()}
        feed={[
          { verdict: "clean", note: null, bpm: 72 },
          { verdict: "flawed", note: "rushed", bpm: 68 },
        ]}
        error={null}
        onCheck={() => {}}
        onClose={() => {}}
      />,
    );
    const feed = screen.getByLabelText("Recent verdicts");
    expect(feed).toBeTruthy();
    expect(screen.getByText("rushed")).toBeTruthy();
  });

  it("fires onClose from the close button", () => {
    const onClose = vi.fn();
    render(
      <RepHud
        snap={makeSnap()}
        feed={[]}
        error={null}
        onCheck={() => {}}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Close block" }));
    expect(onClose).toHaveBeenCalled();
  });
});
