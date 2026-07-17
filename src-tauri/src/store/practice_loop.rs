//! V2.4 focus-loop, durable operation receipts, accepted recovery, safety, and
//! retention persistence.
//!
//! This module owns only additive sidecars. The v1 evidence tables remain the
//! compatibility ledger and are never rebuilt or silently rewritten here.

use rusqlite::{Connection, OptionalExtension, Transaction};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{json, Value};

use super::model::{
    json_from_sql, json_to_sql, MutationEntityRef, MutationReceipt, RecoveryActionRequest,
    RecoveryActionView, RepOpenArgs, RepSnapshot, RetentionCheckView, RetentionCondition,
    RetentionDecision, RetentionResult, SetFocusContextInput,
};
use super::practice_v2::{invalid, project, source_name};
use super::Store;
use crate::date;
use crate::ledger::MutationSource;

/// The frontend checkpoints every 15 seconds. Credit at most four missed
/// heartbeats, then close an explicit suspension interval and restart at the
/// next observed activity so sleep/background time can never become practice.
const MAX_UNCHECKPOINTED_FOCUS_SECONDS: i64 = 60;

#[derive(Debug, Clone)]
pub(super) struct LoopProjection {
    pub active_seconds: u32,
    pub timer_state: String,
    pub intention: Option<String>,
    pub judging_axis: String,
    pub hands: String,
    pub method: String,
    pub planned_seconds: Option<u32>,
    pub reflection: Option<String>,
    pub safety_state: String,
    pub manual_clean_debt: u32,
    pub reset_after_attempt_id: Option<i64>,
    pub tempo_backoff: Option<f64>,
    pub working_m_start: u32,
    pub working_m_end: u32,
    pub recovery_actions: Vec<RecoveryActionView>,
    pub retention_check: Option<RetentionCheckView>,
}

#[derive(Debug)]
pub(super) struct PendingOperation {
    pub(super) id: i64,
    receipt_id: String,
    command_id: String,
    committed_ts: String,
    pub(super) session_id: Option<i64>,
}

pub(super) enum OperationStart<T> {
    Replay(MutationReceipt<T>),
    New(PendingOperation),
}

fn validate_timestamp(conn: &Connection, value: &str) -> rusqlite::Result<()> {
    let valid: bool = conn.query_row("SELECT julianday(?1) IS NOT NULL", [value], |row| {
        row.get(0)
    })?;
    if !valid {
        return Err(invalid(
            "timestamp must be a valid absolute SQLite timestamp",
        ));
    }
    Ok(())
}

fn validate_date(_conn: &Connection, value: &str) -> rusqlite::Result<()> {
    if !date::is_valid(value) {
        return Err(invalid("date must use valid YYYY-MM-DD form"));
    }
    Ok(())
}

fn validate_retention_condition(
    condition: &RetentionCondition,
    label: &str,
) -> rusqlite::Result<()> {
    if condition
        .bpm
        .is_some_and(|bpm| !bpm.is_finite() || !(1.0..=400.0).contains(&bpm))
    {
        return Err(invalid(format!("{label} BPM must be between 1 and 400")));
    }
    match (condition.m_start, condition.m_end) {
        (Some(start), Some(end)) if start >= 1 && end >= start => {}
        (None, None) => {}
        _ => {
            return Err(invalid(format!(
                "{label} measure range must be complete and ordered"
            )))
        }
    }
    if condition
        .required_clean_streak
        .is_some_and(|value| !(1..=100).contains(&value))
    {
        return Err(invalid(format!("{label} clean streak must be 1 to 100")));
    }
    for (value, field, max) in [
        (condition.hands.as_deref(), "hands", 200_usize),
        (condition.method.as_deref(), "method", 500_usize),
        (condition.judging_axis.as_deref(), "judging axis", 200_usize),
    ] {
        if let Some(value) = value {
            required_text(value, &format!("{label} {field}"), max)?;
        }
    }
    if condition == &RetentionCondition::default() {
        return Err(invalid(format!(
            "{label} must contain at least one condition"
        )));
    }
    Ok(())
}

fn validate_retention_result(
    result: &RetentionResult,
    expected: RetentionDecision,
) -> rusqlite::Result<RetentionResult> {
    if result.decision != expected {
        return Err(invalid("retention endpoint and decision do not match"));
    }
    if !date::is_valid(&result.checked_as_of) {
        return Err(invalid("checked_as_of must be a valid YYYY-MM-DD date"));
    }
    let mut validated = result.clone();
    validated.note = required_text(&result.note, "retention result note", 2000)?.to_string();
    if let Some(condition) = &validated.observed_condition {
        validate_retention_condition(condition, "observed retention condition")?;
    }
    if let Some(condition) = &validated.next_condition {
        validate_retention_condition(condition, "next retention condition")?;
    }
    Ok(validated)
}

fn required_text<'a>(value: &'a str, label: &str, max: usize) -> rusqlite::Result<&'a str> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.chars().count() > max {
        return Err(invalid(format!("{label} must be 1 to {max} characters")));
    }
    Ok(trimmed)
}

fn optional_text(value: Option<&str>, label: &str, max: usize) -> rusqlite::Result<Option<String>> {
    value
        .map(|text| required_text(text, label, max).map(str::to_string))
        .transpose()
}

pub(super) fn request_fingerprint(value: &Value) -> rusqlite::Result<String> {
    let encoded = json_to_sql(value)?;
    if encoded.is_empty() || encoded.len() > 24_000 {
        return Err(invalid("operation request is too large"));
    }
    Ok(encoded)
}

pub(super) fn begin_operation<T: DeserializeOwned>(
    tx: &Transaction<'_>,
    command_id: &str,
    operation_kind: &str,
    fingerprint: &str,
    set_id: Option<i64>,
    source: MutationSource,
    now: &str,
) -> rusqlite::Result<OperationStart<T>> {
    let command_id = required_text(command_id, "command id", 200)?;
    required_text(operation_kind, "operation kind", 100)?;
    validate_timestamp(tx, now)?;

    let prior = tx
        .query_row(
            "SELECT receipt_id,operation_kind,request_fingerprint,summary,value_json,
                    entity_refs_json,event_ids_json,undo_action,committed_ts
             FROM practice_operation WHERE command_id=?1",
            [command_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, Option<String>>(7)?,
                    row.get::<_, String>(8)?,
                ))
            },
        )
        .optional()?;
    if let Some((
        receipt_id,
        prior_kind,
        prior_fingerprint,
        summary,
        value,
        entity_refs,
        event_ids,
        undo_action,
        committed_ts,
    )) = prior
    {
        if prior_kind != operation_kind || prior_fingerprint != fingerprint {
            return Err(invalid(
                "command id was already committed with a different operation payload",
            ));
        }
        return Ok(OperationStart::Replay(MutationReceipt {
            receipt_id,
            command_id: command_id.to_string(),
            status: "committed".into(),
            summary,
            value: Some(json_from_sql(&value)?),
            entity_refs: json_from_sql(&entity_refs)?,
            event_ids: json_from_sql(&event_ids)?,
            undo_action,
            error_code: None,
            error_detail: None,
            replayed: true,
            committed_ts: Some(committed_ts),
            session_id: None,
        }));
    }

    let receipt_id = format!("receipt:{command_id}");
    let id: i64 = tx.query_row(
        "INSERT INTO practice_operation
         (receipt_id,command_id,operation_kind,request_fingerprint,set_id,source,
          summary,value_json,entity_refs_json,event_ids_json,committed_ts)
         VALUES (?1,?2,?3,?4,?5,?6,'pending durable practice operation','null','[]','[]',?7)
         RETURNING id",
        rusqlite::params![
            receipt_id,
            command_id,
            operation_kind,
            fingerprint,
            set_id,
            source_name(source),
            now,
        ],
        |row| row.get(0),
    )?;
    Ok(OperationStart::New(PendingOperation {
        id,
        receipt_id,
        command_id: command_id.to_string(),
        committed_ts: now.to_string(),
        session_id: None,
    }))
}

