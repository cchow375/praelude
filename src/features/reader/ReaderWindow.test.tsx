import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReaderWindow } from "./ReaderWindow";
import type { BookExcerpt } from "./excerpt";

const QUOTE = {
  sourceId: "roskell-complete-pianist",
  text: "Slow practice is fast learning.",
  author: "Penelope Roskell",
  book: "The Complete Pianist",
  heading: "Practising",
};

function headedExcerpt(): BookExcerpt {
  return {
    source_id: QUOTE.sourceId,
    title: QUOTE.book,
    author: QUOTE.author,
    heading: "Practising: healthy, effective and inspired",
    text: [
      "A rehearsal that only repeats what you can already do avoids the work.",
      "Slow practice is fast learning. Deliberate attention on the one thing.",
      "When it is reliable three times, let the tempo rise honestly.",
    ].join("\n\n"),
  };
}

/** A huge, heading-less body (the OCR whole-book case) with the quote mid-way. */
function hugeExcerpt(): BookExcerpt {
  const before = Array.from({ length: 20 }, (_, i) => `Before paragraph ${i}.`);
  const after = Array.from({ length: 20 }, (_, i) => `After paragraph ${i}.`);
  return {
    source_id: "gieseking-leimer-technique",
    title: "Piano Technique",
    author: "Walter Gieseking and Karl Leimer",
    heading: "",
    text: [...before, QUOTE.text, ...after].join("\n\n"),
  };
}

afterEach(cleanup);

describe("ReaderWindow", () => {
  it("renders the attribution header and anchors the quote paragraph", async () => {
    render(
      <ReaderWindow
        quote={QUOTE}
        onClose={vi.fn()}
        fetchExcerpt={() => Promise.resolve(headedExcerpt())}
      />,
    );

    const anchor = await screen.findByTestId("reader-quote-anchor");
    expect(anchor.textContent).toContain("Slow practice is fast learning.");
    // Header: author · title · heading.
    const attribution = screen.getByTestId("reader-attribution").textContent;
    expect(attribution).toContain("Penelope Roskell");
    expect(attribution).toContain("The Complete Pianist");
    expect(attribution).toContain(
      "Practising: healthy, effective and inspired",
    );
  });

  it("passes the verbatim quote as `contains`", async () => {
    const fetchExcerpt = vi.fn(() => Promise.resolve(headedExcerpt()));
    render(
      <ReaderWindow
        quote={QUOTE}
        onClose={vi.fn()}
        fetchExcerpt={fetchExcerpt}
      />,
    );
    await screen.findByTestId("reader-quote-anchor");
    expect(fetchExcerpt).toHaveBeenCalledWith({
      sourceId: "roskell-complete-pianist",
      contains: "Slow practice is fast learning.",
    });
  });

  it("windows a huge, heading-less body around the quote with Show more affordances", async () => {
    render(
      <ReaderWindow
        quote={{
          ...QUOTE,
          sourceId: "gieseking-leimer-technique",
          heading: "",
        }}
        onClose={vi.fn()}
        fetchExcerpt={() => Promise.resolve(hugeExcerpt())}
      />,
    );

    const anchor = await screen.findByTestId("reader-quote-anchor");
    expect(anchor.textContent).toContain("Slow practice is fast learning.");

    // Windowed: far paragraphs are hidden, and both Show more buttons appear.
    expect(screen.queryByText("Before paragraph 0.")).toBeNull();
    expect(screen.queryByText("After paragraph 19.")).toBeNull();
    const showAbove = screen.getByRole("button", { name: "Show more above" });
    const showBelow = screen.getByRole("button", { name: "Show more below" });
    // Only the ±4 flank is shown initially.
    expect(screen.getByText("Before paragraph 19.")).toBeTruthy(); // qIndex-1
    expect(screen.queryByText("Before paragraph 15.")).toBeNull();

    fireEvent.click(showAbove);
    expect(screen.getByText("Before paragraph 15.")).toBeTruthy();
    fireEvent.click(showBelow);
    expect(screen.getByText("After paragraph 9.")).toBeTruthy();
  });

  it("closes on the × control", async () => {
    const onClose = vi.fn();
    render(
      <ReaderWindow
        quote={QUOTE}
        onClose={onClose}
        fetchExcerpt={() => Promise.resolve(headedExcerpt())}
      />,
    );
    await screen.findByTestId("reader-quote-anchor");
    fireEvent.click(screen.getByRole("button", { name: "Close reader" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();
    render(
      <ReaderWindow
        quote={QUOTE}
        onClose={onClose}
        fetchExcerpt={() => Promise.resolve(headedExcerpt())}
      />,
    );
    const dialog = await screen.findByTestId("reader-window");
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("shows an honest error when the passage cannot be opened", async () => {
    render(
      <ReaderWindow
        quote={QUOTE}
        onClose={vi.fn()}
        fetchExcerpt={() =>
          Promise.reject("Could not find that passage in the book")
        }
      />,
    );
    expect(
      await screen.findByText("Could not find that passage in the book"),
    ).toBeTruthy();
  });
});
