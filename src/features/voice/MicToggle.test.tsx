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
    render(
      <MicToggle
        status="down"
        downGuidance="Hands-free voice is unavailable on Windows."
        onToggle={() => {}}
      />,
    );
    const button = screen.getByRole("button", { name: "Mic unavailable" });
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(button.textContent).toContain("Unavailable");
    expect(button.getAttribute("title")).toContain("unavailable on Windows");
  });

  it("cannot be reopened while Listen Back owns the verdict boundary", () => {
    const onToggle = vi.fn();
    render(
      <MicToggle
        status="muted"
        onToggle={onToggle}
        lockedReason="Voice stays muted while Listen Back is active."
      />,
    );
    const button = screen.getByRole("button", { name: /mic/i });
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(button.getAttribute("title")).toMatch(/Listen Back/i);
    fireEvent.click(button);
    expect(onToggle).not.toHaveBeenCalled();
  });
});
