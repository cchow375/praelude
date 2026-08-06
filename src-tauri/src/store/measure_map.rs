//! Measure mapping: the machine-readable bar geometry for one page of one
//! edition, keyed `(piece_id, edition_fingerprint, page)` — schema v14's
//! `measure_map` table (shipped empty; this module is its first reader/writer).
//!
//! Nothing here talks to vision or reconciliation (later Plan C tasks own
//! that); this is pure store CRUD plus the typed, validated wire model. The
//! model is deliberately versioned (`version: 1`, `#[serde(deny_unknown_fields)]`
//! throughout): a payload from a future, incompatible mapper is rejected with a
//! clear error instead of silently misread.
//!
//! `edition_id` is NOT part of the row's identity key — the table's `UNIQUE`
//! constraint is `(piece_id, edition_fingerprint, page)`, matching the global
//! constraint that a fingerprint change is what makes a map stale, not a
//! change in the (softer, human-facing) edition id. `edition_id` is still
//! accepted and stored on apply (it travels with the row as descriptive
//! metadata) but never used to filter reads.
//!
//! [`Store::measure_map_apply`] validates the ENTIRE payload — cross-page bar
//! continuity included — before opening a transaction, then replaces ALL
//! existing rows for `(piece_id, edition_fingerprint)` in one atomic write: a
//! partial re-apply of pages 3–5 does not merely upsert those three pages, it
//! becomes the new whole truth for that fingerprint (see the doc comment on
//! that method, and `measure_map_apply` in `lib.rs`). A rejected payload
//! writes nothing at all.

use serde::{Deserialize, Serialize};

use super::model::{json_from_sql, json_to_sql};
use super::practice_v2::invalid;
use super::Store;

/// Upper bound on one page's serialized `systems` JSON, matching the
/// `measure_map.systems_json` column's `CHECK(length(systems_json) <= 262144)`.
/// Checked here so an oversized page is an honest pre-transaction rejection
/// rather than a raw SQLite constraint failure mid-apply.
const MAX_SYSTEMS_JSON_BYTES: usize = 262_144;

/// The only version this module understands. Kept as a named constant (rather
/// than a bare `1` scattered through match arms) so the "reject other
/// versions" contract has one obvious place to update if a v2 model ever
/// ships.
const SUPPORTED_VERSION: u32 = 1;

/// One page's measure map: a version tag plus its systems, top-to-bottom.
/// All system/bar coordinates are normalized 0–1 fractions of the page box,
/// top-left origin (the pencil-mark convention — see `score_marks`).
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct MeasureMapPage {
    pub version: u32,
    pub systems: Vec<MapSystem>,
}

/// One system (a line of music) on a page. Bar `i` spans from the previous
/// bar's `x_right` (or the system's `x_left` for the first bar) to its own
/// `x_right`.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct MapSystem {
    pub y_top: f64,
    pub y_bottom: f64,
    pub x_left: f64,
    pub x_right: f64,
    pub bars: Vec<MapBar>,
}

/// One bar within a system. `number` is the printed measure number; bar
/// numbers are strictly increasing bar-to-bar within a system, system-to-system
/// top-to-bottom (`y_top` order), and page-over-page across an apply payload.
/// The very first bar of the whole payload may be any number `>= 0` (`0` is a
/// pickup/anacrusis).
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct MapBar {
    pub x_right: f64,
    pub number: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub confidence: Option<f64>,
    pub source: MapBarSource,
}

/// Where a bar boundary came from: the vision model, a user correction, or
/// interpolated between two anchors. Later Plan C tasks (reconciliation, the
/// review UI) are the producers/consumers of this distinction; this module
/// only carries it through untouched.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum MapBarSource {
    Model,
    User,
    Interpolated,
}

/// One page of a measure map, addressed by its page number. The wire shape
/// for both [`Store::measure_map_get`]'s return value and
/// [`Store::measure_map_apply`]'s `pages` argument.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct MeasureMapPageRow {
    pub page: u32,
    pub map: MeasureMapPage,
}

