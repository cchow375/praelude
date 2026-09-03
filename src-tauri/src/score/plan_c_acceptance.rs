//! Task C6: REAL-API acceptance harness (Plan C, `v6/plan-c`).
//!
//! `#[ignore]`d by default — these tests hit the real Claude/Gemini vision
//! API (Keychain-resolved key, `security find-generic-password -s codakiller
//! -a claude -w` / `-a gemini -w`, falling back to `ANTHROPIC_API_KEY` /
//! `GEMINI_API_KEY`) over the real network, against Christian's real vault
//! files. Every other test in this crate stays offline (`FakeTransport`);
//! this module is the one deliberate exception, and it is test-only code —
//! nothing here is reachable from the app's production paths.
//!
//! Zero writes to the live DB: both tests open a throwaway `Store::open(":memory:")`
//! and register the real vault piece folder into THAT, never touching
//! Praelude's real sqlite file. The vault PDF/MusicXML/JPEGs are read-only
//! inputs — nothing here ever writes into the vault.
//!
//! Run with:
//! ```text
//! cd src-tauri && cargo test --lib -- --ignored plan_c_acceptance --nocapture
//! ```
//! Evidence prints as one `PAGE_EVIDENCE {json}` / `CORTOT_EVIDENCE {json}`
//! line per page to stderr; `docs/qa/plan-c-scherzo-acceptance.md` is the
//! human-written report built from that output plus the pre-existing
//! hand-verified ground truth in `docs/qa/premap/scherzo-op31-ekier.log.md`.

use std::path::{Path, PathBuf};
use std::time::Instant;

use serde::Serialize;

use crate::brain::{score_xml_measure_facts, NativeTransport, ProviderChain};
use crate::score::measure_reconcile::{self, CalibrationAnchor, MapConflict, XmlTotals};
use crate::score::measure_scan::{measure_scan_page, ScanError, ScanPageOutput};
use crate::store::model::ScanPiece;
use crate::store::Store;

/// The real vault piece folder. Read-only input; never written to.
fn piece_folder() -> PathBuf {
    PathBuf::from(
        "/Users/c3/Desktop/christian's universe/Piano Practice/Pieces/Chopin - Scherzo No.2 Op.31",
    )
}

const EKIER_EDITION_ID: &str = "score/ekierscherzochopin2.pdf";
const XML_REL: &str = "score/Chopin Scherzo No.2 Op.31 (KernScores, measure-accurate).musicxml";
const CORTOT_DIR_REL: &str = "score/Cortot Scherzos 1-2 (Salabert, Slideshare scan)";
const EKIER_PAGE_COUNT: u32 = 25;

/// Ground truth for the Ekier PDF's first-printed-number per page, hand-
/// verified against the printed score and re-checked against the MusicXML
/// in `docs/qa/premap/scherzo-op31-ekier.log.md` (2026-08-xx pre-map pass,
/// prior to this task). Page 1 is the title page (no music, no anchor).
/// This is what a reviewer pinning each page's first system in the review
/// UI would type in, were the model's own reading to disagree.
const EKIER_PAGE_START_MEASURE: &[(u32, u32)] = &[
    (2, 1),
    (3, 44),
    (4, 77),
    (5, 103),
    (6, 133),
    (7, 176),
    (8, 209),
    (9, 235),
    (10, 265),
    (11, 304),
    (12, 334),
    (13, 366),
    (14, 406),
    (15, 436),
    (16, 468),
    (17, 494),
    (18, 524),
    (19, 552),
    (20, 584),
    (21, 627),
    (22, 658),
    (23, 683),
    (24, 708),
    (25, 740),
];

/// Set up a throwaway in-memory store with the real vault piece registered,
/// so `measure_scan_page`'s edition-discovery and `score_xml_measure_facts`'s
/// MusicXML resolution both run against the real files without ever opening
/// Praelude's real database.
fn scratch_store_with_piece() -> (Store, i64) {
    let folder = piece_folder();
    assert!(
        folder.is_dir(),
        "vault piece folder not found at {folder:?} — this test only runs on Christian's \
         dev machine with the vault mounted"
    );
    let store = Store::open(":memory:").expect("open in-memory scratch store");
    let piece_id = store
        .upsert_piece(&ScanPiece {
            folder_path: folder.to_string_lossy().into_owned(),
            title: "Scherzo No. 2, Op. 31 (acceptance run)".into(),
            composer: Some("Chopin".into()),
            xml_path: Some(folder.join(XML_REL)),
            pdf_path: Some(folder.join(EKIER_EDITION_ID)),
        })
        .expect("register the real vault piece into the scratch store");
    (store, piece_id)
}

