import { describe, expect, it } from "vitest";
import { resolveTheme } from "./theme";

describe("resolveTheme", () => {
  it("follows the system value when preference is 'auto'", () => {
    expect(resolveTheme("auto", "dark")).toBe("dark");
    expect(resolveTheme("auto", "light")).toBe("light");
  });

  it("honors an explicit preference regardless of system", () => {
    expect(resolveTheme("light", "dark")).toBe("light");
    expect(resolveTheme("dark", "light")).toBe("dark");
    expect(resolveTheme("dark", "dark")).toBe("dark");
    expect(resolveTheme("light", "light")).toBe("light");
  });
});
