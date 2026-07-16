import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Disclosure } from "./Disclosure";

afterEach(cleanup);

describe("Disclosure", () => {
  it("renders the summary and hides secondary content until opened", () => {
    const { getByText, container } = render(
      <Disclosure summary="Advanced">
        <p>secondary body</p>
      </Disclosure>,
    );
    const details = container.querySelector("details");
    expect(details).toBeTruthy();
    expect(details!.open).toBe(false);
    // The summary is the density primitive; the body still exists in the DOM.
    expect(getByText("Advanced")).toBeTruthy();
    expect(getByText("secondary body")).toBeTruthy();
  });

  it("honors defaultOpen and toggles on summary click", () => {
    const { getByText, container } = render(
      <Disclosure summary="Details" defaultOpen>
        <p>inner</p>
      </Disclosure>,
    );
    const details = container.querySelector("details") as HTMLDetailsElement;
    expect(details.open).toBe(true);
    fireEvent.click(getByText("Details"));
    // jsdom toggles the open attribute on summary click.
    expect(details.open).toBe(false);
  });
});
