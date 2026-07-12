import { describe, expect, it } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";

function NumInput() {
  return <input type="number" aria-label="n" onChange={() => {}} />;
}

describe("scratch", () => {
  it("checks number input sanitization for non-numeric text", () => {
    render(<NumInput />);
    const input = screen.getByLabelText("n") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "abc" } });
    // eslint-disable-next-line no-console
    console.log("VALUE AFTER abc:", JSON.stringify(input.value));
  });
});
