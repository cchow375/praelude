import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Button } from "./Button";

afterEach(cleanup);

describe("Button", () => {
  it("has no outlined variant and never renders a border style", () => {
    // @ts-expect-error outlined is intentionally not a valid variant
    const bad = <Button variant="outlined" />;
    expect(bad).toBeDefined(); // compile-time guard is the real assertion
    const { getByRole } = render(<Button variant="primary">Go</Button>);
    const cs = getComputedStyle(getByRole("button"));
    expect(cs.borderStyle === "none" || cs.borderWidth === "0px").toBe(true);
  });

  it("renders both supported variants and defaults type to button", () => {
    const { getByRole } = render(
      <>
        <Button variant="primary">Primary</Button>
        <Button variant="text">Text</Button>
      </>,
    );
    expect(getByRole("button", { name: "Primary" }).className).toContain(
      "ck-btn-primary",
    );
    const text = getByRole("button", { name: "Text" });
    expect(text.className).toContain("ck-btn-text");
    expect(text.getAttribute("type")).toBe("button");
  });
});
