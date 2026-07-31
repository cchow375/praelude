//! Pencil marks: freehand strokes a pianist draws directly on a score page.
//!
//! One row is one stroke. Geometry is stored ONLY as normalized page-relative
//! points (0–1 of the page box), never in screen pixels, so a mark stays on its
//! notehead through zoom, pan, resize, fit-mode changes, and the switch between
//! the Rust page-image fast path and the PDF.js fallback.
//!
//! Rows are keyed by (piece, edition_id, edition_fingerprint, page). The
//! fingerprint is part of the key on purpose: two editions of the same piece
//! have different page geometry, so a mark drawn on the Henle must never appear
//! on the Schnabel. When the *file behind one edition* changes, its fingerprint
//! changes too, and the old strokes stop matching. Those rows are deliberately
//! NOT deleted — page geometry may or may not have moved and only the reader can
//! tell — they are simply not shown, and `stale_marks` reports how many are
//! sitting there so the UI can say so out loud instead of silently losing work.
//!
//! Undo is "delete the newest stroke on this page", which is exactly the row
//! with the greatest `id` for the key: strokes are append-only, so insertion
//! order is stroke order.

use serde::{Deserialize, Serialize};

use super::model::json_to_sql;
use super::practice_v2::invalid;
use super::Store;

/// Upper bound on points in one stroke. A dense 60 Hz stroke across a page is a
/// few hundred points after the frontend's simplification pass; this only guards
/// against a runaway or adversarial payload.
const MAX_STROKE_POINTS: usize = 5000;

/// A stroke needs at least this many points. A single-point "stroke" is a tap,
/// which the frontend already renders as a dot by duplicating the point.
const MIN_STROKE_POINTS: usize = 2;

/// Stroke width, as a fraction of the page's short edge. Bounded so a stored
/// mark can never be an invisible hairline or a page-covering blot.
const MIN_STROKE_WIDTH: f64 = 0.0002;
const MAX_STROKE_WIDTH: f64 = 0.05;

/// One point of a stroke in normalized page coordinates (top-left origin).
/// Mirrors `StrokePoint` in `src/features/score/marks/strokes.ts`.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct MarkPoint {
    pub x: f64,
    pub y: f64,
}

/// One persisted freehand stroke.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ScoreMark {
    pub id: i64,
    pub page: i64,
    pub width: f64,
    pub points: Vec<MarkPoint>,
}

/// Every stroke on one page, plus the count of strokes held for this piece and
/// edition under a *different* file fingerprint (see the module docs).
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ScorePageMarks {
    pub marks: Vec<ScoreMark>,
    pub stale_marks: i64,
}

/// Validated, trimmed identity of the page a mark belongs to.
struct MarkKey<'a> {
    piece_id: i64,
    edition_id: &'a str,
    edition_fingerprint: &'a str,
    page: i64,
}

fn mark_key<'a>(
    piece_id: i64,
    edition_id: &'a str,
    edition_fingerprint: &'a str,
    page: i64,
) -> rusqlite::Result<MarkKey<'a>> {
    if piece_id < 1 {
        return Err(invalid("a score mark needs a valid piece id"));
    }
    let edition_id = edition_id.trim();
    let edition_fingerprint = edition_fingerprint.trim();
    if edition_id.is_empty() || edition_id.chars().count() > 4096 {
        return Err(invalid("the score mark edition id is empty or too long"));
    }
    if edition_fingerprint.is_empty() || edition_fingerprint.chars().count() > 500 {
        return Err(invalid(
            "the score mark edition fingerprint is empty or too long",
        ));
    }
    if page < 1 {
        return Err(invalid("a score mark needs a positive page number"));
    }
    Ok(MarkKey {
        piece_id,
        edition_id,
        edition_fingerprint,
        page,
    })
}

/// Parse and validate a stroke's `points_json`. Rejects invalid JSON, unknown
/// fields, too few or too many points, and anything outside the normalized page
/// box. The caller re-serializes the returned structs, so only canonical,
/// validated JSON is ever stored.
fn validate_points(points_json: &str) -> rusqlite::Result<Vec<MarkPoint>> {
    let points: Vec<MarkPoint> = serde_json::from_str(points_json)
        .map_err(|e| invalid(format!("score mark points are not valid JSON: {e}")))?;
    if points.len() < MIN_STROKE_POINTS {
        return Err(invalid(format!(
            "a score mark needs at least {MIN_STROKE_POINTS} points"
        )));
    }
    if points.len() > MAX_STROKE_POINTS {
        return Err(invalid(format!(
            "a score mark cannot exceed {MAX_STROKE_POINTS} points"
        )));
    }
    for point in &points {
        if !point.x.is_finite() || point.x < 0.0 || point.x > 1.0 {
            return Err(invalid(
                "a score mark point x must be a normalized 0..=1 fraction",
            ));
        }
        if !point.y.is_finite() || point.y < 0.0 || point.y > 1.0 {
            return Err(invalid(
                "a score mark point y must be a normalized 0..=1 fraction",
            ));
        }
    }
    Ok(points)
}

