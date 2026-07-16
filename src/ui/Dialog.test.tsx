import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Dialog } from "./Dialog";

afterEach(cleanup);

describe("Dialog", () => {
  it("renders nothing when closed", () => {
    const onClose = vi.fn();
    const { container } = render(
      <Dialog open={false} onClose={onClose}>
        body
      </Dialog>,
    );
    expect(container.querySelector(".ck-dialog")).toBeNull();
  });

  it("renders with dialog role and aria attributes when open", () => {
    const onClose = vi.fn();
    const { getByRole } = render(
      <Dialog open label="Confirm restart" onClose={onClose}>
        body
      </Dialog>,
    );
    const dialog = getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-label")).toBe("Confirm restart");
  });

  it("calls onClose on Escape keydown while open", () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose}>
        body
      </Dialog>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not attach an Escape listener when closed", () => {
    const onClose = vi.fn();
    render(
      <Dialog open={false} onClose={onClose}>
        body
      </Dialog>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("calls onClose on backdrop click but not on click inside the dialog", () => {
    const onClose = vi.fn();
    const { container, getByText } = render(
      <Dialog open onClose={onClose}>
        <button type="button">inside</button>
      </Dialog>,
    );
    fireEvent.click(getByText("inside"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(container.querySelector(".ck-dialog-backdrop")!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
