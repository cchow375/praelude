//! Deterministic reconciliation (Plan C, task C3): turns the vision layer's
//! per-page [`ScanPageOutput`]s into a typed [`ReconcileResult`] — a
//! `store::measure_map::MeasureMapPage` per page plus a flat list of typed
//! conflicts the review UI surfaces to the user. Pure function, no I/O: the
//! wiring command (`measure_reconcile` in `lib.rs`) resolves the XML totals
//! and calibration anchors and hands them in.
//!
//! # What this does NOT trust
//!
//! The vision prompt (`SCAN_PAGE_PROMPT_V1`) asks the model to order systems
//! top-to-bottom by `y_top` and to never invent a printed number, but a model
//! reply is not proof of either. This module re-sorts every page's systems by
//! `y_top` itself before doing anything else, and treats a printed number
//! purely as a coordinate to re-derive which bar it actually pins (by y-band
//! containment, then x-span containment) rather than trusting which JSON
//! system object it happened to be nested under.
//!
//! # Barline → bar conversion
//!
//! Per `SCAN_PAGE_PROMPT_V1`: "`barline_xs`: the x position of EVERY bar line
//! in the system, left to right, **including the final bar line at
//! `x_right`**" while `x_left` is "the start of the first bar". So
//! `barline_xs` entries are bar RIGHT edges — a system with N `barline_xs`
//! has exactly N bars, bar `i`'s left edge is bar `i-1`'s `x_right` (or the
//! system's `x_left` for bar 0), matching `store::measure_map::MapSystem`'s
//! own doc comment on `MapBar` verbatim. No `+1`/`-1` reinterpretation needed.
//!
//! # Numbering
//!
//! Bars are laid out into one global, page-ordered / system-ordered (by
//! sorted `y_top`) / bar-ordered stream. An implicit anchor always pins the
//! very first bar of the stream to the start number (1, or a pickup's 0 when
//! a printed number pins it — see [`reconcile`]'s doc comment for the pickup
//! rule). Every OTHER bar's number is `nearest_preceding_anchor.number + (i -
//! nearest_preceding_anchor.index)` — a plain forward fill from whichever
//! anchor (implicit start, or a confident printed number) precedes it in the
//! stream. Because the implicit start anchor always exists at index 0, this
//! single forward pass already delivers "backward" propagation for every bar
//! before the first real printed-number anchor: there is nothing before
//! index 0 to fill backward into. Consecutive anchor pairs are cross-checked
//! against the actual barline count between them; a mismatch is a
//! `continuity_break` conflict, and the forward-fill numbering is left as-is
//! (both bars keep `source: "model"` — this pass never guesses which anchor
//! is "right").

use std::cmp::Ordering;

use serde::Serialize;

use crate::store::{MapBar, MapBarSource, MapSystem, MeasureMapPage, MeasureMapPageRow};

use super::measure_scan::{PrintedNumber, ScanPageOutput, ScanSystem};

/// A printed number is only trusted as a numbering anchor at or above this
/// confidence; below it, the number is surfaced as a `low_confidence_anchor`
/// conflict instead of pinning anything.
const ANCHOR_CONFIDENCE_MIN: f64 = 0.5;

/// Two systems' y-bands are flagged as (likely) a hallucinated extra system
/// once their overlap exceeds this fraction of the SMALLER band's height.
const SYSTEM_OVERLAP_FRACTION_MAX: f64 = 0.2;

/// The MusicXML-derived totals `reconcile` checks the mapped total against.
/// Wraps `brain::score_context::xml_measure_facts`'s `max_measure`; absent
/// when the piece has no MusicXML (reconcile still runs, just without the
/// `total_mismatch` check).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct XmlTotals {
    pub max_measure: u32,
    pub has_pickup: bool,
}

/// One calibration line anchor, reduced to page + measure (the binding v1
/// reading of `score_calibration_get`'s `CalibrationPoint`: its `y` position
/// is ignored — a calibration anchor asserts "page P's mapped run starts at
/// measure M", checked against the first mapped bar found on that page).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CalibrationAnchor {
    pub page: u32,
    pub measure: u32,
}