/// Rasterize one PDF page to a JPEG at ~200dpi via `pdftoppm`, standing in
/// for the browser-canvas client-raster path the frontend would use on a
/// `needs_client_raster` refusal. Documented substitution — see the
/// acceptance doc.
fn pdftoppm_rasterize(pdf: &Path, page: u32, out_dir: &Path) -> Vec<u8> {
    let prefix = out_dir.join(format!("ekier-p{page}"));
    let status = std::process::Command::new("pdftoppm")
        .args([
            "-jpeg",
            "-r",
            "200",
            "-f",
            &page.to_string(),
            "-l",
            &page.to_string(),
            "-singlefile",
        ])
        .arg(pdf)
        .arg(&prefix)
        .status()
        .expect("run pdftoppm (poppler must be installed: brew install poppler)");
    assert!(status.success(), "pdftoppm failed for page {page}");
    let jpeg_path = prefix.with_extension("jpg");
    std::fs::read(&jpeg_path).unwrap_or_else(|e| panic!("read rasterized {jpeg_path:?}: {e}"))
}

#[derive(Debug, Serialize)]
struct PageEvidence {
    page: u32,
    needed_client_raster: bool,
    latency_ms: u128,
    error: Option<String>,
    systems: usize,
    bars: usize,
    printed_numbers: Vec<PrintedNumberEvidence>,
}

#[derive(Debug, Serialize)]
struct PrintedNumberEvidence {
    number: u32,
    confidence: f64,
}

fn evidence_of(
    page: u32,
    needed_client_raster: bool,
    latency_ms: u128,
    result: &Result<ScanPageOutput, ScanError>,
) -> PageEvidence {
    match result {
        Ok(output) => PageEvidence {
            page,
            needed_client_raster,
            latency_ms,
            error: None,
            systems: output.systems.len(),
            bars: output.systems.iter().map(|s| s.barline_xs.len()).sum(),
            printed_numbers: output
                .systems
                .iter()
                .flat_map(|s| s.printed_numbers.iter())
                .map(|n| PrintedNumberEvidence {
                    number: n.number,
                    confidence: n.confidence,
                })
                .collect(),
        },
        Err(error) => PageEvidence {
            page,
            needed_client_raster,
            latency_ms,
            error: Some(error.to_string()),
            systems: 0,
            bars: 0,
            printed_numbers: Vec::new(),
        },
    }
}

