import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionDraftCard } from "./ActionDraftCard";
import { parseNaturalPracticeActionDraft } from "./domain/actionDraft";

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
