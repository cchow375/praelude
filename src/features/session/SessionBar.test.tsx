import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  act,
} from "@testing-library/react";

import { SessionBar, parseStartedAt, formatElapsed } from "./SessionBar";
import type { SessionEventView, SessionView } from "./useSession";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function makeSession(over: Partial<SessionView> = {}): SessionView {
  return {
    id: 1,
    started_at: "2026-07-17T10:00:00Z",
    events: [],
    ...over,
  };
}

function makeEvent(over: Partial<SessionEventView> = {}): SessionEventView {
  return {
    ts: "2026-07-17T10:00:00Z",
    kind: "rep",
    payload: null,
    ...over,
  };
}

describe("parseStartedAt", () => {
  it("multiplies a unix-seconds number (< 1e12) up to millis", () => {
    // 2026-07-17T10:00:00Z in seconds.
    expect(parseStartedAt(1784390400)).toBe(1784390400 * 1000);
  });

  it("leaves an already-millis number (>= 1e12) unchanged", () => {
    expect(parseStartedAt(1784390400000)).toBe(1784390400000);
  });

  it("treats the exact 1e12 boundary as already-millis, not seconds", () => {
    expect(parseStartedAt(1e12)).toBe(1e12);
  });

  it("parses an RFC3339 string to epoch millis", () => {
    expect(parseStartedAt("2026-07-17T10:00:00Z")).toBe(
      Date.parse("2026-07-17T10:00:00Z"),
    );
  });

  it("returns null for an unparsable string", () => {
    expect(parseStartedAt("not-a-date")).toBeNull();
    expect(parseStartedAt("")).toBeNull();
  });
});

describe("formatElapsed", () => {
  it("formats sub-minute spans as M:SS", () => {
    expect(formatElapsed(5000)).toBe("0:05");
    expect(formatElapsed(59000)).toBe("0:59");
  });

  it("formats spans over an hour as H:MM:SS without zero-padding the hour", () => {
    expect(formatElapsed(3_600_000)).toBe("1:00:00");
    expect(formatElapsed(36_000_000 + 61_000)).toBe("10:01:01");
  });

  it("clamps negative elapsed (clock skew / backend rewind) to 0:00", () => {
    expect(formatElapsed(-5000)).toBe("0:00");
  });

  it("floors fractional milliseconds down to the nearest second", () => {
    expect(formatElapsed(1999)).toBe("0:01");
  });
});

