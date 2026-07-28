import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { ConfirmArchive } from "./ConfirmArchive";

afterEach(cleanup);

function open(
  expected: string,
  onConfirm = vi.fn().mockResolvedValue(undefined),
) {
  render(
    <ConfirmArchive expected={expected} onConfirm={onConfirm}>
      <button type="button">Remove</button>
    </ConfirmArchive>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  return onConfirm;
}

describe("ConfirmArchive typed-name gate", () => {
  it("keeps Remove disabled until the exact name is typed", async () => {
    const onConfirm = open("Scherzo No. 2");
    // After opening there are two "Remove" buttons: the trigger + the popover
    // gate. The gate is the disabled one (identity stable across re-renders, so
    // its `disabled` reflects later state updates).
    const gate = screen
      .getAllByRole("button", { name: "Remove" })
      .find((b) => (b as HTMLButtonElement).disabled) as HTMLButtonElement;
    expect(gate).toBeTruthy();
    expect(gate.disabled).toBe(true);

    const input = screen.getByLabelText("Type the piece name to confirm");
    fireEvent.change(input, { target: { value: "Scherzo" } });
    expect(gate.disabled).toBe(true);

    fireEvent.change(input, { target: { value: "Scherzo No. 2" } });
    await waitFor(() => expect(gate.disabled).toBe(false));

    fireEvent.click(gate);
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
  });

  it("does not confirm when a wrong name is typed", async () => {
    const onConfirm = open("Scherzo No. 2");
    const input = screen.getByLabelText("Type the piece name to confirm");
    fireEvent.change(input, { target: { value: "wrong name" } });
    const gate = screen
      .getAllByRole("button", { name: "Remove" })
      .find((b) => (b as HTMLButtonElement).disabled) as HTMLButtonElement;
    fireEvent.click(gate);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
