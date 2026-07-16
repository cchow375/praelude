import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Panel } from "./Panel";

afterEach(cleanup);

describe("Panel", () => {
  it("renders no header when both title and actions are omitted", () => {
    const { container } = render(<Panel>body content</Panel>);
    expect(container.querySelector(".ck-panel-head")).toBeNull();
    expect(container.querySelector(".ck-panel-body")).toBeTruthy();
  });

  it("renders the title and actions in the header when provided", () => {
    const { getByText, container } = render(
      <Panel title="Session" actions={<button type="button">Edit</button>}>
        body
      </Panel>,
    );
    expect(container.querySelector(".ck-panel-head")).toBeTruthy();
    expect(getByText("Session").tagName).toBe("H2");
    expect(getByText("Edit")).toBeTruthy();
  });

  it("merges a custom className onto the root section", () => {
    const { container } = render(<Panel className="extra-class">body</Panel>);
    const section = container.querySelector("section");
    expect(section!.className).toContain("ck-panel");
    expect(section!.className).toContain("extra-class");
  });
});
