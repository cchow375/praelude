import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HeardPill, QUIET_SPEECH_NOTE, truncateHeard } from "./HeardPill";

afterEach(cleanup);

let deliveryId = 0;
const final = (text: string, app_ms?: number) => ({
  text,
  is_final: true,
  delivery_id: `heard-${++deliveryId}`,
  revision: 0,
  ...(app_ms === undefined ? {} : { app_ms }),
});

describe("HeardPill persistent evidence", () => {
  it("teaches the empty state before a final is heard", () => {
    render(<HeardPill delivery={null} />);
    expect(screen.getByLabelText("Recently heard").textContent).toContain(
      "No final speech heard yet.",
    );
  });

  it("keeps an ignored ambient final visible instead of auto-fading", () => {
    render(
      <HeardPill
        delivery={final("i think the metronome off days are behind me")}
      />,
    );
    expect(screen.getByRole("log").textContent).toContain(
      "i think the metronome off days are behind me",
    );
  });

  it("retains exactly the latest three finals, including identical repeats", () => {
    const { rerender } = render(<HeardPill delivery={final("first")} />);
    rerender(<HeardPill delivery={final("done")} />);
    rerender(<HeardPill delivery={final("done")} />);
    rerender(<HeardPill delivery={final("fourth")} />);
    const rows = within(screen.getByRole("log")).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.textContent)).toEqual(["done", "done", "fourth"]);
  });

  it("ignores interim hypotheses", () => {
    render(
      <HeardPill
        delivery={{ text: "metro", is_final: false, delivery_id: "partial" }}
      />,
    );
    expect(screen.queryByRole("log")).toBeNull();
  });

  it("elides long speech and states the system recognition boundary", () => {
    const long = "a".repeat(200);
    expect(truncateHeard(long).length).toBeLessThanOrEqual(72);
    expect(truncateHeard(long)).toMatch(/…$/u);
    expect(truncateHeard("  metronome    off  ")).toBe("metronome off");
    expect(QUIET_SPEECH_NOTE).toContain("system speech engine");
    expect(QUIET_SPEECH_NOTE).toContain("can't hear better");
  });

  it("renders the honest app-side latency and never invents one", () => {
    const { rerender } = render(
      <HeardPill delivery={final("metronome off", 1234)} />,
    );
    expect(screen.getByRole("log").textContent).toContain("app 1.2s");
    expect(screen.getByTitle(/does not include how long/i)).toBeTruthy();
    rerender(<HeardPill delivery={final("mark done")} />);
    const rows = within(screen.getByRole("log")).getAllByRole("listitem");
    expect(rows[rows.length - 1].textContent).not.toContain("app 0.0s");
  });
});
