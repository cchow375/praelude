//! Mechanical schema-v8 compatibility rows and anomaly projections.
//!
//! This worker runs inside the migration's BEGIN IMMEDIATE transaction. It may
//! copy facts into additive sidecars, but it never updates or deletes a v1 row.

use rusqlite::Connection;
use serde_json::{json, Value};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct BackfillStats {
    pub target_meta: usize,
    pub legacy_contracts: usize,
    pub legacy_provenance: usize,
    pub anomalies: usize,
}

pub(crate) fn backfill_v8(conn: &Connection) -> rusqlite::Result<BackfillStats> {
    conn.execute(
        "INSERT OR IGNORE INTO protocol_template
         (id,contract_version,name,rationale,mastery_basis,required_success,
          reset_on_flawed,reset_on_failed,recovery_policy,recovery_value,
          recovery_minimum,tempo_policy_json,attempt_ceiling,planned_seconds,
          retention_delay_days,source_refs_json,user_editable)
         VALUES
         ('default-consecutive-clean-v1',1,'Five clean in a row',
          'A configurable stabilization starting point; attempts are not mastery.',
          'consecutive_clean',5,1,1,'none',0,5,'{}',NULL,NULL,NULL,
          '[]',1)",
        [],
    )?;

    let target_meta = conn.execute(
        "INSERT OR IGNORE INTO target_meta
         (region_id,color,display_order,mapping_evidence_version)
         SELECT id,color,sort_order,1
         FROM region",
        [],
    )?;

    // A historical done flag described only the v1 attempt-count boundary.
    // Preserve it as legacy_closed and explicitly refuse to infer mastery.
    let legacy_contracts = conn.execute(
        "INSERT OR IGNORE INTO set_contract
         (set_id,template_id,contract_version,name,rationale,mastery_basis,
          required_success,reset_on_flawed,reset_on_failed,recovery_policy,
          recovery_value,recovery_minimum,tempo_policy_json,attempt_ceiling,
          planned_seconds,retention_delay_days,source_refs_json,set_state,
          mastery_verification,restart_of_set_id,source)
         SELECT id,NULL,1,'Legacy attempt-count record',
                'Compatibility marker from v1; the source row is retained unchanged and clean-streak mastery was not recorded.',
                'legacy_attempt_count',
                CASE WHEN planned_reps < 0 THEN 0 ELSE planned_reps END,
                0,0,'none',0,0,'{}',
                CASE WHEN planned_reps >= 1 THEN planned_reps ELSE NULL END,
                NULL,NULL,'[]',
                CASE status
                  WHEN 'done' THEN 'legacy_closed'
                  WHEN 'abandoned' THEN 'abandoned'
                  ELSE 'legacy_open'
                END,
                'unverified',NULL,'migration_legacy'
         FROM rep_block",
        [],
    )?;

    let legacy_provenance = conn.execute(
        "INSERT OR IGNORE INTO attempt_provenance
         (rep_id,source,command_id,canonical_event_id,recorded_ts)
         SELECT id,'migration_legacy',NULL,NULL,COALESCE(ts,datetime('now'))
         FROM rep",
        [],
    )?;

    let mut stats = BackfillStats {
        target_meta,
        legacy_contracts,
        legacy_provenance,
        anomalies: 0,
    };

    for (id, start, end) in query_triples(
        conn,
        "SELECT id,m_start,m_end FROM region WHERE m_start > m_end ORDER BY id",
    )? {
        stats.anomalies += insert_anomaly(
            conn,
            format!("reversed_range:target:{id}"),
            "target",
            id,
            "reversed_range",
            json!({"m_start": start, "m_end": end}),
            "error",
        )?;
    }

    for (id, start, end) in query_triples(
        conn,
        "SELECT id,m_start,m_end FROM rep_block WHERE m_start > m_end ORDER BY id",
    )? {
        stats.anomalies += insert_anomaly(
            conn,
            format!("reversed_range:set:{id}"),
            "set",
            id,
            "reversed_range",
            json!({"m_start": start, "m_end": end}),
            "error",
        )?;
    }

    for (entity_type, table) in [("target", "region"), ("set", "rep_block")] {
        let sql = format!(
            "SELECT id,m_start,m_end FROM {table}
             WHERE m_start < 1 OR m_end < 1 ORDER BY id"
        );
        for (id, start, end) in query_triples(conn, &sql)? {
            stats.anomalies += insert_anomaly(
                conn,
                format!("nonpositive_range:{entity_type}:{id}"),
                entity_type,
                id,
                "nonpositive_range",
                json!({"m_start": start, "m_end": end}),
                "error",
            )?;
        }
    }

    let invalid_plans = {
        let mut statement = conn
            .prepare("SELECT id,planned_reps FROM rep_block WHERE planned_reps < 0 ORDER BY id")?;
        let rows =
            statement.query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };
    for (id, planned_attempts) in invalid_plans {
        stats.anomalies += insert_anomaly(
            conn,
            format!("invalid_planned_attempts:set:{id}"),
            "set",
            id,
            "invalid_planned_attempts",
            json!({"planned_attempts": planned_attempts}),
            "error",
        )?;
    }

    let overruns = {
        let mut statement = conn.prepare(
            "SELECT b.id,b.planned_reps,count(r.id)
             FROM rep_block b JOIN rep r ON r.block_id=b.id
             GROUP BY b.id,b.planned_reps
             HAVING count(r.id) > b.planned_reps
             ORDER BY b.id",
        )?;
        let rows = statement.query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };
    for (id, planned, attempts) in overruns {
        stats.anomalies += insert_anomaly(
            conn,
            format!("attempt_overrun:set:{id}"),
            "set",
            id,
            "attempt_overrun",
            json!({
                "planned_attempts": planned,
                "recorded_attempts": attempts,
                "overrun": attempts - planned
            }),
            "warning",
        )?;
    }

    let empty_sets = query_ids(
        conn,
        "SELECT b.id FROM rep_block b
         LEFT JOIN rep r ON r.block_id=b.id
         GROUP BY b.id HAVING count(r.id)=0 ORDER BY b.id",
    )?;
    for id in empty_sets {
        stats.anomalies += insert_anomaly(
            conn,
            format!("empty_set:set:{id}"),
            "set",
            id,
            "empty_set",
            json!({"recorded_attempts": 0}),
            "info",
        )?;
    }

    for id in query_ids(
        conn,
        "SELECT id FROM rep_block WHERE status='abandoned' ORDER BY id",
    )? {
        stats.anomalies += insert_anomaly(
            conn,
            format!("abandoned_legacy_set:set:{id}"),
            "set",
            id,
            "abandoned_legacy_set",
            json!({"legacy_status": "abandoned"}),
            "info",
        )?;
    }

    let duplicate_pairs = {
        let mut statement = conn.prepare(
            "SELECT newer.id,older.id,newer.piece_id,newer.m_start,newer.m_end
             FROM rep_block newer
             JOIN rep_block older
               ON older.id < newer.id
              AND older.piece_id = newer.piece_id
              AND older.m_start = newer.m_start
              AND older.m_end = newer.m_end
              AND lower(trim(COALESCE(older.label,''))) =
                  lower(trim(COALESCE(newer.label,'')))
             ORDER BY newer.id,older.id",
        )?;
        let rows = statement.query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, i64>(4)?,
            ))
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };
    for (newer, older, piece_id, start, end) in duplicate_pairs {
        stats.anomalies += insert_anomaly(
            conn,
            format!("duplicate_candidate:set:{newer}:{older}"),
            "set",
            newer,
            "duplicate_candidate",
            json!({
                "candidate_set_id": older,
                "piece_id": piece_id,
                "m_start": start,
                "m_end": end
            }),
            "warning",
        )?;
    }

    let bursts = {
        let mut statement = conn.prepare(
            "SELECT block_id,ts,count(*)
             FROM rep
             GROUP BY block_id,ts
             HAVING count(*) > 1
             ORDER BY block_id,ts",
        )?;
        let rows = statement.query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };
    for (set_id, timestamp, count) in bursts {
        let attempt_ids = {
            let mut statement =
                conn.prepare("SELECT id FROM rep WHERE block_id=?1 AND ts=?2 ORDER BY id")?;
            let rows = statement.query_map(rusqlite::params![set_id, &timestamp], |row| {
                row.get::<_, i64>(0)
            })?;
            rows.collect::<rusqlite::Result<Vec<_>>>()?
        };
        stats.anomalies += insert_anomaly(
            conn,
            format!("same_second_attempt_burst:set:{set_id}:{timestamp}"),
            "set",
            set_id,
            "same_second_attempt_burst",
            json!({
                "timestamp": timestamp,
                "count": count,
                "attempt_ids": attempt_ids
            }),
            "warning",
        )?;
    }

    // Existing generic events have no mechanically knowable input source or
    // command identity. Preserve them untouched and expose that uncertainty.
    let incomplete_events = {
        let mut statement = conn.prepare(
            "SELECT id,source,command_id
             FROM event WHERE source IS NULL OR command_id IS NULL ORDER BY id",
        )?;
        let rows = statement.query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
            ))
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };
    for (id, source, command_id) in incomplete_events {
        stats.anomalies += insert_anomaly(
            conn,
            format!("incomplete_event_provenance:event:{id}"),
            "event",
            id,
            "incomplete_event_provenance",
            json!({"source": source, "command_id": command_id}),
            "info",
        )?;
    }

    Ok(stats)
}

fn query_ids(conn: &Connection, sql: &str) -> rusqlite::Result<Vec<i64>> {
    let mut statement = conn.prepare(sql)?;
    let rows = statement.query_map([], |row| row.get(0))?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
}

fn query_triples(conn: &Connection, sql: &str) -> rusqlite::Result<Vec<(i64, i64, i64)>> {
    let mut statement = conn.prepare(sql)?;
    let rows = statement.query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
}

#[allow(clippy::too_many_arguments)]
fn insert_anomaly(
    conn: &Connection,
    fingerprint: String,
    entity_type: &str,
    entity_id: i64,
    kind: &str,
    facts: Value,
    severity: &str,
) -> rusqlite::Result<usize> {
    let facts = serde_json::to_string(&facts)
        .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
    conn.execute(
        "INSERT OR IGNORE INTO data_anomaly
         (fingerprint,entity_type,entity_id,kind,observed_facts_json,severity)
         VALUES (?1,?2,?3,?4,?5,?6)",
        rusqlite::params![fingerprint, entity_type, entity_id, kind, facts, severity],
    )
}
