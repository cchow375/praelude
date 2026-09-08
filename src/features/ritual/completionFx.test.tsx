import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { detectMoment, useCompletionFx } from "./completionFx";
import type { RepSnapshot } from "../rep/useRep";

// `import.meta.url` does not resolve to a real file:// URL under this repo's
// vitest transform, so these source-inspection assertions read the files by
// a cwd-relative path instead (vitest always runs with the repo root as cwd).
const HERE = join(process.cwd(), "src", "features", "ritual");

const BASE = {
  block_id: 1,
  set_state: "active",
  mastery_status: "not_satisfied",
} as unknown as RepSnapshot;

function snap(over: Partial<RepSnapshot>): RepSnapshot {
  return { ...BASE, ...over } as RepSnapshot;
}

afterEach(cleanup);

describe("detectMoment", () => {
  it("keeps an unfinished set exit visually distinct from an earned completion", () => {
    expect(detectMoment(snap({}), snap({ set_state: "paused" }))).toBe(
      "set_exit",
    );
    expect(detectMoment(snap({}), null)).toBe("set_exit");
  });

  it("fires mastery_landing, not set_complete, when mastery lands", () => {
    expect(
      detectMoment(
        snap({}),
        snap({ set_state: "mastered", mastery_status: "satisfied" }),
      ),
    ).toBe("mastery_landing");
    expect(detectMoment(snap({}), snap({ mastery_status: "satisfied" }))).toBe(
      "mastery_landing",
    );
  });

  it("fires ordinary set_complete when a total-play volume target lands", () => {
    expect(
      detectMoment(
        snap({ mastery_basis: "total_attempts" }),
        snap({
          set_state: "mastered",
          mastery_basis: "total_attempts",
          mastery_status: "satisfied",
        }),
      ),
    ).toBe("set_complete");
  });

  it("marks only a forward intermediate variant-stage transition", () => {
    expect(
      detectMoment(
        snap({ variant_stage_index: 0, variant_chain_complete: false }),
        snap({ variant_stage_index: 1, variant_chain_complete: false }),
      ),
    ).toBe("variant_stage");
    expect(
      detectMoment(
        snap({ variant_stage_index: 1, variant_chain_complete: false }),
        snap({ variant_stage_index: 0, variant_chain_complete: false }),
      ),
    ).toBeNull();
    expect(
      detectMoment(
        snap({ variant_stage_index: 1, variant_chain_complete: false }),
        snap({ variant_stage_index: 1, variant_chain_complete: true }),
      ),
    ).toBeNull();
  });

  it("fires nothing without a transition — no evidence, no visual", () => {
    expect(detectMoment(null, null)).toBeNull();
    expect(detectMoment(snap({}), snap({}))).toBeNull();
    expect(detectMoment(null, snap({}))).toBeNull(); // opening a set is not completing one
    // A different block replacing the current one is a switch, not a landing.
    expect(detectMoment(snap({}), snap({ block_id: 2 }))).toBeNull();
    // Already-satisfied stays satisfied: it does not re-fire on every tick.
    expect(
      detectMoment(
        snap({ mastery_status: "satisfied" }),
        snap({ mastery_status: "satisfied" }),
      ),
    ).toBeNull();
  });

  it("F2: mastered-but-not-satisfied fires nothing — set_state must never contradict mastery_status (earned-only)", () => {
    // A real, intentional backend state: a mastered set keeps its terminal
    // set_state even when a repaired ledger ceases to satisfy mastery
    // (store/practice_v2.rs:1329-1332). A visual may never fire off
    // set_state alone while mastery_status disagrees.
    const mastered = snap({
      set_state: "mastered",
      mastery_status: "not_satisfied",
    });
    expect(detectMoment(mastered, mastered)).toBeNull();
    expect(
      detectMoment(
        mastered,
        snap({ set_state: "mastered", mastery_status: "not_satisfied" }),
      ),
    ).toBeNull();
  });

  it("F2: an identical repeated snapshot fires nothing", () => {
    const identical = snap({
      set_state: "mastered",
      mastery_status: "not_satisfied",
    });
    expect(detectMoment(identical, { ...identical })).toBeNull();
  });

  it("F2: ten identical polls fire zero times (regression for the every-refetch celebration bug)", () => {
    let previous: RepSnapshot | null = null;
    let fired = 0;
    for (let i = 0; i < 10; i++) {
      const next = snap({
        set_state: "mastered",
        mastery_status: "not_satisfied",
      });
      if (detectMoment(previous, next)) fired++;
      previous = next;
    }
    expect(fired).toBe(0);
  });
});

