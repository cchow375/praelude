//! Honest, read-only projection of disclosed data anomalies.
//!
//! The v8 migration/backfill records shape observations about legacy practice
//! data into the `data_anomaly` table. The binding principle is that anomalies
//! are *projected, never silently repaired* — this module only reads them and
//! groups them for disclosure. It never writes, corrects, or judges: the
//! observations are about the *shape* of the stored data, never about how the
//! human played. The audited archive/correction flow is future work.

use serde::Serialize;

use crate::store::model::AnomalyRow;
use crate::store::Store;

/// The full disclosure payload the anomaly panel renders. Grouped by kind so
/// the UI can explain each shape once and list every affected entity under it.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub(crate) struct AnomalyReport {
    /// When this read was taken (RFC3339). Nothing here is persisted.
    pub generated_at: String,
    /// Total disclosed anomalies across every kind.
    pub total: usize,
    /// One group per distinct anomaly kind, most serious first.
    pub groups: Vec<AnomalyGroup>,
}

/// Every anomaly of a single kind, with its count and the affected rows.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub(crate) struct AnomalyGroup {
    /// The stable machine kind (e.g. `same_second_attempt_burst`). The UI keys
    /// its plain-language explanation off this string.
    pub kind: String,
    /// Uniform severity for the kind: `info`, `warning`, or `error`.
    pub severity: String,
    /// How many rows of this kind were disclosed.
    pub count: usize,
    /// The individual affected entities, in stable id order.
    pub rows: Vec<AnomalyEntry>,
}

/// One disclosed anomaly: which entity it concerns and the observed facts.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub(crate) struct AnomalyEntry {
    pub id: i64,
    /// One of the `data_anomaly.entity_type` values
    /// (`piece`/`target`/`set`/`attempt`/`session`/`event`).
    pub entity_type: String,
    pub entity_id: i64,
    /// Review state; always `open` in this read-only slice.
    pub review_state: String,
    /// The parsed `observed_facts_json` payload — the human-relevant references
    /// (piece/region/set/attempt ids, measure ranges, timestamps) the backfill
    /// recorded for this row. Passed through verbatim so the UI can disclose
    /// exactly what was observed.
    pub detail: serde_json::Value,
    pub created_ts: String,
    pub reviewed_ts: Option<String>,
}

/// Rank severities so the most serious kinds surface first. Unknown values sort
/// last rather than panicking — disclosure must stay calm, never error.
fn severity_rank(severity: &str) -> u8 {
    match severity {
        "error" => 0,
        "warning" => 1,
        "info" => 2,
        _ => 3,
    }
}

/// Parse the stored observed-facts TEXT into a JSON value. A malformed payload
/// is disclosed honestly as `{ "raw": <text> }` rather than dropped or panicked
/// on — production writes valid JSON, but the reader never trusts that blindly.
fn parse_detail(text: &str) -> serde_json::Value {
    serde_json::from_str(text).unwrap_or_else(|_| serde_json::json!({ "raw": text }))
}

