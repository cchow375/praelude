import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
    const { getByText } = render(
      <Dialog open onClose={onClose}>
        <button type="button">inside</button>
      </Dialog>,
    );
    fireEvent.click(getByText("inside"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(document.querySelector(".ck-dialog-backdrop")!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});


describe("Dialog keyboard containment", () => {
  it("focuses the first usable control, wraps both directions, and restores the opener", () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const { unmount } = render(
      <Dialog open title="Practice settings" onClose={vi.fn()}>
        <button disabled>Unavailable</button>
        <button>First</button>
        <button>Last</button>
      </Dialog>,
    );
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "First" }));
    expect(screen.getByRole("dialog", { name: "Practice settings" })).toBeTruthy();
    fireEvent.keyDown(document.activeElement!, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Last" }));
    fireEvent.keyDown(document.activeElement!, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "First" }));
    opener.focus();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "First" }));
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it("keeps the app inert until the last modal closes and skips hidden fields", () => {
    const root = document.createElement("div");
    root.id = "root";
    document.body.append(root);
    const first = render(
      <Dialog open label="First modal" onClose={vi.fn()}>
        <div style={{ display: "none" }}><button>Hidden control</button></div>
        <button>Usable control</button>
      </Dialog>,
    );
    expect(root.hasAttribute("inert")).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Usable control" }));
    const second = render(<Dialog open label="Second modal" onClose={vi.fn()}><button>Second control</button></Dialog>);
    first.unmount();
    expect(root.hasAttribute("inert")).toBe(true);
    second.unmount();
    expect(root.hasAttribute("inert")).toBe(false);
    root.remove();
  });

  it("keeps an empty dialog focusable and does not reset focus on parent rerenders", () => {
    const { rerender } = render(<Dialog open label="Empty" onClose={vi.fn()}>No controls</Dialog>);
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
    rerender(<Dialog open label="Empty" onClose={vi.fn()}><button>First</button><button>Second</button></Dialog>);
    screen.getByRole("button", { name: "Second" }).focus();
    rerender(<Dialog open label="Empty" onClose={vi.fn()}><button>First</button><button>Second</button></Dialog>);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Second" }));
  });

  it("lets a nested surface consume Escape and otherwise closes only the uppermost dialog", () => {
    const outerClose = vi.fn();
    const innerClose = vi.fn();
    render(<Dialog open label="Outer" onClose={outerClose}><button>Outer action</button></Dialog>);
    const inner = render(<Dialog open label="Inner" onClose={innerClose}><button>Inner action</button></Dialog>);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(innerClose).toHaveBeenCalledOnce();
    expect(outerClose).not.toHaveBeenCalled();
    inner.unmount();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Outer action" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(outerClose).toHaveBeenCalledOnce();
  });
});
