import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HEARD_MS,
  HeardPill,
  QUIET_SPEECH_NOTE,
  truncateHeard,
} from "./HeardPill";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const final = (text: string) => ({ text, is_final: true });

describe("HeardPill (visible hearing, v6 S9)", () => {
  it("shows nothing until something is heard", () => {
    render(<HeardPill delivery={null} />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("flashes an AMBIENT final the router ignored — the whole point of it", () => {
    // The confirmation toast is suppressed for `ignored` intents and stays
    // suppressed. What must not stay suppressed is the evidence that the app
    // heard anything at all.
    render(
      <HeardPill
        delivery={final("i think the metronome off days are behind me")}
      />,
    );
    expect(screen.getByRole("status").textContent).toContain("i think the metronome off days are behind me");
  });

  it("auto-fades, so it is a flash and not a log", () => {
    vi.useFakeTimers();
    render(<HeardPill delivery={final("metronome off")} />);
    expect(screen.getByRole("status").textContent).toContain("metronome off");
    act(() => {
      vi.advanceTimersByTime(HEARD_MS + 10);
    });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("re-flashes an identical repeat, because each delivery is its own event", () => {
    vi.useFakeTimers();
    const { rerender } = render(<HeardPill delivery={final("done")} />);
    act(() => {
      vi.advanceTimersByTime(HEARD_MS + 10);
    });
    expect(screen.queryByRole("status")).toBeNull();
    // A NEW object with the same text — a second utterance, not a re-render.
    rerender(<HeardPill delivery={final("done")} />);
    expect(screen.getByRole("status").textContent).toContain("done");
  });

  it("ignores a non-final hypothesis", () => {
    render(<HeardPill delivery={{ text: "metro", is_final: false }} />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("elides a long dictated sentence rather than papering the screen", () => {
    const long = "a".repeat(200);
    expect(truncateHeard(long).length).toBeLessThanOrEqual(72);
    expect(truncateHeard(long).endsWith("…")).toBe(true);
    expect(truncateHeard("  metronome    off  ")).toBe("metronome off");
  });

  it("states the honest limit rather than promising sensitivity it cannot have", () => {
    expect(QUIET_SPEECH_NOTE).toContain("macOS speech engine");
    expect(QUIET_SPEECH_NOTE).toContain("can't hear better");
  });
});
