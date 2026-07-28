import { describe, expect, it } from "vitest";
import { layoutUniversePieces, stableIdHash, starRadius } from "./graphLayout";
import type { UniversePiece } from "./types";

function piece(overrides: Partial<UniversePiece> = {}): UniversePiece {
  return {
    piece_id: 1,
    title: "Piece",
    composer: null,
    focused_seconds: 600,
    active_days_28: 1,
    regions_total: 1,
    regions_practiced: 1,
    regions_revisited: 0,
    quality_brightness: 0.9,
    last_practiced: null,
    region_signals: [],
    ...overrides,
  };
}

describe("starRadius", () => {
  it("returns the floor radius (18) at zero seconds", () => {
    expect(starRadius(0)).toBe(18);
  });

  it("clamps negative seconds to the same floor as zero instead of going lower", () => {
    expect(starRadius(-100)).toBe(18);
    expect(starRadius(-1)).toBe(18);
  });

  it("treats NaN as 0 seconds via the finite guard", () => {
    expect(starRadius(NaN)).toBe(18);
  });

  it("treats +/-Infinity as 0 seconds (floor radius), NOT the max radius", () => {
    // Number.isFinite(Infinity) is false, so `safe` collapses to 0 here —
    // the same as a piece with no focused time at all. A caller expecting
    // "unbounded time -> unbounded (clamped-max) radius" would be surprised
    // that Infinity silently degrades to the *minimum* radius instead.
    expect(starRadius(Infinity)).toBe(18);
    expect(starRadius(-Infinity)).toBe(18);
  });

  it("computes the exact log2-scaled value at known checkpoints", () => {
    // 60s -> safe/60 = 1 -> log2(2) = 1 exactly -> 18 + 4.8 = 22.8
    expect(starRadius(60)).toBeCloseTo(22.8, 10);
    // 600s -> safe/60 = 10 -> 18 + log2(11) * 4.8
    expect(starRadius(600)).toBeCloseTo(34.60527176945902, 10);
    // 3600s -> safe/60 = 60 -> 18 + log2(61) * 4.8
    expect(starRadius(3600)).toBeCloseTo(46.46753922030186, 10);
  });

  it("is monotonically non-decreasing as focused seconds increase", () => {
    const checkpoints = [0, 1, 60, 600, 3600, 6035, 6036, 36000];
    const radii = checkpoints.map(starRadius);
    for (let i = 1; i < radii.length; i++) {
      expect(radii[i]).toBeGreaterThanOrEqual(radii[i - 1]);
    }
  });

  it("clamps at the max radius (50) for very large seconds", () => {
    expect(starRadius(36000)).toBe(50);
    expect(starRadius(1_000_000_000)).toBe(50);
  });

  it("sits just under the max radius right before the clamp threshold", () => {
    // The clamp boundary is at safe/60 = 2^(32/4.8) - 1 ≈ 6035.7s.
    expect(starRadius(6035)).toBeCloseTo(49.99929556751547, 10);
    expect(starRadius(6035)).toBeLessThan(50);
    expect(starRadius(6036)).toBe(50);
  });
});