describe("SessionBar component", () => {
  it("renders nothing when session is null", () => {
    const { container } = render(
      <SessionBar session={null} onEnd={() => {}} onEndDay={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows the elapsed time and pluralized event count, collapsed by default", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-17T10:00:05Z"));
    const session = makeSession({
      started_at: "2026-07-17T10:00:00Z",
      events: [makeEvent(), makeEvent()],
    });
    render(
      <SessionBar session={session} onEnd={() => {}} onEndDay={() => {}} />,
    );

    expect(screen.getByText("0:05")).toBeTruthy();
    expect(screen.getByText("2 events")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Expand session timeline" }),
    ).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Session timeline" })).toBeNull();
  });

  it("uses singular 'event' for exactly one event and '0 events' for none", () => {
    const { rerender } = render(
      <SessionBar
        session={makeSession({ events: [makeEvent()] })}
        onEnd={() => {}}
        onEndDay={() => {}}
      />,
    );
    expect(screen.getByText("1 event")).toBeTruthy();

    rerender(
      <SessionBar
        session={makeSession({ events: [] })}
        onEnd={() => {}}
        onEndDay={() => {}}
      />,
    );
    expect(screen.getByText("0 events")).toBeTruthy();
  });

  it("shows an em dash for elapsed when started_at fails to parse", () => {
    const session = makeSession({ started_at: "garbage-timestamp" });
    render(
      <SessionBar session={session} onEnd={() => {}} onEndDay={() => {}} />,
    );
    expect(screen.getByText("—")).toBeTruthy();
  });

  it("toggles the timeline open/closed and flips aria-expanded + caret on click", () => {
    const session = makeSession({
      events: [makeEvent({ kind: "block_open" })],
    });
    render(
      <SessionBar session={session} onEnd={() => {}} onEndDay={() => {}} />,
    );

    const toggle = screen.getByRole("button", {
      name: "Expand session timeline",
    });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.textContent).toContain("▸");

    fireEvent.click(toggle);

    const collapsed = screen.getByRole("button", {
      name: "Collapse session timeline",
    });
    expect(collapsed.getAttribute("aria-expanded")).toBe("true");
    expect(collapsed.textContent).toContain("▾");
    expect(screen.getByRole("list", { name: "Session timeline" })).toBeTruthy();

    fireEvent.click(collapsed);
    expect(screen.queryByRole("list", { name: "Session timeline" })).toBeNull();
  });

  it("shows 'No events yet.' when expanded with zero events", () => {
    const session = makeSession({ events: [] });
    render(
      <SessionBar session={session} onEnd={() => {}} onEndDay={() => {}} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Expand session timeline" }),
    );
    expect(screen.getByText("No events yet.")).toBeTruthy();
  });

  it("renders each event's kind and joins recognized payload fields in fixed order", () => {
    const session = makeSession({
      events: [
        makeEvent({
          kind: "rep",
          // Keys deliberately out of the loop's declared order to prove the
          // summary is ordered by the fixed key list, not object insertion.
          payload: { note: "nice", verdict: "clean", bpm: 96 },
        }),
      ],
    });
    render(
      <SessionBar session={session} onEnd={() => {}} onEndDay={() => {}} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Expand session timeline" }),
    );

    expect(screen.getByText("rep")).toBeTruthy();
    expect(screen.getByText("clean · 96 · nice")).toBeTruthy();
  });

  it("includes a falsy-but-valid bpm of 0 in the summary instead of dropping it", () => {
    const session = makeSession({
      events: [makeEvent({ kind: "block_open", payload: { bpm: 0 } })],
    });
    render(
      <SessionBar session={session} onEnd={() => {}} onEndDay={() => {}} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Expand session timeline" }),
    );
    expect(screen.getByText("0")).toBeTruthy();
  });

  it("renders a plain string payload as-is", () => {
    const session = makeSession({
      events: [makeEvent({ kind: "note", payload: "manual note text" })],
    });
    render(
      <SessionBar session={session} onEnd={() => {}} onEndDay={() => {}} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Expand session timeline" }),
    );
    expect(screen.getByText("manual note text")).toBeTruthy();
  });

  it("renders an empty detail for null payload and for an object with no recognized keys", () => {
    const session = makeSession({
      events: [
        makeEvent({ kind: "unknown_a", payload: null }),
        makeEvent({ kind: "unknown_b", payload: { foo: "bar" } }),
      ],
    });
    const { container } = render(
      <SessionBar session={session} onEnd={() => {}} onEndDay={() => {}} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Expand session timeline" }),
    );

    const details = container.querySelectorAll(".session-event-detail");
    expect(details).toHaveLength(2);
    expect(details[0].textContent).toBe("");
    expect(details[1].textContent).toBe("");
  });

  it("calls onEnd when 'End session' is clicked", () => {
    const onEnd = vi.fn();
    render(
      <SessionBar session={makeSession()} onEnd={onEnd} onEndDay={() => {}} />,
    );
    fireEvent.click(screen.getByText("End session"));
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("shows an 'End my day' button beside 'End session'", () => {
    render(
      <SessionBar
        session={makeSession()}
        onEnd={() => {}}
        onEndDay={() => {}}
      />,
    );
    expect(screen.getByText("End my day")).toBeTruthy();
    expect(screen.getByText("End session")).toBeTruthy();
  });

  it("'End my day' asks for inline confirmation and calls only onEndDay when confirmed", () => {
    const onEnd = vi.fn();
    const onEndDay = vi.fn();
    render(
      <SessionBar session={makeSession()} onEnd={onEnd} onEndDay={onEndDay} />,
    );

    fireEvent.click(screen.getByText("End my day"));
    expect(screen.getByText("End your practice day?")).toBeTruthy();
    expect(onEnd).not.toHaveBeenCalled();
    expect(onEndDay).not.toHaveBeenCalled();

    // Declining leaves the session open and restores the plain button.
    fireEvent.click(screen.getByText("Keep going"));
    expect(onEnd).not.toHaveBeenCalled();
    expect(onEndDay).not.toHaveBeenCalled();
    expect(screen.getByText("End my day")).toBeTruthy();

    fireEvent.click(screen.getByText("End my day"));
    fireEvent.click(screen.getByText("End day"));
    expect(onEnd).not.toHaveBeenCalled();
    expect(onEndDay).toHaveBeenCalledTimes(1);
  });

  it("disables both end buttons and shows 'Ending…' on each while ending=true, and ignores clicks", () => {
    const onEnd = vi.fn();
    const onEndDay = vi.fn();
    const { container } = render(
      <SessionBar
        session={makeSession()}
        onEnd={onEnd}
        onEndDay={onEndDay}
        ending
      />,
    );
    const buttons = screen.getAllByRole("button", { name: "Ending…" });
    expect(buttons).toHaveLength(2);
    expect(container.querySelector(".session-end")).not.toBeNull();
    expect(container.querySelector(".session-end-day")).not.toBeNull();
    for (const button of buttons) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(button);
    }
    expect(onEnd).not.toHaveBeenCalled();
    expect(onEndDay).not.toHaveBeenCalled();
  });

  it("ticks the elapsed clock once a second while the session is live", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-17T10:00:00Z"));
    const session = makeSession({ started_at: "2026-07-17T10:00:00Z" });
    render(
      <SessionBar session={session} onEnd={() => {}} onEndDay={() => {}} />,
    );

    expect(screen.getByText("0:00")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText("0:01")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(59_000);
    });
    expect(screen.getByText("1:00")).toBeTruthy();
  });

  it("stops ticking after unmount (interval is cleared, no further updates)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-17T10:00:00Z"));
    const clearSpy = vi.spyOn(globalThis, "clearInterval");
    const session = makeSession({ started_at: "2026-07-17T10:00:00Z" });
    const { unmount } = render(
      <SessionBar session={session} onEnd={() => {}} onEndDay={() => {}} />,
    );

    unmount();

    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});
