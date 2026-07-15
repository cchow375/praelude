import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ConfirmDelete } from "./ConfirmDelete";

afterEach(cleanup);

describe("ConfirmDelete", () => {
  it("shows the trigger, and opens a popover with the label on click", () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(
      <ConfirmDelete label="this block and its 9 reps" onConfirm={onConfirm}>
        <button>Delete</button>
      </ConfirmDelete>,
    );
    fireEvent.click(screen.getByText("Delete"));
    expect(screen.getByText("this block and its 9 reps")).toBeTruthy();
  });

  it("Confirm calls onConfirm and closes", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(
      <ConfirmDelete label="this block and its 9 reps" onConfirm={onConfirm}>
        <button>Delete</button>
      </ConfirmDelete>,
    );
    fireEvent.click(screen.getByText("Delete"));
    fireEvent.click(screen.getByText("Confirm"));
    await waitFor(() => expect(onConfirm).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByRole("dialog").getAttribute("data-visible")).toBe("false"),
    );
  });

  it("Cancel does not call onConfirm and closes", () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDelete label="this block and its 9 reps" onConfirm={onConfirm}>
        <button>Delete</button>
      </ConfirmDelete>,
    );
    fireEvent.click(screen.getByText("Delete"));
    fireEvent.click(screen.getByText("Cancel"));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog").getAttribute("data-visible")).toBe("false");
  });

  it("restores focus to the actual delete button after cancel", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDelete label="this block and its 9 reps" onConfirm={onConfirm}>
        <button type="button">Delete block</button>
      </ConfirmDelete>,
    );
    const trigger = screen.getByRole("button", { name: "Delete block" });
    trigger.focus();
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
