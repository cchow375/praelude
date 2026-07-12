import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { EditableNumber } from "./EditableNumber";

afterEach(cleanup);

describe("EditableNumber", () => {
  it("double-click → edit → Enter saves optimistically", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<EditableNumber value={84} onSave={onSave} ariaLabel="bpm" />);
    fireEvent.doubleClick(screen.getByText("84"));
    const input = screen.getByLabelText("bpm") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "96" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(96));
    expect(screen.getByText("96")).toBeTruthy();
  });

  it("rolls back when onSave rejects", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("bad"));
    render(<EditableNumber value={84} onSave={onSave} ariaLabel="bpm" />);
    fireEvent.doubleClick(screen.getByText("84"));
    const input = screen.getByLabelText("bpm");
    fireEvent.change(input, { target: { value: "96" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(screen.getByText("84")).toBeTruthy());
  });

  it("Esc cancels without calling onSave", () => {
    const onSave = vi.fn();
    render(<EditableNumber value={84} onSave={onSave} ariaLabel="bpm" />);
    fireEvent.doubleClick(screen.getByText("84"));
    fireEvent.keyDown(screen.getByLabelText("bpm"), { key: "Escape" });
    expect(onSave).not.toHaveBeenCalled();
  });

  it("clamps to min/max on save", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<EditableNumber value={84} onSave={onSave} min={40} max={100} ariaLabel="bpm" />);
    fireEvent.doubleClick(screen.getByText("84"));
    const input = screen.getByLabelText("bpm");
    fireEvent.change(input, { target: { value: "500" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(100));
  });

  it("clears to null when allowNull and field is emptied", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<EditableNumber value={84} onSave={onSave} allowNull ariaLabel="bpm" />);
    fireEvent.doubleClick(screen.getByText("84"));
    const input = screen.getByLabelText("bpm");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(null));
  });

  it("renders empty placeholder-ish display when value is null", () => {
    const onSave = vi.fn();
    render(<EditableNumber value={null} onSave={onSave} allowNull ariaLabel="bpm" />);
    expect(screen.getByText("—")).toBeTruthy();
  });
});