pub(super) fn finish_operation<T: Clone + Serialize>(
    tx: &Transaction<'_>,
    pending: PendingOperation,
    summary: &str,
    value: &T,
    entity_refs: Vec<MutationEntityRef>,
    event_ids: Vec<i64>,
    undo_action: Option<&str>,
) -> rusqlite::Result<MutationReceipt<T>> {
    let summary = required_text(summary, "receipt summary", 2000)?;
    tx.execute(
        "UPDATE practice_operation
         SET summary=?2,value_json=?3,entity_refs_json=?4,event_ids_json=?5,undo_action=?6
         WHERE id=?1",
        rusqlite::params![
            pending.id,
            summary,
            json_to_sql(value)?,
            json_to_sql(&entity_refs)?,
            json_to_sql(&event_ids)?,
            undo_action,
        ],
    )?;
    Ok(MutationReceipt {
        receipt_id: pending.receipt_id,
        command_id: pending.command_id,
        status: "committed".into(),
        summary: summary.to_string(),
        value: Some(value.clone()),
        entity_refs,
        event_ids,
        undo_action: undo_action.map(str::to_string),
        error_code: None,
        error_detail: None,
        replayed: false,
        committed_ts: Some(pending.committed_ts),
        session_id: pending.session_id,
    })
}

struct LoopEventWrite<'a> {
    session_id: Option<i64>,
    piece_id: i64,
    kind: &'a str,
    payload: &'a Value,
    entity_type: &'a str,
    entity_id: i64,
    source: MutationSource,
    command_id: &'a str,
    now: &'a str,
}

#[derive(Debug, Clone, Copy)]
pub(super) struct PracticeSessionResolution {
    pub(super) id: i64,
    pub(super) start_event_id: Option<i64>,
}

/// Adopt an existing open session or create the session and its canonical
/// SESSION_START evidence inside the caller's mutation transaction. Callers
/// invoke this only after durable-command replay preflight has missed.
pub(super) fn resolve_practice_session(
    tx: &Transaction<'_>,
    cached_hint: Option<i64>,
    source: MutationSource,
    command_id: &str,
    now: &str,
) -> rusqlite::Result<PracticeSessionResolution> {
    validate_timestamp(tx, now)?;
    let hinted = cached_hint
        .map(|id| {
            tx.query_row(
                "SELECT id FROM session WHERE id=?1 AND ended_at IS NULL",
                [id],
                |row| row.get(0),
            )
            .optional()
        })
        .transpose()?
        .flatten();
    let existing = match hinted {
        Some(id) => Some(id),
        None => tx
            .query_row(
                "SELECT id FROM session WHERE ended_at IS NULL ORDER BY id DESC LIMIT 1",
                [],
                |row| row.get(0),
            )
            .optional()?,
    };
    if let Some(id) = existing {
        return Ok(PracticeSessionResolution {
            id,
            start_event_id: None,
        });
    }

    let session_id: i64 = tx.query_row(
        "INSERT INTO session(started_at) VALUES (?1) RETURNING id",
        [now],
        |row| row.get(0),
    )?;
    let start_command_id = format!("{command_id}:session_start");
    let start_event_id: i64 = tx.query_row(
        "INSERT INTO event
         (ts,session_id,piece_id,kind,payload,entity_type,entity_id,source,command_id)
         VALUES (?1,?2,NULL,'session_start','{}','session',?2,?3,?4)
         RETURNING id",
        rusqlite::params![now, session_id, source_name(source), start_command_id],
        |row| row.get(0),
    )?;
    Ok(PracticeSessionResolution {
        id: session_id,
        start_event_id: Some(start_event_id),
    })
}

pub(super) fn operation_event_ids(session: PracticeSessionResolution, event_id: i64) -> Vec<i64> {
    session
        .start_event_id
        .into_iter()
        .chain(std::iter::once(event_id))
        .collect()
}

fn insert_loop_event(
    tx: &Transaction<'_>,
    write: LoopEventWrite<'_>,
) -> rusqlite::Result<(Option<i64>, i64)> {
    let encoded = json_to_sql(write.payload)?;
    let feed_id = if let Some(session_id) = write.session_id {
        Some(tx.query_row(
            "INSERT INTO session_event(session_id,ts,kind,payload)
             VALUES (?1,?2,?3,?4) RETURNING id",
            rusqlite::params![session_id, write.now, write.kind, &encoded],
            |row| row.get(0),
        )?)
    } else {
        None
    };
    let canonical_id: i64 = tx.query_row(
        "INSERT INTO event
         (ts,session_id,piece_id,kind,payload,entity_type,entity_id,source,command_id)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9) RETURNING id",
        rusqlite::params![
            write.now,
            write.session_id,
            write.piece_id,
            write.kind,
            encoded,
            write.entity_type,
            write.entity_id,
            source_name(write.source),
            write.command_id,
        ],
        |row| row.get(0),
    )?;
    if let Some(feed_id) = feed_id {
        tx.execute(
            "INSERT INTO session_event_backfill
             (legacy_session_event_id,canonical_event_id,disposition,reason)
             VALUES (?1,?2,'inserted','live_atomic_v2_loop')",
            rusqlite::params![feed_id, canonical_id],
        )?;
    }
    Ok((feed_id, canonical_id))
}

