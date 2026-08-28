import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DockPanel } from "./DockPanel";
import { DockPillBar } from "./DockPillBar";
import { DockProvider } from "./DockProvider";
import { DOCK_STORAGE_KEY } from "./dockState";

const PANEL_DEFINITIONS = [
  { id: "rep", title: "Rep Counter" },
  { id: "paused", title: "Paused Sets" },
  { id: "clock", title: "Clock" },
  { id: "dynamics", title: "Dynamics" },
  { id: "rotation", title: "Practice rotation" },
] as const;

beforeEach(() => {
  const memory = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => memory.set(key, value),
      removeItem: (key: string) => memory.delete(key),
      clear: () => memory.clear(),
      key: (index: number) => [...memory.keys()][index] ?? null,
      get length() {
        return memory.size;
      },
    },
  });
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: 720,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: 520,
  });
});

afterEach(cleanup);

function renderCollapsedDock({ urgent = false } = {}) {
  const state = Object.fromEntries(
    PANEL_DEFINITIONS.map(({ id }) => [
      id,
      {
        x: 0,
        y: 0,
        minimized: true,
        open: true,
        z: 1,
        flashing: urgent && id === "dynamics",
      },
    ]),
  );
  window.localStorage.setItem(DOCK_STORAGE_KEY, JSON.stringify(state));

  return render(
    <DockProvider>
      <div style={{ width: 720 }}>
        <DockPillBar />
      </div>
      {PANEL_DEFINITIONS.map(({ id, title }) => (
        <DockPanel
          key={id}
          id={id}
          title={title}
          defaultPosition={{ x: 0, y: 0 }}
        >
          <div>{title} body</div>
        </DockPanel>
      ))}
    </DockProvider>,
  );
}

describe("DockPillBar — compact 720px practice toolbar", () => {
  it("keeps Paused Sets and Rep Counter direct while one Tools disclosure owns all three low-frequency restores", () => {
    renderCollapsedDock();

    const bar = screen.getByRole("toolbar", { name: "Practice tools" });
    expect(
      bar.contains(
        screen.getByRole("button", { name: "Restore Rep Counter" }),
      ),
    ).toBe(true);
    expect(
      bar.contains(screen.getByRole("button", { name: "Restore Paused Sets" })),
    ).toBe(true);

    const tools = screen.getByRole("button", { name: "Tools" });
    expect(tools.getAttribute("aria-haspopup")).toBe("menu");
    expect(tools.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.click(tools);
    expect(tools.getAttribute("aria-expanded")).toBe("true");
    const menu = screen.getByRole("menu", { name: "More practice tools" });
    expect(menu).toBeTruthy();
    expect(
      screen
        .getAllByRole("menuitem")
        .map((item) => item.textContent?.trim()),
    ).toEqual(["Clock", "Dynamics", "Practice rotation"]);

    // Choosing the grouped action delegates to DockProvider's original
    // open path. The hot-loop Rep Counter is still directly available with
    // one click; neither path gains an alternate state machine.
    fireEvent.click(screen.getByRole("menuitem", { name: "Clock" }));
    expect(screen.getByRole("dialog", { name: "Clock" })).toBeTruthy();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Restore Rep Counter" }),
    ).toBeTruthy();
  });

  it("supports arrow-key entry, menu navigation and Escape focus return", () => {
    renderCollapsedDock();
    const tools = screen.getByRole("button", { name: "Tools" });
    tools.focus();

    fireEvent.keyDown(tools, { key: "ArrowUp" });
    const rotation = screen.getByRole("menuitem", {
      name: "Practice rotation",
    });
    expect(document.activeElement).toBe(rotation);

    fireEvent.keyDown(rotation, { key: "ArrowUp" });
    expect(document.activeElement).toBe(
      screen.getByRole("menuitem", { name: "Dynamics" }),
    );

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(tools);
  });

  it("surfaces a grouped tool's urgent flash on both Tools and its menu row", () => {
    renderCollapsedDock({ urgent: true });
    const tools = screen.getByRole("button", { name: "Tools" });
    expect(tools.className).toContain("dock-pill-flash");

    fireEvent.click(tools);
    const dynamics = screen.getByRole("menuitem", { name: /Dynamics/ });
    expect(dynamics.className).toContain("dock-pill-tools-item--urgent");
    expect(dynamics.textContent).toContain("Attention");
  });
});

function ruleBody(styles: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "m").exec(styles);
  expect(match, `stylesheet defines ${selector}`).not.toBeNull();
  return match?.[1] ?? "";
}

describe("DockPillBar — one-line layout contract", () => {
  const css = readFileSync(resolve("src/features/dock/dock.css"), "utf8");

  it("cannot wrap or grow a second permanent row at the 720px floor", () => {
    const bar = ruleBody(css, ".dock-pill-bar");
    const pill = ruleBody(css, ".dock-pill");
    const menu = ruleBody(css, ".dock-pill-tools-menu");

    expect(bar).toMatch(/flex-wrap\s*:\s*nowrap/);
    expect(bar).toMatch(/white-space\s*:\s*nowrap/);
    expect(bar).toMatch(/padding\s*:\s*3px var\(--s-2\)/);
    expect(pill).toMatch(/min-height\s*:\s*28px/);
    expect(menu).toMatch(/position\s*:\s*absolute/);
    expect(menu).toMatch(/bottom\s*:\s*calc\(100% \+ var\(--s-1\)\)/);
    expect(menu).toMatch(/z-index\s*:\s*39/);
    expect(Number(/z-index\s*:\s*(\d+)/.exec(menu)?.[1])).toBeLessThan(40);
    expect(css).toMatch(
      /\[aria-label="Restore Clock"\][\s\S]*?\[aria-label="Restore Dynamics"\][\s\S]*?\[aria-label="Restore Practice rotation"\][\s\S]*?\)\s*\{\s*display:\s*none/,
    );
  });
});
