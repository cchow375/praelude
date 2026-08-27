import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  UNIVERSE_BADGES,
  type BadgeTrack,
  type UniverseGameEvidence,
} from "./game";
import { UniverseGamePanel } from "./UniverseGamePanel";

afterEach(cleanup);

function evidence(
  overrides: Partial<UniverseGameEvidence> = {},
): UniverseGameEvidence {
  return {
    lifetimeFocusedSeconds: 0,
    lifetimeActiveDays: 0,
    bestStreakDays: 0,
    revisitedTargets: 0,
    masteredTargets: 0,
    recoveredTargets: 0,
    ...overrides,
  };
}

describe("UniverseGamePanel", () => {
  it("makes exact XP, the published earning rule, and next-level progress legible", () => {
    render(
      <UniverseGamePanel
        evidence={evidence({ lifetimeFocusedSeconds: 10 * 3_600 })}
      />,
    );

    expect(screen.getByRole("heading", { name: "Level 6" })).not.toBeNull();
    expect(screen.getByTestId("universe-game-xp").textContent).toContain(
      "600 XP",
    );
    expect(screen.getByText("in this practice record")).not.toBeNull();
    expect(screen.getByText("Current record milestones")).not.toBeNull();
    expect(screen.getByText(/1 XP/).closest("p")?.textContent).toBe(
      "1 XP = 1 completed focused minute. Quality and verdicts never add or remove XP.",
    );
    const progress = screen.getByRole("progressbar", {
      name: "Level 6 progress",
    });
    expect(progress.parentElement?.textContent).toContain(
      "150 / 180 XP in this level",
    );
    expect(progress.parentElement?.textContent).toContain("30 XP to Level 7");
    expect(progress.getAttribute("aria-valuemin")).toBe("450");
    expect(progress.getAttribute("aria-valuemax")).toBe("630");
    expect(progress.getAttribute("aria-valuenow")).toBe("600");
    expect(progress.getAttribute("aria-valuetext")).toBe(
      "150 of 180 XP in Level 6; 30 XP to Level 7",
    );
    expect(document.body.textContent).not.toMatch(
      /permanent|forever|never lose|all-time immutable/i,
    );
  });

  it("teaches the honest zero state without displaying an earned badge", () => {
    render(<UniverseGamePanel evidence={evidence()} />);

    expect(screen.getByRole("heading", { name: "Level 1" })).not.toBeNull();
    expect(screen.getByTestId("universe-game-xp").textContent).toContain(
      "0 XP",
    );
    expect(
      screen.getByText(
        "Complete one focused minute to put the first mark on this bar.",
      ),
    ).not.toBeNull();
    expect(screen.getByText("0 earned")).not.toBeNull();
    expect(screen.getByText("Your first badge is still ahead.")).not.toBeNull();
    expect(screen.queryByRole("list", { name: /earned badges/i })).toBeNull();

    const next = screen.getByRole("list", {
      name: "Next badge in each evidence track",
    });
    expect(within(next).getAllByRole("listitem")).toHaveLength(6);
    for (const bar of within(next).getAllByRole("progressbar")) {
      expect(bar.getAttribute("aria-valuenow")).toBe("0");
      expect(bar.getAttribute("aria-valuemin")).toBe("0");
    }
    expect(screen.getByText("First active day")).not.toBeNull();
    expect(screen.getByText("First focused hour")).not.toBeNull();
    expect(screen.getByText("First verified mastery")).not.toBeNull();
    expect(screen.getByText("First honest recovery")).not.toBeNull();
    expect(
      screen.getByText(
        "Earned from 1 distinct qualifying focused-practice day.",
      ),
    ).not.toBeNull();
  });

  it("keeps every earned badge in the cabinet and exposes its evidence definition", () => {
    render(
      <UniverseGamePanel
        evidence={evidence({
          lifetimeFocusedSeconds: 10 * 3_600,
          lifetimeActiveDays: 14,
          bestStreakDays: 7,
          revisitedTargets: 5,
          masteredTargets: 2,
          recoveredTargets: 1,
        })}
      />,
    );

    const cabinet = screen.getByRole("list", { name: "13 earned badges" });
    expect(within(cabinet).getAllByRole("listitem")).toHaveLength(13);
    expect(
      within(cabinet)
        .getByLabelText(
          /14 active days\. Earned from 14 distinct qualifying focused-practice days\./,
        )
        .getAttribute("data-track"),
    ).toBe("active_days");
    expect(
      within(cabinet)
        .getByLabelText(
          /First verified mastery\. Earned when 1 target satisfied a verified clean contract\./,
        )
        .getAttribute("data-track"),
    ).toBe("mastery");
    expect(
      within(cabinet)
        .getByLabelText(/First honest recovery\..*recorded recovery debt\./)
        .getAttribute("data-track"),
    ).toBe("recovery");
  });

  it("shows one exact, accessible next milestone per unfinished track", () => {
    render(
      <UniverseGamePanel
        evidence={evidence({
          lifetimeFocusedSeconds: 4 * 3_600 + 3_599,
          lifetimeActiveDays: 2,
          bestStreakDays: 6,
          revisitedTargets: 4,
          masteredTargets: 9,
          recoveredTargets: 2,
        })}
      />,
    );

    const next = screen.getByRole("list", {
      name: "Next badge in each evidence track",
    });
    const items = within(next).getAllByRole("listitem");
    expect(items).toHaveLength(6);
    expect(items.map((item) => item.getAttribute("data-track"))).toEqual([
      "active_days",
      "streak",
      "focused_hours",
      "revisits",
      "mastery",
      "recovery",
    ] satisfies BadgeTrack[]);

    const mastery = within(next).getByRole("progressbar", {
      name: "Verified mastery: 9 of 10 toward 10 verified masteries",
    });
    expect(mastery.getAttribute("aria-valuemin")).toBe("0");
    expect(mastery.getAttribute("aria-valuemax")).toBe("10");
    expect(mastery.getAttribute("aria-valuenow")).toBe("9");
    expect(mastery.getAttribute("aria-valuetext")).toBe(
      "9 of 10; 1 more verified mastery",
    );

    expect(screen.getByText("1 more active day")).not.toBeNull();
    expect(screen.getByText("1 more best-streak day")).not.toBeNull();
    expect(screen.getByText("1 more completed focused hour")).not.toBeNull();
    expect(screen.getByText("1 more revisited target")).not.toBeNull();
    expect(screen.getByText("1 more honest recovery")).not.toBeNull();
  });

  it("celebrates a completed published catalog without inventing another tier", () => {
    const maximum = (track: BadgeTrack) =>
      Math.max(
        ...UNIVERSE_BADGES.filter((badge) => badge.track === track).map(
          (badge) => badge.threshold,
        ),
      );

    render(
      <UniverseGamePanel
        evidence={evidence({
          lifetimeFocusedSeconds: maximum("focused_hours") * 3_600,
          lifetimeActiveDays: maximum("active_days"),
          bestStreakDays: maximum("streak"),
          revisitedTargets: maximum("revisits"),
          masteredTargets: maximum("mastery"),
          recoveredTargets: maximum("recovery"),
        })}
      />,
    );

    expect(
      screen.queryByRole("list", {
        name: "Next badge in each evidence track",
      }),
    ).toBeNull();
    expect(
      screen.getByText("Every published badge is in your cabinet."),
    ).not.toBeNull();
    expect(screen.getByText(`${UNIVERSE_BADGES.length} earned`)).not.toBeNull();
  });

  it("uses unique accessible heading relationships when more than one panel mounts", () => {
    render(
      <>
        <UniverseGamePanel evidence={evidence()} />
        <UniverseGamePanel evidence={evidence()} />
      </>,
    );

    const panels = screen.getAllByTestId("universe-game-panel");
    const labels = panels.map((panel) => panel.getAttribute("aria-labelledby"));
    expect(labels[0]).toBeTruthy();
    expect(labels[1]).toBeTruthy();
    expect(labels[0]).not.toBe(labels[1]);
    for (const panel of panels) {
      const labelId = panel.getAttribute("aria-labelledby") ?? "";
      expect(panel.querySelector(`[id="${labelId}"]`)?.textContent).toContain(
        "Level 1",
      );
    }
  });

  it("pins minimum-window and reduced-motion behavior in the stylesheet", () => {
    const css = readFileSync(
      resolve(process.cwd(), "src/features/universe/universeGamePanel.css"),
      "utf8",
    );

    expect(css).toContain("@media (max-width: 760px), (max-height: 560px)");
    expect(css).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("animation: none !important");
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});