/// Acceptance criterion 1+2: scan every Ekier page, reconcile against the
/// MusicXML, simulate review-UI pins on any page that disagrees with the
/// hand-verified ground truth, and check the vault landmarks (m.67, m.95)
/// locate to the right pages.
#[test]
#[ignore = "real network + real vision API cost; run explicitly for C6 acceptance"]
fn ekier_full_scan_reconcile_and_landmark_check() {
    let (store, piece_id) = scratch_store_with_piece();
    let chain = ProviderChain::from_native_config_with_preference(None);
    assert!(
        !chain.is_empty(),
        "no Claude/Gemini key resolved via Keychain or env — this test requires a real key"
    );
    let transport = NativeTransport::new();
    let raster_dir = std::env::temp_dir().join("plan-c-acceptance-ekier");
    std::fs::create_dir_all(&raster_dir).unwrap();
    // Resumable on-disk cache of each page's already-scanned `ScanPageOutput`,
    // keyed by page number. The real chain here resolved to Gemini-only (no
    // Claude/Anthropic key in Keychain — verified via `security
    // find-generic-password -s codakiller -a claude -w`), whose free-tier
    // rate limit means a cold run of all 25 pages hits intermittent HTTP 429s.
    // Caching successes to disk makes a re-run of this test pay only for the
    // pages still missing, instead of re-spending budget on ones that
    // already succeeded — the real point of the 40-call cap.
    let cache_dir = std::env::temp_dir().join("plan-c-acceptance-ekier-cache");
    std::fs::create_dir_all(&cache_dir).unwrap();

    let mut pages_for_reconcile: Vec<(u32, ScanPageOutput)> = Vec::new();
    let mut evidence: Vec<PageEvidence> = Vec::new();
    let mut real_calls_made = 0u32;

    for page in 1..=EKIER_PAGE_COUNT {
        let cache_path = cache_dir.join(format!("page-{page}.json"));
        if let Ok(cached) = std::fs::read_to_string(&cache_path) {
            if let Ok(output) = serde_json::from_str::<ScanPageOutput>(&cached) {
                eprintln!("plan-c-acceptance: ekier p{page} served from local cache, no API call");
                let ev = evidence_of(page, false, 0, &Ok(output.clone()));
                eprintln!("PAGE_EVIDENCE {}", serde_json::to_string(&ev).unwrap());
                pages_for_reconcile.push((page, output));
                evidence.push(ev);
                continue;
            }
        }

        let pdf_path = piece_folder().join(EKIER_EDITION_ID);
        let started = Instant::now();
        // A gentle pace between real calls to stay under Gemini's free-tier
        // RPM limit (empirically hit at back-to-back requests in the first
        // cold run of this test).
        if real_calls_made > 0 {
            std::thread::sleep(std::time::Duration::from_secs(5));
        }
        let first = measure_scan_page(
            &store,
            piece_id,
            EKIER_EDITION_ID,
            "acceptance-run",
            page,
            None,
            &chain,
            &transport,
        );
        real_calls_made += 1;
        let (needed_client_raster, mut result) = match first {
            Err(ScanError::NeedsClientRaster) => {
                let jpeg = pdftoppm_rasterize(&pdf_path, page, &raster_dir);
                let retry_started = Instant::now();
                let retried = measure_scan_page(
                    &store,
                    piece_id,
                    EKIER_EDITION_ID,
                    "acceptance-run",
                    page,
                    Some(jpeg),
                    &chain,
                    &transport,
                );
                real_calls_made += 1;
                eprintln!(
                    "plan-c-acceptance: ekier p{page} needed client raster; pdftoppm+rescan took {:?}",
                    retry_started.elapsed()
                );
                (true, retried)
            }
            other => (false, other),
        };
        // One bounded, budget-respecting retry after a cooldown when the
        // failure was specifically the rate limit (not a real content
        // problem) — the brief's "if a page loops >2 retries, move on" cap,
        // applied per page: this is retry #1, `measure_scan_page`'s own
        // internal parse-retry is a separate, already-accounted-for thing.
        if let Err(error) = &result {
            if error.to_string().contains("429") && real_calls_made < 40 {
                eprintln!("plan-c-acceptance: ekier p{page} rate-limited, cooling down 20s then retrying once");
                std::thread::sleep(std::time::Duration::from_secs(20));
                result = measure_scan_page(
                    &store,
                    piece_id,
                    EKIER_EDITION_ID,
                    "acceptance-run",
                    page,
                    None,
                    &chain,
                    &transport,
                );
                real_calls_made += 1;
            }
        }
        let latency_ms = started.elapsed().as_millis();
        let ev = evidence_of(page, needed_client_raster, latency_ms, &result);
        eprintln!("PAGE_EVIDENCE {}", serde_json::to_string(&ev).unwrap());
        if let Ok(output) = &result {
            let _ = std::fs::write(&cache_path, serde_json::to_string(output).unwrap());
            pages_for_reconcile.push((page, output.clone()));
        }
        evidence.push(ev);
        if real_calls_made >= 40 {
            eprintln!("plan-c-acceptance: hit the 40-real-call budget cap; remaining pages recorded as skipped");
            break;
        }
    }
    eprintln!("plan-c-acceptance: {real_calls_made} real API calls made this run");

    // Partial maps are legal (brief, budget guard): report honestly rather
    // than hard-failing when a handful of pages never came back clean.
    eprintln!(
        "plan-c-acceptance: {}/{} Ekier pages present in the reconciled map",
        pages_for_reconcile.len(),
        EKIER_PAGE_COUNT
    );

    let xml_facts = score_xml_measure_facts(&store, piece_id)
        .expect("parse the real KernScores MusicXML for max_measure/has_pickup");
    eprintln!(
        "XML_FACTS max_measure={:?} has_pickup={}",
        xml_facts.max_measure, xml_facts.has_pickup
    );
    let xml_totals = xml_facts.max_measure.map(|max_measure| XmlTotals {
        max_measure,
        has_pickup: xml_facts.has_pickup,
    });

    let first_pass =
        measure_reconcile::reconcile(pages_for_reconcile.clone(), xml_totals, Vec::new());
    eprintln!(
        "RECONCILE_FIRST_PASS total_bars={} has_pickup={} conflicts={}",
        first_pass.total_bars,
        first_pass.has_pickup,
        first_pass.conflicts.len()
    );
    for conflict in &first_pass.conflicts {
        eprintln!("CONFLICT_FIRST_PASS {conflict:?}");
    }

    // Acceptance criterion 2: resolve conflicts the way the review UI's pin
    // affordance would — a calibration anchor per page, taken from the
    // hand-verified ground truth log (docs/qa/premap/scherzo-op31-ekier.log.md),
    // for every page this run's own conflicts touched. Document each pin
    // (page, measure, why) via this eprintln — that's the acceptance
    // evidence for "resolved the way the review UI would".
    let conflicted_pages: std::collections::BTreeSet<u32> = first_pass
        .conflicts
        .iter()
        .filter_map(|c| match c {
            MapConflict::ContinuityBreak { page, .. } => Some(*page),
            MapConflict::AnchorDisagreement { page, .. } => Some(*page),
            MapConflict::PickupAmbiguity { page } => Some(*page),
            MapConflict::LowConfidenceAnchor { page, .. } => Some(*page),
            MapConflict::Unapplyable { page, .. } => Some(*page),
            MapConflict::OverlappingSystems { page, .. } => Some(*page),
            MapConflict::TotalMismatch { .. } => None,
            // Informational (C6b): this system's bars were already resolved
            // deterministically by the system-start bracket rule — nothing
            // for a review-UI-style pin to fix here.
            MapConflict::DerivedBarCount { .. } => None,
        })
        .collect();
    let mut pins: Vec<CalibrationAnchor> = Vec::new();
    for &page in &conflicted_pages {
        if let Some((_, measure)) = EKIER_PAGE_START_MEASURE.iter().find(|(p, _)| *p == page) {
            eprintln!(
                "PIN page={page} measure={measure} reason=\"review-UI-style pin from the hand-verified pre-map log (docs/qa/premap/scherzo-op31-ekier.log.md), because reconcile flagged a conflict on this page\""
            );
            pins.push(CalibrationAnchor {
                page,
                measure: *measure,
            });
        }
    }

    let final_result = measure_reconcile::reconcile(pages_for_reconcile, xml_totals, pins);
    eprintln!(
        "RECONCILE_FINAL total_bars={} has_pickup={} conflicts={}",
        final_result.total_bars,
        final_result.has_pickup,
        final_result.conflicts.len()
    );
    for conflict in &final_result.conflicts {
        eprintln!("CONFLICT_FINAL {conflict:?}");
    }

    // Acceptance criterion 2 (landmarks): m.67 -> PDF page 3, m.95 -> PDF
    // page 4 (verified against the printed score AND the MusicXML in the
    // pre-map log). Report where the map ACTUALLY locates each, rather than
    // asserting — a real-API run may legitimately fall short, and BLOCKED
    // is the correct report in that case, not a panic.
    for (landmark, expected_page) in [(67u32, 3u32), (95u32, 4u32)] {
        let located = final_result.pages.iter().find_map(|row| {
            row.map
                .systems
                .iter()
                .flat_map(|s| s.bars.iter())
                .any(|bar| bar.number == landmark)
                .then_some(row.page)
        });
        eprintln!(
            "LANDMARK measure={landmark} expected_page={expected_page} located_page={located:?}"
        );
    }

    // Sampled printed numbers vs the ground truth (acceptance criterion 2):
    // first page, last music page, and 3 more spread through the middle.
    for page in [2u32, 8, 14, 20, 25] {
        if let Some((_, expected)) = EKIER_PAGE_START_MEASURE.iter().find(|(p, _)| *p == page) {
            let mapped_first = final_result
                .pages
                .iter()
                .find(|row| row.page == page)
                .and_then(|row| row.map.systems.first())
                .and_then(|s| s.bars.first())
                .map(|b| b.number);
            eprintln!(
                "SAMPLE page={page} expected_first_measure={expected} mapped_first_measure={mapped_first:?}"
            );
        }
    }
}

