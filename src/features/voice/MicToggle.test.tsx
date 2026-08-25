import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MicToggle } from "./MicToggle";

afterEach(cleanup);

describe("MicToggle", () => {
  it("says what it does and what state it is in when live", () => {
    render(<MicToggle status="live" onToggle={() => {}} />);
    const button = screen.getByRole("button", { name: /mic/i });
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(button.textContent).toMatch(/mic/i); // a visible label, not an icon alone
  });

  it("reports muted unmistakably", () => {
    render(<MicToggle status="muted" onToggle={() => {}} />);
    const button = screen.getByRole("button", { name: /mic/i });
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.textContent).toMatch(/muted/i);
  });

  it("mutes on click and unmutes on the next click", () => {
    const onToggle = vi.fn();
    const { rerender } = render(
      <MicToggle status="live" onToggle={onToggle} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /mic/i }));
    expect(onToggle).toHaveBeenCalledWith(true);

    rerender(<MicToggle status="muted" onToggle={onToggle} />);
    fireEvent.click(screen.getByRole("button", { name: /mic/i }));
    expect(onToggle).toHaveBeenLastCalledWith(false);
  });

  it("is disabled and explains itself when voice is down", () => {
    render(<MicToggle status="down" onToggle={() => {}} />);
    const button = screen.getByRole("button", { name: /mic/i });
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(button.getAttribute("title")).toMatch(/not running|unavailable/i);
  });
});