pub(super) fn capture_open_context(
    tx: &Transaction<'_>,
    set_id: i64,
    args: &RepOpenArgs,
    context: Option<&SetFocusContextInput>,
    now: &str,
) -> rusqlite::Result<()> {
    validate_timestamp(tx, now)?;
    let intention = optional_text(
        context.and_then(|value| value.intention.as_deref()),
        "intention",
        2000,
    )?;
    let judging_axis = required_text(
        context
            .and_then(|value| value.judging_axis.as_deref())
            .unwrap_or(&args.focus),
        "judging axis",
        200,
    )?;
    let hands = required_text(
        context
            .and_then(|value| value.hands.as_deref())
            .unwrap_or("both"),
        "hands",
        200,
    )?;
    let method = required_text(
        context
            .and_then(|value| value.method.as_deref())
            .unwrap_or("normal"),
        "method",
        500,
    )?;
    let planned_seconds = context.and_then(|value| value.planned_seconds);
    if planned_seconds.is_some_and(|seconds| !(1..=86_400).contains(&seconds)) {
        return Err(invalid("planned seconds must be 1 to 86400"));
    }
    let reflection = optional_text(
        context.and_then(|value| value.reflection.as_deref()),
        "reflection",
        4000,
    )?;
    tx.execute(
        "INSERT INTO practice_set_context
         (set_id,intention,judging_axis,hands,method,planned_seconds,initial_reflection,captured_ts)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
        rusqlite::params![
            set_id,
            intention,
            judging_axis,
            hands,
            method,
            planned_seconds,
            reflection,
            now,
        ],
    )?;
    tx.execute(
        "INSERT INTO practice_interval(set_id,started_ts,last_checkpoint_ts)
         VALUES (?1,?2,?2)",
        rusqlite::params![set_id, now],
    )?;
    Ok(())
}

pub(super) fn capture_restart_context(
    tx: &Transaction<'_>,
    old_set_id: i64,
    new_set_id: i64,
    now: &str,
) -> rusqlite::Result<()> {
    validate_timestamp(tx, now)?;
    tx.execute(
        "INSERT INTO practice_set_context
         (set_id,intention,judging_axis,hands,method,planned_seconds,initial_reflection,captured_ts)
         SELECT ?2,intention,judging_axis,hands,method,planned_seconds,NULL,?3
         FROM practice_set_context WHERE set_id=?1",
        rusqlite::params![old_set_id, new_set_id, now],
    )?;
    if tx.changes() == 0 {
        tx.execute(
            "INSERT INTO practice_set_context
             (set_id,judging_axis,hands,method,planned_seconds,captured_ts)
             SELECT ?2,b.focus,'both','normal',c.planned_seconds,?3
             FROM rep_block b JOIN set_contract c ON c.set_id=b.id WHERE b.id=?1",
            rusqlite::params![old_set_id, new_set_id, now],
        )?;
    }
    tx.execute(
        "INSERT INTO practice_interval(set_id,started_ts,last_checkpoint_ts)
         VALUES (?1,?2,?2)",
        rusqlite::params![new_set_id, now],
    )?;
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct IntervalAdvance {
    pub(super) suspended: bool,
}

fn checkpoint_interval(
    tx: &Transaction<'_>,
    set_id: i64,
    now: &str,
    restart_after_suspension: bool,
    operation_id: Option<i64>,
) -> rusqlite::Result<IntervalAdvance> {
    validate_timestamp(tx, now)?;
    let (interval_id, last_checkpoint): (i64, String) = tx
        .query_row(
            "SELECT id,last_checkpoint_ts FROM practice_interval
             WHERE set_id=?1 AND ended_ts IS NULL",
            [set_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?
        .ok_or_else(|| invalid("active practice interval is missing"))?;
    let (now_epoch, checkpoint_epoch): (i64, i64) = tx.query_row(
        "SELECT CAST(strftime('%s',?1) AS INTEGER),
                CAST(strftime('%s',?2) AS INTEGER)",
        rusqlite::params![now, last_checkpoint],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    if now_epoch < checkpoint_epoch {
        return Err(invalid("practice clock moved backward"));
    }
    if now_epoch - checkpoint_epoch <= MAX_UNCHECKPOINTED_FOCUS_SECONDS {
        tx.execute(
            "UPDATE practice_interval SET last_checkpoint_ts=?2 WHERE id=?1",
            rusqlite::params![interval_id, now],
        )?;
        return Ok(IntervalAdvance { suspended: false });
    }

    let capped_end: String = tx.query_row(
        "SELECT strftime('%Y-%m-%dT%H:%M:%SZ',?1,'+60 seconds')",
        [last_checkpoint],
        |row| row.get(0),
    )?;
    tx.execute(
        "UPDATE practice_interval
         SET last_checkpoint_ts=?2,ended_ts=?2,end_reason='suspension',closed_operation_id=?3
         WHERE id=?1",
        rusqlite::params![interval_id, capped_end, operation_id],
    )?;
    if restart_after_suspension {
        start_interval(tx, set_id, now, operation_id)?;
    }
    Ok(IntervalAdvance { suspended: true })
}

pub(super) fn checkpoint_active_interval(
    tx: &Transaction<'_>,
    set_id: i64,
    now: &str,
    operation_id: Option<i64>,
) -> rusqlite::Result<IntervalAdvance> {
    checkpoint_interval(tx, set_id, now, true, operation_id)
}

fn close_interval(
    tx: &Transaction<'_>,
    set_id: i64,
    now: &str,
    reason: &str,
    operation_id: Option<i64>,
) -> rusqlite::Result<()> {
    let advance = checkpoint_interval(tx, set_id, now, false, operation_id)?;
    if !advance.suspended {
        let changed = tx.execute(
            "UPDATE practice_interval
             SET ended_ts=?2,end_reason=?3,closed_operation_id=?4
             WHERE set_id=?1 AND ended_ts IS NULL",
            rusqlite::params![set_id, now, reason, operation_id],
        )?;
        if changed != 1 {
            return Err(invalid("active practice interval could not close"));
        }
    }
    Ok(())
}

pub(super) fn close_active_interval(
    tx: &Transaction<'_>,
    set_id: i64,
    now: &str,
    reason: &str,
    operation_id: Option<i64>,
) -> rusqlite::Result<()> {
    close_interval(tx, set_id, now, reason, operation_id)
}

fn start_interval(
    tx: &Transaction<'_>,
    set_id: i64,
    now: &str,
    operation_id: Option<i64>,
) -> rusqlite::Result<()> {
    validate_timestamp(tx, now)?;
    let overlaps: bool = tx.query_row(
        "SELECT EXISTS(
           SELECT 1 FROM practice_interval
           WHERE set_id=?1
             AND julianday(COALESCE(ended_ts,last_checkpoint_ts)) > julianday(?2)
         )",
        rusqlite::params![set_id, now],
        |row| row.get(0),
    )?;
    if overlaps {
        return Err(invalid("practice clock moved backward across intervals"));
    }
    tx.execute(
        "INSERT INTO practice_interval
         (set_id,started_ts,last_checkpoint_ts,opened_operation_id)
         VALUES (?1,?2,?2,?3)",
        rusqlite::params![set_id, now, operation_id],
    )?;
    Ok(())
}

fn retention_view(conn: &Connection, id: i64) -> rusqlite::Result<RetentionCheckView> {
    conn.query_row(
        "SELECT id,region_id,source_set_id,due_date,original_due_date,condition_json,
                state,result_json,completed_ts,created_ts,updated_ts
         FROM retention_check WHERE id=?1",
        [id],
        |row| {
            let condition: String = row.get(5)?;
            let result: Option<String> = row.get(7)?;
            Ok(RetentionCheckView {
                id: row.get(0)?,
                region_id: row.get(1)?,
                source_set_id: row.get(2)?,
                due_date: row.get(3)?,
                original_due_date: row.get(4)?,
                condition: json_from_sql(&condition)?,
                state: row.get(6)?,
                result: result.map(|raw| json_from_sql(&raw)).transpose()?,
                completed_ts: row.get(8)?,
                created_ts: row.get(9)?,
                updated_ts: row.get(10)?,
            })
        },
    )
}

pub(super) fn load_loop_projection(
    conn: &Connection,
    set_id: i64,
    base_m_start: u32,
    base_m_end: u32,
    base_focus: &str,
    set_state: &str,
) -> rusqlite::Result<LoopProjection> {
    let context = conn
        .query_row(
            "SELECT intention,judging_axis,hands,method,planned_seconds,initial_reflection
             FROM practice_set_context WHERE set_id=?1",
            [set_id],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, Option<u32>>(4)?,
                    row.get::<_, Option<String>>(5)?,
                ))
            },
        )
        .optional()?
        .unwrap_or_else(|| {
            (
                None,
                base_focus.to_string(),
                "unspecified".into(),
                "unspecified".into(),
                None,
                None,
            )
        });

    let active_raw: i64 = conn.query_row(
        "SELECT COALESCE(SUM(MAX(0,
                  CAST(strftime('%s',COALESCE(ended_ts,last_checkpoint_ts)) AS INTEGER)
                - CAST(strftime('%s',started_ts) AS INTEGER))),0)
         FROM practice_interval WHERE set_id=?1",
        [set_id],
        |row| row.get(0),
    )?;
    let active_seconds = u32::try_from(active_raw.max(0)).unwrap_or(u32::MAX);

    let mut actions = Vec::new();
    let mut stmt = conn.prepare(
        "SELECT a.id,a.kind,a.after_attempt_id,a.payload_json,a.rationale,a.source,a.created_ts
         FROM practice_recovery_action a WHERE a.set_id=?1 ORDER BY a.id",
    )?;
    let rows = stmt.query_map([set_id], |row| {
        let payload: String = row.get(3)?;
        Ok(RecoveryActionView {
            id: row.get(0)?,
            kind: row.get(1)?,
            after_attempt_id: row.get(2)?,
            payload: json_from_sql(&payload)?,
            rationale: row.get(4)?,
            source: row.get(5)?,
            created_ts: row.get(6)?,
        })
    })?;
    for row in rows {
        actions.push(row?);
    }

    let mut hands = context.2;
    let mut method = context.3;
    let mut manual_clean_debt = 0_u32;
    let mut reset_after_attempt_id = None;
    let mut tempo_backoff = None;
    let mut working_m_start = base_m_start;
    let mut working_m_end = base_m_end;
    for action in &actions {
        match action.kind.as_str() {
            "reset_streak" => reset_after_attempt_id = action.after_attempt_id,
            "clean_debt" => {
                manual_clean_debt = manual_clean_debt.saturating_add(
                    action
                        .payload
                        .get("clean_count")
                        .and_then(Value::as_u64)
                        .and_then(|value| u32::try_from(value).ok())
                        .unwrap_or(0),
                );
            }
            "tempo_backoff" => {
                let boundary = action.after_attempt_id.unwrap_or(0);
                let later_attempt: bool = conn.query_row(
                    "SELECT EXISTS(SELECT 1 FROM rep WHERE block_id=?1 AND id>?2)",
                    rusqlite::params![set_id, boundary],
                    |row| row.get(0),
                )?;
                if !later_attempt {
                    tempo_backoff = action.payload.get("bpm").and_then(Value::as_f64);
                }
            }
            "narrow_target" => {
                if let (Some(start), Some(end)) = (
                    action.payload.get("m_start").and_then(Value::as_u64),
                    action.payload.get("m_end").and_then(Value::as_u64),
                ) {
                    if let (Ok(start), Ok(end)) = (u32::try_from(start), u32::try_from(end)) {
                        working_m_start = start;
                        working_m_end = end;
                    }
                }
            }
            "change_hands" => {
                if let Some(value) = action.payload.get("hands").and_then(Value::as_str) {
                    hands = value.to_string();
                }
            }
            "change_method" => {
                if let Some(value) = action.payload.get("method").and_then(Value::as_str) {
                    method = value.to_string();
                }
            }
            _ => {}
        }
    }

    let reflection = conn
        .query_row(
            "SELECT reflection FROM practice_reflection WHERE set_id=?1 ORDER BY id DESC LIMIT 1",
            [set_id],
            |row| row.get(0),
        )
        .optional()?
        .or(context.5);
    let safety_state = conn
        .query_row(
            "SELECT state FROM practice_safety_event WHERE set_id=?1 ORDER BY id DESC LIMIT 1",
            [set_id],
            |row| row.get(0),
        )
        .optional()?
        .unwrap_or_else(|| "clear".into());
    let retention_check = conn
        .query_row(
            "SELECT id FROM retention_check WHERE source_set_id=?1 ORDER BY id DESC LIMIT 1",
            [set_id],
            |row| row.get::<_, i64>(0),
        )
        .optional()?
        .map(|id| retention_view(conn, id))
        .transpose()?;

    Ok(LoopProjection {
        active_seconds,
        timer_state: match set_state {
            "active" => "active",
            "paused" => "paused",
            _ => "stopped",
        }
        .into(),
        intention: context.0,
        judging_axis: context.1,
        hands,
        method,
        planned_seconds: context.4,
        reflection,
        safety_state,
        manual_clean_debt,
        reset_after_attempt_id,
        tempo_backoff,
        working_m_start,
        working_m_end,
        recovery_actions: actions,
        retention_check,
    })
}

