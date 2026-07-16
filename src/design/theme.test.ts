import { describe, expect, it } from "vitest";
import { applyTheme, getSystemTheme, resolveTheme, watchTheme } from "./theme";

describe("theme (dark-only)", () => {
  it("always resolves to dark regardless of preference or system", () => {
    expect(resolveTheme("auto", "dark")).toBe("dark");
    expect(resolveTheme("light", "dark")).toBe("dark");
    expect(resolveTheme("dark", "dark")).toBe("dark");
    expect(resolveTheme()).toBe("dark");
  });

  it("reports dark as the system theme", () => {
    expect(getSystemTheme()).toBe("dark");
  });

  it("pins <html data-theme> to dark", () => {
    document.documentElement.removeAttribute("data-theme");
    applyTheme();
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

    document.documentElement.removeAttribute("data-theme");
    const stop = watchTheme("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    stop();
  });
});
