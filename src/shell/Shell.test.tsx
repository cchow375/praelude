import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Shell } from "./Shell";

afterEach(cleanup);

describe("Shell", () => {
  it("renders exactly five workspace nav targets", () => {
    render(<Shell />);
    const nav = screen.getByRole("tablist", { name: /workspace/i });
    const tabs = within(nav).getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual([
      "Today",
      "Score",
      "Assistant",
      "History",
      "Universe",
    ]);
  });

  it("mounts the Today workspace by default", async () => {
    render(<Shell />);
    expect(await screen.findByTestId("workspace-today")).toBeTruthy();
    expect(
      screen.getByRole("tab", { name: "Today" }).getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("switches the mounted workspace when a nav target is chosen", async () => {
    render(<Shell />);
    await screen.findByTestId("workspace-today");
    fireEvent.click(screen.getByRole("tab", { name: "Universe" }));
    await waitFor(() =>
      expect(screen.getByTestId("workspace-universe")).toBeTruthy(),
    );
    expect(
      screen
        .getByRole("tab", { name: "Universe" })
        .getAttribute("aria-selected"),
    ).toBe("true");
  });
});
