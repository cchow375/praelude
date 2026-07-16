import { describe, expect, it } from "vitest";
import {
  authoritativeMeasureRange,
  confirmCalibratedMapping,
  createTargetDraft,
  exactCompatibleMapping,
  unknownMapping,
  validateMeasureRange,
  withTargetDraftDetails,
} from "./draft";
import type { MappingCandidate, PersistentPdfSelectionAnchor } from "./model";

const edition = { edition_id: "scan.pdf", edition_fingerprint: "pdf-fp" };
const anchor: PersistentPdfSelectionAnchor = {
  schema_version: 1,
  ...edition,
  rects: [{ page: 2, x: 0.1, y: 0.2, w: 0.4, h: 0.15 }],
};

const candidate: MappingCandidate = {
  edition_fingerprint: "pdf-fp",
  xml_fingerprint: "xml-fp",
  candidate_range: { m_start: 40, m_end: 44 },
  confidence: 0.62,
  rationale: "Bounded between two user anchors.",
  calibration_point_ids: ["p1", "p2"],
  authoritative: false,
};

describe("Score Atlas TargetDraft", () => {
  it("creates geometry-first drafts without requiring title, note, hands, method, or range", () => {
    const result = createTargetDraft({ draft_id: "draft-1", piece_id: 7, edition, anchor });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.mapping).toMatchObject({ status: "unknown", asserted_range: null });
      expect(result.value.title).toBeUndefined();
      expect(result.value.note).toBeUndefined();
      expect(result.value.hands).toBeUndefined();
      expect(result.value.method).toBeUndefined();
    }
  });

  it("normalizes optional target details without inventing defaults", () => {
    const created = createTargetDraft({ draft_id: "draft-1", piece_id: 7, edition, anchor });
    expect(created.ok).toBe(true);
    if (created.ok) {
      const detailed = withTargetDraftDetails(created.value, {
        title: "  Coda leap ",
        note: "Release before landing",
        hands: "left hand",
        method: "blocked then rhythmic",
      });
      expect(detailed).toMatchObject({
        title: "Coda leap",
        note: "Release before landing",
        hands: "left hand",
        method: "blocked then rhythmic",
      });
      const cleared = withTargetDraftDetails(detailed, {
        title: null,
        note: null,
        hands: null,
        method: null,
      });
      expect(cleared.title).toBeUndefined();
      expect(cleared.note).toBeUndefined();
      expect(cleared.hands).toBeUndefined();
      expect(cleared.method).toBeUndefined();
    }
  });

  it("rejects invalid and reversed musical ranges", () => {
    expect(validateMeasureRange({ m_start: 0, m_end: 8 })).toMatchObject({
      ok: false,
      code: "invalid_measure_range",
    });
    expect(validateMeasureRange({ m_start: 12, m_end: 8 })).toMatchObject({
      ok: false,
      code: "invalid_measure_range",
    });
    expect(
      exactCompatibleMapping(
        { m_start: 44, m_end: 40 },
        {
          edition_fingerprint: "pdf-fp",
          xml_fingerprint: "xml-fp",
          compatibility_id: "compat-1",
          verified_at: "2026-07-15T10:00:00Z",
          rationale: "Same engraved edition.",
        },
      ),
    ).toMatchObject({ ok: false, code: "invalid_measure_range" });
  });

  it("keeps scan/mismatched and low-confidence candidates non-authoritative", () => {
    const mismatch = unknownMapping("The scan and MusicXML editions are known to differ.");
    const suggested = unknownMapping("Calibrated candidate needs review.", candidate);
    expect(authoritativeMeasureRange(mismatch)).toBeNull();
    expect(authoritativeMeasureRange(suggested)).toBeNull();
    expect(suggested).toMatchObject({
      status: "unknown",
      asserted_range: null,
      candidate: { authoritative: false, candidate_range: { m_start: 40, m_end: 44 } },
    });
  });

  it("promotes calibration only with an explicit user confirmation receipt", () => {
    expect(
      confirmCalibratedMapping(candidate, {
        confirmation_id: "",
        confirmed_by: "user",
        confirmed_at: "2026-07-15T10:00:00Z",
        confirmed_range: { m_start: 40, m_end: 44 },
      }),
    ).toMatchObject({ ok: false, code: "invalid_confirmation" });

    const result = confirmCalibratedMapping(candidate, {
      confirmation_id: "confirmation-1",
      confirmed_by: "user",
      confirmed_at: "2026-07-15T10:00:00Z",
      confirmed_range: { m_start: 41, m_end: 43 },
      rationale: "Christian corrected the printed range.",
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        status: "calibrated_user_confirmed",
        asserted_range: { m_start: 41, m_end: 43 },
        confidence: 0.62,
      },
    });
  });
});