/// Read every disclosed anomaly and group it for the review UI. Read-only: no
/// writes occur, and the returned shape carries no repair actions.
pub(crate) fn report(store: &Store) -> rusqlite::Result<AnomalyReport> {
    let rows = store.list_anomalies()?;
    let generated_at = store.now_rfc3339()?;
    let total = rows.len();

    // `list_anomalies` orders by kind then id, so same-kind rows are already
    // contiguous — accumulate into the trailing group as we walk them.
    let mut groups: Vec<AnomalyGroup> = Vec::new();
    for row in rows {
        let AnomalyRow {
            id,
            entity_type,
            entity_id,
            kind,
            observed_facts_json,
            severity,
            review_state,
            created_ts,
            reviewed_ts,
        } = row;
        let entry = AnomalyEntry {
            id,
            entity_type,
            entity_id,
            review_state,
            detail: parse_detail(&observed_facts_json),
            created_ts,
            reviewed_ts,
        };
        match groups.last_mut() {
            Some(group) if group.kind == kind => group.rows.push(entry),
            _ => groups.push(AnomalyGroup {
                kind,
                severity,
                count: 0,
                rows: vec![entry],
            }),
        }
    }

    for group in &mut groups {
        group.count = group.rows.len();
    }
    // Most serious first; ties broken by larger count then kind for stability.
    groups.sort_by(|a, b| {
        severity_rank(&a.severity)
            .cmp(&severity_rank(&b.severity))
            .then(b.count.cmp(&a.count))
            .then(a.kind.cmp(&b.kind))
    });

    Ok(AnomalyReport {
        generated_at,
        total,
        groups,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::Store;

    fn mem() -> Store {
        Store::open(":memory:").expect("open in-memory store")
    }

    /// Seed `data_anomaly` rows directly — production never fabricates these
    /// outside the migration/backfill path, so the test writes the SQL itself.
    fn seed_anomalies(store: &Store) {
        store.exec_for_test(
            "INSERT INTO data_anomaly
               (fingerprint, entity_type, entity_id, kind, observed_facts_json, severity)
             VALUES
               ('reversed_range:set:45', 'set', 45, 'reversed_range',
                  '{\"m_start\":452,\"m_end\":449}', 'error'),
               ('empty_set:set:7', 'set', 7, 'empty_set',
                  '{\"recorded_attempts\":0}', 'info'),
               ('empty_set:set:9', 'set', 9, 'empty_set',
                  '{\"recorded_attempts\":0}', 'info'),
               ('same_second_attempt_burst:set:3:t', 'set', 3, 'same_second_attempt_burst',
                  '{\"timestamp\":\"2026-01-01 10:00:00\",\"count\":2,\"attempt_ids\":[11,12]}', 'warning');",
        );
    }

    #[test]
    fn malformed_observed_facts_degrade_to_raw_without_panicking() {
        let store = mem();
        store.exec_for_test(
            "INSERT INTO data_anomaly
               (fingerprint, entity_type, entity_id, kind, observed_facts_json, severity)
             VALUES
               ('empty_set:set:1', 'set', 1, 'empty_set', 'not json {', 'info');",
        );

        let report = report(&store).expect("report");

        assert_eq!(report.total, 1);
        assert_eq!(
            report.groups[0].rows[0].detail,
            serde_json::json!({ "raw": "not json {" })
        );
    }

    #[test]
    fn projects_rows_grouped_by_kind_with_counts() {
        let store = mem();
        seed_anomalies(&store);

        let report = report(&store).expect("report");

        assert_eq!(report.total, 4);
        assert_eq!(report.groups.len(), 3);

        // Most serious first: error, then warning, then info.
        let kinds: Vec<&str> = report.groups.iter().map(|g| g.kind.as_str()).collect();
        assert_eq!(
            kinds,
            vec!["reversed_range", "same_second_attempt_burst", "empty_set"]
        );

        let empty = report
            .groups
            .iter()
            .find(|g| g.kind == "empty_set")
            .expect("empty_set group");
        assert_eq!(empty.severity, "info");
        assert_eq!(empty.count, 2);
        assert_eq!(empty.rows.len(), 2);
        // Rows stay in id order and carry references + parsed detail verbatim.
        assert_eq!(empty.rows[0].entity_type, "set");
        assert_eq!(empty.rows[0].entity_id, 7);
        assert_eq!(empty.rows[1].entity_id, 9);

        let burst = report
            .groups
            .iter()
            .find(|g| g.kind == "same_second_attempt_burst")
            .expect("burst group");
        assert_eq!(burst.rows[0].detail["count"], serde_json::json!(2));
        assert_eq!(
            burst.rows[0].detail["attempt_ids"],
            serde_json::json!([11, 12])
        );
        // Read-only slice: every disclosed row is still open.
        assert_eq!(burst.rows[0].review_state, "open");
    }

    #[test]
    fn empty_database_reports_no_anomalies_calmly() {
        let store = mem();

        let report = report(&store).expect("report");

        assert_eq!(report.total, 0);
        assert!(report.groups.is_empty());
        assert!(!report.generated_at.is_empty());
    }

    #[test]
    fn reading_never_mutates_the_anomaly_rows() {
        let store = mem();
        seed_anomalies(&store);

        let before = store.list_anomalies().expect("before").len();
        let _ = report(&store).expect("report");
        let _ = report(&store).expect("second report");
        let after = store.list_anomalies().expect("after").len();

        assert_eq!(before, 4);
        assert_eq!(before, after);
    }
}
