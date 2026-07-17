import { afterEach, describe, it, expect, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { MapScoreWizard } from "./MapScoreWizard";
import type { CalibrationApi, CalibrationView } from "./calibrationApi";
import type { EditionIdentity } from "../model";

afterEach(cleanup);

const edition: EditionIdentity = {
  edition_id: "score/Ekier.pdf",
  edition_fingerprint: "fp-a",
};

function fakeApi(): CalibrationApi & {
  saved: { pieceId: number; anchors: unknown }[];
} {
  const saved: { pieceId: number; anchors: unknown }[] = [];
  return {
    saved,
    save: vi.fn(async ({ pieceId, anchors }) => {
      saved.push({ pieceId, anchors });
      const view: CalibrationView = {
        piece_id: pieceId,
        edition_id: edition.edition_id,
        edition_fingerprint: edition.edition_fingerprint,
        method: "user_confirmed",
        confidence: 0.75,
        points: [],
        user_verified: true,
        updated_ts: "2026-07-16T00:00:00Z",
      };
      return view;
    }),
    get: vi.fn(async () => null),
  };
}

function addAnchor(yPercent: number, measure: number) {
  fireEvent.change(screen.getByLabelText("Line position percent from top"), {
    target: { value: String(yPercent) },
  });
  fireEvent.change(
    screen.getByLabelText("Measure number at this system start"),
    {
      target: { value: String(measure) },
    },
  );
  fireEvent.click(screen.getByRole("button", { name: "Add line" }));
}

describe("MapScoreWizard", () => {
  it("collects two anchors on a page and saves them through the calibration API", async () => {
    const api = fakeApi();
    const onSaved = vi.fn();
    render(
      <MapScoreWizard
        pieceId={7}
        edition={edition}
        pageCount={3}
        api={api}
        onSaved={onSaved}
        onClose={() => {}}
      />,
    );

    addAnchor(20, 45);
    addAnchor(34, 52);

    // Save is enabled once at least one anchor exists.
    fireEvent.click(screen.getByRole("button", { name: "Save mapping" }));

    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1));
    expect(api.saved[0].pieceId).toBe(7);
    expect(api.saved[0].anchors).toEqual([
      { page: 1, yPct: 0.2, measure: 45 },
      { page: 1, yPct: 0.34, measure: 52 },
    ]);
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  });

  it("allows a partial map: a single anchor still saves", async () => {
    const api = fakeApi();
    render(
      <MapScoreWizard
        pieceId={1}
        edition={edition}
        pageCount={5}
        api={api}
        onClose={() => {}}
      />,
    );
    // Save is disabled before any anchor.
    expect(
      (
        screen.getByRole("button", {
          name: "Save mapping",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    addAnchor(50, 1);
    fireEvent.click(screen.getByRole("button", { name: "Save mapping" }));
    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1));
    expect(api.saved[0].anchors).toEqual([{ page: 1, yPct: 0.5, measure: 1 }]);
  });

  it("collects anchors across pages via next/skip", async () => {
    const api = fakeApi();
    render(
      <MapScoreWizard
        pieceId={2}
        edition={edition}
        pageCount={2}
        api={api}
        onClose={() => {}}
      />,
    );
    addAnchor(25, 1);
    fireEvent.click(screen.getByRole("button", { name: "Skip / next page ›" }));
    addAnchor(25, 9);
    fireEvent.click(screen.getByRole("button", { name: "Save mapping" }));
    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1));
    expect(api.saved[0].anchors).toEqual([
      { page: 1, yPct: 0.25, measure: 1 },
      { page: 2, yPct: 0.25, measure: 9 },
    ]);
  });

  // --- Measure-number prefill (finding 2) ---

  it("pre-fills the exact measure from existing anchors and tags it 'from anchors'", async () => {
    const api = fakeApi();
    render(
      <MapScoreWizard
        pieceId={7}
        edition={edition}
        pageCount={2}
        api={api}
        initialAnchors={[
          { page: 1, yPct: 0.2, measure: 1 },
          { page: 1, yPct: 0.34, measure: 5 },
        ]}
        onClose={() => {}}
      />,
    );
    // Clicking (here via the line-position field) a system the anchors know
    // pre-fills its measure without any typing.
    fireEvent.change(screen.getByLabelText("Line position percent from top"), {
      target: { value: "34" },
    });
    const measure = screen.getByLabelText(
      "Measure number at this system start",
    ) as HTMLInputElement;
    expect(measure.value).toBe("5");
    expect(screen.getByText("from anchors")).toBeTruthy();

    // Typing over a suggestion clears the provenance tag (it becomes a correction).
    fireEvent.change(measure, { target: { value: "6" } });
    expect(screen.queryByText("from anchors")).toBeNull();
  });

  it("pre-fills from the PDF text layer when no anchor matches, tagged 'from score'", async () => {
    const api = fakeApi();
    render(
      <MapScoreWizard
        pieceId={7}
        edition={edition}
        pageCount={2}
        api={api}
        pageTextItems={async () => [{ text: "12", xPct: 0.05, yPct: 0.6 }]}
        onClose={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText("Line position percent from top"), {
      target: { value: "60" },
    });
    await waitFor(() =>
      expect(
        (
          screen.getByLabelText(
            "Measure number at this system start",
          ) as HTMLInputElement
        ).value,
      ).toBe("12"),
    );
    expect(screen.getByText("from score")).toBeTruthy();
  });

  it("predicts the next measure from the run so far, tagged 'estimated'", async () => {
    const api = fakeApi();
    render(
      <MapScoreWizard
        pieceId={7}
        edition={edition}
        pageCount={2}
        api={api}
        onClose={() => {}}
      />,
    );
    // Two anchors this run establish a 4-bar-per-system median.
    addAnchor(20, 1);
    addAnchor(34, 5);
    // A third click prefills 5 + 4 = 9 as an estimate.
    fireEvent.change(screen.getByLabelText("Line position percent from top"), {
      target: { value: "48" },
    });
    const measure = screen.getByLabelText(
      "Measure number at this system start",
    ) as HTMLInputElement;
    expect(measure.value).toBe("9");
    expect(screen.getByText("estimated")).toBeTruthy();
  });
});