/// A coordinate/fraction field that must be a finite value in `0.0..=1.0`.
fn validate_fraction(value: f64, field: &str, page: u32) -> rusqlite::Result<f64> {
    if !value.is_finite() || !(0.0..=1.0).contains(&value) {
        return Err(invalid(format!(
            "page {page}: {field} must be a normalized 0..=1 fraction"
        )));
    }
    Ok(value)
}

/// Validate one page's systems in place, threading the strictly-increasing
/// bar-number contract through: within a system (bar-to-bar), across systems
/// (top-to-bottom by `y_top`), and — via `carry_in`/the returned value —
/// across pages in an apply payload. Returns the last bar number seen on this
/// page (or `carry_in` unchanged if the page has no bars at all), for the
/// next page's `carry_in`.
fn validate_page_systems(
    page: u32,
    systems: &[MapSystem],
    carry_in: Option<u32>,
) -> rusqlite::Result<Option<u32>> {
    let mut prev_y_top: Option<f64> = None;
    let mut last_number = carry_in;

    for system in systems {
        let y_top = validate_fraction(system.y_top, "system y_top", page)?;
        let y_bottom = validate_fraction(system.y_bottom, "system y_bottom", page)?;
        let x_left = validate_fraction(system.x_left, "system x_left", page)?;
        let x_right = validate_fraction(system.x_right, "system x_right", page)?;
        if y_top >= y_bottom {
            return Err(invalid(format!(
                "page {page}: system y_top must be less than y_bottom"
            )));
        }
        if x_left >= x_right {
            return Err(invalid(format!(
                "page {page}: system x_left must be less than x_right"
            )));
        }
        if let Some(prev) = prev_y_top {
            if y_top <= prev {
                return Err(invalid(format!(
                    "page {page}: systems must be ordered top-to-bottom (y_top strictly increasing)"
                )));
            }
        }
        prev_y_top = Some(y_top);

        if system.bars.is_empty() {
            return Err(invalid(format!(
                "page {page}: a system needs at least one bar"
            )));
        }

        let mut prev_bar_x_right: Option<f64> = None;
        for bar in &system.bars {
            let bar_x_right = validate_fraction(bar.x_right, "bar x_right", page)?;
            if let Some(prev) = prev_bar_x_right {
                if bar_x_right <= prev {
                    return Err(invalid(format!(
                        "page {page}: bar x_right must strictly increase within a system"
                    )));
                }
            }
            prev_bar_x_right = Some(bar_x_right);

            if let Some(confidence) = bar.confidence {
                if !confidence.is_finite() || !(0.0..=1.0).contains(&confidence) {
                    return Err(invalid(format!(
                        "page {page}: bar confidence must be a normalized 0..=1 fraction"
                    )));
                }
            }

            if let Some(last) = last_number {
                if bar.number <= last {
                    return Err(invalid(format!(
                        "page {page}: bar numbers must strictly increase (bar {} follows {})",
                        bar.number, last
                    )));
                }
            }
            last_number = Some(bar.number);
        }
    }

    Ok(last_number)
}

/// Validate one page end-to-end (version, geometry, bar-number continuity,
/// serialized size) and return its canonical `systems_json` plus the last bar
/// number seen (for the next page's continuity check).
fn validate_page(
    page: u32,
    map: &MeasureMapPage,
    carry_in: Option<u32>,
) -> rusqlite::Result<(String, Option<u32>)> {
    if map.version != SUPPORTED_VERSION {
        return Err(invalid(format!(
            "page {page}: unsupported measure map version {} (expected {SUPPORTED_VERSION})",
            map.version
        )));
    }
    let last_number = validate_page_systems(page, &map.systems, carry_in)?;
    let systems_json = json_to_sql(&map.systems)?;
    if systems_json.len() > MAX_SYSTEMS_JSON_BYTES {
        return Err(invalid(format!(
            "page {page}: measure map is too large ({} bytes, max {MAX_SYSTEMS_JSON_BYTES})",
            systems_json.len()
        )));
    }
    Ok((systems_json, last_number))
}

