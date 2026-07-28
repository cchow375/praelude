//! Practice Notebook storage (spec §C2): the per-day "day sheet" and the
//! fully-editable long-term per-piece "arch" plan.
//!
//! A day sheet is an ordered list of typed lines that always round-trips to
//! visible, editable text (spec items 9, 12). The wire contract is strict: each
//! line is one internally-tagged object (`{"type": …, …}`) whose payload struct
//! carries `deny_unknown_fields`, so both an unknown line `type` and an unknown
//! field on a known line are rejected with an honest error rather than silently
//! dropped. An empty sheet (`[]`) is valid.
//!
//! Daily-reset semantics live here, not in a scheduler: [`Store::day_sheet_get`]
//! returns `None` for a date that has never been written (the frontend renders a
//! blank sheet), and nothing is ever auto-carried forward from a prior day. A
//! sheet exists only once the user saves one for that exact date.
//!
//! Neither writer verifies that a referenced `piece_id`/`goal_id` actually
//! exists: the sheet is a free-form editable notebook whose references are
//! display hints, and checking off an `item` is display state — never a
//! practice-truth mutation (attempt history remains the only evidence, spec §C3).
//! `piece_plan` does key on a real piece and so is FK-checked for an honest
//! message.

use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};

use super::model::json_to_sql;
use super::practice_v2::invalid;
use super::Store;

/// Upper bound on lines in one day sheet. Generous for a hand-written practice
/// day; exists only to reject pathological payloads before they reach SQLite.
const MAX_LINES: usize = 2_000;
/// Per-line free-text bound (characters). Covers `text`, `item`, `lesson_notes`,
/// and `lesson_prep.want`.
const MAX_TEXT_CHARS: usize = 8_000;
/// Bound on one `block` line's minute allocation (one line = one timed block).
const MAX_BLOCK_MINUTES: i64 = 1_440;
/// Bound on a `lesson_prep.bring` list length.
const MAX_BRING: usize = 200;
/// Bound on the per-piece long-term plan body (characters). This is a single
/// editable prose/outline field, so it is larger than a day-sheet line.
const MAX_PIECE_PLAN_CHARS: usize = 40_000;

