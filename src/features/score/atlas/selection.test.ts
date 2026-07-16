import { describe, expect, it } from "vitest";
import {
  createPersistentSelectionAnchor,
  dragToPersistentSelection,
  normalizePageLocalDrag,
  selectionAnchorToPdfAnchorMap,
  type PageLocalPointer,
} from "./selection";

const edition = { edition_id: "scores/urtext.pdf", edition_fingerprint: "sha256:edition-a" };

function pointer(
  x: number,
  y: number,
  width = 1000,
  height = 800,
  page = 1,
): PageLocalPointer {
  return { page, x, y, page_width: width, page_height: height };
}

describe("Score Atlas page-local selection", () => {
  it("normalizes reversed drags and clamps both endpoints to the page", () => {
    const result = normalizePageLocalDrag(
      pointer(900, 700, 1000, 800, 3),
      pointer(-20, 100, 1000, 800, 3),
    );

    expect(result).toEqual({
      ok: true,
      value: { page: 3, x: 0, y: 0.125, w: 0.9, h: 0.75 },
    });
  });

  it("persists the same normalized anchor at different viewer zoom levels", () => {
    const normal = dragToPersistentSelection(
      pointer(100, 200, 1000, 800),
      pointer(400, 480, 1000, 800),
      edition,
    );
    const zoomed = dragToPersistentSelection(
      pointer(250, 500, 2500, 2000),
      pointer(1000, 1200, 2500, 2000),
      edition,
    );

    expect(normal.ok).toBe(true);
    expect(zoomed.ok).toBe(true);
    if (normal.ok && zoomed.ok) {
      expect(zoomed.value).toEqual(normal.value);
      expect(normal.value.rects[0]).toEqual({
        page: 1,
        x: 0.1,
        y: 0.25,
        w: 0.3,
        h: 0.35,
      });
    }
  });

  it("rejects a cross-page drag instead of fabricating intermediate geometry", () => {
    const result = normalizePageLocalDrag(pointer(20, 20, 100, 100, 1), pointer(80, 80, 100, 100, 2));
    expect(result).toMatchObject({ ok: false, code: "cross_page_drag" });
  });

  it("rejects click-sized and invalid-area selections", () => {
    expect(normalizePageLocalDrag(pointer(10, 10), pointer(11, 11))).toMatchObject({
      ok: false,
      code: "selection_too_small",
    });
    expect(
      normalizePageLocalDrag(pointer(0, 0), pointer(200, 0.08), {
        min_normalized_span: 0,
      }),
    ).toMatchObject({ ok: false, code: "selection_too_small" });
  });

  it("requires an edition fingerprint and valid normalized persistent rectangles", () => {
    expect(
      createPersistentSelectionAnchor(
        { edition_id: "score.pdf", edition_fingerprint: "" },
        [{ page: 1, x: 0.1, y: 0.1, w: 0.2, h: 0.2 }],
      ),
    ).toMatchObject({ ok: false, code: "invalid_edition" });
    expect(
      createPersistentSelectionAnchor(edition, [
        { page: 1, x: 0.9, y: 0.1, w: 0.2, h: 0.2 },
      ]),
    ).toMatchObject({ ok: false, code: "invalid_rectangle" });
  });

  it("adapts the draft anchor to the existing edition-keyed PdfAnchorMap", () => {
    const selected = dragToPersistentSelection(
      pointer(100, 200),
      pointer(400, 480),
      edition,
    );
    expect(selected.ok).toBe(true);
    if (selected.ok) {
      expect(selectionAnchorToPdfAnchorMap(selected.value)).toEqual({
        v: 1,
        editions: {
          "scores/urtext.pdf": {
            fingerprint: "sha256:edition-a",
            rects: [{ page: 1, x: 0.1, y: 0.25, w: 0.3, h: 0.35 }],
          },
        },
      });
    }
  });
});
