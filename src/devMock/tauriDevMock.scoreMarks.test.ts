import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installTauriDevMock, uninstallTauriDevMock } from "./tauriDevMock";

// score_marks_page / score_mark_add / score_mark_undo / score_marks_clear_page
// (pencil marks on the score page) have ZERO coverage anywhere in src/ — no
// existing UI test drives the mark toolbar through the real seam. This is the
// single biggest untested stateful-CRUD cluster in the mock: score_mark_add's
// "needs at least 2 points" guard, score_mark_undo's LIFO pop, and
// score_marks_page's per-edition-fingerprint "stale marks" count (strokes
// left behind under an older fingerprint for the same piece+edition).
//
// Two behaviors worth calling out before reading the assertions below:
// 1. Unlike region_create's validation failure, score_mark_add's guard is a
//    raw `throw new Error(...)` that is NOT funneled through the mock's
//    `asRejectionString` helper. It rejects with the Error OBJECT itself
//    (not a plain string), so assertions below use `.rejects.toThrow(...)`
//    rather than `.rejects.toBe(...)` (contrast with book_add's plain-string
//    rejections).
// 2. The `SCORE_MARKS` map and its `nextMarkId` counter are module-level and
//    are NEVER reset by installTauriDevMock()/uninstallTauriDevMock() (unlike
//    REGIONS, CLIENT_RASTER_SERVED, etc., which the install path explicitly
//    reseeds). That's a real fidelity gap vs. a per-session-scoped native
//    store. To keep this file order-independent despite that leakage, every
//    test uses its own unique piece/edition/fingerprint key rather than
//    asserting on absolute starting ids or a globally-empty map.

function seamInvoke<T>(cmd: string, args?: unknown): Promise<T> {
  const internals = (
    window as unknown as {
      __TAURI_INTERNALS__: { invoke: (c: string, a?: unknown) => Promise<T> };
    }
  ).__TAURI_INTERNALS__;
  return internals.invoke(cmd, args);
}

interface MockMark {
  id: number;
  page: number;
  width: number;
  points: Array<{ x: number; y: number }>;
}

interface ScoreMarksPage {
  marks: MockMark[];
  stale_marks: number;
}

// Each `it` gets its own edition id so SCORE_MARKS keys never collide across
// tests despite the map never being reset between them.
let keySeq = 0;
function uniqueKey() {
  keySeq += 1;
  return {
    pieceId: 1,
    editionId: `score-marks-test-edition-${keySeq}`,
    editionFingerprint: `fp-${keySeq}`,
  };
}

describe("dev-mock score_mark_add validation", () => {
  beforeEach(() => installTauriDevMock());
  afterEach(() => uninstallTauriDevMock());

  it("rejects a mark with fewer than 2 points", async () => {
    const key = uniqueKey();
    await expect(
      seamInvoke("score_mark_add", {
        ...key,
        page: 1,
        pointsJson: JSON.stringify([{ x: 0.1, y: 0.1 }]),
      }),
    ).rejects.toThrow("a score mark needs at least 2 points");
  });

  it("rejects a mark with no pointsJson at all (defaults to an empty array)", async () => {
    const key = uniqueKey();
    await expect(
      seamInvoke("score_mark_add", { ...key, page: 1 }),
    ).rejects.toThrow("a score mark needs at least 2 points");
  });

  it("adds a mark with ascending ids and default page/width, visible via score_marks_page", async () => {
    const key = uniqueKey();
    const points = [
      { x: 0.1, y: 0.2 },
      { x: 0.3, y: 0.4 },
    ];
    const first = await seamInvoke<MockMark>("score_mark_add", {
      ...key,
      page: 2,
      pointsJson: JSON.stringify(points),
    });
    expect(first.page).toBe(2);
    expect(first.width).toBeCloseTo(0.0022);
    expect(first.points).toEqual(points);

    const second = await seamInvoke<MockMark>("score_mark_add", {
      ...key,
      page: 2,
      width: 0.01,
      pointsJson: JSON.stringify(points),
    });
    expect(second.id).toBe(first.id + 1);
    expect(second.width).toBe(0.01);

    const page = await seamInvoke<ScoreMarksPage>("score_marks_page", {
      ...key,
      page: 2,
    });
    expect(page.marks.map((m) => m.id)).toEqual([first.id, second.id]);
  });
});

