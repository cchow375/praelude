import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BlockForm } from "./BlockForm";

afterEach(cleanup);

describe("BlockForm focus", () => {
  it("opens a non-tempo block without fake BPM or a ladder", () => {
    const onOpen = vi.fn();
    render(<BlockForm pieceId={1} onOpen={onOpen} />);
    fireEvent.change(screen.getByLabelText("Focus"), { target: { value: "notes" } });
    expect(screen.queryByLabelText("Start bpm")).toBeNull();
    fireEvent.change(screen.getByLabelText("From measure"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("To measure"), { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: "Open block" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Open block" }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ focus: "phrasing", use_metronome: true, start_bpm: 60, increment: null }));
  });
});