describe("useCompletionFx", () => {
  function Host() {
    const { fire, overlay } = useCompletionFx();
    return (
      <div>
        <button type="button" onClick={() => fire("day_close")}>
          go
        </button>
        {overlay}
      </div>
    );
  }

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shows a non-blocking overlay and removes it inside 1.5s", () => {
    render(<Host />);
    act(() => screen.getByRole("button", { name: "go" }).click());
    const overlay = screen.getByTestId("completion-fx");
    expect(overlay.getAttribute("data-moment")).toBe("day_close");
    expect(overlay.getAttribute("aria-hidden")).toBe("true");
    act(() => void vi.advanceTimersByTime(1_500));
    expect(screen.queryByTestId("completion-fx")).toBeNull();
  });

  it("never blocks input", () => {
    render(<Host />);
    act(() => screen.getByRole("button", { name: "go" }).click());
    const overlay = screen.getByTestId("completion-fx");
    expect(overlay.className).toContain("completion-fx");
    // The rule is expressed in CSS, so assert it there rather than trusting a
    // computed style jsdom does not fully implement.
    const css = readFileSync(join(HERE, "completionFx.css"), "utf8");
    expect(css).toMatch(/\.completion-fx\s*\{[^}]*pointer-events:\s*none/);
  });

  it("is deterministic — no randomness anywhere in the module", () => {
    const source = readFileSync(join(HERE, "completionFx.tsx"), "utf8");
    expect(source).not.toContain("Math.random");
    expect(source).not.toContain("requestAnimationFrame");
  });

  it("opens no audio path of its own", () => {
    const source = readFileSync(join(HERE, "completionFx.tsx"), "utf8");
    expect(source).not.toContain("new Audio");
    expect(source).not.toContain("AudioContext");
  });

  it("collapses to a single static fade under reduced motion, CSS-only", () => {
    const css = readFileSync(join(HERE, "completionFx.css"), "utf8");
    expect(css).toMatch(/@keyframes completion-bloom/);
    const reduced = css.slice(
      css.indexOf("@media (prefers-reduced-motion: reduce)"),
    );
    expect(reduced).toContain("completion-fade");
    expect(css).not.toContain("matchMedia");
  });

  it("gives chains a distinct finale only on authoritative satisfaction", () => {
    const before = snap({
      variant_stage_index: 1,
      variant_chain_complete: false,
    });
    const complete = snap({
      variant_stage_index: 1,
      variant_chain_complete: true,
      mastery_status: "satisfied",
    });
    expect(detectMoment(before, complete)).toBe("chain_complete");
    expect(detectMoment(complete, { ...complete })).toBeNull();
    expect(detectMoment(null, complete)).toBeNull();
  });
});

describe("earned milestone provenance", () => {
  it("does not replay fanfares for correction, undo/redo, remount or polls", async () => {
    const { renderHook } = await import("@testing-library/react");
    const { useRepCompletion } = await import("./completionFx");
    const fire = vi.fn();
    const before = snap({ last_attempt_id: 4 });
    const done = snap({ last_attempt_id: 5, mastery_status: "satisfied" });
    const { rerender, unmount } = renderHook(
      ({ value }) => useRepCompletion(value, fire),
      { initialProps: { value: before } },
    );
    rerender({ value: done });
    expect(fire).toHaveBeenCalledTimes(1);
    rerender({ value: { ...done } });
    rerender({ value: before });
    rerender({ value: done });
    rerender({
      value: { ...before, last_attempt_id: 5, last_adjustment_id: 7 },
    });
    rerender({ value: { ...done, last_adjustment_id: 8 } });
    expect(fire).toHaveBeenCalledTimes(1);
    unmount();
    renderHook(() => useRepCompletion(done, fire));
    expect(fire).toHaveBeenCalledTimes(1);
  });
});
