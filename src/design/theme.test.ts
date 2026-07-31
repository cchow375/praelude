import { describe, expect, it } from "vitest";
import {
  THEME,
  applyTheme,
  getSystemTheme,
  resolveTheme,
  watchTheme,
} from "./theme";

describe("theme (paper-only)", () => {
  it("always resolves to paper regardless of preference or system", () => {
    expect(resolveTheme("auto", "paper")).toBe("paper");
    expect(resolveTheme("light", "paper")).toBe("paper");
    expect(resolveTheme("dark", "paper")).toBe("paper");
    expect(resolveTheme()).toBe("paper");
    expect(THEME).toBe("paper");
  });

  it("reports paper as the system theme", () => {
    expect(getSystemTheme()).toBe("paper");
  });

  it("pins <html data-theme> to paper", () => {
    document.documentElement.removeAttribute("data-theme");
    applyTheme();
    expect(document.documentElement.getAttribute("data-theme")).toBe("paper");

    document.documentElement.removeAttribute("data-theme");
    const stop = watchTheme("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("paper");
    stop();
  });

  it("ignores a persisted dark/light preference passed by a legacy caller", () => {
    document.documentElement.removeAttribute("data-theme");
    applyTheme("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("paper");
  });
});
