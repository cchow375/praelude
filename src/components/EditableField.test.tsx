import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { EditableField } from "./EditableField";

afterEach(cleanup);

describe("EditableField", () => {
  it("double-click → edit → Enter saves optimistically", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<EditableField value="mm.1-8" onSave={onSave} ariaLabel="label" />);
    fireEvent.doubleClick(screen.getByText("mm.1-8"));
    const input = screen.getByLabelText("label") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "legato" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(onSave).toHaveBeenCalledWith("legato"));
    expect(screen.getByText("legato")).toBeTruthy();
  });

  it("rolls back when onSave rejects", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("bad"));
    render(<EditableField value="mm.1-8" onSave={onSave} ariaLabel="label" />);
    fireEvent.doubleClick(screen.getByText("mm.1-8"));
    const input = screen.getByLabelText("label");
    fireEvent.change(input, { target: { value: "legato" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(screen.getByText("mm.1-8")).toBeTruthy()); // rolled back
  });

  it("Esc cancels without calling onSave", () => {
    const onSave = vi.fn();
    render(<EditableField value="mm.1-8" onSave={onSave} ariaLabel="label" />);
    fireEvent.doubleClick(screen.getByText("mm.1-8"));
    fireEvent.keyDown(screen.getByLabelText("label"), { key: "Escape" });
    expect(onSave).not.toHaveBeenCalled();
  });

  it("shows placeholder when value is empty", () => {
    const onSave = vi.fn();
    render(<EditableField value="" onSave={onSave} placeholder="add a note" ariaLabel="label" />);
    expect(screen.getByText("add a note")).toBeTruthy();
  });

  it("blur commits like Enter", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<EditableField value="mm.1-8" onSave={onSave} ariaLabel="label" />);
    fireEvent.doubleClick(screen.getByText("mm.1-8"));
    const input = screen.getByLabelText("label");
    fireEvent.change(input, { target: { value: "staccato" } });
    fireEvent.blur(input);
    await waitFor(() => expect(onSave).toHaveBeenCalledWith("staccato"));
  });
});
