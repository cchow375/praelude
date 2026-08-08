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
//! # Numbering (the contract C4's TS mirror must match)
//!
//! Bars are laid out into one global, page-ordered / system-ordered (by
//! sorted `y_top`) / bar-ordered stream. Every printed number with
//! confidence at least 0.5, anywhere in the stream, is a numbering anchor
//! (an `{index, number}` pair). Numbering is genuinely BIDIRECTIONAL around
//! those anchors:
//!
//! - **>= 1 printed anchor exists**: NO synthetic anchor is added. The span
//!   BEFORE the first anchor is back-filled FROM it (`first.number - (dist)`
//!   walking backward), clamped at the pickup floor (1, or 0 when
//!   `has_pickup`) — an underflow (the anchor's number can't reach back that
//!   far) clamps to the floor AND raises a `continuity_break` on that
//!   leading span (`page`/`system` of the very first bar; `expected` =
//!   anchor number minus the floor, `found` = bars actually available
//!   before the anchor). From the first anchor onward, every span
//!   forward-fills from its nearest preceding anchor (mid-spans between two
//!   anchors, then the trailing span past the last one) — `pickup_ambiguity`
//!   never fires in this branch: any real anchor is treated as sufficient
//!   evidence for the whole stream's offset, pickup included.
//! - **Zero printed anchors exist**: a single synthetic anchor pins bar 0 to
//!   1, and (only in THIS branch) `has_pickup` raises `pickup_ambiguity`
//!   since there is no evidence at all for where the pickup boundary falls.
//!
//! Consecutive REAL printed anchors are cross-checked in their own pass: the
//! barline count between them must match what their numbers imply, else
//! `continuity_break`; a mismatch does not block numbering (both bars keep
//! `source: "model"` — this pass never guesses which anchor is "right", it
//! forward-fills through the break and lets the conflict carry the span).
//! The leading span's underflow check (above) is a SEPARATE, independent
//! branch — the pickup floor is never itself inserted as a real anchor and
//! never appears in that cross-check pass, it only gates the leading span's
//! own back-fill.
//!
//! # System-start bracketing (C6b)
//!
//! Task C6's real-API acceptance run (Chopin Scherzo No. 2, Ekier + Cortot)
//! found printed-number OCR essentially flawless (22/22 exact) but the
//! model's own per-system `barline_xs` COUNT unreliable in both directions,
//! with no exploitable pattern — a defect a `continuity_break`/calibration
//! pin can flag but structurally cannot repair, because the wrong thing is
//! "how many bar objects exist", not "which number an anchor bar shows".
//!
//! This module resolves the one case where the truth genuinely IS
//! recoverable without trusting the model's barline count at all: when two
//! consecutive real printed anchors each pin their own system's very first
//! bar (local index 0) AND are on immediately adjacent systems (the earlier
//! anchor's system, then the very next system in page/`y_top` stream
//! order — no unlabeled system in between), the number gap between them is
//! unambiguous ground truth for the FULL bar count of the earlier anchor's
//! system, independent of whatever `barline_xs` the model reported for it.
//! When the model's count already agrees, nothing changes (`source:
//! "model"` positions are kept as-is). When it disagrees, that system's
//! bars are resynthesized as N evenly spaced positions across its own
//! `x_left..x_right` span (N = the anchors' number gap), every one
//! `source: "interpolated"`, `confidence: None` — the model's individual
//! barline positions are no longer trusted for this system, even any that
//! happened to be at the right count by coincidence. This deliberately does
//! NOT raise a `continuity_break` for the resolved pair (the disagreement
//! was resolved, not merely flagged); a low-severity `derived_bar_count`
//! conflict is pushed instead so the review UI can still show that a
//! system's geometry was machine-corrected.
//!
//! A system whose start (or whose successor's start) has no real anchor —
//! e.g. this piece's convention that a page's first system is rarely itself
//! numbered — is simply NOT bracketed: it falls through to the ordinary
//! `continuity_break` handling above, unchanged.

use std::cmp::Ordering;

use serde::Serialize;

use crate::store::{
    CalibrationPoint, MapBar, MapBarSource, MapSystem, MeasureMapPage, MeasureMapPageRow,
};

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

/// One calibration line anchor, reduced to page + measure — a calibration
/// anchor asserts "page P's mapped run starts at measure M", checked against
/// the first mapped bar found on that page. Built by
/// [`topmost_calibration_anchors`] from `score_calibration_get`'s raw,
/// PER-SYSTEM `CalibrationPoint`s (see that function's doc comment for why).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CalibrationAnchor {
    pub page: u32,
    pub measure: u32,
}

