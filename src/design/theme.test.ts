import { afterEach, describe, expect, it, vi } from "vitest";
import { THEME, applyTheme, getSystemTheme, resolveTheme, watchTheme } from "./theme";

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute("data-theme");
});

function systemAppearance(dark: boolean) {
  const query = {
    matches: dark,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal("matchMedia", vi.fn(() => query));
  return query;
}

describe("practice appearance", () => {
  it("defaults to dark and respects explicit modes", () => {
    expect(THEME).toBe("dark");
    expect(resolveTheme()).toBe("dark");
    expect(resolveTheme("light", "dark")).toBe("light");
    expect(resolveTheme("dark", "light")).toBe("dark");
    expect(resolveTheme("auto", "light")).toBe("light");
    expect(resolveTheme("auto", "dark")).toBe("dark");
  });

  it("reads the actual system appearance", () => {
    const query = systemAppearance(false);
    expect(getSystemTheme()).toBe("light");
    query.matches = true;
    expect(getSystemTheme()).toBe("dark");
  });

  it("applies both concrete modes to the root", () => {
    applyTheme("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    applyTheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("follows OS changes only in System mode and unsubscribes", () => {
    const query = systemAppearance(false);
    const stop = watchTheme("auto");
    expect(document.documentElement.dataset.theme).toBe("light");
    const listener = query.addEventListener.mock.calls[0][1] as () => void;
    query.matches = true;
    listener();
    expect(document.documentElement.dataset.theme).toBe("dark");
    stop();
    expect(query.removeEventListener).toHaveBeenCalledWith("change", listener);
    query.addEventListener.mockClear();
    watchTheme("light")();
    expect(query.addEventListener).not.toHaveBeenCalled();
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
