import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BlockForm } from "./BlockForm";

afterEach(cleanup);

describe("BlockForm focus", () => {
  it("starts with a five-clean mastery target and no implied attempt ceiling", () => {
    const onOpen = vi.fn();
    render(<BlockForm pieceId={1} onOpen={onOpen} />);
    expect((screen.getByLabelText("Clean streak target") as HTMLSelectElement).value).toBe("5");
    expect((screen.getByLabelText("Attempt review boundary") as HTMLInputElement).value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Start set" }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({
      required_clean_streak: 5,
      planned_reps: null,
    }));
  });

  it("offers quick targets and a custom consecutive-clean target", () => {
    const onOpen = vi.fn();
    render(<BlockForm pieceId={1} defaultCleanStreak={7} onOpen={onOpen} />);
    expect((screen.getByLabelText("Clean streak target") as HTMLSelectElement).value).toBe("7");
    fireEvent.change(screen.getByLabelText("Clean streak target"), { target: { value: "custom" } });
    fireEvent.change(screen.getByLabelText("Custom clean streak"), { target: { value: "12" } });
    fireEvent.change(screen.getByLabelText("Attempt review boundary"), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: "Start set" }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({
      required_clean_streak: 12,
      planned_reps: 20,
    }));
  });

  it("adopts a newly saved default until this form's clean target has been edited", () => {
    const onOpen = vi.fn();
    const { rerender } = render(
      <BlockForm pieceId={1} defaultCleanStreak={5} onOpen={onOpen} />,
    );

    rerender(<BlockForm pieceId={1} defaultCleanStreak={7} onOpen={onOpen} />);
    expect((screen.getByLabelText("Clean streak target") as HTMLSelectElement).value).toBe("7");

    fireEvent.change(screen.getByLabelText("Clean streak target"), { target: { value: "3" } });
    rerender(<BlockForm pieceId={1} defaultCleanStreak={10} onOpen={onOpen} />);
    expect((screen.getByLabelText("Clean streak target") as HTMLSelectElement).value).toBe("3");
  });

  it("opens a non-tempo block without fake BPM or a ladder", () => {
    const onOpen = vi.fn();
    render(<BlockForm pieceId={1} onOpen={onOpen} />);
    fireEvent.change(screen.getByLabelText("Focus"), { target: { value: "notes" } });
    expect(screen.queryByLabelText("Start bpm")).toBeNull();
    fireEvent.change(screen.getByLabelText("From measure"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("To measure"), { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: "Start set" }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({
      focus: "notes",
      use_metronome: false,
      start_bpm: null,
      target_bpm: null,
      increment: null,
    }));
  });

  it("can use a metronome for non-tempo work without enabling a ladder", () => {
    const onOpen = vi.fn();
    render(<BlockForm pieceId={1} onOpen={onOpen} />);
    fireEvent.change(screen.getByLabelText("Focus"), { target: { value: "phrasing" } });
    fireEvent.click(screen.getByLabelText("Use metronome"));
    expect(screen.getByText("Metronome bpm")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Start set" }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ focus: "phrasing", use_metronome: true, start_bpm: 60, increment: null }));
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