fn validate_width(width: f64) -> rusqlite::Result<f64> {
    if !width.is_finite() || !(MIN_STROKE_WIDTH..=MAX_STROKE_WIDTH).contains(&width) {
        return Err(invalid(format!(
            "a score mark width must be between {MIN_STROKE_WIDTH} and {MAX_STROKE_WIDTH} of the page"
        )));
    }
    Ok(width)
}

impl Store {
    /// Every stroke on one page of one edition, oldest first, plus the count of
    /// strokes this piece+edition holds under other fingerprints.
    pub(crate) fn score_marks_page(
        &self,
        piece_id: i64,
        edition_id: &str,
        edition_fingerprint: &str,
        page: i64,
    ) -> rusqlite::Result<ScorePageMarks> {
        let key = mark_key(piece_id, edition_id, edition_fingerprint, page)?;
        let conn = self
            .conn
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());

        let mut statement = conn.prepare(
            "SELECT id, width, points_json
             FROM score_page_mark
             WHERE piece_id = ?1 AND edition_id = ?2 AND edition_fingerprint = ?3 AND page = ?4
             ORDER BY id",
        )?;
        let marks = statement
            .query_map(
                rusqlite::params![
                    key.piece_id,
                    key.edition_id,
                    key.edition_fingerprint,
                    key.page
                ],
                |row| {
                    let points_json: String = row.get(2)?;
                    let points: Vec<MarkPoint> =
                        serde_json::from_str(&points_json).map_err(|e| {
                            rusqlite::Error::FromSqlConversionFailure(
                                2,
                                rusqlite::types::Type::Text,
                                Box::new(e),
                            )
                        })?;
                    Ok(ScoreMark {
                        id: row.get(0)?,
                        page: key.page,
                        width: row.get(1)?,
                        points,
                    })
                },
            )?
            .collect::<rusqlite::Result<Vec<_>>>()?;

        // Strokes drawn before the file behind this edition changed. Counted
        // across every page so one honest notice covers the whole edition.
        let stale_marks: i64 = conn.query_row(
            "SELECT count(*) FROM score_page_mark
             WHERE piece_id = ?1 AND edition_id = ?2 AND edition_fingerprint != ?3",
            rusqlite::params![key.piece_id, key.edition_id, key.edition_fingerprint],
            |row| row.get(0),
        )?;

