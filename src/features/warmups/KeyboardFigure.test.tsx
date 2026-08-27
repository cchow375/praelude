import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { KeyboardFigure } from "./KeyboardFigure";

afterEach(cleanup);

describe("KeyboardFigure", () => {
  it("renders an accessible one-octave SVG with honest key geometry", () => {
    const { container } = render(
      <KeyboardFigure
        label="C diminished seventh"
        spec={{ pitchClasses: [0, 3, 6, 9], motion: "four starts" }}
      />,
    );

    const svg = screen.getByRole("img", {
      name: /C diminished seventh pitch-class keyboard/i,
    });
    expect(svg.tagName.toLowerCase()).toBe("svg");
    expect(svg.getAttribute("viewBox")).toBe("0 0 98 48");
    expect(
      container.querySelectorAll('rect[data-key-color="white"]'),
    ).toHaveLength(7);
    expect(
      container.querySelectorAll('rect[data-key-color="black"]'),
    ).toHaveLength(5);
    expect(container.querySelectorAll('rect[data-active="true"]')).toHaveLength(
      4,
    );
    expect(
      [...container.querySelectorAll('rect[data-active="true"]')].map((key) =>
        key.getAttribute("data-pitch-class"),
      ),
    ).toEqual(["0", "9", "3", "6"]);
    expect(screen.getByText("four starts")).toBeTruthy();
  });

  it("normalizes out-of-octave pitch classes without inventing extra keys", () => {
    const { container } = render(
      <KeyboardFigure label="Octaves" spec={{ pitchClasses: [-12, 0, 12] }} />,
    );

    expect(container.querySelectorAll('rect[data-active="true"]')).toHaveLength(
      1,
    );
    expect(
      container
        .querySelector('rect[data-pitch-class="0"]')
        ?.getAttribute("data-active"),
    ).toBe("true");
  });
});
