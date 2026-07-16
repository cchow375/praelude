import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionDraftCard } from "./ActionDraftCard";
import { parseNaturalPracticeActionDraft } from "./domain/actionDraft";
import type { ProposedAction } from "./domain/proposedAction";

afterEach(cleanup);

function readyDraft() {
  const draft = parseNaturalPracticeActionDraft(
    "Play measures 492 to 512 starting at tempo 50 and get to 64 for 15 reps",
    { piece_id: 7, piece_title: "Scherzo No. 2", default_clean_streak: 5 },
  );
  if (!draft) throw new Error("fixture did not parse");
  return draft;
}

describe("ActionDraftCard", () => {
  it("does not mutate until the explicit confirmation button is pressed", () => {
    const confirm = vi.fn();
    render(<ActionDraftCard draft={readyDraft()} onConfirm={confirm} onCancel={() => undefined} />);

    expect(screen.getByText("Action draft · nothing changed")).toBeTruthy();
    expect(confirm).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Draft planned attempts"), { target: { value: "12" } });
    expect(confirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Start this set" }));
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({
      confirmation_required: true,
      contract: expect.objectContaining({ planned_attempts: 12 }),
    }));
  });

  it("blocks confirmation until an invalid spoken range is corrected", () => {
    const confirm = vi.fn();
    const draft = parseNaturalPracticeActionDraft(
      "Practice measures 12 to 8 for 5 reps",
      { piece_id: 7, piece_title: "Scherzo No. 2", default_clean_streak: 5 },
    );
    if (!draft) throw new Error("fixture did not parse");
    render(<ActionDraftCard draft={draft} onConfirm={confirm} onCancel={() => undefined} />);

    expect((screen.getByRole("button", { name: "Start this set" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/measure range must run forward/i)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Draft end measure"), { target: { value: "18" } });
    expect((screen.getByRole("button", { name: "Start this set" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("cancels without confirming", () => {
    const confirm = vi.fn();
    const cancel = vi.fn();
    render(<ActionDraftCard draft={readyDraft()} onConfirm={confirm} onCancel={cancel} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
  });
});

describe("ActionDraftCard — proposed action slim cards", () => {
  const actions: ProposedAction[] = [
    { kind: "verdict", summary: "Record this attempt as clean", verdict: "clean", note: null },
    { kind: "tempo", summary: "Set the metronome to 120", bpm: 120 },
    { kind: "undo", summary: "Undo the last rep" },
    { kind: "restart", summary: "Restart the streak", required_clean_streak: null },
  ];

  it.each(actions)("renders the summary and confirms $kind with a single button", (action) => {
    const confirm = vi.fn();
    render(<ActionDraftCard draft={action} onConfirm={confirm} onCancel={() => undefined} />);

    expect(screen.getByText("Action draft · nothing changed")).toBeTruthy();
    expect(
      screen.getByText(action.summary, { selector: ".voice-action-draft-summary" }),
    ).toBeTruthy();
    // Slim cards carry no heavy form; only the two controls.
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(confirm).toHaveBeenCalledWith(action);
  });

  it("shows the no-confirm state when a verdict has no active set", () => {
    const confirm = vi.fn();
    render(
      <ActionDraftCard
        draft={actions[0]}
        onConfirm={confirm}
        onCancel={() => undefined}
        unavailableReason="A verdict needs an active set. Open a set first, then ask again."
      />,
    );

    expect(screen.getByText(/verdict needs an active set/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Confirm" })).toBeNull();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
  });

  it("cancels a slim card without confirming", () => {
    const confirm = vi.fn();
    const cancel = vi.fn();
    render(<ActionDraftCard draft={actions[1]} onConfirm={confirm} onCancel={cancel} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
  });
});