impl Store {
    pub(crate) fn v2_pause(
        &self,
        session_hint: Option<i64>,
        block_id: i64,
        source: MutationSource,
        command_id: &str,
        now: &str,
    ) -> rusqlite::Result<MutationReceipt<RepSnapshot>> {
        let fingerprint = request_fingerprint(&json!({"block_id": block_id}))?;
        let mut conn = self
            .conn
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let tx = conn.transaction()?;
        let mut pending = match begin_operation(
            &tx,
            command_id,
            "pause",
            &fingerprint,
            Some(block_id),
            source,
            now,
        )? {
            OperationStart::Replay(receipt) => return Ok(receipt),
            OperationStart::New(pending) => pending,
        };
        let session = resolve_practice_session(&tx, session_hint, source, command_id, now)?;
        pending.session_id = Some(session.id);
        let before = project(&tx, block_id)?;
        if before.set_state != "active" {
            return Err(invalid("only an active practice set can pause"));
        }
        close_interval(&tx, block_id, now, "pause", Some(pending.id))?;
        tx.execute(
            "UPDATE set_contract SET set_state='paused' WHERE set_id=?1",
            [block_id],
        )?;
        let payload = json!({
            "block_id": block_id,
            "piece_id": before.piece_id,
            "active_seconds": load_loop_projection(
                &tx,
                block_id,
                before.m_start,
                before.m_end,
                &before.focus,
                "paused",
            )?.active_seconds,
            "command_id": command_id,
        });
        let (_, event_id) = insert_loop_event(
            &tx,
            LoopEventWrite {
                session_id: Some(session.id),
                piece_id: before.piece_id,
                kind: "rep_pause",
                payload: &payload,
                entity_type: "set",
                entity_id: block_id,
                source,
                command_id,
                now,
            },
        )?;
        let snapshot = project(&tx, block_id)?;
        let receipt = finish_operation(
            &tx,
            pending,
            "Practice paused; paused time will not count.",
            &snapshot,
            vec![MutationEntityRef {
                entity_type: "set".into(),
                entity_id: block_id,
            }],
            operation_event_ids(session, event_id),
            None,
        )?;
        tx.commit()?;
        Ok(receipt)
    }

