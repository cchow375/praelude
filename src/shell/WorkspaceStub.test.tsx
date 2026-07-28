import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceStub } from "./WorkspaceStub";

afterEach(cleanup);

describe("WorkspaceStub", () => {
  it("renders the workspace name as the heading and the fixed placeholder note", () => {
    render(<WorkspaceStub id="score" name="Score" />);
    const heading = screen.getByRole("heading", { level: 1, name: "Score" });
    expect(heading).toBeTruthy();
    expect(heading.className).toBe("workspace-stub-title");
    expect(
      screen.getByText("This workspace arrives in a later phase."),
    ).toBeTruthy();
  });

  it("exposes a labelled landmark keyed by id and name for the shell to target", () => {
    render(<WorkspaceStub id="settings" name="Settings" />);
    const region = screen.getByTestId("workspace-settings");
    expect(region.tagName).toBe("SECTION");
    expect(region.getAttribute("aria-label")).toBe("Settings workspace");
    expect(region.className).toBe("workspace-stub");
  });

  it("renders an empty test id and a leading-space aria-label when id/name are empty strings", () => {
    render(<WorkspaceStub id="" name="" />);
    const region = screen.getByTestId("workspace-");
    expect(region.getAttribute("aria-label")).toBe(" workspace");
    expect(region.querySelector(".workspace-stub-title")?.textContent).toBe("");
  });

  it("renders markup-like name text as literal text, never as HTML", () => {
    render(<WorkspaceStub id="brain" name={'<b>Brain</b> & "friends"'} />);
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.textContent).toBe('<b>Brain</b> & "friends"');
    expect(heading.querySelector("b")).toBeNull();
  });

  it("re-renders with the new id/name when props change on the same element", () => {
    const { rerender } = render(<WorkspaceStub id="ledger" name="Ledger" />);
    expect(screen.getByTestId("workspace-ledger")).toBeTruthy();
    rerender(<WorkspaceStub id="universe" name="Universe" />);
    expect(screen.queryByTestId("workspace-ledger")).toBeNull();
    expect(screen.getByTestId("workspace-universe")).toBeTruthy();
    expect(
      screen.getByRole("heading", { level: 1, name: "Universe" }),
    ).toBeTruthy();
  });

  it("does not de-duplicate ids: two stubs sharing an id both mount, breaking single-element lookup", () => {
    render(
      <>
        <WorkspaceStub id="score" name="Score" />
        <WorkspaceStub id="score" name="Score (duplicate)" />
      </>,
    );
    // The component performs no uniqueness check on `id`, so callers (Shell)
    // are solely responsible for passing distinct ids per mounted stub.
    expect(() => screen.getByTestId("workspace-score")).toThrow();
    expect(screen.getAllByTestId("workspace-score")).toHaveLength(2);
  });
});
