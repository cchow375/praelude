import { describe, expect, it } from "vitest";
import {
  confirmCalibratedMapping,
  exactCompatibleMapping,
  unknownMapping,
} from "./draft";
import type { MappingCandidate, PersistentPdfSelectionAnchor } from "./model";
import { validateAtomicTargetSavePayload } from "./savePayload";

const edition = { edition_id: "score.pdf", edition_fingerprint: "pdf-fp" };
const anchor: PersistentPdfSelectionAnchor = {
  schema_version: 1,
  ...edition,
  rects: [{ page: 1, x: 0.1, y: 0.2, w: 0.3, h: 0.1 }],
};
const candidate: MappingCandidate = {
  edition_fingerprint: "pdf-fp",
  xml_fingerprint: "xml-fp",
  candidate_range: { m_start: 20, m_end: 24 },
  confidence: 0.7,
  rationale: "Bounded calibration candidate.",
  calibration_point_ids: ["one", "two"],
  authoritative: false,
};

describe("Score Atlas atomic target save", () => {
  it("allows geometry plus explicit unknown evidence without asserting measures", () => {
    expect(
      validateAtomicTargetSavePayload({
        piece_id: 7,
        title: "Unmapped jump",
        edition,
        anchor,
        mapping_evidence: unknownMapping("This scanned edition is not aligned."),
        asserted_measure_range: null,
      }),
    ).toMatchObject({ ok: true });
  });

  it("rejects a partial authoritative bundle", () => {
    const mapping = exactCompatibleMapping(
      { m_start: 20, m_end: 24 },
      {
        edition_fingerprint: "pdf-fp",
        xml_fingerprint: "xml-fp",
        compatibility_id: "compat-1",
        verified_at: "2026-07-15T12:00:00Z",
        rationale: "Same source edition.",
      },
    );
    expect(mapping.ok).toBe(true);
    if (mapping.ok) {
      expect(
        validateAtomicTargetSavePayload({
          piece_id: 7,
          edition,
          mapping_evidence: mapping.value,
          asserted_measure_range: { m_start: 20, m_end: 24 },
        }),
      ).toMatchObject({ ok: false, code: "partial_mapping_bundle" });
    }
  });

  it("rejects any asserted range attached to unknown/low-confidence evidence", () => {
    expect(
      validateAtomicTargetSavePayload({
        piece_id: 7,
        edition,
        anchor,
        mapping_evidence: unknownMapping("Candidate needs review.", candidate),
        asserted_measure_range: { m_start: 20, m_end: 24 },
      }),
    ).toMatchObject({ ok: false, code: "unknown_mapping_assertion" });
  });

  it("rejects edition/fingerprint mismatches", () => {
    expect(
      validateAtomicTargetSavePayload({
        piece_id: 7,
        edition: { ...edition, edition_fingerprint: "new-scan-fp" },
        anchor,
        mapping_evidence: unknownMapping("New edition needs remapping."),
        asserted_measure_range: null,
      }),
    ).toMatchObject({ ok: false, code: "edition_anchor_mismatch" });
  });

  it("rejects malformed normalized anchor geometry at the atomic boundary", () => {
    expect(
      validateAtomicTargetSavePayload({
        piece_id: 7,
        edition,
        anchor: {
          ...anchor,
          rects: [{ page: 1, x: 0.95, y: 0.2, w: 0.2, h: 0.1 }],
        },
        mapping_evidence: unknownMapping("Geometry needs correction."),
        asserted_measure_range: null,
      }),
    ).toMatchObject({ ok: false, code: "invalid_anchor" });
  });

  it("accepts an exact-compatible identity only when range and evidence agree", () => {
    const mapping = exactCompatibleMapping(
      { m_start: 20, m_end: 24 },
      {
        edition_fingerprint: "pdf-fp",
        xml_fingerprint: "xml-fp",
        compatibility_id: "compat-1",
        verified_at: "2026-07-15T12:00:00Z",
        rationale: "Same source edition.",
      },
    );
    expect(mapping.ok).toBe(true);
    if (mapping.ok) {
      expect(
        validateAtomicTargetSavePayload({
          piece_id: 7,
          edition,
          anchor,
          mapping_evidence: mapping.value,
          asserted_measure_range: { m_start: 20, m_end: 25 },
        }),
      ).toMatchObject({ ok: false, code: "mapping_range_mismatch" });
      expect(
        validateAtomicTargetSavePayload({
          piece_id: 7,
          edition,
          anchor,
          mapping_evidence: mapping.value,
          asserted_measure_range: { m_start: 20, m_end: 24 },
        }),
      ).toMatchObject({ ok: true });
    }
  });

  it("accepts calibrated identity only after the explicit user-confirmation constructor", () => {
    const mapping = confirmCalibratedMapping(candidate, {
      confirmation_id: "confirm-1",
      confirmed_by: "user",
      confirmed_at: "2026-07-15T12:00:00Z",
      confirmed_range: { m_start: 21, m_end: 23 },
    });
    expect(mapping.ok).toBe(true);
    if (mapping.ok) {
      expect(
        validateAtomicTargetSavePayload({
          piece_id: 7,
          edition,
          anchor,
          mapping_evidence: mapping.value,
          asserted_measure_range: { m_start: 21, m_end: 23 },
        }),
      ).toMatchObject({ ok: true });
    }
  });
});