    pub(crate) fn v2_resume(
        &self,
        session_hint: Option<i64>,
        block_id: i64,
        source: MutationSource,
        command_id: &str,
        now: &str,
    ) -> rusqlite::Result<MutationReceipt<RepSnapshot>> {
        let fingerprint = request_fingerprint(&json!({"block_id": block_id}))?;
        let mut conn = self
            .conn
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let tx = conn.transaction()?;
        let mut pending = match begin_operation(
            &tx,
            command_id,
            "resume",
            &fingerprint,
            Some(block_id),
            source,
            now,
        )? {
            OperationStart::Replay(receipt) => return Ok(receipt),
            OperationStart::New(pending) => pending,
        };
        let session = resolve_practice_session(&tx, session_hint, source, command_id, now)?;
        pending.session_id = Some(session.id);
        let before = project(&tx, block_id)?;
        if before.set_state != "paused" {
            return Err(invalid("only a paused practice set can resume"));
        }
        let safety_was_stopped = before.safety_state == "stopped";
        tx.execute(
            "UPDATE set_contract SET set_state='active' WHERE set_id=?1",
            [block_id],
        )?;
        start_interval(&tx, block_id, now, Some(pending.id))?;
        if safety_was_stopped {
            tx.execute(
                "INSERT INTO practice_safety_event(set_id,state,reason,operation_id,created_ts)
                 VALUES (?1,'cleared','explicit resume after safety stop',?2,?3)",
                rusqlite::params![block_id, pending.id, now],
            )?;
        }
        let payload = json!({
            "block_id": block_id,
            "piece_id": before.piece_id,
            "cleared_safety_stop": safety_was_stopped,
            "command_id": command_id,
        });
        let (_, event_id) = insert_loop_event(
            &tx,
            LoopEventWrite {
                session_id: Some(session.id),
                piece_id: before.piece_id,
                kind: "rep_resume",
                payload: &payload,
                entity_type: "set",
                entity_id: block_id,
                source,
                command_id,
                now,
            },
        )?;
        let snapshot = project(&tx, block_id)?;
        let receipt = finish_operation(
            &tx,
            pending,
            "Practice resumed with a fresh active interval.",
            &snapshot,
            vec![MutationEntityRef {
                entity_type: "set".into(),
                entity_id: block_id,
            }],
            operation_event_ids(session, event_id),
            None,
        )?;
        tx.commit()?;
        Ok(receipt)
    }

    pub(crate) fn v2_checkpoint(
        &self,
        session_hint: Option<i64>,
        block_id: i64,
        source: MutationSource,
        command_id: &str,
        now: &str,
    ) -> rusqlite::Result<MutationReceipt<RepSnapshot>> {
        let fingerprint = request_fingerprint(&json!({"block_id": block_id}))?;
        let mut conn = self
            .conn
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let tx = conn.transaction()?;
        let mut pending = match begin_operation(
            &tx,
            command_id,
            "checkpoint",
            &fingerprint,
            Some(block_id),
            source,
            now,
        )? {
            OperationStart::Replay(receipt) => return Ok(receipt),
            OperationStart::New(pending) => pending,
        };
        let session = resolve_practice_session(&tx, session_hint, source, command_id, now)?;
        pending.session_id = Some(session.id);
        let before = project(&tx, block_id)?;
        if before.set_state != "active" {
            return Err(invalid("only an active practice set can checkpoint time"));
        }
        let advance = checkpoint_interval(&tx, block_id, now, true, Some(pending.id))?;
        let snapshot = project(&tx, block_id)?;
        let payload = json!({
            "block_id": block_id,
            "piece_id": before.piece_id,
            "active_seconds": snapshot.active_seconds,
            "suspended_gap": advance.suspended,
            "command_id": command_id,
        });
        let (_, event_id) = insert_loop_event(
            &tx,
            LoopEventWrite {
                session_id: Some(session.id),
                piece_id: before.piece_id,
                kind: "rep_checkpoint",
                payload: &payload,
                entity_type: "set",
                entity_id: block_id,
                source,
                command_id,
                now,
            },
        )?;
        let receipt = finish_operation(
            &tx,
            pending,
            if advance.suspended {
                "A delayed heartbeat was capped; suspended time was excluded."
            } else {
                "Active practice time checkpointed."
            },
            &snapshot,
            vec![MutationEntityRef {
                entity_type: "set".into(),
                entity_id: block_id,
            }],
            operation_event_ids(session, event_id),
            None,
        )?;
        tx.commit()?;
        Ok(receipt)
    }

    pub(crate) fn v2_reflect(
        &self,
        session_hint: Option<i64>,
        block_id: i64,
        reflection: &str,
        source: MutationSource,
        command_id: &str,
        now: &str,
    ) -> rusqlite::Result<MutationReceipt<RepSnapshot>> {
        let reflection = required_text(reflection, "reflection", 4000)?;
        let fingerprint = request_fingerprint(&json!({
            "block_id": block_id,
            "reflection": reflection,
        }))?;
        let mut conn = self
            .conn
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let tx = conn.transaction()?;
        let mut pending = match begin_operation(
            &tx,
            command_id,
            "reflect",
            &fingerprint,
            Some(block_id),
            source,
            now,
        )? {
            OperationStart::Replay(receipt) => return Ok(receipt),
            OperationStart::New(pending) => pending,
        };
        let session = resolve_practice_session(&tx, session_hint, source, command_id, now)?;
        pending.session_id = Some(session.id);
        let before = project(&tx, block_id)?;
        if before.contract_source == "migration_legacy" {
            return Err(invalid("legacy sets cannot receive a v2 focus reflection"));
        }
        tx.execute(
            "INSERT INTO practice_reflection(set_id,reflection,operation_id,created_ts)
             VALUES (?1,?2,?3,?4)",
            rusqlite::params![block_id, reflection, pending.id, now],
        )?;
        let payload = json!({
            "block_id": block_id,
            "piece_id": before.piece_id,
            "reflection": reflection,
            "command_id": command_id,
        });
        let (_, event_id) = insert_loop_event(
            &tx,
            LoopEventWrite {
                session_id: Some(session.id),
                piece_id: before.piece_id,
                kind: "rep_reflection",
                payload: &payload,
                entity_type: "set",
                entity_id: block_id,
                source,
                command_id,
                now,
            },
        )?;
        let snapshot = project(&tx, block_id)?;
        let receipt = finish_operation(
            &tx,
            pending,
            "Practice reflection saved.",
            &snapshot,
            vec![MutationEntityRef {
                entity_type: "set".into(),
                entity_id: block_id,
            }],
            operation_event_ids(session, event_id),
            None,
        )?;
        tx.commit()?;
        Ok(receipt)
    }