/// Reduce a page's calibration line anchors to this pass's page-level
/// [`CalibrationAnchor`]s. `CalibrationPoint` is a PER-SYSTEM anchor — one
/// per system start on a page, each `{page, y, measure}` (see
/// `atlas/mapping/anchors.ts`'s `LineAnchor` doc comment) — not a whole-page
/// anchor. `reconcile` only checks a page's FIRST mapped bar, so comparing
/// every point on a page (each describing a different, lower system) would
/// produce false `anchor_disagreement`s on a correctly-mapped page. This
/// keeps only the minimum-`y` point per page (the page's topmost/first
/// system); richer per-system anchoring is future work.
///
/// Deliberately a `BTreeMap`, not a `HashMap`: this module's whole contract
/// is determinism (`reconcile` is a pure function), and downstream
/// `AnchorDisagreement` conflicts are pushed in this function's OUTPUT
/// order — a `HashMap`'s random per-instance hasher would make that order
/// (and so `ReconcileResult.conflicts`' order) vary run to run for the exact
/// same input, which a `BTreeMap`'s stable, page-ascending iteration order
/// rules out entirely.
pub fn topmost_calibration_anchors(points: &[CalibrationPoint]) -> Vec<CalibrationAnchor> {
    let mut topmost: std::collections::BTreeMap<i64, (f64, i64)> =
        std::collections::BTreeMap::new();
    for point in points {
        topmost
            .entry(point.page)
            .and_modify(|(y, measure)| {
                if point.y < *y {
                    *y = point.y;
                    *measure = point.measure;
                }
            })
            .or_insert((point.y, point.measure));
    }
    topmost
        .into_iter()
        .map(|(page, (_, measure))| CalibrationAnchor {
            page: page as u32,
            measure: measure as u32,
        })
        .collect()
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
    /// Low-severity, informational (C6b): this system's bar count came from
    /// the SYSTEM-START BRACKET RULE, not the model's own `barline_xs` —
    /// both this system's first bar AND the very next system's first bar
    /// carried real printed anchors, so the number gap between them is
    /// authoritative for how many bars actually exist in between, and the
    /// model's own count (`found`) disagreed with it (`expected`). The
    /// system's bars were resynthesized as `expected` evenly spaced
    /// positions across its own x-span (`source: interpolated`,
    /// `confidence: None` on every bar in it) rather than merely flagged —
    /// this never accompanies a `continuity_break` for the same pair (the
    /// disagreement was resolved, not left open). See
    /// `measure_reconcile`'s module doc comment, "System-start bracketing".
    DerivedBarCount {
        page: u32,
        system: u32,
        expected: u32,
        found: u32,
    },
    /// Two systems' y-bands overlap by more than the tolerance — the
    /// hallucinated-extra-system case: a model reply that invents a system
    /// whose band collides with a real one.
    OverlappingSystems {
        page: u32,
        system_a: u32,
        system_b: u32,
    },
    /// The reconciled output itself, independent of any numbering conflict,
    /// violates one of the FULL set of invariants
    /// `store::measure_map::Store::measure_map_apply` hard-rejects (see
    /// `apply_invariant_conflicts`'s doc comment for the complete list) — a
    /// page could otherwise reconcile with zero OTHER conflicts yet still be
    /// un-Applyable (e.g. garbage geometry reaching `reconcile` directly
    /// from an unvalidated caller, bypassing `ScanSystem::is_valid`'s own
    /// gate). `system` is the real 1-based system index for a defect scoped
    /// to one system, or `0` — a sentinel meaning "the whole page, no single
    /// system to blame" — for a page-/payload-level defect (a duplicate
    /// page, an oversized page). The review UI must treat this exactly like
    /// any other conflict for the Apply gate.
    Unapplyable {
        page: u32,
        system: u32,
        reason: String,
    },
}

/// The reconciled measure map: one `MeasureMapPage` per input page (in page
/// order), every conflict found, the total bar count mapped, and whether
/// this piece's numbering floor was 0 (a pickup) or 1 — carried through so a
/// downstream LOCAL renumber (the review UI's click-to-renumber, which has no
/// XML context of its own) can apply the exact same floor instead of
/// hardcoding 1. `false` whenever no MusicXML `XmlTotals` was available.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ReconcileResult {
    pub pages: Vec<MeasureMapPageRow>,
    pub conflicts: Vec<MapConflict>,
    pub total_bars: u32,
    pub has_pickup: bool,
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

/// One system's FINALIZED geometry, after the system-start bracket pass
/// (see the module doc comment). Unlike [`SystemWork`], this carries no
/// borrowed `printed_numbers` — printed-number resolution (Pass 2) always
/// runs against the model's ORIGINAL, unmodified geometry (a printed
/// number's x/y still describes where the model actually placed it, even
/// when this system's bar count is later overridden) and never needs to run
/// again afterward.
struct SystemFinal {
    page: u32,
    system: u32,
    y_top: f64,
    y_bottom: f64,
    x_left: f64,
    x_right: f64,
    bars_start: usize,
    bar_count: usize,
    /// `true` when this system's bars were resynthesized by the
    /// system-start bracket rule (evenly spaced, `source: interpolated`,
    /// `confidence: None`) rather than kept from the model's own
    /// `barline_xs` (`source: model`).
    interpolated: bool,
}