/// One typed line of a day sheet. Internally tagged by `type`; each variant wraps
/// a strict payload struct so unknown fields are rejected. The tag itself is
/// consumed by serde and is not seen as an unknown field by the payload.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum NotebookLine {
    /// A free-text line (may be blank — a deliberate spacer).
    Text(TextLine),
    /// A reference to a piece (renders as that piece's title / a link).
    Piece(PieceLine),
    /// A checklist item; `checked` is display state only.
    Item(ItemLine),
    /// A timed practice block of `minutes`, optionally scoped to a piece.
    Block(BlockLine),
    /// Free-text notes captured from a lesson.
    LessonNotes(LessonNotesLine),
    /// Lesson preparation: pieces to bring and a free-text want/goal.
    LessonPrep(LessonPrepLine),
    /// A reference to a canonical Goal.
    GoalRef(GoalRefLine),
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct TextLine {
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PieceLine {
    pub piece_id: i64,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ItemLine {
    pub text: String,
    /// Defaults to `false` so a freshly-typed item needs no explicit flag.
    #[serde(default)]
    pub checked: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub piece_id: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct BlockLine {
    pub minutes: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub piece_id: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct LessonNotesLine {
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct LessonPrepLine {
    /// Piece ids to bring to the lesson.
    pub bring: Vec<i64>,
    pub want: String,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct GoalRefLine {
    pub goal_id: i64,
}

/// One day sheet as returned to the frontend: the date it belongs to, its typed
/// body, and when it was last saved.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct DaySheet {
    pub date: String,
    pub body: Vec<NotebookLine>,
    pub updated_at: String,
}

/// One per-piece long-term plan (the editable "arch" schedule, spec item 10).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PiecePlan {
    pub piece_id: i64,
    pub body_text: String,
    pub updated_at: String,
}

/// Parse and structurally validate a day-sheet `body_json` payload. Rejects
/// malformed JSON, unknown line types, unknown fields, and out-of-range values
/// with honest messages. An empty array is valid.
pub fn parse_body(body_json: &str) -> rusqlite::Result<Vec<NotebookLine>> {
    let lines: Vec<NotebookLine> = serde_json::from_str(body_json)
        .map_err(|error| invalid(format!("day sheet body is not valid: {error}")))?;
    validate_lines(&lines)?;
    Ok(lines)
}

/// Enforce the semantic bounds serde cannot: line count, text lengths, and
/// positive ids/minutes. Structural shape is already guaranteed by the strict
/// derive above.
fn validate_lines(lines: &[NotebookLine]) -> rusqlite::Result<()> {
    if lines.len() > MAX_LINES {
        return Err(invalid(format!(
            "a day sheet may not exceed {MAX_LINES} lines"
        )));
    }
    for (index, line) in lines.iter().enumerate() {
        let position = index + 1;
        match line {
            NotebookLine::Text(TextLine { text })
            | NotebookLine::LessonNotes(LessonNotesLine { text }) => {
                bound_text(text, position)?;
            }
            NotebookLine::Item(ItemLine { text, piece_id, .. }) => {
                bound_text(text, position)?;
                if let Some(id) = piece_id {
                    bound_id(*id, position, "item piece_id")?;
                }
            }
            NotebookLine::Piece(PieceLine { piece_id }) => {
                bound_id(*piece_id, position, "piece_id")?;
            }
            NotebookLine::Block(BlockLine { minutes, piece_id }) => {
                if *minutes < 1 || *minutes > MAX_BLOCK_MINUTES {
                    return Err(invalid(format!(
                        "line {position}: a block needs 1..={MAX_BLOCK_MINUTES} minutes"
                    )));
                }
                if let Some(id) = piece_id {
                    bound_id(*id, position, "block piece_id")?;
                }
            }
            NotebookLine::LessonPrep(LessonPrepLine { bring, want }) => {
                bound_text(want, position)?;
                if bring.len() > MAX_BRING {
                    return Err(invalid(format!(
                        "line {position}: lesson_prep may bring at most {MAX_BRING} pieces"
                    )));
                }
                for id in bring {
                    bound_id(*id, position, "lesson_prep bring piece_id")?;
                }
            }
            NotebookLine::GoalRef(GoalRefLine { goal_id }) => {
                bound_id(*goal_id, position, "goal_id")?;
            }
        }
    }
    Ok(())
}

fn bound_text(text: &str, position: usize) -> rusqlite::Result<()> {
    if text.chars().count() > MAX_TEXT_CHARS {
        return Err(invalid(format!(
            "line {position}: text exceeds {MAX_TEXT_CHARS} characters"
        )));
    }
    Ok(())
}

fn bound_id(id: i64, position: usize, field: &str) -> rusqlite::Result<()> {
    if id < 1 {
        return Err(invalid(format!(
            "line {position}: {field} must be a positive id"
        )));
    }
    Ok(())
}

impl Store {
    /// Read the day sheet for `date`, or `None` when no sheet has ever been saved
    /// for that exact date (daily-reset: the frontend renders a blank sheet and
    /// nothing carries over from a prior day).
    pub(crate) fn day_sheet_get(&self, date: &str) -> rusqlite::Result<Option<DaySheet>> {
        let conn = self
            .conn
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        conn.query_row(
            "SELECT date, body_json, updated_at FROM day_sheet WHERE date = ?1",
            [date],
            |row| {
                let date: String = row.get(0)?;
                let body_json: String = row.get(1)?;
                let updated_at: String = row.get(2)?;
                let body: Vec<NotebookLine> =
                    serde_json::from_str(&body_json).map_err(|error| {
                        rusqlite::Error::FromSqlConversionFailure(
                            1,
                            rusqlite::types::Type::Text,
                            Box::new(error),
                        )
                    })?;
                Ok(DaySheet {
                    date,
                    body,
                    updated_at,
                })
            },
        )
        .optional()
    }

    /// Validate and upsert the day sheet for `date`, returning the saved sheet as
    /// its receipt. The stored `body_json` is the canonical re-serialization of
    /// the validated lines, never the raw input.
    pub(crate) fn day_sheet_save(&self, date: &str, body_json: &str) -> rusqlite::Result<DaySheet> {
        let date = date.trim();
        if !crate::date::is_valid(date) {
            return Err(invalid("a day sheet needs a valid YYYY-MM-DD date"));
        }
        let lines = parse_body(body_json)?;
        let canonical_json = json_to_sql(&lines)?;
        // Compute the timestamp before taking the connection lock (it locks too).
        let now = self.now_rfc3339()?;

        let conn = self
            .conn
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        conn.execute(
            "INSERT INTO day_sheet (date, body_json, updated_at)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(date) DO UPDATE SET
                 body_json = excluded.body_json,
                 updated_at = excluded.updated_at",
            rusqlite::params![date, canonical_json, now],
        )?;

        Ok(DaySheet {
            date: date.to_string(),
            body: lines,
            updated_at: now,
        })
    }

    /// Read one piece's long-term plan, or `None` when it has none yet.
    pub(crate) fn piece_plan_get(&self, piece_id: i64) -> rusqlite::Result<Option<PiecePlan>> {
        let conn = self
            .conn
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        conn.query_row(
            "SELECT piece_id, body_text, updated_at FROM piece_plan WHERE piece_id = ?1",
            [piece_id],
            |row| {
                Ok(PiecePlan {
                    piece_id: row.get(0)?,
                    body_text: row.get(1)?,
                    updated_at: row.get(2)?,
                })
            },
        )
        .optional()
    }

    /// Validate and upsert one piece's long-term plan, returning the saved plan.
    pub(crate) fn piece_plan_save(
        &self,
        piece_id: i64,
        body_text: &str,
    ) -> rusqlite::Result<PiecePlan> {
        if piece_id < 1 {
            return Err(invalid("a piece plan needs a valid piece id"));
        }
        if body_text.chars().count() > MAX_PIECE_PLAN_CHARS {
            return Err(invalid(format!(
                "a piece plan may not exceed {MAX_PIECE_PLAN_CHARS} characters"
            )));
        }
        let now = self.now_rfc3339()?;

        let conn = self
            .conn
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        // FK onto piece; check first for an honest message rather than a raw
        // constraint failure.
        let piece_exists: bool = conn
            .query_row("SELECT 1 FROM piece WHERE id = ?1", [piece_id], |_| {
                Ok(true)
            })
            .optional()?
            .unwrap_or(false);
        if !piece_exists {
            return Err(invalid("piece plan references a piece that does not exist"));
        }

        conn.execute(
            "INSERT INTO piece_plan (piece_id, body_text, updated_at)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(piece_id) DO UPDATE SET
                 body_text = excluded.body_text,
                 updated_at = excluded.updated_at",
            rusqlite::params![piece_id, body_text, now],
        )?;

        Ok(PiecePlan {
            piece_id,
            body_text: body_text.to_string(),
            updated_at: now,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::model::ScanPiece;

    fn store_with_piece() -> (Store, i64) {
        let store = Store::open(":memory:").expect("memory store");
        let piece_id = store
            .upsert_piece(&ScanPiece {
                folder_path: "/v/Nocturne".into(),
                title: "Nocturne".into(),
                composer: Some("Chopin".into()),
                xml_path: None,
                pdf_path: None,
            })
            .unwrap();
        (store, piece_id)
    }

    // ── body_json validation ────────────────────────────────────────────────

    #[test]
    fn every_line_type_parses_and_round_trips() {
        let body = r#"[
            {"type":"text","text":"warm up slowly"},
            {"type":"piece","piece_id":1},
            {"type":"item","text":"LH leaps mm.12-16","checked":true,"piece_id":1},
            {"type":"item","text":"a bare item"},
            {"type":"block","minutes":20,"piece_id":1},
            {"type":"block","minutes":10},
            {"type":"lesson_notes","text":"teacher said relax the wrist"},
            {"type":"lesson_prep","bring":[1,2],"want":"play the coda from memory"},
            {"type":"goal_ref","goal_id":7}
        ]"#;
        let lines = parse_body(body).expect("all line types are valid");
        assert_eq!(lines.len(), 9);
        // A bare item defaults checked=false.
        assert_eq!(
            lines[3],
            NotebookLine::Item(ItemLine {
                text: "a bare item".into(),
                checked: false,
                piece_id: None,
            })
        );
        // Canonical re-serialization parses back to the identical structure.
        let canonical = serde_json::to_string(&lines).unwrap();
        let reparsed = parse_body(&canonical).expect("canonical form round-trips");
        assert_eq!(reparsed, lines);
    }

    #[test]
    fn empty_sheet_is_valid() {
        assert!(parse_body("[]").expect("empty is valid").is_empty());
    }

    #[test]
    fn unknown_line_type_is_rejected() {
        let error = parse_body(r#"[{"type":"metronome","bpm":120}]"#).unwrap_err();
        assert!(
            error.to_string().contains("day sheet body is not valid"),
            "{error}"
        );
    }

    #[test]
    fn unknown_field_on_a_known_line_is_rejected() {
        let error = parse_body(r#"[{"type":"text","text":"hi","bogus":1}]"#).unwrap_err();
        assert!(error.to_string().contains("bogus"), "{error}");
    }

    #[test]
    fn malformed_json_is_rejected_honestly() {
        let error = parse_body("{not json").unwrap_err();
        assert!(
            error.to_string().contains("day sheet body is not valid"),
            "{error}"
        );
    }

    #[test]
    fn out_of_range_values_are_rejected() {
        assert!(parse_body(r#"[{"type":"block","minutes":0}]"#)
            .unwrap_err()
            .to_string()
            .contains("minutes"));
        assert!(parse_body(r#"[{"type":"piece","piece_id":0}]"#)
            .unwrap_err()
            .to_string()
            .contains("positive id"));
        assert!(parse_body(r#"[{"type":"goal_ref","goal_id":-3}]"#)
            .unwrap_err()
            .to_string()
            .contains("positive id"));
    }

    // ── command round-trips ──────────────────────────────────────────────────

    #[test]
    fn day_sheet_get_is_none_before_any_save() {
        let (store, _piece) = store_with_piece();
        assert!(store.day_sheet_get("2026-07-28").unwrap().is_none());
    }

    #[test]
    fn day_sheet_save_then_get_round_trips_and_returns_a_receipt() {
        let (store, _piece) = store_with_piece();
        let saved = store
            .day_sheet_save(
                "2026-07-28",
                r#"[{"type":"text","text":"scales"},{"type":"block","minutes":15}]"#,
            )
            .expect("saves");
        assert_eq!(saved.date, "2026-07-28");
        assert_eq!(saved.body.len(), 2);
        assert!(!saved.updated_at.is_empty());

        let fetched = store.day_sheet_get("2026-07-28").unwrap().expect("exists");
        assert_eq!(fetched, saved);
    }

    #[test]
    fn day_sheet_save_upserts_the_same_date() {
        let (store, _piece) = store_with_piece();
        store
            .day_sheet_save("2026-07-28", r#"[{"type":"text","text":"first"}]"#)
            .unwrap();
        store
            .day_sheet_save(
                "2026-07-28",
                r#"[{"type":"text","text":"second"},{"type":"text","text":"third"}]"#,
            )
            .unwrap();
        // Still exactly one row for the date; content is the latest.
        assert_eq!(
            store
                .test_scalar_i64("SELECT count(*) FROM day_sheet WHERE date='2026-07-28'")
                .unwrap(),
            1
        );
        let fetched = store.day_sheet_get("2026-07-28").unwrap().unwrap();
        assert_eq!(fetched.body.len(), 2);
    }

    #[test]
    fn two_dates_are_independent() {
        let (store, _piece) = store_with_piece();
        store
            .day_sheet_save("2026-07-28", r#"[{"type":"text","text":"today"}]"#)
            .unwrap();
        store
            .day_sheet_save(
                "2026-07-29",
                r#"[{"type":"text","text":"tomorrow"},{"type":"text","text":"b"}]"#,
            )
            .unwrap();
        assert_eq!(
            store
                .day_sheet_get("2026-07-28")
                .unwrap()
                .unwrap()
                .body
                .len(),
            1
        );
        assert_eq!(
            store
                .day_sheet_get("2026-07-29")
                .unwrap()
                .unwrap()
                .body
                .len(),
            2
        );
    }

    #[test]
    fn day_sheet_save_rejects_a_bad_date_and_writes_nothing() {
        let (store, _piece) = store_with_piece();
        let error = store
            .day_sheet_save("2026-13-40", r#"[{"type":"text","text":"x"}]"#)
            .unwrap_err();
        assert!(error.to_string().contains("valid YYYY-MM-DD"));
        assert_eq!(
            store
                .test_scalar_i64("SELECT count(*) FROM day_sheet")
                .unwrap(),
            0
        );
    }

    #[test]
    fn day_sheet_save_rejects_malformed_body_and_writes_nothing() {
        let (store, _piece) = store_with_piece();
        assert!(store
            .day_sheet_save("2026-07-28", r#"[{"type":"nope"}]"#)
            .is_err());
        assert_eq!(
            store
                .test_scalar_i64("SELECT count(*) FROM day_sheet")
                .unwrap(),
            0
        );
    }

    #[test]
    fn piece_plan_get_is_none_then_save_get_round_trips_and_upserts() {
        let (store, piece) = store_with_piece();
        assert!(store.piece_plan_get(piece).unwrap().is_none());

        let saved = store
            .piece_plan_save(piece, "Month 1: hands separate.\nMonth 2: bring to tempo.")
            .expect("saves");
        assert_eq!(saved.piece_id, piece);
        assert!(saved.body_text.contains("Month 2"));

        let fetched = store.piece_plan_get(piece).unwrap().expect("exists");
        assert_eq!(fetched, saved);

        store.piece_plan_save(piece, "Rewritten arch.").unwrap();
        assert_eq!(
            store
                .test_scalar_i64("SELECT count(*) FROM piece_plan")
                .unwrap(),
            1
        );
        assert_eq!(
            store.piece_plan_get(piece).unwrap().unwrap().body_text,
            "Rewritten arch."
        );
    }

    #[test]
    fn piece_plan_save_rejects_an_unknown_piece() {
        let (store, _piece) = store_with_piece();
        let error = store.piece_plan_save(999, "orphan").unwrap_err();
        assert!(error.to_string().contains("does not exist"));
        assert_eq!(
            store
                .test_scalar_i64("SELECT count(*) FROM piece_plan")
                .unwrap(),
            0
        );
    }
}
