import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RepHud } from "./RepHud";
import type { RepSnapshot } from "./useRep";

/**
 * Defect D3 regression suite — "the active-set card is enormously oversized".
 *
 * A three-button decision plus a rep counter occupied ~700px, the numeral
 * rendered at ~72px (the loudest element on screen was a rep count), and
 * Resume/Undo/Close, a DETAILS disclosure, a full-width "Change the condition"
 * button and a verdict chip all stacked below at card-sized spacing.
 *
 * The contract this pins:
 *   - NOTHING WAS REMOVED. Every secondary control is still reachable; it moved
 *     behind ONE affordance instead of being deleted.
 *   - The three verdict buttons and the safety stop did NOT shrink and did NOT
 *     move behind that affordance — they are pressed mid-playing at arm's length.
 *   - The headline numeral is no longer the biggest thing on the card.
 */

const css = readFileSync(resolve("src/features/rep/RepHud.css"), "utf8");

function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, "m").exec(
    css,
  );
  expect(match, `RepHud.css defines a \`${selector}\` rule`).not.toBeNull();
  return match![2];
}

const snap: RepSnapshot = {
  block_id: 7,
  piece_id: 3,
  piece_title: "Scherzo No. 2",
  m_start: 65,
  m_end: 96,
  label: "Development",
  variant: "hands together",
  bpm: 84,
  target_bpm: 96,
  focus: "tempo",
  use_metronome: true,
  reps_done: 3,
  planned_reps: 30,
  current_clean_streak: 3,
  required_clean_streak: 5,
  best_clean_streak: 3,
  reset_count: 0,
  accuracy: 0.75,
  voided_attempts: 0,
  active_seconds: 372,
  timer_state: "running",
  set_state: "active",
  rule: { clean_needed: 3, bpm_step: 4 },
  last_attempt_id: 42,
  last: { verdict: "clean", bpm: 84, note: "steadier release" },
} as unknown as RepSnapshot;

const handlers = {
  onCheck: vi.fn().mockResolvedValue(undefined),
  onUndo: vi.fn().mockResolvedValue(undefined),
  onCorrect: vi.fn().mockResolvedValue(undefined),
  onReverseAdjustment: vi.fn().mockResolvedValue(undefined),
  onRestart: vi.fn().mockResolvedValue(undefined),
  onPause: vi.fn().mockResolvedValue(undefined),
  onResume: vi.fn().mockResolvedValue(undefined),
  onReflect: vi.fn().mockResolvedValue(undefined),
  onSafetyStop: vi.fn().mockResolvedValue(undefined),
  onRecover: vi.fn().mockResolvedValue(undefined),
  onClose: vi.fn(),
};

function renderHud() {
  return render(<RepHud snap={snap} feed={[]} error={null} {...handlers} />);
}

afterEach(cleanup);

describe("D3 — every feature survives the density pass", () => {
  it.each([
    "Undo",
    "Correct latest",
    "Restart set",
    "Reflect",
    "Reset clean proof",
    "Add 2 recovery cleans",
    "Back off tempo",
    "Take a 60-second break",
    "Change hands",
    "Change method",
    "Apply range",
  ])("still offers %s", (name) => {
    renderHud();
    expect(screen.getByRole("button", { name })).toBeTruthy();
  });

  it("still shows the focus contract and the full metrics list", () => {
    renderHud();
    for (const label of [
      "Intention",
      "Judge only",
      "Condition",
      "Tries",
      "Best streak",
      "Resets",
      "Accuracy",
      "Voided",
    ]) {
      expect(screen.getByText(label), `${label} is still shown`).toBeTruthy();
    }
    expect(screen.getByText("Change the condition")).toBeTruthy();
  });
});

describe("D3 — secondary controls sit behind exactly one affordance", () => {
  it("folds undo, details, metrics and the condition desk into one drawer", () => {
    const { container } = renderHud();
    const drawer = container.querySelector("details.rep-hud-drawer");
    expect(drawer, "the single secondary drawer exists").not.toBeNull();

    for (const name of ["Undo", "Correct latest", "Restart set", "Reflect"]) {
      expect(
        drawer!.contains(screen.getByRole("button", { name })),
        `${name} lives inside the drawer`,
      ).toBe(true);
    }
    expect(drawer!.contains(screen.getByText("Change the condition"))).toBe(
      true,
    );

    // ONE affordance: the condition desk is nested inside the drawer rather
    // than being a second top-level disclosure competing with it.
    const topLevelDetails = [...container.querySelectorAll("details")].filter(
      (d) => d.parentElement?.classList.contains("rep-hud"),
    );
    expect(topLevelDetails).toHaveLength(1);
    expect(topLevelDetails[0]).toBe(drawer);
  });

  it("keeps the verdicts and the safety stop OUT of the drawer", () => {
    const { container } = renderHud();
    const drawer = container.querySelector("details.rep-hud-drawer")!;
    for (const name of ["Clean", "Sloppy", "Again"]) {
      const button = screen.getByRole("button", { name });
      expect(drawer.contains(button), `${name} stays at top level`).toBe(false);
    }
    const safety = screen.getByRole("button", {
      name: "Pain, numbness, or weakness — stop",
    });
    expect(drawer.contains(safety)).toBe(false);
  });

  it("keeps pause/resume, collapse and close always reachable in the context row", () => {
    const { container } = renderHud();
    const context = container.querySelector(".rep-hud-context")!;
    expect(
      context.contains(screen.getByRole("button", { name: "Pause" })),
    ).toBe(true);
    expect(
      context.contains(
        screen.getByRole("button", { name: "Close practice set" }),
      ),
    ).toBe(true);
  });
});

describe("D3 — the strip is dense but the verdicts stay large", () => {
  it("keeps the three verdict buttons at a mid-playing tap size", () => {
    const actions = ruleBody(".rep-hud-actions .ck-btn");
    const minHeight = Number(/min-height:\s*(\d+)px/.exec(actions)?.[1]);
    expect(minHeight).toBeGreaterThanOrEqual(44);
    // Full width, three equal targets.
    expect(actions).toMatch(/flex:\s*1/);
  });

  it("no longer renders a rep count as the loudest element on the screen", () => {
    const numeral = Number(
      /font-size:\s*([\d.]+)rem/.exec(
        ruleBody(".rep-hud-streak-value strong"),
      )?.[1],
    );
    expect(numeral).toBeLessThan(2);

    const verdict = Number(
      /font-size:\s*([\d.]+)rem/.exec(
        ruleBody(".rep-hud-actions .ck-btn"),
      )?.[1],
    );
    // The numeral may still be bigger than a button label, but not by the
    // ~3x that made a rep counter the headline of the whole app.
    expect(numeral / verdict).toBeLessThan(2);
  });

  it("gives the quiet verdicts a visible control boundary (D7)", () => {
    const quiet = ruleBody(".rep-hud-actions .ck-btn-text");
    // --control-line is the 3.3:1 token; --hairline (1.3:1) is decorative only.
    expect(quiet).toMatch(/border:[^;]*var\(--control-line\)/);
    expect(quiet).toMatch(/color:\s*var\(--ink\)/);
  });

  it("gives every focusable element in the card a real focus ring", () => {
    for (const selector of [
      ".rep-hud-chip:focus-visible",
      ".rep-hud-actions .ck-btn:focus-visible",
      ".rep-hud-note:focus-visible",
      ".rep-safety-stop:focus-visible",
    ]) {
      expect(ruleBody(selector)).toMatch(/outline:[^;]*var\(--focus-ring\)/);
    }
  });
});
