/**
 * Bridge from wizard line anchors to a reviewable `MappingCandidate`.
 *
 * This is what kills the mapping-required dead end: when a box is drawn on a
 * page that has calibration anchors, `resolveMeasureRange` interpolates a range,
 * and this turns that range into an advisory candidate the `TargetDraftEditor`
 * shows as an editable "Suggested measures" field. Confirming it produces a
 * `calibrated_user_confirmed` mapping that saves through the EXISTING
 * `score_atlas_target_save` — the anchors themselves persist separately via
 * `score_calibration_save`.
 */
import type { EditionIdentity, MappingCandidate } from "../model";
import { resolveMeasureRange, type LineAnchor } from "./anchors";

/** A drawn box in normalized 0–1 page coordinates. */
export interface CandidateBox {
  page: number;
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
}

/** Stable id for one calibration anchor, used as evidence provenance. */
function anchorPointId(edition: EditionIdentity, anchor: LineAnchor): string {
  return `line-anchor:${edition.edition_fingerprint}:p${anchor.page}:m${anchor.measure}:y${anchor.yPct}`;
}

/**
 * Build an advisory `MappingCandidate` for a drawn box from the page's line
 * anchors, or `null` when the anchors carry no measure information for that page
 * (interpolation confidence 0). The candidate is never authoritative — the user
 * reviews or corrects it before it becomes a `calibrated_user_confirmed`
 * mapping.
 */
export function candidateFromAnchors(
  box: CandidateBox,
  anchors: LineAnchor[],
  edition: EditionIdentity,
): MappingCandidate | null {
  const resolved = resolveMeasureRange(box, anchors);
  if (resolved.confidence <= 0) return null;

  const pageAnchors = anchors.filter((anchor) => anchor.page === box.page);
  const pointIds = pageAnchors.map((anchor) => anchorPointId(edition, anchor));
  return {
    edition_fingerprint: edition.edition_fingerprint,
    // Not an XML match: names the calibration-anchor provenance so the save
    // boundary can see where the range came from.
    xml_fingerprint: `calibration-anchors:${edition.edition_fingerprint}`,
    candidate_range: { m_start: resolved.mStart, m_end: resolved.mEnd },
    confidence: resolved.confidence,
    rationale: `Interpolated from ${pageAnchors.length} line anchor${pageAnchors.length === 1 ? "" : "s"} on page ${box.page}; review or correct before asserting it.`,
    calibration_point_ids:
      pointIds.length > 0
        ? pointIds
        : [`line-anchor:${edition.edition_fingerprint}:page${box.page}`],
    authoritative: false,
  };
}