        Ok(ScorePageMarks { marks, stale_marks })
    }

    /// Append one stroke to a page and return it with its assigned id.
    pub(crate) fn score_mark_add(
        &self,
        piece_id: i64,
        edition_id: &str,
        edition_fingerprint: &str,
        page: i64,
        width: f64,
        points_json: &str,
    ) -> rusqlite::Result<ScoreMark> {
        let key = mark_key(piece_id, edition_id, edition_fingerprint, page)?;
        let width = validate_width(width)?;
        let points = validate_points(points_json)?;
        // Never store the raw input: persist the canonical re-serialization.
        let canonical_json = json_to_sql(&points)?;
        // Compute the timestamp before locking the connection (it locks too).
        let now = self.now_rfc3339()?;

        let conn = self
            .conn
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        // The row FKs onto piece; check first so a missing piece is an honest
        // message rather than a raw constraint failure.
        let piece_exists: bool = conn
            .query_row("SELECT 1 FROM piece WHERE id = ?1", [key.piece_id], |_| {
                Ok(true)
            })
            .ok()
            .unwrap_or(false);
        if !piece_exists {
            return Err(invalid(
                "score mark save references a piece that does not exist",
            ));
        }

        conn.execute(
            "INSERT INTO score_page_mark
                 (piece_id, edition_id, edition_fingerprint, page, tool, width,
                  points_json, created_ts)
             VALUES (?1, ?2, ?3, ?4, 'pencil', ?5, ?6, ?7)",
            rusqlite::params![
                key.piece_id,
                key.edition_id,
                key.edition_fingerprint,
                key.page,
                width,
                canonical_json,
                now,
            ],
        )?;

        Ok(ScoreMark {
            id: conn.last_insert_rowid(),
            page: key.page,
            width,
            points,
        })
    }

    /// Delete the newest stroke on one page. Returns its id, or `None` when the
    /// page had no marks left to undo.
    pub(crate) fn score_mark_undo(
        &self,
        piece_id: i64,
        edition_id: &str,
        edition_fingerprint: &str,
        page: i64,
    ) -> rusqlite::Result<Option<i64>> {
        let key = mark_key(piece_id, edition_id, edition_fingerprint, page)?;
        let conn = self
            .conn
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        conn.query_row(
            "DELETE FROM score_page_mark
             WHERE id = (
                 SELECT id FROM score_page_mark
                 WHERE piece_id = ?1 AND edition_id = ?2 AND edition_fingerprint = ?3
                   AND page = ?4
                 ORDER BY id DESC LIMIT 1
             )
             RETURNING id",
            rusqlite::params![
                key.piece_id,
                key.edition_id,
                key.edition_fingerprint,
                key.page
            ],
            |row| row.get(0),
        )
        .map(Some)
        .or_else(|error| match error {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            other => Err(other),
        })
    }

    /// Delete every stroke on one page (the destructive "clear page"). Returns
    /// how many rows went. Only this page and this edition are touched.
    pub(crate) fn score_marks_clear_page(
        &self,
        piece_id: i64,
        edition_id: &str,
        edition_fingerprint: &str,
        page: i64,
    ) -> rusqlite::Result<i64> {
        let key = mark_key(piece_id, edition_id, edition_fingerprint, page)?;
        let conn = self
            .conn
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let removed = conn.execute(
            "DELETE FROM score_page_mark
             WHERE piece_id = ?1 AND edition_id = ?2 AND edition_fingerprint = ?3 AND page = ?4",
            rusqlite::params![
                key.piece_id,
                key.edition_id,
                key.edition_fingerprint,
                key.page
            ],
        )?;
        Ok(removed as i64)
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
        assert_eq!(piece(&store, "/v/Nocturne", "Nocturne"), 1);
        assert_eq!(piece(&store, "/v/Sonata", "Sonata"), 2);
        store
    }

    fn line(count: usize) -> String {
        let points: Vec<MarkPoint> = (0..count)
            .map(|index| MarkPoint {
                x: index as f64 / count as f64,
                y: 0.5,
            })
            .collect();
        serde_json::to_string(&points).unwrap()
    }

    #[test]
    fn add_then_read_roundtrips_normalized_points() {
        let store = store();
        let saved = store
            .score_mark_add(1, "score/Henle.pdf", "fp-a", 3, 0.004, &line(5))
            .expect("mark saves");
        assert_eq!(saved.page, 3);
        assert_eq!(saved.points.len(), 5);

        let page = store
            .score_marks_page(1, "score/Henle.pdf", "fp-a", 3)
            .expect("page reads");
        assert_eq!(page.marks.len(), 1);
        assert_eq!(page.marks[0].id, saved.id);
        assert_eq!(page.marks[0].points, saved.points);
        assert!((page.marks[0].width - 0.004).abs() < 1e-9);
        assert_eq!(page.stale_marks, 0);
    }

    #[test]
    fn marks_are_scoped_to_page_edition_fingerprint_and_piece() {
        let store = store();
        store
            .score_mark_add(1, "score/Henle.pdf", "fp-a", 1, 0.004, &line(4))
            .unwrap();
        store
            .score_mark_add(1, "score/Schnabel.pdf", "fp-b", 1, 0.004, &line(4))
            .unwrap();
        store
            .score_mark_add(2, "score/Henle.pdf", "fp-a", 1, 0.004, &line(4))
            .unwrap();
        store
            .score_mark_add(1, "score/Henle.pdf", "fp-a", 2, 0.004, &line(4))
            .unwrap();

        // The Henle page 1 sees exactly its own stroke: not the Schnabel's, not
        // another piece's, not its own page 2.
        let henle = store
            .score_marks_page(1, "score/Henle.pdf", "fp-a", 1)
            .unwrap();
        assert_eq!(henle.marks.len(), 1);
        let schnabel = store
            .score_marks_page(1, "score/Schnabel.pdf", "fp-b", 1)
            .unwrap();
        assert_eq!(schnabel.marks.len(), 1);
        assert_ne!(henle.marks[0].id, schnabel.marks[0].id);
        // Different edition ids, so neither counts as the other's stale history.
        assert_eq!(henle.stale_marks, 0);
        assert_eq!(schnabel.stale_marks, 0);
    }

    #[test]
    fn a_changed_fingerprint_hides_but_never_deletes_the_old_strokes() {
        let store = store();
        store
            .score_mark_add(1, "score/Henle.pdf", "fp-old", 1, 0.004, &line(4))
            .unwrap();
        store
            .score_mark_add(1, "score/Henle.pdf", "fp-old", 2, 0.004, &line(4))
            .unwrap();

        let after_rescan = store
            .score_marks_page(1, "score/Henle.pdf", "fp-new", 1)
            .unwrap();
        assert!(after_rescan.marks.is_empty());
        assert_eq!(after_rescan.stale_marks, 2, "reported, not discarded");

        // Point the app back at the original file and the work is still there.
        let restored = store
            .score_marks_page(1, "score/Henle.pdf", "fp-old", 1)
            .unwrap();
        assert_eq!(restored.marks.len(), 1);
    }

    #[test]
    fn undo_removes_the_newest_stroke_repeatably_then_reports_nothing_left() {
        let store = store();
        let first = store
            .score_mark_add(1, "score/Henle.pdf", "fp-a", 1, 0.004, &line(4))
            .unwrap();
        let second = store
            .score_mark_add(1, "score/Henle.pdf", "fp-a", 1, 0.004, &line(6))
            .unwrap();

        assert_eq!(
            store
                .score_mark_undo(1, "score/Henle.pdf", "fp-a", 1)
                .unwrap(),
            Some(second.id)
        );
        assert_eq!(
            store
                .score_mark_undo(1, "score/Henle.pdf", "fp-a", 1)
                .unwrap(),
            Some(first.id)
        );
        assert_eq!(
            store
                .score_mark_undo(1, "score/Henle.pdf", "fp-a", 1)
                .unwrap(),
            None
        );
    }

    #[test]
    fn undo_never_reaches_another_page_or_edition() {
        let store = store();
        store
            .score_mark_add(1, "score/Henle.pdf", "fp-a", 1, 0.004, &line(4))
            .unwrap();
        let other_page = store
            .score_mark_add(1, "score/Henle.pdf", "fp-a", 2, 0.004, &line(4))
            .unwrap();

        assert_eq!(
            store
                .score_mark_undo(1, "score/Henle.pdf", "fp-a", 2)
                .unwrap(),
            Some(other_page.id)
        );
        assert_eq!(
            store
                .score_marks_page(1, "score/Henle.pdf", "fp-a", 1)
                .unwrap()
                .marks
                .len(),
            1
        );
    }

    #[test]
    fn clear_page_removes_only_that_page() {
        let store = store();
        store
            .score_mark_add(1, "score/Henle.pdf", "fp-a", 1, 0.004, &line(4))
            .unwrap();
        store
            .score_mark_add(1, "score/Henle.pdf", "fp-a", 1, 0.004, &line(4))
            .unwrap();
        store
            .score_mark_add(1, "score/Henle.pdf", "fp-a", 2, 0.004, &line(4))
            .unwrap();

        assert_eq!(
            store
                .score_marks_clear_page(1, "score/Henle.pdf", "fp-a", 1)
                .unwrap(),
            2
        );
        assert!(store
            .score_marks_page(1, "score/Henle.pdf", "fp-a", 1)
            .unwrap()
            .marks
            .is_empty());
        assert_eq!(
            store
                .score_marks_page(1, "score/Henle.pdf", "fp-a", 2)
                .unwrap()
                .marks
                .len(),
            1
        );
    }

    #[test]
    fn out_of_range_geometry_is_rejected_rather_than_stored() {
        let store = store();
        for bad in [
            r#"[{"x":0.1,"y":0.1},{"x":1.4,"y":0.2}]"#,
            r#"[{"x":0.1,"y":-0.01},{"x":0.2,"y":0.2}]"#,
            r#"[{"x":0.1,"y":0.1}]"#,
            r#"[{"x":0.1,"y":0.1,"pressure":0.5},{"x":0.2,"y":0.2}]"#,
            "not json",
        ] {
            assert!(
                store
                    .score_mark_add(1, "score/Henle.pdf", "fp-a", 1, 0.004, bad)
                    .is_err(),
                "should reject {bad}"
            );
        }
        assert!(
            store
                .score_mark_add(1, "score/Henle.pdf", "fp-a", 1, 0.9, &line(4))
                .is_err(),
            "a page-covering width is not a pencil"
        );
        assert!(
            store
                .score_mark_add(1, "score/Henle.pdf", "fp-a", 0, 0.004, &line(4))
                .is_err(),
            "page numbers start at 1"
        );
        assert!(store
            .score_mark_add(1, "", "fp-a", 1, 0.004, &line(4))
            .is_err());
        assert!(
            store
                .score_mark_add(99, "score/Henle.pdf", "fp-a", 1, 0.004, &line(4))
                .is_err(),
            "an unknown piece is an honest error, not a constraint failure"
        );
        assert!(store
            .score_marks_page(1, "score/Henle.pdf", "fp-a", 1)
            .unwrap()
            .marks
            .is_empty());
    }

    #[test]
    fn deleting_a_piece_takes_its_marks_with_it() {
        let store = store();
        store
            .score_mark_add(2, "score/Barber.pdf", "fp-a", 1, 0.004, &line(4))
            .unwrap();
        store
            .conn
            .lock()
            .unwrap()
            .execute("DELETE FROM piece WHERE id = 2", [])
            .unwrap();
        assert!(store
            .score_marks_page(2, "score/Barber.pdf", "fp-a", 1)
            .unwrap()
            .marks
            .is_empty());
    }
}