#[derive(Debug, Serialize)]
struct CortotEvidence {
    file: String,
    latency_ms: u128,
    error: Option<String>,
    systems: usize,
    bars_per_system: Vec<usize>,
}

/// Acceptance criterion 3: 3 mid-piece Cortot scan pages, purely through the
/// client-raster arm (the on-disk JPEGs ARE the client raster — no PDF
/// rendering happens for this arm at all).
#[test]
#[ignore = "real network + real vision API cost; run explicitly for C6 acceptance"]
fn cortot_multi_staff_scan_sample() {
    let (store, piece_id) = scratch_store_with_piece();
    let chain = ProviderChain::from_native_config_with_preference(None);
    assert!(
        !chain.is_empty(),
        "no Claude/Gemini key resolved via Keychain or env — this test requires a real key"
    );
    let transport = NativeTransport::new();
    let cortot_dir = piece_folder().join(CORTOT_DIR_REL);

    // 3 mid-piece, clean grand-staff pages (no exercise/footnote clutter),
    // hand-picked by viewing the images before this run: page-28 (printed
    // p.29, Scherzo No.2 m.~61+), page-33 (p.34, m.~197+), page-48 (p.49,
    // m.~581+) per the set's own _README.md page map.
    for file in ["page-28.jpg", "page-33.jpg", "page-48.jpg"] {
        let path = cortot_dir.join(file);
        let jpeg = std::fs::read(&path).unwrap_or_else(|e| panic!("read {path:?}: {e}"));
        let started = Instant::now();
        let result = measure_scan_page(
            &store,
            piece_id,
            "cortot-client-raster",
            "acceptance-run-cortot",
            1,
            Some(jpeg),
            &chain,
            &transport,
        );
        let latency_ms = started.elapsed().as_millis();
        let ev = match &result {
            Ok(output) => CortotEvidence {
                file: file.into(),
                latency_ms,
                error: None,
                systems: output.systems.len(),
                bars_per_system: output.systems.iter().map(|s| s.barline_xs.len()).collect(),
            },
            Err(error) => CortotEvidence {
                file: file.into(),
                latency_ms,
                error: Some(error.to_string()),
                systems: 0,
                bars_per_system: Vec::new(),
            },
        };
        eprintln!("CORTOT_EVIDENCE {}", serde_json::to_string(&ev).unwrap());
    }
}