describe("stableIdHash", () => {
  it("is deterministic: repeated calls with the same id return the same value", () => {
    expect(stableIdHash(42)).toBe(stableIdHash(42));
    expect(stableIdHash(-7)).toBe(stableIdHash(-7));
  });

  it("returns a 32-bit unsigned integer for a range of ids", () => {
    for (const id of [0, 1, -1, 5, -5, 2147483647, -2147483648, 1e15]) {
      const hash = stableIdHash(id);
      expect(Number.isInteger(hash)).toBe(true);
      expect(hash).toBeGreaterThanOrEqual(0);
      expect(hash).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it("produces different hashes for a spot-check of distinct small integer ids", () => {
    const hashes = [1, 2, 3, 4, 5].map(stableIdHash);
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  it("truncates fractional ids via Math.trunc rather than rounding", () => {
    // trunc(3.9) === trunc(3) === 3, so these collide by construction.
    expect(stableIdHash(3.9)).toBe(stableIdHash(3));
    // trunc(-3.9) === trunc(-3) === -3 (truncation toward zero, NOT floor,
    // which would have given -4).
    expect(stableIdHash(-3.9)).toBe(stableIdHash(-3));
    expect(stableIdHash(-3.9)).not.toBe(stableIdHash(-4));
  });

  it("does not throw for negative ids and returns a value in the valid uint32 range", () => {
    expect(() => stableIdHash(-5)).not.toThrow();
    const hash = stableIdHash(-5);
    expect(hash).toBeGreaterThanOrEqual(0);
    expect(hash).toBeLessThanOrEqual(0xffffffff);
  });

  it("treats NaN the same as 0 (Math.trunc(NaN) | 0 === 0)", () => {
    expect(stableIdHash(NaN)).toBe(stableIdHash(0));
  });

  // TODO(open design question): `(Math.trunc(id) | 0)` reduces the id to its
  // low 32 bits via ToInt32 before hashing, so any two ids that differ by
  // exactly 2**32 collide. piece_id is a real SQLite rowid and is never
  // expected to reach that range in practice, but the collision is real and
  // undocumented — worth a comment on the function, or an explicit
  // out-of-range guard, if piece_id's upper bound is ever revisited.
  it("collides for ids exactly 2**32 apart, because only the low 32 bits are hashed", () => {
    expect(stableIdHash(5)).toBe(stableIdHash(5 + 2 ** 32));
    expect(stableIdHash(0)).toBe(stableIdHash(2 ** 32));
  });
});

describe("layoutUniversePieces", () => {
  it("returns the exact empty-world defaults for zero pieces", () => {
    expect(layoutUniversePieces([])).toEqual({
      nodes: [],
      width: 1060,
      height: 610,
      columns: 1,
      rows: 1,
    });
  });

  it("lays out a single piece on a 2-column grid, centered in the minimum world", () => {
    const layout = layoutUniversePieces([
      piece({ piece_id: 1, focused_seconds: 600 }),
    ]);
    expect(layout.columns).toBe(2);
    expect(layout.rows).toBe(1);
    expect(layout.width).toBe(1060);
    expect(layout.height).toBe(610);
    expect(layout.nodes).toHaveLength(1);

    const [node] = layout.nodes;
    expect(node.x).toBeCloseTo(376.4470588235294, 10);
    expect(node.y).toBeCloseTo(310.0352941176471, 10);
    expect(node.radius).toBeCloseTo(34.60527176945902, 10);
    expect(node.paletteIndex).toBe(3);
  });

  it("sorts nodes by hash of piece_id (with piece_id as tiebreak), not input order", () => {
    const pieces = [
      piece({ piece_id: 1, focused_seconds: 600 }),
      piece({ piece_id: 2, focused_seconds: 1200 }),
      piece({ piece_id: 3, focused_seconds: 60 }),
    ];
    const layout = layoutUniversePieces(pieces);
    // stableIdHash(1) < stableIdHash(3) < stableIdHash(2), verified directly
    // against stableIdHash so this test doesn't silently rot if the hash
    // constants ever change.
    const expectedOrder = [1, 2, 3].sort(
      (a, b) => stableIdHash(a) - stableIdHash(b),
    );
    expect(layout.nodes.map((n) => n.piece.piece_id)).toEqual(expectedOrder);
  });

  it("is input-order-independent: shuffling the input yields the same node set and positions", () => {
    const pieces = [
      piece({ piece_id: 1, focused_seconds: 600 }),
      piece({ piece_id: 2, focused_seconds: 1200 }),
      piece({ piece_id: 3, focused_seconds: 60 }),
    ];
    const shuffled = [pieces[2], pieces[0], pieces[1]];

    const a = layoutUniversePieces(pieces);
    const b = layoutUniversePieces(shuffled);

    expect(a.nodes.map((n) => n.piece.piece_id)).toEqual(
      b.nodes.map((n) => n.piece.piece_id),
    );
    expect(a.nodes.map((n) => ({ x: n.x, y: n.y }))).toEqual(
      b.nodes.map((n) => ({ x: n.x, y: n.y })),
    );
    expect(a.width).toBe(b.width);
    expect(a.height).toBe(b.height);
  });

  it("does not mutate the input array's order or its piece objects", () => {
    const original = [
      piece({ piece_id: 3 }),
      piece({ piece_id: 1 }),
      piece({ piece_id: 2 }),
    ];
    const snapshot = original.map((p) => p.piece_id);
    layoutUniversePieces(original);
    expect(original.map((p) => p.piece_id)).toEqual(snapshot);
  });

  it("grows the world beyond the minimum bounds for a large piece count, staying collision-free", () => {
    const pieces = Array.from({ length: 40 }, (_, i) =>
      piece({ piece_id: i + 1, focused_seconds: 600 }),
    );
    const layout = layoutUniversePieces(pieces);

    expect(layout.nodes).toHaveLength(40);
    expect(layout.columns).toBe(8);
    expect(layout.rows).toBe(5);
    expect(layout.width).toBeGreaterThan(1060);
    expect(layout.height).toBeGreaterThan(610);

    // Collision-freedom: the closest pair of nodes must be farther apart
    // than the sum of the two largest possible radii (2 * 50 = 100), so no
    // two stars can ever visually overlap regardless of focused time.
    let minDistance = Infinity;
    for (let i = 0; i < layout.nodes.length; i++) {
      for (let j = i + 1; j < layout.nodes.length; j++) {
        const dx = layout.nodes[i].x - layout.nodes[j].x;
        const dy = layout.nodes[i].y - layout.nodes[j].y;
        minDistance = Math.min(minDistance, Math.sqrt(dx * dx + dy * dy));
      }
    }
    expect(minDistance).toBeGreaterThan(100);
  });

  it("scales columns/rows/world size up further for a very large piece count", () => {
    const pieces = Array.from({ length: 200 }, (_, i) =>
      piece({ piece_id: i + 1, focused_seconds: 600 }),
    );
    const layout = layoutUniversePieces(pieces);
    expect(layout.columns).toBe(18);
    expect(layout.rows).toBe(12);
    expect(layout.width).toBe(5084);
    expect(layout.height).toBe(3224);
  });

  it("derives paletteIndex as hash(piece_id) % 8, always in [0, 7]", () => {
    const pieces = Array.from({ length: 100 }, (_, i) =>
      piece({ piece_id: i + 1 }),
    );
    const layout = layoutUniversePieces(pieces);
    for (const node of layout.nodes) {
      expect(node.paletteIndex).toBe(stableIdHash(node.piece.piece_id) % 8);
      expect(node.paletteIndex).toBeGreaterThanOrEqual(0);
      expect(node.paletteIndex).toBeLessThanOrEqual(7);
    }
    // Across 100 pieces the 8 buckets should not collapse to a single value.
    const distinctBuckets = new Set(layout.nodes.map((n) => n.paletteIndex));
    expect(distinctBuckets.size).toBeGreaterThan(1);
  });

  it("derives each node's radius from starRadius(piece.focused_seconds)", () => {
    const layout = layoutUniversePieces([
      piece({ piece_id: 1, focused_seconds: 0 }),
      piece({ piece_id: 2, focused_seconds: 36000 }),
    ]);
    for (const node of layout.nodes) {
      expect(node.radius).toBe(starRadius(node.piece.focused_seconds));
    }
    const radii = layout.nodes.map((n) => n.radius);
    expect(Math.min(...radii)).toBe(18);
    expect(Math.max(...radii)).toBe(50);
  });

  // TODO(open design question): two pieces sharing the same piece_id (should
  // never happen in practice, since piece_id is a DB primary key) would hash
  // identically and tie on the piece_id tiebreak too, leaving ordering
  // between them to fall back on Array.prototype.sort's stability guarantee
  // (input order preserved). Not exercised here since it documents an
  // implicit assumption about caller-supplied data rather than a bug.
});