describe("dev-mock score_marks_page isolation + stale_marks", () => {
  beforeEach(() => installTauriDevMock());
  afterEach(() => uninstallTauriDevMock());

  it("keeps marks scoped to their own page", async () => {
    const key = uniqueKey();
    const points = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ];
    await seamInvoke("score_mark_add", {
      ...key,
      page: 1,
      pointsJson: JSON.stringify(points),
    });

    const page1 = await seamInvoke<ScoreMarksPage>("score_marks_page", {
      ...key,
      page: 1,
    });
    const page2 = await seamInvoke<ScoreMarksPage>("score_marks_page", {
      ...key,
      page: 2,
    });
    expect(page1.marks).toHaveLength(1);
    expect(page2.marks).toHaveLength(0);
  });

  it("counts strokes under a DIFFERENT fingerprint (same piece+edition) as stale, not the current fingerprint or other editions", async () => {
    const pieceId = 1;
    const editionId = `score-marks-stale-edition-${(keySeq += 1)}`;
    const points = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ];

    // Two marks under an OLD fingerprint.
    await seamInvoke("score_mark_add", {
      pieceId,
      editionId,
      editionFingerprint: "fp-old",
      page: 1,
      pointsJson: JSON.stringify(points),
    });
    await seamInvoke("score_mark_add", {
      pieceId,
      editionId,
      editionFingerprint: "fp-old",
      page: 5,
      pointsJson: JSON.stringify(points),
    });
    // One mark under the CURRENT fingerprint.
    await seamInvoke("score_mark_add", {
      pieceId,
      editionId,
      editionFingerprint: "fp-current",
      page: 1,
      pointsJson: JSON.stringify(points),
    });
    // One mark under a different EDITION entirely (must not count).
    await seamInvoke("score_mark_add", {
      pieceId,
      editionId: `${editionId}-other`,
      editionFingerprint: "fp-old",
      page: 1,
      pointsJson: JSON.stringify(points),
    });

    const page = await seamInvoke<ScoreMarksPage>("score_marks_page", {
      pieceId,
      editionId,
      editionFingerprint: "fp-current",
      page: 1,
    });
    expect(page.marks).toHaveLength(1);
    expect(page.stale_marks).toBe(2);
  });
});

describe("dev-mock score_mark_undo (LIFO)", () => {
  beforeEach(() => installTauriDevMock());
  afterEach(() => uninstallTauriDevMock());

  it("returns null when the page has no marks", async () => {
    const key = uniqueKey();
    const undone = await seamInvoke<number | null>("score_mark_undo", {
      ...key,
      page: 1,
    });
    expect(undone).toBeNull();
  });

  it("pops the LAST added mark and removes it from score_marks_page", async () => {
    const key = uniqueKey();
    const points = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ];
    const first = await seamInvoke<MockMark>("score_mark_add", {
      ...key,
      page: 1,
      pointsJson: JSON.stringify(points),
    });
    const second = await seamInvoke<MockMark>("score_mark_add", {
      ...key,
      page: 1,
      pointsJson: JSON.stringify(points),
    });

    const undoneId = await seamInvoke<number | null>("score_mark_undo", {
      ...key,
      page: 1,
    });
    expect(undoneId).toBe(second.id);

    const page = await seamInvoke<ScoreMarksPage>("score_marks_page", {
      ...key,
      page: 1,
    });
    expect(page.marks.map((m) => m.id)).toEqual([first.id]);
  });
});

describe("dev-mock score_marks_clear_page", () => {
  beforeEach(() => installTauriDevMock());
  afterEach(() => uninstallTauriDevMock());

  it("returns 0 and is a no-op for a page with zero marks", async () => {
    const key = uniqueKey();
    const removed = await seamInvoke<number>("score_marks_clear_page", {
      ...key,
      page: 3,
    });
    expect(removed).toBe(0);
  });

  it("returns the removed count and empties the page", async () => {
    const key = uniqueKey();
    const points = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ];
    await seamInvoke("score_mark_add", {
      ...key,
      page: 4,
      pointsJson: JSON.stringify(points),
    });
    await seamInvoke("score_mark_add", {
      ...key,
      page: 4,
      pointsJson: JSON.stringify(points),
    });

    const removed = await seamInvoke<number>("score_marks_clear_page", {
      ...key,
      page: 4,
    });
    expect(removed).toBe(2);

    const page = await seamInvoke<ScoreMarksPage>("score_marks_page", {
      ...key,
      page: 4,
    });
    expect(page.marks).toHaveLength(0);
  });
});