impl Store {
    /// Every mapped page for one piece+edition fingerprint, page-ordered. An
    /// empty vec means unmapped. `edition_id` is accepted for call-site
    /// symmetry with `measure_map_apply` but — per the module docs — is not
    /// part of the row identity key, so it is validated but not filtered on.
    pub(crate) fn measure_map_get(
        &self,
        piece_id: i64,
        edition_id: &str,
        edition_fingerprint: &str,
    ) -> rusqlite::Result<Vec<MeasureMapPageRow>> {
        if piece_id < 1 {
            return Err(invalid("measure map get needs a valid piece id"));
        }
        if edition_id.trim().is_empty() {
            return Err(invalid("measure map get needs a non-empty edition id"));
        }
        let edition_fingerprint = edition_fingerprint.trim();
        if edition_fingerprint.is_empty() {
            return Err(invalid(
                "measure map get needs a non-empty edition fingerprint",
            ));
        }

        let conn = self
            .conn
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let mut statement = conn.prepare(
            "SELECT page, systems_json FROM measure_map
             WHERE piece_id = ?1 AND edition_fingerprint = ?2
             ORDER BY page",
        )?;
        let rows = statement
            .query_map(rusqlite::params![piece_id, edition_fingerprint], |row| {
                let page: i64 = row.get(0)?;
                let systems_json: String = row.get(1)?;
                Ok((page, systems_json))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        drop(statement);
        drop(conn);

        rows.into_iter()
            .map(|(page, systems_json)| {
                let systems: Vec<MapSystem> = json_from_sql(&systems_json)?;
                Ok(MeasureMapPageRow {
                    page: page as u32,
                    map: MeasureMapPage {
                        version: SUPPORTED_VERSION,
                        systems,
                    },
                })
            })
            .collect()
    }

    /// Validate `pages` as a WHOLE (cross-page bar-number continuity enforced
    /// at every page boundary present in the payload, in ascending page
    /// order) and, only if every page passes, atomically REPLACE ALL existing
    /// rows for `(piece_id, edition_fingerprint)` — not just the pages given
    /// here — with the new set, in one transaction. A page previously mapped
    /// but absent from `pages` is dropped: a re-apply is the new whole truth
    /// for that fingerprint. Any single invalid page rejects the entire call
    /// before the transaction opens, so a bad payload writes zero rows.
    /// Returns the number of pages written.
    pub(crate) fn measure_map_apply(
        &self,
        piece_id: i64,
        edition_id: &str,
        edition_fingerprint: &str,
        pages: Vec<MeasureMapPageRow>,
    ) -> rusqlite::Result<u32> {
        if piece_id < 1 {
            return Err(invalid("measure map apply needs a valid piece id"));
        }
        let edition_id = edition_id.trim();
        if edition_id.is_empty() {
            return Err(invalid("measure map apply needs a non-empty edition id"));
        }
        let edition_fingerprint = edition_fingerprint.trim();
        if edition_fingerprint.is_empty() {
            return Err(invalid(
                "measure map apply needs a non-empty edition fingerprint",
            ));
        }

        let mut sorted = pages;
        sorted.sort_by_key(|row| row.page);
        for pair in sorted.windows(2) {
            if pair[0].page == pair[1].page {
                return Err(invalid(format!(
                    "measure map apply payload has duplicate page {}",
                    pair[0].page
                )));
            }
        }

        let mut carry: Option<u32> = None;
        let mut prepared: Vec<(u32, String)> = Vec::with_capacity(sorted.len());
        for row in &sorted {
            let (systems_json, last_number) = validate_page(row.page, &row.map, carry)?;
            carry = last_number;
            prepared.push((row.page, systems_json));
        }

        let mut conn = self
            .conn
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let tx = conn.transaction()?;
        tx.execute(
            "DELETE FROM measure_map WHERE piece_id = ?1 AND edition_fingerprint = ?2",
            rusqlite::params![piece_id, edition_fingerprint],
        )?;
        for (page, systems_json) in &prepared {
            tx.execute(
                "INSERT INTO measure_map
                     (piece_id, edition_id, edition_fingerprint, page, systems_json)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                rusqlite::params![
                    piece_id,
                    edition_id,
                    edition_fingerprint,
                    page,
                    systems_json
                ],
            )?;
        }
        tx.commit()?;
        Ok(prepared.len() as u32)
    }

    /// Delete every mapped page for one piece+edition fingerprint. Rows under
    /// any OTHER fingerprint of the same piece (stale maps from a prior scan
    /// of the file) are untouched — they simply stay stale until their own
    /// fingerprint is cleared or reapplied. Returns how many rows were
    /// removed.
    pub(crate) fn measure_map_clear(
        &self,
        piece_id: i64,
        edition_fingerprint: &str,
    ) -> rusqlite::Result<u32> {
        if piece_id < 1 {
            return Err(invalid("measure map clear needs a valid piece id"));
        }
        let edition_fingerprint = edition_fingerprint.trim();
        if edition_fingerprint.is_empty() {
            return Err(invalid(
                "measure map clear needs a non-empty edition fingerprint",
            ));
        }
        let conn = self
            .conn
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let removed = conn.execute(
            "DELETE FROM measure_map WHERE piece_id = ?1 AND edition_fingerprint = ?2",
            rusqlite::params![piece_id, edition_fingerprint],
        )?;
        Ok(removed as u32)
    }

    /// Test-only: the raw row count for one piece+fingerprint, bypassing the
    /// typed reader. Used to prove atomicity (a rejected apply must leave the
    /// row count exactly as it found it).
    #[cfg(test)]
    pub(crate) fn measure_map_row_count_for_test(
        &self,
        piece_id: i64,
        edition_fingerprint: &str,
    ) -> i64 {
        let conn = self
            .conn
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        conn.query_row(
            "SELECT count(*) FROM measure_map WHERE piece_id = ?1 AND edition_fingerprint = ?2",
            rusqlite::params![piece_id, edition_fingerprint],
            |row| row.get(0),
        )
        .unwrap_or(0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::model::ScanPiece;

    fn piece(store: &Store, folder: &str, title: &str) -> i64 {
        store
            .upsert_piece(&ScanPiece {
                folder_path: folder.into(),
                title: title.into(),
                composer: None,
                xml_path: None,
                pdf_path: None,
            })
            .expect("piece upserts")
    }

    fn store() -> Store {
        let store = Store::open(":memory:").expect("memory store");
        assert_eq!(piece(&store, "/v/Etude", "Etude"), 1);
        store
    }

    fn bar(x_right: f64, number: u32) -> MapBar {
        MapBar {
            x_right,
            number,
            confidence: Some(0.9),
            source: MapBarSource::Model,
        }
    }

    /// One system spanning the whole page width, with `bars` numbered
    /// starting at `start`, evenly spaced.
    fn system(y_top: f64, y_bottom: f64, start: u32, count: u32) -> MapSystem {
        let bars = (0..count)
            .map(|i| {
                let x_right = 0.1 + (i as f64 + 1.0) * (0.8 / count as f64);
                bar(x_right, start + i)
            })
            .collect();
        MapSystem {
            y_top,
            y_bottom,
            x_left: 0.1,
            x_right: 0.9,
            bars,
        }
    }

    /// A simple valid page: two systems, four bars each, numbered
    /// contiguously starting at `start`.
    fn page(start: u32) -> MeasureMapPage {
        MeasureMapPage {
            version: 1,
            systems: vec![system(0.1, 0.3, start, 4), system(0.4, 0.6, start + 4, 4)],
        }
    }

    #[test]
    fn round_trip_get_after_apply() {
        let store = store();
        assert_eq!(
            store.measure_map_get(1, "score/Henle.pdf", "fp-a").unwrap(),
            Vec::new(),
            "unmapped is an empty vec, not an error"
        );

        let pages = vec![
            MeasureMapPageRow {
                page: 1,
                map: page(1),
            },
            MeasureMapPageRow {
                page: 2,
                map: page(9),
            },
        ];
        let written = store
            .measure_map_apply(1, "score/Henle.pdf", "fp-a", pages.clone())
            .expect("apply succeeds");
        assert_eq!(written, 2);

        let read = store.measure_map_get(1, "score/Henle.pdf", "fp-a").unwrap();
        assert_eq!(read.len(), 2);
        assert_eq!(read[0].page, 1);
        assert_eq!(read[1].page, 2);
        assert_eq!(read[0].map, page(1));
        assert_eq!(read[1].map, page(9));
    }

    #[test]
    fn whole_payload_continuity_rejects_a_page_restarting_its_numbering() {
        let store = store();
        // Page 1 ends at bar 8; page 2 illegally restarts at bar 1.
        let pages = vec![
            MeasureMapPageRow {
                page: 1,
                map: page(1),
            },
            MeasureMapPageRow {
                page: 2,
                map: page(1),
            },
        ];
        assert!(store
            .measure_map_apply(1, "score/Henle.pdf", "fp-a", pages)
            .is_err());
        assert_eq!(store.measure_map_row_count_for_test(1, "fp-a"), 0);
    }

    #[test]
    fn atomic_apply_writes_zero_rows_when_any_page_is_invalid() {
        let store = store();
        let mut bad = page(9);
        bad.systems[0].bars[0].x_right = 2.0; // out of the 0..=1 range
        let pages = vec![
            MeasureMapPageRow {
                page: 1,
                map: page(1),
            }, // valid on its own
            MeasureMapPageRow { page: 2, map: bad }, // invalid
        ];
        assert!(store
            .measure_map_apply(1, "score/Henle.pdf", "fp-a", pages)
            .is_err());
        assert_eq!(
            store.measure_map_row_count_for_test(1, "fp-a"),
            0,
            "one invalid page must roll back the whole apply, including page 1"
        );
    }

    #[test]
    fn reapply_replaces_the_whole_fingerprint_not_just_the_given_pages() {
        let store = store();
        let first = vec![
            MeasureMapPageRow {
                page: 1,
                map: page(1),
            },
            MeasureMapPageRow {
                page: 2,
                map: page(9),
            },
        ];
        store
            .measure_map_apply(1, "score/Henle.pdf", "fp-a", first)
            .unwrap();

        // Re-apply with ONLY page 1 (a fresh whole truth for this fingerprint).
        let second = vec![MeasureMapPageRow {
            page: 1,
            map: page(1),
        }];
        let written = store
            .measure_map_apply(1, "score/Henle.pdf", "fp-a", second)
            .unwrap();
        assert_eq!(written, 1);

        let read = store.measure_map_get(1, "score/Henle.pdf", "fp-a").unwrap();
        assert_eq!(read.len(), 1, "page 2 was dropped, not preserved");
        assert_eq!(read[0].page, 1);
    }

    #[test]
    fn clear_removes_only_the_given_fingerprint() {
        let store = store();
        store
            .measure_map_apply(
                1,
                "score/Henle.pdf",
                "fp-a",
                vec![MeasureMapPageRow {
                    page: 1,
                    map: page(1),
                }],
            )
            .unwrap();
        store
            .measure_map_apply(
                1,
                "score/Henle.pdf",
                "fp-b",
                vec![MeasureMapPageRow {
                    page: 1,
                    map: page(1),
                }],
            )
            .unwrap();

        let removed = store.measure_map_clear(1, "fp-a").unwrap();
        assert_eq!(removed, 1);
        assert!(store
            .measure_map_get(1, "score/Henle.pdf", "fp-a")
            .unwrap()
            .is_empty());
        assert_eq!(
            store
                .measure_map_get(1, "score/Henle.pdf", "fp-b")
                .unwrap()
                .len(),
            1,
            "clearing one fingerprint must not touch another"
        );
    }

    #[test]
    fn oversized_page_json_is_rejected() {
        let store = store();
        // A single system with many bars pushes systems_json past the column's
        // 262144-byte CHECK.
        let bars: Vec<MapBar> = (0u32..40_000)
            .map(|i| bar(0.000_02 * (i as f64 + 1.0).min(49_999.0), i))
            .collect();
        let huge = MeasureMapPage {
            version: 1,
            systems: vec![MapSystem {
                y_top: 0.1,
                y_bottom: 0.9,
                x_left: 0.0,
                x_right: 1.0,
                bars,
            }],
        };
        let pages = vec![MeasureMapPageRow { page: 1, map: huge }];
        assert!(store
            .measure_map_apply(1, "score/Henle.pdf", "fp-a", pages)
            .is_err());
        assert_eq!(store.measure_map_row_count_for_test(1, "fp-a"), 0);
    }

    #[test]
    fn stale_fingerprint_rows_coexist_until_explicitly_cleared() {
        let store = store();
        store
            .measure_map_apply(
                1,
                "score/Henle.pdf",
                "fp-old",
                vec![MeasureMapPageRow {
                    page: 1,
                    map: page(1),
                }],
            )
            .unwrap();

        // A rescan changes the fingerprint; the new fingerprint starts unmapped
        // and the old fingerprint's rows are neither deleted nor surfaced.
        assert!(store
            .measure_map_get(1, "score/Henle.pdf", "fp-new")
            .unwrap()
            .is_empty());
        assert_eq!(
            store
                .measure_map_get(1, "score/Henle.pdf", "fp-old")
                .unwrap()
                .len(),
            1,
            "the old fingerprint's map is untouched until cleared"
        );

        store.measure_map_clear(1, "fp-old").unwrap();
        assert!(store
            .measure_map_get(1, "score/Henle.pdf", "fp-old")
            .unwrap()
            .is_empty());
    }

    #[test]
    fn version_and_shape_rejections() {
        let store = store();

        let mut wrong_version = page(1);
        wrong_version.version = 2;
        assert!(store
            .measure_map_apply(
                1,
                "score/Henle.pdf",
                "fp-a",
                vec![MeasureMapPageRow {
                    page: 1,
                    map: wrong_version
                }],
            )
            .is_err());

        let mut empty_system_bars = page(1);
        empty_system_bars.systems[0].bars.clear();
        assert!(store
            .measure_map_apply(
                1,
                "score/Henle.pdf",
                "fp-a",
                vec![MeasureMapPageRow {
                    page: 1,
                    map: empty_system_bars
                }],
            )
            .is_err());

        let mut backwards_bars = page(1);
        backwards_bars.systems[0].bars.reverse();
        for (i, b) in backwards_bars.systems[0].bars.iter_mut().enumerate() {
            b.number = i as u32; // numbers ascend but x_right now descends
        }
        assert!(store
            .measure_map_apply(
                1,
                "score/Henle.pdf",
                "fp-a",
                vec![MeasureMapPageRow {
                    page: 1,
                    map: backwards_bars
                }],
            )
            .is_err());

        let mut inverted_coords = page(1);
        inverted_coords.systems[0].y_top = 0.5;
        inverted_coords.systems[0].y_bottom = 0.1;
        assert!(store
            .measure_map_apply(
                1,
                "score/Henle.pdf",
                "fp-a",
                vec![MeasureMapPageRow {
                    page: 1,
                    map: inverted_coords
                }],
            )
            .is_err());

        assert_eq!(store.measure_map_row_count_for_test(1, "fp-a"), 0);
    }

    #[test]
    fn unknown_field_is_rejected_by_deny_unknown_fields() {
        let raw = r#"{"page":1,"map":{"version":1,"systems":[{"y_top":0.1,"y_bottom":0.3,"x_left":0.1,"x_right":0.9,"bars":[{"x_right":0.5,"number":1,"source":"model","haunted":true}]}]}}"#;
        let parsed: Result<MeasureMapPageRow, _> = serde_json::from_str(raw);
        assert!(parsed.is_err(), "an unknown bar field must be rejected");
    }
}