/// A typed reconciliation conflict. `kind` (the serde tag) is the literal
/// string the brief names; every variant's extra fields are exactly what the
/// review UI needs to point at and explain the disagreement. Never blocks
/// output — a page with conflicts is still fully numbered, just flagged.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum MapConflict {
    /// The XML says this piece has a pickup measure, but no printed number
    /// pinned the very first bar's offset, so numbering defaulted to
    /// starting at 1 (the review UI lets the user renumber to a 0-start).
    PickupAmbiguity { page: u32 },
    /// Between two numbering anchors, the barline count did not match what
    /// the anchors' numbers imply (also fires when two anchors flatly
    /// contradict each other, e.g. the later one's number is not greater).
    ContinuityBreak {
        page: u32,
        system: u32,
        expected: u32,
        found: u32,
    },
    /// The final mapped measure number does not match the MusicXML's
    /// `max_measure`.
    TotalMismatch { mapped: u32, xml: u32 },
    /// A calibration anchor's measure does not match the first bar mapped on
    /// that page.
    AnchorDisagreement {
        page: u32,
        anchor_measure: u32,
        mapped_measure: u32,
    },
    /// A printed number was read below the trust threshold, so it was not
    /// used to pin anything.
    LowConfidenceAnchor {
        page: u32,
        system: u32,
        measure: u32,
        confidence: f64,
    },
    /// Two systems' y-bands overlap by more than the tolerance — the
    /// hallucinated-extra-system case: a model reply that invents a system
    /// whose band collides with a real one.
    OverlappingSystems {
        page: u32,
        system_a: u32,
        system_b: u32,
    },
}

/// The reconciled measure map: one `MeasureMapPage` per input page (in page
/// order), every conflict found, and the total bar count mapped.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ReconcileResult {
    pub pages: Vec<MeasureMapPageRow>,
    pub conflicts: Vec<MapConflict>,
    pub total_bars: u32,
}

/// One bar's working state before final numbering: which page/system it
/// belongs to (post-defensive-sort) and its right-edge x.
struct BarWork {
    page: u32,
    system: u32,
    x_right: f64,
}

/// One system's working state: enough geometry to reconstruct `MapSystem`
/// and to resolve printed numbers onto its bars.
struct SystemWork<'a> {
    page: u32,
    system: u32,
    y_top: f64,
    y_bottom: f64,
    x_left: f64,
    x_right: f64,
    bars_start: usize,
    bar_count: usize,
    printed_numbers: &'a [PrintedNumber],
}

/// A resolved numbering anchor: a global bar-stream index paired with the
/// measure number that pins it, plus (for real, non-implicit anchors) where
/// it came from and how confident the model was.
#[derive(Clone, Copy)]
struct Anchor {
    index: usize,
    number: u32,
    page: u32,
    system: u32,
    /// `None` for the synthetic index-0 start anchor; `Some(confidence)` for
    /// a real printed number.
    confidence: Option<f64>,
}

/// Sort a page's systems defensively by `y_top` (never trust model order —
/// see the module doc comment) and flag any pair whose y-bands overlap by
/// more than [`SYSTEM_OVERLAP_FRACTION_MAX`] of the smaller band's height.
fn sorted_systems_with_overlap_conflicts<'a>(
    page: u32,
    systems: &'a [ScanSystem],
    conflicts: &mut Vec<MapConflict>,
) -> Vec<&'a ScanSystem> {
    let mut sorted: Vec<&ScanSystem> = systems.iter().collect();
    sorted.sort_by(|a, b| a.y_top.partial_cmp(&b.y_top).unwrap_or(Ordering::Equal));

    for window in sorted.windows(2) {
        let (a, b) = (window[0], window[1]);
        let overlap = a.y_bottom.min(b.y_bottom) - a.y_top.max(b.y_top);
        if overlap <= 0.0 {
            continue;
        }
        let smaller_height = (a.y_bottom - a.y_top).min(b.y_bottom - b.y_top);
        if smaller_height > 0.0 && overlap > SYSTEM_OVERLAP_FRACTION_MAX * smaller_height {
            let system_a = sorted.iter().position(|s| std::ptr::eq(*s, a)).unwrap_or(0) as u32 + 1;
            let system_b = sorted.iter().position(|s| std::ptr::eq(*s, b)).unwrap_or(0) as u32 + 1;
            conflicts.push(MapConflict::OverlappingSystems {
                page,
                system_a,
                system_b,
            });
        }
    }
    sorted
}

