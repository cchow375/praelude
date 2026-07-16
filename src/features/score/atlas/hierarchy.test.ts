import { describe, expect, it } from "vitest";
import {
  analyzeTargetGraph,
  assignTargetParent,
  type TargetRangeNode,
} from "./hierarchy";

function target(
  id: number,
  start: number,
  end: number,
  parentId: number | null = null,
  pieceId = 1,
): TargetRangeNode {
  return { id, piece_id: pieceId, m_start: start, m_end: end, parent_id: parentId };
}

describe("Score Atlas target hierarchy", () => {
  it("accepts contained nesting and reports its structural relationship", () => {
    const analysis = analyzeTargetGraph([target(1, 1, 32), target(2, 9, 16, 1)]);
    expect(analysis.valid).toBe(true);
    expect(analysis.relationships).toEqual([
      { left_id: 1, right_id: 2, kind: "contains" },
    ]);
  });

  it("keeps partial overlaps valid when neither target is the other's parent", () => {
    const analysis = analyzeTargetGraph([target(1, 1, 12), target(2, 8, 20)]);
    expect(analysis.valid).toBe(true);
    expect(analysis.issues).toEqual([]);
    expect(analysis.relationships).toEqual([
      { left_id: 1, right_id: 2, kind: "partial_overlap" },
    ]);
  });

  it("rejects invalid/reversed ranges and cross-Piece parentage", () => {
    const analysis = analyzeTargetGraph([
      target(1, 12, 8),
      target(2, 1, 4, 3, 1),
      target(3, 1, 8, null, 2),
    ]);
    expect(analysis.valid).toBe(false);
    expect(analysis.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["invalid_range", "cross_piece_parent"]),
    );
  });

  it("requires a selected parent to contain its nested child", () => {
    expect(assignTargetParent([target(1, 1, 12), target(2, 8, 20)], 2, 1)).toMatchObject({
      ok: false,
      code: "parent_does_not_contain_target",
    });
  });

  it("applies a safe parent edge without moving either target range", () => {
    const nodes = [target(1, 1, 32), target(2, 9, 16)];
    const result = assignTargetParent(nodes, 2, 1);
    expect(result).toMatchObject({
      ok: true,
      value: [
        { id: 1, m_start: 1, m_end: 32, parent_id: null },
        { id: 2, m_start: 9, m_end: 16, parent_id: 1 },
      ],
    });
    expect(nodes[1].parent_id).toBeNull();
  });

  it("rejects cycle-producing assignments and detects existing cycles", () => {
    const equalRanges = [target(1, 1, 16, null), target(2, 1, 16, 1)];
    expect(assignTargetParent(equalRanges, 1, 2)).toMatchObject({
      ok: false,
      code: "parent_cycle",
    });
    const analysis = analyzeTargetGraph([target(1, 1, 16, 2), target(2, 1, 16, 1)]);
    expect(analysis.issues.filter((issue) => issue.code === "parent_cycle")).toHaveLength(2);
  });
});
