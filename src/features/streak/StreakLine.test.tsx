import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StreakLine } from "./StreakLine";

afterEach(cleanup);

describe("StreakLine", () => {
  it("names the current run and the best on record", () => {
    render(
      <StreakLine
        summary={{
          current_days: 4,
          best_days: 11,
          threshold_minutes: 10,
          today_focused_seconds: 900,
        }}
      />,
    );
    expect(screen.getByTestId("streak-line").textContent).toContain(
      "4 day streak",
    );
    expect(screen.getByTestId("streak-line").textContent).toContain("best 11");
  });

  it("says nothing at all when nothing has been earned", () => {
    const { container } = render(
      <StreakLine
        summary={{
          current_days: 0,
          best_days: 0,
          threshold_minutes: 10,
          today_focused_seconds: 0,
        }}
      />,
    );
    // No evidence, no visual: not a zero, not a dimmed placeholder — nothing.
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing while the summary is still loading", () => {
    const { container } = render(<StreakLine summary={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the best run alone once the current one has lapsed", () => {
    render(
      <StreakLine
        summary={{
          current_days: 0,
          best_days: 11,
          threshold_minutes: 10,
          today_focused_seconds: 0,
        }}
      />,
    );
    const line = screen.getByTestId("streak-line").textContent ?? "";
    expect(line).toContain("best 11");
    expect(line).not.toContain("day streak");
  });

  it("states the bar the day has to clear, so the number is never a mystery", () => {
    render(
      <StreakLine
        summary={{
          current_days: 2,
          best_days: 2,
          threshold_minutes: 25,
          today_focused_seconds: 300,
        }}
      />,
    );
    expect(screen.getByTestId("streak-line").getAttribute("title")).toContain(
      "25 focused minutes",
    );
  });
});