/// Find which bar (by local, 0-based index within the system) a printed
/// number's x falls into: the first bar whose right edge is at or past the
/// number's x, or the last bar if the number's x is past every bar (a
/// printed number can sit slightly right of the barline it labels).
fn bar_index_for_x(bar_right_edges: &[f64], x: f64) -> Option<usize> {
    if bar_right_edges.is_empty() {
        return None;
    }
    bar_right_edges
        .iter()
        .position(|right| x <= *right)
        .or(Some(bar_right_edges.len() - 1))
}

/// Find which system on a page a printed number's y belongs to, by nearest
/// band distance rather than JSON nesting — a hallucinated system can
/// misplace a number under the wrong JSON object, and a real printed number
/// commonly sits just outside its own system's y-band (the prompt's own
/// example: a system `y_top:0.08` with a printed number at `y:0.075`, just
/// above it). Distance is 0 for a y inside `[y_top, y_bottom]`, else the gap
/// to the nearer edge; ties keep the first (topmost, post-sort) system.
/// `None` only when `systems` is empty.
fn system_for_y(systems: &[&SystemWork], y: f64) -> Option<usize> {
    systems
        .iter()
        .map(|system| {
            if y < system.y_top {
                system.y_top - y
            } else if y > system.y_bottom {
                y - system.y_bottom
            } else {
                0.0
            }
        })
        .enumerate()
        .min_by(|(_, a), (_, b)| a.partial_cmp(b).unwrap_or(Ordering::Equal))
        .map(|(index, _)| index)
}