    pub(crate) fn v2_safety_stop(
        &self,
        session_hint: Option<i64>,
        block_id: i64,
        reason: Option<&str>,
        source: MutationSource,
        command_id: &str,
        now: &str,
    ) -> rusqlite::Result<MutationReceipt<RepSnapshot>> {
        let reason = optional_text(reason, "safety reason", 2000)?;
        let fingerprint = request_fingerprint(&json!({
            "block_id": block_id,
            "reason": reason,
        }))?;
        let mut conn = self
            .conn
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let tx = conn.transaction()?;
        let mut pending = match begin_operation(
            &tx,
            command_id,
            "safety_stop",
            &fingerprint,
            Some(block_id),
            source,
            now,
        )? {
            OperationStart::Replay(receipt) => return Ok(receipt),
            OperationStart::New(pending) => pending,
        };
        let session = resolve_practice_session(&tx, session_hint, source, command_id, now)?;
        pending.session_id = Some(session.id);
        let before = project(&tx, block_id)?;
        if before.set_state != "active" {
            return Err(invalid("safety stop requires an active practice set"));
        }
        // Persistence happens before the command layer is allowed to stop
        // audio. If any statement below fails, the caller must leave both the
        // in-memory set and metronome untouched.
        close_interval(&tx, block_id, now, "safety_stop", Some(pending.id))?;
        tx.execute(
            "UPDATE set_contract SET set_state='paused' WHERE set_id=?1",
            [block_id],
        )?;
        tx.execute(
            "INSERT INTO practice_safety_event(set_id,state,reason,operation_id,created_ts)
             VALUES (?1,'stopped',?2,?3,?4)",
            rusqlite::params![block_id, reason, pending.id, now],
        )?;
        let payload = json!({
            "block_id": block_id,
            "piece_id": before.piece_id,
            "safety_state": "stopped",
            "reason": reason,
            "attempt_recorded": false,
            "command_id": command_id,
        });
        let (_, event_id) = insert_loop_event(
            &tx,
            LoopEventWrite {
                session_id: Some(session.id),
                piece_id: before.piece_id,
                kind: "rep_safety_stop",
                payload: &payload,
                entity_type: "set",
                entity_id: block_id,
                source,
                command_id,
                now,
            },
        )?;
        let snapshot = project(&tx, block_id)?;
        let receipt = finish_operation(
            &tx,
            pending,
            "Practice paused for safety. No attempt was recorded.",
            &snapshot,
            vec![MutationEntityRef {
                entity_type: "set".into(),
                entity_id: block_id,
            }],
            operation_event_ids(session, event_id),
            None,
        )?;
        tx.commit()?;
        Ok(receipt)
    }

