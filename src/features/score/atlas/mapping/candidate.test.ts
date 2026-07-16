import { describe, it, expect } from "vitest";
import { candidateFromAnchors } from "./candidate";
import type { LineAnchor } from "./anchors";
import type { EditionIdentity } from "../model";

const edition: EditionIdentity = {
  edition_id: "score/Ekier.pdf",
  edition_fingerprint: "fp-a",
};

const anchors: LineAnchor[] = [
  { page: 1, yPct: 0.2, measure: 45 },
  { page: 1, yPct: 0.34, measure: 52 },
];

describe("candidateFromAnchors", () => {
  it("builds an advisory candidate whose range sits within the anchor span", () => {
    const candidate = candidateFromAnchors(
      { page: 1, xPct: 0.1, yPct: 0.22, wPct: 0.3, hPct: 0.05 },
      anchors,
      edition,
    );
    expect(candidate).not.toBeNull();
    expect(candidate?.authoritative).toBe(false);
    expect(candidate?.edition_fingerprint).toBe("fp-a");
    expect(candidate?.candidate_range.m_start).toBeGreaterThanOrEqual(45);
    expect(candidate?.candidate_range.m_end).toBeLessThanOrEqual(52);
    expect(candidate?.calibration_point_ids.length).toBeGreaterThan(0);
    expect(candidate?.confidence).toBeGreaterThan(0);
  });

  it("returns null when the page carries no anchors (no measure info)", () => {
    const candidate = candidateFromAnchors(
      { page: 9, xPct: 0.1, yPct: 0.2, wPct: 0.3, hPct: 0.05 },
      anchors,
      edition,
    );
    expect(candidate).toBeNull();
  });
});