/// Pure reconciliation: vision scans + optional XML totals + optional
/// calibration anchors -> a typed measure map plus conflicts. See the module
/// doc comment for the barline/numbering rules in full.
///
/// Pickup rule: when `xml.has_pickup` is true, the very first bar of the
/// whole stream needs a printed number (confidence >= 0.5) pinning it,
/// otherwise numbering defaults to starting at 1 and a `pickup_ambiguity`
/// conflict is emitted (the review UI lets the user renumber to a 0-start).
pub fn reconcile(
    pages: Vec<(u32, ScanPageOutput)>,
    xml: Option<XmlTotals>,
    anchors: Vec<CalibrationAnchor>,
) -> ReconcileResult {
    let mut conflicts: Vec<MapConflict> = Vec::new();

    // Defensive sort: never trust the caller's page order either.
    let mut pages = pages;
    pages.sort_by_key(|(page, _)| *page);

    // Pass 1: flatten every page into per-system geometry (sorted, overlap
    // checked) and a flat, global, page/system/bar-ordered bar stream.
    let mut bar_works: Vec<BarWork> = Vec::new();
    let mut system_works: Vec<SystemWork> = Vec::new();
    for (page, output) in &pages {
        let sorted = sorted_systems_with_overlap_conflicts(*page, &output.systems, &mut conflicts);
        for (idx, system) in sorted.iter().enumerate() {
            let system_no = idx as u32 + 1;
            let bars_start = bar_works.len();
            for &x_right in &system.barline_xs {
                bar_works.push(BarWork {
                    page: *page,
                    system: system_no,
                    x_right,
                });
            }
            system_works.push(SystemWork {
                page: *page,
                system: system_no,
                y_top: system.y_top,
                y_bottom: system.y_bottom,
                x_left: system.x_left,
                x_right: system.x_right,
                bars_start,
                bar_count: system.barline_xs.len(),
                printed_numbers: &system.printed_numbers,
            });
        }
    }

    // Pass 2: resolve every printed number (across the WHOLE page, not just
    // the JSON system it was nested under) onto a bar, or flag it as too low
    // confidence to trust.
    let mut printed_anchors: Vec<Anchor> = Vec::new();
    for page in pages.iter().map(|(page, _)| *page).collect::<Vec<_>>() {
        let page_systems: Vec<&SystemWork> =
            system_works.iter().filter(|s| s.page == page).collect();
        // Every printed number reported anywhere on this page's systems.
        let numbers: Vec<&PrintedNumber> = page_systems
            .iter()
            .flat_map(|s| s.printed_numbers.iter())
            .collect();
        for number in numbers {
            let Some(owning_idx) = system_for_y(&page_systems, number.y) else {
                continue;
            };
            let system = page_systems[owning_idx];
            if system.bar_count == 0 {
                continue;
            }
            let right_edges: Vec<f64> = bar_works
                [system.bars_start..system.bars_start + system.bar_count]
                .iter()
                .map(|b| b.x_right)
                .collect();
            let Some(local_idx) = bar_index_for_x(&right_edges, number.x) else {
                continue;
            };
            if number.confidence < ANCHOR_CONFIDENCE_MIN {
                conflicts.push(MapConflict::LowConfidenceAnchor {
                    page,
                    system: system.system,
                    measure: number.number,
                    confidence: number.confidence,
                });
                continue;
            }
            printed_anchors.push(Anchor {
                index: system.bars_start + local_idx,
                number: number.number,
                page,
                system: system.system,
                confidence: Some(number.confidence),
            });
        }
    }
    // Stable order by stream position; drop later duplicates that pin the
    // exact same bar (keep the first-seen one — page order is already
    // ascending, so "first" is the earliest occurrence).
    printed_anchors.sort_by_key(|a| a.index);
    printed_anchors.dedup_by_key(|a| a.index);

    // Pass 3: the pickup rule + the implicit start anchor.
    let has_pickup = xml.map(|x| x.has_pickup).unwrap_or(false);
    let first_bar = bar_works.first();
    let pins_first_bar = printed_anchors.first().is_some_and(|a| a.index == 0);
    let start_number = if has_pickup && pins_first_bar {
        printed_anchors[0].number
    } else {
        if has_pickup && !pins_first_bar {
            conflicts.push(MapConflict::PickupAmbiguity {
                page: first_bar.map(|b| b.page).unwrap_or(1),
            });
        }
        1
    };

    let mut anchors_sorted = printed_anchors.clone();
    if !pins_first_bar {
        if let Some(first) = first_bar {
            anchors_sorted.push(Anchor {
                index: 0,
                number: start_number,
                page: first.page,
                system: first.system,
                confidence: None,
            });
            anchors_sorted.sort_by_key(|a| a.index);
        }
    }

    // Pass 4: continuity checks between consecutive anchors.
    for pair in anchors_sorted.windows(2) {
        let (a, b) = (pair[0], pair[1]);
        let expected = b.number.saturating_sub(a.number);
        let found = (b.index - a.index) as u32;
        if expected != found {
            conflicts.push(MapConflict::ContinuityBreak {
                page: a.page,
                system: a.system,
                expected,
                found,
            });
        }
    }

    // Pass 5: forward-fill numbering from the nearest preceding anchor.
    let mut assigned: Vec<u32> = vec![0; bar_works.len()];
    let mut anchor_ptr = 0usize;
    for (i, number) in assigned.iter_mut().enumerate() {
        while anchor_ptr + 1 < anchors_sorted.len() && anchors_sorted[anchor_ptr + 1].index <= i {
            anchor_ptr += 1;
        }
        let anchor = &anchors_sorted[anchor_ptr];
        // `anchor.number` is untrusted, model-reported input (a printed
        // number is never range-checked beyond being a `u32`) — a
        // pathological reply near `u32::MAX` must saturate, not panic.
        *number = anchor.number.saturating_add((i - anchor.index) as u32);
    }

    // Confidence carried on the exact bar a printed number pinned; every
    // other bar (interpolated/forward-filled) carries `None`.
    let confidence_by_index: std::collections::HashMap<usize, f64> = printed_anchors
        .iter()
        .filter_map(|a| a.confidence.map(|c| (a.index, c)))
        .collect();

    // Pass 6: calibration anchor disagreement (first bar mapped per page).
    for calibration in &anchors {
        if let Some(index) = bar_works.iter().position(|b| b.page == calibration.page) {
            let mapped_measure = assigned[index];
            if mapped_measure != calibration.measure {
                conflicts.push(MapConflict::AnchorDisagreement {
                    page: calibration.page,
                    anchor_measure: calibration.measure,
                    mapped_measure,
                });
            }
        }
    }

    // Pass 7: total vs XML max_measure.
    if let (Some(xml), Some(&last)) = (xml, assigned.last()) {
        if last != xml.max_measure {
            conflicts.push(MapConflict::TotalMismatch {
                mapped: last,
                xml: xml.max_measure,
            });
        }
    }

    // Pass 8: reassemble the typed `MeasureMapPage` per page.
    let mut result_pages: Vec<MeasureMapPageRow> = Vec::with_capacity(pages.len());
    for (page, _) in &pages {
        let mut systems: Vec<MapSystem> = Vec::new();
        for system in system_works.iter().filter(|s| s.page == *page) {
            let mut bars: Vec<MapBar> = Vec::with_capacity(system.bar_count);
            for local_idx in 0..system.bar_count {
                let global_idx = system.bars_start + local_idx;
                bars.push(MapBar {
                    x_right: bar_works[global_idx].x_right,
                    number: assigned[global_idx],
                    confidence: confidence_by_index.get(&global_idx).copied(),
                    source: MapBarSource::Model,
                });
            }
            systems.push(MapSystem {
                y_top: system.y_top,
                y_bottom: system.y_bottom,
                x_left: system.x_left,
                x_right: system.x_right,
                bars,
            });
        }
        result_pages.push(MeasureMapPageRow {
            page: *page,
            map: MeasureMapPage {
                version: 1,
                systems,
            },
        });
    }

    ReconcileResult {
        pages: result_pages,
        conflicts,
        total_bars: bar_works.len() as u32,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::score::measure_scan::SCAN_PAGE_PROMPT_V1;

    fn system(
        y_top: f64,
        y_bottom: f64,
        x_left: f64,
        x_right: f64,
        barline_xs: Vec<f64>,
        printed_numbers: Vec<PrintedNumber>,
    ) -> ScanSystem {
        ScanSystem {
            y_top,
            y_bottom,
            x_left,
            x_right,
            barline_xs,
            printed_numbers,
            staves: 2,
        }
    }

    fn printed(number: u32, x: f64, y: f64, confidence: f64) -> PrintedNumber {
        PrintedNumber {
            number,
            x,
            y,
            confidence,
        }
    }

    fn page_output(systems: Vec<ScanSystem>) -> ScanPageOutput {
        ScanPageOutput { systems }
    }

    /// A clean two-system page with a printed number pinning the first bar
    /// to 1 and nothing else remarkable: four bars per system, evenly spaced.
    fn clean_page(printed_numbers: Vec<PrintedNumber>) -> ScanPageOutput {
        page_output(vec![
            system(
                0.10,
                0.25,
                0.10,
                0.90,
                vec![0.30, 0.50, 0.70, 0.90],
                printed_numbers,
            ),
            system(0.35, 0.50, 0.10, 0.90, vec![0.30, 0.50, 0.70, 0.90], vec![]),
        ])
    }

    // ── clean scan: zero conflicts, correct numbering ───────────────────

    #[test]
    fn clean_three_page_scan_reconciles_with_zero_conflicts_and_correct_numbering() {
        let pages = vec![
            (1, clean_page(vec![printed(1, 0.10, 0.09, 0.95)])),
            (2, clean_page(vec![printed(9, 0.10, 0.09, 0.95)])),
            (3, clean_page(vec![printed(17, 0.10, 0.09, 0.95)])),
        ];
        let result = reconcile(pages, None, vec![]);
        assert!(
            result.conflicts.is_empty(),
            "expected zero conflicts, got {:?}",
            result.conflicts
        );
        assert_eq!(result.total_bars, 24);
        // Page 1: bars 1..=8 (two systems of four).
        assert_eq!(
            result.pages[0]
                .map
                .systems
                .iter()
                .flat_map(|s| s.bars.iter().map(|b| b.number))
                .collect::<Vec<_>>(),
            vec![1, 2, 3, 4, 5, 6, 7, 8]
        );
        // Page 3's first bar continues the sequence at 17 exactly.
        assert_eq!(result.pages[2].map.systems[0].bars[0].number, 17);
        // Anchored bars carry the pinning confidence; interpolated ones don't.
        assert_eq!(
            result.pages[0].map.systems[0].bars[0].confidence,
            Some(0.95)
        );
        assert_eq!(result.pages[0].map.systems[0].bars[1].confidence, None);
        assert!(result
            .pages
            .iter()
            .flat_map(|p| p.map.systems.iter())
            .flat_map(|s| s.bars.iter())
            .all(|b| b.source == MapBarSource::Model));
    }

    // ── defensive sort: shuffled system order still numbers correctly ──

    #[test]
    fn shuffled_system_order_is_defensively_sorted_before_numbering() {
        // Same two systems as `clean_page`, but reported bottom system first
        // — the model must never be trusted to have ordered them.
        let shuffled = page_output(vec![
            system(0.35, 0.50, 0.10, 0.90, vec![0.30, 0.50, 0.70, 0.90], vec![]),
            system(
                0.10,
                0.25,
                0.10,
                0.90,
                vec![0.30, 0.50, 0.70, 0.90],
                vec![printed(1, 0.10, 0.09, 0.95)],
            ),
        ]);
        let result = reconcile(vec![(1, shuffled)], None, vec![]);
        assert!(result.conflicts.is_empty());
        // Still numbered 1..=8 top-to-bottom despite the shuffled input.
        assert_eq!(
            result.pages[0]
                .map
                .systems
                .iter()
                .flat_map(|s| s.bars.iter().map(|b| b.number))
                .collect::<Vec<_>>(),
            vec![1, 2, 3, 4, 5, 6, 7, 8]
        );
        // The output system order is itself sorted by y_top (first system's
        // y_top is 0.10, the lower one 0.35).
        assert_eq!(result.pages[0].map.systems[0].y_top, 0.10);
        assert_eq!(result.pages[0].map.systems[1].y_top, 0.35);
    }

    // ── printed-number anchor pulls a miscounted system into conflict ──

    #[test]
    fn a_printed_number_anchor_flags_a_miscounted_system_as_continuity_break() {
        // System 1: 4 bars, anchored to start at 1 (bars 1..=4).
        // System 2: only 3 bars but a printed "9" pins its first bar — the
        // model missed a barline, so the anchor gap (9-1=8) doesn't match
        // the actual barline count between the anchors (4).
        let noisy = page_output(vec![
            system(
                0.10,
                0.25,
                0.10,
                0.90,
                vec![0.30, 0.50, 0.70, 0.90],
                vec![printed(1, 0.10, 0.09, 0.95)],
            ),
            system(
                0.35,
                0.50,
                0.10,
                0.90,
                vec![0.40, 0.65, 0.90],
                vec![printed(9, 0.10, 0.345, 0.95)],
            ),
        ]);
        let result = reconcile(vec![(1, noisy)], None, vec![]);
        let breaks: Vec<_> = result
            .conflicts
            .iter()
            .filter(|c| matches!(c, MapConflict::ContinuityBreak { .. }))
            .collect();
        assert_eq!(
            breaks.len(),
            1,
            "expected exactly one continuity break: {:?}",
            result.conflicts
        );
        assert_eq!(
            breaks[0],
            &MapConflict::ContinuityBreak {
                page: 1,
                system: 1,
                expected: 8,
                found: 4,
            }
        );
    }

    /// The clean sibling of the above: same shape, but the barline count
    /// between anchors DOES match what the anchors imply — no conflict.
    #[test]
    fn a_printed_number_anchor_matching_the_barline_count_produces_no_conflict() {
        let clean = page_output(vec![
            system(
                0.10,
                0.25,
                0.10,
                0.90,
                vec![0.30, 0.50, 0.70, 0.90],
                vec![printed(1, 0.10, 0.09, 0.95)],
            ),
            system(
                0.35,
                0.50,
                0.10,
                0.90,
                vec![0.30, 0.50, 0.70, 0.90],
                vec![printed(5, 0.10, 0.345, 0.95)],
            ),
        ]);
        let result = reconcile(vec![(1, clean)], None, vec![]);
        assert!(result.conflicts.is_empty(), "{:?}", result.conflicts);
    }

    // ── pickup handling, with and without a pinning printed number ─────

    #[test]
    fn pickup_without_a_pinning_printed_number_defaults_to_one_with_a_conflict() {
        let page = clean_page(vec![]); // no printed numbers at all
        let xml = XmlTotals {
            max_measure: 8,
            has_pickup: true,
        };
        let result = reconcile(vec![(1, page)], Some(xml), vec![]);
        assert!(result
            .conflicts
            .iter()
            .any(|c| matches!(c, MapConflict::PickupAmbiguity { page: 1 })));
        assert_eq!(result.pages[0].map.systems[0].bars[0].number, 1);
    }

    #[test]
    fn pickup_with_a_pinning_printed_number_starts_at_zero_with_no_ambiguity_conflict() {
        let page = clean_page(vec![printed(0, 0.10, 0.09, 0.95)]);
        let xml = XmlTotals {
            max_measure: 7,
            has_pickup: true,
        };
        let result = reconcile(vec![(1, page)], Some(xml), vec![]);
        assert!(!result
            .conflicts
            .iter()
            .any(|c| matches!(c, MapConflict::PickupAmbiguity { .. })));
        assert_eq!(result.pages[0].map.systems[0].bars[0].number, 0);
    }

    // ── total mismatch ───────────────────────────────────────────────

    #[test]
    fn total_mismatch_against_xml_max_measure_is_flagged() {
        let page = clean_page(vec![printed(1, 0.10, 0.09, 0.95)]); // 8 bars total, ends at 8
        let xml = XmlTotals {
            max_measure: 10,
            has_pickup: false,
        };
        let result = reconcile(vec![(1, page)], Some(xml), vec![]);
        assert!(result
            .conflicts
            .contains(&MapConflict::TotalMismatch { mapped: 8, xml: 10 }));
    }

    #[test]
    fn total_matching_xml_max_measure_produces_no_total_mismatch_conflict() {
        let page = clean_page(vec![printed(1, 0.10, 0.09, 0.95)]); // ends at 8
        let xml = XmlTotals {
            max_measure: 8,
            has_pickup: false,
        };
        let result = reconcile(vec![(1, page)], Some(xml), vec![]);
        assert!(!result
            .conflicts
            .iter()
            .any(|c| matches!(c, MapConflict::TotalMismatch { .. })));
    }

    // ── anchor disagreement (calibration) ───────────────────────────

    #[test]
    fn a_calibration_anchor_disagreeing_with_the_mapped_first_bar_is_flagged() {
        let page = clean_page(vec![printed(1, 0.10, 0.09, 0.95)]); // page 1 starts at bar 1
        let anchors = vec![CalibrationAnchor {
            page: 1,
            measure: 5,
        }];
        let result = reconcile(vec![(1, page)], None, anchors);
        assert!(result.conflicts.contains(&MapConflict::AnchorDisagreement {
            page: 1,
            anchor_measure: 5,
            mapped_measure: 1,
        }));
    }

    #[test]
    fn a_calibration_anchor_agreeing_with_the_mapped_first_bar_is_not_flagged() {
        let page = clean_page(vec![printed(1, 0.10, 0.09, 0.95)]);
        let anchors = vec![CalibrationAnchor {
            page: 1,
            measure: 1,
        }];
        let result = reconcile(vec![(1, page)], None, anchors);
        assert!(!result
            .conflicts
            .iter()
            .any(|c| matches!(c, MapConflict::AnchorDisagreement { .. })));
    }

    // ── low confidence anchor ───────────────────────────────────────

    #[test]
    fn a_low_confidence_printed_number_is_flagged_and_not_used_as_an_anchor() {
        let page = page_output(vec![system(
            0.10,
            0.25,
            0.10,
            0.90,
            vec![0.30, 0.50, 0.70, 0.90],
            vec![printed(1, 0.10, 0.09, 0.4)],
        )]);
        let result = reconcile(vec![(1, page)], None, vec![]);
        assert!(result
            .conflicts
            .contains(&MapConflict::LowConfidenceAnchor {
                page: 1,
                system: 1,
                measure: 1,
                confidence: 0.4,
            }));
        // Not used as an anchor: numbering fell back to the implicit start (1).
        assert_eq!(result.pages[0].map.systems[0].bars[0].number, 1);
        assert_eq!(result.pages[0].map.systems[0].bars[0].confidence, None);
    }

    /// A printed number's `number` is untrusted model input with no upper
    /// bound (only coordinates/confidence are range-checked) — a
    /// pathological reply near `u32::MAX` must saturate the forward-fill,
    /// never panic on overflow.
    #[test]
    fn a_pathologically_large_printed_number_saturates_instead_of_overflowing() {
        let page = page_output(vec![system(
            0.10,
            0.25,
            0.10,
            0.90,
            vec![0.30, 0.50, 0.70, 0.90],
            vec![printed(u32::MAX, 0.10, 0.09, 0.95)],
        )]);
        let result = reconcile(vec![(1, page)], None, vec![]);
        let numbers: Vec<u32> = result.pages[0]
            .map
            .systems
            .iter()
            .flat_map(|s| s.bars.iter().map(|b| b.number))
            .collect();
        assert_eq!(numbers, vec![u32::MAX, u32::MAX, u32::MAX, u32::MAX]);
    }

    // ── hallucinated extra system (y-band overlap) ──────────────────

    #[test]
    fn two_systems_with_overlapping_y_bands_are_flagged_as_overlapping() {
        // A real system 0.10..0.30, plus a hallucinated "extra" system whose
        // band overlaps it by well over 20% of the smaller (second) band's
        // height (0.10 tall; overlap here is 0.10 -> 100%).
        let page = page_output(vec![
            system(0.10, 0.30, 0.10, 0.90, vec![0.30, 0.50, 0.90], vec![]),
            system(0.15, 0.25, 0.10, 0.90, vec![0.30, 0.90], vec![]),
        ]);
        let result = reconcile(vec![(1, page)], None, vec![]);
        assert!(result
            .conflicts
            .iter()
            .any(|c| matches!(c, MapConflict::OverlappingSystems { page: 1, .. })));
    }

    #[test]
    fn two_systems_with_a_small_touching_overlap_under_the_tolerance_are_not_flagged() {
        // Bands share a hairline sliver well under 20% of the smaller
        // (0.15-tall) band's height.
        let page = page_output(vec![
            system(0.10, 0.30, 0.10, 0.90, vec![0.30, 0.50, 0.90], vec![]),
            system(0.301, 0.451, 0.10, 0.90, vec![0.30, 0.90], vec![]),
        ]);
        let result = reconcile(vec![(1, page)], None, vec![]);
        assert!(!result
            .conflicts
            .iter()
            .any(|c| matches!(c, MapConflict::OverlappingSystems { .. })));
    }

    // ── prompt regression: pin the load-bearing substrings (C2 carry-forward) ──

    #[test]
    fn scan_page_prompt_v1_pins_the_system_shape_examples_and_no_inferring_instruction() {
        assert!(
            SCAN_PAGE_PROMPT_V1.contains("Grand staff (solo piano, 2 staves bracketed together):")
        );
        assert!(SCAN_PAGE_PROMPT_V1
            .contains("Multi-instrument system (e.g. a trio, 3 staves bracketed together):"));
        assert!(SCAN_PAGE_PROMPT_V1.contains("Single-line system (one melodic staff, no bracket):"));
        assert!(SCAN_PAGE_PROMPT_V1.contains(
            "NEVER infer, guess, or count out a measure number that is not actually printed on the page"
        ));
    }
}