    pub(crate) fn v2_recover(
        &self,
        session_hint: Option<i64>,
        block_id: i64,
        action: &RecoveryActionRequest,
        source: MutationSource,
        command_id: &str,
        now: &str,
    ) -> rusqlite::Result<MutationReceipt<RepSnapshot>> {
        let fingerprint = request_fingerprint(&json!({
            "block_id": block_id,
            "action": action,
        }))?;
        let mut conn = self
            .conn
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let tx = conn.transaction()?;
        let mut pending = match begin_operation(
            &tx,
            command_id,
            "recovery",
            &fingerprint,
            Some(block_id),
            source,
            now,
        )? {
            OperationStart::Replay(receipt) => return Ok(receipt),
            OperationStart::New(pending) => pending,
        };
        let session = resolve_practice_session(&tx, session_hint, source, command_id, now)?;
        pending.session_id = Some(session.id);
        let before = project(&tx, block_id)?;
        if !matches!(before.set_state.as_str(), "active" | "paused") {
            return Err(invalid(
                "recovery cannot mutate a terminal set; restart it as a linked set first",
            ));
        }

        // Recovery is ordered after every physical attempt already committed,
        // including a latest attempt currently hidden by append-only undo. The
        // HUD intentionally keeps `last_attempt_id` as the last *effective* row.
        let after_attempt_id: Option<i64> = tx.query_row(
            "SELECT MAX(id) FROM rep WHERE block_id=?1",
            [block_id],
            |row| row.get(0),
        )?;
        let (kind, mut payload, rationale) = match action {
            RecoveryActionRequest::ResetStreak { rationale } => {
                if after_attempt_id.is_none() {
                    return Err(invalid("a streak cannot reset before an attempt exists"));
                }
                (
                    "reset_streak",
                    json!({}),
                    required_text(rationale, "recovery rationale", 2000)?,
                )
            }
            RecoveryActionRequest::CleanDebt {
                clean_count,
                rationale,
            } => {
                if !(1..=100).contains(clean_count) {
                    return Err(invalid("clean debt must be 1 to 100"));
                }
                (
                    "clean_debt",
                    json!({"clean_count": clean_count}),
                    required_text(rationale, "recovery rationale", 2000)?,
                )
            }
            RecoveryActionRequest::TempoBackoff { bpm, rationale } => {
                if before.focus != "tempo" {
                    return Err(invalid("tempo backoff requires a tempo-focus set"));
                }
                if !bpm.is_finite()
                    || *bpm <= 0.0
                    || before.bpm.is_none_or(|current| *bpm >= current)
                {
                    return Err(invalid(
                        "tempo backoff must be positive and below the working tempo",
                    ));
                }
                (
                    "tempo_backoff",
                    json!({"bpm": bpm}),
                    required_text(rationale, "recovery rationale", 2000)?,
                )
            }
            RecoveryActionRequest::NarrowTarget {
                m_start,
                m_end,
                rationale,
            } => {
                if *m_start < before.working_m_start
                    || *m_end > before.working_m_end
                    || *m_end < *m_start
                    || (*m_start == before.working_m_start && *m_end == before.working_m_end)
                {
                    return Err(invalid(
                        "narrow target must be a proper subrange of the working target",
                    ));
                }
                (
                    "narrow_target",
                    json!({"m_start": m_start, "m_end": m_end}),
                    required_text(rationale, "recovery rationale", 2000)?,
                )
            }
            RecoveryActionRequest::ChangeHands { hands, rationale } => (
                "change_hands",
                json!({"hands": required_text(hands, "hands", 200)?}),
                required_text(rationale, "recovery rationale", 2000)?,
            ),
            RecoveryActionRequest::ChangeMethod { method, rationale } => (
                "change_method",
                json!({"method": required_text(method, "method", 500)?}),
                required_text(rationale, "recovery rationale", 2000)?,
            ),
            RecoveryActionRequest::Break {
                planned_seconds,
                rationale,
            } => {
                if planned_seconds.is_some_and(|seconds| !(1..=86_400).contains(&seconds)) {
                    return Err(invalid("break seconds must be 1 to 86400"));
                }
                (
                    "break",
                    json!({"planned_seconds": planned_seconds}),
                    required_text(rationale, "recovery rationale", 2000)?,
                )
            }
            RecoveryActionRequest::ScheduleRetention {
                due_date,
                condition,
                rationale,
            } => {
                validate_date(&tx, due_date)?;
                validate_retention_condition(condition, "retention condition")?;
                let region_id: i64 = tx
                    .query_row(
                        "SELECT region_id FROM rep_block WHERE id=?1 AND region_id IS NOT NULL",
                        [block_id],
                        |row| row.get(0),
                    )
                    .optional()?
                    .ok_or_else(|| invalid("retention scheduling requires a canonical target"))?;
                let retention_id: i64 = tx.query_row(
                    "INSERT INTO retention_check
                     (region_id,source_set_id,due_date,original_due_date,condition_json,state,
                      created_ts,updated_ts)
                     VALUES (?1,?2,?3,?3,?4,'due',?5,?5) RETURNING id",
                    rusqlite::params![region_id, block_id, due_date, json_to_sql(condition)?, now,],
                    |row| row.get(0),
                )?;
                tx.execute(
                    "INSERT INTO retention_check_event
                     (retention_check_id,from_state,to_state,due_date,original_due_date,
                      result_json,operation_id,created_ts)
                     VALUES (?1,NULL,'due',?2,?2,NULL,?3,?4)",
                    rusqlite::params![retention_id, due_date, pending.id, now],
                )?;
                (
                    "schedule_retention",
                    json!({
                        "retention_check_id": retention_id,
                        "region_id": region_id,
                        "due_date": due_date,
                        "condition": condition,
                    }),
                    required_text(rationale, "recovery rationale", 2000)?,
                )
            }
        };

        if kind == "break" {
            if before.set_state == "active" {
                close_interval(&tx, block_id, now, "pause", Some(pending.id))?;
            }
            if before.set_state != "paused" {
                tx.execute(
                    "UPDATE set_contract SET set_state='paused' WHERE set_id=?1",
                    [block_id],
                )?;
            }
        }

        payload["accepted"] = Value::Bool(true);
        let action_id: i64 = tx.query_row(
            "INSERT INTO practice_recovery_action
             (set_id,kind,after_attempt_id,payload_json,rationale,source,operation_id,created_ts)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8) RETURNING id",
            rusqlite::params![
                block_id,
                kind,
                after_attempt_id,
                json_to_sql(&payload)?,
                rationale,
                source_name(source),
                pending.id,
                now,
            ],
            |row| row.get(0),
        )?;
        let event_payload = json!({
            "block_id": block_id,
            "piece_id": before.piece_id,
            "recovery_action_id": action_id,
            "kind": kind,
            "after_attempt_id": after_attempt_id,
            "payload": payload,
            "rationale": rationale,
            "command_id": command_id,
        });
        let (_, event_id) = insert_loop_event(
            &tx,
            LoopEventWrite {
                session_id: Some(session.id),
                piece_id: before.piece_id,
                kind: "rep_recovery",
                payload: &event_payload,
                entity_type: "recovery_action",
                entity_id: action_id,
                source,
                command_id,
                now,
            },
        )?;
        let snapshot = project(&tx, block_id)?;
        let receipt = finish_operation(
            &tx,
            pending,
            &format!("Recovery accepted: {}.", kind.replace('_', " ")),
            &snapshot,
            vec![
                MutationEntityRef {
                    entity_type: "set".into(),
                    entity_id: block_id,
                },
                MutationEntityRef {
                    entity_type: "recovery_action".into(),
                    entity_id: action_id,
                },
            ],
            operation_event_ids(session, event_id),
            None,
        )?;
        tx.commit()?;
        Ok(receipt)
    }

    pub(crate) fn retention_due(
        &self,
        as_of_date: &str,
    ) -> rusqlite::Result<Vec<RetentionCheckView>> {
        let conn = self
            .conn
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        validate_date(&conn, as_of_date)?;
        let mut stmt = conn.prepare(
            "SELECT id FROM retention_check
             WHERE state IN ('due','snoozed') AND due_date<=?1
             ORDER BY due_date,id",
        )?;
        let ids = stmt
            .query_map([as_of_date], |row| row.get::<_, i64>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        ids.into_iter()
            .map(|id| retention_view(&conn, id))
            .collect()
    }

    /// Read-only: retention checks that are due or snoozed for ONE piece as of a
    /// date. Mirrors [`retention_due`] but scopes by joining region→piece; used
    /// to ground Brain answers. Performs no writes.
    pub fn retention_due_for_piece(
        &self,
        piece_id: i64,
        as_of_date: &str,
    ) -> rusqlite::Result<Vec<RetentionCheckView>> {
        let conn = self
            .conn
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        validate_date(&conn, as_of_date)?;
        let mut stmt = conn.prepare(
            "SELECT rc.id FROM retention_check rc
             JOIN region r ON r.id = rc.region_id
             WHERE r.piece_id = ?1 AND rc.state IN ('due','snoozed') AND rc.due_date <= ?2
             ORDER BY rc.due_date, rc.id",
        )?;
        let ids = stmt
            .query_map(rusqlite::params![piece_id, as_of_date], |row| {
                row.get::<_, i64>(0)
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        ids.into_iter()
            .map(|id| retention_view(&conn, id))
            .collect()
    }

    #[allow(clippy::too_many_arguments)]
    fn v2_retention_transition(
        &self,
        session_hint: Option<i64>,
        check_id: i64,
        transition: &str,
        due_date: Option<&str>,
        result: Option<&RetentionResult>,
        source: MutationSource,
        command_id: &str,
        now: &str,
    ) -> rusqlite::Result<MutationReceipt<RetentionCheckView>> {
        if let Some(date) = due_date {
            // Validate before beginning the durable operation so malformed
            // input leaves no practice-state row at all.
            let conn = self
                .conn
                .lock()
                .unwrap_or_else(|poison| poison.into_inner());
            validate_date(&conn, date)?;
        }
        let validated_result = match (transition, result) {
            ("snooze", None) => None,
            ("confirm", Some(result)) => Some(validate_retention_result(
                result,
                RetentionDecision::ConfirmRetained,
            )?),
            ("lower", Some(result)) => Some(validate_retention_result(
                result,
                RetentionDecision::LowerWorkingCondition,
            )?),
            ("reopen", Some(result)) => Some(validate_retention_result(
                result,
                RetentionDecision::ReopenTarget,
            )?),
            ("snooze", Some(_)) => return Err(invalid("snooze cannot carry result evidence")),
            _ => return Err(invalid("retention result evidence is required")),
        };
        let fingerprint = request_fingerprint(&json!({
            "retention_check_id": check_id,
            "transition": transition,
            "due_date": due_date,
            "result": validated_result,
        }))?;
        let mut conn = self
            .conn
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let tx = conn.transaction()?;
        let mut pending = match begin_operation(
            &tx,
            command_id,
            &format!("retention_{transition}"),
            &fingerprint,
            None,
            source,
            now,
        )? {
            OperationStart::Replay(mut receipt) => {
                receipt.value = Some(retention_view(&tx, check_id)?);
                return Ok(receipt);
            }
            OperationStart::New(pending) => pending,
        };
        let session = resolve_practice_session(&tx, session_hint, source, command_id, now)?;
        pending.session_id = Some(session.id);
        let before = retention_view(&tx, check_id)?;
        if !matches!(before.state.as_str(), "due" | "snoozed") {
            return Err(invalid("retention check is already resolved"));
        }
        let next_state = match transition {
            "snooze" => "snoozed",
            "confirm" => "confirmed",
            "lower" => "lowered",
            "reopen" => "reopened",
            _ => return Err(invalid("unknown retention transition")),
        };
        if transition == "snooze" && due_date.is_none() {
            return Err(invalid("snooze requires a new due date"));
        }
        if let Some(result) = &validated_result {
            if result.checked_as_of < before.due_date {
                return Err(invalid(
                    "checked_as_of cannot precede the retention due date",
                ));
            }
        }
        let next_due = due_date.unwrap_or(&before.due_date);
        if transition == "snooze" && next_due <= before.due_date.as_str() {
            return Err(invalid("snooze date must move forward"));
        }
        let result_json = validated_result.as_ref().map(json_to_sql).transpose()?;
        tx.execute(
            "UPDATE retention_check
             SET due_date=?2,state=?3,result_json=?4,
                 completed_ts=CASE WHEN ?3='snoozed' THEN NULL ELSE ?5 END,
                 updated_ts=?5
             WHERE id=?1",
            rusqlite::params![check_id, next_due, next_state, result_json, now],
        )?;
        tx.execute(
            "INSERT INTO retention_check_event
             (retention_check_id,from_state,to_state,due_date,original_due_date,
              result_json,operation_id,created_ts)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
            rusqlite::params![
                check_id,
                before.state,
                next_state,
                next_due,
                before.original_due_date,
                result_json,
                pending.id,
                now,
            ],
        )?;
        let piece_id: i64 = tx.query_row(
            "SELECT r.piece_id FROM retention_check c JOIN region r ON r.id=c.region_id
             WHERE c.id=?1",
            [check_id],
            |row| row.get(0),
        )?;
        let payload = json!({
            "retention_check_id": check_id,
            "from_state": before.state,
            "to_state": next_state,
            "due_date": next_due,
            "original_due_date": before.original_due_date,
            "result": validated_result,
            "command_id": command_id,
        });
        let (_, event_id) = insert_loop_event(
            &tx,
            LoopEventWrite {
                session_id: Some(session.id),
                piece_id,
                kind: &format!("retention_{transition}"),
                payload: &payload,
                entity_type: "retention_check",
                entity_id: check_id,
                source,
                command_id,
                now,
            },
        )?;
        let after = retention_view(&tx, check_id)?;
        let receipt = finish_operation(
            &tx,
            pending,
            &format!("Retention check {}.", next_state),
            &after,
            vec![MutationEntityRef {
                entity_type: "retention_check".into(),
                entity_id: check_id,
            }],
            operation_event_ids(session, event_id),
            None,
        )?;
        tx.commit()?;
        Ok(receipt)
    }

    pub(crate) fn retention_snooze(
        &self,
        session_hint: Option<i64>,
        check_id: i64,
        due_date: &str,
        source: MutationSource,
        command_id: &str,
        now: &str,
    ) -> rusqlite::Result<MutationReceipt<RetentionCheckView>> {
        self.v2_retention_transition(
            session_hint,
            check_id,
            "snooze",
            Some(due_date),
            None,
            source,
            command_id,
            now,
        )
    }

    pub(crate) fn retention_confirm(
        &self,
        session_hint: Option<i64>,
        check_id: i64,
        result: &RetentionResult,
        source: MutationSource,
        command_id: &str,
        now: &str,
    ) -> rusqlite::Result<MutationReceipt<RetentionCheckView>> {
        self.v2_retention_transition(
            session_hint,
            check_id,
            "confirm",
            None,
            Some(result),
            source,
            command_id,
            now,
        )
    }

    pub(crate) fn retention_lower(
        &self,
        session_hint: Option<i64>,
        check_id: i64,
        result: &RetentionResult,
        source: MutationSource,
        command_id: &str,
        now: &str,
    ) -> rusqlite::Result<MutationReceipt<RetentionCheckView>> {
        self.v2_retention_transition(
            session_hint,
            check_id,
            "lower",
            None,
            Some(result),
            source,
            command_id,
            now,
        )
    }

    pub(crate) fn retention_reopen(
        &self,
        session_hint: Option<i64>,
        check_id: i64,
        result: &RetentionResult,
        source: MutationSource,
        command_id: &str,
        now: &str,
    ) -> rusqlite::Result<MutationReceipt<RetentionCheckView>> {
        self.v2_retention_transition(
            session_hint,
            check_id,
            "reopen",
            None,
            Some(result),
            source,
            command_id,
            now,
        )
    }

    /// Reconcile a live set after process relaunch. The old open interval is
    /// closed at its last durable checkpoint, never at relaunch time, so the
    /// offline gap contributes exactly zero. Active sets then begin a fresh
    /// interval; paused sets remain paused.
    pub(crate) fn v2_restore_active_at(&self, now: &str) -> rusqlite::Result<Option<RepSnapshot>> {
        let mut conn = self
            .conn
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        validate_timestamp(&conn, now)?;
        let tx = conn.transaction()?;
        let mut stmt = tx.prepare(
            "SELECT set_id,set_state FROM set_contract WHERE set_state IN ('active','paused')
             ORDER BY set_id DESC LIMIT 2",
        )?;
        let live = stmt
            .query_map([], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        drop(stmt);
        if live.len() > 1 {
            return Err(invalid(format!(
                "multiple active practice sets require review: {:?}",
                live.iter().map(|(id, _)| id).collect::<Vec<_>>()
            )));
        }
        let Some((set_id, set_state)) = live.first() else {
            tx.commit()?;
            return Ok(None);
        };

        let has_context: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM practice_set_context WHERE set_id=?1)",
            [set_id],
            |row| row.get(0),
        )?;
        if !has_context {
            tx.execute(
                "INSERT INTO practice_set_context
                 (set_id,judging_axis,hands,method,planned_seconds,captured_ts)
                 SELECT b.id,b.focus,'unspecified','unspecified',c.planned_seconds,?2
                 FROM rep_block b JOIN set_contract c ON c.set_id=b.id WHERE b.id=?1",
                rusqlite::params![set_id, now],
            )?;
        }

        let open_interval = tx
            .query_row(
                "SELECT id,last_checkpoint_ts FROM practice_interval
                 WHERE set_id=?1 AND ended_ts IS NULL",
                [set_id],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()?;
        if let Some((interval_id, checkpoint)) = open_interval {
            tx.execute(
                "UPDATE practice_interval
                 SET ended_ts=?2,end_reason='crash_checkpoint'
                 WHERE id=?1",
                rusqlite::params![interval_id, checkpoint],
            )?;
        }
        if set_state == "active" {
            start_interval(&tx, *set_id, now, None)?;
        }
        let snapshot = project(&tx, *set_id)?;
        tx.commit()?;
        Ok(Some(snapshot))
    }
}
