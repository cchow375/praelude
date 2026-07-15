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
    expect(screen.getByRole("button", { name: "Edit label" })).toBeTruthy();
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

  it("supports a focusable trigger and restores focus after keyboard cancel", async () => {
    const onSave = vi.fn();
    render(<EditableField value="mm.1-8" onSave={onSave} ariaLabel="section label" />);
    const trigger = screen.getByRole("button", { name: "Edit section label" });
    trigger.focus();
    fireEvent.click(trigger);
    const input = screen.getByLabelText("section label");
    expect(document.activeElement).toBe(input);

    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Edit section label" }),
    ));
    expect(onSave).not.toHaveBeenCalled();
  });

  it("does not let an Escape blur guard swallow the next edit cycle's real blur", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<EditableField value="first" onSave={onSave} ariaLabel="label" />);

    fireEvent.click(screen.getByRole("button", { name: "Edit label" }));
    fireEvent.keyDown(screen.getByLabelText("label"), { key: "Escape" });

    fireEvent.click(screen.getByRole("button", { name: "Edit label" }));
    const secondInput = screen.getByLabelText("label");
    fireEvent.change(secondInput, { target: { value: "second cycle" } });
    fireEvent.blur(secondInput);

    await waitFor(() => expect(onSave).toHaveBeenCalledWith("second cycle"));
  });

  it("adopts an external value that arrives during editing when the edit is cancelled", async () => {
    const onSave = vi.fn();
    const view = render(<EditableField value="local old" onSave={onSave} ariaLabel="label" />);
    fireEvent.click(screen.getByRole("button", { name: "Edit label" }));
    fireEvent.change(screen.getByLabelText("label"), { target: { value: "unsaved draft" } });

    view.rerender(<EditableField value="external truth" onSave={onSave} ariaLabel="label" />);
    expect((screen.getByLabelText("label") as HTMLInputElement).value).toBe("unsaved draft");
    fireEvent.keyDown(screen.getByLabelText("label"), { key: "Escape" });

    expect(await screen.findByText("external truth")).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });
});