/// Find which system (by index into a `bars_start`/`bar_count`-aligned pair
/// of slices) a global bar-stream index falls inside — or, for an index that
/// lands exactly ON a system boundary with nothing spanning it (a zero-bar
/// system, or the very end of the stream), the system whose `bars_start`
/// exactly equals it. Used by the system-start bracket pass to remap a
/// printed anchor's index from the ORIGINAL bar stream to the FINAL one
/// after some systems' bar counts changed.
fn system_index_for(starts: &[usize], counts: &[usize], idx: usize) -> Option<usize> {
    for i in 0..starts.len() {
        let start = starts[i];
        let end = start + counts[i];
        if idx >= start && idx < end {
            return Some(i);
        }
    }
    starts.iter().rposition(|&start| start == idx)
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
/// number's x falls into: the first bar whose right edge is STRICTLY past
/// the number's x, or the last bar if the number's x is at or past every
/// bar (a printed number can sit slightly right of the barline it labels).
/// A number sitting exactly ON a barline is a tie between "end of the
/// preceding bar" and "start of the following bar" — ties break toward the
/// following bar (a printed number visually labels the bar it introduces,
/// not the one it closes), so the comparison is strict `<`, not `<=`.
fn bar_index_for_x(bar_right_edges: &[f64], x: f64) -> Option<usize> {
    if bar_right_edges.is_empty() {
        return None;
    }
    bar_right_edges
        .iter()
        .position(|right| x < *right)
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
/// Pickup rule: when `xml.has_pickup` is true, ANY printed number (confidence
/// at least 0.5) anywhere in the stream is treated as sufficient evidence to
/// derive the pickup offset by bidirectional back/forward fill; only when
/// there is NO printed anchor at all does numbering default to starting at 1
/// with a `pickup_ambiguity` conflict (the review UI lets the user renumber
/// to a 0-start).
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
                // A printed number resolved to a system with zero
                // `barline_xs` has no bar to pin — it is DROPPED here,
                // silently as far as numbering is concerned. The system
                // itself is not silently dropped, though: it still reaches
                // Pass 9 as a zero-bar `MapSystem`, which
                // `apply_invariant_conflicts` flags `Unapplyable` ("a system
                // needs at least one bar"), so the page surfaces as
                // un-Applyable rather than the missing number going
                // unnoticed.
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

    // Pass 3 (C6b): system-start bracket resolution. See the module doc
    // comment's "System-start bracketing" section for the full rationale.
    // Determined entirely from the ORIGINAL geometry/anchors above — no
    // cascading, since each system's bracket check only ever looks at its
    // own start and its immediate successor's start.
    let old_bars_start: Vec<usize> = system_works.iter().map(|s| s.bars_start).collect();
    let old_bar_count: Vec<usize> = system_works.iter().map(|s| s.bar_count).collect();
    let mut new_bar_count: Vec<usize> = old_bar_count.clone();
    for i in 0..system_works.len() {
        if i + 1 >= system_works.len() {
            continue;
        }
        let a_index = old_bars_start[i];
        let b_index = old_bars_start[i + 1];
        let Some(a) = printed_anchors
            .iter()
            .find(|anchor| anchor.index == a_index)
        else {
            continue;
        };
        let Some(b) = printed_anchors
            .iter()
            .find(|anchor| anchor.index == b_index)
        else {
            continue;
        };
        let expected = b.number.saturating_sub(a.number);
        let found = old_bar_count[i] as u32;
        // `expected == 0` (a degenerate/contradictory anchor pair) is left
        // to the ordinary continuity-break handling below rather than
        // synthesizing a zero-bar system.
        if expected == found || expected == 0 {
            continue;
        }
        conflicts.push(MapConflict::DerivedBarCount {
            page: system_works[i].page,
            system: system_works[i].system,
            expected,
            found,
        });
        new_bar_count[i] = expected as usize;
    }

    // Rebuild bars_start cumulatively from the (possibly overridden) counts,
    // then the finalized per-system geometry and the finalized bar stream:
    // an overridden system's bars are N evenly spaced synthetic positions
    // across its own x-span; every other system keeps the model's own
    // `barline_xs` positions verbatim, unchanged from Pass 1.
    let mut new_bars_start: Vec<usize> = Vec::with_capacity(system_works.len());
    let mut cursor = 0usize;
    for &count in &new_bar_count {
        new_bars_start.push(cursor);
        cursor += count;
    }
    let systems_final: Vec<SystemFinal> = system_works
        .iter()
        .enumerate()
        .map(|(i, s)| SystemFinal {
            page: s.page,
            system: s.system,
            y_top: s.y_top,
            y_bottom: s.y_bottom,
            x_left: s.x_left,
            x_right: s.x_right,
            bars_start: new_bars_start[i],
            bar_count: new_bar_count[i],
            interpolated: new_bar_count[i] != old_bar_count[i],
        })
        .collect();
    let old_bar_works = bar_works;
    let mut bar_works: Vec<BarWork> = Vec::with_capacity(cursor);
    for (i, system) in systems_final.iter().enumerate() {
        if system.interpolated {
            let width = (system.x_right - system.x_left) / system.bar_count as f64;
            for j in 0..system.bar_count {
                bar_works.push(BarWork {
                    page: system.page,
                    system: system.system,
                    x_right: system.x_left + width * (j as f64 + 1.0),
                });
            }
        } else {
            let start = old_bars_start[i];
            for k in 0..system.bar_count {
                bar_works.push(BarWork {
                    page: system.page,
                    system: system.system,
                    x_right: old_bar_works[start + k].x_right,
                });
            }
        }
    }

    // Remap every printed anchor's stream index from the ORIGINAL bar
    // stream to the FINAL one. Unaffected systems remap 1:1 (their local
    // index is unchanged, only the global offset shifts by whatever earlier
    // systems' counts changed); an overridden system's own bracketing
    // anchor (always local index 0, by construction of the bracket check
    // above) remaps to the new system's local index 0 too, so the pair's
    // own continuity check below naturally finds `found == expected` with
    // no special-casing. Any OTHER anchor that happened to fall inside an
    // overridden system (rare — this piece's convention is one printed
    // number per system, at its start) is remapped proportionally, since
    // its original local position is no longer meaningful once the
    // system's bars were resynthesized.
    let printed_anchors: Vec<Anchor> = printed_anchors
        .into_iter()
        .map(|anchor| {
            let Some(sys) = system_index_for(&old_bars_start, &old_bar_count, anchor.index) else {
                return anchor;
            };
            let local = anchor.index - old_bars_start[sys];
            let old_c = old_bar_count[sys];
            let new_c = new_bar_count[sys];
            let new_local = if old_c == 0 || old_c == new_c {
                local.min(new_c.saturating_sub(1))
            } else {
                (local * new_c / old_c).min(new_c.saturating_sub(1))
            };
            Anchor {
                index: new_bars_start[sys] + new_local,
                ..anchor
            }
        })
        .collect();

    // Pass 4: printed anchors establish the numbering; a synthetic 1-start
    // is used ONLY when there is no printed anchor anywhere in the whole
    // stream. When at least one printed anchor exists, it is trusted to
    // determine numbers both forward AND backward from it — a pickup offset
    // is only truly ambiguous when there is zero evidence to derive it from.
    let has_pickup = xml.map(|x| x.has_pickup).unwrap_or(false);
    let floor: u32 = if has_pickup { 0 } else { 1 };
    let mut anchors_sorted = printed_anchors.clone();
    if anchors_sorted.is_empty() {
        if has_pickup {
            conflicts.push(MapConflict::PickupAmbiguity {
                page: bar_works.first().map(|b| b.page).unwrap_or(1),
            });
        }
        if let Some(first) = bar_works.first() {
            anchors_sorted.push(Anchor {
                index: 0,
                number: 1,
                page: first.page,
                system: first.system,
                confidence: None,
            });
        }
    }

    // Pass 5: continuity checks between consecutive printed anchors (the
    // barline count between two anchors must match what their numbers
    // imply; also fires when a later anchor's number is not greater). A
    // pair resolved by Pass 3's bracket rule naturally finds `found ==
    // expected` here (see that pass's remap comment) — no special-casing
    // needed to suppress a `continuity_break` for it.
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

    // Pass 6: true bidirectional numbering. The span BEFORE the first
    // anchor back-fills FROM it (clamped at the pickup floor — 1, or 0 when
    // `has_pickup` — with an underflow `continuity_break` on that leading
    // span when the anchor's number can't reach back that far); every span
    // from the first anchor onward forward-fills from its nearest preceding
    // anchor (mid-spans between anchors, then the trailing span past the
    // last one).
    let mut assigned: Vec<u32> = vec![0; bar_works.len()];
    if let Some(first_anchor) = anchors_sorted.first().copied() {
        if first_anchor.index > 0 {
            let unclamped_start = first_anchor.number as i64 - first_anchor.index as i64;
            let clamped_start = unclamped_start.max(i64::from(floor)) as u32;
            if unclamped_start < i64::from(floor) {
                conflicts.push(MapConflict::ContinuityBreak {
                    page: bar_works[0].page,
                    system: bar_works[0].system,
                    expected: first_anchor.number.saturating_sub(floor),
                    found: first_anchor.index as u32,
                });
            }
            for (i, number) in assigned[..first_anchor.index].iter_mut().enumerate() {
                *number = clamped_start.saturating_add(i as u32);
            }
        }

        let mut anchor_ptr = 0usize;
        for (i, number) in assigned.iter_mut().enumerate().skip(first_anchor.index) {
            while anchor_ptr + 1 < anchors_sorted.len() && anchors_sorted[anchor_ptr + 1].index <= i
            {
                anchor_ptr += 1;
            }
            let anchor = &anchors_sorted[anchor_ptr];
            // `anchor.number` is untrusted, model-reported input (a printed
            // number is never range-checked beyond being a `u32`) — a
            // pathological reply near `u32::MAX` must saturate, not panic.
            *number = anchor.number.saturating_add((i - anchor.index) as u32);
        }
    }

    // Confidence carried on the exact bar a printed number pinned; every
    // other bar (interpolated/forward-filled) carries `None`. An overridden
    // system's bars are forced to `None` below regardless of this map (Pass
    // 8), even for the local-index-0 bar that a real anchor pinned — the
    // model's OWN positions are no longer trusted for that system.
    let confidence_by_index: std::collections::HashMap<usize, f64> = printed_anchors
        .iter()
        .filter_map(|a| a.confidence.map(|c| (a.index, c)))
        .collect();

    // Pass 7: calibration anchor disagreement (first bar mapped per page).
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

    // Pass 8: total vs XML max_measure.
    if let (Some(xml), Some(&last)) = (xml, assigned.last()) {
        if last != xml.max_measure {
            conflicts.push(MapConflict::TotalMismatch {
                mapped: last,
                xml: xml.max_measure,
            });
        }
    }

    // Pass 9: reassemble the typed `MeasureMapPage` per page from the
    // FINALIZED system list (`systems_final`), not the original
    // `system_works` — an interpolated system's bars carry `source:
    // interpolated` / `confidence: None` unconditionally.
    let mut result_pages: Vec<MeasureMapPageRow> = Vec::with_capacity(pages.len());
    for (page, _) in &pages {
        let mut systems: Vec<MapSystem> = Vec::new();
        for system in systems_final.iter().filter(|s| s.page == *page) {
            let mut bars: Vec<MapBar> = Vec::with_capacity(system.bar_count);
            for local_idx in 0..system.bar_count {
                let global_idx = system.bars_start + local_idx;
                bars.push(MapBar {
                    x_right: bar_works[global_idx].x_right,
                    number: assigned[global_idx],
                    confidence: if system.interpolated {
                        None
                    } else {
                        confidence_by_index.get(&global_idx).copied()
                    },
                    source: if system.interpolated {
                        MapBarSource::Interpolated
                    } else {
                        MapBarSource::Model
                    },
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

    // Pass 10: the reconciled output can still violate an invariant
    // `measure_map_apply` hard-rejects even when every OTHER pass found no
    // conflict — not just an empty system or unsorted `barline_xs`, but
    // anything the payload validator would reject (out-of-range geometry
    // reaching `reconcile` directly, e.g. from an unvalidated caller, is
    // never itself checked by any earlier pass here). Surface every such
    // defect as `unapplyable` too, so a conflict-free result is genuinely
    // Apply-ready — see `apply_invariant_conflicts`'s own doc comment.
    conflicts.extend(apply_invariant_conflicts(&result_pages));

    ReconcileResult {
        pages: result_pages,
        conflicts,
        total_bars: bar_works.len() as u32,
        has_pickup,
    }
}

/// Re-check the assembled output against the FULL invariant list
/// `store::measure_map::Store::measure_map_apply` enforces, via
/// `store::measure_map_payload_defects` — page numbers, no duplicate pages,
/// the supported version, per-system geometry (finite 0..=1 fractions,
/// `y_top < y_bottom`, `x_left < x_right`), systems ordered top-to-bottom,
/// at least one bar per system, strictly increasing bar `x_right` within a
/// system, bar `confidence` in range when present, bar numbers strictly
/// increasing across the WHOLE result, and the serialized size cap. This
/// reuses that store-side checker rather than re-deriving the invariant list
/// by hand, so the two can never quietly drift apart. A page-/payload-level
/// defect (no single system to blame — a duplicate page, an oversized page)
/// reports `system: 0`, a sentinel meaning "the whole page", since
/// `MapConflict::Unapplyable.system` is not optional (real systems are
/// always numbered from 1 — see its own doc comment). A page whose own
/// numbering conflicts already flagged a break (e.g. a `continuity_break`)
/// will naturally also fail the number-monotonicity check here; this pass is
/// not gated on there being no other conflict — it is the last, independent
/// word on "can this actually be Applied".
fn apply_invariant_conflicts(pages: &[MeasureMapPageRow]) -> Vec<MapConflict> {
    crate::store::measure_map_payload_defects(pages)
        .into_iter()
        .map(|defect| MapConflict::Unapplyable {
            page: defect.page,
            system: defect.system.unwrap_or(0),
            reason: defect.reason,
        })
        .collect()
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

    // ── system-start bracket resolution (C6b) ───────────────────────────

    /// UPDATED for C6b (was
    /// `a_printed_number_anchor_flags_a_miscounted_system_as_continuity_break`,
    /// which asserted this exact shape produced a plain `continuity_break`).
    /// Both anchors here sit at their own system's first bar (system 1's "1"
    /// at local index 0, system 2's "9" at local index 0) on two immediately
    /// adjacent systems — exactly the case the system-start bracket rule now
    /// resolves deterministically instead of merely flagging: system 1's 4
    /// model-reported bars are wrong (the anchors imply 8), so its bars are
    /// resynthesized as 8 evenly spaced positions across its own x-span,
    /// `source: interpolated`, `confidence: None`, and NO `continuity_break`
    /// fires for this pair — a `derived_bar_count` conflict documents the
    /// resolution instead.
    #[test]
    fn a_derived_bar_count_overrides_a_wrong_model_count_via_even_interpolation() {
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
        assert!(
            !result
                .conflicts
                .iter()
                .any(|c| matches!(c, MapConflict::ContinuityBreak { .. })),
            "resolved disagreement must not also raise a continuity_break: {:?}",
            result.conflicts
        );
        assert!(
            result.conflicts.contains(&MapConflict::DerivedBarCount {
                page: 1,
                system: 1,
                expected: 8,
                found: 4,
            }),
            "{:?}",
            result.conflicts
        );

        let system1 = &result.pages[0].map.systems[0];
        assert_eq!(system1.bars.len(), 8, "{:?}", system1.bars);
        let numbers: Vec<u32> = system1.bars.iter().map(|b| b.number).collect();
        assert_eq!(numbers, (1..=8).collect::<Vec<u32>>());
        assert!(
            system1
                .bars
                .iter()
                .all(|b| b.source == MapBarSource::Interpolated && b.confidence.is_none()),
            "every bar in an overridden system must be interpolated with no confidence: {:?}",
            system1.bars
        );
        // Evenly spaced across x_left=0.10..x_right=0.90 in 8 equal steps of
        // 0.10 each: right edges 0.20, 0.30, ..., 0.90.
        let right_edges: Vec<f64> = system1.bars.iter().map(|b| b.x_right).collect();
        for (i, edge) in right_edges.iter().enumerate() {
            let expected_edge = 0.10 + 0.10 * (i as f64 + 1.0);
            assert!(
                (edge - expected_edge).abs() < 1e-9,
                "bar {i} right edge {edge} != {expected_edge}"
            );
        }
        // System 2 is untouched: still its own model-reported 3 bars,
        // `source: model`, starting at the anchor's own number (9).
        let system2 = &result.pages[0].map.systems[1];
        assert_eq!(system2.bars.len(), 3);
        assert_eq!(system2.bars[0].number, 9);
        assert!(system2.bars.iter().all(|b| b.source == MapBarSource::Model));
    }

    /// The clean sibling of the above: same bracketed shape, but the
    /// barline count between anchors DOES already match what the anchors
    /// imply — no conflict of any kind, and the model's own bar positions
    /// (`source: model`) are kept exactly as reported, not resynthesized.
    #[test]
    fn a_derived_bar_count_agreeing_with_the_model_keeps_its_positions() {
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
        let system1 = &result.pages[0].map.systems[0];
        assert!(system1.bars.iter().all(|b| b.source == MapBarSource::Model));
        assert_eq!(
            system1.bars.iter().map(|b| b.x_right).collect::<Vec<_>>(),
            vec![0.30, 0.50, 0.70, 0.90]
        );
    }

    /// A system whose start anchor exists but whose SUCCESSOR's start has no
    /// printed anchor (this piece's own convention: system 3's start is
    /// unlabeled) is NOT bracketed — the ordinary `continuity_break`
    /// handling from before C6b still applies unchanged, no
    /// `derived_bar_count` is produced, and no bars are resynthesized.
    #[test]
    fn a_system_whose_successor_start_is_unanchored_is_left_unbracketed() {
        let page = page_output(vec![
            system(
                0.10,
                0.25,
                0.10,
                0.90,
                vec![0.30, 0.50, 0.70, 0.90], // 4 bars, anchored "1"
                vec![printed(1, 0.10, 0.09, 0.95)],
            ),
            system(
                0.35,
                0.50,
                0.10,
                0.90,
                vec![0.40, 0.65, 0.90], // 3 bars, no printed number at all
                vec![],
            ),
            system(
                0.60,
                0.75,
                0.10,
                0.90,
                vec![0.30, 0.50, 0.70, 0.90], // system 3's start is anchored...
                vec![printed(20, 0.10, 0.595, 0.95)],
            ),
        ]);
        let result = reconcile(vec![(1, page)], None, vec![]);
        // ...but system 2's start (the anchor pair's PREDECESSOR system 1's
        // successor) is not, so system 1 -> system 3's anchor pair is not a
        // system-start bracket (system 1's immediate successor is system 2,
        // unanchored) — falls through to the plain continuity check across
        // the combined 7-bar span (system 1 + system 2).
        assert!(
            !result
                .conflicts
                .iter()
                .any(|c| matches!(c, MapConflict::DerivedBarCount { .. })),
            "{:?}",
            result.conflicts
        );
        assert!(result.conflicts.contains(&MapConflict::ContinuityBreak {
            page: 1,
            system: 1,
            expected: 19,
            found: 7,
        }));
        // Bars are untouched: still the model's original positions/counts.
        assert_eq!(result.pages[0].map.systems[0].bars.len(), 4);
        assert_eq!(result.pages[0].map.systems[1].bars.len(), 3);
        assert!(result.pages[0]
            .map
            .systems
            .iter()
            .flat_map(|s| s.bars.iter())
            .all(|b| b.source == MapBarSource::Model));
    }

    /// A mixed page: system 1->2 is a resolved bracket (model undercounted,
    /// gets interpolated), system 2->3 already agrees (untouched), pinning
    /// both C6b outcomes co-existing on one page.
    #[test]
    fn a_mixed_page_resolves_one_bracket_and_leaves_the_agreeing_one_untouched() {
        let page = page_output(vec![
            system(
                0.10,
                0.25,
                0.10,
                0.90,
                vec![0.30, 0.50, 0.70, 0.90], // 4 bars, model undercounts
                vec![printed(1, 0.10, 0.09, 0.95)],
            ),
            system(
                0.35,
                0.50,
                0.10,
                0.90,
                vec![0.20, 0.40, 0.60, 0.80, 0.90], // 5 bars, matches the 2->3 anchor gap exactly (9 -> 14 = 5)
                vec![printed(9, 0.10, 0.345, 0.95)],
            ),
            system(
                0.60,
                0.75,
                0.10,
                0.90,
                vec![0.30, 0.50, 0.70, 0.90], // 4 bars, irrelevant to the 2->3 bracket check
                vec![printed(14, 0.10, 0.595, 0.95)],
            ),
        ]);
        let result = reconcile(vec![(1, page)], None, vec![]);
        assert!(result.conflicts.contains(&MapConflict::DerivedBarCount {
            page: 1,
            system: 1,
            expected: 8,
            found: 4,
        }));
        assert!(
            !result
                .conflicts
                .iter()
                .any(|c| matches!(c, MapConflict::ContinuityBreak { .. })),
            "{:?}",
            result.conflicts
        );
        let system1 = &result.pages[0].map.systems[0];
        assert_eq!(system1.bars.len(), 8);
        assert!(system1
            .bars
            .iter()
            .all(|b| b.source == MapBarSource::Interpolated));
        let system2 = &result.pages[0].map.systems[1];
        assert_eq!(
            system2.bars.len(),
            5,
            "system 2 untouched: {:?}",
            system2.bars
        );
        assert!(system2.bars.iter().all(|b| b.source == MapBarSource::Model));
        assert_eq!(system2.bars[0].number, 9);
        let system3 = &result.pages[0].map.systems[2];
        assert_eq!(system3.bars.len(), 4);
        assert!(system3.bars.iter().all(|b| b.source == MapBarSource::Model));
        assert_eq!(system3.bars[0].number, 14);
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

    // ── bidirectional numbering (Fix round 1: back-fill from a real anchor) ──

    /// Reviewer probe 1 (verbatim): page 1 has 10 unnumbered bars; page 2's
    /// single bar carries a printed "15". The whole 10-bar leading span must
    /// back-fill FROM that anchor (5..14), not forward-fill from a synthetic
    /// 1-start (which would wrongly produce 1..10 plus a spurious
    /// continuity_break at the page boundary).
    #[test]
    fn a_printed_anchor_on_a_later_page_back_fills_the_whole_leading_span_cleanly() {
        let ten_bars: Vec<f64> = (1..=10).map(|i| 0.10 + f64::from(i) * 0.08).collect();
        let page1 = page_output(vec![system(0.10, 0.25, 0.10, 0.90, ten_bars, vec![])]);
        let page2 = page_output(vec![system(
            0.10,
            0.25,
            0.10,
            0.90,
            vec![0.90],
            vec![printed(15, 0.10, 0.09, 0.95)],
        )]);
        let result = reconcile(vec![(1, page1), (2, page2)], None, vec![]);
        assert!(
            result.conflicts.is_empty(),
            "expected zero conflicts, got {:?}",
            result.conflicts
        );
        let page1_numbers: Vec<u32> = result.pages[0].map.systems[0]
            .bars
            .iter()
            .map(|b| b.number)
            .collect();
        assert_eq!(page1_numbers, vec![5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
        assert_eq!(result.pages[1].map.systems[0].bars[0].number, 15);
    }

    /// Reviewer probe 2 (verbatim): a pickup piece where the printed "5"
    /// pins stream index 5 (the 6th bar), not index 0. True bidirectional
    /// fill must back-fill the 5 bars before it down to the pickup floor
    /// (0) exactly, landing on a fully monotonic 0..11 with NO
    /// pickup_ambiguity (a real anchor is evidence enough, wherever it
    /// sits).
    #[test]
    fn a_pickup_pinned_mid_stream_back_fills_to_the_zero_floor_monotonically() {
        let twelve_bars: Vec<f64> = (1..=12)
            .map(|i| 0.10 + f64::from(i) * 0.073_333_3)
            .collect();
        let page = page_output(vec![system(
            0.10,
            0.25,
            0.10,
            0.98,
            twelve_bars,
            vec![printed(5, 0.50, 0.09, 0.95)],
        )]);
        let xml = XmlTotals {
            max_measure: 11,
            has_pickup: true,
        };
        let result = reconcile(vec![(1, page)], Some(xml), vec![]);
        assert!(
            !result
                .conflicts
                .iter()
                .any(|c| matches!(c, MapConflict::PickupAmbiguity { .. })),
            "a real printed anchor is sufficient evidence, no pickup_ambiguity: {:?}",
            result.conflicts
        );
        let numbers: Vec<u32> = result.pages[0].map.systems[0]
            .bars
            .iter()
            .map(|b| b.number)
            .collect();
        assert_eq!(numbers, (0..=11).collect::<Vec<u32>>());
    }

    /// When back-filling from the first anchor would go below the pickup
    /// floor (1, no pickup here), the leading span clamps at the floor and
    /// raises a continuity_break instead of underflowing.
    #[test]
    fn back_fill_underflow_clamps_at_the_floor_and_raises_a_continuity_break() {
        let ten_bars: Vec<f64> = (1..=10).map(|i| 0.10 + f64::from(i) * 0.08).collect();
        let page = page_output(vec![system(
            0.10,
            0.25,
            0.10,
            0.90,
            ten_bars,
            vec![printed(3, 0.90, 0.09, 0.95)],
        )]);
        let result = reconcile(vec![(1, page)], None, vec![]);
        // The anchor pins local index 9 (the 10th bar); the leading span
        // before it is indices 0..9 — 9 bars available, not 10.
        assert!(result.conflicts.contains(&MapConflict::ContinuityBreak {
            page: 1,
            system: 1,
            expected: 2,
            found: 9,
        }));
        let numbers: Vec<u32> = result.pages[0].map.systems[0]
            .bars
            .iter()
            .map(|b| b.number)
            .collect();
        assert_eq!(numbers, vec![1, 2, 3, 4, 5, 6, 7, 8, 9, 3]);
    }

    // ── calibration anchors are per-system, not per-page (Fix round 1) ──

    #[test]
    fn topmost_calibration_anchors_keeps_only_the_minimum_y_point_per_page() {
        let points = vec![
            CalibrationPoint {
                page: 1,
                y: 0.60,
                measure: 9,
            },
            CalibrationPoint {
                page: 1,
                y: 0.10,
                measure: 1,
            },
            CalibrationPoint {
                page: 1,
                y: 0.35,
                measure: 5,
            },
        ];
        let anchors = topmost_calibration_anchors(&points);
        assert_eq!(
            anchors,
            vec![CalibrationAnchor {
                page: 1,
                measure: 1,
            }]
        );
    }

    #[test]
    fn three_per_system_calibration_points_on_one_correctly_mapped_page_produce_zero_disagreements()
    {
        let page = clean_page(vec![printed(1, 0.10, 0.09, 0.95)]); // page starts at bar 1
        let points = vec![
            CalibrationPoint {
                page: 1,
                y: 0.10,
                measure: 1,
            },
            CalibrationPoint {
                page: 1,
                y: 0.35,
                measure: 5,
            },
            CalibrationPoint {
                page: 1,
                y: 0.60,
                measure: 9,
            },
        ];
        let anchors = topmost_calibration_anchors(&points);
        let result = reconcile(vec![(1, page)], None, anchors);
        assert!(
            !result
                .conflicts
                .iter()
                .any(|c| matches!(c, MapConflict::AnchorDisagreement { .. })),
            "{:?}",
            result.conflicts
        );
    }

    /// Fix round 2, finding 1: `topmost_calibration_anchors` used to
    /// accumulate into a `HashMap` and return its (random-per-instance)
    /// iteration order, so `ReconcileResult.conflicts`' order for the SAME
    /// input varied run to run — a determinism violation in a module whose
    /// whole contract is "pure function, same input -> same output". Two
    /// pages that both disagree with their calibration anchor; run the
    /// whole round-trip 20 times in one process and require the exact same
    /// conflict list, in the exact same order, every time.
    #[test]
    fn calibration_disagreement_conflict_order_is_deterministic_across_runs() {
        // Deliberately inserted page-2-before-page-1 to prove the fix isn't
        // "happens to already be sorted" — a `BTreeMap` sorts by page
        // regardless of insertion order.
        let points = vec![
            CalibrationPoint {
                page: 2,
                y: 0.10,
                measure: 99,
            },
            CalibrationPoint {
                page: 1,
                y: 0.10,
                measure: 9,
            },
        ];
        let page1 = page_output(vec![system(
            0.10,
            0.25,
            0.10,
            0.90,
            vec![0.30, 0.60, 0.90],
            vec![],
        )]);
        let page2 = page_output(vec![system(
            0.10,
            0.25,
            0.10,
            0.90,
            vec![0.30, 0.60, 0.90],
            vec![],
        )]);
        // No printed anchors anywhere: numbering defaults to 1, 2, 3 (page
        // 1) then 4, 5, 6 (page 2) — deterministic on its own, independent
        // of the calibration-anchor-order bug this test targets.
        let expected = vec![
            MapConflict::AnchorDisagreement {
                page: 1,
                anchor_measure: 9,
                mapped_measure: 1,
            },
            MapConflict::AnchorDisagreement {
                page: 2,
                anchor_measure: 99,
                mapped_measure: 4,
            },
        ];

        for iteration in 0..20 {
            let anchors = topmost_calibration_anchors(&points);
            let result = reconcile(vec![(1, page1.clone()), (2, page2.clone())], None, anchors);
            let disagreements: Vec<MapConflict> = result
                .conflicts
                .into_iter()
                .filter(|c| matches!(c, MapConflict::AnchorDisagreement { .. }))
                .collect();
            assert_eq!(
                disagreements, expected,
                "conflict order must be deterministic (iteration {iteration})"
            );
        }
    }

    // ── unapplyable: conflict-free-yet-unapplyable outputs (Fix round 1, extended round 2) ──

    #[test]
    fn an_empty_barline_system_is_flagged_unapplyable_instead_of_silently_vanishing() {
        let page = page_output(vec![
            system(
                0.10,
                0.25,
                0.10,
                0.90,
                vec![0.30, 0.50, 0.70, 0.90],
                vec![printed(1, 0.10, 0.09, 0.95)],
            ),
            system(0.35, 0.50, 0.10, 0.90, vec![], vec![]),
        ]);
        let result = reconcile(vec![(1, page)], None, vec![]);
        // Reason text now comes verbatim from
        // `store::measure_map_payload_defects` (Fix round 2), not a
        // hand-rolled string, so it matches `validate_page_systems`'s own
        // wording exactly.
        assert!(result.conflicts.contains(&MapConflict::Unapplyable {
            page: 1,
            system: 2,
            reason: "a system needs at least one bar".to_string(),
        }));
    }

    #[test]
    fn unsorted_barline_xs_are_flagged_unapplyable() {
        // barline_xs out of ascending order: bar x_right ends up non-monotonic.
        let page = page_output(vec![system(
            0.10,
            0.25,
            0.10,
            0.90,
            vec![0.50, 0.30, 0.70, 0.90],
            vec![],
        )]);
        let result = reconcile(vec![(1, page)], None, vec![]);
        assert!(result.conflicts.iter().any(|c| matches!(
            c,
            MapConflict::Unapplyable {
                page: 1,
                system: 1,
                ..
            }
        )));
    }

    /// Fix round 2, finding 2 (probe-G, verbatim scenario): garbage geometry
    /// reaching `reconcile` DIRECTLY — simulating an unvalidated payload
    /// reaching the `measure_reconcile` command, bypassing
    /// `measure_scan::parse_scan_output`'s own `ScanSystem::is_valid` gate
    /// entirely (which `reconcile` itself never re-checks). Before this fix
    /// round, only "empty bars" and "unsorted barline_xs" were mirrored, so
    /// out-of-range coordinates like this reconciled with ZERO conflicts
    /// yet would still be hard-rejected by `measure_map_apply`. Now the full
    /// invariant list (via `store::measure_map_payload_defects`) catches it.
    #[test]
    fn garbage_geometry_reaching_reconcile_directly_is_flagged_unapplyable() {
        // y_top = 1.5 is out of the 0.0..=1.0 normalized-fraction range.
        let page = page_output(vec![system(1.5, 1.6, 0.10, 0.90, vec![0.30, 0.90], vec![])]);
        let result = reconcile(vec![(1, page)], None, vec![]);
        assert!(
            result
                .conflicts
                .iter()
                .any(|c| matches!(c, MapConflict::Unapplyable { page: 1, .. })),
            "expected an Unapplyable conflict for out-of-range geometry, got {:?}",
            result.conflicts
        );
    }

    // ── bar_index_for_x exact-boundary tie-break (Fix round 1) ──

    #[test]
    fn a_printed_number_exactly_on_a_barline_resolves_to_the_following_bar() {
        let right_edges = vec![0.30, 0.50, 0.70, 0.90];
        // Exactly on barline index 1 (0.50): must resolve to bar index 2
        // (the bar it STARTS), not bar index 1 (the bar it closes).
        assert_eq!(bar_index_for_x(&right_edges, 0.50), Some(2));
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

    // ── has_pickup on ReconcileResult (fix round 1) ─────────────────────────

    #[test]
    fn result_carries_has_pickup_true_when_xml_says_so() {
        let pages = vec![(1, clean_page(vec![printed(0, 0.10, 0.09, 0.95)]))];
        let xml = Some(XmlTotals {
            max_measure: 8,
            has_pickup: true,
        });
        let result = reconcile(pages, xml, vec![]);
        assert!(result.has_pickup);
    }

    #[test]
    fn result_carries_has_pickup_false_when_no_xml_is_available() {
        let pages = vec![(1, clean_page(vec![printed(1, 0.10, 0.09, 0.95)]))];
        let result = reconcile(pages, None, vec![]);
        assert!(!result.has_pickup);
    }
}