/// C6c re-evaluation: re-reconcile the Ekier scan purely from the C6/C6b
/// on-disk resumable cache (`plan-c-acceptance-ekier-cache`, same path/keying
/// as `ekier_full_scan_reconcile_and_landmark_check`) — ZERO real API calls,
/// ZERO network, ZERO Keychain lookup. Exists to check the C6c
/// (cross-page-bracket + XML-virtual-end-anchor) `measure_reconcile` changes
/// against the exact same real-model evidence C6/C6b already paid for,
/// without spending any more of the call budget. If the cache is missing or
/// incomplete this test still runs on whatever pages it finds (the harness's
/// own "partial maps are legal" posture) — it never itself calls
/// `measure_scan_page`.
#[test]
#[ignore = "reads the C6 cache; run explicitly for C6c re-evaluation (no network)"]
fn ekier_offline_reconcile_from_cache_c6c() {
    let (store, piece_id) = scratch_store_with_piece();
    let cache_dir = std::env::temp_dir().join("plan-c-acceptance-ekier-cache");

    let mut pages_for_reconcile: Vec<(u32, ScanPageOutput)> = Vec::new();
    let mut missing_pages: Vec<u32> = Vec::new();
    for page in 1..=EKIER_PAGE_COUNT {
        let cache_path = cache_dir.join(format!("page-{page}.json"));
        match std::fs::read_to_string(&cache_path)
            .ok()
            .and_then(|raw| serde_json::from_str::<ScanPageOutput>(&raw).ok())
        {
            Some(output) => pages_for_reconcile.push((page, output)),
            None => missing_pages.push(page),
        }
    }
    eprintln!(
        "plan-c-acceptance-c6c: {}/{} Ekier pages present from cache; missing: {:?}",
        pages_for_reconcile.len(),
        EKIER_PAGE_COUNT,
        missing_pages
    );

    let xml_facts = score_xml_measure_facts(&store, piece_id)
        .expect("parse the real KernScores MusicXML for max_measure/has_pickup");
    eprintln!(
        "XML_FACTS max_measure={:?} has_pickup={}",
        xml_facts.max_measure, xml_facts.has_pickup
    );
    let xml_totals = xml_facts.max_measure.map(|max_measure| XmlTotals {
        max_measure,
        has_pickup: xml_facts.has_pickup,
    });

    let first_pass =
        measure_reconcile::reconcile(pages_for_reconcile.clone(), xml_totals, Vec::new());
    eprintln!(
        "RECONCILE_FIRST_PASS_C6C total_bars={} has_pickup={} conflicts={}",
        first_pass.total_bars,
        first_pass.has_pickup,
        first_pass.conflicts.len()
    );
    for conflict in &first_pass.conflicts {
        eprintln!("CONFLICT_FIRST_PASS_C6C {conflict:?}");
    }

    // Same review-UI-style pin simulation as the real-API test: one
    // calibration anchor per page ANY conflict touched, from the
    // hand-verified ground truth. `derived_bar_count` deliberately does
    // NOT contribute a pin (see the match arm below) — it is already a
    // resolved, not merely flagged, disagreement.
    let conflicted_pages: std::collections::BTreeSet<u32> = first_pass
        .conflicts
        .iter()
        .filter_map(|c| match c {
            MapConflict::ContinuityBreak { page, .. } => Some(*page),
            MapConflict::AnchorDisagreement { page, .. } => Some(*page),
            MapConflict::PickupAmbiguity { page } => Some(*page),
            MapConflict::LowConfidenceAnchor { page, .. } => Some(*page),
            MapConflict::Unapplyable { page, .. } => Some(*page),
            MapConflict::OverlappingSystems { page, .. } => Some(*page),
            MapConflict::TotalMismatch { .. } => None,
            MapConflict::DerivedBarCount { .. } => None,
        })
        .collect();
    let mut pins: Vec<CalibrationAnchor> = Vec::new();
    for &page in &conflicted_pages {
        if let Some((_, measure)) = EKIER_PAGE_START_MEASURE.iter().find(|(p, _)| *p == page) {
            eprintln!(
                "PIN_C6C page={page} measure={measure} reason=\"review-UI-style pin from the hand-verified pre-map log, because reconcile still flagged a conflict on this page after C6c\""
            );
            pins.push(CalibrationAnchor {
                page,
                measure: *measure,
            });
        }
    }
    eprintln!(
        "plan-c-acceptance-c6c: {} pages still need a review-UI pin after C6c (vs C6's/C6b's own counts, see the acceptance doc)",
        pins.len()
    );

    let final_result = measure_reconcile::reconcile(pages_for_reconcile, xml_totals, pins);
    eprintln!(
        "RECONCILE_FINAL_C6C total_bars={} has_pickup={} conflicts={}",
        final_result.total_bars,
        final_result.has_pickup,
        final_result.conflicts.len()
    );
    for conflict in &final_result.conflicts {
        eprintln!("CONFLICT_FINAL_C6C {conflict:?}");
    }

    for (landmark, expected_page) in [(67u32, 3u32), (95u32, 4u32)] {
        let located = final_result.pages.iter().find_map(|row| {
            row.map
                .systems
                .iter()
                .flat_map(|s| s.bars.iter())
                .any(|bar| bar.number == landmark)
                .then_some(row.page)
        });
        eprintln!(
            "LANDMARK_C6C measure={landmark} expected_page={expected_page} located_page={located:?}"
        );
    }

    // Sampled pages: the original 5 (first/last obtained + 3 spread) PLUS
    // page 23, immediately adjacent to the still-missing page 24 — "sample
    // around it" per the C6c brief, since page 24 itself can't be sampled.
    for page in [2u32, 8, 14, 20, 23, 25] {
        if let Some((_, expected)) = EKIER_PAGE_START_MEASURE.iter().find(|(p, _)| *p == page) {
            let mapped_first = final_result
                .pages
                .iter()
                .find(|row| row.page == page)
                .and_then(|row| row.map.systems.first())
                .and_then(|s| s.bars.first())
                .map(|b| b.number);
            eprintln!(
                "SAMPLE_C6C page={page} expected_first_measure={expected} mapped_first_measure={mapped_first:?} near_missing_page_24={}",
                page == 23 || page == 25
            );
        }
    }
}
