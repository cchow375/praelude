import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Receipt } from "./Receipt";

afterEach(cleanup);

describe("Receipt", () => {
  it("renders success status with role=status and matching data attribute", () => {
    const { getByRole } = render(<Receipt status="success" message="Saved" />);
    const receipt = getByRole("status");
    expect(receipt.getAttribute("data-status")).toBe("success");
    expect(receipt.className).toContain("ck-receipt-success");
  });

  it("renders error status with role=alert so it is announced assertively", () => {
    const { getByRole } = render(
      <Receipt status="error" message="Write failed" />,
    );
    const receipt = getByRole("alert");
    expect(receipt.getAttribute("data-status")).toBe("error");
    expect(receipt.className).toContain("ck-receipt-error");
  });

  it("renders the message content and hides the decorative dot from a11y tree", () => {
    const { getByText, container } = render(
      <Receipt status="success" message="Tempo raised to 96" />,
    );
    expect(getByText("Tempo raised to 96")).toBeTruthy();
    const dot = container.querySelector(".ck-receipt-dot");
    expect(dot!.getAttribute("aria-hidden")).toBe("true");
  });
});
